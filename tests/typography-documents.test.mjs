import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from '../dist/pdf/library.mjs';
import {acceptanceDocument} from '../server/acceptance-document.mjs';
import {protocolDocument} from '../server/protocol-document.mjs';
import {protocolDownload} from '../server/protocol-mail.mjs';
import {createApplication} from '../server/application.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {digest} from '../server/auth.mjs';
import {COMPANY} from '../src/company.mjs';
import {mailDocumentPolicy,outboundHtml} from '../server/mail-html.mjs';
import {pdfText} from './pdf-text.mjs';

test('new PDFs embed Jakarta body text and Syne titles and amounts with German and extended Latin characters',async t=>{
  const drawn=[],addPage=PDFDocument.prototype.addPage;
  t.mock.method(PDFDocument.prototype,'addPage',function(...args){
    const page=addPage.apply(this,args),drawText=page.drawText;
    page.drawText=function(value,options){drawn.push({value,font:options.font});return drawText.call(this,value,options);};
    return page;
  });
  const order={wg:'WG-TYPO-TEST',synthetic:true,source:{name:'TEST · Müller Şahin',vehicle:'TEST'},offer:{lines:[{title:'TEST · Reinigung',amountCents:123456}],totalCents:123456},acceptance:{at:'2026-11-11T10:00:00Z',mode:'online'}};
  const result=await acceptanceDocument({},order);
  assert.equal(Buffer.from(result.bytes.subarray(0,5)).toString(),'%PDF-');
  assert.equal(drawn.find(row=>row.value==='Auftragsbestätigung').font.name,'Syne-ExtraBold');
  assert.equal(drawn.find(row=>row.value==='Kunde und Fahrzeug').font.name,'Syne-Bold');
  const name=drawn.find(row=>row.value==='TEST · Müller Şahin');
  assert.equal(name.font.name,'PlusJakartaSans-Regular');
  for(const char of 'ÄÖÜäöüßŞ€µ')assert.ok(name.font.getCharacterSet().includes(char.codePointAt(0)),char+' is embedded');
  assert.equal(drawn.find(row=>row.value.includes('1.234,56')).font.name,'Syne-ExtraBold');
  drawn.length=0;
  await protocolDocument({}, {...order,intake:{business:COMPANY,customerName:'TEST · Müller Şahin',condition:'TEST · Tür geprüft',savedAt:'2026-11-11T10:00:00Z'}},'intake');
  assert.equal(drawn.find(row=>row.value==='Fahrzeugannahmeprotokoll').font.name,'Syne-ExtraBold');
  assert.equal(drawn.find(row=>row.value==='Fahrzeug und Übergabe').font.name,'Syne-Bold');
  assert.equal(drawn.find(row=>row.value==='TEST · Tür geprüft').font.name,'PlusJakartaSans-Regular');
  assert.ok(drawn.every(row=>!row.font.name.startsWith('NotoSans')),'Latin text uses only the new primary fonts');
});

test('new PDFs preserve Cyrillic, Greek and combining accents through measured legacy-font runs',async t=>{
  const drawn=[],addPage=PDFDocument.prototype.addPage;
  t.mock.method(PDFDocument.prototype,'addPage',function(...args){
    const page=addPage.apply(this,args),drawText=page.drawText;
    page.drawText=function(value,options){drawn.push({value,...options});return drawText.call(this,value,options);};
    return page;
  });
  const mixed='TEST · Иван Петров · Γιάννης · Мари́я · Γιάννης · Müller Şahin · 1.234,56 €';
  const long='TEST · '+('Согласованная обработка · Συμφωνημένη φροντίδα · vollständige Pflege · '.repeat(5))+'FINAL SCOPE';
  const order={wg:'WG-TYPO-TEST',synthetic:true,source:{name:mixed,vehicle:'TEST'},offer:{lines:[{title:long,amountCents:123456}],totalCents:123456},acceptance:{at:'2026-11-11T10:00:00Z',mode:'online'}};
  for(const kind of ['acceptance','intake']){
    drawn.length=0;
    const pdf=kind==='acceptance'?await acceptanceDocument({},order):await protocolDocument({}, {...order,intake:{business:COMPANY,customerName:mixed,condition:long,savedAt:'2026-11-11T10:00:00Z'}},'intake');
    const text=(await pdfText(pdf.bytes)).replace(/\s+/g,'');
    assert.ok(text.includes(mixed.replace(/\s+/g,'')),'all mixed-name characters survive actual PDF encoding');
    assert.ok(text.includes(long.replace(/\s+/g,'')),'long multilingual content survives line and page wrapping');
    const accented=drawn.find(row=>row.value.includes('Мари́я'));
    assert.ok(accented?.font.name.startsWith('NotoSans'),'base letter and combining accent stay in the same legacy-font run');
    assert.ok(drawn.some(row=>row.value.includes('Müller Şahin')&&row.font.name==='PlusJakartaSans-Regular'),'supported Latin stays in Jakarta');
    for(const row of drawn)assert.ok(row.x>=42&&row.x+row.font.widthOfTextAtSize(row.value,row.size)<=554,'every actual font run fits the existing PDF text area');
  }
  // This change preserves the previous missing-glyph behavior for a character
  // absent from the original Noto font; it must not newly block a stored name.
  await assert.doesNotReject(()=>acceptanceDocument({}, {...order,source:{...order.source,name:'TEST · Müller 🚗'}}));
});

test('existing signed PDF bytes are returned unchanged without rendering or writing a replacement',async t=>{
  const legacy=await PDFDocument.create();legacy.addPage().drawText('TEST - stored signed original');const bytes=await legacy.save();
  const env={PANEL_ORIGIN:'https://panel.example.invalid',OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:{fetch:async()=>new Response('shell')},BUCKET:{get:async()=>({body:bytes}),put:async()=>{throw Error('An existing PDF must never be replaced.');}}};
  t.after(()=>env.DB.close());await createApplication(env);
  t.mock.method(PDFDocument,'create',()=>{throw Error('An existing PDF must never be rendered again.');});
  for(const kind of ['intake','return','acceptance']){
    const at='2026-11-11T10:00:00Z',order={id:randomUUID(),wg:'WG-TYPO-'+kind.toUpperCase(),status:'Erledigt',source:{name:'TEST'},[kind]:{at,savedAt:at}},asset=randomUUID(),job=randomUUID();
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(order.id,order.wg,order.status,JSON.stringify(order),at,'test','fixture').run();
    await env.DB.prepare("INSERT INTO assets VALUES(?,?,'protocol','application/pdf',?,?,?)").bind(asset,order.id,digest(bytes),bytes.length,at).run();
    if(kind==='acceptance'){
      const snapshot=JSON.stringify(order);
      await env.DB.prepare('INSERT INTO acceptance_deliveries(job_id,order_id,acceptance_version,snapshot_hash,snapshot,recipient,copy_to,asset_id) VALUES(?,?,?,?,?,?,?,?)').bind(job,order.id,at,digest(snapshot),snapshot,'test@example.invalid','',asset).run();
    }else await env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to,asset_id) VALUES(?,?,?,?,?,?,?)').bind(job,order.id,kind,at,'test@example.invalid','',asset).run();
    const response=await protocolDownload(env,order.id,kind);
    assert.equal(response.headers.get('content-type'),'application/pdf');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
  }
});

test('outgoing HTML uses owned font URLs while received mail keeps its isolated font policy',()=>{
  const html=outboundHtml('<p>TEST · Müller · 1.234,56 €</p>','https://panel.example.invalid');
  assert.match(html,/https:\/\/panel\.example\.invalid\/syne-variable\.woff2/);
  assert.match(html,/https:\/\/panel\.example\.invalid\/plus-jakarta-sans-variable\.woff2/);
  assert.match(html,/<p>TEST · Müller · 1.234,56 €<\/p>/);
  assert.doesNotMatch(html,/fonts\.googleapis|fonts\.gstatic|Arial|Helvetica/);
  assert.doesNotMatch(outboundHtml('<p>TEST</p>','http://unsafe.example.invalid'),/src:url/);
  assert.match(mailDocumentPolicy(false),/default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:/);
  assert.doesNotMatch(mailDocumentPolicy(false),/font-src[^;]*(?:https:|'self')/);
});

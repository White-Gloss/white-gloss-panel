// Communication Center: Liste, sichere HTML-Darstellung, CC/BCC, Anhänge und Threading.
// Synthetische Daten, isoliertes SQLite, SMTP nur über Testadapter; kein Server, keine externe Verbindung.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';
import {sanitizeInboundHtml,mailDocument,sanitizeComposeHtml,htmlToText} from '../server/mail-html.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const PDF=Buffer.from('%PDF-1.7\nsynthetic outbound attachment\n%%EOF');
const PNG=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(40,1)]);
async function fixture(t,mailbox={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,21).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},MAILBOX_ADAPTERS:mailbox};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const headers={origin,cookie:'__Host-wg-session='+raw};
  const call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  const upload=(name,bytes,type,extra={})=>app.fetch(new Request(origin+'/api/mailbox/upload?name='+encodeURIComponent(name),{method:'POST',headers:{...headers,'Content-Type':type,...extra},body:bytes}));
  return {env,call,upload,files};
}
let uid=100;
function raw({from='Kunde <kunde@example.invalid>',subject='Anfrage',body='Guten Tag',html='',cc='',messageId=`<${randomUUID()}@example.invalid>`,inReplyTo='',date='Sat, 17 Oct 2026 10:00:00 +0200',attachment=null}={}){
  const head=`From: ${from}\r\nTo: ${owner}\r\n${cc?'Cc: '+cc+'\r\n':''}Subject: ${subject}\r\nMessage-ID: ${messageId}\r\n${inReplyTo?'In-Reply-To: '+inReplyTo+'\r\nReferences: '+inReplyTo+'\r\n':''}Date: ${date}\r\nMIME-Version: 1.0\r\n`;
  if(attachment){const boundary='feature-boundary';return Buffer.from(head+`Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="Beleg.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment.toString('base64')}\r\n--${boundary}--\r\n`);}
  return Buffer.from(head+`Content-Type: ${html?'text/html':'text/plain'}; charset=utf-8\r\n\r\n${html||body}\r\n`);
}
const ingest=(f,options,synthetic=false)=>ingestMessage(f.env,raw(options),{folder:'INBOX',uid:++uid,uidValidity:'features'},{synthetic});
async function smtp(f){assert.equal((await f.call('/api/mailbox/settings',{email:owner,displayName:'White Gloss',imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret'})).status,200);assert.equal((await f.call('/api/mailbox/check',{kind:'smtp'})).status,200);}

test('sanitizer removes active content, keeps safe links and blocks remote images until released',()=>{
  const stored=sanitizeInboundHtml('<style>p{color:red;background:url(https://track.example.invalid/a.png)}</style><scr<script>x</script>ipt>alert(1)</script><img/onerror=alert(1) src=x><img src="https://track.example.invalid/p.gif"><a href="jav&#x61;script:alert(1)">x</a><a href="https://ok.example.invalid/">ok</a><form action="https://evil.example.invalid"><input name=a><button>Senden</button></form><iframe src="https://evil.example.invalid"></iframe><svg><script>alert(2)</script></svg>1 < 2');
  assert.doesNotMatch(stored,/<script|onerror|javascript:|<iframe|<form|<input|<svg/i);assert.match(stored,/https:\/\/ok\.example\.invalid/);assert.match(stored,/1 &lt; 2/);
  const blocked=mailDocument(stored,{images:false});assert.equal(blocked.blockedImages,2);assert.doesNotMatch(blocked.html,/track\.example\.invalid\/p\.gif|url\(https:/);assert.match(blocked.html,/rel="noopener noreferrer"/);
  const released=mailDocument(stored,{images:true});assert.equal(released.blockedImages,0);assert.match(released.html,/track\.example\.invalid\/p\.gif/);
  assert.equal(sanitizeComposeHtml('<div style="x" onclick="y"><b>Hallo</b> <a href="javascript:x">j</a><a href="https://a.example.invalid" class="c">a</a><img src="https://x"><script>1</script></div>'),'<div><b>Hallo</b> <a target="_blank" rel="noopener noreferrer">j</a><a href="https://a.example.invalid" target="_blank" rel="noopener noreferrer">a</a></div>');
  assert.equal(htmlToText('<p>Hallo &amp; <b>Welt</b></p><ul><li>a</li></ul>'),'Hallo & Welt\n• a');
});

test('HTML mail is served in its own sandbox with blocked external images by default',async t=>{
  const f=await fixture(t),message=await ingest(f,{html:'<html><head><style>.x{color:#123}</style></head><body><p class="x">Newsletter</p><img src="https://cdn.example.invalid/logo.png"><a href="https://shop.example.invalid">Shop</a><script>alert(1)</script></body></html>'});
  const detail=await (await f.call('/api/mailbox/message/'+message.id)).json();assert.equal(detail.message.hasHtml,true);assert.equal(detail.message.blockedImages,1);assert.doesNotMatch(detail.message.htmlBody,/<script/);
  const blocked=await f.call(`/api/mailbox/message/${message.id}/view`);assert.equal(blocked.status,200);const policy=blocked.headers.get('content-security-policy');
  assert.match(policy,/^sandbox allow-popups allow-popups-to-escape-sandbox allow-same-origin;/);assert.match(policy,/default-src 'none'/);assert.match(policy,/img-src data:;/);assert.doesNotMatch(policy,/script-src|allow-scripts/);
  assert.equal(blocked.headers.get('x-frame-options'),'SAMEORIGIN');const body=await blocked.text();assert.match(body,/Newsletter/);assert.match(body,/\.x\{color:#123\}/);assert.doesNotMatch(body,/cdn\.example\.invalid|<script/);
  const released=await f.call(`/api/mailbox/message/${message.id}/view?images=1`);assert.match(released.headers.get('content-security-policy'),/img-src data: https: http:/);assert.match(await released.text(),/cdn\.example\.invalid\/logo\.png/);
  const json=await f.call('/api/mailbox');assert.equal(json.headers.get('x-frame-options'),'DENY','normal API responses stay unframeable');
  assert.equal((await f.call(`/api/mailbox/message/${message.id}/view?test=true`)).status,404,'live mail is not visible in the test area');
});

test('server-side folders, counts, umlaut search, CRM filter, paging and bulk actions',async t=>{
  const f=await fixture(t),ids=[];
  for(let index=0;index<55;index++)ids.push((await ingest(f,{subject:'Rechnung '+index,date:new Date(Date.UTC(2026,9,1,8,index)).toUTCString()})).id);
  const umlaut=await ingest(f,{subject:'Äußere Pflege',body:'Übergabe am Montag',from:'Bekannt <bekannt@example.invalid>'});
  await f.env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(randomUUID(),JSON.stringify({name:'Bekannt',email:'bekannt@example.invalid',emailKey:'bekannt@example.invalid'}),'bekannt',new Date().toISOString(),new Date().toISOString()).run();
  let view=await (await f.call('/api/mailbox?folder=INBOX&limit=50')).json();assert.equal(view.total,56);assert.equal(view.messages.length,50);assert.equal(view.counts.INBOX.unread,56);assert.equal(view.messages[0].id,umlaut.id,'newest first');
  const next=await (await f.call('/api/mailbox?folder=INBOX&limit=50&offset=50')).json();assert.equal(next.messages.length,6);assert.equal(new Set([...view.messages,...next.messages].map(item=>item.id)).size,56);
  assert.equal(view.messages[0].crm.customer,'Bekannt');assert.equal(view.messages[1].crm,null);
  assert.deepEqual((await (await f.call('/api/mailbox?folder=INBOX&q='+encodeURIComponent('äußere'))).json()).messages.map(item=>item.id),[umlaut.id]);
  assert.deepEqual((await (await f.call('/api/mailbox?folder=INBOX&q='+encodeURIComponent('übergabe montag'))).json()).messages.map(item=>item.id),[umlaut.id]);
  assert.deepEqual((await (await f.call('/api/mailbox?folder=INBOX&filter=crm')).json()).messages.map(item=>item.id),[umlaut.id]);
  assert.equal((await (await f.call('/api/mailbox?folder=INBOX&sort=oldest&limit=1')).json()).messages[0].id,ids[0]);
  assert.equal((await f.call('/api/mailbox?folder=INBOX&filter=evil')).status,400);
  assert.equal((await f.call('/api/mailbox/state',{messageIds:ids.slice(0,5),read:true})).status,200);
  assert.equal((await f.call('/api/mailbox/state',{messageIds:ids.slice(0,3),folder:'Archive'})).status,200);
  assert.equal((await f.call('/api/mailbox/state',{messageIds:[ids[5]],folder:'Trash',flagged:true})).status,200);
  view=await (await f.call('/api/mailbox?folder=Archive')).json();assert.equal(view.total,3);assert.equal(view.counts.INBOX.total,52);assert.equal(view.counts.INBOX.unread,50);assert.equal(view.counts.Trash.total,1);assert.equal(view.counts.Flagged.total,0,'flagged mail in trash is not listed as important');assert.equal(view.counts.Unread.total,50);
  assert.equal((await f.call('/api/mailbox/state',{messageIds:[ids[5]],folder:null})).status,200);assert.equal((await (await f.call('/api/mailbox?folder=Trash')).json()).total,0,'restore returns mail to its origin');
  const folder=(await (await f.call('/api/mailbox/folder',{name:'Wartet auf Kunde'})).json()).folder;assert.equal((await f.call('/api/mailbox/folder',{name:'Wartet auf Kunde'})).status,409);
  await f.call('/api/mailbox/state',{messageIds:ids.slice(10,12),folder:'Wartet auf Kunde'});assert.equal((await (await f.call('/api/mailbox?folder='+encodeURIComponent('Wartet auf Kunde'))).json()).total,2);
  assert.equal((await f.call('/api/mailbox/folder/delete',{id:folder.id})).status,200);view=await (await f.call('/api/mailbox?folder=INBOX')).json();assert.equal(view.total,53);assert.equal(view.folders.length,0);
  assert.equal((await f.call('/api/mailbox/state',{messageIds:Array.from({length:201},()=>randomUUID()),read:true})).status,404);
});

test('uploads are validated, drafts keep Cc/Bcc/HTML/attachments and sending carries all of it once',async t=>{
  const sent=[];const f=await fixture(t,{async verifySmtp(){},async sendMail(config,message){sent.push(message);return {accepted:[message.to],rejected:[],messageId:'<accepted@example.invalid>',response:'250 accepted'};}});await smtp(f);
  assert.equal((await f.upload('Rechnung.exe',PDF,'application/x-msdownload')).status,415);
  assert.equal((await f.upload('Falsch.pdf',Buffer.from('kein pdf aber lang genug fuer die pruefung'),'application/pdf')).status,415);
  assert.equal((await f.upload('Fremd.pdf',PDF,'application/pdf',{origin:'https://evil.example.invalid'})).status,403);
  const pdf=(await (await f.upload('Angebot',PDF,'application/pdf')).json()).attachment,png=(await (await f.upload('Foto.png',PNG,'image/png')).json()).attachment;
  assert.equal(pdf.filename,'Angebot.pdf');assert.equal(png.mime,'image/png');
  const original=await ingest(f,{from:'Erika <erika@example.invalid>',cc:'partner@example.invalid',subject:'Termin',messageId:'<thread-root@example.invalid>'});
  const draft=await (await f.call('/api/mailbox/draft',{to:'erika@example.invalid',cc:'partner@example.invalid',bcc:'archiv@example.invalid',subject:'Re: Termin',text:'Gerne',html:'<p><b>Gerne</b> am Freitag <script>x</script></p>',attachments:[pdf.id,png.id],replyTo:original.id,mode:'replyAll'})).json();
  const stored=(await (await f.call('/api/mailbox')).json()).drafts[0];assert.equal(stored.cc,'partner@example.invalid');assert.equal(stored.bcc,'archiv@example.invalid');assert.equal(stored.html,'<p><b>Gerne</b> am Freitag </p>');assert.deepEqual(stored.attachments.map(item=>item.filename),['Angebot.pdf','Foto.png']);assert.equal(stored.mode,'replyAll');
  assert.equal((await f.call('/api/mailbox/upload/delete',{id:pdf.id})).status,200);assert.ok(await f.env.DB.prepare('SELECT id FROM mail_uploads WHERE id=?').bind(pdf.id).first(),'upload referenced by a draft stays');
  assert.equal((await f.call('/api/mailbox/send',{requestId:randomUUID(),to:'a@example.invalid',cc:'kein-adresse',subject:'x',text:'y',confirmed:true})).status,400);
  assert.equal((await f.call('/api/mailbox/send',{requestId:randomUUID(),to:Array.from({length:21},(_,i)=>`k${i}@example.invalid`).join(','),subject:'x',text:'y',confirmed:true})).status,400);
  const requestId=randomUUID(),input={requestId,draftId:draft.id,to:'Erika <erika@example.invalid>',cc:'partner@example.invalid',bcc:'archiv@example.invalid',subject:'Re: Termin',text:'Gerne am Freitag',html:'<p><b>Gerne</b> am Freitag</p>',attachments:[pdf.id,png.id],replyTo:original.id,confirmed:true};
  const response=await f.call('/api/mailbox/send',input);assert.equal(response.status,200,await response.clone().text());await f.call('/api/mailbox/send',input);assert.equal(sent.length,1,'same request ID sends once');
  const message=sent[0];assert.equal(message.to,'erika@example.invalid');assert.equal(message.cc,'partner@example.invalid');assert.equal(message.bcc,'archiv@example.invalid');assert.match(message.html,/<b>Gerne<\/b>/);assert.equal(message.text,'Gerne am Freitag');
  assert.equal(message.inReplyTo,'<thread-root@example.invalid>');assert.match(message.references,/<thread-root@example\.invalid>/);
  assert.deepEqual(message.attachments.map(item=>[item.filename,item.contentType,item.content.length]),[['Angebot.pdf','application/pdf',PDF.length],['Foto.png','image/png',PNG.length]]);
  const view=await (await f.call('/api/mailbox?folder=Sent')).json();assert.equal(view.total,1);assert.equal(view.drafts.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM mail_uploads').first()).n,0);
  const sentDetail=await (await f.call('/api/mailbox/message/'+view.messages[0].id)).json();assert.deepEqual(sentDetail.message.cc.map(item=>item.address),['partner@example.invalid']);assert.deepEqual(sentDetail.message.bcc.map(item=>item.address),['archiv@example.invalid']);assert.equal(sentDetail.attachments.length,2);assert.equal(sentDetail.attachments[0].documentId,null,'outbound attachments never become receipts');
  assert.equal(sentDetail.thread.length,2,'reply joins the conversation');
  assert.ok(!sentDetail.attachments.some(item=>[pdf.id,png.id].includes(item.id)),'sent attachments are separate archive copies');
  await f.env.BUCKET.delete(pdf.id);await f.env.BUCKET.delete(png.id);
  const file=await f.call('/api/mailbox/attachment/'+sentDetail.attachments[0].id+'?download=1');assert.equal(file.status,200);assert.match(file.headers.get('content-disposition'),/^attachment; .*filename\*=UTF-8''Angebot\.pdf/);
});

test('forwarding reuses archived attachments by copy and keeps the original receipt untouched',async t=>{
  const sent=[];const f=await fixture(t,{async verifySmtp(){},async sendMail(config,message){sent.push(message);return {accepted:[message.to],rejected:[],messageId:'<fwd@example.invalid>',response:'250 accepted'};}});await smtp(f);
  const original=await ingest(f,{subject:'Beleg',attachment:PDF});const detail=await (await f.call('/api/mailbox/message/'+original.id)).json();const attachment=detail.attachments[0];assert.ok(attachment.documentId);
  const response=await f.call('/api/mailbox/send',{requestId:randomUUID(),to:'steuer@example.invalid',subject:'Fwd: Beleg',text:'Zur Ablage',attachments:[attachment.id],confirmed:true});assert.equal(response.status,200,await response.clone().text());
  assert.equal(sent[0].attachments[0].content.equals(PDF),true);assert.equal(sent[0].inReplyTo,undefined);
  const sentView=await (await f.call('/api/mailbox?folder=Sent')).json(),sentDetail=await (await f.call('/api/mailbox/message/'+sentView.messages[0].id)).json();assert.notEqual(sentDetail.attachments[0].id,attachment.id);assert.equal(sentDetail.attachments[0].documentId,null);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_documents').first()).n,1,'forwarding creates no second receipt');
  assert.equal((await f.call('/api/mailbox/attachment/'+attachment.id)).status,200,'original stays available');
});

test('synthetic area isolates uploads and refuses real sending',async t=>{
  const f=await fixture(t);const live=(await (await f.upload('Live.pdf',PDF,'application/pdf')).json()).attachment;
  assert.equal((await f.call('/api/mailbox/draft?test=true',{to:'a@example.invalid',subject:'x',text:'y',attachments:[live.id]})).status,404,'live upload is not usable in the test area');
  assert.equal((await f.call('/api/mailbox/send?test=true',{requestId:randomUUID(),to:'a@example.invalid',subject:'x',text:'y',confirmed:true})).status,409);
  const folder=(await (await f.call('/api/mailbox/folder',{name:'Gemeinsam'})).json()).folder;
  assert.equal((await f.call('/api/mailbox/folder/delete?test=true',{id:folder.id})).status,409,'shared folders cannot be removed from the test area');
  assert.deepEqual((await (await f.call('/api/mailbox')).json()).folders.map(item=>item.name),['Gemeinsam']);
});

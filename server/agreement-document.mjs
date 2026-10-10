import {readFile} from 'node:fs/promises';
import {need,berlin,customerSignaturePNG} from '../src/domain.mjs';
import {settings} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {letterhead} from './document-template.mjs';
import {wrapPDFText} from './pdf-layout.mjs';

const libraryURL=new URL('../dist/pdf/library.mjs',import.meta.url);
export async function agreementDocument(env,order,amendmentId=null){
  const proof=amendmentId?order.amendments?.find(item=>item.id===amendmentId&&item.state==='accepted')?.acceptance:order.acceptance;
  need(proof,'Unterschriebene Vereinbarung nicht gefunden.',404);
  need(proof.snapshotHash&&proof.snapshot&&(proof.snapshot.offer||proof.snapshot.amendment),'Für dieses historische Dokument fehlt der gespeicherte ursprüngliche Vereinbarungsstand. Das Original bleibt erhalten.',409);
  const signature=customerSignaturePNG(proof.signature),snapshot=proof.snapshot,details=snapshot.amendment??snapshot.offer,policy=snapshot.offer?.cancellationPolicy??order.cancellationTerms?.policy;
  const customer=snapshot.customer??order.source.name,vehicle=snapshot.vehicle??order.source.vehicle,acceptedAt=order.cancellationTerms?.acceptance?.at??proof.at;
  const proofId=amendmentId??'agreement',proofHash=digest(JSON.stringify({proof,customer,vehicle,policy,acceptedAt}));
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS agreement_documents(order_id TEXT NOT NULL REFERENCES orders(id),proof_id TEXT NOT NULL,proof_hash TEXT NOT NULL,asset_id TEXT NOT NULL,hash TEXT NOT NULL,template_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(order_id,proof_id))').run();
  const previous=await env.DB.prepare('SELECT * FROM agreement_documents WHERE order_id=? AND proof_id=?').bind(order.id,proofId).first();
  const title=amendmentId?'Unterschriebener Nachtrag':'Unterschriebene Vereinbarung',filename=order.wg.replace(/[^A-Za-z0-9_-]/g,'_')+'-'+(amendmentId?'Nachtrag-'+amendmentId.slice(0,8):'Vereinbarung')+'.pdf';
  if(previous){need(previous.proof_hash===proofHash,'Der gespeicherte Vereinbarungsnachweis stimmt nicht mehr mit dem ursprünglichen Unterschriftsstand überein.',409);const file=await env.BUCKET.get(previous.asset_id);need(file&&digest(file.body)===previous.hash,'Gespeicherter Vereinbarungsnachweis fehlt oder wurde verändert.',409);return {bytes:file.body,filename};}
  const template=(await settings(env)).documentTemplate;need(template,'Die unterschriebene Vereinbarung bleibt gespeichert. PDF wartet auf freigegebenes echtes Briefpapier.',409);
  const {PDFDocument,rgb,fontkit}=await import(libraryURL.href),doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(await readFile(new URL('../dist/pdf/NotoSans.ttf',import.meta.url)),{subset:true}),background=await letterhead(env,doc,template),box=template.contentBox,width=595.28-box.left-box.right,ink=rgb(.08,.12,.19),grey=rgb(.35,.4,.46);
  /** @type {any} */ let page;let y=0;
  const newPage=()=>{page=doc.addPage([595.28,841.89]);background.draw(page);y=841.89-box.top-20;};
  const ensure=height=>{if(y-height<box.bottom+20)newPage();};
  const paragraph=(value,size=10,color=ink)=>{for(const line of wrapPDFText(value,font,size,width)){ensure(size+6);page.drawText(line,{x:box.left,y,font,size,color});y-=size+6;}};
  const heading=value=>{ensure(40);y-=12;paragraph(value,13);y-=5;};
  newPage();paragraph(title,18);y-=12;paragraph('Auftrag '+order.wg);paragraph('Kunde: '+customer);paragraph('Fahrzeug: '+(vehicle??''));paragraph('Persönlich unterschrieben am '+berlin(proof.at));
  heading('Vereinbarte Leistungen');paragraph(details.services);if(details.reason)paragraph(details.reason);
  const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value/100);
  paragraph('Vereinbarter Gesamtpreis: '+money(details.totalCents),12);if(details.amountCents!==undefined)paragraph('Zusatzpreis dieses Nachtrags: '+money(details.amountCents));
  if(snapshot.appointment){heading('Angenommener Termin');paragraph(berlin(snapshot.appointment.start)+' bis '+berlin(snapshot.appointment.end));paragraph(snapshot.appointment.delivery+' · '+snapshot.appointment.location);}
  if(policy?.terms){heading('Angenommene Stornobedingungen');paragraph('Version '+policy.version+' · angenommen am '+berlin(acceptedAt),9,grey);paragraph(policy.terms);}
  heading('Gespeicherte persönliche Unterschrift');paragraph(customer);ensure(115);const image=await doc.embedPng(signature.bytes),scale=Math.min(width/image.width,85/image.height);page.drawImage(image,{x:box.left,y:y-85,width:image.width*scale,height:image.height*scale});y-=100;
  heading('Vereinbarungsnachweis');paragraph('Ursprüngliche Unterschrifts-Prüfsumme: '+proof.snapshotHash,8,grey);paragraph('Dieses Dokument gibt den gespeicherten angenommenen Stand wieder. Eine Zahlung wird damit nicht bestätigt.',9,grey);
  const pages=doc.getPages();pages.forEach((item,index)=>{item.drawText(order.wg+' · '+(index+1)+' / '+pages.length,{x:box.left,y:box.bottom+2,font,size:8,color:grey});if(order.synthetic)item.drawText('TEST · Kein echtes Kundendokument',{x:box.left,y:box.bottom+12,font,size:8,color:rgb(.65,.08,.08)});});
  doc.setTitle(title+' '+order.wg);doc.setAuthor(template.company.name);doc.setCreationDate(new Date(proof.at));
  const bytes=await doc.save();need(bytes.length<=25*1024*1024,'Vereinbarungsnachweis ist zu groß.',413);const id=crypto.randomUUID(),hash=digest(bytes);await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.prepare('INSERT INTO agreement_documents VALUES(?,?,?,?,?,?,?)').bind(order.id,proofId,proofHash,id,hash,template.id,new Date().toISOString()).run();}
  catch(error){await env.BUCKET.delete(id);const winner=await env.DB.prepare('SELECT proof_id FROM agreement_documents WHERE order_id=? AND proof_id=?').bind(order.id,proofId).first();if(winner)return agreementDocument(env,order,amendmentId);throw error;}
  return {bytes,filename};
}

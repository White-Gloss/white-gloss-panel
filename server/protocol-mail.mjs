import {randomUUID} from 'node:crypto';
import {configuration,getOrder} from '../src/worker.mjs';
import {need,berlin} from '../src/domain.mjs';
import {digest} from './auth.mjs';
import {protocolDocument,protocolFilename} from './protocol-document.mjs';
import {acceptanceDocument,acceptanceFilename} from './acceptance-document.mjs';
import {COMPANY} from '../src/company.mjs';
import {recordOperationIssue,assertCurrentRecordOperation} from '../src/record-compat.mjs';
// Delivered documents: intake and return protocols and the order confirmation ("acceptance").
const DOCUMENT_KINDS=['intake','return','acceptance'];
const labels={intake:'Annahmeprotokoll',return:'Rückgabeprotokoll',acceptance:'Auftragsbestätigung'};
const documentOf=(order,kind)=>kind==='acceptance'?order.acceptance:order[kind];
const deliverable=(kind,p)=>kind==='acceptance'?Boolean(p):Boolean(p?.customerSignature);
const versionOf=(kind,p)=>kind==='acceptance'?(p?.confirmationId??p?.at??''):protocolVersion(p);
const render=(env,order,kind)=>kind==='acceptance'?acceptanceDocument(env,order):protocolDocument(env,order,kind);
const filenameOf=(order,kind)=>kind==='acceptance'?acceptanceFilename(order):protocolFilename(order,kind);
export async function protocolMailSchema(env){await env.DB.batch([
  "CREATE TABLE IF NOT EXISTS protocol_deliveries(job_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,snapshot_hash TEXT NOT NULL,recipient TEXT NOT NULL,copy_to TEXT NOT NULL,asset_id TEXT,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '',UNIQUE(order_id,kind))",
  "CREATE TABLE IF NOT EXISTS acceptance_deliveries(job_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,acceptance_version TEXT NOT NULL,snapshot_hash TEXT NOT NULL,snapshot TEXT NOT NULL,recipient TEXT NOT NULL,copy_to TEXT NOT NULL,asset_id TEXT,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '',UNIQUE(order_id,acceptance_version))"
].map(sql=>env.DB.prepare(sql)));}
const deliveryTable=kind=>kind==='acceptance'?'acceptance_deliveries':'protocol_deliveries';
function acceptanceOrder(order){const a=order.acceptance;return {id:order.id,wg:order.wg,synthetic:order.synthetic===true,source:a.snapshot?.source??order.source,offer:a.snapshot?.offer??order.offer,acceptance:a};}
function deliveryOrder(order,record){if(record.kind!=='acceptance')return order;need(digest(record.snapshot)===record.snapshot_hash,'Gespeicherte Auftragsbestätigung wurde verändert.',409);const saved=JSON.parse(record.snapshot);saved.wg??=order.wg;return saved;}
export const protocolVersion=p=>p?.savedAt??p?.snapshotHash??'';
// A signed protocol with a valid customer address is queued exactly once per version.
// Without signature or address nothing is queued; the PDF stays available for download and sharing.
export function protocolQueueStatements(env,order,kind,operationId,version){
  if(order.synthetic||recordOperationIssue(order,'send'))return [];
  const p=documentOf(order,kind),recipient=(order.source.email??'').trim().toLowerCase(),business=(kind==='acceptance'?COMPANY.email:p?.business?.email)?.trim().toLowerCase();
  if(!DOCUMENT_KINDS.includes(kind)||!deliverable(kind,p)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))return [];
  // Every new order confirmation and every replacement protocol is sent once more.
  const copy=business&&digest(business)===env.OWNER_EMAIL_SHA256?business:'',replacement=kind==='acceptance'||Boolean(p.replaces);
  const id=randomUUID(),now=new Date().toISOString(),jobKind='protocol-'+kind+(replacement?'-'+versionOf(kind,p):'');
  const guard="EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
  if(kind==='acceptance'){
    const snapshot=JSON.stringify(acceptanceOrder(order));
    return [env.DB.prepare("INSERT OR IGNORE INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,?,'queued',?,? WHERE "+guard).bind(id,order.id,jobKind,now,now,order.id,version,operationId),env.DB.prepare('INSERT OR IGNORE INTO acceptance_deliveries(job_id,order_id,acceptance_version,snapshot_hash,snapshot,recipient,copy_to) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(id,order.id,versionOf(kind,p),digest(snapshot),snapshot,recipient,copy,id)];
  }
  return [env.DB.prepare("INSERT OR IGNORE INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,?,'queued',?,? WHERE "+guard).bind(id,order.id,jobKind,now,now,order.id,version,operationId),env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?) ON CONFLICT(order_id,kind) DO UPDATE SET job_id=excluded.job_id,snapshot_hash=excluded.snapshot_hash,recipient=excluded.recipient,copy_to=excluded.copy_to,asset_id=NULL,processing_until=0,lease_owner=\'\' WHERE ?=1').bind(id,order.id,kind,versionOf(kind,p),recipient,copy,id,replacement?1:0)];
}
async function persistedPDF(env,order,record){
  const saved=deliveryOrder(order,record),p=documentOf(saved,record.kind);
  if(record.asset_id&&(record.kind==='acceptance'||record.snapshot_hash===versionOf(record.kind,p))){const asset=await env.DB.prepare("SELECT * FROM assets WHERE id=? AND order_id=? AND kind='protocol'").bind(record.asset_id,order.id).first(),file=await env.BUCKET.get(record.asset_id);need(asset&&file&&digest(file.body)===asset.hash,'Gespeichertes Protokoll-PDF ist unvollständig.',409);return {bytes:file.body,filename:filenameOf(saved,record.kind)};}
  const pdf=await render(env,saved,record.kind),assetId=randomUUID();await env.BUCKET.put(assetId,pdf.bytes,{httpMetadata:{contentType:'application/pdf'}});
  const update=record.kind==='acceptance'?env.DB.prepare('UPDATE acceptance_deliveries SET asset_id=? WHERE job_id=?').bind(assetId,record.job_id):env.DB.prepare('UPDATE protocol_deliveries SET asset_id=?,snapshot_hash=? WHERE job_id=?').bind(assetId,versionOf(record.kind,p),record.job_id);
  try{await env.DB.batch([env.DB.prepare("INSERT INTO assets VALUES(?,?,'protocol','application/pdf',?,?,?)").bind(assetId,order.id,pdf.sha256,pdf.bytes.byteLength,new Date().toISOString()),update]);}catch(error){await env.BUCKET.delete(assetId);throw error;}
  return pdf;
}
export async function deliverProtocol(env,orderId,kind,jobId=null){
  const table=deliveryTable(kind),query=kind==='acceptance'?"SELECT d.*,'acceptance' AS kind,j.state,j.updated_at FROM acceptance_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=?"+(jobId?' AND d.job_id=?':' ORDER BY j.rowid DESC LIMIT 1'):'SELECT d.*,j.state,j.updated_at FROM protocol_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=? AND d.kind=?'+(jobId?' AND d.job_id=?':'');
  const record=await env.DB.prepare(query).bind(orderId,...(kind==='acceptance'?[]:[kind]),...(jobId?[jobId]:[])).first();
  if(!record)return {state:'test',message:'Gespeichert. Keine E-Mail versendet (Testauftrag, keine Kunden-E-Mail oder keine Unterschrift). Das PDF kannst du herunterladen oder teilen.'};
  if(!['queued','failed'].includes(record.state))return {state:record.state,message:record.state==='sent'?'Protokoll-PDF an den Kunden mit Kopie an dich versendet.':'Protokoll gespeichert; Versandergebnis wird geprüft. Keine zweite E-Mail erzeugt.'};
  const now=Date.now(),leaseOwner=randomUUID(),lease=await env.DB.prepare('UPDATE '+table+" SET processing_until=?,lease_owner=? WHERE job_id=? AND processing_until<=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state IN ('queued','failed'))").bind(now+120000,leaseOwner,record.job_id,now,record.job_id).run();
  if(!lease.meta.changes)return {state:'queued',message:'Protokoll gespeichert; PDF-Versand läuft bereits.'};
  let attempted=false,providerId=null;
  try{
    const order=deliveryOrder(await getOrder(env,orderId),record),p=documentOf(order,kind);need(!order.synthetic&&deliverable(kind,p),'Versand gehört nicht zu einem gespeicherten Dokument.',409);
    const config=await configuration(env,['resendKey']);need(config.emailVerified&&config.sendApproved&&config.resendKey&&config.sender,'Protokoll gespeichert. E-Mail-Versand zuerst prüfen und freigeben.',409);
    const pdf=await persistedPDF(env,order,record),label=labels[kind],business=kind==='acceptance'?COMPANY:p.business;
    const replaced=p.replaces?(kind==='acceptance'?'\n\nDiese Annahme ersetzt ausdrücklich das zuvor'+(p.replaces.signedAt?' am '+berlin(p.replaces.signedAt):'')+' unterschriebene Angebot.':'\n\nDieses '+label+' ersetzt ausdrücklich das zuvor'+(p.replaces.signedAt?' am '+berlin(p.replaces.signedAt):'')+' unterschriebene '+label+'.'):'';
    const intro=kind==='acceptance'?'vielen Dank für Ihren Auftrag. Anbei erhalten Sie Ihre Auftragsbestätigung mit den vereinbarten Leistungen und dem Festpreis'+(p.withdrawalText?' sowie der Widerrufsbelehrung und dem Muster-Widerrufsformular':'')+'.':'anbei erhalten Sie das persönlich unterschriebene '+label+' für Ihr Fahrzeug '+(p.vehicle||order.source.vehicle||'')+(p.plate?' ('+p.plate+')':'')+'.';
    const payload={from:config.sender,to:[record.recipient],...(record.copy_to&&record.copy_to!==record.recipient?{cc:[record.copy_to]}:{}),reply_to:record.copy_to||config.sender,subject:'White Gloss · '+label+(p.replaces?' (Ersatz)':'')+' · '+order.wg,text:'Guten Tag '+(p.customerName||order.source.name||'')+',\n\n'+intro+replaced+'\n\nBei Rückfragen antworten Sie bitte auf diese E-Mail.\n\n'+business.name+'\n'+business.owner+'\n'+business.street+'\n'+business.city+'\n'+business.phone+'\n'+business.email,attachments:[{filename:pdf.filename,content:Buffer.from(pdf.bytes).toString('base64')}]};
    const reserved=await env.DB.prepare("UPDATE jobs SET state='pending',detail='Versand wird angefordert',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM "+table+' WHERE job_id=? AND lease_owner=?)').bind(new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();
    if(!reserved.meta.changes)return {state:'queued',message:'Protokoll gespeichert; Versand wurde bereits übernommen.'};
    assertCurrentRecordOperation(env,order,'send');attempted=true;
    const result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-protocol-'+record.job_id},body:JSON.stringify(payload)});
    const data=await result.json();need(result.ok&&typeof data.id==='string','Versandergebnis ist nicht eindeutig bestätigt.',502);providerId=data.id;
    await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail='PDF an Kunden und Betreiber bestätigt',updated_at=? WHERE id=?").bind(providerId,new Date().toISOString(),record.job_id).run();
    return {state:'sent',message:labels[kind]+' als PDF an den Kunden mit Kopie an dich versendet.'};
  }catch(error){const state=attempted?'unknown':'failed',detail=attempted?'Versandergebnis ungeklärt. Keine automatische Wiederholung.':'PDF-Versand steht aus: '+error.message;await env.DB.prepare('UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM '+table+' WHERE job_id=? AND lease_owner=?)').bind(state,providerId,detail,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();return {state,message:'Protokoll und Unterschriften sind gespeichert. '+detail};}
  finally{await env.DB.prepare('UPDATE '+table+" SET processing_until=0,lease_owner='' WHERE job_id=? AND lease_owner=?").bind(record.job_id,leaseOwner).run();}
}
export async function pendingProtocolMails(env){
  const now=Date.now(),rows=await env.DB.prepare("SELECT d.order_id,d.kind,d.job_id,j.created_at FROM protocol_deliveries d JOIN jobs j ON j.id=d.job_id WHERE j.state IN ('queued','failed') AND d.processing_until<=? UNION ALL SELECT d.order_id,'acceptance' AS kind,d.job_id,j.created_at FROM acceptance_deliveries d JOIN jobs j ON j.id=d.job_id WHERE j.state IN ('queued','failed') AND d.processing_until<=? ORDER BY created_at LIMIT 2").bind(now,now).all(),errors=[];
  for(const row of rows.results){const result=await deliverProtocol(env,row.order_id,row.kind,row.job_id);if(result.state!=='sent')errors.push(result.message);}
  return errors;
}
export async function protocolDownload(env,orderId,kind){
  need(DOCUMENT_KINDS.includes(kind),'Unbekanntes Dokument.');const order=await getOrder(env,orderId),record=kind==='acceptance'?await env.DB.prepare("SELECT *,'acceptance' AS kind FROM acceptance_deliveries WHERE order_id=? AND acceptance_version=?").bind(orderId,versionOf(kind,order.acceptance)).first():await env.DB.prepare('SELECT * FROM protocol_deliveries WHERE order_id=? AND kind=?').bind(orderId,kind).first();
  // A download must not compete with the delivery's immutable PDF storage.
  const pdf=record?.asset_id&&(kind==='acceptance'||record.snapshot_hash===versionOf(kind,documentOf(order,kind)))?await persistedPDF(env,order,record):await render(env,record?deliveryOrder(order,record):order,kind);
  return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"','Cache-Control':'no-store'}});
}

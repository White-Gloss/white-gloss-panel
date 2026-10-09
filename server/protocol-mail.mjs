import {randomUUID} from 'node:crypto';
import {configuration,getOrder} from '../src/worker.mjs';
import {need} from '../src/domain.mjs';
import {digest} from './auth.mjs';
import {protocolDocument,protocolFilename} from './protocol-document.mjs';
export async function protocolMailSchema(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS protocol_deliveries(job_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,snapshot_hash TEXT NOT NULL,recipient TEXT NOT NULL,copy_to TEXT NOT NULL,asset_id TEXT,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '',UNIQUE(order_id,kind))").run();}
export function protocolQueueStatements(env,order,kind,operationId,version){
  if(order.synthetic)return [];
  const p=order[kind],recipient=(order.source.email??'').trim().toLowerCase(),copy=p?.business?.email?.trim().toLowerCase();
  need(p?.snapshotHash&&p.signaturesConfirmed,'Vollständiges unterschriebenes Protokoll erforderlich.',409);
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),'Kunden-E-Mail für die Protokollkopie fehlt.',409);
  need(copy&&digest(copy)===env.OWNER_EMAIL_SHA256,'Betriebliche Kopie muss an deine bestätigte Betreiberadresse gehen.',409);
  const id=randomUUID(),now=new Date().toISOString(),jobKind='protocol-'+kind;
  const guard="EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
  return [env.DB.prepare("INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,?,'queued',?,? WHERE "+guard).bind(id,order.id,jobKind,now,now,order.id,version,operationId),env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(id,order.id,kind,p.snapshotHash,recipient,copy,id)];
}
async function persistedPDF(env,order,record){
  if(record.asset_id){const asset=await env.DB.prepare("SELECT * FROM assets WHERE id=? AND order_id=? AND kind='protocol'").bind(record.asset_id,order.id).first(),file=await env.BUCKET.get(record.asset_id);need(asset&&file&&digest(file.body)===asset.hash,'Gespeichertes Protokoll-PDF ist unvollständig.',409);return {bytes:file.body,filename:protocolFilename(order,record.kind)};}
  const pdf=await protocolDocument(env,order,record.kind),assetId=randomUUID();await env.BUCKET.put(assetId,pdf.bytes,{httpMetadata:{contentType:'application/pdf'}});
  try{await env.DB.batch([env.DB.prepare("INSERT INTO assets VALUES(?,?,'protocol','application/pdf',?,?,?)").bind(assetId,order.id,pdf.sha256,pdf.bytes.byteLength,new Date().toISOString()),env.DB.prepare('UPDATE protocol_deliveries SET asset_id=? WHERE job_id=? AND asset_id IS NULL').bind(assetId,record.job_id)]);}catch(error){await env.BUCKET.delete(assetId);throw error;}
  return pdf;
}
export async function deliverProtocol(env,orderId,kind){
  const record=await env.DB.prepare('SELECT d.*,j.state,j.updated_at FROM protocol_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=? AND d.kind=?').bind(orderId,kind).first();
  if(!record)return {state:'test',message:'Testprotokoll gespeichert; keine E-Mail versendet.'};
  if(!['queued','failed'].includes(record.state))return {state:record.state,message:record.state==='sent'?'Protokoll-PDF an den Kunden mit Kopie an dich versendet.':'Protokoll gespeichert; Versandergebnis wird geprüft. Keine zweite E-Mail erzeugt.'};
  const now=Date.now(),leaseOwner=randomUUID(),lease=await env.DB.prepare("UPDATE protocol_deliveries SET processing_until=?,lease_owner=? WHERE job_id=? AND processing_until<=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state IN ('queued','failed'))").bind(now+120000,leaseOwner,record.job_id,now,record.job_id).run();
  if(!lease.meta.changes)return {state:'queued',message:'Protokoll gespeichert; PDF-Versand läuft bereits.'};
  let attempted=false,providerId=null;
  try{
    const order=await getOrder(env,orderId),p=order[kind];need(!recordOperationIssue(order,'send'),recordOperationIssue(order,'send'),409);need(!order.synthetic&&p?.snapshotHash===record.snapshot_hash&&p.signaturesConfirmed,'Versand gehört nicht zum bestätigten Protokoll.',409);
    const config=await configuration(env,['resendKey']);need(config.emailVerified&&config.sendApproved&&config.resendKey&&config.sender,'Protokoll gespeichert. E-Mail-Versand zuerst prüfen und freigeben.',409);
    const pdf=await persistedPDF(env,order,record),label=kind==='intake'?'Annahmeprotokoll':'Rückgabeprotokoll';
    const confirmation=p.workflow==='remote'?'vom Betrieb vorab unterschriebene und von Ihnen anschließend im Kundenzugang bestätigte':'gemeinsam geprüfte und persönlich unterschriebene';
    const payload={from:config.sender,to:[record.recipient],...(record.copy_to!==record.recipient?{cc:[record.copy_to]}:{}),reply_to:record.copy_to,subject:'White Gloss · '+label+' · '+order.wg,text:'Guten Tag '+p.customerName+',\n\nanbei erhalten Sie das '+confirmation+' '+label+' für Ihr Fahrzeug '+p.vehicle+' ('+p.plate+').\n\nBei Rückfragen antworten Sie bitte auf diese E-Mail.\n\n'+p.business.name+'\n'+p.business.owner+'\n'+p.business.street+'\n'+p.business.city+'\n'+p.business.phone+'\n'+p.business.email,attachments:[{filename:pdf.filename,content:Buffer.from(pdf.bytes).toString('base64')}]};
    const reserved=await env.DB.prepare("UPDATE jobs SET state='pending',detail='Versand wird angefordert',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM protocol_deliveries WHERE job_id=? AND lease_owner=?)").bind(new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();
    if(!reserved.meta.changes)return {state:'queued',message:'Protokoll gespeichert; Versand wurde bereits übernommen.'};attempted=true;
    const result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-protocol-'+record.job_id},body:JSON.stringify(payload)});
    const data=await result.json();need(result.ok&&typeof data.id==='string','Versandergebnis ist nicht eindeutig bestätigt.',502);providerId=data.id;
    await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail='PDF an Kunden und Betreiber bestätigt',updated_at=? WHERE id=?").bind(providerId,new Date().toISOString(),record.job_id).run();
    return {state:'sent',message:'Protokoll-PDF an den Kunden mit Kopie an dich versendet.'};
  }catch(error){const state=attempted?'unknown':'failed',detail=attempted?'Versandergebnis ungeklärt. Keine automatische Wiederholung.':'PDF-Versand steht aus: '+error.message;await env.DB.prepare('UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM protocol_deliveries WHERE job_id=? AND lease_owner=?)').bind(state,providerId,detail,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();return {state,message:'Protokoll und Unterschriften sind gespeichert. '+detail};}
  finally{await env.DB.prepare("UPDATE protocol_deliveries SET processing_until=0,lease_owner='' WHERE job_id=? AND lease_owner=?").bind(record.job_id,leaseOwner).run();}
}
export async function pendingProtocolMails(env){
  const rows=await env.DB.prepare("SELECT d.order_id,d.kind FROM protocol_deliveries d JOIN jobs j ON j.id=d.job_id WHERE j.state IN ('queued','failed') AND d.processing_until<=? ORDER BY j.created_at LIMIT 2").bind(Date.now()).all(),errors=[];
  for(const row of rows.results){const result=await deliverProtocol(env,row.order_id,row.kind);if(result.state!=='sent')errors.push(result.message);}
  return errors;
}
export async function protocolDownload(env,orderId,kind){
  need(['intake','return'].includes(kind),'Unbekanntes Protokoll.');const order=await getOrder(env,orderId),record=await env.DB.prepare('SELECT * FROM protocol_deliveries WHERE order_id=? AND kind=?').bind(orderId,kind).first();
  // A download must not compete with the delivery's immutable PDF storage.
  const pdf=record?.asset_id?await persistedPDF(env,order,record):await protocolDocument(env,order,kind);
  return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"','Cache-Control':'no-store'}});
}
import {recordOperationIssue} from '../src/operations.mjs';

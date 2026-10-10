import {randomUUID} from 'node:crypto';
import {configuration,getOrder} from '../src/worker.mjs';
import {need} from '../src/domain.mjs';
import {invoicePaymentDocument,invoicePaymentSchema,invoicePaymentState} from './invoice-payment.mjs';
import {digest} from './auth.mjs';

const kind='invoice-cash-mail';
const messages={
  'not-requested':'Rechnungsmail wurde noch nicht angefordert.',
  test:'Testauftrag: keine Rechnungsmail versendet.',
  queued:'Rechnungsmail wird bereits vorbereitet.',
  pending:'Rechnungsmail wird bereits versendet. Keine zweite E-Mail angefordert.',
  sent:'Gespeicherte Rechnungskopie mit dem Vermerk „Bar bezahlt“ an den Kunden versendet.',
  unknown:'Versandergebnis ungeklärt. Keine Wiederholung; zuerst den vorhandenen Versand beim Anbieter prüfen.'
};
const email=value=>(typeof value==='string'?value:'').trim().toLowerCase();
const failure=error=>Number.isInteger(error?.status)?error.message:'Technischer Fehler vor dem Versand. Erneuter Betreiber-Klick ist sicher.';
const result=record=>({state:record?.state??'not-requested',message:record?.state==='failed'?(record.detail??'Rechnungsversand steht aus.'):messages[record?.state??'not-requested'],...(record?{at:record.updated_at,version:record.copy_version}:{})});

export async function invoiceMailSchema(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS invoice_mail_deliveries(job_id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,invoice_id TEXT UNIQUE NOT NULL,copy_version TEXT NOT NULL,recipient TEXT NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT \'\')').run();
}

async function recordFor(env,orderId){
  return env.DB.prepare('SELECT d.*,j.state,j.detail,j.updated_at FROM invoice_mail_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=? AND j.kind=?').bind(orderId,kind).first();
}

/** Status inspection never sends mail. An interrupted provider attempt remains locked. */
export async function invoiceMailStatus(env,orderId){
  await invoiceMailSchema(env);let record=await recordFor(env,orderId);
  if(record?.state==='pending'&&record.processing_until<=Date.now()){
    await env.DB.prepare("UPDATE jobs SET state='unknown',detail=?,updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM invoice_mail_deliveries WHERE job_id=? AND processing_until<=?)").bind(messages.unknown,new Date().toISOString(),record.job_id,record.job_id,Date.now()).run();
    record=await recordFor(env,orderId);
  }
  return result(record);
}

/** Existing delivery records only: this never invents a request for a legacy order. */
export async function invoiceMailStatuses(env,orderIds){
  if(!orderIds.length)return new Map();
  await invoiceMailSchema(env);
  const ids=[...new Set(orderIds)],placeholders=ids.map(()=>'?').join(','),now=Date.now();
  await env.DB.prepare("UPDATE jobs SET state='unknown',detail=?,updated_at=? WHERE kind=? AND state='pending' AND id IN (SELECT job_id FROM invoice_mail_deliveries WHERE order_id IN ("+placeholders+") AND processing_until<=?)").bind(messages.unknown,new Date(now).toISOString(),kind,...ids,now).run();
  const rows=await env.DB.prepare('SELECT d.*,j.state,j.detail,j.updated_at FROM invoice_mail_deliveries d JOIN jobs j ON j.id=d.job_id AND j.order_id=d.order_id WHERE d.order_id IN ('+placeholders+') AND j.kind=?').bind(...ids,kind).all();
  return new Map(rows.results.map(record=>[record.order_id,result(record)]));
}

async function preparedInvoice(env,order){
  need(!order.synthetic&&order.status==='Bezahlt','Vollständig persönlich bestätigte Barzahlung erforderlich.',409);
  need(order.invoice?.id&&typeof order.invoice.number==='string','Rechnung fehlt. Zuerst die vorhandene Schlussrechnung zuordnen; keine Rechnungsmail versendet.',409);
  need(order.invoice.number===order.wg&&order.invoice.number.length<=200&&!/[\r\n\0]/.test(order.invoice.number),'Rechnungsnummer gehört nicht eindeutig zum Auftrag.',409);
  const recipient=email(order.source?.email);
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient),'Kunden-E-Mail im zugehörigen Auftrag fehlt.',409);
  const payment=await invoicePaymentState(env,order);
  need(payment.fullyCashPaid&&payment.header==='Bar bezahlt','Der kanonische Zahlungsnachweis bestätigt keine vollständige Barzahlung.',409);
  need(order.invoice.totalCents===payment.agreedTotalCents,'Rechnungsbetrag und tatsächlich bestätigte Barzahlung stimmen nicht überein.',409);
  const version=order.invoice.paymentCopyVersion;
  need(/^[a-f0-9]{64}$/.test(version??''),'Gespeicherte Rechnungskopie mit Zahlungsstatus fehlt. Technischen Rechnungsabgleich zuerst abschließen.',409);
  await invoicePaymentSchema(env);
  const copy=await env.DB.prepare('SELECT * FROM invoice_payment_documents WHERE version=? AND order_id=? AND invoice_id=?').bind(version,order.id,order.invoice.id).first();
  need(copy,'Gespeicherte Rechnungskopie gehört nicht zu dieser Rechnung und diesem Auftrag.',409);
  const snapshot=JSON.parse(copy.snapshot);
  need(digest(copy.snapshot)===version&&snapshot.invoiceId===order.invoice.id&&snapshot.number===order.invoice.number&&JSON.stringify(snapshot.payment)===JSON.stringify(payment),'Gespeicherter Rechnungsvermerk weicht vom bestätigten Zahlungseingang ab.',409);
  const pdf=await invoicePaymentDocument(env,order.id,version);
  need(pdf.bytes?.byteLength>5&&pdf.bytes.byteLength<=12*1024*1024&&Buffer.from(pdf.bytes).subarray(0,5).toString()==='%PDF-','Gespeicherte Rechnungskopie ist kein vollständig versendbares PDF.',409);
  const payload={to:[recipient],subject:'White Gloss · Rechnung '+order.invoice.number+' · Bar bezahlt',text:'Guten Tag '+(order.source.name??'')+',\n\nanbei erhalten Sie die gespeicherte Kopie der Rechnung '+order.invoice.number+' für Ihren Auftrag '+order.wg+'. Der persönlich bestätigte vollständige Bargeldeingang ist mit „Bar bezahlt“ dokumentiert.\n\nDie Originalrechnung und ihre Rechnungsnummer bleiben erhalten.\n\nBei Rückfragen antworten Sie bitte auf diese E-Mail.\n\nWhite Gloss'};
  const proof=JSON.stringify({invoiceId:order.invoice.id,version,hash:copy.hash,payload});
  return {recipient,payload,payloadHash:digest(proof),pdf,version};
}

/** Only the personal owner action calls this; there is deliberately no background queue drain. */
export async function sendPaidCashInvoice(env,orderId,actor){
  need(actor==='owner','Die Rechnungsmail darf ausschließlich der persönlich angemeldete Betreiber anfordern.',403);
  await invoiceMailSchema(env);
  const order=await getOrder(env,orderId);if(order.synthetic)return result({state:'test'});
  let record=await recordFor(env,orderId);
  if(record&&!['queued','failed'].includes(record.state))return invoiceMailStatus(env,orderId);
  if(!record){
    let prepared;try{prepared=await preparedInvoice(env,order);}catch(error){return {state:'failed',message:failure(error)};}
    const id=randomUUID(),at=new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,?,'queued',?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND synthetic=0 AND json_extract(data,'$.invoice.id')=? AND json_extract(data,'$.invoice.paymentCopyVersion')=?)").bind(id,order.id,kind,at,at,order.id,order.version,order.invoice.id,prepared.version),
      env.DB.prepare('INSERT OR IGNORE INTO invoice_mail_deliveries(job_id,order_id,invoice_id,copy_version,recipient,payload,payload_hash) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(id,order.id,order.invoice.id,prepared.version,prepared.recipient,JSON.stringify(prepared.payload),prepared.payloadHash,id)
    ]);
    record=await recordFor(env,orderId);
    if(!record)return {state:'failed',message:'Auftrag wurde während der Vorbereitung geändert. Bitte neu öffnen und den Versand erneut anfordern.'};
    if(!['queued','failed'].includes(record.state))return invoiceMailStatus(env,orderId);
  }
  const now=Date.now(),leaseOwner=randomUUID();
  const claimed=await env.DB.prepare("UPDATE invoice_mail_deliveries SET processing_until=?,lease_owner=? WHERE job_id=? AND processing_until<=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state IN ('queued','failed'))").bind(now+120000,leaseOwner,record.job_id,now,record.job_id).run();
  if(!claimed.meta.changes)return invoiceMailStatus(env,orderId);
  let attempted=false,providerId=null;
  try{
    const current=await getOrder(env,orderId);need(!recordOperationIssue(current,'send'),recordOperationIssue(current,'send'),409);const prepared=await preparedInvoice(env,current);
    need(current.invoice.id===record.invoice_id&&prepared.version===record.copy_version&&prepared.recipient===record.recipient&&prepared.payloadHash===record.payload_hash&&JSON.stringify(prepared.payload)===record.payload,'Versandauftrag stimmt nicht mehr mit der gespeicherten Rechnung oder Kundenadresse überein. Bitte prüfen.',409);
    const config=await configuration(env,['resendKey']);
    need(config.emailVerified===true&&config.sendApproved===true&&config.resendKey&&config.sender,'Rechnungsversand steht aus: E-Mail-Absender zuerst prüfen und Versand freigeben.',409);
    const reserved=await env.DB.prepare("UPDATE jobs SET state='pending',detail='Rechnungsmail wird angefordert',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM invoice_mail_deliveries WHERE job_id=? AND lease_owner=? AND processing_until>?) AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND synthetic=0 AND json_extract(data,'$.invoice.id')=? AND json_extract(data,'$.invoice.paymentCopyVersion')=?)").bind(new Date().toISOString(),record.job_id,record.job_id,leaseOwner,Date.now(),orderId,current.version,record.invoice_id,record.copy_version).run();
    need(reserved.meta.changes,'Auftrag wurde vor dem Versand geändert. Bitte erneut öffnen.',409);
    attempted=true;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-invoice-cash-'+record.job_id},body:JSON.stringify({from:config.sender,...prepared.payload,attachments:[{filename:prepared.pdf.filename,content:Buffer.from(prepared.pdf.bytes).toString('base64')}]})});
    const data=await response.json();
    need(response.ok&&typeof data?.id==='string'&&data.id.trim().length>0&&data.id.length<=512,'Versandergebnis ist nicht eindeutig bestätigt.',502);providerId=data.id;
    const saved=await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail='Gespeicherte Rechnungskopie mit Zahlungsstatus an Kunden bestätigt',updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM invoice_mail_deliveries WHERE job_id=? AND lease_owner=?)").bind(providerId,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();
    need(saved.meta.changes,'Versandbestätigung konnte nicht eindeutig gespeichert werden.',502);
    return invoiceMailStatus(env,orderId);
  }catch(error){
    const state=attempted?'unknown':'failed',detail=attempted?messages.unknown:failure(error);
    // If storage itself fails, the previously persisted pending marker still prevents another send.
    await env.DB.prepare("UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=? AND state IN ('queued','failed','pending') AND EXISTS(SELECT 1 FROM invoice_mail_deliveries WHERE job_id=? AND lease_owner=?)").bind(state,providerId,detail,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run().catch(()=>{});
    return {state,message:detail,version:record.copy_version};
  }finally{
    await env.DB.prepare("UPDATE invoice_mail_deliveries SET processing_until=0,lease_owner='' WHERE job_id=? AND lease_owner=?").bind(record.job_id,leaseOwner).run().catch(()=>{});
  }
}
import {recordOperationIssue} from '../src/operations.mjs';

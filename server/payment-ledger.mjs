import {need,transition} from '../src/domain.mjs';
import {agreedOffer} from '../src/operations.mjs';
import {getOrder,saveOrder,settings} from '../src/worker.mjs';
import {digest} from './auth.mjs';

export async function paymentSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS payment_records(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,reference TEXT NOT NULL,payload_hash TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,reference))`).run();
}
export function paymentInput(input,now=new Date().toISOString()){
  need(input&&typeof input==='object','Zahlungsangaben fehlen.');
  need(input.receivedConfirmed===true,'Bitte persönlich bestätigen: Ich habe die Zahlung erhalten.',409);
  need(/^[a-f0-9-]{36}$/.test(input.idempotencyKey??''),'Eindeutiger Zahlungsschlüssel fehlt.');
  need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0,'Zahlungsbetrag ungültig.');
  need(['Überweisung','Karte','Bar'].includes(input.method),'Zahlungsart fehlt.');
  need(typeof input.reference==='string'&&input.reference.trim().length>0&&input.reference.trim().length<=180,'Bitte die eindeutige Bank-, Terminal- oder Kassenbelegreferenz angeben.');
  need(typeof input.at==='string'&&Number.isFinite(Date.parse(input.at))&&Date.parse(input.at)<=Date.parse(now),'Zahlungszeitpunkt ungültig.');
  if(input.method==='Bar')need(input.cashConfirmed===true,'Tatsächlichen Bargeldeingang ausdrücklich bestätigen.');
  else need(/^[a-f0-9-]{36}$/.test(input.receipt??''),'Vorhandener Zahlungsbeleg fehlt.');
  return {id:input.idempotencyKey,amountCents:input.amountCents,method:input.method,reference:input.reference.trim(),at:new Date(input.at).toISOString(),receipt:input.receipt??null,cashConfirmed:input.method==='Bar'&&input.cashConfirmed===true,receivedConfirmed:true};
}
export async function recordPayment(env,order,input,actor='owner',expectedVersion=order.version){
  need(actor==='owner','Den Zahlungseingang darf ausschließlich der persönlich angemeldete Betreiber bestätigen.',403);
  need(['Erledigt','Bezahlt'].includes(order.status)&&agreedOffer(order)&&order.acceptance,'Zahlungserfassung erst nach Abschluss und bestätigter Preisvereinbarung.',409);
  await paymentSchema(env);const payment=paymentInput(input),fingerprint=digest(JSON.stringify(payment));
  const existing=await env.DB.prepare('SELECT * FROM payment_records WHERE id=? OR (order_id=? AND reference=?)').bind(payment.id,order.id,payment.reference).first();
  if(existing){need(existing.order_id===order.id&&existing.payload_hash===fingerprint,'Diese Zahlungsschlüssel oder Belegreferenz wurden bereits mit anderen Angaben verwendet.',409);return getOrder(env,order.id);}
  need(order.version===expectedVersion,'Diese Ansicht ist veraltet. Bitte Auftrag neu öffnen.',409);
  const config=await settings(env);
  if(payment.method==='Bar'&&!order.synthetic)need(config.cashRecordingApproved===true&&typeof config.cashSystemEvidence==='string'&&config.cashSystemEvidence.trim(),'Barzahlung ist bis zur Prüfung von Kassensystem, TSE und Belegweg gesperrt.',409);
  if(payment.method!=='Bar'){
    const asset=await env.DB.prepare('SELECT id,hash FROM assets WHERE id=? AND order_id=?').bind(payment.receipt,order.id).first();
    need(asset,'Zahlungsbeleg fehlt oder gehört zu einem anderen Auftrag.',409);
    const original=await env.BUCKET.get(payment.receipt);
    need(original?.body&&digest(original.body)===asset.hash,'Der originale Zahlungsbeleg fehlt oder wurde verändert. Zahlung wurde nicht gespeichert.',409);
  }
  // The existing domain transition controls completion, fixed price and overpayment.
  const updated=transition(order,'payment',payment),operationId=crypto.randomUUID();updated.operationId=operationId;
  const agreedTotalCents=agreedOffer(order).totalCents,paidTotalCents=updated.payments.reduce((sum,item)=>sum+item.amountCents,0);
  const recordedAt=new Date().toISOString(),snapshot={...payment,orderId:order.id,wg:order.wg,customer:order.source.name,services:agreedOffer(order).services,agreedTotalCents,paidTotalCents,remainingCents:agreedTotalCents-paidTotalCents,recordedAt,receivedConfirmedBy:actor,receivedConfirmedAt:recordedAt,documentType:payment.method==='Bar'?'Quittung':'Zahlungsnachweis',invoiceNumber:order.invoice?.number??null};
  const statements=[env.DB.prepare(`INSERT INTO payment_records(id,order_id,reference,payload_hash,data,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)`).bind(payment.id,order.id,payment.reference,fingerprint,JSON.stringify(snapshot),snapshot.recordedAt,order.id,order.version+1,operationId)];
  try{return await saveOrder(env,updated,order.version,'Tatsächlichen Zahlungseingang dokumentiert',actor,statements);}
  catch(error){const retry=await env.DB.prepare('SELECT * FROM payment_records WHERE id=? OR (order_id=? AND reference=?)').bind(payment.id,order.id,payment.reference).first();if(retry&&retry.order_id===order.id&&retry.payload_hash===fingerprint)return getOrder(env,order.id);throw error;}
}
export async function paymentRecord(env,orderId,paymentId){await paymentSchema(env);const row=await env.DB.prepare('SELECT data FROM payment_records WHERE id=? AND order_id=?').bind(paymentId,orderId).first();need(row,'Zahlungsnachweis nicht gefunden.',404);return JSON.parse(row.data);}

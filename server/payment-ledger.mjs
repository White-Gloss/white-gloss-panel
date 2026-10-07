import {need,transition} from '../src/domain.mjs';
import {agreedOffer} from '../src/operations.mjs';
import {getOrder,saveOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';

export async function paymentSchema(env){
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS payment_records(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,reference TEXT NOT NULL,payload_hash TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(order_id,reference))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS cash_receipt_links(payment_id TEXT PRIMARY KEY REFERENCES payment_records(id),order_id TEXT NOT NULL REFERENCES orders(id),source_key TEXT NOT NULL,reference TEXT NOT NULL,receipt_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,UNIQUE(source_key,reference))`).run();
}
const cashSourceKey=value=>value.normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export function paymentInput(input,now=new Date().toISOString()){
  need(input&&typeof input==='object','Zahlungsangaben fehlen.');
  need(input.receivedConfirmed===true,'Bitte persönlich bestätigen: Ich habe die Zahlung erhalten.',409);
  need(/^[a-f0-9-]{36}$/.test(input.idempotencyKey??''),'Eindeutiger Zahlungsschlüssel fehlt.');
  need(Number.isSafeInteger(input.amountCents)&&input.amountCents>0,'Zahlungsbetrag ungültig.');
  need(['Überweisung','Karte','Bar'].includes(input.method),'Zahlungsart fehlt.');
  const reference=input.reference;
  need(typeof reference==='string'&&reference.trim().length>0&&reference.trim().length<=180,input.method==='Bar'?'Bitte die vorhandene externe Kassen-/Belegreferenz angeben.':'Bitte die eindeutige Bank- oder Terminalbelegreferenz angeben.');
  need(typeof input.at==='string'&&Number.isFinite(Date.parse(input.at))&&Date.parse(input.at)<=Date.parse(now),'Zahlungszeitpunkt ungültig.');
  if(input.method==='Bar'){
    need(input.cashConfirmed===true,'Tatsächlichen Bargeldeingang ausdrücklich bestätigen.');
    need(input.externalCashRecordedConfirmed===true,'Bitte persönlich bestätigen: Diese Zahlung wurde bereits in der separaten Kasse erfasst.',409);
    need(typeof input.cashSource==='string'&&input.cashSource.trim().length>0&&input.cashSource.trim().length<=160&&!/[\r\n\0]/.test(input.cashSource),'Konkrete separate Kasse/Quelle angeben (höchstens 160 Zeichen).');
    need(!/[\r\n\0]/.test(reference),'Externe Belegreferenz ungültig.');
  }
  need(/^[a-f0-9-]{36}$/.test(input.receipt??''),'Vorhandener Original-Zahlungsbeleg fehlt.');
  return {id:input.idempotencyKey,amountCents:input.amountCents,method:input.method,reference:reference.trim(),at:new Date(input.at).toISOString(),receipt:input.receipt,cashConfirmed:input.method==='Bar'&&input.cashConfirmed===true,receivedConfirmed:true,...(input.method==='Bar'?{cashSource:input.cashSource.trim(),externalCashRecordedConfirmed:true,receiptHash:undefined}:{})};
}
export async function recordPayment(env,order,input,actor='owner',expectedVersion=order.version){
  need(actor==='owner','Den Zahlungseingang darf ausschließlich der persönlich angemeldete Betreiber bestätigen.',403);
  need(['Erledigt','Bezahlt'].includes(order.status)&&agreedOffer(order)&&order.acceptance,'Zahlungserfassung erst nach Abschluss und bestätigter Preisvereinbarung.',409);
  await paymentSchema(env);const payment=paymentInput(input);
  if(payment.method==='Bar'){
    const asset=await env.DB.prepare('SELECT id,kind,mime,hash,size FROM assets WHERE id=? AND order_id=?').bind(payment.receipt,order.id).first();
    need(asset?.kind==='payment'&&['application/pdf','image/jpeg','image/png','image/webp'].includes(asset.mime),'Original-Kassenbeleg fehlt, gehört zu einem anderen Auftrag oder ist kein Zahlungsbeleg-Upload.',409);
    const original=await env.BUCKET.get(payment.receipt);
    need(original?.body&&original.body.byteLength===asset.size&&digest(original.body)===asset.hash,'Der originale Kassenbeleg fehlt oder wurde verändert. Zahlung wurde nicht übernommen.',409);
    payment.receiptHash=asset.hash;
  }
  const fingerprint=digest(JSON.stringify(payment));
  const existing=await env.DB.prepare('SELECT * FROM payment_records WHERE id=? OR (order_id=? AND reference=?)').bind(payment.id,order.id,payment.reference).first();
  if(existing){need(existing.order_id===order.id&&existing.payload_hash===fingerprint,'Diese Zahlungsschlüssel oder Belegreferenz wurden bereits mit anderen Angaben verwendet.',409);return getOrder(env,order.id);}
  need(order.version===expectedVersion,'Diese Ansicht ist veraltet. Bitte Auftrag neu öffnen.',409);
  if(payment.method==='Bar'){
    const duplicate=await env.DB.prepare('SELECT payment_id FROM cash_receipt_links WHERE (source_key=? AND reference=?) OR receipt_hash=?').bind(cashSourceKey(payment.cashSource),payment.reference,payment.receiptHash).first();
    need(!duplicate,'Dieser externe Kassenbeleg wurde bereits einer Zahlung zugeordnet. Kein zweiter Zahlungseingang wurde übernommen.',409);
  }
  if(payment.method!=='Bar'){
    const asset=await env.DB.prepare('SELECT id,hash FROM assets WHERE id=? AND order_id=?').bind(payment.receipt,order.id).first();
    need(asset,'Zahlungsbeleg fehlt oder gehört zu einem anderen Auftrag.',409);
    const original=await env.BUCKET.get(payment.receipt);
    need(original?.body&&digest(original.body)===asset.hash,'Der originale Zahlungsbeleg fehlt oder wurde verändert. Zahlung wurde nicht gespeichert.',409);
  }
  // The existing domain transition controls completion, fixed price and overpayment.
  const updated=transition(order,'payment',payment),operationId=crypto.randomUUID();updated.operationId=operationId;
  const agreedTotalCents=agreedOffer(order).totalCents,paidTotalCents=updated.payments.reduce((sum,item)=>sum+item.amountCents,0);
  const recordedAt=new Date().toISOString(),snapshot={...payment,orderId:order.id,wg:order.wg,customer:order.source.name,services:agreedOffer(order).services,agreedTotalCents,paidTotalCents,remainingCents:agreedTotalCents-paidTotalCents,recordedAt,receivedConfirmedBy:actor,receivedConfirmedAt:recordedAt,documentType:payment.method==='Bar'?'Quittung':'Zahlungsnachweis',invoiceNumber:order.invoice?.number??null,...(payment.method==='Bar'?{importType:'external-cash-receipt',externalCashRecordedConfirmedBy:actor,externalCashRecordedConfirmedAt:recordedAt}:{})};
  const statements=[env.DB.prepare(`INSERT INTO payment_records(id,order_id,reference,payload_hash,data,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)`).bind(payment.id,order.id,payment.reference,fingerprint,JSON.stringify(snapshot),snapshot.recordedAt,order.id,order.version+1,operationId)];
  if(payment.method==='Bar')statements.push(env.DB.prepare('INSERT INTO cash_receipt_links SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payment_records WHERE id=? AND order_id=? AND payload_hash=?)').bind(payment.id,order.id,cashSourceKey(payment.cashSource),payment.reference,payment.receiptHash,recordedAt,payment.id,order.id,fingerprint));
  try{return await saveOrder(env,updated,order.version,payment.method==='Bar'?'Bereits extern erfasste Barzahlung mit Originalbeleg übernommen':'Tatsächlichen Zahlungseingang dokumentiert',actor,statements);}
  catch(error){
    const retry=await env.DB.prepare('SELECT * FROM payment_records WHERE id=? OR (order_id=? AND reference=?)').bind(payment.id,order.id,payment.reference).first();if(retry&&retry.order_id===order.id&&retry.payload_hash===fingerprint)return getOrder(env,order.id);
    if(payment.method==='Bar'){
      const duplicate=await env.DB.prepare('SELECT payment_id FROM cash_receipt_links WHERE (source_key=? AND reference=?) OR receipt_hash=?').bind(cashSourceKey(payment.cashSource),payment.reference,payment.receiptHash).first();
      need(!duplicate,'Dieser externe Kassenbeleg wurde bereits einer Zahlung zugeordnet. Kein zweiter Zahlungseingang wurde übernommen.',409);
    }
    throw error;
  }
}
export async function paymentRecord(env,orderId,paymentId){await paymentSchema(env);const row=await env.DB.prepare('SELECT data FROM payment_records WHERE id=? AND order_id=?').bind(paymentId,orderId).first();need(row,'Zahlungsnachweis nicht gefunden.',404);return JSON.parse(row.data);}

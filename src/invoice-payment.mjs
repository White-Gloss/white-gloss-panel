import {need} from './domain.mjs';
import {agreedOffer} from './operations.mjs';

const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value/100);
export function invoicePaymentSummary(order,records=[]){
  const agreedTotalCents=agreedOffer(order)?.totalCents;
  need(Number.isSafeInteger(agreedTotalCents)&&agreedTotalCents>0,'Bestätigter Rechnungsbetrag fehlt.',409);
  const confirmed=[],ids=new Set(),references=new Set();
  for(const record of records){
    if(record.receivedConfirmed!==true||record.receivedConfirmedBy!=='owner')continue;
    need(record.orderId===order.id&&record.wg===order.wg&&record.agreedTotalCents===agreedTotalCents,'Zahlungsbestätigung gehört nicht zum vereinbarten Rechnungsbetrag.',409);
    need(typeof record.id==='string'&&!ids.has(record.id)&&typeof record.reference==='string'&&record.reference&&!references.has(record.reference),'Zahlungsbestätigung fehlt oder ist doppelt.',409);
    need(Number.isSafeInteger(record.amountCents)&&record.amountCents>0&&['Bar','Karte','Überweisung'].includes(record.method),'Bestätigte Zahlung ist ungültig.',409);
    need(Number.isFinite(Date.parse(record.at))&&Number.isFinite(Date.parse(record.receivedConfirmedAt)),'Zeitpunkt der persönlichen Zahlungsbestätigung fehlt.',409);
    need(record.method!=='Bar'||record.cashConfirmed===true,'Persönliche Bargeldbestätigung fehlt.',409);
    ids.add(record.id);references.add(record.reference);confirmed.push(record);
  }
  const receivedTotalCents=confirmed.reduce((sum,record)=>sum+record.amountCents,0),cashTotalCents=confirmed.filter(record=>record.method==='Bar').reduce((sum,record)=>sum+record.amountCents,0);
  need(Number.isSafeInteger(receivedTotalCents)&&receivedTotalCents<=agreedTotalCents,'Bestätigte Zahlungen überschreiten den Rechnungsbetrag.',409);
  const remainingCents=agreedTotalCents-receivedTotalCents,fullyPaid=receivedTotalCents===agreedTotalCents,fullyCashPaid=fullyPaid&&cashTotalCents===agreedTotalCents;
  const header=fullyCashPaid?'Bar bezahlt':cashTotalCents>0?(fullyPaid?'Bezahlt – davon bar '+money(cashTotalCents):'Barzahlung erhalten: '+money(cashTotalCents)+' · Offen: '+money(remainingCents)):fullyPaid?'Bezahlt':receivedTotalCents>0?'Teilzahlung erhalten: '+money(receivedTotalCents)+' · Offen: '+money(remainingCents):null;
  const paidAt=fullyPaid?new Date(Math.max(...confirmed.map(record=>Date.parse(record.at)))).toISOString():null;
  return {agreedTotalCents,receivedTotalCents,cashTotalCents,remainingCents,fullyPaid,fullyCashPaid,paidAt,header,payments:confirmed.map(record=>({id:record.id,amountCents:record.amountCents,method:record.method,at:record.at,receivedConfirmedAt:record.receivedConfirmedAt})).sort((a,b)=>a.id.localeCompare(b.id))};
}

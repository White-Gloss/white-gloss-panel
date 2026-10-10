import {getOrder,saveOrder,configuration,claimJob} from '../src/worker.mjs';
import {need,text,cents,customerSignaturePNG} from '../src/domain.mjs';
import {agreedOffer} from '../src/operations.mjs';
import {digest,issueCustomerAccess} from './auth.mjs';
import {validateCustomerSignature} from './customer-signature.mjs';

export function amendmentOpen(order) {
  need(order.acceptance&&order.offer&&!order.invoice&&!order.return&&!(order.payments??[]).length&&['Angenommen','Termin verbindlich','In Arbeit'].includes(order.status),'Nachträge sind nach der Kundenannahme und vor Rückgabe, Rechnung oder Zahlung möglich.',409);
}
export function createAmendment(order,input,now=new Date().toISOString()) {
  amendmentOpen(order);
  need(!(order.amendments??[]).some(a=>a.state==='open'&&Date.parse(a.expiresAt)>Date.parse(now)),'Zuerst den offenen Nachtrag freigeben oder zurückziehen.',409);
  need(text(input.services)&&text(input.reason),'Zusatzleistungen und Grund fehlen.');
  need(Number.isInteger(input.extraMinutes)&&input.extraMinutes>=0&&input.extraMinutes<=1440,'Zusätzliche Arbeitszeit: 0 bis 1440 Minuten.');
  const amountCents=cents(input.amountCents),baseTotalCents=agreedOffer(order).totalCents;cents(baseTotalCents+amountCents);
  const item={id:crypto.randomUUID(),token:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),state:'open',services:text(input.services,6000),reason:text(input.reason,2000),extraMinutes:input.extraMinutes,amountCents,baseTotalCents,totalCents:baseTotalCents+amountCents,createdAt:now,expiresAt:new Date(Date.parse(now)+7*86400000).toISOString()};
  return {...structuredClone(order),amendments:[...(order.amendments??[]),item]};
}
export function amendmentView(order,item,isOwner=false) {
  return {variant:'amendment',wg:order.wg,customer:order.source.name,vehicle:order.source.vehicle,ownerPreview:isOwner,amendment:{id:item.id,state:item.state,services:item.services,reason:item.reason,extraMinutes:item.extraMinutes,amountCents:item.amountCents,baseTotalCents:item.baseTotalCents,totalCents:item.totalCents,expiresAt:item.expiresAt,acceptedAt:item.acceptance?.at??null}};
}
export async function amendmentAction(env,order,action,input) {
  if(action==='amendmentSend')return sendAmendment(env,order,input);
  const operationId=crypto.randomUUID(),extra=[];
  let updated;
  if(action==='amendmentCreate'){
    updated=createAmendment(order,input);const item=updated.amendments.at(-1);
    extra.push(env.DB.prepare("INSERT INTO offer_tokens(hash,order_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)").bind(digest(item.token),order.id,item.expiresAt,order.id,order.version+1,operationId));
  }else{
    need(action==='amendmentWithdraw','Unbekannter Nachtragsschritt.');updated=structuredClone(order);
    const item=updated.amendments?.find(a=>a.id===input.amendmentId);need(item?.state==='open','Nur offene Nachträge können zurückgezogen werden.',409);
    need(text(input.reason),'Bitte den Rücknahmegrund angeben.');item.state='withdrawn';item.withdrawnAt=new Date().toISOString();item.withdrawalReason=text(input.reason);
  }
  updated.operationId=operationId;
  return saveOrder(env,updated,order.version,action==='amendmentCreate'?'Nachtrag zur Kundenfreigabe erstellt':'Offenen Nachtrag zurückgezogen','owner',extra);
}
export async function acceptAmendment(env,order,item,input) {
  if(item.state==='accepted'){need(item.acceptance.snapshotHash===input.snapshotHash,'Ein anderer Nachtrag wurde unterschrieben.',409);return {ok:true,amendment:true};}
  amendmentOpen(order);need(item.state==='open'&&Date.parse(item.expiresAt)>Date.now(),'Dieser Nachtrag ist geschlossen oder abgelaufen.',409);
  need(input.paymentObligation===true,'Bitte den zusätzlichen Preis ausdrücklich bestätigen.');
  need(agreedOffer(order).totalCents===item.baseTotalCents,'Vereinbarter Gesamtpreis hat sich geändert. Neuen Nachtrag anfordern.',409);
  const snapshot=amendmentView(order,item);need(digest(JSON.stringify(snapshot))===input.snapshotHash,'Nachtrag verändert. Bitte neu öffnen und unterschreiben.',409);
  validateCustomerSignature(customerSignaturePNG(input.signature));
  const updated=structuredClone(order),a=updated.amendments.find(a=>a.id===item.id);
  a.state='accepted';a.acceptance={at:new Date().toISOString(),snapshotHash:input.snapshotHash,snapshot,signature:input.signature,paymentObligation:true};
  await saveOrder(env,updated,order.version,'Kunde hat Nachtrag persönlich unterschrieben','customer');
  return {ok:true,amendment:true};
}
export async function sendAmendment(env,order,input) {
  amendmentOpen(order);need(!order.synthetic,'Testnachträge werden nicht versendet.',409);
  const item=order.amendments?.find(a=>a.id===input.amendmentId);need(item?.state==='open'&&Date.parse(item.expiresAt)>Date.now(),'Kein offener Nachtrag vorhanden.',409);
  const config=await configuration(env,['resendKey']);need(config.emailVerified&&config.sendApproved&&config.resendKey,'E-Mail-Versand zuerst prüfen und freigeben.',409);
  const job=await claimJob(env,order,'amendment-'+item.id);need(job,'Nachtrag schon versendet oder Ergebnis ungeklärt.',409);
  let attempted=false;
  try{
    const current=await getOrder(env,order.id);need(current.version===order.version,'Ansicht veraltet. Bitte neu öffnen.',409);
    const access=await issueCustomerAccess(env,order.source.email,'/angebot/'+item.token,Date.now(),Math.min(Date.now()+86400000,Date.parse(item.expiresAt)));
    attempted=true;
    const result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-amendment-'+item.id},body:JSON.stringify({from:config.sender,to:[order.source.email],subject:'White Gloss · Nachtrag zur Freigabe · '+order.wg,text:'Guten Tag '+order.source.name+',\n\nbitte prüfen Sie die Zusatzleistungen und den zusätzlichen Preis. Erst Ihre persönliche Unterschrift gibt diesen Nachtrag frei.\n\n'+item.services+'\nZusätzlicher Preis: '+(item.amountCents/100).toFixed(2)+' EUR brutto\nNeuer Gesamtpreis: '+(item.totalCents/100).toFixed(2)+' EUR brutto\nZusätzliche Arbeitszeit: '+item.extraMinutes+' Minuten. Ein vereinbarter Termin wird dadurch nicht automatisch verschoben.\n\n'+access.url+'\nPIN für diesen Nachtragslink: '+access.pin+'\n\nDieser Linkzugang gilt bis zu 24 Stunden. Ihre bereits aktivierte persönliche Kundenpanel-PIN bleibt erhalten. Wiederholte Anmeldung: '+env.PANEL_ORIGIN+'/kundenportal. Einen neuen Zugang können Sie unter '+env.PANEL_ORIGIN+'/angebot/'+item.token+' anfordern.'})});
    const data=await result.json();need(result.ok&&typeof data.id==='string','Versandergebnis ungeklärt.',502);
    await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,updated_at=? WHERE id=?").bind(data.id,new Date().toISOString(),job).run();
    return current;
  }catch(error){await env.DB.prepare('UPDATE jobs SET state=?,detail=?,updated_at=? WHERE id=?').bind(attempted?'unknown':'failed',attempted?'Versandergebnis ungeklärt. Keine automatische Wiederholung.':'Vor dem Versand angehalten.',new Date().toISOString(),job).run();throw error;}
}

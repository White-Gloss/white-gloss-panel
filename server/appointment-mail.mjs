import {randomUUID} from 'node:crypto';
import {configuration,getOrder} from '../src/worker.mjs';
import {need,berlin} from '../src/domain.mjs';
import {COMPANY} from '../src/company.mjs';
import {digest} from './auth.mjs';

const email=value=>(value??'').trim().toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const money=value=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(value/100);

/** Pure renderer; calling this does not create an order, signature, calendar event or email. */
export function appointmentConfirmationPayload(order,sender){
  const a=order.acceptance,snapshot=a?.snapshot,p=snapshot?.appointment,offer=snapshot?.offer,recipient=email(order.source?.email),copy=email(COMPANY.email);
  need(a?.snapshotHash&&a.appointmentOptionId&&p?.id===a.appointmentOptionId&&offer&&Number.isSafeInteger(offer.totalCents),'Gemeinsam unterschriebene Angebots- und Terminvereinbarung fehlt.',409);
  need(validEmail(recipient),'Kunden-E-Mail für die Terminbestätigung fehlt.',409);
  need(Number.isFinite(Date.parse(p.start))&&Number.isFinite(Date.parse(p.end))&&Date.parse(p.end)>Date.parse(p.start),'Unterschriebener Termin ist unvollständig.',409);
  const lines=(offer.lines??[]).map(line=>'• '+line.title+(line.description?' – '+line.description:'')+': '+money(line.amountCents)).join('\n');
  const condition=offer.condition?'\n\nGeprüfter Fahrzeugzustand:\n'+offer.condition:'',pickup=p.delivery==='Abholung'?'\nIm Festpreis enthaltene Abholung: '+money(offer.pickupCents??0):'';
  return {from:sender,to:[recipient],...(copy!==recipient?{cc:[copy]}:{}),reply_to:copy,subject:'White Gloss · Verbindliche Terminbestätigung · '+order.wg,text:'Guten Tag '+order.source.name+',\n\nSie haben die Leistungen, den Gesamtfestpreis und den folgenden Termin gemeinsam persönlich unterschrieben. Ihre Vereinbarung ist im White-Gloss-Panel gespeichert.\n\nAuftragsnummer: '+order.wg+'\nFahrzeug: '+(order.source.vehicle??'')+'\nBeginn: '+berlin(p.start)+' Uhr (Europe/Berlin)\nEnde: '+berlin(p.end)+' Uhr (Europe/Berlin)\nDauer: '+p.duration+' Minuten\nÜbergabe: '+p.delivery+'\nOrt: '+p.location+condition+'\n\nVereinbarte Leistungen:\n'+(offer.services??'')+(lines?'\n\n'+lines:'')+'\n\nGesamtfestpreis brutto: '+money(offer.totalCents)+pickup+'\nPersönlich bestätigt am: '+berlin(a.at)+' Uhr (Europe/Berlin)\n\nBei Rückfragen oder Änderungswünschen antworten Sie bitte auf diese E-Mail.\n\n'+COMPANY.name+'\n'+COMPANY.owner+'\n'+COMPANY.street+'\n'+COMPANY.city+'\n'+COMPANY.phone+'\n'+COMPANY.email};
}

export async function appointmentMailSchema(env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS appointment_confirmations(job_id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,snapshot_hash TEXT NOT NULL,recipient TEXT NOT NULL,copy_to TEXT NOT NULL,payload TEXT NOT NULL,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '')").run();
}

export function appointmentConfirmationQueue(env,order,operationId,version){
  if(order.synthetic)return [];
  const payload=appointmentConfirmationPayload(order,'');delete payload.from;
  const recipient=payload.to[0],copy=email(COMPANY.email);
  need(digest(copy)===env.OWNER_EMAIL_SHA256,'Betriebliche Kopie muss an deine bestätigte Betreiberadresse gehen.',409);
  const id=randomUUID(),now=new Date().toISOString(),guard="EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
  return [
    env.DB.prepare("INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,'appointment-confirmation','queued',?,? WHERE "+guard).bind(id,order.id,now,now,order.id,version,operationId),
    env.DB.prepare('INSERT INTO appointment_confirmations(job_id,order_id,snapshot_hash,recipient,copy_to,payload) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)').bind(id,order.id,order.acceptance.snapshotHash,recipient,copy,JSON.stringify(payload),id)
  ];
}

export async function deliverAppointmentConfirmation(env,orderId){
  const record=await env.DB.prepare('SELECT d.*,j.state,j.updated_at FROM appointment_confirmations d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=?').bind(orderId).first();
  if(!record){const order=await getOrder(env,orderId);return order.synthetic?{state:'test',message:'Testannahme gespeichert; keine E-Mail versendet.'}:{state:'failed',message:'Termin gespeichert; Versandauftrag fehlt und muss geprüft werden.'};}
  const now=Date.now();
  if(record.state==='pending'&&record.processing_until<=now){await env.DB.prepare("UPDATE jobs SET state='unknown',detail='Voriger Versand ohne eindeutiges Ergebnis beendet. Keine automatische Wiederholung.',updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM appointment_confirmations WHERE job_id=? AND processing_until<=?)").bind(new Date().toISOString(),record.job_id,record.job_id,now).run();return {state:'unknown',message:'Termin gespeichert; Versandergebnis ungeklärt. Keine automatische Wiederholung.'};}
  if(!['queued','failed'].includes(record.state))return {state:record.state,message:record.state==='sent'?'Terminbestätigung an den Kunden mit Kopie an dich versendet.':record.state==='cancelled'?'Auftrag storniert; die ausstehende Terminbestätigung wurde aufgehoben.':record.state==='unknown'?'Termin gespeichert; Versandergebnis ungeklärt. Keine automatische Wiederholung.':'Termin gespeichert; die Bestätigungsmail wird bereits versendet.'};
  const leaseOwner=randomUUID(),claimed=await env.DB.prepare("UPDATE appointment_confirmations SET processing_until=?,lease_owner=? WHERE job_id=? AND processing_until<=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state IN ('queued','failed'))").bind(now+120000,leaseOwner,record.job_id,now,record.job_id).run();
  if(!claimed.meta.changes)return {state:'queued',message:'Termin gespeichert; die Bestätigungsmail wird bereits verarbeitet.'};
  let attempted=false,providerId=null;
  try{
    const order=await getOrder(env,orderId);
    if(order.status==='Storniert'){await env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Auftrag vor Versand storniert; keine Bestätigungsmail',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM appointment_confirmations WHERE job_id=? AND lease_owner=?)").bind(new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();return {state:'cancelled',message:'Auftrag storniert; die ausstehende Terminbestätigung wurde aufgehoben.'};}
    need(!order.synthetic&&order.acceptance?.snapshotHash===record.snapshot_hash&&order.acceptance?.appointmentOptionId,'Versand gehört nicht zur unterschriebenen Terminvereinbarung.',409);
    need(JSON.stringify(order.appointment)===JSON.stringify(order.acceptance.snapshot?.appointment),'Aktueller Termin weicht von der unterschriebenen Vereinbarung ab.',409);
    need(digest(record.copy_to)===env.OWNER_EMAIL_SHA256,'Betriebliche Versandkopie stimmt nicht mit dem Betreiber überein.',409);
    const stored=JSON.parse(record.payload),expected=appointmentConfirmationPayload(order,'');delete expected.from;
    need(JSON.stringify(stored)===JSON.stringify(expected),'Gespeicherte Terminbestätigung weicht von der unterschriebenen Vereinbarung ab.',409);
    const config=await configuration(env,['resendKey']);need(config.emailVerified&&config.sendApproved&&config.resendKey&&config.sender,'Termin gespeichert. E-Mail-Versand zuerst prüfen und freigeben.',409);
    const reserved=await env.DB.prepare("UPDATE jobs SET state='pending',detail='Terminbestätigung wird angefordert',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM appointment_confirmations WHERE job_id=? AND lease_owner=?) AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status IN ('Termin verbindlich','In Arbeit','Erledigt','Bezahlt') AND json_extract(data,'$.acceptance.snapshotHash')=?)").bind(new Date().toISOString(),record.job_id,record.job_id,leaseOwner,orderId,record.snapshot_hash).run();
    if(!reserved.meta.changes){const job=await env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(record.job_id).first();return {state:job?.state??'queued',message:job?.state==='cancelled'?'Auftrag storniert; die ausstehende Terminbestätigung wurde aufgehoben.':'Termin gespeichert; Versand wurde bereits übernommen.'};}
    attempted=true;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-appointment-'+record.job_id},body:JSON.stringify({from:config.sender,...stored})});
    const data=await response.json();need(response.ok&&typeof data?.id==='string'&&data.id.length>0,'Versandergebnis ist nicht eindeutig bestätigt.',502);providerId=data.id;
    await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail='Terminbestätigung an Kunden und Betreiber bestätigt',updated_at=? WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM appointment_confirmations WHERE job_id=? AND lease_owner=?)").bind(providerId,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();
    return {state:'sent',message:'Terminbestätigung an den Kunden mit Kopie an dich versendet.'};
  }catch(error){
    const state=attempted?'unknown':'failed',detail=attempted?'Versandergebnis ungeklärt. Keine automatische Wiederholung.':'Terminbestätigung steht aus: '+error.message;
    const changed=await env.DB.prepare('UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=? AND '+(attempted?"state='pending'":"state IN ('queued','failed')")+' AND EXISTS(SELECT 1 FROM appointment_confirmations WHERE job_id=? AND lease_owner=?)').bind(state,providerId,detail,new Date().toISOString(),record.job_id,record.job_id,leaseOwner).run();
    if(!changed.meta.changes){const job=await env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(record.job_id).first();if(job?.state==='cancelled')return {state:'cancelled',message:'Auftrag storniert; die ausstehende Terminbestätigung wurde aufgehoben.'};return {state:job?.state??'unknown',message:'Termin gespeichert; der Versandstatus wird geprüft. Keine neue E-Mail erzeugt.'};}
    return {state,message:'Termin und Unterschrift sind gespeichert. '+detail};
  }finally{await env.DB.prepare("UPDATE appointment_confirmations SET processing_until=0,lease_owner='' WHERE job_id=? AND lease_owner=?").bind(record.job_id,leaseOwner).run();}
}

export async function pendingAppointmentConfirmations(env){
  const rows=await env.DB.prepare("SELECT d.order_id FROM appointment_confirmations d JOIN jobs j ON j.id=d.job_id WHERE j.state IN ('queued','failed','pending') AND d.processing_until<=? ORDER BY j.created_at LIMIT 2").bind(Date.now()).all(),errors=[];
  for(const row of rows.results){const result=await deliverAppointmentConfirmation(env,row.order_id);if(!['sent','cancelled'].includes(result.state))errors.push(result.message);}
  return errors;
}

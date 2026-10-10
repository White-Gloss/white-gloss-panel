import {AppError,need,text,berlin} from '../src/domain.mjs';
import {agreedOffer,recordOperationIssue} from '../src/operations.mjs';
import {getOrder,saveOrder,configuration,settings,unprotect} from '../src/worker.mjs';
import {digest} from './auth.mjs';

const email=value=>String(value??'').trim().toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const appointmentValue=p=>p?{start:p.start,end:p.end,delivery:p.delivery,location:p.location}:null;
const appointmentKey=order=>digest(JSON.stringify(appointmentValue(order.appointment)));
const sameAppointment=(a,b)=>JSON.stringify(appointmentValue(a))===JSON.stringify(appointmentValue(b));
export const preparationTemplates=[
  {id:'general',label:'Allgemeine Fahrzeugaufbereitung',text:'Bitte persönliche Wertsachen aus dem Fahrzeug nehmen und den Fahrzeugschlüssel bereithalten. Teilen Sie uns besondere Hinweise zum Fahrzeug vorab mit.'},
  {id:'interior',label:'Innenraumaufbereitung',text:'Bitte persönliche Gegenstände aus Innenraum und Kofferraum entfernen, damit die vereinbarten Bereiche zugänglich sind. Auf empfindliche Materialien oder besondere Verschmutzungen bitte hinweisen.'},
  {id:'exterior',label:'Außenaufbereitung',text:'Bitte auf bekannte Lackschäden, Folierungen und bereits vorhandene Beschichtungen hinweisen. Persönliche Wertsachen bitte aus dem Fahrzeug nehmen.'},
  {id:'coating',label:'Politur / Versiegelung',text:'Bitte auf bekannte Nachlackierungen, Folierungen und vorhandene Versiegelungen hinweisen. Besondere Wünsche bitte vor dem Termin abstimmen.'}
];
export function suggestedPreparation(order){
  const services=String(agreedOffer(order)?.services??order.source?.package??'').toLowerCase();
  const id=/keramik|versiegel|politur/.test(services)?'coating':/innen/.test(services)?'interior':/außen|aussen|wäsche/.test(services)?'exterior':'general';
  const delivery=order.appointment?.delivery==='Abholung'?'Bitte halten Sie Fahrzeug und Schlüssel am vereinbarten Abholort bereit. Der Zugang zum Fahrzeug muss möglich sein.':'Bitte bringen Sie das Fahrzeug und den Schlüssel zum vereinbarten Übergabeort.';
  return {template:id,instructions:preparationTemplates.find(item=>item.id===id).text+'\n'+delivery};
}
export async function appointmentReminderSchema(env){
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS appointment_reminder_deliveries(job_id TEXT PRIMARY KEY REFERENCES jobs(id),order_id TEXT NOT NULL REFERENCES orders(id),appointment_key TEXT NOT NULL,snapshot_hash TEXT NOT NULL,payload TEXT NOT NULL,due_at TEXT NOT NULL,attempted_at TEXT,UNIQUE(order_id,appointment_key))').run();
}
export function appointmentConfirmed(order){
  if(!order.acceptance?.at||!order.appointment)return false;
  if(order.appointmentRevisions?.some(item=>item.acceptance?.confirmed===true&&item.acceptance?.at&&item.acceptance?.snapshotHash&&sameAppointment(item.after,order.appointment)))return true;
  if(order.acceptance.appointmentOptionId)return Boolean(order.acceptance.snapshotHash)&&sameAppointment(order.acceptance.snapshot?.appointment,order.appointment);
  // Earlier accepted offers use the existing operator-confirmed appointment workflow.
  return Boolean(order.acceptance.at)&&(!order.acceptance.snapshot?.appointment||sameAppointment(order.acceptance.snapshot.appointment,order.appointment));
}
export function reminderSnapshot(order,now=Date.now()){
  const config=order.appointmentReminder;
  const issue=recordOperationIssue(order,'send');need(!issue,issue,409);
  need(config?.enabled===true,'Terminerinnerung ist nicht aktiviert.',409);
  need(order.status==='Termin verbindlich'&&appointmentConfirmed(order),'Ein tatsächlich bestätigter Termin mit Kundenannahme fehlt.',409);
  const p=order.appointment,start=Date.parse(p.start),end=Date.parse(p.end);
  need(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&start>now,'Termin ist unvollständig oder liegt nicht mehr in der Zukunft.',409);
  need(['Abholung','Kunde bringt'].includes(p.delivery)&&text(p.location),'Übergabeart und vereinbarter Ort müssen vollständig sein.',409);
  const recipient=email(order.source.email),permission=config.permission;
  need(config.channel==='email'&&validEmail(recipient),'Nur der vorhandene E-Mail-Kanal mit gültigem Empfänger ist verfügbar.',409);
  need(permission?.granted===true&&!permission.revokedAt&&permission.channel==='email'&&permission.recipient===recipient&&permission.orderId===order.id&&text(permission.evidence)&&Number.isFinite(Date.parse(permission.at)),'Dokumentierte Kommunikationsfreigabe für diese E-Mail-Adresse fehlt oder wurde widerrufen.',409);
  need(Number.isInteger(config.leadHours)&&config.leadHours>=1&&config.leadHours<=168,'Vorlauf muss 1 bis 168 Stunden betragen.',409);
  need(config.preparationReviewed===true&&text(config.instructions),'Vorbereitungshinweise wurden noch nicht geprüft.',409);
  const services=text(agreedOffer(order)?.services,8000);need(services,'Vereinbarte Leistungen fehlen.',409);
  const dueAt=new Date(start-config.leadHours*3600000).toISOString(),key=appointmentKey(order);
  const payload={to:[recipient],subject:'White Gloss · Terminerinnerung · '+order.wg,text:'Guten Tag '+order.source.name+',\n\nwir erinnern Sie an Ihren bestätigten Termin bei White Gloss.\n\nAuftrag: '+order.wg+'\nFahrzeug: '+order.source.vehicle+'\nTermin: '+berlin(p.start)+' Uhr (Europe/Berlin)\nÜbergabe: '+p.delivery+'\nOrt: '+p.location+'\n\nVereinbarte Leistungen:\n'+services+'\n\nVorbereitung:\n'+config.instructions+'\n\nBei Rückfragen oder Änderungswünschen antworten Sie bitte auf diese E-Mail.'};
  return {key,kind:'reminder:'+key,dueAt,due:Date.parse(dueAt)<=now,payload,hash:digest(JSON.stringify({key,payload,dueAt,permission}))};
}
async function legacyLock(env,id){return env.DB.prepare("SELECT state FROM jobs WHERE order_id=? AND kind='reminder' AND state IN ('sent','pending','unknown')").bind(id).first();}
function statusText(state){return ({queued:'Erinnerung ist vorgemerkt.',pending:'Anfrage an den E-Mail-Anbieter läuft.',sent:'E-Mail-Anbieter hat die Erinnerung angenommen. Die Zustellung ist damit noch nicht bestätigt.',unknown:'Versandergebnis ungeklärt. Kein automatischer Neuversuch; Anbieterresultat prüfen.',failed:'Versand steht aus. Es wurde noch keine Nachricht angefordert.',cancelled:'Vormerkung aufgehoben; keine neue Nachricht.'})[state]??state;}
export async function appointmentReminderData(env,order,now=Date.now()){
  await appointmentReminderSchema(env);const config=order.appointmentReminder??null,defaultPreparation=suggestedPreparation(order);
  let snapshot=null,reason=null;try{snapshot=reminderSnapshot(order,now);}catch(error){reason=config?error.message:null;}
  const jobs=await env.DB.prepare("SELECT j.id,j.kind,j.state,j.detail,j.updated_at,j.provider_id,d.due_at FROM jobs j LEFT JOIN appointment_reminder_deliveries d ON d.job_id=j.id WHERE j.order_id=? AND (j.kind='reminder' OR j.kind LIKE 'reminder:%') ORDER BY j.created_at DESC").bind(order.id).all();
  const legacy=await legacyLock(env,order.id),provider=await settings(env);
  return {legacyMode:!config,orderId:order.id,orderVersion:order.version,synthetic:order.synthetic===true,config,templates:preparationTemplates,suggested:defaultPreparation,recipient:email(order.source.email),preview:snapshot?.payload??null,dueAt:snapshot?.dueAt??null,reason,legacyBlocked:!!legacy,legacyMessage:legacy?'Eine frühere Erinnerung wurde bereits angefordert oder versendet. Ihr Terminbezug ist nicht sicher nachweisbar; keine zusätzliche automatische E-Mail.':null,providerReady:provider.emailVerified===true&&provider.sendApproved===true&&provider.backgroundApproved===true,jobs:jobs.results.map(job=>({...job,message:statusText(job.state)}))};
}
async function inputOf(request){
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=12000,'Eingabe zu groß.',413);
  try{const input=JSON.parse(raw);need(input&&typeof input==='object'&&!Array.isArray(input),'Ungültige Eingabe.');return input;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige JSON-Eingabe.');}
}
export async function appointmentRemindersEndpoint(env,request,identity){
  const url=new URL(request.url);if(url.pathname!=='/api/appointment-reminders')return null;
  need(identity&&digest(identity)===env.OWNER_EMAIL_SHA256,'Nur der Betreiber darf Terminerinnerungen verwalten.',403);
  await appointmentReminderSchema(env);const order=await getOrder(env,url.searchParams.get('id'));
  if(request.method==='GET')return Response.json(await appointmentReminderData(env,order));
  need(request.method==='POST','Methode nicht erlaubt.',405);need(request.headers.get('origin')===env.PANEL_ORIGIN,'Ungültiger Ursprung.',403);
  const input=await inputOf(request);need(['save','preview'].includes(input.action),'Unbekannte Erinnerungseinstellung.');
  need(Number.isInteger(input.orderVersion)&&input.orderVersion===order.version,'Auftrag wurde geändert. Bitte neu öffnen.',409);
  need(typeof input.enabled==='boolean','Aktivierung bitte ausdrücklich auswählen.');need(input.channel==='email','Nur der vorhandene E-Mail-Kanal ist verfügbar.');
  const at=new Date().toISOString(),old=order.appointmentReminder,recipient=email(order.source.email);
  const config={enabled:input.enabled,channel:'email',leadHours:input.leadHours,template:text(input.template,40),instructions:text(input.instructions,3000),preparationReviewed:input.preparationReviewed===true,updatedAt:at,changeId:crypto.randomUUID(),permission:old?.permission??null,history:[...(old?.history??[])]};
  need(Number.isInteger(config.leadHours)&&config.leadHours>=1&&config.leadHours<=168,'Vorlauf muss 1 bis 168 Stunden betragen.');
  need(preparationTemplates.some(item=>item.id===config.template),'Vorlage nicht gefunden.');
  if(input.enabled){
    need(config.preparationReviewed&&config.instructions,'Vorbereitungshinweise bitte ausdrücklich prüfen.');
    need(input.communicationApproved===true&&text(input.evidence,1000),'Bestehende Kommunikationsfreigabe prüfen und nachvollziehbar dokumentieren.');
    config.permission={granted:true,channel:'email',recipient,orderId:order.id,evidence:text(input.evidence,1000),at};
  }else if(config.permission)config.permission={...config.permission,granted:false,revokedAt:at};
  config.history.push({at,enabled:config.enabled,permission:config.permission});
  const updated={...order,appointmentReminder:config};if(input.enabled)reminderSnapshot(updated);
  if(input.action==='preview'){const preview=reminderSnapshot(updated);return Response.json({preview:preview.payload,dueAt:preview.dueAt});}
  const guard='EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,\'$.appointmentReminder.changeId\')=?)';
  await saveOrder(env,updated,order.version,input.enabled?'Terminerinnerung und Kommunikationsfreigabe dokumentiert':'Terminerinnerung deaktiviert','owner',[
    env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Erinnerungseinstellungen geändert; vor Versand neu prüfen',updated_at=? WHERE order_id=? AND (kind='reminder' OR kind LIKE 'reminder:%') AND state IN ('queued','failed') AND "+guard).bind(at,order.id,order.id,order.version+1,config.changeId)
  ]);
  return Response.json(await appointmentReminderData(env,await getOrder(env,order.id)));
}

async function cancelQueued(env,id,kind=null){
  await env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Termin oder Freigabe nicht mehr aktuell; nichts versendet',updated_at=? WHERE order_id=? AND kind LIKE 'reminder:%' AND state IN ('queued','failed')"+(kind?' AND kind<>?':'')).bind(new Date().toISOString(),id,...(kind?[kind]:[])).run();
}
async function queueReminder(env,order,snapshot){
  const at=new Date().toISOString(),id=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?)';
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO jobs(id,order_id,kind,state,created_at,updated_at,detail) SELECT ?,?,?,'queued',?,?,'Terminerinnerung vorgemerkt' WHERE "+guard).bind(id,order.id,snapshot.kind,at,at,order.id,order.version),
    env.DB.prepare("INSERT OR IGNORE INTO appointment_reminder_deliveries(job_id,order_id,appointment_key,snapshot_hash,payload,due_at) SELECT j.id,?,?,?,?,? FROM jobs j WHERE j.order_id=? AND j.kind=? AND "+guard).bind(order.id,snapshot.key,snapshot.hash,JSON.stringify(snapshot.payload),snapshot.dueAt,order.id,snapshot.kind,order.id,order.version),
    env.DB.prepare("UPDATE appointment_reminder_deliveries SET snapshot_hash=?,payload=?,due_at=? WHERE order_id=? AND appointment_key=? AND attempted_at IS NULL AND EXISTS(SELECT 1 FROM jobs j WHERE j.id=job_id AND j.state IN ('queued','failed','cancelled')) AND "+guard).bind(snapshot.hash,JSON.stringify(snapshot.payload),snapshot.dueAt,order.id,snapshot.key,order.id,order.version),
    env.DB.prepare("UPDATE jobs SET state='queued',detail='Terminerinnerung vorgemerkt',updated_at=? WHERE order_id=? AND kind=? AND state IN ('failed','cancelled') AND EXISTS(SELECT 1 FROM appointment_reminder_deliveries d WHERE d.job_id=jobs.id AND d.attempted_at IS NULL AND d.snapshot_hash=?) AND "+guard).bind(at,order.id,snapshot.kind,snapshot.hash,order.id,order.version)
  ]);
  return env.DB.prepare('SELECT j.*,d.snapshot_hash,d.attempted_at FROM jobs j JOIN appointment_reminder_deliveries d ON d.job_id=j.id WHERE j.order_id=? AND j.kind=?').bind(order.id,snapshot.kind).first();
}
export async function deliverAppointmentReminder(env,id,now=Date.now(),{allowSend=true}={}){
  await appointmentReminderSchema(env);let order=await getOrder(env,id);
  if(order.synthetic){await cancelQueued(env,id);return {state:'test',message:'Testdaten: Vorschau verfügbar; keine Kunden-E-Mail.'};}
  let snapshot;try{snapshot=reminderSnapshot(order,now);}catch(error){await cancelQueued(env,id);return {state:'cancelled',message:error.message};}
  await cancelQueued(env,id,snapshot.kind);
  if(await legacyLock(env,id)){await cancelQueued(env,id);return {state:'legacy',message:'Frühere Erinnerung mit unklarem Terminbezug; kein zusätzlicher Versand.'};}
  const unresolved=await env.DB.prepare("SELECT state FROM jobs WHERE order_id=? AND kind LIKE 'reminder:%' AND kind<>? AND state IN ('unknown','pending')").bind(id,snapshot.kind).first();
  if(unresolved){await cancelQueued(env,id);return {state:unresolved.state,message:'Früherer Erinnerungsversand ungeklärt; keine neue Erinnerung bis zum Anbieterabgleich.'};}
  const job=await queueReminder(env,order,snapshot);if(!job)return {state:'cancelled',message:'Auftrag wurde inzwischen geändert.'};
  if(!['queued','failed'].includes(job.state))return {state:job.state,message:statusText(job.state)};
  if(!snapshot.due||!allowSend)return {state:'queued',message:'Erinnerung ist für '+berlin(snapshot.dueAt)+' vorgemerkt.'};
  let attempted=false,claimed=false,providerId=null;
  try{
    const config=await configuration(env,['resendKey']);need(config.emailVerified&&config.sendApproved&&config.backgroundApproved&&config.resendKey&&config.sender,'Versand steht aus: bestehende E-Mail- und Hintergrundfreigaben prüfen.',409);
    const result=await env.DB.prepare("UPDATE jobs SET state='pending',detail='Versand wird geprüft',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM appointment_reminder_deliveries WHERE job_id=? AND snapshot_hash=? AND attempted_at IS NULL)").bind(new Date().toISOString(),job.id,id,order.version,job.id,snapshot.hash).run();
    if(!result.meta.changes)return {state:'queued',message:'Ein anderer Lauf oder eine Auftragsänderung hat die Erinnerung übernommen.'};claimed=true;
    // Re-read after the atomic claim: cancellation, recipient, consent and provider changes win.
    order=await getOrder(env,id);const current=reminderSnapshot(order,now),protectedConfig=await settings(env),fresh=/** @type {any} */ ({...protectedConfig,resendKey:await unprotect(env,protectedConfig.resendKey)});
    need(!order.synthetic&&current.hash===snapshot.hash&&current.key===snapshot.key,'Termin oder Kommunikationsfreigabe wurde geändert; nichts versendet.',409);
    need(fresh.emailVerified&&fresh.sendApproved&&fresh.backgroundApproved&&fresh.resendKey&&fresh.sender,'Versandfreigabe wurde zurückgenommen; nichts versendet.',409);
    need(!await legacyLock(env,id),'Frühere Erinnerung wurde parallel angefordert; nichts zusätzlich versendet.',409);
    const marked=await env.DB.prepare("UPDATE appointment_reminder_deliveries SET attempted_at=? WHERE job_id=? AND attempted_at IS NULL AND snapshot_hash=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='pending')").bind(new Date().toISOString(),job.id,snapshot.hash,id,order.version,job.id).run();
    need(marked.meta.changes,'Auftrag wurde unmittelbar vor Versand geändert; nichts versendet.',409);
    // The Node runtime performs this final read synchronously, immediately before fetch.
    // All awaited provider/configuration/claim work is complete at this point.
    need(env.DB.sql?.prepare,'Sichere unmittelbare Versandprüfung ist in dieser Laufzeit nicht verfügbar.',503);
    const finalRow=env.DB.sql.prepare("SELECT o.*,(SELECT json_group_object(key,json(value)) FROM settings) AS current_settings,(SELECT state FROM jobs WHERE id=?) AS job_state FROM orders o WHERE id=?").get(job.id,id);
    need(finalRow&&finalRow.version===order.version&&finalRow.job_state==='pending','Auftrag wurde unmittelbar vor Versand geändert; nichts versendet.',409);
    const finalConfig=JSON.parse(finalRow.current_settings),finalOrder={...JSON.parse(finalRow.data),id:finalRow.id,status:finalRow.status,version:finalRow.version};
    need(!finalOrder.synthetic&&reminderSnapshot(finalOrder,now).hash===snapshot.hash,'Termin oder Kommunikationsfreigabe wurde unmittelbar vor Versand geändert.',409);
    need(finalConfig.backgroundApproved&&finalConfig.emailVerified&&finalConfig.sendApproved&&finalConfig.sender===fresh.sender&&finalConfig.resendKey===protectedConfig.resendKey,'Versandfreigabe wurde unmittelbar vor Versand geändert.',409);
    attempted=true;
    const response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+fresh.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-'+id+'-'+snapshot.kind},body:JSON.stringify({from:fresh.sender,...current.payload})});
    const data=await response.json();need(response.ok&&typeof data?.id==='string'&&data.id.length>0,'Versandergebnis nicht eindeutig.',502);providerId=data.id;
    await env.DB.prepare("UPDATE jobs SET state='sent',provider_id=?,detail='Vom E-Mail-Anbieter angenommen; Zustellung noch nicht bestätigt',updated_at=? WHERE id=? AND state='pending'").bind(providerId,new Date().toISOString(),job.id).run();
    return {state:'sent',message:statusText('sent'),attempted:true};
  }catch(error){
    const state=attempted?'unknown':'failed',message=attempted?statusText('unknown'):error instanceof AppError?error.message:'Versandprüfung fehlgeschlagen; keine Nachricht angefordert.';
    if(claimed&&!attempted)await env.DB.prepare("UPDATE appointment_reminder_deliveries SET attempted_at=NULL WHERE job_id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='pending')").bind(job.id,job.id).run();
    await env.DB.prepare('UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=? AND '+(claimed?"state='pending'":"state IN ('queued','failed')")).bind(state,providerId,message,new Date().toISOString(),job.id).run();
    return {state,message,attempted};
  }
}
export async function pendingAppointmentReminders(env,now=Date.now()){
  await appointmentReminderSchema(env);
  await env.DB.prepare("UPDATE jobs SET state='unknown',detail='Voriger Erinnerungsversand ohne eindeutiges Ergebnis beendet; kein automatischer Neuversuch',updated_at=? WHERE kind LIKE 'reminder:%' AND state='pending' AND updated_at<?").bind(new Date().toISOString(),new Date(now-120000).toISOString()).run();
  const rows=await env.DB.prepare("SELECT id FROM orders WHERE json_extract(data,'$.appointmentReminder') IS NOT NULL OR EXISTS(SELECT 1 FROM jobs WHERE order_id=orders.id AND kind LIKE 'reminder:%' AND state IN ('queued','failed')) ORDER BY json_extract(data,'$.appointment.start'),updated_at").all(),errors=[];let remaining=5;
  for(const row of rows.results){const result=await deliverAppointmentReminder(env,row.id,now,{allowSend:remaining>0});if(result.attempted)remaining--;if(['failed','unknown'].includes(result.state))errors.push(result.message);}
  return {errors};
}

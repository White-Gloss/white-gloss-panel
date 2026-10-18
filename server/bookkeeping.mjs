import {randomUUID} from 'node:crypto';
import {AppError,need,text,transition} from '../src/domain.mjs';
import {inputFor} from './password-auth.mjs';
import {advisorContext,advisorStillActive,advisorJSON} from './advisor-auth.mjs';
import {bookData,hash,day,monthValid,monthView,lastResolution,lastPeriod,openMonth} from './bookkeeping-data.mjs';
import {datevConfig,datevLine,datevFile,fiscalContains} from './datev.mjs';

function reason(value){need(typeof value==='string'&&value.trim().length>=8&&value.length<=800,'Bitte eine nachvollziehbare Begründung mit 8–800 Zeichen eingeben.');return value.trim();}
const statement=(env,sql,...params)=>env.DB.prepare(sql).bind(...params);
async function commit(env,data,action,note,build){
  const id=randomUUID(),at=new Date().toISOString();
  try{await env.DB.batch([statement(env,'INSERT INTO book_commands VALUES(?,?,?,?,?)',id,data.version,at,action,note),...build(id,at)]);}catch(error){if(error.message?.includes('BOOK_STALE'))throw new AppError('Der Finanzstand wurde geändert. Bitte neu laden und erneut prüfen.',409);throw error;}
  return advisorJSON({ok:true});
}
function orderUpdate(env,order,at,action){return statement(env,'UPDATE orders SET data=?,status=?,version=version+1,updated_at=?,actor=?,action=? WHERE id=? AND version=?',JSON.stringify(order),order.status,at,'owner',action,order.id,order.version);}
function sourceFor(data,input){const source=data.sources.find(s=>s.key===input.sourceKey);need(source,'Quelle nicht gefunden.',404);need(source.hash===input.sourceHash,'Quelle wurde geändert. Bitte neu laden.',409);return source;}
function configurationFor(data,month){const c=datevConfig(data.settings??{});need(fiscalContains(c,month+'-01'),'Wirtschaftsjahr für diesen Monat in DATEV-Einstellungen hinterlegen.',409);return c;}
const profile=c=>({advisor:c.advisor,client:c.client,chart:c.chart,length:c.length,yearStart:c.yearStart});
function validateEntries(entries,config,month){for(const e of entries){datevLine(e.data,config,month);need(JSON.stringify(e.data.profile)===JSON.stringify(profile(config)),'Kontenrahmen oder Mandat einer Buchung passen nicht zu den DATEV-Einstellungen. Erst stornieren und neu freigeben.',409);}}
async function reconcile(env,data,input){
  const s=sourceFor(data,input);need(s.kind==='bank'&&s.status==='completed'&&s.currency==='EUR'&&s.date,'Nur gebuchte EUR-Umsätze mit Datum können abgeglichen werden.',409);
  const month=s.date.slice(0,7);openMonth(data,month);
  const links=data.matches.filter(m=>m.bank_key===s.key);need(links.every(m=>m.bank_revision===s.revision),'Alte Zuordnung zuerst lösen: Qonto hat diesen Umsatz geändert.',409);
  const remaining=s.amount-links.reduce((sum,m)=>sum+m.amount,0),amount=Number(input.amount);
  need(Number.isSafeInteger(amount)&&amount>0&&amount<=remaining,'Betrag überschreitet den noch offenen Bankbetrag.',409);
  let order=null,paymentId=null,created=0;const note=reason(input.note);
  if(input.orderId){
    need(s.side==='credit','Rechnungszahlungen können nur mit einem Geldeingang verbunden werden.',409);
    const invoice=data.invoices.find(i=>i.orderId===input.orderId&&i.invoiceId===input.invoiceId);need(invoice,'Aktuelle Rechnung nicht gefunden.',409);
    order=data.orders.get(invoice.orderId);need(!order.trash?.deletedAt,'Auftrag zuerst wiederherstellen.',409);
    if(input.paymentId){const p=invoice.payments.find(p=>p.id===input.paymentId);need(p&&!p.matched&&p.method==='Überweisung'&&p.amount===amount,'Vorhandene Überweisung ist bereits verknüpft oder hat einen anderen Betrag.',409);paymentId=p.id;}
    else{need(amount<=invoice.open,'Betrag überschreitet die offene Rechnung. Überzahlung getrennt klären.',409);order=transition(order,'payment',{amountCents:amount,at:data.bank.find(r=>r.revision_id===s.revision).settled_at,method:'Überweisung',note:'Bankabgleich: '+note});paymentId=order.payments.at(-1).id;created=1;}
  }
  return commit(env,data,'reconcile',note,(id,at)=>[
    ...(created?[orderUpdate(env,order,at,'Bestätigter Bankabgleich')]:[]),
    statement(env,'INSERT INTO book_matches VALUES(?,?,?,?,?,?,?,?,?,?)',randomUUID(),id,s.key,s.revision,month,amount,order?.id??null,paymentId,created,note)
  ]);
}
async function unmatch(env,data,input){
  const m=data.matches.find(m=>m.id===input.id);need(m,'Aktive Zuordnung nicht gefunden.',404);openMonth(data,m.month);const note=reason(input.note);
  let order=null;if(m.created_payment){order=data.orders.get(m.order_id);need(order,'Auftrag fehlt.',409);order=transition(order,'paymentEdit',{id:m.payment_id,cancelled:true});}
  return commit(env,data,'unmatch',note,(id,at)=>[statement(env,'INSERT INTO book_match_reversals VALUES(?,?)',m.id,id),...(order?[orderUpdate(env,order,at,'Bankzuordnung gelöst; Zahlung storniert')]:[])]);
}
async function resolveSource(env,data,input){
  const s=sourceFor(data,input),month=input.month;openMonth(data,month);need(s.date?.startsWith(month+'-'),'Quelle gehört nicht in den gewählten Monat. Datum zuerst in der Quelle klären.',409);
  const prior=lastResolution(data,s.key);need(prior?.kind!=='post','Freigegebene Buchung zuerst stornieren.',409);const note=reason(input.note);
  need(['post','exclude'].includes(input.kind),'Freigabeart ungültig.');let lines=[];
  if(input.kind==='post'){
    const config=configurationFor(data,month);need(!s.missing&&!s.canceled&&s.currency==='EUR'&&(s.kind!=='bank'||s.status==='completed'),'Quelle muss vollständig, gültig und in EUR sein.',409);
    need(Array.isArray(input.lines)&&input.lines.length>0&&input.lines.length<=12,'1–12 Buchungszeilen erforderlich.');
    lines=input.lines.map(l=>({...datevLine(l,config,month),profile:profile(config)}));need(lines.reduce((sum,l)=>sum+l.amount,0)===s.amount,'Summe der Buchungszeilen muss genau dem Quellbetrag entsprechen.',409);
  }
  return commit(env,data,input.kind,note,id=>[
    statement(env,'INSERT INTO book_resolutions(command_id,source_key,source_hash,month,kind,reason) VALUES(?,?,?,?,?,?)',id,s.key,s.hash,month,input.kind,note),
    ...lines.map(l=>statement(env,'INSERT INTO book_entries VALUES(?,(SELECT id FROM book_resolutions WHERE command_id=?),?,?,NULL)',randomUUID(),id,month,JSON.stringify(l)))
  ]);
}
async function reverse(env,data,input){
  const r=data.resolutions.find(r=>r.id===Number(input.resolutionId));need(r?.kind==='post'&&lastResolution(data,r.source_key)?.id===r.id,'Aktive Buchung nicht gefunden.',409);openMonth(data,r.month);const note=reason(input.note);
  const entries=data.entries.filter(e=>e.resolution_id===r.id&&!e.reversal_of);need(entries.length,'Keine Buchungszeilen gefunden.',409);
  return commit(env,data,'reverse',note,id=>[
    statement(env,"INSERT INTO book_resolutions(command_id,source_key,source_hash,month,kind,reason) VALUES(?,?,?,?,'reverse',?)",id,r.source_key,r.source_hash,r.month,note),
    ...entries.map(e=>statement(env,'INSERT INTO book_entries VALUES(?,(SELECT id FROM book_resolutions WHERE command_id=?),?,?,?)',randomUUID(),id,r.month,JSON.stringify(e.data),e.id))
  ]);
}
async function closeMonth(env,data,input){
  const month=input.month;openMonth(data,month);need(month<day(new Date().toISOString()).slice(0,7),'Ein Monat kann erst nach seinem letzten Tag abgeschlossen werden.',409);
  const view=monthView(data,month),config=configurationFor(data,month);need(view.problems.length===0,'Offene Punkte zuerst klären: '+view.problems.slice(0,3).join(' · '),409);validateEntries(view.entries,config,month);
  need(input.complete===true,'Vollständigkeit von Kontoauszügen, Bar-/Kartenzahlungen und Belegen ausdrücklich bestätigen.');const note=reason(input.note);
  const snapshot=JSON.stringify({fingerprint:view.fingerprint,evidence:view.evidence,settings:config,entries:view.entries,invoices:data.invoices.map(i=>({orderId:i.orderId,number:i.number,total:i.total,paid:i.paid,open:i.open})),complete:true,note,at:new Date().toISOString()});
  return commit(env,data,'close',note,id=>[statement(env,"INSERT INTO book_periods(command_id,month,kind,snapshot,sha256) VALUES(?,?,'close',?,?)",id,month,snapshot,hash(snapshot))]);
}
async function exportMonth(env,data,input){
  const view=monthView(data,input.month),period=lastPeriod(data,input.month);need(period?.kind==='close'&&!view.period.changed,'Monat zuerst abschließen. Nachträgliche Änderungen müssen erneut geprüft werden.',409);
  const existing=data.exports.find(e=>e.period_id===period.id);if(existing)return advisorJSON({ok:true,id:existing.id});
  const snapshot=JSON.parse(period.snapshot),entries=snapshot.entries.filter(e=>!data.exported.has(e.id));need(entries.length,'Für diesen Abschluss gibt es keine neuen Buchungszeilen.',409);
  const at=new Date().toISOString(),bytes=datevFile(snapshot.settings,input.month,entries,at),id=randomUUID(),filename='EXTF_WhiteGloss_'+input.month+'_'+id.slice(0,8)+'.csv';
  const response=await commit(env,data,'export','DATEV-Stapel für Abschluss '+period.id,command=>[
    statement(env,'INSERT INTO book_exports VALUES(?,?,?,?,?,?,?,?)',id,command,period.id,input.month,filename,bytes.toString('base64'),hash(bytes),entries.length),
    ...entries.map(e=>statement(env,'INSERT INTO book_export_entries VALUES(?,?)',e.id,id))
  ]);need(response.ok,'Export konnte nicht gespeichert werden.',500);return advisorJSON({ok:true,id});
}
export async function handleBookkeeping(env,request){
  const url=new URL(request.url),path=url.pathname;if(path!=='/buchhaltung'&&path!=='/api/books'&&!path.startsWith('/api/books/'))return null;
  const context=await advisorContext(env,request);
  if(!context&&path==='/buchhaltung')return Response.redirect(new URL('/kanzlei',env.PANEL_ORIGIN),303);
  need(context,'Bitte persönlich anmelden.',401);
  if(path==='/buchhaltung'){need(request.method==='GET','Methode nicht erlaubt.',405);return env.ASSETS.fetch(new Request(new URL('/bookkeeping.html',env.PANEL_ORIGIN)));}
  if(request.method==='GET'&&path==='/api/books/download'){
    const row=await env.DB.prepare('SELECT * FROM book_exports WHERE id=?').bind(url.searchParams.get('id')).first();need(row,'Export nicht gefunden.',404);need(hash(Buffer.from(row.bytes_base64,'base64'))===row.sha256,'Gespeicherter Export ist beschädigt.',503);await advisorStillActive(env,context);
    return new Response(Buffer.from(row.bytes_base64,'base64'),{headers:{'Content-Type':'text/csv; charset=windows-1252','Content-Disposition':'attachment; filename="'+row.filename+'"','Cache-Control':'no-store'}});
  }
  if(request.method==='GET'&&path==='/api/books/period'){
    const row=await env.DB.prepare('SELECT * FROM book_periods WHERE id=?').bind(Number(url.searchParams.get('id'))).first();need(row,'Abschluss nicht gefunden.',404);need(hash(row.snapshot)===row.sha256,'Abschlussnachweis ist beschädigt.',503);await advisorStillActive(env,context);return advisorJSON({id:row.id,month:row.month,kind:row.kind,sha256:row.sha256,snapshot:JSON.parse(row.snapshot)});
  }
  if(request.method==='GET'&&path==='/api/books'){
    const data=await bookData(env),month=url.searchParams.get('month')??day(new Date().toISOString()).slice(0,7),view=monthView(data,month);await advisorStillActive(env,context);
    return advisorJSON({isOwner:context.isOwner,version:data.version,settings:data.settings,view,invoices:data.invoices,periods:data.periods.map(p=>({id:p.id,month:p.month,kind:p.kind,sha256:p.sha256}))});
  }
  need(context.isOwner,'Freigaben, Zahlungsabgleich, Abschluss und DATEV-Einstellungen sind dem Betreiber vorbehalten.',403);need(request.method==='POST','Methode nicht erlaubt.',405);
  const input=await inputFor(env,request,16384),data=await bookData(env);need(input.version===data.version,'Ansicht ist veraltet. Bitte neu laden.',409);
  if(path==='/api/books/settings'){const config=datevConfig(input);return commit(env,data,'settings','DATEV-Einstellungen manuell bestätigt',id=>[statement(env,'INSERT INTO book_settings(command_id,data) VALUES(?,?)',id,JSON.stringify(config))]);}
  if(path==='/api/books/reconcile')return reconcile(env,data,input);
  if(path==='/api/books/unmatch')return unmatch(env,data,input);
  if(path==='/api/books/resolve')return resolveSource(env,data,input);
  if(path==='/api/books/reverse')return reverse(env,data,input);
  if(path==='/api/books/close')return closeMonth(env,data,input);
  if(path==='/api/books/reopen'){
    need(monthValid(input.month)&&lastPeriod(data,input.month)?.kind==='close','Abgeschlossener Monat nicht gefunden.',409);const note=reason(input.note),snapshot=JSON.stringify({previousId:lastPeriod(data,input.month).id,note,at:new Date().toISOString()});
    return commit(env,data,'reopen',note,id=>[statement(env,"INSERT INTO book_periods(command_id,month,kind,snapshot,sha256) VALUES(?,?,'reopen',?,?)",id,input.month,snapshot,hash(snapshot))]);
  }
  if(path==='/api/books/export')return exportMonth(env,data,input);
  return advisorJSON({error:'Funktion nicht gefunden.'},404);
}

import {need,berlinISO,text} from '../src/domain.mjs';
import {BOOKING_ZONE,bookingDayValid,bookingWeekend,bookingLocalParts,bookingWindowError,bookingCalendarMetadata,bookingFreeRanges} from '../src/booking-calendar.mjs';

function bookingRange(from,to){
  need(bookingDayValid(from)&&bookingDayValid(to),'Bitte einen gültigen Datumsbereich wählen.');
  const days=(Date.parse(to+'T12:00:00Z')-Date.parse(from+'T12:00:00Z'))/86400000;
  need(days>=1&&days<=62,'Der Kalenderbereich muss zwischen einem und 62 Tagen liegen.');
  return {start:berlinISO(from+'T00:00'),end:berlinISO(to+'T00:00'),days};
}

function bookingDateAfter(day,offset){return new Date(Date.parse(day+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);}

function bookingWindows(day,rule){
  if(!bookingWeekend(day))return [{start:berlinISO(day+'T08:30'),end:berlinISO(day+'T18:00')}];
  if(!rule)return [];
  let windows;try{windows=JSON.parse(rule.windows);}catch{need(false,'Gespeicherte Wochenendfreigabe ist ungültig.',503);}
  need(Array.isArray(windows)&&windows.every(window=>!bookingWindowError(window)&&bookingLocalParts(window.start).day===day),'Gespeicherte Wochenendfreigabe ist ungültig.',503);
  return windows;
}

export async function validateBookingCalendar(env,appointment,{synthetic=false,excludeOrderId=''}={}){
  need(!bookingWindowError(appointment),bookingWindowError(appointment));
  need(Date.parse(appointment.start)>Date.now(),'Termin muss in der Zukunft liegen.',409);
  Object.assign(appointment,bookingCalendarMetadata(appointment));
  const scope=synthetic?1:0;
  const rule=await env.DB.prepare('SELECT * FROM calendar_day_rules WHERE day=? AND synthetic=?').bind(appointment.calendarDay,scope).first();
  const windows=bookingWindows(appointment.calendarDay,rule);
  need(windows.some(window=>Date.parse(window.start)<=Date.parse(appointment.start)&&Date.parse(window.end)>=Date.parse(appointment.end)),'Dieser Wochenendtag oder Zeitraum ist für Kundenbuchungen gesperrt.',409);
  const occupied=await env.DB.prepare('SELECT id FROM calendar_entries WHERE synthetic=? AND julianday(start)<julianday(?) AND julianday(end)>julianday(?) UNION ALL SELECT a.order_id AS id FROM appointments a WHERE COALESCE((SELECT synthetic FROM orders WHERE id=a.order_id),0)=? AND a.order_id!=? AND julianday(a.start)<julianday(?) AND julianday(a.end)>julianday(?) LIMIT 1').bind(scope,appointment.end,appointment.start,scope,excludeOrderId,appointment.end,appointment.start).first();
  need(!occupied,'Dieser Zeitraum ist bereits belegt oder blockiert. Bitte eine andere Zeit wählen.',409);
  return appointment;
}

export async function readBookingCalendar(env,{from,to,synthetic=false,owner=false,duration=30,now=new Date().toISOString()}){
  const range=bookingRange(from,to),scope=synthetic?1:0;
  need(Number.isInteger(duration)&&duration>=15&&duration<=570,'Bitte eine Dauer zwischen 15 und 570 Minuten wählen.');
  const [entriesResult,appointmentsResult,rulesResult]=await Promise.all([
    env.DB.prepare('SELECT * FROM calendar_entries WHERE synthetic=? AND julianday(start)<julianday(?) AND julianday(end)>julianday(?) ORDER BY start').bind(scope,range.end,range.start).all(),
    env.DB.prepare('SELECT a.start,a.end,a.order_id,o.wg,o.version,o.data,o.status FROM appointments a JOIN orders o ON o.id=a.order_id WHERE o.synthetic=? AND julianday(a.start)<julianday(?) AND julianday(a.end)>julianday(?) ORDER BY a.start').bind(scope,range.end,range.start).all(),
    env.DB.prepare('SELECT * FROM calendar_day_rules WHERE synthetic=? AND day>=? AND day<? ORDER BY day').bind(scope,from,to).all()
  ]);
  const entries=entriesResult.results,appointments=appointmentsResult.results,rules=rulesResult.results;
  const days=Array.from({length:range.days},(_,index)=>{
    const day=bookingDateAfter(from,index),start=berlinISO(day+'T00:00'),end=berlinISO(bookingDateAfter(day,1)+'T00:00');
    const windows=bookingWindows(day,rules.find(rule=>rule.day===day));
    const busy=[...entries,...appointments].filter(entry=>Date.parse(entry.start)<Date.parse(end)&&Date.parse(entry.end)>Date.parse(start)).map(entry=>({start:entry.start,end:entry.end}));
    const free=bookingFreeRanges(windows,busy,owner?undefined:now);
    return {day,weekend:bookingWeekend(day),closed:!windows.length,windows,busy,free,available:free.some(window=>Date.parse(window.end)-Date.parse(window.start)>=duration*60000)};
  });
  if(!owner)return {timeZone:BOOKING_ZONE,from,to,duration,days};
  return {timeZone:BOOKING_ZONE,from,to,duration,days,entries,rules:rules.map(rule=>({...rule,windows:JSON.parse(rule.windows)})),appointments:appointments.map(row=>{const order=JSON.parse(row.data);return {id:row.order_id,wg:row.wg,version:row.version,status:row.status,start:row.start,end:row.end,name:order.source?.name??'',vehicle:order.source?.vehicle??''};})};
}

export async function changeBookingCalendar(env,input){
  need(input&&typeof input==='object','Kalenderangaben fehlen.');
  const scope=input.synthetic===true?1:0,at=new Date().toISOString();
  if(input.action==='saveEntry'){
    need(['appointment','block'].includes(input.kind),'Bitte Termin oder Zeitblockierung auswählen.');
    need(typeof input.title==='string'&&input.title.trim().length>0&&input.title.trim().length<=180,'Bitte einen Titel mit höchstens 180 Zeichen angeben.');
    need(input.note===undefined||typeof input.note==='string'&&input.note.length<=2000,'Die Notiz darf höchstens 2000 Zeichen enthalten.');
    const start=berlinISO(input.start),end=berlinISO(input.end);
    need(Date.parse(end)>Date.parse(start),'Das Ende muss nach dem Beginn liegen.');
    need(Date.parse(end)-Date.parse(start)<=366*86400000,'Ein Eintrag darf höchstens 366 Tage umfassen.');
    const id=input.id??crypto.randomUUID();
    let statement;
    if(input.id){need(Number.isInteger(input.version)&&input.version>0,'Aktuelle Eintragsversion fehlt.',409);statement=env.DB.prepare('UPDATE calendar_entries SET version=version+1,kind=?,title=?,note=?,start=?,end=?,updated_at=? WHERE id=? AND version=? AND synthetic=?').bind(input.kind,input.title.trim(),text(input.note),start,end,at,id,input.version,scope);}
    else statement=env.DB.prepare('INSERT INTO calendar_entries(id,synthetic,kind,title,note,start,end,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,scope,input.kind,input.title.trim(),text(input.note),start,end,at);
    const result=await env.DB.batch([statement]);need(result[0].meta.changes>0,'Dieser Eintrag wurde inzwischen geändert. Bitte Kalender neu laden.',409);
    return {ok:true,entry:await env.DB.prepare('SELECT * FROM calendar_entries WHERE id=? AND synthetic=?').bind(id,scope).first()};
  }
  if(input.action==='deleteEntry'){
    need(typeof input.id==='string'&&Number.isInteger(input.version)&&input.version>0,'Aktuelle Eintragsversion fehlt.',409);
    const result=await env.DB.batch([env.DB.prepare('DELETE FROM calendar_entries WHERE id=? AND version=? AND synthetic=?').bind(input.id,input.version,scope)]);
    need(result[0].meta.changes>0,'Dieser Eintrag wurde inzwischen geändert. Bitte Kalender neu laden.',409);return {ok:true};
  }
  if(input.action==='setDayRule'){
    need(bookingDayValid(input.day)&&bookingWeekend(input.day),'Bitte einen Samstag oder Sonntag auswählen.');
    need(Array.isArray(input.windows)&&input.windows.length<=8,'Bitte höchstens acht Freigabezeiträume angeben.');
    const windows=input.windows.map(window=>{
      need(/^\d{2}:\d{2}$/.test(window?.start??'')&&/^\d{2}:\d{2}$/.test(window?.end??''),'Freigabezeiten fehlen.');
      const value={start:berlinISO(input.day+'T'+window.start),end:berlinISO(input.day+'T'+window.end)};
      need(!bookingWindowError(value),bookingWindowError(value));return value;
    }).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    need(windows.every((window,index)=>index===0||Date.parse(windows[index-1].end)<=Date.parse(window.start)),'Freigabezeiträume dürfen sich nicht überschneiden.');
    need(Number.isInteger(input.version)&&input.version>=0,'Aktuelle Freigabeversion fehlt.',409);
    const statement=input.version===0?env.DB.prepare('INSERT OR IGNORE INTO calendar_day_rules(day,synthetic,windows,updated_at) VALUES(?,?,?,?)').bind(input.day,scope,JSON.stringify(windows),at):env.DB.prepare('UPDATE calendar_day_rules SET version=version+1,windows=?,updated_at=? WHERE day=? AND synthetic=? AND version=?').bind(JSON.stringify(windows),at,input.day,scope,input.version);
    const result=await env.DB.batch([statement]);need(result[0].meta.changes>0,'Diese Freigabe wurde inzwischen geändert. Bitte Kalender neu laden.',409);
    return {ok:true,rule:await env.DB.prepare('SELECT * FROM calendar_day_rules WHERE day=? AND synthetic=?').bind(input.day,scope).first()};
  }
  need(false,'Unbekannte Kalenderaktion.');
}

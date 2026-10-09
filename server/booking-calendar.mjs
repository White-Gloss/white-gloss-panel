import {need,berlinISO,text} from '../src/domain.mjs';
import {BOOKING_ZONE,bookingDayValid,bookingWeekend,bookingLocalParts,bookingWindowError,bookingCalendarMetadata,bookingFreeRanges} from '../src/booking-calendar.mjs';

const bookingSchemaReady=new WeakMap();
export async function bookingCalendarSchema(env){
  if(!bookingSchemaReady.has(env.DB))bookingSchemaReady.set(env.DB,env.DB.batch([
    'CREATE TABLE IF NOT EXISTS calendar_entry_links(entry_id TEXT PRIMARY KEY REFERENCES calendar_entries(id) ON DELETE CASCADE,customer_id TEXT,vehicle_id TEXT,order_id TEXT)',
    'CREATE INDEX IF NOT EXISTS calendar_entry_customer ON calendar_entry_links(customer_id)',
    'CREATE TABLE IF NOT EXISTS calendar_entry_history(id INTEGER PRIMARY KEY AUTOINCREMENT,entry_id TEXT NOT NULL,version INTEGER NOT NULL,synthetic INTEGER NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,before_data TEXT,after_data TEXT)'
  ].map(sql=>env.DB.prepare(sql))).catch(error=>{bookingSchemaReady.delete(env.DB);throw error;}));
  await bookingSchemaReady.get(env.DB);
}

async function bookingLinks(env,input,scope,old){
  const values={customer_id:input.customerId??old?.customer_id??'',vehicle_id:input.vehicleId??old?.vehicle_id??'',order_id:input.orderId??old?.order_id??''};
  need(Object.values(values).every(value=>typeof value==='string'&&value.length<=128),'Ungültige Aktenverknüpfung.');
  if(values.order_id){
    const order=await env.DB.prepare('SELECT o.synthetic,f.customer_id,f.vehicle_id FROM orders o LEFT JOIN order_files f ON f.order_id=o.id WHERE o.id=?').bind(values.order_id).first();
    need(order&&order.synthetic===scope&&order.customer_id,'Projekt nicht gefunden oder noch keiner Akte zugeordnet.',404);
    need(!values.customer_id||values.customer_id===order.customer_id,'Das Projekt gehört zu einer anderen Kundenakte.',409);
    need(!values.vehicle_id||values.vehicle_id===order.vehicle_id,'Das Projekt gehört zu einem anderen Fahrzeug.',409);
    values.customer_id=order.customer_id;values.vehicle_id=order.vehicle_id;
  }
  if(values.vehicle_id){
    const vehicle=await env.DB.prepare('SELECT v.customer_id,c.synthetic FROM vehicle_files v JOIN customer_files c ON c.id=v.customer_id WHERE v.id=?').bind(values.vehicle_id).first();
    need(vehicle&&vehicle.synthetic===scope,'Fahrzeugakte nicht gefunden.',404);
    need(!values.customer_id||values.customer_id===vehicle.customer_id,'Das Fahrzeug gehört zu einer anderen Kundenakte.',409);values.customer_id=vehicle.customer_id;
  }
  if(values.customer_id){
    const customer=await env.DB.prepare('SELECT data FROM customer_files WHERE id=? AND synthetic=?').bind(values.customer_id,scope).first();need(customer,'Kundenakte nicht gefunden.',404);
    const state=JSON.parse(customer.data).lifecycle?.status;
    const unchanged=old&&Object.keys(values).every(key=>values[key]===(old[key]??''));
    need(unchanged||!state||state==='active','Diese Kundenakte ist gesperrt oder anonymisiert. Neue Verknüpfungen sind nicht möglich.',409);
  }
  return values;
}

function bookingLinkGuard(links,scope,before){
  const predicates=[],values=[],unchanged=before&&Object.keys(links).every(key=>links[key]===(before[key]??''));
  if(links.customer_id){predicates.push("EXISTS(SELECT 1 FROM customer_files WHERE id=? AND synthetic=?"+(unchanged?'':" AND COALESCE(json_extract(data,'$.lifecycle.status'),'active')='active'")+")");values.push(links.customer_id,scope);}
  if(links.vehicle_id){predicates.push('EXISTS(SELECT 1 FROM vehicle_files WHERE id=? AND customer_id=?)');values.push(links.vehicle_id,links.customer_id);}
  if(links.order_id){predicates.push('EXISTS(SELECT 1 FROM order_files f JOIN orders o ON o.id=f.order_id WHERE f.order_id=? AND f.customer_id=? AND f.vehicle_id=? AND o.synthetic=?)');values.push(links.order_id,links.customer_id,links.vehicle_id,scope);}
  return {sql:predicates.join(' AND ')||'1',values};
}

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
  await bookingCalendarSchema(env);
  const range=bookingRange(from,to),scope=synthetic?1:0;
  need(Number.isInteger(duration)&&duration>=15&&duration<=570,'Bitte eine Dauer zwischen 15 und 570 Minuten wählen.');
  const [entriesResult,appointmentsResult,rulesResult]=await Promise.all([
    env.DB.prepare('SELECT e.*,l.customer_id,l.vehicle_id,l.order_id FROM calendar_entries e LEFT JOIN calendar_entry_links l ON l.entry_id=e.id WHERE synthetic=? AND julianday(start)<julianday(?) AND julianday(end)>julianday(?) ORDER BY start').bind(scope,range.end,range.start).all(),
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
  await bookingCalendarSchema(env);
  const scope=input.synthetic===true?1:0,at=new Date().toISOString();
  if(input.action==='saveEntry'){
    need(['appointment','block'].includes(input.kind),'Bitte Termin oder Zeitblockierung auswählen.');
    need(typeof input.title==='string'&&input.title.trim().length>0&&input.title.trim().length<=180,'Bitte einen Titel mit höchstens 180 Zeichen angeben.');
    need(input.note===undefined||typeof input.note==='string'&&input.note.length<=2000,'Die Notiz darf höchstens 2000 Zeichen enthalten.');
    const start=berlinISO(input.start),end=berlinISO(input.end);
    need(Date.parse(end)>Date.parse(start),'Das Ende muss nach dem Beginn liegen.');
    need(Date.parse(end)-Date.parse(start)<=366*86400000,'Ein Eintrag darf höchstens 366 Tage umfassen.');
    const id=input.id??crypto.randomUUID();
    const before=input.id?await env.DB.prepare('SELECT e.*,l.customer_id,l.vehicle_id,l.order_id FROM calendar_entries e LEFT JOIN calendar_entry_links l ON l.entry_id=e.id WHERE e.id=? AND e.synthetic=?').bind(id,scope).first():null;
    if(input.id)need(before&&before.version===input.version,'Dieser Eintrag wurde inzwischen geändert. Bitte Kalender neu laden.',409);
    const links=await bookingLinks(env,input,scope,before),guard=bookingLinkGuard(links,scope,before),after={id,version:(before?.version??0)+1,synthetic:scope,kind:input.kind,title:input.title.trim(),note:text(input.note),start,end,...links};
    let statement;
    if(input.id){need(Number.isInteger(input.version)&&input.version>0,'Aktuelle Eintragsversion fehlt.',409);statement=env.DB.prepare('UPDATE calendar_entries SET version=version+1,kind=?,title=?,note=?,start=?,end=?,updated_at=? WHERE id=? AND version=? AND synthetic=? AND '+guard.sql).bind(input.kind,input.title.trim(),text(input.note),start,end,at,id,input.version,scope,...guard.values);}
    else statement=env.DB.prepare('INSERT INTO calendar_entries(id,synthetic,kind,title,note,start,end,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE '+guard.sql).bind(id,scope,input.kind,input.title.trim(),text(input.note),start,end,at,...guard.values);
    const result=await env.DB.batch([statement,
      env.DB.prepare('INSERT INTO calendar_entry_history(entry_id,version,synthetic,at,actor,action,before_data,after_data) SELECT ?,?,?,?,?,?,?,? WHERE changes()>0').bind(id,after.version,scope,at,'owner',before?'Eintrag geändert':'Eintrag angelegt',before?JSON.stringify(before):null,JSON.stringify(after)),
      env.DB.prepare('INSERT INTO calendar_entry_links(entry_id,customer_id,vehicle_id,order_id) SELECT ?,?,?,? WHERE changes()>0 ON CONFLICT(entry_id) DO UPDATE SET customer_id=excluded.customer_id,vehicle_id=excluded.vehicle_id,order_id=excluded.order_id').bind(id,links.customer_id||null,links.vehicle_id||null,links.order_id||null)
    ]);need(result[0].meta.changes>0,'Dieser Eintrag wurde inzwischen geändert. Bitte Kalender neu laden.',409);
    return {ok:true,entry:await env.DB.prepare('SELECT e.*,l.customer_id,l.vehicle_id,l.order_id FROM calendar_entries e LEFT JOIN calendar_entry_links l ON l.entry_id=e.id WHERE e.id=? AND e.synthetic=?').bind(id,scope).first()};
  }
  if(input.action==='deleteEntry'){
    need(typeof input.id==='string'&&Number.isInteger(input.version)&&input.version>0,'Aktuelle Eintragsversion fehlt.',409);
    const before=await env.DB.prepare('SELECT e.*,l.customer_id,l.vehicle_id,l.order_id FROM calendar_entries e LEFT JOIN calendar_entry_links l ON l.entry_id=e.id WHERE e.id=? AND e.synthetic=?').bind(input.id,scope).first();
    need(before&&before.version===input.version,'Dieser Eintrag wurde inzwischen geändert. Bitte Kalender neu laden.',409);
    const result=await env.DB.batch([env.DB.prepare('DELETE FROM calendar_entries WHERE id=? AND version=? AND synthetic=?').bind(input.id,input.version,scope),
      env.DB.prepare('INSERT INTO calendar_entry_history(entry_id,version,synthetic,at,actor,action,before_data) SELECT ?,?,?,?,?,?,? WHERE changes()>0').bind(input.id,input.version,scope,at,'owner','Eintrag gelöscht',JSON.stringify(before))]);
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

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const berlinDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const berlinTime=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const monthName=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'UTC'});
const fullDay=new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
const shortDay=new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
const utcDay=value=>new Date(value+'T12:00:00Z');
const isoDay=date=>date.toISOString().slice(0,10);
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')&&Number.isFinite(Date.parse(value+'T12:00:00Z'));
const duration=order=>order.appointment?.duration??Math.max(0,Math.round((Date.parse(order.appointment?.end??'')-Date.parse(order.appointment?.start??''))/60000));
const confirmed=order=>Boolean(order.appointment?.confirmation)||['Termin verbindlich','In Arbeit','Erledigt','Bezahlt'].includes(order.status);
const durationText=minutes=>minutes>=60?`${Math.floor(minutes/60)} Std.${minutes%60?` ${minutes%60} Min.`:''}`:`${minutes} Min.`;
export const calendarToday=()=>berlinDay.format(new Date());
export function calendarMonthFirst(offset=0,today=calendarToday()){
  const current=utcDay(today);
  return new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+offset,1,12));
}
export function calendarOffsetFor(day,today=calendarToday()){
  const current=utcDay(today),target=utcDay(day);
  return (target.getUTCFullYear()-current.getUTCFullYear())*12+target.getUTCMonth()-current.getUTCMonth();
}
function eventChip(order){
  const appointment=order.appointment,proposed=!confirmed(order),state=order.status==='In Arbeit'?'running':['Erledigt','Bezahlt'].includes(order.status)?'done':proposed?'proposed':'confirmed';
  const name=order.source.name||'Ohne Namen',vehicle=order.source.vehicle||'Fahrzeug nicht angegeben';
  return `<button type="button" class="schedule-event ${state}" data-order="${esc(order.id)}" aria-label="${esc(`${berlinTime.format(new Date(appointment.start))} Uhr, ${name}, ${vehicle}, ${proposed?'Terminvorschlag':order.status}. Auftrag öffnen`)}"><time datetime="${esc(appointment.start)}">${berlinTime.format(new Date(appointment.start))}</time><span>${esc(name)}</span></button>`;
}
function dayEvent(order){
  const appointment=order.appointment,proposed=!confirmed(order),minutes=duration(order),name=order.source.name||'Ohne Namen';
  return `<button type="button" class="schedule-detail ${proposed?'proposed':''}" data-order="${esc(order.id)}"><span class="schedule-detail-time"><strong>${berlinTime.format(new Date(appointment.start))}</strong><small>bis ${berlinTime.format(new Date(appointment.end))}</small></span><span class="schedule-detail-main"><strong>${esc(name)}</strong><span>${esc(order.source.vehicle||'Fahrzeug nicht angegeben')}</span><small>${esc([order.wg,minutes?durationText(minutes):'',appointment.delivery].filter(Boolean).join(' · '))}</small></span><span class="schedule-detail-state">${esc(proposed?'Vorschlag':order.status)}</span></button>`;
}
export function calendarWorkspaceHTML(orders,{offset=0,selectedDay='',synthetic=false,connectionLabel='Privater Kalenderexport verfügbar'}={}){
  const today=calendarToday(),first=calendarMonthFirst(offset,today),monthKey=isoDay(first).slice(0,7);
  const appointments=orders.filter(order=>order.appointment?.start&&order.appointment?.end&&!['Storniert','Abgelehnt','Abgelaufen'].includes(order.status)).sort((a,b)=>a.appointment.start.localeCompare(b.appointment.start));
  const byDay=new Map();for(const order of appointments){const key=berlinDay.format(new Date(order.appointment.start));if(!byDay.has(key))byDay.set(key,[]);byDay.get(key).push(order);}
  const monthOrders=appointments.filter(order=>berlinDay.format(new Date(order.appointment.start)).startsWith(monthKey));
  const monthMinutes=monthOrders.reduce((sum,order)=>sum+duration(order),0);
  const chosen=validDay(selectedDay)&&selectedDay.startsWith(monthKey)?selectedDay:offset===0?today:monthKey+'-01';
  const selectedOrders=byDay.get(chosen)??[],selectedMinutes=selectedOrders.reduce((sum,order)=>sum+duration(order),0);
  const gridStart=new Date(first);gridStart.setUTCDate(gridStart.getUTCDate()-((first.getUTCDay()+6)%7));
  const cells=Array.from({length:42},(_,index)=>{
    const date=new Date(gridStart);date.setUTCDate(gridStart.getUTCDate()+index);const key=isoDay(date),items=byDay.get(key)??[],outside=key.slice(0,7)!==monthKey,dayOffset=offset+(outside?(key<monthKey?-1:1):0);
    const label=`${fullDay.format(date)}, ${items.length?`${items.length} ${items.length===1?'Termin':'Termine'}`:'keine Termine'}`;
    return `<div class="schedule-cell${outside?' outside':''}${key===today?' today':''}${key===chosen?' selected':''}" role="gridcell"><button type="button" class="schedule-date" data-click="calendarDay" data-day="${key}" data-offset="${dayOffset}" aria-label="${esc(label)}" aria-pressed="${key===chosen}"><span>${date.getUTCDate()}</span>${items.length?`<small>${items.length}</small>`:''}</button><div class="schedule-events">${items.slice(0,3).map(eventChip).join('')}${items.length>3?`<button type="button" class="schedule-more" data-click="calendarDay" data-day="${key}" data-offset="${dayOffset}">+ ${items.length-3} weitere</button>`:''}</div></div>`;
  }).join('');
  const selectedDate=utcDay(chosen),monthText=monthName.format(first);
  return `<section class="schedule-calendar" aria-labelledby="schedule-month-title"><header class="schedule-commandbar"><div><span class="eyebrow">MONATSPLAN</span><h2 id="schedule-month-title">${esc(monthText)}</h2><p>${monthOrders.length} ${monthOrders.length===1?'Termin':'Termine'} · ${durationText(monthMinutes)} geplant</p></div><div class="schedule-actions"><div class="schedule-pager" aria-label="Monat wechseln"><button type="button" data-click="prevMonth" aria-label="Voriger Monat">←</button><button type="button" data-click="today">Heute</button><button type="button" data-click="nextMonth" aria-label="Nächster Monat">→</button></div><a class="button primary" href="/vor-ort#buchung">+ Sofort buchen</a></div></header><div class="schedule-body"><div class="schedule-month"><div class="schedule-weekdays" role="row">${['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'].map((day,index)=>`<div role="columnheader"><span class="schedule-weekday-full">${day}</span><span class="schedule-weekday-short">${['Mo','Di','Mi','Do','Fr','Sa','So'][index]}</span></div>`).join('')}</div><div class="schedule-grid" role="grid" aria-label="${esc(monthText)}">${cells}</div><div class="schedule-legend" aria-label="Legende"><span><i class="confirmed"></i>Bestätigt</span><span><i class="proposed"></i>Vorschlag</span><span><i class="running"></i>In Arbeit</span></div></div><aside class="schedule-day" aria-labelledby="schedule-day-title"><header><span class="eyebrow">TAGESDETAIL</span><h3 id="schedule-day-title">${esc(fullDay.format(selectedDate))}</h3><p>${selectedOrders.length?`${selectedOrders.length} ${selectedOrders.length===1?'Termin':'Termine'} · ${durationText(selectedMinutes)}`:'Keine Termine eingeplant'}</p></header><div class="schedule-day-list">${selectedOrders.length?selectedOrders.map(dayEvent).join(''):`<div class="schedule-empty"><strong>Der Tag ist noch frei.</strong><p>Bestehende Aufträge bleiben unverändert. Eine neue Buchung erstellst du über die Vor-Ort-App.</p><a class="button" href="/vor-ort#buchung">Sofort buchen</a></div>`}</div><footer><span class="schedule-connection">${esc(connectionLabel)}</span><a href="/api/calendar.ics${synthetic?'?test=true':''}" download>Kalenderdatei exportieren →</a></footer></aside></div></section>`;
}

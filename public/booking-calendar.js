const bookingEscape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const bookingDayFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
const bookingDateFormatter=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',weekday:'long',day:'numeric',month:'long',year:'numeric'});
const bookingTimeFormatter=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',hour:'2-digit',minute:'2-digit'});
const bookingLocalFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
let selectedBookingDay='';

function bookingMonthRange(offset){
  const today=bookingDayFormatter.format(new Date()),base=new Date(today+'T12:00:00Z');
  const first=new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+offset,1,12));
  const after=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,1,12));
  return {from:first.toISOString().slice(0,10),to:after.toISOString().slice(0,10),label:new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',month:'long',year:'numeric'}).format(first),today,offset:(first.getUTCDay()+6)%7};
}

export function bookingCalendarHTML({synthetic=false,offset=0}={}){
  const range=bookingMonthRange(offset);
  return `<section id="booking-calendar" data-from="${range.from}" data-to="${range.to}" data-synthetic="${synthetic}" data-offset="${range.offset}"><div class="monthtitle"><h2>${bookingEscape(range.label)}</h2><div class="actions"><button data-click="prevMonth" aria-label="Vorheriger Monat">←</button><button data-click="today">Heute</button><button data-click="nextMonth" aria-label="Nächster Monat">→</button></div></div><p class="hint">Kundenbuchung: 08:30–18:00 Uhr · Europe/Berlin. Die vollständige Dienstleistung muss in eine freie Zeit passen. Wochenenden benötigen deine ausdrückliche Freigabe. Manuelle Termine und Blockierungen bleiben für Kunden anonym.</p><div class="booking-calendar-legend"><span class="badge good">Freie Zeit</span><span class="badge warn">Belegt / blockiert</span><span class="badge">Gesperrt</span></div><div data-booking-month aria-live="polite">Kalender wird geladen …</div><div data-booking-day-panel></div><p class="error" data-booking-error role="alert"></p></section>`;
}

function bookingClockRange(window){return bookingTimeFormatter.format(new Date(window.start))+'–'+bookingTimeFormatter.format(new Date(window.end));}
function bookingLocalValue(value){return bookingLocalFormatter.format(new Date(value)).replace(' ','T');}
function bookingDayOverlap(entry,day){return bookingDayFormatter.format(new Date(entry.start))<=day&&bookingDayFormatter.format(new Date(Date.parse(entry.end)-1))>=day;}

export async function mountBookingCalendar(host,{api}){
  if(!host||host.dataset.mounted==='true')return;
  host.dataset.mounted='true';
  let data=null,editing=null,deleting='';
  const error=host.querySelector('[data-booking-error]');
  const scope=host.dataset.synthetic==='true';
  const display=()=>{
    if(!host.isConnected||!data)return;
    if(!data.days.some(day=>day.day===selectedBookingDay))selectedBookingDay=data.days.find(day=>day.day===bookingDayFormatter.format(new Date()))?.day??data.days[0].day;
    host.querySelector('[data-booking-month]').innerHTML=`<div class="calendar-grid booking-month-grid">${['Mo','Di','Mi','Do','Fr','Sa','So'].map(day=>`<div class="eyebrow">${day}</div>`).join('')}${Array.from({length:Number(host.dataset.offset)},()=>'<div class="calendar-cell" aria-hidden="true"></div>').join('')}${data.days.map(day=>`<button type="button" data-booking-day="${day.day}" class="calendar-cell booking-day-cell ${day.day===selectedBookingDay?'selected':''} ${day.closed?'closed':''}" aria-pressed="${day.day===selectedBookingDay}" aria-label="${bookingEscape(bookingDateFormatter.format(new Date(day.day+'T12:00:00Z')))}: ${day.closed?'gesperrt':day.free.length?'freie Zeit '+day.free.map(bookingClockRange).join(', '):'ausgebucht'}, ${day.busy.length} Belegungen"><strong>${Number(day.day.slice(-2))}</strong>${day.busy.length?`<span class="booking-occupied">${day.busy.length} belegt</span>`:''}<span class="booking-free">${day.closed?'Gesperrt':day.free.length?day.free.map(bookingClockRange).join(', '):'Ausgebucht'}</span><span class="booking-mobile-status ${day.closed?'':day.busy.length||!day.free.length?'booked':'available'}" aria-hidden="true">${day.closed?'Gesperrt':day.busy.length||!day.free.length?'Belegt':'Frei'}</span></button>`).join('')}</div>`;
    const day=data.days.find(value=>value.day===selectedBookingDay),entries=data.entries.filter(entry=>bookingDayOverlap(entry,day.day)),appointments=data.appointments.filter(entry=>bookingDayOverlap(entry,day.day));
    const row=editing??{kind:'appointment',title:'',note:'',start:day.day+'T08:30',end:day.day+'T09:30'};
    const rule=data.rules.find(value=>value.day===day.day),windows=(rule?.windows??[]).map(bookingClockRange).join('\n');
    host.querySelector('[data-booking-day-panel]').innerHTML=`<section class="card sectiongap booking-day-detail"><div class="card-body"><h2>${bookingEscape(bookingDateFormatter.format(new Date(day.day+'T12:00:00Z')))}</h2><p>${day.closed?'Für Kundenbuchungen gesperrt.':day.free.length?'Freie Zeit: '+bookingEscape(day.free.map(bookingClockRange).join(', ')):'Keine freie Buchungszeit.'}</p><div class="booking-day-events">${appointments.map(entry=>`<div class="calendar-item"><strong>${bookingEscape(bookingClockRange(entry))} · ${bookingEscape(entry.wg)}</strong><span>${bookingEscape(entry.name)} · ${bookingEscape(entry.vehicle)}</span><button class="smallbtn" data-order="${bookingEscape(entry.id)}">Auftrag öffnen</button></div>`).join('')}${entries.map(entry=>`<div class="calendar-item"><strong>${bookingEscape(bookingClockRange(entry))} · ${entry.kind==='block'?'Blockierung':'Manueller Termin'}</strong><span>${bookingEscape(entry.title)}</span>${entry.note?`<p>${bookingEscape(entry.note)}</p>`:''}<small>${bookingEscape(bookingLocalValue(entry.start))} bis ${bookingEscape(bookingLocalValue(entry.end))}</small><div class="actions"><button type="button" class="smallbtn" data-booking-edit="${bookingEscape(entry.id)}">Bearbeiten</button><button type="button" class="smallbtn danger" data-booking-delete="${bookingEscape(entry.id)}">${deleting===entry.id?'Löschen bestätigen':'Löschen'}</button>${deleting===entry.id?'<button type="button" class="smallbtn" data-booking-cancel-delete>Abbrechen</button>':''}</div></div>`).join('')}${!entries.length&&!appointments.length?'<p class="hint">Keine Belegungen an diesem Tag.</p>':''}</div><form data-booking-entry class="formsection"><h3>${editing?'Eintrag bearbeiten':'Termin oder Blockierung anlegen'}</h3><p class="hint">Ohne Kundenkonto und ohne Kundennachricht. Titel und Notiz sind nur für dich sichtbar.</p><div class="grid2"><label>Art<select name="kind"><option value="appointment" ${row.kind==='appointment'?'selected':''}>Manueller Termin</option><option value="block" ${row.kind==='block'?'selected':''}>Zeitblockierung</option></select></label><label>Titel<input name="title" maxlength="180" value="${bookingEscape(row.title)}" required></label></div><div class="grid2"><label>Beginn · Europe/Berlin<input name="start" type="datetime-local" value="${bookingEscape(editing?bookingLocalValue(row.start):row.start)}" required></label><label>Ende · Europe/Berlin<input name="end" type="datetime-local" value="${bookingEscape(editing?bookingLocalValue(row.end):row.end)}" required></label></div><label>Private Notiz<textarea name="note" maxlength="2000">${bookingEscape(row.note)}</textarea></label><div class="actions"><button type="submit" class="primary">${editing?'Änderung speichern':'Eintrag speichern'}</button>${editing?'<button type="button" data-booking-cancel-edit>Abbrechen</button>':''}</div></form>${day.weekend?`<form data-booking-rule class="formsection"><h3>Wochenendfreigabe</h3><p class="hint">Gilt nur für diesen Tag. Bereits verbindlich vereinbarte Termine bleiben beim Sperren erhalten.</p><label>Freigegebene Zeitfenster<textarea name="windows" placeholder="08:30–12:00\n13:00–18:00">${bookingEscape(windows)}</textarea></label><p class="hint">Ein Zeitraum pro Zeile, innerhalb 08:30–18:00 Uhr. Leere Angaben sperren den Tag.</p><div class="actions"><button type="submit" class="primary">Zeitfenster speichern</button><button type="button" data-booking-release>08:30–18:00 freigeben</button><button type="button" class="danger" data-booking-lock>Tag wieder sperren</button></div></form>`:''}</div></section>`;
  };
  const load=async()=>{data=await api('calendar/month?from='+host.dataset.from+'&to='+host.dataset.to+(scope?'&test=true':''));display();};
  const mutate=async(input)=>{error.textContent='';await api('calendar/action',{...input,synthetic:scope});editing=null;deleting='';await load();};
  host.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||!host.contains(button))return;
    try{
      if(button.dataset.bookingDay){selectedBookingDay=button.dataset.bookingDay;editing=null;deleting='';display();return;}
      if(button.dataset.bookingEdit){editing=data.entries.find(entry=>entry.id===button.dataset.bookingEdit);display();return;}
      if(button.hasAttribute('data-booking-cancel-edit')){editing=null;display();return;}
      if(button.hasAttribute('data-booking-cancel-delete')){deleting='';display();return;}
      if(button.dataset.bookingDelete){const entry=data.entries.find(value=>value.id===button.dataset.bookingDelete);if(deleting!==entry.id){deleting=entry.id;display();return;}button.disabled=true;await mutate({action:'deleteEntry',id:entry.id,version:entry.version});return;}
      if(button.hasAttribute('data-booking-release')||button.hasAttribute('data-booking-lock')){button.disabled=true;const rule=data.rules.find(value=>value.day===selectedBookingDay);await mutate({action:'setDayRule',day:selectedBookingDay,version:rule?.version??0,windows:button.hasAttribute('data-booking-release')?[{start:'08:30',end:'18:00'}]:[]});}
    }catch(reason){error.textContent=reason.message;button.disabled=false;}
  });
  host.addEventListener('submit',async event=>{
    if(!event.target.matches('[data-booking-entry],[data-booking-rule]'))return;
    event.preventDefault();event.stopPropagation();const form=event.target,submit=form.querySelector('[type="submit"]');submit.disabled=true;
    try{
      const values=Object.fromEntries(new FormData(form));
      if(form.hasAttribute('data-booking-entry'))await mutate({action:'saveEntry',...values,...(editing?{id:editing.id,version:editing.version}:{})});
      else{
        const windows=String(values.windows).split(/[\n,]+/).map(value=>value.trim()).filter(Boolean).map(value=>{const match=value.match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);if(!match)throw Error('Bitte Zeitfenster im Format 08:30–12:00 angeben.');return {start:match[1],end:match[2]};});
        const rule=data.rules.find(value=>value.day===selectedBookingDay);await mutate({action:'setDayRule',day:selectedBookingDay,version:rule?.version??0,windows});
      }
    }catch(reason){error.textContent=reason.message;submit.disabled=false;}
  });
  try{await load();}catch(reason){if(host.isConnected){host.querySelector('[data-booking-month]').textContent='Kalender konnte nicht geladen werden.';error.textContent=reason.message;}}
}

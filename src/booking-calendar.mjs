export const BOOKING_ZONE='Europe/Berlin';
export const BOOKING_START=510;
export const BOOKING_END=1080;
const bookingPartsFormatter=new Intl.DateTimeFormat('sv-SE',{timeZone:BOOKING_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

export function bookingLocalParts(value){
  const date=new Date(value);
  if(!Number.isFinite(+date))return null;
  const parts=Object.fromEntries(bookingPartsFormatter.formatToParts(date).map(part=>[part.type,part.value]));
  return {day:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute,minute:Number(parts.hour)*60+Number(parts.minute)};
}

export function bookingDayValid(day){
  return typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
}

export function bookingWeekend(day){
  return bookingDayValid(day)&&[0,6].includes(new Date(day+'T12:00:00Z').getUTCDay());
}

export function bookingWindowError(appointment){
  const start=bookingLocalParts(appointment?.start),end=bookingLocalParts(appointment?.end);
  if(!start||!end||Date.parse(appointment.end)<=Date.parse(appointment.start))return 'Der vollständige Terminzeitraum fehlt oder ist ungültig.';
  if(start.day!==end.day||start.minute<BOOKING_START||end.minute>BOOKING_END)return 'Die vollständige Dienstleistung muss zwischen 08:30 und 18:00 Uhr in Europe/Berlin liegen.';
  return '';
}

export function bookingCalendarMetadata(appointment){
  const start=bookingLocalParts(appointment.start),end=bookingLocalParts(appointment.end);
  return {calendarDay:start.day,calendarStartMinute:start.minute,calendarEndMinute:end.minute};
}

export function bookingFreeRanges(windows,busy,now){
  let free=windows.map(window=>({start:window.start,end:window.end}));
  for(const occupied of busy){
    const next=[];
    for(const window of free){
      if(Date.parse(occupied.start)>=Date.parse(window.end)||Date.parse(occupied.end)<=Date.parse(window.start)){next.push(window);continue;}
      if(Date.parse(occupied.start)>Date.parse(window.start))next.push({start:window.start,end:occupied.start});
      if(Date.parse(occupied.end)<Date.parse(window.end))next.push({start:occupied.end,end:window.end});
    }
    free=next;
  }
  if(now)free=free.filter(window=>Date.parse(window.end)>Date.parse(now)).map(window=>({...window,start:Date.parse(window.start)<Date.parse(now)?new Date(now).toISOString():window.start}));
  return free.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
}

import {need} from './domain.mjs';

const calendarText=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const calendarDate=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function foldCalendarLine(line){const lines=[];let part='';let size=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(size+bytes>75){lines.push(part);part=' ';size=1;}part+=char;size+=bytes;}lines.push(part);return lines.join('\r\n');}

export function calendarExport(orders,at=new Date().toISOString()){
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//White Gloss//Mein Panel//DE','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:White Gloss Termine'];
  for(const o of orders){
    if(!o.appointment||!o.acceptance||!['Termin verbindlich','In Arbeit','Erledigt','Bezahlt'].includes(o.status))continue;
    need(Number.isFinite(Date.parse(o.appointment.start))&&Date.parse(o.appointment.end)>Date.parse(o.appointment.start),'Gespeicherter Termin ist unvollständig.',409);
    lines.push('BEGIN:VEVENT','UID:'+calendarText(o.id)+'@white-gloss-panel','DTSTAMP:'+calendarDate(at),'SEQUENCE:'+o.version,'DTSTART:'+calendarDate(o.appointment.start),'DTEND:'+calendarDate(o.appointment.end),'SUMMARY:'+calendarText(o.wg+' · '+o.source.name+' · '+o.source.vehicle),'LOCATION:'+calendarText(o.appointment.location),'DESCRIPTION:'+calendarText(o.appointment.delivery+'\n'+(o.offer?.services??'')),'STATUS:CONFIRMED','END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(foldCalendarLine).join('\r\n')+'\r\n';
}

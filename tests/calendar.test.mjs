import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarExport} from '../src/calendar.mjs';
const appointment={start:'2026-10-25T00:30:00.000Z',end:'2026-10-25T02:30:00.000Z',delivery:'Abholung',location:'Straße, Ort'};
const order={id:'test',wg:'TEST-1',version:4,status:'Termin verbindlich',source:{name:'Test\nBEGIN:VEVENT',vehicle:'Fahrzeug'},acceptance:{at:'test'},appointment,offer:{services:'Pflege; Glas'}};
test('calendar export preserves UTC time across DST and escapes injected lines',()=>{const out=calendarExport([order],'2026-10-02T12:00:00Z');assert.match(out,/DTSTART:20261025T003000Z/);assert.match(out,/DTEND:20261025T023000Z/);assert.match(out,/SEQUENCE:4/);assert.equal(out.split('\r\n').filter(x=>x==='BEGIN:VEVENT').length,1);assert.match(out,/LOCATION:Straße\\, Ort/);assert.match(out,/Pflege\\; Glas/);});
test('wishes, unaccepted and cancelled appointments never export as confirmed',()=>{const out=calendarExport([{...order,status:'Storniert'},{...order,acceptance:null},{...order,status:'Angebot offen'}]);assert.ok(!out.includes('BEGIN:VEVENT'));});
test('calendar folds UTF-8 lines without breaking characters or exceeding 75 bytes',()=>{const out=calendarExport([{...order,source:{...order.source,name:'Ä'.repeat(160)}}]);for(const line of out.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);assert.ok(!out.includes('�'));});

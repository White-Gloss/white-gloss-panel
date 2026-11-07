import test from 'node:test';import assert from 'node:assert/strict';
import {hoursToMinutes} from '../public/appointment-hours.js';
import {transition} from '../src/domain.mjs';
test('hours accept half and individual hours with German comma without rounding silently',()=>{assert.equal(hoursToMinutes('3,5'),210);assert.equal(hoursToMinutes('0.5'),30);assert.equal(hoursToMinutes('1,25'),75);assert.equal(hoursToMinutes('4,1'),246);assert.throws(()=>hoursToMinutes('0'));assert.throws(()=>hoursToMinutes('1.001'));});
test('duration is elapsed time across Berlin daylight saving transition',()=>{const o=transition({status:'Preise prüfen',source:{}},'appointment',{start:'2027-03-28T01:30',duration:hoursToMinutes('2'),delivery:'Kunde bringt'});assert.equal(o.appointment.start,'2027-03-28T00:30:00.000Z');assert.equal(o.appointment.end,'2027-03-28T02:30:00.000Z');});

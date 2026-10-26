import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOperations} from '../public/operations.mjs';

const now = new Date('2026-10-27T00:00:00.000Z');
const order = (id, extra = {}) => ({id, wg: 'WG-' + id, source: {name: 'Kunde ' + id}, status: 'Termin verbindlich', ...extra});

test('operations agenda combines appointments, care follow-ups and invoice due dates without new writes', () => {
  const orders = [
    order('1', {appointment: {start: '2026-10-27T08:00:00.000Z', end: '2026-10-27T10:30:00.000Z', duration: 150, confirmation: {at: '2026-10-20T08:00:00.000Z'}}}),
    order('2', {status: 'Angenommen', appointment: {start: '2026-10-28T08:00:00.000Z', duration: 120}, notes: [{at: '2026-10-20T10:00:00.000Z', note: 'Rückruf', followUp: '2026-10-27'}]}),
    order('3', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-10-26', totalCents: 34900}}),
  ];
  const before = JSON.stringify(orders), model = buildOperations(orders, now);
  assert.equal(JSON.stringify(orders), before);
  assert.equal(model.today, '2026-10-27');
  assert.equal(model.lastDay, '2026-11-02');
  assert.deepEqual(model.summary, {todayAppointments: 1, todayMinutes: 150, proposedAppointments: 1, followUpsDue: 1, overdueInvoiceCents: 34900});
  assert.deepEqual(model.days.map(group => group.day), ['2026-10-27', '2026-10-28']);
  assert.deepEqual(model.days[0].items.map(item => item.kind), ['appointment', 'followup']);
  assert.equal(model.overdue[0].kind, 'invoice');
});

test('operations separates overdue follow-ups and never treats unpaid invoices as cash', () => {
  const model = buildOperations([
    order('1', {status: 'Erledigt', notes: [{note: 'Nachfassen', followUp: '2026-10-25'}]}),
    order('2', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-10-01', totalCents: 12000}}),
    order('3', {status: 'Bezahlt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-10-01', totalCents: 99000}}),
  ], now);
  assert.equal(model.summary.followUpsDue, 1);
  assert.equal(model.summary.overdueInvoiceCents, 12000);
  assert.deepEqual(model.overdue.map(item => item.kind), ['invoice', 'followup']);
});

test('operations ignores invalid or out-of-range dates and derives missing durations conservatively', () => {
  const model = buildOperations([
    order('1', {appointment: {start: '2026-10-27T08:00:00.000Z', end: '2026-10-27T09:00:00.000Z'}}),
    order('2', {appointment: {start: '2026-11-03T08:00:00.000Z'}}),
    order('3', {appointment: {start: 'not-a-date'}, notes: [{followUp: '2026-02-31'}]}),
    order('4', {status: 'Storniert', appointment: {start: '2026-10-27T12:00:00.000Z'}}),
  ], now);
  assert.equal(model.upcoming.length, 1);
  assert.equal(model.summary.todayMinutes, 60);
  assert.equal(model.overdue.length, 0);
});

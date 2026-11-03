import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActionCenter,monthPayments,sortByUrgency} from '../public/action-center.mjs';

// 03.11.2026, 10:00 in Europe/Berlin.
const now = new Date('2026-11-03T09:00:00.000Z');
const order = (id, extra = {}) => ({id, wg: 'WG-' + id, synthetic: false, source: {name: 'Kunde ' + id, vehicle: 'Auto ' + id}, status: 'Angenommen', createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', ...extra});
const kinds = model => model.items.map(item => item.kind);
const find = (model, kind, orderId) => model.items.find(item => item.kind === kind && (!orderId || item.orderId === orderId));

test('overdue invoices, follow-ups and missed appointments are marked overdue and open the matching tab', () => {
  const model = buildActionCenter([
    order('1', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'unpaid', number: 'WG-1', dueDate: '2026-10-30', totalCents: 34900}}),
    order('2', {notes: [{at: '2026-10-20T10:00:00.000Z', note: 'Rückruf Lack', followUp: '2026-11-01'}]}),
    order('3', {status: 'Termin verbindlich', appointment: {start: '2026-11-02T08:00:00.000Z', end: '2026-11-02T10:00:00.000Z', confirmation: {at: '2026-10-30T08:00:00.000Z'}}}),
  ], now);
  const invoice = find(model, 'invoice-overdue', '1'), followup = find(model, 'followup', '2'), missed = find(model, 'appointment-missed', '3');
  assert.deepEqual([invoice.level, invoice.tab], ['overdue', 'payment']);
  assert.match(invoice.detail, /WG-1 · 349,00\s€ · fällig seit 30\.10\.2026/);
  assert.deepEqual([followup.level, followup.tab, followup.detail], ['overdue', 'notes', 'Rückruf Lack']);
  assert.deepEqual([missed.level, missed.tab], ['overdue', 'intake']);
  assert.deepEqual(model.counts, {overdue: 3, today: 0, waiting: 0});
});

test('today items cover appointments, price checks, missing invoices, expiring offers and due follow-ups', () => {
  const model = buildActionCenter([
    order('1', {status: 'Termin verbindlich', appointment: {start: '2026-11-03T13:00:00.000Z', end: '2026-11-03T15:00:00.000Z', confirmation: {at: '2026-11-01T08:00:00.000Z'}}}),
    order('2', {status: 'In Arbeit', appointment: {start: '2026-11-03T07:00:00.000Z', end: '2026-11-03T16:00:00.000Z', confirmation: {at: '2026-11-01T08:00:00.000Z'}}}),
    order('3', {status: 'Preise prüfen'}),
    order('4', {status: 'Erledigt', completedAt: '2026-11-02T16:00:00.000Z'}),
    order('5', {status: 'Angebot offen', offer: {totalCents: 1000, expiresAt: '2026-11-04T20:00:00.000Z'}}),
    order('6', {notes: [{at: '2026-11-01T10:00:00.000Z', note: '', followUp: '2026-11-03'}]}),
  ], now);
  assert.deepEqual(model.counts, {overdue: 0, today: 6, waiting: 0});
  assert.equal(find(model, 'appointment-today', '1').tab, 'intake');
  assert.match(find(model, 'appointment-today', '1').detail, /^14:00 · Auto 1$/);
  assert.equal(find(model, 'appointment-today', '2').tab, 'return');
  assert.equal(find(model, 'price-check', '3').tab, 'price');
  assert.equal(find(model, 'invoice-missing', '4').tab, 'payment');
  assert.equal(find(model, 'offer-expiring', '5').tab, 'price');
  assert.match(find(model, 'offer-expiring', '5').detail, /04\.11\.2026, 21:00/);
  assert.equal(find(model, 'followup', '6').detail, 'Wiedervorlage ohne Notiz');
});

test('waiting items show open customer signatures and unconfirmed appointment proposals', () => {
  const model = buildActionCenter([
    order('1', {status: 'Angebot offen', pending: {offer: {content: {}}}}),
    order('2', {status: 'In Arbeit', pending: {return: {content: {}}}}),
    order('3', {appointment: {start: '2026-11-06T08:00:00.000Z', end: '2026-11-06T10:00:00.000Z'}}),
    order('4', {appointment: {start: '2026-11-01T08:00:00.000Z', end: '2026-11-01T10:00:00.000Z'}}),
    order('5', {appointment: {start: '2026-11-03T12:00:00.000Z', end: '2026-11-03T13:00:00.000Z'}}),
  ], now);
  assert.deepEqual([find(model, 'signature', '1').level, find(model, 'signature', '1').tab, find(model, 'signature', '1').label], ['waiting', 'price', 'Unterschrift offen · Angebot']);
  assert.deepEqual([find(model, 'signature', '2').tab, find(model, 'signature', '2').label], ['return', 'Unterschrift offen · Rückgabeprotokoll']);
  assert.deepEqual([find(model, 'appointment-unconfirmed', '3').level, find(model, 'appointment-unconfirmed', '3').tab], ['waiting', 'price']);
  assert.equal(find(model, 'appointment-unconfirmed', '4').level, 'overdue');
  const proposedToday = find(model, 'appointment-today', '5');
  assert.deepEqual([proposedToday.level, proposedToday.tab, proposedToday.label], ['today', 'price', 'Terminvorschlag heute · unbestätigt']);
  assert.equal(find(model, 'appointment-unconfirmed', '5'), undefined, 'a proposal for today appears only once');
});

test('closed, paid, invoiced, future and distant entries do not create work', () => {
  const model = buildActionCenter([
    order('1', {status: 'Abgelehnt', pending: {offer: {content: {}}}}),
    order('2', {status: 'Bezahlt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-10-01', totalCents: 5000}}),
    order('3', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-11-08', totalCents: 5000}}),
    order('4', {notes: [{at: '2026-11-01T10:00:00.000Z', note: 'Später', followUp: '2026-11-10'}]}),
    order('5', {status: 'Angebot offen', offer: {totalCents: 1000, expiresAt: '2026-11-09T09:00:00.000Z'}}),
    order('6', {status: 'Storniert', appointment: {start: '2026-11-03T12:00:00.000Z', end: '2026-11-03T13:00:00.000Z'}}),
    order('7', {status: 'Preise prüfen', notes: [{note: 'Ungültig', followUp: 'bald'}]}),
  ], now);
  assert.deepEqual(kinds(model), ['price-check', 'offer-waiting']);
  assert.equal(find(model, 'offer-waiting', '5').level, 'waiting');
});

test('items are sorted overdue first, then today, then waiting, and oldest first inside a level', () => {
  const model = buildActionCenter([
    order('1', {status: 'Angebot offen', pending: {offer: {content: {}}}}),
    order('2', {status: 'Preise prüfen', createdAt: '2026-11-02T08:00:00.000Z'}),
    order('3', {notes: [{note: 'Spät', followUp: '2026-11-02'}]}),
    order('4', {notes: [{note: 'Früh', followUp: '2026-10-28'}]}),
    order('5', {status: 'Preise prüfen', createdAt: '2026-10-29T08:00:00.000Z'}),
  ], now);
  assert.deepEqual(model.items.map(item => item.orderId), ['4', '3', '5', '2', '1']);
});

test('portal requests and unread chats from the existing endpoints join the list without mixing the test area', () => {
  const requests = [
    {id: 'r1', orderId: '1', wg: 'WG-1', name: 'Kunde 1', kind: 'extras', status: 'offen', createdAt: '2026-11-02T08:00:00.000Z', synthetic: false, extras: [{name: 'Lederpflege'}]},
    {id: 'r2', orderId: '2', wg: 'WG-2', name: 'Kunde 2', kind: 'details', status: 'offen', createdAt: '2026-11-02T09:00:00.000Z', synthetic: false, wish: 'Neue Adresse'},
    {id: 'r3', orderId: '3', wg: 'WG-3', name: 'Test', kind: 'termin', status: 'offen', createdAt: '2026-11-02T09:00:00.000Z', synthetic: true, wish: 'Freitag'},
  ];
  const model = buildActionCenter([], now, {portalRequests: requests, unreadChats: 3});
  assert.deepEqual(kinds(model), ['chat', 'portal-request', 'portal-request']);
  const chat = model.items[0];
  assert.deepEqual([chat.view, chat.orderId, chat.level, chat.title], ['chat', null, 'today', '3 neue Kundennachrichten']);
  assert.deepEqual(model.items.slice(1).map(item => [item.orderId, item.tab, item.label]), [['1', 'price', 'Kundenwunsch · Zusatzleistungen'], ['2', 'source', 'Kundenwunsch · Angaben korrigieren']]);
  assert.match(model.items[1].detail, /Lederpflege/);
  const test = buildActionCenter([], now, {portalRequests: requests, unreadChats: 0, synthetic: true});
  assert.deepEqual(test.items.map(item => [item.orderId, item.label]), [['3', 'Kundenwunsch · Termin']]);
});

test('the Berlin calendar day decides what is due, also shortly after midnight', () => {
  const lateEvening = new Date('2026-11-03T23:30:00.000Z');
  const model = buildActionCenter([order('1', {notes: [{note: 'Anrufen', followUp: '2026-11-04'}]})], lateEvening);
  assert.equal(model.today, '2026-11-04');
  assert.equal(find(model, 'followup', '1').level, 'today');
});

test('building the action center never changes the orders', () => {
  const orders = [order('1', {status: 'Preise prüfen', notes: [{note: 'x', followUp: '2026-11-01'}]})];
  const before = JSON.stringify(orders);
  buildActionCenter(orders, now, {portalRequests: [], unreadChats: 1});
  sortByUrgency(orders, buildActionCenter(orders, now).items);
  monthPayments(orders, now);
  assert.equal(JSON.stringify(orders), before);
});

test('month payments count only active payments of the current Berlin month', () => {
  const result = monthPayments([
    order('1', {payments: [{amountCents: 10000, at: '2026-11-02T10:00:00.000Z'}, {amountCents: 5000, at: '2026-10-31T23:30:00.000Z'}]}),
    order('2', {payments: [{amountCents: 7000, at: '2026-11-01T10:00:00.000Z', cancelledAt: '2026-11-01T11:00:00.000Z'}, {amountCents: 9000, at: '2026-10-31T22:30:00.000Z'}]}),
    order('3'),
  ], now);
  assert.deepEqual(result, {month: '2026-11', label: 'November 2026', cents: 15000});
});

test('work queue is ordered by urgency instead of the last change', () => {
  const orders = [
    order('1', {status: 'Angebot offen', updatedAt: '2026-11-03T08:00:00.000Z'}),
    order('2', {status: 'Erledigt', updatedAt: '2026-10-01T08:00:00.000Z', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-10-20', totalCents: 100}}),
    order('3', {status: 'Preise prüfen', updatedAt: '2026-11-02T08:00:00.000Z'}),
    order('4', {status: 'In Arbeit', updatedAt: '2026-10-02T08:00:00.000Z'}),
    order('5', {status: 'Termin verbindlich', updatedAt: '2026-10-03T08:00:00.000Z'}),
  ];
  const sorted = sortByUrgency(orders, buildActionCenter(orders, now).items);
  assert.deepEqual(sorted.map(item => item.id), ['2', '3', '4', '5', '1']);
  assert.notEqual(sorted, orders);
});

test('date-shaped but impossible dates never break the overview', () => {
  const model = buildActionCenter([
    order('1', {notes: [{note: 'Kaputt', followUp: '2026-13-01'}, {note: 'Auch kaputt', followUp: '2026-02-30'}]}),
    order('2', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'unpaid', dueDate: '2026-00-10', totalCents: 100}}),
  ], now);
  assert.deepEqual(model.items, []);
});

test('appointment proposals before acceptance appear and open Angebot & Termin', () => {
  const model = buildActionCenter([
    order('1', {status: 'Preise prüfen', appointment: {start: '2026-11-03T12:00:00.000Z', end: '2026-11-03T13:00:00.000Z'}}),
    order('2', {status: 'Angebot offen', offer: {totalCents: 1000, expiresAt: '2026-11-20T09:00:00.000Z'}, appointment: {start: '2026-11-01T12:00:00.000Z', end: '2026-11-01T13:00:00.000Z'}}),
  ], now);
  const today = find(model, 'appointment-today', '1'), past = find(model, 'appointment-unconfirmed', '2');
  assert.deepEqual([today.level, today.tab, today.label], ['today', 'price', 'Terminvorschlag heute · unbestätigt']);
  assert.deepEqual([past.level, past.tab], ['overdue', 'price']);
});

test('a cancelled invoice of a finished order asks for a new invoice', () => {
  const model = buildActionCenter([order('1', {status: 'Erledigt', invoice: {provider: 'qonto', status: 'canceled', number: 'WG-1', totalCents: 100}})], now);
  const missing = find(model, 'invoice-missing', '1');
  assert.deepEqual([missing.level, missing.tab, missing.label], ['today', 'payment', 'Neue Rechnung ausstellen']);
});

test('open offers without a signature request wait for the customer exactly once', () => {
  const model = buildActionCenter([
    order('1', {status: 'Angebot offen', offer: {totalCents: 1000, createdAt: '2026-11-01T08:00:00.000Z', expiresAt: '2026-11-15T08:00:00.000Z'}}),
    order('2', {status: 'Angebot offen', offer: {totalCents: 1000, expiresAt: '2026-11-04T08:00:00.000Z'}}),
    order('3', {status: 'Angebot offen', offer: {totalCents: 1000, expiresAt: '2026-11-15T08:00:00.000Z'}, pending: {offer: {createdAt: '2026-11-02T08:00:00.000Z'}}}),
  ], now);
  assert.deepEqual(model.items.filter(item => item.orderId === '1').map(item => [item.kind, item.level, item.tab]), [['offer-waiting', 'waiting', 'price']]);
  assert.deepEqual(model.items.filter(item => item.orderId === '2').map(item => item.kind), ['offer-expiring']);
  assert.deepEqual(model.items.filter(item => item.orderId === '3').map(item => item.kind), ['signature']);
});

test('signature requests are ordered by the age of the request, not by the last order change', () => {
  const model = buildActionCenter([
    order('1', {status: 'In Arbeit', updatedAt: '2026-11-03T08:00:00.000Z', pending: {return: {createdAt: '2026-10-20T08:00:00.000Z', linked: true}}}),
    order('2', {status: 'In Arbeit', updatedAt: '2026-10-01T08:00:00.000Z', pending: {return: {createdAt: '2026-11-02T08:00:00.000Z', linked: true}}}),
  ], now);
  assert.deepEqual(model.items.map(item => item.orderId), ['1', '2']);
});

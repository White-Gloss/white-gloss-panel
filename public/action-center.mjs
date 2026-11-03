// Read-only work list for the overview. It only combines data that the panel already has.
// No booking, message, invoice, status change or provider call is triggered here.
const berlinDay = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'});
const berlinTime = new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const monthName = new Intl.DateTimeFormat('de-DE', {timeZone: 'UTC', month: 'long', year: 'numeric'});
const euro = new Intl.NumberFormat('de-DE', {style: 'currency', currency: 'EUR'});

const LEVELS = ['overdue', 'today', 'waiting'];
const CLOSED = ['Abgelehnt', 'Storniert', 'Abgelaufen'];
const ACTIVE_APPOINTMENT = ['Preise prüfen', 'Angebot offen', 'Angenommen', 'Termin verbindlich', 'In Arbeit'];
const BEFORE_ACCEPTANCE = ['Preise prüfen', 'Angebot offen'];
const CANCELLED_INVOICE = ['canceled', 'cancelled', 'void', 'voided'];
const SIGNATURES = {offer: ['price', 'Angebot'], intake: ['intake', 'Annahmeprotokoll'], return: ['return', 'Rückgabeprotokoll']};
const REQUESTS = {extras: ['price', 'Zusatzleistungen'], details: ['source', 'Angaben korrigieren']};
const STATUS_PRIORITY = {'In Arbeit': 0, 'Termin verbindlich': 1, 'Preise prüfen': 2, 'Erledigt': 3, 'Angebot offen': 4, 'Angenommen': 5};
const OFFER_WARNING_MS = 48 * 3600000;

const validTime = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = validTime(value + 'T12:00:00Z');
  return time !== null && new Date(time).toISOString().slice(0, 10) === value;
};
const dayOf = value => {
  const time = validTime(value);
  return time === null ? null : berlinDay.format(new Date(time));
};
const germanDay = day => day.slice(8, 10) + '.' + day.slice(5, 7) + '.' + day.slice(0, 4);
const germanDateTime = value => germanDay(dayOf(value)) + ', ' + berlinTime.format(new Date(value));
const money = cents => euro.format((Number.isSafeInteger(cents) ? cents : 0) / 100);
const title = order => (order.wg ?? '') + ' · ' + (order.source?.name || 'Ohne Namen');

function item(order, kind, level, tab, label, detail, sort, key = '') {
  return {id: kind + ':' + order.id + (key ? ':' + key : ''), kind, level, orderId: order.id, view: null, tab, label, title: title(order), detail, sort: sort ?? ''};
}

function orderItems(order, now, today) {
  const out = [], status = order.status, closed = CLOSED.includes(status);
  const invoice = order.invoice;
  if (invoice?.provider === 'qonto' && invoice.status === 'unpaid' && status !== 'Bezahlt' && validDay(invoice.dueDate) && invoice.dueDate < today) {
    out.push(item(order, 'invoice-overdue', 'overdue', 'payment', 'Rechnung überfällig', `${invoice.number || 'Rechnung'} · ${money(invoice.totalCents)} · fällig seit ${germanDay(invoice.dueDate)}`, invoice.dueDate));
  }
  (order.notes ?? []).forEach((note, index) => {
    if (!validDay(note?.followUp) || note.followUp > today) return;
    const overdue = note.followUp < today;
    out.push(item(order, 'followup', overdue ? 'overdue' : 'today', 'notes', overdue ? 'Wiedervorlage überfällig' : 'Wiedervorlage heute', note.note || 'Wiedervorlage ohne Notiz', note.followUp, String(index)));
  });
  if (closed) return out;
  const appointment = order.appointment, start = validTime(appointment?.start), startDay = start === null ? null : dayOf(appointment.start);
  if (start !== null && ACTIVE_APPOINTMENT.includes(status)) {
    const beforeAcceptance = BEFORE_ACCEPTANCE.includes(status), proposed = (beforeAcceptance || status === 'Angenommen') && !appointment.confirmation;
    const when = berlinTime.format(new Date(start)), vehicle = order.source?.vehicle;
    if (startDay === today) {
      const [tab, label] = proposed ? ['price', 'Terminvorschlag heute · unbestätigt'] : beforeAcceptance ? ['price', 'Termin heute · Angebot nicht angenommen'] : status === 'In Arbeit' ? ['return', 'Termin heute · in Arbeit'] : ['intake', 'Termin heute'];
      out.push(item(order, 'appointment-today', 'today', tab, label, [when, vehicle].filter(Boolean).join(' · '), appointment.start));
    } else if (proposed) {
      const past = startDay < today;
      out.push(item(order, 'appointment-unconfirmed', past ? 'overdue' : 'waiting', 'price', past ? 'Terminvorschlag verstrichen · unbestätigt' : 'Terminbestätigung offen', germanDateTime(appointment.start), appointment.start));
    } else if (status === 'Termin verbindlich' && startDay < today) {
      out.push(item(order, 'appointment-missed', 'overdue', 'intake', 'Termin vorbei · Annahme fehlt', germanDateTime(appointment.start), appointment.start));
    }
  }
  if (status === 'Preise prüfen') out.push(item(order, 'price-check', 'today', 'price', 'Preise prüfen', [order.source?.vehicle, order.source?.plate].filter(Boolean).join(' · ') || 'Fahrzeug offen', order.createdAt));
  const cancelled = CANCELLED_INVOICE.includes(invoice?.status);
  if (status === 'Erledigt' && (!invoice || cancelled)) out.push(item(order, 'invoice-missing', 'today', 'payment', cancelled ? 'Neue Rechnung ausstellen' : 'Abrechnen', order.completedAt && validTime(order.completedAt) !== null ? 'Arbeit erledigt am ' + germanDay(dayOf(order.completedAt)) : 'Arbeit erledigt', order.completedAt ?? order.updatedAt));
  const expires = validTime(order.offer?.expiresAt);
  if (status === 'Angebot offen' && expires !== null && expires > now.getTime() && expires - now.getTime() <= OFFER_WARNING_MS) {
    out.push(item(order, 'offer-expiring', 'today', 'price', 'Angebot läuft ab', 'gültig bis ' + germanDateTime(order.offer.expiresAt), order.offer.expiresAt));
  } else if (status === 'Angebot offen' && order.offer && !order.pending?.offer) {
    out.push(item(order, 'offer-waiting', 'waiting', 'price', 'Angebot wartet auf Annahme', expires !== null ? 'gültig bis ' + germanDateTime(order.offer.expiresAt) : 'Wartet auf den Kunden', order.offer.createdAt ?? order.updatedAt));
  }
  for (const key of Object.keys(order.pending ?? {})) {
    if (!SIGNATURES[key]) continue;
    const [tab, label] = SIGNATURES[key];
    out.push(item(order, 'signature', 'waiting', tab, 'Unterschrift offen · ' + label, 'Wartet auf den Kunden', order.pending[key]?.createdAt ?? order.updatedAt, key));
  }
  return out;
}

function requestItems(requests, synthetic) {
  return (requests ?? []).filter(request => request && request.status === 'offen' && request.synthetic === synthetic && request.orderId).map(request => {
    const [tab, label] = REQUESTS[request.kind] ?? ['price', 'Termin'];
    const detail = request.kind === 'extras' ? (request.extras ?? []).map(extra => extra.name).filter(Boolean).join(', ') : request.wish;
    return {id: 'portal-request:' + request.id, kind: 'portal-request', level: 'today', orderId: request.orderId, view: null, tab, label: 'Kundenwunsch · ' + label, title: (request.wg ?? '') + ' · ' + (request.name || 'Ohne Namen'), detail: detail || 'Im Auftrag ansehen', sort: request.createdAt ?? ''};
  });
}

/**
 * Builds the overview work list from existing orders and the optional results of the
 * existing endpoints /api/portal-admin/requests and /api/chats/summary.
 */
export function buildActionCenter(orders, now = new Date(), extras = {}) {
  const today = berlinDay.format(now), synthetic = extras.synthetic === true;
  const items = orders.flatMap(order => orderItems(order, now, today));
  items.push(...requestItems(extras.portalRequests, synthetic));
  const unread = Number.isSafeInteger(extras.unreadChats) ? extras.unreadChats : 0;
  if (unread > 0) items.push({id: 'chat', kind: 'chat', level: 'today', orderId: null, view: 'chat', tab: null, label: 'Nachrichten', title: unread + (unread === 1 ? ' neue Kundennachricht' : ' neue Kundennachrichten'), detail: 'Im Kundenchat antworten', sort: ''});
  items.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || String(a.sort).localeCompare(String(b.sort)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const counts = {overdue: 0, today: 0, waiting: 0};
  for (const entry of items) counts[entry.level]++;
  return {today, items, counts};
}

/** Sum of active payments recorded in the panel during the current Berlin month. */
export function monthPayments(orders, now = new Date()) {
  const month = berlinDay.format(now).slice(0, 7);
  let cents = 0;
  for (const order of orders) for (const payment of order.payments ?? []) {
    if (payment?.cancelledAt || !Number.isSafeInteger(payment?.amountCents) || payment.amountCents <= 0) continue;
    if (dayOf(payment.at)?.slice(0, 7) === month) cents += payment.amountCents;
  }
  return {month, label: monthName.format(new Date(month + '-15T12:00:00Z')), cents};
}

/** Orders with overdue work first, then work for today, then all others by status. Waiting for a customer is no own work. */
export function sortByUrgency(orders, items) {
  const rank = new Map(), own = ['overdue', 'today'];
  for (const entry of items) if (entry.orderId && own.includes(entry.level)) rank.set(entry.orderId, Math.min(rank.get(entry.orderId) ?? own.length, own.indexOf(entry.level)));
  return [...orders].sort((a, b) => (rank.get(a.id) ?? own.length) - (rank.get(b.id) ?? own.length)
    || (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
    || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}

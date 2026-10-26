// Read-only operational planning from existing orders. No new booking, invoice or care workflow.
const berlinDay = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'});
const validDate = value => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
};
const validDay = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = validDate(value + 'T12:00:00Z');
  return parsed?.toISOString().slice(0, 10) === value;
};
const plusDays = (day, amount) => new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
const moneyCents = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const durationMinutes = appointment => {
  if (Number.isFinite(appointment.duration) && appointment.duration > 0) return Math.round(appointment.duration);
  const start = Date.parse(appointment.start), end = Date.parse(appointment.end);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : 0;
};
const kindOrder = {appointment: 0, followup: 1, invoice: 2};
const byDateThenKind = (a, b) => a.day.localeCompare(b.day) || kindOrder[a.kind] - kindOrder[b.kind] || a.sortAt.localeCompare(b.sortAt) || a.order.wg.localeCompare(b.order.wg);

/**
 * Creates a seven-day agenda plus overdue care and invoice items.
 * Scheduled minutes are deliberately not called capacity: staffing and working hours are unknown.
 */
export function buildOperations(orders, now = new Date(), horizonDays = 7) {
  const today = berlinDay.format(now);
  const lastDay = plusDays(today, Math.max(1, horizonDays) - 1);
  const appointments = [], overdue = [], upcoming = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order.wg !== 'string') continue;
    const start = validDate(order.appointment?.start);
    if (start && !['Storniert', 'Abgelehnt'].includes(order.status)) {
      const day = berlinDay.format(start);
      if (day >= today && day <= lastDay) appointments.push({
        kind: 'appointment', day, sortAt: start.toISOString(), order,
        proposed: !order.appointment.confirmation && ['Preise prüfen', 'Angebot offen', 'Angenommen'].includes(order.status),
        minutes: durationMinutes(order.appointment),
      });
    }
    for (const note of Array.isArray(order.notes) ? order.notes : []) {
      if (!validDay(note?.followUp) || note.followUp > lastDay) continue;
      const item = {kind: 'followup', day: note.followUp, sortAt: note.at ?? note.followUp, order, note};
      (note.followUp < today ? overdue : upcoming).push(item);
    }
    if (order.invoice?.provider === 'qonto' && order.invoice.status === 'unpaid' && order.status !== 'Bezahlt' && validDay(order.invoice.dueDate) && order.invoice.dueDate <= lastDay) {
      const item = {kind: 'invoice', day: order.invoice.dueDate, sortAt: order.invoice.dueDate, order, amountCents: moneyCents(order.invoice.totalCents)};
      (order.invoice.dueDate < today ? overdue : upcoming).push(item);
    }
  }
  appointments.sort(byDateThenKind); overdue.sort(byDateThenKind); upcoming.sort(byDateThenKind);
  const allUpcoming = [...appointments, ...upcoming].sort(byDateThenKind);
  const groups = new Map();
  for (const item of allUpcoming) {
    if (!groups.has(item.day)) groups.set(item.day, []);
    groups.get(item.day).push(item);
  }
  const todayAppointments = appointments.filter(item => item.day === today);
  return {
    today, lastDay, overdue, upcoming: allUpcoming,
    days: [...groups].map(([day, items]) => ({day, items})),
    summary: {
      todayAppointments: todayAppointments.length,
      todayMinutes: todayAppointments.reduce((sum, item) => sum + item.minutes, 0),
      proposedAppointments: appointments.filter(item => item.proposed).length,
      followUpsDue: overdue.concat(upcoming).filter(item => item.kind === 'followup' && item.day <= today).length,
      overdueInvoiceCents: overdue.filter(item => item.kind === 'invoice').reduce((sum, item) => sum + item.amountCents, 0),
    },
  };
}

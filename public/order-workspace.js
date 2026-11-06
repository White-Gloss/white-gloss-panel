// Read-only view model: workflow annotations never replace document evidence.
export function orderAreas(order) {
  const pending = order.pending ?? {};
  const documentState = kind => pending[kind] ? 'Unterschrift offen' : order[kind] ? 'Protokoll vorhanden' : 'Kein Protokoll';
  const areas = [
    ['source', 'Kunde & Anfrage', 'Anfrage erfasst'],
    ['price', 'Angebot & Termin', pending.offer ? 'Unterschrift offen' : order.acceptance ? 'Angebot angenommen' : order.offer ? 'Annahme offen' : 'Preise prüfen'],
    ['intake', 'Annahme', documentState('intake')],
    ['return', 'Rückgabe', documentState('return')],
    ['payment', 'Zahlung & Rechnung', order.invoice ? 'Rechnung vorhanden' : 'Keine Rechnung'],
    ['notes', 'Kundenakte & Dokumente', 'Dokumente, Fotos & Verlauf'],
  ];
  return areas.map(([id, label, evidence]) => ({
    id, label, evidence,
    annotation: ({open: 'Wieder geöffnet', completed: 'Manuell erledigt', skipped: 'Übersprungen'})[order.workflow?.[id]?.state] ?? '',
    pending: Boolean(pending[id === 'price' ? 'offer' : id]),
  }));
}

export function orderAppointment(order) {
  if (order.appointment) return {
    label: order.appointment.confirmation ? 'Bestätigter Termin' : 'Terminvorschlag · unbestätigt',
    start: order.appointment.start,
    confirmed: Boolean(order.appointment.confirmation),
    wish: '',
  };
  return {label: 'Noch kein bestätigter Termin', start: null, confirmed: false,
    wish: [order.source?.desiredDate, order.source?.timeWindow].filter(Boolean).join(' · ')};
}

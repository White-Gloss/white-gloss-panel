const HEALTH = [
  ['website', 'Website'],
  ['calendar', 'Google Kalender'],
  ['email', 'E-Mail'],
  ['qonto', 'Qonto'],
  ['customer', 'Kundenannahme'],
  ['background', 'Hintergrundlauf'],
];
const CLOSED = ['Bezahlt', 'Abgelehnt', 'Storniert', 'Abgelaufen'];
const PRIORITY = {'In Arbeit': 0, 'Termin verbindlich': 1, 'Preise prüfen': 2, 'Angebot offen': 3, 'Angenommen': 4};
const dayFormat = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'});
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const nextStep = order => {
  if (order.status === 'Angenommen' && order.appointment && !order.appointment.confirmation) return 'Terminbestätigung abwarten';
  return ({
    'Preise prüfen': 'Fahrzeugzustand und Preise prüfen',
    'Angebot offen': 'Kundenannahme abwarten',
    'Angenommen': 'Termin festlegen',
    'Termin verbindlich': 'Annahmeprotokoll erstellen',
    'In Arbeit': 'Arbeit abschließen und Rückgabe dokumentieren',
    'Erledigt': 'Schlussrechnung und Zahlung',
    'Bezahlt': 'Auftrag abgeschlossen',
  })[order.status] ?? 'Auftrag geschlossen';
};
let request = null;
let scheduled = false;
const enhancedStats = new WeakSet();

async function loadState() {
  if (!request) {
    request = fetch('/api/state', {credentials: 'same-origin'}).then(response => {
      if (!response.ok) throw Error('Betriebsdaten konnten nicht geladen werden.');
      return response.json();
    }).catch(error => {
      request = null;
      throw error;
    });
  }
  return request;
}

function orderList(state, synthetic) {
  const query = (document.querySelector('#search')?.value ?? '').toLowerCase();
  return (state.orders ?? []).filter(order => order.synthetic === synthetic).filter(order =>
    `${order.wg} ${order.source?.name ?? ''} ${order.source?.vehicle ?? ''} ${order.source?.phone ?? ''} ${order.source?.plate ?? ''}`.toLowerCase().includes(query));
}

function focusOrders(open) {
  return [...open].sort((a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9)).slice(0, 4);
}

function focusHTML(focus) {
  if (!focus.length) return '<div class="premium-empty"><strong>Keine kritischen Aufgaben</strong><span>Der Betrieb ist bereit für neue Buchungen.</span></div>';
  return `<div class="focus-list">${focus.map(order => `<div class="focus-row"><i class="focus-dot ${order.status === 'In Arbeit' ? 'active' : order.status === 'Preise prüfen' ? 'warn' : ''}"></i><div><strong>${esc(order.wg)} · ${esc(order.source?.name || 'Ohne Namen')}</strong><span>${esc(nextStep(order))} · ${esc(order.source?.vehicle || 'Fahrzeug offen')}</span></div><button class="smallbtn" data-order="${esc(order.id)}">Öffnen</button></div>`).join('')}</div>`;
}

function integrationsHTML(state) {
  const ready = state.integrationReady ?? {};
  return `<div class="integration-grid">${HEALTH.map(([key, label]) => `<div class="integration-pill ${ready[key] ? 'ok' : 'open'}"><i></i><span>${label}</span><small>${ready[key] ? 'Geprüft' : 'Offen'}</small></div>`).join('')}</div>`;
}

function heroHTML({open, appointments, working, nextAppointment, focus, health}) {
  const statusLine = working ? `${working.wg} · ${working.source?.vehicle ?? 'Fahrzeug'}` : nextAppointment ? `Nächster Termin · ${nextAppointment.source?.vehicle ?? 'Fahrzeug'}` : 'Bereit für deine nächste Anfrage';
  const detail = working ? `${working.source?.name ?? ''} · ${nextStep(working)}` : nextAppointment ? `${new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short'}).format(new Date(nextAppointment.appointment.start))} · ${nextAppointment.source?.name ?? ''}` : 'Keine laufende Arbeit – freie Kapazität für neue Anfragen.';
  const primary = working || nextAppointment ? `data-order="${esc(working?.id ?? nextAppointment?.id)}"` : 'data-click="create"';
  const primaryLabel = working ? 'Aktiven Auftrag öffnen' : nextAppointment ? 'Nächsten Termin öffnen' : 'Auftrag anlegen';
  return `<section class="premium-hero" aria-label="Aktueller Werkstattstatus"><div class="premium-hero-main"><div class="eyebrow">${working ? 'JETZT IN DER WERKSTATT' : 'DEIN BETRIEB · HEUTE'}</div><h2>${esc(statusLine)}</h2><p>${esc(detail)}</p><div class="premium-meta"><span><b>${open.length}</b> offene Aufträge</span><span><b>${appointments.length}</b> kommende Termine</span><span><b>${health}/${HEALTH.length}</b> Verbindungen geprüft</span></div><div class="actions"><button class="premium-primary" ${primary}>${primaryLabel} <span>→</span></button><button class="premium-secondary" data-click="create">+ Neue Anfrage</button></div></div><div class="premium-hero-side"><div class="eyebrow">NÄCHSTE ENTSCHEIDUNG</div><strong>${esc(focus[0] ? nextStep(focus[0]) : 'Betrieb bereit')}</strong><p>${esc(focus[0] ? `${focus[0].wg} · ${focus[0].source?.name ?? ''}` : 'Keine kritische Aktion offen.')}</p><button data-view="orders">Arbeitsvorrat öffnen →</button></div></section>`;
}

function modulesHTML() {
  const modules = [
    ['01', 'Anfrage', 'Website, manuell, Test getrennt'],
    ['02', 'Preis & Angebot', 'Katalog, Extras, Annahme'],
    ['03', 'Termin', 'Europe/Berlin, Google, Slot'],
    ['04', 'Fahrzeug', 'Fotos, Protokoll, Signatur'],
    ['05', 'Rechnung', 'Qonto, Nummern, Zahlung'],
    ['06', 'Betreuung', 'Portal, Chat, Folgejob'],
  ];
  return `<section class="premium-modules"><div><div class="eyebrow">SO ARBEITET WHITE GLOSS</div><h2>Vom Erstkontakt bis zur fertigen Pflege.</h2></div><div class="module-rail">${modules.map(([number, title, text]) => `<div class="module-chip"><b>${number}</b><strong>${title}</strong><span>${text}</span></div>`).join('')}</div></section>`;
}

function prepareShell(content) {
  const heading = content.querySelector(':scope > .heading');
  const stats = content.querySelector(':scope > .stats');
  const columns = content.querySelector(':scope > .columns');
  if (!heading || !stats || !columns || content.querySelector(':scope > .detail-header')) return null;
  content.classList.add('premium-overview');
  heading.classList.add('premium-heading');
  heading.querySelector('h1').textContent = 'Werkstattübersicht';
  heading.querySelector('p').textContent = 'Alles, was heute Aufmerksamkeit braucht – klar sortiert und direkt erreichbar.';
  const actions = heading.querySelector(':scope > .actions');
  if (actions && !actions.querySelector('.premium-date')) {
    const date = document.createElement('span');
    date.className = 'premium-date';
    date.innerHTML = `${new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', weekday: 'long', day: '2-digit', month: 'long'}).format(new Date())}<span>${document.querySelector('.testswitch.on') ? 'TESTBEREICH' : 'LIVE-BEREICH'}</span>`;
    actions.prepend(date);
  }
  stats.classList.add('premium-kpis');
  stats.querySelectorAll('.stat').forEach((card, index) => {
    card.classList.add('premium-kpi');
    const value = card.querySelector('.value')?.textContent?.trim() ?? '0';
    card.classList.add(index < 2 && value !== '0' ? 'attention' : value !== '0' && value !== '0,00 €' ? 'good' : 'neutral');
  });
  return {heading, stats, columns};
}

async function enhance() {
  const content = document.querySelector('#content');
  if (!content || content.querySelector(':scope > .premium-hero')) return;
  // Do not rewrite the heading while an enhancement is already pending: those
  // writes retrigger the MutationObserver and can starve the browser renderer.
  const currentStats = content.querySelector(':scope > .stats');
  if (currentStats && enhancedStats.has(currentStats)) return;
  const shell = prepareShell(content);
  if (!shell) {
    content.classList.remove('premium-overview');
    return;
  }
  if (enhancedStats.has(shell.stats)) return;
  enhancedStats.add(shell.stats);
  const synthetic = Boolean(document.querySelector('.testswitch.on'));
  try {
    const state = await loadState();
    if (!content.isConnected || !content.classList.contains('premium-overview') || synthetic !== Boolean(document.querySelector('.testswitch.on'))) return;
    const orders = orderList(state, synthetic);
    const open = orders.filter(order => !CLOSED.includes(order.status));
    const appointments = orders.filter(order => order.appointment && ['Termin verbindlich', 'In Arbeit'].includes(order.status) && Date.parse(order.appointment.start) >= Date.now() - 15 * 60 * 1000).sort((a, b) => a.appointment.start.localeCompare(b.appointment.start));
    const today = dayFormat.format(new Date());
    const todayAppointments = appointments.filter(order => dayFormat.format(new Date(order.appointment.start)) === today);
    const working = orders.find(order => order.status === 'In Arbeit');
    const focus = focusOrders(open);
    const health = HEALTH.filter(([key]) => state.integrationReady?.[key]).length;
    shell.heading.insertAdjacentHTML('afterend', heroHTML({open, appointments, working, nextAppointment: appointments[0], focus, health}));
    const section = document.createElement('section');
    section.className = 'premium-section';
    section.innerHTML = `<div class="premium-section-title"><h2>HEUTE</h2><span>${todayAppointments.length} kommende Termine am heutigen Berliner Datum</span></div>`;
    shell.stats.before(section);
    section.append(shell.stats);
    const operational = document.createElement('div');
    operational.className = 'premium-columns';
    operational.innerHTML = `<section class="card premium-card"><div class="card-title"><h2>ALS NÄCHSTES</h2><small>${focus.length} nächste Schritte</small></div>${focusHTML(focus)}</section><section class="card premium-card"><div class="card-title"><h2>SYSTEMSTATUS</h2><small>${health}/${HEALTH.length} geprüft</small></div>${integrationsHTML(state)}<button class="premium-link" data-view="settings">Verbindungen verwalten →</button></section>`;
    shell.columns.before(operational);
    shell.columns.insertAdjacentHTML('afterend', modulesHTML());
    const topActions = document.querySelector('.top-actions');
    if (topActions && !topActions.querySelector('.premium-new')) {
      const button = document.createElement('button');
      button.className = 'premium-new';
      button.dataset.click = 'create';
      button.textContent = '+ Neue Anfrage';
      topActions.querySelector('.testswitch')?.before(button);
    }
  } catch {
    // The existing overview remains fully usable if the additional state request fails.
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.queueMicrotask(() => {
    scheduled = false;
    request = null;
    void enhance();
  });
}
new window.MutationObserver(schedule).observe(document.documentElement, {childList: true, subtree: true});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', schedule, {once: true});
else schedule();

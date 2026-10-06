import {todayTasks} from './operations.mjs';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function dailyHTML(orders,jobs){
  const tasks=todayTasks(orders,jobs);
  return `<section class="card sectiongap"><div class="card-title"><h2>Heute erledigen</h2><span>${tasks.length} offene Schritte</span></div><div class="card-body"><div class="actions"><button class="primary" data-click="directIntake">Annahme direkt starten</button><button data-click="directReturn">Rückgabe direkt starten</button></div><p class="hint">Übergaben und Wiedervorlagen haben Vorrang. Offene Preisprüfungen und Kundenfreigaben bleiben darunter sichtbar.</p>${tasks.map(t=>`<div class="daily-task"><div><strong>${escape(t.title)}</strong><p>${escape(t.wg)} · ${escape(t.customer)}</p></div><button data-order="${escape(t.orderId)}" data-jump="${t.tab}">Bearbeiten →</button></div>`).join('')||'<p>Für deinen aktuellen Bestand sind keine offenen Schritte vorhanden.</p>'}</div></section>`;
}

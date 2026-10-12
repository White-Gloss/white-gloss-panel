// Kundenbereich: Rechnung ansehen, PDF laden und Zahlungsdaten abrufen. Nur lesend.
export const isInvoicePage = location.pathname.startsWith("/rechnung/");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const money = (cents) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
const day = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.slice(8, 10) + "." + value.slice(5, 7) + "." + value.slice(0, 4)
    : "—";
const statusText = { open: "Offen", overdue: "Überfällig", paid: "Bezahlt", canceled: "Storniert" };
const statusBadge = { open: "warn", overdue: "bad", paid: "good", canceled: "bad" };
export async function showInvoicePage() {
  const root = document.querySelector("#app"),
    token = location.pathname.split("/").pop();
  const shell = (body) =>
    `<main class="appoff card document-page"><div class="brand"><span class="brandmark">WG</span><div><strong>White Gloss</strong><small>DETAILING · HORB AM NECKAR</small></div></div>${body}</main>`;
  const response = await fetch("/api/rechnung/" + encodeURIComponent(token), { credentials: "same-origin" });
  const d = await response.json().catch(() => ({ error: "Rechnung nicht lesbar." }));
  if (!response.ok) {
    root.innerHTML = shell("<h1>Ihre Rechnung</h1><p>" + esc(d.error) + "</p>");
    return;
  }
  const inv = d.invoice,
    p = d.payment ?? {},
    open = inv.status === "open" || inv.status === "overdue";
  const row = (label, value) => `<div class="fieldpair"><span>${label}</span><span>${value}</span></div>`;
  root.innerHTML = shell(
    `<h1>Rechnung ${esc(inv.number)}</h1><p>${esc(d.customer)}${d.vehicle ? " · " + esc(d.vehicle) : ""}</p><p><span class="badge ${statusBadge[inv.status] ?? "warn"}">${esc(statusText[inv.status] ?? inv.status)}</span>${inv.mode === "paid" ? ' <span class="badge good">Quittung</span>' : ""}</p><div class="protocolreview">${row("Rechnungsdatum", day(inv.issueDate))}${inv.status === "paid" ? row("Bezahlt", (inv.paymentMethod ? esc(inv.paymentMethod) + " " : "") + (inv.paidAt ? "am " + day(inv.paidAt) : "")) : row("Zahlbar bis", "<strong>" + day(inv.dueDate) + "</strong>")}<div class="tablewrap"><table><thead><tr><th>Leistung</th><th>Brutto</th></tr></thead><tbody>${d.lines.map((line) => `<tr><td>${esc(line.title)}${line.description ? '<span class="sub">' + esc(line.description) + "</span>" : ""}</td><td class="money">${money(line.amountCents)}</td></tr>`).join("")}</tbody></table></div>${row("Steuer", esc(d.vat))}<div class="fieldpair"><strong>Gesamtbetrag</strong><strong class="money">${money(inv.totalCents)}</strong></div>${open ? row("Noch offen", "<strong>" + money(inv.openCents) + "</strong>") : ""}</div>${open ? `<div class="protocolreview"><h2 class="sectiontitle">Bezahlen per Überweisung</h2>${row("Empfänger", esc(p.beneficiary || d.company.name))}${p.iban ? row("IBAN", esc(p.iban.replace(/(.{4})/g, "$1 ").trim())) : ""}${p.bic ? row("BIC", esc(p.bic)) : ""}${row("Verwendungszweck", "<strong>" + esc(p.reference) + "</strong>")}${row("Betrag", money(inv.openCents))}</div>` : ""}<div class="actions"><a class="button primary" href="/api/rechnung/${encodeURIComponent(token)}/pdf">Rechnung als PDF</a>${open && d.payUrl ? `<a class="button" href="${esc(d.payUrl)}" target="_blank" rel="noreferrer">Online ansehen und bezahlen</a>` : ""}</div>${d.ownerPreview ? '<p class="hint">Betreibervorschau des Kundenbereichs.</p>' : ""}<p class="hint">Fragen zur Rechnung? ${esc(d.company.name)} · ${esc(d.company.phone)} · <a href="mailto:${esc(d.company.email)}">${esc(d.company.email)}</a></p>`,
  );
}

// Abrechnung mit Qonto: Rechnung (Zahlungsziel 7 Tage) oder Quittung für bereits bezahlte Aufträge.
const invoiceEsc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const invoiceMoney = (cents) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
export const invoiceToday = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const validDay = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export const invoicePlusDays = (day, days) =>
  new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export const invoiceGermanDay = (day) =>
  validDay(day) ? day.slice(8, 10) + "." + day.slice(5, 7) + "." + day.slice(0, 4) : "—";
export const PAYMENT_TERM_DAYS = 7;
const VAT = { 1900: "19 % Umsatzsteuer", 700: "7 % Umsatzsteuer", 0: "0 % · Kleinunternehmer (§ 19 UStG)" };
const mountedInvoices = new WeakMap();
const statusLabels = {
  draft: "Entwurf",
  unpaid: "Offen",
  open: "Offen",
  overdue: "Überfällig",
  paid: "Bezahlt",
  canceled: "Storniert",
  cancelled: "Storniert",
  voided: "Storniert",
};
const deliveryStates = {
  queued: "wartet auf Versand",
  pending: "wird gesendet",
  sent: "gesendet",
  failed: "nicht gesendet",
  unknown: "Ergebnis offen",
  cancelled: "entfällt",
  paused: "pausiert",
};
export const invoiceStatusLabel = (status) =>
  Object.hasOwn(statusLabels, status) ? statusLabels[status] : "Unbekannter Status";

export function invoiceLines(order) {
  const lines = order.invoiceDraft ? order.invoiceDraft.lines : order.offer?.lines?.length
    ? order.offer.lines
    : [{ title: "Fahrzeugaufbereitung", description: order.offer?.services ?? "", amountCents: order.offer?.totalCents }];
  if (
    !lines.length ||
    lines.some((line) => !Number.isSafeInteger(line.amountCents) || line.amountCents < 0) ||
    lines.reduce((sum, line) => sum + line.amountCents, 0) !== (order.invoiceDraft?.totalCents ?? order.offer?.totalCents)
  )
    throw Error("Die gespeicherten Leistungen stimmen nicht mit dem vereinbarten Festpreis überein.");
  return lines;
}
export function invoiceTotals(order, vatBasisPoints) {
  invoiceLines(order);
  if (![0, 700, 1900].includes(vatBasisPoints)) throw Error("Bitte den Umsatzsteuersatz auswählen.");
  const grossCents = order.invoiceDraft?.totalCents ?? order.offer.totalCents,
    denominator = BigInt(10000 + vatBasisPoints);
  const taxCents = Number((BigInt(grossCents) * BigInt(vatBasisPoints) + denominator / 2n) / denominator);
  return { grossCents, netCents: grossCents - taxCents, taxCents };
}
const paidCents = (order) =>
  (order.payments ?? []).filter((payment) => !payment.cancelledAt).reduce((sum, payment) => sum + payment.amountCents, 0);
const addressLines = (address = {}) =>
  [address.street_address, [address.zip_code, address.city].filter(Boolean).join(" "), address.country_code].filter(
    Boolean,
  );

export function invoiceDraftSummaryHTML(order) {
  if (order.invoice && order.invoice.status !== "canceled")
    return "";
  const draft = order.invoiceDraft;
  return `<div class="sectiontitle">Rechnungsentwurf vor Versand</div>${draft ? `<p>Gespeicherter Rechnungsbetrag: <strong>${invoiceMoney(draft.totalCents)}</strong> · Angebot: ${invoiceMoney(order.offer?.totalCents ?? 0)}</p><p class="hint">Änderungsgrund: ${invoiceEsc(draft.reason)}</p>` : '<p class="hint">Bei unerwarteter Mehrarbeit kannst du Positionen und Beträge vor dem Ausstellen bearbeiten. Das unterschriebene Angebot bleibt erhalten.</p>'}<button data-click="invoiceDraft">${draft ? "Rechnungsentwurf bearbeiten" : "Rechnungspositionen bearbeiten"}</button>`;
}
function draftLineHTML(line = {}) {
  return `<fieldset class="catalog-options" data-invoice-draft-line><legend>Rechnungsposition</legend><label>Leistung<input data-draft-title value="${invoiceEsc(line.title ?? "")}" maxlength="180" required></label><label>Beschreibung<textarea data-draft-description maxlength="2000">${invoiceEsc(line.description ?? "")}</textarea></label><label>Bruttobetrag in €<input data-draft-amount inputmode="decimal" value="${Number.isSafeInteger(line.amountCents) ? (line.amountCents / 100).toFixed(2).replace(".", ",") : ""}" required></label><button type="button" data-invoice-remove>Position entfernen</button></fieldset>`;
}
export function invoiceDraftForm(order) {
  if (order.invoice && order.invoice.status !== "canceled") throw Error("Die Rechnung ist bereits ausgestellt und bleibt unverändert.");
  return `<p>${invoiceEsc(order.wg)} · ${invoiceEsc(order.source?.name)} · Angebot ${invoiceMoney(order.offer?.totalCents ?? 0)} brutto</p><p class="hint">Hier bearbeitest du ausschließlich den Rechnungsentwurf. Beschreibe Mehrarbeit und die dazu vereinbarte Preisänderung. Das gespeicherte Angebot und seine Unterschrift bleiben unverändert. Erst nach der anschließenden Rechnungsprüfung wird die Rechnung ausgestellt.</p><form id="invoiceDraftform"><div data-invoice-draft-lines>${invoiceLines(order).map(draftLineHTML).join("")}</div><button type="button" data-invoice-add>Position hinzufügen</button><label>Grund der Änderung / Vereinbarung mit dem Kunden<textarea name="reason" maxlength="2000" required>${invoiceEsc(order.invoiceDraft?.reason ?? "")}</textarea></label><p data-invoice-draft-total aria-live="polite"></p><button type="submit" class="primary">Entwurf speichern</button><div id="modal-error" class="error"></div></form>`;
}
function parseDraftAmount(value) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(raw)) throw Error("Bitte einen Bruttobetrag mit höchstens zwei Nachkommastellen eingeben.");
  const [whole, fraction = ""] = raw.replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount > 100000000) throw Error("Der Betrag darf 1.000.000 € nicht überschreiten.");
  return amount;
}
export function invoiceDraftInput(form) {
  const rows = [...form.querySelectorAll("[data-invoice-draft-line]")];
  if (!rows.length || rows.length > 100) throw Error("Bitte 1 bis 100 Rechnungspositionen angeben.");
  const lines = rows.map((row) => {
    const title = row.querySelector("[data-draft-title]").value.trim(),
      description = row.querySelector("[data-draft-description]").value.trim(),
      amountCents = parseDraftAmount(row.querySelector("[data-draft-amount]").value);
    if (!title || title.length > 180) throw Error("Bitte für jede Position einen Titel angeben (höchstens 180 Zeichen).");
    if (description.length > 2000) throw Error("Die Positionsbeschreibung darf höchstens 2000 Zeichen haben.");
    return { title, description, amountCents };
  });
  const reason = form.elements.reason.value.trim();
  if (!reason || reason.length > 2000) throw Error("Bitte den Grund und die Vereinbarung zur Rechnungsänderung angeben.");
  const totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  if (!totalCents || totalCents > 100000000) throw Error("Der Rechnungsbetrag muss positiv sein und darf 1.000.000 € nicht überschreiten.");
  return { lines, reason };
}
export function mountInvoiceDraftForm(form) {
  if (!form) return;
  const update = () => {
    const total = form.querySelector("[data-invoice-draft-total]");
    try {
      const sum = [...form.querySelectorAll("[data-draft-amount]")].reduce((amount, field) => amount + parseDraftAmount(field.value), 0);
      total.textContent = "Rechnungsbetrag: " + invoiceMoney(sum) + " brutto";
    } catch (error) { total.textContent = error.message; }
  };
  form.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (target?.hasAttribute("data-invoice-add")) {
      if (form.querySelectorAll("[data-invoice-draft-line]").length >= 100) return;
      form.querySelector("[data-invoice-draft-lines]").insertAdjacentHTML("beforeend", draftLineHTML());
      update();
    }
    if (target?.hasAttribute("data-invoice-remove") && form.querySelectorAll("[data-invoice-draft-line]").length > 1) {
      target.closest("[data-invoice-draft-line]").remove();
      update();
    }
  });
  form.addEventListener("input", update);
  update();
}

function readInvoiceFields(form, inventory) {
  const data = Object.fromEntries(
    [...new FormData(form)].map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  );
  const mode = data.mode === "paid" ? "paid" : data.mode === "invoice" ? "invoice" : "";
  if (!mode) throw Error("Bitte auswählen: Rechnung senden oder bereits bezahlt.");
  const vatBasisPoints = Number(data.vatBasisPoints);
  if (![0, 700, 1900].includes(vatBasisPoints)) throw Error("Bitte den Umsatzsteuersatz auswählen.");
  const input = {
    mode,
    vatBasisPoints,
    clientId: data.clientId ?? "",
    sendMail: form.elements.sendMail?.checked === true && !form.elements.sendMail.disabled,
    billing: {
      kind: data.billingKind ?? "",
      firstName: String(data.billingFirstName ?? "").trim(),
      lastName: String(data.billingLastName ?? "").trim(),
      name: String(data.billingName ?? "").trim(),
      street: String(data.billingStreet ?? "").trim(),
      zip: String(data.billingZip ?? "").trim(),
      city: String(data.billingCity ?? "").trim(),
      country: String(data.billingCountry ?? "")
        .trim()
        .toUpperCase(),
    },
  };
  if (mode === "paid") {
    if (!["Bar", "Karte", "Überweisung"].includes(data.paymentMethod)) throw Error("Bitte die Zahlungsart auswählen.");
    if (!validDay(data.paidAt) || data.paidAt > invoiceToday())
      throw Error("Zahlungsdatum muss ein gültiger Tag bis heute sein.");
    input.paymentMethod = data.paymentMethod;
    input.paidAt = data.paidAt;
  }
  reviewedClient(input, inventory);
  return input;
}
function reviewedClient(input, inventory) {
  const clients = inventory.clients ?? [];
  if (input.clientId) {
    const client = clients.find((item) => item.id === input.clientId);
    if (!client) throw Error("Bitte den passenden Qonto-Kunden auswählen.");
    if (!client.complete) throw Error(client.problem || "Der Qonto-Kunde ist unvollständig. Bitte in Qonto ergänzen.");
    return { name: client.name, email: client.email, address: addressLines(client.billing_address), existing: true };
  }
  if (clients.length && inventory.customerEmail)
    throw Error("Für diese E-Mail gibt es bereits einen Qonto-Kunden. Bitte auswählen.");
  const billing = input.billing;
  if (!["individual", "company"].includes(billing.kind)) throw Error("Bitte Privatkunde oder Firmenkunde auswählen.");
  if (billing.kind === "individual" ? !billing.firstName || !billing.lastName : !billing.name)
    throw Error("Bitte den vollständigen Namen des Rechnungskunden angeben.");
  if (!billing.street || !billing.zip || !billing.city) throw Error("Bitte die vollständige Rechnungsadresse angeben.");
  if (billing.country !== "DE") throw Error("Rechnungen in diesem Ablauf gehen an deutsche Adressen (Land DE).");
  return {
    name: billing.kind === "company" ? billing.name : billing.firstName + " " + billing.lastName,
    email: inventory.customerEmail ?? "",
    address: [billing.street, billing.zip + " " + billing.city, "DE"],
    existing: false,
  };
}

export function invoiceReview(order, input, inventory) {
  const client = reviewedClient(input, inventory),
    totals = invoiceTotals(order, input.vatBasisPoints),
    issue = inventory.issueDate ?? invoiceToday(),
    due = inventory.dueDate ?? invoicePlusDays(issue, PAYMENT_TERM_DAYS),
    paid = input.mode === "paid",
    number = inventory.number ?? order.wg;
  const pair = (label, value) => `<div class="fieldpair"><span>${label}</span><span>${value}</span></div>`;
  return `<div class="sectiontitle">${paid ? "Vorschau · Rechnung mit Quittungsvermerk" : "Vorschau · Rechnung"}</div>${pair("Rechnungsnummer", "<strong>" + invoiceEsc(number) + "</strong>")}${pair("Rechnungsdatum", invoiceGermanDay(issue))}${paid ? pair("Bezahlt", invoiceEsc(input.paymentMethod) + " am " + invoiceGermanDay(input.paidAt)) : pair("Zahlbar bis", "<strong>" + invoiceGermanDay(due) + "</strong> · " + PAYMENT_TERM_DAYS + " Tage")}${pair("Rechnungskunde", invoiceEsc(client.name) + (client.email ? "<br>" + invoiceEsc(client.email) : "") + "<br>" + client.address.map(invoiceEsc).join("<br>"))}<div class="tablewrap"><table><thead><tr><th>Leistung</th><th>Brutto</th></tr></thead><tbody>${invoiceLines(
    order,
  )
    .map(
      (line) =>
        `<tr><td>${invoiceEsc(line.title)}${line.description ? '<span class="sub">' + invoiceEsc(line.description) + "</span>" : ""}</td><td class="money">${invoiceMoney(line.amountCents)}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div>${order.invoiceDraft ? pair("Vereinbarter Angebotspreis", invoiceMoney(order.offer.totalCents)) + pair("Grund der Änderung", invoiceEsc(order.invoiceDraft.reason)) : ""}${pair("Netto", '<span class="money">' + invoiceMoney(totals.netCents) + "</span>")}${pair(invoiceEsc(VAT[input.vatBasisPoints]), '<span class="money">' + invoiceMoney(totals.taxCents) + "</span>")}<div class="fieldpair"><strong>Gesamtbetrag</strong><strong class="money">${invoiceMoney(totals.grossCents)}</strong></div><p class="hint">${client.existing ? "Der vorhandene Qonto-Kunde wird verwendet." : "Der Rechnungskunde wird mit diesen Angaben in Qonto angelegt."} Qonto stellt die Rechnung mit der Nummer ${invoiceEsc(number)} aus – eine doppelte Rechnung ist ausgeschlossen.${order.invoice?.status === "canceled" ? " Sie ersetzt die in Qonto stornierte Rechnung " + invoiceEsc(order.invoice.number) + "." : ""}${paid ? " Die Rechnung wird in Qonto sofort als bezahlt markiert und die Zahlung im Auftrag erfasst." : " Ohne Zahlungseingang folgen Zahlungserinnerung und Mahnungen nach deiner Freigabe."}${input.sendMail ? " Die PDF-Rechnung geht per E-Mail an den Kunden, Kopie an dich." : " Es wird keine E-Mail versendet."}</p>`;
}

export function invoiceForm(order, inventory) {
  invoiceLines(order);
  const clients = inventory.clients ?? [],
    today = inventory.issueDate ?? invoiceToday(),
    due = inventory.dueDate ?? invoicePlusDays(today, PAYMENT_TERM_DAYS),
    alreadyPaid = paidCents(order) > 0,
    canMail = Boolean(inventory.customerEmail) && inventory.mailReady === true,
    field = (label, name, value = "", extra = "") =>
      `<label>${label}<input name="${name}" value="${invoiceEsc(value)}" ${extra}></label>`;
  const clientChoice = clients.length
    ? `<label>Qonto-Rechnungskunde<select name="clientId" ${inventory.customerEmail ? "required" : ""}><option value="">${inventory.customerEmail ? "Bitte den passenden Kunden auswählen" : "Neuen Rechnungskunden anlegen"}</option>${clients.map((client) => `<option value="${invoiceEsc(client.id)}">${invoiceEsc(client.name)}${client.email ? " · " + invoiceEsc(client.email) : ""}${client.complete ? "" : " · unvollständig"}</option>`).join("")}</select></label>`
    : '<input type="hidden" name="clientId" value="">';
  const newClient = `<fieldset class="catalog-options" data-new-client ${clients.length && inventory.customerEmail ? "hidden" : ""}><legend>Rechnungsadresse</legend><label>Kundenart<select name="billingKind"><option value="individual">Privatkunde</option><option value="company"${order.source.company ? " selected" : ""}>Firmenkunde</option></select></label><div class="grid2">${field("Vorname", "billingFirstName", String(order.source.name ?? "").split(" ").slice(0, -1).join(" "), 'autocomplete="given-name" maxlength="60"')}${field("Nachname", "billingLastName", String(order.source.name ?? "").split(" ").slice(-1).join(""), 'autocomplete="family-name" maxlength="60"')}${field("Firma", "billingName", order.source.company ?? "", 'autocomplete="organization" maxlength="180"')}${field("Straße und Hausnummer", "billingStreet", "", 'autocomplete="street-address" maxlength="180"')}${field("Postleitzahl", "billingZip", "", 'autocomplete="postal-code" inputmode="numeric" maxlength="20"')}${field("Ort", "billingCity", "", 'autocomplete="address-level2" maxlength="50"')}<input type="hidden" name="billingCountry" value="DE"></div><p class="hint">Die Adresse wird erst mit deiner Freigabe als Qonto-Kunde gespeichert.</p></fieldset>`;
  return `<p>${invoiceEsc(order.wg)} · ${invoiceEsc(order.source.name)} · Angebot ${invoiceMoney(order.offer.totalCents)} brutto${order.invoiceDraft ? " · Rechnungsentwurf " + invoiceMoney(order.invoiceDraft.totalCents) + " brutto" : ""}</p><form id="invoiceform"><fieldset class="catalog-options"><legend>Wie rechnest du ab?</legend><label class="check"><input type="radio" name="mode" value="invoice" ${alreadyPaid ? "disabled" : "checked"}>Rechnung senden · zahlbar in ${PAYMENT_TERM_DAYS} Tagen bis ${invoiceGermanDay(due)}</label><label class="check"><input type="radio" name="mode" value="paid" ${alreadyPaid ? "checked" : ""}>Bereits bezahlt · Rechnung gilt als Quittung</label>${alreadyPaid ? '<p class="hint">Im Auftrag sind bereits ' + invoiceMoney(paidCents(order)) + " als Zahlung erfasst. Abrechnung deshalb nur als Quittung" + (paidCents(order) < (order.invoiceDraft?.totalCents ?? order.offer.totalCents) ? "; der Restbetrag wird mit der gewählten Zahlungsart als bezahlt erfasst." : ".") + "</p>" : ""}</fieldset><div class="grid2" data-paid-fields hidden><label>Zahlungsart<select name="paymentMethod"><option>Bar</option><option>Karte</option><option>Überweisung</option></select></label>${field("Bezahlt am", "paidAt", today, 'type="date" max="' + today + '"')}</div>${clientChoice}${newClient}<label>Umsatzsteuer<select name="vatBasisPoints"><option value="1900" selected>${VAT[1900]}</option><option value="700">${VAT[700]}</option><option value="0">${VAT[0]}</option></select></label><label class="check"><input type="checkbox" name="sendMail" ${canMail ? "checked" : "disabled"}>PDF-Rechnung per E-Mail an ${invoiceEsc(inventory.customerEmail || "den Kunden")} senden (Kopie an dich)</label>${canMail ? "" : '<p class="hint">' + (inventory.customerEmail ? "E-Mail-Versand ist in den Einstellungen noch nicht geprüft und freigegeben." : "Keine Kunden-E-Mail hinterlegt. Das PDF kannst du nach dem Ausstellen herunterladen.") + "</p>"}<section class="sectiongap" data-invoice-review aria-live="polite"><p class="hint">Angaben vervollständigen, dann erscheint die Vorschau.</p></section><label class="check"><input type="checkbox" name="reviewed" required disabled>Ich habe Kunde, Adresse, Leistungen, Steuer und Betrag geprüft. Die Rechnung ${invoiceEsc(inventory.number ?? order.wg)} soll jetzt in Qonto ausgestellt werden.</label><button class="primary" type="submit" disabled>Rechnung ausstellen</button><div id="modal-error" class="error"></div></form>`;
}

export function mountInvoiceForm(form, order, inventory) {
  if (!form) return;
  const context = { order: structuredClone(order), inventory: structuredClone(inventory), reviewedInput: null };
  mountedInvoices.set(form, context);
  const update = () => {
    const kind = form.elements.billingKind?.value,
      mode = [...(form.querySelectorAll?.('[name="mode"]') ?? [])].find((item) => item.checked)?.value,
      paidFields = form.querySelector("[data-paid-fields]"),
      newClient = form.querySelector("[data-new-client]");
    if (paidFields) paidFields.hidden = mode !== "paid";
    if (newClient && form.elements.clientId?.tagName === "SELECT") newClient.hidden = Boolean(form.elements.clientId.value);
    for (const name of ["billingFirstName", "billingLastName", "billingName"])
      if (form.elements[name]?.closest) form.elements[name].closest("label").hidden = name === "billingName" ? kind !== "company" : kind !== "individual";
    const review = form.querySelector("[data-invoice-review]"),
      submit = form.querySelector('[type="submit"]');
    form.elements.reviewed.checked = false;
    try {
      const input = readInvoiceFields(form, context.inventory);
      review.innerHTML = invoiceReview(context.order, input, context.inventory);
      context.reviewedInput = JSON.stringify(input);
      form.elements.reviewed.disabled = false;
      submit.disabled = false;
      submit.textContent = input.mode === "paid" ? "Quittung ausstellen" : "Rechnung ausstellen";
    } catch (error) {
      context.reviewedInput = null;
      review.innerHTML = '<p class="hint">' + invoiceEsc(error.message) + "</p>";
      form.elements.reviewed.disabled = true;
      submit.disabled = true;
    }
  };
  form.addEventListener("input", (event) => {
    if (event.target.name !== "reviewed") update();
  });
  form.addEventListener("change", (event) => {
    if (event.target.name !== "reviewed") update();
  });
  update();
}

export function invoiceInput(form, currentOrder) {
  const context = mountedInvoices.get(form);
  if (!context || !currentOrder || currentOrder.id !== context.order.id || currentOrder.version !== context.order.version)
    throw Error("Der Auftrag hat sich seit der Vorschau geändert. Bitte den Dialog erneut öffnen.");
  const input = readInvoiceFields(form, context.inventory);
  if (context.reviewedInput !== JSON.stringify(input) || form.elements.reviewed.checked !== true)
    throw Error("Bitte die aktuelle Vorschau prüfen und ausdrücklich bestätigen.");
  invoiceTotals(context.order, input.vatBasisPoints);
  const client = (context.inventory.clients ?? []).find((item) => item.id === input.clientId);
  if (client && !/^[a-f0-9]{64}$/i.test(client.reviewHash ?? ""))
    throw Error("Der geprüfte Kundenabgleich fehlt. Bitte den Dialog erneut öffnen.");
  const { billing, ...rest } = input;
  return {
    ...rest,
    ...(input.clientId ? {} : { billing }),
    clientReviewHash: client?.reviewHash ?? null,
    draftReviewHash: context.inventory.draftReviewHash ?? null,
    reviewed: true,
  };
}

function invoiceView(order) {
  const inv = order.invoice,
    info = order.invoiceInfo ?? null,
    open = info?.openCents ?? Math.max(0, (inv.totalCents ?? order.offer?.totalCents ?? 0) - paidCents(order)),
    overdue = inv.status === "unpaid" && validDay(inv.dueDate) && invoiceToday() > inv.dueDate,
    status = inv.status === "unpaid" && open === 0 ? "paid" : overdue ? "overdue" : inv.status;
  return { inv, info, open, overdue, status };
}
export function invoiceResultHTML(order) {
  const invoice = order.invoice;
  if (!invoice) return "";
  if (invoice.provider !== "qonto") {
    let link = "";
    try {
      const url = new URL(invoice.url ?? "");
      if (url.protocol === "https:")
        link = '<a href="' + invoiceEsc(url.href) + '" target="_blank" rel="noreferrer">Bestehende Rechnung ansehen →</a>';
    } catch {
      /* Historische Rechnungsdaten bleiben ohne ungültigen Link sichtbar. */
    }
    return `<p><strong>Bestehende Rechnung ${invoiceEsc(invoice.number ?? "")}</strong> · ${invoiceStatusLabel(invoice.status)}</p><p class="hint">Früherer Rechnungsvorgang (${invoiceEsc(invoice.provider ?? "unbekannt")}). Zahlungen erfasst du wie gewohnt im Auftrag.</p>${link ? '<div class="actions">' + link + "</div>" : ""}`;
  }
  const { inv, info, open, overdue, status } = invoiceView(order),
    paidMode = inv.mode === "paid",
    badge = status === "paid" ? "good" : status === "overdue" ? "bad" : status === "canceled" ? "bad" : "warn",
    pair = (label, value) => `<div class="fieldpair"><span>${label}</span><span>${value}</span></div>`;
  const actions = [
    `<a class="button" href="/api/invoice/pdf?id=${encodeURIComponent(order.id)}">PDF herunterladen</a>`,
    inv.url ? `<a class="button" href="${invoiceEsc(inv.url)}" target="_blank" rel="noreferrer">In Qonto ansehen</a>` : "",
    inv.status === "unpaid" ? '<button data-click="invoiceSync">Zahlstatus abgleichen</button>' : "",
    order.source?.email ? `<button data-click="invoiceMail">${(info?.deliveries ?? []).some((row) => !row.kind.startsWith("reminder-")) ? "Rechnung erneut senden" : "Rechnung per E-Mail senden"}</button>` : "",
    overdue && open > 0 && order.source?.email && (info?.next?.due || info?.pending)
      ? `<button data-click="invoiceReminder">${invoiceEsc(info.pending?.label ?? info.next.label)} jetzt senden</button>`
      : "",
    inv.status === "unpaid" && open === 0 ? '<button data-click="invoiceMarkPaid">In Qonto als bezahlt markieren</button>' : "",
    info?.portalUrl ? `<button data-click="invoicePortal" data-url="${invoiceEsc(info.portalUrl)}">Kundenlink kopieren</button>` : "",
  ].filter(Boolean);
  const deliveries = (info?.deliveries ?? [])
    .map(
      (row) =>
        `<li>${invoiceEsc(row.label)} · ${invoiceEsc(deliveryStates[row.state] ?? row.state)}<small>${row.at ? invoiceEsc(new Date(row.at).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" })) : ""}${row.detail && row.state !== "sent" ? " · " + invoiceEsc(row.detail) : ""}</small></li>`,
    )
    .join("");
  if (inv.status === "canceled")
    return `<div class="sectiontitle">Qonto-Rechnung</div><p><strong>${invoiceEsc(inv.number)}</strong> <span class="badge bad">Storniert</span></p><p class="hint">Diese Rechnung ist in Qonto storniert. Du kannst für den Auftrag eine neue Rechnung mit fortlaufender Nummer ausstellen.</p><div class="actions"><a class="button" href="/api/invoice/pdf?id=${encodeURIComponent(order.id)}">Stornierte Rechnung als PDF</a><button class="primary" data-click="invoice">Neue Rechnung ausstellen</button></div>`;
  const dunning =
    paidMode || inv.status !== "unpaid" || open === 0
      ? ""
      : info?.finished
        ? '<p class="hint"><strong>Mahnverfahren abgeschlossen.</strong> Alle drei Stufen sind versendet. Weitere Schritte (z. B. gerichtliches Mahnverfahren) entscheidest du selbst.</p>'
        : info?.pending
          ? `<p class="hint">${invoiceEsc(info.pending.label)}: ${invoiceEsc(deliveryStates[info.pending.state] ?? info.pending.state)}.</p>`
          : info?.next
            ? `<p class="hint">Nächste Stufe: <strong>${invoiceEsc(info.next.label)}</strong> ab ${invoiceGermanDay(info.next.on)} · ${info.dunningApproved ? "wird automatisch gesendet" : "automatischer Versand ist in den Einstellungen noch nicht freigegeben – du kannst sie hier manuell senden"}.</p>`
            : "";
  return `<div class="sectiontitle">Qonto-Rechnung</div><p><strong>${invoiceEsc(inv.number)}</strong> <span class="badge ${badge}">${invoiceStatusLabel(status)}</span>${paidMode ? ' <span class="badge good">Quittung</span>' : ""}</p>${pair("Rechnungsdatum", invoiceGermanDay(inv.issueDate))}${paidMode ? pair("Bezahlt", invoiceEsc(inv.paymentMethod ?? "") + (inv.paidAt ? " am " + invoiceGermanDay(inv.paidAt) : "")) : pair("Zahlbar bis", invoiceGermanDay(inv.dueDate))}${pair("Betrag", invoiceMoney(inv.totalCents))}<p class="hint">Bereits in Qonto ausgestellt. Die Rechnung bleibt auch vor dem E-Mail-Versand unverändert. Korrekturen erfolgen über Storno und Neuausstellung in Qonto.</p>${paidMode ? "" : pair("Noch offen", invoiceMoney(open))}<div class="actions">${actions.join("")}</div>${dunning}${deliveries ? '<div class="sectiontitle">Versand & Mahnwesen</div><ul class="timeline">' + deliveries + "</ul>" : ""}`;
}

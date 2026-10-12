import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  invoiceForm,
  mountInvoiceForm,
  invoiceInput,
  invoiceReview,
  invoiceResultHTML,
  invoiceTotals,
  invoiceToday,
  invoicePlusDays,
} from "../public/invoice-ui.js";

const order = () => ({
  id: "synthetic-order",
  version: 4,
  wg: "WG-000555",
  status: "Erledigt",
  source: { name: "Max Muster", email: "max@example.invalid" },
  payments: [],
  offer: {
    totalCents: 11900,
    lines: [
      { title: "Paket", description: "Innen und außen", amountCents: 10900 },
      { title: "Abholung", amountCents: 1000 },
    ],
  },
});
const client = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Max Muster",
  email: "max@example.invalid",
  complete: true,
  problem: null,
  reviewHash: "a".repeat(64),
  billing_address: { street_address: "Teststraße 1", zip_code: "72160", city: "Horb", country_code: "DE" },
};
const inventory = (extra = {}) => ({
  clients: [],
  customerEmail: "max@example.invalid",
  mailReady: true,
  issueDate: invoiceToday(),
  dueDate: invoicePlusDays(invoiceToday(), 7),
  ...extra,
});
function mount(t, o, inv) {
  const dom = new JSDOM('<!doctype html><body><div id="modal"></div></body>');
  const previous = globalThis.FormData;
  globalThis.FormData = dom.window.FormData;
  t.after(() => {
    globalThis.FormData = previous;
    dom.window.close();
  });
  dom.window.document.querySelector("#modal").innerHTML = invoiceForm(o, inv);
  const form = dom.window.document.querySelector("#invoiceform");
  mountInvoiceForm(form, o, inv);
  const change = (name, value) => {
    const field = form.elements[name];
    if (field instanceof dom.window.RadioNodeList)
      for (const item of field) item.checked = item.value === value;
    else if (field.type === "checkbox") field.checked = value;
    else field.value = value;
    form.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  return { form, change, review: form.querySelector("[data-invoice-review]"), submit: form.querySelector('[type="submit"]') };
}

test("totals split the agreed gross price into net and VAT without changing the gross amount", () => {
  assert.deepEqual(invoiceTotals(order(), 1900), { grossCents: 11900, netCents: 10000, taxCents: 1900 });
  assert.deepEqual(invoiceTotals(order(), 0), { grossCents: 11900, netCents: 11900, taxCents: 0 });
  assert.throws(() => invoiceTotals({ ...order(), offer: { ...order().offer, totalCents: 1 } }, 1900), /Festpreis/);
});

test("invoice dialog: 7-day invoice preview with new customer address, then explicit confirmation", (t) => {
  const { form, change, review, submit } = mount(t, order(), inventory());
  assert.match(form.textContent, /zahlbar in 7 Tagen/);
  assert.equal(submit.disabled, true);
  change("billingStreet", "Teststraße 1");
  change("billingZip", "72160");
  change("billingCity", "Horb");
  assert.equal(submit.disabled, false);
  assert.match(review.textContent, /WG-000555/);
  assert.match(review.textContent, /Zahlbar bis/);
  assert.match(review.textContent, /119,00/);
  assert.match(review.textContent, /19 % Umsatzsteuer/);
  assert.throws(() => invoiceInput(form, order()), /ausdrücklich bestätigen/);
  form.elements.reviewed.checked = true;
  const input = invoiceInput(form, order());
  assert.equal(input.mode, "invoice");
  assert.equal(input.vatBasisPoints, 1900);
  assert.equal(input.sendMail, true);
  assert.equal(input.reviewed, true);
  assert.equal(input.billing.firstName, "Max");
  assert.equal(input.billing.lastName, "Muster");
  assert.equal(input.billing.country, "DE");
  assert.throws(() => invoiceInput(form, { ...order(), version: 5 }), /geändert/);
});

test("invoice dialog: paid mode shows payment fields and labels the result as receipt", (t) => {
  const { form, change, review, submit } = mount(t, order(), inventory({ clients: [client] }));
  change("clientId", client.id);
  change("mode", "paid");
  assert.equal(form.querySelector("[data-paid-fields]").hidden, false);
  assert.equal(form.querySelector("[data-new-client]").hidden, true);
  assert.match(review.textContent, /Quittungsvermerk/);
  assert.match(review.textContent, /Bar am/);
  assert.equal(submit.textContent, "Quittung ausstellen");
  form.elements.reviewed.checked = true;
  const input = invoiceInput(form, order());
  assert.equal(input.mode, "paid");
  assert.equal(input.paymentMethod, "Bar");
  assert.equal(input.paidAt, invoiceToday());
  assert.equal(input.clientId, client.id);
  assert.equal(input.clientReviewHash, client.reviewHash);
  assert.equal(input.billing, undefined);
});

test("invoice dialog requires choosing the existing Qonto customer and blocks incomplete ones", (t) => {
  const incomplete = { ...client, complete: false, problem: "Vollständige deutsche Rechnungsadresse fehlt im Qonto-Kunden." };
  const { change, review, submit } = mount(t, order(), inventory({ clients: [incomplete] }));
  assert.equal(submit.disabled, true);
  assert.match(review.textContent, /bereits einen Qonto-Kunden/);
  change("clientId", incomplete.id);
  assert.equal(submit.disabled, true);
  assert.match(review.textContent, /Rechnungsadresse fehlt/);
});

test("mail checkbox is disabled without customer e-mail or approved sending", (t) => {
  const { form } = mount(t, order(), inventory({ customerEmail: "", mailReady: true }));
  assert.equal(form.elements.sendMail.disabled, true);
  assert.match(form.textContent, /Keine Kunden-E-Mail/);
});

test("already fully paid orders can only be settled as receipt", (t) => {
  const paid = { ...order(), payments: [{ amountCents: 11900, at: new Date().toISOString(), method: "Karte" }] };
  const { form } = mount(t, paid, inventory());
  const modes = [...form.querySelectorAll('[name="mode"]')];
  assert.equal(modes.find((item) => item.value === "invoice").disabled, true);
  assert.equal(modes.find((item) => item.value === "paid").checked, true);
});

test("result view shows status, dunning stage and the matching actions", () => {
  const base = {
    ...order(),
    invoice: {
      provider: "qonto",
      id: "22222222-2222-4222-8222-222222222222",
      number: "WG-000555",
      status: "unpaid",
      mode: "invoice",
      totalCents: 11900,
      issueDate: "2026-10-01",
      dueDate: "2026-10-08",
      url: "https://pay.qonto.com/invoices/x",
    },
    invoiceInfo: {
      deliveries: [{ kind: "invoice", label: "Rechnung", state: "sent", at: "2026-10-01T10:00:00Z", detail: "" }],
      next: { level: 1, label: "Zahlungserinnerung", on: "2026-10-11", due: true },
      pending: null,
      finished: false,
      openCents: 11900,
      dunningApproved: false,
      portalUrl: "https://panel.example.invalid/rechnung/" + "b".repeat(64),
    },
  };
  const html = invoiceResultHTML(base);
  assert.match(html, /Überfällig/);
  assert.match(html, /PDF herunterladen/);
  assert.match(html, /\/api\/invoice\/pdf\?id=synthetic-order/);
  assert.match(html, /Zahlungserinnerung jetzt senden/);
  assert.match(html, /Rechnung erneut senden/);
  assert.match(html, /noch nicht freigegeben/);
  assert.match(html, /Kundenlink kopieren/);
  const paid = invoiceResultHTML({
    ...base,
    payments: [{ amountCents: 11900 }],
    invoiceInfo: { ...base.invoiceInfo, openCents: 0, next: null },
  });
  assert.match(paid, /Bezahlt/);
  assert.match(paid, /In Qonto als bezahlt markieren/);
  assert.doesNotMatch(paid, /jetzt senden/);
  const legacy = invoiceResultHTML({ ...order(), invoice: { provider: "lexware", number: "RE-1", status: "open" } });
  assert.match(legacy, /Bestehende Rechnung RE-1/);
  const receipt = invoiceResultHTML({
    ...base,
    invoice: { ...base.invoice, mode: "paid", status: "paid", paymentMethod: "Bar", paidAt: "2026-10-01" },
  });
  assert.match(receipt, /Quittung/);
  assert.match(receipt, /Bar am 01\.10\.2026/);
});

test("review escapes customer input", () => {
  const html = invoiceReview(
    { ...order(), offer: { totalCents: 100, lines: [{ title: "<script>x</script>", amountCents: 100 }] } },
    { mode: "invoice", vatBasisPoints: 1900, clientId: "", billing: { kind: "individual", firstName: "<b>", lastName: "X", street: "S", zip: "1", city: "C", country: "DE" } },
    inventory(),
  );
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>/);
});

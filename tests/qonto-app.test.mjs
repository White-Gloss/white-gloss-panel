// End-to-end: Abrechnen im gebauten Panel (jsdom), Serverlogik im Prozess, Qonto und Resend synthetisch.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import worker, { getOrder, init, setting, protect, settings } from "../src/worker.mjs";
import { PanelDatabase } from "../server/storage.mjs";
import { providerOperations, providerSchema } from "../server/providers.mjs";

const origin = "https://panel.example.invalid",
  owner = "test-owner@example.invalid",
  iban = "DE89370400440532013000",
  organizationId = "33333333-3333-4333-8333-333333333333";
let loads = 0;
function qontoMock() {
  const state = { clients: [], invoices: [], mails: [] };
  const meta = (n) => ({ current_page: 1, next_page: null, total_pages: 1, total_count: n, per_page: 100 });
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  state.handle = async (url, options) => {
    const method = options.method ?? "GET",
      body = options.body ? JSON.parse(options.body) : null;
    if (url.origin === "https://api.resend.com") {
      state.mails.push(body);
      return json({ id: "resend-" + state.mails.length });
    }
    if (url.origin === "https://files.qonto.example") return new Response("%PDF-1.7 synthetic");
    assert.equal(url.origin, "https://thirdparty.qonto.com");
    if (url.pathname === "/v2/organization")
      return json({
        organization: {
          id: organizationId,
          legal_name: "White Gloss Detailing",
          bank_accounts: [{ iban, name: "Hauptkonto", status: "active", main: true, is_external_account: false }],
        },
      });
    if (url.pathname === "/v2/clients" && method === "GET") return json({ clients: state.clients, meta: meta(state.clients.length) });
    if (url.pathname === "/v2/clients" && method === "POST") {
      const client = { id: randomUUID(), ...body };
      state.clients.push(client);
      return json({ client });
    }
    if (url.pathname === "/v2/client_invoices" && method === "GET")
      return json({ client_invoices: state.invoices, meta: meta(state.invoices.length) });
    if (url.pathname === "/v2/client_invoices" && method === "POST") {
      const total = body.items.reduce(
        (sum, item) => sum + Math.round(Number(item.unit_price.value) * (1 + Number(item.vat_rate)) * 100),
        0,
      );
      const invoice = {
        id: randomUUID(),
        number: body.number,
        status: "draft",
        currency: "EUR",
        total_amount_cents: total,
        total_amount: { value: (total / 100).toFixed(2), currency: "EUR" },
        issue_date: body.issue_date,
        due_date: body.due_date,
        client: { id: body.client_id },
        payment_methods: { iban, bic: "COBADEFFXXX", beneficiary_name: "White Gloss Detailing" },
        invoice_url: "https://pay.qonto.com/invoices/synthetic",
      };
      state.invoices.push(invoice);
      return json({ client_invoice: invoice });
    }
    const match = /^\/v2\/client_invoices\/([0-9a-f-]{36})(?:\/(finalize|mark_as_paid))?$/.exec(url.pathname);
    if (match) {
      const invoice = state.invoices.find((item) => item.id === match[1]);
      if (match[2] === "finalize") {
        invoice.status = "unpaid";
        invoice.attachment_id = randomUUID();
      }
      if (match[2] === "mark_as_paid") {
        invoice.status = "paid";
        invoice.paid_at = body.paid_at;
      }
      return json({ client_invoice: invoice });
    }
    if (url.pathname.startsWith("/v2/attachments/"))
      return json({ attachment: { url: "https://files.qonto.example/file.pdf", file_content_type: "application/pdf" } });
    throw Error("Unerwarteter Aufruf " + method + " " + url.href);
  };
  return state;
}
async function boot(t, hash) {
  const files = new Map();
  const env = {
    DB: new PanelDatabase(":memory:"),
    BUCKET: {
      async put(id, bytes, o) {
        files.set(id, { body: new Uint8Array(bytes), httpMetadata: o?.httpMetadata ?? {} });
      },
      async get(id) {
        return files.get(id) ?? null;
      },
      async delete(id) {
        files.delete(id);
      },
    },
    ASSETS: { fetch: async () => new Response("") },
    OWNER_EMAIL_SHA256: createHash("sha256").update(owner).digest("hex"),
    CONFIG_KEY: Buffer.alloc(32, 5).toString("base64"),
    PANEL_ORIGIN: origin,
    STANDALONE_AUTH: "true",
    CUSTOMER_ACCESS_APPROVED: "true",
    operations: providerOperations,
  };
  await init(env);
  await providerSchema(env);
  const html = readFileSync(new URL("../dist/client/index.html", import.meta.url), "utf8").replace(
    /<script[^>]*><\/script>/g,
    "",
  );
  const dom = new JSDOM(html, { url: origin + "/" + hash, pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute("open");
  };
  w.scrollTo = () => {};
  const qonto = qontoMock();
  let pending = 0;
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input), origin);
    if (url.origin !== origin) return qonto.handle(url, options);
    pending++;
    try {
      const headers = new Headers(options.headers);
      headers.set("oai-authenticated-user-email", owner);
      headers.set("origin", origin);
      return await worker.fetch(new Request(url, { ...options, headers }), env);
    } finally {
      pending--;
    }
  };
  for (const [key, value] of Object.entries({
    window: w,
    document: w.document,
    location: w.location,
    history: w.history,
    localStorage: w.localStorage,
    FormData: w.FormData,
    HTMLElement: w.HTMLElement,
    Event: w.Event,
    fetch: fetchImpl,
  }))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
  t.after(() => env.DB.close());
  const settle = async () => {
    for (let i = 0; i < 2000; i++) {
      await new Promise((r) => setTimeout(r, 5));
      if (pending === 0) {
        await new Promise((r) => setTimeout(r, 10));
        if (pending === 0) return;
      }
    }
    throw Error("UI blieb beschäftigt.");
  };
  return { env, w, qonto, settle, start: async () => {
    await import(new URL("../dist/client/app.js?load=" + ++loads, import.meta.url).href);
    await settle();
  } };
}

test("panel: connect Qonto in settings, then settle a completed order as invoice with 7-day term", async (t) => {
  const ui = await boot(t, "#settings");
  const { env, w, qonto, settle } = ui;
  await setting(env, "numberAudit", true);
  await setting(env, "emailVerified", true);
  await setting(env, "sendApproved", true);
  await setting(env, "sender", "rechnung@example.invalid");
  await setting(env, "resendKey", await protect(env, "synthetic-resend"));
  const order = {
    id: randomUUID(),
    wg: "WG-000900",
    status: "Erledigt",
    synthetic: false,
    source: { name: "Erika Muster", email: "erika@example.invalid", vehicle: "VW Golf" },
    completedAt: new Date(Date.now() - 3600000).toISOString(),
    return: { at: new Date().toISOString() },
    payments: [],
    offer: { totalCents: 24900, lines: [{ title: "Außenaufbereitung", amountCents: 24900 }] },
  };
  await env.DB.prepare("INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)")
    .bind(order.id, order.wg, order.status, JSON.stringify(order), new Date().toISOString(), "test", "fixture")
    .run();
  await ui.start();
  const $ = (s) => w.document.querySelector(s);
  const click = async (selector) => {
    const element = typeof selector === "string" ? $(selector) : selector;
    assert.ok(element, "Element fehlt: " + selector);
    element.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await settle();
  };
  assert.match(w.document.body.textContent, /Qonto · Rechnungen & Zahlungen/);
  assert.doesNotMatch(w.document.body.textContent, /Lexware/);
  const form = $("#settingsform");
  form.elements.qontoLogin.value = "synthetic-org-1234";
  form.elements.qontoKey.value = "synthetic-qonto-secret";
  await click('[data-check="qonto"]');
  const s = await settings(env);
  assert.equal(s.qontoVerified, true);
  assert.equal(s.qontoIban, iban);
  assert.ok($('select[name="qontoIban"]'));
  assert.ok($('input[name="dunningApproved"]'));
  // Open the completed order from the finance overview and settle it.
  await click('[data-view="finance"]');
  await click('tr[data-order="' + order.id + '"]');
  await click('[data-tab="payment"]');
  assert.ok($('[data-click="invoice"]'), "Abrechnen-Schaltfläche fehlt");
  await click('[data-click="invoiceDraft"]');
  const draftForm = $("#invoiceDraftform");
  assert.ok(draftForm, "Rechnungsentwurf-Dialog fehlt");
  await click('[data-invoice-add]');
  const draftRows = [...draftForm.querySelectorAll("[data-invoice-draft-line]")];
  draftRows[1].querySelector("[data-draft-title]").value = "Unerwartete Mehrarbeit";
  draftRows[1].querySelector("[data-draft-amount]").value = "50,00";
  draftForm.elements.reason.value = "Zusatzreinigung vor Ort mit Kunde vereinbart";
  draftForm.requestSubmit();
  await settle();
  const drafted = await getOrder(env, order.id);
  assert.equal(drafted.invoiceDraft.totalCents, 29900);
  assert.equal(drafted.offer.totalCents, 24900);
  assert.equal(qonto.invoices.length, 0);
  assert.equal(qonto.mails.length, 0);
  await click('[data-click="invoice"]');
  const invoiceForm = $("#invoiceform");
  assert.ok(invoiceForm);
  invoiceForm.elements.billingStreet.value = "Teststraße 5";
  invoiceForm.elements.billingZip.value = "72160";
  invoiceForm.elements.billingCity.value = "Horb";
  invoiceForm.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(invoiceForm.textContent, /Zahlbar bis/);
  assert.match(invoiceForm.textContent, /299,00/);
  assert.match(invoiceForm.textContent, /Unerwartete Mehrarbeit/);
  invoiceForm.elements.reviewed.checked = true;
  invoiceForm.requestSubmit();
  await settle();
  const saved = await getOrder(env, order.id);
  assert.equal(saved.invoice.number, "WG-000900");
  assert.equal(saved.invoice.mode, "invoice");
  assert.equal(saved.invoice.totalCents, 29900);
  assert.equal(saved.offer.totalCents, 24900);
  assert.equal(qonto.invoices.length, 1);
  assert.equal(qonto.invoices[0].status, "unpaid");
  assert.equal(qonto.mails.length, 1);
  assert.match(qonto.mails[0].subject, /Rechnung WG-000900/);
  assert.match(w.document.body.textContent, /Qonto-Rechnung/);
  assert.match(w.document.body.textContent, /PDF herunterladen/);
  assert.ok(!$('[data-click="invoiceDraft"]'), "Ausgestellte Rechnung darf keine Entwurfsbearbeitung anbieten");
});

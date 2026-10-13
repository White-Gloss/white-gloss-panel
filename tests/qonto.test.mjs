import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PanelDatabase, PrivateBucket } from "../server/storage.mjs";
import { init, protect, setting, settings, getOrder, saveOrder } from "../src/worker.mjs";
import { transitionOrderTrash, orderTrashStatements } from "../src/order-trash.mjs";
import { digest } from "../server/auth.mjs";
import {
  qontoSchema,
  qontoCheck,
  qontoInvoicePayload,
  qontoNetValue,
  qontoInventory,
  berlinDay,
  addDays,
  PAYMENT_TERM_DAYS,
  invoiceDraftReviewHash,
} from "../server/qonto.mjs";
import {
  qontoInvoice,
  saveInvoiceDraft,
  syncQontoInvoice,
  qontoMarkPaid,
  deliverInvoiceMail,
  pendingInvoiceWork,
  reminderPlan,
  invoiceInfo,
  invoicePortalView,
  sendReminderNow,
  resendInvoiceMail,
  DUNNING,
} from "../server/qonto-billing.mjs";

const organizationId = "33333333-3333-4333-8333-333333333333",
  iban = "DE89370400440532013000",
  ownerEmail = "info@white-gloss.de",
  customerEmail = "kunde@example.invalid";

function completedOrder(extra = {}) {
  return {
    id: randomUUID(),
    wg: "WG-000123",
    version: 1,
    status: "Erledigt",
    synthetic: false,
    source: { name: "TEST Kunde", email: customerEmail, vehicle: "TEST Fahrzeug", plate: "FDS-T 1" },
    intake: { at: "2026-10-01T08:00:00.000Z" },
    return: { at: "2026-10-02T15:00:00.000Z" },
    completedAt: "2026-10-02T15:00:00.000Z",
    payments: [],
    offer: {
      totalCents: 34900,
      services: "TEST",
      lines: [
        {
          title: "Premium Innenraumaufbereitung inklusive Lederpflege und Geruchsneutralisierung",
          description: "Vereinbarte Leistung",
          amountCents: 29900,
        },
        { title: "Abholung und Rückbringung", amountCents: 5000 },
      ],
    },
    ...extra,
  };
}
async function fixture(t, order = completedOrder(), options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "wg-qonto-"));
  const env = {
    CONFIG_KEY: Buffer.alloc(32, 5).toString("base64"),
    DB: new PanelDatabase(":memory:"),
    BUCKET: new PrivateBucket(directory),
    OWNER_EMAIL_SHA256: digest(ownerEmail),
    PANEL_ORIGIN: "https://panel.example.invalid",
  };
  t.after(() => {
    env.DB.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await init(env);
  await qontoSchema(env);
  await env.DB.prepare("INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)")
    .bind(order.id, order.wg, order.status, JSON.stringify(order), new Date().toISOString(), "test", "fixture")
    .run();
  for (const [key, value] of Object.entries({
    numberAudit: true,
    qontoVerified: true,
    qontoOrganizationId: organizationId,
    qontoLogin: "synthetic-org-1234",
    qontoAccounts: [{ iban, name: "Hauptkonto", main: true }],
    qontoIban: iban,
    emailVerified: true,
    sendApproved: true,
    sender: "White Gloss <rechnung@example.invalid>",
    dunningApproved: options.dunningApproved ?? true,
  }))
    await setting(env, key, value);
  await setting(env, "qontoKey", await protect(env, "synthetic-qonto-" + randomUUID()));
  await setting(env, "resendKey", await protect(env, "synthetic-resend-key"));
  return { env, order: await getOrder(env, order.id) };
}
const json = (data, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const meta = (count) => ({
  current_page: 1,
  next_page: null,
  prev_page: null,
  previous_page: null,
  total_pages: 1,
  total_count: count,
  per_page: 100,
});
// Synthetic Qonto and Resend. Nothing leaves the test process.
function providers(t, setup = {}) {
  const state = {
    clients: setup.clients ?? [],
    invoices: setup.invoices ?? [],
    calls: [],
    mails: [],
    attachmentReady: setup.attachmentReady ?? true,
    totalOffset: setup.totalOffset ?? 0,
    rejectSubCent: setup.rejectSubCent ?? false,
  };
  const invoiceView = (invoice) => ({
    ...invoice,
    ...(state.attachmentReady && invoice.status !== "draft" ? { attachment_id: invoice.attachmentId } : {}),
  });
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(String(input)),
      method = options.method ?? "GET",
      body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ method, url: url.href, body, headers: options.headers ?? {} });
    if (url.origin === "https://api.resend.com") {
      state.mails.push({ ...body, idempotency: options.headers["Idempotency-Key"] });
      return json({ id: "resend-" + state.mails.length });
    }
    if (url.origin === "https://files.qonto.example") return new Response("%PDF-1.7 synthetic invoice", { status: 200 });
    assert.equal(url.origin, "https://thirdparty.qonto.com");
    assert.equal(options.redirect, "manual");
    assert.match(options.headers.Authorization, /^synthetic-org-1234:synthetic-qonto-/);
    const path = url.pathname;
    if (path === "/v2/organization")
      return json({
        organization: {
          id: organizationId,
          name: "White Gloss",
          legal_name: "White Gloss Detailing",
          bank_accounts: [
            { iban, name: "Hauptkonto", status: "active", main: true, is_external_account: false, balance_cents: 999 },
            { iban: "DE02120300000000202051", name: "Alt", status: "closed", main: false },
          ],
        },
      });
    if (path === "/v2/clients" && method === "GET") {
      const filter = url.searchParams.get("filter[email]");
      const rows = state.clients.filter((client) => !filter || client.email === filter);
      return json({ clients: rows, meta: meta(rows.length) });
    }
    if (path === "/v2/clients" && method === "POST") {
      const client = { id: randomUUID(), ...body };
      state.clients.push(client);
      return json({ client });
    }
    if (path.startsWith("/v2/clients/")) {
      const client = state.clients.find((item) => item.id === path.split("/").pop());
      return client ? json({ client }) : json({ errors: [{ code: "not_found" }] }, 404);
    }
    if (path === "/v2/client_invoices" && method === "GET")
      return json({ client_invoices: state.invoices.map(invoiceView), meta: meta(state.invoices.length) });
    if (path === "/v2/client_invoices" && method === "POST") {
      if (state.invoices.some((invoice) => invoice.number === body.number))
        return json({ errors: [{ code: "invoice_number_already_exists", detail: "Number taken" }] }, 409);
      if (state.rejectSubCent && body.items.some((item) => /\.\d{3,}$/.test(item.unit_price.value)))
        return json({ errors: [{ code: "invalid_format", detail: "unit_price" }] }, 422);
      const cents = body.items.reduce(
        (sum, item) => sum + Math.round(Number(item.unit_price.value) * (1 + Number(item.vat_rate)) * 100),
        0,
      );
      const total = cents + state.totalOffset;
      const invoice = {
        id: randomUUID(),
        number: body.number,
        status: "draft",
        currency: "EUR",
        total_amount: { value: (total / 100).toFixed(2), currency: "EUR" },
        total_amount_cents: total,
        issue_date: body.issue_date,
        due_date: body.due_date,
        client: { id: body.client_id },
        payment_methods: { iban: body.payment_methods.iban, bic: "COBADEFFXXX", beneficiary_name: "White Gloss Detailing" },
        invoice_url: "https://pay.qonto.com/invoices/synthetic",
        attachmentId: randomUUID(),
        footer: body.footer,
        items: body.items,
      };
      state.invoices.push(invoice);
      return json({ client_invoice: invoice });
    }
    const match = /^\/v2\/client_invoices\/([0-9a-f-]{36})(?:\/(finalize|mark_as_paid))?$/.exec(path);
    if (match) {
      const invoice = state.invoices.find((item) => item.id === match[1]);
      if (!invoice) return json({ errors: [{ code: "not_found" }] }, 404);
      if (method === "DELETE") {
        state.invoices = state.invoices.filter((item) => item.id !== invoice.id);
        return json(null, 204);
      }
      if (method === "PATCH") {
        assert.equal(invoice.status, "draft", "Nur Qonto-Entwürfe sind bearbeitbar.");
        Object.assign(invoice, body);
        const total = body.items.reduce((sum, item) => sum + Math.round(Number(item.unit_price.value) * (1 + Number(item.vat_rate)) * 100), 0);
        invoice.total_amount_cents = total;
        invoice.total_amount = { value: (total / 100).toFixed(2), currency: "EUR" };
      }
      if (match[2] === "finalize") invoice.status = "unpaid";
      if (match[2] === "mark_as_paid") {
        invoice.status = "paid";
        invoice.paid_at = body.paid_at;
      }
      return json({ client_invoice: invoiceView(invoice) });
    }
    const attachment = /^\/v2\/attachments\/([0-9a-f-]{36})$/.exec(path);
    if (attachment)
      return json({
        attachment: {
          id: attachment[1],
          file_content_type: "application/pdf",
          file_size: 26,
          url: "https://files.qonto.example/" + attachment[1] + ".pdf?signature=synthetic",
        },
      });
    throw Error("Unerwarteter Anbieteraufruf: " + method + " " + url.href);
  });
  return state;
}
const newClientInput = (extra = {}) => ({
  mode: "invoice",
  reviewed: true,
  vatBasisPoints: 1900,
  sendMail: true,
  billing: {
    kind: "individual",
    firstName: "TEST",
    lastName: "Kunde",
    street: "Teststraße 1",
    zip: "72160",
    city: "Horb am Neckar",
    country: "DE",
  },
  ...extra,
});

test("invoice draft records extra work without changing the signed offer or contacting providers", async (t) => {
  const signed = completedOrder({ acceptance: { at: "2026-10-01T09:00:00Z", signature: "synthetic-original" } });
  const { env, order } = await fixture(t, signed);
  const qonto = providers(t);
  const saved = await saveInvoiceDraft(env, order, {
    lines: [...order.offer.lines, { title: "Zusätzliche Reinigung", description: "Vor Ort mit Kunde vereinbart", amountCents: 5000 }],
    reason: "Unerwartete Mehrarbeit, telefonisch mit Kunde vereinbart",
  });
  assert.deepEqual(saved.offer, order.offer);
  assert.deepEqual(saved.acceptance, order.acceptance);
  assert.equal(saved.invoiceDraft.totalCents, 39900);
  assert.equal(saved.invoice, undefined);
  assert.equal(qonto.calls.length, 0);
  assert.equal(qonto.mails.length, 0);
  await assert.rejects(saveInvoiceDraft(env, order, { lines: order.offer.lines, reason: "Veralteter Dialog" }), /inzwischen verändert/);
  await assert.rejects(saveInvoiceDraft(env, saved, { lines: saved.invoiceDraft.lines, reason: "" }), /Grund/);
  const changed = await saveInvoiceDraft(env, saved, { lines: order.offer.lines, reason: "Zusatzarbeit entfällt" });
  assert.equal(changed.invoiceDraft.totalCents, 34900);
  assert.equal(changed.invoiceDraftHistory[0].totalCents, 39900);
});

test("issuing uses the reviewed stored draft and its actual total for the invoice and portal", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const saved = await saveInvoiceDraft(env, order, {
    lines: [...order.offer.lines, { title: "Mehrarbeit", amountCents: 5000 }], reason: "Zusatzreinigung vereinbart",
  });
  await assert.rejects(qontoInvoice(env, saved, newClientInput()), /Rechnungsentwurf/);
  assert.equal(qonto.calls.length, 0);
  const created = await qontoInvoice(env, saved, newClientInput({ sendMail: false, draftReviewHash: invoiceDraftReviewHash(saved) }));
  assert.equal(created.order.invoice.totalCents, 39900);
  assert.equal(created.order.invoice.agreedTotalCents, 34900);
  assert.equal(created.order.invoice.lines[2].title, "Mehrarbeit");
  assert.equal(created.order.offer.totalCents, 34900);
  assert.equal(invoicePortalView(created.order).invoice.openCents, 39900);
  await assert.rejects(saveInvoiceDraft(env, created.order, { lines: order.offer.lines, reason: "Nach Ausstellung" }), /bereits ausgestellt/);
  assert.equal(qonto.invoices[0].total_amount_cents, 39900);
  assert.equal(qonto.mails.length, 0);
});

test("extra work on a previously paid order records only the additional paid amount and settles by invoice total", async (t) => {
  const paid = completedOrder({ status: "Bezahlt", payments: [{ amountCents: 34900, method: "Bar", at: "2026-10-02T14:00:00Z" }] });
  const { env, order } = await fixture(t, paid);
  providers(t);
  const draft = await saveInvoiceDraft(env, order, { lines: [...order.offer.lines, { title: "Mehrarbeit", amountCents: 5000 }], reason: "Zusatz vereinbart" });
  assert.equal(draft.status, "Erledigt");
  const created = await qontoInvoice(env, draft, newClientInput({
    mode: "paid", paymentMethod: "Bar", paidAt: berlinDay(), sendMail: false, draftReviewHash: invoiceDraftReviewHash(draft),
  }));
  assert.equal(created.order.status, "Bezahlt");
  assert.equal(created.order.invoice.totalCents, 39900);
  assert.equal(created.order.payments.length, 2);
  assert.equal(created.order.payments[1].amountCents, 5000);
});

test("a resumed finalized Qonto invoice locks the local draft even before panel assignment or e-mail", async (t) => {
  const { env, order } = await fixture(t);
  const client = { id: randomUUID(), kind: "individual", first_name: "TEST", last_name: "Kunde", email: customerEmail,
    currency: "EUR", billing_address: { street_address: "Teststraße 1", zip_code: "72160", city: "Horb", country_code: "DE" } };
  const input = newClientInput();
  const remote = existingInvoice(order, client, input, "unpaid");
  const qonto = providers(t, { clients: [client], invoices: [remote] });
  await env.DB.prepare("INSERT INTO invoice_claims(order_id,provider,marker,org_id,stage,created_at) VALUES(?,'qonto',?,?,'finalize-attempt',?)")
    .bind(order.id, order.wg, organizationId, new Date().toISOString()).run();
  await assert.rejects(saveInvoiceDraft(env, order, { lines: order.offer.lines, reason: "Geändert" }), /bereits ausgestellt/);
  assert.ok(qonto.calls.every((call) => call.method === "GET"));
  assert.equal((await getOrder(env, order.id)).invoiceDraft, undefined);
});

test("Qonto check stores organization and active accounts without balances", async (t) => {
  const { env } = await fixture(t);
  await setting(env, "qontoVerified", false);
  await setting(env, "qontoIban", null);
  providers(t);
  const result = await qontoCheck(env);
  assert.equal(result.ok, true);
  const s = await settings(env);
  assert.equal(s.qontoVerified, true);
  assert.equal(s.qontoOrganizationId, organizationId);
  assert.equal(s.qontoIban, iban);
  assert.deepEqual(s.qontoAccounts, [{ iban, name: "Hauptkonto", main: true }]);
  assert.ok(!JSON.stringify(s.qontoAccounts).includes("balance"));
  assert.ok(!JSON.stringify(s.qontoAccounts).includes("999"));
  await setting(env, "qontoOrganizationId", "44444444-4444-4444-8444-444444444444");
  await assert.rejects(qontoCheck(env), /anderen Organisation/);
});

test("invoice payload uses the WG number, a 7-day term, exact gross prices and Qonto title limits", () => {
  const order = completedOrder(),
    now = "2026-10-13T08:00:00.000Z",
    payload = qontoInvoicePayload(order, newClientInput(), "11111111-1111-4111-8111-111111111111", iban, now);
  assert.equal(payload.number, "WG-000123");
  assert.equal(payload.status, "draft");
  assert.equal(payload.issue_date, "2026-10-13");
  assert.equal(payload.due_date, addDays("2026-10-13", PAYMENT_TERM_DAYS));
  assert.equal(payload.due_date, "2026-10-20");
  assert.equal(payload.performance_start_date, "2026-10-01");
  assert.equal(payload.performance_end_date, "2026-10-02");
  assert.deepEqual(payload.payment_methods, { iban });
  assert.ok(payload.items.every((item) => item.title.length <= 40));
  assert.match(payload.items[0].description, /Geruchsneutralisierung/);
  assert.equal(payload.items[0].vat_rate, "0.19");
  assert.match(payload.footer, /bis zum 20\.10\.2026/);
  const gross = payload.items.reduce((sum, item) => sum + Math.round(Number(item.unit_price.value) * 1.19 * 100), 0);
  assert.equal(gross, 34900);
  const small = qontoInvoicePayload(
    order,
    newClientInput({ vatBasisPoints: 0 }),
    "11111111-1111-4111-8111-111111111111",
    iban,
    now,
  );
  assert.equal(small.items[0].vat_rate, "0");
  assert.equal(small.items[0].vat_exemption_reason, "S19.1");
  assert.equal(small.items[0].unit_price.value, "299.00");
  assert.match(small.footer, /§ 19 UStG/);
  const paid = qontoInvoicePayload(
    order,
    newClientInput({ mode: "paid", paymentMethod: "Bar", paidAt: "2026-10-13" }),
    "11111111-1111-4111-8111-111111111111",
    iban,
    now,
  );
  assert.equal(paid.due_date, "2026-10-13");
  assert.match(paid.footer, /in bar vollständig bezahlt/);
  assert.match(paid.footer, /Quittung/);
  assert.throws(
    () => qontoInvoicePayload({ ...order, status: "In Arbeit" }, newClientInput(), randomUUID(), iban, now),
    /Arbeitsabschluss/,
  );
  assert.throws(
    () => qontoInvoicePayload(order, newClientInput({ reviewed: false }), randomUUID(), iban, now),
    /bestätigen/,
  );
});

test("net prices reproduce every gross cent amount at 19 % and 7 %", () => {
  for (const rate of [1900, 700])
    for (let gross = 1; gross <= 300000; gross += gross < 2000 ? 1 : 97) {
      const net = Number(qontoNetValue(gross, rate));
      assert.equal(Math.round(net * (1 + rate / 10000) * 100), gross, rate + " " + gross);
    }
});

test("invoice mode creates one Qonto invoice, queues the PDF mail and sends it when Qonto has the PDF", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t, { attachmentReady: false });
  const result = await qontoInvoice(env, order, newClientInput());
  assert.equal(result.order.invoice.provider, "qonto");
  assert.equal(result.order.invoice.number, "WG-000123");
  assert.equal(result.order.invoice.status, "unpaid");
  assert.equal(result.order.invoice.mode, "invoice");
  assert.equal(result.order.invoice.dueDate, addDays(berlinDay(), 7));
  assert.match(result.order.invoice.portalToken, /^[a-f0-9]{64}$/);
  assert.equal(result.order.status, "Erledigt");
  assert.equal(result.delivery.state, "queued");
  assert.equal(qonto.invoices.length, 1);
  assert.equal(qonto.calls.filter((call) => call.url.endsWith("/finalize")).length, 1);
  assert.equal(qonto.clients.length, 1);
  assert.equal(qonto.clients[0].email, customerEmail);
  assert.equal(qonto.mails.length, 0);
  const token = await env.DB.prepare("SELECT * FROM invoice_tokens WHERE order_id=?").bind(order.id).first();
  assert.equal(token.hash, digest(result.order.invoice.portalToken));
  qonto.attachmentReady = true;
  const errors = await pendingInvoiceWork(env);
  assert.deepEqual(errors, []);
  assert.equal(qonto.mails.length, 1);
  const mail = qonto.mails[0];
  assert.deepEqual(mail.to, [customerEmail]);
  assert.deepEqual(mail.cc, [ownerEmail]);
  assert.match(mail.subject, /Rechnung WG-000123/);
  assert.match(mail.text, /innerhalb von 7 Tagen/);
  assert.match(mail.text, /DE89 3704 0044 0532 0130 00/);
  assert.match(mail.text, /\/rechnung\/[a-f0-9]{64}/);
  assert.equal(mail.attachments[0].filename, "WG-000123-Rechnung.pdf");
  assert.equal(Buffer.from(mail.attachments[0].content, "base64").subarray(0, 5).toString(), "%PDF-");
  assert.match(mail.idempotency, /^wg-invoice-/);
  // The stored PDF is reused; no second mail is created.
  assert.equal((await deliverInvoiceMail(env, order.id, "invoice")).state, "sent");
  assert.equal(qonto.mails.length, 1);
  await assert.rejects(qontoInvoice(env, await getOrder(env, order.id), newClientInput()), /bereits eine Rechnung/);
  assert.equal(qonto.invoices.length, 1);
});

test("paid mode issues the invoice as receipt, marks it paid in Qonto and records the cash payment", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const today = berlinDay();
  const result = await qontoInvoice(
    env,
    order,
    newClientInput({ mode: "paid", paymentMethod: "Bar", paidAt: today }),
  );
  assert.equal(result.order.status, "Bezahlt");
  assert.equal(result.order.invoice.status, "paid");
  assert.equal(result.order.invoice.mode, "paid");
  assert.equal(result.order.payments.length, 1);
  assert.equal(result.order.payments[0].amountCents, 34900);
  assert.equal(result.order.payments[0].method, "Bar");
  assert.equal(result.order.payments[0].cashConfirmed, true);
  const markPaid = qonto.calls.find((call) => call.url.endsWith("/mark_as_paid"));
  assert.deepEqual(markPaid.body, { paid_at: today });
  assert.match(qonto.invoices[0].footer, /Quittung/);
  assert.equal(result.delivery.state, "sent");
  assert.match(qonto.mails[0].subject, /Rechnung und Quittung WG-000123/);
  assert.doesNotMatch(qonto.mails[0].text, /überweisen/);
  const plan = reminderPlan(result.order, []);
  assert.equal(plan.next, null);
});

function existingClient() {
  return {
    id: randomUUID(),
    kind: "individual",
    first_name: "TEST",
    last_name: "Kunde",
    email: customerEmail,
    currency: "EUR",
    billing_address: { street_address: "Teststraße 1", zip_code: "72160", city: "Horb", country_code: "DE" },
  };
}
function existingInvoice(order, client, input, status, override = {}) {
  const payload = qontoInvoicePayload(order, input, client.id, iban);
  return {
    id: randomUUID(),
    number: "WG-000123",
    status,
    currency: "EUR",
    total_amount: { value: "349.00", currency: "EUR" },
    total_amount_cents: 34900,
    issue_date: payload.issue_date,
    due_date: payload.due_date,
    client: { id: client.id },
    payment_methods: { iban },
    items: payload.items,
    footer: payload.footer,
    attachmentId: randomUUID(),
    ...override,
  };
}
test("an existing invoice number is adopted instead of creating a second invoice", async (t) => {
  const { env, order } = await fixture(t);
  const client = existingClient(),
    input = newClientInput({ sendMail: false });
  const qonto = providers(t, { clients: [client], invoices: [existingInvoice(order, client, input, "unpaid")] });
  const inventory = await qontoInventory(env, order);
  assert.equal(inventory.clients.length, 1);
  assert.equal(inventory.clients[0].complete, true);
  const result = await qontoInvoice(env, order, {
    ...input,
    billing: undefined,
    clientId: client.id,
    clientReviewHash: inventory.clients[0].reviewHash,
  });
  assert.equal(result.order.invoice.id, qonto.invoices[0].id);
  assert.equal(qonto.calls.filter((call) => call.method === "POST").length, 0);
  assert.equal(qonto.mails.length, 0);
});

test("an issued invoice with different terms is never adopted; a different draft is updated without deletion", async (t) => {
  const { env, order } = await fixture(t);
  const client = existingClient(),
    input = newClientInput({ sendMail: false });
  // Issued with 7 % instead of the reviewed 19 %: same gross, different tax → refuse.
  const issued = existingInvoice(order, client, { ...input, vatBasisPoints: 700 }, "unpaid");
  const qonto = providers(t, { clients: [client], invoices: [issued] });
  const inventory = await qontoInventory(env, order);
  const choose = { ...input, billing: undefined, clientId: client.id, clientReviewHash: inventory.clients[0].reviewHash };
  await assert.rejects(qontoInvoice(env, order, choose), /bereits ausgestellt, weicht aber.*Umsatzsteuersatz/);
  assert.equal(qonto.invoices.length, 1);
  assert.equal((await getOrder(env, order.id)).invoice, undefined);
  // Receipt wording on an invoice request → refuse as well.
  qonto.invoices[0] = existingInvoice(order, client, { ...input, mode: "paid", paymentMethod: "Bar", paidAt: berlinDay() }, "paid");
  await assert.rejects(qontoInvoice(env, await getOrder(env, order.id), choose), /Rechnungsart/);
  // A leftover draft with other terms is deleted and replaced by the reviewed one.
  qonto.invoices[0] = existingInvoice(order, client, { ...input, vatBasisPoints: 700 }, "draft");
  const oldDraft = qonto.invoices[0].id;
  const result = await qontoInvoice(env, await getOrder(env, order.id), choose);
  assert.equal(result.order.invoice.id, oldDraft);
  assert.ok(qonto.calls.some((call) => call.method === "PATCH"));
  assert.ok(!qonto.calls.some((call) => call.method === "DELETE"));
  assert.equal(qonto.invoices.length, 1);
  assert.equal(qonto.invoices[0].items[0].vat_rate, "0.19");
  assert.ok(qonto.calls.some((call) => call.method === "PATCH" && call.url.includes(oldDraft)));
});

test("a Qonto total that differs from the agreed price deletes the draft and stores nothing", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t, { totalOffset: 1 });
  await assert.rejects(qontoInvoice(env, order, newClientInput()), /Entwurf wurde in Qonto wieder gelöscht/);
  assert.equal(qonto.invoices.length, 0);
  assert.equal((await getOrder(env, order.id)).invoice, undefined);
  const job = await env.DB.prepare("SELECT state FROM jobs WHERE order_id=? AND kind='invoice'").bind(order.id).first();
  assert.equal(job.state, "failed");
  // A corrected retry continues safely with the already created Qonto customer.
  qonto.totalOffset = 0;
  const inventory = await qontoInventory(env, order);
  const result = await qontoInvoice(env, await getOrder(env, order.id), {
    ...newClientInput(),
    billing: undefined,
    clientId: inventory.clients[0].id,
    clientReviewHash: inventory.clients[0].reviewHash,
  });
  assert.equal(result.order.invoice.number, "WG-000123");
  assert.equal(qonto.clients.length, 1);
});

test("cent-only fallback is used when Qonto rejects sub-cent net prices", async (t) => {
  const { env, order } = await fixture(t, completedOrder({ offer: { totalCents: 34900, lines: [{ title: "Paket", amountCents: 34900 }] } }));
  const qonto = providers(t, { rejectSubCent: true });
  const result = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  assert.equal(result.order.invoice.totalCents, 34900);
  assert.ok(qonto.invoices[0]);
});

test("payment received in Qonto marks the order paid and cancels open reminders", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  qonto.invoices[0].status = "paid";
  qonto.invoices[0].paid_at = berlinDay();
  const synced = await syncQontoInvoice(env, created.order);
  assert.equal(synced.status, "Bezahlt");
  assert.equal(synced.invoice.status, "paid");
  assert.equal(synced.payments.at(-1).source, "qonto");
  assert.equal(synced.payments.at(-1).method, "Überweisung");
  assert.equal(synced.payments.at(-1).amountCents, 34900);
  // A second sync changes nothing.
  const again = await syncQontoInvoice(env, synced);
  assert.equal(again.version, synced.version);
});

test("panel payment can be mirrored to Qonto as paid", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  await assert.rejects(qontoMarkPaid(env, created.order), /noch nicht der volle Betrag/);
  const paidOrder = { ...created.order, payments: [{ id: "p", amountCents: 34900, at: new Date().toISOString(), method: "Bar" }] };
  await env.DB.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=?").bind(JSON.stringify(paidOrder), order.id).run();
  const saved = await qontoMarkPaid(env, await getOrder(env, order.id));
  assert.equal(saved.invoice.status, "paid");
  assert.equal(qonto.invoices[0].status, "paid");
});

test("dunning plan: reminder after 3 days, 1st notice after 14, 2nd after 28, never two within 7 days", () => {
  const order = completedOrder({
    invoice: { provider: "qonto", mode: "invoice", status: "unpaid", dueDate: "2026-10-20", totalCents: 34900 },
  });
  assert.deepEqual(DUNNING.map((stage) => stage.afterDueDays), [3, 14, 28]);
  assert.equal(reminderPlan(order, [], "2026-10-22").due, null);
  assert.equal(reminderPlan(order, [], "2026-10-22").next.on, "2026-10-23");
  assert.equal(reminderPlan(order, [], "2026-10-23").due.kind, "reminder-1");
  const first = [{ kind: "reminder-1", state: "sent", updated_at: "2026-10-30T09:00:00Z" }];
  assert.equal(reminderPlan(order, first, "2026-11-03").due, null);
  assert.equal(reminderPlan(order, first, "2026-11-06").due.kind, "reminder-2");
  const second = [...first, { kind: "reminder-2", state: "sent", updated_at: "2026-11-06T09:00:00Z" }];
  assert.equal(reminderPlan(order, second, "2026-11-16").due, null);
  assert.equal(reminderPlan(order, second, "2026-11-17").due.kind, "reminder-3");
  const all = [...second, { kind: "reminder-3", state: "sent", updated_at: "2026-11-17T09:00:00Z" }];
  assert.equal(reminderPlan(order, all, "2026-12-30").finished, true);
  assert.equal(reminderPlan({ ...order, payments: [{ amountCents: 34900 }] }, [], "2026-12-30").next, null);
  assert.equal(reminderPlan({ ...order, invoice: { ...order.invoice, mode: "paid" } }, [], "2026-12-30").next, null);
});

test("background sends a due reminder only with approval and re-checks Qonto first", async (t) => {
  const { env, order } = await fixture(t, completedOrder(), { dunningApproved: false });
  const qonto = providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  // Make the invoice four days overdue.
  const overdue = structuredClone(created.order);
  overdue.invoice.dueDate = addDays(berlinDay(), -4);
  await env.DB.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=?").bind(JSON.stringify(overdue), order.id).run();
  qonto.invoices[0].due_date = overdue.invoice.dueDate;
  assert.deepEqual(await pendingInvoiceWork(env), []);
  assert.equal(qonto.mails.length, 0);
  const info = await invoiceInfo(env, await getOrder(env, order.id));
  assert.equal(info.overdue, true);
  assert.equal(info.next.label, "Zahlungserinnerung");
  assert.equal(info.next.due, true);
  await setting(env, "dunningApproved", true);
  assert.deepEqual(await pendingInvoiceWork(env), []);
  assert.equal(qonto.mails.length, 1);
  assert.match(qonto.mails[0].subject, /Zahlungserinnerung · Rechnung WG-000123/);
  assert.match(qonto.mails[0].text, /offen: 349,00/);
  assert.match(qonto.mails[0].text, /bereits veranlasst/);
  assert.equal(qonto.mails[0].attachments.length, 1);
  // Nothing further is due on the same day.
  assert.deepEqual(await pendingInvoiceWork(env), []);
  assert.equal(qonto.mails.length, 1);
  // The 1st notice is only due 7 days after the reminder; a manual click cannot skip the schedule.
  await assert.rejects(sendReminderNow(env, await getOrder(env, order.id)), /erst ab/);
  assert.equal(qonto.mails.length, 1);
  // After a payment in Qonto no further reminder is sent, also not manually.
  qonto.invoices[0].status = "paid";
  qonto.invoices[0].paid_at = berlinDay();
  await assert.rejects(sendReminderNow(env, await getOrder(env, order.id)), /Keine weitere Mahnstufe/);
  assert.equal(qonto.mails.length, 1);
  assert.equal((await getOrder(env, order.id)).status, "Bezahlt");
});

test("invoice mail can be sent later and resent without duplicate idempotency keys", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  assert.equal(qonto.mails.length, 0);
  assert.equal((await resendInvoiceMail(env, created.order)).state, "sent");
  assert.equal((await resendInvoiceMail(env, await getOrder(env, order.id))).state, "sent");
  assert.equal(qonto.mails.length, 2);
  assert.notEqual(qonto.mails[0].idempotency, qonto.mails[1].idempotency);
});

test("restoring an order keeps invoice work paused and explicit resend renews the revoked customer link", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t, { attachmentReady: false });
  const created = await qontoInvoice(env, order, newClientInput());
  const originalToken = created.order.invoice.portalToken;
  const removed = transitionOrderTrash(created.order, "deleteOrder", { reason: "Synthetische Prüfung" });
  removed.operationId = randomUUID();
  const statements = await orderTrashStatements(env, removed, "deleteOrder", removed.operationId, created.order.version + 1);
  const deleted = await saveOrder(env, removed, created.order.version, "Synthetischer Papierkorb", "owner", statements);
  assert.equal((await invoiceInfo(env, deleted)).portalUrl, null);
  await assert.rejects(resendInvoiceMail(env, deleted), /Papierkorb/);
  const restored = await saveOrder(env, transitionOrderTrash(deleted, "restoreOrder"), deleted.version, "Synthetische Wiederherstellung", "owner");
  await pendingInvoiceWork(env);
  assert.equal(qonto.mails.length, 0);
  assert.equal((await env.DB.prepare("SELECT state FROM jobs WHERE order_id=? AND kind='invoice-mail'").bind(order.id).first()).state, "paused");
  qonto.attachmentReady = true;
  const delivery = await resendInvoiceMail(env, restored);
  assert.equal(delivery.state, "sent");
  const current = await getOrder(env, order.id);
  const newToken = current.invoice.portalToken;
  assert.notEqual(newToken, originalToken);
  assert.match(newToken, /^[a-f0-9]{64}$/);
  assert.equal(qonto.mails.length, 1);
  assert.match(qonto.mails[0].text, new RegExp("/rechnung/" + newToken));
  assert.ok(!qonto.mails[0].text.includes(originalToken));
  assert.equal((await env.DB.prepare("SELECT revoked FROM invoice_tokens WHERE hash=?").bind(digest(originalToken)).first()).revoked, 1);
  assert.equal((await env.DB.prepare("SELECT revoked FROM invoice_tokens WHERE hash=?").bind(digest(newToken)).first()).revoked, 0);
  assert.equal((await invoiceInfo(env, current)).portalUrl, env.PANEL_ORIGIN + "/rechnung/" + newToken);
});

test("customer portal view shows payment data while open and hides the pay link once paid", async (t) => {
  const { env, order } = await fixture(t);
  providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  const view = invoicePortalView(created.order);
  assert.equal(view.invoice.number, "WG-000123");
  assert.equal(view.invoice.status, "open");
  assert.equal(view.invoice.openCents, 34900);
  assert.equal(view.payment.reference, "WG-000123");
  assert.equal(view.payment.iban, iban);
  assert.equal(view.payUrl, "https://pay.qonto.com/invoices/synthetic");
  assert.equal(view.lines.length, 2);
  assert.ok(!JSON.stringify(view).includes(created.order.invoice.portalToken));
  const paid = invoicePortalView({ ...created.order, payments: [{ amountCents: 34900 }] });
  assert.equal(paid.invoice.status, "paid");
  assert.equal(paid.payUrl, null);
});

test("synthetic and restricted orders never reach Qonto", async (t) => {
  const { env, order } = await fixture(t, completedOrder({ synthetic: true }));
  const qonto = providers(t);
  await assert.rejects(qontoInvoice(env, order, newClientInput()), /Testaufträge/);
  const blocked = await fixture(t, completedOrder({ recordsRestriction: { status: "blocked" } }));
  await assert.rejects(qontoInvoice(blocked.env, blocked.order, newClientInput()), /gesperrt/);
  assert.equal(qonto.calls.length, 0);
});

test("after a cancellation in Qonto a new invoice is issued with a continued number and the old one is kept", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const first = await qontoInvoice(env, order, newClientInput());
  assert.equal(qonto.mails.length, 1);
  qonto.invoices[0].status = "canceled";
  const canceled = await syncQontoInvoice(env, first.order);
  assert.equal(canceled.invoice.status, "canceled");
  assert.equal(reminderPlan(canceled, []).next, null);
  const inventory = await qontoInventory(env, canceled);
  assert.equal(inventory.number, "WG-000123-2");
  const second = await qontoInvoice(env, canceled, {
    ...newClientInput(),
    billing: undefined,
    clientId: inventory.clients[0].id,
    clientReviewHash: inventory.clients[0].reviewHash,
  });
  assert.equal(second.order.invoice.number, "WG-000123-2");
  assert.equal(second.order.invoice.status, "unpaid");
  assert.equal(second.order.invoiceHistory.length, 1);
  assert.equal(second.order.invoiceHistory[0].number, "WG-000123");
  assert.notEqual(second.order.invoice.portalToken, first.order.invoice.portalToken);
  assert.equal(qonto.invoices.length, 2);
  assert.equal(qonto.mails.length, 2);
  assert.match(qonto.mails[1].subject, /WG-000123-2/);
  const tokens = await env.DB.prepare("SELECT revoked FROM invoice_tokens WHERE order_id=? ORDER BY created_at").bind(order.id).all();
  assert.deepEqual(tokens.results.map((row) => row.revoked).sort(), [0, 1]);
  const info = await invoiceInfo(env, second.order);
  assert.deepEqual(info.deliveries.map((row) => row.kind), ["invoice"]);
  assert.match(qonto.invoices[1].footer, /Verwendungszweck: WG-000123-2/);
});

test("customer portal and reminders use the issued invoice snapshot even if the offer changes later", async (t) => {
  const { env, order } = await fixture(t);
  providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  const changed = { ...created.order, offer: { totalCents: 50000, lines: [{ title: "Später geändert", amountCents: 50000 }] } };
  const view = invoicePortalView(changed);
  assert.deepEqual(view.lines.map((line) => line.amountCents), [29900, 5000]);
  assert.equal(view.invoice.openCents, 34900);
  assert.equal((await invoiceInfo(env, changed)).openCents, 34900);
});

test("partial payments block a full invoice; restricted records never reach Qonto, not even for the preview", async (t) => {
  const partial = completedOrder({ payments: [{ id: "p1", amountCents: 10000, at: "2026-10-02T15:00:00.000Z", method: "Bar" }] });
  assert.throws(() => qontoInvoicePayload(partial, newClientInput(), randomUUID(), iban), /bereits Zahlungen erfasst/);
  const blocked = await fixture(t, completedOrder({ recordsRestriction: { status: "blocked" } }));
  const qonto = providers(t);
  await assert.rejects(qontoInventory(blocked.env, blocked.order), /gesperrt/);
  assert.equal(qonto.calls.length, 0);
});

test("a changed customer e-mail cancels a waiting invoice mail instead of sending to the old address", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t, { attachmentReady: false });
  await qontoInvoice(env, order, newClientInput());
  const changed = await getOrder(env, order.id);
  changed.source.email = "neu@example.invalid";
  await env.DB.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=?").bind(JSON.stringify(changed), order.id).run();
  qonto.attachmentReady = true;
  const result = await deliverInvoiceMail(env, order.id, "invoice");
  assert.equal(result.state, "cancelled");
  assert.equal(qonto.mails.length, 0);
  assert.equal((await resendInvoiceMail(env, await getOrder(env, order.id))).state, "sent");
  assert.deepEqual(qonto.mails[0].to, ["neu@example.invalid"]);
});

test("resuming onto an invoice already paid in Qonto records the payment", async (t) => {
  const { env, order } = await fixture(t);
  const client = existingClient(),
    input = newClientInput({ sendMail: false });
  providers(t, {
    clients: [client],
    invoices: [existingInvoice(order, client, input, "paid", { paid_at: berlinDay() })],
  });
  const inventory = await qontoInventory(env, order);
  const result = await qontoInvoice(env, order, {
    ...input,
    billing: undefined,
    clientId: client.id,
    clientReviewHash: inventory.clients[0].reviewHash,
  });
  assert.equal(result.order.invoice.status, "paid");
  assert.equal(result.order.status, "Bezahlt");
  assert.equal(result.order.payments.at(-1).source, "qonto");
});

test("receipt keeps the actual earlier payment day; Qonto gets the invoice date at the earliest", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const yesterday = addDays(berlinDay(), -1);
  const result = await qontoInvoice(env, order, newClientInput({ mode: "paid", paymentMethod: "Karte", paidAt: yesterday, sendMail: false }));
  assert.equal(result.order.invoice.paidAt, yesterday);
  assert.deepEqual(qonto.calls.find((call) => call.url.endsWith("/mark_as_paid")).body, { paid_at: berlinDay() });
  assert.match(qonto.invoices[0].footer, /per Kartenzahlung/);
  const synced = await syncQontoInvoice(env, result.order);
  assert.equal(synced.invoice.paidAt, yesterday);
});

test("marking a backdated panel payment as paid in Qonto uses at least the invoice date", async (t) => {
  const { env, order } = await fixture(t);
  const qonto = providers(t);
  const created = await qontoInvoice(env, order, newClientInput({ sendMail: false }));
  const paid = { ...created.order, payments: [{ id: "p", amountCents: 34900, at: new Date(Date.now() - 5 * 86400000).toISOString(), method: "Bar" }] };
  await env.DB.prepare("UPDATE orders SET data=?,version=version+1 WHERE id=?").bind(JSON.stringify(paid), order.id).run();
  const saved = await qontoMarkPaid(env, await getOrder(env, order.id));
  assert.deepEqual(qonto.calls.filter((call) => call.url.endsWith("/mark_as_paid")).at(-1).body, { paid_at: created.order.invoice.issueDate });
  assert.equal(saved.invoice.paidAt, berlinDay(paid.payments[0].at));
});

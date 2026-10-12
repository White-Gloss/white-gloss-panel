import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PanelDatabase, PrivateBucket } from "../server/storage.mjs";
import { createApplication, configureFromEnvironment } from "../server/application.mjs";
import { digest } from "../server/auth.mjs";
import { settings, setting, unprotect, protect } from "../src/worker.mjs";
import { providerOperations } from "../server/providers.mjs";

const origin = "https://panel.example.invalid",
  owner = "owner@example.invalid",
  customer = "kunde@example.invalid";
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "wg-qonto-gateway-"));
  const env = {
    PANEL_ORIGIN: origin,
    OWNER_EMAIL_SHA256: digest(owner),
    CONFIG_KEY: Buffer.alloc(32, 8).toString("base64"),
    DB: new PanelDatabase(":memory:"),
    BUCKET: new PrivateBucket(directory),
    ASSETS: { fetch: async () => new Response("shell") },
  };
  t.after(() => {
    env.DB.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const app = await createApplication(env);
  const session = async (email) => {
    const raw = randomBytes(32).toString("hex");
    await env.DB.prepare("INSERT INTO auth_sessions VALUES(?,?,?,?)")
      .bind(digest(raw), email, Date.now() + 600000, Date.now())
      .run();
    return "__Host-wg-session=" + raw;
  };
  return { env, app, cookie: await session(owner), session };
}
const post = (path, input, cookie, from = origin) =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin: from, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(input),
  });
const get = (path, cookie) => new Request(origin + path, { headers: cookie ? { cookie } : {} });
async function invoicedOrder(env) {
  const token = randomBytes(32).toString("hex"),
    order = {
      id: randomUUID(),
      wg: "WG-000777",
      status: "Erledigt",
      synthetic: false,
      completedAt: "2026-10-02T15:00:00.000Z",
      payments: [],
      source: { name: "TEST Kunde", email: customer, vehicle: "TEST" },
      offer: { totalCents: 11900, lines: [{ title: "Paket", amountCents: 11900 }] },
      invoice: {
        provider: "qonto",
        id: randomUUID(),
        number: "WG-000777",
        status: "unpaid",
        mode: "invoice",
        totalCents: 11900,
        issueDate: "2026-10-13",
        dueDate: "2026-10-20",
        vatBasisPoints: 1900,
        portalToken: token,
        payment: { iban: "DE89370400440532013000", bic: "COBADEFFXXX", beneficiary: "White Gloss Detailing" },
      },
    };
  await env.DB.prepare("INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)")
    .bind(order.id, order.wg, order.status, JSON.stringify(order), new Date().toISOString(), "test", "fixture")
    .run();
  await env.DB.prepare("INSERT INTO invoice_tokens(hash,order_id,expires_at,created_at) VALUES(?,?,?,?)")
    .bind(digest(token), order.id, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString())
    .run();
  return { order, token };
}

test("Qonto credentials are stored encrypted, reset verification and never appear in the operator state", async (t) => {
  const { env, app, cookie } = await fixture(t);
  await setting(env, "qontoVerified", true);
  const result = await app.fetch(
    post("/api/settings", { qontoLogin: "synthetic-org-1234", qontoKey: "synthetic-qonto-secret" }, cookie),
  );
  assert.equal(result.status, 200);
  const saved = await settings(env);
  assert.equal(await unprotect(env, saved.qontoKey), "synthetic-qonto-secret");
  assert.equal(saved.qontoLogin, "synthetic-org-1234");
  assert.equal(saved.qontoVerified, false);
  const state = await (await app.fetch(get("/api/state", cookie))).json();
  assert.equal(state.settings.qontoConfigured, true);
  assert.equal(state.integrationReady.qonto, false);
  assert.ok(!JSON.stringify(state).includes("synthetic-qonto-secret"));
  assert.equal(state.integrations.lexware, undefined);
  // Only a verified account may be chosen as payment account.
  const invalid = await app.fetch(post("/api/settings", { qontoIban: "DE02120300000000202051" }, cookie));
  assert.equal(invalid.status, 409);
});

test("retired Lexware routes and settings are gone", async (t) => {
  const { env, app, cookie } = await fixture(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("No live provider");
  });
  env.LEXWARE_API_KEY = "retired-env-secret";
  await configureFromEnvironment(env);
  assert.equal((await settings(env)).lexwareKey, undefined);
  assert.ok((await app.fetch(get("/api/lexware/clients?id=x", cookie))).status >= 400);
  assert.ok((await app.fetch(post("/api/lexware/numbers", {}, cookie))).status >= 400);
  assert.ok((await app.fetch(post("/api/lexware/webhook", {}, null))).status >= 400);
  assert.equal((await app.fetch(post("/api/check", { kind: "lexware" }, cookie))).status, 400);
  assert.equal(calls, 0);
});

test("Qonto connection check is owner-only and rejects foreign origins", async (t) => {
  const { env, app, cookie, session } = await fixture(t);
  t.mock.method(providerOperations, "qontoCheck", async () => {
    await setting(env, "qontoVerified", true);
    return { ok: true, message: "geprüft" };
  });
  assert.equal((await app.fetch(post("/api/check", { kind: "qonto" }, cookie))).status, 200);
  assert.equal((await settings(env)).qontoVerified, true);
  const customerCookie = await session(customer);
  assert.equal((await app.fetch(post("/api/check", { kind: "qonto" }, customerCookie))).status, 403);
  assert.equal(
    (await app.fetch(post("/api/settings", { qontoKey: "foreign" }, cookie, "https://evil.example.invalid"))).status,
    403,
  );
});

test("owner invoice PDF download rejects anonymous and customer sessions", async (t) => {
  const { env, app, cookie, session } = await fixture(t);
  const { order } = await invoicedOrder(env);
  t.mock.method(providerOperations, "invoiceDownload", async (e, o) => {
    assert.equal(o.id, order.id);
    return new Response("%PDF-1.7 synthetic", { headers: { "Content-Type": "application/pdf" } });
  });
  assert.equal((await app.fetch(get("/api/invoice/pdf?id=" + order.id))).status, 401);
  assert.equal((await app.fetch(get("/api/invoice/pdf?id=" + order.id, await session(customer)))).status, 403);
  const response = await app.fetch(get("/api/invoice/pdf?id=" + order.id, cookie));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/pdf/);
});

test("customer portal: own invoice readable after login, foreign customers and anonymous users are rejected", async (t) => {
  const { env, app, cookie, session } = await fixture(t);
  const { order, token } = await invoicedOrder(env);
  const page = await app.fetch(get("/rechnung/" + token));
  assert.equal(page.status, 303);
  assert.equal(new URL(page.headers.get("location")).searchParams.get("returnTo"), "/rechnung/" + token);
  assert.equal((await app.fetch(get("/api/rechnung/" + token))).status, 401);
  const own = await app.fetch(get("/api/rechnung/" + token, await session(customer)));
  assert.equal(own.status, 200);
  const view = await own.json();
  assert.equal(view.invoice.number, "WG-000777");
  assert.equal(view.payment.reference, "WG-000777");
  assert.equal(view.ownerPreview, false);
  assert.equal((await app.fetch(get("/api/rechnung/" + token, await session("fremd@example.invalid")))).status, 403);
  assert.equal((await app.fetch(get("/api/rechnung/" + "0".repeat(64), await session(customer)))).status, 404);
  const preview = await (await app.fetch(get("/api/rechnung/" + token, cookie))).json();
  assert.equal(preview.ownerPreview, true);
  // Customers keep no access to the operator API.
  assert.equal((await app.fetch(get("/api/order/" + order.id, await session(customer)))).status, 403);
});

test("customer login link for an invoice portal is issued only to the order e-mail", async (t) => {
  const { env, app } = await fixture(t);
  const { token } = await invoicedOrder(env);
  await setting(env, "resendKey", await protect(env, "synthetic-resend"));
  await setting(env, "emailVerified", true);
  await setting(env, "sender", "panel@example.invalid");
  const mails = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    mails.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: "resend-login" }), { status: 200 });
  });
  const login = (email) =>
    app.fetch(
      new Request(origin + "/auth/request", {
        method: "POST",
        headers: { origin, "Content-Type": "application/json", "x-forwarded-for": "192.0.2.1" },
        body: JSON.stringify({ email, returnTo: "/rechnung/" + token }),
      }),
    );
  assert.equal((await login("fremd@example.invalid")).status, 200);
  assert.equal(mails.length, 0);
  assert.equal((await login(customer)).status, 200);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, [customer]);
  assert.match(mails[0].text, /PIN: \d{6}/);
});

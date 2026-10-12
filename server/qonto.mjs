import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { configuration, init } from "../src/worker.mjs";
import { AppError, need, cents, paidCents } from "../src/domain.mjs";
import { assertRecordOperation } from "../src/record-compat.mjs";

// Qonto Business API · https://docs.qonto.com
// Authentifizierung mit Organisations-Login und Secret Key: "Authorization: {login}:{secret}".
export const QONTO_BASE = "https://thirdparty.qonto.com";
// Betreiberentscheidung 13.10.2026: Zahlungsziel immer 7 Tage ab Rechnungsdatum.
export const PAYMENT_TERM_DAYS = 7;
// Steuersätze, die das Panel für deutsche Standardrechnungen anbietet.
export const VAT_OPTIONS = Object.freeze({
  1900: { rate: "0.19", label: "19 % Umsatzsteuer" },
  700: { rate: "0.07", label: "7 % Umsatzsteuer" },
  0: { rate: "0", label: "0 % · Kleinunternehmer (§ 19 UStG)", exemption: "S19.1" },
});
export const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

export const uuid = (value) =>
  typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const email = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();
export const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
const dayFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// Kalendertag in Europe/Berlin als YYYY-MM-DD.
export const berlinDay = (iso = new Date().toISOString()) => dayFormat.format(new Date(iso));
export const validDay = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
export function addDays(day, days) {
  need(validDay(day), "Ungültiges Datum.");
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
export const germanDay = (day) => (validDay(day) ? day.slice(8, 10) + "." + day.slice(5, 7) + "." + day.slice(0, 4) : "");
export const euro = (value) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value / 100);

// Qonto-Beträge kommen als Dezimalzeichenkette ("119.00") oder als {value,currency}.
export function amountCents(value) {
  const raw = value && typeof value === "object" ? value.value : value;
  need(typeof raw === "string" || typeof raw === "number", "Qonto-Betrag fehlt.", 502);
  const string = String(raw);
  need(/^\d+(?:\.\d{1,2})?$/.test(string), "Qonto-Betrag ist nicht centgenau.", 502);
  const [whole, fraction = ""] = string.split(".");
  return cents(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
}
export function invoiceTotalCents(remote) {
  if (Number.isSafeInteger(remote?.total_amount_cents)) return cents(remote.total_amount_cents);
  return amountCents(remote?.total_amount);
}

const queues = new Map();
function credentialsReady(config) {
  need(
    typeof config.qontoLogin === "string" &&
      config.qontoLogin.trim().length > 0 &&
      typeof config.qontoKey === "string" &&
      config.qontoKey.length > 0,
    "Qonto-Zugang fehlt. Bitte Login und Secret Key in den Einstellungen hinterlegen.",
    409,
  );
}
/**
 * Ein Anfragekanal pro Zugang: höchstens etwa drei Anfragen pro Sekunde, nie über Weiterleitungen.
 * @param {{qontoLogin?:string,qontoKey?:string,[key:string]:any}} config
 * @param {string} path
 * @param {RequestInit & {beforeSend?:()=>Promise<void>|void}} options
 */
export async function qontoRequest(config, path, options = {}) {
  credentialsReady(config);
  need(
    typeof path === "string" && path.startsWith("/v2/") && !path.includes("://") && !path.includes(".."),
    "Ungültiger Qonto-Endpunkt.",
  );
  const key = hash(config.qontoLogin + ":" + config.qontoKey),
    queue = queues.get(key) ?? { tail: Promise.resolve(), next: 0 };
  queues.set(key, queue);
  const { beforeSend, ...requestOptions } = options;
  const result = queue.tail.then(async () => {
    const wait = queue.next - Date.now();
    if (wait > 0) await delay(wait);
    if (beforeSend) await beforeSend();
    queue.next = Date.now() + 350;
    return fetch(QONTO_BASE + path, {
      ...requestOptions,
      headers: {
        Authorization: config.qontoLogin.trim() + ":" + config.qontoKey,
        Accept: "application/json",
        ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
        ...requestOptions.headers,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
  });
  queue.tail = result.then(
    () => {},
    () => {},
  );
  return result;
}
export async function limitedBytes(response, max, label = "Qonto-Antwort") {
  const length = response.headers.get("content-length");
  need(!length || (/^\d+$/.test(length) && Number(length) <= max), label + " ist zu groß.", 502);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      need(size <= max, label + " ist zu groß.", 502);
      chunks.push(Buffer.from(part.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, size);
}
// Fehlertexte von Qonto werden gekürzt und ohne Zugangsdaten angezeigt.
function providerMessage(data) {
  const first = Array.isArray(data?.errors) ? data.errors[0] : null;
  const detail = String(first?.detail ?? first?.message ?? first?.code ?? data?.message ?? "")
    .replace(/[A-Za-z0-9+/_=-]{28,}/g, "[…]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return { code: typeof first?.code === "string" ? first.code.slice(0, 80) : "", detail };
}
export class QontoError extends AppError {
  constructor(message, status, providerStatus, providerCode) {
    super(message, status);
    this.providerStatus = providerStatus;
    this.providerCode = providerCode;
  }
}
/**
 * @param {{qontoLogin?:string,qontoKey?:string,[key:string]:any}} config
 * @param {string} path
 * @param {RequestInit & {beforeSend?:()=>Promise<void>|void}} options
 */
export async function qontoJSON(config, path, options = {}) {
  const response = await qontoRequest(config, path, options);
  const bytes = await limitedBytes(response, 4 * 1024 * 1024);
  let data = {};
  if (bytes.length) {
    try {
      data = JSON.parse(bytes.toString("utf8"));
    } catch {
      if (response.ok) throw new AppError("Qonto-Antwort ist nicht lesbar.", 502);
      data = {};
    }
  }
  if (!response.ok) {
    const { code, detail } = providerMessage(data);
    const hint =
      response.status === 401
        ? " Login oder Secret Key wurde abgewiesen."
        : response.status === 403
          ? " Dem Qonto-Zugang fehlt die Berechtigung."
          : "";
    throw new QontoError(
      "Qonto hat die Anfrage nicht bestätigt (HTTP " +
        response.status +
        (code ? " · " + code : "") +
        ")." +
        hint +
        (detail ? " " + detail : ""),
      [401, 403, 404, 409, 422].includes(response.status) ? 409 : 502,
      response.status,
      code,
    );
  }
  need(data && typeof data === "object" && !Array.isArray(data), "Qonto-Antwort ist unvollständig.", 502);
  return data;
}

export async function qontoSchema(env) {
  await init(env);
  await env.DB.batch(
    [
      // Gleiche Struktur wie der bisherige Rechnungsvorgang; vorhandene Einträge bleiben erhalten.
      "CREATE TABLE IF NOT EXISTS invoice_claims(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,job_id TEXT,marker TEXT NOT NULL,org_id TEXT NOT NULL,client_id TEXT,payload TEXT,payload_hash TEXT,provider_id TEXT,stage TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,provider_id))",
      "CREATE TABLE IF NOT EXISTS invoice_documents(order_id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,asset_id TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS invoice_deliveries(job_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,kind TEXT NOT NULL,recipient TEXT NOT NULL,copy_to TEXT NOT NULL,processing_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,UNIQUE(order_id,kind))",
      "CREATE TABLE IF NOT EXISTS invoice_tokens(hash TEXT PRIMARY KEY,order_id TEXT NOT NULL,expires_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS invoice_checks(order_id TEXT PRIMARY KEY,checked_at TEXT NOT NULL,error TEXT)",
    ].map((sql) => env.DB.prepare(sql)),
  );
}

function accountsOf(organization) {
  return (organization.bank_accounts ?? [])
    .filter(
      (account) =>
        account &&
        account.status === "active" &&
        account.is_external_account !== true &&
        typeof account.iban === "string" &&
        /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(account.iban.replace(/\s+/g, "")),
    )
    .map((account) => ({
      iban: account.iban.replace(/\s+/g, ""),
      name: String(account.name ?? "Qonto-Konto").slice(0, 80),
      main: account.main === true,
    }));
}
// Lesende Kontoprüfung. Kontostände werden weder gespeichert noch angezeigt.
export async function qontoCheck(env) {
  await qontoSchema(env);
  const config = await configuration(env, ["qontoKey"]);
  const data = await qontoJSON(config, "/v2/organization");
  const organization = data.organization;
  need(
    organization && uuid(organization.id) && Array.isArray(organization.bank_accounts),
    "Qonto-Organisation wurde nicht eindeutig bestätigt.",
    502,
  );
  need(
    !config.qontoOrganizationId || config.qontoOrganizationId === organization.id,
    "Der Qonto-Zugang gehört zu einer anderen Organisation. Bestehende Rechnungszuordnung zuerst klären.",
    409,
  );
  const accounts = accountsOf(organization);
  need(accounts.length > 0, "Kein aktives Qonto-Konto mit IBAN gefunden.", 409);
  const current = await configuration(env, ["qontoKey"]);
  need(
    current.qontoKey === config.qontoKey && current.qontoLogin === config.qontoLogin,
    "Qonto-Zugang wurde während der Prüfung verändert. Bitte erneut prüfen.",
    409,
  );
  const preferred =
    accounts.find((account) => account.iban === config.qontoIban) ??
    accounts.find((account) => account.main) ??
    (accounts.length === 1 ? accounts[0] : null);
  const companyName = String(organization.legal_name ?? organization.name ?? "").slice(0, 200);
  const upsert = (key, value) =>
    env.DB.prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).bind(key, JSON.stringify(value));
  await env.DB.batch([
    upsert("qontoVerified", true),
    upsert("qontoOrganizationId", organization.id),
    upsert("qontoCompanyName", companyName),
    upsert("qontoAccounts", accounts),
    upsert("qontoIban", preferred?.iban ?? null),
    upsert("qontoCheckedAt", new Date().toISOString()),
  ]);
  return {
    ok: true,
    message:
      "Qonto-Verbindung lesend geprüft" +
      (companyName ? " (" + companyName + ")" : "") +
      ". Es wurde nichts erstellt oder versendet." +
      (preferred ? "" : " Bitte das Zahlungskonto für Rechnungen auswählen."),
    companyName,
    accounts: accounts.length,
  };
}
export async function qontoAccess(env) {
  await qontoSchema(env);
  const config = await configuration(env, ["qontoKey"]);
  need(
    config.qontoVerified === true && uuid(config.qontoOrganizationId) && config.qontoKey && config.qontoLogin,
    "Bitte Qonto zuerst in den Einstellungen verbinden und prüfen.",
    409,
  );
  return config;
}

// Liest einen vollständigen paginierten Qonto-Bestand.
async function pages(config, path, field, maxPages = 100) {
  const rows = [],
    ids = new Set();
  let total = null;
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(QONTO_BASE + path);
    url.searchParams.set("page", String(page));
    const data = await qontoJSON(config, url.pathname + url.search);
    const meta = data.meta;
    need(
      Array.isArray(data[field]) &&
        meta &&
        Number.isInteger(meta.current_page) &&
        meta.current_page === page &&
        Number.isInteger(meta.total_pages) &&
        meta.total_pages >= 0 &&
        Number.isInteger(meta.total_count) &&
        meta.total_count >= 0,
      "Qonto-Bestand ist unvollständig gelesen.",
      502,
    );
    if (total === null) total = meta.total_count;
    else need(total === meta.total_count, "Qonto-Bestand hat sich während der Prüfung geändert.", 409);
    for (const row of data[field]) {
      need(row && uuid(row.id) && !ids.has(row.id), "Qonto-ID fehlt oder ist doppelt.", 502);
      ids.add(row.id);
      rows.push(row);
    }
    if (page >= Math.max(1, meta.total_pages)) {
      need(rows.length === total, "Nicht alle Qonto-Einträge wurden gelesen.", 502);
      return rows;
    }
  }
  throw new AppError("Qonto-Bestand ist zu groß für einen vollständigen Abgleich.", 409);
}

// ---------- Rechnungskunden ----------
export function qontoClientName(client) {
  const person = [client?.first_name, client?.last_name].filter(Boolean).join(" ").trim();
  return (client?.kind ?? client?.type) === "individual" ? person || String(client?.name ?? "") : String(client?.name ?? person);
}
function addressOf(client) {
  const a = client?.billing_address ?? {};
  return {
    street_address: String(a.street_address ?? ""),
    city: String(a.city ?? ""),
    zip_code: String(a.zip_code ?? ""),
    country_code: String(a.country_code ?? "").toUpperCase(),
  };
}
export function qontoClientReviewHash(client, order) {
  return hash({
    id: client.id,
    kind: client.kind ?? client.type ?? "",
    name: qontoClientName(client),
    email: email(client.email),
    orderEmail: email(order.source.email),
    address: addressOf(client),
    currency: client.currency ?? null,
    vat: client.vat_number ?? null,
    tax: client.tax_identification_number ?? null,
  });
}
export function qontoClientView(client, order) {
  return {
    id: client.id,
    kind: client.kind ?? client.type ?? "",
    name: qontoClientName(client),
    email: email(client.email),
    currency: client.currency ?? null,
    billing_address: addressOf(client),
    complete: clientProblem(client, order) === null,
    problem: clientProblem(client, order),
    reviewHash: qontoClientReviewHash(client, order),
  };
}
function clientProblem(client, order) {
  if (!uuid(client?.id)) return "Qonto-Kunden-ID fehlt.";
  if (validEmail(order.source.email) && email(client.email) !== email(order.source.email))
    return "Qonto-Kunde gehört nicht zur E-Mail-Adresse dieses Auftrags.";
  const address = addressOf(client);
  if (!address.street_address || !address.city || !address.zip_code || address.country_code !== "DE")
    return "Vollständige deutsche Rechnungsadresse fehlt im Qonto-Kunden. Bitte in Qonto ergänzen.";
  if (client.currency !== "EUR") return "Für den Qonto-Kunden ist keine Währung EUR hinterlegt. Bitte in Qonto ergänzen.";
  if (!qontoClientName(client)) return "Name des Qonto-Kunden fehlt.";
  return null;
}
export function validateQontoClient(client, order) {
  const problem = clientProblem(client, order);
  need(!problem, problem, 409);
  return client;
}
// Mit Kunden-E-Mail: exakter E-Mail-Treffer. Ohne E-Mail: Namenssuche, der Betreiber wählt ausdrücklich aus.
export async function qontoFindClients(config, order) {
  if (validEmail(order.source.email)) {
    const params = new URLSearchParams({ "filter[email]": email(order.source.email), per_page: "100" });
    const rows = await pages(config, "/v2/clients?" + params.toString(), "clients", 10);
    return rows.filter((client) => email(client.email) === email(order.source.email));
  }
  const name = String(order.source.name ?? "").trim();
  if (name.length < 2) return [];
  const params = new URLSearchParams({ "filter[name]": name.slice(0, 120), per_page: "100" });
  return pages(config, "/v2/clients?" + params.toString(), "clients", 3);
}
export function qontoClientPayload(order, billing) {
  const bounded = (value, max, message) => {
    need(typeof value === "string" && value.trim().length > 0 && value.trim().length <= max, message);
    return value.trim();
  };
  need(billing && ["individual", "company"].includes(billing.kind), "Bitte Privat- oder Firmenkunde auswählen.");
  const address = {
    street_address: bounded(billing.street, 250, "Straße und Hausnummer fehlen."),
    city: bounded(billing.city, 50, "Ort fehlt oder ist zu lang."),
    zip_code: bounded(billing.zip, 20, "Postleitzahl fehlt."),
    country_code: bounded(billing.country, 2, "Land fehlt.").toUpperCase(),
  };
  need(address.country_code === "DE", "Dieser Rechnungsablauf ist für deutsche Rechnungsadressen geprüft.");
  const identity =
    billing.kind === "company"
      ? { name: bounded(billing.name, 250, "Firmenname fehlt.") }
      : {
          first_name: bounded(billing.firstName, 60, "Vorname fehlt."),
          last_name: bounded(billing.lastName, 60, "Nachname fehlt."),
        };
  return {
    kind: billing.kind,
    ...identity,
    ...(validEmail(order.source.email) ? { email: email(order.source.email) } : {}),
    currency: "EUR",
    locale: "de",
    billing_address: address,
  };
}
export async function qontoInventory(env, order) {
  // Gesperrte Kundenakten erreichen Qonto auch nicht über die Vorschau.
  assertRecordOperation(order, "invoice");
  need(!order.synthetic, "Testaufträge haben keine externen Rechnungskunden.", 409);
  const config = await qontoAccess(env);
  const clients = await qontoFindClients(config, order);
  const issueDate = berlinDay();
  return {
    number: invoiceNumberFor(order),
    clients: clients.map((client) => qontoClientView(client, order)),
    accounts: Array.isArray(config.qontoAccounts) ? config.qontoAccounts : [],
    iban: config.qontoIban ?? null,
    companyName: config.qontoCompanyName ?? "",
    issueDate,
    dueDate: addDays(issueDate, PAYMENT_TERM_DAYS),
    paymentTermDays: PAYMENT_TERM_DAYS,
    customerEmail: validEmail(order.source.email) ? email(order.source.email) : "",
    paidCents: paidCents(order),
    mailReady: config.emailVerified === true && config.sendApproved === true && Boolean(config.sender),
  };
}

// ---------- Rechnungsinhalt ----------
export function qontoNetValue(grossCents, vatBasisPoints, decimals = 6) {
  cents(grossCents);
  need([0, 700, 1900].includes(vatBasisPoints), "Ungültiger Steuersatz.");
  if (vatBasisPoints === 0) return (BigInt(grossCents) / 100n).toString() + "." + String(grossCents % 100).padStart(2, "0");
  if (decimals === 2) return centNet(grossCents, vatBasisPoints);
  // Netto mit sechs Nachkommastellen, damit Netto + Steuer exakt den vereinbarten Bruttopreis ergibt.
  const denominator = BigInt(10000 + vatBasisPoints),
    micro = (BigInt(grossCents) * 10000n * 10000n + denominator / 2n) / denominator;
  let fraction = (micro % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (fraction.length < 2) fraction = fraction.padEnd(2, "0");
  return (micro / 1000000n).toString() + "." + fraction;
}
// Centgenaues Netto, dessen gerundete Steuer möglichst exakt den Bruttopreis ergibt.
function centNet(grossCents, vatBasisPoints) {
  const rate = vatBasisPoints / 10000,
    exact = Math.round((grossCents * 10000) / (10000 + vatBasisPoints));
  let best = exact;
  for (let candidate = exact - 3; candidate <= exact + 3; candidate++)
    if (candidate >= 0 && candidate + Math.round(candidate * rate) === grossCents) {
      best = candidate;
      break;
    }
  return Math.floor(best / 100) + "." + String(best % 100).padStart(2, "0");
}
export function invoiceLines(order) {
  const lines = order.offer?.lines?.length
    ? order.offer.lines
    : [{ title: "Fahrzeugaufbereitung", description: order.offer?.services ?? "", amountCents: order.offer?.totalCents }];
  need(Array.isArray(lines) && lines.length > 0 && lines.length <= 100, "Bestätigte Leistungen fehlen.", 409);
  for (const line of lines)
    need(
      Number.isSafeInteger(line?.amountCents) && line.amountCents >= 0 && String(line.title ?? "").trim(),
      "Eine Leistungsposition ist unvollständig.",
      409,
    );
  need(
    Number.isSafeInteger(order.offer?.totalCents) &&
      order.offer.totalCents > 0 &&
      lines.reduce((sum, line) => sum + line.amountCents, 0) === order.offer.totalCents,
    "Leistungspositionen stimmen nicht mit dem vereinbarten Festpreis überein.",
    409,
  );
  return lines;
}
export function eligibleForInvoice(order, input) {
  need(!order.synthetic, "Testaufträge erzeugen keine echten Rechnungen.", 409);
  need(
    ["Erledigt", "Bezahlt"].includes(order.status) && order.completedAt && order.offer,
    "Abrechnung erst nach Arbeitsabschluss mit vereinbartem Festpreis.",
    409,
  );
  need(Number.isFinite(Date.parse(order.completedAt)), "Arbeitsabschlussdatum fehlt.", 409);
  need(input && ["invoice", "paid"].includes(input.mode), "Bitte Rechnung oder Quittung auswählen.");
  need(input.reviewed === true, "Bitte Kunde, Leistungen, Steuer und Betrag ausdrücklich prüfen und bestätigen.");
  need(
    Object.hasOwn(VAT_OPTIONS, String(input.vatBasisPoints)) && Number.isInteger(input.vatBasisPoints),
    "Bitte den Umsatzsteuersatz auswählen.",
  );
  if (input.mode === "invoice")
    need(
      paidCents(order) === 0,
      "Für diesen Auftrag sind bereits Zahlungen erfasst. Eine Rechnung über einen Restbetrag ist nicht vorgesehen: Zahlung vollständig erfassen und als Quittung abrechnen oder die Teilzahlung im Auftrag stornieren.",
      409,
    );
  if (input.mode === "paid") {
    need(["Bar", "Karte", "Überweisung"].includes(input.paymentMethod), "Bitte die Zahlungsart auswählen.");
    need(validDay(input.paidAt) && input.paidAt <= berlinDay(), "Zahlungsdatum muss ein gültiger Tag bis heute sein.");
  }
  invoiceLines(order);
}
// Rechnungsnummer = WG-Nummer. Nach einer Stornierung in Qonto erhält die neue Rechnung eine fortlaufende Endung.
export function invoiceNumberFor(order) {
  if (order.invoice?.provider === "qonto" && order.invoice.status === "canceled")
    return order.wg + "-" + ((Array.isArray(order.invoiceHistory) ? order.invoiceHistory.length : 0) + 2);
  return order.wg;
}
export function invoiceTexts(order, input, issueDate, dueDate, number = invoiceNumberFor(order)) {
  const total = euro(order.offer.totalCents),
    vehicle = [order.source.vehicle, order.source.plate].filter(Boolean).join(" · ");
  const header =
    "Vielen Dank für Ihren Auftrag. Wir berechnen die vereinbarten Leistungen zu Auftrag " +
    order.wg +
    (vehicle ? " (Fahrzeug: " + vehicle + ")" : "") +
    ".";
  const tax = input.vatBasisPoints === 0 ? " Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." : "";
  const footer =
    input.mode === "paid"
      ? "Der Rechnungsbetrag von " +
        total +
        " wurde am " +
        germanDay(input.paidAt) +
        ({ Bar: " in bar", Karte: " per Kartenzahlung", Überweisung: " per Überweisung" }[input.paymentMethod] ?? "") +
        " vollständig bezahlt. Diese Rechnung gilt zugleich als Quittung." +
        tax +
        " Vielen Dank!"
      : "Bitte überweisen Sie " +
        total +
        " innerhalb von " +
        PAYMENT_TERM_DAYS +
        " Tagen bis zum " +
        germanDay(dueDate) +
        " ohne Abzug auf das angegebene Konto. Verwendungszweck: " +
        number +
        "." +
        tax;
  return { header: header.slice(0, 600), footer: footer.slice(0, 600), issueDate };
}
export function qontoInvoicePayload(
  order,
  input,
  clientId,
  iban,
  now = new Date().toISOString(),
  decimals = 6,
  number = invoiceNumberFor(order),
) {
  eligibleForInvoice(order, input);
  need(uuid(clientId), "Qonto-Rechnungskunde fehlt.");
  need(typeof iban === "string" && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban), "Qonto-Zahlungskonto fehlt.", 409);
  const issueDate = berlinDay(now),
    dueDate = input.mode === "invoice" ? addDays(issueDate, PAYMENT_TERM_DAYS) : issueDate,
    vat = VAT_OPTIONS[input.vatBasisPoints],
    texts = invoiceTexts(order, input, issueDate, dueDate, number);
  const end = berlinDay(order.completedAt),
    startCandidate = berlinDay(order.intake?.at ?? order.intake?.savedAt ?? order.completedAt),
    start = startCandidate <= end ? startCandidate : end;
  need(end <= issueDate, "Arbeitsabschluss liegt nach dem Rechnungsdatum.", 409);
  const items = invoiceLines(order).map((line) => {
    const title = String(line.title).trim().replace(/\s+/g, " "),
      short = title.length <= 40 ? title : title.slice(0, 39).trimEnd() + "…",
      details = [title.length > 40 ? title : "", String(line.description ?? "").trim()].filter(Boolean).join("\n"),
      description = details.length <= 300 ? details : details.slice(0, 299).trimEnd() + "…";
    return {
      title: short,
      ...(description ? { description } : {}),
      quantity: "1",
      unit_price: { value: qontoNetValue(line.amountCents, input.vatBasisPoints, decimals), currency: "EUR" },
      vat_rate: vat.rate,
      ...(vat.exemption ? { vat_exemption_reason: vat.exemption } : {}),
    };
  });
  return {
    client_id: clientId,
    issue_date: issueDate,
    due_date: dueDate,
    performance_start_date: start,
    performance_end_date: end,
    status: "draft",
    number,
    currency: "EUR",
    payment_methods: { iban },
    header: texts.header,
    footer: texts.footer,
    items,
  };
}

// ---------- Rechnungen lesen ----------
export async function readQontoInvoice(config, id) {
  need(uuid(id), "Qonto-Rechnungs-ID fehlt.", 409);
  const data = await qontoJSON(config, "/v2/client_invoices/" + id);
  const remote = data.client_invoice;
  need(remote && remote.id === id, "Qonto-Rechnung wurde nicht eindeutig geliefert.", 502);
  return remote;
}
// Sucht eine Rechnung über die eindeutige WG-Nummer (einschließlich Entwürfen und Importen).
export async function findQontoInvoiceByNumber(config, number, since = null) {
  const params = new URLSearchParams({ exclude_imported: "false", per_page: "100" });
  if (since) params.set("filter[created_at_from]", new Date(Date.parse(since) - 86400000).toISOString());
  const rows = await pages(config, "/v2/client_invoices?" + params.toString(), "client_invoices", since ? 20 : 100);
  const matches = rows.filter((row) => row.number === number);
  need(matches.length <= 1, "Mehrere Qonto-Rechnungen mit der Nummer " + number + ". Bitte in Qonto klären.", 409);
  return matches[0] ?? null;
}
export function remoteInvoiceProblem(
  remote,
  order,
  clientId = null,
  number = order.invoice?.number ?? order.wg,
  expectedTotal = order.invoice?.number === number && Number.isSafeInteger(order.invoice?.totalCents)
    ? order.invoice.totalCents
    : order.offer.totalCents,
) {
  if (!remote || !uuid(remote.id)) return "Qonto-Rechnung fehlt.";
  if (remote.number !== number) return "Qonto-Rechnungsnummer weicht von " + number + " ab.";
  if ((remote.currency ?? remote.total_amount?.currency) !== "EUR") return "Qonto-Rechnung ist nicht in EUR.";
  let total;
  try {
    total = invoiceTotalCents(remote);
  } catch {
    return "Qonto-Rechnungsbetrag ist nicht lesbar.";
  }
  if (total !== expectedTotal)
    return "Qonto berechnet " + euro(total) + " statt des vereinbarten Festpreises " + euro(expectedTotal) + ".";
  if (clientId && remote.client?.id && remote.client.id !== clientId)
    return "Qonto-Rechnung gehört zu einem anderen Rechnungskunden.";
  if (!["draft", "unpaid", "paid", "canceled"].includes(remote.status)) return "Unbekannter Qonto-Rechnungsstatus.";
  return null;
}
export function invoiceSummary(remote) {
  const method = remote.payment_methods ?? {};
  let url = null;
  try {
    const parsed = new URL(String(remote.invoice_url ?? ""));
    if (parsed.protocol === "https:" && /(^|\.)qonto\.(com|co)$/.test(parsed.hostname)) url = parsed.href;
  } catch {
    url = null;
  }
  return {
    provider: "qonto",
    id: remote.id,
    number: remote.number,
    totalCents: invoiceTotalCents(remote),
    status: remote.status,
    issueDate: validDay(remote.issue_date) ? remote.issue_date : null,
    dueDate: validDay(remote.due_date) ? remote.due_date : null,
    paidAt: typeof remote.paid_at === "string" ? remote.paid_at.slice(0, 10) : null,
    url,
    payment: {
      iban: typeof method.iban === "string" ? method.iban : "",
      bic: typeof method.bic === "string" ? method.bic : "",
      beneficiary: typeof method.beneficiary_name === "string" ? method.beneficiary_name : "",
    },
  };
}

// Lesender Nummernabgleich: höchste in Qonto verwendete WG-Nummer für den einmaligen WG-Nummernabgleich.
export async function qontoNumberCheck(config) {
  need(config.qontoVerified === true && config.qontoKey && config.qontoLogin, "Qonto zuerst verbinden und prüfen.", 409);
  const params = new URLSearchParams({ exclude_imported: "false", per_page: "100" });
  const rows = await pages(config, "/v2/client_invoices?" + params.toString(), "client_invoices", 100);
  let maxNumber = 0,
    otherWgNumbers = 0;
  for (const row of rows) {
    const match = /^WG-(\d+)$/.exec(String(row.number ?? ""));
    if (match) {
      need(Number.isSafeInteger(Number(match[1])), "Qonto-WG-Nummer ist ungültig.", 502);
      maxNumber = Math.max(maxNumber, Number(match[1]));
    } else if (/^WG/i.test(String(row.number ?? ""))) otherWgNumbers++;
  }
  return {
    provider: "qonto",
    count: rows.length,
    maxNumber,
    otherWgNumbers,
    at: new Date().toISOString(),
    note: "Qonto-Rechnungen einschließlich Entwürfen und importierter Rechnungen gelesen. Rechnungsnummer = WG-Nummer des Auftrags.",
  };
}

// Vergleicht eine vorhandene Qonto-Rechnung mit den gerade geprüften Angaben.
// Entwürfe: alle rechnungsbestimmenden Felder. Ausgestellte Rechnungen: Positionen, Steuer und Art (Rechnung/Quittung).
export function invoiceTermsProblem(remote, payload, mode) {
  const num = (value) => (value === undefined || value === null || value === "" ? NaN : Number(value));
  const remoteItems = Array.isArray(remote.items) ? remote.items : null;
  if (!remoteItems || remoteItems.length !== payload.items.length) return "Positionen weichen ab.";
  for (let index = 0; index < payload.items.length; index++) {
    const want = payload.items[index],
      have = remoteItems[index] ?? {};
    const price = num(have.unit_price && typeof have.unit_price === "object" ? have.unit_price.value : have.unit_price);
    if (String(have.title ?? "").trim() !== want.title) return "Positionstitel weichen ab.";
    if (num(have.quantity) !== num(want.quantity)) return "Mengen weichen ab.";
    if (Math.abs(num(have.vat_rate) - num(want.vat_rate)) > 1e-9 || Number.isNaN(num(have.vat_rate)))
      return "Umsatzsteuersatz weicht ab.";
    if (!(Math.abs(price - num(want.unit_price.value)) <= 0.005)) return "Positionspreise weichen ab.";
  }
  const footer = String(remote.footer ?? "");
  if (/Quittung/.test(footer) !== (mode === "paid")) return "Rechnungsart (Rechnung oder Quittung) weicht ab.";
  if (remote.status === "draft") {
    if (remote.due_date !== payload.due_date || remote.issue_date !== payload.issue_date) return "Rechnungs- oder Fälligkeitsdatum weicht ab.";
    if ((remote.payment_methods?.iban ?? "") !== payload.payment_methods.iban) return "Zahlungskonto weicht ab.";
    if (footer.trim() !== payload.footer.trim()) return "Rechnungstext weicht ab.";
  }
  return null;
}

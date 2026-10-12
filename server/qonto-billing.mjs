import { randomUUID, randomBytes } from "node:crypto";
import { configuration, settings, getOrder, saveOrder, claimJob } from "../src/worker.mjs";
import { AppError, need, transition, paidCents, optionalTime } from "../src/domain.mjs";
import { COMPANY } from "../src/company.mjs";
import {
  recordOperationIssue,
  assertRecordOperation,
  assertCurrentRecordOperation,
} from "../src/record-compat.mjs";
import { digest } from "./auth.mjs";
import {
  QontoError,
  qontoSchema,
  qontoAccess,
  qontoJSON,
  qontoFindClients,
  qontoClientPayload,
  qontoClientReviewHash,
  validateQontoClient,
  qontoInvoicePayload,
  eligibleForInvoice,
  invoiceLines,
  readQontoInvoice,
  findQontoInvoiceByNumber,
  remoteInvoiceProblem,
  invoiceSummary,
  invoiceNumberFor,
  limitedBytes,
  berlinDay,
  addDays,
  germanDay,
  validDay,
  euro,
  email,
  validEmail,
  uuid,
  hash,
  VAT_OPTIONS,
  PAYMENT_TERM_DAYS,
} from "./qonto.mjs";

// Mahnwesen ohne Gebühren: Erinnerung, 1. und 2. Mahnung. Jede Stufe setzt eine neue Frist von 7 Tagen.
export const DUNNING = Object.freeze([
  Object.freeze({ level: 1, kind: "reminder-1", label: "Zahlungserinnerung", afterDueDays: 3 }),
  Object.freeze({ level: 2, kind: "reminder-2", label: "1. Mahnung", afterDueDays: 14 }),
  Object.freeze({ level: 3, kind: "reminder-3", label: "2. Mahnung", afterDueDays: 28 }),
]);
export const REMINDER_GRACE_DAYS = 7;
const PORTAL_DAYS = 400;
const guardSQL = "EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
const jobKindOf = (kind) => (kind === "invoice" ? "invoice-mail" : "invoice-" + kind);
const isReminder = (kind) => DUNNING.some((stage) => stage.kind === kind);
const isCopy = (kind) => /^copy-\d{13}$/.test(kind);
export function deliveryLabel(order, kind) {
  if (isReminder(kind)) return DUNNING.find((stage) => stage.kind === kind).label;
  return order?.invoice?.mode === "paid" ? "Rechnung mit Quittung" : "Rechnung";
}
async function finishJob(env, id, state, providerId = null, detail = null) {
  await env.DB.prepare("UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=?")
    .bind(state, providerId, detail, new Date().toISOString(), id)
    .run();
}
const claimRow = (env, orderId) =>
  env.DB.prepare("SELECT * FROM invoice_claims WHERE order_id=?").bind(orderId).first();
const setStage = (env, orderId, stage, extra = {}) =>
  env.DB.prepare(
    "UPDATE invoice_claims SET stage=?,client_id=COALESCE(?,client_id),provider_id=COALESCE(?,provider_id),payload=COALESCE(?,payload),payload_hash=COALESCE(?,payload_hash) WHERE order_id=?",
  )
    .bind(
      stage,
      extra.clientId ?? null,
      extra.providerId ?? null,
      extra.payload ? JSON.stringify(extra.payload) : null,
      extra.payload ? hash(extra.payload) : null,
      orderId,
    )
    .run();
// Zahlungszeitpunkt aus einem Kalendertag: heute → jetzt, sonst 12:00 Uhr Europe/Berlin.
export function paidMoment(day) {
  if (!validDay(day) || day === berlinDay()) return new Date().toISOString();
  return optionalTime(day + "T12:00");
}
const sameOffer = (a, b) => hash(a?.offer ?? null) === hash(b?.offer ?? null);
const reissuable = (order) => order.invoice?.provider === "qonto" && order.invoice.status === "canceled";
async function currentVersion(env, order) {
  const current = await getOrder(env, order.id);
  assertRecordOperation(current, "invoice");
  need(
    current.version === order.version &&
      (!current.invoice || (reissuable(current) && current.invoice.id === order.invoice?.id)) &&
      sameOffer(current, order),
    "Auftrag wurde inzwischen verändert. Bitte neu öffnen und erneut abrechnen.",
    409,
  );
  return current;
}

// Nach einer Stornierung in Qonto: bisherigen Vorgang archivieren, damit eine neue Rechnung ausgestellt werden kann.
async function archiveCanceledInvoice(env, order, number) {
  const tag = "#" + order.invoice.id,
    now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET state='cancelled',detail='Rechnung storniert – Versand entfällt.',updated_at=? WHERE order_id=? AND kind LIKE 'invoice-%' AND instr(kind,'#')=0 AND state IN ('queued','failed','unknown')",
    ).bind(now, order.id),
    env.DB.prepare(
      "UPDATE jobs SET kind=kind||? WHERE order_id=? AND (kind='invoice' OR kind LIKE 'invoice-%') AND instr(kind,'#')=0",
    ).bind(tag, order.id),
    env.DB.prepare("UPDATE invoice_deliveries SET kind=kind||? WHERE order_id=? AND instr(kind,'#')=0").bind(tag, order.id),
    env.DB.prepare("UPDATE invoice_tokens SET revoked=1 WHERE order_id=?").bind(order.id),
    env.DB.prepare("DELETE FROM invoice_documents WHERE order_id=?").bind(order.id),
    env.DB.prepare(
      "UPDATE invoice_claims SET marker=?,stage='preflight',provider_id=NULL,client_id=NULL,payload=NULL,payload_hash=NULL,job_id=NULL,created_at=? WHERE order_id=? AND provider='qonto'",
    ).bind(number, now, order.id),
  ]);
}

// ---------- Rechnung oder Quittung erstellen ----------
export async function qontoInvoice(env, order, input) {
  assertRecordOperation(order, "invoice");
  eligibleForInvoice(order, input);
  const reissue = reissuable(order),
    number = invoiceNumberFor(order);
  need(!order.invoice || reissue, "Für diesen Auftrag ist bereits eine Rechnung zugeordnet.", 409);
  const config = await qontoAccess(env);
  need(config.numberAudit === true, "WG-Nummernabgleich fehlt. Bitte zuerst in den Einstellungen bestätigen.", 409);
  const accounts = Array.isArray(config.qontoAccounts) ? config.qontoAccounts : [];
  need(
    typeof config.qontoIban === "string" && accounts.some((account) => account.iban === config.qontoIban),
    "Bitte das Qonto-Zahlungskonto in den Einstellungen auswählen und speichern.",
    409,
  );
  qontoInvoicePayload(order, input, "00000000-0000-4000-8000-000000000000", config.qontoIban, undefined, 6, number);
  const sendMail = input.sendMail === true;
  if (sendMail) {
    need(validEmail(order.source.email), "Für den E-Mail-Versand fehlt eine gültige Kunden-E-Mail.", 409);
    need(
      config.emailVerified === true && config.sendApproved === true && config.sender,
      "E-Mail-Versand ist noch nicht geprüft und freigegeben. Haken „per E-Mail senden“ entfernen oder Versand in den Einstellungen freigeben.",
      409,
    );
  }
  if (input.mode === "invoice")
    need(
      paidCents(order) < order.offer.totalCents,
      "Der volle Betrag ist bereits als bezahlt erfasst. Bitte „Bereits bezahlt · Quittung“ wählen.",
      409,
    );
  let claim = await claimRow(env, order.id);
  need(
    !claim || claim.provider === "qonto",
    "Für diesen Auftrag besteht ein früherer Rechnungsvorgang (" +
      (claim?.provider ?? "") +
      "). Es wird keine zweite Rechnung erstellt; bitte zuerst klären.",
    409,
  );
  need(
    !claim || claim.org_id === config.qontoOrganizationId,
    "Der Rechnungsvorgang gehört zu einer anderen Qonto-Organisation.",
    409,
  );
  await currentVersion(env, order);
  if (reissue && claim?.marker !== number) {
    await archiveCanceledInvoice(env, order, number);
    claim = await claimRow(env, order.id);
  }
  // Ein früherer, nicht abgeschlossener Vorgang wird über die eindeutige Rechnungsnummer sicher fortgesetzt.
  await env.DB.prepare(
    "UPDATE jobs SET state='failed',detail='Früherer Rechnungsvorgang wird über die WG-Nummer abgeglichen.',updated_at=? WHERE order_id=? AND kind='invoice' AND state IN ('unknown','draft')",
  )
    .bind(new Date().toISOString(), order.id)
    .run();
  const job = await claimJob(env, order, "invoice");
  need(job, "Die Abrechnung läuft bereits oder ist abgeschlossen. Bitte den Auftrag neu öffnen.", 409);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO invoice_claims(order_id,provider,marker,org_id,stage,created_at) VALUES(?,'qonto',?,?,'preflight',?)",
  )
    .bind(order.id, number, config.qontoOrganizationId, new Date().toISOString())
    .run();
  await env.DB.prepare("UPDATE invoice_claims SET job_id=? WHERE order_id=?").bind(job, order.id).run();
  claim = await claimRow(env, order.id);
  const guardWrite = () => assertCurrentRecordOperation(env, order, "invoice", order.version);
  try {
    // 1. Rechnungskunde
    const candidates = await qontoFindClients(config, order);
    let client;
    if (input.clientId) {
      need(
        candidates.some((item) => item.id === input.clientId),
        "Bitte einen zu diesem Auftrag passenden Qonto-Kunden auswählen.",
        409,
      );
      const fresh = (await qontoJSON(config, "/v2/clients/" + input.clientId)).client;
      need(fresh && fresh.id === input.clientId, "Qonto-Kunde wurde nicht eindeutig geliefert.", 502);
      client = validateQontoClient(fresh, order);
      need(
        input.clientReviewHash === qontoClientReviewHash(client, order),
        "Die Qonto-Kundendaten wurden seit der Vorschau verändert. Bitte den Dialog neu öffnen.",
        409,
      );
    } else {
      need(
        !validEmail(order.source.email) || candidates.length === 0,
        "Ein Qonto-Kunde mit dieser E-Mail ist bereits vorhanden. Bitte ihn auswählen.",
        409,
      );
      const payload = qontoClientPayload(order, input.billing);
      await setStage(env, order.id, "client-attempt");
      const created = (
        await qontoJSON(config, "/v2/clients", {
          method: "POST",
          body: JSON.stringify(payload),
          beforeSend: guardWrite,
        })
      ).client;
      need(created && uuid(created.id), "Qonto-Kundenanlage wurde nicht eindeutig bestätigt.", 502);
      await setStage(env, order.id, "client-ready", { clientId: created.id });
      client = validateQontoClient(created, order);
    }
    // 2. Rechnung über die eindeutige WG-Nummer finden oder als Entwurf anlegen
    let remote = await findQontoInvoiceByNumber(config, number, claim.created_at),
      createdNow = false;
    if (!remote) {
      let payload = qontoInvoicePayload(order, input, client.id, config.qontoIban, undefined, 6, number);
      await setStage(env, order.id, "draft-attempt", { clientId: client.id, payload });
      const create = (body) =>
        qontoJSON(config, "/v2/client_invoices", {
          method: "POST",
          body: JSON.stringify(body),
          beforeSend: guardWrite,
        });
      try {
        remote = (await create(payload)).client_invoice;
        createdNow = true;
      } catch (error) {
        if (error instanceof QontoError && error.providerStatus === 409) {
          remote = await findQontoInvoiceByNumber(config, number);
          need(remote, error.message, 409);
        } else if (
          error instanceof QontoError &&
          error.providerStatus === 422 &&
          payload.items.some((item) => /\.\d{3,}$/.test(item.unit_price.value))
        ) {
          // Falls Qonto nur centgenaue Nettopreise annimmt: einmal mit centgenauen Preisen anlegen und Summe prüfen.
          payload = qontoInvoicePayload(order, input, client.id, config.qontoIban, undefined, 2, number);
          await setStage(env, order.id, "draft-attempt", { payload });
          remote = (await create(payload)).client_invoice;
          createdNow = true;
        } else throw error;
      }
      need(remote && uuid(remote.id), "Qonto-Rechnungsentwurf wurde nicht eindeutig bestätigt.", 502);
    }
    const problem = remoteInvoiceProblem(remote, order, client.id, number);
    if (problem) {
      if (createdNow && remote.status === "draft") {
        await qontoJSON(config, "/v2/client_invoices/" + remote.id, { method: "DELETE" }).catch(() => null);
        await setStage(env, order.id, "preflight");
        throw new AppError(
          problem + " Der Entwurf wurde in Qonto wieder gelöscht; es wurde keine Rechnung ausgestellt.",
          409,
        );
      }
      throw new AppError(problem + " Bitte die Rechnung " + number + " in Qonto prüfen.", 409);
    }
    await setStage(env, order.id, remote.status, { clientId: client.id, providerId: remote.id });
    need(remote.status !== "canceled", "Die Rechnung " + number + " ist in Qonto storniert. Bitte dort klären.", 409);
    // 3. Endgültig ausstellen
    if (remote.status === "draft") {
      await setStage(env, order.id, "finalize-attempt");
      remote = (
        await qontoJSON(config, "/v2/client_invoices/" + remote.id + "/finalize", {
          method: "POST",
          beforeSend: guardWrite,
        })
      ).client_invoice;
      const finalProblem = remoteInvoiceProblem(remote, order, client.id, number);
      need(!finalProblem, finalProblem, 409);
      need(remote.status === "unpaid" || remote.status === "paid", "Qonto hat die Rechnung nicht ausgestellt.", 502);
      await setStage(env, order.id, "finalized");
    }
    // 4. Quittung: in Qonto als bezahlt markieren
    if (input.mode === "paid" && remote.status === "unpaid") {
      await setStage(env, order.id, "paid-attempt");
      remote = (
        await qontoJSON(config, "/v2/client_invoices/" + remote.id + "/mark_as_paid", {
          method: "POST",
          // Qonto erwartet kein Zahlungsdatum vor dem Rechnungsdatum; das tatsächliche Datum steht im Quittungsvermerk.
          body: JSON.stringify({ paid_at: [input.paidAt, validDay(remote.issue_date) ? remote.issue_date : berlinDay()].sort()[1] }),
          beforeSend: guardWrite,
        })
      ).client_invoice;
      need(remote?.status === "paid", "Qonto hat die Zahlung nicht bestätigt.", 502);
    }
    // 5. Im Panel speichern
    const current = await getOrder(env, order.id);
    need(
      !current.invoice || current.invoice.id === remote.id || (reissue && current.invoice.id === order.invoice.id),
      "Eine andere Rechnung ist bereits zugeordnet.",
      409,
    );
    need(sameOffer(current, order), "Leistungen wurden während der Abrechnung geändert. Bitte prüfen.", 409);
    let updated = structuredClone(current);
    const open = updated.offer.totalCents - paidCents(updated);
    if (input.mode === "paid" && open > 0)
      updated = transition(updated, "payment", {
        amountCents: open,
        at: paidMoment(input.paidAt),
        method: input.paymentMethod,
        cashConfirmed: input.paymentMethod === "Bar",
        note: "Quittung zu Rechnung " + remote.number,
      });
    const token = randomBytes(32).toString("hex"),
      now = new Date().toISOString(),
      operationId = randomUUID();
    if (reissue && updated.invoice?.id === order.invoice.id)
      updated.invoiceHistory = [...(Array.isArray(updated.invoiceHistory) ? updated.invoiceHistory : []), updated.invoice];
    updated.invoice = {
      ...invoiceSummary(remote),
      mode: input.mode,
      paymentMethod: input.mode === "paid" ? input.paymentMethod : null,
      vatBasisPoints: input.vatBasisPoints,
      clientId: client.id,
      portalToken: token,
      sendMail,
      at: now,
    };
    updated.operationId = operationId;
    updated.updatedAt = now;
    const guard = { sql: guardSQL, params: [order.id, current.version + 1, operationId] };
    const extra = [
      env.DB.prepare(
        "INSERT INTO invoice_tokens(hash,order_id,expires_at,created_at) SELECT ?,?,?,? WHERE " + guard.sql,
      ).bind(digest(token), order.id, new Date(Date.now() + PORTAL_DAYS * 86400000).toISOString(), now, ...guard.params),
      ...(sendMail ? invoiceDeliveryStatements(env, updated, "invoice", guard) : []),
    ];
    const saved = await saveOrder(
      env,
      updated,
      current.version,
      input.mode === "paid"
        ? "Qonto-Rechnung " + remote.number + " als Quittung (bezahlt) erstellt"
        : "Qonto-Rechnung " + remote.number + " erstellt (zahlbar in " + PAYMENT_TERM_DAYS + " Tagen)",
      "provider",
      extra,
    );
    await finishJob(env, job, "sent", remote.id, "Qonto-Rechnung " + remote.number + " ausgestellt.");
    await setStage(env, order.id, "confirmed");
    let delivery = null;
    if (sendMail)
      delivery = await deliverInvoiceMail(env, order.id, "invoice").catch((error) => ({
        state: "queued",
        message: "Rechnung gespeichert. Versand folgt automatisch: " + error.message,
      }));
    return { order: saved, delivery };
  } catch (error) {
    await finishJob(
      env,
      job,
      "failed",
      (await claimRow(env, order.id))?.provider_id ?? null,
      "Abrechnung angehalten: " +
        String(error?.message ?? "Unbekannter Fehler").slice(0, 300) +
        " Ein erneuter Versuch setzt sicher fort; die WG-Nummer verhindert eine zweite Rechnung.",
    );
    throw error;
  }
}

// ---------- Zahlstatus aus Qonto ----------
async function noteCheck(env, orderId, error = null) {
  await env.DB.prepare(
    "INSERT INTO invoice_checks(order_id,checked_at,error) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error",
  )
    .bind(orderId, new Date().toISOString(), error)
    .run();
}
async function cancelOpenReminders(env, orderId, detail) {
  await env.DB.prepare(
    "UPDATE jobs SET state='cancelled',detail=?,updated_at=? WHERE order_id=? AND kind LIKE 'invoice-reminder-%' AND state IN ('queued','failed')",
  )
    .bind(detail, new Date().toISOString(), orderId)
    .run();
}
export async function syncQontoInvoice(env, order) {
  need(
    order.invoice?.provider === "qonto" && uuid(order.invoice.id) && !order.synthetic,
    "Für diesen Auftrag ist keine Qonto-Rechnung zugeordnet.",
    409,
  );
  const config = await qontoAccess(env);
  let remote;
  try {
    remote = await readQontoInvoice(config, order.invoice.id);
    const problem = remoteInvoiceProblem(remote, order);
    need(!problem, problem, 409);
  } catch (error) {
    await noteCheck(env, order.id, String(error.message).slice(0, 300));
    throw error;
  }
  const summary = invoiceSummary(remote),
    current = await getOrder(env, order.id);
  need(current.invoice?.id === remote.id, "Die Rechnungszuordnung hat sich geändert.", 409);
  let updated = structuredClone(current),
    changed = false;
  for (const key of ["status", "paidAt", "dueDate"])
    if (summary[key] !== null && updated.invoice[key] !== summary[key]) {
      updated.invoice[key] = summary[key];
      changed = true;
    }
  if (summary.url && updated.invoice.url !== summary.url) {
    updated.invoice.url = summary.url;
    changed = true;
  }
  const open = updated.offer.totalCents - paidCents(updated);
  let action = "Qonto-Rechnungsstatus übernommen: " + summary.status;
  if (summary.status === "paid" && open > 0 && !recordOperationIssue(updated, "payment")) {
    updated = transition(updated, "payment", {
      amountCents: open,
      at: paidMoment(summary.paidAt),
      method: "Überweisung",
      note: "Zahlungseingang laut Qonto · Rechnung " + summary.number,
    });
    updated.payments[updated.payments.length - 1].source = "qonto";
    action = "Zahlungseingang aus Qonto übernommen · " + summary.number;
    changed = true;
  }
  let saved = current;
  if (changed) saved = await saveOrder(env, updated, current.version, action, "provider");
  if (summary.status !== "unpaid")
    await cancelOpenReminders(env, order.id, "Rechnung ist laut Qonto " + summary.status + " – keine Mahnung.");
  await noteCheck(env, order.id);
  return saved;
}
// Im Panel vollständig bezahlte Rechnung auch in Qonto als bezahlt markieren.
export async function qontoMarkPaid(env, order) {
  assertRecordOperation(order, "payment");
  need(order.invoice?.provider === "qonto" && uuid(order.invoice.id), "Keine Qonto-Rechnung zugeordnet.", 409);
  need(order.invoice.status === "unpaid", "Die Rechnung ist in Qonto nicht mehr offen.", 409);
  need(
    paidCents(order) >= order.offer.totalCents,
    "Im Panel ist noch nicht der volle Betrag als bezahlt erfasst. Bitte zuerst die Zahlung erfassen.",
    409,
  );
  const config = await qontoAccess(env),
    last = (order.payments ?? []).filter((payment) => !payment.cancelledAt).map((payment) => payment.at).sort().at(-1),
    paidAt = last ? [berlinDay(last), berlinDay()].sort()[0] : berlinDay();
  const remote = (
    await qontoJSON(config, "/v2/client_invoices/" + order.invoice.id + "/mark_as_paid", {
      method: "POST",
      body: JSON.stringify({ paid_at: paidAt }),
      beforeSend: () => assertCurrentRecordOperation(env, order, "payment", order.version),
    })
  ).client_invoice;
  need(remote?.id === order.invoice.id && remote.status === "paid", "Qonto hat die Zahlung nicht bestätigt.", 502);
  const current = await getOrder(env, order.id);
  current.invoice = { ...current.invoice, status: "paid", paidAt: invoiceSummary(remote).paidAt ?? paidAt };
  const saved = await saveOrder(env, current, current.version, "Rechnung in Qonto als bezahlt markiert", "provider");
  await cancelOpenReminders(env, order.id, "In Qonto als bezahlt markiert – keine Mahnung.");
  return saved;
}

// ---------- PDF ----------
export function invoiceFilename(order) {
  return (order.invoice?.number ?? order.wg).replace(/[^a-zA-Z0-9_.-]/g, "_") + "-Rechnung.pdf";
}
export async function invoicePDF(env, order) {
  need(order.invoice?.provider === "qonto" && uuid(order.invoice.id), "Keine Qonto-Rechnung vorhanden.", 409);
  const stored = await env.DB.prepare("SELECT * FROM invoice_documents WHERE order_id=?").bind(order.id).first();
  need(!stored || stored.invoice_id === order.invoice.id, "Gespeichertes PDF gehört zu einer anderen Rechnung.", 409);
  if (stored) {
    const asset = await env.DB.prepare("SELECT * FROM assets WHERE id=? AND order_id=? AND kind='invoice'")
        .bind(stored.asset_id, order.id)
        .first(),
      file = await env.BUCKET.get(stored.asset_id);
    need(asset && file && digest(file.body) === asset.hash, "Gespeichertes Rechnungs-PDF ist unvollständig.", 409);
    return { bytes: file.body, filename: invoiceFilename(order) };
  }
  const config = await qontoAccess(env),
    remote = await readQontoInvoice(config, order.invoice.id);
  if (!uuid(remote.attachment_id)) return null;
  const attachment = (await qontoJSON(config, "/v2/attachments/" + remote.attachment_id)).attachment;
  let url;
  try {
    url = new URL(String(attachment?.url ?? ""));
  } catch {
    url = null;
  }
  need(url && url.protocol === "https:", "Qonto hat keinen sicheren PDF-Link geliefert.", 502);
  need(
    !attachment.file_size || Number(attachment.file_size) <= 15 * 1024 * 1024,
    "Rechnungs-PDF ist zu groß.",
    502,
  );
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
  need(response.ok && String(response.url || url.href).startsWith("https://"), "Rechnungs-PDF ist nicht abrufbar.", 502);
  const bytes = await limitedBytes(response, 15 * 1024 * 1024, "Rechnungs-PDF");
  need(bytes.length > 5 && bytes.subarray(0, 5).toString() === "%PDF-", "Qonto-Datei ist kein PDF.", 502);
  const assetId = randomUUID(),
    now = new Date().toISOString();
  await env.BUCKET.put(assetId, bytes, { httpMetadata: { contentType: "application/pdf" } });
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO invoice_documents(order_id,invoice_id,asset_id,created_at) VALUES(?,?,?,?) ON CONFLICT(order_id) DO NOTHING",
      ).bind(order.id, order.invoice.id, assetId, now),
      env.DB.prepare(
        "INSERT INTO assets(id,order_id,kind,mime,hash,size,created_at) SELECT ?,?,'invoice','application/pdf',?,?,? WHERE EXISTS(SELECT 1 FROM invoice_documents WHERE order_id=? AND asset_id=?)",
      ).bind(assetId, order.id, digest(bytes), bytes.length, now, order.id, assetId),
    ]);
    if (!results[0].meta.changes) {
      await env.BUCKET.delete(assetId);
      return invoicePDF(env, order);
    }
  } catch (error) {
    await env.BUCKET.delete(assetId);
    throw error;
  }
  return { bytes, filename: invoiceFilename(order) };
}
export function pdfResponse(pdf) {
  return new Response(pdf.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + pdf.filename + '"',
      "Content-Length": String(pdf.bytes.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export async function invoiceDownload(env, order) {
  const pdf = await invoicePDF(env, order);
  need(pdf, "Qonto erstellt das Rechnungs-PDF noch. Bitte in einer Minute erneut versuchen.", 409);
  return pdfResponse(pdf);
}

// ---------- E-Mail-Versand ----------
export function invoiceDeliveryStatements(env, order, kind, guard = null) {
  const recipient = email(order.source.email);
  if (order.synthetic || !validEmail(recipient)) return [];
  const business = email(COMPANY.email),
    copy = digest(business) === env.OWNER_EMAIL_SHA256 ? business : "",
    id = randomUUID(),
    now = new Date().toISOString();
  return [
    env.DB.prepare(
      "INSERT OR IGNORE INTO jobs(id,order_id,kind,state,created_at,updated_at) SELECT ?,?,?,'queued',?,?" +
        (guard ? " WHERE " + guard.sql : ""),
    ).bind(id, order.id, jobKindOf(kind), now, now, ...(guard?.params ?? [])),
    env.DB.prepare(
      "INSERT OR IGNORE INTO invoice_deliveries(job_id,order_id,kind,recipient,copy_to,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)",
    ).bind(id, order.id, kind, recipient, copy, now, id),
  ];
}
function paymentBlock(order) {
  const p = order.invoice.payment ?? {};
  return [
    "Empfänger: " + (p.beneficiary || COMPANY.name),
    p.iban ? "IBAN: " + p.iban.replace(/(.{4})/g, "$1 ").trim() : "",
    p.bic ? "BIC: " + p.bic : "",
    "Verwendungszweck: " + order.invoice.number,
  ]
    .filter(Boolean)
    .join("\n");
}
export function invoiceMail(env, order, kind, today = berlinDay()) {
  const inv = order.invoice,
    open = Math.max(0, order.offer.totalCents - paidCents(order)),
    name = order.source.name || "",
    portal = env.PANEL_ORIGIN && inv.portalToken ? env.PANEL_ORIGIN + "/rechnung/" + inv.portalToken : "",
    links =
      (inv.url && inv.status === "unpaid" ? "\n\nRechnung online ansehen und bezahlen:\n" + inv.url : "") +
      (portal ? "\n\nIhr Kundenbereich mit allen Rechnungsdaten (Anmeldung mit Ihrer E-Mail-Adresse):\n" + portal : ""),
    signature =
      "\n\nBei Rückfragen antworten Sie bitte auf diese E-Mail.\n\nMit freundlichen Grüßen\n" +
      [COMPANY.name, COMPANY.owner, COMPANY.street, COMPANY.city, COMPANY.phone, COMPANY.email].join("\n");
  const issued = germanDay(inv.issueDate),
    total = euro(inv.totalCents);
  if (kind === "invoice" || isCopy(kind)) {
    if (inv.mode === "paid")
      return {
        subject: "White Gloss · Rechnung und Quittung " + inv.number,
        text:
          "Guten Tag " +
          name +
          ",\n\nvielen Dank für Ihren Auftrag. Anbei erhalten Sie Ihre Rechnung " +
          inv.number +
          " vom " +
          issued +
          " über " +
          total +
          ". Der Betrag wurde vollständig bezahlt" +
          ({ Bar: " (bar)", Karte: " (Karte)", Überweisung: " (Überweisung)" }[inv.paymentMethod] ?? "") +
          "; die Rechnung gilt zugleich als Quittung." +
          (portal ? "\n\nIhr Kundenbereich (Anmeldung mit Ihrer E-Mail-Adresse):\n" + portal : "") +
          signature,
      };
    return {
      subject: "White Gloss · Rechnung " + inv.number,
      text:
        "Guten Tag " +
        name +
        ",\n\nvielen Dank für Ihren Auftrag. Anbei erhalten Sie Ihre Rechnung " +
        inv.number +
        " vom " +
        issued +
        " über " +
        total +
        ".\n\nBitte überweisen Sie den Betrag innerhalb von " +
        PAYMENT_TERM_DAYS +
        " Tagen bis zum " +
        germanDay(inv.dueDate) +
        " ohne Abzug:\n" +
        paymentBlock(order) +
        links +
        signature,
    };
  }
  const stage = DUNNING.find((item) => item.kind === kind);
  need(stage, "Unbekannte Versandart.");
  const deadline = germanDay(addDays(today, REMINDER_GRACE_DAYS)),
    facts =
      "Rechnung " + inv.number + " vom " + issued + " · fällig seit " + germanDay(inv.dueDate) + " · offen: " + euro(open);
  const intro = {
    1: "sicher ist es im Alltag untergegangen: Für die folgende Rechnung konnten wir noch keinen vollständigen Zahlungseingang feststellen.",
    2: "leider ist trotz unserer Zahlungserinnerung bisher kein vollständiger Zahlungseingang zu der folgenden Rechnung erfolgt.",
    3: "trotz Zahlungserinnerung und Mahnung ist die folgende Rechnung weiterhin offen. Dies ist unsere letzte Zahlungsaufforderung.",
  }[stage.level];
  const request =
    stage.level === 3
      ? "Bitte begleichen Sie den offenen Betrag spätestens bis zum " +
        deadline +
        ". Nach Ablauf dieser Frist behalten wir uns weitere Schritte zur Durchsetzung der Forderung vor."
      : "Bitte überweisen Sie den offenen Betrag bis zum " + deadline + ".";
  return {
    subject: "White Gloss · " + stage.label + " · Rechnung " + inv.number,
    text:
      "Guten Tag " +
      name +
      ",\n\n" +
      intro +
      "\n\n" +
      facts +
      "\n\n" +
      request +
      "\n" +
      paymentBlock(order) +
      "\n\nSollten Sie die Zahlung bereits veranlasst haben, betrachten Sie diese Nachricht bitte als gegenstandslos. Die Rechnung finden Sie erneut im Anhang." +
      links +
      signature,
  };
}
async function deliveryRecord(env, orderId, kind) {
  return env.DB.prepare(
    "SELECT d.*,j.state,j.created_at AS job_created,j.updated_at FROM invoice_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=? AND d.kind=?",
  )
    .bind(orderId, kind)
    .first();
}
export async function deliverInvoiceMail(env, orderId, kind) {
  await qontoSchema(env);
  const record = await deliveryRecord(env, orderId, kind);
  if (!record) return { state: "none", message: "Für diese Rechnung ist kein E-Mail-Versand vorgemerkt." };
  if (!["queued", "failed"].includes(record.state))
    return {
      state: record.state,
      message:
        record.state === "sent"
          ? "Bereits per E-Mail versendet."
          : record.state === "cancelled"
            ? "Versand entfällt (Rechnung bezahlt oder erledigt)."
            : "Versandergebnis wird geprüft; es wurde keine zweite E-Mail erzeugt.",
    };
  const now = Date.now(),
    leaseOwner = randomUUID(),
    lease = await env.DB.prepare(
      "UPDATE invoice_deliveries SET processing_until=?,lease_owner=? WHERE job_id=? AND processing_until<=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND state IN ('queued','failed'))",
    )
      .bind(now + 180000, leaseOwner, record.job_id, now, record.job_id)
      .run();
  if (!lease.meta.changes) return { state: "queued", message: "Der Versand läuft bereits." };
  let attempted = false,
    label = "E-Mail";
  try {
    let order = await getOrder(env, orderId);
    label = deliveryLabel(order, kind);
    need(order.invoice?.provider === "qonto" && !order.synthetic, "Keine Qonto-Rechnung für diesen Versand.", 409);
    const issue = recordOperationIssue(order, "send");
    need(!issue, issue, 409);
    if (isReminder(kind)) {
      order = await syncQontoInvoice(env, order);
      if (
        order.invoice.status !== "unpaid" ||
        order.status === "Bezahlt" ||
        paidCents(order) >= order.offer.totalCents
      ) {
        await finishJob(env, record.job_id, "cancelled", null, "Zahlung eingegangen oder Rechnung erledigt – keine Mahnung.");
        return { state: "cancelled", message: label + " entfällt: Zahlung eingegangen oder Rechnung erledigt." };
      }
    }
    const config = await configuration(env, ["resendKey"]);
    need(
      config.emailVerified && config.sendApproved && config.resendKey && config.sender,
      "E-Mail-Versand zuerst prüfen und freigeben.",
      409,
    );
    const pdf = await invoicePDF(env, order);
    if (!pdf) {
      if (now - Date.parse(record.job_created) < 6 * 3600000) {
        await env.DB.prepare("UPDATE jobs SET detail=?,updated_at=? WHERE id=? AND state IN ('queued','failed')")
          .bind("Qonto erstellt das PDF noch. Der Versand folgt automatisch.", new Date().toISOString(), record.job_id)
          .run();
        return {
          state: "queued",
          message: "Qonto erstellt das Rechnungs-PDF noch. Die E-Mail folgt automatisch in wenigen Minuten.",
        };
      }
      throw new AppError("Qonto hat nach 6 Stunden noch kein Rechnungs-PDF bereitgestellt. Bitte in Qonto prüfen.", 502);
    }
    const mail = invoiceMail(env, order, kind);
    const reserved = await env.DB.prepare(
      "UPDATE jobs SET state='pending',detail='Versand wird angefordert',updated_at=? WHERE id=? AND state IN ('queued','failed') AND EXISTS(SELECT 1 FROM invoice_deliveries WHERE job_id=? AND lease_owner=?)",
    )
      .bind(new Date().toISOString(), record.job_id, record.job_id, leaseOwner)
      .run();
    if (!reserved.meta.changes) return { state: "queued", message: "Der Versand wurde bereits übernommen." };
    assertCurrentRecordOperation(env, order, "send");
    attempted = true;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: "Bearer " + config.resendKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "wg-invoice-" + record.job_id,
      },
      body: JSON.stringify({
        from: config.sender,
        to: [record.recipient],
        ...(record.copy_to && record.copy_to !== record.recipient ? { cc: [record.copy_to] } : {}),
        reply_to: record.copy_to || config.sender,
        subject: mail.subject,
        text: mail.text,
        attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.bytes).toString("base64") }],
      }),
    });
    const data = await response.json().catch(() => ({}));
    need(response.ok && typeof data.id === "string", "Versandergebnis ist nicht eindeutig bestätigt.", 502);
    await finishJob(env, record.job_id, "sent", data.id, label + " an " + record.recipient + " versendet.");
    return { state: "sent", message: label + " an " + record.recipient + " versendet" + (record.copy_to ? " (Kopie an dich)." : ".") };
  } catch (error) {
    const state = attempted ? "unknown" : "failed",
      detail = attempted
        ? "Versandergebnis ungeklärt. „Erneut senden“ nutzt denselben Versandschlüssel (innerhalb von 24 Stunden kein Doppelversand)."
        : label + " noch nicht versendet: " + String(error?.message ?? "").slice(0, 300);
    await env.DB.prepare(
      "UPDATE jobs SET state=?,detail=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM invoice_deliveries WHERE job_id=? AND lease_owner=?)",
    )
      .bind(state, detail, new Date().toISOString(), record.job_id, record.job_id, leaseOwner)
      .run();
    return { state, message: detail };
  } finally {
    await env.DB.prepare("UPDATE invoice_deliveries SET processing_until=0,lease_owner='' WHERE job_id=? AND lease_owner=?")
      .bind(record.job_id, leaseOwner)
      .run();
  }
}
function mailReady(config) {
  need(
    config.emailVerified === true && config.sendApproved === true && config.sender,
    "E-Mail-Versand zuerst in den Einstellungen prüfen und freigeben.",
    409,
  );
}
// Betreiberaktion: Rechnungsmail jetzt (erneut) senden.
export async function resendInvoiceMail(env, order) {
  assertRecordOperation(order, "send");
  need(order.invoice?.provider === "qonto" && !order.synthetic, "Keine Qonto-Rechnung vorhanden.", 409);
  need(validEmail(order.source.email), "Für den Versand fehlt eine gültige Kunden-E-Mail.", 409);
  await qontoSchema(env);
  mailReady(await settings(env));
  const existing = await deliveryRecord(env, order.id, "invoice");
  let kind = "invoice";
  if (!existing) await env.DB.batch(invoiceDeliveryStatements(env, order, "invoice"));
  else if (existing.state === "unknown")
    await env.DB.prepare("UPDATE jobs SET state='failed',updated_at=? WHERE id=? AND state='unknown'")
      .bind(new Date().toISOString(), existing.job_id)
      .run();
  else if (["sent", "cancelled"].includes(existing.state)) {
    kind = "copy-" + Date.now();
    await env.DB.batch(invoiceDeliveryStatements(env, order, kind));
  }
  return deliverInvoiceMail(env, order.id, kind);
}

// ---------- Mahnwesen ----------
export async function deliveryStates(env, orderId) {
  const rows = await env.DB.prepare(
    "SELECT d.kind,d.created_at,j.state,j.updated_at,j.detail FROM invoice_deliveries d JOIN jobs j ON j.id=d.job_id WHERE d.order_id=? AND instr(d.kind,'#')=0 ORDER BY d.created_at",
  )
    .bind(orderId)
    .all();
  return rows.results;
}
export function reminderPlan(order, deliveries, today = berlinDay()) {
  const inv = order.invoice,
    none = { due: null, next: null, pending: null, finished: false };
  if (
    !inv ||
    inv.provider !== "qonto" ||
    inv.mode !== "invoice" ||
    inv.status !== "unpaid" ||
    !validDay(inv.dueDate) ||
    order.synthetic ||
    order.status === "Bezahlt" ||
    paidCents(order) >= (order.offer?.totalCents ?? 0)
  )
    return none;
  let previous = null;
  for (const stage of DUNNING) {
    const row = deliveries.find((item) => item.kind === stage.kind);
    if (row) {
      if (row.state !== "sent") return { ...none, pending: { ...stage, state: row.state } };
      previous = berlinDay(row.updated_at);
      continue;
    }
    const byDue = addDays(inv.dueDate, stage.afterDueDays),
      byPrevious = previous ? addDays(previous, REMINDER_GRACE_DAYS) : byDue,
      on = byDue > byPrevious ? byDue : byPrevious;
    return { ...none, due: today >= on ? stage : null, next: { ...stage, on } };
  }
  return { ...none, finished: true };
}
// Betreiberaktion: nächste Mahnstufe sofort senden (nur bei überfälliger, offener Rechnung).
export async function sendReminderNow(env, order) {
  assertRecordOperation(order, "send");
  need(validEmail(order.source.email), "Für den Versand fehlt eine gültige Kunden-E-Mail.", 409);
  await qontoSchema(env);
  mailReady(await settings(env));
  const fresh = await syncQontoInvoice(env, order);
  const plan = reminderPlan(fresh, await deliveryStates(env, fresh.id));
  if (plan.pending) {
    if (plan.pending.state === "unknown")
      await env.DB.prepare(
        "UPDATE jobs SET state='failed',updated_at=? WHERE order_id=? AND kind=? AND state='unknown'",
      )
        .bind(new Date().toISOString(), fresh.id, jobKindOf(plan.pending.kind))
        .run();
    return deliverInvoiceMail(env, fresh.id, plan.pending.kind);
  }
  need(plan.next, "Keine weitere Mahnstufe offen (bezahlt, storniert oder Mahnverfahren abgeschlossen).", 409);
  need(
    berlinDay() > fresh.invoice.dueDate,
    "Die Rechnung ist noch nicht fällig (Zahlungsziel " + germanDay(fresh.invoice.dueDate) + ").",
    409,
  );
  await env.DB.batch(invoiceDeliveryStatements(env, fresh, plan.next.kind));
  return deliverInvoiceMail(env, fresh.id, plan.next.kind);
}
// Hintergrundlauf: wartende Mails, Zahlstatus und fällige Mahnungen.
export async function pendingInvoiceWork(env, now = Date.now()) {
  await qontoSchema(env);
  const config = await settings(env),
    errors = [];
  if (config.qontoVerified !== true) return errors;
  const mail = config.emailVerified === true && config.sendApproved === true;
  if (mail) {
    const rows = await env.DB.prepare(
      "SELECT d.order_id,d.kind FROM invoice_deliveries d JOIN jobs j ON j.id=d.job_id WHERE j.state IN ('queued','failed') AND d.processing_until<=? ORDER BY d.created_at LIMIT 3",
    )
      .bind(now)
      .all();
    for (const row of rows.results) {
      const result = await deliverInvoiceMail(env, row.order_id, row.kind).catch((error) => ({
        state: "failed",
        message: error.message,
      }));
      if (["failed", "unknown"].includes(result.state)) errors.push("Rechnungsmail: " + result.message);
    }
  }
  const open = await env.DB.prepare(
    "SELECT o.id FROM orders o LEFT JOIN invoice_checks c ON c.order_id=o.id WHERE o.synthetic=0 AND json_extract(o.data,'$.invoice.provider')='qonto' AND json_extract(o.data,'$.invoice.status')='unpaid' AND (c.checked_at IS NULL OR c.checked_at<?) ORDER BY COALESCE(c.checked_at,'') LIMIT 5",
  )
    .bind(new Date(now - 3600000).toISOString())
    .all();
  for (const row of open.results) {
    try {
      await syncQontoInvoice(env, await getOrder(env, row.id));
    } catch (error) {
      if (!(error instanceof AppError && error.status === 409 && /veraltet|verändert/.test(error.message)))
        errors.push("Qonto-Zahlstatus: " + error.message);
    }
  }
  if (config.dunningApproved === true && mail) {
    const due = await env.DB.prepare(
      "SELECT id FROM orders WHERE synthetic=0 AND status='Erledigt' AND json_extract(data,'$.invoice.provider')='qonto' AND json_extract(data,'$.invoice.mode')='invoice' AND json_extract(data,'$.invoice.status')='unpaid' ORDER BY updated_at LIMIT 100",
    ).all();
    let remaining = 3;
    for (const row of due.results) {
      if (remaining <= 0) break;
      const order = await getOrder(env, row.id);
      if (recordOperationIssue(order, "send") || !validEmail(order.source.email)) continue;
      const plan = reminderPlan(order, await deliveryStates(env, order.id));
      if (!plan.due) continue;
      remaining--;
      await env.DB.batch(invoiceDeliveryStatements(env, order, plan.due.kind));
      const result = await deliverInvoiceMail(env, order.id, plan.due.kind).catch((error) => ({
        state: "failed",
        message: error.message,
      }));
      if (["failed", "unknown"].includes(result.state)) errors.push(plan.due.label + ": " + result.message);
    }
  }
  return errors;
}

// ---------- Anzeige im Panel und im Kundenbereich ----------
export async function invoiceInfo(env, order) {
  const inv = order.invoice;
  if (inv?.provider !== "qonto") return null;
  const deliveries = await deliveryStates(env, order.id).catch(() => []),
    plan = reminderPlan(order, deliveries),
    config = await settings(env),
    stored = await env.DB.prepare("SELECT asset_id FROM invoice_documents WHERE order_id=? AND invoice_id=?")
      .bind(order.id, inv.id)
      .first()
      .catch(() => null);
  return {
    deliveries: deliveries.map((row) => ({
      kind: row.kind,
      label: deliveryLabel(order, row.kind),
      state: row.state,
      at: row.updated_at,
      detail: row.detail ?? "",
    })),
    next: plan.next ? { level: plan.next.level, label: plan.next.label, on: plan.next.on, due: Boolean(plan.due) } : null,
    pending: plan.pending ? { label: plan.pending.label, state: plan.pending.state } : null,
    finished: plan.finished,
    overdue: inv.status === "unpaid" && validDay(inv.dueDate) && berlinDay() > inv.dueDate,
    openCents: Math.max(0, order.offer.totalCents - paidCents(order)),
    pdfStored: Boolean(stored),
    portalUrl: env.PANEL_ORIGIN && inv.portalToken ? env.PANEL_ORIGIN + "/rechnung/" + inv.portalToken : null,
    dunningApproved: config.dunningApproved === true,
    mailReady: config.emailVerified === true && config.sendApproved === true,
    paymentTermDays: PAYMENT_TERM_DAYS,
  };
}
export function invoicePortalView(order, ownerPreview = false) {
  const inv = order.invoice;
  need(inv?.provider === "qonto", "Für diesen Auftrag liegt keine Rechnung vor.", 404);
  const open = Math.max(0, order.offer.totalCents - paidCents(order)),
    status =
      inv.status === "canceled"
        ? "canceled"
        : inv.status === "paid" || open === 0
          ? "paid"
          : validDay(inv.dueDate) && berlinDay() > inv.dueDate
            ? "overdue"
            : "open";
  return {
    wg: order.wg,
    customer: order.source.name ?? "",
    vehicle: [order.source.vehicle, order.source.plate].filter(Boolean).join(" · "),
    invoice: {
      number: inv.number,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status,
      mode: inv.mode,
      paymentMethod: inv.paymentMethod ?? null,
      totalCents: inv.totalCents,
      openCents: status === "paid" || status === "canceled" ? 0 : open,
      paidAt: inv.paidAt ?? null,
    },
    lines: invoiceLines(order).map((line) => ({
      title: String(line.title),
      description: String(line.description ?? ""),
      amountCents: line.amountCents,
    })),
    vat: VAT_OPTIONS[inv.vatBasisPoints]?.label ?? "",
    payment: { ...(inv.payment ?? {}), reference: inv.number },
    payUrl: status === "open" || status === "overdue" ? (inv.url ?? null) : null,
    company: { name: COMPANY.name, owner: COMPANY.owner, street: COMPANY.street, city: COMPANY.city, phone: COMPANY.phone, email: COMPANY.email },
    ownerPreview,
  };
}

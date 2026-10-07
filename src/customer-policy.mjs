import {AppError, need} from './domain.mjs';
import {agreedOffer} from './operations.mjs';

const HOUR = 3600000;
const hasText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 20000;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Require an unambiguous instant, rather than a host-local date or a silently rolled date.
function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [,year,month,day,hour,minute,second,offset] = match;
  const leap = Number(year)%4 === 0 && (Number(year)%100 !== 0 || Number(year)%400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31][Number(month)-1];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return NaN;
  if (offset !== 'Z' && (Number(offset.slice(1,3)) > 14 || Number(offset.slice(4)) > 59 || (Number(offset.slice(1,3)) === 14 && Number(offset.slice(4)) !== 0))) return NaN;
  return Date.parse(value);
}

const instant = value => typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 8640000000000000 ? value : timestamp(value);
function approvalErrors(policy, now) {
  const errors = [];
  if (!hasText(policy.version)) errors.push('Versionskennung fehlt.');
  if (policy.approved !== true) errors.push('Ausdrückliche Betreiberfreigabe fehlt.');
  if (!hasText(policy.approvedBy)) errors.push('Freigebende Person fehlt.');
  const approved = timestamp(policy.approvedAt);
  if (!Number.isFinite(approved) || approved > now) errors.push('Freigabezeitpunkt fehlt, ist ungültig oder liegt in der Zukunft.');
  return errors;
}

/** Validate explicit decisions; the conservative preview remains separately gated.
 * @param {any} policy
 */
export function cancellationPolicyErrors(policy, now = Date.now()) {
  if (!isObject(policy)) return ['Stornoregeln sind noch nicht vollständig freigegeben.'];
  const time = instant(now);
  if (!Number.isFinite(time)) return ['Prüfzeitpunkt ist ungültig.'];
  const errors = approvalErrors(policy,time);
  if (!['elapsed-hours','berlin-calendar-days'].includes(policy.timeBasis)) errors.push('Storno-Zeitbasis muss ausdrücklich festgelegt werden.');
  if (policy.timeZone !== 'Europe/Berlin') errors.push('Zeitzone Europe/Berlin muss bestätigt werden.');
  const boundaries = policy.boundaries ?? {};
  for (const [key,choices] of Object.entries({fiveDays:['free','25-percent'],threeDays:['25-percent','50-percent']})) {
    if (!isObject(boundaries[key]) || !choices.includes(boundaries[key].atEquality) || !hasText(boundaries[key].definition)) errors.push('Exakte Grenze '+key+' mit Gleichheitsregel fehlt.');
  }
  if (!isObject(boundaries.serviceDay) || !hasText(boundaries.serviceDay.definition) || !['berlin-midnight','appointment-start','explicit-local-time'].includes(boundaries.serviceDay.startsAt)) errors.push('Beginn des Dienstleistungstages muss ausdrücklich festgelegt werden.');
  if (boundaries.serviceDay?.startsAt === 'explicit-local-time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(boundaries.serviceDay.localTime ?? '')) errors.push('Ausdrückliche lokale Tagesgrenze fehlt.');
  for (const [key,label] of [['feeBasis','Berechnungsgrundlage'],['noShow','Nichterscheinen'],['operatorCancellation','Betreiberstornierung'],['exceptions','Sonderfälle'],['lowerDamageText','Hinweis zum Nachweis keines oder geringeren Schadens'],['terms','vollständige Kundenbedingungen']]) {
    if (!hasText(policy[key])) errors.push(label+' muss ausdrücklich bestätigt werden.');
  }
  if (policy.feeCreation !== 'operator-confirmation') errors.push('Die persönliche Betreiberbestätigung für Gebührenbelege muss ausdrücklich festgelegt werden.');
  if (!isObject(policy.rates) || policy.rates.free !== 0 || policy.rates.afterFiveDays !== 25 || policy.rates.fromThreeDays !== 50 || policy.rates.serviceDay !== 75) errors.push('Die ausdrücklich beauftragte Gebührenstaffel muss in der freigegebenen Version vollständig bestätigt werden.');
  const review = policy.legalReview;
  if (!isObject(review) || review.approved !== true || !hasText(review.reviewer) || !hasText(review.evidence) || !Number.isFinite(timestamp(review.reviewedAt)) || timestamp(review.reviewedAt) > timestamp(policy.approvedAt)) errors.push('Belastbarer Rechtsprüfungsnachweis vor der Betreiberfreigabe fehlt.');
  return errors;
}

function freezeSnapshot(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/** @param {any} policy @param {any} acceptance */
export function cancellationSnapshot(policy, acceptance, now = Date.now()) {
  const at = timestamp(acceptance?.at);
  const errors = cancellationPolicyErrors(policy,at);
  need(errors.length === 0,errors.join(' '),409);
  need(Number.isFinite(instant(now)) && at <= instant(now),'Kundenannahmezeitpunkt ist ungültig oder liegt in der Zukunft.',409);
  need(acceptance?.accepted === true && acceptance?.role === 'customer' && hasText(acceptance?.orderId) && hasText(acceptance?.customerId),'Kundenannahme und eindeutige Vorgangszuordnung fehlen.',409);
  need(acceptance.version === policy.version,'Angezeigte Stornoversion stimmt nicht mit der angenommenen Version überein.',409);
  return freezeSnapshot({policy:structuredClone(policy),acceptance:{accepted:true,role:'customer',orderId:acceptance.orderId,customerId:acceptance.customerId,at:new Date(at).toISOString(),version:policy.version}});
}

// Reviewable proposal after the operator's instruction to confirm fees personally and
// allow reasoned reductions. It is deliberately neither approved nor active.
export const proposedCancellationPolicy = freezeSnapshot({
  version:'draft-2026-10-07',approved:false,approvedBy:'',approvedAt:null,
  timeBasis:'elapsed-hours',timeZone:'Europe/Berlin',calculation:'documented-loss-cap-v1',
  boundaries:{
    fiveDays:{atEquality:'free',definition:'Ab exakt 120 verbleibenden Stunden bis zum Terminbeginn ist die Absage kostenlos; darunter und über 72 Stunden gilt eine Obergrenze von 25 Prozent.'},
    threeDays:{atEquality:'50-percent',definition:'Bei exakt 72 verbleibenden Stunden und darunter gilt vor dem Berliner Dienstleistungstag eine Obergrenze von 50 Prozent.'},
    serviceDay:{startsAt:'berlin-midnight',definition:'Ab 00:00 Uhr Europe/Berlin am Dienstleistungstag gilt eine Obergrenze von 75 Prozent; auch bei Nichterscheinen nach Terminbeginn.'}
  },
  feeBasisKey:'agreed-total-cents',feeBasis:'Der kundenseitig angenommene Gesamtfestpreis einschließlich angenommener Nachträge ist ausschließlich die Grundlage der prozentualen Obergrenze. Die Gebühr überschreitet den dokumentierten Verlust nach Abzug ersparter Aufwendungen und Ersatzverdienste nicht.',
  rates:{free:0,afterFiveDays:25,fromThreeDays:50,serviceDay:75},
  noShowRule:'documented-loss-up-to-75-percent',noShow:'Nichterscheinen kann erst nach dem vereinbarten Terminbeginn festgestellt werden. Höchstens 75 Prozent und höchstens der dokumentierte Verlust; persönliche Betreiberbestätigung bleibt erforderlich.',
  operatorCancellationRule:'free',operatorCancellation:'Bei Absage durch den Betreiber fällt keine Stornogebühr an.',
  withdrawalRule:'statutory-review-no-cancellation-fee',
  exceptionsRule:'operator-may-waive-or-reduce-with-reason',exceptions:'Der Betreiber kann eine Gebühr im Einzelfall mit dokumentiertem Grund reduzieren oder vollständig erlassen. Ein Krankheitsfall löst keine automatische Gebühr aus; der konkrete Fall bleibt prüfbar.',
  feeCreation:'operator-confirmation',
  lowerDamageText:'Sie können nachweisen, dass kein Schaden oder ein wesentlich geringerer Schaden entstanden ist. Dann fällt keine beziehungsweise nur die entsprechend geringere Gebühr an.',
  terms:'ENTWURF ZUR PRÜFUNG: Eine Absage ist ab exakt 120 Stunden vor dem Termin kostenlos. Unter 120 und über 72 Stunden gilt höchstens 25 Prozent, bei exakt 72 Stunden und darunter vor dem Dienstleistungstag höchstens 50 Prozent, ab Berliner Mitternacht am Dienstleistungstag sowie bei Nichterscheinen nach Terminbeginn höchstens 75 Prozent des angenommenen Gesamtfestpreises. Die Forderung überschreitet den dokumentierten Verlust nach ersparten Aufwendungen und Ersatzverdiensten nicht. Sie können nachweisen, dass kein oder ein wesentlich geringerer Schaden entstanden ist. Der Betreiber kann die Forderung mit Grund reduzieren oder erlassen und bestätigt sie persönlich; eine Gebührenrechnung wird nicht automatisch erstellt. Bei Betreiberabsage wird keine Stornogebühr verlangt. Ein gesetzlicher Widerruf wird separat geprüft und nicht mit diesen Stornogebühren belastet. Der Wortlaut muss vor verbindlicher Buchung passend zum tatsächlichen Vertrag geprüft und ausdrücklich angenommen werden.',
  legalReview:{approved:false,reviewer:'',reviewedAt:null,evidence:''}
});

const validCents = value => Number.isSafeInteger(value) && value >= 0 && value <= 100000000;
const berlinDay = value => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
/** @param {any} value @returns {any} */
function canonicalPolicy(value) {
  if (Array.isArray(value)) return value.map(canonicalPolicy);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonicalPolicy(value[key])]));
  return value;
}

/** Conservative preview only. No payment, invoice, order or provider is changed.
 * @param {any} order @param {any} input @param {any} policy
 */
export function cancellationPreview(order, input, policy, now = Date.now()) {
  const time = instant(now);
  need(Number.isFinite(time),'Stornozeitpunkt ist ungültig.');
  need(isObject(input) && ['customer','no-show','operator','withdrawal'].includes(input.reason),'Art der Absage fehlt.');
  const base = {eligible:false,policyVersion:policy?.version ?? null,reason:input.reason,capPercent:null,basisCents:null,capCents:null,maxFeeCents:null,feeCents:null,confirmed:false,issueAllowed:false,at:new Date(time).toISOString(),blocked:[]};
  // These are not customer fee claims. Other statutory withdrawal consequences,
  // such as reviewed compensation for services already provided, are out of scope.
  if (['operator','withdrawal'].includes(input.reason)) {
    need(input.feeCents === undefined || input.feeCents === 0,'Für diese Absage wird keine Stornogebühr verlangt.');
    return {...base,eligible:true,capPercent:0,capCents:0,maxFeeCents:0,feeCents:0,confirmed:input.confirmed === true};
  }
  const errors = cancellationPolicyErrors(policy,time);
  if (errors.length) return {...base,blocked:errors};
  if (policy.calculation !== 'documented-loss-cap-v1' || policy.timeBasis !== 'elapsed-hours' || policy.boundaries.fiveDays.atEquality !== 'free' || policy.boundaries.threeDays.atEquality !== '50-percent' || policy.boundaries.serviceDay.startsAt !== 'berlin-midnight' || policy.feeBasisKey !== 'agreed-total-cents' || policy.noShowRule !== 'documented-loss-up-to-75-percent' || policy.operatorCancellationRule !== 'free' || policy.withdrawalRule !== 'statutory-review-no-cancellation-fee' || policy.exceptionsRule !== 'operator-may-waive-or-reduce-with-reason' || policy.feeCreation !== 'operator-confirmation') return {...base,blocked:['Diese Vorschau unterstützt nur die ausdrücklich geprüfte konservative Stundenregel mit persönlicher Gebührenbestätigung.']};
  const snapshot = order?.cancellationTerms;
  const accepted = snapshot?.acceptance;
  const contractAt = timestamp(order?.acceptance?.at);
  if (!isObject(snapshot?.policy) || JSON.stringify(canonicalPolicy(snapshot.policy)) !== JSON.stringify(canonicalPolicy(policy)) || accepted?.accepted !== true || accepted?.role !== 'customer' || accepted.orderId !== order?.id || accepted.version !== policy.version || !hasText(accepted.customerId) || !Number.isFinite(timestamp(accepted.at)) || timestamp(accepted.at) < timestamp(policy.approvedAt) || timestamp(accepted.at) > time || !Number.isFinite(contractAt) || contractAt < timestamp(accepted.at)) return {...base,blocked:['Für diesen Vorgang fehlt eine vor Vertragsschluss kundenseitig angenommene, unveränderte Stornoversion. Keine rückwirkende Gebührenregel.']};
  const offer = agreedOffer(order);
  if (!validCents(offer?.totalCents)) return {...base,blocked:['Angenommener Gesamtfestpreis fehlt.']};
  if (['Erledigt','Bezahlt','In Arbeit'].includes(order.status) || order.completedAt) return {...base,blocked:['Bereits ausgeführte oder abgeschlossene Leistungen benötigen eine gesonderte fachliche Prüfung.']};
  const start = timestamp(order.appointment?.start);
  if (!Number.isFinite(start)) return {...base,blocked:['Verbindlicher Terminbeginn fehlt.']};
  if (input.reason === 'no-show' && time < start) return {...base,blocked:['Nichterscheinen kann vor Terminbeginn nicht festgestellt werden.']};
  const remaining = start-time;
  const percent = input.reason === 'no-show' || berlinDay(time) >= berlinDay(start) ? 75 : remaining >= 120*HOUR ? 0 : remaining > 72*HOUR ? 25 : 50;
  const cap = Math.floor(offer.totalCents*percent/100);
  const result = {...base,capPercent:percent,basisCents:offer.totalCents,capCents:cap};
  let substantiatedLoss = 0;
  if (cap > 0) {
    if (['documentedLossCents','sparedCostsCents','replacementEarningsCents'].some(key => input[key] === undefined) || !hasText(input.lossEvidence)) return {...result,blocked:['Dokumentierter Verlust, ersparte Aufwendungen, Ersatzverdienst und Belegnachweis müssen ausdrücklich erfasst werden.']};
    need(['documentedLossCents','sparedCostsCents','replacementEarningsCents'].every(key => validCents(input[key])),'Verlustbeträge müssen nicht negative ganze Centbeträge sein.');
    substantiatedLoss = Math.max(0,input.documentedLossCents-input.sparedCostsCents-input.replacementEarningsCents);
  }
  let maxFee = Math.min(cap,substantiatedLoss);
  if (input.customerProvenLossCents !== undefined && input.customerProvenLossCents !== null) {
    need(validCents(input.customerProvenLossCents) && hasText(input.customerEvidence),'Kundennachweis zum geringeren Schaden ist unvollständig.');
    maxFee = Math.min(maxFee,input.customerProvenLossCents);
  }
  const preview = {...result,eligible:true,maxFeeCents:maxFee,loss:{documentedLossCents:input.documentedLossCents ?? null,sparedCostsCents:input.sparedCostsCents ?? null,replacementEarningsCents:input.replacementEarningsCents ?? null,substantiatedLossCents:substantiatedLoss,evidence:input.lossEvidence ?? null,customerProvenLossCents:input.customerProvenLossCents ?? null,customerEvidence:input.customerEvidence ?? null}};
  if (input.confirmed !== true) return preview;
  need(hasText(input.confirmedBy),'Persönliche Betreiberbestätigung fehlt.',409);
  need(validCents(input.feeCents) && input.feeCents <= maxFee,'Bestätigte Gebühr überschreitet den anhand von Staffel und Verlustnachweis berechneten Höchstbetrag.',409);
  need(input.feeCents === maxFee || hasText(input.waiverReason),'Grund für Reduktion oder Erlass fehlt.',409);
  return {...preview,confirmed:true,confirmedBy:input.confirmedBy,feeCents:input.feeCents,waiverReason:input.waiverReason ?? null};
}

export function validGoogleReviewUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && ['g.page','maps.app.goo.gl','search.google.com','maps.google.com','google.com','www.google.com','google.de','www.google.de'].includes(url.hostname) && url.pathname !== '/';
  } catch { return false; }
}

/** @param {any} policy */
export function reviewPolicyErrors(policy, now = Date.now()) {
  if (!isObject(policy)) return ['Die neue Drei-Tage-Bewertungsregel ist noch nicht freigegeben.'];
  const time = instant(now);
  if (!Number.isFinite(time)) return ['Prüfzeitpunkt ist ungültig.'];
  const errors = approvalErrors(policy,time);
  if (policy.active !== true) errors.push('Die neue Bewertungsregel ist noch nicht aktiviert.');
  if (!['elapsed-72-hours','berlin-calendar-days'].includes(policy.schedule)) errors.push('72 Stunden oder drei Berliner Kalendertage müssen ausdrücklich gewählt werden.');
  if (policy.timeZone !== 'Europe/Berlin') errors.push('Zeitzone Europe/Berlin muss bestätigt werden.');
  if (policy.schedule === 'berlin-calendar-days' && policy.calendarTime !== 'same-local-time') errors.push('Kalendertage mit derselben Berliner Uhrzeit müssen ausdrücklich bestätigt werden.');
  if (!validGoogleReviewUrl(policy.googleUrl) || policy.googleUrlVerified !== true || !hasText(policy.googleUrlEvidence) || !Number.isFinite(timestamp(policy.googleUrlVerifiedAt)) || timestamp(policy.googleUrlVerifiedAt) > time) errors.push('Der konkrete Google-Bewertungslink ist noch nicht mit Nachweis verifiziert.');
  if (policy.channel !== 'email') errors.push('Der vorbereitete E-Mail-Versandkanal ist noch nicht freigegeben.');
  if (!hasText(policy.optOutText)) errors.push('Der tatsächlich nutzbare Widerrufs- beziehungsweise Widerspruchsweg fehlt.');
  return errors;
}

function calendarDue(completed) {
  const formatter = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const parts = Object.fromEntries(formatter.formatToParts(new Date(completed)).filter(part => part.type !== 'literal').map(part => [part.type,Number(part.value)]));
  const target = new Date(Date.UTC(parts.year,parts.month-1,parts.day+3,parts.hour,parts.minute,parts.second,new Date(completed).getUTCMilliseconds()));
  // Compare wall-clock fields against a UTC formatter; the target itself is just a field carrier.
  const utcFormatter = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const expected = utcFormatter.format(target);
  const matches = [60,120].map(offset => +target-offset*60000).filter(candidate => formatter.format(new Date(candidate)) === expected);
  need(matches.length === 1,'Die Zieluhrzeit ist bei der Berliner Zeitumstellung nicht eindeutig. Versand bleibt bis zur gesonderten Entscheidung gesperrt.',409);
  return matches[0];
}

/** Pure eligibility check: no queue mutation, provider call or consent inference.
 * @param {any} order @param {any} config
 */
export function reviewEligibility(order, config = {}, now = Date.now()) {
  const time = instant(now);
  const policy = config.reviewPolicy;
  const errors = reviewPolicyErrors(policy,time);
  if (errors.length) return {due:false,dueAt:null,reason:errors.join(' ')};
  if (config.emailVerified !== true || config.sendApproved !== true || config.backgroundApproved !== true) return {due:false,dueAt:null,reason:'Versandanbieter, Versand oder Hintergrundverarbeitung sind noch nicht freigegeben.'};
  if (!['Erledigt','Bezahlt'].includes(order?.status) || order?.synthetic === true) return {due:false,dueAt:null,reason:'Kein abgeschlossener produktiver Vorgang.'};
  const completed = timestamp(order.completedAt);
  if (!Number.isFinite(completed) || completed > time) return {due:false,dueAt:null,reason:'Bestätigter Dienstleistungsabschluss mit gültigem Zeitpunkt fehlt.'};
  const consent = order.reviewConsent;
  if (!isObject(consent) || consent.granted !== true || consent.channel !== 'email' || !hasText(order.id) || consent.orderId !== order.id || !hasText(consent.recipient) || consent.recipient.trim().toLowerCase() !== String(order.source?.email ?? '').trim().toLowerCase() || !hasText(consent.version) || !hasText(consent.evidence) || !Number.isFinite(timestamp(consent.grantedAt)) || timestamp(consent.grantedAt) > time || consent.revoked === true || (consent.revokedAt !== undefined && consent.revokedAt !== null)) return {due:false,dueAt:null,reason:'Dokumentierte, gültige und nicht widerrufene Einwilligung für diesen Vorgang fehlt.'};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.source?.email ?? '')) return {due:false,dueAt:null,reason:'Gültige Kunden-E-Mail fehlt.'};
  let due;
  try { due = policy.schedule === 'elapsed-72-hours' ? completed+72*HOUR : calendarDue(completed); }
  catch (error) { return {due:false,dueAt:null,reason:error instanceof AppError ? error.message : 'Bewertungszeitpunkt ist nicht eindeutig berechenbar.'}; }
  return {due:time >= due,dueAt:new Date(due).toISOString(),reason:time >= due ? 'Freigegebene Bewertungsanfrage ist fällig.' : 'Drei-Tage-Frist ist noch nicht erreicht.'};
}

/** @param {any} order @param {any} config */
export function reviewDue(order, config = {}, now = Date.now()) {
  return reviewEligibility(order,config,now).due;
}

export function reviewRequestText(url, optOutText) {
  need(validGoogleReviewUrl(url),'Google-Bewertungslink ist ungültig.',409);
  need(hasText(optOutText),'Bestätigter Widerspruchsweg fehlt.',409);
  return 'Vielen Dank für Ihren Auftrag bei White Gloss. Wenn Sie möchten, teilen Sie Ihre ehrliche Erfahrung auf Google: '+url+'\n\n'+optOutText;
}

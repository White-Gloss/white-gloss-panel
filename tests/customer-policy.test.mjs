import test from 'node:test';
import assert from 'node:assert/strict';
import {cancellationPolicyErrors,cancellationSnapshot,cancellationPreview,proposedCancellationPolicy,reviewPolicyErrors,reviewEligibility,reviewDue,reviewRequestText,validGoogleReviewUrl} from '../src/customer-policy.mjs';
import {dueJobs} from '../src/domain.mjs';

// These choices are isolated test fixtures. No approved production configuration is shipped.
const at = '2026-10-02T10:00:00.000Z';
const epoch = Date.parse(at);
const url = 'https://g.page/r/SYNTHETIC-TEST/review';
function cancellation() {
  return {version:'TEST-v1',approved:true,approvedAt:'2026-10-01T11:00:00Z',approvedBy:'Synthetischer Betreiber',timeBasis:'elapsed-hours',timeZone:'Europe/Berlin',
    boundaries:{fiveDays:{atEquality:'free',definition:'TEST: genau 120 Stunden vorher kostenlos'},threeDays:{atEquality:'50-percent',definition:'TEST: genau 72 Stunden vorher 50 Prozent'},serviceDay:{startsAt:'berlin-midnight',definition:'TEST: am Termintag ab 00:00 Europe/Berlin'}},
    feeBasis:'TEST: vereinbarter Bruttobetrag einschließlich Extras, ohne Abholung',noShow:'TEST: manuelle Prüfung',operatorCancellation:'TEST: keine Gebühr',exceptions:'TEST: dokumentierte Einzelprüfung',lowerDamageText:'TEST: Nachweis keines oder wesentlich geringeren Schadens möglich.',terms:'TEST: vollständiger freigegebener Kundenwortlaut',feeCreation:'operator-confirmation',rates:{free:0,afterFiveDays:25,fromThreeDays:50,serviceDay:75},
    legalReview:{approved:true,reviewedAt:'2026-10-01T10:00:00Z',reviewer:'TEST: Rechtsprüfung',evidence:'TEST: isolierte Prüfungsreferenz'}};
}
function config(schedule = 'elapsed-72-hours') {
  return {emailVerified:true,sendApproved:true,backgroundApproved:true,reviewPolicy:{active:true,version:'TEST-review-v1',approved:true,approvedAt:'2026-01-01T11:00:00Z',approvedBy:'Synthetischer Betreiber',schedule,timeZone:'Europe/Berlin',calendarTime:'same-local-time',channel:'email',googleUrl:url,googleUrlVerified:true,googleUrlVerifiedAt:'2026-01-01T10:00:00Z',googleUrlEvidence:'TEST: Business-Profil und Ziellink geprüft',optOutText:'TEST: bestätigter Widerspruchsweg'}};
}
function order(completedAt = at) {
  return {id:'TEST-order-1',status:'Erledigt',completedAt,source:{email:'synthetic@example.invalid',reviewConsent:true},reviewConsent:{granted:true,channel:'email',orderId:'TEST-order-1',recipient:'synthetic@example.invalid',grantedAt:'2026-01-01T09:00:00Z',version:'TEST-consent-v1',evidence:'TEST: dokumentierte ausdrückliche Einwilligung'}};
}

test('pending policies remain closed without selecting cancellation defaults', () => {
  assert.ok(cancellationPolicyErrors(undefined,epoch).length);
  assert.ok(cancellationPolicyErrors({},epoch).length);
  assert.throws(() => cancellationSnapshot({},{}),{status:409});
  assert.ok(reviewPolicyErrors(undefined,epoch).length);
  assert.equal(reviewDue(order(),{},epoch+200*3600000),false);
  assert.equal(reviewDue(order(),{...config(),reviewPolicy:{...config().reviewPolicy,active:false}},epoch+200*3600000),false);
});

for (const key of ['version','approved','approvedAt','approvedBy','timeBasis','timeZone','boundaries','feeBasis','noShow','operatorCancellation','exceptions','lowerDamageText','terms','feeCreation','rates','legalReview']) {
  test('cancellation approval rejects a missing '+key, () => {
    const policy = cancellation(); delete policy[key];
    assert.ok(cancellationPolicyErrors(policy,epoch).length);
    assert.throws(() => cancellationSnapshot(policy,{accepted:true,role:'customer',orderId:'TEST-1',customerId:'TEST-customer',at,version:'TEST-v1'},epoch),{status:409});
  });
}

test('each cancellation equality and service-day decision is mandatory', () => {
  for (const key of ['fiveDays','threeDays','serviceDay']) {
    const policy = cancellation(); policy.boundaries[key] = {};
    assert.ok(cancellationPolicyErrors(policy,epoch).length);
  }
  const policy = cancellation(); policy.boundaries.serviceDay.startsAt = 'explicit-local-time';
  assert.ok(cancellationPolicyErrors(policy,epoch).length);
  policy.boundaries.serviceDay.localTime = '08:30';
  assert.deepEqual(cancellationPolicyErrors(policy,epoch),[]);
  policy.legalReview.reviewedAt = at;
  assert.ok(cancellationPolicyErrors(policy,epoch).length);
});

test('customer snapshot retains an immutable policy per order and rejects operator acceptance or changed versions', () => {
  const policy = cancellation();
  const acceptance = {accepted:true,role:'customer',orderId:'TEST-1',customerId:'TEST-customer',at,version:'TEST-v1'};
  const first = cancellationSnapshot(policy,acceptance,epoch);
  const second = cancellationSnapshot(policy,{...acceptance,orderId:'TEST-2'},epoch);
  policy.terms = 'changed'; policy.boundaries.fiveDays.atEquality = '25-percent';
  assert.equal(first.policy.terms,'TEST: vollständiger freigegebener Kundenwortlaut');
  assert.equal(first.policy.boundaries.fiveDays.atEquality,'free');
  assert.equal(first.acceptance.orderId,'TEST-1');
  assert.equal(second.acceptance.orderId,'TEST-2');
  assert.throws(() => { first.policy.boundaries.fiveDays.atEquality = '25-percent'; },TypeError);
  assert.throws(() => cancellationSnapshot(cancellation(),{...acceptance,role:'owner'},epoch),{status:409});
  assert.throws(() => cancellationSnapshot(cancellation(),{...acceptance,version:'other'},epoch),{status:409});
  assert.throws(() => cancellationSnapshot(cancellation(),{...acceptance,at:'2026-10-03T10:00:00Z'},epoch),{status:409});
});

test('72-hour review threshold is exact and tied to confirmed completion', () => {
  const due = epoch+72*3600000;
  assert.equal(reviewDue(order(),config(),due-1),false);
  assert.equal(reviewDue(order(),config(),due),true);
  assert.equal(reviewEligibility(order(),config(),due).dueAt,'2026-10-05T10:00:00.000Z');
  for (const status of ['In Arbeit','Termin verbindlich','Storniert','Abgelehnt']) assert.equal(reviewDue({...order(),status},config(),due),false);
  assert.equal(reviewDue({...order(),completedAt:undefined},config(),due),false);
  assert.equal(reviewDue(order('2026-10-10T10:00:00Z'),config(),due),false);
  assert.equal(reviewDue(order('2026-02-30T10:00:00Z'),config(),due),false);
  assert.equal(reviewDue({...order(),synthetic:true},config(),due),false);
});

test('Berlin calendar days preserve local completion time across spring and autumn DST', () => {
  for (const [completed,due,hours] of [['2026-03-26T09:00:00Z','2026-03-29T08:00:00.000Z',71],['2026-10-22T08:00:00Z','2026-10-25T09:00:00.000Z',73]]) {
    const result = reviewEligibility(order(completed),config('berlin-calendar-days'),Date.parse(due));
    assert.equal(result.due,true);
    assert.equal(result.dueAt,due);
    assert.equal(Date.parse(due)-Date.parse(completed),hours*3600000);
    assert.equal(reviewDue(order(completed),config('berlin-calendar-days'),Date.parse(due)-1),false);
    assert.equal(reviewEligibility(order(completed),config(),Date.parse(due)+3600000).dueAt,new Date(Date.parse(completed)+72*3600000).toISOString());
  }
});

test('calendar schedule holds an absent or ambiguous DST target instead of guessing', () => {
  for (const completed of ['2026-03-26T01:30:00Z','2026-10-22T00:30:00Z']) {
    const result = reviewEligibility(order(completed),config('berlin-calendar-days'),Date.parse(completed)+100*3600000);
    assert.equal(result.due,false);
    assert.equal(result.dueAt,null);
    assert.match(result.reason,/Zeitumstellung/);
  }
  const pending = config('berlin-calendar-days'); delete pending.reviewPolicy.calendarTime;
  assert.equal(reviewDue(order(),pending,epoch+100*3600000),false);
});

test('new schedule requires per-order consent with recipient, timestamp, version and evidence', () => {
  const due = epoch+72*3600000;
  for (const key of ['granted','channel','orderId','recipient','grantedAt','version','evidence']) {
    const record = order(); delete record.reviewConsent[key];
    assert.equal(reviewDue(record,config(),due),false,key);
  }
  assert.equal(reviewDue({...order(),reviewConsent:true},config(),due),false);
  assert.equal(reviewDue({...order(),reviewConsent:undefined},config(),due),false);
  const otherOrder = order(); otherOrder.reviewConsent.orderId = 'TEST-other';
  assert.equal(reviewDue(otherOrder,config(),due),false);
  const otherRecipient = order(); otherRecipient.source.email = 'other@example.invalid';
  assert.equal(reviewDue(otherRecipient,config(),due),false);
});

test('revocation and changed consent are rechecked at delivery time', () => {
  const record = order(); const due = epoch+72*3600000;
  assert.equal(reviewDue(record,config(),due),true);
  record.reviewConsent.revokedAt = '2026-10-05T09:59:59Z';
  assert.equal(reviewDue(record,config(),due),false);
  record.reviewConsent.revokedAt = null; record.reviewConsent.revoked = true;
  assert.equal(reviewDue(record,config(),due),false);
  record.reviewConsent.revoked = false; record.reviewConsent.grantedAt = '2026-10-06T10:00:00Z';
  assert.equal(reviewDue(record,config(),due),false);
});

test('provider, send, background and exact Google link approvals fail closed', () => {
  const due = epoch+72*3600000;
  for (const key of ['emailVerified','sendApproved','backgroundApproved']) assert.equal(reviewDue(order(),{...config(),[key]:false},due),false);
  for (const key of ['googleUrlVerified','googleUrlVerifiedAt','googleUrlEvidence','optOutText']) {
    const pending = config(); delete pending.reviewPolicy[key];
    assert.equal(reviewDue(order(),pending,due),false,key);
  }
  for (const value of ['http://g.page/r/TEST/review','https://g.page.evil.invalid/r/TEST/review','https://user:pass@g.page/r/TEST/review','https://g.page:8443/r/TEST/review','https://g.page/']) assert.equal(validGoogleReviewUrl(value),false,value);
  assert.equal(validGoogleReviewUrl(url),true);
});

test('neutral review text uses only supplied verified target and actual opt-out wording', () => {
  assert.equal(reviewRequestText(url,'TEST: Widerspruchsweg'),'Vielen Dank für Ihren Auftrag bei White Gloss. Wenn Sie möchten, teilen Sie Ihre ehrliche Erfahrung auf Google: '+url+'\n\nTEST: Widerspruchsweg');
  assert.throws(() => reviewRequestText(url,''),{status:409});
});

test('technical preparation preserves the existing 168-hour legacy schedule', () => {
  assert.deepEqual(dueJobs(order(),epoch+168*3600000-1),[]);
  assert.deepEqual(dueJobs(order(),epoch+168*3600000),['review']);
});

function feeFixture() {
  const policy = structuredClone(proposedCancellationPolicy);
  Object.assign(policy,{version:'TEST-approved-fee-v1',approved:true,approvedAt:'2026-10-01T11:00:00Z',approvedBy:'TEST Betreiber',terms:'TEST: ausdrücklich angenommene vollständige Bedingungen',legalReview:{approved:true,reviewedAt:'2026-10-01T10:00:00Z',reviewer:'TEST Prüfender',evidence:'TEST konkrete Vertragsprüfung'}});
  const acceptedAt = '2026-10-02T10:00:00Z';
  const record = {id:'TEST-order-1',status:'Termin verbindlich',acceptance:{at:acceptedAt},offer:{totalCents:10000,services:'TEST Fahrzeugpflege'},appointment:{start:'2026-10-12T07:00:00Z'}};
  record.cancellationTerms = cancellationSnapshot(policy,{accepted:true,role:'customer',orderId:record.id,customerId:'TEST-customer-1',at:acceptedAt,version:policy.version},Date.parse(acceptedAt));
  const input = {reason:'customer',documentedLossCents:10000,sparedCostsCents:0,replacementEarningsCents:0,lossEvidence:'TEST: konkret dokumentierter wirtschaftlicher Verlust'};
  return {policy,record,input};
}

test('proposed conservative policy is a frozen unapproved draft with no fee activation', () => {
  assert.equal(proposedCancellationPolicy.approved,false);
  assert.equal(proposedCancellationPolicy.legalReview.approved,false);
  assert.throws(() => { proposedCancellationPolicy.approved = true; },TypeError);
  const {record,input} = feeFixture();
  const preview = cancellationPreview(record,input,proposedCancellationPolicy,Date.parse('2026-10-09T08:00:00Z'));
  assert.equal(preview.eligible,false);
  assert.equal(preview.maxFeeCents,null);
  assert.equal(preview.issueAllowed,false);
});

test('operator instruction excludes an automatic fee policy and semantic equality ignores JSON key order', () => {
  const {policy,record,input} = feeFixture();
  assert.ok(cancellationPolicyErrors({...policy,feeCreation:'automatic'},epoch).length);
  const reordered = Object.fromEntries(Object.entries(policy).reverse());
  assert.equal(cancellationPreview(record,input,reordered,Date.parse('2026-10-09T08:00:00Z')).eligible,true);
});

test('fee preview makes 120-hour and 72-hour equalities exact and uses Berlin service-day midnight', () => {
  const {policy,record,input} = feeFixture();
  const start = Date.parse(record.appointment.start);
  for (const [when,percent] of [[start-120*3600000,0],[start-120*3600000+1,25],[start-72*3600000-1,25],[start-72*3600000,50],[Date.parse('2026-10-11T21:59:59.999Z'),50],[Date.parse('2026-10-11T22:00:00Z'),75]]) {
    const result = cancellationPreview(record,input,policy,when);
    assert.equal(result.eligible,true);
    assert.equal(result.capPercent,percent,new Date(when).toISOString());
    assert.equal(result.maxFeeCents,10000*percent/100);
    assert.equal(result.confirmed,false);
    assert.equal(result.feeCents,null);
    assert.equal(result.issueAllowed,false);
  }
});

test('service-day boundaries follow Berlin date on both DST changes', () => {
  for (const [start,before,midnight] of [['2027-03-28T07:00:00Z','2027-03-27T22:59:59.999Z','2027-03-27T23:00:00Z'],['2026-10-25T08:00:00Z','2026-10-24T21:59:59.999Z','2026-10-24T22:00:00Z']]) {
    const {policy,record,input} = feeFixture(); record.appointment.start = start;
    assert.equal(cancellationPreview(record,input,policy,Date.parse(before)).capPercent,50);
    assert.equal(cancellationPreview(record,input,policy,Date.parse(midnight)).capPercent,75);
  }
});

test('actual documented loss deducts spared costs and replacement earnings and caps the percentage', () => {
  const {policy,record,input} = feeFixture();
  const now = Date.parse('2026-10-11T22:00:00Z');
  const result = cancellationPreview(record,{...input,documentedLossCents:9000,sparedCostsCents:1000,replacementEarningsCents:5000},policy,now);
  assert.equal(result.capCents,7500);
  assert.equal(result.loss.substantiatedLossCents,3000);
  assert.equal(result.maxFeeCents,3000);
  assert.equal(cancellationPreview(record,{...input,sparedCostsCents:10000,replacementEarningsCents:10000},policy,now).maxFeeCents,0);
  for (const field of ['documentedLossCents','sparedCostsCents','replacementEarningsCents','lossEvidence']) {
    const incomplete = {...input}; delete incomplete[field];
    assert.equal(cancellationPreview(record,incomplete,policy,now).eligible,false,field);
  }
  assert.throws(() => cancellationPreview(record,{...input,documentedLossCents:-1},policy,now),{status:400});
});

test('personal fee confirmation allows reasoned reduction or waiver and cannot exceed documented maximum', () => {
  const {policy,record,input} = feeFixture(); const now = Date.parse('2026-10-09T08:00:00Z');
  for (const feeCents of [0,1000]) {
    const result = cancellationPreview(record,{...input,confirmed:true,confirmedBy:'TEST Betreiber',feeCents,waiverReason:'TEST: persönliche Entscheidung nach Rücksprache'},policy,now);
    assert.equal(result.confirmed,true);
    assert.equal(result.feeCents,feeCents);
    assert.equal(result.issueAllowed,false);
  }
  assert.throws(() => cancellationPreview(record,{...input,confirmed:true,confirmedBy:'TEST Betreiber',feeCents:1000},policy,now),{status:409});
  assert.throws(() => cancellationPreview(record,{...input,confirmed:true,feeCents:5000},policy,now),{status:409});
  assert.throws(() => cancellationPreview(record,{...input,confirmed:true,confirmedBy:'TEST Betreiber',feeCents:5001},policy,now),{status:409});
});

test('customer evidence of lower or no damage further reduces maximum without operator discretion', () => {
  const {policy,record,input} = feeFixture(); const now = Date.parse('2026-10-09T08:00:00Z');
  for (const amount of [0,2000]) {
    const result = cancellationPreview(record,{...input,customerProvenLossCents:amount,customerEvidence:'TEST: Kundennachweis geprüft'},policy,now);
    assert.equal(result.maxFeeCents,amount);
  }
  assert.throws(() => cancellationPreview(record,{...input,customerProvenLossCents:0},policy,now),{status:400});
});

test('operator cancellations and statutory withdrawal do not receive these cancellation fees', () => {
  const now = Date.parse('2026-10-09T08:00:00Z');
  for (const reason of ['operator','withdrawal']) {
    const result = cancellationPreview({id:'TEST-no-contract'},{reason},undefined,now);
    assert.equal(result.eligible,true);
    assert.equal(result.maxFeeCents,0);
    assert.equal(result.feeCents,0);
    assert.equal(result.issueAllowed,false);
    assert.throws(() => cancellationPreview({},{reason,feeCents:1},undefined,now),{status:400});
  }
});

test('no-show is held until appointment start and then capped at 75 percent of documented loss', () => {
  const {policy,record,input} = feeFixture(); const start = Date.parse(record.appointment.start);
  assert.equal(cancellationPreview(record,{...input,reason:'no-show'},policy,start-1).eligible,false);
  const result = cancellationPreview(record,{...input,reason:'no-show'},policy,start);
  assert.equal(result.eligible,true);
  assert.equal(result.capPercent,75);
  assert.equal(result.maxFeeCents,7500);
});

test('no retrospective fees, reused acceptance, modified version or already performed work', () => {
  const {policy,record,input} = feeFixture(); const now = Date.parse('2026-10-09T08:00:00Z');
  for (const mutation of [
    candidate => { delete candidate.cancellationTerms; },
    candidate => { candidate.cancellationTerms.acceptance.orderId = 'another'; },
    candidate => { candidate.cancellationTerms.acceptance.version = 'other'; },
    candidate => { candidate.cancellationTerms.policy.terms = 'changed after acceptance'; },
    candidate => { candidate.acceptance.at = '2026-10-01T12:00:00Z'; },
    candidate => { candidate.status = 'Erledigt'; },
    candidate => { candidate.completedAt = at; }
  ]) {
    const changed = structuredClone(record); mutation(changed);
    const result = cancellationPreview(changed,input,policy,now);
    assert.equal(result.eligible,false);
    assert.equal(result.maxFeeCents,null);
  }
});

test('percentage cap includes accepted amendments and rounds down in customer favour', () => {
  const {policy,record,input} = feeFixture();
  record.offer.totalCents = 10001;
  record.amendments = [{state:'accepted',amountCents:2000,services:'TEST Zusatz'}];
  const result = cancellationPreview(record,input,policy,Date.parse(record.appointment.start)-120*3600000+1);
  assert.equal(result.basisCents,12001);
  assert.equal(result.capCents,3000);
});

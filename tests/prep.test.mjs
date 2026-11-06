import test from 'node:test';
import assert from 'node:assert/strict';
import {mailPrep,inquiryGaps,morningBrief,followupDraft,bankMatch} from '../src/prep.mjs';

test('mail, inquiry, brief, follow-up and bank match stay suggestions', () => {
  assert.equal(mailPrep('Rechnung Oktober','').folder,'Rechnung');
  assert.equal(mailPrep('Newsletter Rabatt','').folder,'Werbung');
  assert.equal(mailPrep('Hallo',''),null);
  assert.deepEqual(inquiryGaps({name:'A'}),['Fahrzeug fehlt','Paket fehlt','Wunschtermin fehlt']);
  assert.deepEqual(inquiryGaps({vehicle:'A4',services:'Politur',wish:'Freitag'}),[]);
  const now=new Date('2026-11-04T08:00:00.000Z');
  const brief=morningBrief([{status:'Termin verbindlich',appointment:{start:'2026-11-04T10:00:00.000Z'}},{status:'Angebot offen'},{status:'Preise prüfen'}],now);
  assert.equal(brief.todayCount,1);assert.equal(brief.openOffers,1);assert.equal(brief.prices,1);assert.match(brief.nextTime,/11:00|12:00/);
  assert.match(followupDraft({status:'Angebot offen',wg:'WG-1',offer:{createdAt:'2026-10-01T00:00:00.000Z'}},now),/WG-1/);
  assert.equal(followupDraft({status:'Angebot offen',offer:{createdAt:'2026-11-03T00:00:00.000Z'}},now),null);
  assert.equal(bankMatch({amountMinor:1000,classification:{}},[{filename:'beleg.pdf',classification:{amountMinor:1000}}]).filename,'beleg.pdf');
  assert.equal(bankMatch({amountMinor:1000,classification:{documentId:'x'}},[{classification:{amountMinor:1000}}]),null);
});

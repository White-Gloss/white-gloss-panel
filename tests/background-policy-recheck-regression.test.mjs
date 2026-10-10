import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {init,background,setting,protect} from '../src/worker.mjs';

async function fixture(t,kind) {
  const env = {DB:new PanelDatabase(':memory:'),CONFIG_KEY:Buffer.alloc(32,6).toString('base64')};t.after(() => env.DB.close());await init(env);
  const now = Date.now(),at = new Date(now-14*86400000).toISOString(),id = randomUUID();
  const policy = {active:true,approved:true,version:'TEST-review-v1',approvedAt:at,approvedBy:'TEST Betreiber',schedule:'elapsed-72-hours',timeZone:'Europe/Berlin',channel:'email',googleUrl:'https://g.page/r/TEST-OLD/review',googleUrlVerified:true,googleUrlVerifiedAt:at,googleUrlEvidence:'TEST verifizierter Link',optOutText:'TEST alter Widerspruchshinweis'};
  const order = {id,wg:'TEST-background',status:kind==='review'?'Erledigt':'Termin verbindlich',source:{name:'TEST Kunde',email:'synthetic@example.invalid'},synthetic:false,...(kind==='review'?{completedAt:new Date(now-73*3600000).toISOString(),reviewConsent:{granted:true,channel:'email',recipient:'synthetic@example.invalid',orderId:id,grantedAt:at,version:'TEST-consent',evidence:'TEST dokumentierte Einwilligung'}}:{appointment:{start:new Date(now+24*3600000).toISOString(),delivery:'Kunde bringt'}})};
  await env.DB.prepare('INSERT INTO orders(id,wg,version,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,0)').bind(id,order.wg,1,order.status,JSON.stringify(order),at,'test','Isolierter Versandtest').run();
  for (const [key,value] of Object.entries({emailVerified:true,sendApproved:true,backgroundApproved:true,sender:'synthetic@example.invalid',reviewPolicy:policy})) await setting(env,key,value);
  await setting(env,'resendKey',await protect(env,'synthetic-key'));
  const sent = [];t.mock.method(globalThis,'fetch',async(url,options) => {assert.equal(String(url),'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'TEST-mail'});});
  function afterClaim(change) {
    const original = env.DB.prepare.bind(env.DB);let changed = false;
    t.mock.method(env.DB,'prepare',query => {
      const statement = original(query);
      if (query.startsWith('INSERT OR IGNORE INTO jobs')) {
        const run = statement.run.bind(statement);statement.run = async() => {
          const result = await run();if (!changed && result.meta.changes===1) {changed = true;await change();}return result;
        };
      }
      return statement;
    });
  }
  return {env,policy,sent,afterClaim};
}

test('review dispatch uses the exact verified URL and wording rechecked after claiming the job',async t => {
  const f = await fixture(t,'review');
  f.afterClaim(() => setting(f.env,'reviewPolicy',{...f.policy,version:'TEST-review-v2',googleUrl:'https://g.page/r/TEST-NEW/review',optOutText:'TEST neuer Widerspruchshinweis'}));
  await background(f.env);assert.equal(f.sent.length,1);
  assert.match(f.sent[0].text,/TEST-NEW/);assert.match(f.sent[0].text,/neuer Widerspruchshinweis/);assert.doesNotMatch(f.sent[0].text,/TEST-OLD/);
});

test('revoking send approval after a reminder job is claimed prevents the provider request',async t => {
  const f = await fixture(t,'reminder');f.afterClaim(() => setting(f.env,'sendApproved',false));
  await background(f.env);assert.equal(f.sent.length,0);
  assert.notEqual((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='reminder'").first()).state,'sent');
});

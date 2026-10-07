import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {init,background,setting,protect,getOrder} from '../src/worker.mjs';

async function fixture(t,{hours=73,revoked=false,status='Erledigt',active=true}={}){
  const env={DB:new PanelDatabase(':memory:'),CONFIG_KEY:Buffer.alloc(32,6).toString('base64')};t.after(()=>env.DB.close());await init(env);const id=randomUUID(),start=new Date(Date.now()-hours*3600000).toISOString(),approval=new Date(Date.now()-14*86400000).toISOString();
  const o={id,wg:'TEST-REVIEW-'+id,status,synthetic:false,source:{name:'Testkunde',email:'synthetic@example.invalid',reviewConsent:true},completedAt:start,reviewConsent:{granted:true,channel:'email',recipient:'synthetic@example.invalid',orderId:id,grantedAt:approval,version:'TEST-CONSENT',evidence:'Isolierter Einwilligungsnachweis',...(revoked?{revokedAt:approval}:{})}};
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,0)').bind(id,o.wg,1,status,JSON.stringify(o),start,'test','fixture').run();
  const policy={active,approved:true,version:'TEST-REVIEW',approvedAt:approval,approvedBy:'TESTBETREIBER',schedule:'elapsed-72-hours',timeZone:'Europe/Berlin',channel:'email',googleUrl:'https://g.page/r/SYNTHETIC/review',googleUrlVerified:true,googleUrlVerifiedAt:approval,googleUrlEvidence:'Synthetischer Linknachweis',optOutText:'TEST: Widerspruch über Ihr Kundenpanel.'};
  for(const [key,value] of Object.entries({reviewPolicy:policy,emailVerified:true,sendApproved:true,backgroundApproved:true,sender:'test@example.invalid'}))await setting(env,key,value);await setting(env,'resendKey',await protect(env,'synthetic-key'));
  const sent=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'synthetic-mail'});});return {env,id,sent};
}
test('new review scheduler sends after 72h once across repeated and concurrent background runs',async t=>{
  const {env,sent}=await fixture(t);await Promise.all([background(env),background(env)]);await background(env);assert.equal(sent.length,1);assert.match(sent[0].text,/ehrliche Erfahrung/);assert.match(sent[0].text,/Widerspruch/);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='review' AND state='sent'").first()).n,1);
});
test('disabled new policy never falls back to legacy consent or seven-day dispatch',async t=>{const {env,sent}=await fixture(t,{hours:200,active:false});await background(env);assert.equal(sent.length,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);});
for(const setup of [{hours:71.99},{revoked:true},{status:'Storniert'}])test('review scheduler blocks '+JSON.stringify(setup),async t=>{const {env,sent}=await fixture(t,setup);await background(env);assert.equal(sent.length,0);});
test('unknown review delivery remains locked instead of issuing a second request',async t=>{
  const {env,id}=await fixture(t);let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;throw Error('Synthetisch verlorene Anbieterantwort');});await background(env);await background(env);assert.equal(count,1);assert.equal((await env.DB.prepare("SELECT state FROM jobs WHERE kind='review'").first()).state,'unknown');assert.equal((await getOrder(env,id)).status,'Erledigt');
});
test('legacy seven-day processing remains possible without the new policy and with unrevoked consent',async t=>{
  const {env,sent}=await fixture(t,{hours:200});await env.DB.prepare("DELETE FROM settings WHERE key='reviewPolicy'").run();await setting(env,'reviewUrl','https://g.page/r/SYNTHETIC/review');await background(env);assert.equal(sent.length,1);
});
for(const consent of [{granted:false},{granted:true,revokedAt:'2020-01-01T12:00:00Z'}])test('explicit customer withdrawal blocks legacy source consent without an activated new policy '+JSON.stringify(consent),async t=>{
  const {env,id,sent}=await fixture(t,{hours:200});await env.DB.prepare("DELETE FROM settings WHERE key='reviewPolicy'").run();await setting(env,'reviewUrl','https://g.page/r/SYNTHETIC/review');const order=await getOrder(env,id);assert.equal(order.source.reviewConsent,true);order.reviewConsent={...order.reviewConsent,...consent};await env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),id).run();await Promise.all([background(env),background(env)]);await background(env);assert.equal(sent.length,0);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='review'").first()).n,0);
});

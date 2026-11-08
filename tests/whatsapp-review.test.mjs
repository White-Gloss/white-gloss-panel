import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestWhatsAppWebhook} from '../server/whatsapp.mjs';
import {protect,unprotect} from '../src/worker.mjs';

const origin='https://meta-review.example.invalid',owner='reviewer@example.invalid';
const policy={WHATSAPP_REVIEW_MODE:'true',WHATSAPP_REVIEW_ORIGIN:origin,WHATSAPP_REVIEW_PHONE_NUMBER_ID:'123456789012345',WHATSAPP_REVIEW_RECIPIENT:'+491700000000',WHATSAPP_REVIEW_GRAPH_VERSION:'v99.1',WHATSAPP_REVIEW_ACCESS_TOKEN:'synthetic-asset-limited-review-token'};
const input=()=>({requestId:randomUUID(),phoneNumberId:policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID,recipient:policy.WHATSAPP_REVIEW_RECIPIENT,confirmed:true});
function environment(t,overrides={}){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('asset')},...policy,...overrides};
  t.after(()=>env.DB.close());return env;
}
async function fixture(t,overrides={}){
  const checks=[],sends=[],env=environment(t,{WHATSAPP_ADAPTERS:{async check(config){checks.push(config);return {id:policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID,verified_name:'Synthetic test sender',display_phone_number:'+1 555 0000000'};},async sendTest(config,payload){sends.push({config,payload});return {messages:[{id:'wamid.synthetic.review'}]};}},...overrides});
  const app=await createApplication(env),raw=randomBytes(32).toString('hex'),customer=randomBytes(32).toString('hex');
  for(const [cookie,email] of [[raw,owner],[customer,'customer@example.invalid']])await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(cookie),email,Date.now()+3600000,Date.now()).run();
  const call=(path,body,role='owner',requestOrigin=origin,urlOrigin=origin)=>app.fetch(new Request(urlOrigin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,...(role?{cookie:'__Host-wg-session='+(role==='owner'?raw:customer)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call,checks,sends};
}

test('review startup seeds encrypted outbound credentials once; only the owner can read the fixed recipient',async t=>{
  const f=await fixture(t),before=await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first();
  assert.equal(before.phone_number_id,policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID);assert.equal(before.app_secret,'');assert.equal(before.verify_token,'');assert.equal(before.verified_at,null);
  assert.equal(await unprotect(f.env,before.access_token),policy.WHATSAPP_REVIEW_ACCESS_TOKEN);assert.equal(JSON.stringify(before).includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);
  const response=await f.call('/api/whatsapp'),raw=await response.text(),view=JSON.parse(raw);
  assert.equal(response.status,200);assert.equal(view.settings.reviewMode,true);assert.equal(view.settings.configured,true);assert.equal(view.settings.reviewRecipient,policy.WHATSAPP_REVIEW_RECIPIENT);assert.equal(raw.includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);assert.equal(raw.includes(before.access_token),false);
  assert.deepEqual(await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first(),before);
  for(const role of [false,'customer']){const denied=await f.call('/api/whatsapp',undefined,role),body=await denied.text();assert.equal(denied.status,role?403:401);assert.equal(body.includes(policy.WHATSAPP_REVIEW_RECIPIENT),false);assert.equal(body.includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);}
  const generic=await (await f.call('/api/state')).text();assert.equal(generic.includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);assert.equal(generic.includes(before.access_token),false);assert.equal(generic.includes(policy.WHATSAPP_REVIEW_RECIPIENT),false);
  assert.equal(f.checks.length,0);assert.equal(f.sends.length,0);
});

test('review check and explicitly confirmed fixed send work without a production app secret',async t=>{
  const f=await fixture(t),body=input();
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);
  assert.equal((await f.call('/api/whatsapp/check',{})).status,200);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,confirmed:false})).status,400);
  assert.equal((await f.call('/api/whatsapp/test-send',body,'owner','https://other.example.invalid')).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send',body,false)).status,401);
  assert.equal((await f.call('/api/whatsapp/test-send',body,'customer')).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send?test=true',body)).status,409);
  const sent=await f.call('/api/whatsapp/test-send',body);assert.equal(sent.status,200,await sent.text());
  assert.equal(f.checks.length,1);assert.equal(f.sends.length,1);assert.equal(f.sends[0].config.accessToken,policy.WHATSAPP_REVIEW_ACCESS_TOKEN);
  assert.deepEqual(f.sends[0].payload,{messaging_product:'whatsapp',to:policy.WHATSAPP_REVIEW_RECIPIENT,type:'template',template:{name:'hello_world',language:{code:'en_US'}}});
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,200);assert.equal(f.sends.length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
  assert.equal(JSON.stringify((await f.env.DB.prepare('SELECT * FROM whatsapp_test_sends').all()).results).includes(policy.WHATSAPP_REVIEW_RECIPIENT),false);
});

test('review sender and recipient restrictions apply before the idempotency ledger, regardless of submitted flags',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});const body=input();
  const attempts=[{phoneNumberId:'999999999999999'},{recipient:'+491700000001'},{phoneNumberId:'999999999999999',recipient:'+491700000001',WHATSAPP_REVIEW_MODE:false,reviewMode:false}];
  for(const patch of attempts)assert.equal((await f.call('/api/whatsapp/test-send',{...body,...patch})).status,403);
  assert.equal(f.sends.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_test_sends').first()).n,0);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,200);
  for(const patch of attempts)assert.equal((await f.call('/api/whatsapp/test-send',{...body,...patch})).status,403);
  assert.equal(f.sends.length,1);
});

test('review settings, webhooks, analysis, order import, and media routes stay blocked',async t=>{
  const f=await fixture(t),before=await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first();
  for(const route of ['/settings','/settings?test=true','/analyze','/apply','/media/assign','/webhook']){
    assert.equal((await f.call('/api/whatsapp'+route,{...input(),accessToken:'replacement',appSecret:'replacement',verifyToken:'replacement',reviewMode:false})).status,403,route);
  }
  assert.equal((await f.call('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=anything&hub.challenge=123',undefined,false)).status,403);
  assert.equal((await f.call('/api/whatsapp/media/assign')).status,403);
  await assert.rejects(ingestWhatsAppWebhook(f.env,{object:'whatsapp_business_account'}),error=>error.status===403);
  assert.deepEqual(await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first(),before);assert.equal(f.checks.length,0);assert.equal(f.sends.length,0);
});

test('review policy cannot be changed by mutating environment values after startup',async t=>{
  const f=await fixture(t);Object.assign(f.env,{WHATSAPP_REVIEW_MODE:'false',WHATSAPP_REVIEW_ORIGIN:'https://panel.example.invalid',WHATSAPP_REVIEW_PHONE_NUMBER_ID:'999999999999999',WHATSAPP_REVIEW_RECIPIENT:'+491700000001',WHATSAPP_REVIEW_ACCESS_TOKEN:'replacement'});
  assert.equal((await f.call('/api/whatsapp/settings',{})).status,403);
  assert.equal((await f.call('/api/whatsapp/check',{})).status,200);assert.equal(f.checks[0].phoneNumberId,policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID);assert.equal(f.checks[0].accessToken,policy.WHATSAPP_REVIEW_ACCESS_TOKEN);
  assert.equal((await f.call('/api/whatsapp/test-send',{...input(),recipient:'+491700000001'})).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send',input())).status,200);assert.equal(f.sends.length,1);
  const view=await (await f.call('/api/whatsapp')).json();assert.equal(view.settings.reviewRecipient,policy.WHATSAPP_REVIEW_RECIPIENT);
  f.env.PANEL_ORIGIN='https://panel.example.invalid';const wrongOrigin=await f.call('/api/whatsapp/check',{},'owner',f.env.PANEL_ORIGIN,f.env.PANEL_ORIGIN);assert.equal(wrongOrigin.status,503);assert.equal(f.checks.length,1);
});

for(const [name,patch] of Object.entries({
  disabled:{WHATSAPP_REVIEW_MODE:'false'},partial:{WHATSAPP_REVIEW_ACCESS_TOKEN:undefined},wrongOrigin:{WHATSAPP_REVIEW_ORIGIN:'https://meta-review.other.invalid'},productionHost:{PANEL_ORIGIN:'https://panel.example.invalid',WHATSAPP_REVIEW_ORIGIN:'https://panel.example.invalid'},http:{PANEL_ORIGIN:'http://meta-review.example.invalid',WHATSAPP_REVIEW_ORIGIN:'http://meta-review.example.invalid'},originPath:{WHATSAPP_REVIEW_ORIGIN:origin+'/'},senderNewline:{WHATSAPP_REVIEW_PHONE_NUMBER_ID:'123456789012345\n'},recipientNewline:{WHATSAPP_REVIEW_RECIPIENT:'+491700000000\n'},versionNewline:{WHATSAPP_REVIEW_GRAPH_VERSION:'v99.1\n'},invalidSender:{WHATSAPP_REVIEW_PHONE_NUMBER_ID:'../../../other'},invalidRecipient:{WHATSAPP_REVIEW_RECIPIENT:'01700000000'},invalidVersion:{WHATSAPP_REVIEW_GRAPH_VERSION:'https://other.invalid'},emptyToken:{WHATSAPP_REVIEW_ACCESS_TOKEN:''},tokenNewline:{WHATSAPP_REVIEW_ACCESS_TOKEN:'synthetic\r\ntoken'}
}))test('invalid review deployment fails startup: '+name,async t=>{
  const env=environment(t,patch);await assert.rejects(createApplication(env));
});

for(const field of ['phone_number_id','graph_version','access_token','app_secret','verify_token','missing'])test('persisted review credential drift fails closed without repair: '+field,async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});const body=input();assert.equal((await f.call('/api/whatsapp/test-send',body)).status,200);
  if(field==='missing')await f.env.DB.prepare('DELETE FROM whatsapp_settings').run();
  else {const value=field==='access_token'?await protect(f.env,'replacement-token'):field==='graph_version'?'v98.1':field==='phone_number_id'?'999999999999999':'unexpected-webhook-secret';await f.env.DB.prepare('UPDATE whatsapp_settings SET '+field+'=? WHERE id=1').bind(value).run();}
  const drift=await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first();
  for(const [path,payload] of [['/api/whatsapp',undefined],['/api/whatsapp/check',{}],['/api/whatsapp/test-send',body],['/api/whatsapp/test-send',input()]]){
    const denied=await f.call(path,payload),raw=await denied.text();assert.equal(denied.status,503,path);assert.equal(raw.includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);assert.equal(raw.includes('replacement-token'),false);
  }
  assert.equal(f.checks.length,1);assert.equal(f.sends.length,1);assert.deepEqual(await f.env.DB.prepare('SELECT * FROM whatsapp_settings').first(),drift);
  // A fresh startup must not silently replace a conflicting persisted configuration.
  if(field!=='missing')await assert.rejects(createApplication({...f.env}),error=>error.status===503);
});

test('review Graph requests use only the fixed endpoint; redirects never expose the token or trigger a follow-up',async t=>{
  const f=await fixture(t);delete f.env.WHATSAPP_ADAPTERS.check;let requests=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{requests.push({url,options});return new Response(null,{status:302,headers:{location:'https://other.example.invalid/'+policy.WHATSAPP_REVIEW_ACCESS_TOKEN}});});
  const failed=await f.call('/api/whatsapp/check',{});assert.equal(failed.status,502);assert.equal((await failed.text()).includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);assert.equal(requests.length,1);assert.equal(requests[0].options.redirect,'manual');assert.equal(requests[0].url,'https://graph.facebook.com/v99.1/123456789012345?fields=id,display_phone_number,verified_name');
  f.env.WHATSAPP_ADAPTERS.check=async()=>({id:policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID});await f.call('/api/whatsapp/check',{});delete f.env.WHATSAPP_ADAPTERS.sendTest;requests=[];
  const body=input(),send=await f.call('/api/whatsapp/test-send',body);assert.equal(send.status,502);assert.equal((await send.text()).includes(policy.WHATSAPP_REVIEW_ACCESS_TOKEN),false);assert.equal(requests.length,1);assert.equal(requests[0].options.redirect,'manual');assert.equal(requests[0].url,'https://graph.facebook.com/v99.1/123456789012345/messages');assert.equal(requests[0].options.headers.Authorization,'Bearer '+policy.WHATSAPP_REVIEW_ACCESS_TOKEN);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);assert.equal(requests.length,1);
});

test('production still requires webhook secrets and cannot be switched to review mode after startup',async t=>{
  const unset=Object.fromEntries(Object.keys(policy).map(key=>[key,undefined])),f=await fixture(t,unset),settings={phoneNumberId:policy.WHATSAPP_REVIEW_PHONE_NUMBER_ID,graphVersion:policy.WHATSAPP_REVIEW_GRAPH_VERSION,accessToken:policy.WHATSAPP_REVIEW_ACCESS_TOKEN};
  assert.equal((await f.call('/api/whatsapp/settings',settings)).status,400);
  assert.equal((await f.call('/api/whatsapp/settings',{...settings,appSecret:'synthetic-app-secret',verifyToken:'synthetic-verify-token'})).status,200);
  Object.assign(f.env,policy);const view=await (await f.call('/api/whatsapp')).json();assert.equal(view.settings.reviewMode,undefined);assert.equal(view.settings.reviewRecipient,undefined);
  await f.env.DB.prepare("UPDATE whatsapp_settings SET app_secret='',verify_token='' WHERE id=1").run();
  assert.equal((await f.call('/api/whatsapp/check',{})).status,409);assert.equal((await f.call('/api/whatsapp/test-send',input())).status,409);assert.equal(f.checks.length,0);assert.equal(f.sends.length,0);
});

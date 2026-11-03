import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {JSDOM} from 'jsdom';
import {mountAgent} from '../public/agent.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
const externalFetch=mock.method(globalThis,'fetch',async()=>{throw Error('External traffic forbidden in agent tests');});
test.after(()=>assert.equal(externalFetch.mock.callCount(),0,'all traffic must use injected adapters'));
const origin='https://panel.example.invalid',owner='owner@example.invalid';
async function fixture(t,extra={}){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('asset')},...extra};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  for(const [token,email] of [['owner',owner],['customer','customer@example.invalid']])await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(digest(token)),email,Date.now()+3600000,Date.now()).run();
  const call=(path='/api/agent',body,role='owner',headers={},method=body===undefined?'GET':'POST')=>app.fetch(new Request(origin+path,{method,headers:{origin,cookie:'__Host-wg-session='+digest(role),...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call};
}
async function seed(env,count=23){
  for(let i=0;i<count;i++){
    const data={source:{name:'Name '+i,vehicle:'Vehicle '+i,package:'Pflege',raw:{password:'RAW-SECRET'},email:'PRIVATE-EMAIL'},assessment:{totalCents:12345},appointment:{start:'2026-11-10T10:00:00Z',end:'2026-11-10T12:00:00Z',secret:'APPOINTMENT-SECRET'},signature:'SIGNATURE-SECRET',bank:{iban:'BANK-SECRET'}};
    if(i===21)data.trash={deletedAt:'2026-11-01'};
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind('id-'+i,'WG-'+i,'Neu',JSON.stringify(data),'2026-11-03T10:'+String(i).padStart(2,'0')+':00Z','test','test',i===22?1:0).run();
  }
}
test('bridge authenticates bearer only and returns bounded safe real order context without a Hermes key',async t=>{
  const f=await fixture(t,{PANEL_AGENT_ENABLED:'true',PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret')});await seed(f.env);
  const path='/api/agent-bridge/context',auth={authorization:'Bearer bridge-secret'};
  assert.equal((await f.call(path)).status,401);
  assert.equal((await f.call(path,undefined,'owner',{authorization:'Bearer wrong'})).status,401);
  assert.equal((await f.call(path,{},'anonymous',auth)).status,405);
  const response=await f.call(path,undefined,'anonymous',auth);assert.equal(response.status,200);
  const view=await response.json();assert.equal(view.mode,'read-only');assert.equal(view.counts.total,21);assert.equal(view.counts.byStatus.Neu,21);assert.equal(view.orders.length,20);assert.equal(view.truncated,true);
  assert.deepEqual(Object.keys(view.orders[0]).sort(),['id','wg','status','name','vehicle','package','totalCents','priceBasis','pricesReviewed','agreedTotalCents','appointment','updatedAt'].sort());
  assert.deepEqual(view.orders[0].appointment,{start:'2026-11-10T10:00:00Z',end:'2026-11-10T12:00:00Z'});
  assert.doesNotMatch(JSON.stringify(view),/SECRET|PRIVATE-EMAIL|bridge-secret/);
  const found=await (await f.call(path+'?q=WG-20',undefined,'anonymous',auth)).json();assert.equal(found.orders.length,1);assert.equal(found.counts.total,1);assert.equal(found.truncated,false);
  assert.equal((await f.call(path+'?q='+ 'x'.repeat(101),undefined,'anonymous',auth)).status,400);
  const injection=await (await f.call(path+'?q='+encodeURIComponent("' OR 1=1 --"),undefined,'anonymous',auth)).json();assert.equal(injection.orders.length,0);
  f.env.PANEL_AGENT_ENABLED='false';assert.equal((await f.call(path,undefined,'anonymous',auth)).status,503);
});
test('context distinguishes unreviewed assessment drafts from an accepted offer amount',async t=>{
  const f=await fixture(t,{PANEL_AGENT_ENABLED:'true',PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret')});await seed(f.env,1);
  const view=async()=> (await f.call('/api/agent-bridge/context',undefined,'anonymous',{authorization:'Bearer bridge-secret'})).json();
  let order=(await view()).orders[0];
  assert.equal(order.priceBasis,'assessment-draft');assert.equal(order.pricesReviewed,false);assert.equal(order.agreedTotalCents,null);
  await f.env.DB.prepare('UPDATE orders SET data=?,status=?,version=version+1 WHERE id=?').bind(JSON.stringify({source:{name:'Test'},assessment:{totalCents:99900,pricesReviewed:false},offer:{totalCents:12345},acceptance:{mode:'online',signature:'SECRET'}}),'Angenommen','id-0').run();
  order=(await view()).orders[0];assert.equal(order.totalCents,99900);assert.equal(order.pricesReviewed,false);assert.equal(order.agreedTotalCents,12345);
  assert.doesNotMatch(JSON.stringify(order),/SECRET/);
});

const ready={PANEL_AGENT_ENABLED:'true',HERMES_AGENT_READ_ONLY_CONFIRMED:'true',HERMES_AGENT_ORIGIN:'https://hermes.example.invalid',HERMES_AGENT_API_KEY:'upstream-secret'};
const input=()=>({requestId:randomUUID(),message:'Welche Aufträge sind offen?',confirmed:true});
const completion=(content='Nur lesende Auskunft.',finish_reason='stop')=>new Response(JSON.stringify({choices:[{finish_reason,message:{content}}]}));
test('chat forwards confirmed owner requests to Hermes with restricted context and replays exactly once',async t=>{
  const calls=[];const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async(url,options)=>{calls.push({url,options});return completion();}}});await seed(f.env);
  const message=input();const response=await f.call('/api/agent/chat',message);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.ok,true,'the real response must match the panel chat success contract');assert.equal(result.reply,'Nur lesende Auskunft.');assert.equal(result.requestId,message.requestId);assert.equal(result.mode,'read-only');
  assert.deepEqual(await (await f.call('/api/agent/chat',message)).json(),result);assert.equal(calls.length,1);
  assert.equal(calls[0].url,ready.HERMES_AGENT_ORIGIN+'/v1/chat/completions');const opts=calls[0].options;
  assert.equal(opts.redirect,'manual');assert.ok(opts.signal);assert.equal(opts.headers.Authorization,'Bearer upstream-secret');assert.equal(opts.headers['Idempotency-Key'],message.requestId);
  const payload=JSON.parse(opts.body);assert.equal(payload.model,'hermes-agent');assert.equal(payload.stream,false);assert.equal(payload.messages.at(-1).content,message.message);
  assert.match(payload.messages[0].content,/untrusted/i);assert.match(payload.messages[0].content,/read.only/i);assert.match(JSON.stringify(payload),/BEGIN_UNTRUSTED_CRM_DATA/);assert.doesNotMatch(opts.body,/SECRET|PRIVATE-EMAIL|upstream-secret/);
  const row=await f.env.DB.prepare('SELECT * FROM agent_requests WHERE request_id=?').bind(message.requestId).first();assert.equal(row.state,'completed');assert.match(row.request_hash,/^[a-f0-9]{64}$/);assert.deepEqual(JSON.parse(row.result),result);
  assert.equal((await f.call('/api/agent/chat',{...message,message:'different'})).status,409);assert.equal(calls.length,1);
  assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM orders').first()).n,23);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM jobs').first()).n,0);
});
test('concurrent claims return pending conflict and quota is transactional across unique requests',async t=>{
  let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let calls=0;
  const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;entered();if(calls===1)await wait;return completion();}}});
  const body=input(),first=f.call('/api/agent/chat',body);await started;
  assert.equal((await f.call('/api/agent/chat',body)).status,409);
  const simultaneous=await Promise.all([f.call('/api/agent/chat',{...body,requestId:randomUUID(),message:'Distinct A'}),f.call('/api/agent/chat',{...body,requestId:randomUUID(),message:'Distinct B'})].map(async promise=>{release();return promise;}));
  assert.equal((await first).status,200);assert.ok(simultaneous.every(r=>r.status===200));assert.equal(calls,3);
  // Exercise a real same-ID race before either caller can read an existing claim.
  const race={...input(),message:'ID race'},responses=await Promise.all([f.call('/api/agent/chat',race),f.call('/api/agent/chat',race)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(calls,4);
  const rest=await Promise.all(Array.from({length:20},(_,i)=>f.call('/api/agent/chat',{...input(),message:'Quota '+i})));
  assert.equal(rest.filter(r=>r.status===200).length,16);assert.equal(rest.filter(r=>r.status===429).length,4);assert.equal(calls,20);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM agent_requests').first()).n,20);
});
test('upstream ambiguity, errors, non-stop finish reasons and oversized responses stay unknown without replay',async t=>{
  const cases=[['network',async()=>{throw Error('secret provider error');}],['redirect',async()=>new Response(null,{status:302,headers:{location:'https://other.invalid'}})],['http',async()=>new Response('secret',{status:500})],['invalid-json',async()=>new Response('{')],['api-error',async()=>new Response(JSON.stringify({error:{message:'secret'},choices:[{finish_reason:'stop',message:{content:'Executed!'}}]}))],['length',async()=>completion('Executed!','length')],['tool_calls',async()=>completion('Executed!','tool_calls')],['empty',async()=>completion('')],['oversize',async()=>completion('x'.repeat(131072))],['stream-oversize',async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(131073)));c.close();}}))]];
  for(const [name,adapter] of cases)await t.test(name,async t=>{
    let calls=0;const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async(...args)=>{calls++;return adapter(...args);}}});const body=input();
    const response=await f.call('/api/agent/chat',body);assert.equal(response.status,502);const text=await response.text();assert.doesNotMatch(text,/Executed|secret/);assert.match(text,/ungeklärt/);
    assert.equal((await f.env.DB.prepare('SELECT state FROM agent_requests WHERE request_id=?').bind(body.requestId).first()).state,'unknown');
    assert.equal((await f.call('/api/agent/chat',body)).status,409);assert.equal(calls,1);
  });
});
test('validation and explicit opt-ins reject before any upstream call or ledger claim',async t=>{
  let calls=0;const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;return completion();}}});
  for(const role of ['customer','anonymous'])assert.equal((await f.call('/api/agent/chat',input(),role)).status,role==='customer'?403:401);
  assert.equal((await f.call('/api/agent/chat',input(),'owner',{origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.call('/api/agent/chat',input(),'owner',{'content-type':'text/plain'})).status,415);
  for(const body of [null,{}, {...input(),confirmed:false},{...input(),requestId:'bad'}, {...input(),message:' '}, {...input(),message:'x'.repeat(4001)}])assert.equal((await f.call('/api/agent/chat',body)).status,400);
  assert.equal((await f.call('/api/agent/chat',{...input(),extra:'x'.repeat(33000)})).status,413);
  for(const key of ['PANEL_AGENT_ENABLED','HERMES_AGENT_READ_ONLY_CONFIRMED']){f.env[key]='false';assert.equal((await f.call('/api/agent/chat',input())).status,503);f.env[key]='true';}
  for(const value of ['http://hermes.invalid','https://user:pass@hermes.invalid','https://hermes.invalid/path','https://hermes.invalid?x=1','https://hermes.invalid#x','https://hermes.invalid:8443']){f.env.HERMES_AGENT_ORIGIN=value;assert.equal((await f.call('/api/agent/chat',input())).status,503);}
  assert.equal(calls,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM agent_requests').first()).n,0);
});
test('deadline bounds an adapter that ignores abort and marks its claim unknown',async t=>{
  let entered;const started=new Promise(r=>entered=r);const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{entered();return new Promise(()=>{});}}});
  t.mock.timers.enable({apis:['setTimeout']});const body=input(),pending=f.call('/api/agent/chat',body);await started;t.mock.timers.tick(30001);
  const result=await pending;assert.equal(result.status,502);assert.equal((await f.env.DB.prepare('SELECT state FROM agent_requests WHERE request_id=?').bind(body.requestId).first()).state,'unknown');
});
test('bridge namespace never falls back to session identity and caps malicious source strings',async t=>{
  const f=await fixture(t,{PANEL_AGENT_ENABLED:'true',PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret')});await seed(f.env,1);
  assert.equal((await f.call('/api/agent-bridge/unknown')).status,401);
  assert.equal((await f.call('/api/agent-bridge/unknown',undefined,'anonymous',{authorization:'Bearer bridge-secret'})).status,404);
  const data={source:{name:'x'.repeat(200000),vehicle:'y'.repeat(200000),package:'z'.repeat(200000)}};
  await f.env.DB.prepare('UPDATE orders SET data=?,status=?,version=version+1').bind(JSON.stringify(data),'s'.repeat(200000)).run();
  const result=await f.call('/api/agent-bridge/context',undefined,'anonymous',{authorization:'Bearer bridge-secret'});const text=await result.text();assert.ok(Buffer.byteLength(text)<131072);assert.equal(JSON.parse(text).counts.total,1);
});
test('bridge enforces a byte cap even when JSON escaping expands bounded fields',async t=>{
  const f=await fixture(t,{PANEL_AGENT_ENABLED:'true',PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret')});await seed(f.env,20);
  const giant='\u0001'.repeat(2000),data={source:{name:giant,vehicle:giant,package:giant},appointment:{start:giant,end:giant}};
  for(let i=0;i<20;i++)await f.env.DB.prepare('UPDATE orders SET data=?,wg=?,status=?,updated_at=?,version=version+1 WHERE id=?').bind(JSON.stringify(data),giant+i,giant,giant,'id-'+i).run();
  const result=await f.call('/api/agent-bridge/context',undefined,'anonymous',{authorization:'Bearer bridge-secret'}),text=await result.text();assert.ok(Buffer.byteLength(text)<131072);const view=JSON.parse(text);assert.equal(view.counts.total,20);assert.equal(view.truncated,true);assert.ok(view.orders.length<20);
});
test('real panel chat consumes the authenticated backend response and shows its answer',async t=>{
  let calls=0;
  const f=await fixture(t,{...ready,PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret'),HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;return completion('Geprüfte Auskunft <kein HTML>.');}}});
  await seed(f.env,1);
  const dom=new JSDOM('<div id="agent"></div>',{url:origin});t.after(()=>dom.window.close());
  const root=dom.window.document.querySelector('#agent');let completed;
  const done=new Promise(resolve=>completed=resolve);
  await mountAgent(root,{fetchImpl:async(url,options={})=>{
    const response=await f.call(url,options.body?JSON.parse(options.body):undefined);
    if(url==='/api/agent/chat')setImmediate(completed);
    return response;
  }});
  const form=root.querySelector('form');assert.equal(form.elements.message.disabled,false);
  form.elements.message.value='Welche Aufträge sind offen?';form.elements.confirmed.checked=true;
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  await done;await new Promise(resolve=>setImmediate(resolve));
  assert.equal(root.querySelector('[data-agent-output]').textContent,'Geprüfte Auskunft <kein HTML>.');
  assert.equal(root.querySelector('[data-agent-status]').classList.contains('error'),false);
  assert.equal(root.querySelector('kein'),null);assert.equal(calls,1);
});

test('identical content is blocked across IDs while pending and unknown; completed repeats remain possible',async t=>{
  let release,entered,calls=0;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;entered();if(calls===1)await wait;return completion();}}});
  const body=input(),first=f.call('/api/agent/chat',body);await started;
  const conflicts=await Promise.all(Array.from({length:3},()=>f.call('/api/agent/chat',{...body,requestId:randomUUID()})));
  for(const response of conflicts){assert.equal(response.status,409);assert.equal((await response.json()).existingRequestId,body.requestId);}
  release();assert.equal((await first).status,200);assert.equal(calls,1);
  assert.equal((await f.call('/api/agent/chat',{...body,requestId:randomUUID()})).status,200);assert.equal(calls,2);
  const other=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{throw Error('ambiguous');}}});
  assert.equal((await other.call('/api/agent/chat',body)).status,502);
  const blocked=await other.call('/api/agent/chat',{...body,requestId:randomUUID()});assert.equal(blocked.status,409);assert.equal((await blocked.json()).existingRequestId,body.requestId);
});

test('owner request history is metadata only, bounded, and recovers completed answers without provider calls',async t=>{
  let calls=0;const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;return completion('<b>saved answer</b>');}}});
  const body=input();await f.call('/api/agent/chat',body);
  for(let i=0;i<24;i++)await f.env.DB.prepare('INSERT INTO agent_requests VALUES(?,?,?,?,?)').bind(randomUUID(),digest('private '+i),'unknown',null,Date.now()-1000-i).run();
  for(const role of ['customer','anonymous'])for(const path of ['/api/agent/requests','/api/agent/requests/'+body.requestId])assert.equal((await f.call(path,undefined,role)).status,role==='customer'?403:401);
  const list=await f.call('/api/agent/requests');assert.equal(list.status,200);const data=await list.json();assert.equal(data.requests.length,20);
  assert.deepEqual(data.requests[0],{requestId:body.requestId,state:'completed',createdAt:(await f.env.DB.prepare('SELECT created_at FROM agent_requests WHERE request_id=?').bind(body.requestId).first()).created_at,answerExpired:false});
  for(const row of data.requests)assert.deepEqual(Object.keys(row).sort(),['requestId','state','createdAt','answerExpired'].sort());
  assert.doesNotMatch(JSON.stringify(data),/saved answer|request_hash|upstream-secret|private/);
  const recovered=await f.call('/api/agent/requests/'+body.requestId);assert.equal(recovered.status,200);assert.equal((await recovered.json()).reply,'<b>saved answer</b>');assert.equal(calls,1);
  assert.equal((await f.call('/api/agent/requests/not-a-uuid')).status,400);assert.equal((await f.call('/api/agent/requests/'+randomUUID())).status,404);
});

test('maintenance tombstones old answers, fails stale pending closed, and prevents late completion resurrection',async t=>{
  const {agentMaintenance}=await import('../server/agent.mjs');assert.equal(typeof agentMaintenance,'function');
  let release,entered,calls=0;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;entered();await wait;return completion('late answer');}}});
  const body=input(),first=f.call('/api/agent/chat',body);await started;
  const now=Date.now();await agentMaintenance(f.env,now+90001);release();assert.equal((await first).status,409);
  const row=await f.env.DB.prepare('SELECT * FROM agent_requests WHERE request_id=?').bind(body.requestId).first();assert.equal(row.state,'unknown');assert.equal(row.result,null);
  const blocked=await f.call('/api/agent/chat',{...body,requestId:randomUUID()});assert.equal(blocked.status,409);assert.equal(calls,1);
  const saved={...input(),message:'Saved question'},answer={ok:true,requestId:saved.requestId,reply:'expired private answer',mode:'read-only'};
  await f.env.DB.prepare('INSERT INTO agent_requests VALUES(?,?,?,?,?)').bind(saved.requestId,digest(JSON.stringify({message:saved.message,confirmed:true})),'completed',JSON.stringify(answer),now-7*86400000-1).run();
  await agentMaintenance(f.env,now);
  const tombstone=await f.env.DB.prepare('SELECT * FROM agent_requests WHERE request_id=?').bind(saved.requestId).first();assert.equal(tombstone.state,'completed');assert.equal(tombstone.result,null);assert.ok(tombstone.request_hash);
  assert.equal((await f.call('/api/agent/chat',saved)).status,409);assert.equal((await f.call('/api/agent/requests/'+saved.requestId)).status,409);assert.equal(calls,1);
  const history=await (await f.call('/api/agent/requests')).json();assert.equal(history.requests.find(r=>r.requestId===saved.requestId).answerExpired,true);
  for(const path of ['/api/agent','/api/agent/requests','/api/agent/chat']){
    const id=randomUUID();await f.env.DB.prepare('INSERT INTO agent_requests VALUES(?,?,?,?,?)').bind(id,digest(id),'pending',null,now-90001).run();
    await f.call(path,path.endsWith('chat')?{...body,requestId:randomUUID()}:undefined);
    assert.equal((await f.env.DB.prepare('SELECT state FROM agent_requests WHERE request_id=?').bind(id).first()).state,'unknown');
  }
});

test('remounted UI shows saved and unknown requests and explicitly recovers text without sending',async t=>{
  let calls=0;const f=await fixture(t,{...ready,PANEL_AGENT_READ_TOKEN_SHA256:digest('bridge-secret'),HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;return completion('<img src=x> saved');}}});
  const saved=input();await f.call('/api/agent/chat',saved);
  const unknown={...input(),message:'Unclear question'};await f.env.DB.prepare('INSERT INTO agent_requests VALUES(?,?,?,?,?)').bind(unknown.requestId,digest(JSON.stringify({message:unknown.message,confirmed:true})),'unknown',null,Date.now()).run();
  const dom=new JSDOM('<div id="agent"></div>',{url:origin});t.after(()=>dom.window.close());const root=dom.window.document.querySelector('#agent');
  const fetchImpl=(url,options={})=>f.call(url,options.body?JSON.parse(options.body):undefined);
  await mountAgent(root,{fetchImpl});
  assert.match(root.querySelector('[data-agent-history]').textContent,/ungeklärt/);assert.match(root.textContent,new RegExp(unknown.requestId));assert.equal(calls,1);
  root.querySelector('[data-agent-recover]').click();await new Promise(r=>setImmediate(r));
  assert.equal(root.querySelector('[data-agent-output]').textContent,'<img src=x> saved');assert.equal(root.querySelector('img'),null);assert.equal(calls,1);
  root.querySelector('[name=message]').value=unknown.message;root.querySelector('[name=confirmed]').checked=true;
  root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setImmediate(r));
  assert.equal(root.querySelector('[name=message]').value,unknown.message);assert.match(root.querySelector('[data-agent-status]').textContent,new RegExp(unknown.requestId));assert.equal(calls,1);
  assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);
});

test('simultaneous fresh IDs with identical content elect exactly one upstream owner',async t=>{
  let calls=0;const f=await fixture(t,{...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;await new Promise(r=>setImmediate(r));throw Error('ambiguous synthetic response');}}});
  const body=input(),responses=await Promise.all(Array.from({length:5},()=>f.call('/api/agent/chat',{...body,requestId:randomUUID()})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[409,409,409,409,502]);assert.equal(calls,1);
  const rows=(await f.env.DB.prepare('SELECT * FROM agent_requests').all()).results;assert.equal(rows.length,1);assert.equal(rows[0].state,'unknown');
  for(const response of responses.filter(r=>r.status===409))assert.equal((await response.json()).existingRequestId,rows[0].request_id);
});

test('application maintenance invokes agent retention without network or deleting IDs',async t=>{
  const {maintenance}=await import('../server/application.mjs');const f=await fixture(t),now=Date.now(),id=randomUUID();
  await f.env.DB.prepare('INSERT INTO agent_requests VALUES(?,?,?,?,?)').bind(id,digest('tombstone'),'completed',JSON.stringify({reply:'private synthetic answer'}),now-8*86400000).run();
  const result=await maintenance(f.env,now);assert.equal(result.ok,true);
  const row=await f.env.DB.prepare('SELECT * FROM agent_requests WHERE request_id=?').bind(id).first();assert.equal(row.result,null);assert.equal(row.request_hash,digest('tombstone'));assert.equal(row.state,'completed');
});

test('two database connections share the identical-request guard',async t=>{
  const dir=await mkdtemp(join('/opt/data/cache/scratch','wg-agent-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let calls=0;
  const envFor=()=>({PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(join(dir,'panel.sqlite')),BUCKET:{},ASSETS:{fetch:async()=>new Response('asset')},...ready,HERMES_AGENT_ADAPTERS:{chat:async()=>{calls++;return completion();}}});
  const first=envFor(),second=envFor();
  t.after(()=>{first.DB.close();second.DB.close();});
  const a=await createApplication(first),b=await createApplication(second);
  await first.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(digest('owner')),owner,Date.now()+3600000,Date.now()).run();
  const send=app=>{const body={requestId:randomUUID(),message:'Dieselbe Verbindung über zwei Datenbanken',confirmed:true};return app.fetch(new Request(origin+'/api/agent/chat',{method:'POST',headers:{origin,cookie:'__Host-wg-session='+digest('owner'),'content-type':'application/json'},body:JSON.stringify(body)}));};
  const responses=await Promise.all([send(a),send(b)]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(calls,1);
});

test('owner-only status is fail closed and exposes no secrets',async t=>{
  const f=await fixture(t,{HERMES_AGENT_API_KEY:'secret'});
  assert.deepEqual(await (await f.call()).json(),{configured:false,enabled:false,mode:'read-only',bridgeConfigured:false});
  assert.equal((await f.call('/api/agent',undefined,'customer')).status,403);
  assert.equal((await f.call('/api/agent',undefined,'anonymous')).status,401);
});

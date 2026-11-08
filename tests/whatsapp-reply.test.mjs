import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestWhatsAppWebhook} from '../server/whatsapp.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',sender='491700000000',day=24*60*60*1000;
const settings={phoneNumberId:'123456789012345',graphVersion:'v99.1',accessToken:'synthetic-reply-access-token',appSecret:'synthetic-reply-app-secret',verifyToken:'synthetic-reply-verify-token'};
const stamp=()=>String(Math.floor(Date.now()/1000)-1);
const signature=raw=>'sha256='+createHmac('sha256',settings.appSecret).update(raw).digest('hex');
const envelope=value=>({object:'whatsapp_business_account',entry:[{id:'synthetic-waba',changes:[{field:'messages',value:{messaging_product:'whatsapp',metadata:{phone_number_id:settings.phoneNumberId},...value}}]}]});
function inbound({id='wamid.synthetic.incoming.'+randomUUID(),from=sender,timestamp=stamp(),type='text',body='Bitte antworten.',...rest}={}){
  return envelope({contacts:[{wa_id:from,profile:{name:'Synthetischer Kunde'}}],messages:[{id,from,timestamp,type,...(type==='text'?{text:{body}}:{}),...rest}]});
}
function statusPayload({id='wamid.synthetic.reply',recipient=sender,status='delivered',timestamp=stamp(),phoneNumberId=settings.phoneNumberId,code}={}){
  const payload=envelope({statuses:[{id,recipient_id:recipient,status,timestamp,...(code===undefined?{}:{errors:[{code,title:'synthetic provider detail '+settings.accessToken}]})}]});
  payload.entry[0].changes[0].value.metadata.phone_number_id=phoneNumberId;return payload;
}
async function fixture(t,{send,filename=':memory:',verify=true,review=false}={}){
  const sends=[],checks=[],appOrigin=review?'https://meta-review.example.invalid':origin;
  const env={PANEL_ORIGIN:appOrigin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(filename),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('asset')},WHATSAPP_ADAPTERS:{async check(config){checks.push(config);return {id:settings.phoneNumberId,verified_name:'Synthetic sender'};},async sendReply(config,payload){sends.push({config,payload});return send?send(config,payload):{messages:[{id:'wamid.synthetic.reply'}]};}},...(review?{WHATSAPP_REVIEW_MODE:'true',WHATSAPP_REVIEW_ORIGIN:appOrigin,WHATSAPP_REVIEW_PHONE_NUMBER_ID:settings.phoneNumberId,WHATSAPP_REVIEW_RECIPIENT:'+'+sender,WHATSAPP_REVIEW_GRAPH_VERSION:settings.graphVersion,WHATSAPP_REVIEW_ACCESS_TOKEN:settings.accessToken}:{})};
  t.after(()=>env.DB.close());let app=await createApplication(env);
  const cookies={owner:randomBytes(32).toString('hex'),customer:randomBytes(32).toString('hex')};
  for(const [role,cookie] of Object.entries(cookies))await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(cookie),role==='owner'?owner:'customer@example.invalid',Date.now()+7*day,Date.now()).run();
  const call=(path,body,role='owner',requestOrigin=appOrigin)=>app.fetch(new Request(appOrigin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,...(role?{cookie:'__Host-wg-session='+cookies[role]}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  const webhook=(payload,{sign=true}={})=>{const bytes=Buffer.from(JSON.stringify(payload));return app.fetch(new Request(appOrigin+'/api/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign?signature(bytes):'sha256='+Buffer.alloc(32).toString('hex')},body:bytes}));};
  if(!review)assert.equal((await call('/api/whatsapp/settings',settings)).status,200);
  if(verify)assert.equal((await call('/api/whatsapp/check',{})).status,200);
  const view=async key=>{const response=await call('/api/whatsapp'+(key?'?conversation='+encodeURIComponent(key):''));assert.equal(response.status,200,await response.clone().text());return response.json();};
  const receive=async options=>{const response=await webhook(inbound(options));assert.equal(response.status,200,await response.clone().text());const listing=await view();const conversation=listing.conversations.find(item=>item.senderPhone==='+'+(options?.from??sender));assert.ok(conversation);return view(conversation.conversationKey);};
  return {env,call,webhook,view,receive,sends,checks,async restart(){env.DB.close();env.DB=new PanelDatabase(filename);app=await createApplication(env);}};
}
function replyInput(view,body='Danke. Wir melden uns mit einem Terminvorschlag.'){
  return {requestId:randomUUID(),conversationKey:view.conversations.find(item=>item.senderPhone===view.reply.recipient)?.conversationKey??view.conversations[0].conversationKey,sourceMessageId:view.reply.sourceMessageId??view.messages.find(message=>message.direction==='incoming')?.id,body,confirmed:true};
}
async function outgoing(f,key,id){const view=await f.view(key);return view.messages.find(message=>message.direction==='outgoing'&&(!id||message.id===id));}
async function assertDenied(f,body,status=409,path='/api/whatsapp/reply'){
  const response=await f.call(path,body);if(status===null)assert.ok(response.status>=400&&response.status<500,await response.clone().text());else assert.equal(response.status,status,await response.clone().text());return response;
}

test('manual reply derives the existing recipient, records the outgoing text and replays a request without sending twice',async t=>{
  const f=await fixture(t),timestamp=stamp(),view=await f.receive({timestamp}),body=replyInput(view,'Danke.\nDer Preis bleibt unverändert.');
  assert.equal(view.reply.allowed,true);assert.equal(view.reply.recipient,'+'+sender);assert.equal(Date.parse(view.reply.windowExpiresAt),Number(timestamp)*1000+day);assert.match(body.sourceMessageId,/^[0-9a-f-]{36}$/);assert.equal(view.messages[0].direction,'incoming');
  const response=await f.call('/api/whatsapp/reply',body),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true);assert.equal(result.accepted,true);assert.equal(result.duplicate,false);
  assert.equal(f.sends.length,1);assert.deepEqual(f.sends[0].config,{phoneNumberId:settings.phoneNumberId,graphVersion:settings.graphVersion,accessToken:settings.accessToken});
  assert.equal(f.sends[0].payload.messaging_product,'whatsapp');assert.equal(f.sends[0].payload.type,'text');assert.equal(f.sends[0].payload.to,view.reply.recipient);assert.deepEqual(f.sends[0].payload.text,{body:body.body,preview_url:false});
  const message=await outgoing(f,body.conversationKey,body.requestId);assert.equal(message.body,body.body);assert.equal(message.requestId,body.requestId);assert.equal(message.sendState,'accepted');assert.equal(message.deliveryStatus,'accepted');assert.equal(message.messageType,'text');assert.equal(message.hasMedia,false);assert.equal(message.deliveryErrorCode,null);
  const duplicate=await f.call('/api/whatsapp/reply',body);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.sends.length,1);
  const conflict=await assertDenied(f,{...body,body:'Geänderter Text.'});assert.notEqual((await conflict.json()).notSent,true);assert.equal(f.sends.length,1);
  const malformedRetry=await assertDenied(f,{...body,body:''},400);assert.notEqual((await malformedRetry.json()).notSent,true);assert.equal(f.sends.length,1);
  const stored=await f.env.DB.prepare('SELECT * FROM whatsapp_outgoing WHERE request_id=?').bind(body.requestId).first();assert.equal(stored.recipient_phone,view.reply.recipient);assert.equal(stored.source_message_id,body.sourceMessageId);assert.equal(stored.phone_number_id,settings.phoneNumberId);assert.equal(stored.body,body.body);assert.equal(JSON.stringify(stored).includes(settings.accessToken),false);
  for(const table of ['orders','customers','appointments'])assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
});

test('manual replies require owner authentication, same origin, explicit confirmation and a verified connection',async t=>{
  const f=await fixture(t,{verify:false}),view=await f.receive(),body=replyInput(view);
  assert.equal(view.reply.allowed,false);assert.equal((await f.call('/api/whatsapp/reply',body,false)).status,401);assert.equal((await f.call('/api/whatsapp/reply',body,'customer')).status,403);assert.equal((await f.call('/api/whatsapp/reply',body,'owner','https://other.example.invalid')).status,403);
  for(const role of [false,'customer']){const response=await f.call('/api/whatsapp?conversation='+body.conversationKey,undefined,role),raw=await response.text();assert.equal(response.status,role?403:401);assert.equal(raw.includes(sender),false);assert.equal(raw.includes('Bitte antworten.'),false);}
  await assertDenied(f,body);await f.call('/api/whatsapp/check',{});await assertDenied(f,{...body,confirmed:false},400);await assertDenied(f,body,409,'/api/whatsapp/reply?test=true');assert.equal(f.sends.length,0);
});

test('review mode preserves the existing ban on direct replies and incoming webhooks',async t=>{
  const f=await fixture(t,{review:true});await assertDenied(f,{requestId:randomUUID(),conversationKey:'01700000000',sourceMessageId:randomUUID(),body:'Synthetic review attempt',confirmed:true},403);
  assert.equal((await f.webhook(inbound())).status,403);assert.equal(f.sends.length,0);const view=await f.view();assert.equal(view.settings.reviewMode,true);
});

test('reply rejects malformed text, coerced identifiers and every free-address or credential override before creating a ledger row',async t=>{
  const f=await fixture(t),view=await f.receive(),base=replyInput(view);
  for(const patch of [{body:''},{body:' \n\t '},{body:'a'.repeat(4097)},{body:'hidden\0text'},{body:null},{body:7},{body:['text']},{confirmed:'true'},{confirmed:1},{requestId:'bad'},{requestId:randomUUID()+'\n'},{sourceMessageId:[]},{recipient:'+'+sender},{phoneNumberId:settings.phoneNumberId},{accessToken:'replacement'},{to:'+'+sender},{template:{name:'hello_world'}}]){
    const denied=await assertDenied(f,{...base,...patch},400);assert.equal((await denied.json()).notSent,true,JSON.stringify(patch));
  }
  assert.equal(f.sends.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_outgoing').first()).n,0);
  assert.equal((await f.call('/api/whatsapp/reply',{...base,body:'a'.repeat(4096)})).status,200);assert.equal(f.sends[0].payload.text.body.length,4096);
});

test('reply source must belong to the chosen conversation and the currently configured business phone',async t=>{
  const f=await fixture(t),one=await f.receive(),body=replyInput(one),two=await f.receive({from:'491700000001'}),other=replyInput(two);
  await assertDenied(f,{...body,sourceMessageId:other.sourceMessageId},null);await assertDenied(f,{...body,sourceMessageId:randomUUID()},null);await assertDenied(f,{...body,conversationKey:'01999999999'},null);
  const oldSource=body.sourceMessageId;
  assert.equal((await f.call('/api/whatsapp/settings',{...settings,phoneNumberId:'999999999999999'})).status,200);f.env.WHATSAPP_ADAPTERS.check=async()=>({id:'999999999999999'});assert.equal((await f.call('/api/whatsapp/check',{})).status,200);
  await assertDenied(f,{...body,sourceMessageId:oldSource},null);assert.equal(f.sends.length,0);
});

test('replies use the latest valid inbound time, while old duplicate webhooks cannot reopen the service window',async t=>{
  const f=await fixture(t),now=Date.now(),oldStamp=String(Math.floor((now-day-60000)/1000)),oldId='wamid.synthetic.old',old=await f.receive({id:oldId,timestamp:oldStamp});
  assert.equal(old.reply.allowed,false);const oldBody=replyInput(old);await assertDenied(f,oldBody);
  assert.equal((await f.webhook(inbound({id:oldId,timestamp:oldStamp}))).status,200);const repeated=await f.view(oldBody.conversationKey);assert.equal(repeated.reply.allowed,false);
  const fresh=await f.receive();assert.equal(fresh.reply.allowed,true);const body={...replyInput(fresh),sourceMessageId:oldBody.sourceMessageId};assert.equal((await f.call('/api/whatsapp/reply',body)).status,200);assert.equal(f.sends.length,1);
});

for(const timestamp of [undefined,'invalid','0','-1','123.5',' 1700000000','1700000000\n','999999999999',String(Math.floor(Date.now()/1000)+120)])test('invalid or future inbound timestamp cannot authorize a reply: '+String(timestamp),async t=>{
  const f=await fixture(t),payload=inbound();payload.entry[0].changes[0].value.messages[0].timestamp=timestamp;
  const response=await f.webhook(payload);assert.ok([200,400].includes(response.status));if(response.status===200){const listing=await f.view(),view=await f.view(listing.conversations[0].conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}
  assert.equal(f.sends.length,0);
});

for(const from of ['+491700000000','49 1700000000','491700000000\n','4917abc0000000'])test('malformed inbound sender cannot become a reply address: '+JSON.stringify(from),async t=>{
  const f=await fixture(t),response=await f.webhook(inbound({from}));assert.ok([200,400].includes(response.status));if(response.status===200){const listing=await f.view();for(const conversation of listing.conversations){const view=await f.view(conversation.conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}}
  assert.equal(f.sends.length,0);
});

for(const type of ['system','reaction','unknown','template','echo'])test('non-user event cannot open a reply window: '+type,async t=>{
  const f=await fixture(t),view=await f.receive({type});assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));assert.equal(f.sends.length,0);
});

for(const flag of ['is_echo','echo'])test('echo-marked text cannot open a reply window: '+flag,async t=>{
  const f=await fixture(t),view=await f.receive({[flag]:true});assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));assert.equal(f.sends.length,0);
});

for(const flag of ['is_echo','echo'])test('echo-marked webhook value cannot open a reply window: '+flag,async t=>{
  const f=await fixture(t),payload=inbound();payload.entry[0].changes[0].value[flag]=true;assert.equal((await f.webhook(payload)).status,200);const listing=await f.view();for(const conversation of listing.conversations){const view=await f.view(conversation.conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}assert.equal(f.sends.length,0);
});

test('business-app echo webhook field cannot be treated as a new customer message',async t=>{
  const f=await fixture(t),payload=inbound();payload.entry[0].changes[0].field='smb_message_echoes';assert.equal((await f.webhook(payload)).status,200);const listing=await f.view();for(const conversation of listing.conversations){const view=await f.view(conversation.conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}assert.equal(f.sends.length,0);
});

for(const product of [undefined,'messenger'])test('missing or wrong messaging product cannot authorize a reply: '+String(product),async t=>{
  const f=await fixture(t),payload=inbound();payload.entry[0].changes[0].value.messaging_product=product;const response=await f.webhook(payload);assert.ok([200,400].includes(response.status));
  const listing=await f.view();for(const conversation of listing.conversations){const view=await f.view(conversation.conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}assert.equal(f.sends.length,0);
});

for(const id of [undefined,'invalid-provider-id',' wamid.synthetic.invalid','wamid.synthetic.invalid\n','wamid.bad id','wamid.'+'x'.repeat(175)])test('malformed original provider ID cannot authorize a reply: '+JSON.stringify(id),async t=>{
  const f=await fixture(t),payload=inbound();payload.entry[0].changes[0].value.messages[0].id=id;const response=await f.webhook(payload);assert.ok([200,400].includes(response.status));
  const listing=await f.view();for(const conversation of listing.conversations){const view=await f.view(conversation.conversationKey);assert.equal(view.reply.allowed,false);await assertDenied(f,replyInput(view));}assert.equal(f.sends.length,0);
});

test('supported user message types open the reply window without creating orders or downloading attachments',async t=>{
  const f=await fixture(t);
  for(const [index,type] of ['text','image','audio','video','document','sticker','location','contacts','interactive','button','order'].entries()){
    const from='49170000'+String(index).padStart(4,'0'),view=await f.receive({from,type,...(type==='text'?{}:{[type]:{id:'synthetic-attachment',caption:'Synthetische Nachricht'}})});assert.equal(view.reply.allowed,true,type);assert.equal(view.reply.recipient,'+'+from);
  }
  assert.equal(f.sends.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
});

test('legacy messages with no trustworthy window timestamp remain readable but cannot authorize replies',async t=>{
  const f=await fixture(t),id=randomUUID(),at=new Date().toISOString();
  await f.env.DB.prepare('INSERT INTO whatsapp_messages(id,provider_message_id,synthetic,conversation_key,sender_phone,sender_key,profile_name,message_type,body,sent_at,received_at,phone_number_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,'wamid.synthetic.legacy',0,'01700000000','+'+sender,'01700000000','Legacy','text','Altbestand',at,at,settings.phoneNumberId).run();
  const view=await f.view('01700000000');assert.equal(view.messages[0].body,'Altbestand');assert.equal(view.reply.allowed,false);await assertDenied(f,{...replyInput(view),sourceMessageId:id});assert.equal(f.sends.length,0);
});

test('window expiration is checked on the server at send time; accepted replay never sends again',async t=>{
  const f=await fixture(t),timestamp=stamp(),view=await f.receive({timestamp}),body=replyInput(view);assert.equal((await f.call('/api/whatsapp/reply',body)).status,200);
  const expiredAt=Number(timestamp)*1000+day;t.mock.method(Date,'now',()=>expiredAt);await f.env.DB.prepare('UPDATE auth_sessions SET last_at=?,expires_at=?').bind(expiredAt,expiredAt+day).run();
  const closed=await f.view(body.conversationKey);assert.equal(closed.reply.allowed,false);await assertDenied(f,{...body,requestId:randomUUID()});
  const duplicate=await f.call('/api/whatsapp/reply',body);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.sends.length,1);
});

test('synthetic incoming records cannot authorize a real reply',async t=>{
  const f=await fixture(t),raw=Buffer.from(JSON.stringify(inbound()));await ingestWhatsAppWebhook(f.env,raw,signature(raw),{synthetic:true});
  const listing=await (await f.call('/api/whatsapp?test=true')).json(),key=listing.conversations[0].conversationKey,view=await (await f.call('/api/whatsapp?test=true&conversation='+key)).json();assert.equal(view.reply.allowed,false);
  await assertDenied(f,replyInput(view),409,'/api/whatsapp/reply?test=true');await assertDenied(f,replyInput(view),null);assert.equal(f.sends.length,0);
});

test('concurrent submissions reserve one outgoing request and pending requests never claim that nothing was sent',async t=>{
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),begun=new Promise(resolve=>{started=resolve;});
  const f=await fixture(t,{send:async()=>{started();await gate;return {messages:[{id:'wamid.synthetic.concurrent'}]};}}),view=await f.receive(),body=replyInput(view),first=f.call('/api/whatsapp/reply',body);await begun;
  const pending=await assertDenied(f,body);assert.notEqual((await pending.json()).notSent,true);assert.equal(f.sends.length,1);const ledger=await f.env.DB.prepare('SELECT * FROM whatsapp_outgoing WHERE request_id=?').bind(body.requestId).first();assert.equal(ledger.send_state,'pending');
  release();assert.equal((await first).status,200);const duplicate=await f.call('/api/whatsapp/reply',body);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.sends.length,1);
});

for(const kind of ['timeout','redirect','invalid-json','missing-id'])test('uncertain reply '+kind+' is sanitized, retained and never automatically retried',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);delete f.env.WHATSAPP_ADAPTERS.sendReply;const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});if(kind==='timeout')throw Error(settings.accessToken);if(kind==='redirect')return new Response(null,{status:302,headers:{location:'https://other.example.invalid/'+settings.accessToken}});if(kind==='invalid-json')return new Response(settings.accessToken);return Response.json({messages:[{}]});});
  const response=await f.call('/api/whatsapp/reply',body),raw=await response.text();assert.equal(response.status,502);assert.equal(raw.includes(settings.accessToken),false);assert.notEqual(JSON.parse(raw).notSent,true);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://graph.facebook.com/v99.1/123456789012345/messages');assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.headers.Authorization,'Bearer '+settings.accessToken);assert.equal(calls[0].options.method,'POST');assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(calls[0].options.body).text,{body:body.body,preview_url:false});assert.equal(JSON.parse(calls[0].options.body).to,view.reply.recipient);assert.equal(calls[0].options.body.includes(settings.accessToken),false);
  const message=await outgoing(f,body.conversationKey,body.requestId);assert.equal(message.sendState,'uncertain');assert.equal(message.deliveryStatus,'uncertain');const repeat=await assertDenied(f,body);assert.notEqual((await repeat.json()).notSent,true);assert.equal(calls.length,1);
});

test('uncertain reply reservation survives reopening persistent storage',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wg-wa-reply-')),filename=join(directory,'panel.sqlite'),f=await fixture(t,{filename,send:async()=>{throw Error('synthetic lost reply');}}),view=await f.receive(),body=replyInput(view);
  t.after(async()=>{for(const suffix of ['', '-wal','-shm'])await rm(filename+suffix,{force:true});await rmdir(directory);});
  assert.equal((await f.call('/api/whatsapp/reply',body)).status,502);await f.restart();const repeat=await assertDenied(f,body);assert.notEqual((await repeat.json()).notSent,true);assert.equal(f.sends.length,1);assert.equal((await outgoing(f,body.conversationKey,body.requestId)).sendState,'uncertain');
});

test('a failure to record provider acceptance keeps the reservation and cannot trigger a resend',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);await f.env.DB.prepare("CREATE TRIGGER simulate_reply_write_failure BEFORE UPDATE ON whatsapp_outgoing BEGIN SELECT RAISE(ABORT,'synthetic write failure'); END").run();
  const response=await f.call('/api/whatsapp/reply',body),raw=await response.text();assert.equal(response.status,502);assert.equal(raw.includes('synthetic write failure'),false);await assertDenied(f,body);assert.equal(f.sends.length,1);
});

test('signed delivery events are idempotent and never regress a stronger status or reopen the reply window',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);assert.equal((await f.call('/api/whatsapp/reply',body)).status,200);const expires=view.reply.windowExpiresAt,timestamp=stamp();
  for(const status of ['sent','delivered','read']){assert.equal((await f.webhook(statusPayload({status,timestamp}))).status,200);assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,status);}
  const count=(await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n;
  assert.equal((await f.webhook(statusPayload({status:'read',timestamp}))).status,200);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,count);
  for(const status of ['sent','delivered','failed'])assert.equal((await f.webhook(statusPayload({status,timestamp:String(Number(stamp())+1),...(status==='failed'?{code:131047}:{})}))).status,200);
  const message=await outgoing(f,body.conversationKey,body.requestId);assert.equal(message.deliveryStatus,'read');assert.equal(message.deliveryErrorCode,null);assert.equal((await f.view(body.conversationKey)).reply.windowExpiresAt,expires);assert.equal(f.sends.length,1);
});

test('failed status is shown using a safe numeric error code and later delivery supersedes failure',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);await f.call('/api/whatsapp/reply',body);await f.webhook(statusPayload({status:'failed',code:131047}));
  const failed=await outgoing(f,body.conversationKey,body.requestId);assert.equal(failed.deliveryStatus,'failed');assert.equal(failed.deliveryErrorCode,131047);assert.equal(JSON.stringify(await f.view(body.conversationKey)).includes(settings.accessToken),false);
  await f.webhook(statusPayload({status:'sent'}));assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'failed');await f.webhook(statusPayload({status:'delivered'}));const delivered=await outgoing(f,body.conversationKey,body.requestId);assert.equal(delivered.deliveryStatus,'delivered');assert.equal(delivered.deliveryErrorCode,null);assert.equal(f.sends.length,1);
});

test('forged, foreign-phone, unrelated-ID and mismatched-recipient statuses cannot affect an outgoing message',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);await f.call('/api/whatsapp/reply',body);
  assert.equal((await f.webhook(statusPayload({status:'read'}),{sign:false})).status,401);
  for(const patch of [{phoneNumberId:'999999999999999'},{id:'wamid.synthetic.unrelated'},{recipient:'491700000001'},{status:'deleted'}]){
    const response=await f.webhook(statusPayload({status:'read',...patch}));assert.ok([200,400].includes(response.status));assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'accepted');
  }
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,0);assert.equal(f.sends.length,1);
});

test('status events from a different webhook field cannot change the outgoing delivery state',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);await f.call('/api/whatsapp/reply',body);
  for(const field of ['calls','smb_message_echoes','unknown']){const payload=statusPayload({status:'read'});payload.entry[0].changes[0].field=field;assert.equal((await f.webhook(payload)).status,200);assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'accepted');}
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,0);
});

test('status events with missing or wrong messaging product cannot change delivery state',async t=>{
  const f=await fixture(t),view=await f.receive(),body=replyInput(view);await f.call('/api/whatsapp/reply',body);
  for(const product of [undefined,'messenger']){const payload=statusPayload({status:'read'});payload.entry[0].changes[0].value.messaging_product=product;const response=await f.webhook(payload);assert.ok([200,400].includes(response.status));assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'accepted');}
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,0);
});

test('a signed status arriving before the send response is retained and joined after acceptance',async t=>{
  let f;f=await fixture(t,{send:async()=>{assert.equal((await f.webhook(statusPayload({id:'wamid.synthetic.race',status:'delivered'}))).status,200);return {messages:[{id:'wamid.synthetic.race'}]};}});
  const view=await f.receive(),body=replyInput(view),response=await f.call('/api/whatsapp/reply',body);assert.equal(response.status,200);const message=await outgoing(f,body.conversationKey,body.requestId);assert.equal(message.sendState,'accepted');assert.equal(message.deliveryStatus,'delivered');assert.equal(f.sends.length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,1);
});

test('unknown status cannot be guessed onto an uncertain reply after the HTTP response is lost',async t=>{
  const f=await fixture(t,{send:async()=>{throw Error('synthetic response loss');}}),view=await f.receive(),body=replyInput(view);assert.equal((await f.call('/api/whatsapp/reply',body)).status,502);
  await f.webhook(statusPayload({id:'wamid.synthetic.unknown-after-loss',status:'delivered'}));const message=await outgoing(f,body.conversationKey,body.requestId);assert.equal(message.sendState,'uncertain');assert.equal(message.deliveryStatus,'uncertain');await assertDenied(f,body);assert.equal(f.sends.length,1);
});

test('unmatched early statuses are capped while later statuses for a known own message still work',async t=>{
  let f;f=await fixture(t,{send:async()=>{
    const timestamp=stamp();
    for(let batch=0;batch<11;batch++){
      const statuses=Array.from({length:100},(_,index)=>({id:'wamid.synthetic.unmatched.'+(batch*100+index),recipient_id:sender,status:'delivered',timestamp}));
      assert.equal((await f.webhook(envelope({statuses}))).status,200);
    }
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,1000);
    return {messages:[{id:'wamid.synthetic.accepted.after-cap'}]};
  }});
  const view=await f.receive(),body=replyInput(view);assert.equal((await f.call('/api/whatsapp/reply',body)).status,200);assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'accepted');
  assert.equal((await f.webhook(statusPayload({id:'wamid.synthetic.accepted.after-cap',status:'read'}))).status,200);assert.equal((await outgoing(f,body.conversationKey,body.requestId)).deliveryStatus,'read');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM whatsapp_delivery_events').first()).n,1001);assert.equal(f.sends.length,1);
});

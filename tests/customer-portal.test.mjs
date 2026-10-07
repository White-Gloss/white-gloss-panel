import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest,issueCustomerAccess} from '../server/auth.mjs';
import {getOrder,protect,setting} from '../src/worker.mjs';
import {reviewEligibility} from '../src/customer-policy.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';
import {recordPayment} from '../server/payment-ledger.mjs';
import {registerTemplate} from '../server/document-template.mjs';
const owner='owner@example.invalid',customer='customer@example.invalid',foreign='foreign@example.invalid',origin='https://panel.example.invalid';
test('customers see a receipt only after a separate personal owner issuance request',async t=>{
  const f=await fixture(t),at='2026-10-01T12:00:00Z',o=await f.order(customer,{status:'Erledigt',synthetic:true,acceptance:{at},completedAt:at,payments:[]}),receipt=crypto.randomUUID(),original=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64')),originalHash=digest(original),input={idempotencyKey:crypto.randomUUID(),amountCents:10000,method:'Bar',reference:'TEST-EXTERNAL-CASH-RECEIPT',cashSource:'SYNTHETIC SEPARATE CASH REGISTER',externalCashRecordedConfirmed:true,receipt,at,cashConfirmed:true,receivedConfirmed:true};
  await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(receipt,o.id,'payment','image/png',originalHash,original.byteLength,at).run();await f.env.BUCKET.put(receipt,original,{httpMetadata:{contentType:'image/png'}});
  const paid=await recordPayment(f.env,o,input),path='/api/customer/payment/pdf?id='+o.id+'&payment='+input.idempotencyKey,request={id:o.id,version:paid.version,payment:input.idempotencyKey,confirmed:true};
  assert.ok(!(await(await f.req('/api/customer-portal')).json()).orders[0].documents.some(doc=>doc.kind==='payment'));assert.equal((await f.req(path)).status,409);
  assert.equal((await f.req('/api/payment/receipt',request,'customer')).status,403);assert.equal((await f.req('/api/payment/receipt',request,'foreign',{'oai-authenticated-user-email':owner})).status,403);assert.equal((await f.req('/api/payment/receipt',request,'')).status,401);assert.equal((await f.req('/api/payment/receipt',request,'owner',{origin:'https://foreign.invalid'})).status,403);
  const pending=await f.req('/api/payment/receipt',request,'owner');assert.equal(pending.status,202);assert.equal((await pending.json()).documentReady,false);
  const {PDFDocument}=await import('../dist/pdf/library.mjs'),template=await PDFDocument.create();template.addPage([595.28,841.89]).drawText('SYNTHETIC TEST LETTERHEAD');await registerTemplate(f.env,{pdfBase64:Buffer.from(await template.save()).toString('base64'),approved:true,blankLetterheadConfirmed:true,evidence:'SYNTHETIC TEST ONLY',contentBox:{left:42,right:42,top:150,bottom:100},company:{name:'TEST',street:'Test 1',city:'Test city',email:'test@example.invalid'}});
  const issued=await f.req('/api/payment/receipt',request,'owner');assert.equal(issued.status,200);assert.equal((await issued.json()).documentReady,true);assert.equal((await f.req(path)).status,200);assert.equal((await f.req(path,undefined,'foreign')).status,404);assert.ok((await(await f.req('/api/customer-portal')).json()).orders[0].documents.some(doc=>doc.kind==='payment'));
});
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,11).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async get(id){return files.has(id)?{body:files.get(id)}:null;},async put(id,bytes){files.set(id,bytes);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),cookies={};
  for(const [role,email] of Object.entries({owner,customer,foreign})){const raw=randomBytes(32).toString('hex');cookies[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+86400000,Date.now()).run();}
  const req=(path,data,role='customer',headers={})=>app.fetch(new Request(origin+path,{...(data?{method:'POST',body:JSON.stringify(data)}:{}),headers:{...(data?{origin,'Content-Type':'application/json'}:{}),cookie:cookies[role]??role,...headers}}));
  async function order(email=customer,overrides={}){const id=crypto.randomUUID(),offerToken=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+86400000).toISOString(),o={id,wg:'TEST-'+id,version:1,status:'Angebot offen',synthetic:false,createdAt:new Date().toISOString(),source:{name:'Synthetic customer',email,vehicle:'Synthetic vehicle'},offer:{services:'Synthetic service',totalCents:10000,expiresAt},offerToken,notes:[{private:'operator-only-note'}],...overrides};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,o.wg,o.status,JSON.stringify(o),new Date().toISOString(),'test','fixture').run();await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(offerToken),id,expiresAt).run();return o;}
  async function activate(o){const access=await issueCustomerAccess(env,customer,'/angebot/'+o.offerToken),token=new URL(access.url).searchParams.get('token');const response=await req('/auth/redeem',{token,pin:access.pin},'');assert.equal(response.status,200,await response.clone().text());return {pin:access.pin,token,cookie:response.headers.get('set-cookie').split(';')[0]};}
  async function mail(){await setting(env,'resendKey',await protect(env,'synthetic-resend-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','synthetic@example.invalid');}
  return {env,app,req,order,activate,mail,cookies,files};
}
test('personal PIN repeatedly logs in after signing and offer expiry; same email keeps independent documents',async t=>{
  const f=await fixture(t),one=await f.order(),two=await f.order(customer.toUpperCase()),other=await f.order(foreign),access=await f.activate(one);
  const before=await f.env.DB.prepare('SELECT * FROM auth_customer_credentials').first();assert.notEqual(before.derived,access.pin);assert.ok(!JSON.stringify(before).includes(access.pin));
  const originalSignature=syntheticSignature;one.status='Bezahlt';one.acceptance={at:'2026-10-03T12:00:00Z',signature:originalSignature,snapshotHash:'synthetic-proof',snapshot:{offer:one.offer}};
  await f.env.DB.prepare('UPDATE orders SET data=?,status=?,version=version+1 WHERE id=?').bind(JSON.stringify(one),one.status,one.id).run();await f.env.DB.prepare('UPDATE offer_tokens SET expires_at=? WHERE order_id=?').bind('2020-01-01T00:00:00Z',one.id).run();
  assert.equal((await f.req('/auth/redeem',{token:access.token,pin:access.pin},'')).status,409);
  for(let n=0;n<2;n++){const logged=await f.req('/auth/customer/login',{email:customer.toUpperCase(),pin:access.pin},'');assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0],portal=await f.req('/api/customer-portal',undefined,cookie),data=await portal.json();assert.equal(data.orders.length,2);assert.ok(!data.orders.some(order=>order.id===other.id));assert.ok(!JSON.stringify(data).includes('operator-only-note'));assert.equal(data.orders.find(order=>order.id===one.id).offerUrl,null);assert.ok(data.orders.find(order=>order.id===one.id).documents.some(doc=>doc.kind==='agreement'));assert.equal((await f.req('/api/state',undefined,cookie)).status,403);assert.equal((await f.req('/api/customer-portal/document?id='+other.id+'&kind=intake',undefined,cookie)).status,404);}
  const still=JSON.parse((await f.env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(one.id).first()).data);assert.equal(still.acceptance.signature,originalSignature);assert.equal(still.status,'Bezahlt');assert.notEqual(one.id,two.id);
});
test('mail-confirmed PIN renewal revokes old PIN, sessions and outstanding links without changing signed orders',async t=>{
  const f=await fixture(t),o=await f.order(),access=await f.activate(o);await f.mail();const messages=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push(JSON.parse(options.body));return Response.json({id:'synthetic-mail'});});
  const second=await f.req('/auth/customer/login',{email:customer,pin:access.pin},'');assert.equal(second.status,200);const secondCookie=second.headers.get('set-cookie').split(';')[0];
  const stale=await issueCustomerAccess(f.env,customer,'/angebot/'+o.offerToken);
  assert.equal((await f.req('/auth/customer/reset/request',{email:'unknown@example.invalid'},'')).status,200);assert.equal(messages.length,0);
  assert.equal((await f.req('/auth/customer/reset/request',{email:customer},'')).status,200);assert.equal(messages.length,1);
  assert.equal((await f.req('/api/customer-portal',undefined,secondCookie)).status,200);
  const link=new URL(/https:\/\/\S+/.exec(messages[0].text)[0]),pin=/PIN: (\d{6})/.exec(messages[0].text)[1],resetToken=link.searchParams.get('token');
  assert.equal((await f.req('/auth/redeem',{token:resetToken,pin},'')).status,200);
  assert.equal((await f.req('/api/customer-portal',undefined,access.cookie)).status,401);assert.equal((await f.req('/api/customer-portal',undefined,secondCookie)).status,401);
  assert.equal((await f.req('/auth/redeem',{token:new URL(stale.url).searchParams.get('token'),pin:stale.pin},'')).status,409);
  assert.equal((await f.req('/auth/customer/login',{email:customer,pin:access.pin},'')).status,401);assert.equal((await f.req('/auth/customer/login',{email:customer,pin},'')).status,200);
  assert.equal((await f.req('/auth/customer/reset/request',{email:customer},'',{origin:'https://evil.example.invalid'})).status,403);
});
test('PIN reset can activate an existing completed customer without any active offer; failed dispatch preserves old access',async t=>{
  const f=await fixture(t),o=await f.order(customer,{status:'Erledigt'});await f.env.DB.prepare('UPDATE offer_tokens SET expires_at=? WHERE order_id=?').bind('2020-01-01T00:00:00Z',o.id).run();await f.mail();const messages=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{messages.push(JSON.parse(options.body));return Response.json({id:'synthetic-mail'});});
  assert.equal((await f.req('/auth/customer/reset/request',{email:customer},'')).status,200);const link=new URL(/https:\/\/\S+/.exec(messages[0].text)[0]),pin=/PIN: (\d{6})/.exec(messages[0].text)[1];
  assert.equal((await f.req('/auth/redeem',{token:link.searchParams.get('token'),pin},'')).status,200);
  const logged=await f.req('/auth/customer/login',{email:customer,pin},'');assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];
  t.mock.method(globalThis,'fetch',async()=>{throw Error('synthetic unknown provider result');});assert.equal((await f.req('/auth/customer/reset/request',{email:customer},'')).status,502);
  assert.equal((await f.req('/api/customer-portal',undefined,cookie)).status,200);assert.equal((await f.req('/auth/customer/login',{email:customer,pin},'')).status,200);
});
test('PIN attempt limits persist and untrusted origins cannot log in',async t=>{
  const f=await fixture(t),o=await f.order(),access=await f.activate(o),bucket=Math.floor(Date.now()/3600000);
  await f.env.DB.prepare('INSERT INTO auth_rates VALUES(?,?,5)').bind(digest('customer-login-email:'+customer),bucket).run();
  assert.equal((await f.req('/auth/customer/login',{email:customer,pin:access.pin},'')).status,429);
  assert.equal((await f.req('/auth/customer/login',{email:customer,pin:access.pin},'',{origin:'https://evil.example.invalid'})).status,403);
  assert.equal((await f.req('/auth/customer/login',{email:owner,pin:access.pin},'')).status,401);
});
test('chat isolates customers, persists history, deduplicates concurrent sends and tracks unread per side',async t=>{
  const f=await fixture(t),one=await f.order(),two=await f.order(foreign),path='/api/customer-portal/chat?id='+one.id,key=crypto.randomUUID(),input={action:'send',requestId:key,body:'Synthetic question <script>alert(1)</script>'};
  const results=await Promise.all([f.req(path,input),f.req(path,input)]);assert.deepEqual(results.map(result=>result.status),[200,200]);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM customer_messages').first()).n,1);
  assert.equal((await f.req(path,{...input,body:'Changed request'})).status,409);
  const summary=await(await f.req('/api/customer-chat/summary',undefined,'owner')).json();assert.equal(summary.threads[0].unread,1);
  const ownerPath='/api/customer-chat?id='+one.id,ownerData=await(await f.req(ownerPath,undefined,'owner')).json();assert.equal(ownerData.messages.length,1);assert.equal(ownerData.unread,1);
  assert.equal((await f.req(ownerPath,{action:'read',lastId:ownerData.messages[0].id},'owner')).status,200);assert.equal((await(await f.req('/api/customer-chat/summary',undefined,'owner')).json()).threads.length,0);
  assert.equal((await f.req(ownerPath,{action:'send',requestId:crypto.randomUUID(),body:'Synthetic reply'},'owner')).status,200);
  const customerData=await(await f.req(path)).json();assert.equal(customerData.messages.length,2);assert.equal(customerData.unread,1);assert.equal(customerData.messages[1].sender,'owner');assert.ok(customerData.messages.every(message=>Number.isFinite(Date.parse(message.at))));
  const portal=await(await f.req('/api/customer-portal')).json();assert.equal(portal.orders[0].unreadMessages,1);
  assert.equal((await f.req(path,{action:'read',lastId:customerData.messages[1].id})).status,200);assert.equal((await(await f.req(path)).json()).unread,0);
  assert.equal((await f.req('/api/customer-portal/chat?id='+two.id)).status,404);assert.equal((await f.req(path,undefined,'foreign')).status,404);assert.equal((await f.req(path,input,'customer',{origin:'https://evil.example.invalid'})).status,403);
  assert.equal((await f.req('/api/customer-chat/summary')).status,403);
});
test('signed protocol downloads use own document ACL and agreement pages escape stored content',async t=>{
  const f=await fixture(t),one=await f.order(customer,{acceptance:{at:'2026-10-03T12:00:00Z',signature:syntheticSignature,snapshot:{offer:{services:'<script>untrusted</script>',totalCents:10000}}},intake:{at:'2026-10-03T12:00:00Z',signaturesConfirmed:true,snapshotHash:'synthetic-proof'}}),other=await f.order(foreign),asset=crypto.randomUUID(),bytes=Buffer.from('%PDF-1.7 synthetic stored protocol');
  f.files.set(asset,bytes);await f.env.DB.prepare("INSERT INTO assets VALUES(?,?,'protocol','application/pdf',?,?,?)").bind(asset,one.id,digest(bytes),bytes.length,new Date().toISOString()).run();
  await f.env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to,asset_id) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),one.id,'intake','synthetic-proof',customer,owner,asset).run();
  const pdf=await f.req('/api/customer-portal/document?id='+one.id+'&kind=intake');assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(Buffer.from(await pdf.arrayBuffer()).toString(),bytes.toString());
  assert.equal((await f.req('/api/customer-portal/document?id='+one.id+'&kind=intake',undefined,'foreign')).status,404);assert.equal((await f.req('/api/customer/payment/pdf?id='+other.id+'&payment='+crypto.randomUUID())).status,404);
  const agreement=await f.req('/api/customer-portal/agreement?id='+one.id),html=await agreement.text();assert.equal(agreement.status,200);assert.ok(html.includes('&lt;script&gt;untrusted&lt;/script&gt;'));assert.ok(!html.includes('<script>untrusted'));assert.ok(html.includes(syntheticSignature));
});
test('a later offer link does not replace an active personal PIN; successful logins permit further use',async t=>{
  const f=await fixture(t),first=await f.order(),access=await f.activate(first),second=await f.order(),next=await issueCustomerAccess(f.env,customer,'/angebot/'+second.offerToken),revision=(await f.env.DB.prepare('SELECT revision FROM auth_customer_credentials').first()).revision;
  const redeemed=await f.req('/auth/redeem',{token:new URL(next.url).searchParams.get('token'),pin:next.pin},'');assert.equal(redeemed.status,200);assert.equal((await redeemed.json()).personalPinActivated,false);assert.equal((await f.env.DB.prepare('SELECT revision FROM auth_customer_credentials').first()).revision,revision);
  for(let n=0;n<7;n++)assert.equal((await f.req('/auth/customer/login',{email:customer,pin:access.pin},'')).status,200);
});
test('concurrent renewal redemption has one winner and preserves owner access',async t=>{
  const f=await fixture(t),o=await f.order();await f.activate(o);await f.mail();let mail;
  t.mock.method(globalThis,'fetch',async(url,options)=>{mail=JSON.parse(options.body);return Response.json({id:'synthetic-mail'});});
  assert.equal((await f.req('/auth/customer/reset/request',{email:customer},'')).status,200);const link=new URL(/https:\/\/\S+/.exec(mail.text)[0]),pin=/PIN: (\d{6})/.exec(mail.text)[1],input={token:link.searchParams.get('token'),pin};
  const results=await Promise.all([f.req('/auth/redeem',input,''),f.req('/auth/redeem',input,'')]);assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_customer_credentials').first()).n,1);assert.equal((await f.req('/api/state',undefined,'owner')).status,200);
});
test('chat history pagination, per-order read cursors and size limits retain stored messages',async t=>{
  const f=await fixture(t),one=await f.order(),two=await f.order(),path='/api/customer-portal/chat?id='+one.id;
  for(let n=0;n<103;n++)await f.env.DB.prepare('INSERT INTO customer_messages(order_id,sender_role,request_id,body,created_at) VALUES(?,?,?,?,?)').bind(one.id,'owner',crypto.randomUUID(),'Synthetic message '+n,new Date().toISOString()).run();
  const other=await f.req('/api/customer-chat?id='+two.id,{action:'send',requestId:crypto.randomUUID(),body:'Other synthetic thread'},'owner');assert.equal(other.status,200);const otherId=(await other.json()).id;
  const latest=await(await f.req(path)).json();assert.equal(latest.messages.length,100);assert.equal(latest.hasMore,true);assert.equal(latest.unread,103);
  const older=await(await f.req(path+'&before='+latest.messages[0].id)).json();assert.equal(older.messages.length,3);assert.equal(older.hasMore,false);assert.ok(older.messages.at(-1).id<latest.messages[0].id);
  assert.equal((await f.req(path,{action:'read',lastId:otherId})).status,400);assert.equal((await f.req(path,{action:'read',lastId:latest.messages.at(-1).id})).status,200);
  assert.equal((await f.req(path,{action:'send',requestId:crypto.randomUUID(),body:'x'.repeat(13000)})).status,413);
  const bucket=Math.floor(Date.now()/3600000);await f.env.DB.prepare('INSERT INTO auth_rates VALUES(?,?,60)').bind(digest('chat:customer:'+customer),bucket).run();assert.equal((await f.req(path,{action:'send',requestId:crypto.randomUUID(),body:'Rate-limited synthetic message'})).status,429);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM customer_messages').first()).n,104);
});
test('concurrent first activation of separate offers reports only the PIN actually stored',async t=>{
  const f=await fixture(t),one=await f.order(),two=await f.order(),a=await issueCustomerAccess(f.env,customer,'/angebot/'+one.offerToken),b=await issueCustomerAccess(f.env,customer,'/angebot/'+two.offerToken);
  const attempts=[a,b].map(access=>f.req('/auth/redeem',{token:new URL(access.url).searchParams.get('token'),pin:access.pin},''));const responses=await Promise.all(attempts);assert.deepEqual(responses.map(response=>response.status),[200,200]);const data=await Promise.all(responses.map(response=>response.json()));assert.equal(data.filter(response=>response.personalPinActivated).length,1);const storedPin=data[0].personalPinActivated?a.pin:b.pin;assert.equal((await f.req('/auth/customer/login',{email:customer,pin:storedPin},'')).status,200);
});
test('review consent needs a valid activated policy, is customer-only, preserves signatures and can always be withdrawn',async t=>{
  const f=await fixture(t),proof={at:new Date(Date.now()-5*86400000).toISOString(),signature:syntheticSignature,snapshotHash:'synthetic-original-proof'},o=await f.order(customer,{status:'Erledigt',completedAt:new Date(Date.now()-4*86400000).toISOString(),acceptance:proof}),path='/api/customer-portal/review-consent';
  const request={id:o.id,version:1,granted:true,policyVersion:'synthetic-review-v1',requestId:crypto.randomUUID()};
  assert.equal((await f.req(path,request)).status,409);assert.equal((await f.req(path,request,'owner')).status,403);assert.equal((await f.req(path,request,'foreign')).status,404);
  const policy={version:'synthetic-review-v1',approved:true,active:true,approvedBy:'Synthetic operator',approvedAt:'2020-01-01T12:00:00Z',channel:'email',schedule:'elapsed-72-hours',timeZone:'Europe/Berlin',googleUrl:'https://g.page/r/synthetic/review',googleUrlVerified:true,googleUrlVerifiedAt:'2020-01-01T12:00:00Z',googleUrlEvidence:'Synthetic link test only',optOutText:'Widerruf jederzeit in deinem Kundenpanel.'};
  await setting(f.env,'reviewPolicy',policy);const config={reviewPolicy:policy,emailVerified:true,sendApproved:true,backgroundApproved:true};assert.equal(reviewEligibility(await getOrder(f.env,o.id),config).due,false);
  assert.equal((await f.req(path,request,'customer',{origin:'https://evil.example.invalid'})).status,403);
  const responses=await Promise.all([f.req(path,request),f.req(path,request)]);assert.deepEqual(responses.map(result=>result.status),[200,200]);const granted=await getOrder(f.env,o.id);assert.deepEqual(granted.acceptance,proof);assert.equal(granted.reviewConsent.recipient,customer);assert.equal(granted.reviewConsent.orderId,o.id);assert.equal(reviewEligibility(granted,config).due,true);
  assert.equal((await f.req(path,{...request,granted:false})).status,409);await setting(f.env,'reviewPolicy',{...policy,active:false});
  const revoke={id:o.id,version:granted.version,granted:false,requestId:crypto.randomUUID()};assert.equal((await f.req(path,revoke)).status,200);const revoked=await getOrder(f.env,o.id);assert.equal(revoked.reviewConsent.granted,false);assert.ok(revoked.reviewConsent.revokedAt);assert.equal(reviewEligibility(revoked,config).due,false);assert.deepEqual(revoked.acceptance,proof);
});
test('own agreement retains the originally accepted cancellation wording and version when current settings differ',async t=>{
  const f=await fixture(t),at='2026-10-03T12:00:00Z',original={version:'synthetic-original-policy',terms:'Original <script>synthetic text</script> & accepted wording'},latest={version:'synthetic-latest-policy',terms:'Latest settings must not replace the accepted contract'};
  await setting(f.env,'cancellationPolicy',latest);
  for(const snapshot of [true,false]){const order=await f.order(customer,{acceptance:{at,signature:syntheticSignature,snapshot:{offer:{services:'Synthetic original service',totalCents:10000,...(snapshot?{cancellationPolicy:original}:{})}}},cancellationTerms:{policy:original,acceptance:{at,version:original.version}}});const response=await f.req('/api/customer-portal/agreement?id='+order.id),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('synthetic-original-policy'));assert.ok(html.includes('Original &lt;script&gt;synthetic text&lt;/script&gt; &amp; accepted wording'));assert.ok(html.includes('angenommen am 03.10.2026'));assert.ok(!html.includes('synthetic-latest-policy'));assert.ok(!html.includes('<script>synthetic text</script>'));}
});

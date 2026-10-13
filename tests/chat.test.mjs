// Kundenchat: Zugriffsschutz, Nachrichten, Dateien, Lesebestätigung, Live-Abfrage und E-Mail-Hinweise.
// Alles läuft im Prozess gegen die echte Anwendung mit SQLite im Speicher; es wird kein Server gestartet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication,maintenance} from '../server/application.mjs';
import {chatNotificationsSettled,pruneUnsentUploads} from '../server/chat.mjs';
import {digest} from '../server/auth.mjs';
import {protect,setting} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';

const origin='https://panel.example.invalid',customer='kunde@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const image=Buffer.concat([png,Buffer.alloc(200)]);
const video=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypmp42'),Buffer.alloc(400,7)]);

function bucket(){const files=new Map();return {files,async put(id,bytes,o){files.set(id,{body:new Uint8Array(bytes),httpMetadata:o?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}};}
async function fixture(t,owner='owner@example.invalid'){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:bucket(),ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());
  const app=await createApplication(env);
  return {env,app,owner:await session(env,owner),customer:await session(env,customer),stranger:await session(env,'fremd@example.invalid')};
}
async function session(env,email){const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;}
async function order(env,{synthetic=false,email=customer}={}){
  const id=randomUUID(),wg=(synthetic?'TEST-':'WG-')+id.slice(0,6);
  const data={id,wg,version:1,status:'Angenommen',synthetic,source:{name:'Erika Muster',email,phone:'0151 2345678',vehicle:'VW Golf',plate:'FDS-WG 1'},notes:[],payments:[],createdAt:new Date().toISOString()};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,wg,data.status,JSON.stringify(data),new Date().toISOString(),'test','fixture',Number(synthetic)).run();
  return data;
}
const get=(app,path,cookie,extra={})=>app.fetch(new Request(origin+path,{headers:{...(cookie?{cookie}:{}),...extra}}));
const post=(app,path,cookie,data,extra={})=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(data)}));
const upload=(app,path,cookie,bytes,type,name='bild.png')=>app.fetch(new Request(origin+path+'/file?name='+encodeURIComponent(name),{method:'POST',headers:{origin,'Content-Type':type,'content-length':String(bytes.length),cookie},body:bytes}));
const body=async response=>{const data=await response.json();return data;};
async function openChat(f,o){const opened=await body(await post(f.app,'/api/chats/open',f.owner,{orderId:o.id}));const link=(await body(await post(f.app,'/api/chats/t/'+opened.id+'/link',f.owner,{action:'create'}))).link;return {id:opened.id,link,token:link.url.split('/').pop()};}
async function configureMail(env){await setting(env,'resendKey',await protect(env,'re_synthetic'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','White Gloss <buchung@example.invalid>');}

test('owner opens a chat per order, customer reaches it only with the matching signed-in email',async t=>{
  const f=await fixture(t),o=await order(f.env);
  const first=await openChat(f,o),again=await body(await post(f.app,'/api/chats/open',f.owner,{orderId:o.id}));
  assert.equal(again.id,first.id,'one chat per order');
  assert.match(first.link.url,new RegExp('^'+origin+'/chat/[a-f0-9]{64}$'));
  const page='/api/kundenchat/'+first.token;
  assert.equal((await get(f.app,page)).status,401,'not signed in');
  assert.equal((await get(f.app,page,f.stranger)).status,403,'other customer');
  assert.equal((await get(f.app,'/api/chats',f.customer)).status,403,'customer cannot list chats');
  assert.equal((await get(f.app,'/api/chats/t/'+first.id,f.customer)).status,403,'customer cannot open by id');
  const redirect=await get(f.app,'/chat/'+first.token);
  assert.equal(redirect.status,303);assert.equal(new URL(redirect.headers.get('location')).searchParams.get('returnTo'),'/chat/'+first.token);
  const view=await body(await get(f.app,page,f.customer));
  assert.equal(view.wg,o.wg);assert.equal(view.customer,'Erika Muster');assert.deepEqual(view.messages,[]);assert.equal(view.ownerPreview,false);
  assert.equal(view.orderId,undefined,'no internal ids for the customer');
  const stored=await f.env.DB.prepare('SELECT * FROM chat_threads WHERE id=?').bind(first.id).first();
  assert.notEqual(stored.token_hash,first.token);assert.ok(!JSON.stringify(stored).includes(first.token),'link token is stored only hashed and sealed');
});

test('messages flow both ways with unread counter, read receipts and idempotent retries',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  const sent=await body(await post(f.app,page+'/message',f.customer,{text:'  Hallo, wann passt der Termin?  ',clientId:'client-0001'}));
  assert.equal(sent.message.text,'Hallo, wann passt der Termin?');assert.equal(sent.message.sender,'customer');
  const retry=await body(await post(f.app,page+'/message',f.customer,{text:'Hallo, wann passt der Termin?',clientId:'client-0001'}));
  assert.equal(retry.message.id,sent.message.id,'retry with the same client id creates no duplicate');
  assert.equal((await body(await get(f.app,'/api/chats/summary',f.owner))).unread,1);
  const list=await body(await get(f.app,'/api/chats',f.owner));
  assert.equal(list.threads.length,1);assert.equal(list.threads[0].unread,1);assert.equal(list.threads[0].last.text,'Hallo, wann passt der Termin?');assert.equal(list.threads[0].name,'Erika Muster');
  const ownerView=await body(await get(f.app,'/api/chats/t/'+chat.id,f.owner));
  assert.equal(ownerView.messages.length,1);assert.equal(ownerView.read.owner,0);
  assert.equal((await body(await get(f.app,'/api/chats/summary',f.owner))).unread,1,'delivered but not yet confirmed by the client');
  await get(f.app,'/api/chats/t/'+chat.id+'?after='+sent.message.id,f.owner);
  assert.equal((await body(await get(f.app,'/api/chats/summary',f.owner))).unread,0,'the next request confirms receipt');
  const reply=await body(await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{text:'Morgen um 9 Uhr passt.'}));
  const customerView=await body(await get(f.app,page+'?after='+sent.message.id,f.customer));
  assert.deepEqual(customerView.messages.map(m=>m.text),['Morgen um 9 Uhr passt.']);
  assert.equal(customerView.read.owner,reply.message.id,'customer sees that the owner read their message');
  assert.equal(customerView.read.customer,sent.message.id,'the reply counts as read only after the customer confirms it');
  await get(f.app,page+'?after='+reply.message.id,f.customer);
  assert.equal((await body(await get(f.app,'/api/chats/t/'+chat.id+'?after='+reply.message.id,f.owner))).read.customer,reply.message.id);
  assert.equal((await post(f.app,page+'/message',f.customer,{text:''})).status,400);
  assert.equal((await post(f.app,page+'/message',f.customer,{text:'x'.repeat(4001)})).status,400);
  assert.equal((await post(f.app,page+'/message',f.customer,{text:'Hallo'},{origin:'https://evil.example.invalid'})).status,403,'cross-origin post');
  await assert.rejects(f.env.DB.prepare('DELETE FROM chat_messages').run(),/nicht gelöscht/);
  await assert.rejects(f.env.DB.prepare("UPDATE chat_messages SET body='x'").run(),/nicht verändert/);
});

test('photos, videos and PDFs are checked, stored privately, backed up and only visible inside their chat',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  assert.equal((await upload(f.app,page,f.customer,Buffer.from('<svg></svg>'.repeat(10)),'image/svg+xml')).status,415);
  assert.equal((await upload(f.app,page,f.customer,Buffer.concat([Buffer.from('<html>'),Buffer.alloc(100)]),'image/png')).status,415,'content must match the type');
  const photo=await body(await upload(f.app,page,f.customer,image,'image/png','../../Kratzer Tür.png'));
  assert.equal(photo.name,'Kratzer Tür.png','path parts are removed from the file name');
  const asset=await f.env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(photo.id).first();
  assert.equal(asset.kind,'chat');assert.equal(asset.order_id,o.id);assert.equal(asset.hash,createHash('sha256').update(image).digest('hex'),'backup checks the same hash');
  const message=await body(await post(f.app,page+'/message',f.customer,{text:'Hier der Kratzer',files:[photo.id]}));
  assert.equal(message.message.files.length,1);assert.equal(message.message.files[0].mime,'image/png');
  const download=await get(f.app,message.message.files[0].url,f.customer);
  assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await download.arrayBuffer()),image);
  assert.equal((await get(f.app,message.message.files[0].url,f.stranger)).status,403);
  assert.equal((await post(f.app,page+'/message',f.customer,{text:'nochmal',files:[photo.id]})).status,409,'a file is sent only once');
  // Owner files are hidden from the customer until they are sent.
  const draft=await body(await upload(f.app,'/api/chats/t/'+chat.id,f.owner,video,'video/mp4','vorher.mp4'));
  assert.equal((await get(f.app,page+'/file/'+draft.id,f.customer)).status,404);
  assert.equal((await post(f.app,page+'/message',f.customer,{files:[draft.id]})).status,409,'customer cannot send an owner file');
  await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{files:[draft.id]});
  const ranged=await get(f.app,page+'/file/'+draft.id,f.customer,{range:'bytes=0-9'});
  assert.equal(ranged.status,206);assert.equal(ranged.headers.get('content-range'),'bytes 0-9/'+video.length);assert.equal((await ranged.arrayBuffer()).byteLength,10);
  // Files of another chat are not reachable through this link.
  const other=await openChat(f,await order(f.env));const foreign=await body(await upload(f.app,'/api/kundenchat/'+other.token,f.customer,image,'image/png'));
  assert.equal((await get(f.app,page+'/file/'+foreign.id,f.customer)).status,404);
  assert.equal((await post(f.app,page+'/message',f.customer,{files:[foreign.id]})).status,409);
});

test('revoked, renewed and closed chats, synthetic orders and owner preview',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{text:'Vorschau'});
  const preview=await body(await get(f.app,page+'?after=999',f.owner));assert.equal(preview.ownerPreview,true);assert.equal(preview.read.customer,0,'owner preview never marks customer messages as read');
  assert.equal((await post(f.app,page+'/message',f.owner,{text:'als Kunde'})).status,403,'owner cannot write as customer');
  await post(f.app,'/api/chats/t/'+chat.id+'/close',f.owner,{closed:true});
  assert.equal((await body(await get(f.app,page,f.customer))).closed,true);
  assert.equal((await post(f.app,page+'/message',f.customer,{text:'Hallo'})).status,409);
  assert.equal((await upload(f.app,page,f.customer,image,'image/png')).status,409);
  await post(f.app,'/api/chats/t/'+chat.id+'/close',f.owner,{closed:false});
  assert.equal((await post(f.app,page+'/message',f.customer,{text:'Hallo'})).status,200);
  const renewed=(await body(await post(f.app,'/api/chats/t/'+chat.id+'/link',f.owner,{action:'renew'}))).link;
  assert.notEqual(renewed.url,chat.link.url);assert.equal((await get(f.app,page,f.customer)).status,404,'old link stops working');
  assert.equal((await get(f.app,'/api/kundenchat/'+renewed.url.split('/').pop(),f.customer)).status,200);
  await post(f.app,'/api/chats/t/'+chat.id+'/link',f.owner,{action:'revoke'});
  assert.equal((await get(f.app,'/api/kundenchat/'+renewed.url.split('/').pop(),f.customer)).status,404);
  const test=await order(f.env,{synthetic:true,email:customer}),testChat=await openChat(f,test);
  assert.equal((await get(f.app,'/api/kundenchat/'+testChat.token,f.customer)).status,403,'synthetic orders have no customer access');
  assert.equal((await body(await get(f.app,'/api/chats?test=true',f.owner))).threads.length,1);
  assert.equal((await body(await get(f.app,'/api/chats',f.owner))).threads.length,1,'test and real chats stay apart');
  await configureMail(f.env);
  assert.equal((await post(f.app,'/api/chats/t/'+testChat.id+'/invite',f.owner,{})).status,409,'no customer email from the test area');
});

test('waiting request returns as soon as the other side writes',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o);
  const started=Date.now();
  const waiting=get(f.app,'/api/chats/t/'+chat.id+'?after=0&seen=0&wait=5',f.owner).then(body);
  await new Promise(resolve=>setTimeout(resolve,80));
  await post(f.app,'/api/kundenchat/'+chat.token+'/message',f.customer,{text:'Bin unterwegs'});
  const view=await waiting;
  assert.deepEqual(view.messages.map(m=>m.text),['Bin unterwegs']);assert.ok(Date.now()-started<3000,'returned without waiting for the timeout');
});

test('an abandoned waiting request does not mark new messages as read',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o);
  const controller=new AbortController();
  const abandoned=f.app.fetch(new Request(origin+'/api/chats/t/'+chat.id+'?after=0&seen=0&wait=5',{headers:{cookie:f.owner},signal:controller.signal})).catch(()=>null);
  await new Promise(resolve=>setTimeout(resolve,50));controller.abort();
  await post(f.app,'/api/kundenchat/'+chat.token+'/message',f.customer,{text:'Sind Sie noch da?'});await abandoned;
  assert.equal((await body(await get(f.app,'/api/chats/summary',f.owner))).unread,1);
});

test('invitation and notifications: link with PIN, owner alert, pause and presence',async t=>{
  const f=await fixture(t,COMPANY.email),o=await order(f.env),chat=await openChat(f,o),mails=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');mails.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'synthetic-'+mails.length}));});
  assert.equal((await post(f.app,'/api/chats/t/'+chat.id+'/invite',f.owner,{})).status,409,'mail must be verified and approved first');
  await configureMail(f.env);
  const invited=await body(await post(f.app,'/api/chats/t/'+chat.id+'/invite',f.owner,{}));assert.match(invited.message,/versendet/);
  const invitation=mails.at(-1);assert.deepEqual(invitation.to,[customer]);assert.equal(invitation.reply_to,COMPANY.email);
  assert.match(invitation.text,/\/auth\/verify\?token=[a-f0-9]{64}&pin=required/);assert.match(invitation.text,/PIN: \d{6}/);assert.ok(invitation.text.includes(chat.link.url));
  const login=await f.env.DB.prepare('SELECT return_to FROM auth_tokens ORDER BY rowid DESC LIMIT 1').first();assert.equal(login.return_to,'/chat/'+chat.token);
  // Customer writes: the owner gets one email, a second message inside the pause gets none.
  await post(f.app,'/api/kundenchat/'+chat.token+'/message',f.customer,{text:'Kratzer an der Tür, Foto folgt.'});await chatNotificationsSettled();
  const alert=mails.at(-1);assert.deepEqual(alert.to,[COMPANY.email]);assert.match(alert.subject,/Neue Kundennachricht/);assert.match(alert.text,/Kratzer an der Tür/);assert.ok(alert.text.includes('/#chat='+chat.id));
  const count=mails.length;await post(f.app,'/api/kundenchat/'+chat.token+'/message',f.customer,{text:'Noch eine Frage'});await chatNotificationsSettled();assert.equal(mails.length,count,'pause between owner alerts');
  // Owner answers while the customer is away: one email with fresh link and PIN.
  await f.env.DB.prepare('UPDATE chat_threads SET customer_seen_at=0 WHERE id=?').bind(chat.id).run();
  await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{text:'Danke, sehen wir uns morgen an.'});await chatNotificationsSettled();
  const note=mails.at(-1);assert.deepEqual(note.to,[customer]);assert.match(note.text,/Danke, sehen wir uns morgen an/);assert.match(note.text,/PIN: \d{6}/);
  const after=mails.length;await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{text:'Und bitte Schlüssel mitbringen.'});await chatNotificationsSettled();assert.equal(mails.length,after,'pause between customer emails');
  // A customer who is in the chat right now gets no email.
  await f.env.DB.prepare('UPDATE chat_threads SET customer_notified_at=0,customer_seen_at=? WHERE id=?').bind(Date.now(),chat.id).run();
  await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{text:'Bis gleich'});await chatNotificationsSettled();assert.equal(mails.length,after,'present customer');
  // The background run catches it once the customer has left.
  await f.env.DB.prepare('UPDATE chat_threads SET customer_seen_at=0 WHERE id=?').bind(chat.id).run();
  const result=await maintenance(f.env);assert.equal(result.deliveryError,null);assert.equal(mails.length,after+1);assert.match(mails.at(-1).text,/Bis gleich/);
  await maintenance(f.env);assert.equal(mails.length,after+1,'no repeat for the same messages');
});

test('a failed email gives its slot back; the background run delivers it later',async t=>{
  const f=await fixture(t,COMPANY.email),o=await order(f.env),chat=await openChat(f,o),mails=[];let fail=true;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(fail)return new Response(JSON.stringify({message:'synthetic outage'}),{status:500});mails.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'ok-'+mails.length}));});
  await configureMail(f.env);
  const started=Date.now();await post(f.app,'/api/kundenchat/'+chat.token+'/message',f.customer,{text:'Hallo?'});assert.ok(Date.now()-started<2000,'sender does not wait for the mail provider');
  await chatNotificationsSettled();assert.equal(mails.length,0);
  assert.equal((await f.env.DB.prepare('SELECT owner_notified_id FROM chat_threads WHERE id=?').bind(chat.id).first()).owner_notified_id,0,'slot released');
  fail=false;await f.env.DB.prepare('UPDATE chat_threads SET owner_seen_at=0 WHERE id=?').bind(chat.id).run();
  await maintenance(f.env);assert.equal(mails.length,1);assert.match(mails[0].text,/Hallo\?/);
});

test('unsent uploads expire after a day and no longer block new attachments',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  const ids=[];for(let i=0;i<20;i++)ids.push((await body(await upload(f.app,page,f.customer,image,'image/png'))).id);
  assert.equal((await upload(f.app,page,f.customer,image,'image/png')).status,409);
  const kept=await body(await upload(f.app,'/api/chats/t/'+chat.id,f.owner,image,'image/png'));await post(f.app,'/api/chats/t/'+chat.id+'/message',f.owner,{files:[kept.id]});
  await f.env.DB.prepare("UPDATE chat_attachments SET created_at='2020-01-01T00:00:00.000Z'").run();
  assert.equal(await pruneUnsentUploads(f.env),20);
  assert.equal(f.env.BUCKET.files.has(ids[0]),false);assert.equal(f.env.BUCKET.files.has(kept.id),true,'sent files stay');
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM assets WHERE kind='chat'").first()).n,1);
  assert.equal((await upload(f.app,page,f.customer,image,'image/png')).status,200);
});

test('chat files keep their sandbox policy and PDFs download instead of opening inline',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  const pdf=Buffer.concat([Buffer.from('%PDF-1.7\n'),Buffer.alloc(200,32)]);
  const file=await body(await upload(f.app,page,f.customer,pdf,'application/pdf','Fahrzeugschein.pdf'));
  await post(f.app,page+'/message',f.customer,{files:[file.id]});
  const response=await get(f.app,page+'/file/'+file.id,f.customer);
  assert.match(response.headers.get('content-security-policy'),/^sandbox;/);assert.match(response.headers.get('content-disposition'),/^attachment; filename\*=UTF-8''Fahrzeugschein\.pdf$/);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
});

test('two parallel sends of the same photo: exactly one message gets it, none loses it silently',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  const photo=await body(await upload(f.app,page,f.customer,image,'image/png'));
  const results=await Promise.all(['send-aaaa-1','send-bbbb-2'].map(clientId=>post(f.app,page+'/message',f.customer,{text:'Foto',files:[photo.id],clientId})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const rows=(await f.env.DB.prepare('SELECT m.id,(SELECT COUNT(*) FROM chat_attachments c WHERE c.message_id=m.id) AS files FROM chat_messages m').all()).results;
  assert.deepEqual(rows.map(r=>r.files),[1],'one message, with the photo');
});

test('a failed file deletion is retried in the next cleanup run',async t=>{
  const f=await fixture(t),o=await order(f.env),chat=await openChat(f,o),page='/api/kundenchat/'+chat.token;
  const photo=await body(await upload(f.app,page,f.customer,image,'image/png'));
  await f.env.DB.prepare("UPDATE chat_attachments SET created_at='2020-01-01T00:00:00.000Z'").run();
  const remove=f.env.BUCKET.delete;f.env.BUCKET.delete=async()=>{throw Error('synthetic disk error');};
  await assert.rejects(pruneUnsentUploads(f.env),/synthetic disk error/);
  assert.equal((await post(f.app,page+'/message',f.customer,{files:[photo.id]})).status,409,'a file being removed cannot be sent');
  assert.equal((await get(f.app,page+'/file/'+photo.id,f.customer)).status,404);
  f.env.BUCKET.delete=remove;assert.equal(await pruneUnsentUploads(f.env),1);
  assert.equal(f.env.BUCKET.files.has(photo.id),false);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM chat_attachments').first()).n,0);
});

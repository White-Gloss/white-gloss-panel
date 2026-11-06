import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage,remindDueTasks} from '../server/mailbox.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
async function fixture(t,{mailbox={},assistant}={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,11).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},MAILBOX_ADAPTERS:mailbox,ASSISTANT_ADAPTERS:assistant};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:'__Host-wg-session='+raw,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,call};
}
async function mail(f,{synthetic=false,from='kunde@example.invalid',html=false}={}){
  const body=html?`<html><body><script>alert(1)</script><style>body{display:none}</style><p onmouseover="alert(2)"><strong>Sicherer Inhalt</strong></p><img src="https://tracker.example.invalid/pixel"><a href="javascript:alert(3)">Link</a></body></html>`:'';
  const raw=Buffer.from(`From: Testkunde <${from}>\r\nTo: ${owner}\r\nSubject: Kommunikationstest\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: ${html?'text/html':'text/plain'}; charset=utf-8\r\n\r\n${html?body:'Guten Tag, bitte um Rückmeldung.'}\r\n`);
  return ingestMessage(f.env,raw,{folder:'INBOX',uid:Math.floor(Math.random()*100000)+1,uidValidity:'center-test'},{synthetic});
}
async function smtp(f){await f.call('/api/mailbox/settings',{email:owner,imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret'});assert.equal((await f.call('/api/mailbox/check',{kind:'smtp'})).status,200);}

test('HTML is sanitized and synthetic working states, notes and drafts stay isolated',async t=>{
  const f=await fixture(t),message=await mail(f,{synthetic:true,html:true}),suffix='?test=true';
  const detail=await (await f.call('/api/mailbox/message/'+message.id+suffix)).json();
  assert.match(detail.message.htmlBody,/Sicherer Inhalt/);assert.doesNotMatch(detail.message.htmlBody,/script|onmouseover|https:\/\/|javascript:/i);
  assert.equal((await f.call('/api/mailbox/folder'+suffix,{name:'Wartet auf Kunde'})).status,200);
  assert.equal((await f.call('/api/mailbox/state'+suffix,{messageId:message.id,read:true,flagged:true,folder:'Wartet auf Kunde'})).status,200);
  const changed=await (await f.call('/api/mailbox'+suffix)).json();assert.equal(changed.messages[0].read,true);assert.equal(changed.messages[0].flagged,true);assert.equal(changed.messages[0].folder,'Wartet auf Kunde');
  const note=await (await f.call('/api/mailbox/note'+suffix,{body:'Erste interne Notiz',messageId:message.id})).json();assert.ok(note.id);
  assert.equal((await f.call('/api/mailbox/note'+suffix,{id:note.id,body:'Notiz präzisiert',messageId:message.id})).status,200);
  const draft=await (await f.call('/api/mailbox/draft'+suffix,{to:'kunde@example.invalid',subject:'Antwort',text:'Erster Entwurf',replyTo:message.id})).json();assert.ok(draft.id);
  assert.equal((await f.call('/api/mailbox/draft'+suffix,{id:draft.id,to:'kunde@example.invalid',subject:'Antwort präzisiert',text:'Überarbeiteter Entwurf',replyTo:message.id})).status,200);
  const testView=await (await f.call('/api/mailbox'+suffix)).json();assert.equal(testView.notes[0].body,'Notiz präzisiert');assert.equal(testView.drafts[0].text,'Überarbeiteter Entwurf');
  const liveView=await (await f.call('/api/mailbox')).json();assert.equal(liveView.messages.length,0);assert.equal(liveView.notes.length,0);assert.equal(liveView.drafts.length,0);
  assert.equal((await f.call('/api/mailbox/message/'+message.id)).status,404);assert.equal((await f.call('/api/mailbox/note/delete'+suffix,{id:note.id})).status,200);
});

test('CRM links require exact stored addresses and never fuzzy-match another customer',async t=>{
  const f=await fixture(t),message=await mail(f,{from:'exact@example.invalid'}),at=new Date().toISOString();
  for(const [name,email] of [['Exakt Treffer','exact@example.invalid'],['Ähnlich Kein Treffer','exact.other@example.invalid']])await f.env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(randomUUID(),JSON.stringify({name,email,emailKey:email}),name.toLowerCase(),at,at).run();
  for(const [wg,email] of [['WG-EXAKT','exact@example.invalid'],['WG-FALSCH','other@example.invalid']]){const id=randomUUID(),data={id,wg,version:1,status:'Anfrage',source:{name:wg,email},notes:[],payments:[]};await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,wg,data.status,JSON.stringify(data),at,'test','fixture').run();}
  const detail=await (await f.call('/api/mailbox/message/'+message.id)).json();assert.deepEqual(detail.crm.customers.map(item=>item.name),['Exakt Treffer']);assert.deepEqual(detail.crm.orders.map(item=>item.wg),['WG-EXAKT']);
});

test('draft survives unknown SMTP result and is removed only after accepted delivery',async t=>{
  let fail=true;const sent=[];const f=await fixture(t,{mailbox:{async verifySmtp(){},async sendMail(config,message){sent.push(message);if(fail)throw Error('synthetic timeout');return {accepted:[message.to],rejected:[],messageId:'<accepted@example.invalid>',response:'250 accepted'};}}});await smtp(f);
  const first=await (await f.call('/api/mailbox/draft',{to:'kunde@example.invalid',subject:'Unklar',text:'Entwurf bleibt erhalten'})).json();fail=true;
  assert.equal((await f.call('/api/mailbox/send',{requestId:randomUUID(),draftId:first.id,to:'kunde@example.invalid',subject:'Unklar',text:'Entwurf bleibt erhalten',confirmed:true})).status,502);
  assert.equal((await (await f.call('/api/mailbox')).json()).drafts.length,1);
  const second=await (await f.call('/api/mailbox/draft',{to:'kunde@example.invalid',subject:'Angenommen',text:'Entwurf wird nach Versand gelöscht'})).json();fail=false;
  assert.equal((await f.call('/api/mailbox/send',{requestId:randomUUID(),draftId:second.id,to:'kunde@example.invalid',subject:'Angenommen',text:'Entwurf wird nach Versand gelöscht',confirmed:true})).status,200);
  const view=await (await f.call('/api/mailbox')).json();assert.deepEqual(view.drafts.map(item=>item.id),[first.id]);assert.equal(sent.length,2);
});

test('AI reply requires confirmation, returns an editable draft and never sends mail',async t=>{
  const analyses=[];const f=await fixture(t,{assistant:{async check(){},async analyze(config,payload){analyses.push(payload);return {id:'synthetic-reply',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({correctedText:'Guten Tag, gerne bestätige ich den Erhalt Ihrer Nachricht.',changes:[],note:'Antwortentwurf'})}]}]};}}});
  const message=await mail(f,{synthetic:true}),path='/api/mailbox/reply-suggestion?test=true';
  assert.equal((await f.call(path,{messageId:message.id,style:'professional'})).status,400);assert.equal(analyses.length,0);
  await f.call('/api/assistant/settings',{apiKey:'synthetic-key',model:'synthetic-model',dataApproved:true});assert.equal((await f.call('/api/assistant/check',{})).status,200);
  const response=await f.call(path,{messageId:message.id,style:'professional',confirmed:true}),result=await response.json();assert.equal(response.status,200);assert.match(result.draft,/bestätige ich den Erhalt/);assert.equal(analyses.length,1);assert.match(analyses[0].input[0].content[0].text,/Keine Preise, Zusagen oder Termine erfinden/);
  const view=await (await f.call('/api/mailbox?test=true')).json();assert.equal(view.deliveries.length,0);assert.equal(view.drafts.length,0);assert.equal(view.messages.length,1);
});

test('tasks stay with the mailbox, include a note and stay out of the live area',async t=>{
  const f=await fixture(t),suffix='?test=true';
  assert.equal((await f.call('/api/mailbox/task'+suffix,{})).status,400);
  const created=await (await f.call('/api/mailbox/task'+suffix,{title:'Rückruf vorbereiten',body:'Notiz zur Aufgabe',due:'2026-11-12',important:true})).json();
  assert.ok(created.id);
  const testView=await (await f.call('/api/mailbox'+suffix)).json();
  assert.equal(testView.tasks[0].title,'Rückruf vorbereiten');assert.equal(testView.tasks[0].body,'Notiz zur Aufgabe');assert.equal(testView.tasks[0].due,'2026-11-12');assert.equal(testView.tasks[0].important,true);assert.equal(testView.tasks[0].done,false);
  assert.equal((await f.call('/api/mailbox/task/done'+suffix,{id:created.id,done:true})).status,200);
  const doneView=await (await f.call('/api/mailbox'+suffix)).json();assert.equal(doneView.tasks[0].done,true);
  const liveView=await (await f.call('/api/mailbox')).json();assert.equal(liveView.tasks.length,0);
  assert.equal((await f.call('/api/mailbox/task/delete'+suffix,{id:created.id})).status,200);
  assert.equal((await (await f.call('/api/mailbox'+suffix)).json()).tasks.length,0);
});

test('a reminder rings once at the Berlin time and never for the test area',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/mailbox/task',{title:'Ohne Zeit',remind:true})).status,400);
  assert.equal((await f.call('/api/mailbox/task',{title:'Schlechte Zeit',due:'2026-11-12',time:'25:00',remind:true})).status,400);
  const live=await (await f.call('/api/mailbox/task',{title:'Rückruf',due:'2026-11-12',time:'09:30',remind:true})).json();
  assert.equal((await (await f.call('/api/mailbox')).json()).tasks[0].time,'09:30');
  assert.equal((await (await f.call('/api/mailbox')).json()).tasks[0].remind,true);
  await f.call('/api/mailbox/task?test=true',{title:'Testwecker',due:'2026-11-12',time:'09:30',remind:true});
  assert.equal(await remindDueTasks(f.env,new Date('2026-11-12T08:29:00Z')),0);
  assert.equal(await remindDueTasks(f.env,new Date('2026-11-12T08:30:00Z')),1);
  assert.ok((await f.env.DB.prepare('SELECT reminded_at FROM mail_tasks WHERE id=?').bind(live.id).first()).reminded_at);
  assert.equal(await remindDueTasks(f.env,new Date('2026-11-12T08:45:00Z')),0);
});

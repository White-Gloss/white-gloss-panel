import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
function mime({subject='Rechnung 4711',body='Guten Tag,\n\nanbei der synthetische Beleg.',attachment=Buffer.from('%PDF-1.7\nsynthetic mail receipt\n%%EOF'),type='application/pdf',name='Rechnung.pdf'}={}){
  const boundary='white-gloss-synthetic-boundary';
  return Buffer.from(`From: "Test Lieferant" <billing@example.invalid>\r\nTo: ${owner}\r\nSubject: ${subject}\r\nMessage-ID: <synthetic-4711@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}\r\n--${boundary}\r\nContent-Type: ${type}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment.toString('base64')}\r\n--${boundary}--\r\n`);
}
async function fixture(t,adapters={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},MAILBOX_ADAPTERS:adapters};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const customerRaw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(customerRaw),'customer@example.invalid',Date.now()+3600000,Date.now()).run();
  const call=(path,body,role='owner')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:'__Host-wg-session='+(role==='owner'?raw:customerRaw),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call,files};
}

test('IMAP MIME ingest is deduplicated and stores valid attachments in the existing unclassified receipt archive',async t=>{
  const f=await fixture(t),first=await ingestMessage(f.env,mime(),{folder:'INBOX',uid:42,uidValidity:'7'});assert.equal(first.duplicate,false);
  const second=await ingestMessage(f.env,mime(),{folder:'INBOX',uid:42,uidValidity:'7'});assert.equal(second.duplicate,true);assert.equal(second.id,first.id);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM mail_messages').first()).n,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_documents').first()).n,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
  const list=await (await f.call('/api/mailbox')).json();assert.equal(list.messages.length,1);assert.equal(list.messages[0].subject,'Rechnung 4711');assert.equal(list.messages[0].attachmentCount,1);
  const detail=await (await f.call('/api/mailbox/message/'+first.id)).json();assert.match(detail.message.textBody,/synthetische Beleg/);assert.equal(detail.message.fromAddress,'billing@example.invalid');assert.equal(detail.attachments[0].documentId,detail.attachments[0].id);
  const file=await f.call('/api/mailbox/attachment/'+detail.attachments[0].id);assert.equal(file.status,200);assert.match(await file.text(),/synthetic mail receipt/);
  assert.equal((await f.call('/api/mailbox',undefined,'customer')).status,403);
  const books=await (await f.call('/api/accounting')).json();assert.equal(books.documents[0].source,'EMAIL');assert.equal(books.documents[0].mailMessageId,first.id);assert.equal(books.documents[0].classification,null);
});

test('MIME signature mismatch stays visible as an unarchived attachment and never becomes a receipt',async t=>{
  const f=await fixture(t),result=await ingestMessage(f.env,mime({attachment:Buffer.from('not a real PDF and intentionally long enough'),subject:'Falscher Dateityp'}),{folder:'INBOX',uid:43,uidValidity:'7'});
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_documents').first()).n,0);
  const detail=await (await f.call('/api/mailbox/message/'+result.id)).json();assert.equal(detail.attachments[0].archived,false);assert.equal(detail.attachments[0].documentId,null);
});

test('mailbox secrets are encrypted, provider checks do not send mail, and explicit sending is idempotent',async t=>{
  const sent=[],checks=[];const f=await fixture(t,{
    async verifyImap(config){checks.push(['imap',config.auth.pass]);},
    async verifySmtp(config){checks.push(['smtp',config.auth.pass]);},
    async sendMail(config,message){sent.push(message);return {messageId:'<sent-synthetic@example.invalid>',accepted:[message.to],rejected:[],response:'250 synthetic accepted'};}
  });
  const settings={email:owner,displayName:'White Gloss',imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret-password',syncApproved:true};
  const saved=await f.call('/api/mailbox/settings',settings);assert.equal(saved.status,200,await saved.text());
  const account=await f.env.DB.prepare('SELECT * FROM mailbox_accounts').first();assert.equal(account.password.includes('synthetic-secret-password'),false);assert.equal(account.password.length>40,true);
  const publicView=await (await f.call('/api/mailbox')).json();assert.equal(JSON.stringify(publicView).includes('synthetic-secret-password'),false);assert.equal(publicView.account.syncApproved,true);
  assert.equal((await f.call('/api/mailbox/check',{kind:'imap'})).status,200);assert.equal((await f.call('/api/mailbox/check',{kind:'smtp'})).status,200);assert.deepEqual(checks,[['imap','synthetic-secret-password'],['smtp','synthetic-secret-password']]);assert.equal(sent.length,0);
  const requestId=randomUUID(),message={requestId,to:'customer@example.invalid',subject:'Synthetische Antwort',text:'Guten Tag, dies ist ein Testentwurf.',confirmed:true};
  const response=await f.call('/api/mailbox/send',message);assert.equal(response.status,200,await response.text());assert.equal(sent.length,1);
  await f.call('/api/mailbox/send',message);assert.equal(sent.length,1,'same request ID must not send twice');
  const view=await (await f.call('/api/mailbox')).json();assert.equal(view.deliveries[0].status,'SENT');assert.equal(view.deliveries[0].acceptedCount,1);
});

test('unknown SMTP result is not retried automatically and unconfirmed sending is rejected before the provider',async t=>{
  let attempts=0;const f=await fixture(t,{async verifySmtp(){},async sendMail(){attempts++;throw Error('synthetic timeout');}});
  await f.call('/api/mailbox/settings',{email:owner,imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret-password'});
  await f.call('/api/mailbox/check',{kind:'smtp'});
  assert.equal((await f.call('/api/mailbox/send',{to:'customer@example.invalid',subject:'Nicht senden',text:'Ohne Bestätigung'})).status,400);assert.equal(attempts,0);
  const requestId=randomUUID(),input={requestId,to:'customer@example.invalid',subject:'Unklarer Versand',text:'Synthetischer Test',confirmed:true};
  assert.equal((await f.call('/api/mailbox/send',input)).status,502);assert.equal(attempts,1);
  await f.call('/api/mailbox/send',input);assert.equal(attempts,1,'unknown delivery must never auto-retry');
  const view=await (await f.call('/api/mailbox')).json();assert.equal(view.deliveries[0].status,'UNKNOWN');assert.match(view.deliveries[0].error,/Ergebnis ungeklärt/);
});

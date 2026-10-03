import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealMigration} from '../src/migration.mjs';
import {openMigration,applyMigration,openGoogleClient,applyGoogleClient} from '../server/migration.mjs';
import {calendarAuthorize,calendarOAuthSchema} from '../server/calendar-oauth.mjs';
import {digest} from '../server/auth.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {settings,unprotect} from '../src/worker.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const privatePem=privateKey.export({format:'pem',type:'pkcs8'}),publicBase64=publicKey.export({format:'der',type:'spki'}).toString('base64');
const origin='https://panel.white-gloss.de',values={resendKey:'synthetic-test-only-secret',sender:'test@example.invalid',emailVerified:true,reviewUrl:'https://example.invalid/review'};
test('provider migration is encrypted for one server and expires after one day',async()=>{
  const now=Date.now(),envelope=await sealMigration(values,publicBase64,origin,now);
  assert.ok(!JSON.stringify(envelope).includes(values.resendKey));assert.deepEqual(openMigration(envelope,privatePem,origin,now),values);
  assert.throws(()=>openMigration(envelope,privatePem,'https://wrong.example.invalid',now));assert.throws(()=>openMigration(envelope,privatePem,origin,now+86400000));
  assert.throws(()=>openMigration({...envelope,fingerprint:'0'.repeat(64)},privatePem,origin,now));
  const corrupted=Buffer.from(envelope.ciphertext,'base64');corrupted[10]^=1;assert.throws(()=>openMigration({...envelope,ciphertext:corrupted.toString('base64')},privatePem,origin,now));
  await assert.rejects(sealMigration(values,publicBase64,'https://wrong.example.invalid',now));
});
test('Qonto and Resend transfer atomically while all verification flags reset',async t=>{
  const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,CONFIG_KEY:Buffer.alloc(32,3).toString('base64')};t.after(()=>env.DB.close());
  const both={...values,qontoKey:'synthetic-qonto-secret',qontoLogin:'test-organisation',qontoVerified:true};
  await applyMigration(env,await sealMigration(both,publicBase64,origin),privatePem);const config=await settings(env);
  assert.equal(await unprotect(env,config.qontoKey),both.qontoKey);assert.equal(config.qontoLogin,both.qontoLogin);assert.equal(config.qontoVerified,false);assert.equal(config.emailVerified,false);
  await assert.rejects(applyMigration(env,await sealMigration({qontoKey:both.qontoKey,qontoLogin:both.qontoLogin},publicBase64,origin),privatePem),/überschrieben/);
});
test('Google webclient purpose and callback bind credentials to the intended server',async t=>{
  const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),OWNER_EMAIL_SHA256:digest('owner@example.invalid')};t.after(()=>env.DB.close());
  const client={googleClientId:'123456789-testclient.apps.googleusercontent.com',googleClientSecret:'synthetic-google-client-secret',redirectUri:origin+'/auth/calendar/callback'};
  const envelope=await sealMigration(client,publicBase64,origin,Date.now(),'google-webclient');assert.deepEqual(openGoogleClient(envelope,privatePem,origin),client);
  assert.throws(()=>openMigration(envelope,privatePem,origin),/Einrichtungsschritt/);
  const wrong=await sealMigration({...client,redirectUri:'https://wrong.example.invalid/callback'},publicBase64,origin,Date.now(),'google-webclient');assert.throws(()=>openGoogleClient(wrong,privatePem,origin),/HTTPS/);
  await applyGoogleClient(env,envelope,privatePem);const config=await settings(env);assert.notEqual(config.googleClientSecret,client.googleClientSecret);assert.equal(await unprotect(env,config.googleClientSecret),client.googleClientSecret);
  await calendarOAuthSchema(env);const auth=await calendarAuthorize(env,'owner@example.invalid');const url=new URL(auth.headers.get('location'));assert.equal(url.searchParams.get('client_id'),client.googleClientId);assert.equal(url.searchParams.get('redirect_uri'),client.redirectUri);assert.ok(!String(url).includes(client.googleClientSecret));
  await assert.rejects(applyGoogleClient(env,envelope,privatePem),/überschrieben/);
});
test('migration atomically reseals the credential and refuses to overwrite a connected account',async t=>{
  const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,CONFIG_KEY:Buffer.alloc(32,2).toString('base64')};t.after(()=>env.DB.close());
  const envelope=await sealMigration(values,publicBase64,origin);await applyMigration(env,envelope,privatePem);
  const config=await settings(env);assert.notEqual(config.resendKey,values.resendKey);assert.equal(await unprotect(env,config.resendKey),values.resendKey);assert.equal(config.sender,values.sender);
  await assert.rejects(applyMigration(env,envelope,privatePem),/überschrieben/);
  const forbidden=await sealMigration({...values,hubKey:'forbidden'},publicBase64,origin);assert.throws(()=>openMigration(forbidden,privatePem,origin),/Unbekannte/);
});

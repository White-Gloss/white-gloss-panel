import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealMigration} from '../src/migration.mjs';
import {openMigration,applyMigration} from '../server/migration.mjs';
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
test('migration atomically reseals the credential and refuses to overwrite a connected account',async t=>{
  const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,CONFIG_KEY:Buffer.alloc(32,2).toString('base64')};t.after(()=>env.DB.close());
  const envelope=await sealMigration(values,publicBase64,origin);await applyMigration(env,envelope,privatePem);
  const config=await settings(env);assert.notEqual(config.resendKey,values.resendKey);assert.equal(await unprotect(env,config.resendKey),values.resendKey);assert.equal(config.sender,values.sender);
  await assert.rejects(applyMigration(env,envelope,privatePem),/überschrieben/);
  const forbidden=await sealMigration({...values,hubKey:'forbidden'},publicBase64,origin);assert.throws(()=>openMigration(forbidden,privatePem,origin),/Unbekannte/);
});

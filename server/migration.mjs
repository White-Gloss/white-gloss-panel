import {privateDecrypt,createPrivateKey,createPublicKey,createHash,createDecipheriv,constants} from 'node:crypto';
import {init,settings,protect} from '../src/worker.mjs';
import {need} from '../src/domain.mjs';
export function openMigration(envelope,privateKeyPem,origin,now=Date.now()){
  need(envelope?.version===1&&envelope.targetOrigin===origin,'Übertragung gehört nicht zu diesem Panel.');
  const privateKey=createPrivateKey(privateKeyPem),publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'});
  need(createHash('sha256').update(publicKey).digest('hex')===envelope.fingerprint,'Übertragung wurde für einen anderen Serverschlüssel erstellt.');
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));const iv=Buffer.from(envelope.iv,'base64'),cipher=Buffer.from(envelope.ciphertext,'base64');need(key.length===32&&iv.length===12&&cipher.length>16&&cipher.length<20000,'Übertragung ungültig.');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(cipher.subarray(-16));const payload=JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]).toString('utf8'));
  need(payload.version===1&&payload.targetOrigin===origin&&Number.isFinite(payload.createdAt)&&payload.createdAt<=now+60000&&payload.expiresAt===payload.createdAt+86400000&&payload.expiresAt>now,'Übertragung ist abgelaufen oder ungültig.');
  const allowed=new Set(['resendKey','sender','reviewUrl','emailVerified']);need(payload.settings&&Object.keys(payload.settings).every(key=>allowed.has(key)),'Unbekannte Zugangsdaten in der Übertragung.');
  need(typeof payload.settings.resendKey==='string'&&payload.settings.resendKey.length>10&&typeof payload.settings.sender==='string','Resend-Zugang ist unvollständig.');return payload.settings;
}
export async function applyMigration(env,envelope,privateKeyPem,now=Date.now()){
  const values=openMigration(envelope,privateKeyPem,env.PANEL_ORIGIN,now);await init(env);const existing=await settings(env);need(!existing.resendKey,'Ein vorhandener Serverzugang wird nicht überschrieben.');
  const statements=await Promise.all(Object.entries(values).map(async([key,value])=>env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(key==='resendKey'?await protect(env,value):value))));
  await env.DB.batch(statements);
}

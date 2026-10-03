import {privateDecrypt,createPrivateKey,createPublicKey,createHash,createDecipheriv,constants} from 'node:crypto';
import {init,settings,protect} from '../src/worker.mjs';
import {need} from '../src/domain.mjs';
function decryptEnvelope(envelope,privateKeyPem,origin,now,purpose){
  need(envelope?.version===1&&envelope.targetOrigin===origin&&envelope.purpose===purpose,'Übertragung gehört nicht zu diesem Panel oder Einrichtungsschritt.');
  const privateKey=createPrivateKey(privateKeyPem),publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'});
  need(createHash('sha256').update(publicKey).digest('hex')===envelope.fingerprint,'Übertragung wurde für einen anderen Serverschlüssel erstellt.');
  const key=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.key,'base64'));const iv=Buffer.from(envelope.iv,'base64'),cipher=Buffer.from(envelope.ciphertext,'base64');need(key.length===32&&iv.length===12&&cipher.length>16&&cipher.length<20000,'Übertragung ungültig.');
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(cipher.subarray(-16));const payload=JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]).toString('utf8'));
  need(payload.version===1&&payload.purpose===purpose&&payload.targetOrigin===origin&&Number.isFinite(payload.createdAt)&&payload.createdAt<=now+60000&&payload.expiresAt===payload.createdAt+86400000&&payload.expiresAt>now,'Übertragung ist abgelaufen oder ungültig.');return payload.settings;
}
export function openMigration(envelope,privateKeyPem,origin,now=Date.now()){
  const values=decryptEnvelope(envelope,privateKeyPem,origin,now,'providers');
  const allowed=new Set(['resendKey','sender','reviewUrl','emailVerified','lexwareKey','lexwareVerified']);need(values&&Object.keys(values).every(key=>allowed.has(key)),'Unbekannte Zugangsdaten in der Übertragung.');
  need(values.resendKey||values.lexwareKey,'Anbieterzugang fehlt.');
  if(values.resendKey)need(typeof values.resendKey==='string'&&values.resendKey.length>10&&typeof values.sender==='string','Resend-Zugang ist unvollständig.');
  if(values.lexwareKey)need(typeof values.lexwareKey==='string'&&values.lexwareKey.length>10,'Lexware-Zugang ist unvollständig.');return values;
}
export async function applyMigration(env,envelope,privateKeyPem,now=Date.now()){
  const values=openMigration(envelope,privateKeyPem,env.PANEL_ORIGIN,now);await init(env);const existing=await settings(env);need(!values.resendKey||!existing.resendKey,'Ein vorhandener Serverzugang wird nicht überschrieben.');need(!values.lexwareKey||!existing.lexwareKey,'Ein vorhandener Lexware-Zugang wird nicht überschrieben.');
  const statements=await Promise.all(Object.entries(values).map(async([key,value])=>env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(['emailVerified','lexwareVerified'].includes(key)?false:['resendKey','lexwareKey'].includes(key)?await protect(env,value):value))));
  await env.DB.batch(statements);
}
export function openGoogleClient(envelope,privateKeyPem,origin,now=Date.now()){
  const values=decryptEnvelope(envelope,privateKeyPem,origin,now,'google-webclient');need(values&&Object.keys(values).every(key=>['googleClientId','googleClientSecret','redirectUri'].includes(key)),'Unbekannte Google-Konfiguration.');
  need(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(values.googleClientId??'')&&typeof values.googleClientSecret==='string'&&values.googleClientSecret.length>10&&values.redirectUri===origin+'/auth/calendar/callback','Google-Webclient gehört nicht zu diesem HTTPS-Rückruf.');return values;
}
export async function applyGoogleClient(env,envelope,privateKeyPem,now=Date.now()){
  const values=openGoogleClient(envelope,privateKeyPem,env.PANEL_ORIGIN,now);await init(env);const existing=await settings(env);need(!existing.googleClientId&&!env.GOOGLE_CLIENT_ID,'Ein bestehender Google-Webclient wird nicht überschrieben.');
  await env.DB.batch([env.DB.prepare('INSERT INTO settings VALUES(?,?)').bind('googleClientId',JSON.stringify(values.googleClientId)),env.DB.prepare('INSERT INTO settings VALUES(?,?)').bind('googleClientSecret',JSON.stringify(await protect(env,values.googleClientSecret)))]);
}

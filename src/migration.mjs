function migrationNeed(ok,message){if(!ok)throw Object.assign(new Error(message),{status:409});}
function migrationBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
export async function sealMigration(values,publicKeyBase64,targetOrigin,now=Date.now(),purpose='providers'){
  migrationNeed(targetOrigin==='https://panel.white-gloss.de','IONOS-Ziel muss ausdrücklich freigegeben sein.');
  migrationNeed(['providers','google-webclient'].includes(purpose),'Unbekannter Übertragungszweck.');
  const spki=Uint8Array.from(atob(publicKeyBase64),character=>character.charCodeAt(0));
  const publicKey=await crypto.subtle.importKey('spki',spki,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload={version:1,purpose,targetOrigin,createdAt:now,expiresAt:now+86400000,settings:values};
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(payload)));
  const sealedKey=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,await crypto.subtle.exportKey('raw',key));
  const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',spki))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return {version:1,purpose,targetOrigin,fingerprint,key:migrationBase64(sealedKey),iv:migrationBase64(iv),ciphertext:migrationBase64(ciphertext)};
}

import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createPublicKey,createHash} from 'node:crypto';
import {assertIonosRuntime} from './start.mjs';
import {readProtectedEnvironment} from './environment.mjs';
import {applicationEnvironment,createApplication} from './application.mjs';
import {applyMigration,applyGoogleClient} from './migration.mjs';
import {checkProvider,settings,setting} from '../src/worker.mjs';
import {configuration} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';
import {digest} from './auth.mjs';
import {appointmentConfirmationPayload} from './appointment-mail.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('IONOS-Administrator erforderlich.');
const variables=readProtectedEnvironment();assertIonosRuntime(variables);process.umask(0o077);
const action=process.argv[2];
if(action==='migration-public-key'){
  const spki=createPublicKey(readFileSync('/etc/white-gloss-panel/migration-private.pem')).export({format:'der',type:'spki'});
  console.log(JSON.stringify({publicKey:spki.toString('base64'),fingerprint:createHash('sha256').update(spki).digest('hex'),targetOrigin:variables.PANEL_ORIGIN}));
}else{
  const env=await applicationEnvironment(variables);try{await createApplication(env);
    if(['import-resend','import-connections','import-google-client'].includes(action)){
      const path=process.argv[3];if(!/^\/home\/white-gloss-ci\/white-gloss-(?:ionos-zugang|google-webclient)[\w.-]*verschluesselt\.json$/.test(path??''))throw Error('Nur das verschlüsselte IONOS-Übertragungspaket importieren.');
      const bytes=readFileSync(path);if(bytes.length>50000)throw Error('Übertragung zu groß.');const packet=JSON.parse(bytes.toString('utf8')),privateKey=readFileSync('/etc/white-gloss-panel/migration-private.pem');
      if(action==='import-google-client'){await applyGoogleClient(env,packet,privateKey);console.log(JSON.stringify({ok:true,provider:'Google-Webclient',callback:env.PANEL_ORIGIN+'/auth/calendar/callback'}));}
      else {await applyMigration(env,packet,privateKey);
      // Verify the actual provider after transfer instead of trusting the old Site flag.
      const s=await settings(env);for(const [key,kind,flag] of [['resendKey','email','emailVerified'],['qontoKey','qonto','qontoVerified']])if(s[key]){await setting(env,flag,false);const result=await checkProvider(env,kind);console.log(JSON.stringify({ok:true,provider:kind,message:result.message}));}}
    }else if(action==='check'){
      const kind=process.argv[3];if(!['website','email','calendar','qonto'].includes(kind))throw Error('Unbekannter Anbieter.');console.log(JSON.stringify(await checkProvider(env,kind)));
    }else if(action==='send-appointment-test'){
      // A deliberate operator transport test; never creates an order, signature,
      // appointment, customer account or calendar event. Normal test orders stay blocked.
      const testId=process.argv[3];
      if(!/^[a-f0-9]{32}$/.test(testId??''))throw Error('Eindeutige Test-ID mit 32 Hex-Zeichen angeben.');
      if(digest(COMPANY.email.toLowerCase())!==env.OWNER_EMAIL_SHA256)throw Error('Testempfänger stimmt nicht mit dem Betreiber überein.');
      const config=await configuration(env,['resendKey']);
      if(!config.emailVerified||!config.sendApproved||!config.resendKey||!config.sender)throw Error('Geprüfter und freigegebener E-Mail-Versand fehlt.');
      const fixture={wg:'TEST-TERMIN-'+testId.slice(0,8),synthetic:true,source:{name:'TEST Betreiber',email:COMPANY.email,vehicle:'Fiktives TEST-Fahrzeug'},acceptance:{snapshotHash:'f'.repeat(64),at:'2099-10-03T09:00:00.000Z',appointmentOptionId:'test-option',snapshot:{offer:{services:'TEST Innenreinigung',totalCents:10000,pickupCents:0,lines:[{title:'TEST-Paket',description:'Fiktive Leistung',amountCents:10000}]},appointment:{id:'test-option',start:'2099-10-03T10:00:00.000Z',end:'2099-10-03T12:00:00.000Z',duration:120,delivery:'Kunde bringt',location:'Fiktiver TEST-Ort'},appointmentOptionsVersion:1}}};
      const message=appointmentConfirmationPayload(fixture,config.sender);
      message.to=[COMPANY.email];delete message.cc;
      message.subject='TEST – Terminbestätigung – '+testId.slice(0,8);
      message.text='REINER VERSANDTEST – KEINE ECHTE BUCHUNG.\nDie folgenden Angaben, Unterschriftsbestätigung und Preise sind fiktive Testdaten. Es wurde kein Auftrag und kein Kalendertermin angelegt.\n\n'+message.text;
      // Keep a root-only receipt before transmission, so repeating this test ID
      // remains blocked even after the provider's idempotency window expires.
      const receiptPath='/root/white-gloss-panel-mail-tests/'+testId+'.json';
      mkdirSync('/root/white-gloss-panel-mail-tests',{recursive:true,mode:0o700});
      const receipt={testId,state:'pending',startedAt:new Date().toISOString(),recipient:COMPANY.email,subject:message.subject};
      try{writeFileSync(receiptPath,JSON.stringify(receipt),{encoding:'utf8',mode:0o600,flag:'wx'});}catch{throw Error('Test-ID bereits verwendet oder Quittung nicht speicherbar. Kein Versand ausgelöst.');}
      let response,data;
      try{response=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-appointment-transport-test-'+testId},body:JSON.stringify(message)});data=await response.json();}catch{writeFileSync(receiptPath,JSON.stringify({...receipt,state:'unknown'}));throw Error('Testergebnis ungeklärt. Keine Wiederholung mit neuer Test-ID; zuerst Anbieterbestand prüfen.');}
      if(!response.ok||typeof data?.id!=='string'||!data.id.length){writeFileSync(receiptPath,JSON.stringify({...receipt,state:'unknown'}));throw Error('Testversand nicht bestätigt. Keine Wiederholung mit neuer Test-ID.');}
      writeFileSync(receiptPath,JSON.stringify({...receipt,state:'sent',providerId:data.id,finishedAt:new Date().toISOString()}));
      console.log(JSON.stringify({ok:true,test:true,testId,providerId:data.id,recipient:COMPANY.email,subject:message.subject}));
    }else if(action==='status'){
      const s=await settings(env);console.log(JSON.stringify({website:s.hubVerified===true,email:s.emailVerified===true,googleClientConfigured:Boolean(s.googleClientId||env.GOOGLE_CLIENT_ID),calendar:s.calendarVerified===true,calendarOAuth:s.calendarOAuth===true,qonto:s.qontoVerified===true,numberAudit:s.numberAudit===true,lastScheduledAt:s.lastScheduledAt??null,lastScheduledError:s.lastScheduledError??null,orders:(await env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE synthetic=0').first()).n}));
    }else throw Error('Unbekannter Administrationsauftrag.');
  }finally{env.DB.close();}
}

import {readFileSync} from 'node:fs';
import {createPublicKey,createHash} from 'node:crypto';
import {assertIonosRuntime} from './start.mjs';
import {readProtectedEnvironment} from './environment.mjs';
import {applicationEnvironment,createApplication} from './application.mjs';
import {applyMigration,applyGoogleClient} from './migration.mjs';
import {checkProvider,settings,setting} from '../src/worker.mjs';
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
      const s=await settings(env);for(const [key,kind,flag] of [['resendKey','email','emailVerified'],['lexwareKey','lexware','lexwareVerified']])if(s[key]){await setting(env,flag,false);const result=await checkProvider(env,kind);console.log(JSON.stringify({ok:true,provider:kind,message:result.message}));}}
    }else if(action==='check'){
      const kind=process.argv[3];if(!['website','email','calendar','lexware'].includes(kind))throw Error('Unbekannter Anbieter.');console.log(JSON.stringify(await checkProvider(env,kind)));
    }else if(action==='status'){
      const s=await settings(env);console.log(JSON.stringify({website:s.hubVerified===true,email:s.emailVerified===true,googleClientConfigured:Boolean(s.googleClientId||env.GOOGLE_CLIENT_ID),calendar:s.calendarVerified===true,calendarOAuth:s.calendarOAuth===true,lexware:s.lexwareVerified===true,numberAudit:s.numberAudit===true,lastScheduledAt:s.lastScheduledAt??null,lastScheduledError:s.lastScheduledError??null,orders:(await env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE synthetic=0').first()).n}));
    }else throw Error('Unbekannter Administrationsauftrag.');
  }finally{env.DB.close();}
}

import {readFileSync} from 'node:fs';
import {createPublicKey,createHash} from 'node:crypto';
import {assertIonosRuntime} from './start.mjs';
import {readProtectedEnvironment} from './environment.mjs';
import {applicationEnvironment,createApplication} from './application.mjs';
import {applyMigration} from './migration.mjs';
import {checkProvider,settings,setting} from '../src/worker.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0)throw Error('IONOS-Administrator erforderlich.');
const variables=readProtectedEnvironment();assertIonosRuntime(variables);process.umask(0o077);
const action=process.argv[2];
if(action==='migration-public-key'){
  const spki=createPublicKey(readFileSync('/etc/white-gloss-panel/migration-private.pem')).export({format:'der',type:'spki'});
  console.log(JSON.stringify({publicKey:spki.toString('base64'),fingerprint:createHash('sha256').update(spki).digest('hex'),targetOrigin:variables.PANEL_ORIGIN}));
}else{
  const env=await applicationEnvironment(variables);try{await createApplication(env);
    if(action==='import-resend'){
      const path=process.argv[3];if(!/^\/home\/white-gloss-ci\/white-gloss-ionos-zugang[\w.-]*\.json$/.test(path??''))throw Error('Nur das verschlüsselte IONOS-Übertragungspaket importieren.');
      const bytes=readFileSync(path);if(bytes.length>50000)throw Error('Übertragung zu groß.');await applyMigration(env,JSON.parse(bytes.toString('utf8')),readFileSync('/etc/white-gloss-panel/migration-private.pem'));
      // Verify the actual provider after transfer instead of trusting the old Site flag.
      await setting(env,'emailVerified',false);const result=await checkProvider(env,'email');console.log(JSON.stringify({ok:true,provider:'Resend',message:result.message}));
    }else if(action==='check'){
      const kind=process.argv[3];if(!['website','email','calendar','qonto'].includes(kind))throw Error('Unbekannter Anbieter.');console.log(JSON.stringify(await checkProvider(env,kind)));
    }else if(action==='status'){
      const s=await settings(env);console.log(JSON.stringify({website:s.hubVerified===true,email:s.emailVerified===true,calendar:s.calendarVerified===true,calendarOAuth:s.calendarOAuth===true,qonto:s.qontoVerified===true,numberAudit:s.numberAudit===true,lastScheduledAt:s.lastScheduledAt??null,lastScheduledError:s.lastScheduledError??null,orders:(await env.DB.prepare('SELECT COUNT(*) n FROM orders WHERE synthetic=0').first()).n}));
    }else throw Error('Unbekannter Administrationsauftrag.');
  }finally{env.DB.close();}
}

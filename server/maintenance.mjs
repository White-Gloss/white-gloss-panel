import {assertIonosRuntime} from './start.mjs';
import {applicationEnvironment,createApplication,maintenance} from './application.mjs';
import {settings} from '../src/worker.mjs';
import {pushMaintenance} from './push.mjs';
assertIonosRuntime();process.umask(0o077);const env=await applicationEnvironment();
try{
  await createApplication(env);
  const last=Date.parse((await settings(env)).lastScheduledAttempt??'');
  if(Number.isFinite(last)&&Date.now()-last<15*60000){await pushMaintenance(env);console.log('Handy-Benachrichtigungen geprüft.');}
  else{const result=await maintenance(env);if(result.deliveryError)throw Error('Hintergrundprüfung meldet eine Anbieter-Störung.');console.log(result.skipped?'Vorheriger Lauf noch aktiv.':'Hintergrundprüfung abgeschlossen.');}
}finally{env.DB.close();}

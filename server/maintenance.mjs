import {assertIonosRuntime} from './start.mjs';
import {applicationEnvironment,createApplication,maintenance} from './application.mjs';
assertIonosRuntime();process.umask(0o077);const env=await applicationEnvironment();try{await createApplication(env);const result=await maintenance(env);if(result.deliveryError)throw Error('Hintergrundprüfung meldet eine Anbieter-Störung.');console.log(result.skipped?'Vorheriger Lauf noch aktiv.':'Hintergrundprüfung abgeschlossen.');}finally{env.DB.close();}

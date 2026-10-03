import {readFile,writeFile,mkdir,rename,link} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PanelDatabase} from './storage.mjs';
import {assertIonosRuntime} from './start.mjs';
export async function backupData(dataDirectory,backupRoot,configurationFiles=[],environment=null){
  const target=resolve(backupRoot,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID()),temporary=target+'.incomplete';
  await mkdir(temporary,{recursive:true,mode:0o700});const files=[];
  const add=async(source,name,expectedHash=null)=>{const bytes=await readFile(source),hash=createHash('sha256').update(bytes).digest('hex');if(expectedHash&&hash!==expectedHash)throw Error('Foto-Prüfsumme stimmt nicht; Backup wurde nicht bestätigt.');if(name.startsWith('uploads/'))await link(source,resolve(temporary,name));else await writeFile(resolve(temporary,name),bytes,{mode:0o600,flag:'wx'});files.push({name,size:bytes.length,sha256:hash});};
  const database=new PanelDatabase(resolve(dataDirectory,'panel.sqlite'));try{database.sql.prepare('VACUUM INTO ?').run(resolve(temporary,'panel.sqlite'));}finally{database.close();}
  const snapshot=new PanelDatabase(resolve(temporary,'panel.sqlite'));let assets;try{if(snapshot.sql.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Datenbankprüfung fehlgeschlagen.');assets=snapshot.sql.prepare('SELECT id,hash FROM assets').all();snapshot.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');}finally{snapshot.close();}
  await mkdir(resolve(temporary,'uploads'),{mode:0o700});for(const asset of assets){if(typeof asset.id!=='string'||typeof asset.hash!=='string'||!/^[a-f0-9-]{36}$/.test(asset.id))throw Error('Ungültige Foto-ID.');await add(resolve(dataDirectory,'uploads',asset.id),'uploads/'+asset.id,asset.hash);await add(resolve(dataDirectory,'uploads',asset.id+'.json'),'uploads/'+asset.id+'.json');}
  for(const [source,name] of configurationFiles)await add(source,name);
  if(environment){const bytes=Buffer.from(Object.entries(environment).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n');await writeFile(resolve(temporary,'environment'),bytes,{mode:0o600,flag:'wx'});files.push({name:'environment',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
  const dbBytes=await readFile(resolve(temporary,'panel.sqlite'));files.push({name:'panel.sqlite',size:dbBytes.length,sha256:createHash('sha256').update(dbBytes).digest('hex')});
  await writeFile(resolve(temporary,'manifest.json'),JSON.stringify({version:1,createdAt:new Date().toISOString(),files},null,2),{mode:0o600,flag:'wx'});await rename(temporary,target);return {path:target,assets:assets.length,files:files.length};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const env=Object.fromEntries(['NODE_ENV','PANEL_BIND','PANEL_PORT','PANEL_DATA_DIR','PANEL_ASSETS_DIR','PANEL_ORIGIN','OWNER_EMAIL_SHA256','CONFIG_KEY','CALENDAR_OWNER_EMAIL','CALENDAR_ID','EMAIL_SENDER','HUB_SYNC_TOKEN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','RESEND_API_KEY','QONTO_LOGIN','QONTO_API_KEY','REVIEW_URL'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  assertIonosRuntime(env);process.umask(0o077);console.log(JSON.stringify(await backupData(env.PANEL_DATA_DIR,'/var/lib/white-gloss-panel/backups',[],env)));
}

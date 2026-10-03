import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,rename,unlink,realpath,link} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';

export class PanelDatabase {
  constructor(filename){this.sql=new DatabaseSync(filename);this.sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');this.queue=Promise.resolve();}
  prepare(query){const db=this;let values=[];const run=()=>{const before=db.sql.prepare('SELECT total_changes() AS n').get().n;db.sql.prepare(query).run(...values);return {meta:{changes:Number(db.sql.prepare('SELECT total_changes() AS n').get().n)-Number(before)}};};return {bind(...args){values=args;return this;},_run:run,async run(){return run();},async first(){return db.sql.prepare(query).get(...values)??null;},async all(){return {results:db.sql.prepare(query).all(...values)};}};}
  batch(statements){const task=this.queue.then(()=>{this.sql.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement._run());this.sql.exec('COMMIT');return results;}catch(error){this.sql.exec('ROLLBACK');throw error;}});this.queue=task.catch(()=>{});return task;}
  close(){this.sql.close();}
}
export class PrivateBucket {
  constructor(directory){this.directory=resolve(directory);}
  path(key){if(!/^[a-f0-9-]{36}$/.test(key))throw Error('Ungültige Datei-ID.');return resolve(this.directory,key);}
  async put(key,value,options={}){const path=this.path(key),temporary=path+'.'+randomUUID()+'.tmp';let created=false;await mkdir(this.directory,{recursive:true,mode:0o700});try{await writeFile(temporary,new Uint8Array(value),{mode:0o600,flag:'wx'});await link(temporary,path);created=true;await writeFile(path+'.json',JSON.stringify({httpMetadata:options.httpMetadata??{}}),{mode:0o600,flag:'wx'});}catch(error){if(created)await unlink(path).catch(()=>{});throw error;}finally{await unlink(temporary).catch(()=>{});}}
  async get(key){const path=this.path(key);try{const [body,metadata]=await Promise.all([readFile(path),readFile(path+'.json','utf8')]);return {body:new Uint8Array(body),httpMetadata:JSON.parse(metadata).httpMetadata};}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async delete(key){const path=this.path(key);await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(path+'.json').catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export class StaticAssets {
  constructor(directory){this.directory=resolve(directory);}
  async fetch(request){let name=new URL(request.url).pathname;if(name==='/'||name.startsWith('/angebot/'))name='/index.html';if(!/^\/[a-zA-Z0-9_.-]+$/.test(name)||name.includes('..'))return new Response('Nicht gefunden',{status:404});const candidate=resolve(this.directory,'.'+name);try{const actual=await realpath(candidate),root=await realpath(this.directory);if(!actual.startsWith(root+sep))return new Response('Nicht gefunden',{status:404});const bytes=await readFile(actual);const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[extname(actual)]??'application/octet-stream';return new Response(bytes,{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch(error){if(error.code==='ENOENT')return new Response('Nicht gefunden',{status:404});throw error;}}
}
export async function createStorage(dataDirectory,assetsDirectory){const directory=resolve(dataDirectory);await mkdir(directory,{recursive:true,mode:0o700});return {DB:new PanelDatabase(resolve(directory,'panel.sqlite')),BUCKET:new PrivateBucket(resolve(directory,'uploads')),ASSETS:new StaticAssets(assetsDirectory)};}
export async function atomicPrivateFile(path,content){await mkdir(dirname(path),{recursive:true,mode:0o700});const temporary=path+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,content,{mode:0o600,flag:'wx'});await rename(temporary,path);}finally{await unlink(temporary).catch(()=>{});}}

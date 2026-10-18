import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PanelDatabase,PrivateBucket} from '../server/storage.mjs';
import {backupData} from '../server/backup.mjs';

test('receipt originals survive source removal and corrupted receipts fail the backup',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));
  let db;
  try{
    const data=resolve(root,'data');await mkdir(data);db=new PanelDatabase(resolve(data,'panel.sqlite'));
    await db.prepare('CREATE TABLE assets(id TEXT,hash TEXT)').run();await db.prepare('CREATE TABLE accounting_documents(id TEXT,sha256 TEXT)').run();
    const bucket=new PrivateBucket(resolve(data,'uploads')),id=randomUUID(),bytes=Buffer.from('%PDF-1.7\nsynthetic receipt\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex');
    await db.prepare('INSERT INTO accounting_documents VALUES(?,?)').bind(id,hash).run();await bucket.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});
    const saved=await backupData(data,resolve(root,'backups'));await bucket.delete(id);
    const restored=new PrivateBucket(resolve(saved.path,'uploads'));assert.deepEqual(Buffer.from((await restored.get(id)).body),bytes);
    const manifest=JSON.parse(await readFile(resolve(saved.path,'manifest.json'),'utf8'));assert.equal(manifest.files.find(f=>f.name==='uploads/'+id).sha256,hash);
    const snapshot=new PanelDatabase(resolve(saved.path,'panel.sqlite'));try{assert.equal((await snapshot.prepare('SELECT sha256 FROM accounting_documents WHERE id=?').bind(id).first()).sha256,hash);}finally{snapshot.close();}
    await bucket.put(id,Buffer.from('corrupted receipt'));await assert.rejects(backupData(data,resolve(root,'backups')),/Prüfsumme/);
  }finally{db?.close();assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});}
});
test('backup reopens a consistent database and all private asset bytes after source removal',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));try{
    const data=resolve(root,'data');await mkdir(data);const db=new PanelDatabase(resolve(data,'panel.sqlite')),bucket=new PrivateBucket(resolve(data,'uploads')),id=randomUUID(),bytes=Buffer.from([1,2,3]),hash=createHash('sha256').update(bytes).digest('hex');
    await db.prepare('CREATE TABLE assets(id TEXT,hash TEXT)').run();await db.prepare('INSERT INTO assets VALUES(?,?)').bind(id,hash).run();await bucket.put(id,bytes,{httpMetadata:{contentType:'image/png'}});
    const saved=await backupData(data,resolve(root,'backups'),[],{CONFIG_KEY:'synthetic'});await bucket.delete(id);db.close();
    const restored=new PanelDatabase(resolve(saved.path,'panel.sqlite'));try{assert.equal((await restored.prepare('SELECT hash FROM assets WHERE id=?').bind(id).first()).hash,hash);}finally{restored.close();}
    const restoredBucket=new PrivateBucket(resolve(saved.path,'uploads'));assert.deepEqual([...(await restoredBucket.get(id)).body],[1,2,3]);const manifest=JSON.parse(await readFile(resolve(saved.path,'manifest.json'),'utf8'));
    for(const file of manifest.files){const content=await readFile(resolve(saved.path,file.name));assert.equal(createHash('sha256').update(content).digest('hex'),file.sha256);}
    assert.ok((await readFile(resolve(saved.path,'environment'),'utf8')).includes('CONFIG_KEY="synthetic"'));
  }finally{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});}
});
test('a corrupted photo prevents a completed backup from being advertised',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));try{
    const data=resolve(root,'data');await mkdir(data);const db=new PanelDatabase(resolve(data,'panel.sqlite')),id=randomUUID();await db.prepare('CREATE TABLE assets(id TEXT,hash TEXT)').run();await db.prepare('INSERT INTO assets VALUES(?,?)').bind(id,'0'.repeat(64)).run();const bucket=new PrivateBucket(resolve(data,'uploads'));await bucket.put(id,new Uint8Array([1]),{httpMetadata:{contentType:'image/png'}});
    await assert.rejects(backupData(data,resolve(root,'backups')),/Prüfsumme/);db.close();
  }finally{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});}
});

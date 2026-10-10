import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {PanelDatabase,PrivateBucket} from '../server/storage.mjs';
import {backupData} from '../server/backup.mjs';
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
test('backup restores every immutable document original and deduplicates shared bucket files',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));try{
    const data=resolve(root,'data');await mkdir(data);const db=new PanelDatabase(resolve(data,'panel.sqlite')),bucket=new PrivateBucket(resolve(data,'uploads')),originals=new Map();await db.prepare('CREATE TABLE assets(id TEXT,hash TEXT)').run();
    const tables=[['document_templates','id'],['payment_documents','asset_id'],['agreement_documents','asset_id'],['invoice_originals','asset_id'],['invoice_payment_documents','asset_id']];
    for(const [table,column] of tables){await db.prepare('CREATE TABLE '+table+'('+column+' TEXT,hash TEXT)').run();const id=randomUUID(),bytes=Buffer.from('SYNTHETIC PDF ORIGINAL '+table),hash=createHash('sha256').update(bytes).digest('hex');originals.set(id,bytes);await bucket.put(id,bytes,{httpMetadata:{contentType:'application/pdf'}});await db.prepare('INSERT INTO '+table+' VALUES(?,?)').bind(id,hash).run();}
    const [sharedId,sharedBytes]=originals.entries().next().value;await db.prepare('INSERT INTO assets VALUES(?,?)').bind(sharedId,createHash('sha256').update(sharedBytes).digest('hex')).run();
    const saved=await backupData(data,resolve(root,'backups'));assert.equal(saved.assets,1);assert.equal(saved.documents,5);assert.equal(saved.originals,5);db.close();for(const id of originals.keys())await bucket.delete(id);
    const restored=new PrivateBucket(resolve(saved.path,'uploads')),manifest=JSON.parse(await readFile(resolve(saved.path,'manifest.json'),'utf8'));assert.equal(new Set(manifest.files.map(file=>file.name)).size,manifest.files.length);
    for(const [id,bytes] of originals){const file=await restored.get(id);assert.deepEqual(file.body,new Uint8Array(bytes));assert.equal(file.httpMetadata.contentType,'application/pdf');assert.equal(manifest.files.filter(item=>item.name==='uploads/'+id).length,1);}
    const snapshot=new PanelDatabase(resolve(saved.path,'panel.sqlite'));try{for(const [table] of tables)assert.equal((await snapshot.prepare('SELECT COUNT(*) n FROM '+table).first()).n,1);}finally{snapshot.close();}
    for(const file of manifest.files){const bytes=await readFile(resolve(saved.path,file.name));assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);}
  }finally{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});}
});
for(const failure of ['missing','corrupt','conflicting'])test('a '+failure+' payment PDF original prevents a completed backup',async()=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));try{
    const data=resolve(root,'data');await mkdir(data);const db=new PanelDatabase(resolve(data,'panel.sqlite')),bucket=new PrivateBucket(resolve(data,'uploads')),id=randomUUID(),bytes=Buffer.from('SYNTHETIC PAYMENT ORIGINAL'),hash=createHash('sha256').update(bytes).digest('hex');await db.prepare('CREATE TABLE assets(id TEXT,hash TEXT)').run();await db.prepare('CREATE TABLE payment_documents(asset_id TEXT,hash TEXT)').run();await db.prepare('INSERT INTO payment_documents VALUES(?,?)').bind(id,hash).run();
    if(failure!=='missing')await bucket.put(id,failure==='corrupt'?Buffer.from('CORRUPTED'):bytes,{httpMetadata:{contentType:'application/pdf'}});if(failure==='conflicting')await db.prepare('INSERT INTO assets VALUES(?,?)').bind(id,'0'.repeat(64)).run();
    await assert.rejects(backupData(data,resolve(root,'backups')),failure==='missing'?/ENOENT/:/Prüfsumme/);db.close();const names=await readdir(resolve(root,'backups'));assert.ok(names.length>0&&names.every(name=>name.endsWith('.incomplete')));
  }finally{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});}
});

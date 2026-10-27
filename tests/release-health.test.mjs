import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,cp,mkdir,mkdtemp,readdir,realpath,rm,symlink,unlink,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PanelDatabase} from '../server/storage.mjs';
import {digest} from '../server/auth.mjs';

const source=fileURLToPath(new URL('../',import.meta.url));
const origin='https://panel.example.invalid',commit='a1'.repeat(20),forged='f0'.repeat(20);
async function fixture(t){
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-release-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
async function release(root,name,manifest){
  const directory=resolve(root,name);
  await mkdir(resolve(directory,'server'),{recursive:true});await mkdir(resolve(directory,'dist'));
  await symlink(resolve(source,'src'),resolve(directory,'src'),process.platform==='win32'?'junction':'dir');
  await symlink(resolve(source,'dist/runtime'),resolve(directory,'dist/runtime'),process.platform==='win32'?'junction':'dir');
  await symlink(resolve(source,'node_modules'),resolve(directory,'node_modules'),process.platform==='win32'?'junction':'dir');
  for(const name of await readdir(resolve(source,'server'))){
    const target=resolve(directory,'server',name),original=resolve(source,'server',name);
    if(process.platform==='win32'||['application.mjs','release.mjs'].includes(name))await copyFile(original,target);
    else await symlink(original,target);
  }
  if(manifest!==undefined)await writeFile(resolve(directory,'dist/release.json'),manifest);
  return directory;
}
async function application(t,directory){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('shell')},PANEL_COMMIT:forged,RELEASE_COMMIT:forged,GITHUB_SHA:forged};
  t.after(()=>env.DB.close());
  const {createApplication}=await import(pathToFileURL(resolve(await realpath(directory),'server/application.mjs')).href);
  return createApplication(env);
}
function health(app){return app.fetch(new Request(origin+'/healthz?commit='+forged,{headers:{'X-Panel-Commit':forged,'oai-authenticated-user-email':'owner@example.invalid'}}));}

test('public health reports only the full commit from its packaged release',async t=>{
  const root=await fixture(t),directory=await release(root,'release-a',JSON.stringify({commit,createdAt:'2026-10-18T00:00:00Z',secret:'synthetic-secret'}));
  const app=await application(t,directory),response=await health(app);
  assert.equal(response.status,200);assert.equal(await response.text(),'ok');
  assert.equal(response.headers.get('X-Panel-Commit'),commit);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await app.fetch(new Request('https://evil.example.invalid/healthz'))).status,400);
});

test('health keeps the loaded release when current changes or its manifest is replaced',async t=>{
  const root=await fixture(t),nextCommit='b2'.repeat(20);
  const first=await release(root,'release-a',JSON.stringify({commit}));
  const next=await release(root,'release-b',JSON.stringify({commit:nextCommit}));
  const current=resolve(root,'current'),linkType=process.platform==='win32'?'junction':'dir';await symlink(first,current,linkType);
  const oldApp=await application(t,current);
  await unlink(current);await symlink(next,current,linkType);
  await writeFile(resolve(first,'dist/release.json'),JSON.stringify({commit:forged}));
  assert.equal((await health(oldApp)).headers.get('X-Panel-Commit'),commit);
  const newApp=await application(t,current);
  assert.equal((await health(newApp)).headers.get('X-Panel-Commit'),nextCommit);
});

test('health omits commit proof for an absent or invalid release manifest',async t=>{
  const root=await fixture(t);
  const cases=[undefined,'not json','null','{}',JSON.stringify({commit:'abc1234'}),JSON.stringify({commit:forged+'0'}),JSON.stringify({commit:'A'.repeat(40)}),JSON.stringify({commit:42}),JSON.stringify({commit:forged+'\r\nX-Secret: synthetic'})];
  for(const [index,manifest] of cases.entries())await t.test('manifest '+index,async t=>{
    const app=await application(t,await release(root,'invalid-'+index,manifest)),response=await health(app);
    assert.equal(response.status,200);assert.equal(await response.text(),'ok');
    assert.equal(response.headers.get('X-Panel-Commit'),null);
  });
});

test('production release imports without a project node_modules directory',async t=>{
  const root=await fixture(t);
  for(const name of ['src','server','dist'])await cp(resolve(source,name),resolve(root,name),{recursive:true});
  await writeFile(resolve(root,'package.json'),JSON.stringify({type:'module'}));
  const program="await import('./server/application.mjs');const {ExcelJS}=await import('./dist/runtime/exceljs.mjs');if(!new ExcelJS.Workbook())throw new Error('Excel-Laufzeit fehlt.');console.log('Release-Laufzeit eigenständig');";
  const result=spawnSync(process.execPath,['--input-type=module','--eval',program],{cwd:root,encoding:'utf8',env:{...process.env,NODE_PATH:''},timeout:30000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/Release-Laufzeit eigenständig/);
});

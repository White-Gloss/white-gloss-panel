import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const source=fileURLToPath(new URL('../scripts/deploy-ionos.sh',import.meta.url));
const previous='a1'.repeat(20),privateKey='synthetic-private-key-do-not-print',knownHosts='synthetic-known-hosts-do-not-print';
// These executables model external tools only; the deployment script itself runs unchanged.
const boundary=String.raw`
const fs=require('node:fs'),path=require('node:path');
const env=process.env,args=process.argv.slice(2),tool=path.basename(process.argv[1]);
let operation=tool;
if(tool==='ssh')operation=args.includes('install')?'install':'status';
if(tool==='node')operation='package';
if(tool==='curl')operation=new URL(args.at(-1)).pathname;
fs.appendFileSync(env.TEST_EVENTS,JSON.stringify({tool,operation})+'\n');
if(tool==='gh')process.stdout.write(env.TEST_COMMIT+'\n');
if(tool==='node')fs.writeFileSync(args[1],'synthetic release archive');
if(tool==='ssh'&&operation==='status'){
  if(env.TEST_STATUS_FAILURE==='true')process.exit(27);
  const count=fs.existsSync(env.TEST_COUNTER)?Number(fs.readFileSync(env.TEST_COUNTER,'utf8')):0;
  fs.writeFileSync(env.TEST_COUNTER,String(count+1));
  process.stdout.write((count===0?env.TEST_PREVIOUS:env.TEST_COMMIT)+'\n');
}
if(tool==='ssh'&&operation==='install'&&env.TEST_INSTALL_FAILURE==='true')process.exit(28);
if(tool==='curl'){
  const output=args[args.indexOf('--output')+1];
  if(operation==='/healthz'){
    fs.writeFileSync(output,'ok');
    fs.writeFileSync(args[args.indexOf('--dump-header')+1],'HTTP/1.1 200 OK\r\nX-Panel-Commit: '+(env.TEST_LIVE_COMMIT||env.TEST_COMMIT)+'\r\n\r\n');
  }else if(operation==='/auth/login')fs.writeFileSync(output,'White Gloss');
  else if(operation==='/app.js')fs.writeFileSync(output,'synthetic app');
  else process.exit(99);
}
`;
async function fixture(t){
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-deploy-test-')),repo=resolve(root,'repo'),bin=resolve(root,'bin');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(resolve(repo,'scripts'),{recursive:true});await mkdir(resolve(repo,'dist/client'),{recursive:true});await mkdir(bin);
  await copyFile(source,resolve(repo,'scripts/deploy-ionos.sh'));
  await writeFile(resolve(repo,'scripts/package-ionos.mjs'),'// Replaced only at the external node boundary.\n');
  await writeFile(resolve(repo,'dist/client/app.js'),'synthetic app');
  for(const name of ['gh','node','ssh','scp','curl'])await writeFile(resolve(bin,name),'#!'+process.execPath+'\n'+boundary,{mode:0o700});
  const gitEnv={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'};
  const git=(...args)=>execFileSync('git',args,{cwd:repo,env:gitEnv,encoding:'utf8'}).trim();
  git('init','--quiet');git('add','.');git('-c','user.name=Synthetic Test','-c','user.email=deploy@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Synthetic deployment fixture');
  const commit=git('rev-parse','HEAD');
  const env={...gitEnv,PATH:bin+':'+process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'White-Gloss/white-gloss-panel',GITHUB_REF:'refs/heads/main',GITHUB_SHA:commit,GITHUB_STEP_SUMMARY:resolve(root,'summary'),PANEL_IONOS_HOST:'217.154.124.239',PANEL_IONOS_PORT:'22',PANEL_IONOS_SSH_KEY:privateKey,PANEL_IONOS_KNOWN_HOSTS:knownHosts,TEST_COMMIT:commit,TEST_PREVIOUS:previous,TEST_EVENTS:resolve(root,'events'),TEST_COUNTER:resolve(root,'counter')};
  return {root,repo,env,commit};
}
async function run(f,overrides={}){
  const result=spawnSync('bash',['scripts/deploy-ionos.sh'],{cwd:f.repo,env:{...f.env,...overrides},encoding:'utf8',timeout:10000});
  assert.ifError(result.error);
  const output=result.stdout+result.stderr;
  const events=(await readFile(f.env.TEST_EVENTS,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const summary=await readFile(f.env.GITHUB_STEP_SUMMARY,'utf8').catch(()=>'');
  assert.ok(!output.includes(privateKey));assert.ok(!output.includes(knownHosts));
  return {...result,output,events,summary};
}
function failed(result){assert.notEqual(result.status,0);assert.doesNotMatch(result.output,/IONOS-Panel veröffentlicht und über HTTPS geprüft/);assert.equal(result.summary,'');}

test('deployment stops before external calls when any required secret is missing',async t=>{
  for(const name of ['PANEL_IONOS_HOST','PANEL_IONOS_PORT','PANEL_IONOS_SSH_KEY','PANEL_IONOS_KNOWN_HOSTS'])await t.test(name,async t=>{
    const result=await run(await fixture(t),{[name]:''});failed(result);assert.deepEqual(result.events,[]);assert.ok(result.output.includes(name));
  });
});

test('deployment rejects an unexpected host, invalid port or mismatched commit without printing their values',async t=>{
  for(const [name,value] of [['PANEL_IONOS_HOST','synthetic-private-target.invalid'],['PANEL_IONOS_PORT','65536'],['PANEL_IONOS_PORT','22;synthetic-command'],['GITHUB_SHA','f0'.repeat(20)]])await t.test(name+'='+value,async t=>{
    const result=await run(await fixture(t),{[name]:value});failed(result);assert.deepEqual(result.events,[]);assert.ok(!result.output.includes(value));
  });
});

test('failed or invalid remote status prevents packaging, upload and activation',async t=>{
  for(const overrides of [{TEST_STATUS_FAILURE:'true'},{TEST_PREVIOUS:'untrusted status'}])await t.test(JSON.stringify(overrides),async t=>{
    const result=await run(await fixture(t),overrides);failed(result);
    assert.equal(result.events.filter(event=>event.tool==='ssh').length,1);
    assert.ok(!result.events.some(event=>['node','scp','curl'].includes(event.tool)||event.operation==='install'));
  });
});

test('failed installation cannot report a successful live release or run HTTP checks',async t=>{
  const result=await run(await fixture(t),{TEST_INSTALL_FAILURE:'true'});failed(result);
  assert.equal(result.status,28);assert.ok(result.events.some(event=>event.tool==='scp'));
  assert.ok(result.events.some(event=>event.operation==='install'));assert.ok(!result.events.some(event=>event.tool==='curl'));
  assert.equal(result.events.filter(event=>event.operation==='status').length,1);
});

test('a different public commit fails even after successful installation and remote status',async t=>{
  const result=await run(await fixture(t),{TEST_LIVE_COMMIT:previous});failed(result);
  assert.match(result.output,/öffentliche HTTPS-Antwort bestätigt den Release-Commit nicht/);
  assert.equal(result.events.filter(event=>event.operation==='status').length,2);
  assert.deepEqual(result.events.filter(event=>event.tool==='curl').map(event=>event.operation),['/healthz']);
});

test('deployment reports success only after matching remote and public release checks',async t=>{
  const f=await fixture(t),result=await run(f);
  assert.equal(result.status,0,result.output);assert.ok(result.output.includes('IONOS-Panel veröffentlicht und über HTTPS geprüft: '+f.commit));
  assert.ok(result.summary.includes(f.commit));
  assert.deepEqual(result.events.filter(event=>event.tool==='curl').map(event=>event.operation),['/healthz','/auth/login','/app.js']);
});

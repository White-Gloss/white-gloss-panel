import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod,mkdir,mkdtemp,readFile,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const installer=fileURLToPath(new URL('../deploy/install-panel.sh',import.meta.url));
const helper=fileURLToPath(new URL('../deploy/panel-release.sh',import.meta.url));
// These fixtures execute Linux shell installers; the real GitHub runner keeps full coverage.
const shellTest=process.platform==='linux'?test:test.skip;
const commit='a1'.repeat(20),hash='b2'.repeat(32);
const panelUid=process.getuid?.()??65534,panelGid=process.getgid?.()??65534;
function shell(script,args=[]){return spawnSync('/bin/bash',['-c',script,'synthetic-deployment-test',...args],{encoding:'utf8'});}
async function fixture(t){const path=await mkdtemp(resolve(tmpdir(),'white-gloss-installer-test-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}

shellTest('deployment shell files parse without executing a server or privileged command',()=>{
  for(const path of [installer,helper]){const result=spawnSync('/bin/bash',['-n',path],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
});

shellTest('release helper accepts only the commit-bound upload path and full lowercase hashes',()=>{
  const valid=['/home/white-gloss-ci/white-gloss-panel-'+commit+'.tar.gz',hash,commit];
  const cases=[{args:valid,valid:true},{args:valid.slice(1)},{args:[...valid,'extra']},{args:['/tmp/white-gloss-panel-'+commit+'.tar.gz',hash,commit]},{args:[valid[0]+'/../../installer',hash,commit]},{args:[valid[0],hash.toUpperCase(),commit]},{args:[valid[0],hash,commit+'\n']},{args:[valid[0],hash,'$(touch /tmp/never-execute)']}];
  for(const entry of cases){const result=shell('source "$1"; shift; valid_install_arguments "$@"',[helper,...entry.args]);assert.equal(result.status===0,entry.valid===true,JSON.stringify(entry.args));assert.equal(result.stdout,'');}
});

shellTest('root installer guard rejects a writable or caller-owned tree and symlink',async t=>{
  const root=await fixture(t),file=resolve(root,'installer.sh'),link=resolve(root,'installer-link.sh');
  await writeFile(file,'synthetic fixture',{mode:0o666});await symlink(file,link);
  for(const path of [file,link]){const result=shell('source "$1"; root_protected_path "$2" file',[helper,path]);assert.notEqual(result.status,0);}
  const protectedFile=shell('source "$1"; root_protected_path /etc/passwd file',[helper]);
  assert.equal(protectedFile.status,0,protectedFile.stderr);
});

shellTest('every privileged service template, initialization script and existing configuration must be protected',()=>{
  const names=['install-panel.sh','prepare-environment.mjs','white-gloss-panel.service','white-gloss-panel-maintenance.service','white-gloss-panel-maintenance.timer','white-gloss-panel-backup.service','white-gloss-panel-backup.timer','white-gloss-panel.caddy'];
  const paths=[...names.map(name=>'/usr/local/lib/white-gloss-panel/'+name),'/etc/white-gloss-panel/environment'];
  for(const path of paths){
    const result=shell(`source "$1"
synthetic_bad_path=$2
root_protected_path() { [[ $1 != "$synthetic_bad_path" ]]; }
validate_release_assets /usr/local/lib/white-gloss-panel`,[helper,path]);
    assert.notEqual(result.status,0,path);
  }
  const result=shell(`source "$1"
root_protected_path() { printf '%s\\n' "$1"; }
validate_release_assets /usr/local/lib/white-gloss-panel`,[helper]);
  assert.equal(result.status,0,result.stderr);assert.deepEqual(result.stdout.trim().split('\n'),paths);
});

shellTest('service installation takes all privileged templates from the administrator directory',()=>{
  const result=shell(`source "$1"
installer_directory=/synthetic/administrator
target=/synthetic/uploaded-release
previous=/synthetic/previous-release
install() { printf '%s\\n' "$3"; }
install_trusted_service_templates`,[installer]);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'),['white-gloss-panel.service','white-gloss-panel-maintenance.service','white-gloss-panel-maintenance.timer','white-gloss-panel-backup.service','white-gloss-panel-backup.timer','white-gloss-panel.caddy'].map(name=>'/synthetic/administrator/'+name));
});

shellTest('privileged Python ignores modules in the caller directory',async t=>{
  const root=await fixture(t),marker=resolve(root,'unsafe-import'),archive=resolve(root,'empty.tar.gz');
  const payload='from pathlib import Path\nPath('+JSON.stringify(marker)+').write_text("unexpected privileged import")\nraise RuntimeError("caller module imported")\n';
  await writeFile(resolve(root,'pathlib.py'),payload);await writeFile(resolve(root,'tarfile.py'),payload);
  const prepared=spawnSync('/usr/bin/python3',['-I','-c','import tarfile,sys; tarfile.open(sys.argv[1],"w:gz").close()',archive],{encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);
  for(const [script,command,args] of [[helper,'root_protected_path /etc/passwd file',[]],[installer,'validate_release_archive "$2"',[archive]]]){
    const result=spawnSync('/bin/bash',['-c','source "$1"; '+command,'synthetic-python-import-test',script,...args],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
  await assert.rejects(readFile(marker),{code:'ENOENT'});
});

shellTest('panel data directories are created and repaired through directory descriptors',async t=>{
  const root=await fixture(t),uid=panelUid,gid=panelGid;
  const prepare=()=>shell('source "$1"; prepare_panel_data_directories "$2" "$3" "$4"',[installer,root,String(uid),String(gid)]);
  let result=prepare();assert.equal(result.status,0,result.stderr);
  const paths=['white-gloss-panel','white-gloss-panel/data','white-gloss-panel/backups'].map(name=>resolve(root,name));
  for(const path of paths){let info=await stat(path);assert.equal(info.uid,uid);assert.equal(info.gid,gid);assert.equal(info.mode&0o777,0o700);await chmod(path,0o755);}
  result=prepare();assert.equal(result.status,0,result.stderr);
  for(const path of paths)assert.equal((await stat(path)).mode&0o777,0o700);
});

shellTest('panel data symlinks never change the outside directory or its contents',async t=>{
  for(const child of ['base','data','backups'])await t.test(child,async t=>{
    const root=await fixture(t),outside=resolve(root,'outside'),marker=resolve(outside,'untouched'),base=resolve(root,'white-gloss-panel');
    await mkdir(outside,{mode:0o750});await writeFile(marker,'outside fixture',{mode:0o640});
    if(child==='base')await symlink(outside,base);
    else{await mkdir(base,{mode:0o700});await symlink(outside,resolve(base,child));}
    const before=await stat(outside),beforeMarker=await stat(marker);
    const result=shell('source "$1"; prepare_panel_data_directories "$2" "$3" "$4"',[installer,root,String(panelUid),String(panelGid)]);
    assert.notEqual(result.status,0);
    const after=await stat(outside),afterMarker=await stat(marker);
    for(const key of ['uid','gid','mode']){assert.equal(after[key],before[key],key);assert.equal(afterMarker[key],beforeMarker[key],key);}
    assert.equal(await readFile(marker,'utf8'),'outside fixture');
  });
});

shellTest('panel data preparation refuses uid zero and writable parent directories',async t=>{
  const root=await fixture(t);
  let result=shell('source "$1"; prepare_panel_data_directories "$2" 0 "$3"',[installer,root,String(panelGid)]);assert.notEqual(result.status,0);
  await chmod(root,0o777);
  result=shell('source "$1"; prepare_panel_data_directories "$2" "$3" "$4"',[installer,root,String(panelUid),String(panelGid)]);assert.notEqual(result.status,0);
});

shellTest('only owned temporary release link names with the expected destination are removed',async t=>{
  const root=await fixture(t),next=resolve(root,'current.next'),other=resolve(root,'current.rollback');
  await symlink('/srv/white-gloss-panel/releases/'+commit,next);
  let result=shell('source "$1"; clear_release_link "$2"',[installer,next]);assert.equal(result.status,0,result.stderr);
  await writeFile(next,'must survive');
  result=shell('source "$1"; clear_release_link "$2"',[installer,next]);assert.notEqual(result.status,0);assert.equal(await readFile(next,'utf8'),'must survive');
  await symlink(next,other);
  result=shell('source "$1"; clear_release_link "$2"',[installer,other]);assert.notEqual(result.status,0);assert.equal(await readFile(other,'utf8'),'must survive');
  const unrelated=resolve(root,'unrelated');await symlink('/srv/white-gloss-panel/releases/'+commit,unrelated);
  result=shell('source "$1"; clear_release_link "$2"',[installer,unrelated]);assert.notEqual(result.status,0);
});

shellTest('a failed pre-activation backup restores timer activity and enablement and preserves its failure',async t=>{
  const root=await fixture(t),log=resolve(root,'commands');
  const result=shell(`source "$1"
log=$2
systemctl() {
    printf '%s\\n' "$*" >> "$log"
    if [[ $1 == start && $2 == white-gloss-panel-backup.service ]]; then return 7; fi
    [[ $1 != disable ]]
}
rollback() { printf 'unexpected rollback\\n' >> "$log"; }
timer_units=(synthetic-maintenance.timer synthetic-backup.timer)
timer_was_enabled=(true false)
timer_was_active=(true false)
timers_paused=true
activation_started=false
previous=/srv/white-gloss-panel/releases/${commit}
trap 'finish_install "$?"' EXIT
pause_panel_jobs`,[installer,log]);
  assert.equal(result.status,7,result.stderr);
  assert.deepEqual((await readFile(log,'utf8')).trim().split('\n'),['stop synthetic-maintenance.timer synthetic-backup.timer','stop white-gloss-panel-maintenance.service white-gloss-panel-backup.service','start white-gloss-panel-backup.service','enable synthetic-maintenance.timer','start synthetic-maintenance.timer','disable synthetic-backup.timer','stop synthetic-backup.timer']);
});

shellTest('first installation tolerates absent panel units without attempting an existing-release backup',()=>{
  const result=shell(`source "$1"
systemctl() { [[ $1 == stop ]] || exit 77; return 5; }
previous=''
timer_units=(synthetic-maintenance.timer synthetic-backup.timer)
pause_panel_jobs
printf 'first installation can continue\\n'`,[installer]);
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'first installation can continue\n');
});

shellTest('status never certifies a commit when a required service or timer is inactive',()=>{
  for(const failed of ['white-gloss-panel.service','white-gloss-panel-maintenance.timer','white-gloss-panel-backup.timer','white-gloss.service','caddy.service']){
    const result=shell(`source "$1"
synthetic_commit=$2
current_commit() { printf '%s\\n' "$synthetic_commit"; }
synthetic_failed=$3
systemctl() { [[ $3 != "$synthetic_failed" ]]; }
release_status`,[helper,commit,failed]);
    assert.notEqual(result.status,0,failed);assert.equal(result.stdout,'',failed);
  }
});

shellTest('an already active healthy commit is checked without running the installer again',()=>{
  const result=shell(`source "$1"
synthetic_commit=$2
id() { printf '0\\n'; }
uname() { printf 'Linux\\n'; }
acquire_release_lock() { :; }
release_status() { printf '%s\\n' "$synthetic_commit"; }
root_protected_path() { printf 'installer must not run\\n' >&2; return 1; }
panel_release install "/home/white-gloss-ci/white-gloss-panel-$synthetic_commit.tar.gz" "$3" "$synthetic_commit"`,[helper,commit,hash]);
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,commit+'\n');assert.equal(result.stderr,'');
});

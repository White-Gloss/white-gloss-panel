import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
for(const dir of ['src','public','scripts','tests'])for(const f of readdirSync(dir))if(/\.(mjs|js)$/.test(f)){const r=spawnSync(process.execPath,['--check',dir+'/'+f],{stdio:'inherit'});if(r.status)process.exit(r.status);}
console.log('Syntaxprüfung bestanden.');

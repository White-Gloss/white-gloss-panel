import {spawnSync} from 'node:child_process';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
const c=JSON.parse(input.trim());input='';
const token=c.token;const header='Authorization: Bearer '+token;
const gitEnv={...process.env,GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:header,GIT_CONFIG_KEY_1:'http.sslBackend',GIT_CONFIG_VALUE_1:'openssl',GIT_TERMINAL_PROMPT:'0'};
const r=spawnSync('git',['push',c.remote_url,'HEAD:refs/heads/'+c.branch],{encoding:'utf8',env:gitEnv});
const safe=s=>(s??'').replaceAll(token,'[redacted]').replaceAll(header,'[redacted]');
process.stdout.write(safe(r.stdout));process.stderr.write(safe(r.stderr));c.token='';process.exit(r.status??1);

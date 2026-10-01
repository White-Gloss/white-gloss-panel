import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/client',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const domain=readFileSync('src/domain.mjs','utf8').replace(/export /g,'');const schema=readFileSync('src/schema.mjs','utf8').replace(/export /g,'');const worker=readFileSync('src/worker.mjs','utf8').replace(/^import .*;\r?\n/gm,'');
writeFileSync('dist/server/index.js',domain+'\n'+schema+'\n'+worker);
for(const f of ['index.html','app.js','style.css','offer.js'])copyFileSync('public/'+f,'dist/client/'+f);
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log('Build abgeschlossen. Kein Server gestartet.');

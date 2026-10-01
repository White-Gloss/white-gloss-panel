import {mkdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/client',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const catalog=readFileSync('src/catalog.mjs','utf8').replace(/export /g,'');const domain=readFileSync('src/domain.mjs','utf8').replace(/export /g,'');const schema=readFileSync('src/schema.mjs','utf8').replace(/export /g,'');const worker=readFileSync('src/worker.mjs','utf8').replace(/^import .*;\r?\n/gm,'');
writeFileSync('dist/server/index.js',catalog+'\n'+domain+'\n'+schema+'\n'+worker);
for(const f of ['index.html','app.js','style.css','offer.js','manual.js'])copyFileSync('public/'+f,'dist/client/'+f);
copyFileSync('src/catalog.mjs','dist/client/catalog.mjs');
copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log('Build abgeschlossen. Kein Server gestartet.');

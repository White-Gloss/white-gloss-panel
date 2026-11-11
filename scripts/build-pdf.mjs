import {build} from 'esbuild';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const fonts=[
  ['plus-jakarta-sans-400.ttf','e95ab7d34d39526b395d11fd10dde35d11d29b2a49500cf66e4518f05822788c'],
  ['syne-700.ttf','828b08a1bada0118fcff388362cdd3b1c8f7d349449b641df1a338e8fc33b2a6'],
  ['syne-800.ttf','e97365a6da005eeeb955ecc075c666374aa0e3449a9822bc8686da19969f01dd'],
  ['NotoSans-fallback.ttf','b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5']
];
for(const [name,expected] of fonts){
  const hash=createHash('sha256').update(await readFile('assets/fonts/'+name)).digest('hex');
  if(hash!==expected)throw Error('PDF-Schrift stimmt nicht mit dem geprüften Stand überein: '+name);
}
await mkdir('dist/pdf',{recursive:true});
await build({absWorkingDir:process.cwd(),entryPoints:['./scripts/pdf-library.mjs'],tsconfigRaw:{},bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/pdf/library.mjs',minify:true,legalComments:'linked'});
for(const [name] of fonts)await copyFile('assets/fonts/'+name,'dist/pdf/'+name);
for(const name of ['syne-OFL.txt','plus-jakarta-sans-OFL.txt','NotoSans-fallback-OFL.txt'])await copyFile('assets/fonts/'+name,'dist/pdf/'+name);
console.log('PDF-Bibliothek und Schrift paketiert. Kein Server gestartet.');

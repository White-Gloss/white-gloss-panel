import {build} from 'esbuild';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=createHash('sha256').update(await readFile('assets/fonts/NotoSans.ttf')).digest('hex');
if(hash!=='b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5')throw Error('PDF-Schrift stimmt nicht mit dem geprüften Stand überein.');
await mkdir('dist/pdf',{recursive:true});
await build({absWorkingDir:process.cwd(),entryPoints:['./scripts/pdf-library.mjs'],tsconfigRaw:{},bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/pdf/library.mjs',minify:true,legalComments:'linked'});
await copyFile('assets/fonts/NotoSans.ttf','dist/pdf/NotoSans.ttf');await copyFile('assets/fonts/OFL.txt','dist/pdf/OFL.txt');
console.log('PDF-Bibliothek und Schrift paketiert. Kein Server gestartet.');

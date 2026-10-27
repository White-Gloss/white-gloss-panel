import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';

await mkdir('dist/runtime',{recursive:true});
await build({
  absWorkingDir:process.cwd(),
  entryPoints:{mailbox:'./scripts/runtime-mailbox.mjs',push:'./scripts/runtime-push.mjs',exceljs:'./scripts/runtime-exceljs.mjs'},
  outdir:'dist/runtime',outExtension:{'.js':'.mjs'},tsconfigRaw:{},bundle:true,
  platform:'node',target:'node22',format:'esm',minify:true,legalComments:'linked',
  banner:{js:"import {createRequire as __wgCreateRequire} from 'node:module';const require=__wgCreateRequire(import.meta.url);"}
});
console.log('Laufzeitbibliotheken paketiert. Kein Server gestartet.');

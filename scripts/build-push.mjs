import {build} from 'esbuild';
await build({stdin:{contents:"export {default} from 'web-push';",resolveDir:process.cwd()},outfile:'dist/mcp/web-push.mjs',bundle:true,platform:'node',target:'node22',format:'esm',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});

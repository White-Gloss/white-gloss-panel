import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist/mcp',{recursive:true});
await build({entryPoints:['scripts/agent-library.mjs'],tsconfigRaw:{},bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/mcp/sdk.mjs',legalComments:'linked',banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"}});
await writeFile('dist/mcp/sdk.d.mts',"export {McpServer,createMcpHandler,fromJsonSchema} from '@modelcontextprotocol/server';\n");
console.log('MCP-Bibliothek paketiert. Kein Server gestartet.');

// The approved IONOS archive includes the SDK bundle, without node_modules.
/** @type {typeof import('@modelcontextprotocol/server')} */
const sdk=await import(new URL('../dist/mcp/sdk.mjs',import.meta.url).href);
export const {McpServer,createMcpHandler,fromJsonSchema}=sdk;

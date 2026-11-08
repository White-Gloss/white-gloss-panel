import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMcp} from '../server/mcp.mjs';
test('disabled MCP fails closed without entering panel routes',async()=>{
  const r=await handleMcp({PANEL_ORIGIN:'https://panel.example'},new Request('https://panel.example/mcp'));
  assert.equal(r?.status,404);
});

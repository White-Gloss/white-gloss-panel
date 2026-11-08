import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {handleMcp} from '../server/mcp.mjs';
export const origin='https://panel.example',redirect='https://chatgpt.com/connector/oauth/test';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
export async function fixture(t){
  const env={PANEL_ORIGIN:origin,PANEL_MCP_ENABLED:'true',PANEL_MCP_CLIENT_ID:'test-client',PANEL_MCP_REDIRECT_URI:redirect,OWNER_EMAIL_SHA256:hash('owner@example.test'),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:')};
  t.after(()=>env.DB.close());
  const call=(path,body=null,headers={})=>handleMcp(env,new Request(origin+path,{method:body===null?'GET':'POST',headers:body===null?headers:{'content-type':'application/x-www-form-urlencoded',...headers},...(body===null?{}:{body:typeof body==='string'?body:new URLSearchParams(body).toString()})}),async request=>request.headers.get('cookie')==='owner'?'owner@example.test':request.headers.get('cookie')==='customer'?'customer@example.test':null);
  const params={response_type:'code',client_id:'test-client',redirect_uri:redirect,scope:'panel:read',state:'state-value',resource:origin+'/mcp',code_challenge:challenge,code_challenge_method:'S256'};
  const consent=async()=>{const r=await call('/auth/mcp/authorize?'+new URLSearchParams(params),null,{cookie:'owner'});assert.equal(r.status,200);const html=await r.text();return html.match(/name="consent" value="([^"]+)"/)?.[1];};
  const grant=async()=>{const consentToken=await consent();assert.ok(consentToken);const r=await call('/auth/mcp/authorize',{consent:consentToken,decision:'allow'},{cookie:'owner',origin});assert.equal(r.status,303);const url=new URL(r.headers.get('location'));assert.equal(url.searchParams.get('state'),'state-value');assert.equal(url.searchParams.get('iss'),origin);return url.searchParams.get('code');};
  const exchange=code=>call('/auth/mcp/token',{grant_type:'authorization_code',client_id:'test-client',redirect_uri:redirect,resource:origin+'/mcp',code,code_verifier:verifier});
  return {env,call,params,consent,grant,exchange};
}


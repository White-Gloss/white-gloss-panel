import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../../server/storage.mjs';
import {createApplication} from '../../server/application.mjs';
import {digest,issueCustomerAccess} from '../../server/auth.mjs';
import {getOrder,protect,setting} from '../../src/worker.mjs';
import {COMPANY} from '../../src/company.mjs';
import {signatureBytes,syntheticSignature} from './signature.mjs';
import {createTestLetterhead} from './letterhead.mjs';

export const origin='https://panel.example.invalid',owner=COMPANY.email,customer='customer@example.invalid',foreign='foreign@example.invalid';
export {COMPANY,syntheticSignature,signatureBytes};
export async function ok(pending,status=200){const response=await pending,data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}

/** Every record and file is synthetic and remains in memory; outbound fetch is blocked. */
export async function handoverFixture(t,{withTemplate=true}={}){
  t.mock.method(globalThis,'fetch',()=>{throw Error('Unexpected external call from an isolated handover test');});
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{
    async put(id,bytes,options={}){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},
    async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}
  },ASSETS:{fetch:async()=>new Response('<html>synthetic application shell</html>',{headers:{'Content-Type':'text/html'}})}};
  t.after(()=>env.DB.close());const app=await createApplication(env),cookies={};
  for(const [role,email] of Object.entries({owner,customer,foreign})){
    const raw=randomBytes(32).toString('hex');cookies[role]='__Host-wg-session='+raw;
    await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+86400000,Date.now()).run();
  }
  const template=withTemplate?await createTestLetterhead(env):null;
  function req(path,input,role='owner',extraHeaders={}){return app.fetch(new Request(origin+path,{
    method:input===undefined?'GET':'POST',headers:{cookie:cookies[role]??role,...(input===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extraHeaders},
    body:input===undefined?undefined:JSON.stringify(input)
  }));}
  async function add(overrides={}){
    const id=randomUUID(),now=new Date().toISOString(),offerToken=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+86400000).toISOString();
    const order={id,wg:'TEST-'+id,version:1,status:'Termin verbindlich',synthetic:true,createdAt:now,source:{name:'TEST · Kundin Şahin',email:customer,vehicle:'TEST · Fahrzeug'},offer:{services:'TEST · Innenreinigung',totalCents:10000,expiresAt},offerToken,appointment:{start:'2026-10-09T10:00:00Z',end:'2026-10-09T12:00:00Z',location:'TEST · Betrieb'},acceptance:{at:now},notes:[{note:'PRIVATE OPERATOR NOTE'}],payments:[],...overrides};
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),now,'test','fixture',Number(order.synthetic)).run();
    await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(offerToken),id,expiresAt).run();return order;
  }
  const current=order=>getOrder(env,typeof order==='string'?order:order.id);
  async function update(order,changes){const fresh=await current(order),next={...fresh,...changes};await env.DB.prepare("UPDATE orders SET data=?,status=?,version=version+1,action='Synthetic fixture update' WHERE id=? AND version=?").bind(JSON.stringify(next),next.status,next.id,fresh.version).run();return current(next);}
  async function upload(order,kind='photo',params=''){
    return (await ok(app.fetch(new Request(origin+'/api/upload/'+order.id+'?kind='+kind+params,{method:'POST',headers:{cookie:cookies.owner,Origin:origin,'Content-Type':'image/png'},body:signatureBytes()})))).id;
  }
  async function protocol(order,kind='intake',overrides={}){
    const fresh=await current(order),photos=[await upload(fresh)],p={kind,plate:'TEST-WG-1',at:'2026-10-09T14:00',location:'TEST · Übergabeort',condition:'TEST · dokumentierter Zustand',customerName:fresh.source.name,operatorName:COMPANY.owner,mileage:12345,keys:1,delivery:'Abholung',photos};
    if(kind==='return')Object.assign(p,{workComplete:true,services:'TEST · Innenreinigung abgeschlossen',keyLocation:'TEST · vereinbartes Schlüsselfach',keyPhoto:await upload(fresh)});
    return {...p,...overrides};
  }
  async function prepare(order,kind='intake',details){const fresh=await current(order),draft=await ok(req('/api/handover/prepare',{id:fresh.id,version:fresh.version,kind,protocol:details??await protocol(fresh,kind)})),signature=await upload(fresh,'signature','&draft='+draft.id+'&hash='+draft.hash);return {order:fresh,draft,signature};}
  async function publish(order,kind='intake',details){const prepared=await prepare(order,kind,details);return ok(req('/api/handover/publish',{id:prepared.order.id,version:prepared.order.version,draftId:prepared.draft.id,snapshotHash:prepared.draft.hash,operatorSignature:prepared.signature,operatorConfirmed:true}));}
  async function displayed(order,kind='intake',role='customer'){return ok(req('/api/handover/'+order.handovers[kind].token,undefined,role));}
  async function complete(order,kind='intake',role='customer'){const view=await displayed(order,kind,role),response=await ok(req('/api/handover/'+order.handovers[kind].token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},role));return {response,order:await current(order),view};}
  async function onsite(order,kind='intake',details){const fresh=await current(order),p=details??await protocol(fresh,kind);delete p.keyLocation;delete p.keyPhoto;const draft=await ok(req('/api/protocol/prepare',{id:fresh.id,version:fresh.version,kind,protocol:p})),params='&draft='+draft.id+'&hash='+draft.hash,a=await upload(fresh,'signature',params),b=await upload(fresh,'signature',params);return ok(req('/api/action',{id:fresh.id,version:fresh.version,action:kind,input:{draftId:draft.id,snapshotHash:draft.hash,customerSignature:a,operatorSignature:b,signaturesConfirmed:true}}));}
  async function mail(){await setting(env,'resendKey',await protect(env,'TEST synthetic resend key'));await setting(env,'sender','test@example.invalid');await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);}
  async function activate(order){const access=await issueCustomerAccess(env,order.source.email,'/angebot/'+order.offerToken),token=new URL(access.url).searchParams.get('token'),response=await req('/auth/redeem',{token,pin:access.pin},'');assert.equal(response.status,200,await response.clone().text());return {pin:access.pin,cookie:response.headers.get('set-cookie').split(';')[0],token};}
  return {env,app,files,cookies,template,req,add,current,update,upload,protocol,prepare,publish,displayed,complete,onsite,mail,activate};
}

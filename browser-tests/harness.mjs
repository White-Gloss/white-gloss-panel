// Run real layout checks only on the genuine Linux GitHub runner. No listener or website server.
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {chatNotificationsSettled} from '../server/chat.mjs';

export const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
export async function browserFixture(t,{viewport={width:1280,height:720},identity=owner}={}){
  if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_OS!=='Linux')throw Error('Browserregressionen ausschließlich auf dem echten Linux-GitHub-Runner ausführen. Lokal nur veröffentlichte IONOS-Seiten prüfen.');
  t.mock.method(globalThis,'fetch',async()=>{throw Error('External provider requests are forbidden in browser fixtures.');});
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets(resolve('dist/client')),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}}};
  const app=await createApplication(env),raw=randomBytes(32).toString('hex');
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),identity,Date.now()+3600000,Date.now()).run();
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport,serviceWorkers:'block',reducedMotion:'reduce'}),errors=[],requests=[];
  await context.addCookies([{name:'__Host-wg-session',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin){errors.push('Unexpected external browser request: '+url.origin);await route.abort();return;}
    try{
      const headers=new Headers(await request.allHeaders());headers.set('cookie','__Host-wg-session='+raw);
      if(!['GET','HEAD'].includes(request.method()))headers.set('origin',origin);
      // Avoid long-polling against a fixture which has no background process.
      if(url.searchParams.has('wait'))url.searchParams.set('wait','0');
      const response=await app.fetch(new Request(url,{method:request.method(),headers,body:request.postDataBuffer()??undefined}));
      requests.push({path:url.pathname,method:request.method(),status:response.status});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }catch(error){errors.push(String(error));await route.abort().catch(()=>{});}
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  t.after(async()=>{try{await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/'+t.name.replace(/[^a-z0-9_-]/gi,'-')+'.png',fullPage:true});}finally{await context.close();await browser.close();await chatNotificationsSettled();env.DB.close();}});
  const seedOrder=async(overrides={})=>{
    const id=randomUUID(),at=new Date().toISOString(),line={id:'package',kind:'package',catalogId:'premium',title:'Reinigung & Politur',description:'',amountCents:43625};
    const order={id,wg:'WG-'+id.slice(0,8),synthetic:false,status:'Angenommen',source:{name:'Erika Muster',email:customer,vehicle:'VW Golf',plate:'FDS-WG 1',packageId:'premium',classId:'suv'},assessment:{lines:[line],condition:'',totalCents:43625,pickupCents:0,pricesReviewed:true,services:''},offer:{lines:[line],totalCents:43625,pickupCents:0,services:''},acceptance:{at},appointment:{start:'2035-10-15T07:00:00.000Z',end:'2035-10-15T10:00:00.000Z',duration:180,delivery:'Kunde bringt',location:'Teststraße 1, Horb'},notes:[],payments:[],createdAt:at,updatedAt:at,...overrides};
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),at,'test','fixture',Number(order.synthetic)).run();return order;
  };
  const screenshot=async name=>{await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/'+name+'.png',fullPage:true});};
  return {env,app,page,context,files,errors,requests,seedOrder,screenshot};
}

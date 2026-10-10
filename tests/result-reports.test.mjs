import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {customerResultReports} from '../server/result-reports.mjs';

const owner='owner@example.invalid',customer='customer@example.invalid',foreign='foreign@example.invalid',origin='https://panel.example.invalid';
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,11).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async get(id){return files.has(id)?{body:files.get(id),httpMetadata:{contentType:'image/png'}}:null;},async put(id,bytes){files.set(id,bytes);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),cookies={};
  for(const [role,email] of Object.entries({owner,customer,foreign})){const raw=randomBytes(32).toString('hex');cookies[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+86400000,Date.now()).run();}
  const req=(path,data,role='owner',headers={})=>app.fetch(new Request(origin+path,{...(data?{method:'POST',body:JSON.stringify(data)}:{}),headers:{...(data?{origin,'Content-Type':'application/json'}:{}),cookie:cookies[role]??'',...headers}}));
  async function order(email=customer){const id=crypto.randomUUID(),o={id,wg:'TEST-'+id,version:1,status:'Erledigt',synthetic:true,source:{name:'TEST Kunde',email,vehicle:'TEST Fahrzeug',plate:'TEST 11'},notes:[{note:'INTERN NICHT FREIGEGEBEN'}],return:{services:'Original Rückgabeleistung',signaturesConfirmed:true}};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,synthetic,updated_at,actor,action) VALUES(?,?,?,?,?,?,?,?)').bind(id,o.wg,o.status,JSON.stringify(o),1,new Date().toISOString(),'test','fixture').run();return o;}
  async function asset(o,kind='photo'){const id=crypto.randomUUID(),bytes=await sharp({create:{width:100,height:60,channels:3,background:{r:220,g:100,b:30}}}).png().toBuffer();await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,o.id,kind,'image/png',digest(bytes),bytes.length,new Date().toISOString()).run();files.set(id,bytes);return id;}
  const o=await order(),a=await asset(o),b=await asset(o),url='/api/result-reports?id='+o.id;let version=0;
  await req(url);
  const mutation=async input=>{const r=await req(url,{version,orderVersion:1,...input});if(r.ok&&input.action!=='previewMask'){const d=await r.clone().json();version=d.version;}return r;};
  const save=extra=>mutation({action:'save',entries:[{assetId:a,phase:'before',template:'exterior',motif:'Front',customerVisible:true},{assetId:b,phase:'after',template:'exterior',motif:'Front',customerVisible:false}],completedServices:'TEST: Außenwäsche erledigt',completionConfirmed:true,...extra});
  const grant=(extra={})=>mutation({action:'grant',assetId:a,purpose:'Website',consentDate:'2026-01-02',evidence:'TEST separate ausdrückliche Bildfreigabe',explicitConsent:true,...extra});
  const preview=(extra={})=>mutation({action:'previewMask',assetId:a,rectangles:[{x:.2,y:.3,width:.5,height:.2}],...extra});
  return {files,env,req,order,asset,o,a,b,url,mutation,save,grant,preview};
}
async function success(response){assert.equal(response.status,200,await response.clone().text());return response.json();}

test('existing order preserves original data, associations and images; report remains internal until released',async t=>{
  const f=await fixture(t),before=await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(f.o.id).first(),original=Buffer.from(f.files.get(f.a));
  const saved=await success(await f.save());assert.equal(saved.version,1);assert.equal(saved.customerReleased,false);assert.ok(saved.vehicleId&&saved.customerId);assert.equal(saved.grants.length,0);
  assert.deepEqual(await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(f.o.id).first(),before);assert.deepEqual(f.files.get(f.a),original);
  const path='/api/customer/result-report?id='+f.o.id;assert.equal((await f.req(path,null,'customer')).status,404);assert.equal(await customerResultReports(f.env,f.o,customer),null);
  await success(await f.save({customerReleased:true,customerReleaseConfirmed:true}));const dto=await success(await f.req(path,null,'customer'));assert.equal(dto.entries.length,1);assert.equal(dto.entries[0].assetId,f.a);assert.equal(dto.entries[0].motif,'Front');assert.ok(!JSON.stringify(dto).includes('INTERN'));assert.equal(dto.grants,undefined);assert.equal(dto.customerId,undefined);
  assert.equal((await f.req(dto.entries[0].url,null,'customer')).status,200);assert.equal((await f.req('/api/customer/result-report/asset?id='+f.o.id+'&asset='+f.b,null,'customer')).status,404);
});
test('authentication, customer separation, origin, method and direct image ownership enforced',async t=>{
  const f=await fixture(t),other=await f.order(foreign),otherImage=await f.asset(other),signature=await f.asset(f.o,'signature');
  assert.equal((await f.req(f.url,null,'')).status,401);assert.equal((await f.req(f.url,null,'customer')).status,403);assert.equal((await f.req(f.url,{action:'save'},'owner',{origin:'https://attacker.invalid'})).status,403);
  for(const assetId of [otherImage,signature])assert.equal((await f.save({entries:[{assetId,phase:'before',template:'exterior',motif:'Front'}]})).status,404);
  await success(await f.save({customerReleased:true,customerReleaseConfirmed:true}));for(const suffix of ['','/pdf','/asset'])assert.equal((await f.req('/api/customer/result-report'+suffix+'?id='+f.o.id+'&asset='+f.a,null,'foreign')).status,404);
  assert.equal((await f.req('/api/customer/result-report?id='+f.o.id,{action:'save'},'customer')).status,405);
});
test('completed services and customer publication require explicit review; no protocol advertising consent',async t=>{
  const f=await fixture(t);assert.equal((await f.save({completionConfirmed:false})).status,400);assert.equal((await f.save({customerReleased:true})).status,400);
  assert.equal((await f.grant({explicitConsent:false})).status,400);assert.equal((await f.grant({evidence:''})).status,400);assert.equal((await f.grant({consentDate:'2026-02-31'})).status,400);assert.equal((await f.grant({consentDate:'2099-01-01'})).status,400);
  const data=await success(await f.req(f.url));assert.equal(data.grants.length,0);assert.equal((await f.req('/api/result-reports/export?id='+f.o.id+'&asset='+f.a+'&purpose=Website')).status,403);
});
test('advertising requires purpose-specific consent and reviewed flattened pixels; revocation retains evidence and blocks export',async t=>{
  const f=await fixture(t);await success(await f.grant());let exported='/api/result-reports/export?id='+f.o.id+'&asset='+f.a+'&purpose=Website';assert.equal((await f.req(exported)).status,409);
  const preview=await success(await f.preview()),original=Buffer.from(f.files.get(f.a));assert.equal((await f.req(exported)).status,409);assert.equal((await f.mutation({action:'approveMask',previewId:preview.previewId,hash:'incorrect',reviewed:true})).status,400);
  const data=await success(await f.mutation({action:'approveMask',previewId:preview.previewId,hash:preview.hash,reviewed:true}));assert.ok(data.masks[f.a].reviewedAt);assert.equal((await f.req(exported.replace('Website','Druckwerbung'))).status,403);
  const response=await f.req(exported);assert.equal(response.status,200);const png=Buffer.from(await response.arrayBuffer()),decoded=await sharp(png).ensureAlpha().raw().toBuffer();assert.deepEqual([...decoded.subarray((25*100+30)*4,(25*100+30)*4+4)],[0,0,0,255]);assert.deepEqual([...decoded.subarray(0,4)],[220,100,30,255]);assert.deepEqual(f.files.get(f.a),original);assert.equal((await sharp(png).metadata()).exif,undefined);
  await success(await f.mutation({action:'revoke',grantId:data.grants[0].id,reason:'TEST ausdrücklicher Kundenwiderruf'}));assert.equal((await f.req(exported)).status,403);const revoked=await success(await f.req(f.url));assert.ok(revoked.grants[0].revokedAt);assert.equal(revoked.grants[0].evidence,'TEST separate ausdrückliche Bildfreigabe');
});
test('mask bounds, explicit no-plate review and cross-order preview ownership are enforced',async t=>{
  const f=await fixture(t);assert.equal((await f.preview({rectangles:[]})).status,400);assert.equal((await f.preview({rectangles:[{x:.9,y:0,width:.2,height:.1}]})).status,400);
  const p=await success(await f.preview({rectangles:[],noPlateVisible:true}));assert.equal((await f.mutation({action:'approveMask',previewId:p.previewId,hash:p.hash,reviewed:false})).status,400);
  const other=await f.order(foreign),otherURL='/api/result-reports?id='+other.id;await f.req(otherURL);assert.equal((await f.req(otherURL,{version:0,orderVersion:1,action:'approveMask',previewId:p.previewId,hash:p.hash,reviewed:true})).status,400);
  assert.equal((await f.req('/api/result-reports/mask?id='+other.id+'&preview='+p.previewId)).status,404);
});
test('optimistic conflict preserves saved report and order reassignment blocks old report access',async t=>{
  const f=await fixture(t);await success(await f.save());assert.equal((await f.req(f.url,{action:'save',version:0,orderVersion:1,entries:[]})).status,409);
  const saved=await success(await f.save({customerReleased:true,customerReleaseConfirmed:true})),other=await f.order(foreign);await f.req('/api/result-reports?id='+other.id);const link=await f.env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(other.id).first();await f.env.DB.prepare('UPDATE order_files SET customer_id=?,vehicle_id=? WHERE order_id=?').bind(link.customer_id,link.vehicle_id,f.o.id).run();
  assert.equal((await f.req(f.url)).status,409);assert.equal((await f.req('/api/customer/result-report?id='+f.o.id,null,'customer')).status,404);assert.equal((await f.env.DB.prepare('SELECT version FROM result_reports WHERE order_id=?').bind(f.o.id).first()).version,saved.version);
});
test('customer PDF contains only released images; PDF creation is real and original pixels stay unchanged',async t=>{
  const f=await fixture(t);await success(await f.save({customerReleased:true,customerReleaseConfirmed:true}));const before=Buffer.from(f.files.get(f.a));
  const response=await f.req('/api/customer/result-report/pdf?id='+f.o.id,null,'customer');assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('content-type'),'application/pdf');const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const {PDFDocument}=await import('../dist/pdf/library.mjs'),doc=await PDFDocument.load(bytes);assert.ok(doc.getPageCount()>=1);const images=doc.context.enumerateIndirectObjects().filter(([,obj])=>obj.dict?.get?.(doc.context.obj('Subtype'))?.toString()==='/Image');assert.equal(images.length,1,'one released photo; hidden image is absent');assert.deepEqual(f.files.get(f.a),before);
});
test('storage errors never confirm an image mask; async order blocking rolls back preview metadata and bytes',async t=>{
  const f=await fixture(t),put=f.env.BUCKET.put,initial=f.files.size;f.env.BUCKET.put=async(id,bytes)=>{await put(id,bytes);await f.env.DB.prepare("UPDATE orders SET data=json_set(data,'$.recordsRestriction.status','blocked'),version=version+1 WHERE id=?").bind(f.o.id).run();};
  const response=await f.preview();assert.equal(response.status,409);assert.equal(f.files.size,initial);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM result_mask_previews').first()).n,0);
});
test('revocation during an in-flight masked export prevents stale bytes from being returned',async t=>{
  const f=await fixture(t),grant=await success(await f.grant()),p=await success(await f.preview());await success(await f.mutation({action:'approveMask',previewId:p.previewId,hash:p.hash,reviewed:true}));
  const get=f.env.BUCKET.get;let revoked=false;f.env.BUCKET.get=async id=>{const file=await get(id);if(id===p.previewId&&!revoked){revoked=true;await success(await f.mutation({action:'revoke',grantId:grant.grants[0].id,reason:'TEST während Export eingegangener Widerruf'}));}return file;};
  const r=await f.req('/api/result-reports/export?id='+f.o.id+'&asset='+f.a+'&purpose=Website');assert.equal(r.status,409);assert.equal(revoked,true);assert.equal(r.headers.get('content-type'),'application/json');
});
test('existing completed services are suggestions only, with no inferred offer work or silent saved confirmation',async t=>{
  const f=await fixture(t);let dto=await success(await f.req(f.url));assert.deepEqual(dto.serviceSuggestion,{text:'Original Rückgabeleistung',source:'unterschriebenem Rückgabeprotokoll'});assert.equal(dto.completedServices,'');assert.equal(dto.completionConfirmedAt,null);assert.equal(dto.version,0);
  assert.equal((await f.save({completedServices:dto.serviceSuggestion.text,completionConfirmed:false})).status,400);
  const updated={...f.o,return:undefined,offer:{services:'NICHT ERLEDIGTE ANGEBOTSLEISTUNG'},projectDetails:{workSteps:[{id:'done',title:'Erledigte Felgenreinigung',done:true,note:'INTERNER VERMERK'},{id:'open',title:'Noch offene Versiegelung',done:false}]}};
  await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(updated),f.o.id).run();dto=await success(await f.req(f.url));assert.deepEqual(dto.serviceSuggestion,{text:'Erledigte Felgenreinigung',source:'als erledigt markierten Arbeitsschritten'});assert.equal(dto.completedServices,'');assert.equal(dto.version,0);
  const saved=await success(await f.save({completedServices:dto.serviceSuggestion.text,orderVersion:2}));assert.equal(saved.completedServices,'Erledigte Felgenreinigung');assert.equal(saved.serviceSuggestion,null);
});
test('PDF keeps a before/after motif pair together after long text and handles an unpaired phase honestly',async t=>{
  const f=await fixture(t),entries=[{assetId:f.a,phase:'before',template:'exterior',motif:'Frontansicht mit langem Motivtitel für die Lesbarkeit und Zuordnung beider Zustände',customerVisible:true},{assetId:f.b,phase:'after',template:'exterior',motif:'Frontansicht mit langem Motivtitel für die Lesbarkeit und Zuordnung beider Zustände',customerVisible:true}];
  await success(await f.save({entries,completedServices:Array.from({length:31},(_,i)=>'Tatsächlich erledigte synthetische Testleistung '+(i+1)).join('\n'),customerReleased:true,customerReleaseConfirmed:true}));
  const response=await f.req('/api/customer/result-report/pdf?id='+f.o.id,null,'customer');assert.equal(response.status,200);const {PDFDocument}=await import('../dist/pdf/library.mjs'),doc=await PDFDocument.load(await response.arrayBuffer());
  const imageCounts=doc.getPages().map(p=>p.node.Resources().get(doc.context.obj('XObject'))?.keys().length??0);assert.ok(doc.getPageCount()>1);assert.deepEqual(imageCounts.filter(Boolean),[2],'both phases must occur on the same page');
  await success(await f.save({entries:[entries[0]],customerReleased:true,customerReleaseConfirmed:true}));const one=await f.req('/api/customer/result-report/pdf?id='+f.o.id,null,'customer');assert.equal(one.status,200);const unpaired=await PDFDocument.load(await one.arrayBuffer());assert.equal(unpaired.getPageCount(),1);assert.equal(unpaired.getPage(0).node.Resources().get(unpaired.context.obj('XObject')).keys().length,1);
});

// Explicitly enabled business accounts. Fleet enquiries and completed-vehicle cards are
// separate from orders, invoices and the accounting journal. Photos stay in the private bucket.
import {createHash,randomUUID} from 'node:crypto';
import {AppError,need,text} from '../src/domain.mjs';
import {digest,limited} from './auth.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PREFIX='/api/portal/business/';
const ADMIN='/api/portal-admin/business/';
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...security,'Content-Type':'application/json; charset=utf-8'}});
const emailKey=value=>String(value??'').trim().toLowerCase();
const validDate=value=>{const date=String(value??'');need(/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(Date.parse(date))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date,'Bitte ein gültiges Datum angeben.');return date;};

export async function businessPortalSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS business_portal_access(
      customer_id TEXT PRIMARY KEY REFERENCES customers(id),email TEXT NOT NULL,
      active INTEGER NOT NULL CHECK(active IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS business_portal_access_email ON business_portal_access(email,active)',
    `CREATE TABLE IF NOT EXISTS business_vehicle_requests(
      id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),request_key TEXT NOT NULL UNIQUE,
      vehicle_count INTEGER NOT NULL CHECK(vehicle_count BETWEEN 1 AND 100),desired_date TEXT,
      note TEXT NOT NULL,submitted_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN'
      CHECK(status IN ('OPEN','IN_PROGRESS','DONE','DECLINED')),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS business_vehicle_requests_customer ON business_vehicle_requests(customer_id,created_at)',
    `CREATE TABLE IF NOT EXISTS business_completed_vehicles(
      id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),title TEXT NOT NULL,
      plate TEXT NOT NULL,completed_on TEXT NOT NULL,net_price_minor INTEGER NOT NULL
      CHECK(net_price_minor BETWEEN 0 AND 1000000000),note TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS business_completed_customer ON business_completed_vehicles(customer_id,completed_on)',
    `CREATE TABLE IF NOT EXISTS business_vehicle_photos(
      id TEXT PRIMARY KEY,vehicle_id TEXT NOT NULL REFERENCES business_completed_vehicles(id),
      mime TEXT NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp')),
      sha256 TEXT NOT NULL,size INTEGER NOT NULL,visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
      created_at TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS business_vehicle_photos_vehicle ON business_vehicle_photos(vehicle_id,created_at)',
    `CREATE TABLE IF NOT EXISTS business_portal_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
      at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT)`,
    ...['business_portal_access','business_vehicle_requests','business_completed_vehicles','business_vehicle_photos','business_portal_events'].map(table=>`CREATE TRIGGER IF NOT EXISTS no_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'B2B-Vorgänge werden nicht gelöscht'); END`),
    "CREATE TRIGGER IF NOT EXISTS no_business_portal_event_update BEFORE UPDATE ON business_portal_events BEGIN SELECT RAISE(ABORT,'B2B-Verlauf ist unveränderlich'); END",
    "CREATE TRIGGER IF NOT EXISTS business_photo_visible_limit BEFORE INSERT ON business_vehicle_photos WHEN NEW.visible=1 AND (SELECT COUNT(*) FROM business_vehicle_photos WHERE vehicle_id=NEW.vehicle_id AND visible=1)>=20 BEGIN SELECT RAISE(ABORT,'Höchstens 20 sichtbare Fotos pro Fahrzeug'); END",
    "CREATE TRIGGER IF NOT EXISTS business_photo_reshow_limit BEFORE UPDATE OF visible ON business_vehicle_photos WHEN OLD.visible=0 AND NEW.visible=1 AND (SELECT COUNT(*) FROM business_vehicle_photos WHERE vehicle_id=NEW.vehicle_id AND visible=1)>=20 BEGIN SELECT RAISE(ABORT,'Höchstens 20 sichtbare Fotos pro Fahrzeug'); END"
  ].map(sql=>env.DB.prepare(sql)));
}

async function readJSON(request,max=8000){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=max,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
const event=(env,entityType,entityId,actor,action,before,after,onlyIfChanged=false)=>env.DB.prepare(onlyIfChanged?'INSERT INTO business_portal_events(entity_type,entity_id,at,actor,action,before_json,after_json) SELECT ?,?,?,?,?,?,? WHERE changes()=1':'INSERT INTO business_portal_events(entity_type,entity_id,at,actor,action,before_json,after_json) VALUES(?,?,?,?,?,?,?)').bind(entityType,entityId,new Date().toISOString(),actor,action,before?JSON.stringify(before):null,after?JSON.stringify(after):null);
async function customerRow(env,id){need(UUID.test(id??''),'Geschäftskunde nicht gefunden.',404);const row=await env.DB.prepare('SELECT id,data,synthetic FROM customers WHERE id=?').bind(id).first();need(row,'Geschäftskunde nicht gefunden.',404);return {...row,customer:JSON.parse(row.data)};}
async function membership(env,id,email){
  const row=await env.DB.prepare(`SELECT a.customer_id,c.data,c.synthetic FROM business_portal_access a JOIN customers c ON c.id=a.customer_id
    WHERE a.customer_id=? AND a.email=? AND a.active=1 AND c.synthetic=0`).bind(id,emailKey(email)).first();
  need(row&&emailKey(JSON.parse(row.data).email)===emailKey(email),'Geschäftskunde nicht gefunden.',404);
  return row;
}
async function accountsFor(env,email){
  const rows=(await env.DB.prepare(`SELECT a.customer_id,c.data FROM business_portal_access a JOIN customers c ON c.id=a.customer_id
    WHERE a.email=? AND a.active=1 AND c.synthetic=0 ORDER BY a.created_at`).bind(emailKey(email)).all()).results;
  return rows.filter(row=>emailKey(JSON.parse(row.data).email)===emailKey(email));
}
export async function businessPortalEligible(env,email){return (await accountsFor(env,email)).length>0;}

async function accountView(env,row,owner=false){
  const customer=JSON.parse(row.data),id=row.customer_id;
  const requests=(await env.DB.prepare('SELECT id,vehicle_count,desired_date,note,status,created_at,updated_at FROM business_vehicle_requests WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all()).results;
  const vehicles=(await env.DB.prepare(`SELECT * FROM business_completed_vehicles WHERE customer_id=? ${owner?'':'AND published=1'} ORDER BY completed_on DESC,created_at DESC LIMIT 100`).bind(id).all()).results;
  const photos=(await env.DB.prepare(`SELECT p.id,p.vehicle_id,p.mime,p.visible,p.created_at FROM business_vehicle_photos p JOIN business_completed_vehicles v ON v.id=p.vehicle_id WHERE v.customer_id=? ${owner?'':'AND p.visible=1 AND v.published=1'} ORDER BY p.created_at`).bind(id).all()).results;
  return {id,company:customer.company,name:customer.name??'',email:customer.email??'',requests:requests.map(r=>({id:r.id,count:r.vehicle_count,desiredDate:r.desired_date,note:r.note,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at})),vehicles:vehicles.map(v=>({id:v.id,title:v.title,plate:v.plate,completedOn:v.completed_on,netPriceMinor:v.net_price_minor,note:v.note,published:Boolean(v.published),version:v.version,photos:photos.filter(p=>p.vehicle_id===v.id).map(p=>({id:p.id,mime:p.mime,visible:Boolean(p.visible),url:PREFIX+'photo/'+p.id}))}))};
}

async function photoResponse(env,id,identity,isOwner){
  need(UUID.test(id??''),'Foto nicht gefunden.',404);
  const row=await env.DB.prepare('SELECT p.*,v.customer_id,v.published FROM business_vehicle_photos p JOIN business_completed_vehicles v ON v.id=p.vehicle_id WHERE p.id=?').bind(id).first();
  need(row,'Foto nicht gefunden.',404);
  if(!isOwner){need(row.published===1&&row.visible===1,'Foto nicht gefunden.',404);await membership(env,row.customer_id,identity);}
  const file=await env.BUCKET.get(row.id);need(file,'Foto nicht verfügbar.',503);
  need(createHash('sha256').update(file.body).digest('hex')===row.sha256,'Foto-Prüfung fehlgeschlagen.',503);
  return new Response(file.body,{headers:{...security,'Content-Type':row.mime,'Content-Disposition':'inline'}});
}

export async function handleBusinessPortal(env,request,identity,isOwner){
  const url=new URL(request.url),path=url.pathname;if(!path.startsWith(PREFIX))return null;
  if(request.method==='GET'&&path===PREFIX+'me'){
    let rows,preview=false;
    if(isOwner){const id=url.searchParams.get('vorschau');need(UUID.test(id??''),'Betreibervorschau: Auftrag fehlt.',400);const order=await env.DB.prepare('SELECT data,synthetic FROM orders WHERE id=?').bind(id).first();need(order,'Auftrag nicht gefunden.',404);const email=emailKey(JSON.parse(order.data).source?.email);rows=(await env.DB.prepare(`SELECT a.customer_id,c.data FROM business_portal_access a JOIN customers c ON c.id=a.customer_id
      WHERE a.email=? AND a.active=1 AND c.synthetic=?`).bind(email,order.synthetic).all()).results.filter(row=>emailKey(JSON.parse(row.data).email)===email);preview=true;}
    else rows=await accountsFor(env,identity);
    return json({preview,accounts:await Promise.all(rows.map(row=>accountView(env,row)))});
  }
  if(request.method==='GET'&&path.startsWith(PREFIX+'photo/'))return photoResponse(env,path.slice((PREFIX+'photo/').length),identity,isOwner);
  need(request.method==='POST'&&path===PREFIX+'request','Funktion nicht gefunden.',404);
  need(!isOwner,'Betreibervorschau: Aktionen führt nur der Kunde selbst aus.',403);
  const input=await readJSON(request),id=input.accountId,key=input.requestKey,count=Number(input.count);
  await membership(env,id,identity);
  need(UUID.test(key??''),'Anfragekennung fehlt. Bitte die Seite neu laden.');
  need(Number.isInteger(count)&&count>=1&&count<=100,'Bitte eine Anzahl zwischen 1 und 100 Fahrzeugen eingeben.');
  const note=text(input.note,500),desired=input.desiredDate?validDate(input.desiredDate):null,now=Date.now();
  need(!await limited(env,'business-request:'+emailKey(identity),now,10),'Bitte später erneut versuchen.',429);
  const existing=await env.DB.prepare('SELECT id,customer_id FROM business_vehicle_requests WHERE request_key=?').bind(key).first();
  if(existing){need(existing.customer_id===id,'Anfragekennung bereits verwendet.',409);return json({ok:true,id:existing.id,message:'Ihre Fahrzeuganfrage ist eingegangen.'});}
  const requestId=randomUUID(),at=new Date(now).toISOString();
  try{await env.DB.batch([
    env.DB.prepare('INSERT INTO business_vehicle_requests(id,customer_id,request_key,vehicle_count,desired_date,note,submitted_email,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(requestId,id,key,count,desired,note,emailKey(identity),at,at),
    event(env,'vehicle_request',requestId,emailKey(identity),'CREATED',null,{customerId:id,count,desiredDate:desired,note})
  ]);}catch(error){const replay=await env.DB.prepare('SELECT id,customer_id FROM business_vehicle_requests WHERE request_key=?').bind(key).first();if(replay?.customer_id===id)return json({ok:true,id:replay.id,message:'Ihre Fahrzeuganfrage ist eingegangen.'});throw error;}
  return json({ok:true,id:requestId,message:'Ihre Fahrzeuganfrage ist eingegangen. Wir melden uns zur Abstimmung.'});
}

async function readPhoto(request){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  const mime=request.headers.get('content-type');need(['image/jpeg','image/png','image/webp'].includes(mime),'Nur JPEG, PNG oder WebP erlaubt.',415);
  const max=8*1024*1024;need(Number(request.headers.get('content-length')??0)<=max,'Foto ist zu groß.',413);
  const reader=request.body?.getReader();need(reader,'Foto fehlt.');const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new AppError('Foto darf höchstens 8 MB groß sein.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);need(bytes.length>50,'Foto ist leer oder beschädigt.');
  const valid=mime==='image/jpeg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  need(valid,'Bildinhalt passt nicht zum Dateityp.',415);return {bytes,mime};
}

export async function handleBusinessAdmin(env,request,isOwner){
  const url=new URL(request.url),path=url.pathname;if(!path.startsWith(ADMIN))return null;
  need(isOwner,'Nur für den Betreiber vorgesehen.',403);
  if(request.method==='GET'&&path===ADMIN+'accounts'){
    const synthetic=url.searchParams.get('test')==='true'?1:0;
    const rows=(await env.DB.prepare(`SELECT c.id,c.data,a.active,a.email AS access_email FROM customers c LEFT JOIN business_portal_access a ON a.customer_id=c.id
      WHERE c.synthetic=? AND trim(COALESCE(json_extract(c.data,'$.company'),''))<>'' ORDER BY c.updated_at DESC LIMIT 300`).bind(synthetic).all()).results;
    return json({accounts:rows.map(row=>{const c=JSON.parse(row.data);return {id:row.id,company:c.company,name:c.name??'',email:c.email??'',active:Boolean(row.active)&&emailKey(row.access_email)===emailKey(c.email)};})});
  }
  if(request.method==='GET'&&path.startsWith(ADMIN+'account/')){
    const customer=await customerRow(env,path.slice((ADMIN+'account/').length));return json({account:await accountView(env,{customer_id:customer.id,data:customer.data},true)});
  }
  need(request.method==='POST','Methode nicht erlaubt.',405);
  if(path===ADMIN+'photo'){
    const vehicleId=url.searchParams.get('vehicle');need(UUID.test(vehicleId??''),'Fahrzeug nicht gefunden.',404);
    const vehicle=await env.DB.prepare('SELECT id FROM business_completed_vehicles WHERE id=?').bind(vehicleId).first();need(vehicle,'Fahrzeug nicht gefunden.',404);
    const count=(await env.DB.prepare('SELECT COUNT(*) AS n FROM business_vehicle_photos WHERE vehicle_id=? AND visible=1').bind(vehicleId).first()).n;
    need(count<20,'Höchstens 20 sichtbare Fotos pro Fahrzeug.',409);
    const {bytes,mime}=await readPhoto(request),id=randomUUID(),at=new Date().toISOString(),sha256=createHash('sha256').update(bytes).digest('hex');
    await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:mime}});
    try{await env.DB.batch([
      env.DB.prepare('INSERT INTO business_vehicle_photos(id,vehicle_id,mime,sha256,size,created_at) VALUES(?,?,?,?,?,?)').bind(id,vehicleId,mime,sha256,bytes.length,at),
      event(env,'vehicle_photo',id,'owner','ADDED',null,{vehicleId,sha256,size:bytes.length})
    ]);}catch(error){await env.BUCKET.delete(id).catch(()=>{});throw error;}
    return json({ok:true,id,url:PREFIX+'photo/'+id});
  }
  const input=await readJSON(request);
  if(path===ADMIN+'access'){
    const customer=await customerRow(env,input.customerId),c=customer.customer,enabled=input.enabled===true;
    need(c.company&&emailKey(c.email),'Firmenname und Kunden-E-Mail sind für den B2B-Zugang erforderlich.');
    const before=await env.DB.prepare('SELECT email,active FROM business_portal_access WHERE customer_id=?').bind(customer.id).first();const at=new Date().toISOString(),after={email:emailKey(c.email),active:enabled?1:0};
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO business_portal_access(customer_id,email,active,created_at,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(customer_id) DO UPDATE SET email=excluded.email,active=excluded.active,updated_at=excluded.updated_at`).bind(customer.id,after.email,after.active,at,at),
      event(env,'business_access',customer.id,'owner',enabled?'ENABLED':'DISABLED',before,after)
    ]);return json({ok:true,enabled});
  }
  if(path===ADMIN+'vehicle'){
    const customer=await customerRow(env,input.customerId),title=text(input.title,180),plate=text(input.plate,40).toUpperCase(),note=text(input.note,1000),completed=validDate(input.completedOn),price=Number(input.netPriceMinor);
    need(customer.customer.company,'Nur Firmenkunden können B2B-Fahrzeuge erhalten.');need(title.length>=2,'Fahrzeugbezeichnung fehlt.');
    need(Number.isSafeInteger(price)&&price>=0&&price<=1000000000,'Nettopreis in Cent ist ungültig.');
    const at=new Date().toISOString();
    if(input.id){
      need(UUID.test(input.id),'Fahrzeug nicht gefunden.',404);
      const before=await env.DB.prepare('SELECT * FROM business_completed_vehicles WHERE id=? AND customer_id=?').bind(input.id,customer.id).first();need(before,'Fahrzeug nicht gefunden.',404);
      need(input.version===before.version,'Diese Fahrzeugansicht ist veraltet. Bitte neu laden.',409);
      const after={title,plate,completedOn:completed,netPriceMinor:price,note,version:before.version+1};
      const result=await env.DB.batch([
        env.DB.prepare('UPDATE business_completed_vehicles SET title=?,plate=?,completed_on=?,net_price_minor=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(title,plate,completed,price,note,at,before.id,before.version),
        event(env,'completed_vehicle',before.id,'owner','UPDATED',before,after,true)
      ]);need(result[0].meta.changes===1,'Diese Fahrzeugansicht ist veraltet. Bitte neu laden.',409);
      return json({ok:true,id:before.id});
    }
    const id=randomUUID(),after={customerId:customer.id,title,plate,completedOn:completed,netPriceMinor:price,note,published:false};
    await env.DB.batch([
      env.DB.prepare('INSERT INTO business_completed_vehicles(id,customer_id,title,plate,completed_on,net_price_minor,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,customer.id,title,plate,completed,price,note,at,at),
      event(env,'completed_vehicle',id,'owner','CREATED',null,after)
    ]);return json({ok:true,id});
  }
  if(path===ADMIN+'publish'){
    need(UUID.test(input.id??''),'Fahrzeug nicht gefunden.',404);const row=await env.DB.prepare('SELECT published FROM business_completed_vehicles WHERE id=?').bind(input.id).first();need(row,'Fahrzeug nicht gefunden.',404);
    const published=input.published===true?1:0;if(row.published===published)return json({ok:true,published:Boolean(published)});
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE business_completed_vehicles SET published=?,updated_at=? WHERE id=? AND published=?').bind(published,new Date().toISOString(),input.id,row.published),
      event(env,'completed_vehicle',input.id,'owner',published?'PUBLISHED':'HIDDEN',{published:row.published},{published},true)
    ]);need(result[0].meta.changes===1,'Diese Fahrzeugansicht ist veraltet. Bitte neu laden.',409);return json({ok:true,published:Boolean(published)});
  }
  if(path===ADMIN+'photo/visibility'){
    need(UUID.test(input.id??''),'Foto nicht gefunden.',404);const row=await env.DB.prepare('SELECT visible FROM business_vehicle_photos WHERE id=?').bind(input.id).first();need(row,'Foto nicht gefunden.',404);
    const visible=input.visible===true?1:0;if(row.visible===visible)return json({ok:true,visible:Boolean(visible)});
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE business_vehicle_photos SET visible=? WHERE id=? AND visible=?').bind(visible,input.id,row.visible),
      event(env,'vehicle_photo',input.id,'owner',visible?'SHOWN':'HIDDEN',{visible:row.visible},{visible},true)
    ]);need(result[0].meta.changes===1,'Diese Fotoansicht ist veraltet. Bitte neu laden.',409);return json({ok:true,visible:Boolean(visible)});
  }
  if(path===ADMIN+'request-status'){
    need(UUID.test(input.id??''),'Anfrage nicht gefunden.',404);
    need(['OPEN','IN_PROGRESS','DONE','DECLINED'].includes(input.status),'Status ungültig.');
    const row=await env.DB.prepare('SELECT status FROM business_vehicle_requests WHERE id=?').bind(input.id).first();need(row,'Anfrage nicht gefunden.',404);
    if(row.status===input.status)return json({ok:true,status:row.status});
    const result=await env.DB.batch([
      env.DB.prepare('UPDATE business_vehicle_requests SET status=?,updated_at=? WHERE id=? AND status=?').bind(input.status,new Date().toISOString(),input.id,row.status),
      event(env,'vehicle_request',input.id,'owner','STATUS_CHANGED',{status:row.status},{status:input.status},true)
    ]);need(result[0].meta.changes===1,'Diese Anfrageansicht ist veraltet. Bitte neu laden.',409);return json({ok:true,status:input.status});
  }
  throw new AppError('Funktion nicht gefunden.',404);
}

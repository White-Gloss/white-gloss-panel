// Beleg-Inbox und manuelle, unverbindliche Zuordnungsentwürfe. Keine Journalbuchung,
// Steuerfestsetzung, Zahlung oder DATEV-Ausgabe wird durch diese Endpunkte ausgelöst.
import {createHash,randomUUID} from 'node:crypto';
import {AppError,need,text} from '../src/domain.mjs';

const ROOT='/api/accounting';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIMES={'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const CATEGORIES=['UNCLEAR','SERVICE_INCOME','PRIVATE_CONTRIBUTION','PRIVATE_WITHDRAWAL','CLEANING_SUPPLIES','RENT','OTHER_EXPENSE','PRIVATE_PAID_EXPENSE'];
const PAYMENT_PATHS=['UNKNOWN','QONTO_TRANSFER','QONTO_CARD','CASH','CUSTOMER_CARD','PRIVATE','UNPAID'];
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function accountingSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS accounting_profile(
      id INTEGER PRIMARY KEY CHECK(id=1),legal_form TEXT NOT NULL,profit_method TEXT NOT NULL,
      vat_regime TEXT NOT NULL,vat_timing TEXT NOT NULL,vat_timing_evidence TEXT NOT NULL,
      reserve_mode TEXT NOT NULL CHECK(reserve_mode IN ('OFF','READY')),
      reserve_target_account_id TEXT,reserve_policy TEXT NOT NULL,datev_target TEXT NOT NULL,
      owner_name TEXT NOT NULL,vat_id TEXT NOT NULL)`,
    `INSERT OR IGNORE INTO accounting_profile VALUES(1,'SOLE_PROPRIETOR','EUR','REGULAR','IST','USER_CONFIRMED_OFFICIAL_EVIDENCE_PENDING','OFF',NULL,'VAT_COMPONENT_OF_SETTLED_INCOME','DATEV','Lars Marco Hägele','DE465024196')`,
    `CREATE TABLE IF NOT EXISTS accounting_documents(
      id TEXT PRIMARY KEY,synthetic INTEGER NOT NULL CHECK(synthetic IN (0,1)),
      filename TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,
      received_at TEXT NOT NULL,source TEXT NOT NULL CHECK(source='PANEL'))`,
    'CREATE INDEX IF NOT EXISTS accounting_documents_hash ON accounting_documents(sha256,synthetic)',
    `CREATE TABLE IF NOT EXISTS accounting_classifications(
      id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES accounting_documents(id),
      version INTEGER NOT NULL CHECK(version>0),category TEXT NOT NULL,payment_path TEXT NOT NULL,
      amount_minor INTEGER,document_date TEXT,partner TEXT NOT NULL,note TEXT NOT NULL,
      created_at TEXT NOT NULL,actor TEXT NOT NULL,UNIQUE(document_id,version))`,
    `CREATE TABLE IF NOT EXISTS accounting_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL REFERENCES accounting_documents(id),
      at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL)`,
    ...['accounting_documents','accounting_classifications','accounting_events'].flatMap(table=>[
      `CREATE TRIGGER IF NOT EXISTS no_${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Buchhaltungsnachweise sind unveränderlich'); END`,
      `CREATE TRIGGER IF NOT EXISTS no_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Buchhaltungsnachweise werden nicht gelöscht'); END`
    ])
  ].map(sql=>env.DB.prepare(sql)));
}

async function bodyJSON(request){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=12000,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
async function fileBytes(request){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  const mime=request.headers.get('content-type');need(MIMES[mime],'PDF, JPEG, PNG oder WebP erforderlich.',415);
  const maximum=12*1024*1024;need(Number(request.headers.get('content-length')??0)<=maximum,'Beleg ist zu groß.',413);
  const reader=request.body?.getReader();need(reader,'Belegdatei fehlt.');let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new AppError('Beleg darf höchstens 12 MB groß sein.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);need(bytes.length>30,'Beleg ist leer oder beschädigt.');
  const valid=mime==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':mime==='image/jpeg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  need(valid,'Dateiinhalt passt nicht zum Dateityp.',415);return {bytes,mime};
}
function classification(row){return row?{id:row.id,version:row.version,category:row.category,paymentPath:row.payment_path,amountMinor:row.amount_minor,documentDate:row.document_date,partner:row.partner,note:row.note,createdAt:row.created_at}:null;}

export async function handleAccounting(env,request,isOwner){
  const url=new URL(request.url),path=url.pathname;if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;
  need(isOwner,'Nur für den Betreiber vorgesehen.',403);
  if(request.method==='GET'&&path===ROOT){
    const synthetic=url.searchParams.get('test')==='true'?1:0;
    const profile=await env.DB.prepare('SELECT * FROM accounting_profile WHERE id=1').first();
    const docs=(await env.DB.prepare(`SELECT d.*, (SELECT COUNT(*) FROM accounting_documents duplicate WHERE duplicate.sha256=d.sha256 AND duplicate.synthetic=d.synthetic) AS duplicate_count
      FROM accounting_documents d WHERE d.synthetic=? ORDER BY d.received_at DESC LIMIT 200`).bind(synthetic).all()).results;
    const result=[];for(const doc of docs){const last=await env.DB.prepare('SELECT * FROM accounting_classifications WHERE document_id=? ORDER BY version DESC LIMIT 1').bind(doc.id).first();result.push({id:doc.id,filename:doc.filename,mime:doc.mime,size:doc.size,sha256:doc.sha256,receivedAt:doc.received_at,source:doc.source,duplicateCount:doc.duplicate_count,classification:classification(last)});}
    return response({profile:{legalForm:profile.legal_form,profitMethod:profile.profit_method,vatRegime:profile.vat_regime,vatTiming:profile.vat_timing,vatTimingEvidence:profile.vat_timing_evidence,reserveMode:profile.reserve_mode,reserveTargetAccountId:profile.reserve_target_account_id,reservePolicy:profile.reserve_policy,datevTarget:profile.datev_target,ownerName:profile.owner_name,vatId:profile.vat_id},documents:result});
  }
  if(request.method==='GET'&&path.startsWith(ROOT+'/document/')){
    const id=path.slice((ROOT+'/document/').length);need(UUID.test(id),'Beleg nicht gefunden.',404);
    const row=await env.DB.prepare('SELECT mime,sha256 FROM accounting_documents WHERE id=?').bind(id).first();need(row,'Beleg nicht gefunden.',404);
    const file=await env.BUCKET.get(id);need(file,'Belegarchiv nicht verfügbar.',503);
    need(hash(file.body)===row.sha256,'Belegprüfung fehlgeschlagen.',503);
    return new Response(file.body,{headers:{'Content-Type':row.mime,'Content-Disposition':'inline','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(request.method==='POST'&&path===ROOT+'/document'){
    const {bytes,mime}=await fileBytes(request),id=randomUUID(),at=new Date().toISOString(),digest=hash(bytes),synthetic=url.searchParams.get('test')==='true'?1:0;
    const name=text(url.searchParams.get('name')||'Beleg.'+MIMES[mime],180).replace(/[\\/\u0000-\u001f\u007f]/g,'_');
    await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:mime}});
    try{await env.DB.batch([
      env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(id,synthetic,name,mime,digest,bytes.length,at,'PANEL'),
      env.DB.prepare('INSERT INTO accounting_events(document_id,at,actor,action,payload) VALUES(?,?,?,?,?)').bind(id,at,'owner','RECEIVED',JSON.stringify({sha256:digest,size:bytes.length,mime,source:'PANEL'}))
    ]);}catch(error){await env.BUCKET.delete(id).catch(()=>{});throw error;}
    return response({ok:true,id,sha256:digest});
  }
  if(request.method==='POST'&&path===ROOT+'/classify'){
    const input=await bodyJSON(request);need(UUID.test(input.documentId??''),'Beleg nicht gefunden.',404);
    const doc=await env.DB.prepare('SELECT id FROM accounting_documents WHERE id=?').bind(input.documentId).first();need(doc,'Beleg nicht gefunden.',404);
    need(CATEGORIES.includes(input.category),'Kategorie ungültig.');need(PAYMENT_PATHS.includes(input.paymentPath),'Zahlungsweg ungültig.');
    const amount=input.amountMinor===null||input.amountMinor===''||input.amountMinor===undefined?null:Number(input.amountMinor);
    need(amount===null||(Number.isSafeInteger(amount)&&amount>=0&&amount<=1000000000),'Betrag muss centgenau sein.');
    const date=input.documentDate||null;need(date===null||validDay(date),'Belegdatum ungültig.');
    const partner=text(input.partner,180),note=text(input.note,800),at=new Date().toISOString(),id=randomUUID();
    // INSERT ... SELECT makes the optimistic version check and event insertion atomic.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO accounting_classifications(id,document_id,version,category,payment_path,amount_minor,document_date,partner,note,created_at,actor)
        SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,?,?,? ,?,'owner' FROM accounting_classifications WHERE document_id=?
        HAVING COALESCE(MAX(version),0)=?`).bind(id,doc.id,input.category,input.paymentPath,amount,date,partner,note,at,doc.id,input.version??0),
      env.DB.prepare(`INSERT INTO accounting_events(document_id,at,actor,action,payload)
        SELECT ?,?,?,?,? WHERE changes()=1`).bind(doc.id,at,'owner','CLASSIFIED',JSON.stringify({classificationId:id,category:input.category,paymentPath:input.paymentPath,amountMinor:amount,documentDate:date,partner,note}))
    ]);
    need(result[0].meta.changes===1,'Zuordnung wurde zwischenzeitlich geändert. Bitte neu laden.',409);
    return response({ok:true,id,version:(input.version??0)+1});
  }
  return response({error:'Funktion nicht gefunden.'},404);
}

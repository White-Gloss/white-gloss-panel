// Read-only Qonto bank inbox. Imports provider revisions and manual classifications;
// it never initiates a transfer or turns a classification into a journal entry.
import {createHash,randomUUID} from 'node:crypto';
import {AppError,need,text} from '../src/domain.mjs';
import {qontoAccess,qontoJSON,uuid} from './qonto.mjs';

const ROOT='/api/accounting/bank';
export const CREDIT=['UNCLEAR','SERVICE_B2C','SERVICE_B2B','PRIVATE_CONTRIBUTION','TAX_REFUND','TRANSFER_IN','OTHER_INCOME'];
export const DEBIT=['UNCLEAR','OPERATING_EXPENSE','PRIVATE_WITHDRAWAL','TAX_PAYMENT','TRANSFER_OUT','CARD_FEE','OTHER_OUTGOING'];
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validISO=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&value.length<=40;

export async function bankAccountingSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS accounting_bank_revisions(
      revision_id INTEGER PRIMARY KEY AUTOINCREMENT,organization_id TEXT NOT NULL,account_iban TEXT NOT NULL,
      provider_id TEXT NOT NULL,sha256 TEXT NOT NULL,status TEXT NOT NULL,side TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,label TEXT NOT NULL,reference TEXT NOT NULL,
      settled_at TEXT,provider_updated_at TEXT NOT NULL,raw_json TEXT NOT NULL,received_at TEXT NOT NULL,
      UNIQUE(organization_id,account_iban,provider_id,sha256))`,
    'CREATE INDEX IF NOT EXISTS accounting_bank_lookup ON accounting_bank_revisions(organization_id,account_iban,provider_id,revision_id)',
    `CREATE TABLE IF NOT EXISTS accounting_bank_classifications(
      id TEXT PRIMARY KEY,bank_revision_id INTEGER NOT NULL REFERENCES accounting_bank_revisions(revision_id),
      version INTEGER NOT NULL,category TEXT NOT NULL,document_id TEXT REFERENCES accounting_documents(id),
      note TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL,
      UNIQUE(bank_revision_id,version))`,
    `CREATE TABLE IF NOT EXISTS accounting_bank_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,bank_revision_id INTEGER NOT NULL REFERENCES accounting_bank_revisions(revision_id),
      at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,payload TEXT NOT NULL)`,
    ...['accounting_bank_revisions','accounting_bank_classifications','accounting_bank_events'].flatMap(table=>[
      `CREATE TRIGGER IF NOT EXISTS no_${table}_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Banknachweise sind unveränderlich'); END`,
      `CREATE TRIGGER IF NOT EXISTS no_${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Banknachweise werden nicht gelöscht'); END`
    ])
  ].map(sql=>env.DB.prepare(sql)));
}

async function readJSON(request){need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);const raw=await request.text();need(raw.length<=5000,'Anfrage zu groß.',413);try{const parsed=JSON.parse(raw);need(parsed&&typeof parsed==='object'&&!Array.isArray(parsed),'Ungültige Eingabe.');return parsed;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}}

function financialDigest(row){return digest({id:row.id,status:row.status,side:row.side,amount:row.amount_cents,currency:row.currency,settledAt:row.settled_at??null});}
function normalize(row){
  need(row&&uuid(row.id),'Qonto-Umsatz ohne gültige Kennung.',502);
  need(['credit','debit'].includes(row.side)&&['pending','declined','completed','reversed'].includes(row.status),'Qonto-Umsatzstatus ungültig.',502);
  need(Number.isSafeInteger(row.amount_cents)&&row.amount_cents>=0&&row.amount_cents<=100000000000,'Qonto-Betrag ungültig.',502);
  need(typeof row.currency==='string'&&/^[A-Z]{3}$/.test(row.currency),'Qonto-Währung ungültig.',502);
  need(validISO(row.updated_at),'Qonto-Änderungszeit fehlt.',502);
  need(row.settled_at===null||row.settled_at===undefined||validISO(row.settled_at),'Qonto-Buchungszeit ungültig.',502);
  const raw=JSON.stringify(row);need(raw.length<=30000,'Qonto-Umsatz ist zu umfangreich.',502);
  return {id:row.id,status:row.status,side:row.side,amount:row.amount_cents,currency:row.currency,label:text(row.label,250),reference:text(row.reference,250),settledAt:row.settled_at??null,updatedAt:row.updated_at,raw,sha256:digest(row),financialSha256:financialDigest(row)};
}

async function fetchAccount(config,iban){
  const all=[],seen=new Set();let expected=null;
  for(let page=1;page<=100;page++){
    const params=new URLSearchParams({iban,page:String(page),per_page:'100'});
    for(const status of ['pending','declined','completed','reversed'])params.append('status[]',status);
    const data=await qontoJSON(config,'/v2/transactions?'+params);
    const meta=data.meta;need(Array.isArray(data.transactions)&&meta&&meta.current_page===page&&Number.isInteger(meta.total_pages)&&meta.total_pages>=0&&Number.isInteger(meta.total_count)&&meta.total_count>=0,'Qonto-Umsatzliste ist unvollständig.',502);
    if(expected===null)expected=meta.total_count;else need(expected===meta.total_count,'Qonto-Umsatzliste hat sich während des Abgleichs geändert. Bitte wiederholen.',409);
    for(const remote of data.transactions){const normalized=normalize(remote);need(!seen.has(normalized.id),'Qonto-Umsatz doppelt in der Antwort.',502);seen.add(normalized.id);all.push(normalized);}
    if(page>=Math.max(1,meta.total_pages)){need(all.length===expected,'Qonto-Umsatzliste ist nicht vollständig.',502);return all;}
  }
  throw new AppError('Qonto-Umsatzliste überschreitet die sichere Seitengrenze.',409);
}

async function sync(env){
  const config=await qontoAccess(env),accounts=config.qontoAccounts;
  need(Array.isArray(accounts)&&accounts.length>0,'Bitte Qonto-Konten erneut prüfen.',409);
  const latest=await env.DB.prepare('SELECT * FROM accounting_bank_revisions WHERE revision_id IN (SELECT MAX(revision_id) FROM accounting_bank_revisions GROUP BY organization_id,account_iban,provider_id)').all();
  const known=new Map(latest.results.map(row=>[row.organization_id+'|'+row.account_iban+'|'+row.provider_id,financialDigest(JSON.parse(row.raw_json))]));
  const additions=[],at=new Date().toISOString();let checked=0;
  for(const account of accounts){need(typeof account.iban==='string'&&/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(account.iban),'Qonto-Konto ist nicht eindeutig.',409);const rows=await fetchAccount(config,account.iban);checked+=rows.length;for(const row of rows){const key=config.qontoOrganizationId+'|'+account.iban+'|'+row.id;if(known.get(key)!==row.financialSha256)additions.push({account:account.iban,row});}}
  // All Qonto pages were validated before a single local mutation. A repeated sync
  // only stores changed provider snapshots (unique provider identity + content hash).
  const statements=[];
  for(const item of additions){const r=item.row,account=item.account;statements.push(
    env.DB.prepare(`INSERT OR IGNORE INTO accounting_bank_revisions(organization_id,account_iban,provider_id,sha256,status,side,amount_minor,currency,label,reference,settled_at,provider_updated_at,raw_json,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(config.qontoOrganizationId,account,r.id,r.sha256,r.status,r.side,r.amount,r.currency,r.label,r.reference,r.settledAt,r.updatedAt,r.raw,at),
    env.DB.prepare(`INSERT INTO accounting_bank_events(bank_revision_id,at,actor,action,payload)
      SELECT last_insert_rowid(),?,?,?,? WHERE changes()=1`).bind(at,'qonto','IMPORTED',JSON.stringify({organizationId:config.qontoOrganizationId,accountIban:account,providerId:r.id,sha256:r.sha256,status:r.status}))
  );}
  const result=statements.length?await env.DB.batch(statements):[];
  const imported=result.reduce((count,statement,index)=>count+(index%2===0?statement.meta.changes:0),0);
  return {ok:true,checked,imported,accounts:accounts.length,message:`${checked} Qonto-Umsätze geprüft, ${imported} neue oder geänderte Stände gespeichert. Keine Zahlung ausgelöst.`};
}

async function list(env){
  const rows=(await env.DB.prepare(`SELECT r.* FROM accounting_bank_revisions r WHERE r.revision_id IN
    (SELECT MAX(revision_id) FROM accounting_bank_revisions GROUP BY organization_id,account_iban,provider_id)
    ORDER BY COALESCE(r.settled_at,r.provider_updated_at) DESC LIMIT 200`).all()).results;
  const items=[];for(const r of rows){const c=await env.DB.prepare('SELECT * FROM accounting_bank_classifications WHERE bank_revision_id=? ORDER BY version DESC LIMIT 1').bind(r.revision_id).first();items.push({revisionId:r.revision_id,accountIban:r.account_iban,providerId:r.provider_id,status:r.status,side:r.side,amountMinor:r.amount_minor,currency:r.currency,label:r.label,reference:r.reference,settledAt:r.settled_at,updatedAt:r.provider_updated_at,classification:c?{version:c.version,category:c.category,documentId:c.document_id,note:c.note,createdAt:c.created_at,actor:c.actor}:null});}return {items};
}

async function classify(env,request){
  const input=await readJSON(request),revision=Number(input.revisionId);need(Number.isSafeInteger(revision)&&revision>0,'Umsatz nicht gefunden.',404);
  const row=await env.DB.prepare('SELECT * FROM accounting_bank_revisions WHERE revision_id=?').bind(revision).first();need(row,'Umsatz nicht gefunden.',404);
  const latest=await env.DB.prepare('SELECT MAX(revision_id) AS id FROM accounting_bank_revisions WHERE organization_id=? AND account_iban=? AND provider_id=?').bind(row.organization_id,row.account_iban,row.provider_id).first();
  need(latest.id===revision,'Qonto-Umsatz wurde geändert. Bitte neu prüfen.',409);
  need((row.side==='credit'?CREDIT:DEBIT).includes(input.category),'Kategorie passt nicht zur Umsatzrichtung.');
  const documentId=input.documentId||null;if(documentId){need(uuid(documentId),'Beleg nicht gefunden.',404);need(await env.DB.prepare('SELECT id FROM accounting_documents WHERE id=? AND synthetic=0').bind(documentId).first(),'Beleg nicht gefunden.',404);}
  const note=text(input.note,800),at=new Date().toISOString(),id=randomUUID(),version=Number(input.version??0);
  need(Number.isSafeInteger(version)&&version>=0,'Version ungültig.');
  const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO accounting_bank_classifications(id,bank_revision_id,version,category,document_id,note,created_at,actor)
      SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,?, 'owner' FROM accounting_bank_classifications WHERE bank_revision_id=?
      HAVING COALESCE(MAX(version),0)=? AND ?=(SELECT MAX(revision_id) FROM accounting_bank_revisions WHERE organization_id=? AND account_iban=? AND provider_id=?)`).bind(id,revision,input.category,documentId,note,at,revision,version,revision,row.organization_id,row.account_iban,row.provider_id),
    env.DB.prepare(`INSERT INTO accounting_bank_events(bank_revision_id,at,actor,action,payload)
      SELECT ?,?,?,?,? WHERE changes()=1`).bind(revision,at,'owner','CLASSIFIED',JSON.stringify({id,category:input.category,documentId,note}))
  ]);
  need(result[0].meta.changes===1,'Umsatz wurde zwischenzeitlich zugeordnet. Bitte neu laden.',409);
  return json({ok:true,id,version:version+1});
}

export async function handleBankAccounting(env,request,isOwner){
  const path=new URL(request.url).pathname;if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;
  need(isOwner,'Nur für den Betreiber vorgesehen.',403);
  if(path===ROOT&&request.method==='GET')return json(await list(env));
  if(path===ROOT+'/sync'&&request.method==='POST'){await readJSON(request);return json(await sync(env));}
  if(path===ROOT+'/classify'&&request.method==='POST')return classify(env,request);
  return json({error:'Funktion nicht gefunden.'},404);
}

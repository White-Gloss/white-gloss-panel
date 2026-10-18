import {randomUUID} from 'node:crypto';
import {need} from '../src/domain.mjs';
import {CATEGORIES,PAYMENT_PATHS,validDay} from './accounting.mjs';
import {CREDIT,DEBIT} from './bank-accounting.mjs';
import {digest} from './auth.mjs';
import {inputFor} from './password-auth.mjs';
import {advisorJSON,advisorGuard,advisorAudit,advisorStillActive} from './advisor-auth.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const latestBank=`r.revision_id=(SELECT MAX(b.revision_id) FROM accounting_bank_revisions b
  WHERE b.organization_id=r.organization_id AND b.account_iban=r.account_iban AND b.provider_id=r.provider_id)`;
const queries={
  documents:`SELECT d.rowid AS cursor,d.id,d.filename,d.mime,d.size,d.sha256,d.received_at,
    c.version,c.category,c.payment_path,c.amount_minor,c.document_date,c.partner,c.note
    FROM accounting_documents d LEFT JOIN accounting_classifications c ON c.document_id=d.id
    AND c.version=(SELECT MAX(version) FROM accounting_classifications WHERE document_id=d.id)
    WHERE d.synthetic=0`,
  bank:`SELECT r.revision_id AS cursor,r.revision_id AS id,r.account_iban,r.provider_id,r.status,r.side,
    r.amount_minor,r.currency,r.label,r.reference,r.settled_at,r.provider_updated_at,
    c.version,c.category,c.document_id,c.note FROM accounting_bank_revisions r
    LEFT JOIN accounting_bank_classifications c ON c.bank_revision_id=r.revision_id
    AND c.version=(SELECT MAX(version) FROM accounting_bank_classifications WHERE bank_revision_id=r.revision_id)
    WHERE ${latestBank}`,
  // Include replaced invoices as separate rows, but never expose order JSON,
  // customer access tokens, messages, signatures or vehicle photos.
  invoices:`SELECT o.rowid AS order_cursor,j.key AS invoice_cursor,o.id AS order_id,
    json_extract(j.value,'$.id') AS id,json_extract(j.value,'$.number') AS number,
    json_extract(j.value,'$.issueDate') AS issue_date,json_extract(j.value,'$.dueDate') AS due_date,
    json_extract(j.value,'$.status') AS status,json_extract(j.value,'$.totalCents') AS total_cents,
    json_extract(j.value,'$.paidAt') AS paid_at,json_extract(j.value,'$.provider') AS provider,
    json_extract(o.data,'$.source.name') AS customer,
    CASE WHEN json_extract(j.value,'$.id')=json_extract(o.data,'$.invoice.id') THEN 0 ELSE 1 END AS historical,
    EXISTS(SELECT 1 FROM invoice_documents pdf WHERE pdf.order_id=o.id AND pdf.invoice_id=json_extract(j.value,'$.id')) AS pdf_available
    FROM orders o,json_each(json_insert(COALESCE(json_extract(o.data,'$.invoiceHistory'),'[]'),'$[#]',json_extract(o.data,'$.invoice'))) j
    WHERE o.synthetic=0 AND json_extract(j.value,'$.id') IS NOT NULL`
};
function numeric(value,fallback){if(value===null||value===undefined||value==='')return fallback;need(/^\d{1,16}$/.test(String(value))&&Number.isSafeInteger(Number(value)),'Seitenmarke ungültig.');return Number(value);}
function cursorFor(kind,row){return kind==='invoices'?`${row.order_cursor}:${row.invoice_cursor}`:String(row.cursor);}
export async function listAdvisorFinance(env,kind,cursor=null){
  need(Object.hasOwn(queries,kind),'Liste nicht gefunden.',404);
  let condition='',values=[],order='';
  if(kind==='invoices'){
    need(cursor===null||/^\d{1,16}:\d{1,16}$/.test(cursor),'Seitenmarke ungültig.');
    if(cursor){const [row,index]=cursor.split(':').map(x=>numeric(x,0));condition=' AND (o.rowid<? OR (o.rowid=? AND j.key<?))';values=[row,row,index];}
    order='o.rowid DESC,j.key DESC';
  }else{const field=kind==='documents'?'d.rowid':'r.revision_id';condition=` AND ${field}<?`;values=[numeric(cursor,Number.MAX_SAFE_INTEGER)];order=field+' DESC';}
  const rows=(await env.DB.prepare(queries[kind]+condition+' ORDER BY '+order+' LIMIT 51').bind(...values).all()).results;
  const items=rows.slice(0,50);return {items,nextCursor:rows.length>50?cursorFor(kind,items.at(-1)):null};
}

async function target(env,kind,id){
  need(['document','bank'].includes(kind),'Ziel ungültig.');
  if(kind==='document'){
    need(UUID.test(id??''),'Beleg nicht gefunden.',404);
    const row=await env.DB.prepare('SELECT id FROM accounting_documents WHERE id=? AND synthetic=0').bind(id).first();
    need(row,'Beleg nicht gefunden.',404);return row;
  }
  const n=numeric(id,0);need(n>0,'Bankumsatz nicht gefunden.',404);
  const row=await env.DB.prepare('SELECT r.* FROM accounting_bank_revisions r WHERE r.revision_id=? AND '+latestBank).bind(n).first();
  need(row,'Bankumsatz fehlt oder wurde geändert. Bitte neu laden.',409);return row;
}
function boundedText(value,max,label){need(value===undefined||value===null||typeof value==='string',label+' ungültig.');const result=(value??'').trim();need(result.length<=max,label+' zu lang.');return result;}
async function proposalInput(env,input){
  const kind=input.kind,id=String(input.targetId??''),row=await target(env,kind,id),version=input.version;
  need(Number.isSafeInteger(version)&&version>=0,'Version ungültig.');
  const note=boundedText(input.note,800,'Prüfnotiz');
  if(kind==='document'){
    need(CATEGORIES.includes(input.category)&&PAYMENT_PATHS.includes(input.paymentPath),'Kategorie oder Zahlungsweg ungültig.');
    const amount=input.amountMinor??null,date=input.documentDate||null;
    need(amount===null||(Number.isSafeInteger(amount)&&amount>=0&&amount<=1000000000),'Betrag muss centgenau sein.');
    need(date===null||validDay(date),'Belegdatum ungültig.');
    return {kind,id,version,row,payload:{category:input.category,paymentPath:input.paymentPath,amountMinor:amount,documentDate:date,partner:boundedText(input.partner,180,'Partner'),note}};
  }
  need((row.side==='credit'?CREDIT:DEBIT).includes(input.category),'Kategorie passt nicht zur Umsatzrichtung.');
  const documentId=input.documentId||null;if(documentId)await target(env,'document',documentId);
  return {kind,id,version,row,payload:{category:input.category,documentId,note}};
}
function versionGuard(p){
  return p.kind==='document'?{
    sql:'?=COALESCE((SELECT MAX(version) FROM accounting_classifications WHERE document_id=?),0)',params:[p.version,p.id]
  }:{sql:`?=COALESCE((SELECT MAX(version) FROM accounting_bank_classifications WHERE bank_revision_id=?),0)
    AND ?=(SELECT MAX(revision_id) FROM accounting_bank_revisions WHERE organization_id=? AND account_iban=? AND provider_id=?)`,
    params:[p.version,Number(p.id),Number(p.id),p.row.organization_id,p.row.account_iban,p.row.provider_id]};
}
async function submitProposal(env,request,context){
  const p=await proposalInput(env,await inputFor(env,request)),id=randomUUID(),guard=advisorGuard(context),version=versionGuard(p),at=new Date().toISOString();
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO advisor_proposals SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND ${version.sql}`)
      .bind(id,p.kind,p.id,p.version,JSON.stringify(p.payload),context.actor,at,...guard.params,...version.params),
    env.DB.prepare('INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,?,?,? WHERE changes()=1').bind(at,context.actor,'PROPOSED',id)
  ]);
  need(results[0].meta.changes===1,'Zugang oder Zuordnung wurde geändert. Bitte neu laden.',409);
  return advisorJSON({ok:true,id});
}
async function decide(env,request,context){
  need(context.isOwner,'Nur der Betreiber darf Vorschläge übernehmen oder ablehnen.',403);
  const input=await inputFor(env,request);need(['accepted','rejected'].includes(input.decision),'Entscheidung ungültig.');
  const row=await env.DB.prepare('SELECT * FROM advisor_proposals WHERE id=?').bind(input.id??'').first();need(row,'Vorschlag nicht gefunden.',404);
  const at=new Date().toISOString(),pending='NOT EXISTS(SELECT 1 FROM advisor_decisions WHERE proposal_id=?)',statements=[];
  if(input.decision==='accepted'){
    const p=await proposalInput(env,{...JSON.parse(row.payload),kind:row.target_kind,targetId:row.target_id,version:row.base_version});
    const version=versionGuard(p),id=randomUUID(),v=p.payload;
    if(p.kind==='document'){
      statements.push(env.DB.prepare(`INSERT INTO accounting_classifications SELECT ?,?,?,?,?,?,?,?,?,?,'owner'
        WHERE ${pending} AND ${version.sql}`).bind(id,p.id,p.version+1,v.category,v.paymentPath,v.amountMinor,v.documentDate,v.partner,v.note,at,row.id,...version.params));
      statements.push(env.DB.prepare(`INSERT INTO accounting_events(document_id,at,actor,action,payload) SELECT ?,?,'owner','ADVISOR_PROPOSAL_ACCEPTED',? WHERE changes()=1`).bind(p.id,at,JSON.stringify({proposalId:row.id,classificationId:id,...v})));
    }else{
      statements.push(env.DB.prepare(`INSERT INTO accounting_bank_classifications SELECT ?,?,?,?,?,?,?,'owner'
        WHERE ${pending} AND ${version.sql}`).bind(id,Number(p.id),p.version+1,v.category,v.documentId,v.note,at,row.id,...version.params));
      statements.push(env.DB.prepare(`INSERT INTO accounting_bank_events(bank_revision_id,at,actor,action,payload) SELECT ?,?,'owner','ADVISOR_PROPOSAL_ACCEPTED',? WHERE changes()=1`).bind(Number(p.id),at,JSON.stringify({proposalId:row.id,classificationId:id,...v})));
    }
    statements.push(env.DB.prepare("INSERT INTO advisor_decisions SELECT ?,'accepted','owner',? WHERE changes()=1").bind(row.id,at));
  }else statements.push(env.DB.prepare(`INSERT INTO advisor_decisions SELECT ?,'rejected','owner',? WHERE ${pending}`).bind(row.id,at,row.id));
  statements.push(env.DB.prepare("INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,'owner',?,? WHERE changes()=1").bind(at,input.decision==='accepted'?'ACCEPTED':'REJECTED',row.id));
  const results=await env.DB.batch(statements);
  need(results[0].meta.changes===1,'Vorschlag bereits entschieden oder Zuordnung inzwischen geändert. Bitte neu prüfen.',409);
  return advisorJSON({ok:true});
}
async function comments(env,request,context,url){
  if(request.method==='POST'){
    const input=await inputFor(env,request),id=String(input.targetId??'');await target(env,input.kind,id);
    const body=boundedText(input.body,2000,'Kommentar');need(body,'Kommentar fehlt.');
    const guard=advisorGuard(context),key=randomUUID(),at=new Date().toISOString();
    const results=await env.DB.batch([
      env.DB.prepare(`INSERT INTO advisor_comments SELECT ?,?,?,?,?,? WHERE ${guard.sql}`).bind(key,input.kind,id,body,context.actor,at,...guard.params),
      env.DB.prepare('INSERT INTO advisor_audit(at,actor,action,target) SELECT ?,?,?,? WHERE changes()=1').bind(at,context.actor,'COMMENTED',key)
    ]);
    need(results[0].meta.changes===1,'Zugang wurde gesperrt.',401);return advisorJSON({ok:true,id:key});
  }
  const kind=url.searchParams.get('kind'),id=url.searchParams.get('targetId');await target(env,kind,id);
  const rows=(await env.DB.prepare(`SELECT c.rowid AS cursor,c.id,c.body,c.created_at,c.actor,a.company,a.email FROM advisor_comments c
    LEFT JOIN advisor_accounts a ON c.actor='advisor:'||a.id WHERE c.target_kind=? AND c.target_id=? AND c.rowid<? ORDER BY c.rowid DESC LIMIT 51`)
    .bind(kind,id,numeric(url.searchParams.get('cursor'),Number.MAX_SAFE_INTEGER)).all()).results;
  const items=rows.slice(0,50);return advisorJSON({items,nextCursor:rows.length>50?String(items.at(-1).cursor):null});
}

export function csvCell(value){
  if(typeof value==='number')return String(value);
  let raw=String(value??'');if(/^[\s\u0000-\u001f]*[=+@-]/.test(raw)||/^[\t\r\n]/.test(raw))raw="'"+raw;
  return '"'+raw.replaceAll('"','""')+'"';
}
async function exportCSV(env,url,context){
  const kind=url.searchParams.get('kind'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  need(Object.hasOwn(queries,kind),'Export ungültig.');
  need(validDay(from)&&validDay(to)&&from<=to&&Date.parse(to)-Date.parse(from)<=366*86400000,'Zeitraum von höchstens 366 Tagen wählen.');
  const day={documents:"substr(COALESCE(c.document_date,d.received_at),1,10)",bank:"substr(COALESCE(r.settled_at,r.provider_updated_at),1,10)",invoices:"substr(json_extract(j.value,'$.issueDate'),1,10)"}[kind];
  const rows=(await env.DB.prepare(queries[kind]+` AND ${day} BETWEEN ? AND ? ORDER BY ${day} LIMIT 10001`).bind(from,to).all()).results;
  need(rows.length<=10000,'Mehr als 10.000 Einträge: Bitte den Exportzeitraum verkleinern.',413);
  const fields={
    documents:['id','filename','sha256','received_at','document_date','version','category','payment_path','amount_minor','partner','note'],
    bank:['id','account_iban','provider_id','status','side','amount_minor','currency','label','reference','settled_at','provider_updated_at','version','category','document_id','note'],
    invoices:['id','order_id','number','issue_date','due_date','status','total_cents','paid_at','provider','customer','historical']
  }[kind];
  const csv='\uFEFF'+[fields.map(csvCell).join(';'),...rows.map(row=>fields.map(key=>csvCell(row[key])).join(';'))].join('\r\n')+'\r\n';
  await advisorStillActive(env,context);await advisorAudit(env,context.actor,'EXPORT',`${kind}:${from}:${to}`).run();
  return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="white-gloss-${kind}-${from}-${to}.csv"`,'Cache-Control':'no-store'}});
}

export async function handleAdvisorFinance(env,request,context){
  const url=new URL(request.url),route=url.pathname.slice('/api/advisor'.length);
  need(['GET','POST'].includes(request.method),'Methode nicht erlaubt.',405);
  if(request.method==='GET'&&['/documents','/bank','/invoices'].includes(route))return advisorJSON(await listAdvisorFinance(env,route.slice(1),url.searchParams.get('cursor')));
  if(request.method==='GET'&&route==='/export')return exportCSV(env,url,context);
  if(request.method==='GET'&&route.startsWith('/document/')){
    const id=route.slice('/document/'.length);await target(env,'document',id);
    const row=await env.DB.prepare('SELECT mime,sha256 FROM accounting_documents WHERE id=?').bind(id).first();
    const file=await env.BUCKET.get(id);need(file,'Originaldatei nicht verfügbar.',503);need(digest(file.body)===row.sha256,'Belegprüfung fehlgeschlagen.',503);
    await advisorStillActive(env,context);await advisorAudit(env,context.actor,'DOWNLOAD_DOCUMENT',id).run();
    return new Response(file.body,{headers:{'Content-Type':row.mime,'Content-Disposition':'attachment','Cache-Control':'no-store'}});
  }
  if(request.method==='GET'&&route==='/invoice-pdf'){
    const row=await env.DB.prepare(`SELECT a.id,a.hash FROM invoice_documents d JOIN orders o ON o.id=d.order_id
      JOIN assets a ON a.id=d.asset_id AND a.order_id=o.id AND a.kind='invoice'
      WHERE o.id=? AND d.invoice_id=? AND o.synthetic=0`).bind(url.searchParams.get('orderId')??'',url.searchParams.get('invoiceId')??'').first();
    need(row,'Rechnungsoriginal ist noch nicht im Panel archiviert. Bitte den Betreiber um Abruf bitten.',404);
    const file=await env.BUCKET.get(row.id);need(file&&digest(file.body)===row.hash,'Rechnungsoriginal fehlt oder Integritätsprüfung fehlgeschlagen.',503);
    await advisorStillActive(env,context);await advisorAudit(env,context.actor,'DOWNLOAD_INVOICE',url.searchParams.get('invoiceId')).run();
    return new Response(file.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="Rechnung.pdf"','Cache-Control':'no-store'}});
  }
  if(route==='/comments')return comments(env,request,context,url);
  if(route==='/proposals'&&request.method==='POST')return submitProposal(env,request,context);
  if(route==='/decision'&&request.method==='POST')return decide(env,request,context);
  if(route==='/proposals'&&request.method==='GET'){
    const rows=(await env.DB.prepare(`SELECT p.rowid AS cursor,p.*,a.company,a.email,d.decision,d.created_at AS decided_at
      FROM advisor_proposals p LEFT JOIN advisor_decisions d ON d.proposal_id=p.id LEFT JOIN advisor_accounts a ON p.actor='advisor:'||a.id
      WHERE p.rowid<? ORDER BY p.rowid DESC LIMIT 51`).bind(numeric(url.searchParams.get('cursor'),Number.MAX_SAFE_INTEGER)).all()).results;
    const items=[];
    for(const row of rows.slice(0,50)){
      const document=row.target_kind==='document';
      const current=await env.DB.prepare(queries[document?'documents':'bank']+(document?' AND d.id=?':' AND r.revision_id=?'))
        .bind(document?row.target_id:Number(row.target_id)).first();
      items.push({...row,payload:JSON.parse(row.payload),current});
    }
    return advisorJSON({items,nextCursor:rows.length>50?String(items.at(-1).cursor):null});
  }
  return advisorJSON({error:'Funktion nicht gefunden.'},404);
}

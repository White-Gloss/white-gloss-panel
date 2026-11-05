// KI ausschließlich als nachvollziehbarer Prüfvorschlag. Keine automatische
// Klassifikation, Auftragsänderung, Preisfreigabe oder Kundenkommunikation.
import {createHash,randomUUID} from 'node:crypto';
import {protect,unprotect,getOrder} from '../src/worker.mjs';
import {AppError,need,text} from '../src/domain.mjs';
import {assertRecordOperation} from '../src/record-compat.mjs';
import {CATEGORIES,PAYMENT_PATHS} from './accounting.mjs';

const ROOT='/api/assistant',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const nullableString={type:['string','null']};
const base=(properties)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const schemas={
  receipt:base({category:{type:'string',enum:CATEGORIES},paymentPath:{type:'string',enum:PAYMENT_PATHS},amountMinor:{type:['integer','null']},documentDate:nullableString,partner:{type:'string'},note:{type:'string'},confidence:{type:'number'},warnings:{type:'array',items:{type:'string'}}}),
  text:base({correctedText:{type:'string'},changes:{type:'array',items:{type:'string'}},note:{type:'string'}}),
  vehicle:base({conditionSummary:{type:'string'},findings:{type:'array',items:base({area:{type:'string'},observation:{type:'string'},severity:{type:'string',enum:['keine','leicht','mittel','stark','unklar']},calculationHint:{type:'string'}})},uncertainties:{type:'array',items:{type:'string'}},calculationNote:{type:'string'}})
};
const prompts={
  receipt:'Lies nur diesen Beleg aus. Erkenne Lieferant, Datum und Bruttobetrag in Cent. Unbekannte Werte sind null oder leer. Kategorie und Zahlungsweg sind lediglich Vorschläge. Keine steuerliche Prüfung behaupten, keine Werte schätzen und Unsicherheiten in warnings nennen.',
  text:'Korrigiere ausschließlich deutsche Rechtschreibung, Grammatik und offensichtliche Zeichensetzung. Bewahre Inhalt, Ton, Namen, Termine, Preise und Zahlen exakt. Keine neuen Zusagen oder Fakten ergänzen. Gib den korrigierten Text und eine kurze Änderungsliste zurück.',
  vehicle:'Analysiere nur sichtbare Fahrzeugmerkmale für eine interne Detailing-Kalkulation. Beschreibe Beobachtungen ohne Schadensdiagnose und ohne Preis. Nenne Unsicherheiten durch Licht, Bildqualität und fehlende Perspektiven. Keine Kundenbotschaft formulieren und keinen Festpreis vorschlagen.'
};
const PROVIDERS={
  openai:{label:'OpenAI / ChatGPT',base:'https://api.openai.com/v1',mode:'responses',models:['gpt-6-astra','gpt-4o','gpt-4o-mini']},
  xai:{label:'xAI / Grok',base:'https://api.x.ai/v1',mode:'chat',models:['grok-4','grok-3']},
  openrouter:{label:'OpenRouter',base:'https://openrouter.ai/api/v1',mode:'chat',models:['openai/gpt-4o-mini','x-ai/grok-4']},
  groq:{label:'Groq',base:'https://api.groq.com/openai/v1',mode:'chat',models:['llama-3.3-70b-versatile']},
  mistral:{label:'Mistral',base:'https://api.mistral.ai/v1',mode:'chat',models:['mistral-large-latest','pixtral-large-latest']},
  gemini:{label:'Google / Gemini',base:'https://generativelanguage.googleapis.com/v1beta/openai',mode:'chat',models:['gemini-3.8-flash','gemini-2.5-flash-lite']},
  compatible:{label:'Andere KI',base:null,mode:'chat',models:[]}
};
export function assistantProviderChoices(){return Object.entries(PROVIDERS).map(([id,item])=>({id,label:item.label,models:item.models}));}
function providerTarget(input,old){
  const provider=text(input.provider||old?.provider||'openai',40);need(PROVIDERS[provider],'Unbekannter KI-Anbieter.',400);
  if(provider!=='compatible'){need(!text(input.baseUrl,300),'Diese KI hat eine feste Adresse.',400);return {provider,base:PROVIDERS[provider].base,mode:PROVIDERS[provider].mode,stored:null};}
  let url;try{url=new URL(text(input.baseUrl||old?.base_url,300));}catch{throw new AppError('KI-Adresse ist ungültig.',400);}
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&(url.pathname==='/'||url.pathname===''),'KI-Adresse muss ein reiner HTTPS-Ursprung ohne Schlüssel sein.',400);
  return {provider,base:url.origin+'/v1',mode:'chat',stored:url.origin};
}
function chatBody(payload){
  const content=[];
  for(const part of payload.input?.[0]?.content??[]){
    if(part.type==='input_text')content.push({type:'text',text:part.text});
    else if(part.type==='input_image')content.push({type:'image_url',image_url:{url:part.image_url}});
    else if(part.type==='input_file')throw new AppError('PDF-Belege kann diese KI nicht direkt lesen. Dafür OpenAI oder Google Gemini nutzen oder ein Foto senden.',409);
    else throw new AppError('Diese KI unterstützt den Inhalt nicht.',409);
  }
  return {model:payload.model,messages:[{role:'user',content}],response_format:{type:'json_object'},max_tokens:payload.max_output_tokens??2000};
}
function asResponses(data){
  const message=data.choices?.[0]?.message?.content,textValue=typeof message==='string'?message:JSON.stringify(message??'');
  return {id:data.id,status:data.choices?.[0]?.finish_reason==='stop'?'completed':'incomplete',model:data.model,output:[{type:'message',content:[{type:'output_text',text:textValue}]}]};
}
function geminiOutputText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text;
  const steps=Array.isArray(data?.steps)?data.steps:[];
  const content=steps.at(-1)?.content??[];
  return (Array.isArray(content)?content:[]).map(item=>typeof item?.text==='string'?item.text:'').filter(Boolean).join('');
}
async function geminiDocument(config,payload){
  const parts=payload.input?.flatMap(item=>item?.content??[])??[];
  const files=parts.filter(part=>part.type==='input_file');
  need(files.length===1,'Es kann nur ein PDF-Beleg geprüft werden.',409);
  const match=/^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(files[0].file_data??'');
  need(match,'PDF-Beleg hat kein lesbares Format.',409);
  const bytes=Buffer.from(match[1],'base64');
  need(bytes.length>0&&bytes.length<=12000000,'PDF-Beleg ist leer oder zu groß für die direkte Gemini-Prüfung.',413);
  const prompt=parts.filter(part=>part.type==='input_text').map(part=>part.text).join('\n')+'\nAntworte ausschließlich mit dem JSON-Objekt, ohne Markdown.';
  const result=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json','x-goog-api-key':config.apiKey,'Api-Revision':'2026-05-20'},body:JSON.stringify({model:payload.model,input:[{type:'document',data:match[1].replace(/\s/g,''),mime_type:'application/pdf'},{type:'text',text:prompt}]})});
  need(![301,302,303,307,308].includes(result.status),'Weiterleitung der KI-Adresse ist nicht erlaubt.',502);
  need(result.ok,'KI-Analyse fehlgeschlagen: HTTP '+result.status,502);
  const raw=await result.text();need(raw.length<=2000000,'KI-Antwort ist zu groß.',502);
  let data;try{data=JSON.parse(raw);}catch{throw new AppError('KI-Antwort konnte nicht gelesen werden.',502);}
  const textValue=geminiOutputText(data).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  need(textValue,'KI-Antwort enthält kein lesbares Ergebnis.',502);
  return {id:typeof data.id==='string'?data.id:'gemini-document',status:'completed',model:data.model||payload.model,output:[{type:'message',content:[{type:'output_text',text:textValue}]}]};
}
export async function completeAssistant(env,config,payload){
  if(env.ASSISTANT_ADAPTERS?.analyze)return env.ASSISTANT_ADAPTERS.analyze(config,payload);
  if(config.provider==='gemini'&&payload.input?.some(item=>item?.content?.some(part=>part.type==='input_file')))return geminiDocument(config,payload);
  const responses=config.mode==='responses',result=await fetch(config.base+(responses?'/responses':'/chat/completions'),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},body:JSON.stringify(responses?payload:chatBody(payload)),redirect:'manual',signal:AbortSignal.timeout(90000)});
  need(![301,302,303,307,308].includes(result.status),'Weiterleitung der KI-Adresse ist nicht erlaubt.',502);need(result.ok,'KI-Analyse fehlgeschlagen: HTTP '+result.status,502);
  const raw=await result.text();need(raw.length<=2000000,'KI-Antwort ist zu groß.',502);let data;try{data=JSON.parse(raw);}catch{throw new AppError('KI-Antwort konnte nicht gelesen werden.',502);}return responses?data:asResponses(data);
}

export async function assistantSchema(env){
  await env.DB.batch([
    `CREATE TABLE IF NOT EXISTS assistant_settings(
      id INTEGER PRIMARY KEY CHECK(id=1),api_key TEXT NOT NULL,model TEXT NOT NULL,
      data_approved INTEGER NOT NULL CHECK(data_approved IN (0,1)),verified_at TEXT,last_error TEXT,updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS assistant_suggestions(
      id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('receipt','text','vehicle')),
      source_id TEXT NOT NULL,source_hash TEXT NOT NULL,synthetic INTEGER NOT NULL CHECK(synthetic IN (0,1)),
      provider_response_id TEXT,model TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,actor TEXT NOT NULL)`,
    'CREATE INDEX IF NOT EXISTS assistant_suggestions_source ON assistant_suggestions(source_id,created_at DESC)',
    `CREATE TRIGGER IF NOT EXISTS no_assistant_suggestions_update BEFORE UPDATE ON assistant_suggestions BEGIN SELECT RAISE(ABORT,'KI-Prüfvorschläge sind unveränderlich'); END`,
    `CREATE TRIGGER IF NOT EXISTS no_assistant_suggestions_delete BEFORE DELETE ON assistant_suggestions BEGIN SELECT RAISE(ABORT,'KI-Prüfvorschläge werden nicht gelöscht'); END`
  ].map(sql=>env.DB.prepare(sql)));
  const columns=new Set(((await env.DB.prepare("SELECT name FROM pragma_table_info('assistant_settings')").all()).results??[]).map(row=>row.name));
  if(!columns.has('provider'))await env.DB.prepare("ALTER TABLE assistant_settings ADD COLUMN provider TEXT NOT NULL DEFAULT 'openai'").run();
  if(!columns.has('base_url'))await env.DB.prepare('ALTER TABLE assistant_settings ADD COLUMN base_url TEXT').run();
}
async function bodyJSON(request){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=100000,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}
  catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.',400);}
}
function publicSettings(row){return {providers:assistantProviderChoices(),provider:row?.provider||'openai',baseUrl:row?.provider==='compatible'?row.base_url:'',configured:Boolean(row?.api_key),model:row?.model||'gpt-6-astra',dataApproved:row?.data_approved===1,verifiedAt:row?.verified_at??null,lastError:row?.last_error??null,updatedAt:row?.updated_at??null};}
export async function assistantCredentials(env){const row=await env.DB.prepare('SELECT * FROM assistant_settings WHERE id=1').first();need(row?.api_key,'KI-Verbindung ist noch nicht eingerichtet.',409);let apiKey;try{apiKey=await unprotect(env,row.api_key);}catch{throw new AppError('KI-Schlüssel kann nicht entschlüsselt werden. Bitte erneut geschützt speichern.',503);}need(apiKey,'KI-Schlüssel fehlt.',409);const target=providerTarget({provider:row.provider||'openai',baseUrl:row.provider==='compatible'?row.base_url:''},row);return {row,apiKey,config:{apiKey,model:row.model,provider:target.provider,base:target.base,mode:target.mode}};}
function suggestionView(row){return {id:row.id,kind:row.kind,sourceId:row.source_id,sourceHash:row.source_hash,synthetic:row.synthetic===1,providerResponseId:row.provider_response_id,model:row.model,result:JSON.parse(row.result_json),createdAt:row.created_at,actor:row.actor};}
async function saveSettings(env,input){
  const old=await env.DB.prepare('SELECT * FROM assistant_settings WHERE id=1').first(),model=text(input.model||old?.model||'gpt-6-astra',100),rawKey=text(input.apiKey,500),target=providerTarget(input,old);
  need(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(model),'Modellname ist ungültig.');
  const apiKey=rawKey?await protect(env,rawKey):old?.api_key??'';need(apiKey,'KI-Schlüssel fehlt.',400);
  const changed=!old||old.model!==model||(old.provider||'openai')!==target.provider||(old.base_url??'')!==(target.stored??'')||Boolean(rawKey),at=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO assistant_settings(id,api_key,model,data_approved,verified_at,last_error,updated_at,provider,base_url) VALUES(1,?,?,?,?,NULL,?,?,?)
    ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key,model=excluded.model,data_approved=excluded.data_approved,verified_at=excluded.verified_at,last_error=NULL,updated_at=excluded.updated_at,provider=excluded.provider,base_url=excluded.base_url`)
    .bind(apiKey,model,input.dataApproved===true?1:0,changed?null:old.verified_at,at,target.provider,target.stored).run();
  return {ok:true,message:'KI-Verbindung geschützt gespeichert. Bitte Verbindung prüfen, bevor Inhalte analysiert werden.'};
}
async function check(env){
  const {row,config}=await assistantCredentials(env),at=new Date().toISOString();let error=null;
  try{
    if(env.ASSISTANT_ADAPTERS?.check)await env.ASSISTANT_ADAPTERS.check(config);
    else{const result=await fetch(config.base+'/models'+(config.mode==='responses'?'/'+encodeURIComponent(row.model):''),{headers:{Authorization:'Bearer '+config.apiKey},redirect:'manual',signal:AbortSignal.timeout(15000)});need(![301,302,303,307,308].includes(result.status),'Weiterleitung der KI-Adresse ist nicht erlaubt.',502);need(result.ok,'KI-Verbindung fehlgeschlagen: HTTP '+result.status,502);void result.body?.cancel().catch(()=>{});}
  }catch(cause){error=cause instanceof AppError?cause.message:'KI-Dienst ist nicht erreichbar. Die Verbindung wurde nicht bestätigt.';}
  await env.DB.prepare('UPDATE assistant_settings SET verified_at=?,last_error=?,updated_at=? WHERE id=1').bind(error?null:at,error,at).run();need(!error,error,502);
  return {ok:true,message:'KI-Modell erfolgreich lesend geprüft. Es wurden keine Inhalte zur Analyse übertragen.'};
}
function validateResult(kind,value){
  need(value&&typeof value==='object'&&!Array.isArray(value),'KI-Antwort hat kein gültiges Ergebnis.',502);
  if(kind==='receipt'){
    need(CATEGORIES.includes(value.category)&&PAYMENT_PATHS.includes(value.paymentPath),'KI-Kategorie oder Zahlungsweg ist ungültig.',502);
    need(value.amountMinor===null||(Number.isSafeInteger(value.amountMinor)&&value.amountMinor>=0&&value.amountMinor<=1000000000),'KI-Betrag ist ungültig.',502);
    need(value.documentDate===null||(/^\d{4}-\d{2}-\d{2}$/.test(value.documentDate)&&!Number.isNaN(Date.parse(value.documentDate+'T00:00:00Z'))),'KI-Datum ist ungültig.',502);
    need(Number.isFinite(value.confidence)&&value.confidence>=0&&value.confidence<=1,'KI-Konfidenz ist ungültig.',502);
    return {category:value.category,paymentPath:value.paymentPath,amountMinor:value.amountMinor,documentDate:value.documentDate,partner:text(value.partner,180),note:text(value.note,1000),confidence:value.confidence,warnings:Array.isArray(value.warnings)?value.warnings.slice(0,12).map(item=>text(item,500)):[]};
  }
  if(kind==='text')return {correctedText:text(value.correctedText,20000),changes:Array.isArray(value.changes)?value.changes.slice(0,30).map(item=>text(item,500)):[],note:text(value.note,1000)};
  return {conditionSummary:text(value.conditionSummary,5000),findings:Array.isArray(value.findings)?value.findings.slice(0,30).map(item=>({area:text(item?.area,180),observation:text(item?.observation,1500),severity:['keine','leicht','mittel','stark','unklar'].includes(item?.severity)?item.severity:'unklar',calculationHint:text(item?.calculationHint,1000)})):[],uncertainties:Array.isArray(value.uncertainties)?value.uncertainties.slice(0,20).map(item=>text(item,1000)):[],calculationNote:text(value.calculationNote,2000)};
}
function outputJSON(data){
  need(data?.status==='completed','KI-Analyse ist unvollständig oder wurde abgelehnt.',502);
  const refusal=data.output?.flatMap(item=>item?.content??[]).find(item=>item?.type==='refusal');need(!refusal,'KI-Analyse wurde vom Anbieter abgelehnt.',502);
  const raw=data.output?.flatMap(item=>item?.content??[]).filter(item=>item?.type==='output_text').map(item=>item.text).join('');need(raw&&raw.length<=200000,'KI-Antwort enthält kein lesbares Ergebnis.',502);
  try{return JSON.parse(raw);}catch{throw new AppError('KI-Antwort ist kein gültiges JSON.',502);}
}
async function sourceForAnalysis(env,input,synthetic){
  if(input.kind==='text'){
    const original=text(input.text,20000);need(original,'Text zur Korrektur fehlt.');return {sourceId:'text',sourceHash:hash(original),content:[{type:'input_text',text:original}]};
  }
  need(UUID.test(input.sourceId??''),'Quelle für die Analyse nicht gefunden.',404);
  if(input.kind==='receipt'){
    const row=await env.DB.prepare('SELECT * FROM accounting_documents WHERE id=?').bind(input.sourceId).first();need(row&&row.synthetic===synthetic,'Beleg nicht gefunden.',404);
    const file=await env.BUCKET.get(row.id);need(file&&hash(file.body)===row.sha256,'Beleg fehlt oder die Integritätsprüfung ist fehlgeschlagen.',503);
    const data='data:'+row.mime+';base64,'+Buffer.from(file.body).toString('base64');
    return {sourceId:row.id,sourceHash:row.sha256,content:[row.mime==='application/pdf'?{type:'input_file',filename:text(row.filename,180),file_data:data,detail:'high'}:{type:'input_image',image_url:data,detail:'high'}]};
  }
  const row=await env.DB.prepare("SELECT * FROM assets WHERE id=? AND kind IN ('booking','photo')").bind(input.sourceId).first();need(row&&['image/jpeg','image/png','image/webp'].includes(row.mime),'Fahrzeugfoto nicht gefunden oder Dateityp nicht unterstützt.',404);
  const order=await getOrder(env,row.order_id);need(order.synthetic===Boolean(synthetic),'Fahrzeugfoto gehört nicht zu diesem Bereich.',404);assertRecordOperation(order,'assistant');
  const file=await env.BUCKET.get(row.id);need(file&&hash(file.body)===row.hash,'Fahrzeugfoto fehlt oder die Integritätsprüfung ist fehlgeschlagen.',503);
  return {sourceId:row.id,sourceHash:row.hash,content:[{type:'input_image',image_url:'data:'+row.mime+';base64,'+Buffer.from(file.body).toString('base64'),detail:'high'}]};
}
async function analyze(env,input,synthetic){
  need(['receipt','text','vehicle'].includes(input.kind),'Unbekannte Analyseart.');need(input.confirmed===true,'Bitte die Übertragung an den KI-Anbieter ausdrücklich bestätigen.');need(UUID.test(input.requestId??''),'Analyse-ID fehlt oder ist ungültig.');
  const {row,config}=await assistantCredentials(env);need(row.data_approved===1,'Bitte zuerst die Übertragung von Inhalten an den KI-Anbieter in den KI-Einstellungen freigeben.',409);need(row.verified_at,'KI-Verbindung zuerst erfolgreich prüfen.',409);
  const source=await sourceForAnalysis(env,input,synthetic?1:0),requestHash=hash(JSON.stringify({kind:input.kind,sourceId:source.sourceId,sourceHash:source.sourceHash}));
  const previous=await env.DB.prepare('SELECT * FROM assistant_suggestions WHERE request_id=?').bind(input.requestId).first();if(previous){need(previous.request_hash===requestHash,'Diese Analyse-ID wurde bereits für andere Inhalte verwendet.',409);return {ok:true,duplicate:true,suggestion:suggestionView(previous)};}
  need(!synthetic||env.ASSISTANT_ADAPTERS?.analyze,'Im Testbereich werden keine echten Inhalte an einen KI-Anbieter übertragen.',409);
  const payload={model:row.model,store:false,input:[{role:'user',content:[...source.content,{type:'input_text',text:prompts[input.kind]}]}],text:{format:{type:'json_schema',name:'white_gloss_'+input.kind+'_review',strict:true,schema:schemas[input.kind]}},max_output_tokens:3000};
  let data;if(env.ASSISTANT_ADAPTERS?.analyze)data=await env.ASSISTANT_ADAPTERS.analyze(config,payload);else data=await completeAssistant({...env,ASSISTANT_ADAPTERS:null},config,payload);
  const result=validateResult(input.kind,outputJSON(data)),id=randomUUID(),at=new Date().toISOString();
  await env.DB.prepare('INSERT INTO assistant_suggestions(id,request_id,request_hash,kind,source_id,source_hash,synthetic,provider_response_id,model,result_json,created_at,actor) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id,input.requestId,requestHash,input.kind,source.sourceId,source.sourceHash,synthetic?1:0,text(data.id,180)||null,text(data.model||row.model,100),JSON.stringify(result),at,'owner').run();
  return {ok:true,suggestion:suggestionView(await env.DB.prepare('SELECT * FROM assistant_suggestions WHERE id=?').bind(id).first())};
}
export async function handleAssistant(env,request,isOwner){
  const url=new URL(request.url),path=url.pathname;if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;need(isOwner,'Nur für den Betreiber vorgesehen.',403);
  if(request.method==='GET'&&path===ROOT){const source=text(url.searchParams.get('source'),100),synthetic=url.searchParams.get('test')==='true'?1:0,settings=await env.DB.prepare('SELECT * FROM assistant_settings WHERE id=1').first();const rows=source?(await env.DB.prepare('SELECT * FROM assistant_suggestions WHERE source_id=? AND synthetic=? ORDER BY created_at DESC LIMIT 20').bind(source,synthetic).all()).results:(await env.DB.prepare('SELECT * FROM assistant_suggestions WHERE synthetic=? ORDER BY created_at DESC LIMIT 50').bind(synthetic).all()).results;return response({settings:publicSettings(settings),suggestions:rows.map(suggestionView)});}
  if(request.method==='POST'&&path===ROOT+'/settings')return response(await saveSettings(env,await bodyJSON(request)));
  if(request.method==='POST'&&path===ROOT+'/check'){await bodyJSON(request);return response(await check(env));}
  if(request.method==='POST'&&path===ROOT+'/analyze')return response(await analyze(env,await bodyJSON(request),url.searchParams.get('test')==='true'));
  return response({error:'Funktion nicht gefunden.'},404);
}

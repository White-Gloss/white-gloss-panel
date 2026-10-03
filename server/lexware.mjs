import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {configuration,settings,getOrder,saveOrder,claimJob,init} from '../src/worker.mjs';
import {AppError,need,cents} from '../src/domain.mjs';

const base='https://api.lexware.io';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const email=value=>String(value??'').trim().toLowerCase();
const queues=new Map();
const day=iso=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const amount=value=>{const string=String(value);need(/^\d+(?:\.\d{1,2})?$/.test(string),'Lexware-Betrag ist nicht centgenau.',502);const parts=string.split('.');return cents(Number(parts[0])*100+Number((parts[1]??'').padEnd(2,'0')));};
const bounded=(value,max,message)=>{need(typeof value==='string'&&value.trim().length>0&&value.trim().length<=max,message);return value.trim();};
async function sharedRate(config,key){
  need(config._DB,'Gemeinsame Lexware-Anfragesperre fehlt.',503);await config._DB.prepare('INSERT OR IGNORE INTO lexware_request_rate(name,next_at) VALUES(?,0)').bind(key).run();const deadline=Date.now()+60000;
  while(Date.now()<deadline){const row=await config._DB.prepare('SELECT next_at FROM lexware_request_rate WHERE name=?').bind(key).first();need(row&&Number.isSafeInteger(row.next_at),'Lexware-Anfragesperre ist beschädigt.',503);const now=Date.now();if(row.next_at>now){await delay(Math.min(550,row.next_at-now));continue;}const result=await config._DB.prepare('UPDATE lexware_request_rate SET next_at=? WHERE name=? AND next_at=?').bind(now+550,key,row.next_at).run();if(result.meta.changes===1)return;}
  throw new AppError('Lexware ist gerade ausgelastet. Bitte den lesenden Abgleich später ausführen.',429);
}

// One queue per credential also throttles concurrent webhook and manual requests.
// Mutating requests are never retried, including HTTP 504 and missing response IDs.
/**
 * @param {{lexwareKey?:string,lexwareVerified?:boolean,lexwareOrganizationId?:string,[key:string]:any}} config
 * @param {string} path
 * @param {RequestInit & {beforeSend?:()=>Promise<void>|void}} options
 */
export async function lexwareRequest(config,path,options={}){
  need(typeof config.lexwareKey==='string'&&config.lexwareKey.length>0,'Lexware-API-Schlüssel fehlt.',409);
  need(typeof path==='string'&&path.startsWith('/v1/')&&!path.includes('://'),'Ungültiger Lexware-Endpunkt.');
  const key=hash(config.lexwareKey),queue=queues.get(key)??{tail:Promise.resolve(),next:0};queues.set(key,queue);
  const {beforeSend,...requestOptions}=options;
  const result=queue.tail.then(async()=>{
    const wait=queue.next-Date.now();if(wait>0)await delay(wait);await sharedRate(config,key);
    if(beforeSend)await beforeSend();queue.next=Date.now()+550;
    return fetch(base+path,{...requestOptions,headers:{Authorization:'Bearer '+config.lexwareKey,Accept:'application/json',...(requestOptions.body?{'Content-Type':'application/json'}:{}),...requestOptions.headers},redirect:'manual',signal:AbortSignal.timeout(35000)});
  });queue.tail=result.then(()=>{},()=>{});return result;
}
async function limitedBytes(response,max){
  const length=response.headers.get('content-length');need(!length||/^\d+$/.test(length)&&Number(length)<=max,'Lexware-Datei oder Antwort ist zu groß.',502);
  need(response.body,'Lexware hat keine lesbare Antwort geliefert.',502);const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;need(size<=max,'Lexware-Datei oder Antwort ist zu groß.',502);chunks.push(result.value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  return Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),size);
}
/**
 * @param {{lexwareKey?:string,lexwareVerified?:boolean,lexwareOrganizationId?:string,[key:string]:any}} config
 * @param {string} path
 * @param {RequestInit & {beforeSend?:()=>Promise<void>|void}} options
 */
export async function lexwareJSON(config,path,options={}){
  const response=await lexwareRequest(config,path,options);need(response.ok,'Lexware-Anfrage nicht bestätigt: HTTP '+response.status,502);
  let data;try{data=JSON.parse((await limitedBytes(response,2*1024*1024)).toString('utf8'));}catch(error){if(error instanceof AppError)throw error;throw new AppError('Lexware-Antwort ist nicht lesbar.',502);}
  need(data&&typeof data==='object'&&!Array.isArray(data),'Lexware-Antwort ist unvollständig.',502);return data;
}
function profileValid(profile){need(uuid(profile.organizationId)&&typeof profile.companyName==='string'&&profile.companyName.trim(),'Lexware-Organisation nicht bestätigt.',502);need(Array.isArray(profile.businessFeatures)&&profile.businessFeatures.some(feature=>['INVOICING','INVOICING_PRO'].includes(feature)),'Das Lexware-Konto bietet keine Rechnungsfunktion.',409);return profile;}
async function access(env){
  await lexwareSchema(env);const config=await configuration(env,['lexwareKey']);config._DB=env.DB;need(config.lexwareVerified===true&&uuid(config.lexwareOrganizationId)&&config.lexwareKey,'Bitte Lexware Office zuerst mit dem API-Schlüssel prüfen.',409);
  const profile=profileValid(await lexwareJSON(config,'/v1/profile'));need(profile.organizationId===config.lexwareOrganizationId,'Der Lexware-Schlüssel gehört zu einer anderen Organisation. Verbindung erneut prüfen.',409);return {config,profile};
}
export async function lexwareCheck(env){
  await lexwareSchema(env);const config=await configuration(env,['lexwareKey']);config._DB=env.DB;const profile=profileValid(await lexwareJSON(config,'/v1/profile'));
  need(!config.lexwareOrganizationId||config.lexwareOrganizationId===profile.organizationId,'Lexware-Organisation hat sich geändert. Bestehende Rechnungszuordnung zuerst klären.',409);
  const current=await configuration(env,['lexwareKey']);need(current.lexwareKey===config.lexwareKey&&current.lexwareOrganizationId===config.lexwareOrganizationId,'Lexware-Verbindung wurde während der Prüfung verändert. Erneut prüfen.',409);
  await env.DB.batch([env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('lexwareVerified','true'),env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('lexwareOrganizationId',JSON.stringify(profile.organizationId)),env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('lexwareConnectionId',JSON.stringify(uuid(profile.connectionId)?profile.connectionId:null)),env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('lexwareProfile',JSON.stringify({organizationId:profile.organizationId,companyName:profile.companyName,taxType:profile.taxType,smallBusiness:profile.smallBusiness,businessFeatures:profile.businessFeatures,at:new Date().toISOString()}))]);
  return {ok:true,organizationId:profile.organizationId,connectionId:profile.connectionId,companyName:profile.companyName,taxType:profile.taxType,smallBusiness:profile.smallBusiness};
}
export async function lexwareSchema(env){await init(env);await env.DB.batch([env.DB.prepare('CREATE TABLE IF NOT EXISTS invoice_claims(order_id TEXT PRIMARY KEY,provider TEXT NOT NULL,job_id TEXT,marker TEXT NOT NULL,org_id TEXT NOT NULL,client_id TEXT,payload TEXT,payload_hash TEXT,provider_id TEXT,stage TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(org_id,provider_id))'),env.DB.prepare('CREATE TABLE IF NOT EXISTS lexware_request_rate(name TEXT PRIMARY KEY,next_at INTEGER NOT NULL)')]);}
async function pages(config,path){
  const rows=[],ids=new Set();let total=null,totalPages=null;
  for(let page=0;page<100;page++){
    const url=new URL(base+path);url.searchParams.set('page',String(page));url.searchParams.set('size','100');
    const data=await lexwareJSON(config,url.pathname+url.search);
    need(Array.isArray(data.content)&&Number.isInteger(data.totalElements)&&data.totalElements>=0&&data.totalElements<=10000&&Number.isInteger(data.totalPages)&&data.totalPages>=0&&data.totalPages<=100&&data.number===page&&data.numberOfElements===data.content.length&&typeof data.last==='boolean','Lexware-Paginierung ist unvollständig.',502);
    if(total===null){total=data.totalElements;totalPages=Math.max(1,data.totalPages);}else need(total===data.totalElements&&totalPages===Math.max(1,data.totalPages),'Lexware-Bestand wurde während der Prüfung geändert. Bitte erneut lesen.',409);
    need(data.last===(page===totalPages-1),'Lexware-Paginierung widerspricht dem Gesamtbestand.',502);
    for(const row of data.content){need(uuid(row.id)&&!ids.has(row.id),'Lexware-ID fehlt oder ist doppelt.',502);ids.add(row.id);rows.push(row);}
    if(data.last){need(rows.length===total,'Nicht alle Lexware-Einträge wurden gelesen.',502);return rows;}
  }
  throw new AppError('Lexware-Bestand ist zu groß für einen vollständigen Abgleich.',409);
}
function clientEmails(client){return [...Object.values(client.emailAddresses??{}).flat(),...(client.company?.contactPersons??[]).map(person=>person.emailAddress)].map(email);}
const contactPath=order=>'/v1/contacts?customer=true&email='+encodeURIComponent(email(order.source.email).replace(/[\\_%]/g,character=>'\\'+character));
function clientMatch(client,order,org){return client.organizationId===org&&client.archived!==true&&client.roles?.customer&&clientEmails(client).includes(email(order.source.email));}
export function lexwareInvoiceAddress(client){const address=client.addresses?.billing?.[0]??{};return {name:client.company?.name??[client.person?.firstName,client.person?.lastName].filter(Boolean).join(' '),supplement:address.supplement??'',street:address.street??'',city:address.city??'',zip:address.zip??'',countryCode:address.countryCode??''};}
export function lexwareClientReviewHash(client,order){return hash({id:client.id,organizationId:client.organizationId,identity:contactSnapshot(client),billing:(client.addresses?.billing??[]).map(address=>({supplement:address.supplement??'',street:address.street??'',city:address.city??'',zip:address.zip??'',countryCode:address.countryCode??''})),email:email(order.source.email),emails:clientEmails(client).sort(),archived:client.archived===true,customer:!!client.roles?.customer,xRechnung:client.xRechnung??null});}
function clientView(client,order){const address=client.addresses?.billing?.[0];return {id:client.id,name:client.company?.name??[client.person?.firstName,client.person?.lastName].filter(Boolean).join(' '),email:email(order.source.email),currency:'EUR',billing_address:address?{street_address:address.street??'',city:address.city??'',zip_code:address.zip??'',country_code:address.countryCode??''}:null,xRechnung:!!client.xRechnung?.buyerReference,reviewHash:lexwareClientReviewHash(client,order)};}
async function inventory(config,profile,order){
  need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.source.email??''),'Kunden-E-Mail fehlt.');
  const contacts=await pages(config,contactPath(order));need(contacts.every(client=>client.organizationId===profile.organizationId),'Lexware-Kundenbestand enthält eine fremde Organisation.',502);
  return {clients:contacts.filter(client=>clientMatch(client,order,profile.organizationId)).map(client=>clientView(client,order)),organizationId:profile.organizationId};
}
export async function lexwareInventory(env,order){need(!order.synthetic,'Testaufträge haben keine externen Rechnungskunden.',409);const {config,profile}=await access(env);return inventory(config,profile,order);}
export const lexwareMarker=order=>'[White-Gloss-Auftrag '+bounded(order.wg,80,'WG-Nummer fehlt.')+' | Panel '+bounded(order.id,80,'Panel-Auftrags-ID fehlt.')+']';
function eligible(order,input){
  need(input.provider==='lexware','Bitte Lexware Office als Rechnungsanbieter auswählen.',409);
  need(!order.synthetic&&['Erledigt','Bezahlt'].includes(order.status)&&order.return&&order.completedAt,'Rechnung erst nach vollständigem Arbeitsabschluss und Rückgabe.',409);
  need(input.reviewed===true,'Bitte Rechnungskunde, Leistungen, Steuer und Gesamtbetrag ausdrücklich prüfen.');
  need([0,700,1900].includes(input.vatBasisPoints),'Bitte den gültigen deutschen Umsatzsteuersatz ausdrücklich auswählen.');
  need(input.vatBasisPoints>0||typeof input.vatExemptionReason==='string'&&input.vatExemptionReason.trim().length>0&&input.vatExemptionReason.length<=500,'Bei steuerfreier Rechnung ist die geprüfte Begründung erforderlich.');
  need(Number.isFinite(Date.parse(order.completedAt)),'Arbeitsabschlussdatum fehlt.',409);
}
export function lexwareInvoicePayload(order,input,clientId,now=new Date().toISOString()){
  eligible(order,input);need(uuid(clientId),'Lexware-Rechnungskunde fehlt.');
  const issueDate=day(now);need(date(input.dueDate)&&input.dueDate>=issueDate,'Fälligkeit muss ein gültiges Datum am oder nach dem Rechnungsdatum sein.');
  const duration=Math.round((Date.parse(input.dueDate)-Date.parse(issueDate))/86400000);need(duration<=3650,'Fälligkeit liegt zu weit in der Zukunft.');
  const lines=order.offer?.lines;need(Array.isArray(lines)&&lines.length>0&&lines.length<=300,'Bestätigte Angebotspositionen fehlen.',409);const total=cents(order.offer.totalCents);
  need(lines.reduce((sum,line)=>sum+cents(line.amountCents),0)===total,'Angebotspositionen stimmen nicht mit dem bestätigten Festpreis überein.',409);
  const vatfree=input.vatBasisPoints===0;
  return {voucherDate:now,address:{contactId:clientId},lineItems:lines.map(line=>({type:'custom',name:bounded(line.title,200,'Positionsname fehlt.'),description:String(line.description??'').slice(0,2000),quantity:1,unitName:'Leistung',unitPrice:{currency:'EUR',[vatfree?'netAmount':'grossAmount']:line.amountCents/100,taxRatePercentage:input.vatBasisPoints/100},discountPercentage:0})),totalPrice:{currency:'EUR'},taxConditions:vatfree?{taxType:'vatfree',taxTypeNote:input.vatExemptionReason.trim()}:{taxType:'gross'},paymentConditions:{paymentTermDuration:duration,paymentTermLabel:'Zahlbar bis '+input.dueDate+' ohne Abzug.'},shippingConditions:{shippingType:'service',shippingDate:order.completedAt},title:'Rechnung',introduction:'Rechnung zum bestätigten Auftrag '+order.wg,remark:lexwareMarker(order)};
}
export function lexwareClientPayload(order,billing){
  need(billing&&['individual','company'].includes(billing.kind),'Bitte Privat- oder Firmenkunde auswählen.');
  const address={street:bounded(billing.street,250,'Rechnungsstraße fehlt.'),city:bounded(billing.city,250,'Rechnungsort fehlt.'),zip:bounded(billing.zip,20,'Rechnungs-Postleitzahl fehlt.'),countryCode:bounded(billing.country,2,'Rechnungsland fehlt.').toUpperCase()};need(address.countryCode==='DE','Für diesen geprüften Rechnungsablauf wird eine deutsche Rechnungsadresse benötigt.');
  const identity=billing.kind==='company'?{company:{name:bounded(billing.name,250,'Firmenname fehlt.')}}:{person:{firstName:bounded(billing.firstName,60,'Vorname fehlt.'),lastName:bounded(billing.lastName,60,'Nachname fehlt.')}};
  return {version:0,roles:{customer:{}},...identity,addresses:{billing:[address]},emailAddresses:{[billing.kind==='company'?'business':'private']:[email(order.source.email)]},note:lexwareMarker(order)};
}
function validateClient(client,order,org){
  need(uuid(client.id)&&clientMatch(client,order,org),'Lexware-Rechnungskunde gehört nicht zur geprüften Kunden-E-Mail oder Organisation.',409);
  const address=client.addresses?.billing;need(Array.isArray(address)&&address.length===1&&address[0].countryCode==='DE'&&address[0].street&&address[0].city&&address[0].zip,'Vollständige eindeutige deutsche Rechnungsadresse im Lexware-Kundenkonto fehlt.',409);
  need(!client.xRechnung?.buyerReference,'XRechnung benötigt eine gesondert geprüfte Leitweg-ID und Versandform. Bitte in Lexware bearbeiten.',409);return client;
}
function contactSnapshot(client){const address=client.addresses?.billing?.[0]??{};return {companyName:client.company?.name??'',firstName:client.person?.firstName??'',lastName:client.person?.lastName??'',street:address.street??'',city:address.city??'',zip:address.zip??'',countryCode:address.countryCode??'',emails:Object.values(client.emailAddresses??{}).flat().map(email).sort()};}
async function finishJob(env,id,state,providerId,detail){await env.DB.prepare('UPDATE jobs SET state=?,provider_id=?,detail=?,updated_at=? WHERE id=?').bind(state,providerId??null,detail??null,new Date().toISOString(),id).run();}
async function currentVersion(env,order){const current=await getOrder(env,order.id);need(current.version===order.version&&!current.invoice&&hash(current.offer)===hash(order.offer)&&['Erledigt','Bezahlt'].includes(current.status)&&current.return&&current.completedAt===order.completedAt,'Auftrag oder Rechnung wurde inzwischen verändert. Bitte neu öffnen.',409);return current;}
async function sameAccess(env,config){const current=await configuration(env,['lexwareKey']);need(current.lexwareVerified===true&&current.lexwareKey===config.lexwareKey&&current.lexwareOrganizationId===config.lexwareOrganizationId,'Lexware-Verbindung wurde inzwischen verändert. Bitte erneut prüfen.',409);}
async function readInvoice(config,id){need(uuid(id),'Lexware-Rechnungs-ID fehlt.',409);const remote=await lexwareJSON(config,'/v1/invoices/'+id);need(remote.id===id,'Lexware-Rechnungs-ID stimmt nicht.',502);return remote;}
function lineSnapshot(invoice){return (invoice.lineItems??[]).filter(line=>line.type!=='text').map(line=>({name:line.name,description:line.description??'',quantity:line.quantity,unitName:line.unitName,currency:line.unitPrice?.currency,amountCents:amount(invoice.taxConditions?.taxType==='gross'?line.unitPrice?.grossAmount:line.unitPrice?.netAmount),taxRatePercentage:line.unitPrice?.taxRatePercentage,discountPercentage:line.discountPercentage??0}));}
function validateInvoice(remote,claim,order){
  need(remote.organizationId===claim.org_id&&remote.remark===claim.marker&&remote.address?.contactId===claim.client_id,'Lexware-Rechnung gehört nicht eindeutig zu diesem Auftrag, Kunden und Betrieb.',409);
  need(!claim.provider_id||remote.id===claim.provider_id,'Lexware-Rechnungs-ID weicht vom gespeicherten Ergebnis ab.',409);
  const payload=JSON.parse(claim.payload);need(hash(payload)===claim.payload_hash,'Gesicherte Lexware-Rechnungsprüfung ist beschädigt.',409);
  const addressSnapshot=address=>({name:address?.name??'',supplement:address?.supplement??'',street:address?.street??'',city:address?.city??'',zip:address?.zip??'',countryCode:address?.countryCode??''});
  need(hash(addressSnapshot(remote.address))===hash(addressSnapshot(payload.address)),'Lexware-Rechnungsadresse weicht von den geprüften Kundendaten ab.',409);
  need(remote.totalPrice?.currency==='EUR'&&amount(remote.totalPrice.totalGrossAmount)===order.offer.totalCents&&remote.taxConditions?.taxType===payload.taxConditions.taxType&&hash(lineSnapshot(remote))===hash(lineSnapshot(payload)),'Lexware-Rechnung weicht vom bestätigten Bruttobetrag, Steuer oder den Leistungen ab.',409);
  need(typeof remote.voucherNumber==='string'&&remote.voucherNumber.length>0&&remote.voucherNumber.length<=100&&['open','overdue','paid','voided','sepadebit','transferred'].includes(remote.voucherStatus),'Lexware-Rechnung ist nicht endgültig bestätigt.',409);return remote;
}
async function voucherRows(config){return pages(config,'/v1/voucherlist?voucherType=invoice,salesinvoice&voucherStatus=any');}
async function matchingInvoices(config,marker){
  const rows=await voucherRows(config),matches=[];
  // Voucher metadata omits remark. Read full invoice details before claiming that a marker is absent.
  need(rows.filter(row=>row.voucherType==='invoice').length<=500,'Mehr als 500 Lexware-Rechnungen: vollständiger Markerabgleich muss zuerst separat durchgeführt werden.',409);
  for(const row of rows){if(row.voucherType!=='invoice')continue;const remote=await readInvoice(config,row.id);if(remote.remark===marker)matches.push(remote);}
  return matches;
}
export async function lexwareNumberCheck(config){
  need(config.lexwareVerified&&config.lexwareKey,'Lexware zuerst verbinden und prüfen.',409);const profile=profileValid(await lexwareJSON(config,'/v1/profile'));need(profile.organizationId===config.lexwareOrganizationId,'Lexware-Organisation stimmt nicht.',409);
  const rows=await voucherRows(config);let maxNumber=0,otherWgNumbers=0;
  for(const row of rows){const match=/^WG-(\d+)$/.exec(String(row.voucherNumber??''));if(match){need(Number.isSafeInteger(Number(match[1])),'Lexware-WG-Nummer ungültig.',502);maxNumber=Math.max(maxNumber,Number(match[1]));}else if(/^WG/i.test(String(row.voucherNumber??'')))otherWgNumbers++;}
  return {provider:'lexware',count:rows.length,maxNumber,otherWgNumbers,organizationId:profile.organizationId,at:new Date().toISOString(),note:'Lexware-Rechnungen einschließlich archivierter und importierter Belege gelesen. Lexware vergibt eigene Rechnungsnummern; WG bleibt die Auftragsreferenz. Frühere Qonto-Rechnungen und Buchungsbestand müssen im Nummernbeleg berücksichtigt bleiben.'};
}
export async function lexwareInvoice(env,order,input){
  eligible(order,input);lexwareInvoicePayload(order,input,input.clientId||'00000000-0000-0000-0000-000000000000');need(!order.invoice,'Eine Rechnung ist bereits zugeordnet.',409);
  await lexwareSchema(env);const configBefore=await settings(env);need(configBefore.numberAudit,'WG-Nummernabgleich fehlt.',409);
  let claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first(),previous=await env.DB.prepare("SELECT * FROM jobs WHERE order_id=? AND kind='invoice'").bind(order.id).first();
  need(!claim||claim.provider==='lexware','Dieser Auftrag hat bereits einen anderen Rechnungsanbieter. Keine zweite Rechnung erstellen.',409);
  need(!previous||claim?.provider==='lexware','Ein älterer Qonto-Rechnungsvorgang ist vorhanden. Bitte zuerst dessen Ergebnis klären.',409);
  need(!claim||['preflight','client-ready'].includes(claim.stage),'Rechnungsergebnis oder Kundenanlage ungeklärt. Zuerst Anbieterabgleich durchführen.',409);
  const {config,profile}=await access(env);need(!claim||claim.org_id===profile.organizationId,'Rechnungsablauf gehört zu einer anderen Lexware-Organisation.',409);
  need(!(profile.smallBusiness===true||profile.taxType==='vatfree')||input.vatBasisPoints===0,'Das Lexware-Konto ist steuerfrei eingerichtet. Bitte 0 % und die geprüfte Steuerbefreiung auswählen.',409);
  const list=await inventory(config,profile,order);let client;
  if(input.clientId){need(typeof input.clientReviewHash==='string'&&/^[a-f0-9]{64}$/.test(input.clientReviewHash),'Die angezeigten Lexware-Kundendaten müssen zuerst geprüft werden.',409);need(list.clients.some(item=>item.id===input.clientId),'Bitte einen zur Kunden-E-Mail gehörenden Lexware-Kunden auswählen.',409);client=validateClient(await lexwareJSON(config,'/v1/contacts/'+input.clientId),order,profile.organizationId);need(input.clientReviewHash===lexwareClientReviewHash(client,order),'Lexware-Kundendaten wurden seit der Prüfung verändert. Bitte Adresse erneut prüfen.',409);}
  else{need(list.clients.length===0,'Ein Lexware-Kunde mit dieser E-Mail ist vorhanden. Bitte auswählen.',409);lexwareClientPayload(order,input.billing);}
  await currentVersion(env,order);await env.DB.prepare("INSERT OR IGNORE INTO invoice_claims(order_id,provider,marker,org_id,stage,created_at) VALUES(?,'lexware',?,?,'preflight',?)").bind(order.id,lexwareMarker(order),profile.organizationId,new Date().toISOString()).run();
  claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first();need(claim.provider==='lexware'&&claim.org_id===profile.organizationId,'Rechnung ist anderweitig gesperrt.',409);
  const job=await claimJob(env,order,'invoice');need(job,'Rechnungsergebnis bereits gespeichert oder ungeklärt. Zuerst Anbieterabgleich durchführen.',409);await env.DB.prepare('UPDATE invoice_claims SET job_id=? WHERE order_id=?').bind(job,order.id).run();let attempted=false;
  try{
    if(!client){const payload=lexwareClientPayload(order,input.billing);await env.DB.prepare('UPDATE invoice_claims SET payload=?,payload_hash=? WHERE order_id=?').bind(JSON.stringify(payload),hash(payload),order.id).run();const created=await lexwareJSON(config,'/v1/contacts',{method:'POST',body:JSON.stringify(payload),beforeSend:async()=>{await sameAccess(env,config);await currentVersion(env,order);await env.DB.prepare("UPDATE invoice_claims SET stage='contact-attempt' WHERE order_id=?").bind(order.id).run();attempted=true;}});need(uuid(created.id),'Lexware-Kundenanlage nicht eindeutig bestätigt.',502);await env.DB.prepare("UPDATE invoice_claims SET client_id=?,stage='client-ready' WHERE order_id=?").bind(created.id,order.id).run();client=validateClient(await lexwareJSON(config,'/v1/contacts/'+created.id),order,profile.organizationId);need(hash(contactSnapshot(client))===hash(contactSnapshot(payload)),'Angelegter Lexware-Kunde weicht von den geprüften Rechnungsdaten ab.',409);}
    const payload=lexwareInvoicePayload(order,input,client.id);payload.address={contactId:client.id,...lexwareInvoiceAddress(client)};await env.DB.prepare("UPDATE invoice_claims SET client_id=?,payload=?,payload_hash=?,stage='preflight' WHERE order_id=?").bind(client.id,JSON.stringify(payload),hash(payload),order.id).run();
    const matches=await matchingInvoices(config,claim.marker);need(matches.length===0,'Für diesen Auftrag ist bereits eine Lexware-Rechnung vorhanden. Anbieterabgleich verwenden.',409);
    const freshClient=validateClient(await lexwareJSON(config,'/v1/contacts/'+client.id),order,profile.organizationId);need(lexwareClientReviewHash(freshClient,order)===lexwareClientReviewHash(client,order),'Lexware-Kundendaten wurden während der Rechnungsprüfung verändert. Bitte neu prüfen.',409);
    const created=await lexwareJSON(config,'/v1/invoices?finalize=true',{method:'POST',body:JSON.stringify(payload),beforeSend:async()=>{await sameAccess(env,config);await currentVersion(env,order);await env.DB.prepare("UPDATE invoice_claims SET stage='invoice-attempt' WHERE order_id=?").bind(order.id).run();attempted=true;}});
    need(uuid(created.id),'Lexware-Rechnungsergebnis ohne eindeutige ID. Keine automatische Wiederholung.',502);await env.DB.prepare('UPDATE invoice_claims SET provider_id=? WHERE order_id=?').bind(created.id,order.id).run();await finishJob(env,job,'unknown',created.id,'Lexware hat eine ID geliefert; Rechnungsinhalt wird noch geprüft.');
    claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first();const remote=validateInvoice(await readInvoice(config,created.id),claim,order);
    const current=await getOrder(env,order.id);need(!current.invoice||current.invoice.provider==='lexware'&&current.invoice.id===remote.id,'Eine andere Rechnung ist bereits zugeordnet.',409);need(hash(current.offer)===hash(order.offer),'Auftragsleistungen wurden nach der Rechnungsanlage verändert.',409);
    current.invoice={provider:'lexware',id:remote.id,number:remote.voucherNumber,totalCents:amount(remote.totalPrice.totalGrossAmount),status:remote.voucherStatus,url:'https://app.lexware.de/permalink/invoices/view/'+remote.id,at:new Date().toISOString()};
    const saved=await saveOrder(env,current,current.version,'Lexware-Rechnung erstellt; Zahlung bleibt separat','provider');await finishJob(env,job,'sent',remote.id);await env.DB.prepare("UPDATE invoice_claims SET stage='confirmed' WHERE order_id=?").bind(order.id).run();return saved;
  }catch(error){claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first();await finishJob(env,job,attempted||claim.stage==='invoice-attempt'||claim.stage==='contact-attempt'?'unknown':'failed',claim.provider_id,'Lexware-Ablauf angehalten. Anbieterbestand lesend prüfen; keine automatische Wiederholung.');throw error;}
}
function paymentSnapshot(remote,payment,total){
  need(payment.currency==='EUR'&&payment.voucherType==='invoice'&&['open','paid','voided','sepadebit','transferred'].includes(payment.voucherStatus)&&['balanced','openRevenue'].includes(payment.paymentStatus)&&Array.isArray(payment.paymentItems),'Lexware-Zahlungsergebnis ist unvollständig.',502);
  need(remote.voucherStatus===payment.voucherStatus||remote.voucherStatus==='overdue'&&['open','sepadebit'].includes(payment.voucherStatus),'Lexware-Rechnung und Zahlungsstand haben sich während der Prüfung verändert. Erneut lesend prüfen.',409);
  const openCents=amount(payment.openAmount),seen=new Set(),items=payment.paymentItems.map(item=>{
    need(item.currency==='EUR'&&typeof item.paymentItemType==='string'&&Number.isFinite(Date.parse(item.postingDate)),'Lexware-Zahlungsposition ist ungültig.',502);
    const view={type:item.paymentItemType,at:item.postingDate,amountCents:amount(item.amount)},fingerprint=hash(view);need(!seen.has(fingerprint),'Doppelte Lexware-Zahlungsposition. Bitte im Konto prüfen.',409);seen.add(fingerprint);return view;
  });
  const sum=items.reduce((n,item)=>n+item.amountCents,0),voided=remote.voucherStatus==='voided'||payment.voucherStatus==='voided';
  need(voided||sum+openCents===total,'Lexware-Zahlungspositionen und offener Betrag stimmen nicht mit der Rechnung überein.',409);
  const paid=!voided&&remote.voucherStatus==='paid'&&payment.voucherStatus==='paid'&&payment.paymentStatus==='balanced'&&openCents===0;
  return {status:voided?'voided':payment.paymentStatus,openCents,paid,at:new Date().toISOString(),items,...(paid&&payment.paidDate?{paidAt:payment.paidDate}:{}),...(voided?{warning:'Storniert; ausgeglichener Anbieterstatus ist kein Zahlungseingang.'}:{})};
}
export async function lexwareReconcile(env,order){
  need(!order.synthetic,'Testaufträge haben keine externen Anbieterresultate.',409);await lexwareSchema(env);
  const claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first();
  if(!claim)return order;
  need(claim.provider==='lexware','Dieser Rechnungsvorgang gehört zu einem anderen Anbieter.',409);
  const {config,profile}=await access(env);need(profile.organizationId===claim.org_id,'Lexware-Organisation des Rechnungsvorgangs stimmt nicht.',409);
  if(claim.stage==='contact-attempt'||claim.stage==='client-ready'){
    const contacts=await pages(config,contactPath(order)),matches=contacts.filter(client=>client.note===claim.marker);need(matches.length<=1,'Mehrere Lexware-Kunden mit dieser Auftragsreferenz. Im Konto klären.',409);
    if(matches.length===1){const client=validateClient(matches[0],order,claim.org_id),payload=JSON.parse(claim.payload);need(hash(contactSnapshot(client))===hash(contactSnapshot(payload)),'Angelegter Lexware-Kunde weicht von der geprüften Rechnungsadresse ab.',409);await env.DB.prepare("UPDATE invoice_claims SET client_id=?,stage='client-ready' WHERE order_id=?").bind(client.id,order.id).run();await finishJob(env,claim.job_id,'failed',null,'Lexware-Kunde lesend bestätigt. Rechnung wurde noch nicht angelegt; Kunden auswählen und erneut ausdrücklich prüfen.');}
    return getOrder(env,order.id);
  }
  if(!claim.payload)return order;
  let remote;if(claim.provider_id)remote=await readInvoice(config,claim.provider_id);else{const matches=await matchingInvoices(config,claim.marker);need(matches.length<=1,'Mehrere Lexware-Rechnungen für diesen Auftrag. Bitte im Konto klären.',409);if(!matches.length){if(claim.job_id)await finishJob(env,claim.job_id,'unknown',null,'Vollständiger Lexware-Bestand enthält keine passende Rechnung. Keine automatische Wiederholung.');return order;}remote=matches[0];}
  validateInvoice(remote,claim,order);const current=await getOrder(env,order.id);need(!current.invoice||current.invoice.provider==='lexware'&&current.invoice.id===remote.id,'Eine andere Rechnung ist bereits zugeordnet.',409);
  const payments=await lexwareJSON(config,'/v1/payments/'+remote.id),remotePayment=paymentSnapshot(remote,payments,amount(remote.totalPrice.totalGrossAmount));
  current.invoice={...current.invoice,provider:'lexware',id:remote.id,number:remote.voucherNumber,totalCents:amount(remote.totalPrice.totalGrossAmount),status:remote.voucherStatus,url:'https://app.lexware.de/permalink/invoices/view/'+remote.id,at:current.invoice?.at??new Date().toISOString(),remotePayment};
  const saved=await saveOrder(env,current,current.version,'Lexware-Rechnung und Zahlungsstand lesend abgeglichen; lokaler Zahlungseingang bleibt separat','provider');await env.DB.prepare("UPDATE invoice_claims SET provider_id=?,stage='confirmed' WHERE order_id=?").bind(remote.id,order.id).run();if(claim.job_id)await finishJob(env,claim.job_id,'sent',remote.id);return saved;
}
export async function lexwarePDF(env,order){
  need(!order.synthetic&&order.invoice?.provider==='lexware'&&uuid(order.invoice.id),'Keine echte Lexware-Rechnung für diesen Auftrag vorhanden.',409);await lexwareSchema(env);
  const claim=await env.DB.prepare('SELECT * FROM invoice_claims WHERE order_id=?').bind(order.id).first();need(claim?.provider==='lexware'&&claim.provider_id===order.invoice.id,'Lexware-Rechnungsherkunft ist nicht eindeutig.',409);
  const {config,profile}=await access(env);need(profile.organizationId===claim.org_id,'Lexware-Organisation stimmt nicht.',409);const remote=validateInvoice(await readInvoice(config,order.invoice.id),claim,order);need(remote.electronicDocumentProfile!=='XRechnung'&&!remote.xRechnung?.buyerReference,'Bei XRechnung muss die originale XML-Rechnung in Lexware heruntergeladen werden.',409);
  const response=await lexwareRequest(config,'/v1/invoices/'+order.invoice.id+'/file',{headers:{Accept:'application/pdf'}});need(response.ok&&response.headers.get('content-type')?.split(';')[0]==='application/pdf','Lexware-Rechnungs-PDF ist noch nicht verfügbar oder hat ein anderes Format.',502);
  const bytes=await limitedBytes(response,25*1024*1024);need(bytes.length>5&&bytes.subarray(0,5).toString()==='%PDF-','Lexware-Datei ist kein PDF.',502);
  const filename=(order.wg+'-'+order.invoice.number).replace(/[^a-zA-Z0-9_.-]/g,'_')+'.pdf';return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+filename+'"','Content-Length':String(bytes.length),'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}

import {randomUUID,createHash} from 'node:crypto';
import {websitePhotos,getOrder} from '../src/worker.mjs';
import {need} from '../src/domain.mjs';
const bookingMime=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']);
export async function bookingPhotoSchema(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS booking_photo_sources(order_id TEXT NOT NULL,source_hash TEXT NOT NULL,asset_id TEXT NOT NULL,name TEXT NOT NULL,PRIMARY KEY(order_id,source_hash))').run();await env.DB.prepare('CREATE TABLE IF NOT EXISTS booking_photo_checks(order_id TEXT PRIMARY KEY,checked_at TEXT NOT NULL,error TEXT)').run();}
export async function readLimitedPhoto(response,limit=12*1024*1024){need(response.ok&&response.body,'Buchungsfoto konnte nicht geladen werden.',502);const announced=Number(response.headers.get('content-length'));need(!announced||announced<=limit,'Buchungsaufnahme überschreitet die Website-Größenbegrenzung.',502);const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();need(false,'Buchungsaufnahme ist zu groß.',502);}chunks.push(value);}}finally{reader.releaseLock();}need(size>0,'Buchungsaufnahme ist leer.',502);const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;}
export async function syncBookingPhotos(env,order,budget=1){
  await bookingPhotoSchema(env);if(!order.source.id||order.synthetic)return {downloaded:0,pending:0};
  const photos=await websitePhotos(env,order.id);let downloaded=0,pending=0;
  for(const photo of photos){
    need(bookingMime.has(photo.mime),'Buchungsaufnahme hat ein unbekanntes Format.',502);
    const url=new URL(photo.url);need(url.protocol==='https:'&&url.hostname.endsWith('.supabase.co')&&url.pathname.startsWith('/storage/v1/object/sign/'),'Buchungsaufnahme liegt außerhalb des freigegebenen Website-Speichers.',409);
    const sourceHash=createHash('sha256').update(url.origin+url.pathname).digest('hex');
    if(await env.DB.prepare('SELECT asset_id FROM booking_photo_sources WHERE order_id=? AND source_hash=?').bind(order.id,sourceHash).first())continue;
    if(downloaded>=budget){pending++;continue;}
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});need(response.headers.get('content-type')?.split(';')[0]===photo.mime,'Dateityp der Buchungsaufnahme stimmt nicht überein.',502);
    const bytes=await readLimitedPhoto(response),id=randomUUID(),at=new Date().toISOString();await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:photo.mime}});
    try{await env.DB.batch([env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,order.id,'booking',photo.mime,createHash('sha256').update(bytes).digest('hex'),bytes.byteLength,at),env.DB.prepare('INSERT INTO booking_photo_sources VALUES(?,?,?,?)').bind(order.id,sourceHash,id,String(photo.name??'Buchungsaufnahme').slice(0,250)),env.DB.prepare("INSERT INTO audit(order_id,version,at,actor,action,status) VALUES(?,NULL,?,'provider','Buchungsaufnahme geschützt übernommen',?)").bind(order.id,at,order.status)]);downloaded++;}
    catch(error){await env.BUCKET.delete(id);if(!await env.DB.prepare('SELECT asset_id FROM booking_photo_sources WHERE order_id=? AND source_hash=?').bind(order.id,sourceHash).first())throw error;}
  }
  return {downloaded,pending};
}
export async function bookingPhotos(env,id,sync=false){const order=await getOrder(env,id);let warning=null;if(sync)try{const result=await syncBookingPhotos(env,order);if(result.pending)warning=result.pending+' weitere Aufnahmen werden geschützt übernommen. Erneut laden oder den nächsten Hintergrundlauf abwarten.';}catch(error){warning=error.message;}const rows=await env.DB.prepare("SELECT a.id,a.mime,a.created_at,s.name FROM assets a LEFT JOIN booking_photo_sources s ON s.asset_id=a.id WHERE a.order_id=? AND a.kind='booking' ORDER BY a.created_at LIMIT 20").bind(id).all();need(rows.results.length||!warning,warning??'Buchungsaufnahmen fehlen.',502);return {warning,photos:rows.results.map(row=>({name:row.name??'Ergänzte Buchungsaufnahme',mime:row.mime,url:'/api/asset/'+row.id}))};}

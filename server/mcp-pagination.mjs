import {createHmac,timingSafeEqual} from 'node:crypto';
import {McpError} from './mcp-auth.mjs';
const mac=(env,text)=>createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update(text).digest();
function context(name,args,identity){
 const filters=Object.fromEntries(Object.keys(args).filter(key=>!['cursor','offset'].includes(key)).sort().map(key=>[key,args[key]]));
 return JSON.stringify({name,filters,owner:identity.owner,grant:identity.id});
}
export function readCursor(env,name,args,identity){
 if(!args.cursor)return;
 try{
  if(args.offset!==0)throw Error();
  const [body,signature,...extra]=args.cursor.split('.');
  if(extra.length||!body||!/^[A-Za-z0-9_-]{43}$/.test(signature??''))throw Error();
  const expected=mac(env,body),supplied=Buffer.from(signature,'base64url');
  if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))throw Error();
  const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if(value.context!==mac(env,context(name,args,identity)).toString('base64url')||value.expires<=Date.now()||!Number.isSafeInteger(value.offset)||value.offset<1||value.offset>100000)throw Error();
  args.offset=value.offset;
 }catch{throw new McpError('invalid_cursor');}
}
export function finishPage(env,name,args,identity,data){
 if(!Array.isArray(data.items))return data;
 let more=data.nextOffset!==null;
 // Reserve room for continuation metadata, even for escaped multi-byte customer text.
 while(Buffer.byteLength(JSON.stringify(data))>57000&&data.items.length){data.items.pop();more=true;}
 if(!data.items.length&&more)throw new McpError('result_too_large');
 const offset=args.offset+data.items.length,limitReached=more&&offset>100000;
 data.nextOffset=more&&!limitReached?offset:null;data.nextCursor=null;data.hasMore=more;
 data.pagination={snapshot:false,consistency:'live-offset',continuationLimitReached:limitReached,warning:'Änderungen zwischen Seiten können Datensätze verschieben; dies ist keine vollständige Momentaufnahme.'};
 if(data.nextOffset!==null){
  const body=Buffer.from(JSON.stringify({offset,expires:Date.now()+900000,context:mac(env,context(name,args,identity)).toString('base64url')})).toString('base64url');
  data.nextCursor=body+'.'+mac(env,body).toString('base64url');
 }
 if(Buffer.byteLength(JSON.stringify(data))>60000)throw new McpError('result_too_large');
 return data;
}

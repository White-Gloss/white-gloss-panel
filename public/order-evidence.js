import {invoiceStatusLabel,invoiceView} from './invoice-ui.js';
const kinds=[['offer','Angebot / Auftragsbestätigung','price'],['intake','Annahme','intake'],['return','Rückgabe','return'],['invoice','Rechnung','payment']];
function evidence(kind,document,acceptance){
 const exists=Boolean(document),customerSigned=Boolean(kind==='offer'?acceptance?.signature:document?.customerSignature);
 const status=!exists?'Noch nicht vorhanden':kind==='invoice'?invoiceStatusLabel(document.status):customerSigned?'Vom Kunden unterschrieben':kind==='offer'?(acceptance?'Ohne Kundenunterschrift angenommen':'Annahme offen'):'Gespeichert · Kundenunterschrift fehlt';
 return {exists,status,customerSigned,operatorSigned:Boolean(document?.operatorSignature),at:acceptance?.at??document?.signedAt??document?.savedAt??document?.createdAt??document?.at??null};
}
// Only facts for presentation; never expose tokens or signature payloads.
export function buildOrderEvidence(order){
 if(!order||order.slim===true)return {loading:true,documents:[]};
 return {loading:false,documents:kinds.map(([kind,title,targetTab])=>{
  const current=evidence(kind,order[kind]??(kind==='invoice'&&order.invoiceDraft?{...order.invoiceDraft,status:'draft'}:null),order.acceptance);
  if(kind==='invoice'&&order.invoice?.provider==='qonto')current.status=invoiceStatusLabel(invoiceView(order).status);
  const request=order.pending?.[kind];
  const history=(order[kind+'History']??[]).slice().reverse().map(item=>({...evidence(kind,kind==='offer'?item.offer:item,item.acceptance),active:false,replacedAt:item.replacedAt??null}));
  for(const item of (order.pendingHistory??[]).filter(item=>item.kind===kind).slice().reverse())history.push({...evidence(kind,item.content,null),status:'Frühere Unterschriftsanfrage · inaktiv',active:false,at:item.createdAt??null,replacedAt:item.discardedAt??null});
  const step=order.workflow?.[targetTab];
  return {kind,title,targetTab,current,handover:order.handover?.[kind]?{signed:Boolean(order.handover[kind].signature),at:order.handover[kind].at??null}:null,pending:request?{...evidence(kind,request.content,null),status:'Offene Fassung · Kundenunterschrift fehlt',at:request.createdAt??null}:null,history,annotation:step?{state:step.state,reason:step.reason??'',at:step.at??null}:null};
 })};
}

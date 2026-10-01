import {need} from './domain.mjs';

export async function qontoNumberCheck(config){
  need(config.qontoLogin&&config.qontoKey,'Qonto-Zugang fehlt.',409);
  const ids=new Set();let count=0,maxNumber=0,otherWgNumbers=0,pages=1,total=null;
  for(let page=1;page<=pages;page++){
    const response=await fetch('https://thirdparty.qonto.com/v2/client_invoices?exclude_imported=false&per_page=500&page='+page,{headers:{Authorization:config.qontoLogin+':'+config.qontoKey},redirect:'manual',signal:AbortSignal.timeout(15000)});
    need(response.ok,'Qonto-Rechnungsabgleich fehlgeschlagen: HTTP '+response.status,502);
    const data=await response.json();
    need(Array.isArray(data.client_invoices)&&data.meta&&Number.isInteger(data.meta.total_pages)&&data.meta.total_pages>=0&&data.meta.total_pages<=100&&Number.isInteger(data.meta.total_count)&&data.meta.total_count>=0,'Qonto-Paginierung ist unvollständig. Kein vollständiger Abgleich bestätigt.',502);
    need(data.meta.current_page===page,'Qonto hat eine unerwartete Seite geliefert.',502);
    if(total===null){total=data.meta.total_count;pages=Math.max(1,data.meta.total_pages);}else need(total===data.meta.total_count&&pages===Math.max(1,data.meta.total_pages),'Rechnungsbestand wurde während des Abgleichs geändert. Bitte erneut lesen.',409);
    for(const invoice of data.client_invoices){
      need(invoice.id&&!ids.has(invoice.id),'Doppelte oder fehlende Qonto-Rechnungs-ID. Abgleich nicht vollständig.',502);ids.add(invoice.id);count++;
      const match=/^WG-(\d+)$/.exec(String(invoice.number??''));
      if(match){const n=Number(match[1]);need(Number.isSafeInteger(n),'Qonto-WG-Nummer ist ungültig.',502);maxNumber=Math.max(maxNumber,n);}else if(/^WG/i.test(String(invoice.number??'')))otherWgNumbers++;
    }
  }
  need(count===total,'Nicht alle Qonto-Rechnungen wurden erfasst. Kein vollständiger Abgleich bestätigt.',502);
  return {count,maxNumber,otherWgNumbers,at:new Date().toISOString(),note:'Qonto-Rechnungen einschließlich importierter Rechnungen gelesen. Vor der Nummernfreigabe auch den bisherigen Buchungsbestand abgleichen.'};
}

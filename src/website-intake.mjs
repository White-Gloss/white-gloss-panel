import {normalizeSource,text} from './domain.mjs';

// The inbox keeps only the established business fields, never the raw Hub payload.
export function inspectWebsiteSource(row){
  const id=text(row&&typeof row==='object'?(row.id??row.booking_id):'',150);
  let source=null;
  const errors=[];
  try{source=normalizeSource(row);}catch(error){errors.push(text(error?.message,300)||'Website-Anfrage ist nicht lesbar.');}
  if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(Number(id)))errors.push('Website-ID fehlt oder ist nicht eindeutig numerisch.');
  if(source){
    if(!source.name)errors.push('Kundenname fehlt.');
    if(!source.vehicle)errors.push('Fahrzeug fehlt.');
    if(!source.package)errors.push('Leistung / Paket fehlt.');
    if(!source.phone&&!source.email)errors.push('Telefonnummer oder E-Mail-Adresse fehlt.');
    if(source.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source.email))errors.push('E-Mail-Adresse ist ungültig.');
    if(!Array.isArray(source.extras)||source.extras.length>30||source.extras.some(value=>typeof value!=='string'||value.length>180))errors.push('Zusatzleistungen sind strukturell ungültig.');
  }
  const unique=[...new Set(errors)];
  return {id,source,valid:unique.length===0,errors:unique};
}

export function websiteInboxSnapshot(source){
  if(!source)return {};
  const {raw:_raw,...safe}=source;
  return safe;
}

export const isMailJob=kind=>['offer','reminder','review','invoice-mail'].includes(kind)||/^(offer|document|protocol|invoice-reminder|invoice-copy)-/.test(kind);

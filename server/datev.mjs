// DATEV public specification, Header 700 / Buchungsstapel 13 (2026-10-18).
// https://developer.datev.de/de/file-format/details/datev-format/format-description
import {need} from '../src/domain.mjs';
import {validDay} from './accounting.mjs';
const extended='€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
export function windows1252(value){const bytes=[];for(const char of value){const n=char.codePointAt(0),at=extended.indexOf(char);need(n<128||(n>=160&&n<=255)||at>=0,'DATEV: Nicht darstellbares Zeichen '+char+'. Bitte Buchungstext anpassen.');bytes.push(n<128||n>=160&&n<=255?n:128+at);}return Buffer.from(bytes);}
export function datevText(value,max,label,required=false){need(typeof value==='string'&&value.length<=max&&!/[\x00-\x1f\x7f-\x9f]/.test(value)&&(!required||value.trim().length>0),label+' fehlt, ist zu lang oder enthält Steuerzeichen.');windows1252(value);return value;}
export function datevConfig(input){
  const config={advisor:String(input.advisor??''),client:String(input.client??''),chart:input.chart,length:Number(input.length),yearStart:input.yearStart,locked:input.locked};
  need(/^[1-9]\d{3,6}$/.test(config.advisor)&&Number(config.advisor)>=1001,'DATEV-Beraternummer: 1001 bis 9999999.');
  need(/^[1-9]\d{0,4}$/.test(config.client),'DATEV-Mandantennummer: 1 bis 99999.');
  need(['03','04'].includes(config.chart),'Bitte SKR03 oder SKR04 auswählen.');need(Number.isInteger(config.length)&&config.length>=4&&config.length<=8,'Sachkontenlänge: 4 bis 8.');
  need(validDay(config.yearStart)&&config.yearStart.endsWith('-01'),'Wirtschaftsjahresbeginn muss der erste Tag eines Monats sein.');
  need([0,1].includes(config.locked),'DATEV-Festschreibung ausdrücklich auswählen.');return config;
}
export function fiscalContains(config,day){const end=String(Number(config.yearStart.slice(0,4))+1)+config.yearStart.slice(4);return validDay(day)&&day>=config.yearStart&&day<end;}
export function datevLine(input,config,month){
  const line={amount:Number(input.amount),side:input.side,account:String(input.account??''),counter:String(input.counter??''),tax:String(input.tax??''),date:input.date,reference:input.reference??'',text:input.text??''};
  need(Number.isSafeInteger(line.amount)&&line.amount>0&&line.amount<=999999999999,'Ungültiger Buchungsbetrag in Cent.');need(['S','H'].includes(line.side),'Soll oder Haben auswählen.');
  for(const account of [line.account,line.counter])need(/^[1-9]\d{0,8}$/.test(account)&&account.length<=config.length+1,'Konto passt nicht zur Sachkontenlänge.');need(line.account!==line.counter,'Konto und Gegenkonto müssen verschieden sein.');
  // Extended tax cases require additional fields and are deliberately not guessed.
  need(/^\d{0,2}$/.test(line.tax)&&!['49'].includes(line.tax),'Nur einfache BU-Schlüssel 1–99 (außer 49) oder leer verwenden. Sonderfälle mit der Kanzlei klären.');
  need(validDay(line.date)&&line.date.startsWith(month+'-')&&fiscalContains(config,line.date),'Buchungsdatum liegt außerhalb von Monat oder Wirtschaftsjahr.');
  need(/^[A-Za-z0-9_$&%*+\-/]{1,36}$/.test(line.reference),'Belegnummer: 1–36 Zeichen, Buchstaben/Ziffern oder _ $ & % * + - /.');
  datevText(line.text,60,'Buchungstext',true);need(!/^\s*[=+@-]/.test(line.text),'Buchungstext darf nicht mit einem Tabellen-Formelzeichen beginnen.');return line;
}
export const DATEV_COLUMNS=[
  'Umsatz (ohne Soll/Haben-Kz)','Soll/Haben-Kennzeichen','WKZ Umsatz','Kurs','Basis-Umsatz','WKZ Basis-Umsatz','Konto','Gegenkonto (ohne BU-Schlüssel)','BU-Schlüssel','Belegdatum','Belegfeld 1','Belegfeld 2','Skonto','Buchungstext','Postensperre','Diverse Adressnummer','Geschäftspartnerbank','Sachverhalt','Zinssperre','Beleglink',
  ...Array.from({length:8},(_,i)=>['Beleginfo - Art '+(i+1),'Beleginfo - Inhalt '+(i+1)]).flat(),
  'KOST1 - Kostenstelle','KOST2 - Kostenstelle','Kost-Menge','EU-Land u. UStID (Bestimmung)','EU-Steuersatz (Bestimmung)','Abw. Versteuerungsart','Sachverhalt L+L','Funktionsergänzung L+L','BU 49 Hauptfunktionstyp','BU 49 Hauptfunktionsnummer','BU 49 Funktionsergänzung',
  ...Array.from({length:20},(_,i)=>['Zusatzinformation - Art '+(i+1),'Zusatzinformation- Inhalt '+(i+1)]).flat(),
  'Stück','Gewicht','Zahlweise','Forderungsart','Veranlagungsjahr','Zugeordnete Fälligkeit','Skontotyp','Auftragsnummer','Buchungstyp','USt-Schlüssel (Anzahlungen)','EU-Land (Anzahlungen)','Sachverhalt L+L (Anzahlungen)','EU-Steuersatz (Anzahlungen)','Erlöskonto (Anzahlungen)','Herkunft-Kz','Buchungs GUID','KOST-Datum','SEPA-Mandatsreferenz','Skontosperre','Gesellschaftername','Beteiligtennummer','Identifikationsnummer','Zeichnernummer','Postensperre bis','Bezeichnung SoBil-Sachverhalt','Kennzeichen SoBil-Buchung','Festschreibung','Leistungsdatum','Datum Zuord. Steuerperiode','Fälligkeit','Generalumkehr (GU)','Steuersatz','Land','Abrechnungsreferenz','BVV-Position','EU-Land u. UStID (Ursprung)','EU-Steuersatz (Ursprung)','Abw. Skontokonto'
];
const q=value=>'"'+String(value).replaceAll('"','""')+'"';
export function datevFile(config,month,entries,at){
  datevConfig(config);need(entries.length>0&&entries.length<=99999,'DATEV-Stapel muss 1 bis 99.999 Buchungen enthalten.');
  const from=month+'-01',to=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
  need(fiscalContains(config,from)&&fiscalContains(config,to),'Monat liegt außerhalb des konfigurierten Wirtschaftsjahres.');
  const compact=day=>day.replaceAll('-',''),stamp=at.replace(/[-:TZ.]/g,'');
  const header=[q('EXTF'),700,21,q('Buchungsstapel'),13,stamp,'',q('RE'),q('WhiteGloss'),q(''),config.advisor,config.client,compact(config.yearStart),config.length,compact(from),compact(to),q('WhiteGloss '+month),q(''),1,0,config.locked,q('EUR'),'',q(''),'','',q(config.chart),'','',q(''),q('WhiteGloss')];
  const rows=entries.map(entry=>{const line=datevLine(entry.data,config,month),row=Array(125).fill('');row[0]=Math.floor(line.amount/100)+','+String(line.amount%100).padStart(2,'0');row[1]=q(line.side);row[2]=q('EUR');row[6]=line.account;row[7]=line.counter;row[8]=line.tax?q(line.tax.padStart(4,'0')):'';row[9]=line.date.slice(8,10)+line.date.slice(5,7);row[10]=q(line.reference);row[13]=q(line.text);row[47]=q('Panel-Buchung');row[48]=q(entry.id);row[113]=config.locked;row[117]=q(entry.reversal_of?'1':'0');return row.join(';');});
  return windows1252([header.join(';'),DATEV_COLUMNS.join(';'),...rows,''].join('\r\n'));
}

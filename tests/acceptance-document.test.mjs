import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceDocument} from '../server/acceptance-document.mjs';
import {PDFDocument} from '../dist/pdf/library.mjs';
import {berlin} from '../src/domain.mjs';

test('confirmation PDF identifies operator releases with reason and time without claiming customer acceptance',async t=>{
  const drawn=[],addPage=PDFDocument.prototype.addPage;
  t.mock.method(PDFDocument.prototype,'addPage',function(...args){const page=addPage.apply(this,args),drawText=page.drawText;page.drawText=function(value,options){drawn.push(value);return drawText.call(this,value,options);};return page;});
  const at='2026-10-15T08:30:00Z',releaseAt='2026-10-15T08:29:00Z';
  const order={wg:'WG-TEST-PDF',synthetic:true,source:{name:'TEST',vehicle:'TEST'},offer:{lines:[{title:'TEST',amountCents:1000}],totalCents:1000},acceptance:{at,mode:'ohne Unterschrift freigegeben',signature:null,paymentObligation:true,release:{reason:'TEST telefonisch freigegeben',at:releaseAt}}};
  const pdf=await acceptanceDocument({},order),text=drawn.join('\n');
  assert.equal(Buffer.from(pdf.bytes.subarray(0,5)).toString(),'%PDF-');
  assert.match(text,/Vom Betreiber ohne Kundenunterschrift freigegeben/);
  assert.match(text,/TEST telefonisch freigegeben/);
  assert.ok(text.includes(berlin(releaseAt)));
  assert.match(text,/Keine Unterschrift erfasst/);
  assert.doesNotMatch(text,/Über den persönlichen Kundenzugang angenommen|Vom Kunden ausdrücklich bestätigt/);
  drawn.length=0;
  await acceptanceDocument({}, {...order,acceptance:{at,mode:'online',paymentObligation:true}});
  assert.match(drawn.join('\n'),/Über den persönlichen Kundenzugang angenommen/);
});

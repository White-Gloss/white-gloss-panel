import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildOrderEvidence} from '../dist/client/order-evidence.js';
import {orderEvidenceHTML,mountOrderMedia} from '../public/order-evidence-ui.js';
test('order evidence renders current, pending, inactive history and safe annotations',()=>{
 const html=orderEvidenceHTML(buildOrderEvidence({intake:{customerSignature:'secret'},pending:{intake:{content:{}}},workflow:{intake:{state:'skipped',reason:'<img src=x onerror=alert(1)>'}}}));
 const root=new JSDOM(html).window.document;
 assert.equal(root.querySelectorAll('[data-evidence-document]').length,4);
 assert.match(root.body.textContent,/Vom Kunden unterschrieben/);assert.match(root.body.textContent,/Offene Fassung/);assert.equal(root.querySelector('img'),null);
 assert.equal(root.querySelectorAll('[data-tab]').length,4);
});
test('order evidence media loads only on expansion, coalesces requests and never renders into disposed view',async()=>{
 const w=new JSDOM('<details data-order-media><summary>Fotos</summary><div data-media-result></div></details>').window,root=w.document.body;
 let calls=0,resolve;const pending=new Promise(r=>resolve=r);
 const dispose=mountOrderMedia(root,{order:{id:'a'},load:()=>{calls++;return pending;}});
 assert.equal(calls,0);const detail=root.querySelector('details');detail.open=true;detail.dispatchEvent(new w.Event('toggle'));detail.dispatchEvent(new w.Event('toggle'));assert.equal(calls,1);
 dispose();resolve({photos:[{url:'/api/asset/a',mime:'image/png',name:'Old order'}]});await pending;await Promise.resolve();assert.equal(root.querySelector('img'),null);
});
test('order evidence media separates PDF video and image and retries errors without duplicate loads',async()=>{
 const w=new JSDOM('<details data-order-media="stored"><summary>Fotos</summary><div data-media-result></div></details>').window,root=w.document.body;let calls=0;
 mountOrderMedia(root,{order:{id:'a'},load:async()=>{if(++calls===1)throw Error('offline');return {photos:[{url:'/api/asset/image',mime:'image/png',name:'<script>unsafe</script>'},{url:'/api/asset/pdf',mime:'application/pdf',name:'Befund'},{url:'/api/asset/video',mime:'video/mp4',name:'Video'},{url:'https://tracker.example.invalid/pixel',mime:'image/png'}]};}});
 const toggle=()=>root.querySelector('details').dispatchEvent(new w.Event('toggle'));
 root.querySelector('details').open=true;toggle();await new Promise(r=>setTimeout(r,10));assert.ok(root.querySelector('[data-media-retry]'));root.querySelector('button').click();await new Promise(r=>setTimeout(r,10));
 assert.equal(root.querySelectorAll('img').length,1);assert.equal(root.querySelectorAll('video').length,1);assert.match(root.textContent,/PDF öffnen/);assert.equal(root.querySelector('script'),null);assert.ok(!root.innerHTML.includes('https://tracker'));toggle();assert.equal(calls,2);
});
test('protocol photos remain associated with their original or pending version',async()=>{
 const w=new JSDOM('<details data-order-media="intake"><summary>Fotos</summary><div data-media-result></div></details>').window,root=w.document.body;
 mountOrderMedia(root,{order:{id:'a',intake:{photos:['original']},pending:{intake:{content:{photos:['replacement']}}}},load:()=>{throw Error('must not fetch');}});
 root.querySelector('details').open=true;root.querySelector('details').dispatchEvent(new w.Event('toggle'));
 const imgs=[...root.querySelectorAll('img')];assert.equal(imgs.length,2);assert.match(imgs[0].alt,/Aktuelle Fassung/);assert.match(imgs[1].alt,/Offene Fassung/);
});

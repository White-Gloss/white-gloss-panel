import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const script=await readFile(new URL('../public/bookkeeping.js',import.meta.url),'utf8');
const config={advisor:'1001',client:'7',chart:'03',length:4,yearStart:'2026-01-01',locked:0};
function payload(month,label){return {version:'version-'+month,isOwner:true,settings:config,invoices:[],periods:[],view:{month,items:label?[{kind:'bank',key:'test',hash:'test',label,date:month+'-15',amount:100,remaining:100,currency:'EUR',side:'credit',status:'completed',matches:[],account:'DE123'}]:[],problems:[],entries:[],period:null,positions:{cutoff:month+'-30',items:[]},exports:[]}};}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
test('out-of-order month responses cannot replace the selected evidence or submit a close while loading',async()=>{
  const dom=new JSDOM('<p id="books-message"></p><div id="books-root"></div>',{url:'https://panel.example.invalid/buchhaltung?month=2026-09',runScripts:'outside-only'}),{window}=dom,pending=new Map(),posts=[];
  window.fetch=(url,options)=>{if(options.method==='POST'){posts.push(url);return Promise.resolve(new Response('{}'));}const month=new URL(url,window.location.href).searchParams.get('month');return new Promise(resolve=>pending.set(month,resolve));};
  try{window.eval(script);pending.get('2026-09')(new Response(JSON.stringify(payload('2026-09','September'))));await settle();window.document.querySelector('[data-tab=close]').click();
    const change=value=>{const input=window.document.querySelector('[data-month]');input.value=value;input.dispatchEvent(new window.Event('change',{bubbles:true}));};
    change('2026-08');window.document.querySelector('form[data-action=close]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(posts.length,0);
    change('2026-10');pending.get('2026-10')(new Response(JSON.stringify(payload('2026-10','October'))));await settle();pending.get('2026-08')(new Response(JSON.stringify(payload('2026-08','August'))));await settle();
    assert.equal(window.document.querySelector('[data-month]').value,'2026-10');assert.ok(window.document.querySelector('#books-root').textContent.includes('Monatsabschluss 2026-10'));assert.ok(!window.document.querySelector('#books-root').textContent.includes('Monatsabschluss 2026-08'));
    window.document.querySelector('[data-tab=bank]').click();assert.ok(window.document.querySelector('#books-root').textContent.includes('October'));assert.ok(!window.document.querySelector('#books-root').textContent.includes('August'));
  }finally{window.close();}
});

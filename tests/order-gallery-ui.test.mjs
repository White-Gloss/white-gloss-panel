import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountOrderGallery,orderGalleryHTML} from '../public/order-gallery.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,{holdOriginal=false}={}){
 const dom=new JSDOM(orderGalleryHTML(),{url:'https://panel.example.invalid'}),w=dom.window,sent=[];
 for(const [key,value] of Object.entries({window:w,document:w.document,AbortController:w.AbortController,fetch:async()=>Response.json({items:[],next:24,owner:false})})){const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else delete globalThis[key];});}
 let decodeStarted,finishDecode;const decoding=new Promise(r=>{decodeStarted=r;});
 let decodeCount=0;w.createImageBitmap=()=>{if(decodeCount++)return Promise.reject(Error('Synthetic decoder unavailable'));decodeStarted();return new Promise((_resolve,reject)=>{finishDecode=()=>reject(Error('Synthetic decoder unavailable'));});};
 w.XMLHttpRequest=class{upload={};done=false;open(_method,url){this.url=url;}setRequestHeader(){}send(file){sent.push(file.name);if(!holdOriginal)queueMicrotask(()=>{this.done=true;this.status=200;this.responseText='{"id":"synthetic"}';this.onload();});}abort(){if(!this.done){this.done=true;this.onabort();}}};
 const root=w.document.querySelector('[data-order-gallery]'),dispose=mountOrderGallery(root,{id:'synthetic'});t.after(()=>{dispose();w.close();});await tick();
 const form=root.querySelector('form'),files=['first.png','second.png'].map(name=>new w.File(['synthetic'],name,{type:'image/png'}));Object.defineProperty(form.elements.photos,'files',{value:files});
 const submit=()=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 const settle=async()=>{for(let i=0;i<30;i++){await tick();if(!form.querySelector('[type=submit]').disabled)return;}throw Error('Upload did not settle');};
 return {root,form,sent,decoding,finishDecode:()=>finishDecode(),submit,settle,dispose};
}
test('cancel during preview processing prevents later original uploads and permits retry',async t=>{
 const f=await fixture(t);f.submit();await f.decoding;f.root.querySelector('[data-upload-cancel]').click();f.finishDecode();await f.settle();
 assert.deepEqual(f.sent,['first.png'],'cancellation must stop the entire selected batch');assert.match(f.form.querySelector('[data-upload-status]').textContent,/abgebrochen/i);
 assert.equal(f.form.querySelector('[type=submit]').disabled,false);
});
test('cancel during original upload stops the batch',async t=>{
 const f=await fixture(t,{holdOriginal:true});f.submit();f.root.querySelector('[data-upload-cancel]').click();await f.settle();assert.deepEqual(f.sent,['first.png']);assert.match(f.form.querySelector('[data-upload-status]').textContent,/abgebrochen/i);
});
test('leaving gallery during preview processing never starts the next original',async t=>{
 const f=await fixture(t);f.submit();await f.decoding;f.dispose();f.finishDecode();await f.settle();assert.deepEqual(f.sent,['first.png']);
});
test('filter and pagination cannot replace an active upload form',async t=>{
 const f=await fixture(t,{holdOriginal:true});f.submit();assert.equal(f.root.querySelector('[data-gallery-filter]').disabled,true);assert.equal(f.root.querySelector('[data-gallery-more]').disabled,true);f.root.querySelector('[data-upload-cancel]').click();await f.settle();assert.equal(f.root.querySelector('[data-gallery-filter]').disabled,false);
});

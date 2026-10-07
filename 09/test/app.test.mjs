import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { IDBFactory } from 'fake-indexeddb';
import { createApp } from '../public/app.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function fixture() {
 const {document,window}=parseHTML(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'));
 for(const d of document.querySelectorAll('dialog')){d.showModal=()=>d.setAttribute('open',''); d.close=()=>d.removeAttribute('open');}
 const select=document.querySelector('#pixel-columns'); Object.defineProperty(select,'value',{get(){return this.querySelector('option[selected]')?.value??'64';},set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 return {document,window};
}
const file=()=>new File(['image'],'sample.png',{type:'image/png'});
const processed=async f=>({sourceBlob:f,thumbnailBlob:f,pixelBlob:new Blob(['pixel'],{type:'image/png'}),palette:['#112233','#223344','#334455','#445566','#556677'],width:100,height:80,columns:64,gridWidth:64,gridHeight:51});
async function setup(options={}){
 const {createBoardStore}=await import('../public/storage.mjs');
 const store=await createBoardStore(new IDBFactory(),'app');
 const dom=fixture(); let seq=0; const revoked=[];
 const app=createApp({...dom,store,processImage:processed,renderPixelArt:async()=>({pixelBlob:new Blob(['changed'],{type:'image/png'}),gridWidth:32,gridHeight:26}),clipboard:{writeText:async()=>{}},url:{createObjectURL:()=>`blob:${++seq}`,revokeObjectURL:u=>revoked.push(u)},...options});
 await app.init(); return {...dom,store,app,revoked};
}
test('upload automatically persists image and five colors; a fresh app restores it',async()=>{
 const s=await setup(); await s.app.addFiles([file(),file()]);
 assert.equal((await s.store.list()).length,2); assert.equal(s.document.querySelectorAll('.mood-card').length,2); assert.equal(s.document.querySelectorAll('.swatch').length,10);
 const dom=fixture(); const restored=createApp({...dom,store:s.store,url:{createObjectURL:()=> 'blob:restored',revokeObjectURL:()=>{}}}); await restored.init();
 assert.equal(dom.document.querySelectorAll('.mood-card').length,2); assert.equal(dom.document.querySelector('#empty-state').hidden,true); s.store.close();
});
test('detail title saves, empty title rejects, PNG link carries blob and deleting clears persisted record',async()=>{
 const s=await setup(); await s.app.addFiles([file()]); s.document.querySelector('.card-open').click();
 const name=s.document.querySelector('#detail-name'); name.value='New title'; name.dispatchEvent(new s.window.Event('change')); await tick(); assert.equal((await s.store.list())[0].name,'New title');
 name.value=' '; name.dispatchEvent(new s.window.Event('change')); await tick(); assert.equal((await s.store.list())[0].name,'New title');
 let downloaded; const original=s.document.defaultView.HTMLElement.prototype.click; s.document.defaultView.HTMLElement.prototype.click=function(){if(this.tagName==='A')downloaded={href:this.href,download:this.download};else original.call(this);};
 s.document.querySelector('#download-pixel').click();s.document.defaultView.HTMLElement.prototype.click=original;assert.match(downloaded?.href??'',/^blob:/);assert.match(downloaded?.download??'',/\.png$/);
 s.document.querySelector('#delete-card').click(); s.document.querySelector('#delete-confirm').click(); await tick();
 assert.equal((await s.store.list()).length,0); assert.equal(s.document.querySelectorAll('.mood-card').length,0); assert.ok(s.revoked.length>=2); s.store.close();
});
test('clipboard rejection exposes selectable HEX and processing rejection never creates success card',async()=>{
 const s=await setup({clipboard:{writeText:async()=>{throw Error('denied');}}}); await s.app.addFiles([file()]); s.document.querySelector('.swatch').click(); await tick();
 assert.match(s.document.querySelector('#toast').textContent,/#112233/);
 const failure=await setup({processImage:async()=>{throw Error('bad image');}}); await failure.app.addFiles([file()]); assert.equal((await failure.store.list()).length,0); assert.match(failure.document.querySelector('#status-message').textContent,/bad image/); s.store.close(); failure.store.close();
});

test('initialization shows a readable board count',async()=>{const {document}=fixture(); const app=createApp({document,store:{list:async()=>[]}}); await app.init(); assert.match(document.querySelector('#board-count').textContent,/0/);});

test('closed storage blocks upload after failed restore and preserves card on failed delete',async()=>{
 const s=await setup(); await s.app.addFiles([file()]); s.store.close();
 s.document.querySelector('.card-open').click();s.document.querySelector('#delete-card').click();s.document.querySelector('#delete-confirm').click();await tick();assert.equal(s.document.querySelectorAll('.mood-card').length,1);
 await s.app.init();await s.app.addFiles([file()]);assert.equal(s.document.querySelectorAll('.mood-card').length,1);assert.equal(s.document.querySelector('.restore-retry').hidden,false);
});
test('late pixel conversion persists correct card without changing another open detail',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const s=await setup({renderPixelArt:()=>pending});await s.app.addFiles([file(),new File(['b'],'other.png',{type:'image/png'})]);
 const buttons=s.document.querySelectorAll('.card-open');buttons[0].click();const first=s.document.querySelector('#detail-name').value;
 const select=s.document.querySelector('#pixel-columns');select.value='32';select.dispatchEvent(new s.window.Event('change'));await tick();
 buttons[1].click();const second=s.document.querySelector('#detail-name').value;assert.notEqual(first,second);
 resolve({pixelBlob:new Blob(['new pixels'],{type:'image/png'}),gridWidth:32,gridHeight:26});await tick();assert.equal(s.document.querySelector('#detail-name').value,second);const records=await s.store.list();assert.equal(records.find(r=>r.name===first).columns,32);assert.equal(records.find(r=>r.name===second).columns,64);s.store.close();
});
test('clipboard rejection inside modal offers a selectable input inside that dialog',async()=>{const s=await setup({clipboard:{writeText:async()=>{throw Error('denied');}}});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();s.document.querySelector('#detail-palette .swatch').click();await tick();assert.equal(s.document.querySelector('#detail-dialog input.copy-fallback')?.value,'#112233');s.store.close();});
test('tab switch during delayed title commit preserves edited name and cannot revert it on blur',async()=>{
 const s=await setup();await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();
 const realPut=s.store.put;let release;const pending=new Promise(resolve=>{release=resolve;});
 s.store.put=async record=>{await pending;await realPut(record);};
 const input=s.document.querySelector('#detail-name');input.value='new';input.dispatchEvent(new s.window.Event('change'));await tick();
 s.document.querySelector('#detail-pixel-tab').click();
 try{assert.equal(input.value,'new');}finally{release();}
 await tick();assert.equal((await s.store.list())[0].name,'new');input.dispatchEvent(new s.window.Event('blur'));await tick();assert.equal((await s.store.list())[0].name,'new');s.store.close();
});
test('pixel conversion completion preserves a title draft typed during conversion',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const s=await setup({renderPixelArt:()=>pending});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();
 const select=s.document.querySelector('#pixel-columns');select.value='32';select.dispatchEvent(new s.window.Event('change'));await tick();
 const input=s.document.querySelector('#detail-name');input.value='draft';
 release({pixelBlob:new Blob(['pixels'],{type:'image/png'}),gridWidth:32,gridHeight:26});await tick();assert.equal(input.value,'draft');input.dispatchEvent(new s.window.Event('blur'));await tick();assert.equal((await s.store.list())[0].name,'draft');s.store.close();
});

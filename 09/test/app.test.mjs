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
 for (const select of document.querySelectorAll('select')) Object.defineProperty(select,'value',{get(){return this.querySelector('option[selected]')?.value??'64';},set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 return {document,window};
}
const file=()=>new File(['image'],'sample.png',{type:'image/png'});
const processed=async f=>({sourceBlob:f,thumbnailBlob:f,pixelBlob:new Blob(['pixel'],{type:'image/png'}),palette:['#112233','#223344','#334455','#445566','#556677'],width:100,height:80,columns:64,gridWidth:64,gridHeight:51,pixelMode:'style'});
async function setup(options={}){
 const {createBoardStore}=await import('../public/storage.mjs');
 const store=await createBoardStore(new IDBFactory(),'app');
 const dom=fixture(); let seq=0; const revoked=[];
 const app=createApp({...dom,store,processImage:processed,renderPixelArt:async(_source,columns,pixelMode)=>({pixelBlob:new Blob(['changed'],{type:'image/png'}),gridWidth:columns,gridHeight:26,pixelMode}),clipboard:{writeText:async()=>{}},url:{createObjectURL:()=>`blob:${++seq}`,revokeObjectURL:u=>revoked.push(u)},...options});
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

// These scenarios catch dropped mode metadata, premature commits, stale UI writes,
// and applying later density changes with an earlier mode.
function change(s,id,value){const input=s.document.getElementById(id);assert.ok(input,`${id} control exists`);input.value=value;input.dispatchEvent(new s.window.Event('change'));}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
test('new uploads explicitly request detail at 96 columns and persist it through reload',async()=>{
 const s=await setup({processImage:async(f,options)=>{assert.deepEqual(options,{pixelMode:'detail',columns:96});return {...await processed(f),pixelMode:'detail',columns:96,gridWidth:96,gridHeight:77};}});
 await s.app.addFiles([file()]);assert.equal((await s.store.list())[0]?.pixelMode,'detail');
 await s.app.init();s.document.querySelector('.card-open').click();assert.equal(s.document.querySelector('#pixel-mode')?.value,'detail');assert.equal(s.document.querySelector('#pixel-columns').value,'96');assert.match(s.document.querySelector('.card-caption').textContent,/세밀.*96칸/);assert.equal(s.document.querySelectorAll('.card-palette .swatch').length,5);s.store.close();
});
test('legacy cards show original mode and retain their stored pixel bytes on restore',async()=>{
 const s=await setup();const legacy={...await processed(file()),id:'legacy',name:'legacy',createdAt:1};delete legacy.pixelMode;await s.store.put(legacy);await s.app.init();s.document.querySelector('.card-open').click();
 assert.equal(s.document.querySelector('#pixel-mode')?.value,'original');assert.match(s.document.querySelector('.card-caption').textContent,/원본 색 유지.*64칸/);assert.equal(await (await s.store.list())[0].pixelBlob.text(),'pixel');assert.equal((await s.store.list())[0].pixelMode,undefined);s.store.close();
});
test('mode changes render from source and update pixels only after storage commits',async()=>{
 const rendered=deferred();const s=await setup({renderPixelArt:async(source,columns,mode)=>{assert.equal(await source.text(),'image');assert.equal(columns,64);assert.equal(mode,'original');return rendered.promise;}});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();
 const originalUrl=s.document.querySelector('.card-download').href;change(s,'pixel-mode','original');await tick();assert.equal(s.document.querySelector('#pixel-columns').disabled,true);assert.equal(s.document.querySelector('.pixel-settings').getAttribute('aria-busy'),'true');
 const saved=deferred();const put=s.store.put;s.store.put=async record=>{await saved.promise;await put(record);};rendered.resolve({pixelBlob:new Blob(['original pixels']),gridWidth:64,gridHeight:51,pixelMode:'original'});await tick();assert.equal(s.document.querySelector('.card-download').href,originalUrl);assert.equal((await s.store.list())[0].pixelMode,'style');saved.resolve();await tick();
 assert.equal((await s.store.list())[0].pixelMode,'original');assert.equal(await (await s.store.list())[0].pixelBlob.text(),'original pixels');assert.notEqual(s.document.querySelector('.card-download').href,originalUrl);assert.equal(s.document.querySelector('#pixel-mode').disabled,false);assert.match(s.document.querySelector('#pixel-mode-description').textContent,/원본 색/);s.store.close();
});
for(const failure of ['render','storage'])test(`${failure} failure restores prior mode, density and pixel download`,async()=>{
 const s=await setup({renderPixelArt:async()=>{if(failure==='render')throw Error('render failed');return {pixelBlob:new Blob(['replacement']),gridWidth:64,gridHeight:51,pixelMode:'original'};}});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();const prior=s.document.querySelector('.card-download').href;
 if(failure==='storage')s.store.put=async()=>{throw Error('storage failed');};change(s,'pixel-mode','original');await tick();
 assert.equal(s.document.querySelector('#pixel-mode').value,'style');assert.equal(s.document.querySelector('#pixel-columns').value,'64');assert.equal(s.document.querySelector('.card-download').href,prior);assert.equal((await s.store.list())[0].pixelMode,'style');assert.equal(await (await s.store.list())[0].pixelBlob.text(),'pixel');assert.equal(s.document.querySelector('#pixel-mode').disabled,false);assert.match(s.document.querySelector('#status-message').textContent,/failed/);s.store.close();
});
test('queued mode and density changes retain latest controls and persist the combined choice',async()=>{
 const first=deferred();const second=deferred();let calls=0;
 const s=await setup({renderPixelArt:async(source,columns,pixelMode)=>{assert.equal(await source.text(),'image');calls++;if(calls===1){assert.equal(pixelMode,'original');return first.promise;}assert.equal(columns,128);assert.equal(pixelMode,'original');return second.promise;}});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();
 change(s,'pixel-mode','original');await tick();change(s,'pixel-columns','128');s.document.querySelector('#detail-pixel-tab').click();assert.equal(s.document.querySelector('#pixel-columns').value,'128');first.resolve({pixelBlob:new Blob(['first']),gridWidth:64,gridHeight:51,pixelMode:'original'});await tick();assert.equal(s.document.querySelector('#pixel-columns').value,'128');second.resolve({pixelBlob:new Blob(['second']),gridWidth:128,gridHeight:102,pixelMode:'original'});await tick();assert.equal((await s.store.list())[0].columns,128);assert.equal((await s.store.list())[0].pixelMode,'original');assert.equal(await (await s.store.list())[0].pixelBlob.text(),'second');s.store.close();
});
for(const targetMode of ['style','detail'])test(`late ${targetMode} conversion cannot switch another card preview or mode`,async()=>{
 const pending=deferred();const s=await setup({renderPixelArt:()=>pending.promise});await s.app.addFiles([file(),new File(['other'],'other.png',{type:'image/png'})]);const cards=await s.store.list();for(const card of cards)await s.store.put({...card,pixelMode:'original'});await s.app.init();const buttons=s.document.querySelectorAll('.card-open');buttons[0].click();change(s,'pixel-mode',targetMode);await tick();buttons[1].click();const image=s.document.querySelector('#detail-image').src;pending.resolve({pixelBlob:new Blob([targetMode]),gridWidth:64,gridHeight:51,pixelMode:targetMode});await tick();assert.equal(s.document.querySelector('#pixel-mode').value,'original');assert.equal(s.document.querySelector('#detail-image').src,image);assert.equal(s.document.querySelector('#detail-source-tab').getAttribute('aria-selected'),'true');assert.equal(s.document.querySelector('#pixel-mode').disabled,false);s.store.close();
});
test('selecting style reveals pixel preview without losing an unsaved title draft',async()=>{
 const pending=deferred();const s=await setup({renderPixelArt:()=>pending.promise});await s.app.addFiles([file()]);const [card]=await s.store.list();await s.store.put({...card,pixelMode:'original'});await s.app.init();s.document.querySelector('.card-open').click();change(s,'pixel-mode','style');await tick();s.document.querySelector('#detail-name').value='draft';pending.resolve({pixelBlob:new Blob(['style']),gridWidth:64,gridHeight:51,pixelMode:'style'});await tick();assert.equal(s.document.querySelector('#detail-pixel-tab').getAttribute('aria-selected'),'true');assert.equal(s.document.querySelector('#detail-name').value,'draft');assert.match(s.document.querySelector('#pixel-mode-description').textContent,/32색/);s.store.close();
});

test('reopening the same card while saving clears busy controls when conversion settles',async()=>{
 const pending=deferred();const s=await setup({renderPixelArt:()=>pending.promise});await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();change(s,'pixel-mode','original');await tick();s.document.querySelector('#detail-close').click();s.document.querySelector('.card-open').click();assert.equal(s.document.querySelector('#pixel-mode').disabled,true);pending.resolve({pixelBlob:new Blob(['original']),gridWidth:64,gridHeight:51,pixelMode:'original'});await tick();assert.equal(s.document.querySelector('#pixel-mode').disabled,false);assert.equal(s.document.querySelector('.pixel-settings').getAttribute('aria-busy'),'false');assert.equal(s.document.querySelector('#detail-source-tab').getAttribute('aria-selected'),'true');s.store.close();
});

for (const outcome of ['success', 'render failure', 'storage failure']) test(`detail at 96 columns ${outcome} keeps committed pixels and palette consistent`, async () => {
 const pending=deferred();
 const s=await setup({renderPixelArt:async(source,columns,mode)=>{assert.equal(await source.text(),'image');assert.equal(columns,96);assert.equal(mode,'detail');if(outcome==='render failure')throw Error('detail render failed');return pending.promise;}});
 await s.app.addFiles([file()]);s.document.querySelector('.card-open').click();
 const prior=s.document.querySelector('.card-download').href;
 // Set both controls before dispatching, as a combined settings request.
 s.document.querySelector('#pixel-columns').value='96';change(s,'pixel-mode','detail');await tick();
 if(outcome==='render failure'){
  assert.equal(s.document.querySelector('#pixel-mode').value,'style');
  assert.equal(s.document.querySelector('#pixel-columns').value,'64');
 }else{
  assert.equal(s.document.querySelector('#pixel-mode').disabled,true);
  assert.equal(s.document.querySelector('.card-download').href,prior);
  s.document.querySelector('#detail-name').value='draft';
  if(outcome==='storage failure')s.store.put=async()=>{throw Error('detail storage failed');};
  pending.resolve({pixelBlob:new Blob(['detail pixels']),gridWidth:96,gridHeight:77,pixelMode:'detail'});await tick();
 }
 const [saved]=await s.store.list();
 assert.deepEqual(saved.palette,['#112233','#223344','#334455','#445566','#556677']);
 assert.equal(s.document.querySelector('#pixel-mode').disabled,false);
 if(outcome==='success'){
  assert.equal(saved.pixelMode,'detail');assert.equal(saved.columns,96);assert.equal(await saved.pixelBlob.text(),'detail pixels');
  assert.equal(s.document.querySelector('#detail-pixel-tab').getAttribute('aria-selected'),'true');
  assert.equal(s.document.querySelector('#detail-name').value,'draft');
  assert.match(s.document.querySelector('#pixel-mode-description').textContent,/얇은 윤곽.*64색.*디더링 없음/);
  await s.app.init();assert.equal(await (await s.store.list())[0].pixelBlob.text(),'detail pixels');
 }else{
  assert.equal(saved.pixelMode,'style');assert.equal(saved.columns,64);assert.equal(await saved.pixelBlob.text(),'pixel');
  assert.equal(s.document.querySelector('.card-download').href,prior);
  assert.equal(s.document.querySelector('#pixel-mode').value,'style');
  assert.equal(s.document.querySelector('#pixel-columns').value,'64');
  assert.match(s.document.querySelector('#status-message').textContent,/failed/);
 }
 s.store.close();
});

for(const pixelMode of ['style','detail'])test(`restoring saved ${pixelMode} PNG does not regenerate or replace stored bytes`,async()=>{
 let renders=0;
 const s=await setup({renderPixelArt:async()=>{renders++;throw Error('must not regenerate');}});
 await s.store.put({...await processed(file()),id:'saved',name:'saved',createdAt:1,pixelMode,columns:pixelMode==='detail'?96:64});
 await s.app.init();s.document.querySelector('.card-open').click();s.document.querySelector('#detail-pixel-tab').click();
 assert.equal(renders,0);assert.equal(await (await s.store.list())[0].pixelBlob.text(),'pixel');
 assert.equal(s.document.querySelector('#pixel-mode').value,pixelMode);
 assert.equal(s.document.querySelector('#detail-image').src,s.document.querySelector('.card-download').href);
 s.store.close();
});

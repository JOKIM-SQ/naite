import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createKnowledgeApp} from '../public/app.mjs';
import {createKnowledgeSearch} from '../public/search.mjs';
import {documents} from '../public/documents.mjs';

// Controlled async library boundary: these test DOM state and real search rebuilding,
// not IndexedDB persistence. The real IndexedDB/browser scenario is verified separately.
const added={...documents[0],id:'mine',title:'별빛 프로젝트',summary:'별빛 운영 원문',sections:[{heading:'별빛 기록',text:'별빛 운영 원문 <script>문자 그대로</script>'}]};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(library){
 const {document,window}=parseHTML('<html><body><main id="app"></main></body></html>');
 createKnowledgeApp(document,{documents,search:createKnowledgeSearch(documents).search,library,createSearch:createKnowledgeSearch});
 const input=document.querySelector('[type="search"]');
 const event=(target,type,properties={})=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,properties);target.dispatchEvent(e);return e;};
 const type=value=>{input.value=value;event(input,'input');};
 return {document,input,event,type};
}
test('file selection waits for committed storage before search changes and resets picker',async()=>{
 const commit=deferred();let saved=[];
 const ui=setup({list:async()=>saved,importFiles:async files=>{assert.equal(files.length,1);await commit.promise;saved=[added];return {added:saved,duplicates:[],failures:[]};}});
 await flush();
 const file=ui.document.querySelector('[type="file"]');assert.ok(file);
 Object.defineProperty(file,'files',{value:[new File(['별빛'],'별빛.md')],configurable:true});
 ui.event(file,'change');ui.type('별빛');
 assert.equal(ui.document.querySelector('[data-add]').disabled,true);
 assert.equal(ui.document.querySelector('[data-result-id="mine"]'),null);
 commit.resolve();await flush();
 assert.equal(ui.input.value,'별빛');
 assert.ok(ui.document.querySelector('[data-result-id="mine"]'));
 assert.match(ui.document.querySelector('#reader').textContent,/별빛 운영 원문/);
 assert.equal(ui.document.querySelector('#reader script'),null);
 assert.equal(file.value,'');
 assert.equal(ui.document.querySelector('[data-add]').disabled,false);
 assert.match(ui.document.querySelector('[data-library-count]').textContent,/내 문서 1/);
});
test('restore preserves a query typed while waiting and restores searchable uploads',async()=>{
 const restore=deferred();const ui=setup({list:()=>restore.promise,importFiles:async()=>{throw Error();}});
 ui.type('별빛');restore.resolve([added]);await flush();
 assert.equal(ui.input.value,'별빛');
 assert.ok(ui.document.querySelector('[data-result-id="mine"]'));
});
test('drop reports partial failure and duplicate separately while retaining saved documents',async()=>{
 let saved=[];
 const ui=setup({list:async()=>saved,importFiles:async()=>{saved=[added];return {added:[added],duplicates:['중복.md'],failures:[{name:'잘못.pdf',message:'TXT와 Markdown 파일만 추가할 수 있어요.'}]};}});
 await flush();
 assert.ok(ui.document.querySelector('[data-drop]'));
 const drop=ui.event(ui.document.querySelector('[data-drop]'),'drop',{dataTransfer:{files:[new File(['내용'],'별빛.md')]}});
 await flush();
 assert.equal(drop.defaultPrevented,true);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/1개.*추가/);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/중복.md/);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/잘못.pdf/);
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,21);
});
test('restore failure keeps examples searchable and disables unavailable storage',async()=>{
 const ui=setup({list:async()=>{throw Error('blocked');},importFiles:async()=>{throw Error();}});
 ui.type('연차');await flush();
 assert.equal(ui.input.value,'연차');
 assert.ok(ui.document.querySelectorAll('[data-result-id]').length>0);
 assert.equal(ui.document.querySelector('[data-add]')?.disabled,true);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/저장|보관/);
});
test('failed save retains old corpus and does not claim success',async()=>{
 const ui=setup({list:async()=>[],importFiles:async()=>{throw Error('quota');}});await flush();
 assert.ok(ui.document.querySelector('[data-drop]'));
 ui.event(ui.document.querySelector('[data-drop]'),'drop',{dataTransfer:{files:[new File(['내용'],'별빛.txt')]}});await flush();
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,20);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/저장하지 못/);
 assert.equal(ui.document.querySelector('[data-add]').disabled,false);
});
// Catches reporting a committed import as a failed save when the refresh alone fails.
test('committed save followed by refresh failure is distinguished from storage failure',async()=>{
 let reads=0;
 const ui=setup({list:async()=>{if(reads++)throw Error('read failure');return [];},importFiles:async()=>({added:[added],duplicates:[],failures:[]})});await flush();
 ui.event(ui.document.querySelector('[data-drop]'),'drop',{dataTransfer:{files:[new File(['내용'],'별빛.txt')]}});await flush();
 const message=ui.document.querySelector('[data-import-status]').textContent;
 assert.match(message,/저장했지만/);
 assert.doesNotMatch(message,/저장하지 못/);
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,20);
});
// Catches a second import overwriting an in-flight commit or resetting the current query.
test('a drop during a pending import cannot start a second storage write',async()=>{
 const commit=deferred();let writes=0,saved=[];
 const ui=setup({list:async()=>saved,importFiles:async()=>{writes++;await commit.promise;saved=[added];return {added:saved,duplicates:[],failures:[]};}});await flush();
 const drop=()=>ui.event(ui.document.querySelector('[data-drop]'),'drop',{dataTransfer:{files:[new File(['내용'],'별빛.txt')]}});
 drop();drop();assert.equal(writes,1);
 assert.match(ui.document.querySelector('[data-import-status]').textContent,/완료.*다시/);
 commit.resolve();await flush();
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,21);
});
// Catches claiming a successful save and hiding the per-file error when no write committed.
test('zero added with file failure and failed refresh preserves errors and current query',async()=>{
 let reads=0;
 const ui=setup({list:async()=>{if(reads++)throw Error('read failure');return [];},importFiles:async()=>({added:[],duplicates:[],failures:[{name:'별빛.txt',message:'브라우저 저장 용량이 부족합니다.'}]})});await flush();
 ui.type('연차');
 const before=Array.from(ui.document.querySelectorAll('[data-result-id]'),item=>item.dataset.resultId);
 ui.event(ui.document.querySelector('[data-drop]'),'drop',{dataTransfer:{files:[new File(['내용'],'별빛.txt')]}});await flush();
 const message=ui.document.querySelector('[data-import-status]').textContent;
 assert.doesNotMatch(message,/저장했|추가했/);
 assert.match(message,/별빛.txt.*저장 용량이 부족/);
 assert.match(message,/목록.*불러오지 못/);
 assert.equal(ui.input.value,'연차');
 assert.deepEqual(Array.from(ui.document.querySelectorAll('[data-result-id]'),item=>item.dataset.resultId),before);
 ui.type('');
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,20);
});

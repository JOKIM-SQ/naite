import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {createKnowledgeApp} from '../public/app.mjs';

const docs = [
  {id:'leave',title:'휴가 신청',type:'가이드',department:'피플팀',owner:'김담당',updatedAt:'2026-09-01',summary:'휴가 신청 절차',keywords:['연차'],sections:[{heading:'신청 순서',text:'캘린더에 일정을 등록하세요.'}]},
  {id:'meal',title:'식대 정산',type:'FAQ',department:'재무팀',owner:'이담당',updatedAt:'2026-09-03',summary:'영수증 제출 방법',keywords:['점심'],sections:[{heading:'준비물',text:'영수증 원본을 첨부하세요.'}]},
];
function setup(search = q => docs.filter(d => !q || d.title.includes(q)).map(document => ({document,score:0,snippet:document.summary})), documents = docs) {
 const {document,window} = parseHTML('<!doctype html><html><body><main id="app"></main></body></html>');
 createKnowledgeApp(document,{documents,search});
 const input = () => document.querySelector('input');
 function event(target,type,properties={}) {const e=new window.Event(type,{bubbles:true,cancelable:true}); Object.assign(e,properties); target.dispatchEvent(e); return e;}
 function type(value) {input().value=value; event(input(),'input');}
 return {document,window,input,event,type};
}
// Catches missing initial rendering and input/result/reader synchronization.
test('typing updates result count and reader to the new top result',()=>{
 const ui=setup();
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,2);
 ui.type('식대');
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,1);
 assert.match(ui.document.querySelector('#reader').textContent,/영수증 원본/);
 assert.match(ui.document.querySelector('[role="status"]').textContent,/1/);
});
// Catches accidentally searching unfinished Hangul and searching the final input twice.
test('IME preserves previous results until composition ends and searches once',()=>{
 let calls=0;
 const ui=setup(q=>{calls++;return docs.filter(d=>!q||d.title.includes(q)).map(document=>({document,score:0,snippet:document.summary}));});
 const initial=calls;
 ui.event(ui.input(),'compositionstart'); ui.type('식');
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,2);
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),false);
 assert.equal(calls,initial);
 ui.input().value='식대'; ui.event(ui.input(),'compositionend'); ui.event(ui.input(),'input');
 assert.equal(calls,initial+1);
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),true);
 assert.match(ui.document.querySelector('#reader').textContent,/영수증 원본/);
});
// Catches stale reader on no results and clear not restoring browsing.
test('zero results clear the old reader and clear button restores documents',()=>{
 const ui=setup();
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),false);
 ui.type('없는검색어');
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),true);
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,0);
 assert.doesNotMatch(ui.document.querySelector('#reader').textContent,/캘린더/);
 ui.document.querySelector('[data-clear]').click();
 assert.equal(ui.input().value,'');
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),false);
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,2);
});
// Catches broken click selection, keyboard navigation and Escape reset.
test('click and arrow keys select a document with visible selected state',()=>{
 const ui=setup();
 ui.document.querySelector('[data-result-id="meal"]').click();
 assert.match(ui.document.querySelector('#reader').textContent,/영수증 원본/);
 assert.equal(ui.document.querySelector('[data-result-id="meal"]').getAttribute('aria-pressed'),'true');
 ui.event(ui.input(),'keydown',{key:'ArrowUp'});
 assert.match(ui.document.querySelector('#reader').textContent,/캘린더/);
 ui.type('식대'); ui.event(ui.input(),'keydown',{key:'Escape'});
 assert.equal(ui.input().value,'');
 assert.equal(ui.document.querySelector('#app').classList.contains('has-query'),false);
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,2);
});
// Catches HTML injection from corpus fields.
test('hostile document text stays literal, never creates executable elements',()=>{
 const evil={...docs[0],title:'<img src=x onerror=alert(1)>',sections:[{heading:'<script>alert(1)</script>',text:'<iframe src="evil"></iframe>'}]};
 const ui=setup(()=>[{document:evil,score:0,snippet:evil.title}],[evil]);
 assert.equal(ui.document.querySelector('img,script,iframe'),null);
 assert.match(ui.document.querySelector('#reader').textContent,/<iframe/);
});
// Catches stale results after search failure and failure to recover next input.
test('search failure removes stale content and next input can recover',()=>{
 const ui=setup(q=>{if(q==='fail')throw new Error('failed');return docs.map(document=>({document,score:0,snippet:document.summary}));});
 ui.type('fail');
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,0);
 assert.doesNotMatch(ui.document.querySelector('#reader').textContent,/캘린더/);
 ui.type('다시');
 assert.equal(ui.document.querySelectorAll('[data-result-id]').length,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {sample} from '../lib/sample.mjs';
import {chunkDocument,validateCitationAnswer} from '../lib/rag.mjs';

test('Tesla sample identifies the supplied manual edition and its unofficial translation',()=>{
 assert.match(sample.name,/Tesla Model 3/);
 for(const value of ['2024+','2026.38.3','북미','102~107','104~109','비공식','한국어 요약'])assert.ok(sample.sourceNote.includes(value),value);
 assert.ok(sample.text.length>=3000&&sample.text.length<=5000);
 assert.equal(sample.questions.length,3);
 assert.match(sample.questions[0],/감독/);assert.match(sample.questions[1],/해제/);assert.match(sample.questions[2],/비|눈|안개/);
 assert.match(sample.unknownQuestion,/한국.*출시일/);
 assert.ok(!sample.text.includes(sample.unknownQuestion));
});

test('FSD source excerpts preserve supervision, cancel controls, and visibility limits',()=>{
 for(const quote of ['does not make Model 3 autonomous','requires a fully attentive driver','Press the brake pedal.','Press the right scroll button on the steering wheel.','Take over and steer manually.','can significantly degrade performance.'])assert.ok(sample.text.includes(quote),quote);
 assert.match(sample.text,/한국어 요약은 Tesla의 공식 번역이 아닙니다/);
 assert.match(sample.text,/매뉴얼 p\.105 · PDF p\.107/);
 assert.match(sample.text,/매뉴얼 p\.107 · PDF p\.109/);
});

test('actual cancel excerpt remains citable with original PDF page after chunking',()=>{
 const quote='Press the brake pedal.';
 const chunks=chunkDocument(sample.text),at=chunks.findIndex(c=>c.content.includes(quote));
 assert.ok(at>=0);
 const result=validateCitationAnswer({answer:'브레이크 페달을 누르면 해제할 수 있습니다.',grounded:true,citations:[{index:at+1,quote}]},chunks,sample.name);
 assert.equal(result.grounded,true);
 assert.match(result.citations[0].section,/매뉴얼 p\.105 · PDF p\.107/);
});

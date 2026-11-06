import test from 'node:test';
import assert from 'node:assert/strict';
import {readAskResponse,newJourney,advanceJourney,finishJourney,failJourney} from '../public/rag-journey.js';

// Break caught: treating a streamed response as JSON, or decoding Korean per byte.
test('ask stream preserves split Korean and emits real progress before its result',async()=>{
 const bytes=new globalThis.TextEncoder().encode('{"type":"progress","stage":"embedding","question":"전화기"}\n{"type":"progress","stage":"search","vectorPreview":[0.2,-0.1]}\n{"type":"result","result":{"answer":"사용 금지","grounded":true}}\n');
 const response=new globalThis.Response(new globalThis.ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));controller.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
 const events=[];const result=await readAskResponse(response,event=>events.push(event));
 assert.equal(result.answer,'사용 금지');assert.equal(events[0].question,'전화기');assert.deepEqual(events.map(e=>e.stage),['embedding','search']);assert.deepEqual(events[1].vectorPreview,[0.2,-0.1]);
});
test('stream errors retain safe server message and unfinished streams cannot look complete',async()=>{
 const response=text=>new globalThis.Response(text,{headers:{'Content-Type':'application/x-ndjson'}});
 await assert.rejects(()=>readAskResponse(response('{"type":"error","message":"약 1분 후 다시 시도해 주세요."}\n')),/1분 후/);
 await assert.rejects(()=>readAskResponse(response('{"type":"progress","stage":"search"}\n')),/중단/);
 await assert.rejects(()=>readAskResponse(response('not json\n')),/읽지/);
});
test('ordinary JSON results and HTTP validation errors still work',async()=>{
 assert.equal((await readAskResponse(new globalThis.Response('{"answer":"기존 답변"}',{headers:{'Content-Type':'application/json'}}))).answer,'기존 답변');
 await assert.rejects(()=>readAskResponse(new globalThis.Response('{"message":"문서를 선택해 주세요."}',{status:404,headers:{'Content-Type':'application/json'}})),/문서를 선택/);
});
test('journey only advances on server events and failure preserves the observed stage',()=>{
 let state=newJourney('전화기를 봐도 되나요?');
 assert.equal(state.phase,'connecting');assert.equal(state.stage,null);assert.equal(state.trace.dimensions,undefined);
 state=advanceJourney(state,{stage:'embedding',dimensions:512,translated:true});
 assert.equal(state.stage,'embedding');assert.equal(state.trace.dimensions,512);assert.equal(state.trace.vectorPreview,undefined);
 state=advanceJourney(state,{stage:'search',searchQuestion:'Can I use a phone?',vectorPreview:[0.12,-0.2],threshold:0.35,limit:4});
 assert.equal(state.trace.question,'전화기를 봐도 되나요?');assert.equal(state.trace.searchQuestion,'Can I use a phone?');assert.deepEqual(state.trace.vectorPreview,[0.12,-0.2]);
 state=failJourney(state,'속도 제한');assert.equal(state.phase,'error');assert.equal(state.stage,'search');assert.equal(state.error,'속도 제한');
});
test('unknown answer keeps actual candidates without marking them as cited',()=>{
 const trace={question:'없는 질문',dimensions:512,candidates:[{index:1,content:'실제 문단',similarity:0.43,usedInAnswer:false}],grounded:false};
 const result=finishJourney(newJourney('없는 질문'),{grounded:false,trace});
 assert.equal(result.phase,'done');assert.equal(result.trace.candidates[0].usedInAnswer,false);assert.equal(result.trace.grounded,false);
 const reset=newJourney();assert.equal(reset.phase,'idle');assert.equal(reset.trace,null);
});
test('reviewing an old answer cannot replace the journey of an in-flight question',()=>{
 let current=newJourney('새 질문');
 current=advanceJourney(current,{stage:'search',searchQuestion:'New question',vectorPreview:[0.1]});
 const reviewed=finishJourney(current,{answer:'예전 답',trace:{question:'예전 질문'}},{review:true});
 assert.equal(reviewed.phase,'running');assert.equal(reviewed.trace.question,'새 질문');assert.deepEqual(reviewed.trace.vectorPreview,[0.1]);
});

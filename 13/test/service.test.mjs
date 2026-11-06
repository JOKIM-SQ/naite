import test from 'node:test';
import assert from 'node:assert/strict';
import {createService,sessionHash,missingConfig} from '../lib/service.mjs';
import {UNKNOWN} from '../lib/rag.mjs';
const session='12345678-1234-4123-8123-123456789012';
const documentId='abcdefab-1234-4123-8123-123456789012';
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',VOYAGE_API_KEY:'test',ANTHROPIC_API_KEY:'test'};
const reply=value=>({ok:true,json:async()=>value});
test('invalid session is rejected before external calls',async()=>{
 let called=false;const service=createService(env,async()=>{called=true;});
 await assert.rejects(()=>service.list('guessable'),e=>e.code==='INVALID_SESSION');assert.equal(called,false);
 assert.equal(sessionHash(session).length,64);assert.ok(!sessionHash(session).includes(session));
});
test('missing server keys are reported by name only',()=>{
 assert.deepEqual(missingConfig({SUPABASE_URL:'url'}),['SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY','ANTHROPIC_API_KEY']);
});
test('no similar chunks returns unknown without calling Claude',async()=>{
 const requests=[];
 const service=createService(env,async(url,options)=>{
  requests.push({url,body:options.body&&JSON.parse(options.body)});
  if(url.includes('s13_documents'))return reply([{name:'매뉴얼'}]);
  if(url.includes('voyageai'))return reply({data:[{index:0,embedding:Array(512).fill(0.1)}]});
  if(url.includes('s13_match_chunks'))return reply([]);
  throw Error('Unexpected provider call');
 });
 const r=await service.ask({session,documentId,question:'Wi-Fi가 있나요?'});
 assert.equal(r.grounded,false);assert.equal(r.answer,UNKNOWN);assert.equal(requests.length,3);
 assert.equal(requests[1].body.input_type,'query');assert.equal(requests[2].body.p_session_hash,sessionHash(session));
});
test('another session cannot query a document and no embedding call occurs',async()=>{
 let calls=0;const service=createService(env,async()=>{calls++;return reply([]);});
 await assert.rejects(()=>service.ask({session,documentId,question:'보증 기간?'}),e=>e.code==='DOCUMENT_NOT_FOUND');assert.equal(calls,1);
});
test('ingestion indexes every chunk through Voyage document embeddings and atomic RPC',async()=>{
 const requests=[];const text='공기청정기의 필터는 물로 세척하지 마세요. '.repeat(55);
 const service=createService(env,async(url,options)=>{
  const body=JSON.parse(options.body);requests.push({url,body});
  if(url.includes('voyageai'))return reply({data:body.input.map((_,index)=>({index,embedding:Array(512).fill(0.1)}))});
  return reply([{id:documentId,name:'제품 설명서',chunk_count:body.p_chunks.length}]);
 });
 const r=await service.ingest({session,name:'제품 설명서',text});
 assert.ok(r.chunk_count>1);assert.equal(requests[0].body.input_type,'document');
 assert.equal(requests[1].body.p_chunks.length,r.chunk_count);assert.equal(requests[1].body.p_content,text.trim());
});
test('provider errors do not expose private upstream body',async()=>{
 const service=createService(env,async()=>({ok:false,status:401,text:async()=>'secret-key'}));
 await assert.rejects(()=>service.list(session),e=>e.code==='UPSTREAM_ERROR'&&!e.message.includes('secret-key'));
});

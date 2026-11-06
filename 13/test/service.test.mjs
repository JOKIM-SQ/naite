import test from 'node:test';
import assert from 'node:assert/strict';
import {createService,sessionHash,missingConfig} from '../lib/service.mjs';
import {UNKNOWN} from '../lib/rag.mjs';
const session='12345678-1234-4123-8123-123456789012';
const documentId='abcdefab-1234-4123-8123-123456789012';
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',VOYAGE_API_KEY:'test',ANTHROPIC_API_KEY:'test'};
const reply=value=>({ok:true,json:async()=>value});
test('Korean questions about shared English manuals use translated embeddings and original answer question',async()=>{
 const requests=[];const question='fsd 를 사용할때 전화기를 봐도 되요?';const translated='Can I use a handheld phone while using Full Self-Driving (Supervised)?';
 const service=createService(env,async(url,options)=>{
  const body=options.body&&JSON.parse(options.body);requests.push({url,body});
  if(url.includes('s13_documents'))return reply([{name:'Tesla',is_preloaded:true,status:'ready',source:{language:'en'}}]);
  if(url.includes('anthropic')&&body.max_tokens!==1300){assert.equal(body.max_tokens,1024);return reply({content:[{type:'text',text:'  ```json\n'+JSON.stringify({query:translated})+'\n```  '}]});}
  if(url.includes('voyageai'))return reply({data:[{index:0,embedding:Array(512).fill(0.1)}]});
  if(url.includes('s13_match_chunks'))return reply([{content:'Do not use a handheld phone.',section:'FSD',position:1,similarity:0.6}]);
  return reply({content:[{type:'text',text:JSON.stringify({answer:'휴대전화를 사용하지 마세요.',grounded:true,citations:[{index:1,quote:'Do not use a handheld phone.'}]})}]});
 });
 const result=await service.ask({session,documentId,question});
 assert.deepEqual(requests.find(r=>r.url.includes('voyageai')).body.input,[translated]);
 assert.equal(JSON.parse(requests.at(-1).body.messages[0].content).question,question);
 assert.equal(result.grounded,true);assert.equal(result.retrieval.translated,true);assert.equal(result.retrieval.queryLanguage,'en');
 assert.equal(requests.filter(r=>r.url.includes('voyageai')).length,1);assert.equal(requests.find(r=>r.url.includes('s13_match_chunks')).body.p_threshold,0.35);
});
for(const translation of ['bad json',JSON.stringify({query:''}),JSON.stringify({query:'x'.repeat(1001)}),JSON.stringify({query:'한국어'})])test(`invalid search translation stops before embedding: ${translation.slice(0,20)}`,async()=>{
 let calls=0;const service=createService(env,async(url)=>{calls++;if(url.includes('s13_documents'))return reply([{is_preloaded:true,status:'ready',source:{language:'en'}}]);return reply({content:[{type:'text',text:translation}]});});
 await assert.rejects(()=>service.ask({session,documentId,question:'전화기를 봐도 되나요?'}),e=>e.status===502&&e.code==='INVALID_TRANSLATION');
 assert.equal(calls,2);
});
for(const [preloaded,language,question] of [[false,'en','한국어 질문'],[true,'ko','한국어 질문'],[true,'en','Can I use a phone?']])test(`translation bypass for ${preloaded}/${language}/${question}`,async()=>{
 const requests=[];const service=createService(env,async(url,options)=>{requests.push(url);if(url.includes('s13_documents'))return reply([{is_preloaded:preloaded,source:{language},session_hash:sessionHash(session),status:'ready'}]);if(url.includes('voyageai')){assert.deepEqual(JSON.parse(options.body).input,[question]);return reply({data:[{index:0,embedding:Array(512).fill(0.1)}]});}return reply([]);});
 await service.ask({session,documentId,question});assert.equal(requests.length,3);assert.ok(!requests.some(url=>url.includes('anthropic')));
});
test('preloaded catalog is shared metadata only and private listing excludes preloaded rows',async()=>{
 const paths=[];const service=createService(env,async(url)=>{paths.push(url);return reply([]);});
 await service.list(session);await service.preloaded();
 assert.match(paths[0],/session_hash=eq\./);assert.match(paths[0],/is_preloaded=eq.false/);
 assert.match(paths[1],/is_preloaded=eq.true/);assert.ok(!new URL(paths[1]).searchParams.get('select').split(',').includes('content'));
});
test('ready preloaded manuals can be queried from a different session',async()=>{
 const requests=[];const service=createService(env,async(url)=>{
  requests.push(url);
  if(url.includes('s13_documents'))return reply([{id:documentId,name:'공유 매뉴얼',is_preloaded:true,status:'ready',session_hash:'other-owner'}]);
  if(url.includes('voyageai'))return reply({data:[{index:0,embedding:Array(512).fill(0.1)}]});
  if(url.includes('s13_match_chunks'))return reply([]);
  throw Error('Unexpected provider call');
 });
 const result=await service.ask({session,documentId,question:'휴대전화를 사용해도 되나요?'});
 assert.equal(result.grounded,false);assert.equal(requests.length,3);
 assert.match(requests[0],/or=\(session_hash.eq\.[a-f0-9]+,is_preloaded.eq.true\)/);
});
test('processing preloaded manuals return 409 before any embedding request',async()=>{
 let requests=0;const service=createService(env,async()=>{requests++;return reply([{id:documentId,name:'준비 중',is_preloaded:true,status:'processing'}]);});
 await assert.rejects(()=>service.ask({session,documentId,question:'휴대전화?'}),e=>e.status===409&&e.code==='DOCUMENT_NOT_READY');
 assert.equal(requests,1);
});
test('returned private rows still require matching ownership before embedding',async()=>{
 let requests=0;const service=createService(env,async()=>{requests++;return reply([{id:documentId,name:'다른 사람 문서',session_hash:'other',is_preloaded:false,status:'ready'}]);});
 await assert.rejects(()=>service.ask({session,documentId,question:'내용?'}),e=>e.code==='DOCUMENT_NOT_FOUND');
 assert.equal(requests,1);
});
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
  if(url.includes('s13_documents'))return reply([{name:'매뉴얼',session_hash:sessionHash(session),status:'ready'}]);
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
test('Voyage rate limits retain HTTP 429 and explain when to retry without leaking provider body',async()=>{
 const service=createService(env,async()=>({ok:false,status:429,text:async()=>'private-provider-secret'}));
 await assert.rejects(()=>service.ingest({session,name:'매뉴얼',text:'제품 필터는 물로 씻지 말고 정기적으로 교체하세요. '.repeat(3)}),error=>{
  assert.equal(error.status,429);assert.equal(error.code,'RATE_LIMITED');
  assert.match(error.message,/Voyage AI/);assert.match(error.message,/요청 속도/);assert.match(error.message,/1분 후.*다시 시도/);
  assert.ok(!error.message.includes('private-provider-secret'));return true;
 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createService,sessionHash} from '../lib/service.mjs';
import handler from '../api/manual.mjs';

const session='12345678-1234-4123-8123-123456789012';
const documentId='abcdefab-1234-4123-8123-123456789012';
const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-secret',VOYAGE_API_KEY:'voyage-secret',ANTHROPIC_API_KEY:'claude-secret'};
const reply=value=>({ok:true,json:async()=>value});
const chunks=[
 {section:'매뉴얼 p.106 / PDF p.108',content:'WARNING: Do not use handheld devices while using Self-Driving features.',similarity:0.61,position:600},
 {section:'매뉴얼 p.105 / PDF p.107',content:'Press the brake pedal to disengage.',similarity:0.49,position:590}
];
const payload={session,documentId,question:'Can I use a handheld phone?'};
function provider({sequence=[],candidates=chunks,denied=false,invalidCitation=false,failEmbedding=false}={}){
 return async(url)=>{
  if(url.includes('s13_documents')){sequence.push('lookup');return reply(denied?[]:[{name:'Tesla',is_preloaded:true,status:'ready',source:{language:'en'},session_hash:'private-owner-value'}]);}
  if(url.includes('voyageai')){sequence.push('voyage');if(failEmbedding)return {ok:false,status:429};return reply({data:[{index:0,embedding:Array.from({length:512},(_,i)=>i/1000)}]});}
  if(url.includes('s13_match_chunks')){sequence.push('match');return reply(candidates);}
  if(url.includes('anthropic')){sequence.push('claude');return reply({content:[{type:'text',text:JSON.stringify({answer:'휴대전화를 사용하지 마세요.',grounded:true,citations:[{index:1,quote:invalidCitation?'This is not in the document.':'Do not use handheld devices while using Self-Driving features.'}]})}]});}
  throw Error('Unexpected request');
 };
}

// Missing or reordered real progress events must fail before the final answer is inspected.
test('progress follows actual authorized RAG calls and trace exposes only returned candidates and twelve vector values',async()=>{
 const sequence=[],events=[];
 const result=await createService(env,provider({sequence})).ask(payload,{onProgress:event=>{events.push(event);sequence.push(event.stage);}});
 assert.deepEqual(sequence,['lookup','embedding','voyage','search','match','answer','claude','verify']);
 assert.deepEqual(events.map(e=>e.stage),['embedding','search','answer','verify']);
 assert.equal(events[1].searchQuestion,payload.question);assert.equal(events[1].vectorPreview.length,12);
 assert.deepEqual(result.trace,{question:payload.question,searchQuestion:payload.question,translated:false,dimensions:512,vectorPreview:[0,.001,.002,.003,.004,.005,.006,.007,.008,.009,.01,.011],threshold:.35,limit:4,candidates:[{index:1,...chunks[0],usedInAnswer:true},{index:2,...chunks[1],usedInAnswer:false}],grounded:true});
 assert.ok(!JSON.stringify(result.trace).includes('private-owner-value'));
 assert.ok(!JSON.stringify(result.trace).includes('server-secret'));
});

test('trace marks all candidates unused when literal citation validation rejects the generated answer',async()=>{
 const result=await createService(env,provider({invalidCitation:true})).ask(payload);
 assert.equal(result.grounded,false);assert.equal(result.trace.grounded,false);
 assert.deepEqual(result.trace.candidates.map(c=>c.usedInAnswer),[false,false]);
});

test('translated search trace retains the original question and the actual English embedding input',async()=>{
 const events=[],requests=[];const fallback=provider();
 const service=createService(env,async(url,options)=>{
  const body=options.body&&JSON.parse(options.body);requests.push({url,body});
  if(url.includes('anthropic')&&body.max_tokens===1024)return reply({content:[{type:'text',text:JSON.stringify({query:'Can I use a phone during Full Self-Driving?'})}]});
  return fallback(url,options);
 });
 const result=await service.ask({...payload,question:'FSD 중 휴대전화를 봐도 돼요?'},{onProgress:event=>events.push(event)});
 assert.equal(result.trace.question,'FSD 중 휴대전화를 봐도 돼요?');
 assert.equal(result.trace.translated,true);
 assert.equal(result.trace.searchQuestion,'Can I use a phone during Full Self-Driving?');
 assert.equal(events.find(e=>e.stage==='search').searchQuestion,'Can I use a phone during Full Self-Driving?');
 assert.deepEqual(requests.find(r=>r.url.includes('voyageai')).body.input,['Can I use a phone during Full Self-Driving?']);
});

test('zero matches reports skipped answer without a Claude request and returns an empty evidence trace',async()=>{
 const sequence=[],events=[];
 const result=await createService(env,provider({sequence,candidates:[]})).ask(payload,{onProgress:event=>events.push(event)});
 assert.deepEqual(sequence,['lookup','voyage','match']);
 assert.equal(events.find(e=>e.stage==='answer')?.skipped,true);
 assert.equal(events.find(e=>e.stage==='verify')?.skipped,true);
 assert.equal(result.grounded,false);assert.deepEqual(result.trace.candidates,[]);
});

test('unauthorized manuals never emit progress or expose their trace',async()=>{
 const events=[];
 await assert.rejects(()=>createService(env,provider({denied:true})).ask(payload,{onProgress:event=>events.push(event)}),e=>e.code==='DOCUMENT_NOT_FOUND');
 assert.deepEqual(events,[]);
});

async function withEnvironment(fetcher,run){
 const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));const originalFetch=globalThis.fetch;
 try{Object.assign(process.env,env);globalThis.fetch=fetcher;return await run();}
 finally{globalThis.fetch=originalFetch;for(const key of Object.keys(env)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
}
async function api(body,fetcher){
 const parts=[];const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},flushHeaders(){this.flushed=true;},write(part){parts.push(part);return true;},end(part){if(part)parts.push(part);this.ended=true;}};
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/api/manual';req.headers={host:'localhost','content-type':'application/json'};
 await withEnvironment(fetcher,()=>handler(req,res));
 return {...res,text:parts.join('')};
}

test('opt-in streaming sends progress before one terminal result and preserves ordinary JSON responses',async()=>{
 const streamed=await api({action:'ask',stream:true,...payload},provider());
 assert.match(streamed.headers['content-type'],/application\/x-ndjson/);
 const events=streamed.text.trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(events.map(e=>e.type),['progress','progress','progress','progress','result']);
 assert.equal(events.at(-1).result.trace.grounded,true);
 assert.equal(streamed.flushed,true);assert.equal(streamed.ended,true);assert.equal(streamed.statusCode,200);
 assert.ok(events.every(e=>e.type!=='progress'||Number.isFinite(e.elapsedMs)));
 const ordinary=await api({action:'ask',...payload},provider());
 assert.match(ordinary.headers['content-type'],/application\/json/);assert.equal(JSON.parse(ordinary.text).grounded,true);
});

test('provider errors after streaming starts end with one safe error event',async()=>{
 const streamed=await api({action:'ask',stream:true,...payload},provider({failEmbedding:true}));
 const events=streamed.text.trim().split('\n').map(line=>JSON.parse(line));
 assert.deepEqual(events.map(e=>e.type),['progress','error']);
 assert.equal(events[1].error,'RATE_LIMITED');assert.match(events[1].message,/1분 후/);
 assert.ok(!streamed.text.includes('secret'));assert.equal(streamed.ended,true);
});

test('invalid or unauthorized streaming asks retain normal HTTP errors before headers are flushed',async()=>{
 for(const [body,fetcher,status,code] of [
  [{action:'ask',stream:true,...payload,session:'bad'},provider(),400,'INVALID_SESSION'],
  [{action:'ask',stream:true,...payload,question:''},provider(),400,'INVALID_QUESTION'],
  [{action:'ask',stream:true,...payload},provider({denied:true}),404,'DOCUMENT_NOT_FOUND']
 ]){
  const response=await api(body,fetcher);
  assert.equal(response.statusCode,status);assert.equal(JSON.parse(response.text).error,code);assert.ok(!response.flushed);
 }
});

test('private question trace is only produced for its own authorized session',async()=>{
 const events=[];
 const service=createService(env,async()=>reply([{is_preloaded:false,status:'ready',session_hash:sessionHash('99999999-1234-4123-8123-123456789012')}]));
 await assert.rejects(()=>service.ask(payload,{onProgress:event=>events.push(event)}),e=>e.code==='DOCUMENT_NOT_FOUND');
 assert.deepEqual(events,[]);
});

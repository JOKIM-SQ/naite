import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildCorpus} from '../lib/pdf-corpus.mjs';
import {embedCorpus,syncCorpus,beginSync,readTokenCounts} from '../scripts/preload-manual.mjs';
const chunks=Array.from({length:5},(_,position)=>({position,section:'PDF p.1',pdfPage:1,content:`source ${position}`}));
const corpus={content:'source text',pages:[{pdfPage:1}],chunks};
const reply=(data,status=200,headers={})=>({ok:status<400,status,headers:new globalThis.Headers(headers),json:async()=>data});
test('embedding checkpoints resume without another provider request and reject changed corpus',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-preload-'));let calls=0;
 try{
  const fetcher=async(_url,o)=>{calls++;const input=JSON.parse(o.body).input;return reply({data:input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});};
  const options={cacheDir,key:'not-real',fetcher,batchSize:3,delayMs:0,sleep:async()=>{},log:()=>{}};
  const first=await embedCorpus(corpus,options);assert.equal(first.embeddings.length,5);assert.equal(calls,2);
  await embedCorpus(corpus,options);assert.equal(calls,2);
  await assert.rejects(()=>embedCorpus({...corpus,content:'changed'},options),/다른 문서|일치/);
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('rate limit respects Retry-After, reduces batch, and never logs response secrets',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-rate-'));let calls=0;const waits=[],logs=[];
 try{
  const result=await embedCorpus(corpus,{cacheDir,key:'not-real',batchSize:5,delayMs:0,sleep:async ms=>waits.push(ms),log:x=>logs.push(x),fetcher:async(_url,o)=>{calls++;if(calls<=2)return reply({secret:'do-not-log'},429,{'retry-after':'2'});return reply({data:JSON.parse(o.body).input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});}});
  assert.equal(result.embeddings.length,5);assert.ok(waits.includes(2000));assert.ok(calls>3);assert.ok(!JSON.stringify(logs).includes('do-not-log'));
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('an interrupted run resumes after the persisted batch instead of paying for it again',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-partial-'));let calls=0;const inputs=[];
 try{
  const options={cacheDir,key:'not-real',batchSize:3,delayMs:0,log:()=>{},fetcher:async(_url,o)=>{calls++;const input=JSON.parse(o.body).input;inputs.push(input);if(calls===2)throw new Error('simulated network interruption');return reply({data:input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});}};
  await assert.rejects(()=>embedCorpus(corpus,options),/재시작|이어갑니다/);
  const result=await embedCorpus(corpus,options);
  assert.equal(result.embeddings.length,5);assert.equal(calls,3);
  assert.deepEqual(inputs[0],['source 0','source 1','source 2']);assert.deepEqual(inputs[2],['source 3','source 4']);
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('checkpoint corruption is rejected before provider access',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-corrupt-'));let calls=0;
 try{
  const opts={cacheDir,key:'not-real',batchSize:5,delayMs:0,log:()=>{},fetcher:async(_url,o)=>{calls++;return reply({data:JSON.parse(o.body).input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});}};
  await embedCorpus(corpus,opts);
  const batchPath=join(cacheDir,'batch-000000.json');const b=JSON.parse(readFileSync(batchPath,'utf8'));b.embeddings[0]=[1];writeFileSync(batchPath,JSON.stringify(b));
  await assert.rejects(()=>embedCorpus(corpus,opts),/체크포인트|캐시/);assert.equal(calls,1);
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('successful usage is measured and cache is reusable when a database callback fails',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-callback-'));let calls=0;const logs=[],starts=[];
 try{
  const options={cacheDir,key:'not-real',batchSize:3,delayMs:0,log:e=>logs.push(e),fetcher:async(_url,o)=>{calls++;return reply({usage:{total_tokens:42},data:JSON.parse(o.body).input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});},onBatch:async b=>{starts.push(b.start);throw new Error('simulated DB failure');}};
  await assert.rejects(()=>embedCorpus(corpus,options),/simulated DB failure/);
  const saved=JSON.parse(readFileSync(join(cacheDir,'batch-000000.json'),'utf8'));assert.equal(saved.usageTotalTokens,42);assert.ok(saved.elapsedMs>=0);
  await embedCorpus(corpus,{...options,onBatch:async b=>starts.push(b.start)});
  assert.equal(calls,2);assert.deepEqual(starts,[0,0,3]);
  assert.ok(logs.some(e=>e.status==='batch_embedded'&&e.usageTotalTokens===42));
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('incremental synchronization creates processing first and advances progress before final readiness',async()=>{
 const requests=[];let written=0;
 const store=await beginSync(corpus,{url:'https://example.supabase.co',key:'not-real',log:()=>{},fetcher:async(url,o)=>{requests.push({url,body:o.body&&JSON.parse(o.body)});if(url.includes('s13_chunks')&&o.method==='POST')written+=JSON.parse(o.body).length;return o.method==='HEAD'?{ok:true,status:200,headers:new globalThis.Headers({'content-range':`0-4/${written}`})}:reply([]);}});
 assert.equal(requests.find(r=>r.body?.is_preloaded).body.status,'processing');
 await store.writeBatch({start:0,embeddings:Array.from({length:3},()=>Array(512).fill(.1))});
 assert.equal(requests.at(-1).body.indexed_chunks,3);assert.ok(!requests.some(r=>r.body?.status==='ready'));
 await assert.rejects(()=>store.finish(),/완료|청크/);
 await store.writeBatch({start:3,embeddings:Array.from({length:2},()=>Array(512).fill(.1))});await store.finish();
 assert.equal(requests.at(-1).body.status,'ready');assert.equal(requests.at(-1).body.indexed_chunks,5);
});
test('database readiness is only published after exact stored count, and failed writes stay processing',async()=>{
 const requests=[];let written=0;
 const embeddings=chunks.map(()=>Array(512).fill(.1));
 const options={url:'https://example.supabase.co',key:'not-real',log:()=>{},fetcher:async(url,o)=>{requests.push({url,body:o.body&&JSON.parse(o.body)});if(o.method==='POST'&&url.includes('s13_chunks'))written+=JSON.parse(o.body).length;if(o.method==='HEAD')return {ok:true,status:200,headers:new globalThis.Headers({'content-range':`0-4/${written}`})};return reply([]);}};
 await syncCorpus(corpus,embeddings,options);
 assert.equal(requests.at(-1).body.status,'ready');assert.equal(requests.at(-1).body.indexed_chunks,5);
 const failed=[];
 await assert.rejects(()=>syncCorpus(corpus,embeddings,{...options,fetcher:async(url,o)=>{failed.push(o.body&&JSON.parse(o.body));return url.includes('s13_chunks')?reply({},500):reply([]);}}));
 assert.ok(!failed.some(x=>x?.status==='ready'));
});
test('a mismatched stored count is never published as ready',async()=>{
 const writes=[];
 await assert.rejects(()=>syncCorpus(corpus,chunks.map(()=>Array(512).fill(.1)),{url:'https://example.supabase.co',key:'not-real',log:()=>{},fetcher:async(_url,o)=>{if(o.body)writes.push(JSON.parse(o.body));return o.method==='HEAD'?{ok:true,status:200,headers:new globalThis.Headers({'content-range':'0-3/4'})}:reply([]);}}),/일치하지 않습니다/);
 assert.ok(!writes.some(x=>x?.status==='ready'));
});
test('token-budget batches resume existing checkpoints and pack only new requests below the budget',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-token-pack-'));let calls=0;const inputs=[];
 try{
  const options={cacheDir,key:'not-real',batchSize:2,delayMs:0,log:()=>{},fetcher:async(_url,o)=>{calls++;const input=JSON.parse(o.body).input;inputs.push(input);if(calls===2)throw new Error('stop after checkpoint');return reply({data:input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))});}};
  await assert.rejects(()=>embedCorpus(corpus,options));
  const result=await embedCorpus(corpus,{...options,batchSize:5,tokenCounts:[4,4,4,4,4],tokenBudget:8});
  assert.equal(result.embeddings.length,5);assert.deepEqual(inputs.slice(2),[['source 2','source 3'],['source 4']]);
  assert.equal(inputs.filter(input=>input.includes('source 0')).length,1);
 }finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('token count files bind every count to the exact source and embedding model',()=>{
 const dir=mkdtempSync(join(tmpdir(),'folio-token-file-')),path=join(dir,'counts.json');
 const c={...corpus,sourceSha256:'source-hash'};
 const record={sourceSha256:'source-hash',model:'voyage-4-lite',counts:[4,4,4,4,4]};
 try{
  writeFileSync(path,JSON.stringify(record));assert.deepEqual(readTokenCounts(c,path),record.counts);
  for(const altered of [{...record,sourceSha256:'another-source'},{...record,model:'another-model'},{...record,counts:[4]},{...record,counts:[4,-1,4,4,4]}]){writeFileSync(path,JSON.stringify(altered));assert.throws(()=>readTokenCounts(c,path),/토큰|원문|모델|일치/);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('a single new chunk exceeding the token budget fails without a provider call',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'folio-token-over-'));let calls=0;
 try{await assert.rejects(()=>embedCorpus(corpus,{cacheDir,key:'not-real',batchSize:5,tokenCounts:[11,1,1,1,1],tokenBudget:10,delayMs:0,log:()=>{},fetcher:async()=>{calls++;return reply({});}}),/토큰|예산/);assert.equal(calls,0);}
 finally{rmSync(cacheDir,{recursive:true,force:true});}
});
test('CLI resumes completed cache with token flags and rejects a different-source token file without network',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'folio-token-cli-')),source=join(dir,'manual.txt'),tokens=join(dir,'tokens.json'),guard=join(dir,'no-network.mjs');
 try{
  const raw='Manual text. '.repeat(100)+'\f';writeFileSync(source,raw);writeFileSync(guard,'globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN"); };');
  const c=buildCorpus(raw);await embedCorpus(c,{cacheDir:dir,key:'test-only',batchSize:2,delayMs:0,log:()=>{},fetcher:async(_url,o)=>reply({data:JSON.parse(o.body).input.map((_,index)=>({index,embedding:Array(512).fill(.1)}))})});
  const record={sourceSha256:c.sourceSha256,model:'voyage-4-lite',counts:c.chunks.map(()=>4)};writeFileSync(tokens,JSON.stringify(record));
  const args=['--import',guard,fileURLToPath(new URL('../scripts/preload-manual.mjs',import.meta.url)),'--textfile',source,'--embed-only','--cache-dir',dir,'--batch-size','5','--delay-ms','0','--token-counts',tokens,'--max-tokens','8'];
  const env={PATH:process.env.PATH,VOYAGE_API_KEY:'test-only',SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'};
  const resumed=spawnSync(process.execPath,args,{encoding:'utf8',env});assert.equal(resumed.status,0,resumed.stderr);assert.match(resumed.stdout,/"status":"resumed"/);assert.match(resumed.stdout,/"status":"embedded"/);
  writeFileSync(tokens,JSON.stringify({...record,sourceSha256:'different'}));const rejected=spawnSync(process.execPath,args,{encoding:'utf8',env});assert.equal(rejected.status,1);assert.match(rejected.stderr,/일치하지 않습니다/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

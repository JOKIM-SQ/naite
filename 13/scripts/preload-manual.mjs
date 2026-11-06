import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {buildCorpus} from '../lib/pdf-corpus.mjs';
import {CHUNK_SIZE,OVERLAP,DIMENSIONS,EMBEDDING_MODEL} from '../lib/rag.mjs';
import {TESLA_MANUAL} from '../lib/catalog.mjs';
const digest=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const save=(path,data)=>{writeFileSync(path+'.tmp',JSON.stringify(data));renameSync(path+'.tmp',path);};
const validVector=v=>Array.isArray(v)&&v.length===DIMENSIONS&&v.every(Number.isFinite);
const checkpointPath=(cacheDir,start)=>join(cacheDir,`batch-${String(start).padStart(6,'0')}.json`);
function identity(corpus){return digest({content:corpus.content,chunks:corpus.chunks,model:EMBEDDING_MODEL,dimensions:DIMENSIONS,chunkSize:CHUNK_SIZE,overlap:OVERLAP});}
function cachedBatch(path,start,total){
 let b;try{b=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('임베딩 체크포인트 파일을 읽을 수 없습니다. 캐시를 확인해 주세요.');}
 if(b.start!==start||!Number.isInteger(b.count)||b.count<1||start+b.count>total||!Array.isArray(b.embeddings)||b.embeddings.length!==b.count||!b.embeddings.every(validVector)||b.checksum!==digest(b.embeddings))throw new Error('임베딩 체크포인트 캐시 검증에 실패했습니다.');
 return b;
}
export async function embedCorpus(corpus,{cacheDir,key,fetcher=fetch,batchSize=128,delayMs=21000,sleep=wait,log=console.log,maxRetries=8,onBatch,tokenCounts,tokenBudget}={}){
 if(!cacheDir)throw new Error('체크포인트 폴더가 필요합니다.');
 if(!Number.isInteger(batchSize)||batchSize<1||batchSize>128||!Number.isFinite(delayMs)||delayMs<0)throw new Error('배치 크기는 1~128, 대기 시간은 0 이상이어야 합니다.');
 if(tokenCounts!==undefined&&(!Array.isArray(tokenCounts)||tokenCounts.length!==corpus.chunks.length||tokenCounts.some(n=>!Number.isSafeInteger(n)||n<0)||!Number.isSafeInteger(tokenBudget)||tokenBudget<1))throw new Error('각 청크의 토큰 수와 양의 정수 토큰 예산이 필요합니다.');
 if(tokenBudget!==undefined&&tokenCounts===undefined)throw new Error('토큰 예산을 적용하려면 원문과 일치하는 토큰 수가 필요합니다.');
 mkdirSync(cacheDir,{recursive:true});
 const metadata={identity:identity(corpus),model:EMBEDDING_MODEL,dimensions:DIMENSIONS,totalChunks:corpus.chunks.length,pdfPages:corpus.pages.length};
 const metaPath=join(cacheDir,'metadata.json');
 if(existsSync(metaPath)){
  let previous;try{previous=JSON.parse(readFileSync(metaPath,'utf8'));}catch{throw new Error('체크포인트 메타데이터를 읽을 수 없습니다.');}
  if(previous.identity!==metadata.identity)throw new Error('다른 문서 또는 모델의 체크포인트입니다. 입력이 일치하는 별도 캐시 폴더를 사용하세요.');
 }else save(metaPath,metadata);
 const embeddings=[];let size=batchSize,providerCalls=0;
 const progress=status=>{const p={status,completedChunks:embeddings.length,totalChunks:corpus.chunks.length,pdfPages:corpus.pages.length,updatedAt:new Date().toISOString()};save(join(cacheDir,'progress.json'),p);log(p);};
 progress('embedding');
 while(embeddings.length<corpus.chunks.length){
  const start=embeddings.length,path=checkpointPath(cacheDir,start);
  if(existsSync(path)){const saved=cachedBatch(path,start,corpus.chunks.length);if(onBatch)await onBatch(saved);embeddings.push(...saved.embeddings);progress('resumed');continue;}
  if(!key?.trim())throw new Error('VOYAGE_API_KEY 설정이 필요합니다.');
  if(providerCalls&&delayMs)await sleep(delayMs);
  let failures=0;
  for(;;){
   let count=Math.min(size,corpus.chunks.length-start),offlineTokens=null;
   if(tokenCounts){count=0;offlineTokens=0;while(count<size&&start+count<corpus.chunks.length&&offlineTokens+tokenCounts[start+count]<=tokenBudget){offlineTokens+=tokenCounts[start+count];count++;}if(!count)throw new Error('청크 하나의 토큰 수가 배치 토큰 예산을 초과합니다. 예산을 확인해 주세요.');}
   const input=corpus.chunks.slice(start,start+count).map(c=>c.content);
   const requestedAt=performance.now();
   let res;try{providerCalls++;res=await fetcher('https://api.voyageai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({input,model:EMBEDDING_MODEL,input_type:'document',output_dimension:DIMENSIONS,truncation:false}),signal:AbortSignal.timeout(60000),redirect:'error'});}catch{throw new Error('Voyage 연결에 실패했습니다. 같은 명령으로 재시작하면 저장된 배치부터 이어갑니다.');}
   if(res.status===429){
    failures++;
    if(failures>=maxRetries){progress('rate_limited');throw new Error('Voyage 요청 제한이 계속됩니다. 체크포인트는 보존됐으며 잠시 후 같은 명령으로 재개할 수 있습니다.');}
    const retry=res.headers?.get('retry-after');const seconds=retry&&/^\d+(?:\.\d+)?$/.test(retry)?Number(retry):0;
    // A missing Retry-After usually means a rolling minute window. Wait for that
    // window instead of repeatedly shrinking batches for an unrelated RPM limit.
    const delay=seconds>0?Math.min(60000,Math.max(seconds*1000,Math.min(60000,1000*2**(failures-1)))):60000;
    if(failures%2===0)size=Math.max(1,Math.floor(size/2));
    log({status:'rate_limited',completedChunks:start,totalChunks:corpus.chunks.length,retryInMs:delay,batchSize:size});
    await sleep(delay);continue;
   }
   if(!res.ok)throw new Error(`Voyage 요청에 실패했습니다 (HTTP ${res.status}). 캐시를 보존했으니 서버 설정을 확인한 후 재개하세요.`);
   let data;try{data=await res.json();}catch{throw new Error('Voyage JSON 응답을 읽을 수 없습니다.');}
   const rows=data.data?.toSorted((a,b)=>a.index-b.index);
   if(!Array.isArray(rows)||rows.length!==input.length||rows.some((row,i)=>row.index!==i||!validVector(row.embedding)))throw new Error('Voyage 임베딩 개수 또는 차원이 올바르지 않습니다.');
   const values=rows.map(row=>row.embedding);
   const usageTotalTokens=Number.isFinite(data.usage?.total_tokens)&&data.usage.total_tokens>=0?data.usage.total_tokens:null;
   const saved={start,count:values.length,embeddings:values,checksum:digest(values),usageTotalTokens,offlineTokens,elapsedMs:Math.round(performance.now()-requestedAt),completedAt:new Date().toISOString()};
   save(path,saved);
   log({status:'batch_embedded',start,count:values.length,usageTotalTokens,offlineTokens,elapsedMs:saved.elapsedMs});
   if(onBatch)await onBatch(saved);
   embeddings.push(...values);progress('embedding');break;
  }
 }
 progress('embedded');return {embeddings,metadata};
}
export function readEmbeddings(corpus,cacheDir){
 const metaPath=join(cacheDir,'metadata.json');
 if(!existsSync(metaPath)||JSON.parse(readFileSync(metaPath,'utf8')).identity!==identity(corpus))throw new Error('문서와 일치하는 체크포인트가 없습니다.');
 const embeddings=[];while(embeddings.length<corpus.chunks.length){const path=checkpointPath(cacheDir,embeddings.length);if(!existsSync(path))throw new Error('아직 임베딩이 완료되지 않았습니다. --embed-only로 재개해 주세요.');embeddings.push(...cachedBatch(path,embeddings.length,corpus.chunks.length).embeddings);}
 return embeddings;
}
export function readTokenCounts(corpus,path){
 let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('토큰 수 파일을 읽을 수 없습니다.');}
 if(!corpus.sourceSha256||value.sourceSha256!==corpus.sourceSha256||value.model!==EMBEDDING_MODEL||!Array.isArray(value.counts)||value.counts.length!==corpus.chunks.length||value.counts.some(n=>!Number.isSafeInteger(n)||n<0))throw new Error('토큰 수 파일의 원문 SHA·모델·청크 개수·숫자가 일치하지 않습니다.');
 return value.counts;
}
export async function beginSync(corpus,{url,key,fetcher=fetch,log=console.log,manual=TESLA_MANUAL}={}){
 if(!url||!key)throw new Error('Supabase 서버 연결 설정이 필요합니다.');
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 async function db(path,method='GET',body,extra={}){
  let r;try{r=await fetcher(`${url}/rest/v1/${path}`,{method,headers:{...headers,...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(40000),redirect:'error'});}catch{throw new Error('매뉴얼 저장소 연결에 실패했습니다. 임베딩 캐시를 보존했으며 --sync-only로 재개할 수 있습니다.');}
  if(!r.ok)throw new Error(`매뉴얼 DB 요청 실패 (HTTP ${r.status}). 002 SQL 적용과 서버 설정을 확인하세요. 임베딩 캐시는 보존됩니다.`);
  return r;
 }
 const previous=await (await db(`s13_documents?id=eq.${manual.id}&select=id,source`)).json();
 if(previous[0]?.source?.sha256&&previous[0].source.sha256!==corpus.sourceSha256)throw new Error('기존 등록 문서와 다른 원문입니다. 기존 문서를 덮어쓰지 않도록 새 문서 ID를 준비해 주세요.');
 const source={...manual.source,pdfPages:corpus.pages.length,sha256:corpus.sourceSha256,hashType:'extracted-text',textCharacters:corpus.content.length,...(corpus.pdfSha256?{pdfSha256:corpus.pdfSha256}:{})};
 await db('s13_documents?on_conflict=id','POST',{id:manual.id,session_hash:digest(`folio-preloaded:${manual.id}`),name:manual.name,content:corpus.content,chunk_count:corpus.chunks.length,indexed_chunks:0,status:'processing',is_preloaded:true,source},{Prefer:'resolution=merge-duplicates,return=minimal'});
 let completed=0;
 return {
  async writeBatch({start,embeddings}){
   if(!Number.isInteger(start)||start!==completed||!Array.isArray(embeddings)||!embeddings.length||start+embeddings.length>corpus.chunks.length||!embeddings.every(validVector))throw new Error('DB 반영할 청크 순서 또는 임베딩이 올바르지 않습니다.');
   const rows=corpus.chunks.slice(start,start+embeddings.length).map((chunk,i)=>({document_id:manual.id,position:chunk.position,section:chunk.section,content:chunk.content,embedding:embeddings[i]}));
   await db('s13_chunks?on_conflict=document_id,position','POST',rows,{Prefer:'resolution=merge-duplicates,return=minimal'});
   completed+=rows.length;
   await db(`s13_documents?id=eq.${manual.id}`,'PATCH',{indexed_chunks:completed});
   log({status:'syncing',completedChunks:completed,totalChunks:corpus.chunks.length,pdfPages:corpus.pages.length});
  },
  async finish(){
   if(completed!==corpus.chunks.length)throw new Error('아직 전체 청크 반영이 완료되지 않았습니다.');
   const check=await db(`s13_chunks?document_id=eq.${manual.id}&select=id`,'HEAD',undefined,{Prefer:'count=exact'});
   const count=Number(check.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]);
   if(count!==corpus.chunks.length)throw new Error('저장된 청크 수가 원문과 일치하지 않습니다. 준비 완료로 공개하지 않았습니다.');
   await db(`s13_documents?id=eq.${manual.id}`,'PATCH',{status:'ready',indexed_chunks:count});
   log({status:'ready',documentId:manual.id,pdfPages:corpus.pages.length,totalChunks:count});
   return {documentId:manual.id,pdfPages:corpus.pages.length,chunkCount:count};
  }
 };
}
export async function syncCorpus(corpus,embeddings,options={}){
 const batchSize=options.batchSize||64;
 if(!Number.isInteger(batchSize)||batchSize<1||embeddings.length!==corpus.chunks.length||!embeddings.every(validVector))throw new Error('전체 청크의 임베딩 또는 배치 크기가 검증되지 않았습니다.');
 const store=await beginSync(corpus,options);
 for(let start=0;start<corpus.chunks.length;start+=batchSize)await store.writeBatch({start,embeddings:embeddings.slice(start,start+batchSize)});
 return store.finish();
}
function loadEnvironment(root){
 const allowed=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY'];const inherited=Object.fromEntries(allowed.map(k=>[k,process.env[k]]));
 for(const file of ['../07/.env.local','.env.local']){const p=resolve(root,file);if(existsSync(p)){const values=parseEnv(readFileSync(p,'utf8'));for(const k of allowed)if(values[k])process.env[k]=values[k];}}
 for(const k of allowed)if(inherited[k])process.env[k]=inherited[k];
}
async function main(){
 const root=fileURLToPath(new URL('..',import.meta.url));loadEnvironment(root);
 const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
 const source=args.includes('--source')?resolve(value('--source')):null,textFile=args.includes('--textfile')?resolve(value('--textfile')):null;
 if(!source&&!textFile)throw new Error('사용법: node scripts/preload-manual.mjs --source /path/Owners_Manual.pdf [--embed-only|--sync-only] [--batch-size 128] [--delay-ms 21000] [--token-counts path --max-tokens 9000]');
 if(args.includes('--embed-only')&&args.includes('--sync-only'))throw new Error('실행 모드는 하나만 선택하세요.');
 const cacheDir=args.includes('--cache-dir')?resolve(value('--cache-dir')):resolve(root,'.qa/preload-tesla');mkdirSync(cacheDir,{recursive:true});
 let raw;
 if(textFile)raw=readFileSync(textFile,'utf8');else{const result=spawnSync('pdftotext',[source,'-'],{encoding:'utf8',maxBuffer:20000000});if(result.status!==0)throw new Error('PDF 텍스트 추출 실패. pdftotext 설치와 입력 PDF를 확인하세요.');raw=result.stdout;}
 const corpus=buildCorpus(raw);if(source)corpus.pdfSha256=digest(readFileSync(source));
 save(join(cacheDir,'corpus-info.json'),{input:basename(source||textFile),sourceSha256:corpus.sourceSha256,pdfPages:corpus.pages.length,textCharacters:corpus.content.length,chunks:corpus.chunks.length,extraction:'text',note:'이미지와 도표의 픽셀은 OCR하지 않습니다.'});
 console.log(JSON.stringify({status:'prepared',pdfPages:corpus.pages.length,textCharacters:corpus.content.length,chunks:corpus.chunks.length}));
 if(args.includes('--max-tokens')&&!args.includes('--token-counts'))throw new Error('--max-tokens에는 --token-counts 파일이 필요합니다.');
 const packing=args.includes('--token-counts')?{tokenCounts:readTokenCounts(corpus,resolve(value('--token-counts'))),tokenBudget:args.includes('--max-tokens')?Number(value('--max-tokens')):9000}:{};
 if(packing.tokenCounts&&(!Number.isSafeInteger(packing.tokenBudget)||packing.tokenBudget<1))throw new Error('배치 최대 토큰 수는 양의 정수여야 합니다.');
 const log=data=>console.log(JSON.stringify(data));
 const dbOptions={url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,log};
 if(args.includes('--sync-only')){await syncCorpus(corpus,readEmbeddings(corpus,cacheDir),dbOptions);return;}
 const store=args.includes('--embed-only')?null:await beginSync(corpus,dbOptions);
 await embedCorpus(corpus,{cacheDir,key:process.env.VOYAGE_API_KEY,batchSize:args.includes('--batch-size')?Number(value('--batch-size')):128,delayMs:args.includes('--delay-ms')?Number(value('--delay-ms')):21000,log,...packing,...(store?{onBatch:store.writeBatch}:{})});
 if(store)await store.finish();
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});

import {createService,missingConfig,sessionHash,AppError} from '../lib/service.mjs';
import {TESLA_MANUAL} from '../lib/catalog.mjs';
export function documentView(d){
 const catalog=d.is_preloaded&&d.id===TESLA_MANUAL.id?TESLA_MANUAL:null;
 return {id:d.id,name:d.name,chunkCount:d.chunk_count,createdAt:d.created_at,preloaded:d.is_preloaded===true,status:d.status||'ready',indexedChunks:d.indexed_chunks??d.chunk_count,source:d.source||{},...(catalog?{questions:catalog.questions,unknownQuestion:catalog.unknownQuestion}:{})};
}
async function readBody(req){
 if(Number(req.headers['content-length']||0)>180000)throw new AppError(413,'TOO_LARGE','본문 크기는 180KB 이하여야 합니다.');
 if(req.body){if(typeof req.body==='string'){if(Buffer.byteLength(req.body)>180000)throw new AppError(413,'TOO_LARGE','본문이 너무 큽니다.');return JSON.parse(req.body);}return req.body;}
 const data=[];let size=0;for await(const part of req){size+=Buffer.byteLength(part);if(size>180000)throw new AppError(413,'TOO_LARGE','본문이 너무 큽니다.');data.push(part);}
 return JSON.parse(Buffer.concat(data).toString('utf8'));
}
export default async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 let streamStarted=false;
 const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 const stream=event=>{
  if(res.destroyed||res.writableEnded)throw new AppError(499,'REQUEST_CLOSED','요청 연결이 종료되었습니다.');
  if(!streamStarted){res.setHeader('Content-Type','application/x-ndjson; charset=utf-8');res.setHeader('X-Accel-Buffering','no');res.statusCode=200;res.flushHeaders?.();streamStarted=true;}
  res.write(JSON.stringify(event)+'\n');
 };
 try{
  const service=createService();const missing=missingConfig();
  if(req.method==='GET'){
   const session=new URL(req.url,'http://localhost').searchParams.get('session');sessionHash(session);
   let documents=[],preloaded=[],databaseReady=false;
   if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){try{const rows=await Promise.all([service.list(session),service.preloaded()]);documents=rows[0].map(documentView);preloaded=rows[1].map(documentView);databaseReady=true;}catch{missing.push('SUPABASE_SCHEMA');}}
   return send(200,{configured:missing.length===0,databaseReady,missing,documents,preloaded});
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return send(405,{error:'METHOD_NOT_ALLOWED',message:'지원하지 않는 요청입니다.'});}
  if(missing.length)throw new AppError(503,'CONFIG_REQUIRED','서버 연결 설정이 필요합니다. 설정 안내를 확인해 주세요.');
  const origin=req.headers.origin;
  if(origin&&new URL(origin).host!==req.headers.host)throw new AppError(403,'INVALID_ORIGIN','현재 사이트에서 다시 시도해 주세요.');
  if(!req.headers['content-type']?.includes('application/json'))throw new AppError(415,'JSON_REQUIRED','JSON 요청만 처리할 수 있습니다.');
  const body=await readBody(req),at=performance.now();
  if(body.action==='ingest')return send(200,{document:documentView(await service.ingest(body)),elapsedMs:Math.round(performance.now()-at)});
  if(body.action==='ask'){
   const onProgress=body.stream===true?event=>stream({type:'progress',...event,elapsedMs:Math.round(performance.now()-at)}):undefined;
   const result={...await service.ask(body,{onProgress}),elapsedMs:Math.round(performance.now()-at)};
   if(body.stream===true){stream({type:'result',result});return res.end();}
   return send(200,result);
  }
  throw new AppError(400,'INVALID_ACTION','지원하지 않는 작업입니다.');
 }catch(error){
  if(res.destroyed||res.writableEnded)return;
  if(streamStarted){
   const data=error instanceof AppError?{error:error.code,message:error.message}:{error:'INTERNAL_ERROR',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'};
   stream({type:'error',...data});return res.end();
  }
  if(error instanceof AppError)return send(error.status,{error:error.code,message:error.message});
  if(error instanceof SyntaxError)return send(400,{error:'INVALID_JSON',message:'요청 본문을 확인해 주세요.'});
  return send(500,{error:'INTERNAL_ERROR',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
 }
}

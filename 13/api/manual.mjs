import {createService,missingConfig,sessionHash,AppError} from '../lib/service.mjs';
import {sample} from '../lib/sample.mjs';
export function documentView(d){return {id:d.id,name:d.name,chunkCount:d.chunk_count,createdAt:d.created_at,...(d.content?{text:d.content}:{})};}
async function readBody(req){
 if(Number(req.headers['content-length']||0)>180000)throw new AppError(413,'TOO_LARGE','본문 크기는 180KB 이하여야 합니다.');
 if(req.body){if(typeof req.body==='string'){if(Buffer.byteLength(req.body)>180000)throw new AppError(413,'TOO_LARGE','본문이 너무 큽니다.');return JSON.parse(req.body);}return req.body;}
 const data=[];let size=0;for await(const part of req){size+=Buffer.byteLength(part);if(size>180000)throw new AppError(413,'TOO_LARGE','본문이 너무 큽니다.');data.push(part);}
 return JSON.parse(Buffer.concat(data).toString('utf8'));
}
export default async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
 try{
  const service=createService();const missing=missingConfig();
  if(req.method==='GET'){
   const session=new URL(req.url,'http://localhost').searchParams.get('session');sessionHash(session);
   let documents=[],databaseReady=false;
   if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){try{documents=(await service.list(session)).map(documentView);databaseReady=true;}catch{missing.push('SUPABASE_SCHEMA');}}
   return send(200,{configured:missing.length===0,databaseReady,missing,documents,sample});
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return send(405,{error:'METHOD_NOT_ALLOWED',message:'지원하지 않는 요청입니다.'});}
  if(missing.length)throw new AppError(503,'CONFIG_REQUIRED','서버 연결 설정이 필요합니다. 설정 안내를 확인해 주세요.');
  const origin=req.headers.origin;
  if(origin&&new URL(origin).host!==req.headers.host)throw new AppError(403,'INVALID_ORIGIN','현재 사이트에서 다시 시도해 주세요.');
  if(!req.headers['content-type']?.includes('application/json'))throw new AppError(415,'JSON_REQUIRED','JSON 요청만 처리할 수 있습니다.');
  const body=await readBody(req),at=performance.now();
  if(body.action==='ingest')return send(200,{document:documentView(await service.ingest(body)),elapsedMs:Math.round(performance.now()-at)});
  if(body.action==='ask')return send(200,{...await service.ask(body),elapsedMs:Math.round(performance.now()-at)});
  throw new AppError(400,'INVALID_ACTION','지원하지 않는 작업입니다.');
 }catch(error){
  if(error instanceof AppError)return send(error.status,{error:error.code,message:error.message});
  if(error instanceof SyntaxError)return send(400,{error:'INVALID_JSON',message:'요청 본문을 확인해 주세요.'});
  return send(500,{error:'INTERNAL_ERROR',message:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'});
 }
}

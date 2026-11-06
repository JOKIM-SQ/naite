import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import handler,{documentView} from '../api/manual.mjs';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
async function request(body,headers={}){
 const req=Readable.from([Buffer.from(body)]);req.method='POST';req.url='/api/manual';req.headers={host:'localhost','content-type':'application/json',...headers};
 const res=response();await handler(req,res);return res;
}
test('document views expose preload status and provenance without whole manual or ownership',()=>{
 const d=documentView({id:'id',name:'Tesla',chunk_count:100,indexed_chunks:60,is_preloaded:true,status:'processing',source:{pdfPages:329},content:'private entire manual',session_hash:'secret-owner'});
 assert.equal(d.preloaded,true);assert.equal(d.status,'processing');assert.equal(d.indexedChunks,60);assert.equal(d.source.pdfPages,329);
 assert.ok(!('text' in d));assert.ok(!('content' in d));assert.ok(!('session_hash' in d));
});
test('GET returns shared preloaded metadata without sample payload or private source text',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY','ANTHROPIC_API_KEY'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const oldFetch=globalThis.fetch;
 try{
  for(const key of keys)process.env[key]='test';
  globalThis.fetch=async url=>({ok:true,json:async()=>url.includes('is_preloaded=eq.true')?[{id:'shared',name:'Tesla',chunk_count:100,indexed_chunks:100,is_preloaded:true,status:'ready',source:{pdfPages:329}}]:[]});
  const req={method:'GET',url:'/api/manual?session=12345678-1234-4123-8123-123456789012',headers:{}};const res=response();await handler(req,res);
  assert.equal(res.statusCode,200);assert.equal(res.body.preloaded.length,1);assert.equal(res.body.preloaded[0].preloaded,true);assert.ok(!('sample' in res.body));
 }finally{globalThis.fetch=oldFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});
test('bad JSON and foreign origin produce safe HTTP errors before provider access',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY','ANTHROPIC_API_KEY'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)process.env[key]='test';
  const bad=await request('{invalid');assert.equal(bad.statusCode,400);assert.equal(bad.body.error,'INVALID_JSON');
  const origin=await request('{}',{origin:'https://foreign.invalid'});assert.equal(origin.statusCode,403);
  const large=await request('{}',{'content-length':'180001'});assert.equal(large.statusCode,413);
 }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

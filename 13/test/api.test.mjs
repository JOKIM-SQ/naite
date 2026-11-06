import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import handler from '../api/manual.mjs';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
async function request(body,headers={}){
 const req=Readable.from([Buffer.from(body)]);req.method='POST';req.url='/api/manual';req.headers={host:'localhost','content-type':'application/json',...headers};
 const res=response();await handler(req,res);return res;
}
test('bad JSON and foreign origin produce safe HTTP errors before provider access',async()=>{
 const keys=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VOYAGE_API_KEY','ANTHROPIC_API_KEY'];const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{
  for(const key of keys)process.env[key]='test';
  const bad=await request('{invalid');assert.equal(bad.statusCode,400);assert.equal(bad.body.error,'INVALID_JSON');
  const origin=await request('{}',{origin:'https://foreign.invalid'});assert.equal(origin.statusCode,403);
  const large=await request('{}',{'content-length':'180001'});assert.equal(large.statusCode,413);
 }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

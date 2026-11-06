import {createServer} from 'node:http';
import {readFileSync,existsSync,createReadStream} from 'node:fs';
import {resolve,extname} from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {staticPath} from '../lib/static-path.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
// Only named server variables are reused; tokens unrelated to S13 are never imported.
const allowed=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','ANTHROPIC_API_KEY','ANTHROPIC_MODEL','VOYAGE_API_KEY'];
const externalValues=Object.fromEntries(allowed.map(key=>[key,process.env[key]]));
for(const file of ['../07/.env.local','../11/.env.ai.local','.env.local']){
 const path=resolve(root,file);if(!existsSync(path))continue;
 const values=parseEnv(readFileSync(path,'utf8'));for(const key of allowed)if(values[key])process.env[key]=values[key];
}
for(const key of allowed)if(externalValues[key])process.env[key]=externalValues[key];
const {default:handler}=await import('../api/manual.mjs');
const publicDir=resolve(root,'public');
createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/api/manual')return handler(req,res);
 const file=staticPath(path,publicDir);
 if(!file){res.writeHead(400).end('Bad request');return;}
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};
 try{if(!existsSync(file)){res.writeHead(404).end('Not found');return;}res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');const stream=createReadStream(file);stream.on('error',()=>res.end());stream.pipe(res);}catch{res.writeHead(400).end('Bad request');}
}).listen(3130,'127.0.0.1',()=>console.log('Folio · http://127.0.0.1:3130'));

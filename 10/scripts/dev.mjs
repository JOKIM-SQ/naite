import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/** @param {string} root */
export function createStaticServer(root){
  const base=resolve(root);
  /** @type {Record<string,string>} */
  const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
  return createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Cache-Control','no-store');
    if(request.method!=='GET'&&request.method!=='HEAD'){
      response.writeHead(405,{'Allow':'GET, HEAD'});response.end('Method not allowed');return;
    }
    let path;
    try{path=decodeURIComponent(new URL(request.url||'/', 'http://127.0.0.1').pathname);}
    catch{response.writeHead(400);response.end('Invalid path');return;}
    if(path.includes('\0')){response.writeHead(400);response.end('Invalid path');return;}
    const file=resolve(base,`.${path==='/'?'/index.html':path}`);
    const fromBase=relative(base,file);
    if(fromBase==='..'||fromBase.startsWith(`..${sep}`)||path.split('/').some(part=>part.startsWith('.'))){
      response.writeHead(403);response.end('Forbidden');return;
    }
    try{
      const content=await readFile(file);
      response.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'});
      response.end(request.method==='HEAD'?undefined:content);
    }catch{
      response.writeHead(404);response.end('Not found');
    }
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3100);
  const server=createStaticServer(fileURLToPath(new URL('../public/',import.meta.url)));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`갈피 · http://127.0.0.1:${port}/`));
}

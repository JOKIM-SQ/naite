import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createStaticServer} from '../scripts/dev.mjs';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'s10-static-'));
  await mkdir(join(root,'public'));
  await writeFile(join(root,'public','index.html'),'<h1>Galpi search</h1>');
  await writeFile(join(root,'public','search.mjs'),'export const query = "휴가";');
  await writeFile(join(root,'private.txt'),'PRIVATE');
  const server=createStaticServer(join(root,'public'));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();
  assert.ok(address&&typeof address==='object');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
  return `http://127.0.0.1:${address.port}`;
}

test('static entry and ES modules load with correct MIME and HEAD omits body',async t=>{
  const url=await fixture(t);
  const home=await fetch(url);assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(await home.text(),/Galpi search/);
  const module=await fetch(`${url}/search.mjs?cache=1`);assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);assert.match(await module.text(),/휴가/);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('unknown resources, malformed paths, traversal and mutation never serve private content',async t=>{
  const url=await fixture(t);
  for(const path of ['/missing','/..%2fprivate.txt','/%00','/%ZZ']){
    const response=await fetch(url+path);assert.ok(response.status>=400,response.status);assert.doesNotMatch(await response.text(),/PRIVATE/);
  }
  const response=await fetch(url,{method:'POST'});assert.equal(response.status,405);
});

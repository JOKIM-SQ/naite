import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../public/image-url.mjs').catch(()=>({}));
const load=(...args)=>{assert.equal(typeof module.loadImageURL,'function','URL loader exists');return module.loadImageURL(...args);};
const response=(body='pixels',headers={})=>new Response(body,{headers:{'content-type':'image/png',...headers}});
test('loads remote bytes as a safely named File with privacy preserving fetch options',async()=>{
 const file=await load(' https://example.com/a%20b.png?q=1 ',{fetchImpl:async(url,options)=>{assert.equal(url,'https://example.com/a%20b.png?q=1');assert.equal(options.credentials,'omit');assert.equal(options.mode,'cors');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'follow');return response();}});
 assert.equal(file.name,'a b.png');assert.equal(file.type,'image/png');assert.equal(await file.text(),'pixels');
});
for(const input of ['','not a url','javascript:alert(1)','data:image/png,x','blob:https://example.com/a','file:///tmp/a.png','https://user:password@example.com/a.png','https://example.com/'+ 'x'.repeat(2048)])test(`rejects invalid URL ${input.slice(0,45)} before network`,async()=>{
 await assert.rejects(()=>load(input,{fetchImpl:()=>{assert.fail('must not fetch');}}),/주소/);
});
for(const type of ['text/html','image/gif','image/svg+xml','constructor','__proto__',''])test(`rejects unsupported MIME ${type}`,async()=>{await assert.rejects(()=>load('https://example.com/a',{fetchImpl:async()=>response('html',{'content-type':type})}),/JPG|PNG|WebP/);});
test('CORS or network failure gives file upload recovery',async()=>{await assert.rejects(()=>load('https://example.com/a',{fetchImpl:async()=>{throw new TypeError('Failed to fetch');}}),/원본 이미지 파일을 업로드/);});
test('HTTP failure never returns an image',async()=>{await assert.rejects(()=>load('https://example.com/a',{fetchImpl:async()=>new Response('no',{status:404})}),/가져오지 못/);});
test('rejects declared oversize before reading and cancels body',async()=>{
 let canceled=false;const body=new ReadableStream({cancel(){canceled=true;}});
 await assert.rejects(()=>load('https://example.com/a',{fetchImpl:async()=>response(body,{'content-length':String(12*1024*1024+1)})}),/12MB/);assert.equal(canceled,true);
});
test('counts streaming bytes without Content-Length and cancels oversize',async()=>{
 let canceled=false;const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(7*1024*1024));},cancel(){canceled=true;}});
 await assert.rejects(()=>load('https://example.com/a',{fetchImpl:async()=>response(body)}),/12MB/);assert.equal(canceled,true);
});
test('timeout includes stalled body consumption and aborts fetch',async()=>{
 let signal;let canceled=false;const body=new ReadableStream({cancel(){canceled=true;}});
 await assert.rejects(()=>load('https://example.com/a',{timeoutMs:10,fetchImpl:async(_url,options)=>{signal=options.signal;return response(body);}}),/시간/);
 assert.equal(signal.aborted,true);assert.equal(canceled,true);
});
test('timeout also covers fetch that has not returned headers',async()=>{await assert.rejects(()=>load('https://example.com/a',{timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/시간/);});
test('query image URLs get a safe filename and correct extension',async()=>{const f=await load('https://example.com/?image=1',{fetchImpl:async()=>response('webp',{'content-type':'image/webp'})});assert.equal(f.name,'remote-image.webp');});

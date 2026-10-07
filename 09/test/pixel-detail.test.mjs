import test from 'node:test';
import assert from 'node:assert/strict';
import { detailGrid } from '../public/pixel-detail.mjs';
let cv;
async function runtime() { return cv ??= await (await import('@techstark/opencv-js')).default; }
function pixels(w,h,fn) { const p=new Uint8ClampedArray(w*h*4); for(let y=0;y<h;y++)for(let x=0;x<w;x++)p.set(fn(x,y),(y*w+x)*4); return p; }
// A nonzero RGB payload under alpha=0 must never become visible or pollute
// output pixels; this catches dropping alpha or trusting hidden source RGB.
test('fully transparent input produces only transparent black output', async () => {
  const source = pixels(12, 20, (x, y) => [(x * 31) % 256, (y * 17) % 256, 230, 0]);
  const result = detailGrid(await runtime(), source, 12, 20, { width: 6, height: 10 });
  assert.deepEqual(result.data, new Uint8ClampedArray(6 * 10 * 4));
});

// Independent geometric oracle: four known source regions split at 25% of
// width and 65% of height. Center-cropping to a square, swapping axes, mirroring,
// or returning correctly sized blank pixels must fail the sampled RGB checks.
test('keeps landscape and portrait aspect and asymmetric regions without cropping', async () => {
  const cv = await runtime();
  const colors = [[230, 35, 45, 255], [35, 215, 55, 255], [40, 55, 230, 255], [225, 210, 35, 255]];
  for (const [width, height, gw, gh] of [[40, 80, 16, 32], [80, 40, 32, 16]]) {
    const source = pixels(width, height, (x, y) => colors[(y < height * .65 ? 0 : 2) + (x < width * .25 ? 0 : 1)]);
    const result = detailGrid(cv, source, width, height, { width: gw, height: gh });
    assert.deepEqual([result.width, result.height, result.data.length], [gw, gh, gw * gh * 4]);
    // Four outer corners plus points straddling the two asymmetric boundaries.
    const samples = [[0, 0, 0], [gw - 1, 0, 1], [0, gh - 1, 2], [gw - 1, gh - 1, 3],
      [Math.floor(gw * .125), Math.floor(gh * .5), 0],
      [Math.floor(gw * .375), Math.floor(gh * .5), 1],
      [Math.floor(gw * .125), Math.floor(gh * .8), 2],
      [Math.floor(gw * .375), Math.floor(gh * .8), 3]];
    for (const [x, y, region] of samples) {
      const offset = (y * gw + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        assert.ok(Math.abs(result.data[offset + channel] - colors[region][channel]) <= 45,
          `${width}×${height}: region ${region} at (${x},${y}), channel ${channel}`);
      }
      assert.equal(result.data[offset + 3], 255);
    }
  }
});
test('solid RGB survives Lab matching without NaN or dark drift',async()=>{const r=detailGrid(await runtime(),pixels(16,16,()=>[71,132,209,255]),16,16,{width:8,height:8});for(let i=0;i<r.data.length;i+=4){assert.ok(Math.abs(r.data[i]-71)<=3);assert.ok(Math.abs(r.data[i+1]-132)<=3);assert.ok(Math.abs(r.data[i+2]-209)<=3);assert.equal(r.data[i+3],255);}});
test('preserves partial and zero alpha without hidden black leaking into visible color',async()=>{const r=detailGrid(await runtime(),pixels(16,16,(x)=>x<8?[0,0,0,0]:[230,120,60,128]),16,16,{width:8,height:8});assert.equal(r.data[3],0);assert.equal(r.data[(7*4)+3],128);assert.ok(r.data[7*4]>220);assert.ok(r.data[7*4+1]>110);});
test('limits final visible palette to 64 and is deterministic',async()=>{const c=await runtime(),p=pixels(32,40,(x,y)=>[(x*19+y*7)%256,(y*31+x*3)%256,(x*13+y*11)%256,255]);const a=detailGrid(c,p,32,40,{width:24,height:30}),b=detailGrid(c,p,32,40,{width:24,height:30});assert.deepEqual(a.data,b.data);const colors=new Set();for(let i=0;i<a.data.length;i+=4)colors.add(a.data.slice(i,i+3).join(','));assert.ok(colors.size<=64);assert.ok(colors.size>16);});
test('retains a dark architectural outline between light areas',async()=>{const r=detailGrid(await runtime(),pixels(32,32,(x)=>x>=14&&x<18?[25,30,40,255]:[235,230,220,255]),32,32,{width:16,height:16});const at=(x)=>r.data[(8*16+x)*4];assert.ok(at(8)<80);assert.ok(at(2)>200);});
test('rejects malformed and oversized work with Korean errors',async()=>{const c=await runtime();for(const args of [[new Uint8ClampedArray(4),0,1,{width:8,height:8}],[new Uint8ClampedArray(4),2,2,{width:8,height:8}],[new Uint8ClampedArray(4),1,1,{width:1000,height:1000}]])assert.throws(()=>detailGrid(c,...args),/[가-힣]/);});

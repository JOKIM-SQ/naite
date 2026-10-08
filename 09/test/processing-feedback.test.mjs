import test from 'node:test';
import assert from 'node:assert/strict';
import { paintFeedback } from '../public/processing-feedback.mjs';

function frameBoundary(t,request,cancel){
 const previousRequest=globalThis.requestAnimationFrame;const previousCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=request;globalThis.cancelAnimationFrame=cancel;
 t.after(()=>{if(previousRequest===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previousRequest;if(previousCancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=previousCancel;});
}

// A suspended tab must not hold the shared import queue forever.
test('paint yield settles when requestAnimationFrame never fires and cancels the frame',async t=>{
 const cancelled=[];
 frameBoundary(t,()=>41,id=>cancelled.push(id));
 const outcome=await Promise.race([paintFeedback().then(()=> 'settled'),new Promise(resolve=>setTimeout(()=>resolve('blocked'),150))]);
 assert.equal(outcome,'settled');assert.deepEqual(cancelled,[41]);
});

test('normal frame yields a task for paint and clears its fallback timer',async t=>{
 let frameCallback;const timers=new Map();const cleared=[];let next=0;
 frameBoundary(t,callback=>{frameCallback=callback;return 42;},()=>assert.fail('delivered frame is no longer pending'));
 t.mock.method(globalThis,'setTimeout',callback=>{timers.set(++next,callback);return next;});
 t.mock.method(globalThis,'clearTimeout',id=>{cleared.push(id);timers.delete(id);});
 let settled=false;const pending=paintFeedback().then(()=>{settled=true;});
 assert.equal(timers.size,1);frameCallback();await Promise.resolve();assert.equal(settled,false);assert.equal(timers.size,2);
 timers.get(2)();await pending;assert.equal(settled,true);assert.equal(timers.size,0);assert.ok(cleared.includes(1));
});

test('fallback completion ignores a late frame without scheduling more work',async t=>{
 let frameCallback;const timers=new Map();let next=0;const cancelled=[];
 frameBoundary(t,callback=>{frameCallback=callback;return 43;},id=>cancelled.push(id));
 t.mock.method(globalThis,'setTimeout',callback=>{timers.set(++next,callback);return next;});
 t.mock.method(globalThis,'clearTimeout',id=>timers.delete(id));
 const pending=paintFeedback();timers.get(1)();await pending;assert.equal(timers.size,0);assert.deepEqual(cancelled,[43]);
 frameCallback();assert.equal(timers.size,0);assert.equal(next,1);
});

test('without requestAnimationFrame the queue proceeds without timers',async t=>{
 frameBoundary(t,undefined,undefined);
 t.mock.method(globalThis,'setTimeout',()=>assert.fail('Node does not need a paint timer'));
 await paintFeedback();
});

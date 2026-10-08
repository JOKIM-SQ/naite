import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { IDBFactory } from 'fake-indexeddb';
import { createApp } from '../public/app.mjs';
import { createBoardStore } from '../public/storage.mjs';

const workspace = await import('../public/workspace.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
const user = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { full_name: 'Cloud User' } };
const record = (id, name) => ({ id, name, createdAt: 1, sourceBlob: new Blob(['photo'], { type: 'image/png' }), thumbnailBlob: new Blob(['preview'], { type: 'image/webp' }), pixelBlob: new Blob(['pixels'], { type: 'image/png' }), palette: ['#112233', '#223344', '#334455', '#445566', '#556677'], width: 100, height: 100, columns: 96, gridWidth: 96, gridHeight: 96, pixelMode: 'detail' });

async function setup({ signedIn = false, configFailure = false, oauthError = false, verify, signoutWait, signoutError = false } = {}) {
  const { document, window } = parseHTML(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  for (const dialog of document.querySelectorAll('dialog')) { dialog.showModal = () => dialog.setAttribute('open', ''); dialog.close = () => dialog.removeAttribute('open'); }
  for (const select of document.querySelectorAll('select')) Object.defineProperty(select,'value',{get(){return this.querySelector('option[selected]')?.value??'96';},set(value){for(const option of this.querySelectorAll('option')){if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
  const local = await createBoardStore(new IDBFactory(), 'local');
  const cloud = await createBoardStore(new IDBFactory(), 'cloud');
  let currentUser = signedIn ? user : null;
  let authCallback;
  const navigation = { origin: 'https://s09-chroma.vercel.app', href: 'https://s09-chroma.vercel.app/', reloads: 0, reload() { this.reloads++; } };
  const requests = [];
  const calls = { local: 0, cloud: 0, app: 0, init: 0, localReads: 0, cloudReads: 0 };
  const localList=local.list;local.list=async()=>{calls.localReads++;return localList();};
  const cloudList=cloud.list;cloud.list=async()=>{calls.cloudReads++;return cloudList();};
  const client = { auth: {
    getSession: async () => ({ data: { session: currentUser ? { user: currentUser } : null }, error: null }),
    getUser: async () => verify ? verify() : ({ data: { user: currentUser }, error: null }),
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithOAuth: async options => { requests.push(options); return { data: { provider: 'google', url: 'https://accounts.google.com/' }, error: oauthError ? new Error('OAuth unavailable') : null }; },
    signOut: async () => { if(signoutWait)await signoutWait;if(signoutError)return {error:Error('signout unavailable')};currentUser = null; authCallback?.('SIGNED_OUT', null); return { error: null }; },
  } };
  let sequence = 0;
  const options = { document, window, location: navigation, fetch: async () => ({ ok: !configFailure, json: async () => ({ url: 'https://kmfoeoxvsadlurpmkqwh.supabase.co', publishableKey: 'sb_publishable_test', provider: 'google' }) }), createClient: () => client, createLocalStore: async () => {calls.local++;return local;}, createCloudStore: async () => {calls.cloud++;return cloud;}, createApp: options => {calls.app++;const app=createApp({ ...options, url: { createObjectURL: () => `blob:test-${++sequence}`, revokeObjectURL() {} } });const init=app.init;app.init=()=>{calls.init++;return init();};return app;} };
  return { document, window, local, cloud, navigation, requests, calls, boot: () => workspace.startWorkspace?.(options), emit: (event, nextUser) => authCallback?.(event, nextUser ? { user: nextUser } : null), close() { local.close(); cloud.close(); } };
}

function locked(s){const area=s.document.querySelector('#board-workspace');assert.ok(area);assert.equal(area.hidden,true);assert.equal(area.hasAttribute('inert'),true);assert.equal(s.document.querySelector('#login-gate')?.hidden,false);}
function untouched(s){assert.deepEqual(s.calls,{local:0,cloud:0,app:0,init:0,localReads:0,cloudReads:0});}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('a signed-in page restores only its cloud board, without exposing browser cards', async () => {
  const s = await setup({ signedIn: true });
  await s.local.put(record('local', 'Local photo'));
  await s.cloud.put(record('cloud', 'Cloud photo'));
  await s.boot();
  assert.equal(s.document.querySelectorAll('.mood-card').length, 1);
  assert.equal(s.document.querySelector('.card-name')?.textContent, 'Cloud photo');
  assert.match(s.document.querySelector('#storage-label')?.textContent ?? '', /공유/);
  assert.equal(s.document.querySelector('#board-workspace').hidden,false);
  assert.equal(s.document.querySelector('#login-gate').hidden,true);
  assert.equal(s.document.querySelector('#account-label').textContent,'Cloud User');
  s.close();
});

test('unauthenticated pages never open stores or local cards and both login buttons start OAuth', async () => {
  const s = await setup(); await s.local.put(record('local', 'Local photo')); await s.boot();
  locked(s);untouched(s);assert.equal(s.document.querySelector('.card-name'),null);
  s.document.querySelector('#auth-signin')?.click(); await tick();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].provider, 'google');
  assert.equal(s.requests[0].options.redirectTo, 'https://s09-chroma.vercel.app/');
  untouched(s);
  const gate=await setup();await gate.boot();gate.document.querySelector('#gate-signin').click();await tick();assert.equal(gate.requests[0].options.redirectTo,'https://s09-chroma.vercel.app/');untouched(gate);gate.close();
  s.close();
});

test('explicit import preserves cloud edits, adds missing local cards and retains local copies', async () => {
  const s = await setup({ signedIn: true });
  await s.local.put(record('shared', 'Old title')); await s.local.put(record('new', 'New local photo'));
  await s.cloud.put(record('shared', 'Edited cloud title')); await s.boot();
  s.document.querySelector('#cloud-import')?.click(); await tick(); await tick();
  const cards = await s.cloud.list();
  assert.equal(cards.length, 2);
  assert.equal(cards.find(r => r.id === 'shared').name, 'Edited cloud title');
  assert.equal((await s.local.list()).length, 2);
  assert.equal(s.document.querySelectorAll('.mood-card').length, 2);
  s.close();
});

test('missing configuration keeps storage locked and offers connection retry', async () => {
  const s = await setup({ configFailure: true }); await s.local.put(record('local', 'Kept locally')); await s.boot();
  locked(s);untouched(s);assert.equal(s.document.querySelector('.card-name'),null);
  assert.match(s.document.querySelector('#login-message')?.textContent ?? '', /연결/);
  s.document.querySelector('#auth-retry').click();assert.equal(s.navigation.reloads,1);
  s.close();
});

test('OAuth failure enables retry without exposing local cards or initializing the app', async () => {
  const s = await setup({ oauthError: true }); await s.local.put(record('local', 'Kept locally')); await s.boot();
  s.document.querySelector('#auth-signin')?.click(); await tick();
  assert.equal(s.document.querySelector('#auth-signin')?.disabled, false);
  assert.match(s.document.querySelector('#cloud-message')?.textContent ?? '', /로그인/);
  locked(s);untouched(s);assert.equal(s.document.querySelector('.card-name'),null);
  s.close();
});

test('token refresh keeps the board, while a changed account reloads outside the auth callback', async () => {
  const s = await setup({ signedIn: true });await s.cloud.put(record('cloud','Visible card'));await s.boot();
  s.emit('TOKEN_REFRESHED', user); await tick(); assert.equal(s.navigation.reloads, 0);
  s.document.querySelector('.card-open').click();s.document.querySelector('#delete-card').click();
  s.emit('SIGNED_IN', { ...user, id: '22222222-2222-4222-8222-222222222222' });
  assert.equal(s.navigation.reloads, 0);
  locked(s);for(const dialog of s.document.querySelectorAll('dialog')){assert.equal(dialog.hasAttribute('open'),false);assert.equal(dialog.hasAttribute('inert'),true);}
  await tick(); assert.equal(s.navigation.reloads, 1);
  s.close();
});

test('initial HTML and delayed identity verification keep upload and card data inaccessible',async()=>{
 const verified=deferred();const s=await setup({signedIn:true,verify:()=>verified.promise});await s.local.put(record('local','Private local card'));
 locked(s);for(const dialog of s.document.querySelectorAll('dialog'))assert.equal(dialog.hasAttribute('inert'),true);
 const boot=s.boot();await tick();locked(s);untouched(s);
 s.document.querySelector('#upload-trigger').click();s.document.querySelector('#image-url-form').dispatchEvent(new s.window.Event('submit',{cancelable:true}));s.document.querySelector('#cloud-import').click();await tick();untouched(s);
 verified.resolve({data:{user},error:null});await boot;assert.equal(s.calls.app,1);assert.equal(s.calls.init,1);assert.equal(s.calls.cloudReads,1);assert.equal(s.document.querySelector('#board-workspace').hidden,false);s.close();
});
test('rejected identity does not trust a cached session or fall back to a local board',async()=>{
 const s=await setup({signedIn:true,verify:async()=>({data:{user:null},error:Error('expired')})});await s.boot();locked(s);untouched(s);assert.equal(s.document.querySelector('#auth-retry').hidden,false);s.close();
});
test('signout conceals cards and open dialogs before its network request completes',async()=>{
 const pending=deferred();const s=await setup({signedIn:true,signoutWait:pending.promise});await s.cloud.put(record('cloud','Visible card'));await s.boot();s.document.querySelector('.card-open').click();
 s.document.querySelector('#auth-signout').click();locked(s);assert.equal(s.document.querySelector('#detail-dialog').hasAttribute('open'),false);assert.equal(s.navigation.reloads,0);
 pending.resolve();await tick();assert.equal(s.navigation.reloads,1);s.close();
});

for(const signoutError of [false,true])test(`initial restore cannot reveal cards while signout is pending, then ${signoutError?'recovers after rejection':'stays locked after success'}`,async()=>{
 const pending=deferred();const listing=deferred();const started=deferred();const s=await setup({signedIn:true,signoutWait:pending.promise,signoutError});
 await s.cloud.put(record('cloud','Restored shared card'));const original=s.cloud.list;s.cloud.list=async()=>{started.resolve();await listing.promise;return original();};
 const boot=s.boot();await started.promise;s.document.querySelector('#auth-signout').click();locked(s);
 listing.resolve();await boot;
 try{locked(s);assert.equal(s.document.querySelector('.card-name').textContent,'Restored shared card');for(const dialog of s.document.querySelectorAll('dialog'))assert.equal(dialog.hasAttribute('inert'),true);}
 finally{pending.resolve();await tick();}
 if(signoutError){assert.equal(s.document.querySelector('#board-workspace').hidden,false);assert.equal(s.document.querySelector('#board-workspace').hasAttribute('inert'),false);assert.equal(s.document.querySelector('#login-gate').hidden,true);assert.equal(s.document.querySelector('#auth-signout').disabled,false);assert.equal(s.navigation.reloads,0);s.document.querySelector('.card-open').click();assert.equal(s.document.querySelector('#detail-dialog').hasAttribute('open'),true);}
 else{locked(s);assert.equal(s.navigation.reloads,1);}
 s.close();
});

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

async function setup({ signedIn = false, configFailure = false, oauthError = false } = {}) {
  const { document, window } = parseHTML(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'));
  for (const dialog of document.querySelectorAll('dialog')) { dialog.showModal = () => dialog.setAttribute('open', ''); dialog.close = () => dialog.removeAttribute('open'); }
  const local = await createBoardStore(new IDBFactory(), 'local');
  const cloud = await createBoardStore(new IDBFactory(), 'cloud');
  let currentUser = signedIn ? user : null;
  let authCallback;
  const navigation = { origin: 'https://s09-chroma.vercel.app', href: 'https://s09-chroma.vercel.app/', reloads: 0, reload() { this.reloads++; } };
  const requests = [];
  const client = { auth: {
    getSession: async () => ({ data: { session: currentUser ? { user: currentUser } : null }, error: null }),
    getUser: async () => ({ data: { user: currentUser }, error: null }),
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    signInWithOAuth: async options => { requests.push(options); return { data: { provider: 'google', url: 'https://accounts.google.com/' }, error: oauthError ? new Error('OAuth unavailable') : null }; },
    signOut: async () => { currentUser = null; authCallback?.('SIGNED_OUT', null); return { error: null }; },
  } };
  let sequence = 0;
  const options = { document, window, location: navigation, fetch: async () => ({ ok: !configFailure, json: async () => ({ url: 'https://kmfoeoxvsadlurpmkqwh.supabase.co', publishableKey: 'sb_publishable_test', provider: 'google' }) }), createClient: () => client, createLocalStore: async () => local, createCloudStore: async () => cloud, createApp: options => createApp({ ...options, url: { createObjectURL: () => `blob:test-${++sequence}`, revokeObjectURL() {} } }) };
  return { document, window, local, cloud, navigation, requests, boot: () => workspace.startWorkspace?.(options), emit: (event, nextUser) => authCallback?.(event, nextUser ? { user: nextUser } : null), close() { local.close(); cloud.close(); } };
}

test('a signed-in page restores only its cloud board, without exposing browser cards', async () => {
  const s = await setup({ signedIn: true });
  await s.local.put(record('local', 'Local photo'));
  await s.cloud.put(record('cloud', 'Cloud photo'));
  await s.boot();
  assert.equal(s.document.querySelectorAll('.mood-card').length, 1);
  assert.equal(s.document.querySelector('.card-name')?.textContent, 'Cloud photo');
  assert.match(s.document.querySelector('#storage-label')?.textContent ?? '', /계정/);
  s.close();
});

test('a guest keeps its existing browser board and can start Google OAuth for this public origin', async () => {
  const s = await setup(); await s.local.put(record('local', 'Local photo')); await s.boot();
  assert.equal(s.document.querySelector('.card-name')?.textContent, 'Local photo');
  s.document.querySelector('#auth-signin')?.click(); await tick();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].provider, 'google');
  assert.equal(s.requests[0].options.redirectTo, 'https://s09-chroma.vercel.app/');
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

test('missing cloud configuration leaves a working local board and explicitly labels local storage', async () => {
  const s = await setup({ configFailure: true }); await s.local.put(record('local', 'Kept locally')); await s.boot();
  assert.equal(s.document.querySelector('.card-name')?.textContent, 'Kept locally');
  assert.match(s.document.querySelector('#storage-label')?.textContent ?? '', /브라우저/);
  assert.match(s.document.querySelector('#cloud-message')?.textContent ?? '', /연결/);
  s.close();
});

test('OAuth failure enables retry and does not replace the local board', async () => {
  const s = await setup({ oauthError: true }); await s.local.put(record('local', 'Kept locally')); await s.boot();
  s.document.querySelector('#auth-signin')?.click(); await tick();
  assert.equal(s.document.querySelector('#auth-signin')?.disabled, false);
  assert.match(s.document.querySelector('#cloud-message')?.textContent ?? '', /로그인/);
  assert.equal(s.document.querySelector('.card-name')?.textContent, 'Kept locally');
  s.close();
});

test('token refresh keeps the board, while a changed account reloads outside the auth callback', async () => {
  const s = await setup({ signedIn: true }); await s.boot();
  s.emit('TOKEN_REFRESHED', user); await tick(); assert.equal(s.navigation.reloads, 0);
  s.emit('SIGNED_IN', { ...user, id: '22222222-2222-4222-8222-222222222222' });
  assert.equal(s.navigation.reloads, 0);
  await tick(); assert.equal(s.navigation.reloads, 1);
  s.close();
});

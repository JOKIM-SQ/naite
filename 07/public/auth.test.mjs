import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createAuth } from './auth.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const session = (id = 'user-a', token = 'token-a') => ({ user: { id, email: `${id}@example.test` }, access_token: token });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ initial = session(), sessionResult, logoutResult, href = 'https://receipts.example/?keep=1', configOk = true, oauthError = false } = {}) {
  const states = [];
  const replacements = [];
  const oauthCalls = [];
  const clients = [];
  let listener;
  const sdk = {
    initialize: async () => ({ error: null }),
    onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } }; },
    getSession: async () => sessionResult ? await sessionResult.promise : { data: { session: initial }, error: null },
    signOut: async options => { assert.equal(options.scope, 'local'); if (logoutResult) return await logoutResult.promise; listener('SIGNED_OUT', null); return { error: null }; },
    signInWithOAuth: async options => { oauthCalls.push(options); return { data: {}, error: oauthError ? new Error('raw provider configuration') : null }; },
  };
  const auth = createAuth({
    fetcher: async path => { assert.equal(path, '/api/auth-config'); return { ok: configOk, json: async () => ({ url: 'https://project.supabase.co', publishableKey: 'public-key', provider: 'google' }) }; },
    createClient: (url, key, options) => { clients.push({ url, key, options }); return { auth: sdk }; },
    location: { href, origin: new URL(href).origin },
    history: { state: { keep: true }, replaceState: (state, title, url) => replacements.push(url) },
    onState: state => states.push(state),
  });
  return { auth, states, replacements, oauthCalls, clients, emit: (event, next) => listener(event, next) };
}

test('공개 설정으로 공식 클라이언트를 PKCE 모드로 초기화하고 저장된 세션을 복원한다', async () => {
  const view = fixture();
  await view.auth.start();
  assert.equal(view.auth.getSession()?.user.id, 'user-a');
  assert.equal(view.states.at(-1).phase, 'signed-in');
  assert.equal(view.clients[0].url, 'https://project.supabase.co');
  assert.equal(view.clients[0].key, 'public-key');
  const { storage, ...options } = view.clients[0].options.auth;
  assert.deepEqual(options, { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 's07-receipt-organizer-auth' });
  assert.equal(typeof storage?.getItem, 'function');
});

test('OAuth는 Google과 현재 사이트 루트로 이동하며 시작 실패는 한국어로 표시한다', async () => {
  const view = fixture({ initial: null, oauthError: true });
  await view.auth.start();
  await view.auth.signIn();
  assert.deepEqual(view.oauthCalls, [{ provider: 'google', options: { redirectTo: 'https://receipts.example/' } }]);
  assert.match(view.states.at(-1).message, /로그인.*다시/);
  assert.doesNotMatch(view.states.at(-1).message, /provider|configuration/);
});

test('로그아웃은 네트워크 완료 전에 세션을 지우고 대기 중 토큰 갱신을 무시한다', async () => {
  const pending = deferred();
  const view = fixture({ logoutResult: pending });
  await view.auth.start();
  const exiting = view.auth.signOut();
  assert.equal(view.auth.getSession(), null);
  assert.equal(view.states.at(-1).phase, 'signed-out');
  view.emit('TOKEN_REFRESHED', session('user-a', 'late-token'));
  assert.equal(view.auth.getSession(), null);
  pending.resolve({ error: null });
  await exiting;
  view.emit('TOKEN_REFRESHED', session('user-a', 'later-token'));
  assert.equal(view.auth.getSession(), null);
});

test('늦은 초기 세션 응답은 이미 로그아웃한 계정을 다시 로그인시키지 않는다', async () => {
  const pending = deferred();
  const view = fixture({ sessionResult: pending });
  const starting = view.auth.start();
  await tick();
  await view.auth.signOut();
  pending.resolve({ data: { session: session() }, error: null });
  await starting;
  assert.equal(view.auth.getSession(), null);
  assert.equal(view.states.at(-1).phase, 'signed-out');
});

test('같은 사용자의 토큰 갱신은 최신 토큰으로 갱신하고 세션 복원을 반복하지 않는다', async () => {
  const view = fixture();
  await view.auth.start();
  view.emit('TOKEN_REFRESHED', session('user-a', 'fresh-token'));
  assert.equal(view.auth.getSession()?.access_token, 'fresh-token');
  assert.equal(view.clients.length, 1);
  assert.equal(view.states.at(-1).phase, 'signed-in');
});

test('OAuth 취소 메시지는 한국어이며 URL의 인증 오류만 제거한다', async () => {
  const view = fixture({ initial: null, href: 'https://receipts.example/?keep=1&error=access_denied&error_description=secret-provider-detail#receipt-1' });
  await view.auth.start();
  assert.match(view.states.at(-1).message, /로그인.*취소/);
  assert.deepEqual(view.replacements, ['/?keep=1#receipt-1']);
  assert.doesNotMatch(view.states.at(-1).message, /secret-provider/);
});

test('SDK가 PKCE 코드를 처리한 뒤 URL에서 코드만 정리한다', async () => {
  const pending = deferred();
  const view = fixture({ sessionResult: pending, href: 'https://receipts.example/?code=one-time-code&keep=1' });
  const starting = view.auth.start();
  await tick();
  assert.equal(view.replacements.length, 0);
  pending.resolve({ data: { session: session() }, error: null });
  await starting;
  assert.deepEqual(view.replacements, ['/?keep=1']);
});

test('인증 설정 실패는 세션 없이 잠그고 서버 내부 설명을 표시하지 않는다', async () => {
  const view = fixture({ configOk: false });
  await view.auth.start();
  assert.equal(view.auth.getSession(), null);
  assert.equal(view.clients.length, 0);
  assert.equal(view.states.at(-1)?.phase, 'error');
  assert.match(view.states.at(-1)?.message || '', /로그인.*다시/);
});

test('401 무효화는 즉시 세션을 지우고 다시 로그인할 안내를 남긴다', async () => {
  const pending = deferred();
  const view = fixture({ logoutResult: pending });
  await view.auth.start();
  const invalidating = view.auth.invalidate();
  assert.equal(view.auth.getSession(), null);
  assert.match(view.states.at(-1).message, /다시 로그인/);
  pending.resolve({ error: null });
  await invalidating;
});

test('로그인 준비를 기다리는 동안 로그아웃하면 늦은 준비 응답으로 OAuth를 시작하지 않는다', async () => {
  const pending = deferred();
  const view = fixture({ initial: null, sessionResult: pending });
  const entering = view.auth.signIn();
  await tick();
  await view.auth.signOut();
  pending.resolve({ data: { session: null }, error: null });
  await entering;
  assert.equal(view.oauthCalls.length, 0);
  assert.equal(view.states.at(-1).phase, 'signed-out');
});

// Run the shipped official browser SDK; only storage, browser globals and network are isolated.
const sdkBundle = readFileSync(new URL('../node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url), 'utf8');
function realSdkFixture({ href = 'https://receipts.example/', savedSession = null, verifier = null, fetcher, saved = new Map() } = {}) {
  const storageKey = 's07-receipt-organizer-auth';
  if (savedSession) saved.set(storageKey, JSON.stringify(savedSession));
  if (verifier) saved.set(`${storageKey}-code-verifier`, JSON.stringify(verifier));
  const storage = { get length() { return saved.size; }, key: index => [...saved.keys()][index] ?? null, getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  const states = [];
  const location = { href, origin: new URL(href).origin, assign() {} };
  const history = { state: null, replaceState: (state, title, url) => { location.href = new URL(url, location.href).href; } };
  let clockOffset = 0;
  class Clock extends Date { static now() { return Date.now() + clockOffset; } }
  const browser = { Date: Clock, URL, URLSearchParams, Headers, Request, Response, TextEncoder, TextDecoder, AbortController, WebSocket: globalThis.WebSocket, crypto: globalThis.crypto, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval, console, location, history, localStorage: storage, fetch: fetcher, document: { visibilityState: 'visible' }, navigator: {}, addEventListener() {}, removeEventListener() {} };
  browser.window = browser;
  vm.runInNewContext(sdkBundle, browser);
  let client;
  const auth = createAuth({
    fetcher: async () => ({ ok: true, json: async () => ({ url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture', provider: 'google' }) }),
    createClient: (url, key, options) => (client = browser.supabase.createClient(url, key, { ...options, global: { fetch: fetcher }, auth: { ...options.auth, autoRefreshToken: false } })),
    storage, location, history, onState: state => states.push(state),
  });
  return { auth, states, saved, location, advance: milliseconds => { clockOffset += milliseconds; }, cleanup: () => client?.auth.dispose() };
}

test('실제 SDK: 로그아웃 완료 후 새 OAuth를 시작해 새 PKCE verifier를 보존한다', async t => {
  const pending = deferred();
  let logoutRequested = false;
  const savedSession = { ...session(), refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer' };
  const view = realSdkFixture({ savedSession, fetcher: async url => {
    assert.match(String(url), /\/logout/);
    logoutRequested = true;
    return pending.promise;
  } });
  t.after(() => view.cleanup());
  await view.auth.start();
  const exiting = view.auth.signOut();
  await tick();
  assert.equal(logoutRequested, true);
  assert.equal(view.auth.getSession(), null);
  const entering = view.auth.signIn();
  await tick();
  pending.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  await Promise.all([exiting, entering]);
  assert.ok([...view.saved.keys()].some(key => key.endsWith('-code-verifier')), '로그아웃 정리가 새 로그인 verifier를 지우면 안 된다');
});

test('실제 SDK: 만료된 PKCE 코드 교환 오류는 한국어로 표시하고 교환은 한 번만 한다', async t => {
  let exchanges = 0;
  const view = realSdkFixture({ href: 'https://receipts.example/?code=expired-code&keep=1', verifier: 'test-code-verifier-with-enough-characters-to-exchange', fetcher: async url => {
    assert.match(String(url), /\/token\?grant_type=pkce/);
    exchanges += 1;
    return new Response(JSON.stringify({ code: 'flow_state_expired', message: 'Flow state expired' }), { status: 400, headers: { 'content-type': 'application/json' } });
  } });
  t.after(() => view.cleanup());
  await view.auth.start();
  await tick();
  assert.equal(exchanges, 1);
  assert.equal(view.auth.getSession(), null);
  assert.match(view.states.at(-1).message, /로그인.*다시/);
  assert.doesNotMatch(view.states.at(-1).message, /flow_state|Flow state/);
  assert.equal(view.location.href, 'https://receipts.example/?keep=1');
});

test('실제 SDK: verifier가 사라진 재사용 코드도 조용히 버리지 않고 재로그인을 안내한다', async t => {
  const view = realSdkFixture({ href: 'https://receipts.example/?code=reused-code', fetcher: async () => { assert.fail('verifier 없이 코드를 교환하지 않는다'); } });
  t.after(() => view.cleanup());
  await view.auth.start();
  await tick();
  assert.equal(view.auth.getSession(), null);
  assert.match(view.states.at(-1).message, /로그인.*다시/);
  assert.equal(view.location.href, 'https://receipts.example/');
});

test('실제 SDK: 만료 토큰 로그아웃 중 갱신 503이어도 이 앱 인증정보만 지우고 새 인스턴스는 로그아웃 상태다', async t => {
  const savedSession = { ...session(), refresh_token: 'test-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer' };
  let refreshes = 0;
  const view = realSdkFixture({ savedSession, fetcher: async url => {
    assert.match(String(url), /\/token\?grant_type=refresh_token/);
    refreshes += 1;
    view.advance(31000);
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
  } });
  t.after(() => view.cleanup());
  await view.auth.start();
  assert.equal(view.auth.getSession()?.user.id, 'user-a');
  view.saved.set('unrelated-application-data', 'keep-me');
  view.saved.set('s07-receipt-organizer-auth', JSON.stringify({ ...savedSession, expires_at: Math.floor(Date.now() / 1000) - 1 }));
  view.saved.set('s07-receipt-organizer-auth-flow-old-code-verifier', JSON.stringify('old-verifier'));
  await view.auth.signOut();
  assert.equal(refreshes, 1);
  assert.equal(view.auth.getSession(), null);
  assert.deepEqual([...view.saved.entries()], [['unrelated-application-data', 'keep-me']]);
  const restored = realSdkFixture({ saved: view.saved, fetcher: async () => { assert.fail('로그아웃 뒤 새 인스턴스가 이전 토큰을 갱신하면 안 된다'); } });
  t.after(() => restored.cleanup());
  await restored.auth.start();
  assert.equal(restored.auth.getSession(), null);
  assert.equal(restored.states.at(-1).phase, 'signed-out');
});

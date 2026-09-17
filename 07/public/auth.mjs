export function createAuth({
  fetcher = globalThis.fetch,
  createClient = globalThis.supabase?.createClient,
  location = globalThis.location,
  history = globalThis.history,
  storage,
  onState = () => {},
} = {}) {
  let client;
  let subscription;
  let session = null;
  let operation = 0;
  let eventVersion = 0;
  let blocked = false;
  let redirecting = false;
  let pendingLogout;
  const storageKey = 's07-receipt-organizer-auth';
  const trackedKeys = new Set([storageKey]);
  const memory = new Map();
  if (!storage) { try { storage = globalThis.localStorage; } catch {} }
  const backing = storage || { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const authStorage = {
    getItem: key => { trackedKeys.add(key); return backing.getItem(key); },
    setItem: (key, value) => { trackedKeys.add(key); return backing.setItem(key, value); },
    removeItem: key => backing.removeItem(key),
  };
  async function clearStorage() {
    const keys = new Set(trackedKeys);
    for (let index = 0; index < backing.length; index += 1) keys.add(backing.key(index));
    for (const key of keys) if (key === storageKey || key?.startsWith(`${storageKey}-`)) await backing.removeItem(key);
  }
  const emit = (phase, message = '') => onState({ phase, message, session });
  const setSession = (next, message = '') => {
    const valid = next?.user?.id && next.access_token ? next : null;
    if (session?.user.id !== valid?.user.id) operation += 1;
    session = valid;
    emit(session ? 'signed-in' : 'signed-out', message);
  };

  async function start() {
    const attempt = ++operation;
    emit('loading', '로그인 상태를 확인하고 있어요.');
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const returnedError = url.searchParams.get('error') || hash.get('error');
    let initializationMessage = returnedError === 'access_denied' ? 'Google 로그인을 취소했어요. 다시 로그인할 수 있어요.' : returnedError ? 'Google 로그인을 마치지 못했어요. 다시 시도해 주세요.' : '';
    try {
      const response = await fetcher('/api/auth-config', { cache: 'no-store' });
      if (attempt !== operation) return;
      if (!response.ok) throw new Error('auth configuration unavailable');
      const config = await response.json();
      if (attempt !== operation) return;
      if (!config.url || !config.publishableKey || config.provider !== 'google' || !createClient) throw new Error('auth configuration unavailable');
      client = createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey, storage: authStorage } });
      subscription?.unsubscribe();
      subscription = client.auth.onAuthStateChange((event, next) => {
        if (blocked || (event === 'TOKEN_REFRESHED' && !session)) return;
        eventVersion += 1;
        setSession(next, event === 'INITIAL_SESSION' && !next ? initializationMessage : '');
      }).data.subscription;
      const initialized = await client.auth.initialize();
      if (attempt !== operation) return;
      if (initialized.error) {
        initializationMessage ||= 'Google 로그인을 마치지 못했어요. 다시 로그인해 주세요.';
        throw initialized.error;
      }
      const observed = eventVersion;
      const { data, error } = await client.auth.getSession();
      if (attempt !== operation) return;
      if (error) throw error;
      if (!data.session && url.searchParams.has('code')) initializationMessage ||= '로그인 링크가 만료됐어요. Google로 다시 로그인해 주세요.';
      if (observed === eventVersion) setSession(data.session, initializationMessage);
      else if (initializationMessage) emit(session ? 'signed-in' : 'signed-out', initializationMessage);
    } catch {
      if (attempt === operation) emit('error', initializationMessage || '로그인에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      let changed = false;
      let hashChanged = false;
      for (const key of ['code', 'sb_flow_id', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'provider_token', 'provider_refresh_token']) {
        if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
        if (hash.has(key)) { hash.delete(key); hashChanged = true; }
      }
      if (hashChanged) url.hash = hash.toString();
      if (changed || hashChanged) history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }

  async function signIn() {
    if (redirecting) return;
    if (pendingLogout) {
      const attempt = operation;
      emit('loading', '로그아웃을 마친 뒤 Google 로그인으로 이동할게요.');
      await pendingLogout;
      if (attempt !== operation) return;
    }
    if (!client) {
      const starting = start();
      const attempt = operation;
      await starting;
      if (attempt !== operation) return;
    }
    if (!client) return;
    const attempt = ++operation;
    blocked = false;
    redirecting = true;
    emit('redirecting', 'Google 로그인으로 이동하고 있어요.');
    try {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } });
      if (error) throw error;
    } catch {
      if (attempt === operation) emit(session ? 'signed-in' : 'signed-out', 'Google 로그인을 시작하지 못했어요. 다시 시도해 주세요.');
    } finally { redirecting = false; }
  }

  function signOut(message = '') {
    if (pendingLogout) return pendingLogout;
    blocked = true;
    operation += 1;
    setSession(null, message);
    const attempt = operation;
    pendingLogout = (async () => {
      let failed = false;
      try { failed = !!(await client?.auth.signOut({ scope: 'local' }))?.error; }
      catch { failed = true; }
      try {
        await clearStorage();
        if (failed && client) {
          const { error } = await client.auth.signOut({ scope: 'local' });
          if (error) throw error;
        }
        if (attempt === operation) blocked = false;
      } catch {
        if (attempt === operation) emit('signed-out', message || '로그아웃을 마치지 못했어요. 브라우저를 닫고 다시 시도해 주세요.');
      }
    })().finally(() => { pendingLogout = null; });
    return pendingLogout;
  }

  return { start, signIn, signOut, invalidate: () => signOut('로그인이 만료됐어요. 다시 로그인해 주세요.'), getSession: () => session };
}

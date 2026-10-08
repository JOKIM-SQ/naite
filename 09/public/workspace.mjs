import { createApp } from './app.mjs';
import { createBoardStore } from './storage.mjs';
import { createCloudStore } from './cloud-store.mjs';
/** @param {{document?: Document, window?: Window, location?: Location, fetch?: typeof fetch, createClient?: typeof import('@supabase/supabase-js').createClient, createLocalStore?: typeof createBoardStore, createCloudStore?: typeof createCloudStore, createApp?: typeof createApp}} [options] */
export async function startWorkspace(options = {}) {
  const doc = options.document ?? document;
  const location = options.location ?? globalThis.location;
  const makeLocal = options.createLocalStore ?? createBoardStore;
  const makeCloud = options.createCloudStore ?? createCloudStore;
  const makeApp = options.createApp ?? createApp;
  const fetcher = options.fetch ?? fetch;
  const makeClient = options.createClient ?? globalThis.supabase?.createClient;
  const signin = /** @type {HTMLButtonElement} */ (doc.getElementById('auth-signin'));
  const signout = /** @type {HTMLButtonElement} */ (doc.getElementById('auth-signout'));
  const importer = /** @type {HTMLButtonElement} */ (doc.getElementById('cloud-import'));
  const message = doc.getElementById('cloud-message');
  const account = doc.getElementById('account-label');
  const storage = doc.getElementById('storage-label');
  const local = await makeLocal();
  /** @type {import('@supabase/supabase-js').SupabaseClient | undefined} */ let client;
  /** @type {import('@supabase/supabase-js').User | undefined} */ let user;
  let connectionError = '';
  try {
    const response = await fetcher('/api/config', { cache: 'no-store' });
    if (!response.ok || !makeClient) throw Error('클라우드 연결을 확인할 수 없습니다. 지금은 이 브라우저에 저장됩니다.');
    const config = await response.json();
    if (config.provider !== 'google' || !config.url || !config.publishableKey) throw Error('클라우드 연결 설정이 필요합니다.');
    client = makeClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', storageKey: 's09-chroma-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const session = await client.auth.getSession();
    if (session.error) throw session.error;
    if (session.data.session) {
      const verified = await client.auth.getUser();
      if (verified.error || !verified.data.user) throw Error('로그인 상태를 확인하지 못했습니다. 새로고침해 주세요.');
      user = verified.data.user;
    }
  } catch (error) { connectionError = error instanceof Error ? error.message : '클라우드 연결을 확인하지 못했습니다.'; client = undefined; }
  const cloud = user && client ? await makeCloud(client, user.id) : undefined;
  const app = makeApp({ document: doc, store: cloud ?? local });
  account.textContent = user ? (user.user_metadata?.full_name || user.email?.split('@')[0] || '나의 계정') : '브라우저 보드';
  storage.textContent = user ? '내 계정에 보관돼요' : '이 브라우저에 보관돼요';
  signin.hidden = Boolean(user); signin.disabled = !client; signout.hidden = !user;
  message.textContent = connectionError || (user ? '로그인한 계정의 보드입니다. 다른 브라우저에서도 이어서 볼 수 있어요.' : 'Google로 로그인하면 보드를 계정에 보관할 수 있어요.');
  await app.init();
  let busy = false;
  function lock(locked) {
    busy = locked; signin.disabled = locked || !client; signout.disabled = importer.disabled = locked;
    for (const id of ['drop-zone', 'board']) { const target = doc.getElementById(id); if (locked) target.setAttribute('inert', ''); else target.removeAttribute('inert'); }
  }
  async function updateImport() {
    importer.hidden = !cloud;
    if (!cloud) return;
    const existing = new Set(app.getRecordIds());
    const count = (await local.list()).filter(record => !existing.has(record.id)).length;
    importer.hidden = count === 0; importer.textContent = `이 브라우저의 카드 ${count}개 가져오기`;
  }
  try { await updateImport(); } catch { message.textContent = '브라우저 카드 가져오기를 확인하지 못했습니다. 새로고침해 주세요.'; }
  signin.addEventListener('click', async () => {
    if (busy || !client) return;
    lock(true); message.textContent = 'Google 로그인으로 이동합니다…';
    try { await app.whenIdle(); const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/` } }); if (error) throw error; }
    catch { message.textContent = '로그인을 시작하지 못했습니다. 다시 시도해 주세요.'; lock(false); }
  });
  signout.addEventListener('click', async () => {
    if (busy || !client) return;
    lock(true);
    try { await app.whenIdle(); const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; }
    catch { message.textContent = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; lock(false); }
  });
  importer.addEventListener('click', async () => {
    if (busy || !cloud) return;
    lock(true);
    try {
      await app.whenIdle();
      const existing = new Set((await cloud.list()).map(record => record.id));
      const pending = (await local.list()).filter(record => !existing.has(record.id));
      let saved = 0;
      for (const record of pending) { await cloud.put(record); saved++; message.textContent = `${saved} / ${pending.length}개를 계정으로 가져오고 있습니다…`; }
      message.textContent = `${saved}개를 계정에 가져왔습니다. 브라우저 원본도 보관됩니다.`;
    } catch { message.textContent = '일부 카드를 가져오지 못했습니다. 이미 저장한 카드는 유지되며 다시 시도할 수 있어요.'; }
    finally { await app.init(); try { await updateImport(); } catch {} lock(false); }
  });
  if (client) {
    const activeId = user?.id ?? null;
    client.auth.onAuthStateChange((_event, session) => {
      if ((session?.user?.id ?? null) !== activeId) { doc.getElementById('board').setAttribute('inert', ''); doc.getElementById('board').hidden = true; setTimeout(() => location.reload(), 0); }
    });
  }
  return { app };
}
if (typeof document !== 'undefined') void startWorkspace().catch(() => { const message = document.getElementById('cloud-message'); if (message) message.textContent = '보드를 연결하지 못했습니다. 새로고침해 주세요.'; });

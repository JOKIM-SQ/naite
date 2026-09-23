import { createBoardSync, createStockMutations, validateItem, parseDelta, isDefinitiveError } from './inventory.mjs';

const INVITE_STORAGE = 's08-pending-invite';

export async function startApp({ window = globalThis.window, document = globalThis.document, fetch = globalThis.fetch, createClient = globalThis.supabase?.createClient } = {}) {
  const ui = (id) => document.getElementById(id);
  let client;
  let session = null;
  let boards = [];
  let active = null;
  let items = [];
  let sessionGeneration = 0;
  let boardGeneration = 0;
  let authEvent = 0;
  let connection = 'idle';
  let loaded = false;
  let online = window.navigator.onLine !== false;
  let addingItem = false;
  let adjustItemId = null;
  let invitation = null;
  const saving = new Map();
  const number = new Intl.NumberFormat('ko-KR');

  function notify(message, error = false) {
    ui('toast').textContent = message;
    ui('toast').dataset.kind = error ? 'error' : 'success';
    ui('toast').hidden = !message;
  }
  function status(message) { ui('app-status').textContent = message; }
  function formError(id, message) { ui(id).textContent = message; ui(id).hidden = !message; }
  function localError(message) { const error = new Error(message); error.name = 'InputError'; return error; }
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const mutations = createStockMutations({ adjust: ({ itemId, delta, requestId }) => rpc('s08_adjust_stock', { p_item_id: itemId, p_delta: delta, p_request_id: requestId }) });

  function renderNetworkControls() {
    ui('add-item-button').disabled = !online;
    ui('item-submit').disabled = !online || addingItem;
    ui('adjust-submit').disabled = !online || saving.has(adjustItemId);
    ui('retry-connect').disabled = !online;
  }

  function renderItems() {
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const pending = mutations.pending(item.id);
      const busy = saving.has(item.id);
      const low = item.quantity <= item.low_stock;
      const row = element(['UL', 'OL'].includes(ui('items-list').tagName) ? 'li' : 'div', 'inventory-row');
      row.setAttribute('role', 'listitem');
      row.dataset.itemId = item.id;
      row.setAttribute('aria-busy', String(busy));
      const identity = element('div', 'item-identity');
      identity.append(element('h3', 'item-name', item.name), element('span', 'item-sku', item.sku));
      const stock = element('div', 'item-stock');
      stock.append(element('span', 'stock-value', number.format(item.quantity)), element('span', 'stock-unit', ` ${item.unit}`));
      const controls = element('div', 'stock-controls');
      for (const [action, label, text] of [['decrease', '한 개 출고', '−'], ['increase', '한 개 입고', '+'], ['adjust', pending ? '이전 변경 재시도' : '수량 조정', pending ? '변경 재시도' : '수량 조정']]) {
        const button = element('button', action === 'adjust' ? 'stock-adjust' : 'stock-step', text);
        button.type = 'button';
        button.dataset.action = action;
        button.dataset.itemId = item.id;
        button.setAttribute('aria-label', `${item.name} ${label}`);
        button.disabled = !online || busy || (action !== 'adjust' && Boolean(pending)) || (action === 'decrease' && item.quantity === 0) || (action === 'increase' && item.quantity === 1_000_000);
        controls.append(button);
      }
      const stockStatus = element('span', `stock-status${low ? ' is-low' : ''}`, busy ? '저장 중' : pending ? '확인 필요' : low ? '재고 부족' : '충분');
      stockStatus.dataset.state = busy ? 'saving' : pending ? 'pending' : low ? 'low' : 'ok';
      row.append(identity, stock, controls, stockStatus);
      fragment.append(row);
    }
    ui('items-list').replaceChildren(fragment);
    ui('total-items').textContent = number.format(items.length);
    ui('total-quantity').textContent = number.format(items.reduce((sum, item) => sum + item.quantity, 0));
    ui('low-stock-count').textContent = number.format(items.filter((item) => item.quantity <= item.low_stock).length);
    ui('empty-state').hidden = !loaded || items.length > 0;
    renderNetworkControls();
  }

  const sync = createBoardSync({
    async load(boardId) {
      const { data, error } = await client.from('s08_items').select('id,board_id,name,sku,quantity,unit,low_stock,revision,updated_at,updated_by').eq('board_id', boardId).order('name');
      if (error) throw error;
      return data ?? [];
    },
    subscribe(boardId, changed, stateChanged) {
      const channel = client.channel(`s08-board-${boardId}-${globalThis.crypto.randomUUID()}`, { config: { postgres_changes_options: { wait: true } } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 's08_items', filter: `board_id=eq.${boardId}` }, changed)
        .subscribe(stateChanged);
      return () => { void client.removeChannel(channel).catch(() => {}); };
    },
    onItems(value) { items = value; renderItems(); },
    onStatus(value, error) {
      connection = value;
      if (value === 'idle') loaded = false;
      if (value === 'live') loaded = true;
      const labels = { idle: '보드 선택 대기', connecting: '실시간 연결 중', loading: '최신 재고 확인 중', live: '실시간 연결됨', offline: '연결 끊김 · 복구 대기', error: '재고를 불러오지 못했습니다' };
      ui('connection-status').textContent = labels[value];
      ui('connection-status').dataset.state = value;
      ui('retry-connect').hidden = !['offline', 'error'].includes(value);
      ui('empty-state').hidden = !loaded || items.length > 0;
      if (error && value === 'error') notify(errorMessage(error), true);
    },
  });

  const returnButton = element('button', 'button button-secondary setup-back-button', '기존 보드로 돌아가기');
  returnButton.type = 'button';
  returnButton.hidden = true;
  ui('setup-panel').append(returnButton);
  const retryApp = element('button', 'button button-secondary', '다시 시도');
  retryApp.type = 'button';
  retryApp.hidden = true;
  ui('app-status').after(retryApp);

  const inviteDialog = element('dialog', 'modal-dialog');
  inviteDialog.id = 'invite-dialog';
  inviteDialog.setAttribute('aria-labelledby', 'invite-dialog-title');
  inviteDialog.setAttribute('aria-describedby', 'invite-link-help');
  const inviteHeading = element('header', 'dialog-heading');
  const inviteTitle = element('h2', '', '팀원 초대 링크');
  inviteTitle.id = 'invite-dialog-title';
  const inviteHelp = element('p', '', '자동 복사 권한이 없어 링크를 직접 복사해 주세요. 함께 사용할 팀원에게 보내면 됩니다.');
  inviteHelp.id = 'invite-link-help';
  inviteHeading.append(inviteTitle, inviteHelp);
  const inviteFields = element('div', 'form-fields');
  const inviteField = element('div', 'field');
  const inviteLabel = element('label', '', '초대 링크');
  inviteLabel.htmlFor = 'invite-link';
  const inviteLink = element('input', '');
  inviteLink.id = 'invite-link';
  inviteLink.type = 'text';
  inviteLink.readOnly = true;
  inviteLink.setAttribute('aria-describedby', 'invite-link-help');
  inviteLink.addEventListener('click', () => inviteLink.select());
  inviteField.append(inviteLabel, inviteLink);
  inviteFields.append(inviteField);
  const inviteActions = element('footer', 'dialog-actions');
  const inviteClose = element('button', 'button button-primary', '닫기');
  inviteClose.type = 'button';
  inviteClose.addEventListener('click', () => { inviteDialog.close(); inviteLink.value = ''; });
  inviteDialog.addEventListener('close', () => { inviteLink.value = ''; });
  inviteActions.append(inviteClose);
  inviteDialog.append(inviteHeading, inviteFields, inviteActions);
  document.body.append(inviteDialog);

  function closeDialogs() {
    for (const id of ['item-dialog', 'adjust-dialog', 'invite-dialog']) if (ui(id).open) ui(id).close();
    inviteLink.value = '';
    adjustItemId = null;
  }
  function showSetup() {
    boardGeneration += 1;
    active = null;
    closeDialogs();
    sync.stop();
    ui('workspace').hidden = true;
    ui('setup-panel').hidden = false;
    returnButton.hidden = boards.length === 0;
    status('보드를 만들거나 초대 링크로 참여해 주세요.');
  }
  function selectBoard(boardId) {
    const board = boards.find((candidate) => candidate.id === boardId);
    if (!board) { showSetup(); return; }
    boardGeneration += 1;
    active = board;
    loaded = false;
    closeDialogs();
    ui('board-title').textContent = board.name;
    for (const option of ui('board-select').options) option.selected = option.value === board.id;
    ui('invite-button').hidden = board.role !== 'owner';
    ui('workspace').hidden = false;
    ui('setup-panel').hidden = true;
    status('팀의 재고를 함께 관리하세요.');
    sync.select(board.id);
    if (!online) sync.pause();
  }
  async function loadBoards(preferred, generation = sessionGeneration) {
    const result = await rpc('s08_list_boards');
    if (generation !== sessionGeneration || !session) return;
    boards = result ?? [];
    ui('board-select').replaceChildren();
    for (const board of boards) {
      const option = element('option', '', board.name);
      option.value = board.id;
      ui('board-select').append(option);
    }
    const create = element('option', '', '＋ 새 보드 만들기 / 초대 참여');
    create.value = '__new__';
    ui('board-select').append(create);
    retryApp.hidden = true;
    selectBoard(preferred ?? boards[0]?.id);
  }

  async function applySession(nextSession) {
    if (session?.user.id === nextSession?.user.id && session !== null) { session = nextSession; return; }
    sessionGeneration += 1;
    boardGeneration += 1;
    const generation = sessionGeneration;
    session = nextSession;
    active = null;
    boards = [];
    mutations.clear();
    saving.clear();
    sync.stop();
    closeDialogs();
    ui('workspace').hidden = true;
    ui('setup-panel').hidden = true;
    ui('login-panel').hidden = Boolean(session);
    ui('account-panel').hidden = !session;
    ui('user-name').textContent = session ? String(session.user.user_metadata?.full_name || session.user.email || '팀원') : '';
    ui('board-select').replaceChildren();
    retryApp.hidden = true;
    if (!session) { status(invitation ? '로그인하면 초대받은 보드에 참여합니다.' : 'Google 계정으로 로그인해 주세요.'); return; }
    status('참여 중인 보드를 확인하고 있습니다.');
    let preferred;
    if (invitation) {
      try {
        preferred = await rpc('s08_join_board', { p_invite_code: invitation });
        if (generation !== sessionGeneration) return;
        invitation = null;
        try { window.sessionStorage.removeItem(INVITE_STORAGE); } catch { /* The current tab still joined successfully. */ }
        notify('초대받은 보드에 참여했습니다.');
      } catch (error) {
        if (generation !== sessionGeneration) return;
        notify(`초대 참여 실패: ${errorMessage(error)}`, true);
      }
    }
    try { await loadBoards(preferred, generation); }
    catch (error) {
      if (generation !== sessionGeneration) return;
      showSetup();
      status('보드 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
      retryApp.hidden = false;
      notify(errorMessage(error), true);
    }
  }

  function openAdjustment(itemId) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const pending = mutations.pending(itemId);
    adjustItemId = itemId;
    ui('adjust-item-name').textContent = `${item.name} · 현재 ${number.format(item.quantity)} ${item.unit}`;
    ui('adjust-delta').value = String(pending?.delta ?? '');
    ui('adjust-delta').readOnly = Boolean(pending);
    formError('adjust-error', pending ? '이전 변경의 성공 여부를 확인합니다. 같은 요청으로 다시 보내므로 중복 반영되지 않습니다.' : '');
    ui('adjust-submit').textContent = pending ? '이전 변경 재시도' : '변경 저장';
    ui('adjust-submit').disabled = !online || saving.has(itemId);
    ui('adjust-dialog').showModal();
    ui(pending ? 'adjust-submit' : 'adjust-delta').focus();
  }
  async function adjustStock(itemId, delta) {
    if (!active || !online || saving.has(itemId)) return;
    const generation = boardGeneration;
    const saveToken = Symbol();
    saving.set(itemId, saveToken);
    renderItems();
    if (adjustItemId === itemId) ui('adjust-submit').disabled = true;
    try {
      await mutations.run(itemId, delta);
      if (generation !== boardGeneration) return;
      notify('수량 변경을 저장했습니다. 최신 재고를 확인합니다.');
      if (adjustItemId === itemId && ui('adjust-dialog').open) ui('adjust-dialog').close();
      sync.refresh();
    } catch (error) {
      if (generation !== boardGeneration) return;
      const message = isDefinitiveError(error) ? errorMessage(error) : '변경의 성공 여부를 확인하지 못했습니다. 이 품목의 변경 재시도로 결과를 확인해 주세요.';
      notify(message, true);
      if (adjustItemId === itemId && ui('adjust-dialog').open) {
        formError('adjust-error', message);
        const pending = Boolean(mutations.pending(itemId));
        ui('adjust-delta').readOnly = pending;
        ui('adjust-submit').textContent = pending ? '이전 변경 재시도' : '변경 저장';
      }
    } finally {
      if (saving.get(itemId) === saveToken) saving.delete(itemId);
      renderItems();
    }
  }

  ui('sign-in').disabled = true;
  ui('workspace').hidden = true;
  ui('setup-panel').hidden = true;
  ui('account-panel').hidden = true;
  ui('login-panel').hidden = false;
  status('서비스 설정을 확인하고 있습니다.');
  try {
    invitation = window.sessionStorage.getItem(INVITE_STORAGE);
    if (invitation) invitation = parseInvitation(invitation);
  } catch { invitation = null; }
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has('invite')) {
    try {
      invitation = parseInvitation(fragment.get('invite'));
      window.sessionStorage.setItem(INVITE_STORAGE, invitation);
      fragment.delete('invite');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${fragment.size ? `#${fragment}` : ''}`);
    } catch (error) { notify(error.name === 'InputError' ? error.message : '초대 정보를 보관할 수 없습니다. 브라우저 저장 공간 설정을 확인해 주세요.', true); }
  }
  ui('sign-in').addEventListener('click', async () => {
    ui('sign-in').disabled = true;
    try {
      const redirect = new URL(window.location.href);
      redirect.hash = '';
      redirect.search = '';
      const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect.href } });
      if (error) throw error;
    } catch (error) { notify(`로그인 시작 실패: ${errorMessage(error)}`, true); ui('sign-in').disabled = false; }
  });
  ui('sign-out').addEventListener('click', async () => {
    const previousSession = session;
    void applySession(null);
    try { const { error } = await client.auth.signOut(); if (error) throw error; notify('로그아웃했습니다.'); }
    catch (error) { notify(`로그아웃 실패: ${errorMessage(error)}`, true); await applySession(previousSession); }
  });
  ui('board-select').addEventListener('change', () => selectBoard(ui('board-select').value));
  returnButton.addEventListener('click', () => selectBoard(boards[0]?.id));
  retryApp.addEventListener('click', async () => {
    if (!client) { window.location.reload(); return; }
    retryApp.disabled = true;
    try { await loadBoards(active?.id); } catch (error) { notify(errorMessage(error), true); }
    finally { retryApp.disabled = false; }
  });
  ui('retry-connect').addEventListener('click', () => sync.reconnect());
  for (const [formId, rpcName, inputId] of [['create-board-form', 's08_create_board', 'board-name'], ['join-board-form', 's08_join_board', 'invite-code']]) {
    ui(formId).addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!session || ui(formId).getAttribute('aria-busy') === 'true') return;
      const generation = sessionGeneration;
      const submit = ui(formId).querySelector('[type="submit"]');
      ui(formId).setAttribute('aria-busy', 'true');
      if (submit) submit.disabled = true;
      try {
        const value = ui(inputId).value.trim();
        if (!value) throw localError(inputId === 'board-name' ? '보드 이름을 입력해 주세요.' : '초대 링크 또는 코드를 입력해 주세요.');
        const id = await rpc(rpcName, inputId === 'board-name' ? { p_name: value } : { p_invite_code: parseInvitation(value) });
        if (generation !== sessionGeneration) return;
        await loadBoards(id, generation);
        ui(inputId).value = '';
        notify(inputId === 'board-name' ? '새 보드를 만들었습니다.' : '보드에 참여했습니다.');
      } catch (error) { if (generation === sessionGeneration) notify(errorMessage(error), true); }
      finally { ui(formId).setAttribute('aria-busy', 'false'); if (submit) submit.disabled = false; }
    });
  }
  ui('invite-button').addEventListener('click', async () => {
    if (active?.role !== 'owner') return;
    const generation = boardGeneration;
    ui('invite-button').disabled = true;
    try {
      const code = await rpc('s08_get_invite', { p_board_id: active.id });
      if (generation !== boardGeneration) return;
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = `invite=${code}`;
      try {
        await window.navigator.clipboard.writeText(url.href);
        if (generation === boardGeneration) notify('초대 링크를 복사했습니다. 함께 사용할 팀원에게 보내 주세요.');
      } catch {
        if (generation !== boardGeneration) return;
        inviteLink.value = url.href;
        notify('');
        inviteDialog.showModal();
        inviteLink.focus();
        inviteLink.select();
      }
    } catch (error) { if (generation === boardGeneration) notify(`초대 링크를 가져오지 못했습니다. ${errorMessage(error)}`, true); }
    finally { ui('invite-button').disabled = false; }
  });
  ui('add-item-button').addEventListener('click', () => {
    if (!online || !active) return;
    ui('item-form').reset?.();
    formError('item-form-error', '');
    ui('item-dialog').showModal();
    ui('item-name').focus();
  });
  ui('item-cancel').addEventListener('click', () => ui('item-dialog').close());
  ui('adjust-cancel').addEventListener('click', () => ui('adjust-dialog').close());
  ui('item-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!active || !online || ui('item-submit').disabled) return;
    let input;
    try { input = validateItem({ name: ui('item-name').value, sku: ui('item-sku').value, quantity: ui('item-quantity').value, unit: ui('item-unit').value, lowStock: ui('item-low-stock').value }); }
    catch (error) { formError('item-form-error', error.message); return; }
    const generation = boardGeneration;
    addingItem = true;
    renderNetworkControls();
    formError('item-form-error', '');
    try {
      await rpc('s08_add_item', { p_board_id: active.id, p_name: input.name, p_sku: input.sku, p_quantity: input.quantity, p_unit: input.unit, p_low_stock: input.lowStock });
      if (generation !== boardGeneration) return;
      ui('item-dialog').close();
      notify('품목을 등록했습니다.');
      sync.refresh();
    } catch (error) { if (generation === boardGeneration) formError('item-form-error', errorMessage(error)); }
    finally { addingItem = false; renderNetworkControls(); }
  });
  ui('items-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'adjust') openAdjustment(button.dataset.itemId);
    else void adjustStock(button.dataset.itemId, button.dataset.action === 'increase' ? 1 : -1);
  });
  ui('adjust-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!adjustItemId) return;
    try { void adjustStock(adjustItemId, parseDelta(ui('adjust-delta').value)); }
    catch (error) { formError('adjust-error', error.message); }
  });
  function refetch() {
    if (!active || !online || document.visibilityState === 'hidden') return;
    if (['offline', 'error'].includes(connection)) sync.reconnect();
    else sync.refresh();
  }
  window.addEventListener('focus', refetch);
  window.addEventListener('offline', () => {
    online = false;
    sync.pause();
    renderItems();
    notify('네트워크 연결이 끊겼습니다. 마지막 재고를 표시하며 연결이 복구되면 최신 정보를 확인합니다.', true);
  });
  window.addEventListener('online', () => {
    online = true;
    if (active) sync.reconnect();
    renderItems();
    notify('네트워크 연결이 복구되었습니다. 최신 재고를 확인합니다.');
  });
  document.addEventListener('visibilitychange', refetch);

  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('config unavailable');
    const config = await response.json();
    if (!config.url || !config.publishableKey || config.provider !== 'google' || !createClient) throw new Error('config incomplete');
    client = createClient(config.url, config.publishableKey, { auth: { flowType: 'pkce', storageKey: 's08-stockroom-auth', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      const version = ++authEvent;
      // Supabase holds its auth lock during this callback. All DB work runs afterward.
      setTimeout(() => { if (version === authEvent) void applySession(nextSession); }, 0);
    });
    const version = authEvent;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    ui('sign-in').disabled = false;
    if (version === authEvent) await applySession(data.session);
    window.addEventListener('pagehide', (event) => { sync.stop(); if (!event.persisted) subscription.unsubscribe(); });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && active) { sync.select(active.id); if (!online) sync.pause(); }
    });
  } catch {
    status('서비스 설정을 확인하지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 설정을 확인해 주세요.');
    ui('sign-in').disabled = true;
    retryApp.hidden = false;
  }
}
export function errorMessage(error) {
  if (error?.code === '23505') return '이미 사용 중인 SKU입니다. 다른 SKU로 등록해 주세요.';
  if (['42501', '28000'].includes(error?.code)) return '접근 권한을 확인할 수 없습니다. 보드 멤버 여부나 초대 링크를 확인해 주세요.';
  if (['22003', '23514'].includes(error?.code) || /변경 후 수량|quantity_out_of_range/.test(error?.message ?? '')) return '변경 후 수량은 0~1,000,000이어야 합니다. 재고 수량을 확인해 주세요.';
  if (error?.code === '22023') return '입력값을 확인해 주세요. 수량은 정수이며 허용 범위 안이어야 합니다.';
  if (error instanceof Error && error.name === 'InputError') return error.message;
  return '서버 연결을 확인하지 못했습니다. 연결 상태를 확인하고 재시도해 주세요.';
}

export function parseInvitation(value) {
  let code = String(value ?? '').trim();
  if (/^https?:\/\//i.test(code)) {
    try { code = new URLSearchParams(new URL(code).hash.slice(1)).get('invite') ?? ''; }
    catch { code = ''; }
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(code)) {
    const error = new Error('올바른 초대 링크 또는 초대 코드를 입력해 주세요.');
    error.name = 'InputError';
    throw error;
  }
  return code.toLowerCase();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') void startApp();

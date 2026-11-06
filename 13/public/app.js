const $ = (id) => document.getElementById(id);
const state = { session: '', configured: false, documents: [], sample: null, active: null, busy: false, history: new Map(), retry: null };

function sessionId() {
  let saved;
  try { saved = localStorage.getItem('folio-session'); } catch { /* Browser storage can be unavailable. */ }
  const valid = typeof saved === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved);
  const id = valid ? saved : crypto.randomUUID();
  try { localStorage.setItem('folio-session', id); } catch { /* The session still works until this page closes. */ }
  return id;
}

async function request(payload) {
  const options = { signal: AbortSignal.timeout(90000), headers: { 'Content-Type': 'application/json' } };
  if (payload) { options.method = 'POST'; options.body = JSON.stringify({ ...payload, session: state.session }); }
  const response = await fetch(`/api/manual${payload ? '' : `?session=${encodeURIComponent(state.session)}`}`, options);
  let data;
  try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new Error(data.message || '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showError(message, retry = null) {
  $('error-message').textContent = message;
  $('request-error').hidden = false;
  $('retry-button').hidden = !retry;
  state.retry = retry;
}

function clearError() { $('request-error').hidden = true; state.retry = null; }

function updateControls() {
  const canAsk = state.configured && state.active && !state.busy;
  $('question').disabled = !canAsk;
  $('question').placeholder = !state.configured ? '서비스 연결을 준비하고 있어요' : state.active ? '이 매뉴얼에 궁금한 내용을 물어보세요' : '왼쪽에서 매뉴얼을 먼저 추가해 주세요';
  $('ask-button').disabled = !canAsk || !$('question').value.trim();
  $('sample-button').disabled = !state.configured || state.busy || !state.sample;
  $('manual-file').disabled = !state.configured || state.busy;
  $('drop-zone').setAttribute('aria-disabled', String(!state.configured || state.busy));
  for (const button of $('suggestions').querySelectorAll('button')) button.disabled = !canAsk;
  for (const button of $('library-list').querySelectorAll('button')) button.disabled = state.busy;
}

function processing(on, mode = 'ask') {
  state.busy = on;
  $('processing').hidden = !on;
  $('processing-label').textContent = mode === 'ingest' ? '매뉴얼을 차근차근 읽고 있어요' : '질문에 맞는 문장을 찾고 있어요';
  $('processing-detail').textContent = mode === 'ingest' ? '문서를 나누고 검색할 수 있도록 정리하고 있어요.' : '근거를 확인하고, 답변을 준비하고 있어요.';
  $('drop-zone').classList.remove('dragging');
  updateControls();
}

function renderLibrary() {
  $('document-count').textContent = String(state.documents.length);
  $('library-list').replaceChildren();
  state.documents.forEach((document) => {
    const card = node('button', `document-card${state.active?.id === document.id ? ' active' : ''}`);
    card.type = 'button';
    card.setAttribute('aria-pressed', String(state.active?.id === document.id));
    card.append(node('span', 'doc-icon', '▤'));
    const info = node('span');
    info.append(node('strong', '', document.name), node('small', '', `${document.chunkCount}개 문단 · 검색 준비 완료`));
    card.append(info);
    card.addEventListener('click', () => selectDocument(document));
    $('library-list').append(card);
  });
}

function selectDocument(document) {
  if (state.busy) return;
  state.active = document;
  clearError();
  $('chat-title').textContent = document.name;
  $('question').value = '';
  $('question-count').textContent = '0';
  renderLibrary();
  renderHistory();
  renderSuggestions();
  updateControls();
}

function renderSuggestions() {
  $('suggestions').replaceChildren();
  const isSample = state.sample && state.active?.name === state.sample.name;
  if (!isSample) return;
  const questions = [...(state.sample.questions || []), state.sample.unknownQuestion].filter(Boolean);
  questions.forEach((question, index) => {
    const button = node('button', '', index === questions.length - 1 ? '문서에 없는 질문도 해볼까요?' : question);
    button.type = 'button';
    button.title = question;
    button.addEventListener('click', () => { $('question').value = question; $('question-count').textContent = String(question.length); updateControls(); $('question').focus(); });
    $('suggestions').append(button);
  });
}

function renderSources(result) {
  $('source-list').replaceChildren();
  if (!result) {
    const empty = node('div', 'source-empty');
    for (let i = 0; i < 3; i += 1) empty.append(node('div', `source-line${i === 1 ? ' short' : ''}`));
    empty.append(node('span', '', '답변이 도착하면\n이곳에 출처가 펼쳐져요.'));
    $('source-list').append(empty);
    return;
  }
  if (!result.grounded || !result.citations?.length) {
    $('source-list').append(node('p', 'source-unknown', '매뉴얼에서 충분한 근거를 찾지 못했어요. 질문을 더 구체적으로 바꾸거나, 관련 내용이 담긴 매뉴얼을 추가해 보세요.'));
    return;
  }
  result.citations.forEach((citation, offset) => {
    const card = node('article', 'citation-card');
    const heading = node('div', 'citation-heading');
    heading.append(node('span', '', String(citation.index ?? offset + 1).padStart(2, '0')), node('strong', '', citation.section || '매뉴얼에서 찾은 문장'));
    const quote = node('blockquote', '', citation.quote);
    const button = node('button', '', '발췌 원문 자세히 보기 ↗');
    button.type = 'button';
    button.addEventListener('click', () => {
      $('dialog-title').textContent = citation.documentName || state.active?.name || '매뉴얼';
      $('dialog-section').textContent = citation.section || `출처 ${citation.index ?? offset + 1}`;
      $('dialog-quote').textContent = citation.quote;
      const isSummary = state.sample?.sourceNote && state.active?.name === state.sample.name;
      $('dialog-note').textContent = isSummary ? '등록 문서의 인용문입니다. 요약 문서는 원본 매뉴얼과 함께 확인하세요.' : '매뉴얼에서 발췌한 원문입니다. AI 답변과 비교해 확인하세요.';
      $('source-dialog').showModal();
    });
    card.append(heading, quote, node('span', 'source-file', citation.documentName || state.active?.name || ''), button);
    $('source-list').append(card);
  });
}

function appendAnswer(result) {
  const message = node('article', 'message message-answer');
  const label = node('div', 'answer-label');
  label.append(node('span', 'answer-logo', 'f'), node('span', '', 'FOLIO · 매뉴얼의 답'));
  const meta = node('div', 'answer-meta');
  meta.append(node('span', result.grounded ? 'answer-tag' : 'answer-tag unknown-tag', result.grounded ? '근거 확인됨' : '근거 부족'));
  if (result.citations?.length) {
    const sourceButton = node('button', 'inline-source-button', `출처 ${result.citations.length}개 보기 ↗`);
    sourceButton.type = 'button';
    sourceButton.addEventListener('click', () => { renderSources(result); $('sources-title').scrollIntoView({ block: 'nearest' }); });
    meta.append(sourceButton);
  }
  if (Number.isFinite(result.elapsedMs)) meta.append(node('span', '', `${(result.elapsedMs / 1000).toFixed(1)}초`));
  message.append(label, node('div', 'answer-body', result.answer), meta);
  $('chat-log').append(message);
}

function renderHistory() {
  const items = state.history.get(state.active?.id) || [];
  const empty = $('chat-empty');
  if (empty) empty.remove();
  $('chat-log').replaceChildren();
  if (!items.length) {
    const intro = node('div', 'chat-empty');
    const mark = node('div', 'empty-mark');
    mark.append(node('span', '', '“'), node('i'));
    intro.append(mark, node('h3', '', '이제 매뉴얼에 물어보세요.'), node('p', '', '아래 예시 질문으로 시작하거나, 궁금한 내용을 직접 입력해 보세요.'), node('span', 'empty-footnote', '문서에 없는 내용은 솔직하게 모른다고 답해요.'));
    $('chat-log').append(intro);
  } else {
    items.forEach((item) => { $('chat-log').append(node('div', 'message message-user', item.question)); if (item.result) appendAnswer(item.result); });
  }
  const lastAnswer = [...items].reverse().find((item) => item.result)?.result;
  renderSources(lastAnswer);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

async function ingest(name, text) {
  if (state.busy) return;
  if (!state.configured) { showError('서비스 연결이 필요해요. 상단 안내를 확인해 주세요.'); return; }
  if (!text.trim()) { showError('내용이 비어 있는 파일이에요. 텍스트가 포함된 매뉴얼을 선택해 주세요.'); return; }
  if (text.length > 40000) { showError('매뉴얼은 최대 40,000자까지 읽을 수 있어요. 필요한 부분만 나누어 추가해 주세요.'); return; }
  clearError(); processing(true, 'ingest');
  try {
    const { document } = await request({ action: 'ingest', name, text });
    if (!document?.id) throw new Error('매뉴얼 저장 결과를 확인하지 못했어요. 다시 시도해 주세요.');
    state.documents = [document, ...state.documents.filter((item) => item.id !== document.id)];
    processing(false); selectDocument(document); $('question').focus();
  } catch (error) { showError(readableError(error), () => ingest(name, text)); }
  finally { processing(false); }
}

function readableError(error) {
  return error.name === 'TimeoutError' || error.name === 'AbortError' ? '처리가 예상보다 오래 걸리고 있어요. 잠시 후 다시 시도해 주세요.' : error instanceof TypeError ? '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' : error.message || '요청을 완료하지 못했어요.';
}

async function readFile(file) {
  if (!file || state.busy) return;
  if (!/\.(txt|md)$/i.test(file.name)) { showError('TXT 또는 MD 형식의 텍스트 매뉴얼을 선택해 주세요.'); return; }
  if (file.size > 160000) { showError('파일이 너무 커요. 최대 40,000자의 매뉴얼을 선택해 주세요.'); return; }
  try { await ingest(file.name.replace(/\.(txt|md)$/i, '').slice(0, 100), await file.text()); }
  catch { showError('파일을 읽지 못했어요. UTF-8 텍스트 파일로 다시 선택해 주세요.'); }
}

async function ask(question) {
  if (!question.trim() || !state.active || state.busy || !state.configured) return;
  const documentId = state.active.id;
  clearError();
  const history = state.history.get(documentId) || [];
  const item = { question: question.trim() };
  history.push(item); state.history.set(documentId, history);
  $('question').value = ''; $('question-count').textContent = '0';
  renderHistory(); processing(true);
  try {
    const result = await request({ action: 'ask', documentId, question: item.question });
    if (typeof result.answer !== 'string') throw new Error('답변을 확인하지 못했어요. 다시 시도해 주세요.');
    item.result = result; renderHistory();
  } catch (error) {
    history.splice(history.indexOf(item), 1);
    renderHistory(); $('question').value = question; $('question-count').textContent = String(question.length);
    showError(readableError(error), () => ask(question));
  } finally { processing(false); }
}

async function initialize() {
  clearError();
  try {
    const data = await request();
    state.configured = Boolean(data.configured);
    state.documents = Array.isArray(data.documents) ? data.documents : [];
    state.sample = data.sample;
    $('sample-source-note').textContent = typeof state.sample?.sourceNote === 'string' ? state.sample.sourceNote : '';
    $('sample-source-note').hidden = !$('sample-source-note').textContent;
    $('service-status').className = `service-status ${state.configured ? 'ready' : 'needs-setup'}`;
    $('service-status').replaceChildren(node('i'), node('span', '', state.configured ? '매뉴얼을 읽을 준비가 됐어요' : '서비스 연결 준비 중'));
    $('setup-notice').hidden = state.configured;
    const setupNames = { SUPABASE_URL: '매뉴얼 저장소 연결', SUPABASE_SERVICE_ROLE_KEY: '매뉴얼 저장소 접근 설정', SUPABASE_SCHEMA: '매뉴얼 데이터베이스 테이블 준비', VOYAGE_API_KEY: 'Voyage AI 검색 키 설정', ANTHROPIC_API_KEY: 'Claude 답변 키 설정' };
    const pending = [...new Set((Array.isArray(data.missing) ? data.missing : []).map((key) => setupNames[key]).filter(Boolean))];
    $('setup-notice').replaceChildren(node('strong', '', '서비스를 연결하면 시작할 수 있어요.'), node('span', 'setup-details', pending.length ? `필요한 준비: ${pending.join(' · ')}. 설정을 완료한 뒤 연결을 다시 확인해 주세요.` : '서비스 연결 설정을 확인해 주세요.'));
    const reconnect = node('button', 'reconnect-button', '연결 다시 확인 ↻');
    reconnect.type = 'button';
    reconnect.addEventListener('click', initialize);
    $('setup-notice').append(reconnect);
    renderLibrary();
    if (state.documents.length) selectDocument(state.documents[0]);
    updateControls();
  } catch (error) {
    $('service-status').className = 'service-status needs-setup';
    $('service-status').replaceChildren(node('i'), node('span', '', '연결을 확인해 주세요'));
    showError(readableError(error), initialize); updateControls();
  }
}

state.session = sessionId();
$('manual-file').addEventListener('change', (event) => { readFile(event.target.files[0]); event.target.value = ''; });
$('sample-button').addEventListener('click', () => { if (state.sample) ingest(state.sample.name, state.sample.text); });
$('question').addEventListener('input', () => { $('question-count').textContent = String($('question').value.length); updateControls(); });
$('question').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('question-form').requestSubmit(); } });
$('question-form').addEventListener('submit', (event) => { event.preventDefault(); ask($('question').value); });
$('retry-button').addEventListener('click', () => { if (state.retry && !state.busy) state.retry(); });
$('close-source').addEventListener('click', () => $('source-dialog').close());
$('source-dialog').addEventListener('click', (event) => { if (event.target === $('source-dialog')) { const bounds = $('source-dialog').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) $('source-dialog').close(); } });
for (const name of ['dragenter', 'dragover']) $('drop-zone').addEventListener(name, (event) => { event.preventDefault(); if (state.configured && !state.busy) $('drop-zone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) $('drop-zone').addEventListener(name, (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragging'); if (name === 'drop' && state.configured) readFile(event.dataTransfer.files[0]); });
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
initialize();

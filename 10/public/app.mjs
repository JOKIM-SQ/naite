/** @typedef {import('./documents.mjs').KnowledgeDocument} KnowledgeDocument */
/** @typedef {{document: KnowledgeDocument, score: number, snippet: string}} SearchResult */

/**
 * Mount the search and reading experience. All corpus content uses text nodes.
 * @param {Document} document
 * @param {{documents: KnowledgeDocument[], search: (query: string) => SearchResult[]}} options
 */
export function createKnowledgeApp(document, options) {
  const root = document.getElementById('app');
  if (!root) throw new Error('검색 화면을 찾을 수 없습니다.');
  root.innerHTML = `
    <section class="intro" aria-labelledby="intro-title">
      <div class="intro-copy"><p class="eyebrow"><span></span> 흩어진 지식에, 하나의 갈피</p>
      <h1 id="intro-title">팀의 지식,<br>필요한 순간에<span class="period">.</span></h1>
      <p class="intro-description">어디서 봤더라, 누구에게 물어볼까.<br>이제 검색 한 번으로 팀의 답을 찾아보세요.</p></div>
      <div class="book-art" aria-hidden="true"><div class="book-shadow"></div><div class="book-back"></div><div class="book-pages"></div><div class="book-cover"><span class="book-small">THE TEAM LIBRARY</span><span class="book-title">우리의<br>일하는<br>방법들.</span><span class="book-line"></span><span class="book-bottom">KNOWLEDGE, TOGETHER.</span><span class="book-ribbon"></span></div><span class="art-note">함께 쌓고, 쉽게 찾는 지식</span></div>
    </section>
    <section class="search-section" aria-label="지식 검색">
      <label class="sr-only" for="knowledge-query">팀 문서 검색</label>
      <div class="search-box"><svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="knowledge-query" type="search" placeholder="궁금한 업무를 검색해 보세요" autocomplete="off" spellcheck="false" aria-describedby="search-help"><button class="clear-button" data-clear type="button" aria-label="검색어 지우기" hidden>지우기 <span aria-hidden="true">×</span></button><kbd class="slash-hint" aria-hidden="true">/</kbd></div>
      <div class="search-below"><div class="examples"><span>이렇게 찾아보세요</span><button type="button" data-query="연차 신청">연차 신청 <span aria-hidden="true">↗</span></button><button type="button" data-query="비용 정산">비용 정산 <span aria-hidden="true">↗</span></button><button type="button" data-query="VPN">VPN 연결 <span aria-hidden="true">↗</span></button></div><p id="search-help">조금 틀려도 괜찮아요.</p></div>
    </section>
    <section class="library" aria-label="팀 지식 라이브러리">
      <div class="result-pane"><div class="pane-heading"><h2 id="results-heading">모든 문서</h2><span class="result-count" role="status" aria-live="polite" aria-atomic="true"></span></div><div id="results" aria-labelledby="results-heading"></div><div class="list-note"><span aria-hidden="true">↵</span> 문서를 선택하면 오른쪽에서 읽을 수 있어요.</div></div>
      <article id="reader" class="reader" aria-label="선택한 문서"></article>
    </section>`;
  const input = /** @type {HTMLInputElement} */ (root.querySelector('input'));
  const clear = /** @type {HTMLButtonElement} */ (root.querySelector('[data-clear]'));
  const resultsNode = /** @type {HTMLElement} */ (root.querySelector('#results'));
  const reader = /** @type {HTMLElement} */ (root.querySelector('#reader'));
  const status = /** @type {HTMLElement} */ (root.querySelector('[role="status"]'));
  const heading = /** @type {HTMLElement} */ (root.querySelector('#results-heading'));
  /** @type {SearchResult[]} */
  let results = [];
  let selected = 0;
  let composing = false;
  /** @type {string | null} */
  let lastQuery = null;
  /** @param {string} tag @param {string} className @param {string} text */
  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  /** @param {string} title @param {string} description */
  function emptyReader(title, description) {
    reader.replaceChildren(node('div', 'empty-symbol', '⌑'), node('h2', '', title), node('p', '', description));
    reader.classList.add('is-empty');
  }
  /** @param {number} index */
  function select(index) {
    selected = index;
    const item = results[index];
    if (!item) return;
    resultsNode.querySelectorAll('[data-result-id]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    const doc = item.document;
    reader.classList.remove('is-empty');
    reader.replaceChildren();
    const label = node('div', 'reader-label', '');
    label.append(node('span', 'type-badge', doc.type), node('span', '', doc.department));
    reader.append(label, node('h2', 'reader-title', doc.title), node('p', 'reader-summary', doc.summary));
    const meta = node('div', 'reader-meta', '');
    meta.append(node('span', 'owner-avatar', doc.owner.slice(0, 1)), node('span', '', doc.owner), node('span', 'meta-divider', '·'), node('span', '', `${doc.updatedAt.replaceAll('-', '.')} 업데이트`));
    reader.append(meta);
    const content = node('div', 'reader-content', '');
    for (const section of doc.sections) {
      const block = node('section', 'document-section', '');
      block.append(node('h3', '', section.heading), node('p', '', section.text));
      content.append(block);
    }
    reader.append(content, node('p', 'document-end', '갈피에 담긴 팀의 지식'));
    reader.scrollTop = 0;
  }
  function update() {
    if (composing) return;
    const query = input.value.trim();
    root.classList.toggle('has-query', Boolean(query));
    clear.hidden = input.value.length === 0;
    if (lastQuery === query) return;
    lastQuery = query;
    resultsNode.replaceChildren();
    heading.textContent = query ? '검색 결과' : '모든 문서';
    try {
      results = options.search(query);
    } catch {
      results = [];
      lastQuery = null;
      status.textContent = '검색 오류';
      resultsNode.append(node('p', 'empty-results', '검색을 불러오지 못했어요. 검색어를 다시 입력해 주세요.'));
      emptyReader('잠시 검색이 멈췄어요', '검색어를 다시 입력하면 한 번 더 찾아볼게요.');
      return;
    }
    status.textContent = `${results.length}개 문서`;
    if (!results.length) {
      resultsNode.append(node('p', 'empty-results', '일치하는 문서를 찾지 못했어요. 다른 단어나 짧은 검색어로 다시 찾아보세요.'));
      emptyReader('아직 찾지 못한 지식이에요', '검색어를 바꾸거나 지우면 다른 문서를 살펴볼 수 있어요.');
      return;
    }
    results.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result-card';
      button.dataset.resultId = item.document.id;
      button.setAttribute('aria-controls', 'reader');
      const top = node('span', 'result-top', '');
      top.append(node('span', 'type-badge', item.document.type), node('span', 'result-department', item.document.department), node('span', 'result-number', String(index + 1).padStart(2, '0')));
      button.append(top, node('span', 'result-title', item.document.title), node('span', 'result-snippet', item.snippet || item.document.summary), node('span', 'result-meta', `${item.document.owner} · ${item.document.updatedAt.replaceAll('-', '.')}`));
      button.addEventListener('click', () => select(index));
      resultsNode.append(button);
    });
    select(0);
  }
  function reset() { input.value = ''; update(); input.focus(); }
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; update(); });
  input.addEventListener('input', update);
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); reset(); }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
      event.preventDefault();
      select(Math.max(0, Math.min(results.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))));
      resultsNode.querySelectorAll('[data-result-id]')[selected]?.scrollIntoView?.({ block: 'nearest' });
    }
    if (event.key === 'Enter' && results.length) {
      event.preventDefault();
      const current = /** @type {HTMLButtonElement} */ (resultsNode.querySelectorAll('[data-result-id]')[selected]);
      current.focus();
    }
  });
  clear.addEventListener('click', reset);
  root.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => { input.value = button.getAttribute('data-query') || ''; update(); input.focus(); }));
  document.addEventListener('keydown', event => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && !target?.closest('input, textarea, [contenteditable="true"]')) {
      event.preventDefault(); input.focus();
    }
  });
  update();
}

if (typeof document !== 'undefined') {
  Promise.all([import('./documents.mjs'), import('./search.mjs')]).then(([{ documents }, { createKnowledgeSearch }]) => {
    const engine = createKnowledgeSearch(documents);
    createKnowledgeApp(document, { documents, search: query => engine.search(query) });
  }).catch(() => {
    const root = document.getElementById('app');
    if (root) root.textContent = '문서를 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
  });
}

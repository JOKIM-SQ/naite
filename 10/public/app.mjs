/** @typedef {import('./documents.mjs').KnowledgeDocument} KnowledgeDocument */
/** @typedef {{titleRanges: number[][], snippetRanges: number[][], sectionIndex: number | null, sectionRanges: {headingRanges: number[][], textRanges: number[][]}[], keywords: string[]}} Evidence */
/** @typedef {{document: KnowledgeDocument, score: number, snippet: string, evidence?: Evidence}} SearchResult */
/** @typedef {{list: () => Promise<KnowledgeDocument[]>, importFiles: (files: File[]) => Promise<{added: KnowledgeDocument[], duplicates: string[], failures: {name: string, message: string}[]}>}} DocumentLibrary */

/**
 * Mount the search and reading experience. All corpus content uses text nodes.
 * @param {Document} document
 * @param {{documents: KnowledgeDocument[], search: (query: string) => SearchResult[], library?: DocumentLibrary, createSearch?: (documents: KnowledgeDocument[]) => {search: (query: string) => SearchResult[]}}} options
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
      <div class="library-tools" data-drop><div><span data-library-count></span><span class="drop-hint">TXT · Markdown 파일을 여기에 놓아도 돼요</span></div><button type="button" class="add-button" data-add disabled>＋ 문서 추가</button><input type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" multiple hidden aria-label="추가할 문서 선택"></div>
      <p class="import-note">파일은 서버에 보내지 않고 이 브라우저에 보관해요. 파일당 256KiB · 한 번에 10개 · 최대 100개, 총 5MiB</p>
      <p class="import-status" data-import-status role="status" aria-live="polite" aria-atomic="true"></p>
      <label class="sr-only" for="knowledge-query">팀 문서 검색</label>
      <div class="search-box"><svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="knowledge-query" type="search" placeholder="궁금한 업무를 검색해 보세요" autocomplete="off" spellcheck="false" aria-describedby="search-help"><button class="clear-button" data-clear type="button" aria-label="검색어 지우기" hidden>지우기 <span aria-hidden="true">×</span></button><kbd class="slash-hint" aria-hidden="true">/</kbd></div>
      <div class="search-below"><div class="examples"><span>이렇게 찾아보세요</span><button type="button" data-query="연차 신청">연차 신청 <span aria-hidden="true">↗</span></button><button type="button" data-query="비용 정산">비용 정산 <span aria-hidden="true">↗</span></button><button type="button" data-query="VPN">VPN 연결 <span aria-hidden="true">↗</span></button></div><p id="search-help">조금 틀려도 괜찮아요.</p></div>
    </section>
    <section class="library" aria-label="팀 지식 라이브러리">
      <div class="result-pane"><div class="pane-heading"><h2 id="results-heading">모든 문서</h2><span class="result-count" role="status" aria-live="polite" aria-atomic="true"></span></div><div id="results" aria-labelledby="results-heading"></div><div class="list-note"><span aria-hidden="true">↵</span> 문서를 선택하면 오른쪽에서 읽을 수 있어요.</div></div>
      <article id="reader" class="reader" aria-label="선택한 문서"></article>
    </section>`;
  const input = /** @type {HTMLInputElement} */ (root.querySelector('[type="search"]'));
  const clear = /** @type {HTMLButtonElement} */ (root.querySelector('[data-clear]'));
  const resultsNode = /** @type {HTMLElement} */ (root.querySelector('#results'));
  const reader = /** @type {HTMLElement} */ (root.querySelector('#reader'));
  const status = /** @type {HTMLElement} */ (root.querySelector('.result-count'));
  const heading = /** @type {HTMLElement} */ (root.querySelector('#results-heading'));
  /** @type {SearchResult[]} */
  let results = [];
  let selected = 0;
  let composing = false;
  let search = options.search;
  const addButton = /** @type {HTMLButtonElement} */ (root.querySelector('[data-add]'));
  const picker = /** @type {HTMLInputElement} */ (root.querySelector('[type="file"]'));
  const drop = /** @type {HTMLElement} */ (root.querySelector('[data-drop]'));
  const importStatus = /** @type {HTMLElement} */ (root.querySelector('[data-import-status]'));
  const libraryCount = /** @type {HTMLElement} */ (root.querySelector('[data-library-count]'));
  let storageReady = false;
  let busy = false;
  libraryCount.textContent = `예시 ${options.documents.length}개 · 내 문서 0개`;
  /** @type {string | null} */
  let lastQuery = null;
  /** @param {string} tag @param {string} className @param {string} text */
  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }
  /** Preserve UTF-16 source offsets; discard invalid ranges and merge overlaps.
   * @param {string} tag @param {string} className @param {string} text @param {number[][]} [ranges] */
  function marked(tag, className, text, ranges = []) {
    const element = node(tag, className, '');
    const valid = ranges.filter(range => Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] >= 0 && range[1] <= text.length && range[0] < range[1]).sort((a, b) => a[0] - b[0]);
    /** @type {number[][]} */
    const merged = [];
    for (const [start, end] of valid) {
      const previous = merged.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    let cursor = 0;
    for (const [start, end] of merged) {
      element.append(document.createTextNode(text.slice(cursor, start)), node('mark', '', text.slice(start, end)));
      cursor = end;
    }
    element.append(document.createTextNode(text.slice(cursor)));
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
    const evidence = input.value.trim() ? item.evidence : undefined;
    reader.classList.remove('is-empty');
    reader.replaceChildren();
    const label = node('div', 'reader-label', '');
    label.append(node('span', 'type-badge', doc.type), node('span', '', doc.department));
    reader.append(label, marked('h2', 'reader-title', doc.title, evidence?.titleRanges), node('p', 'reader-summary', doc.summary));
    const meta = node('div', 'reader-meta', '');
    meta.append(node('span', 'owner-avatar', doc.owner.slice(0, 1)), node('span', '', doc.owner), node('span', 'meta-divider', '·'), node('span', '', `${doc.updatedAt.replaceAll('-', '.')} 업데이트`));
    reader.append(meta);
    const content = node('div', 'reader-content', '');
    for (const [sectionIndex, section] of doc.sections.entries()) {
      const block = node('section', 'document-section', '');
      const ranges = evidence?.sectionRanges[sectionIndex];
      block.append(marked('h3', '', section.heading, ranges?.headingRanges), marked('p', '', section.text, ranges?.textRanges));
      if (evidence?.sectionIndex === sectionIndex && block.querySelector('mark')) {
        block.classList.add('is-relevant');
        const jump = node('button', 'jump-button', '관련 부분 보기 ↓');
        jump.setAttribute('type', 'button');
        jump.setAttribute('data-jump', '');
        jump.addEventListener('click', () => {
          const behavior = document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
          // container: nearest confines supported browsers to the reader scrollport.
          // Restore outer scroll positions as a fallback for older browsers.
          const ancestors = [];
          for (let parent = reader.parentElement; parent; parent = parent.parentElement) ancestors.push({element: parent, top: parent.scrollTop, left: parent.scrollLeft});
          block.scrollIntoView?.(/** @type {ScrollIntoViewOptions} */ ({block: 'nearest', behavior, container: 'nearest'}));
          for (const {element, top, left} of ancestors) { element.scrollTop = top; element.scrollLeft = left; }
        });
        reader.append(jump);
      }
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
      results = search(query);
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
      const evidence = query ? item.evidence : undefined;
      button.append(top, marked('span', 'result-title', item.document.title, evidence?.titleRanges), marked('span', 'result-snippet', item.snippet || item.document.summary, evidence?.snippetRanges), node('span', 'result-meta', `${item.document.owner} · ${item.document.updatedAt.replaceAll('-', '.')}`));
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
  /** @param {KnowledgeDocument[]} uploaded */
  function syncLibrary(uploaded) {
    if (!options.createSearch) return;
    search = options.createSearch([...options.documents, ...uploaded]).search;
    libraryCount.textContent = `예시 ${options.documents.length}개 · 내 문서 ${uploaded.length}개`;
    lastQuery = null;
    update();
  }
  /** @param {File[]} files */
  async function importFiles(files) {
    if (!files.length) return;
    if (busy || !storageReady || !options.library) {
      importStatus.textContent = busy ? '문서를 보관하고 있어요. 완료된 뒤 다시 추가해 주세요.' : '브라우저 보관함을 사용할 수 없어요. 예시 문서는 계속 검색할 수 있어요.';
      return;
    }
    busy = true;
    addButton.disabled = picker.disabled = true;
    drop.setAttribute('aria-busy', 'true');
    importStatus.textContent = '문서를 읽고 이 브라우저에 보관하는 중이에요…';
    try {
      const report = await options.library.importFiles(files);
      const messages = [`${report.added.length}개 문서를 추가했어요.`];
      if (report.duplicates.length) messages.push(`이미 보관한 문서: ${report.duplicates.join(', ')}`);
      if (report.failures.length) messages.push(`추가하지 못한 문서: ${report.failures.map(failure => `${failure.name} — ${failure.message}`).join(' / ')}`);
      try { syncLibrary(await options.library.list()); }
      catch {
        messages[0] = report.added.length
          ? '문서를 저장했지만 목록을 다시 불러오지 못했어요.'
          : '새로 추가된 문서는 없고, 목록도 다시 불러오지 못했어요.';
        messages.push('새로고침하면 보관함을 다시 확인할 수 있어요.');
      }
      importStatus.textContent = messages.join(' ');
    } catch {
      importStatus.textContent = '문서를 저장하지 못했어요. 기존 문서는 그대로예요. 브라우저 저장 공간과 설정을 확인한 뒤 다시 추가해 주세요.';
    } finally {
      busy = false;
      addButton.disabled = picker.disabled = !storageReady;
      picker.value = '';
      drop.setAttribute('aria-busy', 'false');
    }
  }
  addButton.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => { const files = Array.from(picker.files || []); picker.value = ''; void importFiles(files); });
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('is-dragging'); void importFiles(Array.from(event.dataTransfer?.files || [])); });
  update();
  picker.disabled = true;
  if (options.library && options.createSearch) {
    importStatus.textContent = '이 브라우저에 보관한 문서를 불러오는 중이에요…';
    options.library.list().then(uploaded => {
      syncLibrary(uploaded);
      storageReady = true;
      addButton.disabled = picker.disabled = false;
      importStatus.textContent = uploaded.length ? `보관한 문서 ${uploaded.length}개를 불러왔어요.` : '';
    }).catch(() => {
      importStatus.textContent = '브라우저 보관함을 열지 못했어요. 예시 문서는 계속 검색할 수 있어요.';
    });
  } else importStatus.textContent = '이 환경에서는 문서를 보관할 수 없어요. 예시 문서는 계속 검색할 수 있어요.';
}

if (typeof document !== 'undefined') {
  Promise.all([import('./documents.mjs'), import('./search.mjs'), import('./library.mjs')]).then(([{ documents }, { createKnowledgeSearch }, {createDocumentLibrary}]) => {
    const engine = createKnowledgeSearch(documents);
    createKnowledgeApp(document, { documents, search: query => engine.search(query), createSearch: createKnowledgeSearch, library: createDocumentLibrary({indexedDB: globalThis.indexedDB}) });
  }).catch(() => {
    const root = document.getElementById('app');
    if (root) root.textContent = '문서를 불러오지 못했어요. 잠시 후 새로고침해 주세요.';
  });
}

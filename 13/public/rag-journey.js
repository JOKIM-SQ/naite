const stages = ['embedding', 'search', 'answer'];
const stageTitles = { embedding: '질문을 숫자로', search: '비슷한 문단 찾기', answer: '근거로 답하기' };
const unreadable = () => new Error('검색 과정의 응답을 읽지 못했어요. 다시 시도해 주세요.');

export async function readAskResponse(response, onProgress = () => {}) {
  if (!response.ok || !response.headers?.get('content-type')?.includes('application/x-ndjson')) {
    let data;
    try { data = await response.json(); } catch { throw unreadable(); }
    if (!response.ok) throw new Error(data.message || '요청을 완료하지 못했어요. 다시 시도해 주세요.');
    return data;
  }
  if (!response.body) throw unreadable();
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', finished = false;
  const line = (text) => {
    if (!text.trim()) return;
    let event;
    try { event = JSON.parse(text); } catch { throw unreadable(); }
    if (event.type === 'error') throw new Error(event.message || '질문 처리가 중단됐어요. 다시 시도해 주세요.');
    if (event.type === 'progress') onProgress(event);
    if (event.type === 'result') {
      if (!event.result || typeof event.result.answer !== 'string') throw unreadable();
      finished = true;
      return event.result;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      try { buffer += done ? decoder.decode() : decoder.decode(value, { stream: true }); } catch { throw unreadable(); }
      if (buffer.length > 1000000) throw unreadable();
      let boundary;
      while ((boundary = buffer.indexOf('\n')) !== -1) {
        const result = line(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        if (finished) return result;
      }
      if (done) {
        const result = line(buffer);
        if (finished) return result;
        throw new Error('검색 과정의 연결이 중단됐어요. 다시 시도해 주세요.');
      }
    }
  } finally {
    try { await reader.cancel(); } catch { /* A closed or aborted stream needs no further cleanup. */ }
    reader.releaseLock();
  }
}

export function newJourney(question = '') {
  return { phase: question ? 'connecting' : 'idle', stage: null, selected: 'embedding', trace: question ? { question } : null, error: '' };
}
export function advanceJourney(state, event) {
  if (![...stages, 'verify'].includes(event.stage)) return state;
  const trace = { ...state.trace };
  for (const key of ['question', 'searchQuestion', 'translated', 'dimensions', 'vectorPreview', 'threshold', 'limit', 'candidates']) if (event[key] !== undefined) trace[key] = event[key];
  const stage = event.stage === 'verify' ? 'answer' : event.stage;
  return { ...state, phase: 'running', stage, selected: state.pinned ? state.selected : stage, trace, verifying: event.stage === 'verify', skipped: Boolean(event.skipped) };
}
export function finishJourney(state, result, { review = false } = {}) {
  if (review && ['connecting', 'running'].includes(state.phase)) return state;
  return { ...state, phase: 'done', stage: 'answer', selected: state.pinned ? state.selected : 'answer', trace: result.trace || null, result, error: '' };
}
export function failJourney(state, error) { return { ...state, phase: 'error', error }; }

export function createJourneyPanel(root) {
  const document = root.ownerDocument;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let state = newJourney(), manual = null, expanded = false, candidateIndex = 0, mode = 'easy';
  const detail = root.querySelector('.journey-detail'), status = root.querySelector('.journey-status'), toggle = root.querySelector('.journey-toggle');
  const steps = root.querySelector('.journey-steps');
  const modes = make('div', 'journey-modes');
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '설명 보기 방식');
  const easy = make('div', 'journey-easy');
  const preparation = make('div', 'journey-preparation');
  const modeButtons = ['easy', 'technical'].map(value => {
    const button = make('button', '', value === 'easy' ? '쉽게 보기' : '기술 상세');
    button.type = 'button'; button.dataset.mode = value;
    button.addEventListener('click', () => { mode = value; render(); });
    modes.append(button); return button;
  });
  steps.before(modes, preparation, easy);
  const stepButtons = stages.map((stage, index) => {
    const button = make('button', 'journey-step');
    button.type = 'button'; button.dataset.stage = stage;
    button.setAttribute('aria-controls', 'journey-detail');
    const symbol = make('span', 'journey-step-symbol', ['⌁', '▤', '↳'][index]); symbol.setAttribute('aria-hidden', 'true');
    const words = make('span', 'journey-step-words');
    words.append(make('small', '', `0${index + 1} / ${['EMBED', 'RETRIEVE', 'ANSWER'][index]}`), make('strong', '', stageTitles[stage]), make('span', '', ['의미를 담은 숫자 벡터', '가까운 원문을 골라서', '찾은 문장만 근거로'][index]));
    const indicator = make('span', 'journey-step-state', '↗'); indicator.setAttribute('aria-hidden', 'true');
    button.append(symbol, words, indicator);
    button.addEventListener('click', () => { state = { ...state, selected: stage, pinned: true }; expanded = true; candidateIndex = 0; render(); });
    steps.append(button);
    return button;
  });
  toggle.addEventListener('click', () => { expanded = !expanded; render(); });

  function textBlock(kicker, title, description) {
    const block = make('div', 'journey-copy');
    block.append(make('span', 'journey-kicker', kicker), make('h3', '', title), make('p', '', description));
    return block;
  }
  function note(text) { return make('p', 'journey-note', text); }
  function renderEmbedding(trace) {
    const copy = textBlock('01 / VOYAGE AI', '질문도, 문단도 같은 숫자 언어로.', '매뉴얼은 미리 문단별로 저장하고, 질문할 때는 질문만 새로 임베딩해요. 의미가 비슷하면 숫자 벡터도 가까워집니다.');
    const visual = make('div', 'journey-embedding');
    if (trace?.question) {
      const question = make('div', 'journey-query');
      question.append(make('span', 'journey-kicker', '이번 질문'), make('p', '', trace.question));
      if (trace.searchQuestion) {
        const search = make('p', 'journey-search-query', trace.searchQuestion);
        question.append(make('span', 'journey-query-label', trace.translated ? '영문 원문을 찾기 위한 검색 문장' : '검색에 사용한 문장'), search);
      }
      visual.append(question);
    }
    const values = trace?.vectorPreview?.filter(Number.isFinite) || [];
    if (values.length) {
      const vector = make('div', 'journey-vector');
      const head = make('div', 'journey-vector-heading');
      head.append(make('strong', '', `${trace.dimensions || 512}차원 질문 벡터`), make('span', '', `앞 ${values.length}개 값`));
      vector.append(head);
      const bars = make('div', 'journey-vector-bars');
      bars.setAttribute('aria-label', `실제 질문 임베딩 벡터의 앞 ${values.length}개 값`);
      const maximum = Math.max(...values.map(Math.abs), 0.001);
      values.forEach((value, index) => {
        const column = make('div', 'journey-vector-column');
        const bar = make('i', value < 0 ? 'negative' : 'positive');
        bar.style.setProperty('--bar-height', `${Math.max(2, Math.abs(value) / maximum * 29)}px`);
        column.title = `차원 ${index + 1}: ${value}`;
        column.append(bar, make('span', '', value.toFixed(3)));
        bars.append(column);
      });
      vector.append(bars, note('실제 질문 벡터의 일부입니다. 막대 높이는 표시된 값 안에서 비교하며, 문단 위치나 정답 확률을 뜻하지 않아요.'));
      visual.append(vector);
    } else {
      const empty = make('div', 'journey-vector-empty');
      empty.append(make('span', '', '문장 → 숫자 → 의미 검색'), note(trace?.question ? 'Voyage AI의 실제 임베딩 결과가 도착하면 이곳에 펼쳐져요.' : '질문을 보내면 실제 질문과 숫자 벡터 일부를 확인할 수 있어요.'));
      visual.append(empty);
    }
    detail.append(copy, visual);
  }
  function renderSearch(trace) {
    const count = manual?.chunkCount;
    const copy = textBlock('02 / PGVECTOR', '닮은 문장은 가까운 곳에.', `${Number.isFinite(count) ? `${count.toLocaleString()}개 문단 속에서 ` : '미리 저장한 문단 속에서 '}질문과 의미가 가까운 문단을 찾습니다. 기준을 넘은 상위 문단만 답변에 전달해요.`);
    const visual = make('div', 'journey-retrieval');
    if (!Array.isArray(trace?.candidates)) {
      visual.append(make('div', 'journey-search-empty', '질문 벡터 ↔ 저장된 문단 벡터'), note('검색이 끝나면 실제로 찾은 문단과 코사인 유사도를 확인할 수 있어요. 아직 검색 결과가 없습니다.'));
    } else {
      const heading = make('div', 'journey-matches-heading');
      heading.append(make('strong', '', `${trace.candidates.length}개 문단을 찾았어요`), make('span', '', `기준 ${trace.threshold ?? 0.35} · 최대 ${trace.limit ?? 4}개`));
      visual.append(heading);
      if (!trace.candidates.length) visual.append(note('기준을 넘는 문단이 없어요. 원문 근거 없이 답을 만들지 않습니다.'));
      else {
        const list = make('div', 'journey-matches');
        trace.candidates.forEach((candidate, index) => {
          const button = make('button', `journey-match${candidateIndex === index ? ' selected' : ''}`);
          button.type = 'button'; button.setAttribute('aria-pressed', String(candidateIndex === index));
          const label = make('span', 'journey-match-label');
          label.append(make('span', '', `${String(candidate.index ?? index + 1).padStart(2, '0')} ${candidate.section || '매뉴얼 문단'}`));
          if (candidate.usedInAnswer) label.append(make('small', 'journey-used', '답변에 인용'));
          const score = make('span', 'journey-score', Number.isFinite(candidate.similarity) ? candidate.similarity.toFixed(3) : '—');
          button.append(label, score);
          if (Number.isFinite(candidate.similarity)) button.style.setProperty('--match-width', `${Math.max(0, Math.min(1, candidate.similarity)) * 100}%`);
          button.addEventListener('click', () => { candidateIndex = index; render(); });
          list.append(button);
        });
        const selected = trace.candidates[candidateIndex] || trace.candidates[0];
        const excerpt = make('div', 'journey-excerpt');
        excerpt.append(make('span', 'journey-kicker', selected.section || '찾은 원문'), make('blockquote', '', selected.content), make('span', 'journey-excerpt-label', selected.usedInAnswer ? '이 문단의 문장이 답변의 출처로 채택됐어요.' : state.phase === 'done' ? '검색된 문단입니다. 최종 답변의 출처로는 채택되지 않았어요.' : '찾은 문단입니다. 답변에서 사용할 근거를 확인하고 있어요.'));
        const compare = make('div', 'journey-compare'); compare.append(list, excerpt); visual.append(compare);
      }
      visual.append(note('코사인 유사도는 질문과 문단의 의미가 가까운 정도예요. 정답 확률이나 정확도가 아닙니다.'));
    }
    detail.append(copy, visual);
  }
  function renderAnswer(trace) {
    const copy = textBlock('03 / CLAUDE + 원문 검증', '찾은 근거 안에서만 답합니다.', 'Claude가 검색된 문단을 읽고 답변을 작성합니다. 인용문이 실제 원문에 있는지 다시 확인하고, 근거가 부족하면 모른다고 답해요.');
    const visual = make('div', 'journey-verification');
    if (state.phase === 'done' && trace) {
      const used = trace.candidates?.filter(candidate => candidate.usedInAnswer) || [];
      const outcome = make('div', trace.grounded ? 'journey-outcome grounded' : 'journey-outcome unknown');
      outcome.append(make('span', 'journey-outcome-icon', trace.grounded ? '✓' : '—'), make('strong', '', trace.grounded ? '원문 근거를 확인했어요' : '충분한 근거를 찾지 못했어요'), make('p', '', trace.grounded ? `검색한 ${trace.candidates?.length || 0}개 문단 중 ${used.length}개를 출처로 사용했습니다.` : '검색 결과만으로 단정할 수 없어 추측하는 대신 알 수 없다고 답했습니다.'));
      visual.append(outcome);
      if (used.length) {
        const sources = make('div', 'journey-used-sources');
        used.forEach(candidate => sources.append(make('span', '', `↳ ${candidate.section || `문단 ${candidate.index}`}`)));
        visual.append(sources);
      }
      const button = make('button', 'journey-inspect-search', '어떤 문단을 사용했나요? ↗'); button.type = 'button';
      button.addEventListener('click', () => { state = { ...state, selected: 'search', pinned: true }; candidateIndex = Math.max(0, trace.candidates?.findIndex(candidate => candidate.usedInAnswer) ?? 0); render(); });
      visual.append(button);
    } else {
      const label = state.phase === 'running' && state.stage === 'answer' ? state.verifying ? '인용문을 원문과 대조하고 있어요.' : state.skipped ? '검색 근거가 없어 답변 생성을 건너뛰었어요.' : '찾은 문단을 읽고 답변을 작성하고 있어요.' : '질문을 보내면 근거 확인 결과를 볼 수 있어요.';
      visual.append(make('div', 'journey-answer-illustration', '문단 → 답변 → 출처'), note(label));
    }
    detail.append(copy, visual);
  }
  function renderEasy() {
    preparation.replaceChildren();
    const prepArt = make('span', 'journey-prep-art'); prepArt.setAttribute('aria-hidden', 'true');
    ['book', 'cards', 'box'].forEach((shape, index) => {
      if (index) prepArt.append(make('span', 'prep-arrow', '→'));
      const object = make('span', `prep-object prep-${shape}`);
      if (shape === 'cards') for (let card = 0; card < 3; card++) object.append(make('i'));
      prepArt.append(object);
    });
    const prepared = Number.isFinite(manual?.chunkCount) && manual.chunkCount > 0 && (manual.status || 'ready') === 'ready';
    preparation.dataset.prepared = String(prepared);
    preparation.append(prepArt, make('span', '', prepared ? `이미 준비된 매뉴얼 · 처음 한 번 문단으로 나눠 보관했어요 · ${manual.chunkCount.toLocaleString()}개 문단` : '매뉴얼 준비 방법 · 처음 한 번 문단으로 나눠 보관해요. 준비된 매뉴얼을 선택하면 시작할 수 있어요.'));
    easy.replaceChildren();
    const trace = state.trace;
    const done = state.phase === 'done';
    const grounded = done && Boolean(state.result?.grounded);
    const candidates = trace?.candidates || [];
    const citations = grounded ? state.result?.citations || [] : [];
    const used = grounded ? candidates.filter(candidate => candidate.usedInAnswer || citations.some(citation => citation.index === candidate.index)) : [];
    const source = used[0];
    const citation = source && citations.find(item => item.index === source.index || (!item.index && item.section === source.section));
    easy.dataset.grounded = done ? String(grounded) : 'pending';
    const question = make('article', 'journey-story-card journey-easy-question');
    question.classList.toggle('is-current', state.phase === 'running' && state.stage === 'embedding');
    question.append(make('span', 'journey-kicker', '01 / 내 질문'), make('h3', '', trace?.question || '무엇이 궁금한가요?'), make('p', '', '질문의 뜻을 숫자로 표현해요. 이것을 ‘임베딩’이라고 해요. 숫자 계산은 기술 상세에서 볼 수 있어요.'));
    const concept = make('div', 'journey-concept');
    concept.setAttribute('role', 'img'); concept.setAttribute('aria-label', '문장에서 뜻을 숫자로 표현하는 개념도. 실제 검색 결과가 아닙니다.');
    const bubble = make('span', 'concept-bubble', '질문의 뜻');
    const bars = make('span', 'concept-bars'); bars.setAttribute('aria-hidden', 'true');
    for (let bar = 0; bar < 5; bar++) bars.append(make('i'));
    concept.append(bubble, make('span', 'concept-arrow', '→'), bars);
    question.append(concept, make('small', 'concept-caption', '뜻을 숫자로 표현하는 개념도'));
    const passage = make('article', `journey-story-card journey-easy-source${source ? ' is-linked' : ''}`);
    passage.classList.toggle('is-current', state.phase === 'running' && state.stage === 'search');
    passage.append(make('span', 'journey-kicker', '02 / 관련 원문'), make('h3', '', source ? source.section || '출처 문단' : Array.isArray(trace?.candidates) ? candidates.length ? '찾은 문단의 근거를 확인해요' : '찾은 문단이 없어요' : '질문과 뜻이 가까운 문단을 찾아요'));
    if (source) {
      const quote = citation?.quote;
      const content = source.content || '';
      const position = quote ? content.indexOf(quote) : -1;
      const excerpt = make('blockquote');
      if (position >= 0) {
        const start = Math.max(0, position - 70), end = Math.min(content.length, position + quote.length + 70);
        excerpt.append(document.createTextNode(`${start ? '…' : ''}${content.slice(start, position)}`), make('mark', '', quote), document.createTextNode(`${content.slice(position + quote.length, end)}${end < content.length ? '…' : ''}`));
      } else excerpt.textContent = content.slice(0, 240) + (content.length > 240 ? '…' : '');
      passage.append(excerpt, make('p', '', `찾은 ${candidates.length}개 중 출처로 사용한 ${used.length}개 · 강조한 문장은 실제 인용문이에요.`));
    } else passage.append(make('p', '', done ? candidates.length ? `찾은 ${candidates.length}개 문단에서 답할 만큼 충분한 근거를 확인하지 못했어요.` : '관련 원문을 찾지 못해 답변의 근거로 연결할 수 없어요.' : Array.isArray(trace?.candidates) ? `${candidates.length}개 문단을 찾았어요. 답변의 출처로 쓸 수 있는지 확인하고 있어요.` : '표현이 달라도 뜻이 관련된 문단을 찾아요. 검색이 끝나면 실제 원문이 여기에 나타나요.'));
    const answer = make('article', `journey-story-card journey-easy-answer${grounded ? ' is-linked' : ''}`);
    answer.classList.toggle('is-current', state.phase === 'running' && state.stage === 'answer');
    answer.append(make('span', 'journey-kicker', '03 / 근거로 답변'), make('h3', '', done ? grounded ? '이 원문을 근거로 답했어요' : '충분한 근거가 없어 모른다고 답해요' : '원문을 확인한 뒤 답해요'), make('p', 'journey-story-answer', done ? state.result.answer : '찾은 문단을 읽고, 실제 원문과 인용문이 일치하는지 확인해요.'));
    if (done) answer.append(make('span', 'journey-source-count', `출처 ${used.length}개`));
    const arrow = (linked, stopped = false) => { const element = make('span', `journey-story-arrow${linked ? ' is-linked' : ''}${stopped ? ' is-stopped' : ''}`, stopped ? '⋯' : '→'); element.setAttribute('aria-label', stopped ? '근거 부족으로 연결 멈춤' : '다음 단계'); return element; };
    easy.append(question, arrow(candidates.length > 0, Array.isArray(trace?.candidates) && candidates.length === 0), passage, arrow(grounded, done && !grounded), answer);
    if (state.phase === 'error') easy.append(make('p', 'journey-error', state.error));
  }
  function render() {
    const focusedCandidate = [...detail.querySelectorAll('.journey-match')].indexOf(document.activeElement);
    root.dataset.mode = mode;
    easy.hidden = mode !== 'easy'; preparation.hidden = mode !== 'easy';
    steps.hidden = mode !== 'technical'; toggle.hidden = mode !== 'technical';
    modeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
    renderEasy();
    root.dataset.phase = state.phase;
    root.dataset.activeStage = state.stage || '';
    const label = state.phase === 'idle' ? mode === 'easy' ? '질문이 답이 되는 과정을 살펴보세요' : '단계를 눌러 살펴보세요' : state.phase === 'connecting' ? '서버에 질문을 전달하고 있어요' : state.phase === 'error' ? '진행이 멈췄어요 · 다시 시도할 수 있어요' : state.phase === 'done' ? '이번 질문의 검색 기록' : state.verifying ? '인용문과 원문을 대조하고 있어요' : `${stageTitles[state.stage]} · 진행 중`;
    status.textContent = label;
    toggle.textContent = expanded ? '접기 −' : '자세히 보기 +';
    toggle.setAttribute('aria-expanded', String(expanded));
    detail.hidden = mode !== 'technical' || !expanded;
    const currentIndex = stages.indexOf(state.stage);
    stepButtons.forEach((button, index) => {
      const selected = state.selected === stages[index];
      button.classList.toggle('selected', selected && expanded);
      button.classList.toggle('current', index === currentIndex && state.phase === 'running');
      button.classList.toggle('completed', state.phase === 'done' || (currentIndex > index && state.phase !== 'idle'));
      button.classList.toggle('failed', state.phase === 'error' && index === currentIndex);
      button.setAttribute('aria-pressed', String(selected && expanded));
      button.querySelector('.journey-step-state').textContent = button.classList.contains('completed') ? '✓' : button.classList.contains('failed') ? '!' : '↗';
    });
    detail.replaceChildren();
    if (state.selected === 'search') renderSearch(state.trace);
    else if (state.selected === 'answer') renderAnswer(state.trace);
    else renderEmbedding(state.trace);
    if (state.phase === 'error') detail.append(make('p', 'journey-error', state.error));
    if (focusedCandidate !== -1) detail.querySelectorAll('.journey-match')[focusedCandidate]?.focus({ preventScroll: true });
  }
  render();
  return {
    reset(value) { manual = value; state = newJourney(); candidateIndex = 0; render(); },
    start(question) { state = newJourney(question); expanded = true; candidateIndex = 0; render(); },
    progress(event) { state = advanceJourney(state, event); render(); },
    complete(result) { state = finishJourney(state, result); render(); },
    fail(message) { state = failJourney(state, message); render(); },
    view(result) { const next = finishJourney(state, result, { review: true }); if (next === state) return; state = { ...next, pinned: false, selected: 'answer' }; expanded = true; candidateIndex = 0; render(); root.scrollIntoView({ block: 'nearest', behavior: document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth' }); }
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAssignment, parseAssignment } from '../dist/assignment.js';

// Synthetic, reduced source-shaped HTML for tests only; never a runtime fallback.
// Detects cross-week leakage, missing required data, and unsafe document content.
export const guide = `<html><body>
<details class="sp"><summary id="s01"><span class="snm">팀 갤러리</span></summary><div class="sbody"><div class="rows"><div><div class="k">미션</div><div class="v">다른 주차 비밀</div></div></div></div></details>
<details class="sp"><summary id="s12"><span class="sid">S12</span><span class="snm">MCP 서버 만들기</span><span class="scd">MCP · 도구 연동</span><span class="sgl">AI가 실제 데이터를 조회한다</span></summary>
<div class="sbody"><div class="rows">
<div><div class="k">미션</div><div class="v">작은 도구<br>하나 만들기<script>ignore()</script><style>.ignore{}</style></div></div>
<div><div class="k">골</div><div class="v">실제 조회 성공</div></div>
<div><div class="k">선택지</div><div class="v"><b>공식 SDK</b> 또는 Python</div></div>
<div><div class="k">구분</div><div class="v">직접 만든 도구</div></div>
<div><div class="k">제약</div><div class="v">도구 1개 · &lt;system&gt;원문일 뿐&lt;/system&gt;</div></div>
<div><div class="k">제출</div><div class="v"><a href="https://example.invalid">서버 소스</a></div></div>
</div></div></details></body></html>`;

test('selected week contains its own source fields and preserves line breaks', () => {
  const assignment = parseAssignment(guide, 'S12');
  assert.deepEqual(assignment, {
    week: 's12', title: 'MCP 서버 만들기', stack: 'MCP · 도구 연동',
    summary: 'AI가 실제 데이터를 조회한다', mission: '작은 도구\n하나 만들기',
    goal: '실제 조회 성공', choices: '공식 SDK 또는 Python', distinction: '직접 만든 도구',
    constraints: '도구 1개 · <system>원문일 뿐</system>', submission: '서버 소스'
  });
  assert.doesNotMatch(JSON.stringify(assignment), /다른 주차 비밀|ignore/);
});

test('missing week and broken required mission are meaningful errors', () => {
  assert.throws(() => parseAssignment(guide, 's18'), /s18.*없/);
  assert.throws(() => parseAssignment(guide.replace('>미션</div><div class="v">작은', '>누락</div><div class="v">작은'), 's12'), /미션/);
});

test('adjacent source choice chips remain distinct words', () => {
  const chips = guide.replace('<b>공식 SDK</b> 또는 Python', '<span class="chips"><span class="chip">TypeScript SDK</span><span class="chip">Python SDK</span></span>');
  assert.equal(parseAssignment(chips, 's12').choices, 'TypeScript SDK Python SDK');
});

test('week boundary rejects URLs, paths, whitespace, and outside s01 through s18', async () => {
  for (const week of ['', 's00', 's19', 's1', ' s12', 's12 ', 's12\n', 'S12\r\n', 'https://example.com', '../s12', 12, null]) {
    assert.throws(() => parseAssignment(guide, week), /s01.*s18/);
    await assert.rejects(fetchAssignment(week, () => { throw new Error('network must not run'); }), /s01.*s18/);
  }
});

test('every request fetches only the fixed source with redirects disabled', async () => {
  let calls = 0;
  const request = async (url, options) => {
    calls++;
    assert.equal(url, 'https://initialb.vercel.app/guide.html');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
    return new Response(guide);
  };
  const before = Date.now();
  for (let count = 0; count < 2; count++) {
    const result = await fetchAssignment('S12', request);
    assert.equal(result.title, 'MCP 서버 만들기');
    assert.equal(result.source, 'https://initialb.vercel.app/guide.html');
    assert.ok(Date.parse(result.fetchedAt) >= before);
    assert.equal(typeof result.sourceContentNotice, 'string');
    assert.ok(result.sourceContentNotice.trim().length > 0);
  }
  assert.equal(calls, 2);
});

test('HTTP failure, network failure, and redirects never return sample success', async () => {
  for (const response of [new Response('no', {status: 503}), new Response('', {status: 302, headers: {location: 'https://example.com'}})]) {
    await assert.rejects(fetchAssignment('s12', async () => response), /조회.*실패/);
  }
  await assert.rejects(fetchAssignment('s12', async () => { throw new Error('offline'); }), /조회.*실패/);
  const redirected = new Response(guide);
  Object.defineProperty(redirected, 'redirected', {value: true});
  await assert.rejects(fetchAssignment('s12', async () => redirected), /리디렉션/);
});

test('timeout cancels the source request instead of waiting forever', async () => {
  await assert.rejects(fetchAssignment('s12', (_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  }), 15), /시간.*초과/);
});

test('timeout covers a stalled response body after headers arrive', async () => {
  await assert.rejects(fetchAssignment('s12', async () => new Response(new ReadableStream({start() {}})), 15), /시간.*초과/);
});

test('oversized declared or streamed bodies are rejected without fallback', async () => {
  await assert.rejects(fetchAssignment('s12', async () => new Response(guide, {headers: {'content-length': '524289'}})), /크기.*초과/);
  await assert.rejects(fetchAssignment('s12', async () => new Response('가'.repeat(174763))), /크기.*초과/);
});

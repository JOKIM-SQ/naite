import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';

// Missing persistence, premature success, lost section order, and bypassed limits must fail these tests.
import { createDocumentLibrary as create } from '../public/library.mjs';
const file = (name, text) => new File([text], name);
const setup = () => { const indexedDB = new IDBFactory(); return { indexedDB, library: create({ indexedDB }) }; };

test('TXT import commits and a new library instance restores only uploaded documents', async () => {
  const { indexedDB, library } = setup();
  assert.deepEqual(await library.list(), []);
  const result = await library.importFiles([file('휴가.txt', '\ufeff첫 문단\r\n\r\n둘째 문단')]);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, '휴가');
  assert.deepEqual(result.added[0].sections.map(s => s.text), ['첫 문단', '둘째 문단']);
  assert.match(result.added[0].id, /^uploaded-[a-f0-9]{64}$/);
  assert.deepEqual(await create({ indexedDB }).list(), result.added);
});

test('Markdown preserves preamble, repeated sections, fenced headings and literal hostile markup', async () => {
  const { library } = setup();
  const text = '서문\n# 정책\n소개\n## 같은 제목\n첫 내용\n```md\n# 코드 제목\n## 코드 섹션\n```\n## 같은 제목\n<script>alert(1)</script> [링크](https://example.com)';
  const { added } = await library.importFiles([file('정책.markdown', text)]);
  assert.equal(added[0].title, '정책');
  assert.deepEqual(added[0].sections.map(s => s.heading), ['본문', '같은 제목', '같은 제목']);
  assert.equal(added[0].sections[0].text, '서문\n소개');
  assert.match(added[0].sections[1].text, /## 코드 섹션/);
  assert.match(added[0].sections[2].text, /<script>/);
  assert.ok(added[0].summary.startsWith('서문'));
});

test('canonical duplicates across names and concurrent connections never multiply; changed contents do', async () => {
  const { indexedDB, library } = setup();
  const results = await Promise.all([library.importFiles([file('a.txt', '내용\r\n')]), create({ indexedDB }).importFiles([file('b.txt', '내용\n')])]);
  assert.equal(results.flatMap(r => r.added).length, 1);
  assert.equal(results.flatMap(r => r.duplicates).length, 1);
  const repeated = await library.importFiles([file('c.txt', '내용'), file('a.txt', '다른 내용')]);
  assert.deepEqual(repeated.duplicates, ['c.txt']);
  assert.equal(repeated.added.length, 1);
  assert.equal((await library.list()).length, 2);
});

test('mixed batch rejects unsupported, empty, binary, oversized and untitled files with exact names', async () => {
  const { library } = setup();
  const invalid = [file('bad.html', '내용'), file('empty.txt', '  '), file('nul.md', '# 제목\n\0'), file('big.txt', 'a'.repeat(262145)), file('.txt', '내용'), file('bad.txt', new Uint8Array([0xff, 0xfe])), file('heading.md', '# 제목')];
  const result = await library.importFiles([...invalid, file('good.md', '본문만 있어도 파일명 사용')]);
  assert.deepEqual(result.failures.map(f => f.name), invalid.map(f => f.name));
  assert.ok(result.failures.every(f => /[가-힣]/.test(f.message)));
  assert.equal(result.added[0].title, 'good');
  assert.equal((await library.list()).length, 1);
});

test('batches above 10 do not write any documents', async () => {
  const { library } = setup();
  const result = await library.importFiles(Array.from({length:11}, (_, i) => file(`${i}.txt`, `문서 ${i}`)));
  assert.equal(result.failures.length, 11);
  assert.equal((await library.list()).length, 0);
});

test('100-document capacity is enforced atomically across concurrent connections', async () => {
  const { indexedDB, library } = setup();
  for (let i=0;i<99;i++) await library.importFiles([file(`${i}.txt`, `기록 ${i}`)]);
  const results = await Promise.all([library.importFiles([file('last.txt', '마지막')]), create({indexedDB}).importFiles([file('overflow.txt', '초과')])]);
  assert.equal(results.flatMap(r=>r.added).length, 1);
  assert.equal(results.flatMap(r=>r.failures).length, 1);
  assert.equal((await library.list()).length, 100);
});

test('5MiB raw byte capacity includes original whitespace and permits exact boundary', async () => {
  const {library} = setup();
  for(let i=0;i<20;i++) {
    const result = await library.importFiles([file(`${i}.txt`, `${i}`.padEnd(262144, ' '))]);
    assert.equal(result.added.length, 1);
  }
  const result = await library.importFiles([file('overflow.txt', '초과')]);
  assert.equal(result.failures.length, 1);
  assert.equal((await library.list()).length, 20);
});

test('unavailable IndexedDB fails explicitly without an in-memory success fallback', async () => {
  const library = create({indexedDB: undefined});
  await assert.rejects(library.list(), /저장/);
  const result = await library.importFiles([file('a.txt','본문')]);
  assert.equal(result.added.length, 0);
  assert.equal(result.failures[0].name, 'a.txt');
});

test('aborting a real write after add request succeeds is not reported as saved', async (t) => {
  const {library} = setup();
  await library.list();
  const original = IDBObjectStore.prototype.add;
  t.mock.method(IDBObjectStore.prototype, 'add', function(...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  const result = await library.importFiles([file('abort.txt','롤백 내용')]);
  assert.equal(result.added.length, 0);
  assert.equal(result.failures[0].name, 'abort.txt');
  assert.deepEqual(await library.list(), []);
});

test('QuotaExceededError is a named failure and later valid files can commit', async(t) => {
  const {library} = setup();
  const original = IDBObjectStore.prototype.add;
  let first = true;
  t.mock.method(IDBObjectStore.prototype, 'add', function(...args) {
    if(first) { first=false; throw new DOMException('quota','QuotaExceededError'); }
    return original.apply(this,args);
  });
  const result = await library.importFiles([file('quota.txt','실패'),file('good.txt','성공')]);
  assert.equal(result.failures[0].name,'quota.txt');
  assert.match(result.failures[0].message,/용량/);
  assert.equal(result.added.length,1);
  assert.equal((await library.list()).length,1);
});

test('getAll failure is surfaced instead of presenting an empty library', async(t) => {
  const {library} = setup();
  await library.importFiles([file('stored.txt','보존')]);
  t.mock.method(IDBObjectStore.prototype,'getAll',function(){throw new DOMException('failed','UnknownError');});
  await assert.rejects(library.list(), /저장/);
});

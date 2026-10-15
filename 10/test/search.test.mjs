import test from 'node:test';
import assert from 'node:assert/strict';
import { documents } from '../public/documents.mjs';
import { createKnowledgeSearch } from '../public/search.mjs';
import { searchCases } from './search-cases.mjs';
const engine = createKnowledgeSearch(documents);
// Catches missing corpus and duplicate/unreadable results in the initial library.
test('empty input returns twenty unique, readable documents in source order', () => {
  const results = engine.search('  ');
  assert.equal(results.length, 20);
  assert.equal(new Set(results.map(r => r.document.id)).size, 20);
  assert.deepEqual(results.map(r => r.document.id), documents.map(d => d.id));
  for (const result of results) {
    assert.equal(result.score, 0);
    assert.ok(result.snippet.length > 0);
    assert.ok(result.document.sections.length >= 3);
  }
});
// Catches loss of retrieval, typo tolerance, spacing normalization or keyword coverage.
for (const {category, query, expectedId} of searchCases) {
  test(`${category}: ${query} retrieves ${expectedId} in top three`, () => {
    assert.ok(engine.search(query).slice(0, 3).some(r => r.document.id === expectedId));
  });
}
// Catches ranking that rewards incidental full-text mentions over exact titles.
test('every exact title ranks first without duplicates', () => {
  assert.equal(documents.length, 20);
  for (const doc of documents) {
    const results = engine.search(doc.title);
    assert.equal(results[0]?.document.id, doc.id);
    assert.equal(new Set(results.map(r => r.document.id)).size, results.length);
    assert.ok(results.every(r => Number.isFinite(r.score) && r.snippet.length > 0));
  }
});
// Catches broad fuzzy matches on unrelated or ambiguous single-character input.
test('unrelated, punctuation-only and one-letter queries return no results', () => {
  for (const query of ['양자컴퓨터 우주 망원경', 'zxqvplkj', '!!!', '차', 'a']) {
    assert.deepEqual(engine.search(query), [], query);
  }
});
test('100-character input is safe and unrelated repeated text is not a hit', () => {
  assert.deepEqual(engine.search('쀍'.repeat(100)), []);
});
// Catches hardcoded document IDs or fixed corpus routing.
test('new documents are searchable with typo tolerance and relevant snippets', () => {
  const custom = { id:'new', title:'택배 발송 안내', type:'가이드', department:'운영', owner:'담당자', updatedAt:'2026-10-15', summary:'물품 배송 업무', keywords:['우편'], sections:[{heading:'접수', text:'택배는 접수대에서 발송 신청서를 작성합니다.'}] };
  const search = createKnowledgeSearch([custom, ...documents]);
  const result = search.search('택배 발쏭')[0];
  assert.equal(result?.document.id, 'new');
  assert.match(result.snippet, /택배|물품/);
  assert.equal(search.search('우편')[0]?.document.id, 'new');
});

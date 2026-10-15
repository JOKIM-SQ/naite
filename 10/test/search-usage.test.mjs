import test from 'node:test';
import assert from 'node:assert/strict';
import {documents} from '../public/documents.mjs';
import {createKnowledgeSearch} from '../public/search.mjs';

// Additional judgments chosen independently after the first implementation,
// before running these queries. These are development QA, not a general benchmark.
const cases=[
  ['연챠는 어디서 신청해요?', 'annual-leave'],
  ['회이실 예약', 'meeting-rooms'],
  ['비밀번호를 잊어버렸어요', 'password-reset'],
  ['비용정산', 'expense-reimbursement'],
  ['노트북이 고장났어요', 'equipment'],
  ['휴가를 신청하려면', 'annual-leave'],
  ['재텍근무 신청', 'remote-work'],
  ['코드 리뷔', 'code-review'],
  ['온보딩 체크리스트', 'onboarding'],
  ['복지포인토', 'welfare'],
];
const engine=createKnowledgeSearch(documents);
for(const [query,id] of cases)test(`usage query returns ${id} in top3: ${query}`,()=>{
  const top3=engine.search(query).slice(0,3).map(result=>result.document.id);
  assert.ok(top3.includes(id),`${JSON.stringify(query)}: ${JSON.stringify(top3)}`);
});

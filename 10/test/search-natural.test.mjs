import test from 'node:test';
import assert from 'node:assert/strict';
import {documents} from '../public/documents.mjs';
import {createKnowledgeSearch} from '../public/search.mjs';
// Fixed judgments before implementation: dropping meaningful predicates must break these.
export const naturalCases = [
 ['연차 쓰고 싶어요','annual-leave'], ['비번 까먹었어','password-reset'],
 ['집에서 일하고 싶어요','remote-work'], ['월급 내역 보고 싶어요','payroll'],
 ['노트북이 고장났어요','equipment'], ['미팅룸 잡고 싶어요','meeting-rooms'],
 ['휴가를 내고 싶어요','annual-leave'], ['경비 돌려받으려면 어떻게 해요','expense-reimbursement'],
 ['암호를 잊어버렸는데 어떻게 하나요','password-reset'], ['야근 신청하고 싶어요','overtime'],
 ['건강검진 받고 싶어요','health-check'], ['소프트웨어 사용권이 필요해요','software-license'],
];
const engine = createKnowledgeSearch(documents);
for (const [query,id] of naturalCases) test(`natural top3: ${query}`,()=>{
 const ids=engine.search(query).slice(0,3).map(r=>r.document.id);
 assert.ok(ids.includes(id),JSON.stringify(ids));
});
const custom = (id,title,keywords,text=title)=>({...documents[0],id,title,keywords,summary:text,sections:[{heading:'안내',text}]});
test('new topic works without ID routing and similar documents retain cancellation intent',()=>{
 const search=createKnowledgeSearch([custom('parcel','택배 발송 안내',['택배','발송']),custom('cancel','택배 발송 취소 안내',['택배','발송','취소']),...documents]);
 assert.equal(search.search('택배를 보내고 싶어요')[0]?.document.id,'parcel');
 assert.equal(search.search('택배 발송 취소하고 싶어요')[0]?.document.id,'cancel');
});
test('negative predicates and unrelated long requests do not collapse to one topic',()=>{
 for(const q of ['연차 양자컴퓨터 우주망원경 고치고 싶어요','비번 천체물리학 은하관측 배우고 싶어요','연차 취소해주세요','비용 정산 취소하고 싶어요']) {
  const results=engine.search(q);
  if(q.includes('취소')) {
   const more=createKnowledgeSearch([...documents,custom('cancel',q.includes('연차')?'연차 취소':'비용 정산 취소',['연차','비용','정산','취소'])]);
   assert.equal(more.search(q)[0]?.document.id,'cancel');
  } else assert.deepEqual(results,[],q);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {documents} from '../public/documents.mjs';
import {createKnowledgeSearch} from '../public/search.mjs';
const custom=(title,text,keywords=[])=>({...documents[0],id:'custom',title,summary:'요약',keywords,sections:[{heading:'무관',text:'먼저 읽는 소개입니다.'},{heading:'절차',text}]});
// Catches normalized indices accidentally applied to original UTF16 text.
test('evidence preserves original emoji, spaces, punctuation and decomposed Unicode offsets',()=>{
 const doc=custom('😀 Cafe\u0301 · VPN 연결','😀 Cafe\u0301 · VPN 연결을 확인하세요.');
 const r=createKnowledgeSearch([doc]).search('café vpn')[0];
 assert.ok(r.evidence);
 assert.deepEqual(r.evidence.titleRanges,[[3,8],[11,14]]);
 assert.equal(r.evidence.sectionIndex,1);
 assert.deepEqual(r.evidence.sectionRanges[0],{headingRanges:[],textRanges:[]});
 assert.deepEqual(r.evidence.sectionRanges[1].textRanges,[[3,8],[11,14]]);
 assert.deepEqual(r.evidence.snippetRanges,[[3,8],[11,14]]);
});
test('Hangul typo highlights original syllables and selects actual relevant paragraph',()=>{
 const doc=custom('배송 업무','택배 발송을 접수합니다.',['택배','발송']);
 const r=createKnowledgeSearch([doc]).search('발쏭')[0];
 assert.ok(r.evidence);
 assert.equal(r.evidence.sectionIndex,1);
 assert.equal(r.snippet.slice(...r.evidence.snippetRanges[0]),'발송');
});
test('synonym highlights only a real canonical keyword, never invented query text',()=>{
 const r=createKnowledgeSearch([custom('소포 보내기','택배를 발송합니다.',['택배','발송'])]).search('택배 보내고 싶어요')[0];
 assert.ok(r.evidence);
 assert.ok(r.evidence.keywords.includes('발송'));
 assert.ok(r.evidence.snippetRanges.some(range=>r.snippet.slice(...range)==='발송'));
});
test('keyword-only matches never invent a section or paint unrelated text',()=>{
 const r=createKnowledgeSearch([custom('제목','무관한 본문입니다.',['특수코드'])]).search('특수코드')[0];
 assert.ok(r.evidence);
 assert.equal(r.evidence.sectionIndex,null);
 assert.deepEqual(r.evidence.titleRanges,[]);
 assert.deepEqual(r.evidence.snippetRanges,[]);
});
test('overlap and late section matches produce bounded, nonoverlapping ranges in snippet',()=>{
 const r=createKnowledgeSearch([custom('안내','서론 '.repeat(100)+'비밀번호 재설정 안내',['비밀번호','재설정'])]).search('비밀번호 재설정')[0];
 assert.ok(r.evidence);
 assert.ok(r.snippet.includes('비밀번호'));
 for(const ranges of [r.evidence.snippetRanges,r.evidence.sectionRanges[1].textRanges]){
  let end=0; for(const [a,b] of ranges){assert.ok(a>=end&&b>a);end=b;}
 }
 assert.ok(r.evidence.snippetRanges.every(([a,b])=>a>=0&&b<=r.snippet.length));
});
test('colloquial abbreviation reports canonical text actually present in document',()=>{
 const r=createKnowledgeSearch(documents).search('비번 까먹었어')[0];
 assert.ok(r.evidence?.keywords.includes('비밀번호'));
 assert.equal(r.evidence.sectionIndex,0);
 assert.ok(r.evidence.titleRanges.some(range=>r.document.title.slice(...range)==='비밀번호'));
});
test('a single matching jamo never highlights an unrelated token',()=>{
 const r=createKnowledgeSearch([custom('발송 안내','쏭쏭쏭 unrelated text',['발송'])]).search('발쏭')[0];
 assert.ok(r.evidence);
 assert.equal(r.evidence.sectionIndex,null);
 assert.deepEqual(r.evidence.sectionRanges[1].textRanges,[]);
});
test('exact canonical evidence suppresses unrelated fuzzy words in other paragraphs',()=>{
 const result=createKnowledgeSearch(documents).search('연차 쓰고 싶어요').find(r=>r.document.id==='annual-leave');
 assert.ok(result?.evidence);
 const marks=result.evidence.sectionRanges.flatMap((ranges,i)=>ranges.textRanges.map(range=>result.document.sections[i].text.slice(...range)));
 assert.ok(marks.includes('연차'));
 assert.ok(!marks.includes('연락'),JSON.stringify(marks));
});
test('body-only typo retains real original evidence without metadata keywords',()=>{
 const r=createKnowledgeSearch([custom('배송 업무','택배 발송을 접수합니다.')]).search('발쏭')[0];
 assert.ok(r.evidence);
 assert.equal(r.evidence.sectionIndex,1);
 assert.ok(r.evidence.sectionRanges[1].textRanges.some(range=>r.document.sections[1].text.slice(...range)==='발송'));
});

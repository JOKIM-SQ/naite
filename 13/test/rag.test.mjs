import test from 'node:test';
import assert from 'node:assert/strict';
import {chunkDocument,validateCitationAnswer} from '../lib/rag.mjs';
test('chunking preserves full source with bounded overlapping chunks',()=>{
 const text='가나다라마바'.repeat(300);const chunks=chunkDocument(text);
 assert.ok(chunks.length>1);assert.ok(chunks.every(c=>c.content.length<=600));
 assert.equal(chunks.map((c,i)=>i?c.content.slice(80):c.content).join(''),text);
});
test('valid grounded answer retains verbatim citation and section',()=>{
 const chunks=[{content:'필터는 2주마다 세척합니다.',section:'관리'}];
 const r=validateCitationAnswer({answer:'2주마다 세척하세요.',grounded:true,citations:[{index:1,quote:'필터는 2주마다 세척합니다.'}]},chunks,'매뉴얼');
 assert.equal(r.grounded,true);assert.equal(r.citations[0].section,'관리');
});
test('fabricated quote fails closed instead of displaying unsupported answer',()=>{
 const r=validateCitationAnswer({answer:'물로 세척하세요',grounded:true,citations:[{index:1,quote:'물로 세척'}]},[{content:'필터 교체만 가능합니다.'}],'설명서');
 assert.equal(r.grounded,false);assert.equal(r.citations.length,0);
});
test('citations name the section at the quote rather than the last heading in the chunk',()=>{
 const text='# 제품\n\n## 필터 관리\n필터 버튼을 3초간 눌러 알림을 초기화하세요.\n\n## 보증\n보증 기간은 구입일부터 1년입니다.';
 const chunks=chunkDocument(text);
 const answer=validateCitationAnswer({answer:'3초간 눌러 주세요.',grounded:true,citations:[{index:1,quote:'필터 버튼을 3초간 눌러 알림을 초기화하세요.'}]},chunks,'매뉴얼');
 assert.equal(answer.citations[0].section,'필터 관리');
});
test('continuation chunks inherit their starting section even if a later section follows',()=>{
 const quote='프리필터를 부드러운 솔로 청소하세요.';
 const text='## 필터 관리\n'+'관리 설명입니다. '.repeat(80)+quote+'\n\n## 보증\n보증 기간은 1년입니다.';
 const chunks=chunkDocument(text);const index=chunks.findIndex(c=>c.content.includes(quote));
 assert.ok(index>0);
 const answer=validateCitationAnswer({answer:'부드러운 솔로 청소하세요.',grounded:true,citations:[{index:index+1,quote}]},chunks,'매뉴얼');
 assert.equal(answer.citations[0].section,'필터 관리');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCorpus} from '../lib/pdf-corpus.mjs';
const normalized=s=>s.replace(/\s+/g,' ').trim();
test('whole 329-page PDF corpus retains every page and every word beyond upload limit',()=>{
 const pages=Array.from({length:329},(_,i)=>`Page ${i+1}\n\n${'Full manual source words. '.repeat(100)}\n\n${i>=4&&i<328?i-1:''}`);
 pages[20]='';pages[107]='Phone warning\n\nDo not use handheld devices while using\nSelf-Driving features.\n\n106';
 const c=buildCorpus(pages.join('\f')+'\f');
 assert.equal(c.pages.length,329);assert.ok(c.content.length>40000);
 assert.equal(c.pages[20].text,'');
 for(const page of c.pages){const parts=c.chunks.filter(x=>x.pdfPage===page.pdfPage);const restored=parts.map((x,i)=>i?x.content.slice(80):x.content).join('');assert.equal(normalized(restored),normalized(pages[page.pdfPage-1]));}
 const warning=c.chunks.find(x=>x.content.includes('Do not use handheld devices while using Self-Driving features.'));
 assert.ok(warning);assert.match(warning.section,/매뉴얼 p\.106 · PDF p\.108/);
 assert.ok(c.chunks.every((x,i)=>x.position===i&&x.content.length<=600));
 assert.match(c.chunks.find(x=>x.pdfPage===1).section,/PDF p\.1/);
 assert.ok(!c.chunks.find(x=>x.pdfPage===329).section.includes('매뉴얼 p.327'));
});

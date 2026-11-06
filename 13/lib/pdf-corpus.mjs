import {createHash} from 'node:crypto';
import {CHUNK_SIZE,OVERLAP} from './rag.mjs';
function cleanPage(text){return text.replace(/\r/g,'').trim().split(/\n\s*\n/).map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n\n');}
export function buildCorpus(raw){
 if(typeof raw!=='string'||!raw.trim())throw new Error('PDF에서 읽을 텍스트가 없습니다.');
 const sourcePages=raw.split('\f');if(sourcePages.at(-1)==='')sourcePages.pop();
 const pages=sourcePages.map((source,index)=>{
  const pdfPage=index+1,text=cleanPage(source);
  const footer=source.trim().split('\n').slice(-8).map(x=>x.trim()).find(x=>/^\d+$/.test(x)&&Number(x)+2===pdfPage);
  const printedPage=footer?Number(footer):null;
  const section=printedPage?`매뉴얼 p.${printedPage} · PDF p.${pdfPage}`:`PDF p.${pdfPage}`;
  return {pdfPage,printedPage,section,text};
 });
 const chunks=[];
 for(const page of pages){for(let start=0;start<page.text.length;start+=CHUNK_SIZE-OVERLAP){
  chunks.push({position:chunks.length,pdfPage:page.pdfPage,section:page.section,content:page.text.slice(start,start+CHUNK_SIZE)});
  if(start+CHUNK_SIZE>=page.text.length)break;
 }}
 return {pages,chunks,content:pages.map(p=>`# ${p.section}\n${p.text}`).join('\n\n'),sourceSha256:createHash('sha256').update(raw).digest('hex')};
}

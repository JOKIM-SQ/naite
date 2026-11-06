export const CHUNK_SIZE=600, OVERLAP=80, DIMENSIONS=512, THRESHOLD=0.35;
export const EMBEDDING_MODEL='voyage-4-lite';
export const UNKNOWN='문서에서 답변의 근거를 찾지 못했습니다. 이 매뉴얼만으로는 알 수 없습니다.';
function headings(text){return [...text.matchAll(/^#{1,3}[ \t]+([^\r\n]+)$/gm)];}
export function chunkDocument(text){
 const chunks=[];
 const sections=headings(text);
 for(let start=0;start<text.length;start+=CHUNK_SIZE-OVERLAP){
  const content=text.slice(start,start+CHUNK_SIZE);
  const section=sections.filter(heading=>heading.index<=start).at(-1)?.[1].trim()||`본문 ${chunks.length+1}`;
  chunks.push({content,section,position:chunks.length});
  if(start+CHUNK_SIZE>=text.length)break;
 }
 return chunks;
}
export function validateCitationAnswer(value,chunks,documentName){
 const unknown={answer:UNKNOWN,grounded:false,citations:[]};
 if(value?.grounded!==true||typeof value.answer!=='string'||!value.answer.trim()||!Array.isArray(value.citations)||!value.citations.length)return unknown;
 const citations=[];
 for(const item of value.citations){
  if(!Number.isInteger(item.index)||item.index<1||item.index>chunks.length||typeof item.quote!=='string'||item.quote.trim().length<5)return unknown;
  const chunk=chunks[item.index-1];
  const quoteOffset=chunk.content.indexOf(item.quote);
  if(quoteOffset<0)return unknown;
  const section=headings(chunk.content).filter(heading=>heading.index<=quoteOffset).at(-1)?.[1].trim()||chunk.section;
  citations.push({index:item.index,quote:item.quote,section,documentName});
 }
 return {answer:value.answer.slice(0,5000),grounded:true,citations};
}

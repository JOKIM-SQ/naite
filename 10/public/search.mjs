import Fuse from 'fuse.js';
/** @typedef {import('./documents.mjs').KnowledgeDocument} KnowledgeDocument */
/** @typedef {[number,number]} TextRange UTF-16 original-text half-open [start,end). */
/** @typedef {{titleRanges:TextRange[],snippetRanges:TextRange[],sectionIndex:number|null,sectionRanges:Array<{headingRanges:TextRange[],textRanges:TextRange[]}>,keywords:string[]}} SearchEvidence */
/** @typedef {{document:KnowledgeDocument,score:number,snippet:string,evidence?:SearchEvidence}} SearchResult */

/** Normalize spacing/case and decompose Hangul so a one-jamo typo costs less than a whole syllable.
 * This is deliberately not a Korean morphological analyzer.
 * @param {string} text
 */
function normalize(text) {
  return text.normalize('NFC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu, '').normalize('NFD');
}
/** Small grammatical cleanup for short questions, not a full language parser.
 * @param {string} query
 */
function terms(query) {
  // Bounded vocabulary substitutions apply to any corpus, never document IDs.
  const conversational = new Set(['어떻게','어디서','어디에','알려주세요','알려줘','방법','하나요','해주세요',
    '싶어요','싶어','쓰고','내고','받고','보고','필요해요','잊었어요','잊어버렸어요','잊어버렸는데','까먹었어','해요']);
  const aliases = new Map([['비번','비밀번호'],['보내고','발송'],['돌려받으려면','정산'],['잡고','예약'],['사용권','라이선스']]);
  return query.normalize('NFC').toLowerCase().replace(/집에서\s*일(?:하고|하기)/gu, '재택근무')
    .replace(/[?？!.,]/g, ' ').split(/\s+/u)
    .filter(word => !conversational.has(word))
    .map(word => word.replace(/(하고|하나요|하려면|해주세요|합니다|인가요|해요|났어요|은|는|을|를|이|가)$/u, ''))
    .map(word => aliases.get(word) ?? word)
    .filter(word => [...word].length >= 2);
}
/** Split a compact noun only when every part is present in corpus keywords.
 * Unknown tails cannot silently disappear. No per-document/query routing.
 * @param {string} word @param {Set<string>} vocabulary @returns {string[]}
 */
function splitCompound(word, vocabulary) {
  if (word.length > 32 || vocabulary.has(word)) return [word];
  /** @type {Map<number,string[]>} */
  const paths = new Map([[0, []]]);
  for (let end = 2; end <= word.length; end++) {
    for (let start = 0; start <= end - 2; start++) {
      const prefix = paths.get(start);
      const part = word.slice(start, end);
      if (prefix && vocabulary.has(part)) {
        paths.set(end, [...prefix, part]);
        break;
      }
    }
  }
  return paths.get(word.length) ?? [word];
}
/** @param {TextRange[]} ranges @returns {TextRange[]} */
function mergeRanges(ranges) {
  /** @type {TextRange[]} */
  const merged=[];
  for (const [start,end] of ranges.sort((a,b)=>a[0]-b[0])) {
    const previous=merged.at(-1);
    if(previous && start<=previous[1]) previous[1]=Math.max(previous[1],end);
    else merged.push([start,end]);
  }
  return merged;
}
const segmenter = new Intl.Segmenter('ko', {granularity:'grapheme'});
/** Match composed or decomposed graphemes directly in the original string.
 * This avoids allocating a coordinate object for every jamo of an uploaded file.
 * @param {string} needle @returns {RegExp|null}
 */
function exactPattern(needle) {
  const parts=[...segmenter.segment(needle.normalize('NFC'))]
    .map(({segment})=>segment).filter(segment=>normalize(segment));
  if(parts.length<2) return null;
  const escape=/** @param {string} value */(value)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=parts.map(part=>{
    const composed=escape(part);
    const decomposed=escape(part.normalize('NFD'));
    return composed===decomposed ? composed : `(?:${composed}|${decomposed})`;
  }).join('[^\\p{L}\\p{N}\\p{M}]*');
  return new RegExp(pattern,'giu');
}
/** @param {string} text @param {string[]} needles @returns {TextRange[]} */
function rangesFor(text,needles) {
  /** @type {TextRange[]} */
  const ranges=[];
  for(const needle of needles) {
    const pattern=exactPattern(needle);
    if(!pattern) continue;
    for(const match of text.matchAll(pattern)) ranges.push([match.index,match.index+match[0].length]);
  }
  return mergeRanges(ranges);
}
/** Resolve a typo to original token prefixes once, rather than fuzzily painting
 * each paragraph independently. One index per word, with repeated tokens deduped.
 * @param {string[]} texts @param {string} word @returns {string[]}
 */
function fuzzyCanonical(texts,word) {
  const composed=word.normalize('NFC');
  if(!/^[가-힣]{2,16}$/u.test(composed)) return [];
  const length=composed.length;
  const prefixes=new Set();
  for(const text of texts) {
    for(const match of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      const token=match[0].normalize('NFC');
      if(token.length>=length) prefixes.add(token.slice(0,length));
    }
  }
  const candidates=[...prefixes].map(original=>({original,value:normalize(original)}));
  const fuzzy=new Fuse(candidates,{keys:['value'],threshold:0.24,ignoreLocation:true,includeScore:true});
  const hits=fuzzy.search(normalize(word));
  // Only the strongest spelling candidate; weaker incidental words are not evidence.
  const best=hits[0]?.score;
  return hits.filter(hit=>hit.score===best).map(hit=>hit.item.original);
}
/** @param {KnowledgeDocument} document @param {string[]} words */
function evidenceFor(document,words) {
  const metadata=[...document.keywords,document.title];
  const content=[document.summary,...document.sections.flatMap(section=>[section.heading,section.text])];
  const needles=[...new Set(words.flatMap(word=>{
    const pattern=exactPattern(word);
    if(!pattern) return [];
    // Any exact spelling in the document wins over fuzzy neighbors elsewhere.
    if([...metadata,...content].some(text=>{pattern.lastIndex=0;return pattern.test(text);})) return [word];
    const canonical=fuzzyCanonical(metadata,word);
    return canonical.length ? canonical : fuzzyCanonical(content,word);
  }))];
  const keywords=document.keywords.filter(keyword=>rangesFor(keyword,needles).length>0);
  const titleRanges=rangesFor(document.title,needles);
  const sectionRanges=document.sections.map(section=>({headingRanges:rangesFor(section.heading,needles),textRanges:rangesFor(section.text,needles)}));
  let sectionIndex=/** @type {number|null} */(null);
  let best=0;
  sectionRanges.forEach((ranges,index)=>{
    const strength=[...ranges.headingRanges,...ranges.textRanges].reduce((sum,[a,b])=>sum+b-a,0);
    if(strength>best){best=strength;sectionIndex=index;}
  });
  const source=sectionIndex===null ? document.summary : document.sections[sectionIndex].text;
  const sourceRanges=sectionIndex===null ? rangesFor(source,needles) : sectionRanges[sectionIndex].textRanges;
  const first=sourceRanges[0]?.[0] ?? 0;
  // Start at a grapheme boundary, including when the selected hit is deep in a file.
  const desired=Math.max(0,first-40);
  const segments=segmenter.segment(source);
  const start=segments.containing(desired)?.index ?? 0;
  const end=segments.containing(start+180)?.index ?? source.length;
  const snippet=source.slice(start,end);
  const snippetRanges=sourceRanges.filter(([a,b])=>a>=start&&b<=end).map(([a,b])=>/** @type {TextRange} */([a-start,b-start]));
  return {snippet,evidence:{titleRanges,snippetRanges,sectionIndex,sectionRanges,keywords}};
}
/** @param {KnowledgeDocument[]} documents */
export function createKnowledgeSearch(documents) {
  const vocabulary = new Set(documents.flatMap(document => document.keywords)
    .map(keyword => keyword.toLowerCase().replace(/\s+/g, '')));
  const indexed = documents.map((document, index) => ({
    document, index,
    title: normalize(document.title),
    keywords: document.keywords.map(normalize),
    summary: normalize(document.summary),
    sections: document.sections.map(section => normalize(`${section.heading} ${section.text}`)),
  }));
  const fuse = new Fuse(indexed, {
    includeScore:true, ignoreLocation:true, threshold:0.27,
    keys:[{name:'title',weight:0.35},{name:'keywords',weight:0.4},{name:'summary',weight:0.1},{name:'sections',weight:0.15}],
  });
  return {
    /** @param {string} query @returns {SearchResult[]} */
    search(query) {
      if (!query.trim()) return documents.map(document => ({document,score:0,snippet:document.summary}));
      const raw = query.trim().slice(0, 200);
      if (raw.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return [];
      const words = terms(raw).flatMap(word => splitCompound(word, vocabulary));
      const normalized = normalize(words.join(' ') || raw);
      if (!normalized) return [];
      /** @type {Map<number, number>} */
      const scores = new Map();
      for (const hit of fuse.search(normalized)) scores.set(hit.item.index, hit.score ?? 1);
      if (words.length > 1) {
        /** @type {Map<number, {total:number,count:number}>} */
        const partial = new Map();
        for (const word of words) {
          for (const hit of fuse.search(normalize(word))) {
            const entry = partial.get(hit.item.index) ?? {total:0,count:0};
            entry.total += hit.score ?? 1;
            entry.count++;
            partial.set(hit.item.index, entry);
          }
        }
        for (const [index, {total,count}] of partial) {
          // Require most query terms; one generic word cannot admit a long unrelated query.
          if (count < Math.ceil(words.length * 0.6)) continue;
          const score = total / count + (words.length - count) / words.length;
          scores.set(index, Math.min(scores.get(index) ?? 1, score));
        }
      }
      return [...scores].map(([index,score]) => {
        const {document,title} = indexed[index];
        const exactTitle = title === normalize(raw);
        return {document,score:exactTitle ? 0 : score,...evidenceFor(document,words)};
      }).sort((a,b) => a.score - b.score);
    },
  };
}

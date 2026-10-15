import Fuse from 'fuse.js';
/** @typedef {import('./documents.mjs').KnowledgeDocument} KnowledgeDocument */
/** @typedef {{document:KnowledgeDocument,score:number,snippet:string}} SearchResult */

/** Normalize spacing/case and decompose Hangul so a one-jamo typo costs less than a whole syllable.
 * This is deliberately not a Korean morphological analyzer.
 * @param {string} text
 */
function normalize(text) {
  return text.toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu, '').normalize('NFD');
}
/** Small grammatical cleanup for short questions, not a full language parser.
 * @param {string} query
 */
function terms(query) {
  return query.toLowerCase().replace(/[?？!.,]/g, ' ').split(/\s+/u)
    .filter(word => !['어떻게','어디서','어디에','알려주세요','알려줘','방법','하나요','해주세요'].includes(word))
    // Polite predicates carry little topic information in short help questions.
    .filter(word => !/[가-힣]+(?:어요|아요|습니다|습니까)$/u.test(word))
    .map(word => word.replace(/(하나요|하려면|해주세요|합니다|인가요|해요|은|는|을|를|이|가)$/u, ''))
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
        const section = document.sections.find(section => words.some(word => normalize(`${section.heading} ${section.text}`).includes(normalize(word))));
        return {document,score:exactTitle ? 0 : score,snippet:(section ? section.text : document.summary).slice(0, 180)};
      }).sort((a,b) => a.score - b.score);
    },
  };
}

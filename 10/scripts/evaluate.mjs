import { documents } from '../public/documents.mjs';
import { createKnowledgeSearch } from '../public/search.mjs';
import { searchCases } from '../test/search-cases.mjs';

const search = createKnowledgeSearch(documents);
const rows = searchCases.map(({category,query,expectedId}) => {
  const top3 = search.search(query).slice(0,3).map(result => result.document.id);
  const rank = top3.indexOf(expectedId) + 1;
  return {category,query,expectedId,top3,rank:rank || null,pass:rank > 0};
});
const groups = ['normal','typo'].map(category => {
  const cases = rows.filter(row => row.category === category);
  const passed = cases.filter(row => row.pass).length;
  return {category,total:cases.length,passed,top3Accuracy:passed / cases.length};
});
console.log(JSON.stringify({
  corpusCount:documents.length,
  method:'Fixed hand-labeled queries; a hit requires the expected ID within the first three results.',
  limitations:[
    'This is a small demo corpus and a development evaluation set, not an unseen benchmark.',
    'Hangul NFD, whitespace normalization and a small grammatical cleanup are used; no morphological analyzer or semantic embeddings.',
  ],
  groups,total:rows.length,passed:rows.filter(row => row.pass).length,rows,
}, null, 2));
if (rows.some(row => !row.pass)) process.exitCode = 1;

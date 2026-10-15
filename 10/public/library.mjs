/** @typedef {import('./documents.mjs').KnowledgeDocument} KnowledgeDocument */
/** @typedef {KnowledgeDocument & {_bytes:number}} StoredDocument */
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_BATCH_FILES = 10;
export const MAX_DOCUMENTS = 100;
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;

/** @param {unknown} error */
function storageError(error) {
  return new Error(error instanceof DOMException && error.name === 'QuotaExceededError'
    ? '브라우저 저장 용량이 부족합니다. 저장 공간을 확보한 뒤 다시 시도하세요.'
    : `문서 저장소를 사용할 수 없습니다. ${error instanceof Error ? error.message : '브라우저 저장 설정을 확인하세요.'}`);
}

/** @param {File} file @returns {Promise<StoredDocument>} */
async function parseFile(file) {
  if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('TXT, MD, Markdown 파일만 추가할 수 있습니다.');
  if (file.size > MAX_FILE_BYTES) throw new Error('파일당 최대 256 KiB까지 추가할 수 있습니다.');
  const stem = file.name.replace(/\.(txt|md|markdown)$/i, '').trim();
  if (!stem) throw new Error('문서 제목으로 사용할 파일 이름이 필요합니다.');
  let raw;
  try { raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('UTF-8 텍스트 파일을 읽을 수 없습니다. 파일 인코딩을 확인하세요.'); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(raw)) throw new Error('바이너리 또는 잘못된 제어 문자가 포함된 파일입니다.');
  const canonical = raw.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim();
  if (!canonical) throw new Error('내용이 비어 있는 문서는 추가할 수 없습니다.');
  let title = stem;
  /** @type {Array<{heading:string,text:string}>} */
  const sections = [];
  if (/\.txt$/i.test(file.name)) {
    for (const text of canonical.split(/\n\s*\n/)) sections.push({heading: '본문', text});
  } else {
    let heading = '본문';
    let lines = [];
    let foundTitle = false;
    let fence = '';
    const flush = () => {
      const text = lines.join('\n').trim();
      if (text) sections.push({heading, text});
      lines = [];
    };
    for (const line of canonical.split('\n')) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        lines.push(line);
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = '';
        continue;
      }
      if (marker) { fence = marker[1]; lines.push(line); continue; }
      const h1 = line.match(/^ {0,3}#\s+(.+?)(?:\s+#+)?$/);
      if (h1 && !foundTitle) { title = h1[1].trim(); foundTitle = true; continue; }
      const h2 = line.match(/^ {0,3}##\s+(.+?)(?:\s+#+)?$/);
      if (h2) { flush(); heading = h2[1].trim(); continue; }
      lines.push(line);
    }
    flush();
  }
  if (!sections.length) throw new Error('제목 외에 문서 본문을 입력해 주세요.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const id = `uploaded-${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const today = new Date();
  return {
    id, title, type: '가이드', department: '내 문서', owner: '직접 추가',
    updatedAt: `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`,
    summary: sections.map(section => section.text).join(' ').replace(/\s+/g,' ').slice(0,180),
    keywords: [...new Set([title, ...sections.map(s => s.heading)].join(' ').match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter(word => word !== '본문').slice(0,12),
    sections, _bytes: file.size,
  };
}

/** @param {StoredDocument} record @returns {KnowledgeDocument} */
function publicDocument(record) { const {_bytes, ...document} = record; return document; }

/**
 * Each operation owns and closes its database connection. This permits upgrades
 * in another tab without a permanent stale connection or a test-only lifecycle API.
 * @param {{indexedDB?:IDBFactory,name?:string}} [options]
 */
export function createDocumentLibrary(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const name = options.name ?? 'galpi-documents-v1';
  /** @returns {Promise<IDBDatabase>} */
  function open() {
    return new Promise((resolve,reject) => {
      if (!factory) { reject(storageError(new Error('이 브라우저는 영속 저장을 지원하지 않습니다.'))); return; }
      let request;
      try { request = factory.open(name,1); } catch(error) { reject(storageError(error)); return; }
      request.onupgradeneeded = () => { request.result.createObjectStore('documents',{keyPath:'id'}); };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => reject(storageError(new Error('다른 탭의 문서 저장소를 닫고 다시 시도하세요.')));
      request.onsuccess = () => resolve(request.result);
    });
  }
  /** @param {StoredDocument} [record] @returns {Promise<KnowledgeDocument[]|boolean>} */
  async function transact(record) {
    const db = await open();
    try {
      return await new Promise((resolve,reject) => {
        const transaction = db.transaction('documents', record ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('documents');
        /** @type {KnowledgeDocument[]|boolean} */
        let result = false;
        /** @type {unknown} */
        let failure;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(storageError(failure ?? transaction.error ?? new Error('저장 작업이 취소되었습니다.')));
        transaction.onerror = () => { failure ??= transaction.error; };
        try {
          const request = store.getAll();
          request.onsuccess = () => {
            try {
              /** @type {StoredDocument[]} */
              const records = request.result;
              if (!record) { result = records.map(publicDocument); return; }
              if (records.some(existing => existing.id === record.id)) return;
              if (records.length >= MAX_DOCUMENTS) throw new Error('문서는 최대 100개까지 보관할 수 있습니다.');
              if (records.reduce((sum,existing) => sum + existing._bytes,0) + record._bytes > MAX_TOTAL_BYTES) throw new Error('보관 가능한 문서 원본의 총용량 5 MiB를 초과했습니다.');
              store.add(record);
              result = true;
            } catch(error) { failure = error; transaction.abort(); }
          };
        } catch(error) { failure = error; transaction.abort(); }
      });
    } finally { db.close(); }
  }
  return {
    /** @returns {Promise<KnowledgeDocument[]>} */
    async list() { return /** @type {KnowledgeDocument[]} */ (await transact()); },
    /** @param {Iterable<File>} files */
    async importFiles(files) {
      const batch = Array.from(files);
      /** @type {{added:KnowledgeDocument[],duplicates:string[],failures:Array<{name:string,message:string}>}} */
      const result = {added:[],duplicates:[],failures:[]};
      if (batch.length > MAX_BATCH_FILES) {
        result.failures = batch.map(file => ({name:file.name,message:'한 번에 최대 10개 파일까지 추가할 수 있습니다.'}));
        return result;
      }
      for (const file of batch) {
        try {
          const record = await parseFile(file);
          if (await transact(record)) result.added.push(publicDocument(record));
          else result.duplicates.push(file.name);
        } catch(error) { result.failures.push({name:file.name,message:error instanceof Error ? error.message : '파일을 추가하지 못했습니다.'}); }
      }
      return result;
    },
  };
}

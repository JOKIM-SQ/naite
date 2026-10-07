/**
 * @typedef {Object} BoardRecord
 * @property {string} id
 * @property {string} name
 * @property {number} createdAt
 * @property {Blob} sourceBlob
 * @property {Blob} thumbnailBlob
 * @property {Blob} pixelBlob
 * @property {string[]} palette
 * @property {number} width
 * @property {number} height
 * @property {'original'|'style'|'detail'} [pixelMode]
 * @property {number} columns
 * @property {number} gridWidth
 * @property {number} gridHeight
 */

/** @param {IDBFactory} [factory] @param {string} [name] */
export async function createBoardStore(factory = globalThis.indexedDB, name = 's09-chroma') {
  if (!factory) throw new Error('이 브라우저에서는 이미지 저장을 사용할 수 없습니다.');
  const database = await new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore('cards', { keyPath: 'id' });
    request.onerror = () => reject(request.error ?? new Error('저장 공간을 열지 못했습니다.'));
    request.onblocked = () => { blocked = true; reject(new Error('다른 탭을 닫은 뒤 다시 시도해 주세요.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      resolve(request.result);
    };
  });
  database.onversionchange = () => database.close();

  /**
   * @template T
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => IDBRequest<T>} operation
   * @returns {Promise<T>}
   */
  function transact(mode, operation) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('cards', mode);
      /** @type {IDBRequest<T> | undefined} */
      let request;
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request?.error ?? new Error('이미지 저장이 취소되었습니다.'));
      transaction.onerror = () => reject(transaction.error ?? request?.error ?? new Error('저장 공간을 확인해 주세요.'));
      try {
        request = operation(transaction.objectStore('cards'));
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  return {
    /** @returns {Promise<BoardRecord[]>} */
    async list() {
      const records = await transact('readonly', store => store.getAll());
      return records.sort((a, b) => b.createdAt - a.createdAt);
    },
    /** @param {BoardRecord} record */
    async put(record) { await transact('readwrite', store => store.put(record)); },
    /** @param {string} id */
    async remove(id) { await transact('readwrite', store => store.delete(id)); },
    close() { database.close(); },
  };
}

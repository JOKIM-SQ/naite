const MAX_BYTES = 12 * 1024 * 1024;
const RECOVERY = '주소에서 이미지를 가져오지 못했습니다. 원본 이미지 파일을 업로드해 주세요.';
/** Download only browser-readable image resources; the decoder validates image bytes afterward.
 * @param {string} raw
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [options]
 * @returns {Promise<File>}
 */
export async function loadImageURL(raw, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  let address;
  try {
    if (typeof raw !== 'string' || raw.trim().length > 2048) throw Error();
    address = new URL(raw.trim());
    if (!['http:', 'https:'].includes(address.protocol) || address.username || address.password) throw Error();
  } catch { throw Error('로그인 정보가 없는 HTTP 또는 HTTPS 이미지 주소를 입력해 주세요.'); }
  const controller = new AbortController();
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */ let reader;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Error('이미지를 가져오는 시간이 초과되었습니다. 원본 이미지 파일을 업로드해 주세요.'));
      controller.abort();
      void reader?.cancel().catch(() => {});
    }, timeoutMs);
  });
  const download = async () => {
    const response = await fetchImpl(address.href, {mode:'cors', credentials:'omit', referrerPolicy:'no-referrer', redirect:'follow', signal:controller.signal});
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw Error(RECOVERY); }
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : '';
    if (!response.ok || !extension || Number(response.headers.get('content-length')) > MAX_BYTES) {
      void response.body?.cancel().catch(() => {});
      if (!response.ok) throw Error(RECOVERY);
      if (!extension) throw Error('JPG, PNG, WebP 원본 이미지 주소만 사용할 수 있습니다.');
      throw Error('이미지는 12MB 이하만 사용할 수 있습니다.');
    }
    if (!response.body) throw Error(RECOVERY);
    reader = response.body.getReader();
    /** @type {Uint8Array<ArrayBuffer>[]} */ const chunks = [];
    let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (controller.signal.aborted) throw Error(RECOVERY);
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { void reader.cancel().catch(() => {}); throw Error('이미지는 12MB 이하만 사용할 수 있습니다.'); }
        chunks.push(new Uint8Array(value));
      }
    } finally { reader.releaseLock(); }
    let name = address.pathname.split('/').pop() || 'remote-image';
    try { name = decodeURIComponent(name); } catch { /* Preserve malformed percent-encoded names safely. */ }
    name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\.[^.]*$/, '').trim().slice(0, 100) || 'remote-image';
    return new File(chunks, `${name}.${extension}`, {type});
  };
  try { return /** @type {File} */ (await Promise.race([download(), timeout])); }
  catch (error) { if (error instanceof TypeError) throw Error(RECOVERY); throw error; }
  finally { clearTimeout(timer); }
}

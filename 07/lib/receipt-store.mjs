import { remoteRequest } from './receipt-http.mjs';
import { ReceiptError } from './receipt-values.mjs';
import { isUserId } from './receipt-auth.mjs';

const encode = (value) => encodeURIComponent(String(value));
export function createReceiptStore({ url, key, userId, fetchImpl, timeoutMs }) {
  if (!isUserId(userId)) throw new ReceiptError(401, '로그인이 필요합니다.');
  const objectPath = (path) => {
    const [owner, file, ...extra] = typeof path === 'string' ? path.split('/') : [];
    if (owner !== userId || extra.length || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.(jpg|png|webp)$/i.test(file || '')) {
      throw new ReceiptError(404, '영수증을 찾을 수 없습니다.');
    }
    return `s07-receipts/${encode(owner)}/${encode(file)}`;
  };
  const base = new URL(url).origin;
  const auth = { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }) };
  const json = { ...auth, 'Content-Type': 'application/json' };
  const profile = { ...json, 'Accept-Profile': 'weekly_projects', 'Content-Profile': 'weekly_projects' };
  const call = (path, options, binary = false) => remoteRequest(fetchImpl, `${base}${path}`, options, { timeoutMs, binary });
  const rest = (query, options = {}) => call(`/rest/v1/s07_receipts${query}`, { ...options, headers: { ...profile, ...options.headers } });
  const scope = (id) => `?user_id=eq.${encode(userId)}${id ? `&id=eq.${encode(id)}` : ''}`;
  const find = async (id) => (await rest(`${scope(id)}&select=*&limit=1`))[0] || null;
  return {
    list: async () => {
      const rows = [];
      let cursor = '';
      for (;;) {
        const page = await rest(`${scope()}&select=*&order=created_at.desc,id.desc&limit=100${cursor}`);
        if (!page.length) return rows;
        rows.push(...page);
        const last = page.at(-1);
        // A keyset stays stable when new uploads or deletions shift earlier pages.
        cursor = `&or=(created_at.lt.${encode(last.created_at)},and(created_at.eq.${encode(last.created_at)},id.lt.${encode(last.id)}))`;
      }
    },
    find,
    create: async (row) => {
      objectPath(row.storage_path);
      return (await rest('', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...row, user_id: userId, session_hash: null }) }))[0];
    },
    update: async (row, values) => {
      const rows = await rest(`${scope(row.id)}&revision=eq.${row.revision}&status=eq.${row.status}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...values, user_id: userId, session_hash: null, revision: row.revision + 1, updated_at: new Date().toISOString() }),
      });
      if (!rows.length) throw new ReceiptError(409, '다른 작업이 먼저 저장되었습니다. 최신 결과를 확인해 주세요.');
      return rows[0];
    },
    remove: async (row) => {
      if (row.status !== 'deleting') throw new ReceiptError(409, '삭제가 예약되지 않았습니다. 최신 결과를 확인해 주세요.');
      let rows;
      try {
        rows = await rest(`${scope(row.id)}&revision=eq.${row.revision}&status=eq.deleting`, {
          method: 'DELETE', headers: { Prefer: 'return=representation' },
        });
      } catch (error) {
        // A lost response can follow a committed DELETE. Confirm before reporting failure.
        if (!await find(row.id)) return;
        throw error;
      }
      if (!rows.length && await find(row.id)) throw new ReceiptError(409, '다른 작업이 먼저 저장되었습니다. 최신 결과를 확인해 주세요.');
    },
    removeObject: (path) => {
      objectPath(path);
      // Storage bulk removal is idempotent: an already absent object returns an empty result.
      return call('/storage/v1/object/s07-receipts', { method: 'DELETE', headers: json, body: JSON.stringify({ prefixes: [path] }) });
    },
    upload: (path, bytes, mediaType) => call(`/storage/v1/object/${objectPath(path)}`, {
      method: 'POST', headers: { ...auth, 'Content-Type': mediaType, 'x-upsert': 'false' }, body: bytes,
    }),
    download: (path) => call(`/storage/v1/object/authenticated/${objectPath(path)}`, { headers: auth }, true),
    signedUrl: async (path) => {
      const result = await call(`/storage/v1/object/sign/${objectPath(path)}`, { method: 'POST', headers: json, body: JSON.stringify({ expiresIn: 300 }) });
      const signed = result.signedURL;
      if (typeof signed !== 'string') throw new ReceiptError(502, '원본 이미지를 열 수 없습니다.');
      const resolved = new URL(signed.startsWith('/object/') ? `/storage/v1${signed}` : signed, base);
      if (resolved.origin !== base || !resolved.pathname.startsWith('/storage/v1/object/sign/s07-receipts/')) throw new ReceiptError(502, '원본 이미지를 열 수 없습니다.');
      return resolved.href;
    },
  };
}

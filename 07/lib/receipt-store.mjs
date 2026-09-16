import { remoteRequest } from './receipt-http.mjs';
import { ReceiptError } from './receipt-values.mjs';

const encode = (value) => encodeURIComponent(String(value));
const objectPath = (path) => `s07-receipts/${path.split('/').map(encode).join('/')}`;

export function createReceiptStore({ url, key, fetchImpl, timeoutMs }) {
  const base = new URL(url).origin;
  const auth = { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }) };
  const json = { ...auth, 'Content-Type': 'application/json' };
  const profile = { ...json, 'Accept-Profile': 'weekly_projects', 'Content-Profile': 'weekly_projects' };
  const call = (path, options, binary = false) => remoteRequest(fetchImpl, `${base}${path}`, options, { timeoutMs, binary });
  const rest = (query, options = {}) => call(`/rest/v1/s07_receipts${query}`, { ...options, headers: { ...profile, ...options.headers } });
  const scope = (sessionHash, id) => `?session_hash=eq.${encode(sessionHash)}${id ? `&id=eq.${encode(id)}` : ''}`;
  return {
    list: (sessionHash) => rest(`${scope(sessionHash)}&select=*&order=created_at.desc&limit=30`),
    find: async (sessionHash, id) => (await rest(`${scope(sessionHash, id)}&select=*&limit=1`))[0] || null,
    create: async (row) => (await rest('', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) }))[0],
    update: async (row, values) => {
      const rows = await rest(`${scope(row.session_hash, row.id)}&revision=eq.${row.revision}&status=eq.${row.status}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...values, revision: row.revision + 1, updated_at: new Date().toISOString() }),
      });
      if (!rows.length) throw new ReceiptError(409, '다른 작업이 먼저 저장되었습니다. 최신 결과를 확인해 주세요.');
      return rows[0];
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

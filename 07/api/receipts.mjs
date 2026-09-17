import { randomUUID } from 'node:crypto';
import { changedFields, decodeUpload, ReceiptError, validateValues } from '../lib/receipt-values.mjs';
import { createReceiptStore } from '../lib/receipt-store.mjs';
import { extractReceipt } from '../lib/receipt-extract.mjs';
import { authenticatedUserId } from '../lib/receipt-auth.mjs';

const stale = (row) => row.status === 'processing' && Date.now() - Date.parse(row.updated_at) > 90000;
const validId = (id) => typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id);

function requestBody(req) {
  try {
    const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(String(req.body)) : req.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid body');
    return raw;
  } catch { throw new ReceiptError(400, 'JSON 요청 형식이 올바르지 않습니다.'); }
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ReceiptError(403, '같은 사이트에서 요청해 주세요.');
  if (!req.headers.origin) return;
  try {
    const origin = new URL(req.headers.origin);
    const protocol = req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http');
    if (origin.host !== req.headers.host || origin.protocol !== `${protocol}:`) throw new Error('Cross origin');
  } catch { throw new ReceiptError(403, '같은 사이트에서 요청해 주세요.'); }
}

async function publicReceipt(row, store) {
  let imageUrl = null;
  try { imageUrl = await store.signedUrl(row.storage_path); } catch { /* Keep saved results accessible when signing is unavailable. */ }
  return {
    id: row.id, fileName: row.file_name, imageUrl,
    status: stale(row) ? 'failed' : row.status,
    error: stale(row) ? '분석이 중단되었습니다. 다시 시도해 주세요.' : row.error,
    original: row.original_values, values: row.edited_values,
    correctionCount: row.correction_count, revision: row.revision, createdAt: row.created_at,
  };
}

async function analyze(row, store, options, file) {
  let values;
  try {
    const bytes = file?.bytes || await store.download(row.storage_path);
    const verified = decodeUpload({ fileName: row.file_name, mediaType: row.media_type, data: bytes.toString('base64') });
    values = await extractReceipt({ bytes: verified.bytes, mediaType: row.media_type, ...options });
  } catch {
    return store.update(row, { status: 'failed', error: '영수증을 분석하지 못했습니다. 원본을 확인하고 다시 시도해 주세요.' });
  }
  return store.update(row, {
    status: 'ready', error: null,
    // Both the first extraction and later human corrections survive retries.
    ...(row.original_values === null ? { original_values: values, edited_values: values } : {}),
  });
}

export function createHandler({ env = process.env, fetchImpl = fetch, timeoutMs = 5000, ocrTimeoutMs = 30000 } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
        res.setHeader('Allow', 'GET, POST, PATCH');
        throw new ReceiptError(405, 'GET, POST 또는 PATCH만 지원합니다.');
      }
      if (req.method !== 'GET') sameOrigin(req);
      const userId = await authenticatedUserId({
        authorization: req.headers.authorization, url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY,
        fetchImpl, timeoutMs: Math.min(timeoutMs, 3000),
      });
      const body = req.method === 'GET' ? null : requestBody(req);
      const file = req.method === 'POST' && body.action === 'upload' ? decodeUpload(body) : null;
      if (body && !file && !validId(body.id)) throw new ReceiptError(422, '영수증 ID가 올바르지 않습니다.');
      if (req.method === 'POST' && !['upload', 'retry'].includes(body.action)) throw new ReceiptError(422, '지원하지 않는 작업입니다.');
      const values = req.method === 'PATCH' ? validateValues(body.values) : null;
      if (values && (!Number.isSafeInteger(body.revision) || body.revision < 0)) throw new ReceiptError(422, '저장 버전이 올바르지 않습니다.');
      if (req.method === 'POST' && (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY.includes('[SENSITIVE]'))) throw new ReceiptError(503, '서버 분석 서비스 연결 설정이 필요합니다.');
      const store = createReceiptStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, userId, fetchImpl, timeoutMs });
      const extraction = { apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || undefined, fetchImpl, timeoutMs: ocrTimeoutMs };
      if (req.method === 'GET') {
        const rows = await store.list();
        return res.status(200).json({ receipts: await Promise.all(rows.map((row) => publicReceipt(row, store))) });
      }
      if (file) {
        const id = randomUUID(), path = `${userId}/${id}.${file.extension}`;
        await store.upload(path, file.bytes, file.mediaType);
        const row = await store.create({ id, storage_path: path, file_name: file.fileName, media_type: file.mediaType, status: 'processing' });
        const result = await analyze(row, store, extraction, file);
        return res.status(201).json({ receipt: await publicReceipt(result, store) });
      }
      const row = await store.find(body.id);
      if (!row) throw new ReceiptError(404, '영수증을 찾을 수 없습니다.');
      if (req.method === 'PATCH') {
        if (row.status !== 'ready' || row.revision !== body.revision) throw new ReceiptError(409, '결과가 변경되었거나 아직 분석 중입니다. 최신 결과를 확인해 주세요.');
        const corrections = changedFields(row.edited_values, values);
        const saved = corrections ? await store.update(row, { edited_values: values, correction_count: row.correction_count + corrections }) : row;
        return res.status(200).json({ receipt: await publicReceipt(saved, store) });
      }
      if (row.status === 'processing' && !stale(row)) throw new ReceiptError(409, '이미 분석 중입니다. 잠시 뒤 확인해 주세요.');
      const claimed = await store.update(row, { status: 'processing', error: null });
      const result = await analyze(claimed, store, extraction);
      return res.status(200).json({ receipt: await publicReceipt(result, store) });
    } catch (error) {
      const safe = error instanceof ReceiptError;
      return res.status(safe ? error.status : 502).json({ message: safe ? error.message : '요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
    }
  };
}

export default createHandler();

export class ReceiptError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const fields = ['merchant', 'date', 'total', 'currency', 'category'];
export const RECEIPT_CATEGORIES = Object.freeze(['쇼핑', '장보기', '외식', '그 외']);
const currencies = new Set(Intl.supportedValuesOf('currency'));
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const invalid = () => { throw new ReceiptError(422, '영수증 값 또는 파일 형식이 올바르지 않습니다.'); };
const objectWith = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const shortText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12;
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function validateValues(input, { extraction = false } = {}) {
  if (!objectWith(input, fields)) invalid();
  const nullable = (value, check) => {
    if (value === null || check(value)) return value;
    if (extraction) return null;
    return invalid();
  };
  return {
    merchant: nullable(input.merchant, (value) => shortText(value, 200)),
    date: nullable(input.date, date),
    total: nullable(input.total, number),
    currency: nullable(input.currency, (value) => currencies.has(value)),
    category: RECEIPT_CATEGORIES.includes(input.category) ? input.category : extraction ? '그 외' : invalid(),
  };
}

// Normalize the public shape without rewriting immutable legacy extraction data.
export function publicValues(input) {
  if (input === null) return null;
  return Object.fromEntries(fields.map((field) => [field, field === 'category'
    ? RECEIPT_CATEGORIES.includes(input?.category) ? input.category : '그 외'
    : input?.[field] ?? null]));
}

export const changedFields = (before, after) => {
  const normalized = publicValues(before);
  return fields.filter((field) => JSON.stringify(normalized?.[field]) !== JSON.stringify(after[field])).length;
};

export function decodeUpload(input) {
  const { fileName, mediaType, data } = input || {};
  if (!shortText(fileName, 200) || /[\u0000-\u001f\u007f]/.test(fileName) || typeof data !== 'string'
    || !data.length || data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || data.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) invalid();
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== data) invalid();
  let extension;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) extension = 'jpg';
  else if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) extension = 'png';
  else if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') extension = 'webp';
  if (!extension || mediaType !== { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extension]) invalid();
  return { bytes, fileName, mediaType, extension };
}

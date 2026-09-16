import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValues, changedFields, decodeUpload } from './receipt-values.mjs';

const values = () => ({ merchant: '시장', date: '2024-02-29', total: 12.5, currency: 'USD', items: [{ name: '사과', quantity: 2, amount: 12.5 }] });
const invalid = (run) => assert.throws(run, (error) => error.status === 422);

test('유효한 영수증 값과 불확실한 null 값을 보존한다', () => {
  assert.deepEqual(validateValues(values()), values());
  const unknown = { merchant: null, date: null, total: null, currency: null, items: [] };
  assert.deepEqual(validateValues(unknown), unknown);
});

test('수동 편집의 불가능한 날짜와 금액을 거부한다', () => {
  for (const date of ['2025-02-29', '2026-04-31', '09/16/2026', '', 20260916]) invalid(() => validateValues({ ...values(), date }));
  for (const total of [-1, Infinity, NaN, '12.50', '', 1e15]) invalid(() => validateValues({ ...values(), total }));
  for (const currency of ['usd', 'FAKE', 'XYZ', '']) invalid(() => validateValues({ ...values(), currency }));
});

test('AI의 불확실하거나 유효하지 않은 날짜·금액·통화를 null로 정규화한다', () => {
  assert.deepEqual(validateValues({ ...values(), date: '2025-02-29', total: -12, currency: 'XYZ' }, { extraction: true }), {
    ...values(), date: null, total: null, currency: null,
  });
});

test('값 구조와 과도한 품목, 임의 추가 필드를 거부한다', () => {
  for (const input of [null, [], {}, { ...values(), injected: true }, { ...values(), items: new Array(201).fill(values().items[0]) }, { ...values(), items: [{ name: '', quantity: 1, amount: 1 }] }]) invalid(() => validateValues(input));
});

test('실제 변경된 최상위 필드만 수정 횟수로 센다', () => {
  assert.equal(changedFields(values(), values()), 0);
  assert.equal(changedFields(values(), { ...values(), date: null, total: 0 }), 2);
  assert.equal(changedFields(values(), { ...values(), items: [{ name: '배', quantity: 3, amount: 20 }] }), 1);
});

test('업로드는 이미지 헤더와 MIME이 일치해야 하며 원본 바이트를 유지한다', () => {
  const bytes = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.deepEqual(decodeUpload({ fileName: '한글 영수증.png', mediaType: 'image/png', data: bytes.toString('base64') }), {
    bytes, fileName: '한글 영수증.png', mediaType: 'image/png', extension: 'png',
  });
  invalid(() => decodeUpload({ fileName: 'fake.png', mediaType: 'image/png', data: Buffer.from('<svg>fake</svg>').toString('base64') }));
  invalid(() => decodeUpload({ fileName: 'fake.jpg', mediaType: 'image/jpeg', data: bytes.toString('base64') }));
  invalid(() => decodeUpload({ fileName: 'x.png', mediaType: 'image/png', data: 'https://private.example/x' }));
});

test('3 MiB 경계는 허용하며 초과 파일과 비정규 base64는 거부한다', () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024); bytes.set([0xff, 0xd8, 0xff]);
  assert.equal(decodeUpload({ fileName: 'x.jpg', mediaType: 'image/jpeg', data: bytes.toString('base64') })?.bytes?.length, 3145728);
  invalid(() => decodeUpload({ fileName: 'x.jpg', mediaType: 'image/jpeg', data: Buffer.concat([bytes, Buffer.from([0])]).toString('base64') }));
  invalid(() => decodeUpload({ fileName: 'x.jpg', mediaType: 'image/jpeg', data: '/9j/\n' }));
});

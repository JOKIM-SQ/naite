import test from 'node:test';
import assert from 'node:assert/strict';
import { parseField, validateFiles, createAutosave, reconcileDraft } from './receipt-view.mjs';

const values = { merchant: '문구점', date: '2026-09-16', total: 12000, currency: 'KRW', items: [{ name: '노트', quantity: 2, amount: 12000 }] };
const receipt = { id: 'r-1', fileName: 'receipt.png', imageUrl: '/original.png', status: 'ready', error: null, original: values, values, correctionCount: 0, revision: 0, createdAt: '2026-09-16T00:00:00Z' };
const later = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setTimeout(done, 0));

test('빈 추출값은 0으로 발명하지 않고 null로 저장한다', () => {
  assert.equal(parseField('total', '  '), null);
  assert.equal(parseField('quantity', ''), null);
  assert.equal(parseField('merchant', ''), null);
});

test('금액의 천 단위 구분자와 소수는 보존하고 잘못된 숫자는 거절한다', () => {
  assert.equal(parseField('total', '12,340.50'), 12340.5);
  assert.equal(parseField('amount', '0'), 0);
  for (const raw of ['abc', '12,34', '-10', 'Infinity', '1e5']) assert.throws(() => parseField('amount', raw));
});

test('존재하지 않는 날짜를 거절하며 실제 윤년 날짜는 저장한다', () => {
  assert.equal(parseField('date', '2024-02-29'), '2024-02-29');
  assert.throws(() => parseField('date', '2026-02-29'));
  assert.throws(() => parseField('date', '2026-13-01'));
});

test('통화 입력을 대문자로 정리하고 잘못된 길이는 거절한다', () => {
  assert.equal(parseField('currency', ' krw '), 'KRW');
  assert.throws(() => parseField('currency', '원'));
  assert.equal(parseField('name', '  노트  '), '노트');
});

test('서버가 저장할 수 없는 금액 상한·비실재 통화·긴 텍스트를 입력 단계에서 거절한다', () => {
  assert.equal(parseField('total', '1000000000000'), 1000000000000);
  assert.throws(() => parseField('total', '1000000000001'));
  assert.throws(() => parseField('currency', 'XYZ'));
  assert.throws(() => parseField('merchant', '상'.repeat(201)));
  assert.throws(() => parseField('name', '명'.repeat(301)));
  assert.throws(() => parseField('name', '   '));
});

test('선택한 파일은 3장까지 허용하고 파일별 오류를 분리한다', () => {
  const input = [{ name: 'ok.jpg', type: 'image/jpeg', size: 3 * 1024 * 1024 }, { name: 'large.png', type: 'image/png', size: 3 * 1024 * 1024 + 1 }, { name: 'phone.heic', type: 'image/heic', size: 10 }];
  const result = validateFiles(input);
  assert.deepEqual(result.accepted, [input[0]]);
  assert.equal(result.rejected.length, 2);
  assert.match(result.rejected[0].message, /3 MiB/);
  assert.match(result.rejected[1].message, /JPEG|PNG/);
  assert.throws(() => validateFiles([...input, input[0]]), /3장/);
});

test('비어 있거나 파일명이 너무 긴 사진은 업로드 요청 전에 거절한다', () => {
  const result = validateFiles([{ name: 'empty.png', type: 'image/png', size: 0 }, { name: 'a'.repeat(201), type: 'image/png', size: 12 }]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 2);
});

test('빠른 편집을 한 번에 저장하고 서버에서 받은 수정 횟수를 표시한다', async () => {
  let persisted = structuredClone(receipt);
  const states = [];
  const autosave = createAutosave({ receipt, delay: 10000, onState: state => states.push(state), save: async (next, revision) => {
    assert.equal(revision, 0);
    persisted = { ...persisted, values: next, correctionCount: 2, revision: 1 };
    return persisted;
  } });
  autosave.update({ ...values, total: 14000 });
  autosave.update({ ...values, total: 15000, merchant: '새 문구점' });
  await autosave.flush();
  assert.equal(persisted.values.total, 15000);
  assert.equal(persisted.values.merchant, '새 문구점');
  assert.equal(states.at(-1).phase, 'saved');
  assert.equal(states.at(-1).receipt.correctionCount, 2);
});

test('저장 중 추가한 편집을 이전 응답이 덮어쓰지 않으며 다음 revision으로 저장한다', async () => {
  const first = later();
  let requests = 0;
  let persisted = structuredClone(receipt);
  const states = [];
  const autosave = createAutosave({ receipt, delay: 10000, onState: state => states.push(state), save: async (next, revision) => {
    requests += 1;
    if (requests === 1) await first.promise;
    assert.equal(revision, persisted.revision);
    persisted = { ...persisted, values: next, revision: revision + 1 };
    return persisted;
  } });
  autosave.update({ ...values, total: 13000 });
  const saving = autosave.flush();
  await tick();
  autosave.update({ ...values, total: 16000 });
  first.resolve();
  await saving;
  assert.equal(requests, 2);
  assert.equal(persisted.values.total, 16000);
  assert.ok(states.filter(state => state.receipt.revision > 0).every(state => state.receipt.values.total === 16000));
});

test('409 충돌에서는 원격의 다른 필드는 보존하며 사용자가 고친 필드만 재적용한다', async () => {
  let persisted = { ...receipt, values: { ...values, merchant: '다른 탭에서 고친 상호' }, revision: 1 };
  let first = true;
  const autosave = createAutosave({ receipt, delay: 10000, save: async (next, revision) => {
    if (first) { first = false; throw Object.assign(new Error('충돌'), { status: 409 }); }
    assert.equal(revision, 1);
    persisted = { ...persisted, values: next, revision: 2 };
    return persisted;
  }, refresh: async () => persisted });
  autosave.update({ ...values, total: 18000 });
  await autosave.flush();
  assert.equal(persisted.values.total, 18000);
  assert.equal(persisted.values.merchant, '다른 탭에서 고친 상호');
});

test('409 이후 원격 품목 삭제·추가 구조를 최신 상태에 반영한다', async () => {
  for (const remoteItems of [[], [{ name: '추가된 영수증 품목', quantity: 1, amount: 700 }, { name: '추가된 두 번째 품목', quantity: 2, amount: 500 }]]) {
    let persisted = { ...receipt, values: { ...values, items: remoteItems }, revision: 2 };
    let conflict = true;
    let state;
    const autosave = createAutosave({ receipt, delay: 10000, onState: next => { state = next; }, refresh: async () => persisted, save: async (next, revision) => {
      if (conflict) { conflict = false; throw Object.assign(new Error('다른 탭 수정'), { status: 409 }); }
      assert.equal(revision, 2);
      persisted = { ...persisted, values: next, revision: 3 };
      return persisted;
    } });
    autosave.update({ ...values, total: 21000 });
    await autosave.flush();
    assert.deepEqual(state.receipt.values.items, remoteItems);
    assert.equal(state.receipt.values.total, 21000);
  }
});

test('아직 입력 중인 품목이 있으면 원격 구조변경으로 행을 없애지 않는다', () => {
  const incoming = { ...values, merchant: '다른 탭 상호', items: [] };
  const next = reconcileDraft(values, values, incoming, true);
  assert.deepEqual(next.items, [{ name: '노트', quantity: 2, amount: 12000 }]);
  assert.equal(next.merchant, '다른 탭 상호');
});

test('추가한 빈 품목은 지연된 저장응답에도 남고 편집 없는 품목은 원격 구조를 따른다', () => {
  const local = { ...values, items: [...values.items, { name: '', quantity: null, amount: null }] };
  const incoming = { ...values, total: 9000 };
  assert.deepEqual(reconcileDraft(values, local, incoming).items, [{ name: '노트', quantity: 2, amount: 12000 }, { name: '', quantity: null, amount: null }]);
  assert.deepEqual(reconcileDraft(values, values, { ...values, items: [] }).items, []);
});

test('계속 충돌하는 서버에 무한 재시도하지 않고 사용자 수정값을 보존한다', async () => {
  let attempts = 0;
  let state;
  const autosave = createAutosave({ receipt, delay: 10000, onState: next => { state = next; }, refresh: async () => ({ ...receipt, revision: 1 }), save: async () => {
    attempts += 1;
    throw Object.assign(new Error('다른 탭에서 다시 변경했어요.'), { status: 409 });
  } });
  autosave.update({ ...values, total: 22000 });
  await autosave.flush();
  assert.equal(attempts, 2);
  assert.equal(state.phase, 'error');
  assert.equal(state.receipt.values.total, 22000);
});

test('저장 오류에도 미저장 수정값을 유지하고 재시도로 복구한다', async () => {
  let offline = true;
  let persisted = receipt;
  let state;
  const autosave = createAutosave({ receipt, delay: 10000, onState: next => { state = next; }, save: async next => {
    if (offline) throw new Error('네트워크 연결을 확인해 주세요.');
    persisted = { ...receipt, values: next, revision: 1 };
    return persisted;
  } });
  autosave.update({ ...values, total: 20000 });
  await autosave.flush();
  assert.equal(state.phase, 'error');
  assert.equal(state.receipt.values.total, 20000);
  assert.equal(autosave.hasPending(), true);
  offline = false;
  await autosave.flush();
  assert.equal(persisted.values.total, 20000);
  assert.equal(autosave.hasPending(), false);
});

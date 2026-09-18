const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const currencies = new Set(Intl.supportedValuesOf('currency'));

export function parseField(field, raw) {
  const value = String(raw).trim();
  if (field === 'category') {
    if (!['쇼핑', '장보기', '외식', '그 외'].includes(value)) throw new Error('카테고리를 선택해 주세요.');
    return value;
  }
  if (!value) return null;
  if (field === 'merchant' && value.length > 200) throw new Error('입력한 내용이 너무 길어요.');
  if (field === 'total') {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new Error('0 이상의 숫자를 입력해 주세요.');
    const number = Number(value.replaceAll(',', ''));
    if (!Number.isFinite(number) || number > 1e12) throw new Error('금액은 1조 이하로 입력해 주세요.');
    return number;
  }
  if (field === 'date') {
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  if (field === 'currency') {
    if (!currencies.has(value.toUpperCase())) throw new Error('KRW, USD처럼 실제 통화 코드 3자를 입력해 주세요.');
    return value.toUpperCase();
  }
  return value;
}

export function validateFiles(files) {
  if (files.length > 3) throw new Error('한 번에 사진을 3장까지 선택해 주세요.');
  const accepted = [];
  const rejected = [];
  for (const file of files) {
    let message;
    if (file.name.length > 200 || /[\u0000-\u001f\u007f]/.test(file.name)) message = '파일 이름은 특수 제어문자 없이 200자 이내로 바꿔 주세요.';
    else if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) message = 'HEIC 사진은 JPEG 또는 PNG로 변환한 뒤 올려 주세요.';
    else if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) message = 'JPEG, PNG, WebP 사진만 올릴 수 있어요.';
    else if (!file.size) message = '비어 있는 파일은 올릴 수 없어요.';
    else if (file.size > 3 * 1024 * 1024) message = '사진 한 장은 3 MiB 이하여야 해요. 크기를 줄인 뒤 다시 올려 주세요.';
    if (message) rejected.push({ file, message });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

// Retain only local changes when a different tab has advanced the revision.
function mergeChanges(base, local, remote) {
  const merged = copy(remote);
  for (const field of Object.keys(local)) {
    if (!same(base[field], local[field])) merged[field] = copy(local[field]);
  }
  return merged;
}

export function reconcileDraft(base, local, remote) {
  return mergeChanges(base, local, remote);
}

export function createAutosave({ receipt, save, refresh, onState = () => {}, delay = 450 }) {
  let current = copy(receipt);
  let confirmed = copy(receipt.values);
  let local = copy(receipt.values);
  let generation = 0;
  let timer;
  let running;
  const hasPending = () => !same(confirmed, local);
  const emit = (phase, error = null) => onState({ phase, error, receipt: { ...copy(current), values: copy(local) }, pending: hasPending() });

  async function drain() {
    let conflicts = 0;
    while (hasPending()) {
      const snapshot = copy(local);
      const startedAt = generation;
      emit('saving');
      try {
        current = copy(await save(snapshot, current.revision));
        confirmed = copy(current.values);
        if (generation === startedAt) local = copy(current.values);
        conflicts = 0;
      } catch (error) {
        if (error.status === 409 && refresh && conflicts < 1) {
          conflicts += 1;
          try {
            const remote = await refresh();
            local = mergeChanges(confirmed, local, remote.values);
            confirmed = copy(remote.values);
            current = copy(remote);
            continue;
          } catch (refreshError) { emit('error', refreshError.message); return; }
        }
        emit('error', error.message || '저장하지 못했어요. 다시 시도해 주세요.');
        return;
      }
    }
    emit('saved');
  }

  function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (!hasPending()) return Promise.resolve();
    running = drain().finally(() => { running = null; });
    return running;
  }

  return {
    update(next) {
      if (same(local, next)) return;
      local = copy(next);
      generation += 1;
      emit('pending');
      clearTimeout(timer);
      if (!running) timer = setTimeout(flush, delay);
    },
    flush,
    hasPending,
  };
}

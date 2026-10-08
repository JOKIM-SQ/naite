/** @typedef {import('./storage.mjs').BoardRecord} BoardRecord */
/** @typedef {import('@supabase/supabase-js').SupabaseClient} SupabaseClient */
const BUCKET = 's09-chroma-images';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${UUID}$`);
const kinds = /** @type {const} */ (['source', 'thumbnail', 'pixel']);

/** @param {unknown} value @returns {value is string} */
function uuid(value) { return typeof value === 'string' && uuidPattern.test(value); }
/**
 * @typedef {Object} CloudRow
 * @property {string} id
 * @property {number} revision
 * @property {string} user_id
 * @property {string} name
 * @property {number|string} created_at
 * @property {string[]} palette
 * @property {number} width
 * @property {number} height
 * @property {number} columns
 * @property {number} grid_width
 * @property {number} grid_height
 * @property {string} pixel_mode
 * @property {string} source_path
 * @property {string} thumbnail_path
 * @property {string} pixel_path
 */
/** @param {CloudRow} row */
function validateRow(row) {
  const positive = value => Number.isInteger(value) && value > 0 && value <= 32768;
  if (!row || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1 || !uuid(row.id) || !uuid(row.user_id) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 500 ||
      !Number.isSafeInteger(Number(row.created_at)) || Number(row.created_at) < 0 ||
      !Array.isArray(row.palette) || row.palette.length !== 5 || row.palette.some(color => typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) ||
      ![row.width, row.height, row.grid_width, row.grid_height].every(positive) || ![32, 64, 96, 128].includes(row.columns) ||
      !['original', 'style', 'detail'].includes(row.pixel_mode)) throw new Error('카드 데이터가 올바르지 않습니다.');
  for (const kind of kinds) {
    if (typeof row[`${kind}_path`] !== 'string' || !new RegExp(`^${row.user_id}/${row.id}/${UUID}/${kind}$`).test(row[`${kind}_path`])) {
      throw new Error('카드 이미지 경로가 올바르지 않습니다.');
    }
  }
}
/** @param {SupabaseClient} client @param {string} userId */
export async function createCloudStore(client, userId) {
  if (!uuid(userId)) throw new Error('로그인 계정을 확인해 주세요.');
  let closed = false;
  /** Snapshot of blob references and paths, never the caller's mutable record. */
  const snapshots = new Map();
  async function checkSession() {
    if (closed) throw new Error('이미 닫힌 저장 공간입니다.');
    const { data, error } = await client.auth.getSession();
    if (closed) throw new Error('이미 닫힌 저장 공간입니다.');
    if (error || data.session?.user.id !== userId) throw new Error('로그인 계정이 변경되었습니다. 새로고침 후 다시 시도해 주세요.');
  }
  await checkSession();
  const bucket = client.storage.from(BUCKET);
  /** Cleanup is best effort after commit. Durable rows remain until storage acknowledges removal. */
  async function cleanup() {
    try {
      await checkSession();
      const { data, error } = await client.from('s09_image_cleanup').select('id,paths').eq('user_id', userId);
      if (error) return;
      for (const entry of data ?? []) {
        const pattern = new RegExp(`^${UUID}/${UUID}/${UUID}/(source|thumbnail|pixel)$`);
        if (!uuid(entry.id) || !Array.isArray(entry.paths) || !entry.paths.length || entry.paths.some(path => typeof path !== 'string' || !pattern.test(path))) continue;
        await checkSession();
        const removed = await bucket.remove(entry.paths);
        if (removed.error) continue;
        await checkSession();
        await client.from('s09_image_cleanup').delete().eq('id', entry.id).eq('user_id', userId);
      }
    } catch { /* Cleanup must never turn a committed save/delete into a reported failure. */ }
  }
  return {
    /** @returns {Promise<BoardRecord[]>} */
    async list() {
      await checkSession();
      await cleanup();
      await checkSession();
      const { data, error } = await client.from('s09_cards').select('*').order('created_at', { ascending: false });
      if (error) throw new Error('카드 목록을 불러오지 못했습니다. 다시 시도해 주세요.', { cause: error });
      for (const row of data ?? []) validateRow(row);
      const entries = await Promise.all((data ?? []).map(async row => {
        const blobs = await Promise.all(kinds.map(async kind => {
          await checkSession();
          const result = await bucket.download(row[`${kind}_path`]);
          if (result.error || !result.data) throw new Error('카드 이미지를 불러오지 못했습니다. 다시 시도해 주세요.', { cause: result.error });
          return result.data;
        }));
        const record = { id: row.id, name: row.name, createdAt: Number(row.created_at), palette: [...row.palette], width: row.width, height: row.height,
          columns: row.columns, gridWidth: row.grid_width, gridHeight: row.grid_height, pixelMode: row.pixel_mode,
          sourceBlob: blobs[0], thumbnailBlob: blobs[1], pixelBlob: blobs[2] };
        return { record, row };
      }));
      await checkSession();
      snapshots.clear();
      for (const { record, row } of entries) snapshots.set(record.id, { record: { ...record }, row: { ...row } });
      return entries.map(entry => entry.record);
    },
    /** @param {BoardRecord} record */
    async put(record) {
      await checkSession();
      const previous = snapshots.get(record.id);
      const version = crypto.randomUUID();
      /** @type {CloudRow} */
      const row = { revision: (Number(previous?.row.revision) || 0) + 1, source_path: '', thumbnail_path: '', pixel_path: '', id: record.id, user_id: previous?.row.user_id ?? userId, name: record.name, created_at: record.createdAt, palette: [...record.palette],
        width: record.width, height: record.height, columns: record.columns, grid_width: record.gridWidth, grid_height: record.gridHeight,
        pixel_mode: record.pixelMode ?? 'original' };
      for (const kind of kinds) {
        const blob = record[`${kind}Blob`];
        if (!(blob instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || blob.size <= 0 || blob.size > 12 * 1024 * 1024) {
          throw new Error('이미지는 12MB 이하의 JPG, PNG, WebP 파일이어야 합니다.');
        }
        row[`${kind}_path`] = previous?.record[`${kind}Blob`] === blob ? previous.row[`${kind}_path`] : `${row.user_id}/${record.id}/${version}/${kind}`;
      }
      validateRow(row);
      const uploaded = [];
      let safeToRollback = true;
      try {
        for (const kind of kinds) {
          const path = row[`${kind}_path`];
          if (path === previous?.row[`${kind}_path`]) continue;
          await checkSession();
          const result = await bucket.upload(path, record[`${kind}Blob`], { upsert: false, contentType: record[`${kind}Blob`].type });
          if (result.error) throw new Error('이미지 업로드에 실패했습니다. 다시 시도해 주세요.', { cause: result.error });
          uploaded.push(path);
        }
        await checkSession();
        safeToRollback = false;
        const saved = await client.rpc('s09_save_card', { p_card: row, p_expected_revision: previous?.row.revision ?? null });
        if (saved.error) {
          // A lost response may follow a successful commit. Read it back before deciding.
          await checkSession();
          const verified = await client.from('s09_cards').select('*').eq('id', record.id);
          const persisted = !verified.error && verified.data?.[0];
          const matches = persisted && Object.entries(row).every(([key, value]) =>
            key === 'revision' ? Number(persisted[key]) === row.revision : key === 'created_at' ? Number(persisted[key]) === value : JSON.stringify(persisted[key]) === JSON.stringify(value));
          if (!matches) {
            // Only a definite PostgreSQL rejection permits deletion; uncertain transport failures retain files.
            safeToRollback = saved.status >= 400 && saved.status < 500 && /^[0-9A-Z]{5}$/.test(saved.error.code ?? '') && !verified.error;
            throw new Error(saved.error.code === 'P0001' && saved.error.details === 's09_revision_conflict' ? '다른 탭에서 카드가 변경되었습니다. 다시 불러와 주세요.' : '카드 저장 결과를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.', { cause: saved.error });
          }
        }
        row.revision = saved.error ? row.revision : Number(saved.data);
      } catch (error) {
        // Failed uploads have no committed row. Never clean with another account's session.
        if (safeToRollback && uploaded.length) try { await checkSession(); await bucket.remove(uploaded); } catch { /* best effort */ }
        throw error;
      }
      if (!closed) snapshots.set(record.id, { record: { ...record }, row: { ...row } });
      await cleanup();
    },
    /** @param {string} id */
    async remove(id) {
      await checkSession();
      if (!uuid(id)) throw new Error('삭제할 카드가 올바르지 않습니다.');
      const result = await client.rpc('s09_delete_card', { p_id: id });
      if (result.error) {
        await checkSession();
        const verified = await client.from('s09_cards').select('id').eq('id', id);
        if (verified.error || !verified.data || verified.data.length) {
          throw new Error('카드 삭제 결과를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.', { cause: result.error });
        }
      }
      snapshots.delete(id);
      await cleanup();
    },
    close() { closed = true; snapshots.clear(); },
  };
}

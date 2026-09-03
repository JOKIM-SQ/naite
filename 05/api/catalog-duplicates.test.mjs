import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoDuplicateAsins, duplicateAsins } from './catalog-duplicates.mjs';

test('이미 저장된 ASIN만 한 번씩 찾아낸다', () => {
  assert.deepEqual(duplicateAsins(['B000000001', 'B000000002', 'B000000001'], ['B000000002', 'B000000003']), ['B000000002']);
});

test('중복 ASIN이 있으면 저장 전에 거부한다', () => {
  assert.doesNotThrow(() => assertNoDuplicateAsins(['B000000001'], ['B000000002']));
  assert.throws(() => assertNoDuplicateAsins(['B000000001'], ['B000000001']), /이미 저장된 ASIN/);
});

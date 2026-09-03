import assert from 'node:assert/strict';
import test from 'node:test';

import { allSelectableVariantsSelected, selectableVariantAsins, toggleAllSelectableVariants } from './variant-selection.mjs';

const variants = [
  { asin: 'B000000001', selected: false },
  { asin: 'B000000002', selected: false },
  { asin: 'B000000001', selected: false },
  { asin: 'B000000003', selected: true },
];

test('현재 탭에서 저장 가능한 ASIN만 고유하게 고른다', () => {
  assert.deepEqual(selectableVariantAsins(variants), ['B000000001', 'B000000002']);
});

test('현재 탭의 전체 선택과 해제는 다른 탭의 선택을 보존한다', () => {
  const selected = new Set(['B000000009']);
  const selectedAll = toggleAllSelectableVariants(selected, variants);
  assert.deepEqual([...selectedAll].sort(), ['B000000001', 'B000000002', 'B000000009']);
  assert.equal(allSelectableVariantsSelected(selectedAll, variants), true);
  assert.deepEqual([...toggleAllSelectableVariants(selectedAll, variants)], ['B000000009']);
});

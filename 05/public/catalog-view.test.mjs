import assert from 'node:assert/strict';
import test from 'node:test';

import { isDashboardView } from './catalog-view.mjs';

test('전체 제품 필터에서만 대시보드를 표시한다', () => {
  assert.equal(isDashboardView({ category: null, model: null, color: null }), true);
  assert.equal(isDashboardView({ category: 'Samsung Galaxy', model: null, color: null }), false);
  assert.equal(isDashboardView({ category: 'Apple iPhone', model: 'iPhone 17 Pro', color: null }), false);
  assert.equal(isDashboardView({ category: 'Apple iPhone', model: 'iPhone 17 Pro', color: 'Clear' }), false);
});

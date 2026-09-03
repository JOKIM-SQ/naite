import assert from 'node:assert/strict';
import test from 'node:test';

import { deviceCategory } from './device-category.mjs';

test('호환 기기명을 아카이브 카테고리로 분류한다', () => {
  assert.equal(deviceCategory('iPhone 17 Pro Max'), 'Apple iPhone');
  assert.equal(deviceCategory('Galaxy S25 Ultra'), 'Samsung Galaxy');
  assert.equal(deviceCategory('Google Pixel 10 Pro'), 'Google Pixel');
  assert.equal(deviceCategory('Nothing Phone 3'), 'Etc');
});

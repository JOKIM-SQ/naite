import assert from 'node:assert/strict';
import test from 'node:test';

import { deviceColorSelections } from './catalog-expansion.mjs';

test('선택한 기기의 모든 색상 ASIN을 저장 대상으로 확장한다', () => {
  assert.deepEqual(deviceColorSelections({
    currentDevice: 'Galaxy Z Flip 7',
    colorVariants: [
      { asin: 'B0FVN7LPVJ', label: 'Black Sesame' },
      { asin: 'B0FVNKST47', label: 'Avo Green' },
      { asin: 'B0F1BXGPCF', label: 'Blueberry Navy' },
    ],
  }), [
    { asin: 'B0FVN7LPVJ', expectedColor: 'Black Sesame', expectedDevice: 'Galaxy Z Flip 7' },
    { asin: 'B0FVNKST47', expectedColor: 'Avo Green', expectedDevice: 'Galaxy Z Flip 7' },
    { asin: 'B0F1BXGPCF', expectedColor: 'Blueberry Navy', expectedDevice: 'Galaxy Z Flip 7' },
  ]);
});

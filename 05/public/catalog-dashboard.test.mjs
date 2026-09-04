import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogMetrics, catalogDistribution } from './catalog-dashboard.mjs';

const entries = [
  { product: { id: 'p1' }, device: { modelName: 'Galaxy Z Flip 7' }, option: { asin: 'A1', colorName: 'Black Sesame' } },
  { product: { id: 'p1' }, device: { modelName: 'Galaxy Z Flip 7' }, option: { asin: 'A2', colorName: 'Avo Green' } },
  { product: { id: 'p1' }, device: { modelName: 'Galaxy Z Flip 8' }, option: { asin: 'A3', colorName: 'Black Sesame' } },
  { product: { id: 'p2' }, device: { modelName: 'iPhone 17 Pro' }, option: { asin: 'A4', colorName: 'Clear' } },
];

test('카탈로그 KPI는 실제 저장된 ASIN과 관계 수를 고유하게 집계한다', () => {
  assert.deepEqual(catalogMetrics(entries), {
    asins: 4,
    products: 2,
    devices: 3,
    colors: 3,
  });
});

test('파이 차트 분포는 상위 항목과 기타를 합산한다', () => {
  assert.deepEqual(catalogDistribution(entries, (entry) => entry.device.modelName, 2), [
    { label: 'Galaxy Z Flip 7', value: 2 },
    { label: 'Galaxy Z Flip 8', value: 1 },
    { label: '기타', value: 1 },
  ]);
});

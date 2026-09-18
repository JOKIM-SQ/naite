import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, categoryOf, formatAmount } from './receipt-dashboard.mjs';

const now = new Date('2026-09-18T00:30:00Z');
const receipt = (id, overrides = {}, status = 'ready') => ({
  id, fileName: `${id}.jpg`, status, createdAt: '2026-09-18T00:00:00Z',
  values: { merchant: '마트', date: '2026-09-16', total: 10, currency: 'USD', category: '장보기', ...overrides },
  original: { total: 999 },
});

test('빈 기록은 실제 0과 비어 있는 6개월 분포를 보여준다', () => {
  const data = buildDashboard([], { now });
  assert.deepEqual(data.kpis, { total: 0, processedCount: 0, monthTotal: 0, average: 0 });
  assert.equal(data.monthly.length, 6);
  assert.equal(data.monthly[0].month, '2026-04');
  assert.equal(data.monthly[5].month, '2026-09');
  assert.equal(data.categories.every(item => item.total === 0 && item.share === 0), true);
  assert.deepEqual(data.filtered, []);
});

test('수정된 값으로 계산하고 실패·분석중·삭제중 기록을 지출에서 제외한다', () => {
  const rows = [receipt('a', { total: 12.5 }), receipt('b', { total: 0 }), receipt('c', { total: 90 }, 'failed'), receipt('d', {}, 'processing'), receipt('e', {}, 'deleting')];
  const data = buildDashboard(rows, { now });
  assert.deepEqual(data.kpis, { total: 12.5, processedCount: 2, monthTotal: 12.5, average: 6.25 });
  assert.equal(data.filtered.length, 5);
  assert.equal(data.counts.all, 5);
});

test('서로 다른 통화와 단위 미확인 금액을 합치지 않고 선택별로 계산한다', () => {
  const rows = [receipt('a'), receipt('b', { total: 20 }), receipt('c', { total: 5000, currency: 'KRW' }), receipt('d', { total: 800, currency: null })];
  const data = buildDashboard(rows, { now });
  assert.equal(data.currency, 'USD');
  assert.equal(data.kpis.total, 30);
  assert.equal(data.kpis.processedCount, 4);
  assert.equal(data.filtered.length, 4, '통화 선택 때문에 업로드한 영수증 카드가 사라지면 안 된다');
  assert.equal(data.amountCount, 2);
  assert.equal(data.currencies.length, 3);
  assert.equal(buildDashboard(rows, { now, currency: 'KRW' }).kpis.total, 5000);
  assert.equal(buildDashboard(rows, { now, currency: 'UNKNOWN' }).kpis.total, 800);
});

test('카테고리·월·검색은 함께 적용하며 사이드바 개수는 전체 기록 기준이다', () => {
  const rows = [receipt('a', { merchant: 'Ralphs', total: 14.15 }), receipt('b', { merchant: 'Ralphs', date: '2026-08-16' }), receipt('c', { merchant: 'Cafe', category: '외식' })];
  const data = buildDashboard(rows, { now, view: '장보기', month: '2026-09', search: ' RALPHS ' });
  assert.deepEqual(data.filtered.map(row => row.id), ['a']);
  assert.equal(data.kpis.total, 14.15);
  assert.equal(data.counts['장보기'], 2);
  assert.equal(data.counts['외식'], 1);
  assert.deepEqual(data.months, ['2026-09', '2026-08']);
  assert.equal(data.monthly.find(item => item.month === '2026-08').total, 10);
});

test('유효하지 않은 날짜는 월 집계에 넣지 않고 업로드 날짜로 대체하지 않는다', () => {
  const rows = [receipt('a', { date: null }), receipt('b', { date: '2026-02-30' }), receipt('c', { date: '2026-09-16', total: null })];
  const data = buildDashboard(rows, { now });
  assert.equal(data.kpis.total, 20);
  assert.equal(data.kpis.processedCount, 3);
  assert.equal(data.kpis.monthTotal, 0);
  assert.equal(data.unknownAmountCount, 1);
  assert.equal(data.unknownDateCount, 2);
  assert.equal(data.monthly.every(item => item.total === 0), true);
  assert.equal(buildDashboard(rows, { now, month: '2026-09' }).filtered.length, 1);
});

test('기존 분류 없는 기록은 그 외로 묶고 원본 객체를 변경하지 않는다', () => {
  const row = receipt('legacy', { category: undefined });
  const before = structuredClone(row);
  assert.equal(categoryOf(row), '그 외');
  assert.equal(buildDashboard([row], { now, view: '그 외' }).categories[3].total, 10);
  assert.deepEqual(row, before);
});

test('카테고리 분포의 합계와 비율은 같은 범위의 총 지출과 일치한다', () => {
  const rows = [receipt('a', { category: '쇼핑', total: 10 }), receipt('b', { category: '외식', total: 30 })];
  const data = buildDashboard(rows, { now });
  assert.equal(data.categories.find(item => item.value === '쇼핑').share, 0.25);
  assert.equal(data.categories.find(item => item.value === '외식').share, 0.75);
  assert.equal(data.categories.reduce((sum, item) => sum + item.total, 0), data.kpis.total);
});

test('연도 경계를 넘는 월별 집계가 날짜의 월을 그대로 유지한다', () => {
  const rows = [receipt('a', { date: '2025-12-31', total: 7 }), receipt('b', { date: '2026-01-01', total: 3 })];
  const data = buildDashboard(rows, { now: new Date(2026, 0, 1, 12) });
  assert.equal(data.monthly.at(-2).month, '2025-12');
  assert.equal(data.monthly.at(-2).total, 7);
  assert.equal(data.monthly.at(-1).total, 3);
});

test('미확인·음수·무한 금액은 지출에서 제외하며 0.1+0.2는 0.3으로 집계한다', () => {
  const rows = [receipt('a', { total: 0.1 }), receipt('b', { total: 0.2 }), receipt('c', { total: -1 }), receipt('d', { total: Infinity })];
  const data = buildDashboard(rows, { now });
  assert.equal(data.kpis.total, 0.3);
  assert.equal(data.unknownAmountCount, 2);
  assert.equal(formatAmount(null), '—');
  assert.match(formatAmount(0), /0/);
  assert.match(formatAmount(14.15, 'USD'), /14\.15/);
});

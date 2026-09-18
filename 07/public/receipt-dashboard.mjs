export const CATEGORIES = Object.freeze([
  { value: '쇼핑', label: '쇼핑', color: '#8a92b2' },
  { value: '장보기', label: '장보기', color: '#719783' },
  { value: '외식', label: '외식', color: '#c79a75' },
  { value: '그 외', label: '그 외', color: '#a6aaa0' },
].map(Object.freeze));

const categoryNames = new Set(CATEGORIES.map(item => item.value));
const currencyNames = new Set(Intl.supportedValuesOf('currency'));
const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const cleanSum = rows => Number(rows.reduce((sum, row) => sum + row.values.total, 0).toFixed(8));
const currencyOf = row => currencyNames.has(row.values?.currency) ? row.values.currency : 'UNKNOWN';
const monthOf = row => {
  const value = row.values?.date;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value.slice(0, 7) : null;
};
const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, '0')}`;

export const categoryOf = receipt => categoryNames.has(receipt.values?.category) ? receipt.values.category : '그 외';

export function formatAmount(value, currency = null) {
  if (!validAmount(value)) return '—';
  const options = currencyNames.has(currency)
    ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
    : { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('ko-KR', options).format(value);
}

export function buildDashboard(receipts, { view = 'dashboard', month = 'all', currency = null, search = '', now = new Date() } = {}) {
  const counts = Object.fromEntries([['all', receipts.length], ...CATEGORIES.map(item => [item.value, 0])]);
  for (const row of receipts) counts[categoryOf(row)] += 1;
  const months = [...new Set(receipts.map(monthOf).filter(Boolean))].sort().reverse();
  const query = search.trim().toLocaleLowerCase();
  const scoped = receipts.filter(row => (!categoryNames.has(view) || categoryOf(row) === view)
    && (!query || `${row.values?.merchant || ''} ${row.fileName || ''} ${categoryOf(row)}`.toLocaleLowerCase().includes(query)));
  const currencyCounts = new Map();
  for (const row of scoped.filter(row => row.status === 'ready')) {
    const key = currencyOf(row);
    currencyCounts.set(key, (currencyCounts.get(key) || 0) + 1);
  }
  const currencies = [...currencyCounts].map(([value, count]) => ({ value, label: value === 'UNKNOWN' ? '단위 미확인' : value, count }))
    .sort((a, b) => (a.value === 'UNKNOWN') - (b.value === 'UNKNOWN') || b.count - a.count || a.value.localeCompare(b.value));
  const chosenCurrency = currencies.some(item => item.value === currency) ? currency : currencies[0]?.value || 'UNKNOWN';
  const currencyScoped = scoped.filter(row => row.status !== 'ready' || currencyOf(row) === chosenCurrency);
  // Currency selects a monetary unit for charts, never hides uploaded cards.
  const filtered = scoped.filter(row => month === 'all' || monthOf(row) === month);
  const ready = filtered.filter(row => row.status === 'ready');
  const monetaryRows = ready.filter(row => currencyOf(row) === chosenCurrency);
  const amounts = monetaryRows.filter(row => validAmount(row.values?.total));
  const total = cleanSum(amounts);
  const currentMonth = monthKey(now.getFullYear(), now.getMonth());
  const chartAnchor = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : currentMonth;
  const [year, lastMonth] = chartAnchor.split('-').map(Number);
  const chartRows = currencyScoped.filter(row => row.status === 'ready' && validAmount(row.values?.total));
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, lastMonth - 1 - (5 - index), 1));
    const key = monthKey(date.getUTCFullYear(), date.getUTCMonth());
    const rows = chartRows.filter(row => monthOf(row) === key);
    return { month: key, label: `${date.getUTCMonth() + 1}월`, total: cleanSum(rows), count: rows.length };
  });
  const categories = CATEGORIES.map(item => {
    const rows = amounts.filter(row => categoryOf(row) === item.value);
    const value = cleanSum(rows);
    return { ...item, total: value, count: rows.length, share: total ? value / total : 0 };
  });
  return {
    filtered, counts, currencies, currency: chosenCurrency, months, monthly, categories, amountCount: amounts.length,
    kpis: { total, processedCount: ready.length, monthTotal: cleanSum(amounts.filter(row => monthOf(row) === currentMonth)), average: amounts.length ? Number((total / amounts.length).toFixed(8)) : 0 },
    unknownAmountCount: monetaryRows.length - amounts.length,
    unknownDateCount: monetaryRows.filter(row => !monthOf(row)).length,
  };
}

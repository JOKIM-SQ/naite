export const DASHBOARD_COLORS = ['#1b5547', '#6ca38a', '#bdc95a', '#e88f78', '#91a99c', '#5f776d'];

export function catalogMetrics(entries = []) {
  return {
    asins: new Set(entries.map((entry) => entry.option?.asin).filter(Boolean)).size,
    products: new Set(entries.map((entry) => entry.product?.id).filter(Boolean)).size,
    devices: new Set(entries.map((entry) => entry.device?.modelName).filter(Boolean)).size,
    colors: new Set(entries.map((entry) => entry.option?.colorName).filter(Boolean)).size,
  };
}

export function catalogDistribution(entries = [], accessor, limit = 5) {
  const counts = new Map();
  entries.forEach((entry) => {
    const label = String(accessor(entry) || '기타').trim() || '기타';
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  const ranked = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ko'));
  if (ranked.length <= limit) return ranked;
  const remainder = ranked.slice(limit).reduce((total, item) => total + item.value, 0);
  return [...ranked.slice(0, limit), { label: '기타', value: remainder }];
}

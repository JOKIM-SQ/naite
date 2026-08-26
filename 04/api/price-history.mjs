export const priceCents = (value) => {
  const match = String(value || '').match(/\$\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  return (Number(match[1].replaceAll(',', '')) * 100) + Number((match[2] || '').padEnd(2, '0'));
};

export const priceDirection = (previous, current) => previous === null || previous === current ? 0 : current > previous ? 1 : -1;
export const ratingDirection = (previous, current) => previous === null || current === null || previous === current ? 0 : current > previous ? 1 : -1;

export const summarizeHistory = (history) => {
  if (!history.length) return { lowest: null, highest: null, current: null, average: null };
  const prices = history.map((entry) => entry.priceCents);
  return {
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    current: prices.at(-1),
    average: Math.round(prices.reduce((total, value) => total + value, 0) / prices.length),
  };
};

const periodDays = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 };

export const filterHistory = (history, period, now = new Date()) => {
  if (period === 'all' || !periodDays[period]) return history;
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - periodDays[period]);
  return history.filter((entry) => new Date(entry.checkedAt) >= cutoff);
};

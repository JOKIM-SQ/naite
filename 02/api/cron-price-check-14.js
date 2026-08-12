export default async function handler(req, res) {
  const { default: priceCheck } = await import('./price-check.mjs');
  return priceCheck(req, res);
}

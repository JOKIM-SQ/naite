const SPIGEN = /(^|\W)spigen(\W|$)/i;
const PHONE_ACCESSORIES_CATEGORY = /\bcell phones?\s*(?:&|and)\s*accessories\b/i;
const CASE_CATEGORY = /\b(?:cell phone cases|cases?\s*,\s*holsters?\s*(?:&|and)\s*sleeves?)\b/i;

export function catalogIneligibility(snapshot) {
  const brandAndTitle = `${snapshot.brand || ''} ${snapshot.title || ''}`;
  if (!SPIGEN.test(brandAndTitle)) return 'Spigen에서 판매하는 상품만 Case Archive에 저장할 수 있습니다.';

  const categoryText = snapshot.categoryText || '';
  if (!PHONE_ACCESSORIES_CATEGORY.test(categoryText) || !CASE_CATEGORY.test(categoryText)) return 'Amazon 카테고리가 휴대폰 케이스인 상품만 Case Archive에 저장할 수 있습니다.';
  return null;
}

export function assertCatalogEligible(snapshot) {
  const message = catalogIneligibility(snapshot);
  if (message) throw new Error(message);
}

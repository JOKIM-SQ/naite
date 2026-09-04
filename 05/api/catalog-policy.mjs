const SPIGEN = /(^|\W)spigen(\W|$)/i;
const CASE = /\b(case|cover|bumper|shell)\b/i;
const PHONE = /\b(iphone|samsung|galaxy|pixel|phone|smartphone|mobile)\b/i;
const SPIGEN_CASE_LINE = /\b(ultra\s+hybrid|liquid\s+air|tough\s+armor|rugged\s+armor|slim\s+armor|thin\s+fit|core\s+armor|neo\s+hybrid|parallax|mag\s*armor|optik\s+armor|classic\s+c1)\b/i;

export function catalogIneligibility(snapshot) {
  const brandAndTitle = `${snapshot.brand || ''} ${snapshot.title || ''}`;
  if (!SPIGEN.test(brandAndTitle)) return 'Spigen에서 판매하는 상품만 Case Archive에 저장할 수 있습니다.';

  const productContext = `${snapshot.title || ''} ${snapshot.currentDevice || ''} ${snapshot.categoryText || ''}`;
  if ((!CASE.test(productContext) && !SPIGEN_CASE_LINE.test(productContext)) || !PHONE.test(productContext)) return '휴대폰 케이스 카테고리 상품만 Case Archive에 저장할 수 있습니다.';
  return null;
}

export function assertCatalogEligible(snapshot) {
  const message = catalogIneligibility(snapshot);
  if (message) throw new Error(message);
}

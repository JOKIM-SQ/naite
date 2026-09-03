export const DEVICE_CATEGORIES = ['Apple iPhone', 'Samsung Galaxy', 'Google Pixel', 'Etc'];

export function deviceCategory(deviceName) {
  const value = String(deviceName || '');
  if (/\biphone\b/i.test(value)) return 'Apple iPhone';
  if (/\b(samsung|galaxy)\b/i.test(value)) return 'Samsung Galaxy';
  if (/\b(google|pixel)\b/i.test(value)) return 'Google Pixel';
  return 'Etc';
}

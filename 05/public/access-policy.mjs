const SPIGEN_EMAIL = /^[^@\s]+@spigen\.com$/i;
const ACCESS_ALLOWLIST = new Set(['jayoo0621@gmail.com']);

export function isCatalogMemberEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return SPIGEN_EMAIL.test(normalized) || ACCESS_ALLOWLIST.has(normalized);
}

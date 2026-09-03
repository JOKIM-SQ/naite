const SPIGEN_EMAIL = /^[^@\s]+@spigen\.com$/i;

export function isSpigenEmail(email) {
  return SPIGEN_EMAIL.test(String(email || ''));
}

export function assertSpigenMember(user) {
  if (!isSpigenEmail(user?.email)) {
    throw new Error('Spigen 이메일(@spigen.com)로만 접근할 수 있습니다.');
  }
}

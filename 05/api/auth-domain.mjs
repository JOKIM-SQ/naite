import { isCatalogMemberEmail } from '../public/access-policy.mjs';

export function isSpigenEmail(email) {
  return isCatalogMemberEmail(email);
}

export function assertSpigenMember(user) {
  if (!isSpigenEmail(user?.email)) {
    throw new Error('Spigen 이메일 또는 허용된 계정으로만 접근할 수 있습니다.');
  }
}

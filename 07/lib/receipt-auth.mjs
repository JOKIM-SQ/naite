import { ReceiptError } from './receipt-values.mjs';

export const isUserId = (value) => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);

export async function authenticatedUserId({ authorization, url, key, fetchImpl, timeoutMs = 3000 }) {
  const token = typeof authorization === 'string' && authorization.length <= 16384 && /^Bearer ([^\s,]+)$/i.exec(authorization)?.[1];
  if (!token) throw new ReceiptError(401, '로그인이 필요합니다. 다시 로그인해 주세요.');
  if (![url, key].every((item) => typeof item === 'string' && item && !item.includes('[SENSITIVE]')) || !/^https:\/\//.test(url)) {
    throw new ReceiptError(503, '서버 인증 서비스 연결 설정이 필요합니다.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${new URL(url).origin}/auth/v1/user`, {
      method: 'GET', headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: controller.signal, redirect: 'error', cache: 'no-store',
    });
    if ([400, 401, 403, 422].includes(response.status)) throw new ReceiptError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (!response.ok) throw new Error('Authentication service unavailable');
    const user = await response.json();
    if (!isUserId(user?.id)) throw new Error('Invalid authenticated user');
    if (user.is_anonymous === true) throw new ReceiptError(401, '계정으로 로그인해 주세요.');
    return user.id;
  } catch (error) {
    if (error instanceof ReceiptError) throw error;
    throw new ReceiptError(502, '로그인 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  } finally { clearTimeout(timer); }
}

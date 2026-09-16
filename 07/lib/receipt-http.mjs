import { ReceiptError } from './receipt-values.mjs';

// The timer remains active while the response body is read, too.
export async function remoteRequest(fetchImpl, url, options, { timeoutMs = 8000, binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error('Remote request failed');
    return binary ? Buffer.from(await response.arrayBuffer()) : await response.json();
  } catch {
    throw new ReceiptError(502, '외부 서비스 요청에 실패했습니다. 잠시 뒤 다시 시도해 주세요.');
  } finally { clearTimeout(timer); }
}

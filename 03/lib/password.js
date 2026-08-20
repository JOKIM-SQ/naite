// bcryptjs는 Vercel Edge 번들링에서 깨져서, Edge 런타임에 내장된 Web Crypto(PBKDF2)로 직접 해시한다.
const ITERATIONS = 100_000;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function derive(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${hash}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterationsRaw, saltHex, hashHex] = String(stored || '').split(':');
  if (scheme !== 'pbkdf2' || !iterationsRaw || !saltHex || !hashHex) return false;
  const iterations = parseInt(iterationsRaw, 10);
  const computed = await derive(password, fromHex(saltHex), iterations);
  return computed === hashHex;
}

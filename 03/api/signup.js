export const config = { runtime: 'edge' };

import { hashPassword } from '../lib/password.js';
import { pgFetch } from '../lib/db.js';

export default async function handler(request) {
  try {
    return await route(request);
  } catch (error) {
    return Response.json({ message: 'DB 연결에 실패했다: ' + error.message }, { status: 502 });
  }
}

async function route(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { email, password } = await request.json().catch(() => ({}));
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !password || password.length < 6) {
    return Response.json({ message: '이메일과 6자 이상 비밀번호를 입력해줘.' }, { status: 400 });
  }

  const existing = await pgFetch(`/s03_users?email=eq.${encodeURIComponent(normalizedEmail)}&select=id`);
  if (!existing.ok) return Response.json({ message: '가입 확인에 실패했다.' }, { status: 502 });
  if ((await existing.json()).length > 0) {
    return Response.json({ message: '이미 가입된 이메일이다.' }, { status: 409 });
  }

  const password_hash = await hashPassword(password);
  const inserted = await pgFetch('/s03_users', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ email: normalizedEmail, password_hash }),
  });
  if (!inserted.ok) {
    return Response.json({ message: '가입에 실패했다.' }, { status: 502 });
  }
  return Response.json({ message: '가입 완료. 로그인해줘.' });
}

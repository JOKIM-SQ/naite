export const config = { runtime: 'edge' };

import { getToken } from '@auth/core/jwt';
import { pgFetch } from '../lib/db.js';

async function currentUser(request) {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.url.startsWith('https://'),
  });
  return token?.sub ? { id: token.sub, email: token.email } : null;
}

export default async function handler(request) {
  try {
    return await route(request);
  } catch (error) {
    return Response.json({ message: 'DB 연결에 실패했다: ' + error.message }, { status: 502 });
  }
}

async function route(request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ message: '로그인이 필요하다.' }, { status: 401 });

  if (request.method === 'GET') {
    const [ideasRes, votesRes] = await Promise.all([
      pgFetch('/s03_ideas?select=id,title,author_id,created_at&order=created_at.desc'),
      pgFetch('/s03_votes?select=id,idea_id,voter_id'),
    ]);
    if (!ideasRes.ok || !votesRes.ok) return Response.json({ message: '목록을 읽지 못했다.' }, { status: 502 });
    return Response.json({ ideas: await ideasRes.json(), votes: await votesRes.json(), myId: user.id });
  }

  if (request.method === 'POST') {
    const { title } = await request.json().catch(() => ({}));
    const trimmed = String(title || '').trim();
    if (!trimmed || trimmed.length > 120) return Response.json({ message: '제목을 1~120자로 입력해줘.' }, { status: 400 });
    const res = await pgFetch('/s03_ideas', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ title: trimmed, author_id: user.id }),
    });
    if (!res.ok) return Response.json({ message: '저장에 실패했다.' }, { status: 502 });
    return Response.json({ message: '등록했다.' });
  }

  if (request.method === 'PATCH' || request.method === 'DELETE') {
    const { id, title } = await request.json().catch(() => ({}));
    if (!id) return Response.json({ message: 'id가 필요하다.' }, { status: 400 });

    const ownedRes = await pgFetch(`/s03_ideas?id=eq.${encodeURIComponent(id)}&select=author_id`);
    const [owned] = await ownedRes.json();
    if (!owned || owned.author_id !== user.id) {
      return Response.json({ message: '본인 글만 수정·삭제할 수 있다.' }, { status: 403 });
    }

    if (request.method === 'DELETE') {
      const res = await pgFetch(`/s03_ideas?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) return Response.json({ message: '삭제에 실패했다.' }, { status: 502 });
      return Response.json({ message: '삭제했다.' });
    }

    const trimmed = String(title || '').trim();
    if (!trimmed || trimmed.length > 120) return Response.json({ message: '제목을 1~120자로 입력해줘.' }, { status: 400 });
    const res = await pgFetch(`/s03_ideas?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ title: trimmed, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) return Response.json({ message: '수정에 실패했다.' }, { status: 502 });
    return Response.json({ message: '수정했다.' });
  }

  return new Response('Method not allowed', { status: 405 });
}

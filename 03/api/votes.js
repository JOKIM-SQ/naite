export const config = { runtime: 'edge' };

import { getToken } from '@auth/core/jwt';
import { pgFetch } from '../lib/db.js';

const VOTE_LIMIT = 3;

export default async function handler(request) {
  try {
    return await route(request);
  } catch (error) {
    return Response.json({ message: 'DB 연결에 실패했다: ' + error.message }, { status: 502 });
  }
}

async function route(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.url.startsWith('https://'),
  });
  if (!token?.sub) return Response.json({ message: '로그인이 필요하다.' }, { status: 401 });

  const { ideaId } = await request.json().catch(() => ({}));
  if (!ideaId) return Response.json({ message: 'ideaId가 필요하다.' }, { status: 400 });

  const ideaRes = await pgFetch(`/s03_ideas?id=eq.${encodeURIComponent(ideaId)}&select=author_id`);
  const [idea] = await ideaRes.json();
  if (!idea) return Response.json({ message: '아이디어를 찾지 못했다.' }, { status: 404 });
  if (idea.author_id === token.sub) return Response.json({ message: '본인 글에는 투표할 수 없다.' }, { status: 403 });

  const myVotesRes = await pgFetch(`/s03_votes?voter_id=eq.${encodeURIComponent(token.sub)}&select=id`);
  const myVotes = await myVotesRes.json();
  if (myVotes.length >= VOTE_LIMIT) {
    return Response.json({ message: `계정당 최대 ${VOTE_LIMIT}표까지다.` }, { status: 403 });
  }

  const insertRes = await pgFetch('/s03_votes', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ idea_id: ideaId, voter_id: token.sub }),
  });
  if (insertRes.status === 409) return Response.json({ message: '이미 투표한 아이디어다.' }, { status: 409 });
  if (!insertRes.ok) return Response.json({ message: '투표에 실패했다.' }, { status: 502 });
  return Response.json({ message: '투표했다.' });
}

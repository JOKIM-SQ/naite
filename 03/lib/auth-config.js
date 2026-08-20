import Credentials from '@auth/core/providers/credentials';
import { verifyPassword } from './password.js';
import { pgFetch } from './db.js';

async function authorize(credentials) {
  const email = String(credentials?.email || '').trim().toLowerCase();
  const password = String(credentials?.password || '');
  if (!email || !password) return null;

  const res = await pgFetch(`/s03_users?email=eq.${encodeURIComponent(email)}&select=id,email,password_hash`);
  if (!res.ok) return null;
  const [user] = await res.json();
  if (!user) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return { id: user.id, email: user.email };
}

export const authConfig = {
  basePath: '/api/auth',
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      name: '이메일/비밀번호',
      credentials: { email: {}, password: {} },
      authorize,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.id = token.sub;
      return session;
    },
  },
};

// TEST ONLY: exercises the production API/UI with external HTTP responses replaced.
// Not deployed; simulated OAuth is not evidence of Google login, real Supabase
// persistence, or OCR accuracy. No production route imports this server.
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../api/receipts.mjs';
import { createTestService, testAccounts } from '../lib/test-support.mjs';
import { resolvePublicPath } from './dev.mjs';

const port = Number(process.env.PORT || 3071);
const local = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('../public/', import.meta.url));
const remote = createTestService();
const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_server_only', ANTHROPIC_API_KEY: 'sk-ant-test_server_only', NODE_ENV: 'development' };
let delayReads = 0;
let oauthAccount = 'a';
let oauthError = null;
const authCodes = new Map();
const refreshTokens = new Map();
const accessSessions = new Map();
const qaUsers = Object.fromEntries(Object.entries(testAccounts).map(([account, { id, accessToken }]) => [account, {
  ...remote.authUsers.get(accessToken), id, email: `qa-${account}@example.test`,
  user_metadata: { full_name: `QA 계정 ${account.toUpperCase()} · TEST ONLY`, name: `QA ${account.toUpperCase()}` },
}]));
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};
const authError = (res, errorCode, status = 400) => json(res, { error_code: errorCode, msg: `TEST ONLY: ${errorCode}` }, status);
const readJson = async req => {
  let text = ''; for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
};
const bearer = req => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];

function issueSession(account, sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const user = qaUsers[account];
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: `${local}/auth/v1`, sub: user.id, aud: 'authenticated', role: 'authenticated',
    email: user.email, iat: now, exp: now + 3600, session_id: sessionId,
    jti: randomUUID(), aal: 'aal1', is_anonymous: false,
  })).toString('base64url');
  const signature = createHmac('sha256', 'TEST ONLY — not a Supabase signing key').update(`${header}.${payload}`).digest('base64url');
  const accessToken = `${header}.${payload}.${signature}`;
  const refreshToken = `qa-refresh-${randomUUID()}`;
  remote.authUsers.set(accessToken, structuredClone(user));
  accessSessions.set(accessToken, { account, sessionId });
  refreshTokens.set(refreshToken, { account, sessionId });
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user: structuredClone(user) };
}

async function handleAuth(req, res, url) {
  if (remote.failAuth) { authError(res, 'qa_auth_unavailable', 503); return; }
  if (url.pathname === '/auth/v1/authorize' && req.method === 'GET') {
    const redirect = new URL(url.searchParams.get('redirect_to') || '/', local);
    const challenge = url.searchParams.get('code_challenge');
    const method = url.searchParams.get('code_challenge_method')?.toLowerCase();
    if (redirect.origin !== local || url.searchParams.get('provider') !== 'google' || !challenge || !['s256', 'plain'].includes(method)) {
      authError(res, 'bad_oauth_request'); return;
    }
    if (oauthError) {
      redirect.searchParams.set('error', oauthError);
      redirect.searchParams.set('error_description', 'TEST ONLY: simulated OAuth error');
    } else {
      const code = `qa-code-${randomUUID()}`;
      authCodes.set(code, { account: oauthAccount, challenge, method, expiresAt: Date.now() + 60000 });
      redirect.searchParams.set('code', code);
    }
    console.log(`TEST ONLY — simulated Google callback for QA account ${oauthAccount.toUpperCase()}${oauthError ? ' (error)' : ''}`);
    res.writeHead(302, { Location: redirect.href }); res.end(); return;
  }
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const body = await readJson(req);
    const grant = url.searchParams.get('grant_type');
    if (grant === 'pkce') {
      const code = authCodes.get(body.auth_code);
      authCodes.delete(body.auth_code);
      if (!code || code.expiresAt < Date.now()) { authError(res, 'flow_state_not_found'); return; }
      const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
      const challenge = code.method === 's256' ? createHash('sha256').update(verifier).digest('base64url') : verifier;
      if (!verifier || challenge !== code.challenge) { authError(res, 'bad_code_verifier'); return; }
      json(res, issueSession(code.account)); return;
    }
    if (grant === 'refresh_token') {
      const session = refreshTokens.get(body.refresh_token);
      refreshTokens.delete(body.refresh_token);
      if (!session) { authError(res, 'refresh_token_not_found'); return; }
      json(res, issueSession(session.account, session.sessionId)); return;
    }
    authError(res, 'unsupported_grant_type'); return;
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    const user = remote.authUsers.get(bearer(req));
    if (!user) { authError(res, 'bad_jwt', 401); return; }
    json(res, user); return;
  }
  if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
    const token = bearer(req);
    const session = accessSessions.get(token);
    if (!session) { authError(res, 'session_not_found', 401); return; }
    const scope = url.searchParams.get('scope') || 'global';
    if (!['local', 'global', 'others'].includes(scope)) { authError(res, 'invalid_scope'); return; }
    const matches = candidate => candidate.account === session.account && (scope === 'global' || (scope === 'local' ? candidate.sessionId === session.sessionId : candidate.sessionId !== session.sessionId));
    for (const [accessToken, candidate] of accessSessions) {
      if (matches(candidate)) { accessSessions.delete(accessToken); remote.authUsers.delete(accessToken); }
    }
    for (const [refreshToken, candidate] of refreshTokens) if (matches(candidate)) refreshTokens.delete(refreshToken);
    json(res, {}); return;
  }
  authError(res, 'unsupported_auth_route', 404);
}

const handler = createHandler({ env, fetchImpl: async (target, options = {}) => {
  if (delayReads && new URL(target).pathname.startsWith('/rest/v1/') && (!options.method || options.method === 'GET')) await new Promise(done => setTimeout(done, delayReads));
  return remote.fetch(target, options);
} });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-QA-Test-Only', 'simulated-auth-storage-ocr');
  try {
    const url = new URL(req.url, local);
    if (url.pathname === '/api/auth-config') {
      if (req.method !== 'GET') { json(res, { message: 'GET only' }, 405); return; }
      json(res, { url: local, publishableKey: 'sb_publishable_test_qa_only', provider: 'google', testOnly: true }); return;
    }
    if (url.pathname.startsWith('/auth/v1/')) { await handleAuth(req, res, url); return; }
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      const key = url.pathname.slice('/storage/v1/object/sign/'.length);
      const bytes = remote.objects.get(key);
      if (!bytes) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.end(bytes); return;
    }
    if (url.pathname === '/__qa/control' && req.method === 'POST') {
      const options = await readJson(req);
      if ('oauthAccount' in options) {
        const next = String(options.oauthAccount).toLowerCase();
        if (!Object.hasOwn(testAccounts, next)) { json(res, { message: 'TEST ONLY: oauthAccount must be A or B' }, 400); return; }
        oauthAccount = next;
      }
      if ('oauthError' in options) oauthError = options.oauthError ? String(options.oauthError) : null;
      if ('delayReads' in options) delayReads = Math.max(0, Math.min(2000, Number(options.delayReads) || 0));
      if ('failOcr' in options) remote.failOcr = Boolean(options.failOcr);
      if ('failStore' in options) remote.failStore = Boolean(options.failStore);
      if ('failAuth' in options) remote.failAuth = Boolean(options.failAuth);
      json(res, { testOnly: true, oauthAccount: oauthAccount.toUpperCase(), oauthError, delayReads }); return;
    }
    if (url.pathname === '/api/receipts') {
      let text = ''; for await (const chunk of req) text += chunk;
      req.body = text ? JSON.parse(text) : {};
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => {
        const rewrite = receipt => {
          if (receipt?.imageUrl) receipt.imageUrl = receipt.imageUrl.replace(env.SUPABASE_URL, local);
        };
        body.receipts?.forEach(rewrite); rewrite(body.receipt);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res;
      };
      await handler(req, res); return;
    }
    const path = resolvePublicPath(req.url);
    if (!path) { res.writeHead(404).end(); return; }
    const bytes = await readFile(resolve(root, path));
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('QA fixture error'); }
}).listen(port, '127.0.0.1', () => console.log(`TEST ONLY — production UI/API, simulated Google OAuth, fake Supabase/OCR: ${local}`));

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const modulePath = new URL('../scripts/dev.mjs', import.meta.url);

test('public routes reject traversal, hidden files, and malformed escapes', async () => {
  assert.ok(existsSync(modulePath), 'S09 public server has not been implemented');
  const { resolvePublicPath } = await import(modulePath.href);
  assert.equal(resolvePublicPath('/'), 'index.html');
  assert.equal(resolvePublicPath('/docs/plan.html?v=1'), 'docs/plan.html');
  for (const route of ['/../CLAUDE.md', '/..%2fCLAUDE.md', '/.env', '/a\\b', '/%00', '/%bad']) {
    assert.equal(resolvePublicPath(route), null, route);
  }
});

test('HTTP rejects non-read methods and private paths', async () => {
  assert.ok(existsSync(modulePath), 'S09 public server has not been implemented');
  const { startServer } = await import(modulePath.href);
  const server = startServer(0);
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${origin}/..%2fCLAUDE.md`)).status, 404);
    assert.equal((await fetch(`${origin}/.env.local`)).status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

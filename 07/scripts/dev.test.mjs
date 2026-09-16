import test from 'node:test';
import assert from 'node:assert/strict';

// A traversal bug must not expose environment files outside public/.
test('static path resolution rejects traversal and serves the index', async () => {
  const { resolvePublicPath } = await import('./dev.mjs');
  assert.equal(resolvePublicPath('/'), 'index.html');
  assert.equal(resolvePublicPath('/docs/plan.html?x=1'), 'docs/plan.html');
  assert.equal(resolvePublicPath('/%2e%2e/.env.local'), null);
  assert.equal(resolvePublicPath('/%2e%2e%2f.env.local'), null);
  assert.equal(resolvePublicPath('/.env.local'), null);
  assert.equal(resolvePublicPath('/%'), null);
});

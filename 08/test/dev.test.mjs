import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicPath } from '../scripts/dev.mjs';

test('local server never exposes dotfiles, traversal, or malformed URL paths', () => {
  for (const path of ['/.env.local', '/../SUPABASE.sql', '/%2e%2e/package.json', '/vendor/../../.env', '/%00', '/%QQ', '/a\\..\\.env']) {
    assert.equal(resolvePublicPath(path), null, path);
  }
  assert.equal(resolvePublicPath('/?code=auth-code'), 'index.html');
  assert.equal(resolvePublicPath('/docs/plan.html'), 'docs/plan.html');
});

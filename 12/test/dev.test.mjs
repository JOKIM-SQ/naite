import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/dev.mjs';

// Detects the wrong static root, broken document URLs, and files outside public leaking.
test('dev server serves its public root and docs, rejecting traversal and writes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'weeknote-dev-'));
  const root = join(dir, 'public');
  await mkdir(join(root, 'docs'), {recursive: true});
  await writeFile(join(root, 'index.html'), '<title>Weeknote</title>');
  await writeFile(join(root, 'docs', 'plan.html'), '<title>계획</title>');
  await writeFile(join(dir, 'secret.txt'), 'outside public');
  const server = createStaticServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, {recursive: true, force: true});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.equal(await home.text(), '<title>Weeknote</title>');
  assert.equal(await (await fetch(`${base}/docs/plan.html`)).text(), '<title>계획</title>');
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e%2fsecret.txt`)).status, 403);
  assert.equal((await fetch(base, {method: 'POST'})).status, 405);
});

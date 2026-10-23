import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDevelopmentEnv } from '../scripts/development.mjs';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
it('local S11 credentials override previous-week credentials without forwarding Node env flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 's11-env-test-')); dirs.push(dir);
  mkdirSync(join(dir, '07')); mkdirSync(join(dir, '11'));
  writeFileSync(join(dir, '07/.env.local'), 'SUPABASE_URL=https://example.test\nVERCEL_OIDC_TOKEN=old\n');
  writeFileSync(join(dir, '11/.env.local'), 'VERCEL_OIDC_TOKEN=new\nINNGEST_EVENT_KEY=local-event\n');
  writeFileSync(join(dir, '11/.env.ai.local'), 'ANTHROPIC_API_KEY=test-only\n');
  const result = loadDevelopmentEnv(join(dir, '11'), { PATH: '/test' });
  expect(result.SUPABASE_URL).toBe('https://example.test');
  expect(result.VERCEL_OIDC_TOKEN).toBe('new');
  expect(result.ANTHROPIC_API_KEY).toBe('test-only');
  expect(result.INNGEST_DEV).toBe('1');
  expect(result.NODE_OPTIONS).toBeUndefined();
});
it('optional files and blank template values preserve an existing configured environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 's11-env-test-')); dirs.push(dir);
  writeFileSync(join(dir, '.env.ai.local'), 'ANTHROPIC_API_KEY=\n');
  const result = loadDevelopmentEnv(dir, { ANTHROPIC_API_KEY: 'test-only-existing' });
  expect(result.ANTHROPIC_API_KEY).toBe('test-only-existing');
  expect(result.INNGEST_DEV).toBe('1');
});

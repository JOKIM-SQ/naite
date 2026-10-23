import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/** @param {string} root @param {Record<string, string | undefined>} base */
export function loadDevelopmentEnv(root, base = process.env) {
  const env = { ...base };
  for (const file of ['../07/.env.local', '.env.local', '.env.ai.local']) {
    let text;
    try { text = readFileSync(resolve(root, file), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const [name, value] of Object.entries(parseEnv(text))) {
      if (value && value !== '[SENSITIVE]') env[name] = value;
    }
  }
  env.INNGEST_DEV = '1';
  return env;
}

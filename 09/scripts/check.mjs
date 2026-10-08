import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const directory of ['public', 'scripts', 'api']) {
  const root = new URL(`../${directory}/`, import.meta.url);
  for (const name of await readdir(root)) {
    if (!/\.m?js$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(name, root))], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
  }
}
console.log('JavaScript 구문 검사 통과');

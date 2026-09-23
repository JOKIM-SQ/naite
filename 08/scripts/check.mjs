import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

for (const dir of ['api', 'public', 'scripts', 'test']) {
  for (const file of readdirSync(dir).filter(name => /\.(mjs|js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript 구문 검사 통과');

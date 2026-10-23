import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadDevelopmentEnv } from './development.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'dev', '--hostname', '127.0.0.1', '--port', '3110'], { cwd: root, env: loadDevelopmentEnv(root), stdio: 'inherit' });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHandler } from '../api/config.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function resolvePublicPath(url) {
  let path;
  try { path = decodeURIComponent(url.split('?')[0]); } catch { return null; }
  if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part.startsWith('.'))) return null;
  return path === '/' ? 'index.html' : path.replace(/^\/+/, '');
}

export function startServer(port = Number(process.env.PORT || 3090), env = process.env) {
  const config = createHandler({ env });
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url?.split('?')[0] === '/api/config') { config(req, res); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const path = resolvePublicPath(req.url);
    if (!path) { res.writeHead(404).end('Not found'); return; }
    try {
      const content = await readFile(resolve(root, path));
      res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`S09 Chroma: http://127.0.0.1:${address.port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) console.log('사용법: npm run dev (기본 PORT=3090)');
  else startServer();
}

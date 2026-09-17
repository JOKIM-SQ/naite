import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extname, resolve } from 'node:path';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg' };

export function resolvePublicPath(url) {
  let path;
  try { path = decodeURIComponent(url.split('?')[0]); } catch { return null; }
  if (path.includes('\\') || path.split('/').some(part => part.startsWith('.')) || path.includes('\0')) return null;
  return path === '/' ? 'index.html' : path.replace(/^\/+/, '');
}

export function startServer(port = Number(process.env.PORT || 3070)) {
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const apiPath = req.url.split('?')[0];
    if (['/api/receipts', '/api/auth-config'].includes(apiPath)) {
      res.status = code => { res.statusCode = code; return res; };
      res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
      let bytes = 0;
      const chunks = [];
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 4.3 * 1024 * 1024) { res.status(413).json({ message: '사진은 한 장당 3MB 이하로 올려 주세요.' }); return; }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks).toString();
        try { req.body = body ? JSON.parse(body) : {}; }
        catch { res.status(400).json({ message: '요청 형식이 올바르지 않습니다.' }); return; }
        const { default: handler } = await import(apiPath === '/api/auth-config' ? '../api/auth-config.mjs' : '../api/receipts.mjs');
        await handler(req, res);
      } catch (error) {
        console.error('API 요청 실패:', error.name);
        if (!res.headersSent) res.status(500).json({ message: '요청을 처리하지 못했습니다.' });
        else res.end();
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const path = resolvePublicPath(req.url);
    if (!path) { res.writeHead(404).end('Not found'); return; }
    try {
      const content = await readFile(resolve(root, path));
      res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404).end('Not found'); }
  });
  server.listen(port, '127.0.0.1', () => console.log(`S07: http://127.0.0.1:${server.address().port}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--help')) console.log('사용법: npm run dev (PORT=3070 기본, .env.local 자동 로드)');
  else startServer();
}

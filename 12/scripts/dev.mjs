import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};

export function createStaticServer(root = publicRoot) {
  const base = resolve(root);
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {'allow': 'GET, HEAD'}).end();
      return;
    }
    let path;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      path = resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (!path.startsWith(base + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, {'content-type': types[extname(path)] ?? 'application/octet-stream'});
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStaticServer().listen(3120, '127.0.0.1', () => {
    console.log('Weeknote 소개 페이지: http://127.0.0.1:3120');
  });
}

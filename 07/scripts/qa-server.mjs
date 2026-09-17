// TEST ONLY: exercises the production API/UI with external HTTP responses replaced.
// Not deployed; not evidence of real Supabase persistence or OCR accuracy.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../api/receipts.mjs';
import { createTestService } from '../lib/test-support.mjs';
import { resolvePublicPath } from './dev.mjs';

const port = Number(process.env.PORT || 3071);
const local = `http://127.0.0.1:${port}`;
const root = fileURLToPath(new URL('../public/', import.meta.url));
const remote = createTestService();
const env = { SUPABASE_URL: 'https://receipts.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_server_only', ANTHROPIC_API_KEY: 'sk-ant-test_server_only', NODE_ENV: 'development' };
let delayReads = 0;
const handler = createHandler({ env, fetchImpl: async (target, options = {}) => {
  if (delayReads && new URL(target).pathname.startsWith('/rest/v1/') && (!options.method || options.method === 'GET')) await new Promise(done => setTimeout(done, delayReads));
  return remote.fetch(target, options);
} });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, local);
    if (url.pathname.startsWith('/storage/v1/object/sign/')) {
      const key = url.pathname.slice('/storage/v1/object/sign/'.length);
      const bytes = remote.objects.get(key);
      if (!bytes) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.end(bytes); return;
    }
    if (url.pathname === '/__qa/control' && req.method === 'POST') {
      let text = ''; for await (const chunk of req) text += chunk;
      const options = JSON.parse(text);
      if ('delayReads' in options) delayReads = Math.max(0, Math.min(2000, Number(options.delayReads) || 0));
      if ('failOcr' in options) remote.failOcr = Boolean(options.failOcr);
      if ('failStore' in options) remote.failStore = Boolean(options.failStore);
      res.setHeader('Content-Type', 'application/json'); res.end('{"testOnly":true}'); return;
    }
    if (url.pathname === '/api/receipts') {
      let text = ''; for await (const chunk of req) text += chunk;
      req.body = text ? JSON.parse(text) : {};
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => {
        const rewrite = receipt => {
          if (receipt?.imageUrl) receipt.imageUrl = receipt.imageUrl.replace(env.SUPABASE_URL, local);
        };
        body.receipts?.forEach(rewrite); rewrite(body.receipt);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res;
      };
      await handler(req, res); return;
    }
    const path = resolvePublicPath(req.url);
    if (!path) { res.writeHead(404).end(); return; }
    const bytes = await readFile(resolve(root, path));
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(bytes);
  } catch { if (!res.headersSent) res.writeHead(500); res.end('QA fixture error'); }
}).listen(port, '127.0.0.1', () => console.log(`TEST ONLY — production UI/API, fake external responses: ${local}`));

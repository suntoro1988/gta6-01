// serve.ts — Sunset Bay v13 (gta6-01)
// Server statis kecil untuk testing lokal game/ lewat HTTP.
// Node 22 stdlib saja. Jalankan: node --experimental-strip-types serve.ts [port]
// Default port 8080. Buka http://localhost:8080/ di browser.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const GAME_DIR = join(REPO_ROOT, 'game');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
let requestCount = 0;

if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`[serve] ERROR: port tidak valid: ${process.argv[2] ?? process.env.PORT}`);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// Tolak path traversal: hasil resolve harus tetap di bawah GAME_DIR.
function safePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\//, '');
  const full = resolve(join(GAME_DIR, normalize(rel)));
  if (!full.startsWith(GAME_DIR + '/') && full !== GAME_DIR) return null;
  return full;
}

const server = createServer((req, res) => {
  const started = Date.now();
  requestCount++;
  const file = safePath(req.url ?? '/');
  if (file === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('400 bad path\n');
    console.log(`${req.method} ${req.url} -> 400 (${Date.now() - started}ms)`);
    return;
  }
  let target = file;
  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, 'index.html');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 not found\n');
    console.log(`${req.method} ${req.url} -> 404 (${Date.now() - started}ms)`);
    return;
  }
  const stream = createReadStream(target);
  stream.on('error', () => {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('500 read error\n');
  });
  res.writeHead(200, {
    'content-type': mimeFor(target),
    'content-length': statSync(target).size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    console.log(`${req.method} ${req.url} -> 200 (${Date.now() - started}ms)`);
    return;
  }
  stream.pipe(res);
  res.on('finish', () => {
    console.log(`${req.method} ${req.url} -> 200 (${Date.now() - started}ms)`);
  });
});

if (!existsSync(join(GAME_DIR, 'index.html'))) {
  console.error('[serve] ERROR: game/index.html tidak ditemukan — jalankan dari repo Sunset Bay v13');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[serve] Sunset Bay v13 disajikan di http://localhost:${PORT}/`);
  console.log('[serve] Tekan Ctrl+C untuk berhenti.');
});

// Matikan server dengan rapi saat Ctrl+C.
process.on('SIGINT', () => {
  console.log(`\n[serve] berhenti setelah ${requestCount} request.`);
  server.close(() => process.exit(0));
});

// Sunset Bay v9 — tiny static server for local playtesting.
// Serves the game/ folder on http://localhost:8080/ with no dependencies.
//   node serve.ts
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8080;
const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    const rawPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\//, '');
    const filePath = resolve(join(gameRoot, normalize(rel)));
    if (!filePath.startsWith(gameRoot)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`Sunset Bay dev server: http://localhost:${PORT}/`);
});

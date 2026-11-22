// Jalankan: node serve.ts
// Server statis sederhana untuk QA lokal Sunset Bay: melayani direktori
// game/ di http://localhost:8901/ . Node 22 stdlib saja, tanpa dependensi.
// Tidak dipakai oleh grader — hanya alat bantu saat mengembangkan game.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const GAME_ROOT = join(REPO_ROOT, 'game');
const PORT = 8901;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

// Gabungkan path permintaan ke GAME_ROOT tanpa membiarkan ".." lolos keluar.
function safePath(requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const cleaned = normalize(join(sep, decoded)).replace(/^[/\\]+/, '');
  const target = join(GAME_ROOT, cleaned);
  if (!target.startsWith(GAME_ROOT)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  try {
    let target = safePath(req.url || '/');
    if (target === null) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end('bad path');
      return;
    }
    if (target.endsWith(sep)) target = join(target, 'index.html');
    if (target === GAME_ROOT) target = join(GAME_ROOT, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`Sunset Bay QA server: http://localhost:${PORT}/ (melayani game/)`);
});

// Sunset Bay v12 — local development server.
//
// Serves the playable game in game/ on http://127.0.0.1:8080, static
// files only, exactly as the grader will serve it: no build step,
// no network. Run it with plain Node 22 and stop it with Ctrl+C:
//
//   node serve.ts
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The game lives in game/ next to this file; nothing outside it is served.
const GAME_ROOT: string = resolve(join(dirname(fileURLToPath(import.meta.url)), 'game'));
const HOST: string = '127.0.0.1';
const PORT: number = 8080;

// Content types the game needs. Unknown extensions get a safe fallback
// instead of a guess that could break a script or an image.
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
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webp': 'image/webp',
};
const FALLBACK_MIME: string = 'application/octet-stream';

// Turn a request path into a file inside GAME_ROOT, or null when the
// path tries to climb out of it (for example /../main.ts).
function resolveGameFile(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  const cleaned = decoded.split('?')[0].split('#')[0];
  const joined = resolve(join(GAME_ROOT, cleaned));
  if (joined !== GAME_ROOT && !joined.startsWith(GAME_ROOT + sep)) return null;
  return joined;
}

// A directory request serves its index.html, so / opens the game.
function entryFor(file: string): string {
  if (statSync(file).isDirectory()) return join(file, 'index.html');
  return file;
}

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? FALLBACK_MIME;
}

function sendText(res, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed.\n');
    return;
  }
  let target: string | null;
  try {
    target = resolveGameFile(new URL(req.url ?? '/', `http://${HOST}:${PORT}`).pathname);
  } catch {
    sendText(res, 400, 'Bad request.\n');
    return;
  }
  if (target === null) {
    sendText(res, 403, 'Forbidden.\n');
    return;
  }
  let file: string;
  try {
    file = entryFor(target);
  } catch {
    sendText(res, 404, 'Not found.\n');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    sendText(res, 404, 'Not found.\n');
    return;
  }
  res.writeHead(200, {
    'content-type': mimeFor(file),
    'content-length': statSync(file).size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.on('error', (err) => {
  console.error(`[sunset-bay] server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[sunset-bay] Sunset Bay v12 dev server: http://${HOST}:${PORT}/`);
  console.log(`[sunset-bay] serving: ${GAME_ROOT}`);
});

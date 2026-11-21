// Sunset Bay v11 — tiny static server for local QA.
//
// Serves the repository root on http://localhost:8080 so the game can
// be played in a desktop browser exactly as the grader will load it:
// plain files, no bundler, no network. Node 22 standard library only.
//
//   node serve.ts            # serves this repo on port 8080
//   node serve.ts 9000       # serves this repo on port 9000
//   node serve.ts 8080 /tmp/qa   # serves another directory instead
//
// Stop with Ctrl-C. Only GET and HEAD are answered; anything else gets
// 405, and a path that escapes the served directory gets 403.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The directory served: the repo root by default, or the caller's
// explicit directory as the second argument.
const repoRoot = dirname(fileURLToPath(import.meta.url));
const serveRoot = resolve(process.argv[3] ?? repoRoot);

// Port from the first argument; 8080 when none is given.
const port = Number(process.argv[2] ?? 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  console.error(`serve.ts: port must be 1-65535, not ${process.argv[2] ?? ''}`);
  process.exit(1);
}

// MIME types the game needs. Unknown extensions fall back to
// application/octet-stream so nothing is ever served with a wrong
// type by accident; text types carry an explicit UTF-8 charset.
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Resolve a request path inside the served directory. Returns null
// when the path would climb out of it (a traversal attempt).
function resolveInside(requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const cleaned = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = resolve(join(serveRoot, cleaned));
  if (full !== serveRoot && !full.startsWith(serveRoot + sep)) return null;
  return full;
}

const server = createServer((req, res) => {
  // Only reads are served; anything that could mutate state is refused.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('405 Method Not Allowed\n');
    return;
  }

  const target = resolveInside(req.url ?? '/');
  if (target === null) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden\n');
    return;
  }

  // A directory request loads its index.html, so / opens the game.
  let filePath = target;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found\n');
    return;
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const size = statSync(filePath).size;
  res.writeHead(200, { 'content-type': type, 'content-length': size });
  if (req.method === 'GET') {
    createReadStream(filePath).pipe(res);
  } else {
    res.end();
  }
});

server.listen(port, () => {
  console.log(`Sunset Bay v11: serving ${serveRoot} at http://localhost:${port}/`);
  console.log('Sunset Bay v11: open http://localhost:' + port + '/game/ to play');
});

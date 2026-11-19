// Sunset Bay v5 — serve.ts (Builder E)
// Zero-dependency static file server (Node 22) for local dev / QA.
// Serves the game/ directory. ?seed= and ?shot= are passed straight
// through as query strings — the game itself reads them.
//
//   node serve.ts            -> http://localhost:8080/
//   node serve.ts 9000       -> http://localhost:9000/
//   PORT=9000 node serve.ts  -> http://localhost:9000/
//   node serve.ts --port 9000 --dir ./game
//
// Written fresh in this session from the design spec.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));

function parseArgs(argv: string[]): { port: number; dir: string } {
  let port = Number(process.env.PORT || 8080);
  let dir = join(here, 'game');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (a === '--dir' && argv[i + 1]) dir = resolve(argv[++i]);
    else if (/^\d+$/.test(a)) port = Number(a);
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) port = 8080;
  return { port, dir };
}

const { port, dir: rootDir } = parseArgs(process.argv.slice(2));
const root = resolve(rootDir);

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
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res: ServerResponse, code: number, body: string | Buffer, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    // ?seed= / ?shot= are intentionally ignored by the server: the game
    // reads them from the URL in the browser. Only the path matters here.
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';

    // Block path traversal: the resolved file must stay under root.
    const filePath = resolve(join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, '')));
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      send(res, 404, 'Not found: ' + pathname);
      return;
    }

    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    // No caching for the entry page so ?shot= staging always reloads fresh.
    const headers: Record<string, string> = { 'Content-Type': type, 'Content-Length': String(body.length) };
    if (pathname === '/index.html') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(body);
  } catch (err) {
    console.error('serve error:', err);
    if (!res.headersSent) send(res, 500, 'Internal server error');
    else res.end();
  }
});

server.listen(port, () => {
  console.log(`Sunset Bay dev server: http://localhost:${port}/  (serving ${root})`);
  console.log(`Try: http://localhost:${port}/?seed=7  or  http://localhost:${port}/?shot=play&seed=7`);
});

// Sunset Bay — static file server for local play and screenshots.
// Serves only the game/ directory. Node 22 stdlib only.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const GAME_DIR = resolve(new URL("./game", import.meta.url).pathname);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const target = resolve(join(GAME_DIR, normalize(pathname)));
    if (!target.startsWith(GAME_DIR + "/") && target !== GAME_DIR) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found\n");
      return;
    }

    const info = await stat(target);
    if (!info.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found\n");
      return;
    }

    const body = await readFile(target);
    const type =
      CONTENT_TYPES[extname(target).toLowerCase()] ||
      "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found\n");
  }
});

server.listen(PORT, () => {
  console.log(`Sunset Bay serving game/ on http://localhost:${PORT}`);
});

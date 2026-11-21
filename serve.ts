// Sunset Bay — tiny static file server for local playtesting.
// Serves the game/ folder on port 8080. Node 22, stdlib only.
//
// Usage:
//   node serve.ts
//   open http://localhost:8080/

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8080;
const LOG_PREFIX = "[sunset-bay]";

// The game/ folder sits next to this file.
const gameDir = resolve(
  fileURLToPath(new URL("./game", import.meta.url)),
);

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function mimeFor(filePath: string): string {
  return mimeTypes[extname(filePath).toLowerCase()] ??
    "application/octet-stream";
}

const server = createServer(async (request, response) => {
  try {
    const rawPath = decodeURIComponent(
      (request.url ?? "/").split("?")[0],
    );
    const requested = rawPath === "/" ? "/index.html" : rawPath;

    // Resolve inside gameDir and reject any path that escapes it.
    const target = resolve(join(gameDir, normalize(requested)));
    if (target !== gameDir && !target.startsWith(gameDir + sep)) {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("Forbidden\n");
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found\n");
      return;
    }

    const body = await readFile(target);
    response.writeHead(200, {
      "content-type": mimeFor(target),
      "content-length": body.length,
      "cache-control": "no-cache",
    });
    response.end(body);
  } catch (error) {
    console.error(`${LOG_PREFIX} server error:`, error);
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain" });
    }
    response.end("Internal server error\n");
  }
});

server.listen(PORT, () => {
  console.log(`${LOG_PREFIX} serving game/ at http://localhost:${PORT}/`);
});

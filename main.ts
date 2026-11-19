// Sunset Bay — dossier builder (makefun/dossier/v1).
// Copies game/ and screenshots/ into the output directory and writes
// dossier.json describing every file. Node 22 stdlib only.

import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const TEXT_LIMIT = 163840;

const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || "/output");
const rootDir = resolve(new URL(".", import.meta.url).pathname);

const TEXT_EXTS = new Set([
  ".html", ".js", ".ts", ".css", ".json", ".md", ".txt", ".svg", ".xml",
]);

function isTextFile(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTS.has(name.slice(dot).toLowerCase());
}

async function walk(dir, base) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(base, full).split(sep).join("/");
    if (entry.isDirectory()) {
      found.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found;
}

async function main() {
  const gameDir = join(rootDir, "game");
  const shotsDir = join(rootDir, "screenshots");

  await mkdir(outDir, { recursive: true });
  await cp(gameDir, join(outDir, "game"), { recursive: true });

  let shotFiles = [];
  try {
    const st = await stat(shotsDir);
    if (st.isDirectory()) {
      await cp(shotsDir, join(outDir, "screenshots"), { recursive: true });
      shotFiles = (await walk(join(outDir, "screenshots"), outDir))
        .filter((p) => p.startsWith("screenshots/"))
        .sort();
    }
  } catch {
    // No screenshots directory yet; dossier still lists the game files.
  }

  const gameFiles = (await walk(join(outDir, "game"), outDir))
    .filter((p) => p.startsWith("game/"))
    .sort();

  const files = [];
  let textBytes = 0;
  for (const rel of [...gameFiles, ...shotFiles]) {
    const full = join(outDir, rel);
    const info = await stat(full);
    files.push({ path: rel, size: info.size });
    if (isTextFile(rel)) textBytes += info.size;
  }

  if (textBytes > TEXT_LIMIT) {
    console.error(
      `dossier text budget exceeded: ${textBytes} > ${TEXT_LIMIT} bytes`,
    );
    process.exit(1);
  }

  const images = shotFiles
    .filter((p) => /\.(png|jpg|jpeg|webp)$/i.test(p))
    .slice(0, 4);

  const dossier = {
    schema: "makefun/dossier/v1",
    files,
    images,
    textBytes,
  };

  await writeFile(
    join(outDir, "dossier.json"),
    JSON.stringify(dossier, null, 2) + "\n",
    "utf8",
  );

  console.log(
    `dossier written: ${files.length} files, ${images.length} images, ${textBytes} text bytes`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

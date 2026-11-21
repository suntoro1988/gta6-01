// Sunset Bay — build entrypoint (v10, written from scratch).
// Copies the playable game and its screenshots into the output
// directory and writes the make.fun dossier for this entry.
//
// Usage:
//   node main.ts
//   MAKEFUN_OUTPUT_DIR=/some/dir node main.ts
//
// Node 22, standard library only. No third-party dependencies.

import { buildDossier } from "./vendor/makefun-game.ts";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOG_PREFIX = "[sunset-bay]";

function log(message: string): void {
  console.log(`${LOG_PREFIX} ${message}`);
}

function fail(message: string): never {
  console.error(`${LOG_PREFIX} error: ${message}`);
  process.exit(1);
}

// Directory holding this entrypoint file; the game/ and screenshots/
// folders live next to it.
const rootDir = dirname(fileURLToPath(import.meta.url));

// Output goes to $MAKEFUN_OUTPUT_DIR when set, otherwise ./output.
const outDir = resolve(
  process.env.MAKEFUN_OUTPUT_DIR ?? join(rootDir, "output"),
);

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function requireEntry(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isFile()) fail(`${label} is not a file: ${path}`);
  } catch {
    fail(`missing required entry ${label}: ${path}`);
  }
}

const MAX_SCREENSHOT_BYTES = 256 * 1024;

async function validateEntry(): Promise<void> {
  const indexPath = join(rootDir, "game", "index.html");
  await requireEntry(indexPath, "game entrypoint");

  const shotsDir = join(rootDir, "screenshots");
  let names: string[];
  try {
    names = await readdir(shotsDir);
  } catch {
    fail(`cannot read screenshots directory: ${shotsDir}`);
  }
  const shots = names.filter((name) => /\.(jpe?g|png)$/i.test(name)).sort();
  if (shots.length === 0) fail("no screenshots found in screenshots/");
  for (const name of shots) {
    const info = await stat(join(shotsDir, name));
    if (info.size > MAX_SCREENSHOT_BYTES) {
      fail(`screenshot ${name} is ${info.size} bytes, over the 256 KiB limit`);
    }
    log(`screenshot ok: ${name} (${info.size} bytes)`);
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  await ensureDir(target);
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    }
  }
}

async function writeDossier(): Promise<void> {
  // buildDossier takes the directory to describe plus a limits object,
  // and returns the canonical dossier JSON as bytes. We point it at the
  // output directory so the dossier describes exactly what is submitted
  // (game/ + screenshots/), not the repo tooling around it.
  const dossier = await buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  const dossierPath = join(outDir, "dossier.json");
  await writeFile(dossierPath, dossier);
  log(`dossier written: ${dossierPath} (${dossier.length} bytes)`);
}

async function main(): Promise<void> {
  log(`root: ${rootDir}`);
  log(`output: ${outDir}`);

  await validateEntry();

  await ensureDir(outDir);
  await copyTree(join(rootDir, "game"), join(outDir, "game"));
  log("game/ copied");
  await copyTree(join(rootDir, "screenshots"), join(outDir, "screenshots"));
  log("screenshots/ copied");

  await writeDossier();
  log("build complete");
  log(
    `summary: entrypoint game/index.html, 4 screenshots, ` +
      `dossier at ${join(outDir, "dossier.json")}`,
  );
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});

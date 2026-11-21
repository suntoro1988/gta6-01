// Sunset Bay v9 — entrypoint for the make.fun gta6-01 bounty.
//
// Stages the playable game and its screenshots into the output directory,
// then writes the dossier the bounty scorer reads. Run it with:
//   MAKEFUN_OUTPUT_DIR=/output node main.ts
// Node 22+ runs this erasable TypeScript file directly, no build step.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// A screenshot the dossier accepts is at most 256 KiB.
const SHOT_LIMIT_BYTES = 256 * 1024;
// The dossier caps the bounty gate hands the scorer (gate.json).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// The folder this file lives in: the repository root, beside game/ and screenshots/.
const rootDir = dirname(fileURLToPath(import.meta.url));
// Where the staged entry goes: the environment's choice, or the platform default.
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Make a directory (and its parents) when it is not there yet. */
function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
    console.log(`[sunset-bay] created directory ${path}`);
  }
}

/** Fail fast with a plain message when a required entry is missing. */
function requireEntry(path: string, what: string): void {
  if (!existsSync(path)) throw new Error(`[sunset-bay] missing ${what}: ${path}`);
}

/** Check the game page and its screenshots before anything is copied. */
function validateEntry(): string[] {
  const indexPage = join(rootDir, 'game', 'index.html');
  requireEntry(indexPage, 'game page');
  if (!statSync(indexPage).isFile()) throw new Error(`[sunset-bay] game/index.html is not a file: ${indexPage}`);
  console.log('[sunset-bay] game/index.html found');

  const shotDir = join(rootDir, 'screenshots');
  requireEntry(shotDir, 'screenshots folder');
  const shots = readdirSync(shotDir)
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort();
  if (shots.length === 0) throw new Error('[sunset-bay] screenshots/ holds no image');
  if (shots.length > 4) throw new Error(`[sunset-bay] screenshots/ holds ${shots.length} images, at most 4 allowed`);
  for (const name of shots) {
    const shotPath = join(shotDir, name);
    const size = statSync(shotPath).size;
    if (size > SHOT_LIMIT_BYTES) {
      throw new Error(`[sunset-bay] screenshot ${name} is ${size} bytes, over the ${SHOT_LIMIT_BYTES} limit`);
    }
    console.log(`[sunset-bay] screenshot ${name}: ${size} bytes, OK`);
  }
  console.log(`[sunset-bay] ${shots.length} screenshots validated`);
  return shots;
}

/** Copy a folder into the output directory, replacing any stale copy first. */
function copyTree(folder: string): void {
  const from = join(rootDir, folder);
  const to = join(outDir, folder);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log(`[sunset-bay] copied ${folder}/ -> ${to}`);
}

/** Build the dossier from the staged output and write it as dossier.json. */
function writeDossier(): void {
  const dossier = buildDossier(outDir, DOSSIER_CAPS);
  const target = join(outDir, 'dossier.json');
  writeFileSync(target, dossier);
  console.log(`[sunset-bay] wrote ${target} (${dossier.length} bytes)`);
}

ensureDir(outDir);
validateEntry();
copyTree('game');
copyTree('screenshots');
writeDossier();
console.log('[sunset-bay] entry staged, dossier ready');

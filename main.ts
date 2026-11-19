// Sunset Bay v5 — main.ts (Builder E)
// Node 22 entrypoint for the make.fun build.
// Reads MAKEFUN_OUTPUT_DIR (default /output), copies game/ + screenshots/
// into it, then writes dossier.json via vendor/makefun-game.ts buildDossier.
// vendor/makefun-game.ts is kit code — never edited here.
//
// buildDossier signature (kit): buildDossier(dir, caps) -> Uint8Array
//   dir  = directory holding game/ and screenshots/ (here: the output dir)
//   caps = limits from the bounty gates (spec section 6):
//          text ≤ 160 KiB, screenshots ≤ 4 files × 256 KiB,
//          game ≤ 993 files / 48 MiB, path names ≤ 1000 bytes.

import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here);

// Caps from the bounty gates (design-spec.md section 6).
const CAPS = {
  text_max_bytes: 163840, // 160 KiB of dossier text
  screenshots: { max: 4, max_bytes: 262144 }, // 4 files, 256 KiB each
  game_max_files: 993,
  game_max_bytes: 50331648, // 48 MiB
  game_path_max_bytes: 1000,
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
  const out = resolve(outputDir);

  await mkdir(out, { recursive: true });

  // 1. Copy the playable game (static files, no build step).
  const gameSrc = join(repoRoot, 'game');
  const gameDst = join(out, 'game');
  await cp(gameSrc, gameDst, { recursive: true });

  // 2. Copy screenshots when present (the render step may run before this).
  const shotsSrc = join(repoRoot, 'screenshots');
  const shotsDst = join(out, 'screenshots');
  if (await exists(shotsSrc)) {
    await cp(shotsSrc, shotsDst, { recursive: true });
  } else {
    await mkdir(shotsDst, { recursive: true });
  }

  // 3. Build the dossier with the kit helper and write it out.
  const dossierBytes = buildDossier(out, CAPS);
  const dossierPath = join(out, 'dossier.json');
  await writeFile(dossierPath, dossierBytes);

  console.log(`Sunset Bay v5 packaged to ${out}`);
  console.log(`dossier written to ${dossierPath} (${dossierBytes.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error('make.fun build failed:', err);
  process.exit(1);
});

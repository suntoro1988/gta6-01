// Sunset Bay v12 — entry builder for the make.fun gta6-01 bounty.
//
// What this file does, in order:
//   1. wipes /output and copies game/ + screenshots/ into it,
//   2. builds dossier.json from that copy with the platform's own
//      buildDossier() (vendor/makefun-game.ts, untouched),
//   3. checks the dossier against the 1.5 MiB ceiling and exits 0.
//
// Run it from the repository root with plain Node 22, no flags,
// no install, no build step:
//   node main.ts
//
// The grader re-runs buildDossier itself on the same /output tree,
// so this file must never hand-edit dossier.json: whatever
// buildDossier returns is exactly what gets written.
import { buildDossier } from './vendor/makefun-game.ts';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository root is wherever this file lives; the game and the
// screenshots are read from there, never from the working directory,
// so `node main.ts` works from any cwd.
const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR: string = '/output';
const GAME_DIR: string = join(REPO_ROOT, 'game');
const SHOTS_DIR: string = join(REPO_ROOT, 'screenshots');
const DOSSIER_PATH: string = join(OUT_DIR, 'dossier.json');

// Hard ceiling for the finished dossier: 1.5 MiB (1,572,864 bytes).
// The v12 target is 1.4–1.5 MB; anything past this fails the build
// loudly instead of shipping an entry the scorer would refuse.
const DOSSIER_LIMIT_BYTES: number = 1572864;

// Caps handed to buildDossier. text_max_bytes is set to the same
// 1.5 MiB so the game text is never cut mid-file: the text is the
// whole game (~10k lines), and a cut dossier would not match what
// the scorer builds. The other caps only refuse oversize input.
const CAPS = {
  text_max_bytes: 1572864,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// One screenshot per scene the bounty asks for, in dossier order.
// The first file is the cover. buildDossier reads them by name.
const EXPECTED_SHOTS: string[] = [
  '1-start.jpg',
  '2-play.jpg',
  '3-foot.jpg',
  '4-end.jpg',
];

function fail(message: string): never {
  console.error(`[sunset-bay] ERROR: ${message}`);
  process.exit(1);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(3)} MiB`;
}

// Count every file under a directory, recursively, for the summary.
function countFiles(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    total += statSync(full).isDirectory() ? countFiles(full) : 1;
  }
  return total;
}

// Fresh output directory: remove any previous build, then recreate it.
function freshOutputDir(): void {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
}

// The entry is only valid when the game boots and the shots exist.
function checkInputs(): void {
  if (!existsSync(join(GAME_DIR, 'index.html'))) {
    fail('game/index.html is missing — the game cannot be an entry without it.');
  }
  for (const shot of EXPECTED_SHOTS) {
    const path = join(SHOTS_DIR, shot);
    if (!existsSync(path)) fail(`screenshots/${shot} is missing.`);
    if (statSync(path).size > 262144) {
      fail(`screenshots/${shot} is over the 256 KiB screenshot cap.`);
    }
  }
}

function build(): void {
  checkInputs();
  freshOutputDir();
  cpSync(GAME_DIR, join(OUT_DIR, 'game'), { recursive: true });
  cpSync(SHOTS_DIR, join(OUT_DIR, 'screenshots'), { recursive: true });

  const dossier: Uint8Array = buildDossier(OUT_DIR, CAPS);
  writeFileSync(DOSSIER_PATH, dossier);

  if (dossier.length > DOSSIER_LIMIT_BYTES) {
    fail(
      `dossier.json is ${formatBytes(dossier.length)}, past the ` +
        `${formatBytes(DOSSIER_LIMIT_BYTES)} ceiling — shrink the game or the shots.`,
    );
  }

  console.log('[sunset-bay] Sunset Bay v12 entry built.');
  console.log(`[sunset-bay] game files: ${countFiles(join(OUT_DIR, 'game'))}`);
  console.log(`[sunset-bay] screenshots: ${EXPECTED_SHOTS.length}`);
  console.log(`[sunset-bay] dossier: ${formatBytes(dossier.length)} (${dossier.length} bytes)`);
  console.log(`[sunset-bay] output: ${OUT_DIR}`);
}

try {
  build();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
process.exit(0);

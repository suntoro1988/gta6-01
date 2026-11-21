// Sunset Bay v11 — entry point.
//
// Builds the make.fun submission bundle for bounty gta6-01: copies the
// playable game and its screenshots into the output directory, then asks
// the vendor library to write the dossier for that exact directory.
//
// Node 22 standard library only. No dependencies, no build step, no
// network: `node main.ts` (or `node main.ts <output-dir>`).
//
// The dossier MUST come from buildDossier — never hand-rolled — because
// the scorer rebuilds it from the same game/ and screenshots/ and
// requires byte equality with dossier.json.

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

// ------------------------------------------------------------------ paths

// The repository root is the directory holding this file, wherever the
// checkout happens to live. Everything else is resolved from it so the
// script never depends on the current working directory.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// The grader collects /output; a caller may pass another directory (a
// temp dir for a local check, for example) as the first argument.
const outDir = resolve(process.argv[2] ?? '/output');

// ------------------------------------------------------------------ caps

// Caps copied from the bounty's gate: the text budget shapes the
// dossier, the screenshot caps bound the renders, and the game caps
// mirror the grader's own /output ceiling (993 game entries + game/,
// screenshots/ and its 4 files + dossier.json = 1000 entries).
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

// ------------------------------------------------------------------ helpers

// Count every file and directory under `dir`, recursively, so the run
// can report what it staged instead of failing silently on a half copy.
function countEntries(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    total += 1;
    const child = join(dir, name);
    if (statSync(child).isDirectory()) total += countEntries(child);
  }
  return total;
}

// Stage one top-level directory (game/ or screenshots/) into the
// output directory, replacing any stale copy left by an earlier run.
function stageDirectory(name: string): number {
  const source = join(repoRoot, name);
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error(`main.ts: ${name}/ is missing — nothing to stage`);
  }
  const target = join(outDir, name);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
  return countEntries(target);
}

// ------------------------------------------------------------------ build

function main(): void {
  mkdirSync(outDir, { recursive: true });

  // 1. Stage the playable game and its renders first: buildDossier
  //    reads them from the output directory, so they must already be
  //    there when it runs — a dossier built over an empty folder
  //    would describe nothing and fail the gate.
  const gameEntries = stageDirectory('game');
  const shotEntries = stageDirectory('screenshots');

  // 2. Ask the vendor library for the dossier of the staged bundle.
  //    It throws DossierError on anything it refuses (missing
  //    game/index.html, too many or too large screenshots, a text
  //    budget the sources cannot fit in), and that throw is the
  //    correct outcome: a bad bundle must fail loudly here, not
  //    ship a dossier the scorer would reject.
  const dossier = buildDossier(outDir, DOSSIER_CAPS);

  // 3. Write the dossier exactly as buildDossier returned it — no
  //    re-serialising, no pretty-printing, no trailing newline added.
  //    The scorer requires dossier.json to equal these bytes.
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  // 3b. Prove the dossier actually landed before claiming success:
  //     a write that silently vanished must not pass as a good build.
  const written = statSync(join(outDir, 'dossier.json'));
  if (written.size !== dossier.byteLength) {
    throw new Error(
      `main.ts: dossier.json is ${written.size} bytes, expected ${dossier.byteLength}`,
    );
  }

  // 4. Report the run so a human (or a log) can see what shipped.
  console.log(`Sunset Bay v11: staged game/ (${gameEntries} entries)`);
  console.log(`Sunset Bay v11: staged screenshots/ (${shotEntries} entries)`);
  console.log(`Sunset Bay v11: dossier.json written (${dossier.byteLength} bytes)`);
  console.log(`Sunset Bay v11: output ready at ${outDir}`);
}

// A non-zero exit on any failure; zero only when the bundle —
// game, screenshots AND dossier — is complete on disk.
try {
  main();
} catch (err) {
  console.error(`Sunset Bay v11: build failed: ${(err as Error).message}`);
  process.exit(1);
}
process.exit(0);

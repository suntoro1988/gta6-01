// main.ts — Sunset Bay v13 (gta6-01)
// Build tool: menyalin game/ + screenshots/ ke direktori output dan
// menulis dossier.json memakai buildDossier dari vendor/makefun-game.ts.
// Node 22 stdlib saja. Jalankan: node --experimental-strip-types main.ts
// Output default: ./output (atau $MAKEFUN_OUTPUT_DIR bila diset).

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const GAME_DIR = join(REPO_ROOT, 'game');
const SHOTS_DIR = join(REPO_ROOT, 'screenshots');

const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR
  ? resolve(process.env.MAKEFUN_OUTPUT_DIR)
  : join(REPO_ROOT, 'output');

// Batas dossier kompetisi: 1,5 MiB total, 8 screenshot, 256 KiB per gambar.
const CAPS = {
  text_max_bytes: 1572864,
  screenshots: { max: 8, max_bytes: 262144 },
  game_max_files: 100,
  game_max_bytes: 1572864,
  game_path_max_bytes: 1000,
};

function fail(message: string): never {
  console.error(`[main] ERROR: ${message}`);
  process.exit(1);
}

function checkInputs(): void {
  if (!existsSync(GAME_DIR) || !statSync(GAME_DIR).isDirectory()) {
    fail(`direktori game/ tidak ditemukan di ${GAME_DIR}`);
  }
  const indexHtml = join(GAME_DIR, 'index.html');
  if (!existsSync(indexHtml)) fail('game/index.html tidak ditemukan');
  const entries = readdirSync(GAME_DIR);
  if (entries.length === 0) fail('game/ kosong');
  if (!existsSync(SHOTS_DIR)) fail(`direktori screenshots/ tidak ditemukan di ${SHOTS_DIR}`);
  const shots = readdirSync(SHOTS_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f));
  if (shots.length < 4) fail(`butuh minimal 4 screenshot, baru ada ${shots.length}`);
  console.log(`[main] game/: ${entries.length} entri, screenshots/: ${shots.length} gambar`);
  verifyScreenshotSizes(shots);
}

// Tiap screenshot maksimal 256 KiB (batas kompetisi).
function verifyScreenshotSizes(shots: string[]): void {
  for (const shot of shots) {
    const size = statSync(join(SHOTS_DIR, shot)).size;
    if (size > 262144) fail(`screenshot ${shot} ${size} byte melebihi 256 KiB`);
  }
  console.log('[main] semua screenshot <= 256 KiB');
}

// Daftarkan isi output untuk log akhir (tanpa membaca isi file game).
function listOutput(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
      else found.push(`${prefix}${entry}`);
    }
  };
  walk(join(OUTPUT_DIR, 'game'), 'game/');
  walk(join(OUTPUT_DIR, 'screenshots'), 'screenshots/');
  found.push('dossier.json');
  return found.sort();
}

function prepareOutput(): void {
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(join(OUTPUT_DIR, 'game'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
  console.log(`[main] output disiapkan di ${OUTPUT_DIR}`);
}

function copyTree(): void {
  cpSync(GAME_DIR, join(OUTPUT_DIR, 'game'), { recursive: true });
  cpSync(SHOTS_DIR, join(OUTPUT_DIR, 'screenshots'), { recursive: true });
  const copiedGame = readdirSync(join(OUTPUT_DIR, 'game')).length;
  const copiedShots = readdirSync(join(OUTPUT_DIR, 'screenshots')).length;
  if (copiedGame === 0 || copiedShots === 0) fail('salinan output kosong');
  console.log(`[main] game/ + screenshots/ disalin ke output (${copiedGame} entri game, ${copiedShots} gambar)`);
}

function writeDossier(): void {
  const dossier = buildDossier(REPO_ROOT, CAPS);
  if (dossier.length === 0) fail('buildDossier menghasilkan dossier kosong');
  const outPath = join(OUTPUT_DIR, 'dossier.json');
  writeFileSync(outPath, dossier);
  const size = statSync(outPath).size;
  console.log(`[main] dossier.json ditulis: ${size} byte`);
  if (size > 1572864) fail(`dossier ${size} byte melebihi batas 1,5 MiB`);
  if (size < 1024) fail(`dossier hanya ${size} byte — terlalu kecil, ada yang salah`);
}

function main(): void {
  const started = Date.now();
  checkInputs();
  prepareOutput();
  copyTree();
  writeDossier();
  const files = listOutput();
  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  console.log(`[main] SELESAI dalam ${elapsed} detik -> ${OUTPUT_DIR}`);
  console.log(`[main] isi output (${files.length} file):`);
  for (const f of files) console.log(`[main]   ${f}`);
}

main();

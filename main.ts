// Jalankan: node main.ts
// Menyalin game/ dan screenshots/ repo ini ke direktori keluaran, lalu
// menulis dossier.json dari hasil salinan itu memakai buildDossier vendor.
// Direktori keluaran dibaca dari MAKEFUN_OUTPUT_DIR (grader mengisinya
// dengan /output); bila variabel itu kosong, dipakai ./output di repo ini.
//
// ATURAN PALING PENTING: direktori keluaran TIDAK PERNAH dihapus.
// Grader menjalankan program ini dengan MAKEFUN_OUTPUT_DIR menunjuk ke
// Docker bind mount; menghapus mount point itu sendiri melempar EBUSY
// ("Device or resource busy") dan menggagalkan seluruh run. Jadi
// prepareOutput() hanya membersihkan ISI keluaran (subdirektori game,
// screenshots, dan berkas dossier.json), bukan wadahnya.
import { buildDossier } from './vendor/makefun-game.ts';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Lokasi repo = direktori tempat main.ts ini berada, bukan cwd pemanggil.
const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const GAME_SOURCE = join(REPO_ROOT, 'game');
const SHOTS_SOURCE = join(REPO_ROOT, 'screenshots');
const OUTPUT_DIR =
  process.env.MAKEFUN_OUTPUT_DIR && process.env.MAKEFUN_OUTPUT_DIR.length > 0
    ? process.env.MAKEFUN_OUTPUT_DIR
    : join(REPO_ROOT, 'output');

// Batas-batas dari gate bounty gta6-01.
const CAPS = {
  text_max_bytes: 1572864,
  screenshots: { max: 8, max_bytes: 262144 },
  game_max_files: 100,
  game_max_bytes: 1572864,
  game_path_max_bytes: 1000,
};
const MIN_SCREENSHOTS = 4;
const MIN_DOSSIER_BYTES = 1024;
const MAX_DOSSIER_BYTES = 1572864;

function fail(message: string): never {
  console.error(`main.ts: ${message}`);
  process.exit(1);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Langkah 1: pastikan bahan masukan lengkap sebelum menyentuh keluaran.
function checkInputs(): void {
  if (!isDir(GAME_SOURCE)) {
    fail(`game/ tidak ditemukan di ${REPO_ROOT}`);
  }
  if (!existsSync(join(GAME_SOURCE, 'index.html'))) {
    fail('game/index.html tidak ditemukan');
  }
  const gameEntries = readdirSync(GAME_SOURCE);
  if (gameEntries.length === 0) {
    fail('game/ kosong');
  }
  if (!isDir(SHOTS_SOURCE)) {
    fail('screenshots/ tidak ditemukan');
  }
  const shots = readdirSync(SHOTS_SOURCE, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  if (shots.length < MIN_SCREENSHOTS) {
    fail(
      `screenshots/ hanya berisi ${shots.length} berkas, butuh minimal ${MIN_SCREENSHOTS}`,
    );
  }
  for (const name of shots) {
    const size = lstatSync(join(SHOTS_SOURCE, name)).size;
    if (size > CAPS.screenshots.max_bytes) {
      fail(`screenshots/${name} berukuran ${size} byte, melebihi batas 262144 byte`);
    }
  }
  console.log(
    `checkInputs: OK — game/ (${gameEntries.length} entri), screenshots/ (${shots.length} berkas)`,
  );
}

// Langkah 2: siapkan direktori keluaran TANPA menghapus wadahnya sendiri.
// Pola ini aman baik saat OUTPUT_DIR adalah bind mount maupun direktori biasa.
function prepareOutput(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  rmSync(join(OUTPUT_DIR, 'game'), { recursive: true, force: true });
  rmSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true, force: true });
  rmSync(join(OUTPUT_DIR, 'dossier.json'), { force: true });
  mkdirSync(join(OUTPUT_DIR, 'game'), { recursive: true });
  mkdirSync(join(OUTPUT_DIR, 'screenshots'), { recursive: true });
  console.log(`prepareOutput: OK — ${OUTPUT_DIR} siap (isi lama dibersihkan)`);
}

// Menyalin satu pohon direktori secara rekursif (berkas biasa saja).
function copyTree(source: string, target: string): number {
  let copied = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      copied += copyTree(from, to);
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

// Langkah 3: salin game/ dan screenshots/ ke dalam keluaran.
function copyTreeStep(): void {
  const gameFiles = copyTree(GAME_SOURCE, join(OUTPUT_DIR, 'game'));
  const shotFiles = copyTree(SHOTS_SOURCE, join(OUTPUT_DIR, 'screenshots'));
  if (gameFiles === 0) {
    fail('salinan game/ kosong — tidak ada berkas yang tersalin');
  }
  if (shotFiles === 0) {
    fail('salinan screenshots/ kosong — tidak ada berkas yang tersalin');
  }
  console.log(
    `copyTree: OK — ${gameFiles} berkas game/ dan ${shotFiles} berkas screenshots/ tersalin`,
  );
}

// Langkah 4: bangun dossier dari SALINAN di keluaran (bukan dari repo),
// lalu tulis sebagai dossier.json di keluaran.
function writeDossier(): void {
  const dossier = buildDossier(OUTPUT_DIR, CAPS);
  if (dossier.length === 0) {
    fail('dossier kosong');
  }
  if (dossier.length < MIN_DOSSIER_BYTES) {
    fail(`dossier hanya ${dossier.length} byte, di bawah minimum ${MIN_DOSSIER_BYTES} byte`);
  }
  if (dossier.length > MAX_DOSSIER_BYTES) {
    fail(`dossier ${dossier.length} byte, melebihi batas ${MAX_DOSSIER_BYTES} byte`);
  }
  writeFileSync(join(OUTPUT_DIR, 'dossier.json'), dossier);
  console.log(`writeDossier: OK — dossier.json ${dossier.length} byte`);
}

// Langkah 5: daftarkan isi keluaran agar mudah diperiksa.
function listOutput(): void {
  const rows: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path, `${prefix}${entry.name}/`);
      } else if (entry.isFile()) {
        rows.push(`${prefix}${entry.name} (${lstatSync(path).size} byte)`);
      }
    }
  };
  walk(OUTPUT_DIR, '');
  console.log(`listOutput: ${rows.length} berkas di ${OUTPUT_DIR}`);
  for (const row of rows) {
    console.log(`  ${row}`);
  }
}

checkInputs();
prepareOutput();
copyTreeStep();
writeDossier();
listOutput();
console.log('main.ts: selesai, exit 0');

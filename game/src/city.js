// Sunset Bay v14 — SB.City
// Peta kota: 14 distrik, 300+ bangunan, grid jalan, tabrakan bangunan.
// Ditulis dari design spec v14 §3–§4. Tanpa import modul lain;
// komunikasi antar modul hanya lewat namespace SB saat runtime.
//
// Penempatan bangunan memakai grid blok kota (sel 60x60 m di antara jalan):
// tiap blok diisi 1 menara di tengah ATAU 4 bangunan kecil di sudut-sudut
// blok, ditambah fallback sampling di interior blok. Sampling acak bebas
// TIDAK dipakai — titik acak yang lolos-jalan menumpuk di tengah blok yang
// sama lalu saling bertabrakan, sehingga distrik tidak pernah penuh.

const SB_ROOT = (typeof window !== "undefined" ? window : globalThis);
SB_ROOT.SB = SB_ROOT.SB || {};
const SB = SB_ROOT.SB;

// ---------------------------------------------------------------------------
// RNG deterministik (mulberry32) supaya tata kota identik di tiap load.
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(0x5eed8a11);
function rand(min, max) {
  return min + rng() * (max - min);
}
function pick(list) {
  return list[Math.floor(rng() * list.length)];
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// §3 — 14 distrik. NAMA + pusat x,z + radius HARUS PERSIS sama dengan
// config.js, economy.js, dan weather.js. Jangan ubah satu angka pun.
// ---------------------------------------------------------------------------
const DISTRICTS = [
  { name: "Marina Bay", x: 0, z: 0, r: 120 },
  { name: "Old Town", x: -120, z: 40, r: 90 },
  { name: "Fisherman's Wharf", x: -185, z: 40, r: 55 },
  { name: "Sunset Strip", x: 120, z: -60, r: 100 },
  { name: "North Hills", x: 60, z: 180, r: 110 },
  { name: "East Market", x: 200, z: 80, r: 90 },
  { name: "Harbor Point", x: -220, z: -80, r: 80 },
  { name: "Palm Court", x: 40, z: -180, r: 90 },
  { name: "Coral District", x: -60, z: -140, r: 80 },
  { name: "Beacon Hill", x: 180, z: 180, r: 100 },
  { name: "Little Havana", x: -160, z: 160, r: 90 },
  { name: "Airport South", x: 260, z: -160, r: 110 },
  { name: "University Row", x: -40, z: 220, r: 90 },
  { name: "Industrial Docks", x: 240, z: 20, r: 100 },
];

// Distrik hiburan / neon: bangunan boleh memakai warna neon menyala.
const NEON_DISTRICTS = ["Sunset Strip", "Marina Bay", "East Market"];

// Profil bangunan per distrik: [tinggiMin, tinggiMax, lebarMin, lebarMax].
// Gedung pencakar langit di pusat kota, rumah rendah di bukit & pelabuhan.
// Lebar dibatasi supaya tapak muat di interior blok 48 m (lebar jalan 12 m).
const DISTRICT_PROFILE = {
  "Marina Bay": { hMin: 25, hMax: 60, wMin: 14, wMax: 26 },
  "Old Town": { hMin: 10, hMax: 28, wMin: 12, wMax: 22 },
  "Fisherman's Wharf": { hMin: 8, hMax: 18, wMin: 10, wMax: 18 },
  "Sunset Strip": { hMin: 20, hMax: 55, wMin: 14, wMax: 26 },
  "North Hills": { hMin: 8, hMax: 20, wMin: 12, wMax: 22 },
  "East Market": { hMin: 15, hMax: 40, wMin: 12, wMax: 24 },
  "Harbor Point": { hMin: 8, hMax: 22, wMin: 10, wMax: 20 },
  "Palm Court": { hMin: 12, hMax: 35, wMin: 12, wMax: 24 },
  "Coral District": { hMin: 10, hMax: 30, wMin: 12, wMax: 22 },
  "Beacon Hill": { hMin: 15, hMax: 45, wMin: 14, wMax: 26 },
  "Little Havana": { hMin: 8, hMax: 25, wMin: 12, wMax: 22 },
  "Airport South": { hMin: 10, hMax: 25, wMin: 16, wMax: 28 },
  "University Row": { hMin: 10, hMax: 30, wMin: 12, wMax: 24 },
  "Industrial Docks": { hMin: 10, hMax: 30, wMin: 18, wMax: 30 },
};

// Jumlah bangunan target per distrik (total 324 — di atas syarat 301).
// Fisherman's Wharf kecil (r=55, sedikit blok) jadi targetnya paling rendah.
const DISTRICT_COUNT = {
  "Marina Bay": 36,
  "Old Town": 26,
  "Fisherman's Wharf": 12,
  "Sunset Strip": 30,
  "North Hills": 22,
  "East Market": 28,
  "Harbor Point": 18,
  "Palm Court": 24,
  "Coral District": 22,
  "Beacon Hill": 24,
  "Little Havana": 22,
  "Airport South": 20,
  "University Row": 20,
  "Industrial Docks": 20,
};

// ---------------------------------------------------------------------------
// Palette kota pesisir (RGB 0..1) + palette neon untuk distrik hiburan.
// ---------------------------------------------------------------------------
const COASTAL_PALETTE = [
  [0.93, 0.88, 0.78], // pasir krem
  [0.96, 0.94, 0.88], // putih hangat
  [0.85, 0.62, 0.45], // terakota
  [0.62, 0.78, 0.85], // biru pastel
  [0.95, 0.72, 0.68], // koral muda
  [0.68, 0.85, 0.78], // mint laut
  [0.88, 0.80, 0.62], // kuning pasir
  [0.72, 0.72, 0.74], // abu terang
  [0.94, 0.80, 0.62], // peach
  [0.55, 0.68, 0.78], // biru baja
  [0.90, 0.68, 0.75], // pink pesisir
  [0.78, 0.85, 0.66], // hijau palem muda
  [0.82, 0.70, 0.55], // cokelat muda
  [0.98, 0.96, 0.92], // putih kapur
];

const NEON_PALETTE = [
  [1.0, 0.16, 0.55], // pink neon
  [0.1, 0.95, 1.0], // cyan neon
  [1.0, 0.55, 0.1], // oranye neon
  [0.65, 0.2, 1.0], // ungu neon
  [0.2, 1.0, 0.45], // hijau neon
  [1.0, 0.9, 0.1], // kuning neon
];

const ROOF_PALETTE = [
  [0.45, 0.35, 0.30],
  [0.35, 0.45, 0.50],
  [0.55, 0.45, 0.35],
  [0.30, 0.35, 0.40],
  [0.60, 0.35, 0.30],
];

function pickBuildingColor(districtName) {
  // Distrik hiburan: sebagian bangunan memakai warna neon menyala.
  if (NEON_DISTRICTS.indexOf(districtName) !== -1 && rng() < 0.35) {
    return pick(NEON_PALETTE).slice();
  }
  // Sedikit variasi kecerahan supaya fasad tidak terlihat seragam.
  const base = pick(COASTAL_PALETTE).slice();
  const shade = rand(0.85, 1.05);
  return [
    clamp(base[0] * shade, 0, 1),
    clamp(base[1] * shade, 0, 1),
    clamp(base[2] * shade, 0, 1),
  ];
}

// ---------------------------------------------------------------------------
// ROADS — grid jalan kota.
// Jalan lurus tiap 60 m, lebar 12 m, dari -300 sampai +300 di sumbu x dan z.
// Laut ada di barat (x < -265) dan selatan (z < -265), jadi grid berhenti
// di tepi pantai; jalan lingkar pantai mengikuti garis x = -240 dan z = -240
// (keduanya juga garis grid, karena -240 kelipatan 60 dari -300).
// ---------------------------------------------------------------------------
const ROAD_SPACING = 60;
const ROAD_WIDTH = 12;
const ROAD_MIN = -300;
const ROAD_MAX = 300;

const roadLines = [];
for (let v = ROAD_MIN; v <= ROAD_MAX; v += ROAD_SPACING) {
  roadLines.push(v);
}

const ROADS = {
  spacing: ROAD_SPACING,
  width: ROAD_WIDTH,
  min: ROAD_MIN,
  max: ROAD_MAX,
  // Garis jalan vertikal (x tetap) dan horizontal (z tetap).
  linesX: roadLines.slice(),
  linesZ: roadLines.slice(),
  // Jalan pantai di tepi laut barat & selatan.
  coastRoadX: -240,
  coastRoadZ: -240,
};

// Jarak dari (x,z) ke garis grid terdekat pada satu sumbu.
function distToGridLine(v) {
  const rel = (v - ROAD_MIN) / ROAD_SPACING;
  const nearest = Math.round(rel);
  return Math.abs(v - (ROAD_MIN + nearest * ROAD_SPACING));
}

function isRoad(x, z) {
  if (x < ROAD_MIN - 20 || x > ROAD_MAX + 20 || z < ROAD_MIN - 20 || z > ROAD_MAX + 20) {
    return false;
  }
  const half = ROAD_WIDTH / 2;
  // Jalan grid vertikal / horizontal.
  if (distToGridLine(x) <= half || distToGridLine(z) <= half) {
    return true;
  }
  // Jalan lingkar pantai (barat & selatan).
  if (Math.abs(x - ROADS.coastRoadX) <= half && z >= -300 && z <= 300) {
    return true;
  }
  if (Math.abs(z - ROADS.coastRoadZ) <= half && x >= -300 && x <= 300) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// BUILDINGS — ditempatkan per distrik di atas grid blok, menjauhi jalan &
// laut, tanpa tumpang tindih. Posisi y = 0 (tanah datar kota; bukit
// ditangani SB.World).
// ---------------------------------------------------------------------------
const LAND_MIN_X = -252; // garis pantai barat — bangunan tidak boleh di laut
const LAND_MIN_Z = -252; // garis pantai selatan

function buildingsOverlap(a, b) {
  const dx = Math.abs(a.pos.x - b.pos.x);
  const dz = Math.abs(a.pos.z - b.pos.z);
  const gapX = (a.w + b.w) / 2 + 1;
  const gapZ = (a.d + b.d) / 2 + 1;
  return dx < gapX && dz < gapZ;
}

// Pusat blok kota: sel 60x60 m di antara garis jalan, pusat di -270 + 60k.
function blockCenters() {
  const centers = [];
  for (let bx = -270; bx <= 270; bx += ROAD_SPACING) {
    for (let bz = -270; bz <= 270; bz += ROAD_SPACING) {
      centers.push({ x: bx, z: bz });
    }
  }
  return centers;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

// Statistik generator per distrik (berapa percobaan, berapa berhasil, dan
// alasan gagal) — dipakai QA/debug, bukan gameplay.
const GEN_STATS = {};

function buildBuildings() {
  const list = [];
  const allBlocks = blockCenters();

  // Coba tempatkan satu bangunan di (x,z) dengan tapak w x dep.
  // Kembalikan true bila berhasil ditempatkan.
  function tryPlace(x, z, w, dep, h, d) {
    const st = (GEN_STATS[d.name] = GEN_STATS[d.name] || {
      tried: 0,
      ok: 0,
      land: 0,
      district: 0,
      roadX: 0,
      roadZ: 0,
      clash: 0,
    });
    st.tried++;
    const rotY = rng() < 0.5 ? 0 : Math.PI / 2;
    const extX = (rotY === 0 ? w : dep) / 2;
    const extZ = (rotY === 0 ? dep : w) / 2;
    // Harus di darat (tapak tidak boleh menjorok ke laut).
    if (x - extX < LAND_MIN_X || z - extZ < LAND_MIN_Z) {
      st.land++;
      return false;
    }
    if (x + extX > ROAD_MAX + 30 || z + extZ > ROAD_MAX + 30) {
      st.land++;
      return false;
    }
    // Harus tetap di dalam lingkaran distrik.
    const dx = x - d.x;
    const dz = z - d.z;
    if (Math.sqrt(dx * dx + dz * dz) > d.r) {
      st.district++;
      return false;
    }
    // Tapak tidak boleh menyentuh jalan.
    if (distToGridLine(x) < extX + ROAD_WIDTH / 2 + 1) {
      st.roadX++;
      return false;
    }
    if (distToGridLine(z) < extZ + ROAD_WIDTH / 2 + 1) {
      st.roadZ++;
      return false;
    }
    const candidate = {
      pos: { x: Math.round(x * 10) / 10, y: 0, z: Math.round(z * 10) / 10 },
      w: Math.round(w * 10) / 10,
      h: Math.round(h * 10) / 10,
      d: Math.round(dep * 10) / 10,
      color: pickBuildingColor(d.name),
      roof: pick(ROOF_PALETTE).slice(),
      district: d.name,
      rotY: rotY,
    };
    // Bangunan neon di distrik hiburan mendapat aksen neon terpisah
    // (dipakai render untuk jendela / papan nama menyala).
    if (NEON_DISTRICTS.indexOf(d.name) !== -1 && rng() < 0.45) {
      candidate.neon = pick(NEON_PALETTE).slice();
    }
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (Math.abs(other.pos.x - x) > 60 || Math.abs(other.pos.z - z) > 60) continue;
      if (buildingsOverlap(candidate, other)) {
        st.clash++;
        return false;
      }
    }
    list.push(candidate);
    st.ok++;
    return true;
  }

  // PARTISI BLOK (Voronoi relatif): tiap blok kota dimiliki tepat satu
  // distrik — distrik dengan jarak relatif (jarak / radius) terkecil ke
  // pusat blok. Tanpa partisi, distrik yang diproses lebih dulu merebut
  // blok tumpang tindih milik tetangga, dan distrik terakhir kehabisan
  // tempat (total mentok ~245 padahal kapasitas peta cukup).
  for (const b of allBlocks) {
    let owner = null;
    let bestScore = Infinity;
    for (const d of DISTRICTS) {
      const dx = b.x - d.x;
      const dz = b.z - d.z;
      const score = Math.sqrt(dx * dx + dz * dz) / d.r;
      if (score < bestScore) {
        bestScore = score;
        owner = d;
      }
    }
    b.owner = owner.name;
  }

  for (const d of DISTRICTS) {
    const profile = DISTRICT_PROFILE[d.name];
    const target = DISTRICT_COUNT[d.name] || 20;
    let placed = 0;
    // Hanya blok milik distrik ini, diurutkan dari yang terdekat ke pusat.
    const blocks = allBlocks
      .filter((b) => b.owner === d.name && b.x >= -246 && b.z >= -246)
      .sort((a, b) => {
        const da = (a.x - d.x) * (a.x - d.x) + (a.z - d.z) * (a.z - d.z);
        const db = (b.x - d.x) * (b.x - d.x) + (b.z - d.z) * (b.z - d.z);
        return da - db;
      });
    for (const b of blocks) {
      if (placed >= target) break;
      const mode = rng();
      if (mode < 0.35) {
        // Mode sangat padat: grid 4x4 kios / ruko kecil (8–10 m). Jarak
        // antar titik 11 m, jadi lebar dibatasi 10 m (4,5+4,5+1 celah).
        const offs = shuffleInPlace([
          [-16, -16], [-5, -16], [6, -16], [17, -16],
          [-16, -5], [-5, -5], [6, -5], [17, -5],
          [-16, 6], [-5, 6], [6, 6], [17, 6],
          [-16, 17], [-5, 17], [6, 17], [17, 17],
        ]);
        for (const off of offs) {
          if (placed >= target) break;
          const w = rand(8, 10);
          const dep = rand(8, 10);
          const h = rand(profile.hMin, Math.min(profile.hMax, 14));
          if (
            tryPlace(b.x + off[0] + rand(-0.5, 0.5), b.z + off[1] + rand(-0.5, 0.5), w, dep, h, d)
          ) {
            placed++;
          }
        }
      } else if (mode < 0.7) {
        // Mode padat: grid 3x3 bangunan kecil (ruko / rumah deret).
        const offs = shuffleInPlace([
          [-14, -14], [0, -14], [14, -14],
          [-14, 0], [0, 0], [14, 0],
          [-14, 14], [0, 14], [14, 14],
        ]);
        for (const off of offs) {
          if (placed >= target) break;
          // Lebar dibatasi 12 m (titik grid 28 m, celah jalan terpenuhi).
          const w = rand(Math.min(profile.wMin, 12), 12);
          const dep = rand(Math.min(profile.wMin, 12), 12);
          const h = rand(profile.hMin, Math.min(profile.hMax, 22));
          if (
            tryPlace(b.x + off[0] + rand(-1.5, 1.5), b.z + off[1] + rand(-1.5, 1.5), w, dep, h, d)
          ) {
            placed++;
          }
        }
      } else if (mode < 0.9) {
        // Mode menengah: 4 bangunan di sudut-sudut blok.
        const offs = shuffleInPlace([
          [-12, -12],
          [12, -12],
          [-12, 12],
          [12, 12],
        ]);
        for (const off of offs) {
          if (placed >= target) break;
          const w = rand(profile.wMin, Math.min(profile.wMax, 18));
          const dep = rand(profile.wMin, Math.min(profile.wMax, 18));
          const h = rand(profile.hMin, Math.min(profile.hMax, 35));
          if (
            tryPlace(b.x + off[0] + rand(-2, 2), b.z + off[1] + rand(-2, 2), w, dep, h, d)
          ) {
            placed++;
          }
        }
      } else {
        // Mode menara: 1 bangunan besar di tengah blok (gedung tinggi).
        const w = rand(profile.wMin, profile.wMax);
        const dep = rand(profile.wMin, profile.wMax);
        const h = rand(profile.hMin, profile.hMax);
        if (tryPlace(b.x + rand(-4, 4), b.z + rand(-4, 4), w, dep, h, d)) {
          placed++;
        }
      }
    }
    // Cadangan: isi sisa dengan bangunan kecil di titik acak di dalam
    // interior blok milik distrik ini (bukan acak bebas, supaya tapak
    // tidak menabrak jalan).
    const innerBlocks = blocks.filter((b) => {
      const dx = b.x - d.x;
      const dz = b.z - d.z;
      return Math.sqrt(dx * dx + dz * dz) <= d.r - 15;
    });
    const fallbackBlocks = innerBlocks.length > 0 ? innerBlocks : blocks;
    let guard = 0;
    while (placed < target && guard < target * 150) {
      guard++;
      if (fallbackBlocks.length === 0) break;
      const blk = fallbackBlocks[Math.floor(rng() * fallbackBlocks.length)];
      const x = blk.x + rand(-14, 14);
      const z = blk.z + rand(-14, 14);
      const w = rand(profile.wMin, Math.min(profile.wMax, 16));
      const dep = rand(profile.wMin, Math.min(profile.wMax, 16));
      const h = rand(profile.hMin, Math.min(profile.hMax, 28));
      if (tryPlace(x, z, w, dep, h, d)) placed++;
    }
  }

  // PUTARAN KEDUA: distrik yang masih di bawah target boleh memakai spot
  // di blok mana pun (bukan hanya blok miliknya), selama spot itu masuk
  // lingkaran distriknya sendiri dan tidak bertabrakan. Partisi Voronoi
  // putaran pertama menyisakan banyak spot pinggir yang tak terpakai oleh
  // pemilik bloknya — putaran ini memanfaatkannya. Distrik dengan
  // kekurangan terbesar didahulukan.
  const placedCount = {};
  for (const b of list) {
    placedCount[b.district] = (placedCount[b.district] || 0) + 1;
  }
  const needy = DISTRICTS.map((d) => ({
    d: d,
    need: (DISTRICT_COUNT[d.name] || 20) - (placedCount[d.name] || 0),
  }))
    .filter((item) => item.need > 0)
    .sort((a, b) => b.need - a.need);
  for (const item of needy) {
    const d = item.d;
    const profile = DISTRICT_PROFILE[d.name];
    let remaining = item.need;
    const blocks = allBlocks
      .filter((b) => b.x >= -246 && b.z >= -246)
      .sort((a, b) => {
        const da = (a.x - d.x) * (a.x - d.x) + (a.z - d.z) * (a.z - d.z);
        const db = (b.x - d.x) * (b.x - d.x) + (b.z - d.z) * (b.z - d.z);
        return da - db;
      });
    for (const b of blocks) {
      if (remaining <= 0) break;
      const offs = shuffleInPlace([
        [-14, -14], [0, -14], [14, -14],
        [-14, 0], [0, 0], [14, 0],
        [-14, 14], [0, 14], [14, 14],
      ]);
      for (const off of offs) {
        if (remaining <= 0) break;
        const w = rand(profile.wMin, Math.min(profile.wMax, 12));
        const dep = rand(profile.wMin, Math.min(profile.wMax, 12));
        const h = rand(profile.hMin, Math.min(profile.hMax, 22));
        if (
          tryPlace(b.x + off[0] + rand(-1.5, 1.5), b.z + off[1] + rand(-1.5, 1.5), w, dep, h, d)
        ) {
          remaining--;
        }
      }
    }
  }
  return list;
}

const BUILDINGS = buildBuildings();

// Hitung per distrik (dipakai QA & debug).
const BUILDINGS_PER_DISTRICT = {};
for (const d of DISTRICTS) {
  BUILDINGS_PER_DISTRICT[d.name] = 0;
}
for (const b of BUILDINGS) {
  BUILDINGS_PER_DISTRICT[b.district] = (BUILDINGS_PER_DISTRICT[b.district] || 0) + 1;
}

// ---------------------------------------------------------------------------
// getDistrictAt(x, z) — distrik yang pusatnya paling dekat & masih di dalam
// radiusnya. Kembalikan objek distrik atau null bila di luar semua distrik
// (misalnya di laut lepas / jalan antar distrik).
// ---------------------------------------------------------------------------
function getDistrictAt(x, z) {
  let best = null;
  let bestScore = Infinity;
  for (const d of DISTRICTS) {
    const dx = x - d.x;
    const dz = z - d.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= d.r) {
      // Bila titik masuk dua lingkaran yang tumpang tindih, pilih yang
      // pusatnya paling dekat secara relatif (dist / radius terkecil).
      const score = dist / d.r;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
  }
  return best;
}

function getDistrictName(x, z) {
  const d = getDistrictAt(x, z);
  return d ? d.name : null;
}

function getBuildingsInDistrict(name) {
  const out = [];
  for (const b of BUILDINGS) {
    if (b.district === name) out.push(b);
  }
  return out;
}

// Posisi jalan acak di dalam sebuah distrik (dipakai spawn mobil / NPC).
function randomStreetPos(districtName) {
  const d = DISTRICTS.find((item) => item.name === districtName) || DISTRICTS[0];
  for (let tries = 0; tries < 60; tries++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * (d.r - 10);
    const x = clamp(d.x + Math.cos(ang) * rad, LAND_MIN_X, ROAD_MAX);
    const z = clamp(d.z + Math.sin(ang) * rad, LAND_MIN_Z, ROAD_MAX);
    if (isRoad(x, z)) {
      return { x: Math.round(x * 10) / 10, y: 0, z: Math.round(z * 10) / 10 };
    }
  }
  return { x: d.x, y: 0, z: d.z };
}

// ---------------------------------------------------------------------------
// collide(pos, radius) — tabrakan lingkaran (pemain/mobil) vs kotak bangunan.
// Bila bertabrakan: dorong pos keluar sepanjang sumbu penetrasi terkecil
// (sumbu x atau z), simpan kedalaman penetrasi di lastPenetration, dan
// kembalikan true. Bila tidak ada tabrakan, kembalikan false.
// pos adalah {x, y, z} dan DIMUTASI langsung (in-place) saat tabrakan.
// Bangunan yang atapnya di bawah posisi y tidak menghalangi (mis. helikopter
// yang terbang di atas kota lolos).
// ---------------------------------------------------------------------------
let lastPenetration = 0;

function collide(pos, radius) {
  if (!pos || typeof pos.x !== "number" || typeof pos.z !== "number") {
    return false;
  }
  const r = typeof radius === "number" && radius > 0 ? radius : 1;
  let hit = false;
  lastPenetration = 0;
  for (let i = 0; i < BUILDINGS.length; i++) {
    const b = BUILDINGS[i];
    // Lewati bangunan yang sepenuhnya di bawah posisi (terbang di atasnya).
    if (typeof pos.y === "number" && pos.y >= b.h) continue;
    const halfW = b.w / 2;
    const halfD = b.d / 2;
    const dx = pos.x - b.pos.x;
    const dz = pos.z - b.pos.z;
    const overlapX = halfW + r - Math.abs(dx);
    if (overlapX <= 0) continue;
    const overlapZ = halfD + r - Math.abs(dz);
    if (overlapZ <= 0) continue;
    // Dorong keluar lewat sumbu dengan penetrasi terkecil.
    if (overlapX < overlapZ) {
      pos.x = b.pos.x + (dx >= 0 ? halfW + r : -(halfW + r));
      if (overlapX > lastPenetration) lastPenetration = overlapX;
    } else {
      pos.z = b.pos.z + (dz >= 0 ? halfD + r : -(halfD + r));
      if (overlapZ > lastPenetration) lastPenetration = overlapZ;
    }
    hit = true;
  }
  return hit;
}

// Varian non-mutasi: berapa dalam pos menembus bangunan terdekat (0 = bebas).
function penetrationAt(pos, radius) {
  const r = typeof radius === "number" && radius > 0 ? radius : 1;
  let worst = 0;
  for (let i = 0; i < BUILDINGS.length; i++) {
    const b = BUILDINGS[i];
    if (typeof pos.y === "number" && pos.y >= b.h) continue;
    const overlapX = b.w / 2 + r - Math.abs(pos.x - b.pos.x);
    const overlapZ = b.d / 2 + r - Math.abs(pos.z - b.pos.z);
    if (overlapX > 0 && overlapZ > 0) {
      worst = Math.max(worst, Math.min(overlapX, overlapZ));
    }
  }
  return worst;
}

// Apakah titik (x,z) berada di dalam tapak bangunan mana pun.
function isInsideBuilding(x, z) {
  for (let i = 0; i < BUILDINGS.length; i++) {
    const b = BUILDINGS[i];
    if (Math.abs(x - b.pos.x) <= b.w / 2 && Math.abs(z - b.pos.z) <= b.d / 2) {
      return b;
    }
  }
  return null;
}

// Batas dunia yang bisa dijelajahi (kota 1200x1200 + laut di sekitarnya).
const WORLD_BOUNDS = { minX: -600, maxX: 600, minZ: -600, maxZ: 600 };

function clampToWorld(pos) {
  pos.x = clamp(pos.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
  pos.z = clamp(pos.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
  return pos;
}

// ---------------------------------------------------------------------------
// Registrasi modul.
// ---------------------------------------------------------------------------
SB.City = {
  DISTRICTS: DISTRICTS,
  BUILDINGS: BUILDINGS,
  BUILDINGS_PER_DISTRICT: BUILDINGS_PER_DISTRICT,
  GEN_STATS: GEN_STATS,
  ROADS: ROADS,
  WORLD_BOUNDS: WORLD_BOUNDS,
  ROAD_SPACING: ROAD_SPACING,
  ROAD_WIDTH: ROAD_WIDTH,
  getDistrictAt: getDistrictAt,
  getDistrictName: getDistrictName,
  getBuildingsInDistrict: getBuildingsInDistrict,
  randomStreetPos: randomStreetPos,
  isRoad: isRoad,
  collide: collide,
  penetrationAt: penetrationAt,
  isInsideBuilding: isInsideBuilding,
  clampToWorld: clampToWorld,
  get lastPenetration() {
    return lastPenetration;
  },
};

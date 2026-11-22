// Sunset Bay v14 — SB.World
// Medan (tanah datar + bukit), permukaan laut, perahu, dan properti kota
// (lampu jalan, palem, rambu, dermaga). Ditulis dari design spec v14 §3–§5.
// Tanpa import modul lain; komunikasi antar modul hanya lewat namespace SB.

const SB_ROOT = (typeof window !== "undefined" ? window : globalThis);
SB_ROOT.SB = SB_ROOT.SB || {};
const SB = SB_ROOT.SB;

// ---------------------------------------------------------------------------
// RNG deterministik supaya dunia identik di tiap load.
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

const rng = makeRng(0x901d7e22);
function rand(min, max) {
  return min + rng() * (max - min);
}
function pick(list) {
  return list[Math.floor(rng() * list.length)];
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Laut & pantai.
// Permukaan air di y = 0 (WATER_LEVEL). Daratan kota di y = 0, pantai
// melandai ke bawah di tepi barat (x < -240) dan selatan (z < -240) sampai
// dasar laut y = -3. Air adalah daerah x < -265 atau z < -265.
// ---------------------------------------------------------------------------
const WATER_LEVEL = 0;
const COAST_X = -265; // garis pantai barat
const COAST_Z = -265; // garis pantai selatan
const SEA_FLOOR = -3;

// Bukit: gundukan halus (gaussian) di dua distrik perbukitan.
const HILLS = [
  { x: 60, z: 180, r: 110, h: 26, name: "North Hills" }, // North Hills
  { x: 180, z: 180, r: 100, h: 22, name: "Beacon Hill" }, // Beacon Hill
  { x: -40, z: 220, r: 70, h: 8, name: "University Row" }, // undakan kecil
];

function hillHeight(x, z) {
  let h = 0;
  for (const hill of HILLS) {
    const dx = (x - hill.x) / hill.r;
    const dz = (z - hill.z) / hill.r;
    const d2 = dx * dx + dz * dz;
    // Cutoff tegas di 1,5 radius: di luar itu tanah DATAR (0), supaya ekor
    // bukit tidak mengangkat pusat kota.
    if (d2 < 2.25) {
      h += hill.h * Math.exp(-d2 * 3);
    }
  }
  return h;
}

// Lereng pantai: 0 di darat, melandai ke SEA_FLOOR begitu melewati garis
// pantai, supaya garis air terlihat di tepi barat & selatan kota.
function beachSlope(x, z) {
  let drop = 0;
  if (x < -240) drop = Math.max(drop, smoothstep(-240, -275, x));
  if (z < -240) drop = Math.max(drop, smoothstep(-240, -275, z));
  return -drop * (0 - SEA_FLOOR + 0.5); // turun sampai ~-3.5 di laut
}

function terrainHeight(x, z) {
  // Di laut lepas, dasar laut datar.
  if (x < -280 || z < -280) return SEA_FLOOR;
  // Tanah datar kota (0) + bukit + lereng pantai yang melandai ke dasar laut.
  const h = hillHeight(x, z) + beachSlope(x, z);
  return h < SEA_FLOOR ? SEA_FLOOR : h;
}

function isWater(x, z) {
  return x < COAST_X || z < COAST_Z;
}

function isBeach(x, z) {
  return !isWater(x, z) && (x < -235 || z < -235);
}

// Tinggi ombak di satu titik & waktu (dipakai render air & perahu).
let time = 0;
let wavePhase = 0;
const WAVE_AMP = 0.18;

function waveHeight(x, z, t) {
  const tt = typeof t === "number" ? t : time;
  return (
    WAVE_AMP * Math.sin(x * 0.08 + tt * 1.1) * Math.cos(z * 0.06 + tt * 0.9) +
    WAVE_AMP * 0.5 * Math.sin((x + z) * 0.05 + tt * 1.7)
  );
}

// ---------------------------------------------------------------------------
// BOATS — 6 perahu, berpatroli melingkar di laut & pelabuhan.
// Dua di pelabuhan Fisherman's Wharf, dua di Harbor Point, dua di laut lepas.
// pos.y mengikuti permukaan air + ombak (diperbarui di update).
// ---------------------------------------------------------------------------
const BOATS = [
  {
    id: "boat-wharf-1",
    name: "Wharf Trawler",
    kind: "trawler",
    center: { x: -300, z: 60 },
    radius: 26,
    angle: 0.4,
    angularSpeed: 0.05,
    pos: { x: -300, y: 0, z: 60 },
    rotY: 0,
    speed: 3.2,
    bobPhase: 0,
  },
  {
    id: "boat-wharf-2",
    name: "Sunset Ferry",
    kind: "ferry",
    center: { x: -310, z: -10 },
    radius: 34,
    angle: 2.4,
    angularSpeed: 0.04,
    pos: { x: -310, y: 0, z: -10 },
    rotY: 0,
    speed: 4.0,
    bobPhase: 1.3,
  },
  {
    id: "boat-harbor-1",
    name: "Harbor Tug",
    kind: "tug",
    center: { x: -300, z: -110 },
    radius: 22,
    angle: 1.1,
    angularSpeed: 0.06,
    pos: { x: -300, y: 0, z: -110 },
    rotY: 0,
    speed: 2.6,
    bobPhase: 2.1,
  },
  {
    id: "boat-harbor-2",
    name: "Dock Runner",
    kind: "speedboat",
    center: { x: -330, z: -160 },
    radius: 40,
    angle: 4.0,
    angularSpeed: 0.09,
    pos: { x: -330, y: 0, z: -160 },
    rotY: 0,
    speed: 7.5,
    bobPhase: 0.7,
  },
  {
    id: "boat-sea-1",
    name: "Golden Hour Yacht",
    kind: "yacht",
    center: { x: -420, z: -60 },
    radius: 70,
    angle: 5.2,
    angularSpeed: 0.03,
    pos: { x: -420, y: 0, z: -60 },
    rotY: 0,
    speed: 5.0,
    bobPhase: 1.9,
  },
  {
    id: "boat-sea-2",
    name: "Coral Sailer",
    kind: "sailboat",
    center: { x: -380, z: -340 },
    radius: 55,
    angle: 2.9,
    angularSpeed: 0.035,
    pos: { x: -380, y: 0, z: -340 },
    rotY: 0,
    speed: 3.8,
    bobPhase: 2.8,
  },
];

function stepBoat(boat, dt) {
  boat.angle += boat.angularSpeed * dt;
  const x = boat.center.x + Math.cos(boat.angle) * boat.radius;
  const z = boat.center.z + Math.sin(boat.angle) * boat.radius;
  boat.pos.x = x;
  boat.pos.z = z;
  // Hadap mengikuti arah gerak (tangen lingkaran).
  boat.rotY = Math.atan2(
    -Math.sin(boat.angle) * boat.angularSpeed,
    -Math.cos(boat.angle) * boat.angularSpeed
  );
  // Oleng & naik-turun mengikuti ombak.
  boat.pos.y = WATER_LEVEL + waveHeight(x, z, time) + Math.sin(time * 0.8 + boat.bobPhase) * 0.08;
}

// Tempatkan tiap perahu di orbit patrolinya sejak awal (bukan di pusat).
for (const boat of BOATS) {
  stepBoat(boat, 0);
}

// ---------------------------------------------------------------------------
// PROPS — lampu jalan, pohon palem, rambu, dermaga, pelampung, bangku.
// Dibangkitkan deterministik sekali saat modul dimuat.
// ---------------------------------------------------------------------------
const LAMP_COLOR_WARM = [1.0, 0.75, 0.45];
const LAMP_COLOR_NEON = [0.4, 0.9, 1.0];

function buildProps() {
  const props = [];
  let id = 0;
  const nextId = (kind) => kind + "-" + String(++id).padStart(3, "0");

  // --- Lampu jalan: di sepanjang garis jalan grid, selang 60 m, berselang-
  // seling di kedua sisi jalan. Hanya di darat (x,z > -250).
  for (let gx = -300; gx <= 300; gx += 60) {
    for (let gz = -300; gz <= 300; gz += 60) {
      if (gx < -250 || gz < -250) continue;
      // Lampu di sudut persimpangan, satu tiap simpang (bergantian sisi).
      const side = ((gx + gz) / 60) % 2 === 0 ? 1 : -1;
      props.push({
        id: nextId("lamp"),
        kind: "lamp",
        pos: { x: gx + side * 8, y: 0, z: gz + 8 },
        rotY: side > 0 ? 0 : Math.PI,
        color: LAMP_COLOR_WARM.slice(),
        height: 7,
      });
    }
  }

  // --- Pohon palem: barisan di sepanjang pantai barat & selatan, rumpun di
  // Palm Court, dan selingan di Marina Bay.
  const palmSpots = [];
  for (let z = -240; z <= 260; z += 28) {
    palmSpots.push({ x: rand(-248, -232), z: z + rand(-6, 6) });
  }
  for (let x = -240; x <= 260; x += 28) {
    palmSpots.push({ x: x + rand(-6, 6), z: rand(-248, -232) });
  }
  for (let i = 0; i < 26; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 70;
    palmSpots.push({ x: 40 + Math.cos(ang) * rad, z: -180 + Math.sin(ang) * rad });
  }
  for (let i = 0; i < 12; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 90;
    palmSpots.push({ x: Math.cos(ang) * rad, z: Math.sin(ang) * rad });
  }
  for (const spot of palmSpots) {
    if (spot.x < -252 || spot.z < -252) continue;
    props.push({
      id: nextId("palm"),
      kind: "palm",
      pos: { x: Math.round(spot.x * 10) / 10, y: 0, z: Math.round(spot.z * 10) / 10 },
      rotY: rand(0, Math.PI * 2),
      height: rand(6, 11),
      lean: rand(-0.08, 0.08),
    });
  }

  // --- Rambu jalan: di persimpangan utama, menamai jalan / distrik.
  const SIGN_TEXTS = [
    "Marina Blvd",
    "Sunset Strip",
    "Ocean Drive",
    "Palm Court Ave",
    "Harbor Rd",
    "Old Town Sq",
    "Coral Way",
    "Beacon Hill Rd",
    "Market St",
    "University Ave",
    "Dockside Ln",
    "Wharf St",
  ];
  let signIdx = 0;
  for (let gx = -240; gx <= 240; gx += 120) {
    for (let gz = -240; gz <= 240; gz += 120) {
      props.push({
        id: nextId("sign"),
        kind: "sign",
        pos: { x: gx + 8, y: 0, z: gz - 8 },
        rotY: ((gx + gz) / 120) % 2 === 0 ? 0 : Math.PI / 2,
        text: SIGN_TEXTS[signIdx % SIGN_TEXTS.length],
        color: [0.1, 0.45, 0.2],
      });
      signIdx++;
    }
  }

  // --- Dermaga (pier): menjorok ke laut dari Fisherman's Wharf, Harbor
  // Point, dan Marina Bay selatan. Tiap dermaga: papan kayu + tiang.
  const PIERS = [
    { x: -252, z: 40, rotY: Math.PI / 2, length: 55, width: 8, name: "Wharf Pier" },
    { x: -252, z: -80, rotY: Math.PI / 2, length: 45, width: 8, name: "Harbor Pier" },
    { x: 0, z: -252, rotY: 0, length: 40, width: 8, name: "Marina Pier" },
  ];
  for (const pier of PIERS) {
    props.push({
      id: nextId("pier"),
      kind: "pier",
      name: pier.name,
      pos: { x: pier.x, y: 0.6, z: pier.z },
      rotY: pier.rotY,
      length: pier.length,
      width: pier.width,
      color: [0.55, 0.42, 0.28],
    });
  }

  // --- Pelampung (buoy): penanda alur pelayaran di laut barat & selatan.
  const buoySpots = [
    { x: -290, z: 100 },
    { x: -320, z: 0 },
    { x: -290, z: -60 },
    { x: -340, z: -140 },
    { x: -300, z: -220 },
    { x: -220, z: -300 },
    { x: -100, z: -310 },
    { x: 60, z: -295 },
  ];
  for (const spot of buoySpots) {
    props.push({
      id: nextId("buoy"),
      kind: "buoy",
      pos: { x: spot.x, y: 0, z: spot.z },
      rotY: rand(0, Math.PI * 2),
      color: [1.0, 0.35, 0.15],
      bobPhase: rand(0, Math.PI * 2),
    });
  }

  // --- Bangku taman: di sekitar Marina Bay & Palm Court.
  for (let i = 0; i < 16; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 80;
    const cx = i % 2 === 0 ? 0 : 40;
    const cz = i % 2 === 0 ? 0 : -180;
    props.push({
      id: nextId("bench"),
      kind: "bench",
      pos: {
        x: Math.round((cx + Math.cos(ang) * rad) * 10) / 10,
        y: 0,
        z: Math.round((cz + Math.sin(ang) * rad) * 10) / 10,
      },
      rotY: rand(0, Math.PI * 2),
      color: [0.45, 0.35, 0.25],
    });
  }

  return props;
}

const PROPS = buildProps();

function propsByKind(kind) {
  return PROPS.filter((p) => p.kind === kind);
}

// ---------------------------------------------------------------------------
// update(dt) — perahu berlayar, ombak berjalan, pelampung naik-turun.
// Dipanggil tiap frame dari game loop (SB.Main / SB.Game).
// ---------------------------------------------------------------------------
function update(dt) {
  const step = typeof dt === "number" && dt > 0 ? Math.min(dt, 0.1) : 0.016;
  time += step;
  wavePhase += step * 1.1;
  for (const boat of BOATS) {
    stepBoat(boat, step);
  }
  // Pelampung mengikuti ombak.
  for (const p of PROPS) {
    if (p.kind === "buoy") {
      p.pos.y = WATER_LEVEL + waveHeight(p.pos.x, p.pos.z, time) * 0.9;
    }
  }
}

// Posisi matahari golden hour (rendah di barat, oranye) — dipakai render.
const SUN = {
  direction: { x: -0.75, y: 0.28, z: -0.35 },
  color: [1.0, 0.6, 0.24], // #ff9a3c
  skyTop: [0.35, 0.55, 0.85],
  skyHorizon: [1.0, 0.62, 0.3],
};

// ---------------------------------------------------------------------------
// Registrasi modul.
// ---------------------------------------------------------------------------
SB.World = {
  WATER_LEVEL: WATER_LEVEL,
  SEA_FLOOR: SEA_FLOOR,
  COAST_X: COAST_X,
  COAST_Z: COAST_Z,
  HILLS: HILLS,
  SUN: SUN,
  BOATS: BOATS,
  PROPS: PROPS,
  terrainHeight: terrainHeight,
  waveHeight: waveHeight,
  isWater: isWater,
  isBeach: isBeach,
  propsByKind: propsByKind,
  update: update,
  get time() {
    return time;
  },
  get wavePhase() {
    return wavePhase;
  },
};

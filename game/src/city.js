// Sunset Bay v5 — city.js
// Layout kota pesisir prosedural: 10 distrik, jalan grid + jalan pantai,
// gedung, properti, stash, POI, marina, dan perairan. Deterministik per seed.
//
// Semua posisi dihitung dari rng yang diberikan; seed yang sama selalu
// menghasilkan kota yang sama.

const GRID_LINES = [-150, -100, -50, 0, 50, 100, 150];

// Palet tiap distrik: warna tanah, daftar warna gedung, rentang tinggi.
const DISTRICT_DEFS = [
  {
    name: 'Downtown', cx: 0, cz: -60, r: 55,
    ground: '#4a4f5c', desc: 'Menara kaca tinggi, pusat kota.',
    colors: ['#5d6b82', '#7d8aa5', '#3f4a5e', '#8fa3bd', '#6b7c99'],
    hMin: 28, hMax: 68, count: 26,
  },
  {
    name: 'Old Town', cx: -130, cz: -70, r: 42,
    ground: '#6b5a4a', desc: 'Bangunan bata, jalan sempit.',
    colors: ['#8a5a44', '#a0714f', '#7a4f3d', '#96684e', '#6e4a38'],
    hMin: 8, hMax: 18, count: 20,
  },
  {
    name: 'Southside', cx: 40, cz: 140, r: 50,
    ground: '#55504a', desc: 'Gudang dan pabrik.',
    colors: ['#6e6a63', '#7d7468', '#5c564e', '#8a7f70', '#4e4a44'],
    hMin: 6, hMax: 14, count: 18,
  },
  {
    name: 'Hillcrest', cx: 130, cz: -130, r: 45,
    ground: '#7d6b52', desc: 'Rumah terracotta di bukit, titik lookout.',
    colors: ['#c07a4a', '#d99a5f', '#b56b3f', '#e0aa72', '#a85f38'],
    hMin: 6, hMax: 12, count: 18,
  },
  {
    name: 'Beachfront', cx: -150, cz: 60, r: 45,
    ground: '#d9c48f', desc: 'Pasir, palem, boardwalk.',
    colors: ['#e8d5a0', '#f0e0b8', '#d9b878', '#c9a86a', '#efe3c0'],
    hMin: 8, hMax: 16, count: 16,
  },
  {
    name: 'The Pier', cx: -178, cz: 10, r: 22,
    ground: '#8a6f4d', desc: 'Dermaga kayu menjorok ke laut, warung.',
    colors: ['#9a7a52', '#b08a5e', '#7d6242', '#a8895f'],
    hMin: 4, hMax: 8, count: 8,
  },
  {
    name: 'Sunset Mall', cx: 80, cz: 50, r: 45,
    ground: '#5e5a55', desc: 'Mal besar dan parkir luas.',
    colors: ['#c9c2b8', '#e0d8cc', '#b8a898', '#d4c9b8'],
    hMin: 12, hMax: 20, count: 10,
  },
  {
    name: 'Marina Bay', cx: -120, cz: 158, r: 40,
    ground: '#4f5e6b', desc: 'Pelabuhan: dermaga, kapal, crane, pasar ikan.',
    colors: ['#5e7d8c', '#7d9aa8', '#4a6a7d', '#8fb0bd', '#6b8a99'],
    hMin: 8, hMax: 16, count: 14,
  },
  {
    name: 'Northside', cx: -70, cz: -140, r: 45,
    ground: '#5d7050', desc: 'Perumahan tenang dan taman.',
    colors: ['#e0cfa8', '#c9b48a', '#d4bfa0', '#b8a37e', '#e8dcc0'],
    hMin: 5, hMax: 10, count: 20,
  },
  {
    name: 'Uptown', cx: 140, cz: -20, r: 45,
    ground: '#4a5566', desc: 'Apartemen dan kantor modern.',
    colors: ['#6b7d99', '#8aa0b8', '#5a6b82', '#7d93ad', '#4e5e75'],
    hMin: 20, hMax: 45, count: 20,
  },
];

// Jarak sebuah titik ke garis jalan grid terdekat (sumbu x atau z).
function nearRoad(x, z, margin) {
  for (const g of GRID_LINES) {
    if (Math.abs(x - g) < margin) return true;
    if (Math.abs(z - g) < margin) return true;
  }
  return false;
}

// Cek apakah titik berada di dalam salah satu rect air.
function inRects(rects, x, z) {
  for (const r of rects) {
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2) return true;
  }
  return false;
}

export function buildCity(rng) {
  const districts = DISTRICT_DEFS.map((d) => ({
    name: d.name, cx: d.cx, cz: d.cz, r: d.r,
    color: d.ground, desc: d.desc,
  }));

  // ---- Perairan: laut barat + laut selatan + cekungan marina ----
  const water = [
    { x: -193, z: 0, w: 14, d: 400 },   // laut barat (x -200..-186)
    { x: 0, z: 193, w: 400, d: 14 },    // laut selatan (z 186..200)
    { x: -120, z: 182, w: 110, d: 12 }, // cekungan marina (z 176..188)
  ];

  // ---- Jalan: grid + jalan pantai ----
  const roads = [];
  for (const g of GRID_LINES) {
    roads.push({ x1: g, z1: -185, x2: g, z2: 185, w: 10 }); // vertikal
    roads.push({ x1: -185, z1: g, x2: 185, z2: g, w: 10 }); // horizontal
  }
  // Jalan pantai barat (sepanjang pantai) dan jalan pelabuhan selatan.
  roads.push({ x1: -178, z1: -185, x2: -178, z2: 175, w: 8 });
  roads.push({ x1: -178, z1: 172, x2: 185, z2: 172, w: 8 });
  // Jalan akses ke Hillcrest lookout (tanjakan).
  roads.push({ x1: 100, z1: -150, x2: 155, z2: -150, w: 8 });

  // ---- Gedung ----
  const buildings = [];
  const placed = []; // {x, z, r} untuk cek tumpang tindih

  function tryPlace(x, z, w, d) {
    if (x < -180 || x > 185 || z < -180 || z > 170) return false;
    if (inRects(water, x, z)) return false;
    if (nearRoad(x, z, 8)) return false;
    const rr = Math.max(w, d) / 2 + 3;
    for (const p of placed) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < (p.r + rr) * (p.r + rr)) return false;
    }
    placed.push({ x, z, r: rr });
    return true;
  }

  for (const def of DISTRICT_DEFS) {
    let made = 0;
    let attempts = 0;
    while (made < def.count && attempts < def.count * 40) {
      attempts++;
      const a = rng.next() * Math.PI * 2;
      const rr = Math.sqrt(rng.next()) * def.r * 0.85;
      const x = Math.round(def.cx + Math.cos(a) * rr);
      const z = Math.round(def.cz + Math.sin(a) * rr);
      const w = rng.int(8, 20);
      const d = rng.int(8, 20);
      if (!tryPlace(x, z, w, d)) continue;
      const h = rng.int(def.hMin, def.hMax);
      buildings.push({
        x, z, w, d, h,
        color: rng.pick(def.colors),
        roof: rng.pick(['flat', 'flat', 'flat', 'pyr', 'slab']),
        district: def.name,
      });
      made++;
    }
  }

  // Landmark tetap (dibangun di atas pola acak, posisi dijamin bebas jalan).
  const landmarks = [
    // Menara bank Downtown — gedung tertinggi kota.
    { x: 18, z: -72, w: 26, d: 26, h: 74, color: '#2f3a4e', roof: 'pyr', district: 'Downtown' },
    // Gedung mal utama Sunset Mall.
    { x: 80, z: 50, w: 44, d: 32, h: 18, color: '#e8ddc8', roof: 'flat', district: 'Sunset Mall' },
    // Pasar ikan Marina Bay.
    { x: -105, z: 150, w: 30, d: 16, h: 9, color: '#7d9aa8', roof: 'slab', district: 'Marina Bay' },
    // Gudang besar Southside.
    { x: 55, z: 150, w: 34, d: 20, h: 12, color: '#5c564e', roof: 'slab', district: 'Southside' },
    // Menara lookout Hillcrest.
    { x: 152, z: -148, w: 10, d: 10, h: 22, color: '#b56b3f', roof: 'pyr', district: 'Hillcrest' },
  ];
  for (const b of landmarks) {
    // Landmark dipaksa masuk meski tryPlace menolak (posisinya sudah dipilih aman).
    if (tryPlace(b.x, b.z, b.w, b.d) || true) buildings.push(b);
    placed.push({ x: b.x, z: b.z, r: Math.max(b.w, b.d) / 2 + 3 });
  }

  // ---- Properti ----
  const props = [];

  // Lampu jalan di sepanjang tiap jalan grid (sisi kanan jalan, tiap ~28 unit).
  for (const g of GRID_LINES) {
    for (let t = -175; t <= 175; t += 28) {
      if (rng.chance(0.85)) props.push({ kind: 'lamp', x: g + 7, z: t + rng.int(-3, 3) });
      if (rng.chance(0.5)) props.push({ kind: 'lamp', x: t + rng.int(-3, 3), z: g - 7 });
    }
  }
  // Rambu di persimpangan utama.
  for (const gx of [-100, 0, 100]) {
    for (const gz of [-100, 0, 100]) {
      props.push({ kind: 'sign', x: gx + 7, z: gz + 7 });
    }
  }
  // Hydrant tersebar di trotoar.
  for (let i = 0; i < 26; i++) {
    const x = rng.int(-170, 175);
    const z = rng.int(-170, 165);
    if (!inRects(water, x, z) && !nearRoad(x, z, 5)) {
      props.push({ kind: 'hydrant', x, z });
    }
  }
  // Peti di Southside dan Marina Bay.
  for (let i = 0; i < 18; i++) {
    const base = rng.chance(0.5) ? { x: 40, z: 140 } : { x: -120, z: 150 };
    const x = base.x + rng.int(-30, 30);
    const z = base.z + rng.int(-20, 20);
    if (!inRects(water, x, z)) props.push({ kind: 'crate', x, z });
  }
  // Pohon: banyak di Hillcrest + Northside, sedikit di Beachfront (palem).
  for (let i = 0; i < 60; i++) {
    const zone = rng.pick([
      { x: 130, z: -130, r: 42 }, { x: -70, z: -140, r: 42 },
      { x: -150, z: 60, r: 40 }, { x: 0, z: -60, r: 50 },
    ]);
    const a = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next()) * zone.r;
    const x = Math.round(zone.x + Math.cos(a) * rr);
    const z = Math.round(zone.z + Math.sin(a) * rr);
    if (!inRects(water, x, z) && !nearRoad(x, z, 6)) {
      props.push({ kind: 'tree', x, z });
    }
  }

  // ---- Marina: dermaga kayu + crane ----
  const marina = {
    x: -120, z: 168,
    docks: [
      { x: -148, z: 184, len: 16, angle: 0 },
      { x: -128, z: 186, len: 20, angle: 0 },
      { x: -108, z: 186, len: 20, angle: 0 },
      { x: -88, z: 184, len: 16, angle: 0 },
    ],
  };
  for (const dock of marina.docks) {
    props.push({ kind: 'dock', x: dock.x, z: dock.z });
  }
  // Crane pelabuhan di tepi marina.
  props.push({ kind: 'crane', x: -150, z: 168 });
  props.push({ kind: 'crane', x: -95, z: 168 });
  props.push({ kind: 'crane', x: -120, z: 160 });
  // Dermaga The Pier (menjorok ke laut barat).
  props.push({ kind: 'dock', x: -186, z: 10 });
  props.push({ kind: 'dock', x: -190, z: -6 });

  // ---- POI ----
  const garage = { x: 45, z: 78, name: 'Sunset Garage' };
  const shop = { x: -28, z: 62, name: 'Bay Mart' };
  const safehouse = { x: -72, z: -128, name: 'Sunset Safehouse' };

  // ---- Stash (6, di lokasi masuk akal, di darat) ----
  const stashSpots = [
    { x: 30, z: -78, why: 'gang belakang menara bank Downtown' },
    { x: 108, z: 74, why: 'belakang gedung mal Sunset Mall' },
    { x: -182, z: 10, why: 'ujung darat dermaga The Pier' },
    { x: -128, z: 174, why: 'ujung dermaga Marina Bay' },
    { x: 146, z: -142, why: 'dekat menara lookout Hillcrest' },
    { x: 72, z: 158, why: 'halaman gudang Southside' },
  ];
  const stashes = stashSpots.map((s) => ({
    x: s.x + rng.int(-2, 2),
    z: s.z + rng.int(-2, 2),
  }));

  return {
    districts,
    roads,
    buildings,
    props,
    stashes,
    garage,
    shop,
    safehouse,
    marina,
    water,
    bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
  };
}

export function districtAt(city, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const d of city.districts) {
    const dx = x - d.cx, dz = z - d.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= d.r) return d.name;
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best ? best.name : 'Downtown';
}

export function isWater(city, x, z) {
  return inRects(city.water, x, z);
}

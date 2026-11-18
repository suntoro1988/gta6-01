// The city: a 6x6 grid of blocks on a sunset coast, generated from a seed
// so every run (and every screenshot) shows the same streets.
import { MeshBuilder, shade } from './gl.js';

export const ROAD_W = 12;
// Road centre lines, west to east and south to north.
export const LINES = [-156, -104, -52, 0, 52, 104, 156];
export const CITY_MIN = -162;
export const CITY_MAX = 162;
export const BEACH_X = 190; // sand ends, ocean begins
export const WORLD = { minX: -172, maxX: 198, minZ: -172, maxZ: 172 };

const NEON = [
  [1.0, 0.25, 0.55], [0.2, 0.9, 1.0], [1.0, 0.85, 0.2], [0.65, 0.4, 1.0],
  [0.5, 1.0, 0.3], [1.0, 0.45, 0.85],
];
const WINDOW_LIT = [1.0, 0.85, 0.55];
const WINDOW_DARK = [0.25, 0.3, 0.42];

// --- Districts: 9 named neighbourhoods, one per region of the 6x6 grid.
// Each has its own building palette (five colours in v4) and height range,
// so the city reads as different places instead of one repeating pattern.
// The map is indexed [bx][bz] over the block grid; the park block (2,2)
// is Bay Park itself. v4 adds Hillcrest, a terracotta hillside quarter
// in the far west blocks, with cypress trees and a lookout tower. ---
export const DISTRICTS = [
  { name: 'Old Town', colors: [[0.93, 0.82, 0.68], [0.9, 0.6, 0.5], [0.95, 0.75, 0.35], [0.85, 0.7, 0.55], [0.8, 0.55, 0.45]], h: [8, 18] },
  { name: 'Downtown', colors: [[0.35, 0.65, 0.62], [0.65, 0.55, 0.85], [0.92, 0.9, 0.86], [0.3, 0.45, 0.7], [0.55, 0.6, 0.75]], h: [18, 34] },
  { name: 'Marina', colors: [[0.95, 0.62, 0.72], [0.92, 0.9, 0.86], [0.95, 0.55, 0.45], [0.5, 0.8, 0.85], [1.0, 0.7, 0.5]], h: [22, 46] },
  { name: 'West End', colors: [[0.6, 0.8, 0.65], [0.93, 0.82, 0.68], [0.9, 0.6, 0.5], [0.75, 0.85, 0.6], [0.95, 0.85, 0.6]], h: [8, 20] },
  { name: 'The Strip', colors: [[0.65, 0.55, 0.85], [0.95, 0.62, 0.72], [0.95, 0.55, 0.45], [1.0, 0.35, 0.6], [0.3, 0.85, 0.9]], h: [16, 32] },
  { name: 'Southside', colors: [[0.95, 0.55, 0.45], [0.9, 0.6, 0.5], [0.6, 0.8, 0.65], [0.85, 0.5, 0.35], [0.7, 0.75, 0.55]], h: [8, 22] },
  { name: 'Midtown', colors: [[0.92, 0.9, 0.86], [0.35, 0.65, 0.62], [0.95, 0.75, 0.35], [0.45, 0.55, 0.8], [0.9, 0.65, 0.4]], h: [14, 28] },
  { name: 'Harbor South', colors: [[0.35, 0.65, 0.62], [0.6, 0.8, 0.65], [0.93, 0.82, 0.68], [0.5, 0.7, 0.75], [0.8, 0.7, 0.5]], h: [8, 24] },
  { name: 'Hillcrest', colors: [[0.85, 0.55, 0.4], [0.95, 0.88, 0.72], [0.6, 0.7, 0.5], [0.9, 0.65, 0.55], [0.78, 0.68, 0.5]], h: [10, 26] },
];
// [bx][bz] -> district index. Rows are bz (south to north), columns bx.
const DISTRICT_MAP = [
  [0, 0, 3, 5, 8, 8],
  [0, 0, 3, 5, 8, 8],
  [1, 1, -1, 6, 6, 6],
  [1, 1, 6, 6, 6, 6],
  [2, 2, 4, 7, 7, 7],
  [2, 2, 4, 7, 7, 7],
];

/** The district a ground point sits in (Bay Park for the park block,
 * Marina for the beach strip east of the city, Old Town off-grid). */
export function districtAt(x, z) {
  if (x > CITY_MAX) return DISTRICTS[2]; // the beach belongs to Marina
  let bx = -1;
  let bz = -1;
  for (let i = 0; i < 6; i += 1) {
    if (x >= LINES[i] && x < LINES[i + 1]) bx = i;
    if (z >= LINES[i] && z < LINES[i + 1]) bz = i;
  }
  if (bx < 0 || bz < 0) return DISTRICTS[0];
  const id = DISTRICT_MAP[bx][bz];
  if (id < 0) return { name: 'Bay Park', colors: DISTRICTS[0].colors, h: [8, 18] };
  return DISTRICTS[id];
}

// --- Fixed places: the garage (car upgrades), the shop (ammo) and the
// safehouse (heal + save). All sit on a road line, never inside a building,
// so they are always reachable on foot or by car. ---
export const PLACES = {
  garage: { name: 'Sunset Garage', x: -104, z: 46, color: [1.0, 0.6, 0.15] },
  shop: { name: 'Ammo & More', x: 104, z: -46, color: [0.3, 0.9, 0.4] },
  safehouse: { name: 'Safehouse', x: -52, z: 24, color: [0.35, 0.6, 1.0] },
};

function blockBounds(bx, bz) {
  return {
    x0: LINES[bx] + ROAD_W / 2,
    x1: LINES[bx + 1] - ROAD_W / 2,
    z0: LINES[bz] + ROAD_W / 2,
    z1: LINES[bz + 1] - ROAD_W / 2,
  };
}

export function generateCity(rng) {
  const buildings = [];
  const lamps = [];
  const trees = [];
  const cypress = [];
  const signs = [];
  const parkSpots = [];
  const landmarks = [];

  for (let bx = 0; bx < 6; bx += 1) {
    for (let bz = 0; bz < 6; bz += 1) {
      const b = blockBounds(bx, bz);
      // The middle block is a park: grass, palms, no buildings.
      if (bx === 2 && bz === 2) {
        for (let i = 0; i < 7; i += 1) {
          trees.push({ x: rng.range(b.x0 + 4, b.x1 - 4), z: rng.range(b.z0 + 4, b.z1 - 4), s: rng.range(0.9, 1.4) });
        }
        continue;
      }
      const nearBeach = bx === 5;
      const mid = {
        x: (b.x0 + b.x1) / 2,
        z: (b.z0 + b.z1) / 2,
      };
      const district = districtAt(mid.x, mid.z);
      const isHillcrest = district.name === 'Hillcrest';
      const count = rng.chance(0.55) ? 1 : rng.int(2, 4);
      for (let i = 0; i < count; i += 1) {
        const cols = count === 1 ? 1 : 2;
        const rows = Math.ceil(count / cols);
        const ci = i % cols;
        const ri = Math.floor(i / cols);
        const cw = (b.x1 - b.x0) / cols;
        const ch = (b.z1 - b.z0) / rows;
        const w = cw * rng.range(0.55, 0.8);
        const d = ch * rng.range(0.55, 0.8);
        const x = b.x0 + ci * cw + cw / 2 + rng.range(-2, 2);
        const z = b.z0 + ri * ch + ch / 2 + rng.range(-2, 2);
        const h = nearBeach
          ? rng.range(22, 46)
          : rng.range(district.h[0], district.h[1]) + (Math.abs(bx - 2.5) + Math.abs(bz - 2.5) < 2 ? 8 : 0);
        // A few landmark towers rise above their district's range, so the
        // skyline has peaks instead of one flat band of heights.
        const tall = rng.chance(0.08) ? Math.min(54, h * 1.45) : h;
        // Gaussian jitter on top, so two buildings from the same district
        // range never come out exactly the same height.
        const hj = Math.max(6, tall + rng.gauss() * 1.5);
        const color = rng.pick(district.colors);
        const building = { x, z, w, d, h: hj, color };
        buildings.push(building);
        // A neon sign on some buildings, facing a random street.
        if (rng.chance(0.35)) {
          const face = rng.int(0, 3);
          const nc = rng.pick(NEON);
          const sw = Math.min(6, w * 0.5);
          const sy = rng.range(1.2, 2.2);
          const sh = Math.min(h * 0.55, rng.range(6, 14));
          if (face === 0) signs.push({ x, y: sh, z: z + d / 2 + 0.15, w: sw, h: sy, alongX: true, color: nc });
          if (face === 1) signs.push({ x, y: sh, z: z - d / 2 - 0.15, w: sw, h: sy, alongX: true, color: nc });
          if (face === 2) signs.push({ x: x + w / 2 + 0.15, y: sh, z, w: sw, h: sy, alongX: false, color: nc });
          if (face === 3) signs.push({ x: x - w / 2 - 0.15, y: sh, z, w: sw, h: sy, alongX: false, color: nc });
        }
      }
      // Palm trees on the block corners.
      for (let i = 0; i < 2; i += 1) {
        trees.push({ x: rng.range(b.x0 + 2, b.x1 - 2), z: rng.chance(0.5) ? b.z0 + 2 : b.z1 - 2, s: rng.range(0.8, 1.2) });
      }
      // Hillcrest grows tall cypress instead of extra palms, so the
      // hillside quarter reads green and vertical from across town.
      if (isHillcrest) {
        for (let i = 0; i < 3; i += 1) {
          cypress.push({ x: rng.range(b.x0 + 3, b.x1 - 3), z: rng.range(b.z0 + 3, b.z1 - 3), s: rng.range(0.9, 1.5) });
        }
      }
      // Parked cars along the block edge.
      if (rng.chance(0.7)) {
        const alongX = rng.chance(0.5);
        parkSpots.push({
          x: alongX ? rng.range(b.x0 + 4, b.x1 - 4) : (rng.chance(0.5) ? b.x0 - 3.5 : b.x1 + 3.5),
          z: alongX ? (rng.chance(0.5) ? b.z0 - 3.5 : b.z1 + 3.5) : rng.range(b.z0 + 4, b.z1 - 4),
          heading: alongX ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2),
        });
      }
    }
  }

  // Street lamps at every intersection corner.
  for (const lx of LINES) {
    for (const lz of LINES) {
      lamps.push({ x: lx + 7.5, z: lz + 7.5 });
      lamps.push({ x: lx - 7.5, z: lz - 7.5 });
    }
  }
  // Palms along the beach.
  for (let z = -150; z <= 150; z += 24) {
    trees.push({ x: 172 + rng.range(-2, 4), z: z + rng.range(-4, 4), s: rng.range(1.0, 1.5) });
  }

  // Landmarks for jobs: hotel tower by the beach, the pier, the mall,
  // the docks, the park — and, in v4, the Hillcrest lookout.
  landmarks.push({ name: 'Hotel Bayview', x: 138, z: -78, kind: 'hotel' });
  landmarks.push({ name: 'The Pier', x: 196, z: 0, kind: 'pier' });
  landmarks.push({ name: 'Sunset Mall', x: -130, z: 130, kind: 'mall' });
  landmarks.push({ name: 'The Docks', x: -130, z: -130, kind: 'docks' });
  landmarks.push({ name: 'Bay Park', x: -26, z: -26, kind: 'park' });
  landmarks.push({ name: 'Hillcrest Lookout', x: -140, z: 104, kind: 'lookout' });

  // The hotel tower: tall, by the beach.
  buildings.push({ x: 138, z: -78, w: 26, d: 22, h: 52, color: [0.95, 0.62, 0.72] });
  signs.push({ x: 138, y: 46, z: -78 + 11 + 0.15, w: 14, h: 3, alongX: true, color: [1.0, 0.25, 0.55] });
  // The lookout tower: a terracotta block in Hillcrest, drawn with its
  // round tower and cone roof in buildCityMesh.
  buildings.push({ x: -140, z: 104, w: 14, d: 14, h: 24, color: [0.85, 0.55, 0.4] });

  return { buildings, lamps, trees, cypress, signs, parkSpots, landmarks };
}

/** Build the one big static mesh for the whole city. */
export function buildCityMesh(city) {
  const m = new MeshBuilder();
  // Base ground: concrete under the city, sand on the beach, ocean beyond.
  m.groundQuad(-400, -400, CITY_MAX, 400, 0, [0.52, 0.5, 0.46]);
  m.groundQuad(CITY_MAX, -400, BEACH_X, 400, 0.02, [0.9, 0.8, 0.6]);
  m.groundQuad(BEACH_X, -400, 400, 400, 0.04, [0.16, 0.45, 0.62]);
  // Park grass.
  const park = blockBounds(2, 2);
  m.groundQuad(park.x0, park.z0, park.x1, park.z1, 0.03, [0.32, 0.55, 0.32]);

  // Roads: asphalt strips along every line, with sidewalks beside them.
  for (const line of LINES) {
    m.groundQuad(line - ROAD_W / 2, CITY_MIN, line + ROAD_W / 2, CITY_MAX, 0.05, [0.22, 0.22, 0.25]);
    m.groundQuad(CITY_MIN, line - ROAD_W / 2, CITY_MAX, line + ROAD_W / 2, 0.05, [0.22, 0.22, 0.25]);
    // Centre dashes.
    for (let t = CITY_MIN + 8; t < CITY_MAX; t += 16) {
      m.groundQuad(line - 0.4, t, line + 0.4, t + 5, 0.08, [0.95, 0.8, 0.25]);
      m.groundQuad(t, line - 0.4, t + 5, line + 0.4, 0.08, [0.95, 0.8, 0.25]);
    }
  }
  // Sidewalks: light strips around each block.
  for (let bx = 0; bx < 6; bx += 1) {
    for (let bz = 0; bz < 6; bz += 1) {
      const b = blockBounds(bx, bz);
      m.groundQuad(b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z1 + 2, 0.06, [0.62, 0.6, 0.55]);
      if (bx === 2 && bz === 2) continue;
      m.groundQuad(b.x0, b.z0, b.x1, b.z1, 0.07, [0.55, 0.53, 0.48]);
    }
  }
  // Crosswalks at every intersection.
  for (const lx of LINES) {
    for (const lz of LINES) {
      for (let i = -2; i <= 2; i += 1) {
        m.groundQuad(lx - 5 + i * 2.2, lz - ROAD_W / 2, lx - 5 + i * 2.2 + 1.1, lz + ROAD_W / 2, 0.09, [0.92, 0.92, 0.88]);
      }
    }
  }

  // Buildings, with lit windows as thin glowing strips on the faces.
  for (const b of city.buildings) {
    m.box(b.x, b.h / 2, b.z, b.w, b.h, b.d, b.color, shade(b.color, 0.75));
    // Roof rim.
    m.box(b.x, b.h + 0.4, b.z, b.w * 0.7, 0.8, b.d * 0.7, shade(b.color, 0.6));
    // Facade variation: a neon-trim band near the top (one of the six
    // neon colours, picked from the building's position so it is stable),
    // plus rooftop props — an AC box on every roof, a water tower on the
    // tall ones — so roofs read as roofs, not flat caps.
    const accent = NEON[(((Math.floor(b.x * 7 + b.z * 3) % NEON.length) + NEON.length) % NEON.length)];
    m.box(b.x, b.h - 1.4, b.z + b.d / 2 + 0.06, b.w * 0.92, 0.9, 0.12, accent, accent, 0.55);
    m.box(b.x, b.h - 1.4, b.z - b.d / 2 - 0.06, b.w * 0.92, 0.9, 0.12, accent, accent, 0.55);
    m.box(b.x - b.w * 0.22, b.h + 1.1, b.z - b.d * 0.15, Math.min(3.2, b.w * 0.28), 1.4, 2.2, [0.55, 0.56, 0.6]);
    if (b.h >= 22) {
      m.cylinder(b.x + b.w * 0.22, b.h + 0.8, b.z + b.d * 0.18, 1.1, 3.4, [0.45, 0.36, 0.28], 8);
      m.box(b.x + b.w * 0.22, b.h + 4.6, b.z + b.d * 0.18, 2.8, 0.7, 2.8, [0.4, 0.32, 0.25]);
    }
    // Window strips: a few glowing bands on the two long faces.
    const rows = Math.max(1, Math.floor(b.h / 7));
    for (let r = 0; r < rows; r += 1) {
      const wy = 4 + r * 7;
      if (wy > b.h - 2) break;
      const lit = (r * 7 + Math.floor(b.x)) % 3 !== 0;
      const wc = lit ? WINDOW_LIT : WINDOW_DARK;
      const glow = lit ? 0.7 : 0;
      m.box(b.x, wy, b.z + b.d / 2 + 0.06, b.w * 0.8, 1.6, 0.12, wc, wc, glow);
      m.box(b.x, wy, b.z - b.d / 2 - 0.06, b.w * 0.8, 1.6, 0.12, wc, wc, glow);
      // Tall buildings get lit windows on the side face too, so they do
      // not look blank from the street running alongside them.
      if (b.h >= 22) {
        m.box(b.x + b.w / 2 + 0.06, wy, b.z, 0.12, 1.6, b.d * 0.8, wc, wc, glow);
      }
    }
  }
  // Neon signs.
  for (const s of city.signs) {
    if (s.alongX) m.box(s.x, s.y, s.z, s.w, s.h, 0.3, s.color, s.color, 0.95);
    else m.box(s.x, s.y, s.z, 0.3, s.h, s.w, s.color, s.color, 0.95);
  }
  // Street lamps: pole and glowing head.
  for (const lamp of city.lamps) {
    m.cylinder(lamp.x, 0, lamp.z, 0.18, 7, [0.2, 0.2, 0.22], 6);
    m.box(lamp.x, 7.1, lamp.z, 0.5, 0.3, 1.6, [1.0, 0.85, 0.5], [1.0, 0.85, 0.5], 0.9);
  }
  // Palm trees: trunk and three crowns.
  for (const t of city.trees) {
    const s = t.s;
    m.cylinder(t.x, 0, t.z, 0.22 * s, 5.5 * s, [0.5, 0.38, 0.25], 6);
    m.octa(t.x, 6.2 * s, t.z, 2.2 * s, [0.25, 0.55, 0.25]);
    m.octa(t.x + 1.2 * s, 5.6 * s, t.z + 0.6 * s, 1.5 * s, [0.3, 0.62, 0.28]);
    m.octa(t.x - 1.1 * s, 5.7 * s, t.z - 0.7 * s, 1.4 * s, [0.22, 0.5, 0.24]);
  }
  // Hillcrest cypress: a thin trunk and two stacked dark-green crowns,
  // tall and narrow where palms are wide and round.
  for (const t of city.cypress || []) {
    const s = t.s;
    m.cylinder(t.x, 0, t.z, 0.18 * s, 4.5 * s, [0.4, 0.32, 0.22], 6);
    m.octa(t.x, 6.5 * s, t.z, 1.3 * s, [0.16, 0.4, 0.2]);
    m.octa(t.x, 9.0 * s, t.z, 0.9 * s, [0.2, 0.48, 0.24]);
  }
  // The pier: wooden deck into the ocean, with posts and a little shack.
  m.box(208, 0.6, 0, 36, 1.2, 8, [0.55, 0.42, 0.28], [0.62, 0.48, 0.32]);
  // Water: pale wave bands rolling across the ocean, and beach umbrellas
  // on the sand, so the coast reads as a beach, not a blue slab.
  for (const wx of [198, 214, 232, 252]) {
    for (let wz = -170; wz < 170; wz += 34) {
      m.groundQuad(wx, wz, wx + 1.6, wz + 18, 0.06, [0.42, 0.68, 0.8], 0.25);
    }
  }
  const UMBRELLAS = [
    { x: 170, z: -60, c: [1.0, 0.35, 0.45] },
    { x: 176, z: 24, c: [0.25, 0.85, 0.95] },
    { x: 171, z: 78, c: [1.0, 0.85, 0.25] },
    { x: 178, z: 132, c: [0.65, 0.45, 1.0] },
    { x: 173, z: -120, c: [0.35, 0.9, 0.5] },
    { x: 179, z: -8, c: [1.0, 0.55, 0.25] },
  ];
  for (const u of UMBRELLAS) {
    m.cylinder(u.x, 0, u.z, 0.12, 2.6, [0.9, 0.88, 0.8], 6);
    m.octa(u.x, 3.1, u.z, 2.4, u.c);
    m.box(u.x + 1.6, 0.25, u.z + 1.2, 2.2, 0.5, 1.2, [0.95, 0.6, 0.4]);
  }
  // Lifeguard tower on the sand: four legs, a cabin and a cone roof.
  for (const dx of [-1.6, 1.6]) {
    for (const dz of [-1.4, 1.4]) {
      m.cylinder(180 + dx, 0, -100 + dz, 0.16, 4.2, [0.85, 0.85, 0.8], 6);
    }
  }
  m.box(180, 4.8, -100, 4.2, 2.2, 3.4, [0.95, 0.95, 0.9], [0.9, 0.9, 0.85]);
  m.cone(180, 5.9, -100, 3.0, 2.0, [1.0, 0.35, 0.3], 8);
  // Boardwalk along the sand: wooden planks with a cross-plank rhythm,
  // so the beach edge reads as a promenade, not a hard concrete line.
  m.groundQuad(164, -160, 170, 160, 0.05, [0.6, 0.48, 0.32]);
  for (let z = -158; z < 160; z += 8) {
    m.groundQuad(164.4, z, 169.6, z + 1.2, 0.06, [0.52, 0.4, 0.26]);
  }
  // Beach volleyball court: a pale sand square, two net poles and a net.
  m.groundQuad(172, 52, 184, 64, 0.05, [0.95, 0.87, 0.68]);
  m.cylinder(178, 0, 52.5, 0.12, 2.4, [0.9, 0.9, 0.85], 6);
  m.cylinder(178, 0, 63.5, 0.12, 2.4, [0.9, 0.9, 0.85], 6);
  m.box(178, 2.0, 58, 0.15, 0.9, 11, [0.95, 0.95, 0.9]);
  for (let x = 194; x <= 224; x += 6) {
    m.cylinder(x, -1, -3.4, 0.5, 2.4, [0.4, 0.3, 0.2], 6);
    m.cylinder(x, -1, 3.4, 0.5, 2.4, [0.4, 0.3, 0.2], 6);
  }
  m.box(222, 2.6, 0, 5, 4, 6, [0.85, 0.5, 0.4], [0.7, 0.4, 0.32]);
  m.box(222, 5.2, 0, 6, 1, 7, [0.5, 0.3, 0.25]);

  // Hillcrest Lookout: a stone plaza, a round tower with a cone roof and
  // a glowing beacon cap, so the new district has a skyline of its own.
  m.groundQuad(-152, 92, -128, 116, 0.06, [0.68, 0.62, 0.52]);
  m.cylinder(-140, 24, 104, 4.5, 12, [0.85, 0.55, 0.4], 10);
  m.cone(-140, 36, 104, 5.6, 5, [0.7, 0.35, 0.28], 10);
  m.octa(-140, 43.5, 104, 1.6, [1.0, 0.85, 0.3], 0.9);

  // Garage, shop and safehouse kiosks: a low canopy in the place colour
  // with a glowing sign, so each one reads from down the street.
  for (const key of Object.keys(PLACES)) {
    const p = PLACES[key];
    m.box(p.x, 0.5, p.z, 7, 1, 5, [0.3, 0.3, 0.34]);
    m.box(p.x, 3.4, p.z, 7.6, 0.5, 5.6, p.color, p.color, 0.35);
    m.box(p.x, 4.6, p.z, 4.5, 1.6, 0.3, p.color, p.color, 0.9);
    m.cylinder(p.x - 3.2, 0, p.z - 2.2, 0.18, 3.2, [0.25, 0.25, 0.28], 6);
    m.cylinder(p.x + 3.2, 0, p.z - 2.2, 0.18, 3.2, [0.25, 0.25, 0.28], 6);
    m.cylinder(p.x - 3.2, 0, p.z + 2.2, 0.18, 3.2, [0.25, 0.25, 0.28], 6);
    m.cylinder(p.x + 3.2, 0, p.z + 2.2, 0.18, 3.2, [0.25, 0.25, 0.28], 6);
  }

  return m;
}

/** Building colliders as AABBs, for cars and feet. */
export function buildingColliders(city) {
  return city.buildings.map((b) => ({
    x0: b.x - b.w / 2,
    x1: b.x + b.w / 2,
    z0: b.z - b.d / 2,
    z1: b.z + b.d / 2,
  }));
}

/** True when (x, z) is on a road (asphalt), for speed and sound feel. */
export function onRoad(x, z) {
  for (const line of LINES) {
    if (Math.abs(x - line) < ROAD_W / 2 + 0.5) return true;
    if (Math.abs(z - line) < ROAD_W / 2 + 0.5) return true;
  }
  return false;
}

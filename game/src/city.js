// The city: a 6x6 grid of blocks on a sunset coast, generated from a seed so
// every run (and every screenshot) shows the same streets.
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
];
const WINDOW_LIT = [1.0, 0.85, 0.55];
const WINDOW_DARK = [0.25, 0.3, 0.42];

// --- Districts: 8 named neighbourhoods, one per region of the 6x6 grid.
// Each has its own building palette and height range, so the city reads
// as different places instead of one repeating pattern. The map is indexed
// [bx][bz] over the block grid; the park block (2,2) is Bay Park itself. ---
export const DISTRICTS = [
  { name: 'Old Town', colors: [[0.93, 0.82, 0.68], [0.9, 0.6, 0.5], [0.95, 0.75, 0.35]], h: [8, 18] },
  { name: 'Downtown', colors: [[0.35, 0.65, 0.62], [0.65, 0.55, 0.85], [0.92, 0.9, 0.86]], h: [18, 34] },
  { name: 'Marina', colors: [[0.95, 0.62, 0.72], [0.92, 0.9, 0.86], [0.95, 0.55, 0.45]], h: [22, 46] },
  { name: 'West End', colors: [[0.6, 0.8, 0.65], [0.93, 0.82, 0.68], [0.9, 0.6, 0.5]], h: [8, 20] },
  { name: 'The Strip', colors: [[0.65, 0.55, 0.85], [0.95, 0.62, 0.72], [0.95, 0.55, 0.45]], h: [16, 32] },
  { name: 'Southside', colors: [[0.95, 0.55, 0.45], [0.9, 0.6, 0.5], [0.6, 0.8, 0.65]], h: [8, 22] },
  { name: 'Midtown', colors: [[0.92, 0.9, 0.86], [0.35, 0.65, 0.62], [0.95, 0.75, 0.35]], h: [14, 28] },
  { name: 'Harbor South', colors: [[0.35, 0.65, 0.62], [0.6, 0.8, 0.65], [0.93, 0.82, 0.68]], h: [8, 24] },
];
// [bx][bz] -> district index. Rows are bz (south to north), columns bx.
const DISTRICT_MAP = [
  [0, 0, 3, 5, 5, 5],
  [0, 0, 3, 5, 5, 5],
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
      const district = districtAt(
        (blockBounds(bx, bz).x0 + blockBounds(bx, bz).x1) / 2,
        (blockBounds(bx, bz).z0 + blockBounds(bx, bz).z1) / 2,
      );
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
        const color = rng.pick(district.colors);
        const building = { x, z, w, d, h, color };
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

  // Landmarks for jobs: hotel tower by the beach, the pier, the mall, the docks.
  landmarks.push({ name: 'Hotel Bayview', x: 138, z: -78, kind: 'hotel' });
  landmarks.push({ name: 'The Pier', x: 196, z: 0, kind: 'pier' });
  landmarks.push({ name: 'Sunset Mall', x: -130, z: 130, kind: 'mall' });
  landmarks.push({ name: 'The Docks', x: -130, z: -130, kind: 'docks' });
  landmarks.push({ name: 'Bay Park', x: -26, z: -26, kind: 'park' });

  // The hotel tower: tall, by the beach.
  buildings.push({ x: 138, z: -78, w: 26, d: 22, h: 52, color: [0.95, 0.62, 0.72] });
  signs.push({ x: 138, y: 46, z: -78 + 11 + 0.15, w: 14, h: 3, alongX: true, color: [1.0, 0.25, 0.55] });

  return { buildings, lamps, trees, signs, parkSpots, landmarks };
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
  // The pier: wooden deck into the ocean, with posts and a little shack.
  m.box(208, 0.6, 0, 36, 1.2, 8, [0.55, 0.42, 0.28], [0.62, 0.48, 0.32]);
  for (let x = 194; x <= 224; x += 6) {
    m.cylinder(x, -1, -3.4, 0.5, 2.4, [0.4, 0.3, 0.2], 6);
    m.cylinder(x, -1, 3.4, 0.5, 2.4, [0.4, 0.3, 0.2], 6);
  }
  m.box(222, 2.6, 0, 5, 4, 6, [0.85, 0.5, 0.4], [0.7, 0.4, 0.32]);
  m.box(222, 5.2, 0, 6, 1, 7, [0.5, 0.3, 0.25]);

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

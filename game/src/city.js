// Sunset Bay — procedural city, fresh v6 rewrite (written in-session).
// No external requests; all geometry is generated locally from a seed.
import { makeRng } from './rng.js';

function toRng(seed, fallback) {
  if (seed && typeof seed.next === 'function') return seed;
  return makeRng(seed == null ? fallback : seed);
}

export const ROAD_STEP = 56;
export const ROAD_HALF = 5;
export const SEA_X = 318; // sea starts east of this x
export const WORLD = 420; // city half-extent in x and z

// name, cx, cz, radius, hue
const DISTRICTS = [
  ['Downtown', 0, 0, 150, 210],
  ['Old Town', -190, -140, 115, 28],
  ['Southside', -90, 235, 130, 350],
  ['Hillcrest', 205, -235, 125, 140],
  ['Beachfront', 295, 95, 110, 45],
  ['The Pier', 330, 215, 65, 190],
  ['Sunset Mall', -245, 70, 115, 280],
  ['Marina Bay', 285, -175, 115, 200],
  ['Northside', -70, -285, 125, 260],
  ['Uptown', 150, 150, 125, 320],
];

function hillH(x, z) {
  const dx = x - 205, dz = z + 235;
  const d = Math.sqrt(dx * dx + dz * dz);
  return d >= 130 ? 0 : 15 * (1 - d / 130);
}

function districtAt(x, z) {
  let best = DISTRICTS[0], bd = Infinity;
  for (const d of DISTRICTS) {
    const dx = x - d[1], dz = z - d[2], dd = dx * dx + dz * dz;
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

export function buildCity(seed) {
  const rng = toRng(seed, 1337);
  const districts = DISTRICTS.map(d => ({ name: d[0], cx: d[1], cz: d[2], r: d[3], hue: d[4] }));

  // Roads: straight lines on a regular grid, both axes.
  const roads = [];
  for (let p = -336; p <= 336; p += ROAD_STEP) {
    roads.push({ axis: 'x', at: p });
    roads.push({ axis: 'z', at: p });
  }

  // Buildings sit inside blocks between roads, never on a road or in the sea.
  const buildings = [];
  const colliders = [];
  for (let gx = -336; gx <= 336; gx += ROAD_STEP) {
    for (let gz = -336; gz <= 336; gz += ROAD_STEP) {
      const cx = gx + ROAD_STEP / 2, cz = gz + ROAD_STEP / 2;
      if (cx > SEA_X - 24) continue;
      const d = districtAt(cx, cz);
      const n = 1 + Math.floor(rng.next() * 2);
      for (let i = 0; i < n; i++) {
        const jx = (rng.next() - 0.5) * 22;
        const jz = (rng.next() - 0.5) * 22;
        const w = 10 + rng.next() * 14, dep = 10 + rng.next() * 14;
        const x = cx + jx, z = cz + jz;
        if (x + w / 2 > SEA_X - 6) continue;
        let h;
        if (d[0] === 'Downtown') h = 26 + rng.next() * 42;
        else if (d[0] === 'Uptown') h = 18 + rng.next() * 26;
        else if (d[0] === 'Old Town') h = 7 + rng.next() * 6;
        else h = 8 + rng.next() * 14;
        const y = d[0] === 'Hillcrest' ? hillH(x, z) : 0;
        buildings.push({ x, z, w, d: dep, h, y, hue: d[4], district: d[0] });
        colliders.push({ x0: x - w / 2, z0: z - dep / 2, x1: x + w / 2, z1: z + dep / 2 });
      }
    }
  }

  const pois = districts.map(d => ({ name: d.name, x: d.cx, z: d.cz, kind: 'district' }));
  pois.push(
    { name: 'Hillcrest Lookout', x: 205, z: -235, kind: 'view' },
    { name: 'Marina Docks', x: 322, z: -175, kind: 'dock' },
    { name: 'Sunset Mall', x: -245, z: 70, kind: 'shop' },
    { name: 'The Pier', x: 330, z: 215, kind: 'pier' },
    { name: 'Beachfront', x: 300, z: 95, kind: 'beach' },
    { name: 'City Hall', x: 0, z: -28, kind: 'civic' },
  );

  const spawn = { x: 0, z: 28, angle: 0 };
  const carSpawns = [
    { x: 14, z: 28, angle: 0 },
    { x: -14, z: 56, angle: Math.PI / 2 },
    { x: 28, z: -14, angle: Math.PI },
  ];

  function clearAt(x, z, pad) {
    if (x < -WORLD || x > WORLD || z < -WORLD || z > WORLD) return false;
    if (x > SEA_X - 4) return false;
    for (const c of colliders) {
      if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) return false;
    }
    return true;
  }

  function findClearSpot(x, z, r) {
    for (let i = 0; i < 48; i++) {
      const a = rng.next() * Math.PI * 2, d = rng.next() * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (clearAt(px, pz, 2.5)) return { x: px, z: pz };
    }
    return { x: spawn.x, z: spawn.z };
  }

  return { districts, buildings, roads, colliders, spawn, carSpawns, pois, findClearSpot, hillH };
}

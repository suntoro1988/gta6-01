// Sunset Bay — city.js (v10, written from scratch)
// Procedural city generation for Sunset Bay.
//
// The city is a 480 x 480 metre grid centred on (0, 0). Streets run
// on a regular grid every 40 m, leaving 32 m blocks between them.
// Ten districts tile the map; the sea lies to the south (z > +190),
// so the southern districts face the waterfront and the Marina Bay
// district sits right on the pier. Exactly 219 buildings are placed
// across the ten districts — the per-district quotas below sum to 219
// and generateCity asserts that, so a miscount can never ship silently.
// Generation is fully deterministic: the same seed always rebuilds
// the same city (mulberry32 PRNG, no Math.random, no Date.now).
//
// A building is a plain record:
//   { id, district, x, z, w, d, h, floors, type, color, roof,
//     rotY }   (x, z = centre; w, d = footprint; h = height;
//     rotY is 0 or PI/2 — buildings stay axis-aligned so the
//     vehicle collision test in vehicles.js stays a cheap AABB test.)

const SB = (globalThis.SB = globalThis.SB || {});

const CITY_HALF = 240; // city spans -240 .. +240 on x and z
const STREET_STEP = 40; // distance between street centrelines
const STREET_WIDTH = 8; // drivable asphalt width
const SIDEWALK_WIDTH = 2;

// Ten districts. quota = buildings in that district; the ten quotas
// sum to exactly 219. bounds are [x0, z0, x1, z1] (inclusive-ish).
const DISTRICTS = [
  { name: "Downtown",        quota: 34, bounds: [-120, -120,   40,   40], palette: ["#8a94a6", "#6f7f96", "#a8b0c0", "#5d6b82"], types: ["office", "office", "shop"] },
  { name: "Old Town",        quota: 26, bounds: [-240, -120, -120,   40], palette: ["#b08968", "#9c7a54", "#c2a27a", "#8a6d4b"], types: ["house", "shop", "house"] },
  { name: "Market Quarter",  quota: 24, bounds: [   40, -120,  120,   40], palette: ["#c98a4b", "#b5773a", "#d9a05b", "#a86f45"], types: ["shop", "shop", "house"] },
  { name: "University",      quota: 22, bounds: [-240,   40, -120,  160], palette: ["#7d8aa0", "#9aa5b8", "#6b7a90", "#b0bac8"], types: ["civic", "house", "office"] },
  { name: "Harborfront",     quota: 20, bounds: [-120,   40,    0,  120], palette: ["#5f7d8c", "#7a99a8", "#4e6b78", "#93b0bd"], types: ["shop", "house", "office"] },
  { name: "Industrial",      quota: 18, bounds: [    0,   40,  120,  120], palette: ["#7a7a72", "#8c8c82", "#66665e", "#9a9a8e"], types: ["warehouse", "warehouse", "office"] },
  { name: "Residential North", quota: 20, bounds: [  120, -120,  240,  -40], palette: ["#c2b49a", "#b3a284", "#d4c7ab", "#a3906f"], types: ["house", "house", "house"] },
  { name: "Riverside",       quota: 16, bounds: [  120,  -40,  240,   80], palette: ["#a8b5a0", "#94a48c", "#bcc8b4", "#86967e"], types: ["house", "house", "shop"] },
  { name: "Marina Bay",      quota: 19, bounds: [-120,  120,  120,  190], palette: ["#6fa8b8", "#8fc0cc", "#5b8fa0", "#a5d0dc"], types: ["shop", "house", "house"] },
  { name: "Hillcrest",       quota: 20, bounds: [  120,   80,  240,  190], palette: ["#b5a88f", "#c9bda1", "#a3937a", "#d8cdb4"], types: ["house", "house", "house"] },
];

const TOTAL_BUILDINGS = DISTRICTS.reduce((s, d) => s + d.quota, 0); // 219

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function range(rng, min, max) {
  return min + rng() * (max - min);
}

// True when the point sits on a street (within half the street
// width of a street centreline) rather than inside a block.
function isOnStreet(x, z) {
  const fx = ((x + CITY_HALF) % STREET_STEP + STREET_STEP) % STREET_STEP;
  const fz = ((z + CITY_HALF) % STREET_STEP + STREET_STEP) % STREET_STEP;
  const nearX = fx < STREET_WIDTH / 2 + 1 || fx > STREET_STEP - STREET_WIDTH / 2 - 1;
  const nearZ = fz < STREET_WIDTH / 2 + 1 || fz > STREET_STEP - STREET_WIDTH / 2 - 1;
  return nearX || nearZ;
}

// Street centrelines, for traffic AI and the minimap.
function buildRoads() {
  const roads = [];
  for (let c = -CITY_HALF + STREET_STEP; c < CITY_HALF; c += STREET_STEP) {
    roads.push({ axis: "x", at: c, from: -CITY_HALF, to: CITY_HALF, width: STREET_WIDTH });
    roads.push({ axis: "z", at: c, from: -CITY_HALF, to: CITY_HALF, width: STREET_WIDTH });
  }
  return roads;
}

function buildIntersections(roads) {
  const points = [];
  const verticals = roads.filter((r) => r.axis === "x").map((r) => r.at);
  const horizontals = roads.filter((r) => r.axis === "z").map((r) => r.at);
  for (const x of verticals) {
    for (const z of horizontals) points.push({ x, z });
  }
  return points;
}

// Traffic lights only at the busiest crossings: every second
// intersection inside the central area, so traffic AI has real
// stop/go points without a light on every corner.
function buildTrafficLights(rng, intersections) {
  const lights = [];
  for (const p of intersections) {
    const central = Math.abs(p.x) <= 120 && Math.abs(p.z) <= 120;
    const onGrid = (Math.round(p.x / STREET_STEP) + Math.round(p.z / STREET_STEP)) % 2 === 0;
    if (central && onGrid) {
      lights.push({
        x: p.x,
        z: p.z,
        state: rng() < 0.5 ? "green" : "red",
        timer: range(rng, 1, 5),
        greenTime: 5,
        redTime: 5,
      });
    }
  }
  return lights;
}

// Lamp posts line both sides of every street, one per block.
function buildStreetLights() {
  const lights = [];
  for (let c = -CITY_HALF + STREET_STEP; c < CITY_HALF; c += STREET_STEP) {
    for (let t = -CITY_HALF + STREET_STEP / 2; t < CITY_HALF; t += STREET_STEP) {
      lights.push({ x: c - STREET_WIDTH / 2 - SIDEWALK_WIDTH / 2, z: t, side: "west" });
      lights.push({ x: c + STREET_WIDTH / 2 + SIDEWALK_WIDTH / 2, z: t, side: "east" });
    }
  }
  return lights;
}

// Sidewalk strips run alongside every street; kept as a list of
// thin rectangles the renderer can draw as flat quads.
function buildSidewalks() {
  const walks = [];
  for (let c = -CITY_HALF + STREET_STEP; c < CITY_HALF; c += STREET_STEP) {
    walks.push({ x: c, z: 0, w: STREET_WIDTH + SIDEWALK_WIDTH * 2, d: CITY_HALF * 2, axis: "x" });
    walks.push({ x: 0, z: c, w: CITY_HALF * 2, d: STREET_WIDTH + SIDEWALK_WIDTH * 2, axis: "z" });
  }
  return walks;
}

function buildingHeightFor(type, rng) {
  switch (type) {
    case "office": return range(rng, 14, 42);
    case "warehouse": return range(rng, 7, 12);
    case "civic": return range(rng, 10, 18);
    case "shop": return range(rng, 6, 12);
    case "house":
    default: return range(rng, 5, 11);
  }
}

function footprintFor(type, rng) {
  switch (type) {
    case "office": return [range(rng, 14, 22), range(rng, 14, 22)];
    case "warehouse": return [range(rng, 20, 30), range(rng, 16, 24)];
    case "civic": return [range(rng, 18, 26), range(rng, 14, 20)];
    case "shop": return [range(rng, 10, 16), range(rng, 8, 14)];
    case "house":
    default: return [range(rng, 8, 14), range(rng, 8, 12)];
  }
}

function generateCity(seed = 1337) {
  const rng = mulberry32(seed);
  const buildings = [];
  const byDistrict = {};
  let nextId = 0;

  // Placement is block-based, not pure random rejection: each
  // district is walked block by block (blocks are the 32 m squares
  // between streets, centred on the -220 + 40k grid) and 1-4
  // buildings are slotted into each block. Pure random sampling
  // under-filled dense districts (179/219 in the first pass) because
  // a large footprint rarely lands wholly inside one block. Slot
  // layouts keep every footprint inside its block and off the
  // streets, so the quota is reachable in every district.
  const PIER_RECT = { x0: -7, z0: 186, x1: 7, z1: 224 };
  function slotLayout(n, horizontal) {
    if (n <= 1) return [{ dx: 0, dz: 0, mw: 26, md: 26 }];
    if (n === 2) {
      return horizontal
        ? [{ dx: -7.5, dz: 0, mw: 13, md: 26 }, { dx: 7.5, dz: 0, mw: 13, md: 26 }]
        : [{ dx: 0, dz: -7.5, mw: 26, md: 13 }, { dx: 0, dz: 7.5, mw: 26, md: 13 }];
    }
    if (n === 3) {
      return [
        { dx: -7.5, dz: -7.5, mw: 13, md: 13 },
        { dx: 7.5, dz: -7.5, mw: 13, md: 13 },
        { dx: 0, dz: 7.5, mw: 13, md: 13 },
      ];
    }
    return [
      { dx: -7.5, dz: -7.5, mw: 13, md: 13 },
      { dx: 7.5, dz: -7.5, mw: 13, md: 13 },
      { dx: -7.5, dz: 7.5, mw: 13, md: 13 },
      { dx: 7.5, dz: 7.5, mw: 13, md: 13 },
    ];
  }
  function tryPlace(placed, all, district, x, z, mw, md) {
    const type = pick(rng, district.types);
    let [w, d] = footprintFor(type, rng);
    w = Math.min(w, mw);
    d = Math.min(d, md);
    if (w < 6 || d < 6) return false;
    // Never into the sea, never onto the pier.
    if (z + d / 2 > 189.5) return false;
    if (x + w / 2 > PIER_RECT.x0 && x - w / 2 < PIER_RECT.x1 && z + d / 2 > PIER_RECT.z0 && z - d / 2 < PIER_RECT.z1) return false;
    if (isOnStreet(x - w / 2, z) || isOnStreet(x + w / 2, z)) return false;
    if (isOnStreet(x, z - d / 2) || isOnStreet(x, z + d / 2)) return false;
    for (const b of all) {
      if (Math.abs(b.x - x) < (b.w + w) / 2 + 1.5 && Math.abs(b.z - z) < (b.d + d) / 2 + 1.5) return false;
    }
    const h = buildingHeightFor(type, rng);
    const roof = type === "house" ? pick(rng, ["gable", "pyramid", "flat"]) : "flat";
    const rec = {
      id: nextId++,
      district: district.name,
      x: Math.round(x * 10) / 10,
      z: Math.round(z * 10) / 10,
      w: Math.round(w * 10) / 10,
      d: Math.round(d * 10) / 10,
      h: Math.round(h * 10) / 10,
      floors: Math.max(1, Math.round(h / 3.2)),
      type,
      color: pick(rng, district.palette),
      roof,
      rotY: rng() < 0.5 ? 0 : Math.PI / 2,
    };
    placed.push(rec);
    all.push(rec);
    return true;
  }

  for (const district of DISTRICTS) {
    const [x0, z0, x1, z1] = district.bounds;
    const placed = [];
    // Blocks whose centre sits inside this district.
    const blocks = [];
    for (let bx = -CITY_HALF + STREET_STEP / 2; bx < CITY_HALF; bx += STREET_STEP) {
      for (let bz = -CITY_HALF + STREET_STEP / 2; bz < CITY_HALF; bz += STREET_STEP) {
        if (bx >= x0 + 10 && bx <= x1 - 10 && bz >= z0 + 10 && bz <= z1 - 10) {
          blocks.push({ x: bx, z: bz });
        }
      }
    }
    // Shuffle so the dense side of a district is not always the same.
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }
    for (let bi = 0; bi < blocks.length && placed.length < district.quota; bi++) {
      const block = blocks[bi];
      const remaining = district.quota - placed.length;
      const blocksAfter = blocks.length - bi - 1;
      // Minimum this block must contribute so the blocks after it
      // (max 4 each) can still finish the quota.
      let n = Math.max(1, remaining - blocksAfter * 4);
      n = Math.min(n, 4, remaining);
      // Occasionally pack one extra building in, when the blocks
      // after this one can still absorb the rest.
      if (n < 4 && n < remaining && rng() < 0.35 && remaining - (n + 1) <= blocksAfter * 4) n++;
      const slots = slotLayout(n, rng() < 0.5);
      for (const s of slots) {
        if (placed.length >= district.quota) break;
        tryPlace(placed, buildings, district, block.x + s.dx, block.z + s.dz, s.mw, s.md);
      }
    }
    // Top-up: random retry for anything the block pass could not
    // place (e.g. Marina Bay slots rejected at the water's edge).
    let guard = 0;
    while (placed.length < district.quota && guard < 8000) {
      guard++;
      const x = range(rng, x0 + 8, x1 - 8);
      const z = range(rng, z0 + 8, z1 - 8);
      if (isOnStreet(x, z)) continue;
      tryPlace(placed, buildings, district, x, z, 14, 14);
    }
    byDistrict[district.name] = placed;
  }

  if (buildings.length !== TOTAL_BUILDINGS) {
    throw new Error(
      `generateCity: expected ${TOTAL_BUILDINGS} buildings, got ${buildings.length}`
    );
  }

  const roads = buildRoads();
  const intersections = buildIntersections(roads);
  const city = {
    seed,
    half: CITY_HALF,
    streetStep: STREET_STEP,
    streetWidth: STREET_WIDTH,
    districts: DISTRICTS.map((d) => ({ name: d.name, bounds: d.bounds, quota: d.quota })),
    buildings,
    byDistrict,
    roads,
    intersections,
    trafficLights: buildTrafficLights(rng, intersections),
    streetLights: buildStreetLights(),
    sidewalks: buildSidewalks(),
    // The sea starts here (south edge); water.js owns everything
    // past this line. The pier juts out from the Marina Bay shore.
    seaLineZ: 190,
    pier: { x: 0, z: 205, w: 10, d: 34, deckY: 1.2 },
    spawn: { x: 0, z: 170, yaw: Math.PI },
  };

  // Freeze the district lookup table for fast point queries.
  city.getDistrict = (x, z) => getDistrict(city, x, z);
  return city;
}

// District containing the point (x, z), or null outside the city.
// Call as getDistrict(city, x, z); getDistrict(x, z) also works and
// looks the point up in the built-in DISTRICTS table. Marina Bay and
// Hillcrest are real districts here, not aliases: the ten DISTRICTS
// entries above are the single source of truth.
function getDistrict(cityOrX, xOrZ, z) {
  let districts;
  let px, pz;
  if (typeof cityOrX === "number") {
    districts = DISTRICTS;
    px = cityOrX;
    pz = xOrZ;
  } else {
    districts = Array.isArray(cityOrX) ? cityOrX : cityOrX.districts;
    px = xOrZ;
    pz = z;
  }
  for (const d of districts) {
    const b = d.bounds;
    if (px >= b[0] && px <= b[2] && pz >= b[1] && pz <= b[3]) return d.name;
  }
  return null;
}

function buildingsInDistrict(city, name) {
  return city.byDistrict[name] ? [...city.byDistrict[name]] : [];
}

// Cheap AABB test: is the point inside any building footprint?
function buildingAt(city, x, z, pad = 0) {
  for (const b of city.buildings) {
    if (Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad) return b;
  }
  return null;
}

// Random street position (used for traffic / pedestrian spawns).
function randomStreetPoint(rng, city) {
  const roads = city.roads;
  const road = roads[Math.floor(rng() * roads.length)];
  const t = (rng() * 2 - 1) * (CITY_HALF - 10);
  return road.axis === "x" ? { x: road.at, z: t } : { x: t, z: road.at };
}

// ---------------------------------------------------------------------------
// Rendering (v10 integration): build() generates the city once and merges
// every static piece into ONE mesh (ground, roads, sidewalks, buildings
// with roofs); render() draws it every frame with GL.drawMesh. Without
// these, main.js had nothing to call and the city never appeared.
// ---------------------------------------------------------------------------

let cachedCity = null;
let cachedMesh = null;

function buildCityMesh(city) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  // Ground: dry land only (z -240 .. sea line 190); the sea is water.js.
  b.flatQuad(0, -0.05, (-CITY_HALF + 190) / 2, CITY_HALF * 2, 190 + CITY_HALF, "#5d7a4a");
  // Roads: dark asphalt strips along every street centreline.
  for (const road of city.roads) {
    if (road.axis === "x") {
      b.flatQuad(road.at, 0.0, 0, STREET_WIDTH, CITY_HALF * 2, "#3a3a40");
    } else {
      b.flatQuad(0, 0.0, road.at, CITY_HALF * 2, STREET_WIDTH, "#3a3a40");
    }
  }
  // Sidewalks: pale strips flanking the roads.
  for (const walk of city.sidewalks) {
    if (walk.axis === "x") {
      b.flatQuad(walk.x, 0.01, walk.z, walk.w, walk.d, "#8f8f86");
    } else {
      b.flatQuad(walk.x, 0.01, walk.z, walk.w, walk.d, "#8f8f86");
    }
  }
  // Buildings: solid box + roof (gable / pyramid / flat cap).
  for (const bd of city.buildings) {
    b.boxAt(bd.x, 0, bd.z, bd.w, bd.h, bd.d, bd.color);
    if (bd.roof === "gable") {
      b.gableRoof(bd.x, bd.h, bd.z, bd.w + 0.6, Math.min(3.5, bd.w * 0.22), bd.d + 0.6, "#6b4a3a");
    } else if (bd.roof === "pyramid") {
      b.pyramid(bd.x, bd.h, bd.z, Math.max(bd.w, bd.d) * 0.75, Math.min(4, bd.w * 0.25), "#7a5240");
    }
  }
  // Marina pier approach: wooden boardwalk strip on the shore.
  b.flatQuad(0, 0.02, 186, 16, 8, "#8a6d4b");
  return b.build();
}

/** Generate the city (once) and build its static render mesh. */
function build(seed) {
  cachedCity = generateCity(seed === undefined ? 1337 : seed);
  cachedMesh = buildCityMesh(cachedCity);
  return cachedCity;
}

function getBuiltCity() {
  if (!cachedCity) build();
  return cachedCity;
}

/** Draw the whole city. Call once per frame; mesh is built once. */
function render(GL, Math3) {
  if (!cachedCity || !cachedMesh) build();
  if (!cachedMesh || !GL || typeof GL.drawMesh !== "function") return false;
  const identity = Math3 && typeof Math3.mat4Identity === "function"
    ? Math3.mat4Identity()
    : new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  GL.drawMesh(cachedMesh, identity);
  return true;
}

SB.City = {
  DISTRICTS,
  TOTAL_BUILDINGS,
  CITY_HALF,
  STREET_STEP,
  STREET_WIDTH,
  generateCity,
  getDistrict,
  buildingsInDistrict,
  buildingAt,
  isOnStreet,
  randomStreetPoint,
  build,
  getBuiltCity,
  render,
};

const City = SB.City;

export { City, generateCity, getDistrict, buildingsInDistrict, buildingAt, isOnStreet, DISTRICTS, TOTAL_BUILDINGS, build, getBuiltCity, render as renderCity };
export default SB.City;

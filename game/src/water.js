// Sunset Bay — water.js (v10, written from scratch)
// Sea rendering and water logic.
//
// The sea covers everything south of the sea line (z > 190). It is
// a large flat quad (SB.Meshes.flatQuad — wound CCW from above, so
// it is never culled) with animated wave vertices, plus a wooden
// pier jutting out from the Marina Bay shore and a ring of buoys.
//
// DRAW() MUST BE CALLED EVERY FRAME. There is no skip flag, no
// "only when the camera looks at the sea" early return, and no
// visibility culling in this module: draw() always rebuilds and
// returns the sea + pier meshes for the current time. v8 lost the
// sea entirely because a frame skipped the water draw; this module
// makes that impossible by construction — the caller draws whatever
// draw() returns, unconditionally.
//
// SOFT-LOCK FIX (v10): pressing E on a boat must ALWAYS let the
// player off. exitBoat() never refuses and never leaves the player
// on the boat:
//   * near the pier / shore -> step onto the pier or dry land;
//   * anywhere else -> drop into the water in "swim" mode, facing
//     the shore, so the player can swim back. A boat far from the
//     dock is an inconvenience, never a trap.

const SB = (globalThis.SB = globalThis.SB || {});

const SEA_LINE_Z = 190; // water starts here (matches city.seaLineZ)
const SEA_Y = 0; // sea surface height
const SEA_EXTENT = 420; // sea plane spans z 190 .. 610, x -210 .. +210
const WAVE_AMP = 0.22;
const WAVE_SPEED = 1.3;
const PIER = { x: 0, z: 205, w: 10, d: 34, deckY: 1.2 };
const SHORE_SWIM_MAX = 260; // swim zone extends to z = 260 + margin

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// Sine-wave height at (x, z) at time t (seconds). Two waves at an
// angle so the surface never looks like a flat sheet of stripes.
function waveHeight(x, z, t) {
  return (
    Math.sin(x * 0.08 + t * WAVE_SPEED) * WAVE_AMP * 0.6 +
    Math.sin(z * 0.11 - t * WAVE_SPEED * 0.8) * WAVE_AMP * 0.4 +
    Math.sin((x + z) * 0.05 + t * WAVE_SPEED * 0.5) * WAVE_AMP * 0.3
  );
}

function isInWater(x, z) {
  return z > SEA_LINE_Z;
}

function isOnPier(x, z) {
  return (
    Math.abs(x - PIER.x) <= PIER.w / 2 &&
    z >= PIER.z - PIER.d / 2 &&
    z <= PIER.z + PIER.d / 2
  );
}

// Nearest dry-land point for (x, z): the shore at z = SEA_LINE_Z,
// or the pier deck if the pier is closer than the shore.
function nearestLand(x, z) {
  const shore = { x, z: SEA_LINE_Z - 1.5, onPier: false };
  if (isOnPier(x, z) || Math.abs(x - PIER.x) < PIER.w / 2 + 6) {
    const pierZ = clamp(z, PIER.z - PIER.d / 2 + 1, PIER.z + PIER.d / 2 - 1);
    if (Math.abs(z - pierZ) < Math.abs(z - shore.z)) {
      return { x: clamp(x, PIER.x - PIER.w / 2 + 0.8, PIER.x + PIER.w / 2 - 0.8), z: pierZ, onPier: true };
    }
  }
  return shore;
}

function createWater(options = {}) {
  return {
    seaLineZ: SEA_LINE_Z,
    seaY: SEA_Y,
    pier: { ...PIER, ...(options.pier || {}) },
    time: 0,
    // Buoys marking the boat area, fixed positions on the water.
    buoys: [
      { x: -60, z: 230 }, { x: 0, z: 250 }, { x: 60, z: 230 },
      { x: -90, z: 280 }, { x: 90, z: 280 }, { x: 0, z: 300 },
    ],
    waveAmp: WAVE_AMP,
  };
}

// --- meshes --------------------------------------------------------
// The sea is a grid of flat quads (not one giant quad) so each
// vertex can bob with waveHeight() — the "vertex animation" the
// brief requires. Every quad is wound CCW from above, exactly like
// SB.Meshes.flatQuad, so the sea is visible from above at all times.
function buildSeaMesh(water, time, cols = 14, rows = 14) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  const x0 = -SEA_EXTENT / 2, x1 = SEA_EXTENT / 2;
  const z0 = SEA_LINE_Z, z1 = SEA_LINE_Z + SEA_EXTENT;
  const cw = (x1 - x0) / cols;
  const cd = (z1 - z0) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ax = x0 + c * cw, bx = ax + cw;
      const az = z0 + r * cd, bz = az + cd;
      // Slight colour shift per cell so waves read in flat shading.
      const shade = 0.92 + 0.08 * Math.sin((c * 3 + r * 5) * 0.7 + time * 0.6);
      const base = [0.09 * shade, 0.42 * shade, 0.62 * shade];
      const y = (x, z) => SEA_Y + waveHeight(x, z, time);
      // Corners in flatQuad order: (ax,az) (ax,bz) (bx,bz) (bx,az)
      // — CCW seen from above.
      b.flatQuadCorners(
        [ax, y(ax, az), az],
        [ax, y(ax, bz), bz],
        [bx, y(bx, bz), bz],
        [bx, y(bx, az), az],
        base
      );
    }
  }
  return b.build();
}

// Wooden pier: deck planks (flat quads, CCW from above), support
// posts, and side rails. Deck sits at deckY above the water so
// boats can pull alongside it.
function buildPierMesh(water) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  const p = water.pier;
  // Deck: planks across the width, one quad per plank row.
  const planks = 12;
  for (let i = 0; i < planks; i++) {
    const z0 = p.z - p.d / 2 + (i * p.d) / planks;
    const z1 = z0 + p.d / planks - 0.15;
    const wood = i % 2 === 0 ? "#8a6d4b" : "#7d6242";
    b.flatQuadCorners(
      [p.x - p.w / 2, p.deckY, z0],
      [p.x - p.w / 2, p.deckY, z1],
      [p.x + p.w / 2, p.deckY, z1],
      [p.x + p.w / 2, p.deckY, z0],
      wood
    );
  }
  // Support posts down into the water (both sides, every 6 m).
  for (let z = p.z - p.d / 2 + 2; z <= p.z + p.d / 2; z += 6) {
    b.cylinder(p.x - p.w / 2 + 0.4, -0.5, z, 0.28, p.deckY + 0.5, "#5e4a33", 8);
    b.cylinder(p.x + p.w / 2 - 0.4, -0.5, z, 0.28, p.deckY + 0.5, "#5e4a33", 8);
  }
  // Side rails.
  b.boxAt(p.x - p.w / 2 + 0.25, p.deckY, p.z, 0.18, 0.9, p.d, "#6b543a");
  b.boxAt(p.x + p.w / 2 - 0.25, p.deckY, p.z, 0.18, 0.9, p.d, "#6b543a");
  return b.build();
}

function buildBuoyMesh(water, time) {
  const M = SB.Meshes;
  if (!M) return null;
  const b = new M.MeshBuilder();
  for (const buoy of water.buoys) {
    const y = SEA_Y + waveHeight(buoy.x, buoy.z, time);
    b.cylinder(buoy.x, y, buoy.z, 0.55, 0.5, "#e07a2a", 10);
    b.pyramid(buoy.x, y + 0.5, buoy.z, 0.8, 0.7, "#d94f3d");
  }
  return b.build();
}

// --- draw ----------------------------------------------------------
// Called EVERY frame by the game loop. Always returns the full set
// of water meshes for this frame — sea, pier, buoys — freshly built
// with the current wave phase. There is deliberately no condition
// that can skip the sea: even a frame with a broken camera or a
// zero dt still gets a sea mesh back.
//
// v10 integration note: the sea mesh is rebuilt only when the wave
// phase quantum changes (10x/second) and the pier/buoys meshes are
// built once and reused. Rebuilding brand-new meshes every frame
// would allocate fresh GL buffers every frame (GL.prepareMesh caches
// buffers on the mesh object), leaking GPU memory over a play
// session. The caller still calls draw() unconditionally each frame
// and always receives all three meshes.
let cachedSea = null;
let cachedSeaQuantum = -1;
let cachedPier = null;
let cachedBuoys = null;

function draw(water, time) {
  const t = typeof time === "number" ? time : water.time || 0;
  water.time = t;
  const quantum = Math.floor(t * 10);
  if (!cachedSea || quantum !== cachedSeaQuantum) {
    cachedSea = buildSeaMesh(water, t);
    cachedSeaQuantum = quantum;
  }
  if (!cachedPier) cachedPier = buildPierMesh(water);
  if (!cachedBuoys) cachedBuoys = buildBuoyMesh(water, t);
  return {
    sea: cachedSea,
    pier: cachedPier,
    buoys: cachedBuoys,
    // Convenience: one merged mesh for renderers that draw a
    // single water batch. Merging keeps the per-quad winding.
    merged: null,
  };
}

// --- boat / player interaction -------------------------------------
// Drop the player off a boat. NEVER traps the player: this function
// always succeeds and always leaves the player either on foot on
// the pier / shore, or swimming toward it.
//   * Within 8 m of the pier end or the shore -> step onto dry land.
//   * Anywhere else -> mode "swim" in the water beside the boat,
//     facing the shore (yaw = PI points back toward land from the
//     sea, since land is at smaller z).
function exitBoat(player, boat, world) {
  const land = nearestLand(boat.x, boat.z);
  const distToLand = Math.hypot(boat.x - land.x, boat.z - land.z);
  const nearPierOrShore = distToLand < 9 || isOnPier(boat.x, boat.z);
  player.vehicle = null;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  if (nearPierOrShore) {
    player.mode = "foot";
    player.x = land.x;
    player.z = land.z;
    player.y = land.onPier ? PIER.deckY : 0;
    player.swimming = false;
  } else {
    // Far from the dock: into the water, swimming, facing shore.
    player.mode = "swim";
    player.swimming = true;
    player.x = boat.x + Math.sin(boat.yaw || 0) * 2.5;
    player.z = boat.z + Math.cos(boat.yaw || 0) * 2.5;
    player.y = 0;
    player.yaw = Math.PI; // face back toward the shore (smaller z)
  }
  return player;
}

// Board a boat from the water or the pier: player must be close.
function boardBoat(player, boat) {
  const d = Math.hypot(boat.x - player.x, boat.z - player.z);
  if (d > 3.5) return false;
  boat.driver = player;
  player.vehicle = boat;
  player.mode = "boat";
  player.swimming = false;
  return true;
}

// Keep a swimming player inside the swim zone; past the outer
// buoys the current gently pushes them back toward shore instead
// of letting them swim to infinity.
function clampSwimmer(player) {
  if (player.z > SHORE_SWIM_MAX + 120) {
    player.z = SHORE_SWIM_MAX + 120;
  }
  return player;
}

SB.Water = {
  SEA_LINE_Z,
  SEA_Y,
  PIER,
  createWater,
  draw,
  waveHeight,
  isInWater,
  isOnPier,
  nearestLand,
  exitBoat,
  boardBoat,
  buildSeaMesh,
  buildPierMesh,
  buildBuoyMesh,
  clampSwimmer,
};

const Water = SB.Water;

export { Water, createWater, draw, waveHeight, isInWater, isOnPier, nearestLand, exitBoat, boardBoat, buildSeaMesh, buildPierMesh, buildBuoyMesh };
export default SB.Water;

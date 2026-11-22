// Sunset Bay v14 — SB.Render (Builder B: graphics / rendering)
// Draws the whole world every frame from SB.Game.state, using only the
// public SB.* interfaces from design spec section 4. This module never
// reads another module's source file; it only calls SB.City / SB.World /
// SB.Vehicles / SB.NPC / SB.Police / SB.FX / SB.Weather / SB.Water at
// runtime, and every one of those reads is guarded so a missing or
// differently-shaped module degrades gracefully instead of throwing.
//
// Camera: third-person follow — behind and above the player on foot, or
// behind and above the vehicle while driving. When there is no player
// yet (menu), the camera slowly orbits the city so the world is always
// visible — never an empty sky.
//
// Golden hour look (spec section 5): low orange sun #ff9a3c, cold blue
// dusk sky, thin warm haze, neon signs lit, shiny puddles / sun glint
// on the water.
//
// Contract (design spec section 4):
//   SB.Render.render(state)
//   SB.Render.camera = { pos:{x,y,z}, yaw, pitch }

window.SB = window.SB || {};

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Palette (golden hour) and the 14 district centers, copied exactly
  // from design spec section 3 — used ONLY as a fallback when SB.City
  // is not available yet, so the world is never empty.
  // ------------------------------------------------------------------
  var SUN_COLOR = "#ff9a3c";
  var NEON_COLORS = ["#ff4fd8", "#37e6ff", "#ff9a3c", "#7cff6b", "#ffe14d"];
  var BUILDING_COLORS = [
    "#e8dcc8", "#d9c2a3", "#c9b8a6", "#b8c4cc", "#9fb6c9",
    "#e0a878", "#c98f6a", "#8fa3b8", "#d8cfc0", "#a89a8c",
    "#f2e3c9", "#7d94a6", "#c2a878", "#e6d5b8",
  ];
  var DISTRICTS_FALLBACK = [
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

  // Deterministic PRNG for fallback placement (same city every run).
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  function angleLerp(a, b, k) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }

  function vecLen(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

  // Rotate a local (ox, oz) offset by rotY, matching SB.GL's transform
  // convention: world = (cos*ox + sin*oz, -sin*ox + cos*oz).
  function rotOffset(rotY, ox, oz) {
    var c = Math.cos(rotY), s = Math.sin(rotY);
    return { x: c * ox + s * oz, z: -s * ox + c * oz };
  }

  // ------------------------------------------------------------------
  // Cached unit meshes (built once GL is ready) and the merged static
  // city mesh (built once, rebuilt only if the building list changes).
  // ------------------------------------------------------------------
  var unitBox = null;        // 1x1x1, centered, white (vehicles, props)
  var unitBoxBase = null;    // 1x1x1, base at y=0, white (buildings)
  var unitPlane = null;      // 1x1 flat quad, white
  var unitQuad = null;       // 1x1 vertical quad, white
  var skyMesh = null;
  var staticMesh = null;
  var staticBuiltFor = -1;
  var billboard = null;      // scratch quad mesh, verts rewritten per use

  function ensureMeshes() {
    if (unitBox || !SB.GL || !SB.GL.ready) return;
    unitBox = SB.GL.makeBoxCentered(1, 1, 1, [1, 1, 1]);
    unitBoxBase = SB.GL.makeBox(1, 1, 1, [1, 1, 1]);
    unitPlane = SB.GL.makePlane(1, 1, [1, 1, 1], 1);
    unitQuad = SB.GL.makeQuad(1, 1, [1, 1, 1]);
    skyMesh = SB.GL.makeSkyBox(1700);
    billboard = {
      verts: new Float32Array(24),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    };
  }

  // ------------------------------------------------------------------
  // Static world: ground + roads + buildings + palms + lamps + hills,
  // merged into ONE mesh so the whole city draws in a single call.
  // ------------------------------------------------------------------
  function fallbackBuildings() {
    var rnd = mulberry32(1337);
    var list = [];
    for (var d = 0; d < DISTRICTS_FALLBACK.length; d++) {
      var dc = DISTRICTS_FALLBACK[d];
      var n = 18 + ((d * 7) % 5) * 3; // 18..30 per district, ~330 total
      for (var i = 0; i < n; i++) {
        var ang = rnd() * Math.PI * 2;
        var rad = Math.sqrt(rnd()) * dc.r * 0.85;
        var tall = (dc.name === "Marina Bay" || dc.name === "Sunset Strip");
        var h = tall ? 18 + rnd() * 42 : 8 + rnd() * 34;
        if (i === 0 && tall) h = 55 + rnd() * 5; // landmark tower
        list.push({
          pos: { x: dc.x + Math.cos(ang) * rad, y: 0, z: dc.z + Math.sin(ang) * rad },
          w: 10 + rnd() * 16,
          h: h,
          d: 10 + rnd() * 16,
          color: BUILDING_COLORS[(rnd() * BUILDING_COLORS.length) | 0],
          district: dc.name,
        });
      }
    }
    return list;
  }

  // Interpret one SB.City.ROADS entry (shape not fixed by the spec) as
  // {cx, cz, w, d, rotY}, or null when it cannot be understood.
  function parseRoad(r) {
    if (!r) return null;
    if (typeof r.x === "number" && typeof r.z === "number" &&
        typeof r.w === "number" && typeof r.d === "number") {
      return { cx: r.x, cz: r.z, w: r.w, d: r.d, rotY: r.rotY || 0 };
    }
    var x1 = (typeof r.x1 === "number") ? r.x1 : r.ax;
    var z1 = (typeof r.z1 === "number") ? r.z1 : r.az;
    var x2 = (typeof r.x2 === "number") ? r.x2 : r.bx;
    var z2 = (typeof r.z2 === "number") ? r.z2 : r.bz;
    if (typeof x1 === "number" && typeof z1 === "number" &&
        typeof x2 === "number" && typeof z2 === "number") {
      var dx = x2 - x1, dz = z2 - z1;
      var len = Math.sqrt(dx * dx + dz * dz) || 1;
      return {
        cx: (x1 + x2) / 2, cz: (z1 + z2) / 2,
        w: r.w || r.width || 14, d: len,
        rotY: Math.atan2(dx, dz),
      };
    }
    return null;
  }

  function buildStatic() {
    ensureMeshes();
    var parts = [];
    var GL = SB.GL;

    // Ground: one big slab for the whole 1200x1200 city.
    parts.push({
      mesh: unitPlane,
      transform: { pos: { x: 0, y: 0.1, z: 0 }, scale: { x: 1200, y: 1, z: 1200 } },
      color: [0.44, 0.46, 0.40],
    });

    // Roads: use SB.City.ROADS when usable, otherwise a regular grid.
    var roads = [];
    var rawRoads = (SB.City && Array.isArray(SB.City.ROADS)) ? SB.City.ROADS : null;
    if (rawRoads) {
      for (var ri = 0; ri < rawRoads.length; ri++) {
        var pr = parseRoad(rawRoads[ri]);
        if (pr) roads.push(pr);
      }
    }
    if (roads.length < 4 && SB.City && SB.City.ROADS &&
        Array.isArray(SB.City.ROADS.linesX) && Array.isArray(SB.City.ROADS.linesZ)) {
      // SB.City.ROADS adalah objek {linesX, linesZ, ...} (grid 60 m),
      // bukan array — bangun jalan dari garis gridnya supaya sejajar
      // dengan blok kota (fallback 100 m di bawah ini tidak sejajar).
      roads = [];
      var RL = SB.City.ROADS;
      var rw = RL.width || 12;
      for (var gi = 0; gi < RL.linesX.length; gi++) {
        roads.push({ cx: RL.linesX[gi], cz: 0, w: rw, d: 660, rotY: 0 });
      }
      for (var gj = 0; gj < RL.linesZ.length; gj++) {
        roads.push({ cx: 0, cz: RL.linesZ[gj], w: 660, d: rw, rotY: 0 });
      }
    }
    if (roads.length < 4) {
      roads = [];
      for (var g = -500; g <= 500; g += 100) {
        roads.push({ cx: 0, cz: g, w: 1200, d: 14, rotY: 0 });
        roads.push({ cx: g, cz: 0, w: 14, d: 1200, rotY: 0 });
      }
    }
    for (var r = 0; r < roads.length; r++) {
      parts.push({
        mesh: unitPlane,
        transform: {
          pos: { x: roads[r].cx, y: 0.14, z: roads[r].cz },
          rotY: roads[r].rotY,
          scale: { x: roads[r].w, y: 1, z: roads[r].d },
        },
        color: [0.17, 0.17, 0.19],
      });
    }

    // Buildings: SB.City.BUILDINGS, or the deterministic fallback.
    var buildings = (SB.City && Array.isArray(SB.City.BUILDINGS) &&
      SB.City.BUILDINGS.length > 0) ? SB.City.BUILDINGS : fallbackBuildings();
    for (var b = 0; b < buildings.length; b++) {
      var bd = buildings[b];
      if (!bd || !bd.pos) continue;
      var bw = bd.w || 14, bh = bd.h || 16, bdpth = bd.d || 14;
      var bx = bd.pos.x || 0, bz = bd.pos.z || 0;
      parts.push({
        mesh: unitBoxBase,
        transform: {
          pos: { x: bx, y: 0.1, z: bz },
          rotY: bd.rotY || 0,
          scale: { x: bw, y: bh, z: bdpth },
        },
        color: GL.normalizeColor(bd.color, [0.8, 0.78, 0.72]),
      });
      // Rooftop rim (slightly darker cap so towers read at dusk).
      parts.push({
        mesh: unitBoxBase,
        transform: {
          pos: { x: bx, y: 0.1 + bh, z: bz },
          rotY: bd.rotY || 0,
          scale: { x: bw * 0.92, y: 0.8, z: bdpth * 0.92 },
        },
        color: [0.32, 0.32, 0.36],
      });
      // Neon sign on taller towers: a lit strip near the top, facing +z.
      if (bh >= 24 && b % 3 === 0) {
        var neon = GL.hexToRgb(NEON_COLORS[b % NEON_COLORS.length]);
        parts.push({
          mesh: unitBoxBase,
          transform: {
            pos: { x: bx, y: 0.1 + bh * 0.72, z: bz + bdpth / 2 + 0.25 },
            scale: { x: Math.min(bw * 0.6, 12), y: 1.4, z: 0.5 },
          },
          color: neon,
        });
      }
    }

    // Palm trees + street lamps: from SB.World.PROPS when it carries
    // recognizable entries, otherwise deterministic fallbacks along
    // the road grid so the streets never look bare.
    var props = (SB.World && Array.isArray(SB.World.PROPS)) ? SB.World.PROPS : null;
    var palms = [];
    var lamps = [];
    if (props && props.length > 0) {
      for (var pi = 0; pi < props.length; pi++) {
        var pr2 = props[pi];
        if (!pr2 || !pr2.pos) continue;
        var kind = String(pr2.kind || pr2.type || pr2.name || "").toLowerCase();
        if (kind.indexOf("palm") >= 0 || kind.indexOf("tree") >= 0) palms.push(pr2.pos);
        else if (kind.indexOf("lamp") >= 0 || kind.indexOf("light") >= 0) lamps.push(pr2.pos);
      }
    }
    if (palms.length === 0) {
      var rndP = mulberry32(77);
      for (var p = 0; p < 64; p++) {
        var gx = ((rndP() * 11) | 0) * 100 - 500;
        var gz = ((rndP() * 11) | 0) * 100 - 500;
        palms.push({ x: gx + 9, y: 0, z: gz + 9 });
      }
    }
    if (lamps.length === 0) {
      var rndL = mulberry32(91);
      for (var l = 0; l < 40; l++) {
        var lx = ((rndL() * 11) | 0) * 100 - 500;
        var lz = ((rndL() * 11) | 0) * 100 - 500;
        lamps.push({ x: lx - 9, y: 0, z: lz - 9 });
      }
    }
    for (var q = 0; q < palms.length; q++) {
      var pp = palms[q];
      parts.push({
        mesh: unitBoxBase,
        transform: { pos: { x: pp.x || 0, y: 0.1, z: pp.z || 0 }, scale: { x: 0.5, y: 5, z: 0.5 } },
        color: [0.35, 0.24, 0.15],
      });
      for (var f = 0; f < 3; f++) {
        parts.push({
          mesh: unitPlane,
          transform: {
            pos: { x: pp.x || 0, y: 5.1 + f * 0.45, z: pp.z || 0 },
            rotY: q * 0.7 + f * 1.1,
            scale: { x: 4.2 - f * 0.9, y: 1, z: 4.2 - f * 0.9 },
          },
          color: [0.16 + f * 0.03, 0.42 + f * 0.03, 0.20],
        });
      }
    }
    for (var lm = 0; lm < lamps.length; lm++) {
      var lp = lamps[lm];
      parts.push({
        mesh: unitBoxBase,
        transform: { pos: { x: lp.x || 0, y: 0.1, z: lp.z || 0 }, scale: { x: 0.25, y: 6, z: 0.25 } },
        color: [0.12, 0.12, 0.14],
      });
      parts.push({
        mesh: unitBoxBase,
        transform: { pos: { x: lp.x || 0, y: 6.1, z: lp.z || 0 }, scale: { x: 0.9, y: 0.3, z: 0.4 } },
        color: [1.0, 0.82, 0.45],
      });
    }

    // Distant hills ringing the city, hazy mauve-blue silhouettes.
    var hills = [
      { x: -820, z: -320, w: 340, h: 120, d: 200 },
      { x: 820, z: -260, w: 300, h: 95, d: 220 },
      { x: -760, z: 420, w: 320, h: 80, d: 200 },
      { x: 780, z: 480, w: 360, h: 130, d: 200 },
      { x: -120, z: -880, w: 420, h: 110, d: 180 },
      { x: 140, z: 900, w: 380, h: 90, d: 180 },
    ];
    for (var h2 = 0; h2 < hills.length; h2++) {
      parts.push({
        mesh: unitBoxBase,
        transform: {
          pos: { x: hills[h2].x, y: 0, z: hills[h2].z },
          scale: { x: hills[h2].w, y: hills[h2].h, z: hills[h2].d },
        },
        color: [0.42, 0.40, 0.52],
      });
    }

    staticMesh = GL.mergeMeshes(parts);
    staticBuiltFor = buildings.length;
  }

  // ------------------------------------------------------------------
  // Dynamic drawing helpers.
  // ------------------------------------------------------------------
  function drawCarLike(pos, rotY, color, opts) {
    var GL = SB.GL;
    var rgb = GL.normalizeColor(color, [0.7, 0.1, 0.1]);
    // Body + glass cabin + 4 wheels.
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: 0.55, z: pos.z }, rotY: rotY, scale: { x: 2, y: 0.75, z: 4.4 } }, rgb);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: 1.2, z: pos.z - 0.2 }, rotY: rotY, scale: { x: 1.7, y: 0.6, z: 2.2 } }, [0.13, 0.18, 0.26]);
    var wheels = [[-0.85, 1.45], [0.85, 1.45], [-0.85, -1.45], [0.85, -1.45]];
    for (var i = 0; i < 4; i++) {
      var o = rotOffset(rotY, wheels[i][0], wheels[i][1]);
      GL.drawMesh(unitBox, {
        pos: { x: pos.x + o.x, y: 0.35, z: pos.z + o.z },
        rotY: rotY, scale: { x: 0.35, y: 0.7, z: 0.7 },
      }, [0.05, 0.05, 0.06]);
    }
    if (opts && opts.lightBar) {
      // Police light bar, alternating red / blue with time.
      var phase = (opts.time || 0) % 1 < 0.5;
      GL.drawMesh(unitBox, {
        pos: { x: pos.x, y: 1.62, z: pos.z - 0.2 }, rotY: rotY, scale: { x: 1.1, y: 0.22, z: 0.4 },
      }, phase ? [1.0, 0.1, 0.1] : [0.1, 0.3, 1.0]);
    }
  }

  function drawPerson(pos, rotY, seed) {
    var GL = SB.GL;
    var palette = [
      [0.85, 0.35, 0.25], [0.25, 0.45, 0.85], [0.9, 0.8, 0.4],
      [0.35, 0.7, 0.4], [0.8, 0.5, 0.85], [0.95, 0.95, 0.95],
      [0.2, 0.2, 0.25], [0.95, 0.6, 0.3],
    ];
    var shirt = palette[((seed % palette.length) + palette.length) % palette.length];
    var y = (pos.y || 0) + 0.1;
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 0.55, z: pos.z }, rotY: rotY, scale: { x: 0.55, y: 1.0, z: 0.32 } }, shirt);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 1.25, z: pos.z }, rotY: rotY, scale: { x: 0.34, y: 0.34, z: 0.34 } }, [0.92, 0.76, 0.62]);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 0.28, z: pos.z }, rotY: rotY, scale: { x: 0.5, y: 0.55, z: 0.3 } }, [0.15, 0.16, 0.22]);
  }

  function drawBoat(pos, rotY, seed, time) {
    var GL = SB.GL;
    var bob = 0.15 + Math.sin(time * 0.8 + seed * 1.7) * 0.08;
    var y = (pos.y || 0) + bob;
    var hull = (seed % 2 === 0) ? [0.92, 0.92, 0.95] : [0.15, 0.25, 0.45];
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 0.5, z: pos.z }, rotY: rotY, scale: { x: 3, y: 1, z: 7 } }, hull);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 1.35, z: pos.z - 0.5 }, rotY: rotY, scale: { x: 2.2, y: 0.9, z: 3 } }, [0.95, 0.93, 0.88]);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 2.6, z: pos.z + 0.8 }, rotY: rotY, scale: { x: 0.18, y: 3.2, z: 0.18 } }, [0.3, 0.25, 0.2]);
  }

  function drawHelicopter(pos, rotY, time) {
    var GL = SB.GL;
    var y = pos.y || 60;
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y, z: pos.z }, rotY: rotY, scale: { x: 2.6, y: 1.6, z: 5 } }, [0.12, 0.14, 0.18]);
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y + 0.2, z: pos.z - 4.6 }, rotY: rotY, scale: { x: 0.5, y: 0.5, z: 4.4 } }, [0.12, 0.14, 0.18]);
    // Spinning main rotor (thin long box, angle from time) + tail rotor.
    GL.drawMesh(unitBox, {
      pos: { x: pos.x, y: y + 1.1, z: pos.z }, rotY: rotY + time * 9, scale: { x: 11, y: 0.12, z: 0.5 },
    }, [0.75, 0.78, 0.82]);
    GL.drawMesh(unitBox, {
      pos: { x: pos.x, y: y + 0.4, z: pos.z - 6.4 }, rotY: rotY + time * 14, scale: { x: 0.4, y: 2.4, z: 0.15 },
    }, [0.75, 0.78, 0.82]);
    // Searchlight cone hint: a small bright box under the nose.
    GL.drawMesh(unitBox, { pos: { x: pos.x, y: y - 0.9, z: pos.z + 1.6 }, rotY: rotY, scale: { x: 0.5, y: 0.3, z: 0.5 } }, [1.0, 0.95, 0.6]);
  }

  // Fill the scratch billboard mesh so it faces the camera.
  function drawBillboard(center, halfW, halfH, camPos, lookAt, color, alpha, fog) {
    var GL = SB.GL;
    var fx = lookAt.x - camPos.x, fy = lookAt.y - camPos.y, fz = lookAt.z - camPos.z;
    var fl = vecLen(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // right = forward x up(0,1,0) = (fz, 0, -fx) normalized
    var rx = fz, rz = -fx;
    var rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl; rz /= rl;
    // up2 = right x forward
    var ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    var v = billboard.verts;
    var corners = [
      [-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH],
    ];
    for (var i = 0; i < 4; i++) {
      var a = corners[i][0], b = corners[i][1];
      v[i * 6] = center.x + rx * a + ux * b;
      v[i * 6 + 1] = center.y + 0 * a + uy * b;
      v[i * 6 + 2] = center.z + rz * a + uz * b;
      v[i * 6 + 3] = 1; v[i * 6 + 4] = 1; v[i * 6 + 5] = 1;
    }
    GL.drawMesh(billboard, null, color, { alpha: alpha, fog: fog, depthWrite: false });
  }

  // ------------------------------------------------------------------
  // Weather / time-of-day resolution (all reads guarded).
  // ------------------------------------------------------------------
  function currentWeather(state) {
    var w = null;
    if (SB.Weather && typeof SB.Weather.current === "string") w = SB.Weather.current;
    else if (state && typeof state.weather === "string") w = state.weather;
    else if (state && state.weather && typeof state.weather.current === "string") w = state.weather.current;
    return (w || "clear").toLowerCase();
  }

  function currentHour(state) {
    var t = null;
    if (state && typeof state.time === "number") t = state.time;
    else if (state && state.time && typeof state.time.hour === "number") t = state.time.hour;
    else if (SB.Game && SB.Game.state && typeof SB.Game.state.time === "number") t = SB.Game.state.time;
    if (t === null || isNaN(t)) return 18; // golden hour default
    return ((t % 24) + 24) % 24;
  }

  function sunDirection(hour) {
    // Sun travels east -> west; at 18:00 it hangs low in the west.
    var dayFrac = clamp((hour - 6) / 12, 0, 1);
    var az = Math.PI * (0.15 + dayFrac * 0.7); // 0=east horizon ... pi=west
    var elev = Math.sin(dayFrac * Math.PI) * 0.55 + 0.06; // radians, low at golden hour
    if (hour < 6 || hour >= 20) elev = 0.05; // night: sun below horizon
    return {
      x: -Math.cos(az),
      y: Math.max(0.05, elev),
      z: -0.35 - dayFrac * 0.1,
    };
  }

  // ------------------------------------------------------------------
  // Camera + render state.
  // ------------------------------------------------------------------
  var camera = {
    pos: { x: 60, y: 55, z: 190 },
    yaw: 0,
    pitch: -0.3,
  };
  var lastNow = 0;
  var warned = false;
  var rainPuddles = null;

  function getRainPuddles() {
    if (rainPuddles) return rainPuddles;
    var rnd = mulberry32(4242);
    rainPuddles = [];
    for (var i = 0; i < 26; i++) {
      var gx = ((rnd() * 11) | 0) * 100 - 500;
      var gz = ((rnd() * 11) | 0) * 100 - 500;
      rainPuddles.push({
        x: gx + (rnd() * 60 - 30),
        z: gz + (rnd() * 60 - 30),
        w: 4 + rnd() * 7,
        d: 2.5 + rnd() * 4,
        rotY: rnd() * Math.PI,
      });
    }
    return rainPuddles;
  }

  function resolveTarget(state) {
    var player = null;
    if (state && state.player) player = state.player;
    else if (SB.Game && SB.Game.state && SB.Game.state.player) player = SB.Game.state.player;
    else if (SB.Player && SB.Player.pos) player = SB.Player;
    if (!player) return null;
    var vehicle = null;
    if (player.vehicle) vehicle = player.vehicle;
    else if (state && state.vehicle) vehicle = state.vehicle;
    else if (player.onFoot === false && SB.Vehicles && Array.isArray(SB.Vehicles.CARS)) {
      // nearestCar() mengembalikan {car, dist}, bukan mobil — jangan
      // pakai langsung (pos jadi {0,0,0}, kamera terbang ke origin).
      // Cari mobil yang dikendarai lewat vehicleId.
      if (player.vehicleId) {
        for (var vi = 0; vi < SB.Vehicles.CARS.length; vi++) {
          if (SB.Vehicles.CARS[vi].id === player.vehicleId) {
            vehicle = SB.Vehicles.CARS[vi];
            break;
          }
        }
      }
    }
    var ent = vehicle || player;
    var pos = ent.pos || { x: 0, y: 0, z: 0 };
    var heading = ent.rotY || 0;
    var vel = ent.vel || player.vel || null;
    var speed = 0;
    if (vel) speed = vecLen(vel.x || 0, vel.y || 0, vel.z || 0);
    else if (typeof ent.speed === "number") speed = Math.abs(ent.speed);
    // While moving, trust the velocity direction over rotY so the
    // camera stays behind the direction of travel regardless of which
    // yaw convention the player/vehicle module uses.
    if (vel && speed > 1.2) heading = Math.atan2(vel.x, vel.z);
    return {
      pos: pos, heading: heading, speed: speed,
      inVehicle: !!vehicle, vehicle: vehicle, player: player,
    };
  }

  // ------------------------------------------------------------------
  // SB.Render
  // ------------------------------------------------------------------
  var Render = {
    camera: camera,

    resetCache: function () {
      staticMesh = null;
      staticBuiltFor = -1;
    },

    render: function (state) {
      try {
        return this._render(state);
      } catch (e) {
        if (!warned) {
          warned = true;
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[SB.Render] frame skipped: " + (e && e.message));
          }
        }
        return false;
      }
    },

    _render: function (state) {
      var GL = SB.GL;
      if (!GL || !GL.ready || !GL.ctx) return false;
      ensureMeshes();

      var now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
      var dt = lastNow ? clamp(now - lastNow, 0.001, 0.1) : 0.016;
      lastNow = now;
      var time = now;

      var gameState = state || (SB.Game && SB.Game.state) || null;
      var weather = currentWeather(gameState);
      var hour = currentHour(gameState);
      var isNight = hour < 6 || hour >= 20;
      var isRain = weather.indexOf("rain") >= 0 || weather.indexOf("storm") >= 0;
      var isFoggy = weather.indexOf("fog") >= 0 || weather.indexOf("mist") >= 0;

      // --- Fog + sky colors for the current conditions ---------------
      if (isRain) {
        GL.setFog(70, 480, [0.55, 0.58, 0.62]);
        GL.setClearColor([0.45, 0.52, 0.60]);
      } else if (isFoggy) {
        GL.setFog(40, 320, [0.72, 0.66, 0.58]);
        GL.setClearColor([0.62, 0.62, 0.58]);
      } else if (isNight) {
        GL.setFog(150, 900, [0.10, 0.12, 0.22]);
        GL.setClearColor([0.10, 0.13, 0.26]);
      } else {
        GL.setFog(200, 1100, [0.78, 0.62, 0.48]); // thin golden haze
        GL.setClearColor([0.55, 0.68, 0.80]);      // cold blue dusk sky
      }

      // --- Camera ------------------------------------------------------
      var target = resolveTarget(gameState);
      var lookAt;
      if (!target) {
        // Menu / no player yet: slow cinematic orbit over the city so
        // the world (not empty sky) is always on screen.
        var orbit = time * 0.045;
        camera.pos.x = Math.sin(orbit) * 250;
        camera.pos.y = 95;
        camera.pos.z = Math.cos(orbit) * 250;
        camera.yaw = orbit + Math.PI;
        camera.pitch = -0.28;
        lookAt = { x: 0, y: 8, z: 0 };
      } else {
        var dist = target.inVehicle ? 13.5 : 9.5;
        var height = target.inVehicle ? 6.0 : 4.4;
        var kPos = 1 - Math.exp(-dt * 5.5);
        var kYaw = 1 - Math.exp(-dt * 4.0);
        camera.yaw = angleLerp(camera.yaw, target.heading, kYaw);
        camera.pitch = lerp(camera.pitch, target.inVehicle ? -0.26 : -0.32, kPos);
        var fx = Math.sin(camera.yaw), fz = Math.cos(camera.yaw);
        var wantX = target.pos.x - fx * dist;
        var wantY = (target.pos.y || 0) + height;
        var wantZ = target.pos.z - fz * dist;
        // First frame (or a huge jump, e.g. respawn): snap, don't swoop.
        var jump = vecLen(wantX - camera.pos.x, wantY - camera.pos.y, wantZ - camera.pos.z);
        if (jump > 120) {
          camera.pos.x = wantX; camera.pos.y = wantY; camera.pos.z = wantZ;
        } else {
          camera.pos.x = lerp(camera.pos.x, wantX, kPos);
          camera.pos.y = lerp(camera.pos.y, wantY, kPos);
          camera.pos.z = lerp(camera.pos.z, wantZ, kPos);
        }
        // Never let the camera sink under the street.
        if (camera.pos.y < 2.2) camera.pos.y = 2.2;
        lookAt = {
          x: target.pos.x + fx * 9,
          y: (target.pos.y || 0) + 2.0,
          z: target.pos.z + fz * 9,
        };
      }

      GL.clear();
      GL.setCamera(camera.pos, lookAt);

      // --- Sky dome + low golden sun -----------------------------------
      var sunDir = sunDirection(hour);
      var sunDist = 780;
      var sunCenter = {
        x: camera.pos.x + sunDir.x * sunDist,
        y: Math.max(28, camera.pos.y * 0.4 + sunDir.y * sunDist),
        z: camera.pos.z + sunDir.z * sunDist,
      };
      GL.drawMesh(skyMesh, { pos: { x: camera.pos.x, y: 0, z: camera.pos.z } },
        [1, 1, 1], { fog: false, depthWrite: false });
      if (!isNight) {
        drawBillboard(sunCenter, 150, 150, camera.pos, lookAt,
          [1.0, 0.72, 0.38], 0.30, false); // halo
        drawBillboard(sunCenter, 52, 52, camera.pos, lookAt,
          SB.GL.hexToRgb(SUN_COLOR), 1.0, false); // disc
      }

      // --- Static city (one draw call) ----------------------------------
      var buildingCount = (SB.City && Array.isArray(SB.City.BUILDINGS))
        ? SB.City.BUILDINGS.length : -1;
      if (!staticMesh || staticBuiltFor !== buildingCount) buildStatic();
      GL.drawMesh(staticMesh, null, [1, 1, 1]);

      // --- Water: big plane + sun glint path ----------------------------
      var shimmer = Math.sin(time * 0.6) * 0.015;
      var waterColor = isRain
        ? [0.16 + shimmer, 0.24 + shimmer, 0.32]
        : [0.13 + shimmer, 0.33 + shimmer, 0.49];
      GL.drawMesh(unitPlane, {
        pos: { x: 0, y: 0.0, z: 0 }, scale: { x: 2600, y: 1, z: 2600 },
      }, waterColor);
      if (!isNight) {
        // Golden glint strip on the water, pointing toward the sun.
        var glintAngle = Math.atan2(sunDir.x, sunDir.z);
        GL.drawMesh(unitPlane, {
          pos: {
            x: camera.pos.x + sunDir.x * 260,
            y: 0.06,
            z: camera.pos.z + sunDir.z * 260,
          },
          rotY: glintAngle,
          scale: { x: 70, y: 1, z: 420 },
        }, [1.0, 0.62, 0.25], { alpha: 0.4, fog: false });
      }

      // --- Boats (SB.World.BOATS) ---------------------------------------
      var boats = (SB.World && Array.isArray(SB.World.BOATS)) ? SB.World.BOATS : null;
      if (boats) {
        for (var bi = 0; bi < boats.length; bi++) {
          var boat = boats[bi];
          if (!boat || !boat.pos) continue;
          drawBoat(boat.pos, boat.rotY || 0, bi, time);
        }
      } else {
        // Fallback: six boats drifting on the bay so the water is alive.
        for (var fb = 0; fb < 6; fb++) {
          var bx = -260 + fb * 90 + Math.sin(time * 0.05 + fb) * 12;
          var bz = 320 + (fb % 3) * 60;
          drawBoat({ x: bx, y: 0, z: bz }, Math.sin(time * 0.1 + fb) * 0.4, fb, time);
        }
      }

      // --- Vehicles: player cars, AI traffic, police --------------------
      var cars = (SB.Vehicles && Array.isArray(SB.Vehicles.CARS)) ? SB.Vehicles.CARS : null;
      if (cars) {
        for (var ci = 0; ci < cars.length; ci++) {
          var car = cars[ci];
          if (!car || !car.pos) continue;
          drawCarLike(car.pos, car.rotY || 0, car.color);
        }
      }
      var aiCars = (SB.NPC && Array.isArray(SB.NPC.CARS_AI)) ? SB.NPC.CARS_AI : null;
      if (aiCars) {
        for (var ai = 0; ai < aiCars.length; ai++) {
          var ac = aiCars[ai];
          if (!ac || !ac.pos) continue;
          drawCarLike(ac.pos, ac.rotY || 0, ac.color || [0.5, 0.5, 0.55]);
        }
      }
      var cops = (SB.Police && Array.isArray(SB.Police.COP_CARS)) ? SB.Police.COP_CARS : null;
      if (cops) {
        for (var cp = 0; cp < cops.length; cp++) {
          var cop = cops[cp];
          if (!cop || !cop.pos) continue;
          drawCarLike(cop.pos, cop.rotY || 0, [0.92, 0.92, 0.95], { lightBar: true, time: time });
        }
      }

      // --- Pedestrians (SB.NPC.PEDESTRIANS) ------------------------------
      var peds = (SB.NPC && Array.isArray(SB.NPC.PEDESTRIANS)) ? SB.NPC.PEDESTRIANS : null;
      if (peds) {
        for (var pd = 0; pd < peds.length; pd++) {
          var ped = peds[pd];
          if (!ped || !ped.pos) continue;
          drawPerson(ped.pos, ped.rotY || 0, pd);
        }
      }

      // --- Particles (SB.FX) --------------------------------------------
      var parts = null;
      if (SB.FX) {
        if (Array.isArray(SB.FX.particles)) parts = SB.FX.particles;
        else if (typeof SB.FX.getParticles === "function") {
          try { parts = SB.FX.getParticles(); } catch (e) { parts = null; }
        }
      }
      if (parts && parts.length) {
        for (var pt = 0; pt < parts.length; pt++) {
          var part = parts[pt];
          if (!part || !part.pos) continue;
          var size = (typeof part.size === "number") ? part.size : 0.3;
          GL.drawMesh(unitBox, {
            pos: { x: part.pos.x, y: part.pos.y || 0.5, z: part.pos.z },
            scale: { x: size, y: size, z: size },
          }, GL.normalizeColor(part.color, [1.0, 0.8, 0.3]), { fog: false });
        }
      }

      // --- Puddles: golden sheen always, extra pools when it rains -----
      var sheen = getRainPuddles();
      var puddleCount = isRain ? sheen.length : 6;
      for (var pu = 0; pu < puddleCount; pu++) {
        var pdl = sheen[pu];
        GL.drawMesh(unitPlane, {
          pos: { x: pdl.x, y: 0.16, z: pdl.z },
          rotY: pdl.rotY,
          scale: { x: pdl.w, y: 1, z: pdl.d },
        }, isRain ? [0.62, 0.72, 0.88] : [1.0, 0.66, 0.3], { alpha: isRain ? 0.6 : 0.35 });
      }

      // --- Helicopter: hero chase moment at sunset -----------------------
      var heli = null;
      if (gameState && gameState.helicopter && gameState.helicopter.pos) heli = gameState.helicopter;
      else if (SB.Police && SB.Police.HELICOPTER && SB.Police.HELICOPTER.pos) heli = SB.Police.HELICOPTER;
      else if (SB.Police && SB.Police.helicopter && SB.Police.helicopter.pos) heli = SB.Police.helicopter;
      var wanted = 0;
      if (gameState && typeof gameState.wanted === "number") wanted = gameState.wanted;
      else if (SB.Police && typeof SB.Police.WANTED === "number") wanted = SB.Police.WANTED;
      if (heli) {
        drawHelicopter(heli.pos, heli.rotY || 0, time);
      } else if (wanted >= 3 && target) {
        // No helicopter object supplied by other modules: render an
        // ambient pursuit helicopter circling the player so the sunset
        // chase hero moment is always visible at 3+ stars.
        var ha = time * 0.35;
        drawHelicopter({
          x: target.pos.x + Math.cos(ha) * 42,
          y: 58 + Math.sin(time * 0.5) * 4,
          z: target.pos.z + Math.sin(ha) * 42,
        }, ha + Math.PI / 2, time);
      }

      return true;
    },
  };

  SB.Render = Render;
})();

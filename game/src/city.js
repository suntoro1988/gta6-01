// Sunset Bay — city module (v7, written fresh from SPEC)
// Builds a deterministic 10-district city: grid roads, ~220 buildings.
(function () {
  var SB = window.SB = window.SB || {};

  // City extents. Water lies west (x < -280) and south (z > 280).
  var MIN = -280, MAX = 280, CELL = 56, ROAD_W = 8;

  // District rectangles: 5 columns x 2 rows = 10 districts.
  var DEFS = [
    { name: "Downtown",   x0: 56,   z0: -280, x1: 168,  z1: 0,   hMin: 20, hMax: 60 },
    { name: "Old Town",   x0: 56,   z0: 0,    x1: 168,  z1: 280, hMin: 10, hMax: 24 },
    { name: "Harbor",     x0: -168, z0: 0,    x1: -56,  z1: 280, hMin: 8,  hMax: 16 },
    { name: "Marina Bay", x0: -280, z0: 0,    x1: -168, z1: 280, hMin: 8,  hMax: 20 },
    { name: "Hillcrest",  x0: -168, z0: -280, x1: -56,  z1: 0,   hMin: 12, hMax: 34 },
    { name: "Northside",  x0: 168,  z0: -280, x1: 280,  z1: 0,   hMin: 10, hMax: 28 },
    { name: "Southside",  x0: -56,  z0: 0,    x1: 56,   z1: 280, hMin: 10, hMax: 26 },
    { name: "Beachfront", x0: -280, z0: -280, x1: -168, z1: 0,   hMin: 8,  hMax: 22 },
    { name: "Uptown",     x0: -56,  z0: -280, x1: 56,   z1: 0,   hMin: 14, hMax: 40 },
    { name: "Industrial", x0: 168,  z0: 0,    x1: 280,  z1: 280, hMin: 8,  hMax: 15 }
  ];
  var NAMES = ["Downtown", "Old Town", "Harbor", "Marina Bay", "Hillcrest",
    "Northside", "Southside", "Beachfront", "Uptown", "Industrial"];

  var City = {
    buildings: [],
    roads: [],
    districts: NAMES.slice(),
    _defs: DEFS,
    _roadMeshes: null,
    _bldMeshes: null,
    _groundMesh: null,

    build: function (seed) {
      SB.RNG.seed(seed);
      var i, j, k, d;
      // Roads: grid lines every 56 units, both axes, full span.
      this.roads = [];
      for (i = 0; i <= 10; i++) {
        var at = MIN + i * CELL;
        this.roads.push({ x1: at, z1: MIN, x2: at, z2: MAX, w: ROAD_W, axis: "z", at: at });
        this.roads.push({ x1: MIN, z1: at, x2: MAX, z2: at, w: ROAD_W, axis: "x", at: at });
      }
      // Buildings: 100 blocks (10x10). 2 per block, +1 on every 5th block = 220.
      this.buildings = [];
      var idx = 0;
      for (j = 0; j < 10; j++) {
        for (i = 0; i < 10; i++) {
          var cx0 = MIN + i * CELL, cz0 = MIN + j * CELL;
          var cx = cx0 + CELL / 2, cz = cz0 + CELL / 2;
          var dist = this.districtAt(cx, cz);
          var def = null;
          for (k = 0; k < DEFS.length; k++) if (DEFS[k].name === dist) def = DEFS[k];
          var count = 2 + (idx % 5 === 0 ? 1 : 0);
          var slots = count === 2
            ? [[0.28, 0.5], [0.72, 0.5]]
            : [[0.25, 0.28], [0.75, 0.28], [0.5, 0.74]];
          var inset = 7, inner = CELL - inset * 2;
          for (k = 0; k < count; k++) {
            var w = SB.RNG.range(8, 16), dd = SB.RNG.range(8, 16);
            var h = SB.RNG.range(def.hMin, def.hMax);
            var bx = cx0 + inset + slots[k][0] * inner + SB.RNG.range(-2.5, 2.5);
            var bz = cz0 + inset + slots[k][1] * inner + SB.RNG.range(-2.5, 2.5);
            this.buildings.push({ x: bx, z: bz, w: w, d: dd, h: h, district: dist });
          }
          idx++;
        }
      }
      this._roadMeshes = null;
      this._bldMeshes = null;
      this._groundMesh = null;
      return { buildings: this.buildings, roads: this.roads, districts: NAMES.slice() };
    },

    districtAt: function (x, z) {
      var k, d;
      for (k = 0; k < DEFS.length; k++) {
        d = DEFS[k];
        if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d.name;
      }
      // Outside the grid: nearest district by clamped distance.
      var best = "Downtown", bestD = Infinity;
      for (k = 0; k < DEFS.length; k++) {
        d = DEFS[k];
        var dx = x < d.x0 ? d.x0 - x : (x > d.x1 ? x - d.x1 : 0);
        var dz = z < d.z0 ? d.z0 - z : (z > d.z1 ? z - d.z1 : 0);
        var dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; best = d.name; }
      }
      return best;
    },

    // True if point (x,z) is free of buildings (margin r) and on land.
    _isClear: function (x, z, r) {
      if (x < MIN + 2 || x > MAX - 2 || z < MIN + 2 || z > MAX - 2) return false;
      var i, b;
      for (i = 0; i < this.buildings.length; i++) {
        b = this.buildings[i];
        if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return false;
      }
      return true;
    },

    // Deterministic spiral search for a collision-free point near (x, z).
    findClearSpot: function (x, z, r) {
      r = r || 1;
      if (this._isClear(x, z, r)) return { x: x, z: z };
      var ring, dir;
      var dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
      for (ring = 1; ring <= 40; ring++) {
        var rad = ring * (r + 4);
        for (dir = 0; dir < 8; dir++) {
          var px = x + dirs[dir][0] * rad, pz = z + dirs[dir][1] * rad;
          if (this._isClear(px, pz, r)) return { x: px, z: pz };
        }
      }
      return { x: x, z: z };
    },

    // Flat quad mesh helper (two triangles) at fixed y.
    _quad: function (x0, z0, x1, z1, y, cr, cg, cb) {
      var pos = new Float32Array([
        x0, y, z0, x1, y, z0, x1, y, z1,
        x0, y, z0, x1, y, z1, x0, y, z1
      ]);
      var col = new Float32Array(18);
      var v;
      for (v = 0; v < 6; v++) { col[v * 3] = cr; col[v * 3 + 1] = cg; col[v * 3 + 2] = cb; }
      return SB.GL.mesh(pos, col);
    },

    draw: function () {
      if (!SB.GL || !SB.GL.draw) return;
      var i, b, m;
      if (!this._groundMesh) {
        this._groundMesh = this._quad(MIN - 12, MIN - 12, MAX + 12, MAX + 12, -0.05, 0.23, 0.26, 0.20);
        this._roadMeshes = [];
        for (i = 0; i < this.roads.length; i++) {
          var rd = this.roads[i], hw = rd.w / 2;
          if (rd.axis === "z") this._roadMeshes.push(this._quad(rd.x1 - hw, rd.z1, rd.x1 + hw, rd.z2, 0.05, 0.13, 0.13, 0.14));
          else this._roadMeshes.push(this._quad(rd.x1, rd.z1 - hw, rd.x2, rd.z1 + hw, 0.05, 0.13, 0.13, 0.14));
        }
      }
      var I = SB.Math3.mat4Identity();
      SB.GL.draw(this._groundMesh, I);
      for (i = 0; i < this._roadMeshes.length; i++) SB.GL.draw(this._roadMeshes[i], I);
      if (SB.Meshes && SB.Meshes.building) {
        if (!this._bldMeshes) {
          this._bldMeshes = [];
          for (i = 0; i < this.buildings.length; i++) {
            b = this.buildings[i];
            this._bldMeshes.push(SB.Meshes.building(b.w, b.h, b.d, (i * 7 + 3) % 997));
          }
        }
        for (i = 0; i < this.buildings.length; i++) {
          b = this.buildings[i];
          // Mesh building beralas di y=0 (BUKAN berpusat) — tanpa offset h/2,
          // kalau tidak bangunan melayang h/2 di udara.
          m = SB.Math3.mat4Translate(b.x, 0, b.z);
          SB.GL.draw(this._bldMeshes[i], m);
        }
      }
    }
  };

  SB.City = City;
})();

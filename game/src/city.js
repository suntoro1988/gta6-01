// Sunset Bay v8 — city.js (ditulis fresh dari SPEC-v8)
// Kota prosedural deterministik: grid jalan + ~215-225 bangunan, 10 distrik.
(function () {
  var SB = window.SB = window.SB || {};
  var DISTRICTS = ["Downtown", "Old Town", "Harbor", "Marina Bay", "Hillcrest",
    "Northside", "Southside", "Beachfront", "Uptown", "Industrial"];
  var GRID = [-160, -120, -80, -40, 0, 40, 80, 120, 160]; // garis jalan
  var HALF = 168; // batas kota (laut di barat x<-168 & selatan z>168)

  function districtAt(x, z) {
    if (z > 130) return "Beachfront";
    if (x < -110) return z < 0 ? "Marina Bay" : "Harbor";
    if (x > 120) return "Industrial";
    if (z < -110) return "Northside";
    if (Math.abs(x) < 40 && Math.abs(z) < 40) return "Downtown";
    if (x < 0) return z < 0 ? "Old Town" : "Southside";
    return z < 0 ? "Uptown" : "Hillcrest";
  }

  function build(seed) {
    var rng = SB.RNG;
    rng.seed(seed == null ? 7 : seed);
    var buildings = [];
    var roads = [];
    var i, j;
    for (i = 0; i < GRID.length; i++) {
      roads.push({ x: GRID[i], z: 0, w: 8, d: 340, axis: "z" });
      roads.push({ x: 0, z: GRID[i], w: 340, d: 8, axis: "x" });
    }
    // Blok: pusat di antara garis jalan. Tiap blok dibagi 2x2 kuadran
    // (pusat kuadran ±8, bangunan 8-12 lebar + jitter ±1.5) sehingga
    // bangunan tak pernah bertabrakan & tak keluar blok.
    var centers = [-140, -100, -60, -20, 20, 60, 100, 140];
    var quads = [[-8, -8], [8, -8], [-8, 8], [8, 8]];
    for (i = 0; i < centers.length; i++) {
      for (j = 0; j < centers.length; j++) {
        var bx = centers[i], bz = centers[j];
        var dist = districtAt(bx, bz);
        var plaza = (bx === -20 && bz === -20) || (bx === 100 && bz === 60);
        var n = plaza ? 1 : 3 + (rng.next() < 0.55 ? 1 : 0);
        // Acak urutan kuadran (Fisher-Yates dengan rng).
        var order = [0, 1, 2, 3];
        for (var s = 3; s > 0; s--) {
          var t = Math.floor(rng.next() * (s + 1));
          var tmp = order[s]; order[s] = order[t]; order[t] = tmp;
        }
        for (var q = 0; q < n; q++) {
          var qd = quads[order[q]];
          var w = 8 + rng.range(0, 4);
          var d = 8 + rng.range(0, 4);
          var x = bx + qd[0] + rng.range(-1.5, 1.5);
          var z = bz + qd[1] + rng.range(-1.5, 1.5);
          var tall = dist === "Downtown" || dist === "Uptown";
          var h = tall ? rng.range(18, 60) : rng.range(6, 26);
          if (dist === "Industrial") h = rng.range(8, 16);
          buildings.push({ x: x, z: z, w: w, d: d, h: h, district: dist });
        }
      }
    }
    // Jaga jumlah 215-225 secara deterministik.
    while (buildings.length > 225) buildings.pop();
    var city = { buildings: buildings, roads: roads, districts: DISTRICTS.slice(), roadCoords: GRID.slice() };
    SB.City.buildings = buildings;
    SB.City.roads = roads;
    SB.City.districts = DISTRICTS.slice();
    SB.City._data = city;
    return city;
  }

  function findClearSpot(x, z, r) {
    r = r || 2;
    var list = SB.City.buildings || [];
    function free(px, pz) {
      if (px < -HALF + 2 || px > HALF - 2 || pz < -HALF + 2 || pz > HALF - 2) return false;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (Math.abs(px - b.x) < b.w / 2 + r && Math.abs(pz - b.z) < b.d / 2 + r) return false;
      }
      return true;
    }
    if (free(x, z)) return { x: x, z: z };
    for (var rad = 4; rad <= 120; rad += 4) {
      for (var k = 0; k < 16; k++) {
        var a = Math.random() * Math.PI * 2;
        var px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
        if (free(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: 0, z: 0 };
  }

  SB.City = {
    districts: DISTRICTS.slice(),
    buildings: [],
    roads: [],
    roadCoords: GRID.slice(),
    build: build,
    districtAt: districtAt,
    findClearSpot: findClearSpot
  };
})();

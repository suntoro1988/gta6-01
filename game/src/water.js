// Sunset Bay v8 — water.js (ditulis fresh dari SPEC-v8)
// Laut di sisi barat (x < -168) & selatan (z > 168) kota + dermaga kayu + speedboat.
(function () {
  var SB = window.SB = window.SB || {};
  var SEA_X = -168, SEA_Z = 168; // garis pantai
  var PIER = { x: -168, z: 120 }; // ujung dermaga di darat
  var BOAT_START = { x: -182, z: 120, yaw: Math.PI / 2, speed: 0 };

  var _seaMesh = null, _pierMeshes = [], _boatMesh = null, _t = 0;
  var _keys = {};

  window.addEventListener("keydown", function (e) { _keys[e.code || e.key] = true; });
  window.addEventListener("keyup", function (e) { _keys[e.code || e.key] = false; });

  function keys() {
    // Gabung input lokal + input global dari main (SB.G.keys) bila ada.
    var g = (SB.G && SB.G.keys) || {};
    var out = {};
    var k;
    for (k in _keys) out[k] = _keys[k];
    for (k in g) out[k] = g[k];
    return out;
  }

  // Satu quad datar (2 segitiga) pada y tertentu, warna solid.
  function flatQuad(x0, z0, x1, z1, y, rgb) {
    var pos = new Float32Array([
      x0, y, z0, x1, y, z0, x1, y, z1,
      x0, y, z0, x1, y, z1, x0, y, z1
    ]);
    var col = new Float32Array(18);
    for (var i = 0; i < 6; i++) { col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2]; }
    return { pos: pos, col: col };
  }

  function init() {
    _t = 0;
    SB.Water.boat.x = BOAT_START.x;
    SB.Water.boat.z = BOAT_START.z;
    SB.Water.boat.yaw = BOAT_START.yaw;
    SB.Water.boat.speed = 0;
    if (!SB.GL || !SB.GL.mesh) return;
    // Laut: dua bidang besar (barat + selatan), biru laut.
    var west = flatQuad(-340, -220, SEA_X, 220, -0.4, [0.05, 0.25, 0.45]);
    var south = flatQuad(-340, SEA_Z, 220, 340, -0.4, [0.05, 0.28, 0.5]);
    _seaMesh = [SB.GL.mesh(west.pos, west.col), SB.GL.mesh(south.pos, south.col)];
    // Dermaga kayu: papan-papan dari darat (x=-168) menjorok ke laut (x=-192).
    _pierMeshes = [];
    var M = SB.Math3;
    for (var i = 0; i < 8; i++) {
      var px = -170 - i * 3;
      var plank = flatQuad(px - 1.4, 117, px + 1.4, 123, 0.3, [0.45, 0.3, 0.14]);
      _pierMeshes.push({ mesh: SB.GL.mesh(plank.pos, plank.col), mat: M.mat4Identity() });
    }
    if (SB.Meshes && SB.Meshes.boat) {
      var b = SB.Meshes.boat();
      _boatMesh = SB.GL.mesh(b.pos, b.col);
    }
  }

  function inBoat() { return !!(SB.G && SB.G.player && SB.G.player.inBoat); }

  function nearBoatOrPier(px, pz) {
    var b = SB.Water.boat;
    var dBoat = Math.hypot(px - b.x, pz - b.z);
    var dPier = Math.hypot(px - (PIER.x - 22), pz - PIER.z);
    return Math.min(dBoat, dPier) < 7;
  }

  function boardBoat() {
    if (!SB.G || !SB.G.player) return false;
    if (SB.G.player.inCar) return false;
    var p = SB.G.player;
    if (!nearBoatOrPier(p.x, p.z)) return false;
    p.inBoat = true;
    p.x = SB.Water.boat.x;
    p.z = SB.Water.boat.z;
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage("Speedboat — W gas, S rem, A/D belok, E turun");
    return true;
  }

  function leaveBoat() {
    if (!SB.G || !SB.G.player) return false;
    var p = SB.G.player;
    if (!p.inBoat) return false;
    p.inBoat = false;
    SB.Water.boat.speed = 0;
    // Turun di ujung dermaga (darat).
    var spot = { x: PIER.x - 22, z: PIER.z + 5 };
    if (SB.City && SB.City.findClearSpot) spot = SB.City.findClearSpot(PIER.x - 20, PIER.z + 5, 2);
    p.x = spot.x; p.z = spot.z;
    return true;
  }

  function update(dt) {
    _t += dt;
    var b = SB.Water.boat;
    if (!inBoat()) {
      // Kapal diam mengapung di dermaga; animasi ombak kecil via _t saja.
      return;
    }
    var k = keys();
    var fwd = (k["KeyW"] || k["ArrowUp"]) ? 1 : 0;
    var back = (k["KeyS"] || k["ArrowDown"]) ? 1 : 0;
    var left = (k["KeyA"] || k["ArrowLeft"]) ? 1 : 0;
    var right = (k["KeyD"] || k["ArrowRight"]) ? 1 : 0;
    if (fwd) b.speed += 14 * dt;
    if (back) b.speed -= 10 * dt;
    if (!fwd && !back) b.speed *= Math.max(0, 1 - 0.8 * dt);
    b.speed = Math.max(-6, Math.min(20, b.speed));
    var steer = (left ? 1 : 0) - (right ? 1 : 0);
    b.yaw += steer * 1.4 * dt * Math.min(1, Math.abs(b.speed) / 6) * (b.speed < 0 ? -1 : 1);
    b.x += Math.sin(b.yaw) * b.speed * dt;
    b.z += Math.cos(b.yaw) * b.speed * dt;
    // Jaga kapal tetap di laut (barat x<-170 atau selatan z>170), jangan naik darat.
    if (b.x > -172 && b.z < 172) {
      if (Math.abs(b.x + 172) < Math.abs(b.z - 172)) b.x = -172; else b.z = 172;
      b.speed *= 0.4;
    }
    b.x = Math.max(-330, Math.min(-172, b.x));
    b.z = Math.max(-210, Math.min(330, b.z));
    var p = SB.G.player;
    p.x = b.x; p.z = b.z; p.yaw = b.yaw; p.speed = Math.abs(b.speed);
    if (SB.G) SB.G.dist += Math.abs(b.speed) * dt;
  }

  function draw() {
    if (!SB.GL || !SB.GL.draw || !SB.Math3) return;
    var M = SB.Math3, I = M.mat4Identity();
    var i;
    if (_seaMesh) for (i = 0; i < _seaMesh.length; i++) SB.GL.draw(_seaMesh[i], I);
    for (i = 0; i < _pierMeshes.length; i++) SB.GL.draw(_pierMeshes[i].mesh, _pierMeshes[i].mat);
    // Kapal: goyang ombak kecil + posisi/yaw saat ini.
    var b = SB.Water.boat;
    var bobY = 0.1 + Math.sin(_t * 1.8) * 0.12;
    var mat = M.mat4Mul(M.mat4Translate(b.x, bobY, b.z), M.mat4RotateY(b.yaw));
    if (_boatMesh) {
      SB.GL.draw(_boatMesh, mat);
    } else if (SB.Meshes && SB.Meshes.box) {
      var hull = SB.Meshes.box(3, 1, 7);
      SB.GL.draw(SB.GL.mesh(hull.pos, hull.col), mat);
    }
  }

  SB.Water = {
    boat: { x: BOAT_START.x, z: BOAT_START.z, yaw: BOAT_START.yaw, speed: 0 },
    pier: { x: PIER.x, z: PIER.z },
    seaX: SEA_X,
    seaZ: SEA_Z,
    init: init,
    update: update,
    draw: draw,
    boardBoat: boardBoat,
    leaveBoat: leaveBoat
  };
})();

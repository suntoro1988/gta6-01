// Sunset Bay v8 — player.js
// Gerakan pemain jalan kaki: W/A/S/D, lari Shift (12 u/s), putar A/D (yaw).
// Menempel ke namespace global window.SB. State di SB.G.
(function () {
  'use strict';

  var WALK_SPEED = 5;    // unit/detik jalan biasa
  var RUN_SPEED = 12;    // unit/detik lari (Shift)
  var TURN_SPEED = 2.6;  // radian/detik putar A/D
  var PLAYER_RADIUS = 0.6; // margin tabrakan dengan bangunan

  function G() { return window.SB.G; }

  // Cek apakah titik (x,z) bertabrakan dengan bangunan (dengan margin).
  function hitsBuilding(x, z) {
    var city = window.SB.City;
    if (!city || !city.buildings) return false;
    var blds = city.buildings;
    for (var i = 0; i < blds.length; i++) {
      var b = blds[i];
      var hw = (b.w || 10) / 2 + PLAYER_RADIUS;
      var hd = (b.d || 10) / 2 + PLAYER_RADIUS;
      if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd) return true;
    }
    return false;
  }

  // Coba pindah ke (nx, nz); bila tertabrak, coba geser per sumbu (slide).
  function tryMove(p, nx, nz) {
    if (!hitsBuilding(nx, nz)) {
      p.x = nx; p.z = nz;
      return true;
    }
    if (!hitsBuilding(nx, p.z)) {
      p.x = nx;
      return true;
    }
    if (!hitsBuilding(p.x, nz)) {
      p.z = nz;
      return true;
    }
    return false;
  }

  window.SB.Player = {
    update: function (dt, input) {
      var g = G();
      if (!g || !g.player) return;
      var p = g.player;
      if (p.inCar) return; // sedang menyetir: kendaraan yang menggerakkan pemain
      if (!input) input = {};

      // Putar dengan A / D (yaw).
      if (input.left) p.yaw += TURN_SPEED * dt;
      if (input.right) p.yaw -= TURN_SPEED * dt;

      var speed = input.run ? RUN_SPEED : WALK_SPEED;
      var mx = 0, mz = 0;
      // Maju/mundur relatif terhadap arah hadap (yaw).
      var fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      if (input.forward) { mx += fx; mz += fz; }
      if (input.back) { mx -= fx; mz -= fz; }
      // Strafe kiri/kanan (bila input menyediakan).
      if (input.strafeLeft) { mx += fz; mz -= fx; }
      if (input.strafeRight) { mx -= fz; mz += fx; }

      var len = Math.sqrt(mx * mx + mz * mz);
      if (len > 0) {
        mx /= len; mz /= len;
        var nx = p.x + mx * speed * dt;
        var nz = p.z + mz * speed * dt;
        var ox = p.x, oz = p.z;
        tryMove(p, nx, nz);
        // Jarak jalan kaki total (untuk statistik).
        var moved = Math.sqrt((p.x - ox) * (p.x - ox) + (p.z - oz) * (p.z - oz));
        g.dist = (g.dist || 0) + moved;
        p.speed = moved / Math.max(dt, 0.0001);
      } else {
        p.speed = 0;
      }

      // Jaga pemain tetap di dalam batas kota (radius aman 260 unit).
      var r = Math.sqrt(p.x * p.x + p.z * p.z);
      if (r > 260) {
        p.x *= 260 / r;
        p.z *= 260 / r;
      }
    },

    pos: function () {
      var g = G();
      if (!g || !g.player) return { x: 0, z: 0 };
      return { x: g.player.x, z: g.player.z };
    }
  };
})();

// Sunset Bay v9 — player.js
// Gerakan pemain jalan kaki: W/S atau panah atas/bawah untuk maju/mundur,
// A/D atau panah kiri/kanan untuk berputar, Shift untuk lari.
// Menempel ke namespace global window.SB. State hidup di SB.G.
//
// PERBAIKAN v9 (bug v8):
// 1. Maju/mundur dibaca dari input.up / input.down — BUKAN input.forward /
//    input.back. Di v8 jalan kaki mati karena mapping itu tidak cocok dengan
//    input yang dikirim game loop.
// 2. SB.G dijamin ada sebelum dipakai: bila Game.start() belum jalan,
//    state awal dibuat di sini supaya update()/pos() tidak pernah crash
//    dan pemain tetap bisa berjalan.
(function () {
  'use strict';

  var STEP = 5;      // unit/detik jalan biasa
  var SPRINT = 12;   // unit/detik lari (Shift)
  var TURN = 2.6;    // radian/detik putar A/D
  var MARGIN = 0.6;  // margin tabrakan dengan bangunan
  var BOUND = 260;   // radius maksimal pemain dari pusat kota

  // State awal default — bentuknya sama seperti yang dibuat Game.start().
  function freshState() {
    return {
      money: 250, rep: 0, wanted: 0, mission: 0, missionStage: 0,
      clock: 18.0,
      player: { x: 0, z: 0, yaw: 0, hp: 100, inCar: false, car: null, speed: 0 },
      police: [], heli: null, dist: 0, drifts: 0, busted: 0,
      ammo: { pistol: 48 }, weapon: 'pistol'
    };
  }

  // Ambil SB.G, buat bila belum ada (beserta player-nya bila hilang).
  function state() {
    var SB = window.SB;
    if (!SB.G) SB.G = freshState();
    if (!SB.G.player) {
      SB.G.player = { x: 0, z: 0, yaw: 0, hp: 100, inCar: false, car: null, speed: 0 };
    }
    return SB.G;
  }

  // Apakah titik (x, z) menabrak bangunan (dengan margin)?
  function blocked(x, z) {
    var city = window.SB.City;
    if (!city || !city.buildings) return false;
    var list = city.buildings;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var hw = (b.w || 10) / 2 + MARGIN;
      var hd = (b.d || 10) / 2 + MARGIN;
      if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd) return true;
    }
    return false;
  }

  // Coba pindah ke (nx, nz); bila mentok, coba geser per sumbu (slide).
  function slide(p, nx, nz) {
    if (!blocked(nx, nz)) {
      p.x = nx; p.z = nz;
      return;
    }
    if (!blocked(nx, p.z)) {
      p.x = nx;
      return;
    }
    if (!blocked(p.x, nz)) {
      p.z = nz;
    }
  }

  window.SB.Player = {
    update: function (dt, input) {
      var g = state();
      var p = g.player;
      if (p.inCar) return; // sedang menyetir: kendaraan yang menggerakkan pemain
      if (!input) input = {};
      if (!dt || dt <= 0) dt = 0.016;

      // Putar dengan A / D (yaw).
      if (input.left) p.yaw += TURN * dt;
      if (input.right) p.yaw -= TURN * dt;

      var speed = input.run ? SPRINT : STEP;
      // Arah hadap: maju = (sin yaw, cos yaw).
      var fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      var mx = 0, mz = 0;
      // Maju/mundur: up/down (W/S atau panah atas/bawah).
      if (input.up) { mx += fx; mz += fz; }
      if (input.down) { mx -= fx; mz -= fz; }
      // Strafe kiri/kanan bila input menyediakannya.
      if (input.strafeLeft) { mx += fz; mz -= fx; }
      if (input.strafeRight) { mx -= fz; mz += fx; }

      var len = Math.sqrt(mx * mx + mz * mz);
      if (len > 0) {
        mx /= len; mz /= len;
        var ox = p.x, oz = p.z;
        slide(p, p.x + mx * speed * dt, p.z + mz * speed * dt);
        // Jarak jalan kaki total (untuk statistik).
        var moved = Math.sqrt((p.x - ox) * (p.x - ox) + (p.z - oz) * (p.z - oz));
        g.dist = (g.dist || 0) + moved;
        p.speed = moved / Math.max(dt, 0.0001);
      } else {
        p.speed = 0;
      }

      // Jaga pemain tetap di dalam batas kota (radius aman).
      var r = Math.sqrt(p.x * p.x + p.z * p.z);
      if (r > BOUND) {
        p.x *= BOUND / r;
        p.z *= BOUND / r;
      }
    },

    pos: function () {
      var g = state();
      return { x: g.player.x, z: g.player.z };
    }
  };
})();

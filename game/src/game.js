// Sunset Bay v8 — game.js
// Misi (18 misi / 49 stage), wanted, polisi, heli, busted/wasted, save/load, ammo.
// Menempel ke namespace global window.SB. State di SB.G.
(function () {
  'use strict';

  var SAVE_KEY = 'sunset-bay-save-v1';
  var SAFEHOUSE = { x: 0, z: 0, yaw: 0 };
  var STAGE_ARRIVE_DIST = 6;
  var AMMO_PRICE = 50;
  var AMMO_AMOUNT = 24;
  var RESPRAY_PRICE = 150;
  var REP_PER_STAGE = 15;   // v8: tiap stage selesai +15 REP
  var REP_PER_MISSION = 40; // v8: tiap misi selesai +40 REP
  // Misi 1 (4 stage) = 4x15 + 40 = +100 REP.

  function G() { return window.SB.G; }

  function showMessage(t) {
    if (window.SB.HUD && window.SB.HUD.showMessage) window.SB.HUD.showMessage(t);
  }

  function sfx(name) {
    if (window.SB.Audio && window.SB.Audio.sfx) window.SB.Audio.sfx(name);
  }

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // ---------------------------------------------------------------------------
  // 18 misi, total 49 stage. Stage counts: 4,3,3,3,3,3,3,2,3,2,3,2,3,2,3,2,3,2
  // ---------------------------------------------------------------------------
  var MISSIONS = [
    { name: 'First Wheels', fastBonus: 50, stages: [
      { text: 'Pergi ke mobil parkir di sudut jalan', target: { x: 20, z: -10 }, reward: 25 },
      { text: 'Bawa mobil ke garasi di seberang kota', target: { x: 60, z: 40 }, reward: 50 },
      { text: 'Antar mobil ke titik drop-off pelabuhan', target: { x: -60, z: 70 }, reward: 25 },
      { text: 'Kembali ke safehouse', target: { x: 0, z: 0 }, reward: 50 }
    ] },
    { name: 'Package Run', stages: [
      { text: 'Ambil paket di Downtown', target: { x: 30, z: 30 }, reward: 40 },
      { text: 'Antar paket ke Marina Bay', target: { x: -80, z: -40 }, reward: 60 },
      { text: 'Lapor kembali ke safehouse', target: { x: 0, z: 0 }, reward: 40 }
    ] },
    { name: 'Harbor Lights', stages: [
      { text: 'Cek dermaga Harbor', target: { x: -100, z: 60 }, reward: 40 },
      { text: 'Ambil kiriman di gudang pelabuhan', target: { x: -120, z: 20 }, reward: 60 },
      { text: 'Antar kiriman ke Old Town', target: { x: 50, z: -60 }, reward: 50 }
    ] },
    { name: 'Night Shift', stages: [
      { text: 'Mulai shift malam di Uptown', target: { x: 70, z: -80 }, reward: 40 },
      { text: 'Jemput penumpang di Northside', target: { x: 90, z: 40 }, reward: 60 },
      { text: 'Antar penumpang ke Beachfront', target: { x: -30, z: 110 }, reward: 50 }
    ] },
    { name: 'Marina Run', stages: [
      { text: 'Ke Marina Bay', target: { x: -70, z: -70 }, reward: 40 },
      { text: 'Ikuti rute pesisir ke selatan', target: { x: -40, z: 100 }, reward: 60 },
      { text: 'Selesai di dermaga selatan', target: { x: -110, z: 90 }, reward: 50 }
    ] },
    { name: 'Hillcrest Climb', stages: [
      { text: 'Naik ke Hillcrest', target: { x: 100, z: 90 }, reward: 50 },
      { text: 'Turun ke titik pandang', target: { x: 60, z: 110 }, reward: 50 },
      { text: 'Kembali ke jalan utama', target: { x: 20, z: 60 }, reward: 50 }
    ] },
    { name: 'Downtown Dash', stages: [
      { text: 'Sprint melintasi Downtown', target: { x: 40, z: 10 }, reward: 50 },
      { text: 'Lewati persimpangan Old Town', target: { x: -20, z: -50 }, reward: 50 },
      { text: 'Finish di alun-alun', target: { x: 10, z: -20 }, reward: 50 }
    ] },
    { name: 'Beachfront Cruise', stages: [
      { text: 'Cruise di Beachfront', target: { x: -10, z: 120 }, reward: 60 },
      { text: 'Parkir di ujung pantai', target: { x: 50, z: 130 }, reward: 60 }
    ] },
    { name: 'Old Town Tour', stages: [
      { text: 'Mulai tur di Old Town', target: { x: -50, z: -80 }, reward: 40 },
      { text: 'Mampir ke pasar lama', target: { x: -30, z: -100 }, reward: 60 },
      { text: 'Akhiri tur di gerbang kota', target: { x: -70, z: -30 }, reward: 50 }
    ] },
    { name: 'Industrial Haul', stages: [
      { text: 'Ambil muatan di Industrial', target: { x: 120, z: -20 }, reward: 60 },
      { text: 'Antar muatan ke gudang Harbor', target: { x: -100, z: 40 }, reward: 70 }
    ] },
    { name: 'Northside Nights', stages: [
      { text: 'Patroli Northside', target: { x: 80, z: 60 }, reward: 50 },
      { text: 'Cek taman utara', target: { x: 110, z: 70 }, reward: 50 },
      { text: 'Kembali ke base', target: { x: 0, z: 0 }, reward: 50 }
    ] },
    { name: 'Southside Sprint', stages: [
      { text: 'Sprint ke Southside', target: { x: -20, z: -120 }, reward: 60 },
      { text: 'Putar balik di ujung selatan', target: { x: 40, z: -130 }, reward: 60 }
    ] },
    { name: 'Uptown Express', stages: [
      { text: 'Ekspres ke Uptown', target: { x: 90, z: -60 }, reward: 50 },
      { text: 'Ambil dokumen penting', target: { x: 120, z: -90 }, reward: 60 },
      { text: 'Serahkan dokumen di Downtown', target: { x: 30, z: 20 }, reward: 50 }
    ] },
    { name: 'Sunset Delivery', stages: [
      { text: 'Ambil pesanan saat senja', target: { x: -60, z: 30 }, reward: 50 },
      { text: 'Antar sebelum gelap', target: { x: 70, z: 100 }, reward: 70 }
    ] },
    { name: 'Midnight Rider', stages: [
      { text: 'Riding tengah malam ke Marina', target: { x: -80, z: -60 }, reward: 60 },
      { text: 'Lewati jembatan pelabuhan', target: { x: -110, z: -10 }, reward: 60 },
      { text: 'Parkir di dermaga', target: { x: -90, z: 50 }, reward: 60 }
    ] },
    { name: 'Harbor Heist', stages: [
      { text: 'Menyusup ke gudang Harbor', target: { x: -120, z: 60 }, reward: 70 },
      { text: 'Kabur ke Hillcrest', target: { x: 100, z: 100 }, reward: 80 }
    ] },
    { name: 'Bay City Legend', stages: [
      { text: 'Buktikan diri di Downtown', target: { x: 20, z: 40 }, reward: 60 },
      { text: 'Tantangan di Northside', target: { x: 100, z: 30 }, reward: 70 },
      { text: 'Penutup di Beachfront', target: { x: 0, z: 120 }, reward: 70 }
    ] },
    { name: 'Sunset Finale', stages: [
      { text: 'Putaran terakhir keliling kota', target: { x: -40, z: -40 }, reward: 80 },
      { text: 'Kembali ke safehouse — legenda Sunset Bay!', target: { x: 0, z: 0 }, reward: 100 }
    ] }
  ];

  function currentMission() {
    var g = G();
    if (!g) return null;
    return MISSIONS[g.mission] || null;
  }

  function currentStage() {
    var m = currentMission();
    var g = G();
    if (!m || !g) return null;
    return m.stages[g.missionStage] || null;
  }

  function respawn(reason) {
    var g = G();
    if (!g || !g.player) return;
    var p = g.player;
    if (p.car && window.SB.Vehicles && window.SB.Vehicles.exitCar) {
      window.SB.Vehicles.exitCar();
    }
    p.x = SAFEHOUSE.x;
    p.z = SAFEHOUSE.z;
    p.yaw = SAFEHOUSE.yaw;
    p.hp = 100;
    p.inCar = false;
    p.car = null;
    p.speed = 0;
    g.police = [];
    g.heli = null;
    g.wanted = 0;
    g._bustTimer = 0;
    if (reason === 'busted') {
      var lost = Math.floor((g.money || 0) * 0.10);
      g.money = (g.money || 0) - lost;
      g.busted = (g.busted || 0) + 1;
      showMessage('BUSTED! Polisi menyita $' + lost + ' (-10%)');
    } else if (reason === 'wasted') {
      showMessage('WASTED! Kamu bangun di safehouse.');
    }
    sfx('busted');
  }

  var Game = {
    MISSIONS: MISSIONS,
    SAVE_KEY: SAVE_KEY,
    _missionStart: 0,
    _bustTimer: 0,

    start: function () {
      // SB.G belum pernah dibuat modul mana pun: buat state awal di sini
      // (tanpa ini Game.start() return dini dan game tak punya state).
      var g = G();
      if (!g) {
        g = window.SB.G = {
          money: 250, rep: 0, wanted: 0, mission: 0, missionStage: 0,
          clock: 18.0,
          player: { x: SAFEHOUSE.x, z: SAFEHOUSE.z, yaw: SAFEHOUSE.yaw, hp: 100, inCar: false, car: null, speed: 0 },
          police: [], heli: null, dist: 0, drifts: 0, busted: 0,
          ammo: { pistol: 48 }, weapon: 'pistol'
        };
      }
      g.money = 250;
      g.rep = 0;
      g.wanted = 0;
      g.mission = 0;
      g.missionStage = 0;
      g.clock = 18.0;
      g.player = { x: SAFEHOUSE.x, z: SAFEHOUSE.z, yaw: SAFEHOUSE.yaw, hp: 100, inCar: false, car: null, speed: 0 };
      g.police = [];
      g.heli = null;
      g.dist = 0;
      g.drifts = 0;
      g.busted = 0;
      g.ammo = { pistol: 48 };
      g.weapon = 'pistol';
      this._missionStart = Date.now();
      this._bustTimer = 0;
      if (window.SB.Jobs) {
        window.SB.Jobs.taxi.active = false;
        window.SB.Jobs.package.active = false;
      }
      showMessage('Misi 1: First Wheels — pergi ke mobil parkir!');
    },

    update: function (dt) {
      var g = G();
      if (!g || !g.player) return;

      // Siklus siang-malam: 1 jam game per ~50 detik nyata.
      g.clock = (g.clock + dt * 0.02) % 24;

      // Cek penyelesaian stage aktif (kedekatan dengan target).
      var stage = currentStage();
      if (stage && stage.target) {
        var d = dist2(g.player.x, g.player.z, stage.target.x, stage.target.z);
        if (d < STAGE_ARRIVE_DIST) this.completeStage();
      }

      if (window.SB.Jobs) window.SB.Jobs.update(dt);
      this.updatePolice(dt);
      this.bustCheck(dt);

      // WASTED: HP habis -> respawn di safehouse.
      if (g.player.hp <= 0) respawn('wasted');

      // Heli mengikuti pemain saat aktif.
      if (g.heli) {
        g.heli.x = g.player.x;
        g.heli.z = g.player.z;
        g.heli.y = 60;
      }
    },

    completeStage: function () {
      var g = G();
      var m = currentMission();
      var stage = currentStage();
      if (!g || !m || !stage) return;
      g.money = (g.money || 0) + (stage.reward || 0);
      g.rep = (g.rep || 0) + REP_PER_STAGE; // v8: +15 REP per stage
      sfx('mission');
      var lastStage = g.missionStage >= m.stages.length - 1;
      if (lastStage) {
        g.rep = (g.rep || 0) + REP_PER_MISSION; // v8: +40 REP per misi selesai
        var bonusMsg = '';
        if (m.fastBonus) {
          var elapsed = (Date.now() - this._missionStart) / 1000;
          if (elapsed < 300) {
            g.money = (g.money || 0) + m.fastBonus;
            bonusMsg = ' Fast bonus +$' + m.fastBonus + '!';
          }
        }
        showMessage('Misi selesai: ' + m.name + '! +$' + (stage.reward || 0) +
          ' (+15 REP stage, +40 REP misi).' + bonusMsg);
        g.mission++;
        g.missionStage = 0;
        this._missionStart = Date.now();
        if (g.mission >= MISSIONS.length) {
          showMessage('SEMUA MISI SELESAI! Kamu legenda Sunset Bay!');
        } else {
          showMessage('Misi ' + (g.mission + 1) + ': ' + MISSIONS[g.mission].name);
        }
      } else {
        showMessage('Stage selesai! +$' + (stage.reward || 0) + ' (+15 REP)');
        g.missionStage++;
      }
      this.save();
    },

    // --- Wanted ---
    wantedUp: function (n) {
      var g = G();
      if (!g) return;
      g.wanted = Math.max(0, Math.min(5, (g.wanted || 0) + (n || 1)));
      if (g.wanted >= 3) this.spawnHeli();
    },

    wantedDown: function (n) {
      var g = G();
      if (!g) return;
      g.wanted = Math.max(0, (g.wanted || 0) - (n || 1));
      if (g.wanted < 3) g.heli = null;
    },

    // Respray di garage (F): bersihkan wanted ke 0, biaya $150.
    respray: function () {
      var g = G();
      if (!g) return false;
      if ((g.money || 0) < RESPRAY_PRICE) {
        showMessage('Respray butuh $' + RESPRAY_PRICE + '!');
        return false;
      }
      if ((g.wanted || 0) === 0) {
        showMessage('Tidak ada wanted untuk dibersihkan.');
        return false;
      }
      g.money -= RESPRAY_PRICE;
      g.wanted = 0;
      g.police = [];
      g.heli = null;
      showMessage('Respray selesai! Wanted bersih. -$' + RESPRAY_PRICE);
      sfx('pickup');
      return true;
    },

    // --- Heli ---
    spawnHeli: function () {
      var g = G();
      if (!g || !g.player) return;
      if (!g.heli) {
        g.heli = { x: g.player.x, y: 60, z: g.player.z };
        showMessage('AIR-1 di udara! Heli polisi mengawasimu.');
      }
    },

    // --- Polisi ---
    updatePolice: function (dt) {
      var g = G();
      if (!g || !g.player) return;
      var wanted = g.wanted || 0;
      if (wanted <= 0) {
        if (g.police.length > 0) g.police = [];
        return;
      }
      // Jumlah polisi aktif mengikuti level wanted (maks 5).
      var want = Math.min(wanted, 5);
      while (g.police.length < want) {
        var a = Math.random() * Math.PI * 2;
        g.police.push({
          x: g.player.x + Math.cos(a) * 40,
          z: g.player.z + Math.sin(a) * 40,
          hp: 100
        });
      }
      while (g.police.length > want) g.police.pop();

      // Polisi mengejar pemain.
      var speed = 7 + wanted * 1.5;
      for (var i = 0; i < g.police.length; i++) {
        var cop = g.police[i];
        var dx = g.player.x - cop.x, dz = g.player.z - cop.z;
        var d = Math.sqrt(dx * dx + dz * dz) || 1;
        cop.x += (dx / d) * speed * dt;
        cop.z += (dz / d) * speed * dt;
        // Polisi menembak bila dekat: kurangi HP pemain perlahan.
        if (d < 25 && wanted >= 2) {
          g.player.hp = Math.max(0, g.player.hp - 2 * dt);
        }
      }
    },

    // Tembak polisi: kurangi HP-nya; menembak polisi → wanted +1 (SPEC).
    // Bila mati, pesan tumbang (total tetap +1, bukan +2).
    damagePolice: function (index, dmg) {
      var g = G();
      if (!g || !g.police || !g.police[index]) return false;
      var cop = g.police[index];
      cop.hp -= (dmg || 25);
      this.wantedUp(1);
      if (cop.hp <= 0) {
        g.police.splice(index, 1);
        showMessage('Polisi tumbang! Wanted +1');
        return true;
      }
      return false;
    },

    // Tembak polisi terdekat dalam jangkauan (dipakai combat klik/F).
    shootNearestPolice: function (range, dmg) {
      var g = G();
      if (!g || !g.player || !g.police || g.police.length === 0) return false;
      var best = -1, bestD = range || 40;
      for (var i = 0; i < g.police.length; i++) {
        var d = dist2(g.player.x, g.player.z, g.police[i].x, g.police[i].z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return false;
      return this.damagePolice(best, dmg || 25);
    },

    // Tembak (F / klik): habiskan 1 ammo Pistol, kenai polisi terdekat.
    // Dipanggil main.js doFireOrRespray — tanpa ini tembakan hanya bunyi.
    fire: function () {
      var g = G();
      if (!g || !g.player) return false;
      if (!g.ammo) g.ammo = { pistol: 0 };
      if ((g.ammo.pistol || 0) <= 0) {
        showMessage('Pistol kehabisan ammo! Beli di garage (G) — $50/+24.');
        sfx('click');
        return false;
      }
      g.ammo.pistol--;
      sfx('shoot');
      this.shootNearestPolice(40, 34);
      return true;
    },

    // Busted: polisi menangkap bila sangat dekat dan pemain lambat/tidak lari.
    bustCheck: function (dt) {
      var g = G();
      if (!g || !g.player) return;
      if ((g.wanted || 0) <= 0 || !g.police || g.police.length === 0) {
        this._bustTimer = 0;
        return;
      }
      var near = false;
      for (var i = 0; i < g.police.length; i++) {
        var d = dist2(g.player.x, g.player.z, g.police[i].x, g.police[i].z);
        if (d < 3) { near = true; break; }
      }
      var playerSpeed = g.player.speed || 0;
      if (near && playerSpeed < 4 && !g.player.inCar) {
        this._bustTimer += dt;
        if (this._bustTimer > 3) {
          this._bustTimer = 0;
          respawn('busted');
        }
      } else {
        this._bustTimer = Math.max(0, this._bustTimer - dt * 2);
      }
    },

    // --- Ammo (baru v8): $50 untuk +24 ammo Pistol ---
    buyAmmo: function () {
      var g = G();
      if (!g) return false;
      if ((g.weapon || 'pistol') !== 'pistol') {
        showMessage('Isi ulang ammo hanya untuk Pistol!');
        return false;
      }
      if ((g.money || 0) < AMMO_PRICE) {
        showMessage('Beli ammo butuh $' + AMMO_PRICE + '!');
        return false;
      }
      if (!g.ammo) g.ammo = { pistol: 0 };
      if (typeof g.ammo.pistol !== 'number') g.ammo.pistol = 0;
      g.money -= AMMO_PRICE;
      g.ammo.pistol += AMMO_AMOUNT;
      showMessage('Ammo Pistol +24! -$' + AMMO_PRICE + ' (total ' + g.ammo.pistol + ')');
      sfx('pickup');
      return true;
    },

    // --- Save / Load ---
    save: function () {
      var g = G();
      if (!g) return;
      try {
        var s = {
          money: g.money, rep: g.rep, wanted: g.wanted,
          mission: g.mission, missionStage: g.missionStage, clock: g.clock,
          player: {
            x: g.player.x, z: g.player.z, yaw: g.player.yaw,
            hp: g.player.hp, inCar: false, car: null, speed: 0
          },
          dist: g.dist, drifts: g.drifts, busted: g.busted,
          ammo: g.ammo, weapon: g.weapon
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      } catch (e) { /* storage tidak tersedia: abaikan */ }
    },

    load: function () {
      try {
        var raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        this.applySave(s);
        return s;
      } catch (e) {
        return null;
      }
    },

    applySave: function (s) {
      var g = G();
      if (!s) return;
      if (!g) {
        g = window.SB.G = {
          money: 250, rep: 0, wanted: 0, mission: 0, missionStage: 0,
          clock: 18.0,
          player: { x: 0, z: 0, yaw: 0, hp: 100, inCar: false, car: null, speed: 0 },
          police: [], heli: null, dist: 0, drifts: 0, busted: 0,
          ammo: { pistol: 48 }, weapon: 'pistol'
        };
      }
      g.money = (typeof s.money === 'number') ? s.money : 250;
      g.rep = s.rep || 0;
      g.wanted = s.wanted || 0;
      g.mission = s.mission || 0;
      g.missionStage = s.missionStage || 0;
      g.clock = (typeof s.clock === 'number') ? s.clock : 18.0;
      if (s.player) {
        g.player = {
          x: s.player.x || 0, z: s.player.z || 0, yaw: s.player.yaw || 0,
          hp: (typeof s.player.hp === 'number') ? s.player.hp : 100,
          inCar: false, car: null, speed: 0
        };
      }
      g.dist = s.dist || 0;
      g.drifts = s.drifts || 0;
      g.busted = s.busted || 0;
      g.ammo = s.ammo || { pistol: 48 };
      g.weapon = s.weapon || 'pistol';
      g.police = [];
      g.heli = null;
      if (g.wanted >= 3) this.spawnHeli();
      this._missionStart = Date.now();
      this._bustTimer = 0;
    }
  };

  window.SB.Game = Game;
})();

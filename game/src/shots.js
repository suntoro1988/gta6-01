// Sunset Bay — Shots (v9, ditulis fresh dari SPEC-v8)
// window.SB.Shots: { fire, selectWeapon, weapons, stage }
// Dua tugas dalam satu modul:
//  (A) LOGIKA PENEMBAKAN — Game.fire() + 4 slot senjata + HP polisi.
//  (B) STAGING SCREENSHOT — stage() menyiapkan kamera/state untuk 4
//      screenshot dossier (?shot=start|play|foot|end), dipakai main.js.
//
// PERBAIKAN BUG v8: Game.fire() di sini DIDEFINISIKAN dan dipasang ke
// SB.Game.fire (shots.js dimuat setelah game.js, jadi ini yang dipakai
// main.js saat tombol F / klik). Kunci ammo konsisten lowercase semua:
// 'pistol' — tidak pernah 'Pistol'. Slot lain (smg/shotgun/rifle) memakai
// kunci lowercase yang sama ('smg', 'shotgun', 'rifle').
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};
  function G() { return SB.G; }

  // ---------- (A) LOGIKA PENEMBAKAN ----------

  // 4 slot senjata. damage = HP polisi yang hilang per kena (polisi HP 100,
  // jadi Pistol butuh 3 kena — sama seperti SPEC v8). range = jarak kena
  // maksimum. starter = ammo awal bila kunci ammo belum ada di save/state.
  var WEAPONS = [
    { key: 'pistol',  name: 'Pistol',  damage: 34, range: 40, starter: 48 },
    { key: 'smg',     name: 'SMG',     damage: 16, range: 35, starter: 60 },
    { key: 'shotgun', name: 'Shotgun', damage: 50, range: 22, starter: 12 },
    { key: 'rifle',   name: 'Rifle',   damage: 65, range: 70, starter: 20 }
  ];

  function showMessage(t) {
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage(t);
  }

  function playSfx(name) {
    if (SB.Audio) SB.Audio.sfx(name);
  }

  // Pastikan objek ammo punya keempat kunci lowercase. Hanya mengisi kunci
  // yang BELUM ADA — jumlah ammo yang sudah dimiliki tidak pernah diubah.
  function ensureAmmo(g) {
    if (!g.ammo || typeof g.ammo !== 'object') g.ammo = {};
    for (var i = 0; i < WEAPONS.length; i++) {
      var w = WEAPONS[i];
      if (typeof g.ammo[w.key] !== 'number') g.ammo[w.key] = w.starter;
    }
    return g.ammo;
  }

  // Senjata aktif saat ini (slot 0 = Pistol bila belum pernah dipilih).
  function activeWeapon(g) {
    var slot = g.weaponSlot || 0;
    if (slot < 0 || slot >= WEAPONS.length) slot = 0;
    return WEAPONS[slot];
  }

  // Naikkan wanted +1 (maks 5). Pakai Game.wantedUp bila ada.
  function wantedUp(g) {
    if (SB.Game && SB.Game.wantedUp) { SB.Game.wantedUp(1); return; }
    g.wanted = Math.min(5, (g.wanted || 0) + 1);
  }

  // Kurangi HP satu polisi; mati -> hapus dari daftar. Return true bila mati.
  // Menembak polisi -> wanted +1 per kena (SPEC v8; kill tidak menambah lagi).
  function damageCop(g, index, dmg) {
    if (!g.police || !g.police[index]) return false;
    var cop = g.police[index];
    if (typeof cop.hp !== 'number') cop.hp = 100;
    cop.hp -= (dmg || 25);
    wantedUp(g);
    if (cop.hp <= 0) {
      g.police.splice(index, 1);
      showMessage('Polisi tumbang! Wanted +1');
      return true;
    }
    return false;
  }

  // Tembak polisi terdekat dalam jangkauan. Delegasikan ke Game bila ada
  // (game.js), supaya satu sumber kebenaran; fallback lokal bila tidak ada.
  function shootNearest(g, range, dmg) {
    if (!g.player || !g.police || g.police.length === 0) return false;
    if (SB.Game && SB.Game.shootNearestPolice) {
      return SB.Game.shootNearestPolice(range, dmg);
    }
    var best = -1, bestD = range || 40;
    for (var i = 0; i < g.police.length; i++) {
      var d = Math.sqrt(
        (g.player.x - g.police[i].x) * (g.player.x - g.police[i].x) +
        (g.player.z - g.police[i].z) * (g.player.z - g.police[i].z));
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return false;
    return damageCop(g, best, dmg || 25);
  }

  // Tembak (F / klik): habiskan 1 ammo senjata aktif, kenai polisi terdekat.
  // Dipanggil main.js doFireOrRespray lewat SB.Game.fire().
  // Selalu menandai g._fireFlashUntil supaya HUD menampilkan crosshair
  // selama momen tembakan (perbaikan bug v8: crosshair tak pernah tampil).
  function fire() {
    var g = G();
    if (!g || !g.player) return false;
    var w = activeWeapon(g);
    var ammo = ensureAmmo(g);
    // Crosshair menyala saat menembak, apa pun hasil tembakannya.
    g._fireFlashUntil = Date.now() + 400;
    if ((ammo[w.key] || 0) <= 0) {
      showMessage(w.name + ' kehabisan ammo! Beli di garage (G) — $50/+24.');
      playSfx('click');
      return false;
    }
    ammo[w.key]--;
    g.weapon = w.key; // sinkronkan nama senjata (lowercase) untuk HUD & shop
    playSfx('shoot');
    shootNearest(g, w.range, w.damage);
    return true;
  }

  // Ganti slot senjata (tombol 1..4). Return true bila berhasil.
  function selectWeapon(slot) {
    var g = G();
    if (!g) return false;
    if (slot < 0 || slot >= WEAPONS.length) return false;
    var w = WEAPONS[slot];
    ensureAmmo(g);
    g.weaponSlot = slot;
    g.weapon = w.key;
    if (!g.weapons) {
      g.weapons = WEAPONS.map(function (x) { return { name: x.name }; });
    }
    showMessage('Senjata: ' + w.name + ' (ammo ' + (g.ammo[w.key] || 0) + ')');
    playSfx('click');
    return true;
  }

  // Tombol 1..4 untuk ganti senjata. Listener sendiri di modul ini supaya
  // tidak perlu mengubah main.js.
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) selectWeapon(n - 1);
    });
  }

  // ---------- (B) STAGING SCREENSHOT ----------

  function showTitle() {
    var t = document.getElementById('title');
    if (t) t.style.display = 'flex';
    var h = document.getElementById('hud');
    if (h) h.style.display = 'none';
  }

  function hideTitle() {
    var t = document.getElementById('title');
    if (t) t.style.display = 'none';
    var h = document.getElementById('hud');
    if (h) h.style.display = 'block';
  }

  function putInCar() {
    var g = SB.G;
    if (!g || !g.player) return;
    var car = null;
    if (SB.Vehicles && SB.Vehicles.cars) {
      for (var i = 0; i < SB.Vehicles.cars.length; i++) {
        if (SB.Vehicles.cars[i].parked) { car = SB.Vehicles.cars[i]; break; }
      }
      if (!car && SB.Vehicles.cars.length) car = SB.Vehicles.cars[0];
    }
    if (car) {
      g.player.inCar = true;
      g.player.car = car;
      g.player.x = car.x; g.player.z = car.z;
      g.player.yaw = car.yaw || 0;
      g.player.speed = 14;
    }
  }

  function spawnPoliceNear(n) {
    var g = SB.G;
    if (!g || !g.player) return;
    g.police = g.police || [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      g.police.push({
        x: g.player.x + Math.cos(a) * 14,
        z: g.player.z + Math.sin(a) * 14,
        hp: 100, yaw: a
      });
    }
  }

  var Shots = {
    weapons: WEAPONS,
    fire: fire,
    selectWeapon: selectWeapon,

    // Siapkan kamera/state untuk screenshot dossier (?shot=<nama>).
    stage: function (name) {
      var g = SB.G;
      if (!g) return;
      hideTitle();
      if (SB.HUD && SB.HUD.mapOpen) SB.HUD.toggleMap();
      if (name === 'start') {
        // Title screen, senja, kota di belakang.
        showTitle();
        g.clock = 18.0;
        g.wanted = 0;
        g.mission = 0; g.missionStage = 0;
        if (g.player) {
          g.player.x = 0; g.player.z = 0; g.player.yaw = 0.6;
          g.player.inCar = false; g.player.car = null;
        }
        return;
      }
      if (name === 'play') {
        // Kejar-kejaran: wanted >= 2 + polisi terlihat + minimap + misi aktif.
        g.clock = 18.5;
        g.mission = 0; g.missionStage = 0;
        g.wanted = 2;
        putInCar();
        spawnPoliceNear(3);
        if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
        return;
      }
      if (name === 'foot') {
        // Jalan kaki, siang, di darat dekat dermaga marina.
        g.clock = 10.0;
        g.wanted = 0;
        g.police = [];
        g.mission = 1; g.missionStage = 0;
        if (g.player) {
          g.player.inCar = false; g.player.car = null;
          g.player.x = -160; g.player.z = 110; g.player.yaw = 1.2; g.player.speed = 0;
        }
        if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
        return;
      }
      if (name === 'end') {
        // Peta fullscreen di malam hari.
        g.clock = 22.0;
        g.wanted = 0;
        g.mission = 2; g.missionStage = 0;
        if (g.player) {
          g.player.inCar = false; g.player.car = null;
          g.player.x = 40; g.player.z = -60;
        }
        if (SB.HUD && !SB.HUD.mapOpen) SB.HUD.toggleMap();
        if (SB.HUD) SB.HUD.update();
        return;
      }
      // Nama shot tak dikenal: gameplay biasa.
      g.mission = 0; g.missionStage = 0;
      if (SB.HUD) SB.HUD.update();
    }
  };

  SB.Shots = Shots;

  // Pasang fire() sebagai SB.Game.fire — inilah yang dipanggil main.js
  // (doFireOrRespray) saat pemain menekan F / klik. shots.js dimuat setelah
  // game.js, jadi penugasan ini yang berlaku; perilakunya sama dengan SPEC
  // v8 (pistol 34 dmg / jangkauan 40, ammo -1, wanted +1 per kena).
  if (SB.Game) {
    SB.Game.fire = fire;
  } else {
    SB.Game = { fire: fire };
  }
})();

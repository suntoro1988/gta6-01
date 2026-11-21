// Sunset Bay — main.js (v9, ditulis ulang)
// Bootstrap: inisialisasi GL + kota, bangun mesh dunia sekali di awal,
// layar judul, game loop (update + render), input keyboard, dan toko
// garage. Semua mesh diproses lewat SB.GL.mesh() DI SINI (sekali),
// sehingga render loop hanya memanggil GL.draw() dengan mesh yang
// sudah jadi — tidak pernah dengan mesh mentah.
// PENTING: SB.Water.draw() dipanggil setiap frame render (dermaga
// marina harus selalu tergambar).
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var canvas = null;
  var pressed = {};
  var isRunning = false;
  var prevTime = 0;
  var stagedShot = null;

  // Mesh yang sudah diproses (buffer WebGL), dibangun sekali saat start.
  var worldMeshes = [];
  var walkerMesh = null;
  var boatMesh = null;
  var treeMesh = null;
  var groundMesh = null;
  var seaMesh = null;
  var carMeshes = {};

  function el(id) { return document.getElementById(id); }

  function queryParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ---------- toko garage ----------
  function showGarage() {
    var ov = el('garage');
    if (!ov) return;
    ov.style.display = 'flex';
    refreshGaragePanel();
    if (SB.Audio) SB.Audio.sfx('click');
  }

  function hideGarage() {
    var ov = el('garage');
    if (ov) ov.style.display = 'none';
  }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  function refreshGaragePanel() {
    var g = SB.G;
    if (!g) return;
    setText('garage-money', 'Money: $' + Math.floor(g.money || 0));
    setText('garage-wanted', 'Wanted: ' + (g.wanted || 0) + ' stars');
    var ammo = 0;
    if (g.ammo && typeof g.ammo === 'object' && g.ammo.pistol != null) ammo = g.ammo.pistol;
    else if (typeof g.ammo === 'number') ammo = g.ammo;
    setText('garage-ammo', 'Pistol ammo: ' + ammo);
  }

  function shopBuyAmmo() {
    if (SB.Game && SB.Game.buyAmmo) SB.Game.buyAmmo();
    else if (SB.G && SB.G.money >= 50) {
      SB.G.money -= 50;
      if (SB.G.ammo && typeof SB.G.ammo === 'object') SB.G.ammo.pistol = (SB.G.ammo.pistol || 0) + 24;
      else SB.G.ammo = { pistol: 24 };
    }
    refreshGaragePanel();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Ammo +24'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }

  function shopRespray() {
    var g = SB.G;
    if (SB.Game && SB.Game.respray) { SB.Game.respray(); }
    else if (g && g.money >= 150) { g.money -= 150; g.wanted = 0; }
    else { if (SB.HUD) SB.HUD.showMessage('Need $150 for respray'); return; }
    refreshGaragePanel();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Respray done — wanted cleared'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }

  function shopEngine() {
    var g = SB.G;
    if (!g) return;
    if (SB.Game && SB.Game.buyEngine) { SB.Game.buyEngine(); }
    else if (g.money >= 400) { g.money -= 400; g.engineLevel = (g.engineLevel || 0) + 1; }
    else { if (SB.HUD) SB.HUD.showMessage('Engine upgrade needs $400'); return; }
    refreshGaragePanel();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Engine upgraded'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }

  function shopArmour() {
    var g = SB.G;
    if (!g) return;
    if (SB.Game && SB.Game.buyArmour) { SB.Game.buyArmour(); }
    else if (g.money >= 300) { g.money -= 300; g.armour = (g.armour || 0) + 50; }
    else { if (SB.HUD) SB.HUD.showMessage('Armour needs $300'); return; }
    refreshGaragePanel();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Armour installed'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }

  // ---------- input ----------
  function onKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (SB.HUD) SB.HUD.toggleMap();
      return;
    }
    pressed[e.key.toLowerCase()] = true;
    if (e.key === ' ') e.preventDefault();
    if (e.repeat) return;
    var k = e.key.toLowerCase();
    if (k === 'p') { if (SB.HUD) SB.HUD.togglePause(); return; }
    if (k === 'm') { if (SB.Audio) SB.Audio.nextStation(); return; }
    if (k === 'g') { showGarage(); return; }
    if (k === 'escape') { hideGarage(); return; }
    if (k === 'e') { interact(); return; }
    if (k === 'f') { fireOrRespray(); return; }
  }

  function onKeyUp(e) { pressed[e.key.toLowerCase()] = false; }

  function interact() {
    var g = SB.G;
    if (!g || !g.player) return;

    // Sudah di kapal: E selalu bisa turun, di mana pun kapal berada.
    // Sebelumnya turun hanya bisa di zona dermaga (gate di bawah), jadi
    // pemain yang berlayar >20 unit dari dermaga TERKUNCI di kapal (E
    // tidak melakukan apa-apa) — cacat nyata temuan QA v9.
    if (g.player.inBoat) {
      if (SB.Water && SB.Water.leaveBoat) { SB.Water.leaveBoat(); return; }
    }

    // Dekat dermaga marina: naik / turun speedboat. Boarding hanya
    // diizinkan di area dermaga (x < -160, z sekitar 120); jarak
    // pastinya dicek sendiri oleh Water.boardBoat.
    if (SB.Water && SB.Water.boardBoat && g.player.x < -160 && Math.abs(g.player.z - 120) < 20) {
      if (SB.Water.boardBoat()) return;
    }

    // Keluar dari mobil.
    if (g.player.inCar) {
      if (SB.Vehicles) SB.Vehicles.exitCar();
      g.player.inCar = false;
      g.player.car = null;
      return;
    }

    // Curi mobil terdekat. stealNearest sudah memasukkan pemain ke
    // mobil DAN menaikkan wanted sendiri — jangan dobel di sini.
    var car = null;
    if (SB.Vehicles) {
      car = SB.Vehicles.stealNearest ? SB.Vehicles.stealNearest() : null;
      if (car) return;
      if (SB.Vehicles.nearestParked) car = SB.Vehicles.nearestParked(g.player.x, g.player.z);
    }
    // Jalur cadangan: mobil parkir terdekat dalam 6 unit. Jalur ini hanya
    // tercapai bila stealNearest gagal; curi mobil tetap wanted +2 TOTAL
    // (SPEC v8) — sama seperti stealNearest, jangan +1.
    if (car && Math.hypot(car.x - g.player.x, car.z - g.player.z) <= 6) {
      if (SB.Vehicles && SB.Vehicles.enterCar) SB.Vehicles.enterCar(car);
      else { g.player.inCar = true; g.player.car = car; }
      if (SB.Game && SB.Game.wantedUp) SB.Game.wantedUp(2);
      else g.wanted = Math.min(5, (g.wanted || 0) + 2);
      if (SB.HUD) SB.HUD.showMessage('Car stolen! Wanted +2');
      if (SB.Audio) SB.Audio.sfx('pickup');
    }
  }

  function fireOrRespray() {
    var g = SB.G;
    if (!g || !g.player) return;
    // Dekat garage: F = respray (bersihkan wanted, $150).
    if (Math.abs(g.player.x - 120) < 25 && Math.abs(g.player.z + 80) < 25) {
      shopRespray();
      return;
    }
    // Selain itu: tembak pistol.
    if (SB.Game && SB.Game.fire) SB.Game.fire();
    else {
      if (SB.Audio) SB.Audio.sfx('shoot');
      if (SB.HUD) SB.HUD.showMessage('Bang!');
    }
  }

  // State tombol yang dibaca Player.update. Kunci panah dipetakan ke
  // nama yang sama dengan WASD agar jalan kaki tetap jalan.
  function readInput() {
    return {
      forward: !!(pressed['w'] || pressed['arrowup']),
      back: !!(pressed['s'] || pressed['arrowdown']),
      left: !!(pressed['a'] || pressed['arrowleft']),
      right: !!(pressed['d'] || pressed['arrowright']),
      up: !!(pressed['w'] || pressed['arrowup']),
      down: !!(pressed['s'] || pressed['arrowdown']),
      run: !!pressed['shift'],
      drift: !!pressed[' ']
    };
  }

  // ---------- bangun mesh dunia (sekali saat start) ----------
  function buildWorldMeshes() {
    worldMeshes = [];
    var list = (SB.City && SB.City.buildings) || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      // SB.Meshes.building mengembalikan data mentah {pos, col};
      // bungkus sekali lewat GL.mesh di sini, bukan tiap frame.
      var raw = SB.Meshes.building(b.w, b.h, b.d, i * 7 + 3);
      worldMeshes.push({ mesh: SB.GL.mesh(raw.pos, raw.col), x: b.x, z: b.z });
    }
    var pm = SB.Meshes.person();
    walkerMesh = SB.GL.mesh(pm.pos, pm.col);
    var bm = SB.Meshes.boat();
    boatMesh = SB.GL.mesh(bm.pos, bm.col);
    var tm = SB.Meshes.tree();
    treeMesh = SB.GL.mesh(tm.pos, tm.col);
    var gm = SB.Meshes.box(560, 0.5, 560);
    groundMesh = SB.GL.mesh(gm.pos, gm.col);
    var sm = SB.Meshes.box(120, 0.4, 560);
    seaMesh = SB.GL.mesh(sm.pos, sm.col);
  }

  // Mesh mobil per warna, di-cache supaya tidak dibuat ulang tiap frame.
  function meshForCar(color) {
    var key = Array.isArray(color) ? color.join(',') : String(color || 'red');
    if (!carMeshes[key]) {
      var raw = SB.Meshes.car(Array.isArray(color) ? color : [0.8, 0.2, 0.2]);
      carMeshes[key] = SB.GL.mesh(raw.pos, raw.col);
    }
    return carMeshes[key];
  }

  // ---------- render ----------
  // Warna langit mengikuti jam game: siang cerah, senja oranye,
  // awal malam ungu, malam biru gelap.
  function skyFor(clock) {
    var h = clock % 24;
    if (h >= 6 && h < 17) return [0.53, 0.81, 0.92];
    if (h >= 17 && h < 19.5) return [0.98, 0.62, 0.35];
    if (h >= 19.5 && h < 21) return [0.35, 0.25, 0.45];
    return [0.05, 0.08, 0.18];
  }

  function drawWorld() {
    var GL = SB.GL, M = SB.Math3;
    if (!GL || !GL.alive()) return;
    var g = SB.G;
    var sky = skyFor(g.clock == null ? 18 : g.clock);
    GL.clear(sky[0], sky[1], sky[2]);
    GL.setFog(60, 320);

    var p = g.player || { x: 0, z: 0, yaw: 0 };
    var camBack = 12, camUp = 5;
    // PENTING: Math3 memakai vektor OBJEK {x,y,z} — JANGAN array [x,y,z].
    // Array membuat vSub/vDot di mat4LookAt menghasilkan NaN (vec() mengubah
    // NaN jadi 0) sehingga matriks view nol total dan DUNIA TIDAK TERRENDER
    // sama sekali (hanya warna langit). Itu bug v9 yang ditemukan QA.
    var eye = M.v3(p.x - Math.sin(p.yaw) * camBack, camUp, p.z - Math.cos(p.yaw) * camBack);
    var look = M.v3(p.x + Math.sin(p.yaw) * 6, 1.5, p.z + Math.cos(p.yaw) * 6);
    GL.setCamera(eye, look);

    // Tanah kota + laut (slab datar di barat/selatan).
    if (groundMesh) GL.draw(groundMesh, M.mat4Translate(0, -0.3, 0));
    if (seaMesh) GL.draw(seaMesh, M.mat4Translate(-300, -0.2, 0));

    // Gedung-gedung.
    for (var i = 0; i < worldMeshes.length; i++) {
      var bm = worldMeshes[i];
      GL.draw(bm.mesh, M.mat4Translate(bm.x, 0, bm.z));
    }

    // Pohon di sepanjang jalan (grid 8 x 5).
    if (treeMesh) {
      for (var t = 0; t < 40; t++) {
        var tx = -240 + (t % 8) * 68;
        var tz = -240 + Math.floor(t / 8) * 96;
        GL.draw(treeMesh, M.mat4Translate(tx, 0, tz));
      }
    }

    // Lalu lintas + mobil parkir (mobil pemain digambar terpisah di bawah).
    if (SB.Vehicles && SB.Vehicles.cars) {
      for (var c = 0; c < SB.Vehicles.cars.length; c++) {
        var car = SB.Vehicles.cars[c];
        if (g.player.inCar && g.player.car === car) continue;
        var cm = M.mat4Mul(M.mat4Translate(car.x, 0, car.z), M.mat4RotateY(car.yaw || 0));
        GL.draw(meshForCar(car.color), cm);
      }
    }

    // Pemain: mobilnya bila sedang menyetir, pejalan kaki bila tidak.
    if (g.player.inCar && g.player.car) {
      var pc = g.player.car;
      var pcm = M.mat4Mul(M.mat4Translate(p.x, 0, p.z), M.mat4RotateY(p.yaw));
      GL.draw(meshForCar(pc.color), pcm);
    } else if (walkerMesh) {
      var wm = M.mat4Mul(M.mat4Translate(p.x, 0, p.z), M.mat4RotateY(p.yaw));
      GL.draw(walkerMesh, wm);
    }

    // Mobil polisi.
    if (g.police) {
      for (var j = 0; j < g.police.length; j++) {
        var cop = g.police[j];
        var pom = M.mat4Mul(M.mat4Translate(cop.x, 0, cop.z), M.mat4RotateY(cop.yaw || 0));
        GL.draw(meshForCar([0.1, 0.15, 0.5]), pom);
      }
    }

    // Heli polisi (digambar dengan mesh pejalan kaki sebagai placeholder).
    if (g.heli && walkerMesh) {
      GL.draw(walkerMesh, M.mat4Translate(g.heli.x, g.heli.y || 40, g.heli.z));
    }

    // Speedboat di atas air.
    if (boatMesh && SB.Water && SB.Water.boat) {
      var b = SB.Water.boat;
      var boatM = M.mat4Mul(M.mat4Translate(b.x, 0.4, b.z), M.mat4RotateY(b.yaw || 0));
      GL.draw(boatMesh, boatM);
    }

    // Dermaga marina — HARUS digambar tiap frame.
    if (SB.Water && SB.Water.draw) SB.Water.draw();
  }

  // ---------- game loop ----------
  function frame(t) {
    if (!isRunning) return;
    requestAnimationFrame(frame);
    var dt = Math.min(0.05, (t - prevTime) / 1000 || 0.016);
    prevTime = t;
    var g = SB.G;
    var paused = SB.HUD ? SB.HUD.isPaused() : false;
    if (!paused && g) {
      // Jam game hanya maju di Game.update — jangan dobel di sini.
      if (SB.Player) SB.Player.update(dt, readInput());
      if (SB.Vehicles) SB.Vehicles.update(dt);
      if (SB.Water) SB.Water.update(dt);
      if (SB.Jobs) SB.Jobs.update(dt);
      if (SB.Game) SB.Game.update(dt);
    }
    drawWorld();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
  }

  // ---------- layar judul ----------
  function wireTitleButtons() {
    var btnNew = el('btn-new');
    if (btnNew) btnNew.addEventListener('click', function () {
      if (SB.Audio) SB.Audio.init();
      beginPlay(false);
    });
    var btnContinue = el('btn-continue');
    if (btnContinue) btnContinue.addEventListener('click', function () {
      if (SB.Audio) SB.Audio.init();
      beginPlay(true);
    });
    // Tombol Continue hanya tampil bila ada save tersimpan.
    var save = null;
    try { save = localStorage.getItem('sunset-bay-save-v1'); } catch (e) { save = null; }
    if (btnContinue) btnContinue.style.display = save ? 'block' : 'none';
  }

  function beginPlay(fromSave) {
    var title = el('title');
    if (title) title.style.display = 'none';
    var hud = el('hud');
    if (hud) hud.style.display = 'block';
    if (fromSave && SB.Game && SB.Game.load) SB.Game.load();
    else if (SB.Game && SB.Game.start) SB.Game.start();
    if (SB.HUD) SB.HUD.showMessage(fromSave ? 'Welcome back to Sunset Bay' : 'Welcome to Sunset Bay');
    if (!isRunning) {
      isRunning = true;
      prevTime = performance.now();
      requestAnimationFrame(frame);
    }
  }

  function ensureLoop() {
    if (!isRunning) {
      isRunning = true;
      prevTime = performance.now();
      requestAnimationFrame(frame);
    }
  }

  var Main = {
    start: function () {
      canvas = el('game');
      if (!canvas) return;

      // Canvas mengikuti ukuran jendela.
      var resize = function () {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      window.addEventListener('resize', resize);
      resize();

      if (SB.GL) SB.GL.init(canvas);
      if (SB.City) SB.City.build(7); // seed deterministik 7
      buildWorldMeshes();
      if (SB.Vehicles) SB.Vehicles.spawnTraffic();
      if (SB.Water) SB.Water.init();
      if (SB.Game) SB.Game.start();

      window.__SB = SB; // hook untuk QA otomatis

      // Tombol-tombol garage.
      var bind = function (id, fn) { var node = el(id); if (node) node.addEventListener('click', fn); };
      bind('btn-ammo', shopBuyAmmo);
      bind('btn-respray', shopRespray);
      bind('btn-engine', shopEngine);
      bind('btn-armour', shopArmour);
      bind('btn-garage-close', hideGarage);

      // Audio WebAudio butuh gestur pengguna dulu: buka di interaksi pertama.
      document.addEventListener('pointerdown', function () { if (SB.Audio) SB.Audio.init(); }, { once: true });
      document.addEventListener('keydown', function () { if (SB.Audio) SB.Audio.init(); }, { once: true });

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      canvas.addEventListener('click', function () {
        if (SB.Audio) SB.Audio.init();
        fireOrRespray();
      });

      wireTitleButtons();

      // Mode screenshot (?shot=nama): langsung main tanpa layar judul.
      stagedShot = queryParam('shot');
      if (stagedShot) {
        beginPlay(false);
        if (SB.Shots) SB.Shots.stage(stagedShot);
      } else {
        // Layar judul: kota tetap dirender di belakangnya.
        ensureLoop();
      }
    }
  };

  SB.Main = Main;
  document.addEventListener('DOMContentLoaded', function () { Main.start(); });
})();

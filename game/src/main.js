// Sunset Bay — Main (ditulis fresh untuk v7, dari SPEC)
// SB.Main.start(): bootstrap — init GL, City.build(7), spawn traffic,
// title screen (New Game / Continue — Continue hidden jika tak ada save),
// loop requestAnimationFrame, input keyboard, ?shot= staging.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};
  var SAVE_KEY = 'sunset-bay-save-v1';

  // State default SB.G (isi field yang belum ada saja).
  var DEF = {
    money: 250, rep: 0, wanted: 0, mission: 0, missionStage: 0,
    clock: 18.0,
    player: { x: 0, z: 40, yaw: 0, hp: 100, inCar: false, car: null, speed: 0 },
    police: [], heli: null, dist: 0, drifts: 0, busted: 0,
    paused: false, weapon: 'Fists', inBoat: false, input: {}
  };
  SB.G = SB.G || {};
  for (var k in DEF) if (SB.G[k] === undefined) SB.G[k] = DEF[k];
  if (!SB.G.player) SB.G.player = DEF.player;
  if (!SB.G.input) SB.G.input = {};
  window.__SB = SB;

  var started = false, booted = false;
  var canvas = null, titleEl = null, btnNew = null, btnContinue = null;
  var groundMesh = null, waterMesh = null, personMesh = null, boatMesh = null;
  var bMeshes = [], carMeshes = {};
  var keys = {};
  var orbitT = 0, lastT = 0;

  function $(id) { return document.getElementById(id); }

  function skyColor(h) {
    // h = jam 0-24. Siang terang, senja oranye, malam gelap.
    var day = (h >= 7 && h < 17.5) ? 1 : 0;
    var dusk = (h >= 17.5 && h < 19.5) || (h >= 5.5 && h < 7) ? 1 : 0;
    if (day) return [0.45, 0.68, 0.92];
    if (dusk) return [0.42, 0.24, 0.28];
    return [0.03, 0.04, 0.10];
  }

  function fwd(yaw) { return [Math.sin(yaw), 0, Math.cos(yaw)]; }

  function buildTitle() {
    titleEl = $('title');
    if (!titleEl) {
      titleEl = document.createElement('div');
      titleEl.id = 'title';
      titleEl.style.cssText =
        'position:fixed;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;z-index:50;' +
        'background:linear-gradient(rgba(5,10,25,.25),rgba(5,10,25,.72));' +
        'color:#fff;font-family:system-ui,sans-serif;text-align:center;';
      titleEl.innerHTML =
        '<h1 style="font-size:56px;margin:0;letter-spacing:4px;' +
        'text-shadow:0 3px 14px #000">SUNSET BAY</h1>' +
        '<p style="font-size:16px;opacity:.9;margin:10px 0 26px">' +
        'Open-world di tepi teluk — 18 misi, 10 distrik, radio 5 stasiun</p>' +
        '<button id="btn-new" style="font-size:18px;padding:12px 34px;' +
        'margin:6px;border:0;border-radius:8px;cursor:pointer;' +
        'background:#FFD23F;color:#111;font-weight:700">New Game</button>' +
        '<button id="btn-continue" style="font-size:18px;padding:12px 34px;' +
        'margin:6px;border:0;border-radius:8px;cursor:pointer;' +
        'background:#2E7DFF;color:#fff;font-weight:700">Continue</button>' +
        '<p style="font-size:12px;opacity:.75;margin-top:22px">' +
        'WASD jalan / nyetir &nbsp;·&nbsp; E curi &amp; naik mobil / boat ' +
        '&nbsp;·&nbsp; F tembak / respray &nbsp;·&nbsp; Space drift<br>' +
        'M radio &nbsp;·&nbsp; Tab peta &nbsp;·&nbsp; P pause &nbsp;·&nbsp; Shift lari</p>';
      document.body.appendChild(titleEl);
    }
    btnNew = $('btn-new');
    btnContinue = $('btn-continue');
    var hasSave = false;
    try { hasSave = !!localStorage.getItem(SAVE_KEY); } catch (e) { hasSave = false; }
    if (btnContinue) btnContinue.style.display = hasSave ? 'block' : 'none';
    if (btnNew) btnNew.addEventListener('click', function () {
      SB.Audio.init();
      SB.Audio.sfx('click');
      if (SB.Game) SB.Game.start();
      hideTitle();
    });
    if (btnContinue) btnContinue.addEventListener('click', function () {
      SB.Audio.init();
      SB.Audio.sfx('click');
      // load() mengembalikan OBJEK save (bukan boolean) — harus di-apply,
      // kalau tidak Continue mulai dari nol meski save ada.
      var sv = SB.Game && SB.Game.load ? SB.Game.load() : null;
      if (sv) {
        if (SB.Game.applySave) SB.Game.applySave(sv);
        hideTitle();
      } else if (SB.HUD) SB.HUD.showMessage('Save tidak ditemukan — mulai New Game.');
    });
  }

  function hideTitle() {
    started = true;
    if (titleEl) titleEl.style.display = 'none';
  }

  function showTitle() {
    started = false;
    if (titleEl) titleEl.style.display = 'flex';
  }

  function cacheMeshes() {
    var M = SB.Meshes, GL = SB.GL;
    if (!M || !GL) return;
    groundMesh = GL.mesh.apply(GL, meshArgs(M.box(560, 1, 560), [0.13, 0.28, 0.16]));
    // Satu hamparan laut besar (±800) di bawah daratan — tanpa tumpang tindih
    // dua kotak air (z-fighting) dan tanpa celah kosong di sudut peta.
    waterMesh = GL.mesh.apply(GL, meshArgs(M.box(1600, 1, 1600), [0.05, 0.22, 0.45]));
    personMesh = GL.mesh.apply(GL, meshArgs(M.person(), [0.9, 0.75, 0.55]));
    boatMesh = GL.mesh.apply(GL, meshArgs(M.boat(), [0.95, 0.95, 0.95]));
    bMeshes = [];
    var bs = (SB.City && SB.City.buildings) || [];
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      var m = M.building(b.w, b.h, b.d, i + 1);
      bMeshes.push({ mesh: GL.mesh(m.pos, m.col), b: b });
    }
  }

  // mesh() GL menerima (positions, colors); helper agar box polos bisa diwarnai.
  function meshArgs(mesh, rgb) {
    if (mesh.col) return [mesh.pos, mesh.col];
    var n = mesh.pos.length / 3, col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
    }
    return [mesh.pos, col];
  }

  function carMesh(color) {
    var key = color || 'default';
    if (carMeshes[key]) return carMeshes[key];
    var M = SB.Meshes, GL = SB.GL;
    var m = M.car(color || '#C0392B');
    var mesh = GL.mesh(m.pos, m.col);
    carMeshes[key] = mesh;
    return mesh;
  }

  function drawWorld() {
    var GL = SB.GL, M3 = SB.Math3, G = SB.G;
    if (!GL || !M3) return;
    var sky = skyColor(G.clock);
    GL.clear(sky[0], sky[1], sky[2]);
    GL.setFog(60, 420);
    // Kamera
    var p = G.player, f = fwd(p.yaw);
    var mode = (SB.Shots && SB.Shots.cam && SB.Shots.cam.mode) || 'chase';
    var eye, center;
    if (!started || mode === 'orbit') {
      orbitT += 0.016;
      var a = orbitT * 0.07;
      eye = [Math.cos(a) * 190, 75, Math.sin(a) * 190];
      center = [0, 15, 0];
    } else if (mode === 'high') {
      eye = [p.x, 130, p.z + 50];
      center = [p.x, 0, p.z];
    } else if (mode === 'follow' || !p.inCar) {
      eye = [p.x - f[0] * 6.5, 3.2, p.z - f[2] * 6.5];
      center = [p.x + f[0] * 6, 1.4, p.z + f[2] * 6];
    } else {
      eye = [p.x - f[0] * 11, 4.6, p.z - f[2] * 11];
      center = [p.x + f[0] * 10, 1.2, p.z + f[2] * 10];
    }
    GL.setCamera(eye, center);
    // Tanah (kotak y 0..1 → alas -1 supaya permukaan pas y=0) + laut besar
    // (y 0..1 → alas -1.2 supaya permukaan -0.2, di bawah daratan).
    if (groundMesh) GL.draw(groundMesh, M3.mat4Translate(0, -1, 0));
    if (waterMesh) GL.draw(waterMesh, M3.mat4Translate(0, -1.2, 0));
    // Bangunan (mesh beralas y=0 — tanpa offset h/2, kalau tidak melayang).
    for (var i = 0; i < bMeshes.length; i++) {
      var bm = bMeshes[i];
      GL.draw(bm.mesh, M3.mat4Translate(bm.b.x, 0, bm.b.z));
    }
    // Mobil AI + parkir (mesh mobil beralas y~0 — tanpa offset 0.6).
    var cars = (SB.Vehicles && SB.Vehicles.cars) || [];
    for (var c = 0; c < cars.length; c++) {
      var car = cars[c];
      var m = M3.mat4Mul(
        M3.mat4Translate(car.x, 0, car.z),
        M3.mat4RotateY(car.yaw || 0));
      GL.draw(carMesh(car.color), m);
    }
    // Speedboat (lambung mulai y=0.1; alas -0.25 menaruhnya pas di air -0.2).
    if (SB.Water && SB.Water.boat && boatMesh) {
      var bt = SB.Water.boat;
      GL.draw(boatMesh, M3.mat4Mul(
        M3.mat4Translate(bt.x, -0.25, bt.z),
        M3.mat4RotateY(bt.yaw || 0)));
    }
    // Pemain (jalan kaki — mesh person beralas y=0, tanpa offset 0.95).
    if (!p.inCar && !p.inBoat && personMesh) {
      GL.draw(personMesh, M3.mat4Mul(
        M3.mat4Translate(p.x, 0, p.z),
        M3.mat4RotateY(p.yaw || 0)));
    }
    // Polisi (jalan kaki)
    var pol = G.police || [];
    for (var q = 0; q < pol.length; q++) {
      if (!personMesh) break;
      GL.draw(personMesh, M3.mat4Translate(pol[q].x, 0, pol[q].z));
    }
  }

  function pressE() {
    var G = SB.G;
    if (G.player.inCar) {
      if (SB.Vehicles.exitCar) SB.Vehicles.exitCar();
      return;
    }
    // Turun dari kapal: flag-nya player.inBoat (Water memakai itu);
    // G.inBoat (top-level) tidak pernah di-set, jadi cek lama ini mati.
    if (G.player.inBoat) {
      if (SB.Water.leaveBoat) SB.Water.leaveBoat();
      return;
    }
    // Naik boat di dekat dermaga
    if (SB.Water && SB.Water.boat) {
      var b = SB.Water.boat;
      var d = Math.hypot(b.x - G.player.x, b.z - G.player.z);
      if (d < 7 && SB.Water.boardBoat) { SB.Water.boardBoat(); return; }
    }
    // Curi / naik mobil terdekat. stealNearest() SUDAH memanggil enterCar
    // sendiri — jangan panggil enterCar kedua kali untuk mobil yang sama.
    var car = null, stolen = false;
    if (SB.Vehicles.stealNearest) {
      car = SB.Vehicles.stealNearest();
      if (car) stolen = true;
    }
    if (!car && SB.Vehicles.nearestParked) {
      car = SB.Vehicles.nearestParked(G.player.x, G.player.z);
      if (car && SB.Vehicles.enterCar) SB.Vehicles.enterCar(car);
    }
    if (car) {
      if (stolen && SB.Game && SB.Game.wantedUp) SB.Game.wantedUp(1);
      if (SB.HUD) SB.HUD.showMessage(stolen ?
        'Mobil dicuri — wanted +1' : 'Masuk mobil');
      if (SB.Audio) SB.Audio.sfx('engine');
    }
  }

  function pressF() {
    var G = SB.G;
    // Respray di garage: bersihkan wanted, biaya $150 (dicek Game).
    if (SB.Game && SB.Game.atGarage && SB.Game.atGarage() &&
        SB.Game.respray && SB.Game.respray()) return;
    if (SB.Game && SB.Game.shoot) SB.Game.shoot();
    else if (SB.Game && SB.Game.punch) SB.Game.punch();
  }

  function bindInput() {
    window.addEventListener('keydown', function (e) {
      SB.Audio.init();
      if (e.code === 'Tab') {
        e.preventDefault();
        if (SB.HUD) SB.HUD.toggleMap();
        return;
      }
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) { keys[e.code] = true; syncInput(); return; }
      keys[e.code] = true;
      syncInput();
      if (e.code === 'KeyE') pressE();
      else if (e.code === 'KeyF') pressF();
      else if (e.code === 'KeyM') {
        if (SB.Audio) SB.Audio.nextStation();
      } else if (e.code === 'KeyP') {
        if (SB.HUD) SB.HUD.togglePause();
      }
    });
    window.addEventListener('keyup', function (e) {
      keys[e.code] = false;
      syncInput();
    });
    window.addEventListener('mousedown', function () {
      SB.Audio.init();
      if (!started) return;
      if (SB.Game && SB.Game.shoot) SB.Game.shoot();
    });
    window.addEventListener('resize', fitCanvas);
  }

  function syncInput() {
    var G = SB.G;
    // Bentuk input HARUS cocok dengan alias yang dibaca SB.Player.update
    // (up/w/forward, down/s/back, left/a/turnLeft, right/d/turnRight,
    // run/shift). Bentuk lama {f,b,l,r,run,drift} tidak dikenali Player
    // sehingga pemain sama sekali tidak bisa jalan.
    var f = !!(keys.KeyW || keys.ArrowUp);
    var b = !!(keys.KeyS || keys.ArrowDown);
    var l = !!(keys.KeyA || keys.ArrowLeft);
    var r = !!(keys.KeyD || keys.ArrowRight);
    var run = !!(keys.ShiftLeft || keys.ShiftRight);
    G.input = {
      up: f, w: f, forward: f,
      down: b, s: b, back: b,
      left: l, a: l, turnLeft: l,
      right: r, d: r, turnRight: r,
      run: run, shift: run,
      drift: !!keys.Space
    };
  }

  function fitCanvas() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function tick(t) {
    requestAnimationFrame(tick);
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    var G = SB.G;
    if (started && !G.paused) {
      // Jam hanya dimajukan Game.update (1 jam / 50 detik) — dulu tick juga
      // memajukan jam sehingga clock berlari ~6x lebih cepat.
      if (SB.Game && SB.Game.update) SB.Game.update(dt);
      if (SB.Player && SB.Player.update) SB.Player.update(dt, G.input);
      if (SB.Vehicles && SB.Vehicles.update) SB.Vehicles.update(dt);
      if (SB.Water && SB.Water.update) SB.Water.update(dt);
      if (SB.Jobs && SB.Jobs.update) SB.Jobs.update(dt);
    }
    if (SB.HUD) SB.HUD.update();
    drawWorld();
    if (SB.HUD) SB.HUD.draw();
  }

  SB.Main = {
    start: function () {
      if (booted) return;
      booted = true;
      canvas = $('game');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'game';
        canvas.style.cssText =
          'position:fixed;inset:0;width:100vw;height:100vh;display:block;';
        document.body.appendChild(canvas);
      }
      fitCanvas();
      if (SB.GL) SB.GL.init(canvas);
      if (SB.City) SB.City.build(7); // seed 7 deterministik
      if (SB.Water && SB.Water.init) SB.Water.init();
      if (SB.Vehicles && SB.Vehicles.spawnTraffic) SB.Vehicles.spawnTraffic();
      cacheMeshes();
      buildTitle();
      bindInput();
      // Staging screenshot ?shot=<name>
      var shot = null;
      try { shot = new URLSearchParams(window.location.search).get('shot'); } catch (e) {}
      if (shot) {
        if (shot === 'start') {
          showTitle();
          if (SB.Shots) SB.Shots.stage('start');
        } else {
          if (SB.Game) SB.Game.start();
          hideTitle();
          if (SB.Shots) SB.Shots.stage(shot);
        }
      }
      lastT = performance.now();
      requestAnimationFrame(tick);
    }
  };

  // Auto-start saat DOM siap (index.html boleh juga memanggil SB.Main.start()).
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', SB.Main.start);
  else
    SB.Main.start();
})();

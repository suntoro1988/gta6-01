// Sunset Bay — Main bootstrap (v8, written fresh from SPEC-v8)
// window.SB.Main: { start }
// Bootstrap: init GL, City.build(7), spawn traffic, title screen,
// requestAnimationFrame loop (tick + render), keyboard input.
// IMPORTANT: SB.Water.draw() is called every render frame (v7 missed it).
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var canvas = null;
  var keys = {};
  var running = false;
  var lastT = 0;
  var buildingMeshes = [];
  var carMeshCache = {};
  var personMesh = null;
  var boatMesh = null;
  var treeMesh = null;
  var shotName = null;

  function $(id) { return document.getElementById(id); }

  function getParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search || '');
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ---------- garage / shop ----------
  function openGarage() {
    var ov = $('garage');
    if (!ov) return;
    ov.style.display = 'flex';
    refreshGarage();
    if (SB.Audio) SB.Audio.sfx('click');
  }
  function closeGarage() {
    var ov = $('garage');
    if (ov) ov.style.display = 'none';
  }
  function refreshGarage() {
    var g = SB.G;
    var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
    set('garage-money', 'Money: $' + Math.floor(g.money || 0));
    set('garage-wanted', 'Wanted: ' + (g.wanted || 0) + ' stars');
    var ammo = (g.ammo && typeof g.ammo === 'object' && g.ammo.pistol != null)
      ? g.ammo.pistol : (typeof g.ammo === 'number' ? g.ammo : 0);
    set('garage-ammo', 'Pistol ammo: ' + ammo);
  }
  function buyAmmo() {
    if (SB.Game && SB.Game.buyAmmo) SB.Game.buyAmmo();
    else if (SB.G && SB.G.money >= 50) {
      SB.G.money -= 50;
      if (SB.G.ammo && typeof SB.G.ammo === 'object') SB.G.ammo.pistol = (SB.G.ammo.pistol || 0) + 24;
      else SB.G.ammo = { pistol: 24 };
    }
    refreshGarage();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Ammo +24'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }
  function respray() {
    var g = SB.G;
    if (SB.Game && SB.Game.respray) { SB.Game.respray(); }
    else if (g && g.money >= 150) { g.money -= 150; g.wanted = 0; }
    else { if (SB.HUD) SB.HUD.showMessage('Need $150 for respray'); return; }
    refreshGarage();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Respray done — wanted cleared'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }
  function buyEngine() {
    var g = SB.G;
    if (!g) return;
    if (SB.Game && SB.Game.buyEngine) { SB.Game.buyEngine(); }
    else if (g.money >= 400) { g.money -= 400; g.engineLevel = (g.engineLevel || 0) + 1; }
    else { if (SB.HUD) SB.HUD.showMessage('Engine upgrade needs $400'); return; }
    refreshGarage();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Engine upgraded'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }
  function buyArmour() {
    var g = SB.G;
    if (!g) return;
    if (SB.Game && SB.Game.buyArmour) { SB.Game.buyArmour(); }
    else if (g.money >= 300) { g.money -= 300; g.armour = (g.armour || 0) + 50; }
    else { if (SB.HUD) SB.HUD.showMessage('Armour needs $300'); return; }
    refreshGarage();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.showMessage('Armour installed'); }
    if (SB.Audio) SB.Audio.sfx('pickup');
  }

  // ---------- input ----------
  function onKeyDown(e) {
    if (e.key === 'Tab') { e.preventDefault(); if (SB.HUD) SB.HUD.toggleMap(); return; }
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') e.preventDefault();
    if (e.repeat) return;
    var k = e.key.toLowerCase();
    if (k === 'p') { if (SB.HUD) SB.HUD.togglePause(); return; }
    if (k === 'm') { if (SB.Audio) SB.Audio.nextStation(); return; }
    if (k === 'g') { openGarage(); return; }
    if (k === 'escape') { closeGarage(); return; }
    if (k === 'e') { doInteract(); return; }
    if (k === 'f') { doFireOrRespray(); return; }
  }
  function onKeyUp(e) { keys[e.key.toLowerCase()] = false; }

  function doInteract() {
    var g = SB.G;
    if (!g || !g.player) return;
    // Near marina/pier: board / leave boat. Boarding gate: area dermaga
    // (x < -160, dekat z=120); Water.boardBoat sendiri mengecek jarak < 7
    // ke kapal/ujung dermaga. Status naik kapal ada di player.inBoat.
    if (SB.Water && SB.Water.boardBoat && g.player.x < -160 && Math.abs(g.player.z - 120) < 20) {
      if (g.player.inBoat) { SB.Water.leaveBoat(); return; }
      if (SB.Water.boardBoat()) return;
    }
    if (g.player.inCar) {
      if (SB.Vehicles) SB.Vehicles.exitCar();
      g.player.inCar = false; g.player.car = null;
      return;
    }
    // stealNearest SUDAH enterCar + wantedUp(1) sendiri: jangan dobel.
    var car = null;
    if (SB.Vehicles) {
      car = SB.Vehicles.stealNearest ? SB.Vehicles.stealNearest() : null;
      if (car) return; // sudah di dalam mobil, wanted sudah +1
      if (SB.Vehicles.nearestParked) car = SB.Vehicles.nearestParked(g.player.x, g.player.z);
    }
    if (car && Math.hypot(car.x - g.player.x, car.z - g.player.z) <= 6) {
      if (SB.Vehicles && SB.Vehicles.enterCar) SB.Vehicles.enterCar(car);
      else { g.player.inCar = true; g.player.car = car; }
      if (SB.Game && SB.Game.wantedUp) SB.Game.wantedUp(1);
      else g.wanted = Math.min(5, (g.wanted || 0) + 1);
      if (SB.HUD) SB.HUD.showMessage('Car stolen! Wanted +1');
      if (SB.Audio) SB.Audio.sfx('pickup');
    }
  }

  function doFireOrRespray() {
    var g = SB.G;
    if (!g || !g.player) return;
    // near garage: respray clears wanted ($150)
    if (Math.abs(g.player.x - 120) < 25 && Math.abs(g.player.z + 80) < 25) { respray(); return; }
    // otherwise: fire pistol
    if (SB.Game && SB.Game.fire) SB.Game.fire();
    else {
      if (SB.Audio) SB.Audio.sfx('shoot');
      if (SB.HUD) SB.HUD.showMessage('Bang!');
    }
  }

  function inputState() {
    // Player.update memakai forward/back; Vehicles/Water memakai listener
    // e.code mereka sendiri. Kembalikan kedua nama agar jalan kaki jalan.
    return {
      forward: !!(keys['w'] || keys['arrowup']),
      back: !!(keys['s'] || keys['arrowdown']),
      left: !!(keys['a'] || keys['arrowleft']),
      right: !!(keys['d'] || keys['arrowright']),
      up: !!(keys['w'] || keys['arrowup']),
      down: !!(keys['s'] || keys['arrowdown']),
      run: !!keys['shift'],
      drift: !!keys[' ']
    };
  }

  // ---------- render ----------
  function skyColor(clock) {
    // day 6-18 bright, dusk 18-20 orange, night dark blue
    var h = clock % 24;
    if (h >= 6 && h < 17) return [0.53, 0.81, 0.92];
    if (h >= 17 && h < 19.5) return [0.98, 0.62, 0.35];
    if (h >= 19.5 && h < 21) return [0.35, 0.25, 0.45];
    return [0.05, 0.08, 0.18];
  }

  var groundMesh = null;
  var seaMesh = null;

  function buildWorldMeshes() {
    buildingMeshes = [];
    var list = (SB.City && SB.City.buildings) || [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      // Meshes.building mengembalikan {pos,col} mentah; GL.draw butuh buffer
      // WebGL dari GL.mesh — bungkus sekali di init, bukan per frame.
      var raw = SB.Meshes.building(b.w, b.h, b.d, i * 7 + 3);
      buildingMeshes.push({ mesh: SB.GL.mesh(raw.pos, raw.col), x: b.x, z: b.z });
    }
    var pm = SB.Meshes.person();
    personMesh = SB.GL.mesh(pm.pos, pm.col);
    var bm = SB.Meshes.boat();
    boatMesh = SB.GL.mesh(bm.pos, bm.col);
    var tm = SB.Meshes.tree();
    treeMesh = SB.GL.mesh(tm.pos, tm.col);
    var gm = SB.Meshes.box(560, 0.5, 560);
    groundMesh = SB.GL.mesh(gm.pos, gm.col);
    var sm = SB.Meshes.box(120, 0.4, 560);
    seaMesh = SB.GL.mesh(sm.pos, sm.col);
  }

  function carMesh(color) {
    var key = Array.isArray(color) ? color.join(',') : String(color || 'red');
    if (!carMeshCache[key]) {
      var raw = SB.Meshes.car(Array.isArray(color) ? color : [0.8, 0.2, 0.2]);
      carMeshCache[key] = SB.GL.mesh(raw.pos, raw.col);
    }
    return carMeshCache[key];
  }

  function drawWorld() {
    var GL = SB.GL, M = SB.Math3;
    if (!GL || !GL.alive()) return;
    var g = SB.G;
    var sky = skyColor(g.clock == null ? 18 : g.clock);
    GL.clear(sky[0], sky[1], sky[2]);
    GL.setFog(60, 320);

    var p = g.player || { x: 0, z: 0, yaw: 0 };
    var back = 12, up = 5;
    var eye = [p.x - Math.sin(p.yaw) * back, up, p.z - Math.cos(p.yaw) * back];
    var center = [p.x + Math.sin(p.yaw) * 6, 1.5, p.z + Math.cos(p.yaw) * 6];
    GL.setCamera(eye, center);

    // ground plane (flat dark slab under the city)
    if (groundMesh) GL.draw(groundMesh, M.mat4Translate(0, -0.3, 0));
    // sea slab west + south
    if (seaMesh) GL.draw(seaMesh, M.mat4Translate(-300, -0.2, 0));

    // buildings
    for (var i = 0; i < buildingMeshes.length; i++) {
      var bm = buildingMeshes[i];
      GL.draw(bm.mesh, M.mat4Translate(bm.x, 0, bm.z));
    }
    // trees along streets
    if (treeMesh) {
      for (var t = 0; t < 40; t++) {
        var tx = -240 + (t % 8) * 68, tz = -240 + Math.floor(t / 8) * 96;
        GL.draw(treeMesh, M.mat4Translate(tx, 0, tz));
      }
    }
    // traffic + parked cars
    if (SB.Vehicles && SB.Vehicles.cars) {
      for (var c = 0; c < SB.Vehicles.cars.length; c++) {
        var car = SB.Vehicles.cars[c];
        if (g.player.inCar && g.player.car === car) continue; // drawn as player car below
        var m = M.mat4Mul(M.mat4Translate(car.x, 0, car.z), M.mat4RotateY(car.yaw || 0));
        GL.draw(carMesh(car.color), m);
      }
    }
    // player car
    if (g.player.inCar && g.player.car) {
      var pc = g.player.car;
      var pm = M.mat4Mul(M.mat4Translate(p.x, 0, p.z), M.mat4RotateY(p.yaw));
      GL.draw(carMesh(pc.color), pm);
    } else if (personMesh) {
      // player on foot
      var qm = M.mat4Mul(M.mat4Translate(p.x, 0, p.z), M.mat4RotateY(p.yaw));
      GL.draw(personMesh, qm);
    }
    // police
    if (g.police) {
      for (var j = 0; j < g.police.length; j++) {
        var po = g.police[j];
        var pom = M.mat4Mul(M.mat4Translate(po.x, 0, po.z), M.mat4RotateY(po.yaw || 0));
        GL.draw(carMesh([0.1, 0.15, 0.5]), pom);
      }
    }
    // heli
    if (g.heli && personMesh) {
      var hm = M.mat4Translate(g.heli.x, g.heli.y || 40, g.heli.z);
      GL.draw(personMesh, hm);
    }
    // boat on the water
    if (boatMesh && SB.Water && SB.Water.boat) {
      var b = SB.Water.boat;
      var bm2 = M.mat4Mul(M.mat4Translate(b.x, 0.4, b.z), M.mat4RotateY(b.yaw || 0));
      GL.draw(boatMesh, bm2);
    }
    // marina pier — MUST be drawn every frame (v7 missed this call)
    if (SB.Water && SB.Water.draw) SB.Water.draw();
  }

  // ---------- loop ----------
  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    var g = SB.G;
    var paused = SB.HUD ? SB.HUD.isPaused() : false;
    if (!paused && g) {
      // Jam maju di Game.update saja (dt*0.02 ≈ 1 jam game / 50 dtk nyata);
      // jangan dobel di sini.
      if (SB.Player) SB.Player.update(dt, inputState());
      if (SB.Vehicles) SB.Vehicles.update(dt);
      if (SB.Water) SB.Water.update(dt);
      if (SB.Jobs) SB.Jobs.update(dt);
      if (SB.Game) SB.Game.update(dt);
    }
    drawWorld();
    if (SB.HUD) { SB.HUD.update(); SB.HUD.draw(); }
  }

  // ---------- title screen ----------
  function wireTitle() {
    var bn = $('btn-new');
    if (bn) bn.addEventListener('click', function () {
      if (SB.Audio) SB.Audio.init();
      startGame(false);
    });
    var bc = $('btn-continue');
    if (bc) bc.addEventListener('click', function () {
      if (SB.Audio) SB.Audio.init();
      startGame(true);
    });
    // Continue hidden when there is no save
    var save = null;
    try { save = localStorage.getItem('sunset-bay-save-v1'); } catch (e) { save = null; }
    if (bc) bc.style.display = save ? 'block' : 'none';
  }

  function startGame(fromSave) {
    var title = $('title');
    if (title) title.style.display = 'none';
    var hud = $('hud');
    if (hud) hud.style.display = 'block';
    if (fromSave && SB.Game && SB.Game.load) SB.Game.load();
    else if (SB.Game && SB.Game.start) SB.Game.start();
    if (SB.HUD) SB.HUD.showMessage(fromSave ? 'Welcome back to Sunset Bay' : 'Welcome to Sunset Bay');
    if (!running) {
      running = true;
      lastT = performance.now();
      requestAnimationFrame(loop);
    }
  }

  var Main = {
    start: function () {
      canvas = $('game');
      if (!canvas) return;
      // size canvas to window
      var resize = function () {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      window.addEventListener('resize', resize);
      resize();

      if (SB.GL) SB.GL.init(canvas);
      if (SB.City) SB.City.build(7); // deterministic seed 7
      buildWorldMeshes();
      if (SB.Vehicles) SB.Vehicles.spawnTraffic();
      if (SB.Water) SB.Water.init();
      if (SB.Game) SB.Game.start();

      window.__SB = SB; // QA hook

      // wire garage buttons
      var bind = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); };
      bind('btn-ammo', buyAmmo);
      bind('btn-respray', respray);
      bind('btn-engine', buyEngine);
      bind('btn-armour', buyArmour);
      bind('btn-garage-close', closeGarage);

      // audio unlock on first interaction
      document.addEventListener('pointerdown', function () { if (SB.Audio) SB.Audio.init(); }, { once: true });
      document.addEventListener('keydown', function () { if (SB.Audio) SB.Audio.init(); }, { once: true });

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      canvas.addEventListener('click', function () {
        if (SB.Audio) SB.Audio.init();
        doFireOrRespray();
      });

      wireTitle();

      // screenshot staging
      shotName = getParam('shot');
      if (shotName) {
        startGame(false);
        if (SB.Shots) SB.Shots.stage(shotName);
      } else {
        // title screen idle: keep rendering the city behind it
        if (!running) {
          running = true;
          lastT = performance.now();
          requestAnimationFrame(loop);
        }
      }
    }
  };

  SB.Main = Main;
  document.addEventListener('DOMContentLoaded', function () { Main.start(); });
})();

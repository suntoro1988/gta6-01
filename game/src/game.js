window.SB = window.SB || {};
// game.js — Sunset Bay v12 (Builder B: graphics engine)
// ORCHESTRATOR. Satu-satunya file yang tahu urutan modul.
//   - Membuat SB.state (bentuk PERSIS sesuai design spec)
//   - init() semua modul sesuai urutan load
//   - frame(dt): update semua modul, lalu draw semua modul
//   - save()/load() localStorage key 'sunset-bay-save-v12'
//   - pause()/resume(), kamera third-person, siklus siang-malam
//
// Aturan keras: modul dipanggil HANYA lewat API spec, dengan guard
// `if (SB.X && SB.X.update)` — bila builder lain belum menulis
// modulnya, game tetap jalan tanpa modul itu. TIDAK ADA adapter.
(function () {
  'use strict';

  var M3 = null;
  var GL = null;
  var SAVE_KEY = 'sunset-bay-save-v12';
  var SAVE_VERSION = 12;

  // ------------------------------------------------------------------
  // State bersama — BENTUK PERSIS SESUAI DESIGN SPEC
  // ------------------------------------------------------------------
  function freshState() {
    return {
      time: 0,               // detik sejak game mulai
      timeOfDay: 18.33,      // jam (18:20 = golden hour default)
      day: 1,
      money: 500, rep: 0, respect: 0, respectRank: 'Rookie',
      wanted: 0,             // 0-5 bintang
      heat: 0,               // 0-100 indikator Heat
      player: { x: 0, y: 0, z: 0, angle: 0, onFoot: true, vehicle: null, hp: 100, armor: 0 },
      camera: { eye: { x: 0, y: 8, z: 12 }, look: { x: 0, y: 1, z: 0 } },
      weather: { rain: 0, rainArea: null, clouds: 0.3, wind: 0.2, puddles: 0 },
      mission: { id: null, stage: 0, text: '', reward: 0 },
      crew: [],              // anggota crew aktif
      districtRep: {},       // reputasi per distrik (nama distrik -> 0-100)
      businesses: [],        // bisnis yang dimiliki
      race: null,            // balapan aktif
      radio: 0,              // stasiun radio aktif 0-5
      ammo: 24, weapon: 0,   // 0=pistol 1=smg 2=shotgun 3=rifle
      stats: { kills: 0, carsStolen: 0, drifts: 0, racesWon: 0, missionsDone: 0 },
      flags: {}              // flag boolean bebas
    };
  }

  var state = freshState();

  // ------------------------------------------------------------------
  // State internal game.js (bukan bagian save)
  // ------------------------------------------------------------------
  var canvas = null;
  var paused = true;            // mulai paused sampai START ditekan
  var started = false;          // true setelah tombol START/CONTINUE
  var attractMode = true;       // kamera sinematik di belakang overlay
  var attractAngle = 0;
  var actionQueue = [];         // aksi sekali tekan dari main.js
  var camMode = 0;              // 0=dekat 1=medium 2=jauh (tombol C)
  var camYaw = 0;               // yaw kamera (drag mouse)
  var camPitch = 0.32;
  var camDist = 9;
  var camTarget = { x: 0, y: 1.5, z: 0 };
  var mapOpen = false;
  var missionPanelOpen = false;
  var lastAutosave = 0;
  var frameCount = 0;
  var missionIntroShown = false;
  var introTimer = 0;
  var dayLengthSec = 600;       // 1 hari game = 10 menit nyata
  var timeScale = 24 / dayLengthSec; // jam game per detik nyata

  // Kamera sinematik attract mode: titik-titik panorama kota.
  var ATTRACT_POINTS = [
    { x: 0, y: 26, z: 120, lx: 0, ly: 6, lz: 0 },
    { x: -90, y: 20, z: 60, lx: 0, ly: 8, lz: -20 },
    { x: 80, y: 14, z: -40, lx: -20, ly: 4, lz: 30 },
    { x: 10, y: 34, z: -110, lx: 0, ly: 2, lz: 40 }
  ];
  var attractIdx = 0;
  var attractBlend = 0;

  // ------------------------------------------------------------------
  // init(canvas)
  // ------------------------------------------------------------------
  function init(c) {
    M3 = window.SB.Math3;
    GL = window.SB.GL;
    canvas = c;
    state = freshState();
    window.SB.state = state;

    // Distrik default: reputasi 0 di semua distrik yang dikenal City.
    // Diisi ulang setelah City.init (guard: modul boleh belum ada).
    seedDistrictRep();

    // Init semua modul sesuai URUTAN LOAD di spec.
    // Setiap init dipanggil dengan guard — modul yang belum ditulis
    // builder lain dilewati tanpa error.
    callInit('City');
    callInit('Water');
    callInit('Vehicles');
    callInit('Player');
    callInit('NPC');
    callInit('Police');
    callInit('Crew');
    callInit('Economy');
    callInit('Races');
    callInit('Weather');
    callInit('FX');
    callInit('Audio');
    callInit('HUD');
    callInit('Jobs');

    // Shots tidak punya init(state) di spec — hanya take(name).
    // HUD butuh DOM siap: init HUD terakhir sebelum frame pertama.
    if (window.SB.HUD && window.SB.HUD.init) {
      try { window.SB.HUD.init(state); } catch (e) { logModErr('HUD', e); }
    }

    // Misi pertama aktif sejak awal (hadiah +$200 & REP+100).
    // ID harus sama dengan MISSIONS di jobs.js ('courier-first-light').
    state.mission = {
      id: 'courier-first-light',
      stage: 0,
      text: 'First Light Courier — Pick up the package at the diner.',
      reward: 200
    };
    if (window.SB.Jobs && window.SB.Jobs.startMission) {
      try { window.SB.Jobs.startMission('courier-first-light'); } catch (e) { logModErr('Jobs', e); }
    }

    // Kamera awal: di belakang pemain, menghadap kota saat sunset.
    state.player.x = 0;
    state.player.z = 24;
    state.player.angle = Math.PI; // menghadap -Z? lihat Player: 0 = -Z
    updateCamera(0.016, true);

    paused = true;
    attractMode = true;
    started = false;
    window.SB.started = false;

    // Waktu: matahari golden hour dari jam 18.33.
    if (GL && GL.setTimeOfDay) GL.setTimeOfDay(state.timeOfDay);

    if (typeof console !== 'undefined' && console.info) {
      console.info('[SB.Game] init selesai — Sunset Bay v12 siap.');
    }
  }

  function callInit(name) {
    var mod = window.SB[name];
    if (mod && typeof mod.init === 'function') {
      try { mod.init(state); } catch (e) { logModErr(name, e); }
    }
  }

  function logModErr(name, e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[SB.Game] modul ' + name + ' error: ' +
        (e && e.message ? e.message : e));
    }
  }

  function seedDistrictRep() {
    var names = [];
    if (window.SB.City && Array.isArray(window.SB.City.districts)) {
      names = window.SB.City.districts;
    } else {
      names = ['Ocean Drive', 'Downtown', 'Harbour', 'Little Havana',
        'Star Island', 'Vice Port', 'Bayshore', 'Coral Heights',
        'Neon Mile', 'Palm Court', 'Fishermans Wharf', 'Sunset Strip'];
    }
    for (var i = 0; i < names.length; i++) {
      if (state.districtRep[names[i]] === undefined) state.districtRep[names[i]] = 0;
    }
  }

  // ------------------------------------------------------------------
  // frame(dt) — dipanggil main.js tiap requestAnimationFrame
  // ------------------------------------------------------------------
  function frame(dt) {
    frameCount++;
    if (!M3 || !GL) return;

    // --- Waktu game selalu berjalan (kecuali pause penuh) ---
    if (!paused) {
      state.time += dt;
      advanceClock(dt);
    } else if (attractMode) {
      // Attract mode: waktu tetap berjalan pelan untuk langit hidup.
      state.time += dt * 0.5;
      advanceClock(dt * 0.25);
    }

    // --- Aksi sekali tekan dari main.js ---
    drainActions();

    // --- Update modul (URUTAN SPEC) ---
    if (!paused) {
      updateModules(dt);
    } else if (attractMode) {
      // Di balik overlay start, dunia tetap hidup secukupnya.
      callUpdate('Weather', dt);
      callUpdate('Water', dt);
      callUpdate('City', dt);
      callUpdate('NPC', dt);
      callUpdate('FX', dt);
    }

    // --- Kamera ---
    if (attractMode) {
      updateAttractCamera(dt);
    } else {
      updateCamera(dt, false);
    }

    // --- Render ---
    render();

    // --- HUD (DOM) — cukup tiap frame, HUD modul men-throttle sendiri ---
    if (!paused && window.SB.HUD && window.SB.HUD.update) {
      try { window.SB.HUD.update(state); } catch (e) { logModErr('HUD', e); }
    }

    // --- Autosave tiap 60 detik saat bermain ---
    if (!paused && state.time - lastAutosave > 60) {
      lastAutosave = state.time;
      save(true);
    }

    // --- Intro misi pertama (sekali) ---
    if (started && !missionIntroShown) {
      introTimer += dt;
      if (introTimer > 1.2) {
        missionIntroShown = true;
        toast('Mission: First Light Courier — pick up the package at the diner.', 'gold');
      }
    }
  }

  // Jam game maju; ganti hari saat melewati 24.00.
  function advanceClock(dt) {
    state.timeOfDay += dt * timeScale;
    if (state.timeOfDay >= 24) {
      state.timeOfDay -= 24;
      state.day += 1;
      onNewDay();
    }
    if (GL && GL.setTimeOfDay) GL.setTimeOfDay(state.timeOfDay);
  }

  function onNewDay() {
    // Pemasukan pasif bisnis masuk tiap pagi (modul Economy yang hitung).
    if (window.SB.Economy && window.SB.Economy.collectIncome) {
      try {
        var inc = window.SB.Economy.collectIncome();
        if (inc > 0) toast('Business income: +$' + inc + ' (Day ' + state.day + ')', 'green');
      } catch (e) { logModErr('Economy', e); }
    }
    // Heat mendingin semalam.
    state.heat = Math.max(0, state.heat - 25);
    if (state.wanted > 0 && state.heat < 10) {
      state.wanted = 0;
      if (window.SB.Police && window.SB.Police.setWanted) {
        try { window.SB.Police.setWanted(0); } catch (e) { logModErr('Police', e); }
      }
    }
    toast('Day ' + state.day + ' — a new day in Sunset Bay.', '');
  }

  // Urutan update PERSIS spec:
  // Weather, City, Water, Vehicles, Player, NPC, Police, Crew,
  // Economy, Races, FX, Jobs, Audio, HUD.
  function updateModules(dt) {
    callUpdate('Weather', dt);
    callUpdate('City', dt);
    callUpdate('Water', dt);
    callUpdate('Vehicles', dt);
    // Player butuh input: teruskan SB.input.
    var P = window.SB.Player;
    if (P && typeof P.update === 'function') {
      try { P.update(dt, state, window.SB.input || null); } catch (e) { logModErr('Player', e); }
    }
    callUpdate('NPC', dt);
    callUpdate('Police', dt);
    callUpdate('Crew', dt);
    callUpdate('Economy', dt);
    callUpdate('Races', dt);
    callUpdate('FX', dt);
    callUpdate('Jobs', dt);
    // Audio.update tidak ada di API spec (hanya setStation/sfx/
    // toggleMute) — panggil bila modul menyediakannya, dengan guard.
    callUpdate('Audio', dt);

    // Sinkronisasi wanted/heat dua arah dengan modul Police.
    syncWanted();
    // Kamera mengikuti kendaraan / pemain sudah di updateCamera.
    // Hujan lokal memengaruhi genangan (Weather yang mengatur).
    clampState();
    // Sistem game.js sendiri: objektif, busted, event hari, performa.
    updateObjective(dt);
    updateBusted(dt);
    updateDayEvents(dt);
    updatePerformance(dt);
  }

  function callUpdate(name, dt) {
    var mod = window.SB[name];
    if (mod && typeof mod.update === 'function') {
      try { mod.update(dt, state); } catch (e) { logModErr(name, e); }
    }
  }

  function callDraw(name) {
    var mod = window.SB[name];
    if (mod && typeof mod.draw === 'function') {
      try { mod.draw(GL, state); } catch (e) { logModErr(name, e); }
    }
  }

  // Jaga state tetap dalam batas aman setiap frame.
  function clampState() {
    state.wanted = M3.clamp(Math.round(state.wanted), 0, 5);
    state.heat = M3.clamp(state.heat, 0, 100);
    state.money = Math.max(0, Math.floor(state.money));
    state.rep = Math.max(0, Math.floor(state.rep));
    state.player.hp = M3.clamp(state.player.hp, 0, 100);
    state.player.armor = M3.clamp(state.player.armor, 0, 100);
    state.ammo = Math.max(0, Math.floor(state.ammo));
    state.weapon = M3.clamp(state.weapon, 0, 3);
    state.radio = M3.clamp(state.radio, 0, 5);
    if (state.player.hp <= 0) onPlayerDown();
  }

  function syncWanted() {
    var Pol = window.SB.Police;
    if (Pol && typeof Pol.setWanted === 'function') {
      // Police adalah sumber kebenaran wanted saat kejar-kejaran aktif.
      if (Pol.wanted !== undefined && Pol.wanted !== state.wanted) {
        state.wanted = M3.clamp(Pol.wanted, 0, 5);
      }
    }
    // Heat naik saat wanted tinggi, turun pelan saat bersih.
    if (state.wanted > 0) {
      state.heat = M3.clamp(state.heat + state.wanted * 0.35, 0, 100);
    } else {
      state.heat = M3.clamp(state.heat - 0.9, 0, 100);
    }
  }

  function onPlayerDown() {
    if (state.flags._down) return;
    state.flags._down = true;
    state.player.hp = 100;
    state.wanted = 0;
    state.heat = 0;
    state.money = Math.max(0, state.money - 100);
    state.player.x = 0; state.player.z = 24;
    state.player.onFoot = true; state.player.vehicle = null;
    if (window.SB.Police && window.SB.Police.setWanted) {
      try { window.SB.Police.setWanted(0); } catch (e) { /* abaikan */ }
    }
    toast('WASTED — you woke up at the hospital. -$100.', 'red');
    setTimeout(function () { state.flags._down = false; }, 3000);
  }

  // ------------------------------------------------------------------
  // Kamera third-person
  // ------------------------------------------------------------------
  function updateCamera(dt, snap) {
    var p = state.player;
    var input = window.SB.input;

    // Drag mouse mengorbit kamera di sekitar pemain.
    if (input && input.mouse && input.mouse.moved && !attractMode) {
      camYaw -= input.mouse.dx * 0.0042;
      camPitch = M3.clamp(camPitch + input.mouse.dy * 0.003, 0.08, 1.15);
    }
    // Scroll mouse: zoom jarak kamera.
    if (input && input.wheel) {
      camDist = M3.clamp(camDist + input.wheel * 0.6, 5, 16);
    }
    // Jarak dasar per mode kamera (tombol C) + boost kejar-kejaran.
    var baseDist = effectiveCamDist();
    camDist = M3.lerp(camDist, baseDist, snap ? 1 : dt * 1.5);

    // Target kamera: pemain (atau kendaraan bila mengemudi).
    var tx = p.x, ty = 1.6, tz = p.z;
    if (!p.onFoot && p.vehicle) {
      tx = p.vehicle.x !== undefined ? p.vehicle.x : p.x;
      tz = p.vehicle.z !== undefined ? p.vehicle.z : p.z;
      ty = 2.0;
    }
    camTarget.x = M3.lerp(camTarget.x, tx, snap ? 1 : dt * 6);
    camTarget.y = M3.lerp(camTarget.y, ty, snap ? 1 : dt * 6);
    camTarget.z = M3.lerp(camTarget.z, tz, snap ? 1 : dt * 6);

    // Yaw kamera mengikuti arah pemain bila tidak sedang di-orbit.
    var followYaw = p.angle + Math.PI; // kamera di belakang pemain
    if (!input || !input.mouse || !input.mouse.down) {
      camYaw = M3.lerpAngle(camYaw, followYaw, snap ? 1 : dt * 1.8);
    }

    var eye = {
      x: camTarget.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      y: camTarget.y + Math.sin(camPitch) * camDist,
      z: camTarget.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist
    };
    // Sinkronkan yaw kamera ke SB.input agar Player bergerak relatif
    // kamera (kontrak input.camAngle di player.js). Arah pandang kamera
    // adalah kebalikan vektor eye->target, jadi +PI dari camYaw.
    if (window.SB.input) window.SB.input.camAngle = camYaw + Math.PI;
    // Jangan biarkan kamera masuk ke bawah tanah.
    if (eye.y < 1.2) eye.y = 1.2;
    var look = { x: camTarget.x, y: camTarget.y, z: camTarget.z };

    if (snap) {
      state.camera.eye = eye;
      state.camera.look = look;
    } else {
      state.camera.eye.x = M3.lerp(state.camera.eye.x, eye.x, dt * 8);
      state.camera.eye.y = M3.lerp(state.camera.eye.y, eye.y, dt * 8);
      state.camera.eye.z = M3.lerp(state.camera.eye.z, eye.z, dt * 8);
      state.camera.look.x = M3.lerp(state.camera.look.x, look.x, dt * 10);
      state.camera.look.y = M3.lerp(state.camera.look.y, look.y, dt * 10);
      state.camera.look.z = M3.lerp(state.camera.look.z, look.z, dt * 10);
    }
  }

  // Kamera sinematik attract mode: melayang antar panorama kota.
  function updateAttractCamera(dt) {
    attractBlend += dt / 9; // 9 detik per titik
    if (attractBlend >= 1) {
      attractBlend = 0;
      attractIdx = (attractIdx + 1) % ATTRACT_POINTS.length;
    }
    var a = ATTRACT_POINTS[attractIdx];
    var b = ATTRACT_POINTS[(attractIdx + 1) % ATTRACT_POINTS.length];
    var t = attractBlend * attractBlend * (3 - 2 * attractBlend); // smoothstep
    var slow = state.time * 0.05;
    state.camera.eye = {
      x: M3.lerp(a.x, b.x, t) + Math.sin(slow) * 6,
      y: M3.lerp(a.y, b.y, t) + Math.sin(slow * 0.7) * 2,
      z: M3.lerp(a.z, b.z, t) + Math.cos(slow) * 6
    };
    state.camera.look = {
      x: M3.lerp(a.lx, b.lx, t),
      y: M3.lerp(a.ly, b.ly, t),
      z: M3.lerp(a.lz, b.lz, t)
    };
  }

  // ------------------------------------------------------------------
  // Render: shadow pass lalu scene pass
  // ------------------------------------------------------------------
  function render() {
    if (!GL) return;
    var eye = state.camera.eye;
    var look = state.camera.look;
    // mat4LookAt WAJIB object {x,y,z} — BUKAN array (bug v8).
    var view = M3.mat4LookAt(eye, look, { x: 0, y: 1, z: 0 });
    var aspect = canvas ? canvas.width / Math.max(1, canvas.height) : 16 / 9;
    var proj = M3.mat4Perspective(M3.degToRad(62), aspect, 0.1, 900);

    // 1) Shadow pass: gambar caster ke depth map 1024. beginShadow()
    // mengembalikan false bila bayangan mati (mis. software renderer) —
    // jangan gambar caster tanpa guna (itu menggambar ulang seluruh dunia
    // dengan program lit — 2x kerja per frame).
    var shadowPass = GL.beginShadow ? GL.beginShadow() : false;
    if (shadowPass) drawShadowCasters();
    if (GL.endShadow) GL.endShadow();

    // 2) Scene pass: langit + semua modul draw (URUTAN SPEC).
    if (GL.beginFrame) GL.beginFrame(view, proj, eye);
    drawModules();
    if (GL.endFrame) GL.endFrame();

    // 3) Overlay peta besar (Tab) digambar HUD modul via DOM/canvas 2D.
    if (mapOpen && window.SB.HUD && window.SB.HUD.showMap) {
      try { window.SB.HUD.showMap(state); } catch (e) { logModErr('HUD', e); }
    }
  }

  // Caster bayangan: modul yang punya draw() digambar ulang ke shadow
  // map — cukup City, Vehicles, Player, NPC, Police (FX tidak perlu).
  function drawShadowCasters() {
    callDraw('City');
    callDraw('Vehicles');
    callDraw('Player');
    callDraw('NPC');
    callDraw('Police');
  }

  // Urutan draw PERSIS spec: City, Water, Vehicles, Player, NPC,
  // Police, FX. (Water & FX digambar di sini; modul lain yang tidak
  // ada di daftar ini — mis. Crew/Economy — tidak punya draw 3D.)
  function drawModules() {
    callDraw('City');
    callDraw('Water');
    callDraw('Vehicles');
    callDraw('Player');
    callDraw('NPC');
    callDraw('Police');
    callDraw('FX');
  }

  // ------------------------------------------------------------------
  // Aksi sekali tekan (dari main.js via queueAction)
  // ------------------------------------------------------------------
  function queueAction(action) {
    if (typeof action === 'string') actionQueue.push(action);
  }

  function drainActions() {
    if (!actionQueue.length) return;
    var actions = actionQueue.splice(0, actionQueue.length);
    for (var i = 0; i < actions.length; i++) {
      handleAction(actions[i]);
    }
  }

  function handleAction(action) {
    if (!started && action !== 'pause') return; // overlay start aktif
    switch (action) {
      case 'interact': doInteract(); break;
      case 'enterExit': doEnterExit(); break;
      case 'radio': cycleRadio(1); break;
      case 'missions': toggleMissionPanel(); break;
      case 'camera': camMode = (camMode + 1) % 3; break;
      case 'weapon0': setWeapon(0); break;
      case 'weapon1': setWeapon(1); break;
      case 'weapon2': setWeapon(2); break;
      case 'weapon3': setWeapon(3); break;
      case 'weaponPrev': setWeapon((state.weapon + 3) % 4); break;
      case 'buyAmmo': buyAmmo(); break;
      case 'horn': honk(); break;
      case 'crewCommand': cycleCrewCommand(); break;
      case 'lights': toggleLights(); break;
      case 'pause': togglePause(); break;
      default: break;
    }
  }

  // E: curi mobil terdekat / masuk kendaraan / naik perahu.
  function doInteract() {
    var V = window.SB.Vehicles;
    var W = window.SB.Water;
    if (state.player.onFoot) {
      // Coba perahu dulu bila dekat dermaga (Water.boardBoat).
      if (W && W.boardBoat) {
        try {
          var boarded = W.boardBoat();
          if (boarded) { toast('You boarded a boat.', ''); return; }
        } catch (e) { logModErr('Water', e); }
      }
      if (V && V.stealCar) {
        try {
          // stealCar() mengembalikan BOOLEAN, bukan mobil — objek mobil
          // sudah disimpan ke state.player.vehicle oleh Vehicles.enterCar
          // di dalamnya. Jangan timpa dengan nilai kembaliannya (dulu:
          // state.player.vehicle = true, merusak respray/drift/dll).
          if (V.stealCar()) {
            // carsStolen sudah dihitung di Vehicles.stealCar — jangan
            // hitung dua kali di sini.
            state.player.onFoot = false;
            addWanted(1, 'Grand theft auto');
            toast('Car stolen! Lose the cops.', 'red');
            sfx('steal');
            return;
          }
        } catch (e) { logModErr('Vehicles', e); }
      }
      toast('No car nearby. Walk to a parked car and press E.', '');
    } else {
      doEnterExit();
    }
  }

  function doEnterExit() {
    var V = window.SB.Vehicles;
    var W = window.SB.Water;
    if (!state.player.onFoot) {
      if (W && W.exitBoat) {
        try { W.exitBoat(); } catch (e) { logModErr('Water', e); }
      }
      if (V && V.exitCar) {
        try { V.exitCar(); } catch (e) { logModErr('Vehicles', e); }
      }
      state.player.onFoot = true;
      state.player.vehicle = null;
    }
  }

  function cycleRadio(dir) {
    state.radio = (state.radio + (dir || 1) + 6) % 6;
    var A = window.SB.Audio;
    if (A && A.setStation) {
      try { A.setStation(state.radio); } catch (e) { logModErr('Audio', e); }
    }
    var name = 'Station ' + (state.radio + 1);
    if (A && Array.isArray(A.stations) && A.stations[state.radio]) {
      name = A.stations[state.radio];
    }
    toast('Radio: ' + name, '');
  }

  function toggleMissionPanel() {
    missionPanelOpen = !missionPanelOpen;
    if (window.SB.HUD && window.SB.HUD.toggleMissionPanel) {
      try { window.SB.HUD.toggleMissionPanel(missionPanelOpen, state); } catch (e) { logModErr('HUD', e); }
    }
    if (missionPanelOpen && window.SB.Jobs && window.SB.Jobs.missions) {
      var list = window.SB.Jobs.missions;
      toast(list.length + ' missions available. Press M to close.', '');
    }
  }

  var WEAPON_NAMES = ['PISTOL', 'SMG', 'SHOTGUN', 'RIFLE'];
  function setWeapon(i) {
    state.weapon = M3.clamp(i, 0, 3);
    toast('Weapon: ' + WEAPON_NAMES[state.weapon], '');
    sfx('weapon');
    if (window.SB.HUD && window.SB.HUD.setWeapon) {
      try { window.SB.HUD.setWeapon(state.weapon, state.ammo); } catch (e) { logModErr('HUD', e); }
    }
  }

  // Beli amunisi: $50 / +24 (API SB.Shots.buyAmmo bila ada).
  function buyAmmo() {
    if (window.SB.Shots && window.SB.Shots.buyAmmo) {
      try { window.SB.Shots.buyAmmo(); return; } catch (e) { logModErr('Shots', e); }
    }
    if (state.money >= 50) {
      state.money -= 50;
      state.ammo += 24;
      toast('Ammo +24 ($50). Total: ' + state.ammo, 'green');
      sfx('buy');
    } else {
      toast('Not enough cash for ammo ($50).', 'red');
    }
  }

  function honk() {
    sfx('horn');
    // Klakson membuat NPC di dekatnya menoleh (modul NPC yang urus).
    var N = window.SB.NPC;
    if (N && N.cheer) {
      try { N.cheer(state.player.x, state.player.z); } catch (e) { logModErr('NPC', e); }
    }
  }

  var CREW_COMMANDS = ['follow', 'attack', 'wait'];
  var crewCmdIdx = 0;
  function cycleCrewCommand() {
    var cmd = CREW_COMMANDS[crewCmdIdx % CREW_COMMANDS.length];
    crewCmdIdx++;
    var C = window.SB.Crew;
    if (C && C.command) {
      try { C.command(cmd); } catch (e) { logModErr('Crew', e); }
    }
    toast('Crew: ' + cmd.toUpperCase(), '');
  }

  function toggleLights() {
    state.flags.lights = !state.flags.lights;
    toast(state.flags.lights ? 'Headlights ON' : 'Headlights OFF', '');
  }

  // Tambah wanted (dipakai modul lain lewat SB.Game.addWanted).
  function addWanted(n, reason) {
    var before = state.wanted;
    state.wanted = M3.clamp(state.wanted + n, 0, 5);
    state.heat = M3.clamp(state.heat + n * 12, 0, 100);
    if (state.wanted > before) {
      var Pol = window.SB.Police;
      if (Pol && Pol.setWanted) {
        try { Pol.setWanted(state.wanted); } catch (e) { logModErr('Police', e); }
      }
      var stars = '';
      for (var i = 0; i < state.wanted; i++) stars += '★';
      toast('WANTED ' + stars + (reason ? ' — ' + reason : ''), 'red');
      sfx('siren');
    }
  }

  function sfx(name) {
    var A = window.SB.Audio;
    if (A && A.sfx) {
      try { A.sfx(name); } catch (e) { /* abaikan */ }
    }
  }

  function toast(text, kind) {
    var H = window.SB.HUD;
    if (H && H.showToast) {
      try { H.showToast(text, kind); return; } catch (e) { /* fallback */ }
    }
    // Fallback DOM langsung bila modul HUD belum ada.
    var box = document.getElementById('toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    box.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 3600);
  }

  // ------------------------------------------------------------------
  // Pause / resume
  // ------------------------------------------------------------------
  function pause() {
    if (paused) return;
    paused = true;
    var overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.remove('hidden');
    save(true);
  }

  function resume() {
    paused = false;
    attractMode = false;
    started = true;
    window.SB.started = true;
    var overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.add('hidden');
    var start = document.getElementById('start-overlay');
    if (start) start.classList.add('hidden');
    // Snap kamera ke belakang pemain saat mulai.
    updateCamera(0.016, true);
  }

  function togglePause() {
    if (!started) return;
    if (paused) resume(); else pause();
  }

  function isPaused() { return paused; }

  function onResize() {
    if (GL && GL.resize) GL.resize();
  }

  // ------------------------------------------------------------------
  // Save / load — localStorage key 'sunset-bay-save-v12'
  // ------------------------------------------------------------------
  function save(silent) {
    try {
      var data = {
        version: SAVE_VERSION,
        savedAt: new Date().toISOString(),
        state: state
      };
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      // Save baru dibuat (atau autosave) -> tombol CONTINUE di menu
      // harus aktif. Sebelumnya opacity 0.45 dari boot tetap menempel
      // meski save sudah ada, jadi CONTINUE tampak mati.
      try {
        var contBtn = document.getElementById('continue-btn');
        if (contBtn) {
          contBtn.style.opacity = '1';
          contBtn.title = 'Lanjutkan permainan yang tersimpan';
        }
      } catch (e) { /* abaikan: tanpa DOM pun save tetap sah */ }
      if (!silent) toast('Game saved.', 'green');
      return true;
    } catch (e) {
      if (!silent) toast('Save failed: storage penuh / diblokir.', 'red');
      return false;
    }
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) {
        toast('No save found — starting fresh.', '');
        return false;
      }
      var data = JSON.parse(raw);
      if (!data || data.version !== SAVE_VERSION || !data.state) {
        toast('Save tidak cocok dengan v12 — mulai baru.', 'red');
        return false;
      }
      var s = data.state;
      // Salin field yang dikenal saja (tahan terhadap save rusak).
      var next = freshState();
      var keys = Object.keys(next);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (s[k] !== undefined) next[k] = s[k];
      }
      state = next;
      window.SB.state = state;
      seedDistrictRep();
      // Beri tahu modul bahwa state dimuat ulang (guard: opsional).
      callInit('Jobs');
      if (GL && GL.setTimeOfDay) GL.setTimeOfDay(state.timeOfDay);
      if (window.SB.Police && window.SB.Police.setWanted) {
        try { window.SB.Police.setWanted(state.wanted); } catch (e) { /* abaikan */ }
      }
      if (window.SB.Audio && window.SB.Audio.setStation) {
        try { window.SB.Audio.setStation(state.radio); } catch (e) { /* abaikan */ }
      }
      updateCamera(0.016, true);
      toast('Save loaded — Day ' + state.day + ', $' + state.money + '.', 'green');
      return true;
    } catch (e) {
      toast('Load gagal: save rusak.', 'red');
      return false;
    }
  }

  function resetSave() {
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) { /* abaikan */ }
    state = freshState();
    window.SB.state = state;
    seedDistrictRep();
    updateCamera(0.016, true);
  }

  // ------------------------------------------------------------------
  // Respect ranks: Rookie -> Street -> Boss -> Kingpin
  // (dipakai Economy.rankUp dan Jobs.completeMission lewat SB.Game)
  // ------------------------------------------------------------------
  var RESPECT_RANKS = [
    { name: 'Rookie', min: 0 },
    { name: 'Street', min: 250 },
    { name: 'Boss', min: 800 },
    { name: 'Kingpin', min: 2000 }
  ];

  function respectRankFor(rep) {
    var rank = RESPECT_RANKS[0].name;
    for (var i = 0; i < RESPECT_RANKS.length; i++) {
      if (rep >= RESPECT_RANKS[i].min) rank = RESPECT_RANKS[i].name;
    }
    return rank;
  }

  function addRep(n, reason) {
    var before = state.respectRank;
    state.rep = Math.max(0, state.rep + n);
    state.respect = state.rep;
    state.respectRank = respectRankFor(state.rep);
    if (state.respectRank !== before) {
      toast('RESPECT UP — you are now ' + state.respectRank.toUpperCase() + '!', 'gold');
      sfx('rankup');
    } else if (n > 0) {
      toast('REP +' + n + (reason ? ' — ' + reason : ''), 'gold');
    }
  }

  function addMoney(n, reason) {
    state.money = Math.max(0, state.money + n);
    if (n > 0) toast('+$' + n + (reason ? ' — ' + reason : ''), 'green');
    else if (n < 0) toast('-$' + (-n) + (reason ? ' — ' + reason : ''), 'red');
    if (window.SB.HUD && window.SB.HUD.setMoney) {
      try { window.SB.HUD.setMoney(state.money); } catch (e) { /* abaikan */ }
    }
  }

  // Dipanggil modul Jobs saat misi selesai: hadiah + rep + wanted turun.
  function completeMissionReward(reward, repGain) {
    if (reward) addMoney(reward, 'Mission complete');
    if (repGain) addRep(repGain, 'Mission complete');
    state.stats.missionsDone++;
    state.heat = Math.max(0, state.heat - 15);
    save(true);
  }

  // District standing: reputasi per distrik 0-100.
  function addDistrictRep(district, n) {
    if (!district) return;
    var cur = state.districtRep[district] || 0;
    state.districtRep[district] = M3.clamp(cur + n, 0, 100);
  }

  function districtAt(x, z) {
    var C = window.SB.City;
    if (C && C.districtAt) {
      try { return C.districtAt(x, z); } catch (e) { /* abaikan */ }
    }
    return 'Ocean Drive';
  }

  // ------------------------------------------------------------------
  // Pelacak objektif misi — waypoint + jarak + arah kompas
  // Dipakai HUD.minimap (rute) dan toast jarak berkala.
  // ------------------------------------------------------------------
  var objective = null; // {x, z, label, radius}
  var lastObjectiveToast = 0;

  // Tetapkan titik objektif aktif (dipanggil modul Jobs saat stage berubah).
  function setObjective(x, z, label, radius) {
    objective = {
      x: x, z: z,
      label: label || 'Objective',
      radius: radius || 6
    };
    lastObjectiveToast = 0;
  }

  function clearObjective() { objective = null; }

  function getObjective() { return objective; }

  // Jarak pemain ke objektif (meter), atau -1 bila tak ada objektif.
  function objectiveDistance() {
    if (!objective) return -1;
    return M3.dist2D(state.player.x, state.player.z, objective.x, objective.z);
  }

  // Arah kompas ke objektif dari sudut pandang pemain:
  // 0 = lurus ke depan, positif = belok kanan (radian, -PI..PI).
  function objectiveBearing() {
    if (!objective) return 0;
    var dx = objective.x - state.player.x;
    var dz = objective.z - state.player.z;
    var targetYaw = M3.yawFromDir(dx, dz);
    return M3.angleDiff(state.player.angle, targetYaw);
  }

  function objectiveReached() {
    if (!objective) return false;
    return objectiveDistance() <= objective.radius;
  }

  // Dipanggil tiap frame dari updateModules: toast jarak tiap 15 detik
  // bila objektif jauh, dan auto-advance bila pemain sampai.
  function updateObjective(dt) {
    if (!objective || paused) return;
    if (objectiveReached()) {
      var label = objective.label;
      clearObjective();
      toast('Objective reached: ' + label, 'green');
      sfx('objective');
      if (window.SB.Jobs && window.SB.Jobs.advanceStage) {
        try { window.SB.Jobs.advanceStage(); } catch (e) { logModErr('Jobs', e); }
      }
      return;
    }
    if (state.time - lastObjectiveToast > 20) {
      lastObjectiveToast = state.time;
      var d = Math.round(objectiveDistance());
      if (d > 60) toast(objective.label + ' — ' + d + 'm away', '');
    }
  }

  // ------------------------------------------------------------------
  // BUSTED — ditangkap polisi (wanted tinggi + HP rendah + polisi dekat)
  // ------------------------------------------------------------------
  var bustedCooldown = 0;
  function updateBusted(dt) {
    if (bustedCooldown > 0) { bustedCooldown -= dt; return; }
    if (state.wanted < 2 || state.player.hp > 25) return;
    var Pol = window.SB.Police;
    if (!Pol || !Array.isArray(Pol.cops) || !Pol.cops.length) return;
    var near = false;
    for (var i = 0; i < Pol.cops.length; i++) {
      var c = Pol.cops[i];
      if (c && M3.dist2D(state.player.x, state.player.z, c.x || 0, c.z || 0) < 4) {
        near = true; break;
      }
    }
    if (!near) return;
    bustedCooldown = 8;
    onBusted();
  }

  function onBusted() {
    var fine = Math.min(300, 50 + state.wanted * 50);
    state.money = Math.max(0, state.money - fine);
    state.wanted = 0;
    state.heat = 0;
    state.player.hp = 100;
    state.player.x = 0; state.player.z = 24;
    state.player.onFoot = true; state.player.vehicle = null;
    if (window.SB.Police && window.SB.Police.setWanted) {
      try { window.SB.Police.setWanted(0); } catch (e) { /* abaikan */ }
    }
    toast('BUSTED — bail $' + fine + '. The cops dropped you at Ocean Drive.', 'red');
    sfx('busted');
    save(true);
  }

  // ------------------------------------------------------------------
  // Event siklus hari — hook jam tertentu (neon malam, rush hour, dll)
  // ------------------------------------------------------------------
  var lastHourMark = -1;
  var neonOn = false;
  var rushHour = false;

  // Dipanggil tiap frame: deteksi pergantian jam bulat.
  function updateDayEvents(dt) {
    var hour = Math.floor(state.timeOfDay);
    if (hour === lastHourMark) return;
    lastHourMark = hour;
    var night = hour >= 19 || hour < 6;
    if (night !== neonOn) {
      neonOn = night;
      state.flags.neon = night;
      if (night) toast('Night falls — the neon comes alive.', '');
    }
    // Rush hour: 07.00-09.00 & 17.00-19.00 -> traffic lebih padat.
    rushHour = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 19);
    state.flags.rushHour = rushHour;
    // Pagi hari: toko buka, misi harian segar (Jobs yang urus isinya).
    if (hour === 6) toast('Morning in Sunset Bay — new day, new jobs.', '');
    // Golden hour: 18.00-19.00 — momen ikonik, beri tahu pemain.
    if (hour === 18) toast('Golden hour — the city glows orange.', 'gold');
  }

  function isNight() {
    return state.timeOfDay >= 19 || state.timeOfDay < 6;
  }

  function isGoldenHour() {
    return state.timeOfDay >= 17.5 && state.timeOfDay < 19.5;
  }

  // Faktor kepadatan traffic saat ini (1.0 normal, 1.5 rush hour,
  // 0.6 larut malam). Dipakai modul Vehicles untuk spawn/despawn.
  function trafficDensity() {
    if (isNight() && state.timeOfDay >= 1 && state.timeOfDay < 5) return 0.55;
    if (rushHour) return 1.5;
    return 1.0;
  }

  // ------------------------------------------------------------------
  // Monitor performa + kualitas adaptif
  // Kurangi beban bila fps jatuh: matikan post dulu, lalu shadow.
  // ------------------------------------------------------------------
  var perfSamples = [];
  var perfLevel = 2; // 2=penuh, 1=tanpa post, 0=tanpa post+shadow
  var perfCheckTimer = 0;

  function updatePerformance(dt) {
    perfSamples.push(dt);
    if (perfSamples.length > 90) perfSamples.shift();
    perfCheckTimer += dt;
    if (perfCheckTimer < 3) return;
    perfCheckTimer = 0;
    if (perfSamples.length < 30) return;
    var sum = 0;
    for (var i = 0; i < perfSamples.length; i++) sum += perfSamples[i];
    var avgFps = perfSamples.length / Math.max(sum, 0.001);
    if (avgFps < 24 && perfLevel > 0) {
      perfLevel--;
      applyPerfLevel();
    } else if (avgFps > 55 && perfLevel < 2) {
      perfLevel++;
      applyPerfLevel();
    }
  }

  function applyPerfLevel() {
    if (!GL) return;
    if (GL.setPostEnabled) GL.setPostEnabled(perfLevel >= 2);
    if (GL.setShadowEnabled) GL.setShadowEnabled(perfLevel >= 1);
    if (typeof console !== 'undefined' && console.info) {
      console.info('[SB.Game] kualitas adaptif -> level ' + perfLevel);
    }
  }

  function getPerfLevel() { return perfLevel; }

  // ------------------------------------------------------------------
  // Kamera sinematik kejar-kejaran — aktif saat wanted >= 3
  // Kamera mundur & naik sedikit agar heli + jalan terlihat.
  // ------------------------------------------------------------------
  function chaseCamBoost() {
    if (state.wanted >= 3 && !state.player.onFoot) return 1;
    if (state.wanted >= 3) return 0.6;
    return 0;
  }

  // Jarak kamera efektif (dipakai updateCamera lewat camDist).
  function effectiveCamDist() {
    var base = [9, 12.5, 16][camMode] || 9;
    return base + chaseCamBoost() * 4;
  }

  // ------------------------------------------------------------------
  // Statistik sesi — ringkasan untuk layar pause / akhir sesi
  // ------------------------------------------------------------------
  function sessionSummary() {
    return {
      day: state.day,
      timeOfDay: state.timeOfDay,
      money: state.money,
      rep: state.rep,
      respectRank: state.respectRank,
      wanted: state.wanted,
      kills: state.stats.kills,
      carsStolen: state.stats.carsStolen,
      drifts: state.stats.drifts,
      racesWon: state.stats.racesWon,
      missionsDone: state.stats.missionsDone,
      businesses: state.businesses.length,
      crew: state.crew.length,
      playSeconds: Math.round(state.time)
    };
  }

  // ------------------------------------------------------------------
  // Ekspor namespace — API spec SB.Game
  // ------------------------------------------------------------------
  window.SB.Game = {
    init: init,
    frame: frame,
    save: save,
    load: load,
    pause: pause,
    resume: resume,
    togglePause: togglePause,
    isPaused: isPaused,
    onResize: onResize,
    queueAction: queueAction,
    // Helper lintas modul (dipakai Jobs / Economy / Police):
    addWanted: addWanted,
    addRep: addRep,
    addMoney: addMoney,
    addDistrictRep: addDistrictRep,
    districtAt: districtAt,
    completeMissionReward: completeMissionReward,
    respectRankFor: respectRankFor,
    resetSave: resetSave,
    showToast: toast,
    // Objektif misi & info dunia:
    setObjective: setObjective,
    clearObjective: clearObjective,
    getObjective: getObjective,
    objectiveDistance: objectiveDistance,
    objectiveBearing: objectiveBearing,
    objectiveReached: objectiveReached,
    isNight: isNight,
    isGoldenHour: isGoldenHour,
    trafficDensity: trafficDensity,
    getPerfLevel: getPerfLevel,
    sessionSummary: sessionSummary,
    chaseCamBoost: chaseCamBoost,
    get state() { return state; },
    set state(s) { state = s; window.SB.state = s; },
    get started() { return started; },
    get saveKey() { return SAVE_KEY; }
  };

  // SB.state dibuat sejak file dimuat agar modul lain yang di-load
  // setelah game.js tetap bisa membaca state awal.
  window.SB.state = state;
})();

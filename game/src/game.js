window.SB = window.SB || {};
(function(){ 'use strict';
// ============================================================================
// SB.Game — ORCHESTRATOR Sunset Bay
// Satu-satunya modul yang memanggil init/update/draw modul lain, sesuai
// urutan load spec. SB.state dibuat di sini (struktur PERSIS spec) dan
// dibaca/ditulis semua modul. File ini tidak menggambar gedung/mobil/NPC
// sendiri — ia memanggil SB.City.draw, SB.Vehicles.draw, dst.
// Urutan update per frame: Weather (waktu) -> Jobs -> Races -> Economy ->
// Crew -> Player -> Vehicles -> Water -> NPC -> Police -> FX -> Audio -> HUD.
// Urutan draw: langit -> bayangan (pass depth) -> kota -> air -> kendaraan
// -> pemain -> NPC -> polisi -> FX.
// Save/load: localStorage key 'sunset-bay-save-v1' (versi 1).
// ============================================================================

var SAVE_KEY = 'sunset-bay-save-v1';
var SAVE_VERSION = 1;

var initialized = false;
var paused = false;
var started = false;
var canvas = null;
var skyMesh = null;
var frameCount = 0;
var lastFpsLog = 0;
var cameraMode = 0;        // 0 = kejar (chase), 1 = jauh, 2 = atas (top-down)
var cameraYaw = 0;
var cameraPitch = 0.32;
var cameraDistance = 11;
var cameraTarget = { x: 0, y: 1, z: 0 };
var cameraEye = { x: 0, y: 8, z: 12 };
var attractAngle = 0;
var dayRolloverDone = false;
var lastRadioKey = false;
var lastCameraKey = false;
var lastWeaponKey = -1;
var heatDecayTimer = 0;
var autosaveTimer = 0;

// ---------------------------------------------------------------------------
// SB.state — struktur PERSIS spec (jangan ubah nama / bentuk field)
// ---------------------------------------------------------------------------

function createState() {
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

// State pertama dibuat saat file dimuat agar modul lain bisa membacanya
// sebelum init() (mis. SB.Audio.init(state) dari main.js).
window.SB.state = createState();

function has(mod) {
  return !!(window.SB && window.SB[mod]);
}

function safeCall(mod, fn) {
  try {
    if (has(mod) && typeof window.SB[mod][fn] === 'function') {
      var args = Array.prototype.slice.call(arguments, 2);
      return window.SB[mod][fn].apply(window.SB[mod], args);
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[SB.Game] ' + mod + '.' + fn + ' gagal: ' + (err && err.message ? err.message : err));
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// init()
// ---------------------------------------------------------------------------

function init() {
  if (initialized) { return true; }
  canvas = document.getElementById('game-canvas');
  if (!canvas) { return false; }
  // State segar (tahan terhadap init ganda dari main.js).
  window.SB.state = createState();
  if (window.SB.Game) { window.SB.Game.state = window.SB.state; }
  var st = window.SB.state;
  // Renderer.
  if (!has('GL') || !window.SB.GL.init(canvas)) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[SB.Game] WebGL tidak tersedia');
    }
    return false;
  }
  window.SB.GL.setPerspective(62, 0.1, 900);
  window.SB.GL.applyGoldenHour(st.timeOfDay);
  window.SB.GL.setCamera(st.camera.eye, st.camera.look);
  // Langit: kubus besar dari helper GL (bukan mesh modul lain).
  if (window.SB.GL.skyCube) { skyMesh = window.SB.GL.skyCube(420); }
  // Reputasi awal tiap distrik (0 = netral, naik lewat misi/balapan).
  var districts = [];
  if (has('City') && Array.isArray(window.SB.City.districts)) {
    districts = window.SB.City.districts;
  } else {
    districts = ['Sunset Beach', 'Marina Bay', 'Old Town', 'Downtown',
      'Harbour', 'North Hills', 'Palm Avenue', 'Fisherman Wharf',
      'Neon Strip', 'University', 'Airport Road', 'South Docks'];
  }
  for (var i = 0; i < districts.length; i++) {
    st.districtRep[districts[i]] = 0;
  }
  // Init modul — URUTAN LOAD spec (bukan urutan alfabet).
  safeCall('Rng', 'make', 1337);
  safeCall('City', 'init', st);
  safeCall('Water', 'init', st);
  safeCall('Vehicles', 'init', st);
  safeCall('Player', 'init', st);
  safeCall('NPC', 'init', st);
  safeCall('Police', 'init', st);
  safeCall('Crew', 'init', st);
  safeCall('Economy', 'init', st);
  safeCall('Races', 'init', st);
  safeCall('Weather', 'init', st);
  safeCall('FX', 'init', st);
  safeCall('Audio', 'init', st);
  safeCall('HUD', 'init', st);
  safeCall('Shots', 'init', st);
  safeCall('Jobs', 'init', st);
  // Misi pertama aktif sejak awal (hadiah +$200 & REP+100 bila selesai).
  // ID harus 'm01' — id misi di Jobs (bukan 'mission-01').
  safeCall('Jobs', 'startMission', 'm01');
  initialized = true;
  started = false;
  frameCount = 0;
  return true;
}

// Reset ke state baru (tombol MAIN LAGI / mulai baru setelah pernah main).
function reset() {
  window.SB.state = createState();
  if (window.SB.Game) { window.SB.Game.state = window.SB.state; }
  var st = window.SB.state;
  paused = false;
  started = false;
  frameCount = 0;
  cameraMode = 0;
  cameraYaw = 0;
  if (window.SB.GL) { window.SB.GL.applyGoldenHour(st.timeOfDay); }
  safeCall('City', 'init', st);
  safeCall('Water', 'init', st);
  safeCall('Vehicles', 'init', st);
  safeCall('Player', 'init', st);
  safeCall('NPC', 'init', st);
  safeCall('Police', 'init', st);
  safeCall('Crew', 'init', st);
  safeCall('Economy', 'init', st);
  safeCall('Races', 'init', st);
  safeCall('Weather', 'init', st);
  safeCall('FX', 'init', st);
  safeCall('HUD', 'init', st);
  safeCall('Shots', 'init', st);
  safeCall('Jobs', 'init', st);
  safeCall('Jobs', 'startMission', 'm01');
  return true;
}

// ---------------------------------------------------------------------------
// frame(dt) — satu frame penuh: update lalu draw
// ---------------------------------------------------------------------------

function frame(dt) {
  if (!initialized) { return; }
  if (paused) { return; }
  var st = window.SB.state;
  if (!st) { return; }
  var d = (typeof dt === 'number' && dt > 0) ? dt : 0.016;
  if (d > 0.05) { d = 0.05; }
  frameCount++;
  st.time += d;
  update(d, st);
  draw(st);
  if (window.SB.GL && window.SB.GL.nextFrame) { window.SB.GL.nextFrame(); }
}

// ---------------------------------------------------------------------------
// update(dt, state)
// ---------------------------------------------------------------------------

function update(dt, st) {
  // Waktu dunia: 1 detik nyata = 1 menit game (siang-malam terasa berjalan).
  // advanceTime milik Weather; fallback bila modul belum ada: hitung sendiri.
  if (has('Weather') && typeof window.SB.Weather.advanceTime === 'function') {
    window.SB.Weather.advanceTime(dt);
  } else {
    st.timeOfDay += dt / 60;
    if (st.timeOfDay >= 24) { st.timeOfDay -= 24; st.day++; }
  }
  // Pergantian hari: 00:00 -> hari baru, pemasukan bisnis masuk.
  if (st.timeOfDay < 0.05 && !dayRolloverDone) {
    dayRolloverDone = true;
    st.day++;
    onNewDay(st);
  }
  if (st.timeOfDay > 0.2) { dayRolloverDone = false; }
  // Golden hour mengikuti jam (matahari, kabut, neon).
  if (window.SB.GL && window.SB.GL.applyGoldenHour) {
    window.SB.GL.applyGoldenHour(st.timeOfDay);
  }
  // Input global (radio, kamera, senjata, isi ulang) — dibaca sekali di sini.
  handleGlobalInput(st);
  // Heat mereda perlahan bila tidak ada wanted.
  heatDecayTimer += dt;
  if (heatDecayTimer > 1) {
    heatDecayTimer = 0;
    if (st.wanted === 0 && st.heat > 0) { st.heat = Math.max(0, st.heat - 1); }
    if (st.wanted > 0 && st.heat < 100) { st.heat = Math.min(100, st.heat + 0.5); }
  }
  // Sinkron wanted -> Police + HUD (satu sumber kebenaran: SB.state).
  syncWanted(st);
  // Update modul — urutan logika (bukan urutan gambar).
  safeCall('Weather', 'update', dt, st);
  safeCall('Jobs', 'update', dt, st);
  safeCall('Races', 'update', dt, st);
  safeCall('Economy', 'update', dt, st);
  safeCall('Crew', 'update', dt, st);
  safeCall('Player', 'update', dt, st, readInput());
  safeCall('Vehicles', 'update', dt, st);
  // Speedometer HUD dinamis: tidak ada modul yang memanggil HUD.setSpeed,
  // sehingga .hud-speed selalu 0 km/h saat mengemudi. Isi dari kendaraan
  // pemain (satuan sama dengan #hud-speed statis: |speed| * 3.6).
  if (window.SB.HUD && window.SB.HUD.setSpeed) {
    var _v = st.player && st.player.vehicle;
    window.SB.HUD.setSpeed((_v && typeof _v.speed === 'number') ? Math.abs(_v.speed) * 3.6 : 0);
  }
  safeCall('Water', 'update', dt, st);
  safeCall('NPC', 'update', dt, st);
  safeCall('Police', 'update', dt, st);
  safeCall('FX', 'update', dt, st);
  safeCall('Audio', 'update', dt, st);
  // Kamera mengikuti pemain / kendaraan.
  updateCamera(dt, st);
  // HUD + minimap (setelah semua modul update agar angka terbaru).
  syncHud(st);
  // Rank respect dihitung ulang dari respect total.
  updateRespectRank(st);
  // Misi selesai -> hadiah (Jobs yang memutuskan; di sini hanya sinkron).
  if (st.mission && st.mission.id && st.flags && st.flags['mission-complete']) {
    st.flags['mission-complete'] = false;
    completeMissionReward(st);
  }
  // Pemain mati -> respawn di rumah sakit (bukan game over total).
  if (st.player.hp <= 0) {
    respawnPlayer(st);
  }
  // Autosave internal tiap 60 detik (main.js juga memanggil save()).
  autosaveTimer += dt;
  if (autosaveTimer > 60) { autosaveTimer = 0; save(); }
}

function onNewDay(st) {
  var income = 0;
  if (has('Economy') && typeof window.SB.Economy.collectIncome === 'function') {
    try { income = window.SB.Economy.collectIncome() || 0; } catch (e) { income = 0; }
  }
  var msg = 'Hari ' + st.day + ' — matahari terbit di Sunset Bay.';
  if (income > 0) { msg += ' Pemasukan bisnis: +$' + income + '.'; }
  if (window.SB.HUD && window.SB.HUD.showToast) { window.SB.HUD.showToast(msg); }
}

function syncWanted(st) {
  var w = Math.max(0, Math.min(5, st.wanted | 0));
  st.wanted = w;
  if (has('Police') && typeof window.SB.Police.setWanted === 'function') {
    try { window.SB.Police.setWanted(w); } catch (e) { /* abaikan */ }
  }
  if (window.SB.HUD && window.SB.HUD.setWanted) {
    try { window.SB.HUD.setWanted(w); } catch (e) { /* abaikan */ }
  }
}

function updateRespectRank(st) {
  var r = st.respect || 0;
  var rank = 'Rookie';
  // Ambang HARUS sama dengan Economy.RANKS (Street 300, Boss 800, Kingpin 1800).
  if (r >= 1800) { rank = 'Kingpin'; }
  else if (r >= 800) { rank = 'Boss'; }
  else if (r >= 300) { rank = 'Street'; }
  if (rank !== st.respectRank) {
    st.respectRank = rank;
    // JANGAN panggil Economy.rankUp() di sini: rankUp() menaikkan respect
    // ke ambang rank BERIKUTNYA sehingga rank melonjak ke Kingpin sendiri.
    if (window.SB.HUD && window.SB.HUD.showToast) {
      window.SB.HUD.showToast('Respect naik: kamu sekarang ' + rank + '!');
    }
  }
}

function completeMissionReward(st) {
  var reward = (st.mission && st.mission.reward) || 200;
  st.money += reward;
  st.rep += 100;
  st.respect += 50;
  st.stats.missionsDone++;
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast('Misi selesai! +$' + reward + ' & REP+100');
  }
  if (window.SB.HUD && window.SB.HUD.setMoney) {
    try { window.SB.HUD.setMoney(st.money); } catch (e) { /* abaikan */ }
  }
}

function respawnPlayer(st) {
  st.player.hp = 100;
  st.player.armor = 0;
  st.player.x = 0; st.player.y = 0; st.player.z = 0;
  st.player.angle = 0;
  st.player.onFoot = true;
  st.player.vehicle = null;
  st.money = Math.max(0, st.money - 100);
  st.wanted = 0;
  st.heat = Math.max(0, st.heat - 20);
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast('Kamu tumbang. Bangun di rumah sakit — -$100.');
  }
  if (has('Player') && typeof window.SB.Player.init === 'function') {
    try { window.SB.Player.init(st); } catch (e) { /* abaikan */ }
  }
}

// ---------------------------------------------------------------------------
// Input global: dibaca main.js lewat SB.Input; fallback keyboard mentah
// ---------------------------------------------------------------------------

function readInput() {
  // Bentuk input yang dibaca SB.Player.update: moveX/moveZ (sumbu gerak),
  // action (E, edge), sprint, shoot, lookDX/lookDY (mouse). Field legacy
  // (forward/back/...) dipertahankan untuk kompatibilitas.
  var input = { moveX: 0, moveZ: 0, action: false, sprint: false,
    shoot: false, lookDX: 0, lookDY: 0,
    forward: false, back: false, left: false, right: false,
    run: false, jump: false, interact: false,
    mouseDX: 0, mouseDY: 0, wheel: 0 };
  if (window.SB.Input) {
    try {
      var fwd = !!window.SB.Input.actionDown('forward');
      var back = !!window.SB.Input.actionDown('back');
      var left = !!window.SB.Input.actionDown('left');
      var right = !!window.SB.Input.actionDown('right');
      input.moveZ = (fwd ? 1 : 0) - (back ? 1 : 0);
      input.moveX = (right ? 1 : 0) - (left ? 1 : 0);
      input.forward = fwd; input.back = back;
      input.left = left; input.right = right;
      input.sprint = !!window.SB.Input.actionDown('run');
      input.run = input.sprint;
      input.jump = !!window.SB.Input.actionPressed('jump');
      input.action = !!window.SB.Input.actionPressed('interact');
      input.interact = input.action;
      input.shoot = !!window.SB.Input.actionDown('shoot');
      var md = window.SB.Input.getMouseDelta();
      input.lookDX = md.x || 0;
      input.lookDY = md.y || 0;
      input.mouseDX = input.lookDX;
      input.mouseDY = input.lookDY;
      input.wheel = window.SB.Input.getWheelDelta ? window.SB.Input.getWheelDelta() : 0;
    } catch (e) { /* input gagal: pakai default (diam) */ }
  }
  return input;
}

function handleGlobalInput(st) {
  if (!window.SB.Input) { return; }
  var inp = window.SB.Input;
  // M: ganti stasiun radio (0-5, ORIGINAL, diegetik).
  var radioDown = false;
  try { radioDown = inp.actionPressed('radio'); } catch (e) { radioDown = false; }
  if (radioDown && !lastRadioKey) {
    st.radio = (st.radio + 1) % 6;
    if (has('Audio') && typeof window.SB.Audio.setStation === 'function') {
      try { window.SB.Audio.setStation(st.radio); } catch (e) { /* abaikan */ }
    }
    var names = ['Sunset FM', 'Neon Nights', 'Bay Talk', 'Palm Radio', 'Harbour Beats', 'Midnight Drive'];
    if (has('Audio') && Array.isArray(window.SB.Audio.stations) && window.SB.Audio.stations[st.radio]) {
      names[st.radio] = window.SB.Audio.stations[st.radio];
    }
    if (window.SB.HUD && window.SB.HUD.showToast) {
      window.SB.HUD.showToast('Radio: ' + names[st.radio]);
    }
  }
  lastRadioKey = radioDown;
  // C: ganti mode kamera.
  var camDown = false;
  try { camDown = inp.actionPressed('camera'); } catch (e) { camDown = false; }
  if (camDown && !lastCameraKey) {
    cameraMode = (cameraMode + 1) % 3;
  }
  lastCameraKey = camDown;
  // 1-4: ganti senjata (0=pistol 1=smg 2=shotgun 3=rifle).
  var weaponNames = ['PISTOL', 'SMG', 'SHOTGUN', 'RIFLE'];
  for (var w = 0; w < 4; w++) {
    var pressed = false;
    try { pressed = inp.isPressed('Digit' + (w + 1)); } catch (e) { pressed = false; }
    if (pressed && st.weapon !== w) {
      st.weapon = w;
      if (window.SB.HUD && window.SB.HUD.showToast) {
        window.SB.HUD.showToast('Senjata: ' + weaponNames[w]);
      }
    }
  }
  // R: isi ulang amunisi — $50 / +24 (SB.Shots.buyAmmo).
  var reloadDown = false;
  try { reloadDown = inp.actionPressed('reload'); } catch (e) { reloadDown = false; }
  if (reloadDown) {
    if (has('Shots') && typeof window.SB.Shots.buyAmmo === 'function') {
      try { window.SB.Shots.buyAmmo(); } catch (e) { /* abaikan */ }
    } else if (st.money >= 50) {
      st.money -= 50;
      st.ammo += 24;
    }
  }
  // N: mute/unmute audio.
  var muteDown = false;
  try { muteDown = inp.isPressed('KeyN'); } catch (e) { muteDown = false; }
  if (muteDown && has('Audio') && typeof window.SB.Audio.toggleMute === 'function') {
    try { window.SB.Audio.toggleMute(); } catch (e) { /* abaikan */ }
  }
}

// ---------------------------------------------------------------------------
// Kamera: mengikuti pemain / kendaraan; attract mode saat belum mulai
// ---------------------------------------------------------------------------

function updateCamera(dt, st) {
  var M = window.SB.Math3;
  var p = st.player;
  if (!started) {
    // Attract mode (layar start): kamera mengorbit kota perlahan.
    attractAngle += dt * 0.05;
    var ax = Math.sin(attractAngle) * 90;
    var az = Math.cos(attractAngle) * 90;
    cameraEye = { x: ax, y: 26, z: az };
    cameraTarget = { x: 0, y: 4, z: 0 };
  } else if (cameraMode === 2) {
    // Top-down: dari atas pemain, untuk melihat rute / minimap besar.
    cameraEye = { x: p.x, y: 60, z: p.z + 0.01 };
    cameraTarget = { x: p.x, y: 0, z: p.z };
  } else {
    var dist = (cameraMode === 1) ? 18 : 11;
    var height = (cameraMode === 1) ? 7 : 4.5;
    // Saat di kendaraan, kamera lebih jauh & lebih tinggi: +1,5 HARUS masuk
    // ke target (cy) SEBELUM lerp. Versi lama menambahkannya ke cameraEye.y
    // SETELAH lerp tiap frame, sehingga titik tetapnya jadi 4,5+1,5/0,3=9,5
    // (kamera terlalu tinggi, menunduk ~35 derajat, langit/heli tak terlihat).
    if (!p.onFoot && p.vehicle) { height += 1.5; }
    // Yaw kamera mengikuti arah pemain + drag mouse.
    var input = readInput();
    if (input.mouseDX) { cameraYaw -= input.mouseDX * 0.003; }
    var targetYaw = p.angle + Math.PI + cameraYaw;
    var cx = p.x + Math.sin(targetYaw) * dist;
    var cz = p.z + Math.cos(targetYaw) * dist;
    var cy = p.y + height;
    // Haluskan (lerp) agar kamera tidak patah-patah.
    var k = Math.min(1, dt * 6);
    cameraEye.x += (cx - cameraEye.x) * k;
    cameraEye.y += (cy - cameraEye.y) * k;
    cameraEye.z += (cz - cameraEye.z) * k;
    if (cameraEye.y < 1.2) { cameraEye.y = 1.2; }
    cameraTarget = { x: p.x, y: p.y + 1.5, z: p.z };
  }
  st.camera.eye = { x: cameraEye.x, y: cameraEye.y, z: cameraEye.z };
  st.camera.look = { x: cameraTarget.x, y: cameraTarget.y, z: cameraTarget.z };
  if (window.SB.GL && window.SB.GL.setCamera) {
    window.SB.GL.setCamera(st.camera.eye, st.camera.look);
  }
  if (window.SB.GL && window.SB.GL.setPerspective) {
    // FOV melebar sedikit saat ngebut (rasa kecepatan).
    var speed = 0;
    if (!p.onFoot && p.vehicle && typeof p.vehicle.speed === 'number') {
      speed = Math.abs(p.vehicle.speed);
    }
    var fov = 62 + Math.min(10, speed * 0.12);
    window.SB.GL.setPerspective(fov, 0.1, 900);
  }
}

// ---------------------------------------------------------------------------
// draw(state)
// ---------------------------------------------------------------------------

function draw(st) {
  var GL = window.SB.GL;
  if (!GL) { return; }
  // Resize bila ukuran kanvas berubah (jendela / rotasi HP).
  if (GL.resize) { GL.resize(); }
  // Pass bayangan dulu (depth ke shadow map), lalu gambar utama.
  if (GL.beginShadow && GL.beginShadow()) {
    drawWorld(st, true);
    GL.endShadow();
  }
  // Langit gradien golden hour + matahari (sebelum objek lain).
  var sky = [0.98, 0.62, 0.38];
  if (GL.clear) { GL.clear(sky[0], sky[1], sky[2]); }
  if (skyMesh && GL.drawSky) {
    try { GL.drawSky(skyMesh, st.time); } catch (e) { /* abaikan */ }
  }
  drawWorld(st, false);
  // Vignette ringan (post-processing sederhana).
  if (GL.drawVignette && GL.fullscreenQuad) {
    try { GL.drawVignette(GL.fullscreenQuad(), 0.18); } catch (e) { /* abaikan */ }
  }
}

// Gambar seluruh dunia. shadowOnly=true -> hanya mesh padat (tanpa air/FX).
function drawWorld(st, shadowOnly) {
  var GL = window.SB.GL;
  // Kota: >250 gedung, 12+ distrik, jalan, palma, neon malam.
  safeCall('City', 'draw', GL, st);
  if (shadowOnly) { return; }
  // Air: laut reflektif + perahu (5+) + wake.
  safeCall('Water', 'draw', GL, st);
  // Kendaraan: 36+ traffic + mobil pemain.
  safeCall('Vehicles', 'draw', GL, st);
  // Pemain (jalan kaki / mengemudi).
  safeCall('Player', 'draw', GL, st);
  // NPC: 24+ pejalan kaki, turis pantai, hewan peliharaan.
  safeCall('NPC', 'draw', GL, st);
  // Polisi: patroli, roadblock, heli AIR-1 (wanted >= 3).
  safeCall('Police', 'draw', GL, st);
  // FX: ledakan, asap, api, partikel, percikan.
  safeCall('FX', 'draw', GL, st);
  // Jobs / Races tidak menggambar mesh sendiri lewat drawWorld — mereka
  // memakai marker lewat HUD/minimap; bila suatu saat punya draw, panggil:
  safeCall('Jobs', 'draw', GL, st);
  safeCall('Races', 'draw', GL, st);
  safeCall('Crew', 'draw', GL, st);
}

// ---------------------------------------------------------------------------
// HUD sync: angka di index.html + modul SB.HUD + minimap
// ---------------------------------------------------------------------------

function syncHud(st) {
  // Modul HUD (bila ada): update(state) + minimap(state).
  if (has('HUD')) {
    if (typeof window.SB.HUD.update === 'function') {
      try { window.SB.HUD.update(st); } catch (e) { /* abaikan */ }
    }
    if (typeof window.SB.HUD.minimap === 'function') {
      try { window.SB.HUD.minimap(st); } catch (e) { /* abaikan */ }
    }
    if (typeof window.SB.HUD.setMoney === 'function') {
      try { window.SB.HUD.setMoney(st.money); } catch (e) { /* abaikan */ }
    }
  }
  // Fallback DOM langsung (agar HUD tetap hidup walau SB.HUD belum siap).
  var el;
  el = document.getElementById('hud-money');
  if (el) { el.innerHTML = '$' + st.money + ' <small>REP ' + st.rep + ' &middot; ' + st.respectRank + '</small>'; }
  el = document.getElementById('hud-hp-num');
  if (el) { el.textContent = String(Math.max(0, Math.round(st.player.hp))); }
  el = document.getElementById('hud-armor-num');
  if (el) { el.textContent = String(Math.max(0, Math.round(st.player.armor))); }
  el = document.getElementById('hud-health-fill');
  if (el) { el.style.width = Math.max(0, Math.min(100, st.player.hp)) + '%'; }
  el = document.getElementById('hud-armor-fill');
  if (el) { el.style.width = Math.max(0, Math.min(100, st.player.armor)) + '%'; }
  el = document.getElementById('hud-heat-num');
  if (el) { el.textContent = String(Math.round(st.heat)); }
  el = document.getElementById('hud-heat-fill');
  if (el) { el.style.width = Math.max(0, Math.min(100, st.heat)) + '%'; }
  el = document.getElementById('hud-time');
  if (el) { el.textContent = formatClock(st.timeOfDay); }
  el = document.getElementById('hud-day');
  if (el) {
    var label = 'Hari ' + st.day;
    if (st.timeOfDay >= 17.5 && st.timeOfDay <= 19.5) { label += ' &middot; Golden Hour'; }
    else if (st.timeOfDay >= 19.5 || st.timeOfDay < 5.5) { label += ' &middot; Malam'; }
    else if (st.timeOfDay >= 5.5 && st.timeOfDay < 11) { label += ' &middot; Pagi'; }
    else { label += ' &middot; Siang'; }
    el.innerHTML = label;
  }
  el = document.getElementById('hud-weather');
  if (el) {
    var w = st.weather;
    var wt = (w.rain > 0.3) ? 'Hujan lokal' : (w.clouds > 0.6 ? 'Berawan' : 'Cerah');
    wt += ' &middot; Angin ' + (w.wind > 0.5 ? 'kencang' : 'sepoi');
    if (w.puddles > 0.1) { wt += ' &middot; Genangan'; }
    el.textContent = wt;
  }
  el = document.getElementById('hud-weapon');
  if (el) {
    var wn = ['PISTOL', 'SMG', 'SHOTGUN', 'RIFLE'][st.weapon] || 'PISTOL';
    el.textContent = wn + ' &middot; Ammo ' + st.ammo + ' &middot; [1-4] ganti senjata &middot; [R] isi ulang';
  }
  el = document.getElementById('hud-wanted');
  if (el) {
    var stars = '';
    for (var i = 0; i < 5; i++) {
      stars += (i < st.wanted) ? '&#9733;' : '<span class="star-off">&#9733;</span>';
    }
    el.innerHTML = stars;
  }
  el = document.getElementById('hud-mission-text');
  if (el) {
    if (st.mission && st.mission.text) { el.textContent = st.mission.text; }
    else { el.textContent = 'Jelajahi Sunset Bay. Cari ikon misi di peta.'; }
  }
  el = document.getElementById('hud-zone');
  if (el) {
    var zone = 'Sunset Beach';
    if (has('City') && typeof window.SB.City.districtAt === 'function') {
      try { zone = window.SB.City.districtAt(st.player.x, st.player.z) || zone; } catch (e) { /* abaikan */ }
    }
    el.textContent = zone;
  }
  el = document.getElementById('hud-radio');
  if (el) {
    var stations = ['Sunset FM', 'Neon Nights', 'Bay Talk', 'Palm Radio', 'Harbour Beats', 'Midnight Drive'];
    if (has('Audio') && Array.isArray(window.SB.Audio.stations) && window.SB.Audio.stations[st.radio]) {
      stations[st.radio] = window.SB.Audio.stations[st.radio];
    }
    el.innerHTML = '&#9834; ' + stations[st.radio];
  }
  el = document.getElementById('hud-speed');
  if (el) {
    var kmh = 0;
    if (!st.player.onFoot && st.player.vehicle && typeof st.player.vehicle.speed === 'number') {
      kmh = Math.round(Math.abs(st.player.vehicle.speed) * 3.6);
    } else if (st.player.onFoot) {
      kmh = 0;
    }
    el.innerHTML = kmh + ' <small>km/j</small>';
  }
  el = document.getElementById('hud-wanted-flash');
  if (el) { el.style.display = (st.wanted >= 3) ? 'block' : 'none'; }
  el = document.getElementById('hud-objective');
  if (el) {
    if (st.mission && st.mission.text) {
      el.textContent = 'Misi ' + (st.mission.id || '') + ': ' + st.mission.text;
    } else {
      // Misi selesai / belum ada: jangan biarkan teks stage lama menempel.
      el.textContent = 'Tidak ada misi aktif — cari pekerjaan di marina.';
    }
  }
}

function formatClock(hour) {
  var h = Math.floor(hour) % 24;
  var m = Math.floor((hour - Math.floor(hour)) * 60);
  var hh = (h < 10 ? '0' : '') + h;
  var mm = (m < 10 ? '0' : '') + m;
  return hh + ':' + mm;
}

// ---------------------------------------------------------------------------
// save() / load() — localStorage (Continue)
// ---------------------------------------------------------------------------

function save() {
  if (!initialized) { return false; }
  var st = window.SB.state;
  if (!st) { return false; }
  var data = {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    time: st.time, timeOfDay: st.timeOfDay, day: st.day,
    money: st.money, rep: st.rep, respect: st.respect, respectRank: st.respectRank,
    wanted: st.wanted, heat: st.heat,
    player: { x: st.player.x, y: st.player.y, z: st.player.z,
      angle: st.player.angle, onFoot: st.player.onFoot,
      hp: st.player.hp, armor: st.player.armor },
    weather: { rain: st.weather.rain, clouds: st.weather.clouds,
      wind: st.weather.wind, puddles: st.weather.puddles },
    mission: { id: st.mission.id, stage: st.mission.stage,
      text: st.mission.text, reward: st.mission.reward },
    crew: st.crew.slice(),
    districtRep: st.districtRep,
    businesses: st.businesses.slice(),
    radio: st.radio, ammo: st.ammo, weapon: st.weapon,
    stats: { kills: st.stats.kills, carsStolen: st.stats.carsStolen,
      drifts: st.stats.drifts, racesWon: st.stats.racesWon,
      missionsDone: st.stats.missionsDone },
    flags: st.flags
  };
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    // Segarkan tombol Continue (di layar start) agar langsung bisa dipakai.
    var cbtn = document.getElementById('btn-continue');
    if (cbtn) { cbtn.style.display = ''; cbtn.disabled = false; cbtn.style.opacity = '1'; }
    return true;
  } catch (err) {
    return false;
  }
}

function load() {
  if (!initialized) { return false; }
  var raw = null;
  try { raw = window.localStorage.getItem(SAVE_KEY); } catch (err) { return false; }
  if (!raw) { return false; }
  var data = null;
  try { data = JSON.parse(raw); } catch (err) { return false; }
  if (!data || data.version !== SAVE_VERSION) { return false; }
  var st = window.SB.state;
  // Hanya field yang dikenal yang dipulihkan; sisanya tetap default aman.
  if (typeof data.time === 'number') { st.time = data.time; }
  if (typeof data.timeOfDay === 'number') { st.timeOfDay = data.timeOfDay; }
  if (typeof data.day === 'number') { st.day = data.day; }
  if (typeof data.money === 'number') { st.money = data.money; }
  if (typeof data.rep === 'number') { st.rep = data.rep; }
  if (typeof data.respect === 'number') { st.respect = data.respect; }
  if (typeof data.respectRank === 'string') { st.respectRank = data.respectRank; }
  if (typeof data.wanted === 'number') { st.wanted = Math.max(0, Math.min(5, data.wanted)); }
  if (typeof data.heat === 'number') { st.heat = Math.max(0, Math.min(100, data.heat)); }
  if (data.player) {
    if (typeof data.player.x === 'number') { st.player.x = data.player.x; }
    if (typeof data.player.y === 'number') { st.player.y = data.player.y; }
    if (typeof data.player.z === 'number') { st.player.z = data.player.z; }
    if (typeof data.player.angle === 'number') { st.player.angle = data.player.angle; }
    if (typeof data.player.onFoot === 'boolean') { st.player.onFoot = data.player.onFoot; }
    if (typeof data.player.hp === 'number') { st.player.hp = data.player.hp; }
    if (typeof data.player.armor === 'number') { st.player.armor = data.player.armor; }
    st.player.vehicle = null;
  }
  if (data.weather) {
    if (typeof data.weather.rain === 'number') { st.weather.rain = data.weather.rain; }
    if (typeof data.weather.clouds === 'number') { st.weather.clouds = data.weather.clouds; }
    if (typeof data.weather.wind === 'number') { st.weather.wind = data.weather.wind; }
    if (typeof data.weather.puddles === 'number') { st.weather.puddles = data.weather.puddles; }
  }
  if (data.mission) {
    st.mission = {
      id: data.mission.id || null,
      stage: data.mission.stage || 0,
      text: data.mission.text || '',
      reward: data.mission.reward || 0
    };
  }
  if (Array.isArray(data.crew)) { st.crew = data.crew.slice(); }
  if (data.districtRep) { st.districtRep = data.districtRep; }
  if (Array.isArray(data.businesses)) { st.businesses = data.businesses.slice(); }
  if (typeof data.radio === 'number') { st.radio = data.radio % 6; }
  if (typeof data.ammo === 'number') { st.ammo = data.ammo; }
  if (typeof data.weapon === 'number') { st.weapon = data.weapon % 4; }
  if (data.stats) {
    if (typeof data.stats.kills === 'number') { st.stats.kills = data.stats.kills; }
    if (typeof data.stats.carsStolen === 'number') { st.stats.carsStolen = data.stats.carsStolen; }
    if (typeof data.stats.drifts === 'number') { st.stats.drifts = data.stats.drifts; }
    if (typeof data.stats.racesWon === 'number') { st.stats.racesWon = data.stats.racesWon; }
    if (typeof data.stats.missionsDone === 'number') { st.stats.missionsDone = data.stats.missionsDone; }
  }
  if (data.flags) { st.flags = data.flags; }
  // Sinkronkan dunia dengan state yang dipulihkan.
  if (window.SB.GL) { window.SB.GL.applyGoldenHour(st.timeOfDay); }
  safeCall('Player', 'init', st);
  safeCall('Police', 'setWanted', st.wanted);
  syncWanted(st);
  syncHud(st);
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast('Save dimuat — selamat datang kembali di Sunset Bay.');
  }
  return true;
}

function hasSave() {
  try { return !!window.localStorage.getItem(SAVE_KEY); } catch (err) { return false; }
}

function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); return true; } catch (err) { return false; }
}

// ---------------------------------------------------------------------------
// pause() / resume()
// ---------------------------------------------------------------------------

function pause() {
  paused = true;
  if (window.SB.Audio && typeof window.SB.Audio.toggleMute === 'function') {
    // Jangan mute permanen saat pause — hanya catat; audio modul yang atur.
  }
  return true;
}

function resume() {
  paused = false;
  started = true;
  return true;
}

function isPaused() { return paused; }
function isStarted() { return started; }
function isInitialized() { return initialized; }
function getFrameCount() { return frameCount; }

// API bantuan untuk modul lain / debug (tidak mengubah state diam-diam).
function setWanted(n) {
  var st = window.SB.state;
  if (!st) { return; }
  st.wanted = Math.max(0, Math.min(5, n | 0));
  syncWanted(st);
}

function addMoney(n) {
  var st = window.SB.state;
  if (!st) { return 0; }
  st.money = Math.max(0, st.money + (n | 0));
  return st.money;
}

function addRep(n) {
  var st = window.SB.state;
  if (!st) { return 0; }
  st.rep += (n | 0);
  st.respect += (n | 0);
  updateRespectRank(st);
  return st.rep;
}

function setMission(id, stage, text, reward) {
  var st = window.SB.state;
  if (!st) { return; }
  st.mission = { id: id || null, stage: stage || 0, text: text || '', reward: reward || 0 };
  if (window.SB.HUD && window.SB.HUD.showMission) {
    try { window.SB.HUD.showMission(text); } catch (e) { /* abaikan */ }
  }
  syncHud(st);
}

function getCameraMode() { return cameraMode; }
function setCameraMode(m) { cameraMode = Math.max(0, Math.min(2, m | 0)); }

// ---------------------------------------------------------------------------
// Reputasi distrik (12+ distrik): pengaruhi harga & reaksi NPC
// ---------------------------------------------------------------------------

function getDistrictRep(name) {
  var st = window.SB.state;
  if (!st || !st.districtRep) { return 0; }
  var v = st.districtRep[name];
  return (typeof v === 'number') ? v : 0;
}

function addDistrictRep(name, delta) {
  var st = window.SB.state;
  if (!st) { return 0; }
  if (!st.districtRep) { st.districtRep = {}; }
  var cur = getDistrictRep(name);
  var next = Math.max(0, Math.min(100, cur + (delta | 0)));
  st.districtRep[name] = next;
  return next;
}

function setDistrictRep(name, value) {
  var st = window.SB.state;
  if (!st) { return 0; }
  if (!st.districtRep) { st.districtRep = {}; }
  var next = Math.max(0, Math.min(100, value | 0));
  st.districtRep[name] = next;
  return next;
}

// Pengali harga di distrik: rep tinggi -> diskon (0.85), rep 0 -> harga penuh.
function districtPriceModifier(name) {
  var rep = getDistrictRep(name);
  if (rep >= 80) { return 0.85; }
  if (rep >= 50) { return 0.92; }
  if (rep >= 25) { return 0.97; }
  return 1.0;
}

// Distrik dengan reputasi tertinggi (markas / wilayah kekuasaan pemain).
function topDistrict() {
  var st = window.SB.state;
  if (!st || !st.districtRep) { return 'Sunset Beach'; }
  var best = 'Sunset Beach', bestVal = -1;
  var keys = Object.keys(st.districtRep);
  for (var i = 0; i < keys.length; i++) {
    var v = st.districtRep[keys[i]] || 0;
    if (v > bestVal) { bestVal = v; best = keys[i]; }
  }
  return best;
}

// Rata-rata reputasi semua distrik (0..100).
function averageDistrictRep() {
  var st = window.SB.state;
  if (!st || !st.districtRep) { return 0; }
  var keys = Object.keys(st.districtRep);
  if (!keys.length) { return 0; }
  var sum = 0;
  for (var i = 0; i < keys.length; i++) { sum += st.districtRep[keys[i]] || 0; }
  return Math.round(sum / keys.length);
}

// ---------------------------------------------------------------------------
// Wanted & Heat
// ---------------------------------------------------------------------------

function addHeat(n) {
  var st = window.SB.state;
  if (!st) { return 0; }
  st.heat = Math.max(0, Math.min(100, st.heat + (n | 0)));
  if (st.heat >= 80 && st.wanted < 2) { setWanted(2); }
  else if (st.heat >= 50 && st.wanted < 1) { setWanted(1); }
  return st.heat;
}

function clearWanted() {
  var st = window.SB.state;
  if (!st) { return; }
  st.wanted = 0;
  st.heat = 0;
  syncWanted(st);
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast('Polisi kehilangan jejakmu. Wanted bersih.');
  }
}

// Naik wanted satu tingkat (maks 5). Dipakai saat kejahatan terlihat NPC/polisi.
function raiseWanted() {
  var st = window.SB.state;
  if (!st) { return 0; }
  if (st.wanted < 5) { setWanted(st.wanted + 1); }
  addHeat(15);
  return st.wanted;
}

// ---------------------------------------------------------------------------
// Misi: stage, gagal, dan heist showcase
// ---------------------------------------------------------------------------

function advanceMissionStage() {
  var st = window.SB.state;
  if (!st || !st.mission || !st.mission.id) { return false; }
  if (has('Jobs') && typeof window.SB.Jobs.advanceStage === 'function') {
    try { window.SB.Jobs.advanceStage(); } catch (e) { /* abaikan */ }
  }
  st.mission.stage++;
  syncHud(st);
  return true;
}

function failMission(reason) {
  var st = window.SB.state;
  if (!st) { return false; }
  var msg = 'Misi gagal' + (reason ? ': ' + reason : '.') + ' Coba lagi.';
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast(msg);
  }
  // Misi diulang dari stage 0 (bukan game over).
  if (st.mission) { st.mission.stage = 0; }
  if (has('Jobs') && typeof window.SB.Jobs.startMission === 'function' && st.mission && st.mission.id) {
    try { window.SB.Jobs.startMission(st.mission.id); } catch (e) { /* abaikan */ }
  }
  return true;
}

function startMission(id) {
  var st = window.SB.state;
  if (!st) { return false; }
  var ok = false;
  if (has('Jobs') && typeof window.SB.Jobs.startMission === 'function') {
    try { ok = !!window.SB.Jobs.startMission(id); } catch (e) { ok = false; }
  }
  if (ok) {
    st.mission = { id: id, stage: 0, text: 'Misi ' + id + ' dimulai.', reward: 200 };
    syncHud(st);
  }
  return ok;
}

// Misi heist showcase 3 fase: recon -> eksekusi -> kabur ("The Harbour Lights Job").
function startHeist() {
  return startMission('harbour-lights-job');
}

// ---------------------------------------------------------------------------
// Waktu dunia
// ---------------------------------------------------------------------------

function setTimeOfDay(hour) {
  var st = window.SB.state;
  if (!st) { return; }
  st.timeOfDay = ((hour % 24) + 24) % 24;
  if (window.SB.GL) { window.SB.GL.applyGoldenHour(st.timeOfDay); }
}

function skipToGoldenHour() {
  setTimeOfDay(18.33);
  if (window.SB.HUD && window.SB.HUD.showToast) {
    window.SB.HUD.showToast('Golden hour — 18:20. Matahari terbenam di Sunset Bay.');
  }
}

function skipToNight() {
  setTimeOfDay(21.0);
}

function isNight() {
  var st = window.SB.state;
  if (!st) { return false; }
  if (has('Weather') && typeof window.SB.Weather.isNight === 'function') {
    try { return !!window.SB.Weather.isNight(); } catch (e) { return false; }
  }
  return (st.timeOfDay >= 19.5 || st.timeOfDay < 5.5);
}

function isGoldenHour() {
  var st = window.SB.state;
  if (!st) { return false; }
  return st.timeOfDay >= 17.5 && st.timeOfDay <= 19.5;
}

// ---------------------------------------------------------------------------
// Statistik dunia & validasi state (dipakai QA / layar debug)
// ---------------------------------------------------------------------------

function getWorldStats() {
  var st = window.SB.state;
  var stats = {
    day: st ? st.day : 0, timeOfDay: st ? st.timeOfDay : 0,
    money: st ? st.money : 0, wanted: st ? st.wanted : 0,
    buildings: 0, cars: 0, pedestrians: 0, boats: 0,
    missions: 0, races: 0, crew: st ? st.crew.length : 0,
    businesses: st ? st.businesses.length : 0,
    drawCalls: 0, triangles: 0, frame: frameCount
  };
  if (has('City') && Array.isArray(window.SB.City.buildings)) {
    stats.buildings = window.SB.City.buildings.length;
  }
  if (has('Vehicles') && Array.isArray(window.SB.Vehicles.cars)) {
    stats.cars = window.SB.Vehicles.cars.length;
  }
  if (has('NPC') && Array.isArray(window.SB.NPC.pedestrians)) {
    stats.pedestrians = window.SB.NPC.pedestrians.length;
  }
  if (has('Water') && Array.isArray(window.SB.Water.boats)) {
    stats.boats = window.SB.Water.boats.length;
  }
  if (has('Jobs') && Array.isArray(window.SB.Jobs.missions)) {
    stats.missions = window.SB.Jobs.missions.length;
  }
  if (has('Races') && Array.isArray(window.SB.Races.races)) {
    stats.races = window.SB.Races.races.length;
  }
  if (window.SB.GL && window.SB.GL.getStats) {
    try {
      var s = window.SB.GL.getStats();
      stats.drawCalls = s.drawCalls;
      stats.triangles = s.triangles;
    } catch (e) { /* abaikan */ }
  }
  return stats;
}

// Periksa state sesuai spec: semua field wajib ada dengan tipe benar.
// Mengembalikan array string masalah (kosong = valid).
function validateState() {
  var st = window.SB.state;
  var problems = [];
  if (!st) { problems.push('state hilang'); return problems; }
  var required = ['time', 'timeOfDay', 'day', 'money', 'rep', 'respect',
    'respectRank', 'wanted', 'heat', 'player', 'camera', 'weather',
    'mission', 'crew', 'districtRep', 'businesses', 'race', 'radio',
    'ammo', 'weapon', 'stats', 'flags'];
  for (var i = 0; i < required.length; i++) {
    if (st[required[i]] === undefined) { problems.push('field hilang: ' + required[i]); }
  }
  if (st.player) {
    var pf = ['x', 'y', 'z', 'angle', 'onFoot', 'vehicle', 'hp', 'armor'];
    for (var j = 0; j < pf.length; j++) {
      if (st.player[pf[j]] === undefined) { problems.push('player field hilang: ' + pf[j]); }
    }
  }
  if (st.camera) {
    if (!st.camera.eye || st.camera.eye.x === undefined) { problems.push('camera.eye hilang'); }
    if (!st.camera.look || st.camera.look.x === undefined) { problems.push('camera.look hilang'); }
  }
  if (st.weather) {
    var wf = ['rain', 'rainArea', 'clouds', 'wind', 'puddles'];
    for (var k = 0; k < wf.length; k++) {
      if (st.weather[wf[k]] === undefined) { problems.push('weather field hilang: ' + wf[k]); }
    }
  }
  if (st.stats) {
    var sf = ['kills', 'carsStolen', 'drifts', 'racesWon', 'missionsDone'];
    for (var m = 0; m < sf.length; m++) {
      if (st.stats[sf[m]] === undefined) { problems.push('stats field hilang: ' + sf[m]); }
    }
  }
  if (typeof st.wanted !== 'number' || st.wanted < 0 || st.wanted > 5) {
    problems.push('wanted di luar 0-5: ' + st.wanted);
  }
  if (typeof st.heat !== 'number' || st.heat < 0 || st.heat > 100) {
    problems.push('heat di luar 0-100: ' + st.heat);
  }
  if (typeof st.radio !== 'number' || st.radio < 0 || st.radio > 5) {
    problems.push('radio di luar 0-5: ' + st.radio);
  }
  if (typeof st.weapon !== 'number' || st.weapon < 0 || st.weapon > 3) {
    problems.push('weapon di luar 0-3: ' + st.weapon);
  }
  return problems;
}

// Ringkasan satu baris untuk log QA.
function stateSummary() {
  var st = window.SB.state;
  if (!st) { return 'no-state'; }
  return 'hari ' + st.day + ' ' + formatClock(st.timeOfDay) +
    ' $' + st.money + ' rep ' + st.rep + ' ' + st.respectRank +
    ' wanted ' + st.wanted + ' heat ' + Math.round(st.heat) +
    ' misi ' + (st.mission && st.mission.id ? st.mission.id : '-') +
    ' stage ' + (st.mission ? st.mission.stage : 0);
}

// ---------------------------------------------------------------------------
// Screenshot & event kecil
// ---------------------------------------------------------------------------

function takeShot(name) {
  if (has('Shots') && typeof window.SB.Shots.take === 'function') {
    try { return window.SB.Shots.take(name || 'shot'); } catch (e) { return null; }
  }
  return null;
}

// Teleport pemain (dipakai misi / debug / respawn aman).
function teleportPlayer(x, z) {
  var st = window.SB.state;
  if (!st) { return false; }
  st.player.x = x || 0;
  st.player.z = z || 0;
  st.player.y = 0;
  cameraEye = { x: st.player.x, y: 8, z: st.player.z + 12 };
  cameraTarget = { x: st.player.x, y: 1, z: st.player.z };
  return true;
}

// ---------------------------------------------------------------------------
// Ekspor API (wajib spec: init, frame, save, load, pause, resume, state)
// ---------------------------------------------------------------------------
window.SB.Game = {
  init: init, frame: frame, save: save, load: load,
  pause: pause, resume: resume, reset: reset,
  state: window.SB.state,
  hasSave: hasSave, clearSave: clearSave,
  isPaused: isPaused, isStarted: isStarted, isInitialized: isInitialized,
  getFrameCount: getFrameCount, setWanted: setWanted,
  addMoney: addMoney, addRep: addRep, setMission: setMission,
  getCameraMode: getCameraMode, setCameraMode: setCameraMode,
  updateCamera: updateCamera, syncHud: syncHud,
  formatClock: formatClock,
  getDistrictRep: getDistrictRep, addDistrictRep: addDistrictRep,
  setDistrictRep: setDistrictRep, districtPriceModifier: districtPriceModifier,
  topDistrict: topDistrict, averageDistrictRep: averageDistrictRep,
  addHeat: addHeat, clearWanted: clearWanted, raiseWanted: raiseWanted,
  advanceMissionStage: advanceMissionStage, failMission: failMission,
  startMission: startMission, startHeist: startHeist,
  setTimeOfDay: setTimeOfDay, skipToGoldenHour: skipToGoldenHour,
  skipToNight: skipToNight, isNight: isNight, isGoldenHour: isGoldenHour,
  getWorldStats: getWorldStats, validateState: validateState,
  stateSummary: stateSummary, takeShot: takeShot,
  teleportPlayer: teleportPlayer
};
})();

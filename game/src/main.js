window.SB = window.SB || {};
(function(){ 'use strict';
// ============================================================================
// main.js — boot + input + game loop untuk Sunset Bay
// Tugas file ini SAJA:
//   1. Boot: tunggu DOM, cari kanvas, panggil SB.Game.init().
//   2. Input: keyboard, mouse, tombol sentuh (data-key di index.html).
//   3. Loop: requestAnimationFrame, dt dijepit, panggil SB.Game.frame(dt).
// File ini TIDAK menggambar scene / mengupdate modul — itu milik SB.Game.
// Input diekspos lewat SB.Input agar SB.Player / SB.Vehicles membacanya.
// ============================================================================

var canvas = null;
var started = false;
var running = false;
var paused = false;
var rafId = 0;
var lastTime = 0;
var elapsed = 0;
var frameNumber = 0;
var fpsSamples = [];
var fpsValue = 0;
var fpsTimer = 0;
var bootError = null;
var bootDone = false;
var saveAvailable = false;
var pointerLocked = false;
var mouseDX = 0;
var mouseDY = 0;
var mouseDown = false;
var mouseX = 0;
var mouseY = 0;
var wheelDelta = 0;
var lastSaveCheck = 0;

// --- Input state (dibaca modul lain lewat SB.Input / SB.state.input) --------
var keys = {};            // code -> true bila ditekan
var keysPressed = {};     // code -> true hanya pada frame ditekan
var keysReleased = {};    // code -> true hanya pada frame dilepas
var touchKeys = {};       // code -> true bila tombol sentuh aktif

var KEY_ALIASES = {
  'ArrowUp': 'KeyW', 'ArrowDown': 'KeyS',
  'ArrowLeft': 'KeyA', 'ArrowRight': 'KeyD'
};

// Aksi yang dipetakan dari tombol (dipakai SB.Player / SB.Game).
var ACTION_KEYS = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'], jump: ['Space'],
  interact: ['KeyE'], shoot: ['KeyF', 'Mouse0'],
  camera: ['KeyC'], radio: ['KeyM'], pause: ['KeyP', 'Escape'],
  horn: ['KeyH'], reload: ['KeyR'], weapon1: ['Digit1'],
  weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'],
  map: ['KeyM'], mute: ['KeyN'], screenshot: ['KeyG']
};

function isDown(code) {
  return !!(keys[code] || touchKeys[code]);
}

function isPressed(code) {
  return !!keysPressed[code];
}

function isReleased(code) {
  return !!keysReleased[code];
}

function actionDown(name) {
  var list = ACTION_KEYS[name] || [];
  for (var i = 0; i < list.length; i++) {
    if (isDown(list[i])) { return true; }
  }
  return false;
}

function actionPressed(name) {
  var list = ACTION_KEYS[name] || [];
  for (var i = 0; i < list.length; i++) {
    if (isPressed(list[i])) { return true; }
  }
  return false;
}

// Sumbu gerak -1..1 dari WASD / panah (x = kanan, y = maju).
function moveAxis() {
  var x = 0, y = 0;
  if (actionDown('right')) { x += 1; }
  if (actionDown('left')) { x -= 1; }
  if (actionDown('forward')) { y += 1; }
  if (actionDown('back')) { y -= 1; }
  return { x: x, y: y };
}

function clearPressed() {
  keysPressed = {};
  keysReleased = {};
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;
}

function getMouseDelta() {
  var d = { x: mouseDX, y: mouseDY };
  mouseDX = 0;
  mouseDY = 0;
  return d;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function hideLoading() {
  var el = $('hud-loading');
  if (el) { el.style.display = 'none'; }
}

function showStart() {
  var el = $('screen-start');
  if (el) { el.style.display = 'flex'; }
  var pauseEl = $('screen-pause');
  if (pauseEl) { pauseEl.style.display = 'none'; }
  var endEl = $('screen-end');
  if (endEl) { endEl.style.display = 'none'; }
}

function showPause() {
  var el = $('screen-pause');
  if (el) { el.style.display = 'flex'; }
}

function hidePause() {
  var el = $('screen-pause');
  if (el) { el.style.display = 'none'; }
}


function updateContinueButton() {
  var btn = $('btn-continue');
  if (!btn) { return; }
  try {
    saveAvailable = !!window.localStorage.getItem('sunset-bay-save-v1');
  } catch (e) {
    saveAvailable = false;
  }
  btn.style.display = saveAvailable ? '' : 'none';
  btn.disabled = !saveAvailable;
}

function reportBootError(msg) {
  bootError = msg;
  hideLoading();
  var el = $('screen-start');
  if (el) {
    el.style.display = 'flex';
    var sub = el.querySelector('.game-sub');
    if (sub) { sub.textContent = 'Gagal memuat: ' + msg + ' — coba muat ulang halaman.'; }
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[Sunset Bay] boot gagal: ' + msg);
  }
}

function checkModules() {
  var missing = [];
  var need = ['Math3', 'Rng', 'GL', 'Meshes', 'City', 'Water', 'Vehicles',
    'Player', 'NPC', 'Police', 'Crew', 'Economy', 'Races', 'Weather',
    'FX', 'Audio', 'HUD', 'Jobs', 'Shots', 'Game'];
  for (var i = 0; i < need.length; i++) {
    if (!window.SB[need[i]]) { missing.push(need[i]); }
  }
  return missing;
}

function boot() {
  if (bootDone) { return; }
  bootDone = true;
  canvas = $('game-canvas');
  if (!canvas) { reportBootError('kanvas game tidak ditemukan'); return; }
  var missing = checkModules();
  if (missing.length) {
    reportBootError('modul belum termuat: ' + missing.join(', '));
    return;
  }
  var ok = false;
  try {
    ok = window.SB.Game.init();
  } catch (err) {
    reportBootError('SB.Game.init() error: ' + (err && err.message ? err.message : err));
    return;
  }
  if (ok === false) {
    reportBootError('SB.Game.init() mengembalikan false (WebGL mungkin tidak tersedia)');
    return;
  }
  bindInput();
  bindButtons();
  updateContinueButton();
  hideLoading();
  showStart();
  lastTime = performance.now();
  // Loop berjalan di latar agar layar start sudah menampilkan scene
  // (kota golden hour di belakang judul) sebelum pemain menekan MULAI.
  running = true;
  rafId = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Input: keyboard
// ---------------------------------------------------------------------------

function onKeyDown(e) {
  var code = KEY_ALIASES[e.code] || e.code;
  if (!keys[code]) { keysPressed[code] = true; }
  keys[code] = true;
  if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown') {
    if (e.target === document.body || e.target === canvas) { e.preventDefault(); }
  }
  // Pause toggle: P atau Escape (hanya setelah game dimulai).
  if ((code === 'KeyP' || code === 'Escape') && started && !e.repeat) {
    togglePause();
  }
  // M: ganti radio — diteruskan ke SB.Game lewat keysPressed.
  // R: isi ulang amunisi, G: screenshot — ditangani SB.Game.frame.
  // Enter di layar start = mulai.
  if (code === 'Enter' && !started) { startGame(false); }
  if (code === 'Enter' && paused) { resumeGame(); }
}

function onKeyUp(e) {
  var code = KEY_ALIASES[e.code] || e.code;
  keys[code] = false;
  keysReleased[code] = true;
}

function onBlur() {
  // Kehilangan fokus = semua tombol dilepas (hindari pemain "nyangkut").
  keys = {};
  touchKeys = {};
  mouseDown = false;
  if (started && !paused) {
    // Auto-pause saat tab ditinggalkan? Tidak otomatis — hanya catat.
  }
}

// ---------------------------------------------------------------------------
// Input: mouse + pointer lock
// ---------------------------------------------------------------------------

function onMouseMove(e) {
  mouseX = e.clientX;
  mouseY = e.clientY;
  if (pointerLocked) {
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  } else {
    mouseDX += e.movementX || 0;
    mouseDY += e.movementY || 0;
  }
}

function onMouseDown(e) {
  mouseDown = true;
  keys['Mouse' + e.button] = true;
  keysPressed['Mouse' + e.button] = true;
  if (started && !paused && canvas) {
    // Klik pertama mengunci pointer agar kamera bisa digerakkan mouse.
    requestPointerLock();
  }
}

function onMouseUp(e) {
  mouseDown = false;
  keys['Mouse' + e.button] = false;
  keysReleased['Mouse' + e.button] = true;
}

function onWheel(e) {
  wheelDelta += e.deltaY || 0;
  if (e.target === canvas) { e.preventDefault(); }
}

function onContextMenu(e) {
  if (e.target === canvas) { e.preventDefault(); }
}

function requestPointerLock() {
  if (!canvas || pointerLocked) { return; }
  try {
    if (canvas.requestPointerLock) {
      var p = canvas.requestPointerLock();
      if (p && p.catch) { p.catch(function() { /* pointer lock ditolak: abaikan */ }); }
    }
  } catch (err) { /* abaikan */ }
}

function exitPointerLock() {
  try {
    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  } catch (err) { /* abaikan */ }
}

function onPointerLockChange() {
  pointerLocked = (document.pointerLockElement === canvas);
}

// ---------------------------------------------------------------------------
// Input: tombol sentuh (layar sentuh / mobile)
// ---------------------------------------------------------------------------

function bindTouchButtons() {
  var btns = document.querySelectorAll('#touch-controls .tbtn');
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      var code = btn.getAttribute('data-key');
      if (!code) { return; }
      function press(e) {
        if (e) { e.preventDefault(); }
        if (!touchKeys[code]) { keysPressed[code] = true; }
        touchKeys[code] = true;
      }
      function release(e) {
        if (e) { e.preventDefault(); }
        touchKeys[code] = false;
        keysReleased[code] = true;
      }
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
    })(btns[i]);
  }
}

function bindInput() {
  window.addEventListener('keydown', onKeyDown, false);
  window.addEventListener('keyup', onKeyUp, false);
  window.addEventListener('blur', onBlur, false);
  document.addEventListener('mousemove', onMouseMove, false);
  if (canvas) {
    canvas.addEventListener('mousedown', onMouseDown, false);
    canvas.addEventListener('mouseup', onMouseUp, false);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu, false);
  }
  document.addEventListener('pointerlockchange', onPointerLockChange, false);
  document.addEventListener('visibilitychange', onVisibilityChange, false);
  window.addEventListener('resize', onResize, false);
  bindTouchButtons();
}

function onVisibilityChange() {
  if (document.hidden && started && !paused) {
    // Tab disembunyikan: jeda otomatis agar pemain tidak dirugikan.
    pauseGame();
  }
}

function onResize() {
  if (window.SB.GL && window.SB.GL.resize) { window.SB.GL.resize(); }
}

// ---------------------------------------------------------------------------
// Tombol layar (start / pause / end)
// ---------------------------------------------------------------------------

function bindButtons() {
  var startBtn = $('btn-start');
  if (startBtn) { startBtn.addEventListener('click', function() { startGame(false); }); }
  var contBtn = $('btn-continue');
  if (contBtn) { contBtn.addEventListener('click', function() { startGame(true); }); }
  var resumeBtn = $('btn-resume');
  if (resumeBtn) { resumeBtn.addEventListener('click', function() { resumeGame(); }); }
  var saveBtn = $('btn-save-quit');
  if (saveBtn) {
    saveBtn.addEventListener('click', function() {
      if (window.SB.Game && window.SB.Game.save) { window.SB.Game.save(); }
      paused = false;
      hidePause();
      exitPointerLock();
      showStart();
      updateContinueButton();
    });
  }
  var againBtn = $('btn-again');
  if (againBtn) { againBtn.addEventListener('click', function() { startGame(false); }); }
}

function startGame(fromSave) {
  if (started && !paused) { return; }
  started = true;
  paused = false;
  hidePause();
  var startEl = $('screen-start');
  if (startEl) { startEl.style.display = 'none'; }
  var endEl = $('screen-end');
  if (endEl) { endEl.style.display = 'none'; }
  if (fromSave) {
    try {
      if (window.SB.Game && window.SB.Game.load) { window.SB.Game.load(); }
    } catch (err) { /* save rusak: lanjut dengan state baru */ }
  } else {
    // Mulai baru: reset progress bila game sudah pernah berjalan.
    if (window.SB.Game && window.SB.Game.reset && frameNumber > 10) {
      window.SB.Game.reset();
    }
  }
  if (window.SB.Game && window.SB.Game.resume) { window.SB.Game.resume(); }
  if (window.SB.Audio && window.SB.Audio.init) {
    // AudioContext butuh gestur pengguna; init dipanggil di sini (klik).
    try { window.SB.Audio.init(window.SB.state); } catch (err) { /* abaikan */ }
  }
  requestPointerLock();
  lastTime = performance.now();
}

function pauseGame() {
  if (!started || paused) { return; }
  paused = true;
  if (window.SB.Game && window.SB.Game.pause) { window.SB.Game.pause(); }
  showPause();
  exitPointerLock();
}

function resumeGame() {
  if (!started || !paused) { return; }
  paused = false;
  hidePause();
  if (window.SB.Game && window.SB.Game.resume) { window.SB.Game.resume(); }
  requestPointerLock();
  lastTime = performance.now();
}

function togglePause() {
  if (paused) { resumeGame(); } else { pauseGame(); }
}


// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

function loop(now) {
  if (!running) { return; }
  rafId = requestAnimationFrame(loop);
  var t = (typeof now === 'number') ? now : performance.now();
  var rawDt = (t - lastTime) / 1000;
  lastTime = t;
  // Jepit dt: tab yang ditinggal lama tidak membuat simulasi melompat.
  // 0.05 = 20 fps minimum; di bawah itu game melambat, bukan melompat.
  var dt = rawDt;
  if (!(dt > 0)) { dt = 0; }
  if (dt > 0.05) { dt = 0.05; }
  if (dt < 0.0001 && started && !paused) { dt = 0.0001; }
  elapsed += dt;
  frameNumber++;
  // FPS: rata-rata bergerak dari 30 sampel terakhir.
  fpsTimer += rawDt;
  fpsSamples.push(rawDt > 0 ? 1 / rawDt : 60);
  if (fpsSamples.length > 30) { fpsSamples.shift(); }
  if (fpsTimer >= 0.5) {
    var sum = 0;
    for (var i = 0; i < fpsSamples.length; i++) { sum += fpsSamples[i]; }
    fpsValue = fpsSamples.length ? Math.round(sum / fpsSamples.length) : 0;
    fpsTimer = 0;
    updateFpsHud();
  }
  // Frame game (hanya bila tidak pause; saat pause, Game.frame dilewati
  // agar simulasi berhenti tapi loop tetap jalan untuk overlay).
  if (started && !paused) {
    try {
      window.SB.Game.frame(dt);
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[Sunset Bay] frame error: ' + (err && err.message ? err.message : err));
      }
      // Satu frame gagal tidak boleh mematikan loop: lanjut frame berikut.
    }
  } else if (!started) {
    // Layar start: render scene latar (attract mode) dengan dt kecil.
    try {
      window.SB.Game.frame(dt * 0.25);
    } catch (err) { /* abaikan di attract mode */ }
  }
  // Input per-frame dibersihkan SETELAH Game.frame membacanya.
  clearPressed();
  // Autosave ringan tiap ~60 detik saat bermain.
  if (started && !paused && elapsed - lastSaveCheck > 60) {
    lastSaveCheck = elapsed;
    try {
      if (window.SB.Game && window.SB.Game.save) { window.SB.Game.save(); }
    } catch (err) { /* autosave gagal: abaikan */ }
  }
}

function updateFpsHud() {
  var el = $('hud-fps');
  if (!el) { return; }
  el.textContent = fpsValue + ' fps';
}


function getFps() { return fpsValue; }
function isStarted() { return started; }
function isPaused() { return paused; }

// ---------------------------------------------------------------------------
// Util: pindah layar & status (dipakai HUD / Game)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Ekspor input (SB.Input) + mulai boot saat DOM siap
// ---------------------------------------------------------------------------
window.SB.Input = {
  isDown: isDown, isPressed: isPressed, isReleased: isReleased,
  actionDown: actionDown, actionPressed: actionPressed,
  moveAxis: moveAxis, getMouseDelta: getMouseDelta,
  getMousePos: function() { return { x: mouseX, y: mouseY }; },
  isMouseDown: function() { return mouseDown; },
  getWheelDelta: function() { return wheelDelta; },
  isPointerLocked: function() { return pointerLocked; },
  requestPointerLock: requestPointerLock, exitPointerLock: exitPointerLock,
  keys: keys
};

window.SB.Main = {
  boot: boot, startGame: startGame, pauseGame: pauseGame,
  resumeGame: resumeGame, togglePause: togglePause,
  getFps: getFps, isStarted: isStarted, isPaused: isPaused,
  showStart: showStart, showPause: showPause,
  hidePause: hidePause
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, false);
} else {
  boot();
}
})();

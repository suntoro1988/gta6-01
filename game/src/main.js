window.SB = window.SB || {};
// main.js — Sunset Bay v12 (Builder B: graphics engine)
// Boot + game loop + input. Satu-satunya tugas file ini:
//   1. init canvas & panggil SB.Game.init()
//   2. requestAnimationFrame dengan dt ter-clamp
//   3. kumpulkan input keyboard/mouse/touch -> SB.input
//   4. panggil SB.Game.frame(dt) tiap frame
// Logika game TIDAK ada di sini — semuanya di SB.Game & modul lain.
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Input bersama — dibaca SB.Game.frame -> modul (khususnya Player)
  // ------------------------------------------------------------------
  // SB.input: { keys:Set kode tombol, axes:{x,y}, mouse:{x,y,dx,dy,down},
  //   pressed:Set (sekali per frame), touch:{...}, sprint, brake }
  var input = {
    keys: {},
    pressed: {},
    axes: { x: 0, y: 0 },       // -1..1, dari WASD / panah
    mouse: { x: 0, y: 0, dx: 0, dy: 0, down: false, moved: false },
    touch: { active: false, sx: 0, sy: 0, x: 0, y: 0 },
    sprint: false,
    brake: false,
    interact: false,            // E ditekan (edge)
    shootHeld: false,
    wheel: 0,
    anyKey: false
  };

  // Peta kode tombol -> aksi (dipakai game.js untuk aksi sekali tekan).
  var ACTION_KEYS = {
    KeyE: 'interact',       // curi mobil / masuk kendaraan
    KeyF: 'enterExit',      // keluar kendaraan (alternatif E)
    KeyR: 'radio',          // ganti stasiun radio
    KeyM: 'missions',       // buka/tutup panel misi
    KeyQ: 'weaponPrev',     // senjata sebelumnya
    Digit1: 'weapon0', Digit2: 'weapon1', Digit3: 'weapon2', Digit4: 'weapon3',
    KeyB: 'buyAmmo',        // beli amunisi $50/+24
    KeyC: 'camera',         // ganti sudut kamera
    KeyH: 'horn',           // klakson
    KeyP: 'pause',          // pause (alternatif Esc)
    KeyG: 'crewCommand',    // perintah crew (siklus)
    KeyT: 'phone',          // ponsel / peta cepat
    KeyL: 'lights'          // lampu mobil
  };

  var started = false;
  var booted = false;
  var lastTime = 0;
  var fpsSamples = [];
  var fps = 0;
  var fpsBadgeEl = null;
  var pausedByVisibility = false;

  // Alias tombol huruf kecil — modul Player/Vehicles/Water membaca
  // input.keys dengan kunci 'w'/'a'/'s'/'d'/'space'/'shift'/'arrow*',
  // sementara keydown menyimpan e.code ('KeyW', 'Space', ...).
  // Tanpa alias ini WASD di keyboard nyata tidak menggerakkan apa pun.
  var KEY_ALIASES = {
    KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
    Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift',
    ArrowUp: 'arrowup', ArrowDown: 'arrowdown',
    ArrowLeft: 'arrowleft', ArrowRight: 'arrowright'
  };
  function setKeyAliases(code, down) {
    var a = KEY_ALIASES[code];
    if (a) input.keys[a] = down;
    if (code === 'Space') input.keys[' '] = down;
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function boot() {
    if (booted) return;
    booted = true;

    var canvas = document.getElementById('game-canvas');
    if (!canvas) {
      showFatal('Canvas #game-canvas tidak ditemukan.');
      return;
    }

    // Cek modul wajib sudah termuat (urutan script di index.html).
    var missing = [];
    ['Math3', 'Rng', 'GL', 'Game'].forEach(function (name) {
      if (!window.SB[name]) missing.push(name);
    });
    if (missing.length) {
      showFatal('Modul belum termuat: ' + missing.join(', ') +
        '. Periksa urutan <script> di index.html.');
      return;
    }

    // Ekspos input ke namespace agar modul bisa membacanya.
    window.SB.input = input;

    // Init WebGL lewat SB.GL, lalu game lewat SB.Game.init.
    var glOk = true;
    try {
      glOk = window.SB.GL.init(canvas);
    } catch (err) {
      glOk = false;
      showFatal('WebGL gagal start: ' + (err && err.message ? err.message : err));
      return;
    }
    if (glOk === false) {
      showFatal('WebGL tidak tersedia di browser ini. Coba browser lain.');
      return;
    }

    try {
      window.SB.Game.init(canvas);
    } catch (err) {
      showFatal('Game.init gagal: ' + (err && err.message ? err.message : err));
      return;
    }

    bindInput(canvas);
    bindButtons();
    bindResize();

    fpsBadgeEl = document.getElementById('fps-badge');

    // Muat save lama (kalau ada) supaya tombol CONTINUE bisa aktif.
    var hasSave = false;
    try {
      hasSave = !!window.localStorage.getItem('sunset-bay-save-v12');
    } catch (e) { hasSave = false; }
    var contBtn = document.getElementById('continue-btn');
    if (contBtn && !hasSave) {
      contBtn.style.opacity = '0.45';
      contBtn.title = 'Belum ada save v12 di browser ini';
    }

    // Loop mulai berjalan begitu tombol START ditekan; sebelum itu
    // game.js menggambar adegan latar (attract mode) di belakang overlay.
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  function showFatal(msg) {
    var note = document.getElementById('loading-note');
    if (note) {
      note.textContent = msg;
      note.style.color = '#ff8a96';
    }
    if (typeof console !== 'undefined' && console.error) {
      console.error('[SB.main] ' + msg);
    }
  }

  // ------------------------------------------------------------------
  // Game loop — dt di-clamp agar tab yang lama tidak aktif tidak
  // melempar simulasi (maks 50 ms per frame).
  // ------------------------------------------------------------------
  function loop(now) {
    requestAnimationFrame(loop);
    var dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;      // clamp: maks 50 ms
    if (dt < 0.001) dt = 0.001;

    trackFps(now, dt);

    // Update axes dari tombol yang sedang ditekan.
    updateAxes();

    // Klik kiri ditahan = tembak. Player.shoot() punya cooldown
    // sendiri per senjata, jadi menahan klik = tembak otomatis.
    // (Sebelumnya shootHeld tidak pernah dibaca siapa pun.)
    if (input.shootHeld && window.SB.Player && window.SB.Player.shoot) {
      try { window.SB.Player.shoot(); } catch (err) { /* abaikan */ }
    }

    try {
      if (window.SB.Game && window.SB.Game.frame) {
        window.SB.Game.frame(dt);
      }
    } catch (err) {
      // Jangan matikan loop karena satu frame error; laporkan sekali.
      if (!loop._reported) {
        loop._reported = true;
        if (typeof console !== 'undefined' && console.error) {
          console.error('[SB.main] frame error:', err);
        }
      }
    }

    // Bersihkan edge-trigger per frame SETELAH game membacanya.
    clearPressed();
    input.mouse.dx = 0;
    input.mouse.dy = 0;
    input.mouse.moved = false;
    input.wheel = 0;
  }

  function trackFps(now, dt) {
    fpsSamples.push(1 / Math.max(dt, 0.001));
    if (fpsSamples.length > 40) fpsSamples.shift();
    if (fpsSamples.length === 40) {
      var sum = 0;
      for (var i = 0; i < fpsSamples.length; i++) sum += fpsSamples[i];
      fps = Math.round(sum / fpsSamples.length);
      if (fpsBadgeEl) {
        fpsBadgeEl.textContent = fps + ' fps · v12';
      }
      fpsSamples.length = 0;
    }
  }

  // ------------------------------------------------------------------
  // Input keyboard
  // ------------------------------------------------------------------
  function bindInput(canvas) {
    window.addEventListener('keydown', function (e) {
      // Tab dipakai untuk peta — cegah fokus pindah.
      if (e.code === 'Tab') e.preventDefault();
      // Space scroll halaman — cegah.
      if (e.code === 'Space') e.preventDefault();
      // F5 / Ctrl+R biarkan lewat (reload).
      if (e.ctrlKey || e.metaKey) return;

      var code = e.code;
      if (!input.keys[code]) {
        input.pressed[code] = true;
        input.anyKey = true;
        handleActionPress(code);
      }
      input.keys[code] = true;
      setKeyAliases(code, true);

      // Esc: pause toggle langsung di sini (game.js juga menanganinya).
      // KeyP TIDAK di sini: sudah dipetakan di ACTION_KEYS -> queueAction
      // ('pause') -> game.js togglePause. Dua jalur = toggle dua kali
      // (pause langsung batal lagi), jadi P dulu tidak pernah pause.
      if (code === 'Escape') {
        if (started && window.SB.Game && window.SB.Game.togglePause) {
          window.SB.Game.togglePause();
        }
      }
    });

    window.addEventListener('keyup', function (e) {
      input.keys[e.code] = false;
      setKeyAliases(e.code, false);
    });

    window.addEventListener('blur', function () {
      // Lepas semua tombol saat jendela kehilangan fokus.
      input.keys = {};
      input.shootHeld = false;
      input.mouse.down = false;
    });

    // ---- Mouse: arahkan kamera (drag) + tembak (klik kiri) ----
    canvas.addEventListener('mousedown', function (e) {
      input.mouse.down = true;
      input.mouse.x = e.clientX;
      input.mouse.y = e.clientY;
      if (e.button === 0) {
        input.shootHeld = true;
        input.pressed.MouseLeft = true;
      }
      if (e.button === 2) input.pressed.MouseRight = true;
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.shootHeld = false;
      input.mouse.down = false;
    });
    window.addEventListener('mousemove', function (e) {
      var nx = e.clientX, ny = e.clientY;
      input.mouse.dx = nx - input.mouse.x;
      input.mouse.dy = ny - input.mouse.y;
      input.mouse.x = nx;
      input.mouse.y = ny;
      input.mouse.moved = true;
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('wheel', function (e) {
      input.wheel += (e.deltaY > 0 ? 1 : -1);
      e.preventDefault();
    }, { passive: false });

    // ---- Touch: joystick virtual kiri + drag kamera kanan ----
    var touchStart = null;
    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.45 && !input.touch.active) {
          input.touch.active = true;
          input.touch.sx = t.clientX; input.touch.sy = t.clientY;
          input.touch.x = t.clientX; input.touch.y = t.clientY;
        } else {
          touchStart = { x: t.clientX, y: t.clientY, id: t.identifier };
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (input.touch.active && t.clientX < window.innerWidth * 0.5) {
          input.touch.x = t.clientX; input.touch.y = t.clientY;
        } else if (touchStart && t.identifier === touchStart.id) {
          input.mouse.dx += t.clientX - touchStart.x;
          input.mouse.dy += t.clientY - touchStart.y;
          input.mouse.moved = true;
          touchStart.x = t.clientX; touchStart.y = t.clientY;
        }
      }
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touchStart && t.identifier === touchStart.id) touchStart = null;
      }
      if (e.touches.length === 0) {
        input.touch.active = false;
        input.touch.x = input.touch.sx; input.touch.y = input.touch.sy;
      }
    });

    // Pause otomatis saat tab disembunyikan (hemat baterai & adil).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && started && window.SB.Game) {
        if (window.SB.Game.pause && !window.SB.Game.isPaused()) {
          window.SB.Game.pause();
          pausedByVisibility = true;
        }
      } else if (!document.hidden && pausedByVisibility && window.SB.Game) {
        pausedByVisibility = false;
        // Jangan auto-resume: biarkan pemain menekan RESUME sendiri.
      }
    });
  }

  // Aksi sekali tekan: teruskan ke game.js lewat antrian aksi.
  function handleActionPress(code) {
    var action = ACTION_KEYS[code];
    if (!action) return;
    if (window.SB.Game && window.SB.Game.queueAction) {
      window.SB.Game.queueAction(action);
    }
    if (action === 'interact') input.interact = true;
  }

  // Hitung axes gerak dari tombol yang sedang ditekan.
  function updateAxes() {
    var k = input.keys;
    var x = 0, y = 0;
    if (k.KeyW || k.ArrowUp) y += 1;
    if (k.KeyS || k.ArrowDown) y -= 1;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    // Joystick sentuh menimpa keyboard bila aktif.
    if (input.touch.active) {
      var dx = input.touch.x - input.touch.sx;
      var dy = input.touch.y - input.touch.sy;
      var dead = 14;
      if (Math.abs(dx) > dead || Math.abs(dy) > dead) {
        x = Math.max(-1, Math.min(1, dx / 60));
        y = Math.max(-1, Math.min(1, -dy / 60));
      }
    }
    input.axes.x = x;
    input.axes.y = y;
    input.sprint = !!(k.ShiftLeft || k.ShiftRight);
    input.brake = !!(k.Space);
  }

  function clearPressed() {
    input.pressed = {};
    input.interact = false;
    input.anyKey = false;
  }

  // ------------------------------------------------------------------
  // Tombol overlay (START / CONTINUE / RESUME / SAVE)
  // ------------------------------------------------------------------
  function bindButtons() {
    var startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        startGame(false);
      });
    }
    var contBtn = document.getElementById('continue-btn');
    if (contBtn) {
      contBtn.addEventListener('click', function () {
        startGame(true);
      });
    }
    var resumeBtn = document.getElementById('resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', function () {
        if (window.SB.Game && window.SB.Game.resume) window.SB.Game.resume();
      });
    }
    var saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (window.SB.Game && window.SB.Game.save) {
          var ok = window.SB.Game.save();
          saveBtn.textContent = ok ? 'SAVED ✓' : 'SAVE FAILED';
          setTimeout(function () { saveBtn.textContent = 'SAVE GAME'; }, 1600);
        }
      });
    }
    // Enter di layar start = mulai.
    window.addEventListener('keydown', function (e) {
      if (!started && e.code === 'Enter') startGame(false);
    });
  }

  function startGame(continueSave) {
    var overlay = document.getElementById('start-overlay');
    if (overlay) overlay.classList.add('hidden');
    started = true;
    window.SB.started = true;
    if (continueSave && window.SB.Game && window.SB.Game.load) {
      window.SB.Game.load();
    }
    if (window.SB.Game && window.SB.Game.resume) {
      window.SB.Game.resume();
    }
    // Audio butuh gestur pengguna: init/resume konteks audio di sini.
    if (window.SB.Audio && window.SB.Audio.unlock) {
      try { window.SB.Audio.unlock(); } catch (e) { /* abaikan */ }
    }
    var canvas = document.getElementById('game-canvas');
    if (canvas) canvas.focus();
  }

  // ------------------------------------------------------------------
  // Resize: canvas fullscreen mengikuti jendela
  // ------------------------------------------------------------------
  function bindResize() {
    var t = null;
    window.addEventListener('resize', function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        if (window.SB.GL && window.SB.GL.resize) window.SB.GL.resize();
        if (window.SB.Game && window.SB.Game.onResize) window.SB.Game.onResize();
      }, 80);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        if (window.SB.GL && window.SB.GL.resize) window.SB.GL.resize();
      }, 200);
    });
  }

  // ------------------------------------------------------------------
  // Ekspor kecil (debug / game.js)
  // ------------------------------------------------------------------
  window.SB.Main = {
    boot: boot,
    get input() { return input; },
    get fps() { return fps; },
    get started() { return started; },
    startGame: startGame
  };

  // Boot saat DOM siap (script dimuat di akhir body, jadi biasanya
  // DOM sudah siap; tetap jaga jalur readyState).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

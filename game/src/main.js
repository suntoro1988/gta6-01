// Sunset Bay — bootstrap & game loop (SB.Main).
// Modul ini yang pertama kali "menghidupkan" game: mengikat canvas ke
// WebGL, menjalankan loop requestAnimationFrame, menggambar HUD + minimap,
// menangani menu (Start / Continue / How to Play), pause, dan semua input
// keyboard/mouse. Semua sistem lain dipanggil lewat namespace SB — modul
// ini tidak tahu isi dalam mereka, hanya kontrak interface di design spec.
window.SB = window.SB || {};

SB.Main = {
  canvas: null,
  minimap: null,
  running: false,
  started: false,
  paused: false,
  lastTime: 0,
  input: {},
  mouse: { dx: 0, dy: 0, locked: false, down: false },
  cameraYaw: 0.6,
  cameraPitch: 0.35,
  cameraDistance: 9,
  fps: 0,
  fpsFrames: 0,
  fpsTime: 0,
  toastTimer: null,

  // Titik masuk dari index.html (dipanggil setelah semua modul terdaftar).
  start: function () {
    var cfg = SB.Config;
    this.canvas = document.getElementById('game');
    this.minimap = document.getElementById('minimap');
    if (!this.canvas) {
      console.error('SB.Main: canvas #game tidak ditemukan');
      return;
    }

    // WebGL lewat SB.GL. Bila gagal, tampilkan pesan jelas, bukan layar hitam.
    if (SB.GL && typeof SB.GL.init === 'function') {
      try {
        SB.GL.init(this.canvas);
      } catch (err) {
        this.showFatal('WebGL tidak tersedia di browser ini: ' + err.message);
        return;
      }
    } else {
      this.showFatal('Modul SB.GL belum terdaftar.');
      return;
    }

    this.bindMenu();
    this.bindInput();
    this.updateContinueButton();
    this.showMenu();

    // Muat save lama (bila ada) supaya tombol Continue tahu statusnya,
    // tapi JANGAN mulai permainan sebelum pemain menekan Start/Continue.
    if (SB.Game && typeof SB.Game.load === 'function') {
      try {
        SB.Game.load();
      } catch (err) {
        console.warn('SB.Main: save lama tidak bisa dibaca, mulai dari awal', err);
      }
    }

    this.running = true;
    this.lastTime = performance.now();
    var self = this;
    var loop = function (now) {
      if (!self.running) return;
      self.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  // Satu frame: hitung dt, update dunia, render, lalu HUD + minimap.
  frame: function (now) {
    var dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05;
    if (dt <= 0) dt = 0.001;

    this.updateFps(dt);

    if (this.started && !this.paused) {
      this.update(dt);
    }

    this.render();
    this.updateHud();
    this.drawMinimap();
    this.checkEndStates();
  },

  update: function (dt) {
    // SATU jalur update: SB.Game.update sudah memanggil Player,
    // Vehicles, Missions, World, Weather, NPC, Police, Crew, Races,
    // Heist, FX, dan Water. Memanggil mereka lagi di sini membuat
    // semua sistem jalan 2x per frame, dan input tidak pernah sampai
    // ke Vehicles (nyetir mati). Jadi teruskan input ke Game saja.
    if (SB.Game && SB.Game.update) SB.Game.update(dt, this.input);

    // Kamera mengikuti pemain (atau mobilnya) dari belakang.
    this.updateCamera(dt);

    // Input sekali-tekan: curi mobil, respray, ganti senjata, radio.
    this.handleActionKeys();
  },

  updateCamera: function (dt) {
    var state = SB.Game && SB.Game.state ? SB.Game.state : null;
    var target = null;
    if (SB.Player && SB.Player.pos) {
      target = SB.Player.pos;
      if (SB.Player.onFoot === false && SB.Player.vehicle) {
        target = SB.Player.vehicle.pos;
      }
    }
    if (!target || !SB.Render || !SB.Render.camera) return;

    // Mouse menggeser yaw/pitch kamera; posisi kamera mengorbit target.
    this.cameraYaw += this.mouse.dx * 0.0032;
    this.cameraPitch += this.mouse.dy * 0.0022;
    if (this.cameraPitch < 0.08) this.cameraPitch = 0.08;
    if (this.cameraPitch > 1.1) this.cameraPitch = 1.1;
    this.mouse.dx = 0;
    this.mouse.dy = 0;

    var dist = this.cameraDistance;
    var cam = SB.Render.camera;
    cam.pos.x = target.x - Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    cam.pos.y = target.y + Math.sin(this.cameraPitch) * dist + 2.2;
    cam.pos.z = target.z - Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * dist;
    cam.yaw = this.cameraYaw;
    cam.pitch = this.cameraPitch;
    if (SB.GL && SB.GL.setCamera) {
      SB.GL.setCamera(cam.pos, { x: target.x, y: target.y + 1.6, z: target.z });
    }
    void dt;
  },

  render: function () {
    if (!this.started) {
      // Di menu: tetap render dunia sebagai latar belakang hidup.
      if (SB.Render && SB.Render.render && SB.Game && SB.Game.state) {
        try {
          SB.Render.render(SB.Game.state);
        } catch (err) {
          if (SB.GL && SB.GL.clear) SB.GL.clear();
        }
      } else if (SB.GL && SB.GL.clear) {
        SB.GL.clear();
      }
      return;
    }
    if (SB.Render && SB.Render.render && SB.Game && SB.Game.state) {
      SB.Render.render(SB.Game.state);
    } else if (SB.GL && SB.GL.clear) {
      SB.GL.clear();
    }
  },

  // ---- Menu, pause, game over, win ------------------------------------

  bindMenu: function () {
    var self = this;
    var startBtn = document.getElementById('btn-start');
    var continueBtn = document.getElementById('btn-continue');
    var howtoBtn = document.getElementById('btn-howto');
    var howtoClose = document.getElementById('btn-howto-close');
    var resumeBtn = document.getElementById('btn-resume');
    var restartBtn = document.getElementById('btn-restart');
    var restartBtn2 = document.getElementById('btn-restart-2');
    var menuBtn = document.getElementById('btn-menu');
    var menuBtn2 = document.getElementById('btn-menu-2');

    if (startBtn) startBtn.addEventListener('click', function () { self.newGame(); });
    if (continueBtn) continueBtn.addEventListener('click', function () { self.continueGame(); });
    if (howtoBtn) howtoBtn.addEventListener('click', function () { self.showHowto(true); });
    if (howtoClose) howtoClose.addEventListener('click', function () { self.showHowto(false); });
    if (resumeBtn) resumeBtn.addEventListener('click', function () { self.togglePause(false); });
    if (restartBtn) restartBtn.addEventListener('click', function () { self.newGame(); });
    if (restartBtn2) restartBtn2.addEventListener('click', function () { self.newGame(); });
    if (menuBtn) menuBtn.addEventListener('click', function () { self.showMenu(); });
    if (menuBtn2) menuBtn2.addEventListener('click', function () { self.showMenu(); });
  },

  newGame: function () {
    if (SB.Game && SB.Game.start) SB.Game.start();
    this.beginPlay();
    this.toast('Welcome to Sunset Bay. Follow the mission marker.');
  },

  continueGame: function () {
    var loaded = false;
    if (SB.Game && SB.Game.load) {
      try {
        loaded = SB.Game.load();
      } catch (err) {
        loaded = false;
      }
    }
    if (!loaded && SB.Game && SB.Game.start) SB.Game.start();
    this.beginPlay();
    this.toast(loaded ? 'Save loaded. Welcome back.' : 'No save found — new game started.');
  },

  beginPlay: function () {
    this.started = true;
    this.paused = false;
    this.hideAllOverlays();
    document.getElementById('hud').classList.remove('hidden');
    if (SB.Audio && SB.Audio.init) {
      try {
        SB.Audio.init();
      } catch (err) {
        console.warn('SB.Main: audio init gagal', err);
      }
    }
    this.canvas.focus();
  },

  showMenu: function () {
    this.started = false;
    this.paused = false;
    this.hideAllOverlays();
    var menu = document.getElementById('menu');
    if (menu) menu.classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
    this.updateContinueButton();
  },

  showHowto: function (show) {
    var panel = document.getElementById('howto');
    if (panel) panel.classList.toggle('hidden', !show);
  },

  togglePause: function (force) {
    if (!this.started) return;
    this.paused = typeof force === 'boolean' ? force : !this.paused;
    var pauseEl = document.getElementById('pause');
    if (pauseEl) pauseEl.classList.toggle('hidden', !this.paused);
    if (this.paused && document.exitPointerLock) document.exitPointerLock();
  },

  checkEndStates: function () {
    if (!this.started || !SB.Game || !SB.Game.state) return;
    var state = SB.Game.state;
    var overEl = document.getElementById('gameover');
    var winEl = document.getElementById('win');
    if (state.status === 'gameover' && overEl && overEl.classList.contains('hidden')) {
      overEl.classList.remove('hidden');
      var reason = document.getElementById('gameover-reason');
      if (reason) reason.textContent = state.gameOverReason || 'Busted.';
      if (document.exitPointerLock) document.exitPointerLock();
    }
    if (state.status === 'won' && winEl && winEl.classList.contains('hidden')) {
      winEl.classList.remove('hidden');
      if (document.exitPointerLock) document.exitPointerLock();
    }
  },

  hideAllOverlays: function () {
    var ids = ['menu', 'pause', 'howto', 'gameover', 'win'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.classList.add('hidden');
    }
  },

  updateContinueButton: function () {
    var btn = document.getElementById('btn-continue');
    if (!btn) return;
    var hasSave = false;
    try {
      hasSave = !!window.localStorage.getItem(SB.Config.SAVE_KEY);
    } catch (err) {
      hasSave = false;
    }
    if (hasSave) {
      btn.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Continue';
    } else {
      btn.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Continue (no save yet)';
    }
  },

  showFatal: function (message) {
    var el = document.getElementById('fatal');
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    } else {
      alert(message);
    }
  },

  // ---- Input -----------------------------------------------------------

  bindInput: function () {
    var self = this;
    var cfg = SB.Config;

    window.addEventListener('keydown', function (e) {
      self.input[e.code] = true;
      if (e.code === cfg.KEYS.PAUSE || e.code === cfg.KEYS.PAUSE_ESC) {
        if (self.started) {
          e.preventDefault();
          self.togglePause();
        }
      }
      if (e.code === cfg.KEYS.BRAKE) e.preventDefault();
      if (e.code === cfg.KEYS.MUTE && SB.Audio && SB.Audio.toggleMute) {
        SB.Audio.toggleMute();
      }
      if (e.code === cfg.KEYS.RADIO_NEXT && SB.Audio && SB.Audio.setStation) {
        var next = ((SB.Audio.station || 0) + 1) % cfg.RADIO_STATIONS.length;
        SB.Audio.setStation(next);
        self.toast('Radio: ' + cfg.RADIO_STATIONS[next]);
      }
    });
    window.addEventListener('keyup', function (e) {
      self.input[e.code] = false;
    });
    window.addEventListener('blur', function () {
      self.input = {};
      if (self.started && !self.paused) self.togglePause(true);
    });

    // Klik canvas: kunci pointer agar mouse memutar kamera.
    this.canvas.addEventListener('click', function () {
      if (!self.started || self.paused) return;
      if (self.canvas.requestPointerLock) self.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', function () {
      self.mouse.locked = document.pointerLockElement === self.canvas;
    });
    document.addEventListener('mousemove', function (e) {
      if (self.mouse.locked) {
        self.mouse.dx += e.movementX || 0;
        self.mouse.dy += e.movementY || 0;
      }
    });
    // Klik kiri = tembak (bila senjata aktif).
    this.canvas.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !self.started || self.paused) return;
      self.mouse.down = true;
      if (SB.Weapons && SB.Weapons.shoot) {
        try {
          SB.Weapons.shoot();
        } catch (err) {
          console.warn('SB.Main: shoot gagal', err);
        }
      }
    });
    window.addEventListener('mouseup', function () {
      self.mouse.down = false;
    });

    // Resize: jaga canvas & viewport WebGL tetap sinkron.
    window.addEventListener('resize', function () {
      self.resize();
    });
    this.resize();
  },

  resize: function () {
    if (!this.canvas) return;
    var w = this.canvas.clientWidth || 1280;
    var h = this.canvas.clientHeight || 720;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (SB.GL && SB.GL.resize) SB.GL.resize(this.canvas.width, this.canvas.height);
  },

  // Tombol sekali-tekan (dicek tiap frame; flag _pressed mencegah pengulangan).
  handleActionKeys: function () {
    var cfg = SB.Config;
    var pressed = function (code) {
      if (this.input[code] && !this.input[code + '_used']) {
        this.input[code + '_used'] = true;
        return true;
      }
      if (!this.input[code]) this.input[code + '_used'] = false;
      return false;
    }.bind(this);

    if (pressed(cfg.KEYS.STEAL)) this.tryStealOrExit();
    if (pressed(cfg.KEYS.RESPRAY)) this.tryRespray();
    if (pressed(cfg.KEYS.INTERACT)) this.tryInteract();
    if (pressed(cfg.KEYS.WEAPON_1) && SB.Weapons && SB.Weapons.equip) SB.Weapons.equip(0);
    if (pressed(cfg.KEYS.WEAPON_2) && SB.Weapons && SB.Weapons.equip) SB.Weapons.equip(1);
    if (pressed(cfg.KEYS.WEAPON_3) && SB.Weapons && SB.Weapons.equip) SB.Weapons.equip(2);
  },

  tryStealOrExit: function () {
    if (!SB.Player) return;
    if (SB.Player.onFoot === false) {
      if (SB.Player.exitVehicle) SB.Player.exitVehicle();
      return;
    }
    // nearestCar() mengembalikan {car, dist}, BUKAN mobil — jangan
    // teruskan ke enterVehicle (pos jadi NaN). Pakai stealNearest()
    // yang sudah menangani curi + wanted + enterVehicle dengan benar.
    var car = null;
    if (SB.Vehicles && SB.Vehicles.stealNearest) {
      car = SB.Vehicles.stealNearest();
    }
    if (car) {
      this.toast('Car stolen! The cops noticed.');
    } else {
      this.toast('No car nearby. Walk to a parked car and press E.');
    }
  },

  tryRespray: function () {
    if (!SB.Player || SB.Player.onFoot !== false || !SB.Player.vehicle) {
      this.toast('Respray needs a car — steal one first (E).');
      return;
    }
    if (SB.Vehicles && SB.Vehicles.respray) {
      var ok = SB.Vehicles.respray(SB.Player.vehicle);
      this.toast(ok
        ? 'Respray done — $' + SB.Config.RESPRAY_COST + '. New paint, clean record.'
        : 'Not enough cash for a respray ($' + SB.Config.RESPRAY_COST + ').');
    }
  },

  tryInteract: function () {
    // F dipakai misi & job: serahkan ke SB.Missions / SB.Game bila tersedia.
    if (SB.Missions && SB.Missions.current) {
      var m = SB.Missions.current();
      if (m) this.toast('Mission: ' + m.title);
    }
  },

  // ---- HUD -------------------------------------------------------------

  updateHud: function () {
    if (!this.started || !SB.Game || !SB.Game.state) return;
    var s = SB.Game.state;
    var set = function (id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('hud-cash', '$' + Math.floor(s.cash || 0).toLocaleString('en-US'));
    set('hud-health', Math.max(0, Math.round((SB.Player && SB.Player.health !== undefined)
      ? SB.Player.health : (s.health || 100))));
    var t = (typeof s.time === 'number') ? s.time : SB.Config.TIME.START_HOUR;
    set('hud-time', this.formatTime(Math.floor(t), (t - Math.floor(t)) * 60));
    set('hud-weather', SB.Weather && SB.Weather.current ? SB.Weather.current : 'sunny');
    set('hud-respect', SB.Respect && SB.Respect.rank ? SB.Respect.rank() : 'Rookie');
    set('hud-speed', this.currentSpeedText());
    set('hud-mission', this.currentMissionText());
    set('hud-radio', SB.Audio && SB.Audio.station !== undefined
      ? SB.Config.RADIO_STATIONS[SB.Audio.station] || ''
      : '');

    var stars = '';
    var wanted = s.wanted || 0;
    for (var i = 0; i < 5; i++) stars += i < wanted ? '★' : '☆';
    set('hud-wanted', stars);

    var healthBar = document.getElementById('hud-health-bar');
    if (healthBar) {
      var hp = SB.Player && SB.Player.health !== undefined ? SB.Player.health : 100;
      healthBar.style.width = Math.max(0, Math.min(100, hp)) + '%';
      healthBar.style.background = hp > 50 ? '#37d67a' : hp > 25 ? '#ffb020' : '#ff4040';
    }

    var wantedEl = document.getElementById('hud-wanted');
    if (wantedEl) wantedEl.style.color = wanted >= 3 ? '#ff4040' : '#ffd23c';
  },

  currentSpeedText: function () {
    if (SB.Player && SB.Player.onFoot === false && SB.Player.vehicle) {
      var v = SB.Player.vehicle.speed || 0;
      return Math.round(Math.abs(v) * 3.6) + ' km/h';
    }
    if (SB.Player && SB.Player.vel) {
      var sp = Math.sqrt(SB.Player.vel.x * SB.Player.vel.x + SB.Player.vel.z * SB.Player.vel.z);
      return Math.round(sp * 3.6) + ' km/h';
    }
    return '0 km/h';
  },

  currentMissionText: function () {
    if (SB.Missions && SB.Missions.current) {
      var m = SB.Missions.current();
      if (m) {
        var stage = m.stages && m.stageIndex !== undefined ? m.stages[m.stageIndex] : null;
        return m.title + (stage ? ' — ' + stage.text : '');
      }
    }
    return 'No active mission — press F near a mission marker.';
  },

  formatTime: function (hour, minute) {
    var h = hour === undefined ? SB.Config.TIME.START_HOUR : hour;
    var m = minute === undefined ? SB.Config.TIME.START_MINUTE : minute;
    var hh = Math.floor(h);
    var mm = Math.floor(m);
    var ampm = hh >= 12 ? 'PM' : 'AM';
    var h12 = hh % 12;
    if (h12 === 0) h12 = 12;
    return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ampm;
  },

  // ---- Minimap (canvas 2D) ---------------------------------------------

  drawMinimap: function () {
    if (!this.minimap || !this.started) return;
    var ctx = this.minimap.getContext('2d');
    if (!ctx) return;
    var W = this.minimap.width;
    var H = this.minimap.height;
    var half = SB.Config.WORLD.HALF;
    var toMap = function (x, z) {
      return { x: ((x + half) / (half * 2)) * W, y: ((z + half) / (half * 2)) * H };
    };

    // Latar: laut gelap, daratan, lalu jalan grid.
    ctx.fillStyle = '#0a2036';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1d2b26';
    ctx.fillRect(4, 4, W - 8, H - 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    var spacing = SB.Config.WORLD.ROAD_SPACING;
    for (var gx = -half; gx <= half; gx += spacing) {
      var p1 = toMap(gx, -half);
      var p2 = toMap(gx, half);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      var q1 = toMap(-half, gx);
      var q2 = toMap(half, gx);
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.stroke();
    }

    // Distrik: titik kecil + nama singkat distrik pemain saat ini.
    ctx.fillStyle = 'rgba(255,200,90,0.55)';
    for (var i = 0; i < SB.Config.DISTRICTS.length; i++) {
      var d = SB.Config.DISTRICTS[i];
      var dp = toMap(d.x, d.z);
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Marker misi aktif (kuning berdenyut).
    if (SB.Missions && SB.Missions.current) {
      var m = SB.Missions.current();
      if (m && m.marker) {
        var mp = toMap(m.marker.x, m.marker.z);
        var pulse = 4 + Math.sin(performance.now() / 300) * 1.5;
        ctx.fillStyle = '#ffd23c';
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7a5b00';
        ctx.stroke();
      }
    }

    // Polisi (biru) & mobil AI (abu-abu).
    if (SB.Police && SB.Police.COP_CARS) {
      ctx.fillStyle = '#4aa8ff';
      for (var c = 0; c < SB.Police.COP_CARS.length; c++) {
        var cp = toMap(SB.Police.COP_CARS[c].pos.x, SB.Police.COP_CARS[c].pos.z);
        ctx.fillRect(cp.x - 2, cp.y - 2, 4, 4);
      }
    }

    // Pemain: panah putih mengarah sesuai rotasi.
    if (SB.Player && SB.Player.pos) {
      var pp = toMap(SB.Player.pos.x, SB.Player.pos.z);
      var rot = SB.Player.rotY || 0;
      ctx.save();
      ctx.translate(pp.x, pp.y);
      ctx.rotate(-rot);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Bingkai + utara.
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', W - 14, 14);
  },

  // ---- Lainnya ---------------------------------------------------------

  updateFps: function (dt) {
    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
      var el = document.getElementById('hud-fps');
      if (el) el.textContent = this.fps + ' FPS';
    }
  },

  toast: function (message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    var self = this;
    this.toastTimer = setTimeout(function () {
      el.classList.add('hidden');
    }, 3500);
  },
};

// index.html memanggil SB.Main.start() setelah semua modul termuat.

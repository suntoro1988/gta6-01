// main.js — Sunset Bay v11 (Builder B: game core + rendering)
// Entry point game: init WebGL, muat semua modul (dinamis + guarded),
// game loop, input keyboard/mouse/sentuh, resize, pause, dan
// save/load localStorage (key sunset-bay-save-v1) dengan Continue.
//
// Modul lain (city, player, vehicles, water, audio, hud, jobs, meshes,
// rng, shots) dimuat dengan dynamic import + try/catch: bila satu modul
// belum ada atau gagal, game tetap jalan dengan fallback prosedural
// dari game.js. JANGAN jadikan import mereka statis — satu file rusak
// tidak boleh mematikan seluruh game.

import { createRenderer } from './gl.js';
import { Game, SAVE_KEY } from './game.js';
import * as math3 from './math3.js';

export const VERSION = '11.0.0';

// Modul yang diharapkan ada di game/src/ (ditulis builder lain).
// Urutan tidak mengikat — semuanya opsional dan guarded.
const MODULE_NAMES = ['city', 'player', 'vehicles', 'water', 'audio', 'hud', 'jobs', 'meshes', 'rng', 'shots'];

const $ = (id) => document.getElementById(id);

function collectDom() {
  return {
    hud: $('hud'),
    toast: $('toast'),
    hint: $('hint'),
    missionOverlay: $('mission-overlay'),
    missionTitle: $('mission-title'),
    missionDesc: $('mission-desc'),
    missionProgress: $('mission-progress'),
    hpFill: $('hp-fill'),
    staminaFill: $('stamina-fill'),
    moneyText: $('money-text'),
    wantedStars: $('wanted-stars'),
    weaponText: $('weapon-text'),
    clockText: $('clock-text'),
    radioText: $('radio-text'),
    speedText: $('speed-text'),
    playerState: $('player-state'),
    vehicleText: $('vehicle-text'),
    minimap: $('minimap'),
    fpsMeter: $('fps-meter'),
    crosshair: $('crosshair'),
    startOverlay: $('start-overlay'),
    pauseOverlay: $('pause-overlay'),
    pauseStats: $('pause-stats'),
    btnContinue: $('btn-continue'),
    btnStart: $('btn-start'),
    btnResume: $('btn-resume'),
    btnRestart: $('btn-restart'),
    btnQuitToMenu: $('btn-quit-to-menu'),
    loading: $('loading'),
    loadingText: $('loading-text'),
    webglError: $('webgl-error'),
    saveNote: $('save-note'),
  };
}

// Normalisasi satu modul hasil dynamic import ke "instance" yang bisa
// dipanggil game.js lewat callModule(name, method, ...args):
//  - default export class   -> new default()
//  - default export object  -> object itu
//  - named exports          -> namespace (fungsi init/update/render dicari di sini)
// Gagal total -> null (game memakai fallback).
async function loadModule(name) {
  try {
    const mod = await import('./' + name + '.js');
    if (mod.default && typeof mod.default === 'function') {
      try {
        return new mod.default();
      } catch (err) {
        console.warn(`[main] modul ${name}: konstruktor butuh argumen, pakai namespace:`, err);
        return mod;
      }
    }
    if (mod.default && typeof mod.default === 'object') return mod.default;
    return mod;
  } catch (err) {
    console.warn(`[main] modul ${name} tidak dimuat (pakai fallback):`, err.message);
    return null;
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (err) {
    console.warn('[main] save korup, diabaikan:', err);
    return null;
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn('[main] gagal menulis save:', err);
    return false;
  }
}

async function boot() {
  const dom = collectDom();
  const canvas = $('game-canvas');
  const loadingText = dom.loadingText;

  const setLoading = (msg) => { if (loadingText) loadingText.textContent = msg; };

  setLoading('Menyiapkan WebGL…');
  const renderer = createRenderer(canvas, {
    onError: (msg) => {
      if (dom.webglError) {
        dom.webglError.style.display = 'block';
        dom.webglError.textContent = msg;
      }
      const spinner = document.querySelector('#loading .spinner');
      if (spinner) spinner.style.display = 'none';
      setLoading('Game tidak bisa dimulai.');
    },
  });
  if (!renderer) return; // pesan error sudah ditampilkan oleh onError

  // ---- input bersama (dibaca game.js) ----
  const input = {
    keys: new Set(),
    lookDX: 0,
    lookDY: 0,
    actions: [], // antrean aksi sekali-tekan {type, data}
  };

  setLoading('Memuat modul game…');
  const rawModules = {};
  for (const name of MODULE_NAMES) {
    rawModules[name] = await loadModule(name);
  }
  const loadedNames = MODULE_NAMES.filter((n) => rawModules[n]);
  console.log('[main] modul termuat:', loadedNames.join(', ') || '(tidak ada — full fallback)');
  console.log('[main] math3', math3.VERSION, '| gl', renderer.version, '| game', Game ? 'ok' : 'gagal');

  // Integrasi v11: namespace mentah TIDAK cocok dengan kontrak duck-typing
  // game.js (modul IIFE hanya mendaftar di globalThis.Sunset*). Adapter
  // menerjemahkan tiap modul asli ke init/update/render/getState/... agar
  // kota, air, player, kendaraan, misi, audio, HUD, dan shooting yang
  // asli yang dipakai — bukan fallback prosedural.
  setLoading('Menghubungkan modul game…');
  const { buildAdapters } = await import('./adapters.js');
  const allAdapters = buildAdapters(rawModules);
  const registry = allAdapters.__registry;
  delete allAdapters.__registry;
  const modules = allAdapters;

  setLoading('Membangun Sunset Bay…');
  const game = new Game({
    renderer,
    dom,
    modules,
    input,
    onEvent: handleGameEvent,
  });
  game.init();

  // ---- save / load ----
  let saveData = loadSave();
  if (saveData && dom.btnContinue) {
    dom.btnContinue.style.display = 'inline-block';
    const when = saveData.savedAt ? new Date(saveData.savedAt).toLocaleString('id-ID') : '';
    if (dom.saveNote) {
      dom.saveNote.textContent = `Save ditemukan${when ? ' (' + when + ')' : ''} — uang $${Math.floor(saveData.money || 0)}, hari ke-${saveData.day || 1}, ${saveData.missionsDone || 0} misi selesai.`;
    }
  }

  function saveGame() {
    if (!game) return;
    writeSave(game.getSaveData());
  }

  function handleGameEvent(type, data) {
    switch (type) {
      case 'autosave':
        writeSave(data);
        break;
      case 'paused': {
        if (dom.pauseStats && data) {
          dom.pauseStats.innerHTML =
            `Hari ke-${data.day} • ${data.clock} (${data.phase})<br>` +
            `Uang: $${data.money.toLocaleString('en-US')} • Misi selesai: ${data.missionsDone}<br>` +
            `Mobil dicuri: ${data.carsStolen} • Jarak mengemudi: ${data.distanceDrivenKm} km • Bermain: ${data.playMinutes} menit`;
        }
        if (dom.pauseOverlay) dom.pauseOverlay.classList.add('show');
        break;
      }
      case 'resumed':
        if (dom.pauseOverlay) dom.pauseOverlay.classList.remove('show');
        break;
      case 'started':
        if (dom.startOverlay) dom.startOverlay.classList.remove('show');
        if (dom.pauseOverlay) dom.pauseOverlay.classList.remove('show');
        if (dom.hud) dom.hud.classList.add('visible');
        break;
      case 'quit-to-menu':
        if (dom.hud) dom.hud.classList.remove('visible');
        if (dom.pauseOverlay) dom.pauseOverlay.classList.remove('show');
        if (dom.startOverlay) dom.startOverlay.classList.add('show');
        // Refresh tombol Continue setelah kembali ke menu.
        saveData = loadSave();
        if (saveData && dom.btnContinue) dom.btnContinue.style.display = 'inline-block';
        break;
      default:
        break;
    }
  }

  // ---- tombol overlay ----
  if (dom.btnStart) {
    dom.btnStart.addEventListener('click', () => {
      saveData = null;
      game.start(true);
    });
  }
  if (dom.btnContinue) {
    dom.btnContinue.addEventListener('click', () => {
      const data = loadSave();
      game.start(false, data);
    });
  }
  if (dom.btnResume) dom.btnResume.addEventListener('click', () => game.resume());
  if (dom.btnRestart) {
    dom.btnRestart.addEventListener('click', () => {
      if (dom.pauseOverlay) dom.pauseOverlay.classList.remove('show');
      game.start(true);
    });
  }
  if (dom.btnQuitToMenu) dom.btnQuitToMenu.addEventListener('click', () => game.quitToMenu());

  // ---- keyboard ----
  const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'ShiftLeft', 'ShiftRight',
  ]);
  window.addEventListener('keydown', (e) => {
    if (e.repeat) {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      return;
    }
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      input.keys.add(e.code);
    }
    switch (e.code) {
      case 'KeyE':
        if (game.mode === 'playing') input.actions.push({ type: 'interact' });
        break;
      case 'Space':
        if (game.mode === 'playing') input.actions.push({ type: 'jump' });
        break;
      case 'KeyR':
        if (game.mode === 'playing') input.actions.push({ type: 'radio' });
        break;
      case 'KeyQ':
        if (game.mode === 'playing') input.actions.push({ type: 'mission' });
        break;
      case 'KeyM':
        if (game.mode === 'playing') input.actions.push({ type: 'mute' });
        break;
      case 'KeyF':
        if (game.mode === 'playing') input.actions.push({ type: 'headlights' });
        break;
      case 'KeyB':
        if (game.mode === 'playing') input.actions.push({ type: 'buy-ammo' });
        break;
      case 'KeyG':
        if (game.mode === 'playing') input.actions.push({ type: 'respray' });
        break;
      case 'Digit1':
        if (game.mode === 'playing') input.actions.push({ type: 'weapon', data: 0 });
        break;
      case 'Digit2':
        if (game.mode === 'playing') input.actions.push({ type: 'weapon', data: 1 });
        break;
      case 'Digit3':
        if (game.mode === 'playing') input.actions.push({ type: 'weapon', data: 2 });
        break;
      case 'Escape':
      case 'KeyP':
        input.actions.push({ type: 'pause' });
        break;
      default:
        break;
    }
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    if (game.mode === 'playing') game.pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'playing') game.pause();
  });

  // ---- mouse: seret untuk orbit kamera ----
  let dragging = false;
  let lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    input.lookDX += e.clientX - lastX;
    input.lookDY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Klik (tanpa seret) = tembak — ShootingSystem via game.fireWeapon().
  let downX = 0, downY = 0, downT = 0;
  canvas.addEventListener('pointerdown', (e) => {
    downX = e.clientX; downY = e.clientY; downT = performance.now();
  });
  canvas.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (moved < 6 && performance.now() - downT < 400 && game.mode === 'playing') {
      game.fireWeapon();
    }
  });

  // ---- tombol sentuh ----
  const touchInteract = $('touch-interact');
  const touchJump = $('touch-jump');
  if (touchInteract) {
    touchInteract.addEventListener('click', () => {
      if (game.mode === 'playing') input.actions.push({ type: 'interact' });
    });
  }
  if (touchJump) {
    touchJump.addEventListener('click', () => {
      if (game.mode === 'playing') input.actions.push({ type: 'jump' });
    });
  }

  // ---- resize ----
  let aspect = 16 / 9;
  function onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    renderer.resize(w, h);
    aspect = w / Math.max(1, h);
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ---- save saat tab ditutup ----
  window.addEventListener('beforeunload', () => {
    if (game.mode === 'playing' || game.mode === 'paused') saveGame();
  });

  // ---- handle untuk harness / modul lain (mis. shots.js) ----
  window.__sunsetBay = {
    game,
    renderer,
    modules,
    rawModules,
    registry,
    math3,
    version: VERSION,
    save: saveGame,
    loadSave,
    // Helper QA (dipakai skrip uji otomatis, bukan gameplay):
    qa: {
      // Teleport pemain (sinkronkan modul player + state game).
      teleport(x, z) {
        game.player.pos.x = x;
        game.player.pos.z = z;
        const p = registry.player && registry.player.player;
        if (p) { p.x = x; p.z = z; }
        game.camera.lookAt = { x, y: 1.7, z };
        game.camera.pos = { x: x + Math.sin(game.camera.yaw) * 7, y: 4, z: z + Math.cos(game.camera.yaw) * 7 };
      },
      setWanted(n) { game.player.wanted = n; },
      // Polisi di depan kamera (untuk uji tembak): wanted >= 3 agar heli ikut.
      spawnCopNear(dist) {
        return registry.jobs ? registry.jobs.spawnCopNear(dist || 12) : null;
      },
      // Paksa waktu game (jam 0-24) — untuk uji siang/malam.
      setTime(hour) { game.timeOfDay = hour; },
      state() {
        return {
          mode: game.mode,
          pos: { ...game.player.pos },
          money: game.player.money,
          wanted: game.player.wanted,
          health: game.player.health,
          missionsDone: game.missionsDone,
          mission: game.mission ? { title: game.mission.def.title, stage: game.mission.stageIndex, stages: (game.mission.def.stages || []).length } : null,
          rep: game.rep || 0,
          inVehicle: game.player.inVehicle,
          inBoat: !!game.player.inBoat,
          waterDrawCalls: registry.water ? registry.water.drawCalls : 0,
          ambient: registry.water ? registry.water.getAmbientStatus() : null,
          buildings: registry.city ? registry.city.buildingCount() : 0,
          shots: registry.shots ? registry.shots.getState() : null,
          jobs: registry.jobs ? registry.jobs.getState() : null,
          heliActive: registry.jobs && registry.jobs.cops ? registry.jobs.cops.heliActive : false,
          cops: registry.jobs && registry.jobs.cops ? registry.jobs.cops.cops.length : 0,
          radio: registry.audio ? registry.audio.getStation() : null,
        };
      },
    },
  };

  // ---- game loop ----
  const fpsMeter = dom.fpsMeter;
  if (fpsMeter) fpsMeter.classList.add('show');
  let lastT = performance.now();
  let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    game.update(dt);
    game.render(aspect);

    fpsAccum += dt;
    fpsFrames += 1;
    fpsTimer += dt;
    if (fpsTimer >= 0.5 && fpsMeter) {
      const fps = Math.round(fpsFrames / Math.max(0.001, fpsAccum));
      fpsMeter.textContent = fps + ' FPS';
      fpsAccum = 0;
      fpsFrames = 0;
      fpsTimer = 0;
    }
  }

  // ---- tampilkan menu utama ----
  if (dom.loading) dom.loading.classList.add('hide');
  if (dom.startOverlay) dom.startOverlay.classList.add('show');
  setLoading('');
  requestAnimationFrame(frame);
}

// Boot dengan penanganan error agar overlay loading tidak menggantung.
boot().catch((err) => {
  console.error('[main] boot gagal:', err);
  const loadingText = $('loading-text');
  if (loadingText) loadingText.textContent = 'Gagal memuat game: ' + err.message;
  const errBox = $('webgl-error');
  if (errBox) {
    errBox.style.display = 'block';
    errBox.textContent = 'Error: ' + err.message + ' — coba muat ulang halaman.';
  }
  const spinner = document.querySelector('#loading .spinner');
  if (spinner) spinner.style.display = 'none';
});

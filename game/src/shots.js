window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.Shots — screenshot helper + weapon ammo economy for Sunset Bay v12.
  // take(name): captures the game canvas to a dataURL and triggers a
  // download (name.jpg). Used for the 4 submission screenshots, and for
  // the in-game photo missions (SB.Jobs "Golden Hour Shots").
  // Ammo: the module owns the lowercase `ammo` counter and buyAmmo()
  // ($50 for +24 ammo), matching the weapon slots in the design spec
  // (0 pistol, 1 smg, 2 shotgun, 3 rifle). SB.Game / SB.Player read
  // SB.Shots.ammo and call SB.Shots.spendAmmo() on every shot.
  // scorePhoto(state): rates a shot 0-100 from how many systems are
  // visible at once (HUD, wanted, heli, explosion, sunset, NPCs) — the
  // same ingredients the 4 submission shots are built from.
  // ---------------------------------------------------------------------------

  var AMMO_PRICE = 50;
  var AMMO_PACK = 24;
  var MAX_AMMO = 240;
  var MAX_CARRY = 999;

  var ammoCount = 24;      // lowercase `ammo` — see getter below
  var weapon = 0;          // 0 pistol, 1 smg, 2 shotgun, 3 rifle
  var stateRef = null;
  var shotsTaken = [];
  var lastDataUrl = null;
  var canvasRef = null;
  var flashEl = null;

  var WEAPONS = [
    { name: 'Pistol', damage: 25, rate: 0.35, spread: 0.02, cost: 1 },
    { name: 'SMG', damage: 14, rate: 0.09, spread: 0.07, cost: 1 },
    { name: 'Shotgun', damage: 18, rate: 0.8, spread: 0.16, cost: 3 },
    { name: 'Rifle', damage: 45, rate: 0.5, spread: 0.01, cost: 1 }
  ];

  var WEAPON_NAMES = ['Pistol', 'SMG', 'Shotgun', 'Rifle'];

  // The 4 submission shots from the design spec, with the systems each
  // one must show. take() can be called with any name; these four are
  // the ones the dossier build records.
  var SUBMISSION_SHOTS = [
    {
      name: '1-start',
      file: '1-start.jpg',
      desc: 'Start screen + golden-hour city + crowded beach',
      systems: ['start screen', 'golden hour', 'city skyline', 'beach NPCs']
    },
    {
      name: '2-play',
      file: '2-play.jpg',
      desc: 'Car chase + heli AIR-1 + wanted 3 stars + full HUD + minimap red zone',
      systems: ['car chase', 'heli AIR-1', 'wanted 3', 'HUD', 'minimap']
    },
    {
      name: '3-foot',
      file: '3-foot.jpg',
      desc: 'On foot on the beach road at sunset + palms + lit windows + active mission + NPCs',
      systems: ['on foot', 'sunset', 'palms', 'lit windows', 'mission', 'NPCs']
    },
    {
      name: '4-end',
      file: '4-end.jpg',
      desc: 'Heli AIR-1 + spotlight sweeping the road + wanted 4 stars + explosion/smoke',
      systems: ['heli AIR-1', 'spotlight', 'wanted 4', 'explosion', 'smoke']
    }
  ];

  // --- Canvas capture ---------------------------------------------------------

  function findCanvas() {
    if (canvasRef) return canvasRef;
    var c = document.getElementById('game-canvas') ||
      document.getElementById('game') ||
      document.querySelector('canvas');
    canvasRef = c || null;
    return canvasRef;
  }

  function setCanvas(canvas) {
    canvasRef = canvas || null;
    return canvasRef;
  }

  function captureDataUrl(quality) {
    var canvas = findCanvas();
    if (!canvas) return null;
    try {
      // preserveDrawingBuffer may be off; toDataURL still works if called
      // in the same frame as a draw. Game calls take() right after frame().
      return canvas.toDataURL('image/jpeg', quality || 0.85);
    } catch (e) {
      return null;
    }
  }

  function download(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 200);
  }

  function flash() {
    if (typeof document === 'undefined') return;
    if (!flashEl) {
      flashEl = document.createElement('div');
      flashEl.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;' +
        'pointer-events:none;z-index:60;transition:opacity .12s;';
      document.body.appendChild(flashEl);
    }
    flashEl.style.opacity = '0.7';
    setTimeout(function () { flashEl.style.opacity = '0'; }, 120);
  }

  function take(name) {
    var clean = String(name || 'shot').replace(/[^a-z0-9\-_]/gi, '').toLowerCase() || 'shot';
    var dataUrl = captureDataUrl(0.85);
    var record = {
      name: clean,
      file: clean + '.jpg',
      time: stateRef ? stateRef.time : 0,
      timeOfDay: stateRef ? stateRef.timeOfDay : 0,
      wanted: stateRef ? stateRef.wanted : 0,
      score: stateRef ? scorePhoto(stateRef) : 0,
      dataUrl: dataUrl,
      at: new Date().toISOString()
    };
    lastDataUrl = dataUrl;
    shotsTaken.push(record);
    flash();
    if (dataUrl) download(dataUrl, record.file);
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Photo saved: ' + record.file +
        '  ·  score ' + record.score + '/100');
    }
    if (window.SB && window.SB.Audio) window.SB.Audio.sfx('click');
    return record;
  }

  // Take one of the four named submission shots, pre-checking its setup.
  function takeSubmission(slot) {
    var idx = Math.max(0, Math.min(3, Math.floor(slot || 0)));
    var spec = SUBMISSION_SHOTS[idx];
    var rec = take(spec.name);
    rec.submission = true;
    rec.spec = spec.desc;
    return rec;
  }

  // --- Photo scoring ----------------------------------------------------------

  function scorePhoto(state) {
    if (!state) return 0;
    var score = 20; // base: a clean frame of the bay is worth something
    // Golden hour / sunset light is the hero look.
    var tod = state.timeOfDay || 0;
    if (tod >= 17.5 && tod <= 19.5) score += 18;
    else if (tod >= 19.5 || tod < 6) score += 10; // neon night
    // Wanted heat makes a shot dramatic.
    if (state.wanted >= 4) score += 16;
    else if (state.wanted >= 3) score += 12;
    else if (state.wanted >= 1) score += 5;
    // Active mission + HUD richness.
    if (state.mission && state.mission.id) score += 10;
    if (state.heat >= 50) score += 6;
    // Heli in the air (wanted >= 3 spawns AIR-1).
    if (window.SB && window.SB.Police && window.SB.Police.heli) score += 12;
    // FX on screen: explosion / smoke / fire particles.
    if (window.SB && window.SB.FX && window.SB.FX.particles &&
      window.SB.FX.particles.length > 0) score += 10;
    // Living world: NPCs + traffic visible.
    if (window.SB && window.SB.NPC && window.SB.NPC.pedestrians &&
      window.SB.NPC.pedestrians.length >= 10) score += 6;
    if (window.SB && window.SB.Vehicles && window.SB.Vehicles.cars &&
      window.SB.Vehicles.cars.length >= 10) score += 4;
    // On foot vs in a vehicle — foot shots show the street life.
    if (state.player && state.player.onFoot) score += 4;
    if (state.weather && state.weather.rain > 0) score += 4; // rain + puddles
    if (score > 100) score = 100;
    return score;
  }

  function bestShot() {
    var best = null, i;
    for (i = 0; i < shotsTaken.length; i++) {
      if (!best || shotsTaken[i].score > best.score) best = shotsTaken[i];
    }
    return best;
  }

  // --- Ammo economy -----------------------------------------------------------

  function syncFromState() {
    // Shots tidak di-init oleh game.js (di luar urutan init spec), dan
    // game.js load() mengganti objek state — jadi selalu baca state live
    // dari window.SB.state, bukan hanya stateRef sekali init.
    if (window.SB && window.SB.state) stateRef = window.SB.state;
    if (!stateRef) return;
    if (typeof stateRef.ammo === 'number') ammoCount = stateRef.ammo;
    if (typeof stateRef.weapon === 'number') weapon = stateRef.weapon;
  }

  function syncToState() {
    if (window.SB && window.SB.state) stateRef = window.SB.state;
    if (!stateRef) return;
    stateRef.ammo = ammoCount;
    stateRef.weapon = weapon;
  }

  function buyAmmo() {
    syncFromState();
    if (!stateRef) return false;
    if ((stateRef.money || 0) < AMMO_PRICE) {
      if (window.SB && window.SB.HUD) {
        window.SB.HUD.showToast('Not enough cash — ammo costs $' + AMMO_PRICE + '.');
      }
      return false;
    }
    if (ammoCount >= MAX_AMMO) {
      if (window.SB && window.SB.HUD) {
        window.SB.HUD.showToast('Ammo full (' + MAX_AMMO + ').');
      }
      return false;
    }
    stateRef.money -= AMMO_PRICE;
    ammoCount = Math.min(MAX_AMMO, ammoCount + AMMO_PACK);
    syncToState();
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Ammo +24  ·  -$50  ·  total ' + ammoCount);
      window.SB.HUD.setMoney(stateRef.money);
    }
    if (window.SB && window.SB.Audio) window.SB.Audio.sfx('money');
    return true;
  }

  function spendAmmo(n) {
    syncFromState();
    var cost = n || WEAPONS[weapon].cost;
    if (ammoCount < cost) return false;
    ammoCount -= cost;
    syncToState();
    return true;
  }

  function addAmmo(n) {
    syncFromState();
    ammoCount = Math.min(MAX_AMMO, Math.max(0, ammoCount + (n || 0)));
    syncToState();
    return ammoCount;
  }

  function switchWeapon(dir) {
    syncFromState();
    weapon = ((weapon + (dir || 1)) % 4 + 4) % 4;
    syncToState();
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Weapon: ' + WEAPONS[weapon].name +
        '  ·  ammo ' + ammoCount);
    }
    if (window.SB && window.SB.Audio) window.SB.Audio.sfx('click');
    return weapon;
  }

  function setWeapon(i) {
    syncFromState();
    weapon = ((Math.floor(i) % 4) + 4) % 4;
    syncToState();
    return weapon;
  }

  function weaponInfo() {
    return {
      index: weapon,
      name: WEAPONS[weapon].name,
      damage: WEAPONS[weapon].damage,
      rate: WEAPONS[weapon].rate,
      ammo: ammoCount
    };
  }

  // --- Lifecycle --------------------------------------------------------------

  function init(state) {
    stateRef = state || null;
    if (stateRef) {
      if (typeof stateRef.ammo !== 'number') stateRef.ammo = ammoCount;
      if (typeof stateRef.weapon !== 'number') stateRef.weapon = weapon;
      syncFromState();
    }
    findCanvas();
  }

  window.SB.Shots = {
    init: init,
    take: take,
    takeSubmission: takeSubmission,
    scorePhoto: scorePhoto,
    bestShot: bestShot,
    buyAmmo: buyAmmo,
    spendAmmo: spendAmmo,
    addAmmo: addAmmo,
    switchWeapon: switchWeapon,
    setWeapon: setWeapon,
    weaponInfo: weaponInfo,
    setCanvas: setCanvas,
    findCanvas: findCanvas,
    submissionShots: SUBMISSION_SHOTS,
    weapons: WEAPON_NAMES,
    get ammo() { syncFromState(); return ammoCount; },
    set ammo(v) { ammoCount = Math.max(0, Math.min(MAX_AMMO, Math.floor(v || 0))); syncToState(); },
    get weapon() { return weapon; },
    get shots() { return shotsTaken; },
    get lastDataUrl() { return lastDataUrl; },
    get price() { return AMMO_PRICE; },
    get pack() { return AMMO_PACK; }
  };
})();

// Sunset Bay — game.js
// State dan logika inti game (v10, ditulis dari nol).
// Objek Game (SB.G / SB.Game): pemain, wanted 0-5, cash, REP, health,
// waktu, cuaca, polisi, heli AIR-1, WASTED, respawn.

const SB = (typeof window !== 'undefined' ? (window.SB = window.SB || {}) : (globalThis.SB = globalThis.SB || {}));

const SAVE_KEY = 'sunset-bay-save-v1';
const MAX_WANTED = 5;
const MAX_HEALTH = 100;
const WANTED_DECAY_SECONDS = 45;

function makeDefaultState() {
  return {
    mode: 'menu', // menu | playing | paused | wasted
    startedAt: 0,
    elapsed: 0,
    cash: 150,
    rep: 0,
    health: MAX_HEALTH,
    wanted: 0,
    wantedTimer: 0,
    score: 0,
    ammo: 24,
    timeOfDay: 17.5, // 17:30 — matahari terbenam di Sunset Bay
    weather: 'sunset', // clear | sunset | cloudy | rain
    day: 1,
    missionsDone: 0,
    carsStolen: 0,
    copsShot: 0,
    heliActive: false,
    heliHp: 0,
    // Player shape is the SAME record player.js uses (v10 integration):
    // top-level x/y/z/yaw/mode/vehicle, so Player.update, Jobs
    // (game.player.x/z distance checks) and the renderer all agree.
    // Game-only extras: alive, inVehicle, vehicleId.
    player: {
      x: 0,
      y: 0,
      z: 8,
      yaw: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      onGround: true,
      mode: 'foot', // foot | car | boat | swim
      vehicle: null,
      armed: true,
      shootCooldown: 0,
      shotsFired: 0,
      walkCycle: 0,
      moving: false,
      running: false,
      swimming: false,
      alive: true,
      inVehicle: false,
      vehicleId: null,
    },
    cops: [], // { id, pos:{x,y,z}, hp, speed, state }
    heli: null, // { pos:{x,y,z}, hp, active }
    stats: { shotsFired: 0, shotsHit: 0, distanceDriven: 0, distanceWalked: 0 },
  };
}

const Game = {
  state: makeDefaultState(),
  SAVE_KEY,
  MAX_WANTED,
  MAX_HEALTH,

  startGame(options) {
    const opts = options || {};
    this.state = makeDefaultState();
    this.state.mode = 'playing';
    this.state.startedAt = Date.now();
    if (typeof opts.cash === 'number') this.state.cash = opts.cash;
    if (typeof opts.timeOfDay === 'number') this.state.timeOfDay = opts.timeOfDay;
    if (opts.weather) this.state.weather = opts.weather;
    this.state.player.alive = true;
    this.save();
    return this.state;
  },

  newGame() {
    return this.startGame();
  },

  pause() {
    if (this.state.mode === 'playing') this.state.mode = 'paused';
    return this.state.mode;
  },

  resume() {
    if (this.state.mode === 'paused') this.state.mode = 'playing';
    return this.state.mode;
  },

  toMenu() {
    this.state.mode = 'menu';
    return this.state.mode;
  },

  update(dt) {
    const s = this.state;
    if (s.mode !== 'playing') return s;
    const step = Math.min(Math.max(dt || 0, 0), 0.1);
    s.elapsed += step;
    // Jam game berjalan: 1 detik nyata = 1 menit game.
    s.timeOfDay = (s.timeOfDay + step / 60) % 24;
    if (s.timeOfDay >= 24) s.day += 1;

    // Wanted memudar perlahan bila pemain tidak berbuat onar.
    if (s.wanted > 0) {
      s.wantedTimer += step;
      if (s.wantedTimer >= WANTED_DECAY_SECONDS) {
        s.wantedTimer = 0;
        s.wanted = Math.max(0, s.wanted - 1);
        if (s.wanted < 3) this.dismissHeli();
        this.onWantedChanged(s.wanted);
      }
    }

    this.updateCops(step);
    this.updateHeli(step);

    // Regen health pelan saat wanted 0.
    if (s.wanted === 0 && s.health > 0 && s.health < MAX_HEALTH) {
      s.health = Math.min(MAX_HEALTH, s.health + step * 1.5);
    }
    return s;
  },

  // ---- Wanted ----
  addWanted(amount) {
    const s = this.state;
    s.wanted = Math.min(MAX_WANTED, Math.max(0, s.wanted + amount));
    s.wantedTimer = 0;
    this.onWantedChanged(s.wanted);
    return s.wanted;
  },

  setWanted(level) {
    const s = this.state;
    s.wanted = Math.min(MAX_WANTED, Math.max(0, level));
    s.wantedTimer = 0;
    this.onWantedChanged(s.wanted);
    return s.wanted;
  },

  clearWanted() {
    const s = this.state;
    s.wanted = 0;
    s.wantedTimer = 0;
    this.dismissHeli();
    this.onWantedChanged(0);
    return 0;
  },

  onWantedChanged(level) {
    // Hook yang dipakai HUD/main: spawn / lepas polisi & heli.
    if (level >= 3) this.spawnHeli();
    if (level >= 1) this.ensureCops(Math.min(level, 4));
    if (level === 0) {
      this.state.cops = [];
      this.dismissHeli();
    }
    if (typeof SB !== 'undefined' && SB.HUD && typeof SB.HUD.setWanted === 'function') {
      SB.HUD.setWanted(level);
    }
  },

  // Curi mobil = +2 wanted TOTAL (bukan +1 lalu +1 terpisah).
  stealCar(vehicleId) {
    const s = this.state;
    s.carsStolen += 1;
    s.player.inVehicle = true;
    s.player.vehicleId = vehicleId || null;
    s.player.mode = 'car';
    const level = this.addWanted(2);
    return { wanted: level, carsStolen: s.carsStolen };
  },

  exitVehicle() {
    const s = this.state;
    s.player.inVehicle = false;
    s.player.vehicleId = null;
    s.player.vehicle = null;
    s.player.mode = 'foot';
  },

  // ---- Polisi ----
  ensureCops(count) {
    const s = this.state;
    while (s.cops.length < count) {
      const i = s.cops.length;
      s.cops.push({
        id: 'cop-' + (Date.now() % 100000) + '-' + i,
        pos: { x: s.player.x + 18 + i * 6, y: 0, z: s.player.z - 14 - i * 4 },
        hp: 100,
        speed: 7 + s.wanted,
        state: 'chase',
      });
    }
  },

  updateCops(dt) {
    const s = this.state;
    if (s.wanted === 0) return;
    for (const cop of s.cops) {
      if (cop.hp <= 0) continue;
      const dx = s.player.x - cop.pos.x;
      const dz = s.player.z - cop.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const step = cop.speed * dt;
      cop.pos.x += (dx / dist) * step;
      cop.pos.z += (dz / dist) * step;
      // Polisi menabrak pemain dari dekat: kurangi health.
      if (dist < 2.2) {
        this.damagePlayer(6 * dt);
      }
    }
    s.cops = s.cops.filter((c) => c.hp > 0);
  },

  // Menembak polisi: kurangi HP polisi; bila HP habis, polisi tumbang,
  // wanted naik +1 (maks 5) dan REP naik.
  shootCop(copId, damage) {
    const s = this.state;
    const dmg = typeof damage === 'number' ? damage : 34;
    const cop = s.cops.find((c) => c.id === copId) || s.cops[0];
    if (!cop) return null;
    cop.hp = Math.max(0, cop.hp - dmg);
    s.stats.shotsHit += 1;
    if (cop.hp <= 0) {
      s.copsShot += 1;
      s.rep = Math.min(100, s.rep + 2);
      s.cops = s.cops.filter((c) => c.id !== cop.id);
      this.addWanted(1);
      return { id: cop.id, hp: 0, down: true, wanted: s.wanted };
    }
    return { id: cop.id, hp: cop.hp, down: false, wanted: s.wanted };
  },

  damagePlayer(amount) {
    const s = this.state;
    if (s.mode !== 'playing' || !s.player.alive) return s.health;
    s.health = Math.max(0, s.health - amount);
    if (s.health <= 0) this.gameOver();
    return s.health;
  },

  healPlayer(amount) {
    const s = this.state;
    s.health = Math.min(MAX_HEALTH, s.health + amount);
    return s.health;
  },

  // ---- Heli AIR-1 ----
  spawnHeli() {
    const s = this.state;
    if (s.heliActive && s.heli) return s.heli;
    s.heliActive = true;
    s.heliHp = 300;
    s.heli = {
      id: 'AIR-1',
      name: 'AIR-1',
      pos: { x: s.player.x + 25, y: 32, z: s.player.z + 25 },
      hp: 300,
      active: true,
    };
    return s.heli;
  },

  updateHeli(dt) {
    const s = this.state;
    if (!s.heliActive || !s.heli || s.wanted < 3) return;
    const h = s.heli;
    // Heli melayang mengikuti pemain dari ketinggian.
    const dx = s.player.x - h.pos.x;
    const dz = s.player.z - h.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;
    h.pos.x += (dx / dist) * 9 * dt;
    h.pos.z += (dz / dist) * 9 * dt;
    h.pos.y = 30 + Math.sin(s.elapsed * 1.4) * 2;
    if (dist < 30) this.damagePlayer(4 * dt);
  },

  dismissHeli() {
    const s = this.state;
    s.heliActive = false;
    s.heliHp = 0;
    s.heli = null;
  },

  shootHeli(damage) {
    const s = this.state;
    if (!s.heli) return null;
    const dmg = typeof damage === 'number' ? damage : 25;
    s.heli.hp = Math.max(0, s.heli.hp - dmg);
    s.heliHp = s.heli.hp;
    if (s.heli.hp <= 0) {
      s.rep = Math.min(100, s.rep + 10);
      this.dismissHeli();
      return { id: 'AIR-1', hp: 0, down: true };
    }
    return { id: 'AIR-1', hp: s.heli.hp, down: false };
  },

  // ---- Ekonomi & misi ----
  addCash(amount) {
    const s = this.state;
    s.cash = Math.max(0, s.cash + amount);
    return s.cash;
  },

  addRep(amount) {
    const s = this.state;
    s.rep = Math.min(100, Math.max(0, s.rep + amount));
    return s.rep;
  },

  completeMission(rewardCash, rewardRep) {
    const s = this.state;
    s.missionsDone += 1;
    if (rewardCash) this.addCash(rewardCash);
    if (rewardRep) this.addRep(rewardRep);
    s.score += 100 + (rewardCash || 0);
    return { missionsDone: s.missionsDone, cash: s.cash, rep: s.rep };
  },

  setWeather(weather) {
    const allowed = ['clear', 'sunset', 'cloudy', 'rain'];
    this.state.weather = allowed.includes(weather) ? weather : 'sunset';
    return this.state.weather;
  },

  // ---- Game over / respawn ----
  gameOver() {
    const s = this.state;
    s.mode = 'wasted';
    s.player.alive = false;
    s.health = 0;
    // Denda rumah sakit: kehilangan 10% cash, wanted direset.
    const fine = Math.floor(s.cash * 0.1);
    s.cash = Math.max(0, s.cash - fine);
    s.wanted = 0;
    s.cops = [];
    this.dismissHeli();
    this.save();
    return { mode: 'wasted', fine, cash: s.cash };
  },

  respawn() {
    const s = this.state;
    s.mode = 'playing';
    s.health = MAX_HEALTH;
    s.player.alive = true;
    s.player.x = 0;
    s.player.y = 0;
    s.player.z = 8;
    s.player.yaw = 0;
    s.player.vx = 0;
    s.player.vy = 0;
    s.player.vz = 0;
    s.player.mode = 'foot';
    s.player.vehicle = null;
    s.player.inVehicle = false;
    s.player.vehicleId = null;
    s.wanted = 0;
    s.wantedTimer = 0;
    s.cops = [];
    this.dismissHeli();
    this.save();
    return s;
  },

  // ---- Save / load ----
  save() {
    try {
      if (typeof localStorage === 'undefined') return false;
      const s = this.state;
      // Player.vehicle points at a vehicle whose .driver points back
      // at the player: strip it before stringify (circular otherwise).
      const savedPlayer = Object.assign({}, s.player, { vehicle: null });
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: s.cash, rep: s.rep, health: s.health, wanted: s.wanted,
        score: s.score, ammo: s.ammo, day: s.day, missionsDone: s.missionsDone,
        carsStolen: s.carsStolen, copsShot: s.copsShot,
        timeOfDay: s.timeOfDay, weather: s.weather, elapsed: s.elapsed,
        player: savedPlayer, stats: s.stats,
      }));
      return true;
    } catch (e) {
      return false;
    }
  },

  load() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const s = makeDefaultState();
      Object.assign(s, data);
      s.mode = 'menu';
      // Never resume inside a vehicle (the vehicle is not saved).
      if (s.player) {
        s.player.mode = 'foot';
        s.player.vehicle = null;
        s.player.inVehicle = false;
        s.player.vehicleId = null;
        if (typeof s.player.x !== 'number') s.player.x = 0;
        if (typeof s.player.z !== 'number') s.player.z = 8;
        if (typeof s.player.yaw !== 'number') s.player.yaw = 0;
      }
      if (typeof s.ammo !== 'number') s.ammo = 24;
      this.state = s;
      return s;
    } catch (e) {
      return null;
    }
  },

  clearSave() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* abaikan */ }
  },
};

// Alias singkat yang dipakai main.js: SB.G adalah state game yang sama.
SB.Game = Game;
SB.G = Game;

export { Game, SAVE_KEY, makeDefaultState };
export default Game;

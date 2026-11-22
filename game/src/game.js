// Sunset Bay — SB.Game
// Core game state, main update loop, save/load, cash/wanted, game over & win.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).
// Modul ini tidak meng-import modul lain dan tidak membaca file sumber lain.

window.SB = window.SB || {};

(function () {
  "use strict";

  var SAVE_KEY = "sunset-bay-save-v1";
  var DAY_LENGTH_SECONDS = 480; // satu hari penuh game = 480 detik nyata
  var START_HOUR = 17.5; // golden hour: matahari rendah, langit oranye
  var START_CASH = 250;
  var MAX_WANTED = 5;
  var MAX_HEALTH = 100;

  function config() {
    return (window.SB && window.SB.Config) || {};
  }

  function saveKey() {
    var c = config();
    return c.SAVE_KEY || SAVE_KEY;
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function freshState() {
    return {
      // Identitas sesi
      status: "menu", // menu | playing | paused | gameover | won
      startedAt: Date.now(),
      playTime: 0, // detik total bermain
      // Pemain (disinkronkan dari SB.Player tiap frame)
      player: {
        pos: { x: 0, y: 0, z: 20 },
        vel: { x: 0, y: 0, z: 0 },
        rotY: 0,
        onFoot: true,
        health: MAX_HEALTH,
        stamina: 100,
        vehicleId: null,
        speed: 0
      },
      // Ekonomi & progres
      cash: START_CASH,
      wanted: 0,
      heat: 0, // 0..100, panas polisi; turun saat sembunyi
      respect: 0,
      // Waktu & cuaca
      time: START_HOUR, // jam 0..24
      day: 1,
      weather: "clear", // clear | rain | fog
      // Misi aktif
      mission: {
        id: null,
        stageIndex: 0,
        done: [], // id misi yang sudah selesai
        progress: {} // penghitung bebas per misi, mis. {deliveries: 2}
      },
      crew: [], // nama anggota crew yang direkrut
      weapons: {
        current: 0,
        slots: [
          { name: "Pistol", ammo: 24 },
          { name: "SMG", ammo: 0 },
          { name: "Shotgun", ammo: 0 }
        ]
      },
      // Statistik untuk cek stage misi & HUD
      stats: {
        deliveries: 0,
        fares: 0,
        racesWon: 0,
        racesRun: 0,
        carsStolen: 0,
        carsResprayed: 0,
        distanceDriven: 0,
        distanceWalked: 0,
        arrestsEscaped: 0,
        shotsFired: 0,
        pickups: 0,
        heistsDone: 0
      },
      // Hasil akhir
      gameOverReason: null,
      winReason: null,
      // HUD siap pakai untuk SB.Main (diperbarui tiap frame di update)
      hud: {
        cash: START_CASH,
        wanted: 0,
        health: MAX_HEALTH,
        stamina: 100,
        hour: START_HOUR,
        clock: "17:30",
        weather: "clear",
        missionTitle: "",
        missionStage: "",
        respect: 0,
        speed: 0,
        onFoot: true,
        day: 1
      }
    };
  }

  function formatClock(hour) {
    var h = Math.floor(hour) % 24;
    var m = Math.floor((hour - Math.floor(hour)) * 60);
    var hh = (h < 10 ? "0" : "") + h;
    var mm = (m < 10 ? "0" : "") + m;
    return hh + ":" + mm;
  }

  function districtNameAt(x, z) {
    if (window.SB && window.SB.City && typeof window.SB.City.getDistrictAt === "function") {
      try {
        var d = window.SB.City.getDistrictAt(x, z);
        return d ? d.name : "";
      } catch (e) { /* abaikan */ }
    }
    return "";
  }

  var Game = {
    state: freshState(),
    input: null, // diisi SB.Main tiap frame: {keys:Set, yaw, mouseDX, ...}
    _saveTimer: 0,

    // ---------- lifecycle ----------

    start: function (fresh) {
      var keep = null;
      if (fresh === false && this.hasSave()) {
        keep = this.load();
      }
      if (keep) {
        this.state.status = "playing";
      } else {
        this.state = freshState();
        this.state.status = "playing";
      }
      // Sinkronkan posisi awal ke SB.Player bila tersedia.
      if (window.SB && window.SB.Player) {
        var P = window.SB.Player;
        P.pos.x = this.state.player.pos.x;
        P.pos.y = this.state.player.pos.y;
        P.pos.z = this.state.player.pos.z;
        P.rotY = this.state.player.rotY;
        P.health = this.state.player.health;
        P.stamina = this.state.player.stamina;
        P.onFoot = true;
        P.vel.x = 0; P.vel.y = 0; P.vel.z = 0;
      }
      // Cuaca awal: cerah golden hour.
      if (window.SB && window.SB.Weather && typeof window.SB.Weather.setWeather === "function") {
        try { window.SB.Weather.setWeather("clear"); } catch (e) { /* abaikan */ }
      }
      this.state.weather = "clear";
      this.refreshHUD();
      return this.state;
    },

    pause: function () {
      if (this.state.status === "playing") {
        this.state.status = "paused";
        this.save();
        return true;
      }
      return false;
    },

    resume: function () {
      if (this.state.status === "paused") {
        this.state.status = "playing";
        return true;
      }
      return false;
    },

    togglePause: function () {
      if (this.state.status === "playing") return this.pause();
      if (this.state.status === "paused") return this.resume();
      return false;
    },

    // ---------- loop utama ----------

    update: function (dt, input) {
      if (!dt || dt <= 0) dt = 0.016;
      if (dt > 0.25) dt = 0.25; // clamp agar tab yang lama tidak melompat
      if (input) this.input = input;
      var st = this.state;
      if (st.status !== "playing") return;

      st.playTime += dt;
      this._saveTimer += dt;

      // --- waktu game: hari berjalan, golden hour di 17.5 ---
      st.time += (dt / DAY_LENGTH_SECONDS) * 24;
      if (st.time >= 24) {
        st.time -= 24;
        st.day += 1;
      }

      // --- cuaca dari SB.Weather bila ada ---
      if (window.SB && window.SB.Weather) {
        if (typeof window.SB.Weather.update === "function") {
          try { window.SB.Weather.update(dt); } catch (e) { /* abaikan */ }
        }
        if (window.SB.Weather.current) st.weather = window.SB.Weather.current;
      }

      // --- pemain ---
      if (window.SB && window.SB.Player && typeof window.SB.Player.update === "function") {
        try { window.SB.Player.update(dt, this.input); } catch (e) { /* abaikan */ }
        this.syncPlayerFromModule();
      }

      // --- kendaraan: mobil yang dikendarai pemain ---
      if (window.SB && window.SB.Vehicles) {
        var V = window.SB.Vehicles;
        if (typeof V.update === "function") {
          try { V.update(dt, this.input); } catch (e) { /* abaikan */ }
        }
        // Bila pemain di dalam mobil, posisi pemain mengikuti mobil.
        if (!st.player.onFoot && st.player.vehicleId != null && V.CARS) {
          var car = null;
          for (var i = 0; i < V.CARS.length; i++) {
            if (V.CARS[i].id === st.player.vehicleId) { car = V.CARS[i]; break; }
          }
          if (car) {
            st.player.pos.x = car.pos.x;
            st.player.pos.y = car.pos.y;
            st.player.pos.z = car.pos.z;
            st.player.rotY = car.rotY;
            st.player.speed = Math.abs(car.speed || 0);
            if (window.SB.Player) {
              window.SB.Player.pos.x = car.pos.x;
              window.SB.Player.pos.y = car.pos.y;
              window.SB.Player.pos.z = car.pos.z;
              window.SB.Player.rotY = car.rotY;
            }
          }
        }
      }

      // --- misi ---
      if (window.SB && window.SB.Missions && typeof window.SB.Missions.update === "function") {
        try { window.SB.Missions.update(dt); } catch (e) { /* abaikan */ }
      }

      // --- sistem dunia & AI ---
      var sys = [
        ["World", "update"],
        ["NPC", "update"],
        ["Police", "update"],
        ["Crew", "update"],
        ["Races", "update"],
        ["Heist", "update"],
        ["FX", "update"],
        ["Water", "update"]
      ];
      for (var s = 0; s < sys.length; s++) {
        var mod = window.SB && window.SB[sys[s][0]];
        if (mod && typeof mod[sys[s][1]] === "function") {
          try { mod[sys[s][1]](dt); } catch (e) { /* abaikan */ }
        }
      }

      // --- wanted / heat: turun pelan saat pemain sembunyi & tidak terlihat ---
      if (st.wanted > 0) {
        var hiding = this._isHiding();
        if (hiding) {
          st.heat -= dt * 6;
          if (st.heat <= 0) {
            st.heat = 0;
            this.setWanted(st.wanted - 1);
            if (st.wanted === 0) st.stats.arrestsEscaped += 1;
          }
        } else {
          st.heat = clamp(st.heat + dt * 1.5, 0, 100);
        }
      } else {
        st.heat = Math.max(0, st.heat - dt * 10);
      }

      // --- kesehatan: mati bila 0 ---
      if (st.player.health <= 0) {
        st.player.health = 0;
        this.gameOver("You were taken down on the streets of Sunset Bay.");
        return;
      }

      // --- auto-save tiap 30 detik ---
      if (this._saveTimer >= 30) {
        this._saveTimer = 0;
        this.save();
      }

      this.refreshHUD();
    },

    // Pemain dianggap sembunyi bila jalan kaki, diam, dan jauh dari jalan raya
    // (diukur sederhana: tidak di dalam mobil dan tidak bergerak cepat).
    _isHiding: function () {
      var st = this.state;
      if (!st.player.onFoot) return false;
      var sp = Math.sqrt(
        st.player.vel.x * st.player.vel.x + st.player.vel.z * st.player.vel.z
      );
      return sp < 0.5;
    },

    syncPlayerFromModule: function () {
      var P = window.SB && window.SB.Player;
      var st = this.state;
      if (!P || !P.pos) return;
      var prevX = st.player.pos.x;
      var prevZ = st.player.pos.z;
      st.player.pos.x = P.pos.x;
      st.player.pos.y = P.pos.y;
      st.player.pos.z = P.pos.z;
      st.player.vel.x = P.vel.x || 0;
      st.player.vel.y = P.vel.y || 0;
      st.player.vel.z = P.vel.z || 0;
      st.player.rotY = P.rotY || 0;
      st.player.onFoot = P.onFoot !== false;
      st.player.health = P.health != null ? P.health : st.player.health;
      st.player.stamina = P.stamina != null ? P.stamina : st.player.stamina;
      st.player.vehicleId = P.vehicleId != null ? P.vehicleId : st.player.vehicleId;
      var dx = st.player.pos.x - prevX;
      var dz = st.player.pos.z - prevZ;
      var moved = Math.sqrt(dx * dx + dz * dz);
      if (st.player.onFoot) st.stats.distanceWalked += moved;
      else st.stats.distanceDriven += moved;
      if (st.player.onFoot) {
        st.player.speed = Math.sqrt(
          st.player.vel.x * st.player.vel.x + st.player.vel.z * st.player.vel.z
        );
      }
    },

    // ---------- HUD ----------

    refreshHUD: function () {
      var st = this.state;
      var hud = st.hud;
      hud.cash = st.cash;
      hud.wanted = st.wanted;
      hud.heat = Math.round(st.heat);
      hud.health = Math.round(st.player.health);
      hud.stamina = Math.round(st.player.stamina);
      hud.hour = st.time;
      hud.clock = formatClock(st.time);
      hud.weather = st.weather;
      hud.respect = st.respect;
      hud.speed = Math.round(st.player.speed || 0);
      hud.onFoot = st.player.onFoot;
      hud.day = st.day;
      hud.district = districtNameAt(st.player.pos.x, st.player.pos.z);
      var cur = null;
      if (window.SB && window.SB.Missions && typeof window.SB.Missions.current === "function") {
        try { cur = window.SB.Missions.current(); } catch (e) { cur = null; }
      }
      if (cur) {
        hud.missionTitle = cur.title || "";
        var stage = cur.stages && cur.stages[st.mission.stageIndex];
        hud.missionStage = stage ? stage.text : "";
        hud.missionId = cur.id;
        hud.missionStageIndex = st.mission.stageIndex;
        hud.missionStageCount = cur.stages ? cur.stages.length : 0;
      } else {
        hud.missionTitle = "";
        hud.missionStage = "";
        hud.missionId = null;
        hud.missionStageIndex = 0;
        hud.missionStageCount = 0;
      }
      return hud;
    },

    getHUD: function () {
      return this.refreshHUD();
    },

    // ---------- ekonomi ----------

    addCash: function (n) {
      n = Math.round(n) || 0;
      this.state.cash += n;
      if (this.state.cash < 0) this.state.cash = 0;
      if (window.SB && window.SB.Economy) {
        // Jaga agar modul ekonomi tetap sinkron dengan kas game.
        if (typeof window.SB.Economy.cash === "number") {
          window.SB.Economy.cash = this.state.cash;
        }
      }
      this.state.hud.cash = this.state.cash;
      return this.state.cash;
    },

    spendCash: function (n) {
      n = Math.round(n) || 0;
      if (this.state.cash < n) return false;
      this.state.cash -= n;
      this.state.hud.cash = this.state.cash;
      return true;
    },

    addRespect: function (n) {
      n = Math.round(n) || 0;
      this.state.respect += n;
      if (this.state.respect < 0) this.state.respect = 0;
      if (window.SB && window.SB.Respect && typeof window.SB.Respect.gain === "function") {
        try {
          var d = districtNameAt(this.state.player.pos.x, this.state.player.pos.z);
          window.SB.Respect.gain(d || "Marina Bay", n);
        } catch (e) { /* abaikan */ }
      }
      return this.state.respect;
    },

    setWanted: function (n) {
      n = clamp(Math.round(n) || 0, 0, MAX_WANTED);
      var prev = this.state.wanted;
      // Guard anti-rekursi: Police.setWanted() memanggil kembali Game.setWanted(n).
      // Karena state sudah diset ke n di pemanggilan pertama, pemanggilan ulang
      // (n === prev) langsung return tanpa memanggil Police lagi — tidak ada loop.
      if (n === prev) return this.state.wanted;
      this.state.wanted = n;
      if (n > prev) {
        this.state.heat = Math.max(this.state.heat, 25 + n * 12);
        if (window.SB && window.SB.Police && typeof window.SB.Police.heat === "function") {
          try { window.SB.Police.heat(); } catch (e) { /* abaikan */ }
        }
      }
      if (n === 0) this.state.heat = 0;
      // Sinkronkan modul Police lewat setter resminya (bukan assignment langsung):
      // ini mengupdate closure WANTED + properti + memanggil syncCopCars().
      if (window.SB && window.SB.Police && typeof window.SB.Police.setWanted === "function") {
        try { window.SB.Police.setWanted(n); } catch (e) { /* abaikan */ }
      }
      this.state.hud.wanted = n;
      return this.state.wanted;
    },

    raiseWanted: function (n) {
      return this.setWanted(this.state.wanted + (n || 1));
    },

    damagePlayer: function (n) {
      this.state.player.health = clamp(this.state.player.health - (n || 0), 0, MAX_HEALTH);
      if (window.SB && window.SB.Player) window.SB.Player.health = this.state.player.health;
      if (this.state.player.health <= 0) {
        this.gameOver("You were taken down on the streets of Sunset Bay.");
      }
      return this.state.player.health;
    },

    healPlayer: function (n) {
      this.state.player.health = clamp(this.state.player.health + (n || 0), 0, MAX_HEALTH);
      if (window.SB && window.SB.Player) window.SB.Player.health = this.state.player.health;
      return this.state.player.health;
    },

    // ---------- misi & progres ----------

    missionsDoneCount: function () {
      return this.state.mission.done.length;
    },

    allMissionsDone: function () {
      if (window.SB && window.SB.Missions && window.SB.Missions.LIST) {
        return this.state.mission.done.length >= window.SB.Missions.LIST.length;
      }
      return false;
    },

    // ---------- save / load ----------

    hasSave: function () {
      try {
        return !!window.localStorage.getItem(saveKey());
      } catch (e) {
        return false;
      }
    },

    save: function () {
      var st = this.state;
      var data = {
        version: 1,
        savedAt: Date.now(),
        cash: st.cash,
        wanted: st.wanted,
        heat: st.heat,
        respect: st.respect,
        time: st.time,
        day: st.day,
        weather: st.weather,
        playTime: st.playTime,
        player: {
          pos: { x: st.player.pos.x, y: st.player.pos.y, z: st.player.pos.z },
          rotY: st.player.rotY,
          health: st.player.health,
          stamina: st.player.stamina,
          onFoot: st.player.onFoot
        },
        mission: {
          id: st.mission.id,
          stageIndex: st.mission.stageIndex,
          done: st.mission.done.slice(),
          progress: st.mission.progress
        },
        crew: st.crew.slice(),
        weapons: JSON.parse(JSON.stringify(st.weapons)),
        stats: JSON.parse(JSON.stringify(st.stats))
      };
      try {
        window.localStorage.setItem(saveKey(), JSON.stringify(data));
        return true;
      } catch (e) {
        return false;
      }
    },

    load: function () {
      var raw = null;
      try {
        raw = window.localStorage.getItem(saveKey());
      } catch (e) {
        return false;
      }
      if (!raw) return false;
      var data = null;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        return false;
      }
      if (!data || data.version !== 1) return false;
      var st = freshState();
      st.cash = typeof data.cash === "number" ? data.cash : START_CASH;
      st.wanted = clamp(data.wanted || 0, 0, MAX_WANTED);
      st.heat = clamp(data.heat || 0, 0, 100);
      st.respect = data.respect || 0;
      st.time = typeof data.time === "number" ? data.time : START_HOUR;
      st.day = data.day || 1;
      st.weather = data.weather || "clear";
      st.playTime = data.playTime || 0;
      if (data.player) {
        if (data.player.pos) {
          st.player.pos.x = data.player.pos.x || 0;
          st.player.pos.y = data.player.pos.y || 0;
          st.player.pos.z = data.player.pos.z || 20;
        }
        st.player.rotY = data.player.rotY || 0;
        st.player.health = clamp(data.player.health != null ? data.player.health : MAX_HEALTH, 0, MAX_HEALTH);
        st.player.stamina = clamp(data.player.stamina != null ? data.player.stamina : 100, 0, 100);
        st.player.onFoot = true; // selalu mulai lanjutan dengan jalan kaki
        st.player.vehicleId = null;
      }
      if (data.mission) {
        st.mission.id = data.mission.id || null;
        st.mission.stageIndex = data.mission.stageIndex || 0;
        st.mission.done = Array.isArray(data.mission.done) ? data.mission.done.slice() : [];
        st.mission.progress = data.mission.progress || {};
      }
      if (Array.isArray(data.crew)) st.crew = data.crew.slice();
      if (data.weapons) st.weapons = data.weapons;
      if (data.stats) {
        for (var k in data.stats) {
          if (Object.prototype.hasOwnProperty.call(st.stats, k)) st.stats[k] = data.stats[k];
        }
      }
      st.status = "playing";
      this.state = st;
      // Terapkan kembali ke modul Player.
      if (window.SB && window.SB.Player) {
        var P = window.SB.Player;
        P.pos.x = st.player.pos.x;
        P.pos.y = st.player.pos.y;
        P.pos.z = st.player.pos.z;
        P.rotY = st.player.rotY;
        P.health = st.player.health;
        P.stamina = st.player.stamina;
        P.onFoot = true;
        P.vel.x = 0; P.vel.y = 0; P.vel.z = 0;
      }
      this.refreshHUD();
      return true;
    },

    clearSave: function () {
      try {
        window.localStorage.removeItem(saveKey());
        return true;
      } catch (e) {
        return false;
      }
    },

    // ---------- akhir game ----------

    gameOver: function (reason) {
      var st = this.state;
      if (st.status === "gameover") return st;
      st.status = "gameover";
      st.gameOverReason = reason || "You failed in Sunset Bay.";
      this.save();
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("mission"); } catch (e) { /* abaikan */ }
      }
      return st;
    },

    win: function (reason) {
      var st = this.state;
      if (st.status === "won") return st;
      st.status = "won";
      st.winReason = reason || "You became a legend of Sunset Bay.";
      this.save();
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("mission"); } catch (e) { /* abaikan */ }
      }
      return st;
    }
  };

  window.SB.Game = Game;
})();

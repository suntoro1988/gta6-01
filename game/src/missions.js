// Sunset Bay — SB.Missions
// 22 misi cerita (79 stage total): dari kurir jalanan sampai heist besar.
// Tiap stage punya check(state) NYATA — posisi, kendaraan, kecepatan, uang,
// wanted, waktu, respect, crew, atau statistik — bukan auto-selesai.
// Komunikasi antar modul HANYA lewat namespace SB (design spec §4).

window.SB = window.SB || {};

(function () {
  "use strict";

  // Pusat distrik — SAMA PERSIS dengan design spec §3.
  var DISTRICTS = {
    "Marina Bay": { x: 0, z: 0, r: 120 },
    "Old Town": { x: -120, z: 40, r: 90 },
    "Fisherman's Wharf": { x: -185, z: 40, r: 55 },
    "Sunset Strip": { x: 120, z: -60, r: 100 },
    "North Hills": { x: 60, z: 180, r: 110 },
    "East Market": { x: 200, z: 80, r: 90 },
    "Harbor Point": { x: -220, z: -80, r: 80 },
    "Palm Court": { x: 40, z: -180, r: 90 },
    "Coral District": { x: -60, z: -140, r: 80 },
    "Beacon Hill": { x: 180, z: 180, r: 100 },
    "Little Havana": { x: -160, z: 160, r: 90 },
    "Airport South": { x: 260, z: -160, r: 110 },
    "University Row": { x: -40, z: 220, r: 90 },
    "Industrial Docks": { x: 240, z: 20, r: 100 }
  };

  function dist2(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function playerPos(state) {
    if (state && state.player && state.player.pos) return state.player.pos;
    if (window.SB && window.SB.Player && window.SB.Player.pos) return window.SB.Player.pos;
    return { x: 0, y: 0, z: 0 };
  }

  function stat(state, key) {
    if (state && state.stats && typeof state.stats[key] === "number") return state.stats[key];
    return 0;
  }

  function progress(state, key) {
    if (state && state.mission && state.mission.progress &&
        typeof state.mission.progress[key] === "number") {
      return state.mission.progress[key];
    }
    return 0;
  }

  // ---------- pabrik check stage (semua menerima state = SB.Game.state) ----------

  // Berada dalam radius r dari titik (x, z).
  function at(x, z, r) {
    return function (state) {
      var p = playerPos(state);
      return dist2(p.x, p.z, x, z) <= (r || 12);
    };
  }

  // Berada di dalam distrik bernama.
  function inDistrict(name) {
    return function (state) {
      if (window.SB && window.SB.City && typeof window.SB.City.getDistrictAt === "function") {
        try {
          var d = window.SB.City.getDistrictAt(playerPos(state).x, playerPos(state).z);
          if (d) return d.name === name;
        } catch (e) { /* jatuh ke tabel lokal */ }
      }
      var c = DISTRICTS[name];
      if (!c) return false;
      var p = playerPos(state);
      return dist2(p.x, p.z, c.x, c.z) <= c.r;
    };
  }

  function driving() {
    return function (state) {
      if (state && state.player) return state.player.onFoot === false;
      return window.SB && window.SB.Player ? window.SB.Player.onFoot === false : false;
    };
  }

  function onFoot() {
    return function (state) {
      if (state && state.player) return state.player.onFoot !== false;
      return window.SB && window.SB.Player ? window.SB.Player.onFoot !== false : true;
    };
  }

  function drivingFast(minSpeed) {
    return function (state) {
      var s = 0;
      if (state && state.player) s = state.player.speed || 0;
      return state && state.player && state.player.onFoot === false && s >= minSpeed;
    };
  }

  function cashAtLeast(n) {
    return function (state) { return (state ? state.cash || 0 : 0) >= n; };
  }

  function wantedAtLeast(n) {
    return function (state) { return (state ? state.wanted || 0 : 0) >= n; };
  }

  function wantedIs(n) {
    return function (state) { return (state ? state.wanted || 0 : 0) === n; };
  }

  function timeAfter(h) {
    return function (state) { return (state ? state.time || 0 : 0) >= h; };
  }

  function timeBefore(h) {
    return function (state) { return (state ? state.time || 0 : 0) < h; };
  }

  function statAtLeast(key, n) {
    return function (state) { return stat(state, key) >= n; };
  }

  function progressAtLeast(key, n) {
    return function (state) { return progress(state, key) >= n; };
  }

  function respectAtLeast(n) {
    return function (state) { return (state ? state.respect || 0 : 0) >= n; };
  }

  function crewAtLeast(n) {
    return function (state) {
      var c = state ? state.crew : null;
      return (c ? c.length : 0) >= n;
    };
  }

  function healthAtLeast(n) {
    return function (state) {
      var h = 100;
      if (state && state.player) h = state.player.health;
      return h >= n;
    };
  }

  function all(checks) {
    return function (state) {
      for (var i = 0; i < checks.length; i++) {
        if (!checks[i](state)) return false;
      }
      return true;
    };
  }

  function any(checks) {
    return function (state) {
      for (var i = 0; i < checks.length; i++) {
        if (checks[i](state)) return true;
      }
      return false;
    };
  }

  // ---------- daftar misi ----------
  // 22 misi, 79 stage: 13 misi x 4 stage + 9 misi x 3 stage = 52 + 27 = 79.
  // Cerita: kurir -> taksi -> balap jalanan -> kru -> heist besar -> legenda.

  var LIST = [
    {
      id: "courier-first",
      title: "First Delivery",
      desc: "A courier job in Marina Bay. Pick up the parcel, cross town, and deliver it before dark.",
      district: "Marina Bay",
      reqRespect: 0,
      rewardCash: 120,
      rewardRespect: 10,
      stages: [
        { text: "Go to the pickup point at the Marina Bay docks", check: at(-30, 30, 14) },
        { text: "Pick up the parcel on foot", check: all([at(-30, 30, 14), onFoot()]) },
        { text: "Deliver the parcel to Old Town", check: at(-120, 40, 14) },
        { text: "Return to Marina Bay to collect your pay", check: at(10, -10, 16) }
      ]
    },
    {
      id: "courier-rush",
      title: "Rush Hour",
      desc: "Old Town is jammed and the client is impatient. Three drops, one hour, no excuses.",
      district: "Old Town",
      reqRespect: 10,
      rewardCash: 180,
      rewardRespect: 12,
      stages: [
        { text: "Pick up the rush parcels in Old Town", check: at(-120, 40, 14) },
        { text: "Drop parcel one at Fisherman's Wharf", check: at(-185, 40, 12) },
        { text: "Drop parcel two at Sunset Strip", check: at(120, -60, 14) },
        { text: "Drop parcel three at Palm Court", check: at(40, -180, 14) }
      ]
    },
    {
      id: "taxi-night",
      title: "Night Shift Taxi",
      desc: "Drive a cab through the neon of Sunset Strip. Fares pay well after sunset.",
      district: "Sunset Strip",
      reqRespect: 20,
      rewardCash: 220,
      rewardRespect: 14,
      stages: [
        { text: "Steal or find a car and get behind the wheel", check: driving() },
        { text: "Pick up your first fare on Sunset Strip", check: all([driving(), at(120, -60, 18)]) },
        { text: "Drop the fare at Coral District", check: all([driving(), at(-60, -140, 14)]) },
        { text: "Pick up a second fare and drop it at North Hills", check: all([driving(), at(60, 180, 16)]) }
      ]
    },
    {
      id: "taxi-airport",
      title: "Airport Run",
      desc: "A VIP lands at Airport South and needs a fast, quiet ride to Beacon Hill.",
      district: "Airport South",
      reqRespect: 30,
      rewardCash: 260,
      rewardRespect: 14,
      stages: [
        { text: "Drive to Airport South arrivals", check: all([driving(), at(260, -160, 16)]) },
        { text: "Take the VIP to Beacon Hill", check: all([driving(), at(180, 180, 16)]) },
        { text: "Finish the run with the car in one piece (health 60+)", check: healthAtLeast(60) }
      ]
    },
    {
      id: "race-heat",
      title: "Street Heat",
      desc: "Your first illegal street race. Beat the pack on the Strip and earn the scene's respect.",
      district: "Sunset Strip",
      reqRespect: 35,
      rewardCash: 400,
      rewardRespect: 20,
      stages: [
        { text: "Reach the start line on Sunset Strip in a car", check: all([driving(), at(120, -60, 16)]) },
        { text: "Hit 25 speed on the straight", check: drivingFast(25) },
        { text: "Reach the Harbor Point checkpoint", check: all([driving(), at(-220, -80, 16)]) },
        { text: "Win a street race", check: statAtLeast("racesWon", 1) }
      ]
    },
    {
      id: "race-harbor",
      title: "Harbor Sprint",
      desc: "A sprint along the docks. Short, wet, and dangerous when the rain comes in.",
      district: "Harbor Point",
      reqRespect: 50,
      rewardCash: 350,
      rewardRespect: 18,
      stages: [
        { text: "Get to the Harbor Point start line", check: all([driving(), at(-220, -80, 16)]) },
        { text: "Sprint to Industrial Docks", check: all([driving(), at(240, 20, 16)]) },
        { text: "Win 2 street races in total", check: statAtLeast("racesWon", 2) }
      ]
    },
    {
      id: "courier-fish",
      title: "Fish Market Run",
      desc: "Fresh catch from Fisherman's Wharf has to reach East Market before it spoils.",
      district: "Fisherman's Wharf",
      reqRespect: 55,
      rewardCash: 240,
      rewardRespect: 14,
      stages: [
        { text: "Collect the fish crates at the Wharf", check: at(-185, 40, 12) },
        { text: "Drive the crates to East Market", check: all([driving(), at(200, 80, 14)]) },
        { text: "Deliver the second load to Little Havana", check: at(-160, 160, 14) },
        { text: "Make 4 deliveries in total", check: statAtLeast("deliveries", 4) }
      ]
    },
    {
      id: "heist-casing",
      title: "Casing the Bank",
      desc: "The big job needs eyes first. Scout the Beacon Hill bank without raising heat.",
      district: "Beacon Hill",
      reqRespect: 65,
      rewardCash: 300,
      rewardRespect: 18,
      stages: [
        { text: "Scout the bank in Beacon Hill on foot", check: all([onFoot(), at(180, 180, 16)]) },
        { text: "Check the escape route through North Hills", check: at(60, 180, 16) },
        { text: "Check the boat exit at Marina Bay", check: at(0, 0, 18) },
        { text: "Leave the area with zero wanted stars", check: all([wantedIs(0), at(0, 0, 40)]) }
      ]
    },
    {
      id: "crew-driver",
      title: "Recruit the Driver",
      desc: "Every crew needs a wheelman. Convince Rico in Little Havana to join you.",
      district: "Little Havana",
      reqRespect: 70,
      rewardCash: 150,
      rewardRespect: 16,
      stages: [
        { text: "Find Rico in Little Havana", check: at(-160, 160, 14) },
        { text: "Prove yourself: drive fast past the plaza", check: drivingFast(20) },
        { text: "Have at least 1 crew member", check: crewAtLeast(1) }
      ]
    },
    {
      id: "race-hills",
      title: "Hills Climb",
      desc: "Twisty mountain roads above North Hills. Only the best drivers survive the climb.",
      district: "North Hills",
      reqRespect: 80,
      rewardCash: 500,
      rewardRespect: 22,
      stages: [
        { text: "Reach the North Hills start line", check: all([driving(), at(60, 180, 16)]) },
        { text: "Climb to University Row", check: all([driving(), at(-40, 220, 14)]) },
        { text: "Descend fast to Beacon Hill", check: drivingFast(28) },
        { text: "Win 3 street races in total", check: statAtLeast("racesWon", 3) }
      ]
    },
    {
      id: "taxi-vip",
      title: "VIP Client",
      desc: "A movie star in Palm Court wants a discreet driver for the whole evening.",
      district: "Palm Court",
      reqRespect: 90,
      rewardCash: 320,
      rewardRespect: 16,
      stages: [
        { text: "Pick up the VIP in Palm Court", check: all([driving(), at(40, -180, 14)]) },
        { text: "Drive the VIP to Sunset Strip", check: all([driving(), at(120, -60, 14)]) },
        { text: "Finish the evening with zero wanted stars", check: wantedIs(0) }
      ]
    },
    {
      id: "courier-market",
      title: "East Market Haul",
      desc: "The market never sleeps. Haul goods across four districts before sunrise.",
      district: "East Market",
      reqRespect: 100,
      rewardCash: 380,
      rewardRespect: 18,
      stages: [
        { text: "Load up at East Market", check: at(200, 80, 14) },
        { text: "Deliver to Coral District", check: at(-60, -140, 14) },
        { text: "Deliver to Old Town", check: at(-120, 40, 14) },
        { text: "Deliver to Airport South", check: all([driving(), at(260, -160, 16)]) }
      ]
    },
    {
      id: "heist-wheels",
      title: "Getaway Wheels",
      desc: "The heist needs fast, clean cars. Steal and respray two rides at the Docks.",
      district: "Industrial Docks",
      reqRespect: 110,
      rewardCash: 450,
      rewardRespect: 20,
      stages: [
        { text: "Reach Industrial Docks", check: at(240, 20, 16) },
        { text: "Steal a car", check: statAtLeast("carsStolen", 1) },
        { text: "Respray the getaway car", check: statAtLeast("carsResprayed", 1) },
        { text: "Park the clean car at Marina Bay", check: all([driving(), at(0, 0, 18)]) }
      ]
    },
    {
      id: "race-university",
      title: "University Loop",
      desc: "Students race the loop around University Row every Friday. Take their crown.",
      district: "University Row",
      reqRespect: 120,
      rewardCash: 420,
      rewardRespect: 20,
      stages: [
        { text: "Reach the University Row loop", check: all([driving(), at(-40, 220, 14)]) },
        { text: "Complete a full loop back to the start", check: all([driving(), at(-40, 220, 14), statAtLeast("racesRun", 1)]) },
        { text: "Win 4 street races in total", check: statAtLeast("racesWon", 4) }
      ]
    },
    {
      id: "courier-coral",
      title: "Coral Run",
      desc: "Smuggle medical supplies through Coral District while the cops watch the main roads.",
      district: "Coral District",
      reqRespect: 130,
      rewardCash: 400,
      rewardRespect: 18,
      stages: [
        { text: "Pick up the supplies in Coral District", check: at(-60, -140, 12) },
        { text: "Slip through Old Town unseen (wanted 0)", check: all([at(-120, 40, 14), wantedIs(0)]) },
        { text: "Deliver to North Hills", check: at(60, 180, 14) },
        { text: "Make 6 deliveries in total", check: statAtLeast("deliveries", 6) }
      ]
    },
    {
      id: "crew-mechanic",
      title: "The Mechanic",
      desc: "Maya at the Docks can armor any car — if you bring her the parts and the cash.",
      district: "Industrial Docks",
      reqRespect: 140,
      rewardCash: 200,
      rewardRespect: 16,
      stages: [
        { text: "Find Maya's garage at Industrial Docks", check: at(240, 20, 14) },
        { text: "Bring $800 to pay for the parts", check: cashAtLeast(800) },
        { text: "Have at least 2 crew members", check: crewAtLeast(2) }
      ]
    },
    {
      id: "heist-marina",
      title: "The Marina Job",
      desc: "A yacht full of cash docks at Marina Bay tonight. Hit it fast, leave by boat.",
      district: "Marina Bay",
      reqRespect: 150,
      rewardCash: 900,
      rewardRespect: 25,
      stages: [
        { text: "Reach the Marina Bay yacht at night", check: all([driving(), at(0, 0, 16)]) },
        { text: "Grab the cash on foot", check: all([onFoot(), at(0, 0, 16)]) },
        { text: "Escape by car to Harbor Point", check: all([driving(), at(-220, -80, 16)]) },
        { text: "Lose the heat completely", check: wantedIs(0) }
      ]
    },
    {
      id: "race-dockside",
      title: "Dockside Dash",
      desc: "The final qualifier: a midnight dash from the Docks to the Strip. Winner takes all.",
      district: "Industrial Docks",
      reqRespect: 160,
      rewardCash: 650,
      rewardRespect: 22,
      stages: [
        { text: "Line up at Industrial Docks after dark", check: all([driving(), at(240, 20, 16)]) },
        { text: "Race to Sunset Strip", check: all([driving(), at(120, -60, 16)]) },
        { text: "Win 5 street races in total", check: statAtLeast("racesWon", 5) }
      ]
    },
    {
      id: "taxi-last",
      title: "Last Fare",
      desc: "One last honest fare through Old Town before the big night. The city feels different now.",
      district: "Old Town",
      reqRespect: 170,
      rewardCash: 300,
      rewardRespect: 16,
      stages: [
        { text: "Pick up the last fare in Old Town", check: all([driving(), at(-120, 40, 14)]) },
        { text: "Drop the fare at Palm Court", check: all([driving(), at(40, -180, 14)]) },
        { text: "Drive 500 meters in total tonight", check: statAtLeast("distanceDriven", 500) },
        { text: "Return to the Old Town cab stand", check: all([driving(), at(-120, 40, 14)]) }
      ]
    },
    {
      id: "crew-friends",
      title: "Old Friends",
      desc: "The crew is almost complete. Bring the old gang together in Little Havana.",
      district: "Little Havana",
      reqRespect: 180,
      rewardCash: 250,
      rewardRespect: 20,
      stages: [
        { text: "Gather the crew in Little Havana", check: at(-160, 160, 14) },
        { text: "Have at least 3 crew members", check: crewAtLeast(3) },
        { text: "Hold $1,500 for the big job", check: cashAtLeast(1500) }
      ]
    },
    {
      id: "heist-golden",
      title: "Golden Hour Heist",
      desc: "The Beacon Hill bank at sunset. Three phases, one shot, no mistakes.",
      district: "Beacon Hill",
      reqRespect: 190,
      rewardCash: 2500,
      rewardRespect: 40,
      stages: [
        { text: "Arrive at Beacon Hill with the full crew (3+)", check: all([at(180, 180, 18), crewAtLeast(3)]) },
        { text: "Reach the bank vault on foot", check: all([onFoot(), at(180, 180, 12)]) },
        { text: "Escape to Marina Bay in a car", check: all([driving(), at(0, 0, 18)]) },
        { text: "Complete the heist with the crew intact", check: statAtLeast("heistsDone", 1) }
      ]
    },
    {
      id: "sunset-legend",
      title: "Sunset Bay Legend",
      desc: "The whole city knows your name now. One last sunset drive to seal the legend.",
      district: "Marina Bay",
      reqRespect: 220,
      rewardCash: 5000,
      rewardRespect: 50,
      stages: [
        { text: "Drive to Marina Bay at golden hour (17:00-19:00)", check: all([driving(), at(0, 0, 20), timeAfter(17), timeBefore(19)]) },
        { text: "Hold $3,000 in cash", check: cashAtLeast(3000) },
        { text: "Finish with 100 respect in the city", check: respectAtLeast(100) }
      ]
    }
  ];

  // ---------- util ----------

  function gameState() {
    if (window.SB && window.SB.Game && window.SB.Game.state) return window.SB.Game.state;
    return null;
  }

  function findMission(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return LIST[i];
    }
    return null;
  }

  function missionIndex(id) {
    for (var i = 0; i < LIST.length; i++) {
      if (LIST[i].id === id) return i;
    }
    return -1;
  }

  var Missions = {
    LIST: LIST,
    DISTRICTS: DISTRICTS,

    totalStages: function () {
      var n = 0;
      for (var i = 0; i < LIST.length; i++) n += LIST[i].stages.length;
      return n;
    },

    get: function (id) {
      return findMission(id);
    },

    isDone: function (id) {
      var st = gameState();
      if (!st || !st.mission) return false;
      return st.mission.done.indexOf(id) !== -1;
    },

    current: function () {
      var st = gameState();
      if (!st || !st.mission || !st.mission.id) return null;
      return findMission(st.mission.id);
    },

    currentStage: function () {
      var st = gameState();
      var cur = this.current();
      if (!st || !cur) return null;
      return cur.stages[st.mission.stageIndex] || null;
    },

    canStart: function (id) {
      var m = findMission(id);
      if (!m) return false;
      if (this.isDone(id)) return false;
      var st = gameState();
      var respect = st ? st.respect || 0 : 0;
      return respect >= (m.reqRespect || 0);
    },

    start: function (id) {
      var m = findMission(id);
      if (!m) return false;
      var st = gameState();
      if (!st) return false;
      if (this.isDone(id)) return false;
      if (!this.canStart(id)) return false;
      st.mission.id = id;
      st.mission.stageIndex = 0;
      st.mission.progress = {};
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("mission"); } catch (e) { /* abaikan */ }
      }
      return true;
    },

    // Misi berikutnya yang belum selesai dan syarat respect-nya terpenuhi.
    nextAvailable: function () {
      for (var i = 0; i < LIST.length; i++) {
        if (!this.isDone(LIST[i].id) && this.canStart(LIST[i].id)) return LIST[i];
      }
      return null;
    },

    // Dipanggil tiap frame dari SB.Game.update.
    update: function (dt) {
      var st = gameState();
      if (!st || !st.mission) return;
      if (st.status && st.status !== "playing") return;
      // Auto-start misi berikutnya bila tidak ada misi aktif — tanpa ini
      // sistem misi mati total karena start() tidak pernah dipanggil UI.
      if (!st.mission.id) {
        var next = this.nextAvailable();
        if (next) this.start(next.id);
        return;
      }
      var cur = findMission(st.mission.id);
      if (!cur) return;
      var stage = cur.stages[st.mission.stageIndex];
      if (!stage) {
        this._finishMission(cur);
        return;
      }
      var done = false;
      try {
        done = !!stage.check(st);
      } catch (e) {
        done = false;
      }
      if (done) this.completeStage();
    },

    completeStage: function () {
      var st = gameState();
      if (!st || !st.mission || !st.mission.id) return false;
      var cur = findMission(st.mission.id);
      if (!cur) return false;
      var idx = st.mission.stageIndex;
      if (idx >= cur.stages.length) return false;
      st.mission.stageIndex = idx + 1;
      // Hadiah kecil tiap stage selesai.
      if (window.SB && window.SB.Game && typeof window.SB.Game.addCash === "function") {
        try { window.SB.Game.addCash(25); } catch (e) { /* abaikan */ }
      }
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("pickup"); } catch (e) { /* abaikan */ }
      }
      if (st.mission.stageIndex >= cur.stages.length) {
        this._finishMission(cur);
      }
      return true;
    },

    _finishMission: function (mission) {
      var st = gameState();
      if (!st) return;
      if (st.mission.done.indexOf(mission.id) === -1) {
        st.mission.done.push(mission.id);
      }
      // Hadiah misi: cash + respect.
      if (window.SB && window.SB.Game) {
        if (typeof window.SB.Game.addCash === "function") {
          try { window.SB.Game.addCash(mission.rewardCash || 0); } catch (e) { /* abaikan */ }
        }
        if (typeof window.SB.Game.addRespect === "function") {
          try { window.SB.Game.addRespect(mission.rewardRespect || 0); } catch (e) { /* abaikan */ }
        }
      }
      // Statistik & crew loyalty.
      if (mission.id.indexOf("courier") === 0 || mission.id.indexOf("taxi") === 0) {
        st.stats.deliveries += 1;
      }
      if (window.SB && window.SB.Crew && typeof window.SB.Crew.update === "function") {
        // Loyalty crew naik saat misi sukses — ditangani modul Crew di update-nya.
      }
      var finishedId = mission.id;
      st.mission.id = null;
      st.mission.stageIndex = 0;
      st.mission.progress = {};
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("mission"); } catch (e) { /* abaikan */ }
      }
      // Misi final -> menang.
      if (finishedId === "sunset-legend" &&
          window.SB && window.SB.Game && typeof window.SB.Game.win === "function") {
        try {
          window.SB.Game.win("You became a legend of Sunset Bay.");
        } catch (e) { /* abaikan */ }
      }
      // Otomatis tawarkan misi berikutnya bila ada (tidak auto-start).
      return true;
    },

    // Dipakai modul lain untuk mencatat progres misi, mis. SB.Races saat menang.
    bumpProgress: function (key, n) {
      var st = gameState();
      if (!st || !st.mission) return 0;
      st.mission.progress[key] = (st.mission.progress[key] || 0) + (n || 1);
      return st.mission.progress[key];
    },

    setProgress: function (key, n) {
      var st = gameState();
      if (!st || !st.mission) return 0;
      st.mission.progress[key] = n || 0;
      return st.mission.progress[key];
    },

    // Ringkasan progres untuk HUD / menu.
    summary: function () {
      var st = gameState();
      var done = st && st.mission ? st.mission.done.length : 0;
      return {
        totalMissions: LIST.length,
        totalStages: this.totalStages(),
        doneMissions: done,
        activeId: st && st.mission ? st.mission.id : null,
        activeStage: st && st.mission ? st.mission.stageIndex : 0
      };
    }
  };

  window.SB.Missions = Missions;
})();

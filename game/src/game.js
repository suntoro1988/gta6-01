(function () {
  "use strict";
  var SB = window.SB = window.SB || {};
  var SAVE_KEY = "sunset-bay-save-v1";
  var SAFE = { x: 8, z: 8 }; // safehouse
  var GARAGE = { x: 60, z: -40 }; // garage Downtown (respray)
  var bustT = 0, decayT = 0;

  function msg(t) {
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage(t);
  }

  function sfx(n) {
    if (SB.Audio && SB.Audio.sfx) SB.Audio.sfx(n);
  }

  function freshState() {
    return {
      money: 250, rep: 0, wanted: 0,
      mission: 0, missionStage: 0,
      clock: 18.0,
      player: { x: SAFE.x, z: SAFE.z, yaw: 0, hp: 100, inCar: false, car: null, speed: 0, inBoat: false },
      police: [], heli: null,
      dist: 0, drifts: 0, busted: 0,
      // Stash pickup di dunia (4 titik, diisi Game.start via initStash):
      // [{x, z, taken}] — disimpan di SB.G agar save/load konsisten.
      stash: null,
      // Senjata: mulai dengan Pistol (ammo 24) agar klik/F langsung menembak;
      // Fists selalu tersedia sebagai fallback saat ammo habis.
      weapon: 'Pistol', ammo: { Pistol: 24 },
      paused: false, input: {}
    };
  }

  if (!SB.G) SB.G = freshState();

  function st(text, x, z, reward, water) {
    var s = { text: text, target: { x: x, z: z }, reward: reward };
    if (water) s.target.water = true; // target di laut — jangan snap ke darat
    return s;
  }

  // 18 missions, 49 stages. Stage counts: 4,3,2,3,2,3,3,2,3,3,2,3,2,3,3,2,3,3.
  var MISSIONS = [
    { name: "First Wheels", stages: [
      st("Walk to the parked car by the safehouse", 14, 6, 0),
      st("Take the car (press E)", 14, 6, 0),
      st("Drive to the garage in Downtown", 60, -40, 0),
      st("Park at the safehouse to finish", 8, 8, 150) ] },
    { name: "Package Run", stages: [
      st("Pick up the package at the Harbor", -120, 80, 0),
      st("Deliver it in Old Town", -40, 120, 60),
      st("Deliver the second box in Marina Bay", 120, 60, 120) ] },
    { name: "Taxi Nights", stages: [
      st("Pick up the passenger in Uptown", 90, -90, 0),
      st("Drop them off at Beachfront", -90, -140, 90) ] },
    { name: "Harbor Lights", stages: [
      st("Meet the contact at the docks", -140, 60, 0),
      st("Check the warehouse on the pier", -100, 100, 50),
      st("Bring the crate back to the Harbor gate", -160, 20, 110) ] },
    { name: "Hillcrest Climb", stages: [
      st("Drive up to Hillcrest overlook", 150, -120, 0),
      st("Reach the summit house", 170, -150, 140) ] },
    { name: "Marina Getaway", stages: [
      // Target air (water:true) TIDAK di-snap ke darat oleh stageTarget —
      // kapal tidak bisa mencapai titik darat, jadi stage 2/3 harus di laut.
      st("Board the speedboat at the marina", -282, 44, 0),
      st("Sail to the far buoy", -420, 200, 60, true),
      st("Return to the marina dock", -292, 50, 130, true) ] },
    { name: "Night Shift", stages: [
      st("Clock in at the Downtown garage", 60, -40, 0),
      st("Tow the broken car in Southside", -60, -60, 50),
      st("Drop it at the safehouse lot", 0, 0, 120) ] },
    { name: "Downtown Dash", stages: [
      st("Race to the Downtown plaza", 40, -20, 0),
      st("Beat the clock to the north gate", 80, -60, 150) ] },
    { name: "Beachfront Cruise", stages: [
      st("Cruise the Beachfront strip", -90, -140, 0),
      st("Stop at the pier cafe", -130, -120, 60),
      st("Park at the lifeguard tower", -60, -160, 130) ] },
    { name: "Industrial Heat", stages: [
      st("Sneak into the Industrial yard", -160, -40, 0),
      st("Grab the parts from the depot", -180, -80, 70),
      st("Get out through the west gate", -140, -10, 150) ] },
    { name: "Old Town Tour", stages: [
      st("Visit the Old Town square", -40, 120, 0),
      st("Photograph the old chapel", -70, 90, 130) ] },
    { name: "Uptown Hustle", stages: [
      st("Meet the buyer in Uptown", 90, -90, 0),
      st("Collect the payment downtown", 110, -120, 60),
      st("Stash the cash at the safehouse", 70, -70, 140) ] },
    { name: "Southside Story", stages: [
      st("Find the informant in Southside", 20, 150, 0),
      st("Escort them to the safe street", 60, 130, 140) ] },
    { name: "Northside Nights", stages: [
      st("Patrol the Northside blocks", -20, -160, 0),
      st("Check the alley behind the market", 20, -140, 60),
      st("Report back at the corner store", -60, -180, 140) ] },
    { name: "Sunset Chase", stages: [
      st("Chase the rival car from the plaza", 0, 0, 0),
      st("Cut them off near the marina road", 120, -60, 80),
      st("Corner them at the Harbor fence", -120, 40, 160) ] },
    { name: "Harbor Heist", stages: [
      st("Slip into the Harbor warehouse", -140, 60, 0),
      st("Escape with the goods to the boat", -100, 20, 180) ] },
    { name: "Bay Finale", stages: [
      st("One last run: marina to Hillcrest", 120, 60, 0),
      st("Down the hill to the bay road", 150, -120, 100),
      st("Finish at the safehouse", 8, 8, 200) ] },
    { name: "Legend of the Bay", stages: [
      st("Prove it at the Downtown garage", 60, -40, 0),
      st("One final delivery in Old Town", -40, 120, 150),
      st("Take the crown at the plaza", 0, 0, 300) ] }
  ];

  // Stash pickup: 4 titik di distrik berbeda, JAUH dari stage misi mana pun
  // (bukan reward misi 12 stage 3 — itu $140 dan tidak diubah).
  // Anchor di-snap ke titik bebas bangunan via City.findClearSpot.
  var STASH_ANCHORS = [
    { x: -120, z: 120 },  // Harbor
    { x: 0, z: -100 },    // Uptown
    { x: -220, z: -200 }, // Beachfront
    { x: 220, z: 100 }    // Industrial
  ];

  function initStash() {
    var G = SB.G;
    G.stash = STASH_ANCHORS.map(function (a) {
      var c = a;
      if (SB.City && SB.City.findClearSpot) c = SB.City.findClearSpot(a.x, a.z, 2);
      return { x: c.x, z: c.z, taken: false };
    });
    return G.stash;
  }

  // Pemain jalan kaki melewati titik stash (radius 2) → +$100, sekali saja.
  function checkStash() {
    var G = SB.G;
    if (!G || !G.stash) return;
    if (G.player.inCar || G.player.inBoat) return;
    for (var i = 0; i < G.stash.length; i++) {
      var s = G.stash[i];
      if (s.taken) continue;
      if (Math.hypot(G.player.x - s.x, G.player.z - s.z) < 2) {
        s.taken = true;
        G.money += 100;
        msg("Stash found: +$100");
        sfx("pickup");
      }
    }
  }

  function curMission() { return MISSIONS[SB.G.mission] || null; }
  function curStage() {
    var m = curMission();
    return m ? (m.stages[SB.G.missionStage] || null) : null;
  }

  function stageTarget(s) {
    if (!s) return null;
    var t = s.target;
    // Target air (misi kapal) tidak boleh di-snap ke darat: findClearSpot
    // hanya mengembalikan titik darat, kapal takkan pernah sampai.
    if (t.water) return { x: t.x, z: t.z };
    if (SB.City && SB.City.findClearSpot) {
      var c = SB.City.findClearSpot(t.x, t.z, 4);
      if (c) return { x: c.x, z: c.z };
    }
    return { x: t.x, z: t.z };
  }

  function respawn() {
    var p = SB.G.player;
    p.x = SAFE.x; p.z = SAFE.z; p.yaw = 0;
    p.hp = 100; p.inCar = false; p.car = null; p.speed = 0; p.inBoat = false;
    SB.G.police = []; SB.G.heli = null; SB.G.wanted = 0;
  }

  function loseCut(label) {
    var lost = Math.floor(SB.G.money * 0.10);
    SB.G.money -= lost;
    msg(label + " You lost $" + lost + ".");
    return lost;
  }

  SB.Game = {
    MISSIONS: MISSIONS,
    SAVE_KEY: SAVE_KEY,
    safehouse: SAFE,

    start: function () {
      SB.G = freshState();
      bustT = 0; decayT = 0;
      initStash();
      msg("Welcome to Sunset Bay. Mission 1: First Wheels.");
      sfx("mission");
    },

    // Daftar titik stash (untuk QA/debug; init bila belum ada).
    stashSpots: function () {
      if (!SB.G.stash) initStash();
      return SB.G.stash;
    },

    missionTarget: function () { return stageTarget(curStage()); },

    update: function (dt) {
      var G = SB.G;
      if (!G) return;
      // Day/night clock: 1 game hour per 50 seconds.
      G.clock = (G.clock + dt * 0.02) % 24;
      // WASTED: hp hit zero.
      if (G.player.hp <= 0) {
        loseCut("WASTED!");
        G.busted = (G.busted || 0) + 1;
        respawn();
        sfx("busted");
        return;
      }
      // Mission progress: reach the stage marker.
      var s = curStage();
      if (s) {
        var t = stageTarget(s);
        var d = Math.hypot(G.player.x - t.x, G.player.z - t.z);
        if (d < 5) SB.Game.completeStage();
      }
      // Stash pickup (jalan kaki, +$100 per titik, sekali saja).
      if (!G.stash) initStash();
      checkStash();
      SB.Game.updatePolice(dt);
      SB.Game.bustCheck(dt);
      // Wanted slowly cools off when the player stays clean.
      if (G.wanted > 0) {
        decayT += dt;
        if (decayT > 90) { decayT = 0; SB.Game.wantedDown(); }
      } else decayT = 0;
    },

    completeStage: function () {
      var G = SB.G;
      var m = curMission(), s = curStage();
      if (!m || !s) return;
      if (s.reward) {
        G.money += s.reward;
        msg("Stage complete: +$" + s.reward);
      } else {
        msg("Stage complete.");
      }
      sfx("mission");
      G.missionStage++;
      if (G.missionStage >= m.stages.length) {
        // SATU misi yang selesai = total REP +100 (konsisten di semua misi,
        // berapa pun jumlah stage-nya; tidak ada REP per stage).
        G.rep = (G.rep || 0) + 100;
        msg("Mission complete: " + m.name + "! +100 REP");
        G.mission++;
        G.missionStage = 0;
        if (G.mission >= MISSIONS.length) {
          msg("All missions complete. You are a legend of the Bay!");
        } else {
          var next = MISSIONS[G.mission];
          msg("New mission: " + next.name + " — " + next.stages[0].text);
        }
      }
    },

    save: function () {
      try {
        var s = JSON.parse(JSON.stringify(SB.G));
        s.player.car = null; // never persist a live car reference
        s.player.inCar = false;
        localStorage.setItem(SAVE_KEY, JSON.stringify(s));
        return true;
      } catch (e) { return false; }
    },

    load: function () {
      try {
        var raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || typeof s.money !== "number") return null;
        return s;
      } catch (e) { return null; }
    },

    applySave: function (s) {
      if (!s) return false;
      var G = SB.G;
      G.money = s.money; G.rep = s.rep || 0; G.wanted = s.wanted || 0;
      G.mission = s.mission || 0; G.missionStage = s.missionStage || 0;
      G.clock = (typeof s.clock === "number") ? s.clock : 18.0;
      if (s.player) {
        G.player.x = s.player.x || SAFE.x;
        G.player.z = s.player.z || SAFE.z;
        G.player.yaw = s.player.yaw || 0;
        G.player.hp = s.player.hp || 100;
      }
      G.player.inCar = false; G.player.car = null;
      G.player.inBoat = false;
      G.dist = s.dist || 0; G.drifts = s.drifts || 0; G.busted = s.busted || 0;
      // Pulihkan titik stash yang sudah diambil (save/load konsisten);
      // save lama tanpa stash → init titik baru (belum diambil).
      if (s.stash && s.stash.length) G.stash = s.stash;
      else initStash();
      G.police = []; G.heli = null;
      // Pulihkan senjata; pastikan field runtime main.js selalu ada
      // (Game.start() mengganti objek SB.G, jadi default ini penting).
      G.weapon = s.weapon || 'Pistol';
      G.ammo = s.ammo || { Pistol: 24 };
      if (typeof G.paused !== 'boolean') G.paused = false;
      if (!G.input) G.input = {};
      return true;
    },

    wantedUp: function (n) {
      var G = SB.G;
      G.wanted = Math.min(5, (G.wanted || 0) + (n || 1));
      decayT = 0;
      if (G.wanted >= 3) SB.Game.spawnHeli();
    },

    wantedDown: function () {
      SB.G.wanted = Math.max(0, (SB.G.wanted || 0) - 1);
      if (SB.G.wanted < 3) SB.G.heli = null;
    },

    spawnHeli: function () {
      var G = SB.G;
      if (!G.heli) {
        G.heli = { x: G.player.x + 50, y: 55, z: G.player.z + 50 };
        msg("AIR-1 helicopter is on you!");
      }
    },

    updatePolice: function (dt) {
      var G = SB.G;
      var want = G.wanted | 0;
      if (want <= 0) {
        if (G.police.length) G.police = [];
        if (G.heli) G.heli = null;
        return;
      }
      var wantCount = Math.min(want * 2, 8);
      while (G.police.length < wantCount) {
        var a = Math.random() * Math.PI * 2;
        var r = 30 + Math.random() * 20;
        G.police.push({ x: G.player.x + Math.cos(a) * r, z: G.player.z + Math.sin(a) * r, hp: 100 });
      }
      while (G.police.length > wantCount) G.police.pop();
      var sp = 6.5 + want * 0.4;
      for (var i = 0; i < G.police.length; i++) {
        var p = G.police[i];
        var dx = G.player.x - p.x, dz = G.player.z - p.z;
        var d = Math.hypot(dx, dz) || 1;
        p.x += dx / d * sp * dt;
        p.z += dz / d * sp * dt;
      }
      G.police = G.police.filter(function (p) { return p.hp > 0; });
      if (want >= 3) {
        SB.Game.spawnHeli();
        if (G.heli) {
          G.heli.x += (G.player.x - G.heli.x) * dt * 0.8;
          G.heli.z += (G.player.z - G.heli.z) * dt * 0.8;
          G.heli.y = 55;
        }
      } else if (G.heli) G.heli = null;
    },

    bustCheck: function (dt) {
      var G = SB.G;
      if (!G.wanted || G.player.inCar) { bustT = 0; return; }
      var near = false;
      for (var i = 0; i < G.police.length; i++) {
        var p = G.police[i];
        if (Math.hypot(G.player.x - p.x, G.player.z - p.z) < 3.5) { near = true; break; }
      }
      // Running away (speed > 6) breaks the bust timer.
      if (near && G.player.speed <= 6) bustT += dt;
      else bustT = Math.max(0, bustT - dt * 2);
      if (bustT > 3) {
        bustT = 0;
        loseCut("BUSTED! The police caught you.");
        G.busted = (G.busted || 0) + 1;
        respawn();
        sfx("busted");
      }
    },

    // Garage respray: $150 clears the wanted level.
    respray: function () {
      var G = SB.G;
      if (G.wanted <= 0) { msg("No heat to clear."); return false; }
      if (G.money < 150) { msg("Respray costs $150. Not enough cash."); return false; }
      G.money -= 150;
      G.wanted = 0; G.police = []; G.heli = null;
      msg("Respray done. Heat cleared.");
      sfx("pickup");
      return true;
    },

    // True bila pemain berada di area garage (respray, radius 10).
    // Dipakai main.js (tombol F) sebelum menembak.
    atGarage: function () {
      var p = SB.G && SB.G.player;
      if (!p) return false;
      return Math.hypot(p.x - GARAGE.x, p.z - GARAGE.z) < 10;
    },

    // Polisi terdekat dalam radius r dari pemain (atau null).
    _nearestPolice: function (r) {
      var G = SB.G;
      var best = null, bestD = r * r;
      for (var i = 0; i < G.police.length; i++) {
        var p = G.police[i];
        var d = (p.x - G.player.x) * (p.x - G.player.x) +
                (p.z - G.player.z) * (p.z - G.player.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    },

    // Tembak (klik / F saat bersenjata): polisi terdekat dalam 40 unit
    // kena 34 damage, ammo -1, wanted +1 (SPEC: tembak polisi naik wanted).
    // Tanpa senjata api / ammo habis → fallback ke punch().
    shoot: function () {
      var G = SB.G;
      if (!G) return false;
      if (G.player.inCar || G.player.inBoat) return false;
      var w = G.weapon || 'Fists';
      var ammo = (G.ammo && G.ammo[w]) || 0;
      if (w === 'Fists' || ammo <= 0) {
        if (w !== 'Fists' && ammo <= 0) msg("No ammo — punching instead.");
        return SB.Game.punch();
      }
      G.ammo[w] = ammo - 1;
      sfx("shoot");
      var target = SB.Game._nearestPolice(40);
      if (target) {
        target.hp -= 34;
        SB.Game.wantedUp(1);
        if (target.hp <= 0) msg("Officer down.");
      }
      return true;
    },

    // Pukul (F saat Fists): polisi terdekat dalam 3 unit kena 20 damage.
    punch: function () {
      var G = SB.G;
      if (!G) return false;
      if (G.player.inCar || G.player.inBoat) return false;
      sfx("punch");
      var target = SB.Game._nearestPolice(3);
      if (target) {
        target.hp -= 20;
        SB.Game.wantedUp(1);
        if (target.hp <= 0) msg("Officer down.");
        return true;
      }
      return false;
    }
  };
})();

window.SB = window.SB || {};
(function () {
  'use strict';
  // SB.Races — Sunset Bay v12. Street racing: 6 races, sequential
  // checkpoints, 3 AI rival cars each, countdown start, cash prize + REP
  // for the winner, stats.racesWon. Flow: startRace(id) -> 3-2-1-GO ->
  // drive checkpoints in order (checkpoint(i)) -> finishRace() at the
  // last one. Missing a checkpoint (driving far past it without
  // triggering) fails the race. AI rivals run the same checkpoint chain
  // with per-rival pace + rubber-banding, for live HUD positions.
  var RACES = [
    { id: 'sunset-sprint', name: 'Sunset Sprint', district: 'Ocean Drive',
      entryFee: 50, prize: 400, repReward: 60, laps: 1, difficulty: 1, rivalSkill: 0.82,
      desc: 'Sprint lurus di jalan pantai saat golden hour. Pemanasan yang manis.',
      checkpoints: [{ x: 40, z: -10, r: 9 }, { x: 90, z: -30, r: 9 }, { x: 130, z: 10, r: 9 },
        { x: 110, z: 70, r: 9 }, { x: 50, z: 90, r: 9 }, { x: 0, z: 40, r: 10 }] },
    { id: 'marina-loop', name: 'Marina Loop', district: 'Marina',
      entryFee: 100, prize: 700, repReward: 90, laps: 1, difficulty: 2, rivalSkill: 0.88,
      desc: 'Putaran marina yang ketat, tikungan sempit di antara kapal dan kafe.',
      checkpoints: [{ x: -60, z: -40, r: 9 }, { x: -110, z: 0, r: 9 }, { x: -90, z: 60, r: 9 },
        { x: -30, z: 90, r: 9 }, { x: 20, z: 40, r: 9 }, { x: -10, z: -20, r: 10 }] },
    { id: 'harbour-run', name: 'Harbour Run', district: 'Harbour',
      entryFee: 150, prize: 1100, repReward: 120, laps: 1, difficulty: 3, rivalSkill: 0.93,
      desc: 'Balapan pelabuhan: kontainer, derek, dan jalan licin dekat air.',
      checkpoints: [{ x: 120, z: -80, r: 9 }, { x: 170, z: -20, r: 9 }, { x: 150, z: 50, r: 9 },
        { x: 90, z: 100, r: 9 }, { x: 30, z: 60, r: 9 }, { x: 60, z: -30, r: 9 },
        { x: 100, z: -60, r: 10 }] },
    { id: 'neon-nights', name: 'Neon Nights', district: 'Little Havana',
      entryFee: 200, prize: 1600, repReward: 150, laps: 2, difficulty: 3, rivalSkill: 0.96,
      desc: 'Balapan malam 2 lap di bawah neon Little Havana. Ramai dan berbahaya.',
      checkpoints: [{ x: -40, z: 120, r: 9 }, { x: -100, z: 90, r: 9 }, { x: -130, z: 30, r: 9 },
        { x: -80, z: -10, r: 9 }, { x: -20, z: 20, r: 9 }, { x: -10, z: 80, r: 10 }] },
    { id: 'kingpin-gp', name: 'Kingpin Grand Prix', district: 'Vice Port',
      entryFee: 400, prize: 3000, repReward: 250, laps: 2, difficulty: 5, rivalSkill: 1.0,
      desc: 'Grand Prix pamungkas keliling kota. Hanya untuk Kingpin sejati.',
      checkpoints: [{ x: 0, z: -120, r: 10 }, { x: 80, z: -100, r: 9 }, { x: 140, z: -20, r: 9 },
        { x: 120, z: 80, r: 9 }, { x: 40, z: 120, r: 9 }, { x: -60, z: 100, r: 9 },
        { x: -120, z: 20, r: 9 }, { x: -60, z: -80, r: 10 }] },
    { id: 'bridge-blitz', name: 'Bridge Blitz', district: 'Ocean Drive',
      entryFee: 250, prize: 2000, repReward: 180, laps: 1, difficulty: 4, rivalSkill: 0.98,
      desc: 'Sprint di atas jembatan saat sunset — hero shot Sunset Bay.',
      checkpoints: [{ x: -150, z: -60, r: 9 }, { x: -80, z: -90, r: 9 }, { x: 0, z: -110, r: 9 },
        { x: 80, z: -90, r: 9 }, { x: 150, z: -60, r: 9 }, { x: 180, z: 0, r: 10 }] }
  ];
  var RIVAL_NAMES = ['Vex', 'Nitro Nina', 'El Toro'];
  var RIVAL_COLORS = ['#ff4d6d', '#c58cff', '#4dd0ff'];
  var stateRef = null, active = null;
  var countdown = 0, countdownShown = 0, raceTime = 0;
  var bestTimes = {}, winsByRace = {}, initialized = false;
  function findRace(id) {
    if (!id) return null;
    var key = String(id).trim().toLowerCase();
    for (var i = 0; i < RACES.length; i++) {
      if (RACES[i].id === key || RACES[i].name.toLowerCase() === key) return RACES[i];
    }
    return null;
  }
  function toast(text) { if (window.SB && SB.HUD && SB.HUD.showToast) SB.HUD.showToast(text); }
  function sfx(name) { if (window.SB && SB.Audio && SB.Audio.sfx) SB.Audio.sfx(name); }
  function playerPos() {
    if (!stateRef || !stateRef.player) return { x: 0, z: 0 };
    return { x: stateRef.player.x || 0, z: stateRef.player.z || 0 };
  }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function formatTime(t) {
    var min = Math.floor(t / 60), sec = (t - min * 60).toFixed(1);
    return min > 0 ? min + ':' + (sec < 10 ? '0' : '') + sec : sec + 's';
  }
  function makeRivals(def) {
    var rivals = [];
    for (var i = 0; i < 3; i++) {
      rivals.push({ name: RIVAL_NAMES[i], color: RIVAL_COLORS[i],
        checkpoint: 0, lap: 1, progress: 0,
        pace: def.rivalSkill * (0.92 + Math.random() * 0.16),
        finished: false, finishTime: 0, position: i + 2, x: 0, z: 0, speed: 0 });
    }
    return rivals;
  }
  function checkpointPos(def, index) {
    var total = def.checkpoints.length;
    var cp = def.checkpoints[index % total];
    return { x: cp.x, z: cp.z, r: cp.r, lap: Math.floor(index / total) + 1 };
  }
  function totalCheckpoints(def) { return def.checkpoints.length * (def.laps || 1); }
  function syncState() {
    if (!stateRef) return;
    stateRef.race = active;
    stateRef.flags = stateRef.flags || {};
    stateRef.flags.raceActive = !!active;
    stateRef.flags.raceCountdown = countdown > 0 ? Math.ceil(countdown) : 0;
  }
  function failRace(reason) {
    if (!active) return false;
    toast('Balapan gagal: ' + reason); sfx('fail');
    if (stateRef) { stateRef.flags = stateRef.flags || {}; stateRef.flags.lastRaceResult = 'failed: ' + reason; }
    active = null; countdown = 0; syncState(); return true;
  }
  function updateCountdown(dt) {
    if (countdown <= 0) return;
    countdown -= dt;
    var shown = Math.ceil(countdown);
    if (shown !== countdownShown && shown > 0) { countdownShown = shown; toast(String(shown) + '...'); sfx('beep'); }
    if (countdown <= 0) {
      countdown = 0; countdownShown = 0;
      active.started = true; active.startTime = stateRef ? stateRef.time : 0;
      toast('GO! ' + active.def.name + ' dimulai!'); sfx('go');
      if (window.SB && SB.HUD && SB.HUD.showMission) {
        SB.HUD.showMission('Race: ' + active.def.name + ' — checkpoint 1/' + totalCheckpoints(active.def));
      }
    }
  }
  function updatePlayerCheckpoints() {
    if (!active || !active.started || active.finished) return;
    var def = active.def, pos = playerPos();
    var next = checkpointPos(def, active.checkpoint);
    var d = dist2(pos.x, pos.z, next.x, next.z);
    if (d > next.r + 55) { failRace('checkpoint ' + (active.checkpoint + 1) + ' terlewat!'); return; }
    if (d <= next.r) window.SB.Races.checkpoint(active.checkpoint);
  }
  function updateRivals(dt) {
    if (!active || !active.started || active.finished) return;
    var def = active.def, total = totalCheckpoints(def);
    for (var i = 0; i < active.rivals.length; i++) {
      var r = active.rivals[i];
      if (r.finished) continue;
      var legLen = 60; // average metres between checkpoints
      r.progress += (r.pace * 22 * dt) / legLen;
      // Rubber-banding: trailing rivals gain a little, the leader loses a touch.
      if (r.checkpoint < active.checkpoint - 1) r.progress += dt * 0.02;
      if (r.checkpoint > active.checkpoint + 1) r.progress -= dt * 0.01;
      while (r.progress >= 1) {
        r.progress -= 1; r.checkpoint++;
        if (r.checkpoint >= total) { r.finished = true; r.finishTime = raceTime; toast(r.name + ' finish di ' + formatTime(r.finishTime) + '!'); break; }
      }
      var cp = checkpointPos(def, Math.min(r.checkpoint, total - 1));
      var prev = checkpointPos(def, Math.max(0, r.checkpoint - 1));
      r.x = prev.x + (cp.x - prev.x) * r.progress;
      r.z = prev.z + (cp.z - prev.z) * r.progress;
      r.speed = r.pace * 22;
    }
    var entries = [{ name: 'Kamu', checkpoint: active.checkpoint, progress: 0, isPlayer: true }];
    for (var j = 0; j < active.rivals.length; j++) {
      entries.push({ name: active.rivals[j].name, checkpoint: active.rivals[j].checkpoint,
        progress: active.rivals[j].progress, isPlayer: false });
    }
    entries.sort(function (a, b) {
      if (b.checkpoint !== a.checkpoint) return b.checkpoint - a.checkpoint;
      return b.progress - a.progress;
    });
    for (var k = 0; k < entries.length; k++) entries[k].position = k + 1;
    active.positions = entries;
    active.playerPosition = 4;
    for (var m = 0; m < entries.length; m++) if (entries[m].isPlayer) active.playerPosition = entries[m].position;
  }
  var raceHistory = []; // last 10 results {id,name,won,time,prize}
  var tauntCooldown = 0;
  var TAUNTS = {
    'Vex': ['Kamu lambat, bos!', 'Mobilku lebih cepat dari bayanganmu!'],
    'Nitro Nina': ['Nitroku belum panas, sayang!', 'Ke pantai saja sana!'],
    'El Toro': ['Toro tidak pernah kalah!', 'Aku banteng jalanan!']
  };
  function recordHistory(result) {
    raceHistory.unshift({ id: result.id, name: result.name, won: result.won,
      time: result.time, prize: result.prize });
    if (raceHistory.length > 10) raceHistory.length = 10;
  }
  function maybeTaunt(dt) {
    if (!active || !active.started || active.finished) return;
    tauntCooldown -= dt;
    if (tauntCooldown > 0) return;
    tauntCooldown = 18 + Math.random() * 12;
    // Only the leading rival taunts, and only while the player is behind.
    var leader = null;
    for (var i = 0; i < active.rivals.length; i++) {
      var r = active.rivals[i];
      if (!r.finished && (!leader || r.checkpoint > leader.checkpoint)) leader = r;
    }
    if (!leader || leader.checkpoint <= active.checkpoint) return;
    var lines = TAUNTS[leader.name] || ['Ayo kejar aku!'];
    toast(leader.name + ': "' + lines[Math.floor(Math.random() * lines.length)] + '"');
  }
  function suggestRace() {
    // Recommend the hardest race the player can afford, by respect rank.
    var respect = stateRef ? stateRef.respect || 0 : 0;
    var best = RACES[0];
    for (var i = 0; i < RACES.length; i++) {
      var r = RACES[i];
      if ((stateRef.money || 0) >= r.entryFee && r.difficulty * 250 <= respect + 500) best = r;
    }
    return best;
  }
  window.SB.Races = {
    races: RACES,
    active: function () { return active; },
    bestTimes: bestTimes,
    init: function (state) {
      stateRef = state || null;
      active = null; countdown = 0; countdownShown = 0; raceTime = 0;
      bestTimes = {}; winsByRace = {}; initialized = true;
      if (stateRef) {
        stateRef.race = null; stateRef.flags = stateRef.flags || {};
        if (stateRef.raceBestTimes) bestTimes = stateRef.raceBestTimes;
      }
      syncState(); return RACES;
    },
    update: function (dt, state) {
      if (!initialized) this.init(state);
      if (state) stateRef = state;
      if (!stateRef) return;
      dt = Math.max(0, Math.min(dt || 0, 0.1));
      if (!active) { syncState(); return; }
      if (countdown > 0) { updateCountdown(dt); syncState(); return; }
      if (!active.started || active.finished) { syncState(); return; }
      raceTime += dt; active.elapsed = raceTime;
      updatePlayerCheckpoints();
      if (!active) { syncState(); return; } // may have failed on a missed checkpoint
      updateRivals(dt);
      maybeTaunt(dt);
      if (stateRef.player && stateRef.player.onFoot && raceTime > 5) { failRace('kamu keluar dari mobil!'); return; }
      syncState();
    },
    startRace: function (id) {
      if (!stateRef) return null;
      if (active) { toast('Balapan ' + active.def.name + ' sedang berjalan. Selesaikan dulu!'); return active; }
      var def = findRace(id);
      if (!def) { toast('Balapan tidak dikenal: "' + id + '". Pilihan: sunset-sprint, marina-loop, harbour-run, neon-nights, kingpin-gp, bridge-blitz.'); return null; }
      if ((stateRef.money || 0) < def.entryFee) {
        toast(def.name + ' butuh entry fee $' + def.entryFee + ' (kamu: $' + (stateRef.money || 0) + ').'); return null;
      }
      if (stateRef.player && stateRef.player.onFoot) { toast('Masuk mobil dulu sebelum balapan!'); return null; }
      stateRef.money -= def.entryFee;
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      raceTime = 0; countdown = 3.2; countdownShown = 4;
      active = { def: def, id: def.id, name: def.name, checkpoint: 0,
        total: totalCheckpoints(def), started: false, finished: false, won: false,
        elapsed: 0, startTime: 0, rivals: makeRivals(def), positions: [],
        playerPosition: 4, entryFee: def.entryFee };
      var start = checkpointPos(def, 0);
      if (stateRef.player) { stateRef.player.x = start.x - 12; stateRef.player.z = start.z + 8; }
      if (window.SB && SB.Crew && SB.Crew.onRaceStart) SB.Crew.onRaceStart();
      toast(def.name + ' — entry $' + def.entryFee + ', hadiah $' + def.prize + ' + ' + def.repReward + ' REP. Lawan: ' + RIVAL_NAMES.join(', ') + '.');
      sfx('race-start'); syncState(); return active;
    },
    checkpoint: function (i) {
      if (!active || !active.started || active.finished) return false;
      if (i !== active.checkpoint) return false;
      active.checkpoint++;
      var total = totalCheckpoints(active.def);
      sfx('checkpoint');
      if (active.checkpoint >= total) { this.finishRace(); return true; }
      var next = checkpointPos(active.def, active.checkpoint);
      toast('Checkpoint ' + active.checkpoint + '/' + total + ' — lanjut! (' +
        Math.round(dist2(playerPos().x, playerPos().z, next.x, next.z)) + 'm)');
      if (window.SB && SB.HUD && SB.HUD.showMission) {
        SB.HUD.showMission('Race: ' + active.def.name + ' — checkpoint ' + (active.checkpoint + 1) + '/' + total);
      }
      syncState(); return true;
    },
    finishRace: function () {
      if (!active || active.finished) return null;
      active.finished = true;
      var def = active.def, playerTime = raceTime, rivalsDone = 0;
      for (var i = 0; i < active.rivals.length; i++) {
        if (active.rivals[i].finished && active.rivals[i].finishTime < playerTime) rivalsDone++;
      }
      var won = rivalsDone === 0;
      active.won = won; active.finishTime = playerTime;
      if (!bestTimes[def.id] || playerTime < bestTimes[def.id]) {
        bestTimes[def.id] = playerTime;
        if (stateRef) stateRef.raceBestTimes = bestTimes;
      }
      var result = { id: def.id, name: def.name, won: won, time: playerTime,
        prize: won ? def.prize : Math.floor(def.prize * 0.2),
        rep: won ? def.repReward : Math.floor(def.repReward * 0.25),
        rivalsBeaten: 3 - rivalsDone };
      if (stateRef) {
        stateRef.money = (stateRef.money || 0) + result.prize;
        stateRef.rep = (stateRef.rep || 0) + result.rep;
        stateRef.stats = stateRef.stats || {};
        if (won) { stateRef.stats.racesWon = (stateRef.stats.racesWon || 0) + 1; winsByRace[def.id] = (winsByRace[def.id] || 0) + 1; }
        stateRef.flags = stateRef.flags || {};
        stateRef.flags.lastRaceResult = won ? 'won' : 'lost';
        if (window.SB && SB.Economy && SB.Economy.addRespect) SB.Economy.addRespect(won ? 40 : 10);
        else stateRef.respect = (stateRef.respect || 0) + (won ? 40 : 10);
        if (window.SB && SB.Economy && SB.Economy.addDistrictRep) SB.Economy.addDistrictRep(def.district, won ? 8 : 2);
        if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      }
      if (won) {
        toast('MENANG! ' + def.name + ' — +$' + result.prize + ', +' + result.rep + ' REP, waktu ' + formatTime(playerTime) + '!');
        sfx('win');
      } else {
        toast('Finish, tapi ' + rivalsDone + ' rival lebih cepat. Hadiah hiburan +$' + result.prize + '. Coba lagi!');
        sfx('lose');
      }
      recordHistory(result);
      var finished = active;
      active = null; countdown = 0; syncState();
      finished.result = result;
      return result;
    },
    quitRace: function () { if (!active) return false; return failRace('balapan dibatalkan.'); },
    list: function () {
      var out = [];
      for (var i = 0; i < RACES.length; i++) {
        out.push({ id: RACES[i].id, name: RACES[i].name, district: RACES[i].district,
          entryFee: RACES[i].entryFee, prize: RACES[i].prize, repReward: RACES[i].repReward,
          laps: RACES[i].laps, difficulty: RACES[i].difficulty,
          bestTime: bestTimes[RACES[i].id] || null, wins: winsByRace[RACES[i].id] || 0 });
      }
      return out;
    },
    wins: function () { var total = 0; for (var k in winsByRace) total += winsByRace[k]; return total; },
    history: function () { return raceHistory.slice(); },
    suggest: function () { return suggestRace(); }
  };
})();

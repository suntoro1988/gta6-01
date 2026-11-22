window.SB = window.SB || {};
(function(){ 'use strict';
// ---------------------------------------------------------------------------
// SB.Jobs — the mission system of Sunset Bay: 22 missions, 72 stages,
// including the 3-phase showcase heist "The Harbour Lights Job" plus two
// further showcase missions. Missions are data + a small state machine:
// startMission(id) -> advanceStage() on objective completion ->
// completeMission() pays out money / REP / respect and advances the story.
// Objective kinds: 'go' (reach a point), 'talk' (reach an NPC), 'drive'
// (reach a point in a vehicle), 'collect' (pick up an item, then the
// stage auto-advances), 'deliver' (reach a point carrying cargo),
// 'timer' (survive / wait N seconds), 'kills' (reach a kill count),
// 'race' (win the linked street race), 'photo' (stand at a viewpoint).
// API (spec): init(state), update(dt,state), startMission(id),
// advanceStage(), completeMission(), missions (array 20+, 60+ stages),
// showcase (heist 3 fase "The Harbour Lights Job" + 2 misi showcase lain).
// Mission 1 pays +$200 & REP+100 (spec).
// ---------------------------------------------------------------------------

// Stage helper: s(text, kind, x, z, opt) -> stage object.
// opt: {r: radius, t: seconds, n: kill target, race: race id, item: name}
function s(text, kind, x, z, opt) {
  var o = opt || {};
  return {
    text: text, kind: kind || 'go',
    x: (x === undefined ? 0 : x), z: (z === undefined ? 0 : z),
    r: o.r || 14, t: o.t || 0, n: o.n || 0,
    race: o.race || null, item: o.item || null,
    done: false
  };
}

// Mission helper: m(id, name, giver, district, reward, rep, stages, opt)
// opt: {showcase: true, unlock: missionId, respect: rankNeeded}
function m(id, name, giver, district, reward, rep, stages, opt) {
  var o = opt || {};
  return {
    id: id, name: name, giver: giver, district: district,
    reward: reward, rep: rep, stages: stages,
    showcase: !!o.showcase, unlock: o.unlock || null,
    respect: o.respect || null, done: false, best: null
  };
}

// --- District anchor points (world coords, shared with City) -------------
var ANCHOR = {
  marina:     { x: 120,  z: 300 },
  palmParade: { x: -430, z: 60 },
  oldTown:    { x: -120, z: -180 },
  harbour:    { x: 420,  z: 380 },
  downtown:   { x: 60,   z: -40 },
  beachfront: { x: -480, z: 220 },
  fishMarket: { x: 260,  z: 330 },
  pierNine:   { x: 480,  z: 460 },
  bridge:     { x: 460,  z: 280 },
  airport:    { x: -300, z: -420 },
  casino:     { x: 180,  z: -220 },
  lighthouse: { x: -520, z: 480 }
};

// --- Missions 1-8: the opening arc ----------------------------------------
var missions = [
  // 1 — Mission 1 (spec): +$200 & REP+100. Rico teaches the ropes.
  m('m01', 'First Light', 'Rico', 'Marina', 200, 100, [
    s('Meet Rico at the marina office.', 'talk', 120, 300),
    s('Drive the sunset coupe to Palm Parade.', 'drive', -430, 60),
    s('Deliver the sealed package to the beach vendor.', 'deliver', -480, 220, { item: 'Sealed package' })
  ]),

  // 2 — Easy money, introduces the fish market and the tide clock.
  m('m02', 'Fish Market Run', 'Mama Rosa', 'Harbour', 150, 40, [
    s('Collect the morning catch at the fish market.', 'collect', 260, 330, { item: 'Icebox of snapper' }),
    s('Drop the catch at the Old Town restaurant.', 'deliver', -120, -180, { item: 'Icebox of snapper' }),
    s('Report back to Mama Rosa at the harbour.', 'talk', 420, 380)
  ]),

  // 3 — First taste of heat: a rival crew wants the same car.
  m('m03', 'Palm Parade Pickup', 'Rico', 'Palm Parade', 250, 60, [
    s('Find the parked Sunset GT on Palm Parade.', 'go', -430, 60),
    s('Shake the rival lookouts — lose the tail.', 'timer', 0, 0, { t: 25 }),
    s('Bring the GT to Rico\'s garage in Downtown.', 'drive', 60, -40)
  ]),

  // 4 — Tourists, selfies, and a runaway dog. Light-hearted, on foot.
  m('m04', 'Tourist Trouble', 'Beach Patrol', 'Beachfront', 120, 30, [
    s('Find the lost tourist near the lifeguard tower.', 'talk', -480, 220),
    s('Catch the runaway dog by the palm grove.', 'go', -440, 140, { r: 10 }),
    s('Escort the tourist back to the beachfront hotel.', 'go', -470, 260)
  ]),

  // 5 — Night driving: neon, rain, and a timed delivery.
  m('m05', 'Neon Delivery', 'Dex', 'Downtown', 300, 70, [
    s('Pick up the neon sign tubes at the warehouse.', 'collect', 180, -220, { item: 'Neon tubes' }),
    s('Deliver them to the casino before midnight.', 'deliver', 180, -220, { item: 'Neon tubes' }),
    s('Return the van to Dex in Downtown.', 'drive', 60, -40)
  ]),

  // 6 — First real chase: two stars, no shooting required.
  m('m06', 'Harbour Heat', 'Rico', 'Harbour', 350, 80, [
    s('Steal the harbour master\'s speedboat.', 'go', 420, 380, { r: 12 }),
    s('Outrun the harbour patrol — stay ahead for 30 seconds.', 'timer', 0, 0, { t: 30 }),
    s('Dock the boat at Pier Nine and vanish.', 'go', 480, 460)
  ]),

  // 7 — Photography side job that teaches the viewpoint system.
  m('m07', 'Golden Hour Shots', 'Lena', 'Beachfront', 180, 50, [
    s('Photograph the sunset from the lighthouse point.', 'photo', -520, 480, { r: 12 }),
    s('Photograph the skyline from the bridge.', 'photo', 460, 280, { r: 12 }),
    s('Bring the shots back to Lena at the marina.', 'talk', 120, 300)
  ]),

  // 8 — Crew introduction: recruit your first crewmate, Mia.
  m('m08', 'A Fourth Seat', 'Rico', 'Old Town', 220, 60, [
    s('Meet Mia at the Old Town cafe.', 'talk', -120, -180),
    s('Win Mia over: beat her in a sprint to the marina.', 'race', 120, 300, { race: 'marina-sprint' }),
    s('Drive Mia to the crew safehouse.', 'drive', 60, -40)
  ]),

  // --- Missions 9-15: the showcase arc -----------------------------------
  // 9 — SHOWCASE 1: "The Harbour Lights Job", a 3-phase heist.
  // Phase 1 RECON: case the harbour. Phase 2 EKSEKUSI: take the cargo.
  // Phase 3 KABUR: lose AIR-1 across the bridge at sunset.
  m('heist-harbour', 'The Harbour Lights Job', 'Rico', 'Harbour', 1500, 300, [
    s('PHASE 1 — RECON: photograph the harbour patrol routes.', 'photo', 420, 380, { r: 12 }),
    s('PHASE 1 — RECON: tag the cargo crates on Pier Nine.', 'go', 480, 460, { r: 10 }),
    s('PHASE 1 — RECON: meet the crew at the lighthouse to plan.', 'talk', -520, 480),
    s('PHASE 2 — EKSEKUSI: cut the pier lights at the junction box.', 'go', 460, 430, { r: 8 }),
    s('PHASE 2 — EKSEKUSI: load the gold crates onto the truck.', 'collect', 480, 460, { item: 'Gold crates' }),
    s('PHASE 2 — EKSEKUSI: drive the truck out through the harbour gate.', 'drive', 380, 320),
    s('PHASE 3 — KABUR: cross the bridge while AIR-1 hunts you.', 'drive', 460, 280),
    s('PHASE 3 — KABUR: lose the helicopter in the Old Town alleys.', 'timer', 0, 0, { t: 40 }),
    s('PHASE 3 — KABUR: deliver the gold to the safehouse.', 'deliver', 60, -40, { item: 'Gold crates' })
  ], { showcase: true, unlock: 'm08', respect: 'Street' }),

  // 10 — SHOWCASE 2: a tidal getaway — race the rising tide, then the cops.
  m('showcase-tide', 'Neon Tide Getaway', 'Mia', 'Beachfront', 900, 200, [
    s('Meet Mia\'s crew at the beachfront arcade.', 'talk', -480, 220),
    s('Race the tide run: beachfront to the pier before the water rises.', 'race', 480, 460, { race: 'tide-run' }),
    s('Lose the pursuing patrol cars in Downtown.', 'timer', 0, 0, { t: 30 })
  ], { showcase: true, unlock: 'heist-harbour' }),

  // 11 — SHOWCASE 3: the iconic moment — helicopter chase over the
  // bridge and the water at sunset. Wanted 4, spotlight, explosions.
  m('showcase-bridge', 'Bridge Run: AIR-1', 'Rico', 'Harbour', 1200, 250, [
    s('Steal the armoured truck from the harbour depot.', 'go', 420, 380, { r: 12 }),
    s('Cross the bridge at full speed while AIR-1 spotlights you.', 'drive', 460, 280),
    s('Jump the gap at the bridge end and escape over the water.', 'timer', 0, 0, { t: 20 })
  ], { showcase: true, unlock: 'showcase-tide' }),

  // 12 — Business arc begins: buy low, sell high, don't get caught.
  m('m12', 'Smoke and Mirrors', 'Dex', 'Downtown', 400, 90, [
    s('Collect the shipment at the airport hangar.', 'collect', -300, -420, { item: 'Crates' }),
    s('Deliver the crates to the casino loading bay.', 'deliver', 180, -220, { item: 'Crates' }),
    s('Collect your cut from Dex.', 'talk', 60, -40)
  ]),

  // 13 — A rival racer challenges you to a pink-slip race.
  m('m13', 'Pink Slip', 'Vex', 'Palm Parade', 600, 120, [
    s('Meet Vex at the Palm Parade start line.', 'talk', -430, 60),
    s('Beat Vex in the coast road race.', 'race', -460, 300, { race: 'coast-road' }),
    s('Claim the pink slip at Vex\'s garage.', 'go', -400, 100)
  ]),

  // 14 — Protect the fish market from a protection racket.
  m('m14', 'Market Guard', 'Mama Rosa', 'Harbour', 450, 100, [
    s('Reach the fish market before the racket crew arrives.', 'go', 260, 330),
    s('Stand your ground — hold the market for 45 seconds.', 'timer', 0, 0, { t: 45 }),
    s('Escort Mama Rosa home to Old Town.', 'go', -120, -180)
  ]),

  // 15 — Night taxi: three fares, one very talkative passenger.
  m('m15', 'Night Shift', 'Lena', 'Downtown', 280, 60, [
    s('Pick up the first fare at the casino.', 'talk', 180, -220),
    s('Drop the fare at the marina hotel.', 'deliver', 120, 300),
    s('Pick up the last fare at the airport and bring them home.', 'drive', -300, -420)
  ]),

  // --- Missions 16-22: the endgame arc ------------------------------------
  // 16 — Smuggling by sea: fast boat, faster patrols.
  m('m16', 'Midnight Tide', 'Captain Sal', 'Marina', 700, 130, [
    s('Board the smuggler\'s boat at the marina.', 'go', 120, 300, { r: 12 }),
    s('Deliver the cargo to the lighthouse cove.', 'deliver', -520, 480, { item: 'Sealed crates' }),
    s('Return to the marina before dawn patrols launch.', 'drive', 120, 300)
  ]),

  // 17 — The casino heist rehearsal: timing is everything.
  m('m17', 'House Rules', 'Dex', 'Downtown', 800, 150, [
    s('Case the casino floor — photograph the vault door.', 'photo', 180, -220, { r: 10 }),
    s('Plant the signal jammer on the casino roof.', 'go', 190, -230, { r: 8 }),
    s('Slip out through the staff exit without raising alarm.', 'timer', 0, 0, { t: 20 })
  ]),

  // 18 — A friend in trouble: bail out a crewmate from impound.
  m('m18', 'Impound Break', 'Mia', 'Old Town', 500, 110, [
    s('Reach the police impound lot.', 'go', -80, -120),
    s('Recover Mia\'s car from the impound.', 'go', -70, -110, { r: 10 }),
    s('Drive the car back to the safehouse in one piece.', 'drive', 60, -40)
  ]),

  // 19 — The big race: the Sunset Grand Prix, winner takes the crown.
  m('m19', 'Sunset Grand Prix', 'Rico', 'Palm Parade', 1000, 200, [
    s('Qualify: reach the start line on Palm Parade.', 'talk', -430, 60),
    s('Win the Grand Prix — five laps of the coast road.', 'race', -460, 300, { race: 'grand-prix' }),
    s('Take the trophy to the marina celebration.', 'go', 120, 300)
  ]),

  // 20 — The rival boss makes his move: defend the crew's turf.
  m('m20', 'Turf War', 'Rico', 'Old Town', 900, 180, [
    s('Defend the Old Town cafe from the rival crew.', 'timer', 0, 0, { t: 40 }),
    s('Chase the rival lieutenant to the harbour.', 'drive', 420, 380),
    s('End the standoff at Pier Nine.', 'talk', 480, 460)
  ]),

  // 21 — The final setup: gather the crew, the cars, and the plan.
  m('m21', 'All Hands', 'Rico', 'Marina', 600, 150, [
    s('Gather Mia at the Old Town cafe.', 'talk', -120, -180),
    s('Gather Dex at the Downtown warehouse.', 'talk', 60, -40),
    s('Bring the whole crew to the marina for the briefing.', 'go', 120, 300)
  ]),

  // 22 — Finale: the Kingpin run. Everything you built leads here.
  m('m22', 'Kingpin of the Bay', 'Rico', 'Downtown', 2500, 500, [
    s('Hit the rival convoy on the coast road.', 'drive', -460, 300),
    s('Escape the five-star manhunt across the bridge.', 'timer', 0, 0, { t: 60 }),
    s('Claim the bay: reach the lighthouse as the sun rises.', 'go', -520, 480)
  ], { unlock: 'm21', respect: 'Boss' })
];

// The three showcase missions, by id, in story order.
var showcase = [
  'heist-harbour',
  'showcase-tide',
  'showcase-bridge'
];

// Quick lookup: id -> mission.
var byId = {};
(function () {
  var i;
  for (i = 0; i < missions.length; i++) { byId[missions[i].id] = missions[i]; }
})();

// Count total stages across all missions (spec: 60+).
function totalStages() {
  var n = 0, i;
  for (i = 0; i < missions.length; i++) { n += missions[i].stages.length; }
  return n;
}

// Missions available right now: unlocked, not done, respect requirement met.
function availableMissions(state) {
  var rank = (state && state.respectRank) || 'Rookie';
  var order = { Rookie: 0, Street: 1, Boss: 2, Kingpin: 3 };
  var out = [], i, mm;
  for (i = 0; i < missions.length; i++) {
    mm = missions[i];
    if (mm.done) { continue; }
    if (mm.unlock && !(byId[mm.unlock] && byId[mm.unlock].done)) { continue; }
    if (mm.respect && order[rank] < order[mm.respect]) { continue; }
    out.push(mm);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runtime state of the mission system.
// ---------------------------------------------------------------------------
var stateRef = null;
var active = null;        // current mission object (or null)
var stageIndex = 0;       // index into active.stages
var stageTimer = 0;       // seconds spent in the current stage
var stageKills = 0;       // kills at stage start (for 'kills' stages)
var stageRaceWon = false;
var completedCount = 0;
var failedCount = 0;
var lastPayout = 0;

function dist2(ax, az, bx, bz) {
  var dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function currentStage() {
  if (!active) { return null; }
  return active.stages[stageIndex] || null;
}

// ---------------------------------------------------------------------------
// init(state): reset the mission system and sync shared state.
// ---------------------------------------------------------------------------
function init(state) {
  stateRef = state || null;
  active = null;
  stageIndex = 0;
  stageTimer = 0;
  if (stateRef) {
    stateRef.mission = { id: null, stage: 0, text: '', reward: 0 };
  }
  return true;
}

// ---------------------------------------------------------------------------
// startMission(id): begin a mission. Returns true on success, false when
// the mission is locked, already done, or unknown. Sets shared state,
// the HUD objective, the minimap route, and plays the mission sting.
// ---------------------------------------------------------------------------
function startMission(id) {
  var mm = byId[id];
  if (!mm) { return false; }
  if (mm.done) { return false; }
  if (active) { return false; } // finish or fail the current job first
  if (mm.unlock && !(byId[mm.unlock] && byId[mm.unlock].done)) { return false; }
  var rank = (stateRef && stateRef.respectRank) || 'Rookie';
  var order = { Rookie: 0, Street: 1, Boss: 2, Kingpin: 3 };
  if (mm.respect && order[rank] < order[mm.respect]) { return false; }

  active = mm;
  stageIndex = 0;
  stageTimer = 0;
  stageKills = (stateRef && stateRef.stats) ? stateRef.stats.kills : 0;
  stageRaceWon = false;
  if (stateRef) {
    stateRef.mission = { id: mm.id, stage: 0, text: mm.stages[0].text, reward: mm.reward };
    if (mm.id === 'showcase-bridge' || mm.id === 'm22') {
      stateRef.wanted = Math.max(stateRef.wanted || 0, 3);
    }
  }
  announceStage();
  if (window.SB && window.SB.Audio) { window.SB.Audio.sfx('mission'); }
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.showBanner(mm.name, 'From ' + mm.giver + ' — ' + mm.district, 3);
  }
  updateRoute();
  return true;
}

// Push the current stage text to the HUD and shared state.
function announceStage() {
  var st = currentStage();
  if (!st || !stateRef) { return; }
  var label = st.text;
  if (active.id === 'heist-harbour') {
    label = '[' + active.name + '] ' + label;
  }
  stateRef.mission.text = label;
  stateRef.mission.stage = stageIndex;
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.showMission(label);
    window.SB.HUD.showToast(label, 'info');
  }
}

// Rebuild the minimap route: player -> current objective.
function updateRoute() {
  if (!window.SB || !window.SB.HUD || !stateRef || !stateRef.player) { return; }
  var st = currentStage();
  if (!st) { window.SB.HUD.setRoute([]); return; }
  if (st.kind === 'timer') { window.SB.HUD.setRoute([]); return; }
  window.SB.HUD.setRoute([
    { x: stateRef.player.x, z: stateRef.player.z },
    { x: st.x, z: st.z }
  ]);
}

// ---------------------------------------------------------------------------
// advanceStage(): move to the next stage, or complete the mission when
// the last stage is done. Called by update() when the objective is met,
// and by other systems (Races.finishRace, FX, Police) for linked goals.
// ---------------------------------------------------------------------------
function advanceStage() {
  if (!active) { return false; }
  var st = currentStage();
  if (st) { st.done = true; }
  stageIndex++;
  stageTimer = 0;
  stageKills = (stateRef && stateRef.stats) ? stateRef.stats.kills : 0;
  stageRaceWon = false;
  if (stageIndex >= active.stages.length) {
    completeMission();
    return true;
  }
  announceStage();
  updateRoute();
  if (window.SB && window.SB.Audio) { window.SB.Audio.sfx('checkpoint'); }
  return true;
}

// ---------------------------------------------------------------------------
// completeMission(): pay out the reward, add REP, bump respect, count the
// mission, clear shared state, and celebrate. Mission 1 pays +$200 &
// REP+100 (data above); every mission also grants its listed reward.
// ---------------------------------------------------------------------------
function completeMission() {
  if (!active) { return false; }
  var mm = active;
  mm.done = true;
  completedCount++;
  lastPayout = mm.reward;
  if (stateRef) {
    stateRef.money = (stateRef.money || 0) + mm.reward;
    stateRef.rep = (stateRef.rep || 0) + mm.rep;
    stateRef.respect = (stateRef.respect || 0) + mm.rep;
    if (stateRef.stats) { stateRef.stats.missionsDone = (stateRef.stats.missionsDone || 0) + 1; }
    stateRef.mission = { id: null, stage: 0, text: '', reward: 0 };
    updateRespectRank();
  }
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.setMoney(stateRef ? stateRef.money : 0);
    window.SB.HUD.showBanner('MISSION COMPLETE', mm.name + ' — +$' + mm.reward + '  REP +' + mm.rep, 4);
    window.SB.HUD.showMission('Mission complete — find your next job.');
    window.SB.HUD.showToast('+' + '$' + mm.reward + '  REP +' + mm.rep, 'good');
    window.SB.HUD.setRoute([]);
  }
  if (window.SB && window.SB.Audio) {
    window.SB.Audio.sfx('success');
    window.SB.Audio.sfx('cash');
  }
  active = null;
  stageIndex = 0;
  return true;
}

// Fail the active mission (busted, wasted, or out of time).
function failMission(reason) {
  if (!active) { return false; }
  var mm = active;
  failedCount++;
  if (stateRef) {
    stateRef.mission = { id: null, stage: 0, text: '', reward: 0 };
    stateRef.rep = Math.max(0, (stateRef.rep || 0) - 20);
  }
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.showBanner('MISSION FAILED', mm.name + (reason ? ' — ' + reason : ''), 3);
    window.SB.HUD.showMission('Mission failed — try again when ready.');
    window.SB.HUD.setRoute([]);
  }
  if (window.SB && window.SB.Audio) { window.SB.Audio.sfx('missionFail'); }
  // Reset stage completion so a retry starts clean.
  var i;
  for (i = 0; i < mm.stages.length; i++) { mm.stages[i].done = false; }
  active = null;
  stageIndex = 0;
  return true;
}

// Respect ranks (spec): Rookie -> Street -> Boss -> Kingpin.
function updateRespectRank() {
  if (!stateRef) { return; }
  var r = stateRef.respect || 0;
  var rank = 'Rookie';
  if (r >= 1500) { rank = 'Kingpin'; }
  else if (r >= 700) { rank = 'Boss'; }
  else if (r >= 250) { rank = 'Street'; }
  if (rank !== stateRef.respectRank) {
    stateRef.respectRank = rank;
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Respect rank up: ' + rank, 'good');
      window.SB.HUD.showBanner('RANK UP', 'You are now ' + rank + ' of Sunset Bay', 3);
    }
  }
}

// ---------------------------------------------------------------------------
// update(dt, state): called every frame. Checks the active stage's
// objective and advances when it is met. Also fails the mission when
// the player is busted (wanted 5 + caught) or wasted (hp 0).
// ---------------------------------------------------------------------------
function update(dt, state) {
  if (!state) { return; }
  stateRef = state;
  if (!active) { return; }
  var st = currentStage();
  if (!st) { return; }
  stageTimer += dt;
  var p = state.player || { x: 0, z: 0, onFoot: true };

  // Busted / wasted ends any mission.
  if (state.player && state.player.hp !== undefined && state.player.hp <= 0) {
    failMission('Wasted');
    return;
  }
  if (state.flags && state.flags.busted) {
    state.flags.busted = false;
    failMission('Busted');
    return;
  }

  switch (st.kind) {
    case 'go':
    case 'talk':
    case 'collect':
    case 'deliver':
      if (dist2(p.x, p.z, st.x, st.z) <= st.r) {
        if (st.kind === 'collect' && st.item) {
          if (window.SB && window.SB.HUD) {
            window.SB.HUD.showToast('Picked up: ' + st.item, 'good');
          }
          if (window.SB && window.SB.Audio) { window.SB.Audio.sfx('pickup'); }
        }
        if (st.kind === 'deliver' && st.item) {
          if (window.SB && window.SB.HUD) {
            window.SB.HUD.showToast('Delivered: ' + st.item, 'good');
          }
        }
        advanceStage();
      }
      break;
    case 'drive':
      if (!p.onFoot && dist2(p.x, p.z, st.x, st.z) <= st.r) {
        advanceStage();
      } else if (p.onFoot && dist2(p.x, p.z, st.x, st.z) <= st.r) {
        // On foot at the destination: hint, don't complete.
        if (stageTimer > 5 && window.SB && window.SB.HUD) {
          window.SB.HUD.setHint('You need a vehicle for this leg — press E near a car.');
        }
      }
      break;
    case 'timer':
      if (stageTimer >= st.t) { advanceStage(); }
      break;
    case 'kills': {
      var kills = (state.stats && state.stats.kills) || 0;
      if (kills - stageKills >= st.n) { advanceStage(); }
      break;
    }
    case 'race':
      if (stageRaceWon) { advanceStage(); }
      break;
    case 'photo':
      if (dist2(p.x, p.z, st.x, st.z) <= st.r) {
        if (window.SB && window.SB.Shots) { window.SB.Shots.take('mission-' + active.id + '-stage' + stageIndex); }
        if (window.SB && window.SB.HUD) {
          window.SB.HUD.showToast('Photo captured', 'good');
        }
        advanceStage();
      }
      break;
    default:
      break;
  }

  // Showcase pressure: the bridge run keeps wanted high while active.
  if (active && active.id === 'showcase-bridge' && state.wanted < 3) {
    state.wanted = 3;
  }
}

// Called by SB.Races.finishRace when the player wins a race.
function notifyRaceWon(raceId) {
  stageRaceWon = true;
  var st = currentStage();
  if (active && st && st.kind === 'race' && (!st.race || st.race === raceId)) {
    advanceStage();
    return true;
  }
  return false;
}

// Called by SB.Races when the player loses a linked race: retry the stage.
function notifyRaceLost(raceId) {
  var st = currentStage();
  if (active && st && st.kind === 'race' && (!st.race || st.race === raceId)) {
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Race lost — try the stage again.', 'bad');
    }
  }
}

// Current objective target for the minimap (or null).
function missionTarget() {
  var st = currentStage();
  if (!st || st.kind === 'timer') { return null; }
  return { x: st.x, z: st.z, text: st.text };
}

// Human-readable progress, e.g. "Stage 2/3 — The Harbour Lights Job".
function progressText() {
  if (!active) { return 'No active mission'; }
  return 'Stage ' + (stageIndex + 1) + '/' + active.stages.length + ' — ' + active.name;
}

// Active mission summary for the pause screen / save system.
function status() {
  return {
    active: active ? active.id : null,
    name: active ? active.name : null,
    stage: stageIndex,
    stages: active ? active.stages.length : 0,
    completed: completedCount,
    failed: failedCount,
    lastPayout: lastPayout
  };
}

window.SB.Jobs = {
  init: init,
  update: update,
  startMission: startMission,
  advanceStage: advanceStage,
  completeMission: completeMission,
  failMission: failMission,
  notifyRaceWon: notifyRaceWon,
  notifyRaceLost: notifyRaceLost,
  missionTarget: missionTarget,
  progressText: progressText,
  status: status,
  availableMissions: availableMissions,
  totalStages: totalStages,
  missions: missions,
  showcase: showcase,
  byId: byId,
  activeMission: function () { return active; },
  currentStage: currentStage
};
})();

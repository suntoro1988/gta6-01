// jobs.js — Sunset Bay (v11)
// Mission system for Sunset Bay, written from scratch.
// 18 missions, 49 stages total. All mission names, characters,
// shops and places are original inventions — no borrowed franchise names.
// Mission 1 pays +$150 on completion, +$50 bonus, +100 REP.
//
// Highlights:
//  * Showcase heist "The Harbour Lights Job" (mission 18): three
//    phases — (a) Prep: pick 1 of 2 getaway cars and park it yourself
//    at a spot you choose; (b) Execution: rob a small harbour shop
//    through the busy front door OR the quiet back alley, NPCs react
//    differently depending on how loud you are; (c) Escape: systemic
//    pursuit — police chase your actual position, never a scripted
//    spline; swapping cars mid-chase drops the vehicle trail.
//    Set pieces: AIR-1 helicopter with a sweeping spotlight at
//    wanted >= 3, spike strips / roadblocks at 1-2 points.
//    The mission passes when you reach the end point by ANY route.
//  * Cop AI, wanted 0-5 with MEMORY (see hud.js), safehouse,
//    garage / shop respray -$150, cash pickups.
//  * One night-only side mission (street race / harbour delivery).
// No dependencies: the system is driven by plain state objects and
// optional callbacks, so it can run standalone or wired into game.js.

'use strict';

export const RESPRAY_COST = 150;
export const MAX_WANTED = 5;
export const AIR_HELI_WANTED = 3;

// Stage kinds the engine understands.
export const STAGE_KINDS = ['go', 'talk', 'collect', 'deliver', 'race', 'rob', 'escape', 'hide', 'choice', 'park', 'chase'];

// --- Mission catalogue: 18 missions, 49 stages ---------------------
// Stage counts: 3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,2,3,6 = 49. Counted
// in the self-test at the bottom of this file (validateMissions()).
export const MISSIONS = [
  {
    id: 'm01-first-light', name: 'First Light on the Bay', giver: 'Auntie Rosa',
    blurb: 'Rosa needs her delivery van back before the market opens.',
    reward: { cash: 150, bonus: 50, rep: 100 },
    nightOnly: false,
    stages: [
      { id: 'm01-s1', kind: 'talk', label: 'Talk to Auntie Rosa at the market stall', x: -120, z: 80 },
      { id: 'm01-s2', kind: 'go', label: 'Find Rosa\'s van near the pier', x: -260, z: 210 },
      { id: 'm01-s3', kind: 'deliver', label: 'Drive the van back to the market', x: -120, z: 80 },
    ],
  },
  {
    id: 'm02-gull-post', name: 'Gull Post', giver: 'Old Man Ferry',
    blurb: 'Deliver Ferry\'s letters before the tide turns.',
    reward: { cash: 80, bonus: 20, rep: 40 },
    nightOnly: false,
    stages: [
      { id: 'm02-s1', kind: 'collect', label: 'Pick up the mailbag at the harbour office', x: -300, z: 260 },
      { id: 'm02-s2', kind: 'deliver', label: 'Deliver the letters to the lighthouse keeper', x: -420, z: 380 },
    ],
  },
  {
    id: 'm03-salt-air', name: 'Salt Air Taxi', giver: 'Mina the Dispatcher',
    blurb: 'Three tourists, one sunset, no wrong turns.',
    reward: { cash: 120, bonus: 30, rep: 60 },
    nightOnly: false,
    stages: [
      { id: 'm03-s1', kind: 'go', label: 'Pick up the tourists at Coral Plaza', x: 60, z: -40 },
      { id: 'm03-s2', kind: 'deliver', label: 'Drop them at the beach viewpoint', x: -180, z: 320 },
      { id: 'm03-s3', kind: 'deliver', label: 'Take them back to their hotel', x: 140, z: 60 },
    ],
  },
  {
    id: 'm04-crate-expectations', name: 'Crate Expectations', giver: 'Dockmaster Ilya',
    blurb: 'Two crates, one forklift, zero excuses.',
    reward: { cash: 100, bonus: 25, rep: 50 },
    nightOnly: false,
    stages: [
      { id: 'm04-s1', kind: 'collect', label: 'Collect the blue crate from Pier 2', x: -320, z: 240 },
      { id: 'm04-s2', kind: 'deliver', label: 'Stack it at the harbour warehouse', x: -260, z: 180 },
    ],
  },
  {
    id: 'm05-mural-run', name: 'The Mural Run', giver: 'Pip the Painter',
    blurb: 'Pip\'s paint is across town and the wall will not wait.',
    reward: { cash: 110, bonus: 30, rep: 55 },
    nightOnly: false,
    stages: [
      { id: 'm05-s1', kind: 'go', label: 'Meet Pip at the underpass mural', x: 90, z: 150 },
      { id: 'm05-s2', kind: 'collect', label: 'Fetch the paint cans from the art shop', x: 180, z: 90 },
      { id: 'm05-s3', kind: 'deliver', label: 'Bring the paint back to Pip', x: 90, z: 150 },
    ],
  },
  {
    id: 'm06-lost-dog', name: 'The Lost Dog of Meridian', giver: 'Mrs. Alba',
    blurb: 'Biscuit the dog is loose in downtown. Bring him home.',
    reward: { cash: 90, bonus: 40, rep: 70 },
    nightOnly: false,
    stages: [
      { id: 'm06-s1', kind: 'go', label: 'Search Meridian Avenue for Biscuit', x: 200, z: -120 },
      { id: 'm06-s2', kind: 'deliver', label: 'Walk Biscuit home to Mrs. Alba', x: 240, z: -60 },
    ],
  },
  {
    id: 'm07-fish-fry', name: 'Fish Fry Friday', giver: 'Chef Tomas',
    blurb: 'The fry stall needs ice, fish and a miracle before 7pm.',
    reward: { cash: 130, bonus: 30, rep: 60 },
    nightOnly: false,
    stages: [
      { id: 'm07-s1', kind: 'collect', label: 'Buy ice from the harbour shop', x: -280, z: 220 },
      { id: 'm07-s2', kind: 'collect', label: 'Pick up the catch from the boats', x: -340, z: 300 },
      { id: 'm07-s3', kind: 'deliver', label: 'Deliver everything to Chef Tomas', x: -140, z: 120 },
    ],
  },
  {
    id: 'm08-surfboard', name: 'Surfboard Rescue', giver: 'Kai the Surfer',
    blurb: 'Kai\'s board floated off. The tide is not waiting.',
    reward: { cash: 95, bonus: 25, rep: 45 },
    nightOnly: false,
    stages: [
      { id: 'm08-s1', kind: 'go', label: 'Reach the board drifting near the rocks', x: -380, z: 420 },
      { id: 'm08-s2', kind: 'deliver', label: 'Return the board to Kai on the beach', x: -200, z: 360 },
    ],
  },
  {
    id: 'm09-paper-trail', name: 'Paper Trail', giver: 'Nadia the Reporter',
    blurb: 'Three sources, one story, and a deadline at midnight.',
    reward: { cash: 140, bonus: 35, rep: 75 },
    nightOnly: false,
    stages: [
      { id: 'm09-s1', kind: 'talk', label: 'Interview the night guard at the depot', x: 260, z: 180 },
      { id: 'm09-s2', kind: 'collect', label: 'Photograph the harbour ledger', x: -300, z: 260 },
      { id: 'm09-s3', kind: 'deliver', label: 'Bring the photos to Nadia\'s office', x: 120, z: -180 },
    ],
  },
  {
    id: 'm10-bus-stop', name: 'The Last Bus', giver: 'Driver Oka',
    blurb: 'Oka\'s bus broke down. Drive the route yourself.',
    reward: { cash: 115, bonus: 20, rep: 50 },
    nightOnly: false,
    stages: [
      { id: 'm10-s1', kind: 'go', label: 'Reach the broken bus on Hill Road', x: 320, z: 240 },
      { id: 'm10-s2', kind: 'deliver', label: 'Finish the route: drop passengers downtown', x: 80, z: -80 },
    ],
  },
  {
    id: 'm11-lantern', name: 'Lantern Festival Setup', giver: 'Festival Chief Lani',
    blurb: 'Hang the lanterns before the crowd arrives.',
    reward: { cash: 125, bonus: 30, rep: 65 },
    nightOnly: false,
    stages: [
      { id: 'm11-s1', kind: 'collect', label: 'Collect lanterns from the festival store', x: 40, z: 200 },
      { id: 'm11-s2', kind: 'go', label: 'Hang lanterns along Coral Plaza', x: 60, z: -40 },
      { id: 'm11-s3', kind: 'talk', label: 'Report to Chief Lani', x: 60, z: -20 },
    ],
  },
  {
    id: 'm12-tide-pool', name: 'Tide Pool Science', giver: 'Dr. Selin',
    blurb: 'Sample the tide pools before the water comes back.',
    reward: { cash: 105, bonus: 25, rep: 55 },
    nightOnly: false,
    stages: [
      { id: 'm12-s1', kind: 'collect', label: 'Sample the west tide pool', x: -420, z: 360 },
      { id: 'm12-s2', kind: 'collect', label: 'Sample the east tide pool', x: -300, z: 430 },
    ],
  },
  {
    id: 'm13-alley-cat', name: 'Alley Cat Courier', giver: 'Whisper',
    blurb: 'A package, no questions, and a very short fuse.',
    reward: { cash: 160, bonus: 40, rep: 80 },
    nightOnly: false,
    stages: [
      { id: 'm13-s1', kind: 'collect', label: 'Pick up the package in the back alley', x: 160, z: 140 },
      { id: 'm13-s2', kind: 'chase', label: 'Lose the rival courier on your tail', x: 0, z: 0 },
      { id: 'm13-s3', kind: 'deliver', label: 'Drop the package at the blue door', x: -80, z: -220 },
    ],
  },
  {
    id: 'm14-sunrise-yoga', name: 'Sunrise Yoga Run', giver: 'Instructor Bea',
    blurb: 'Mats, music and mangoes for the dawn class.',
    reward: { cash: 85, bonus: 20, rep: 45 },
    nightOnly: false,
    stages: [
      { id: 'm14-s1', kind: 'collect', label: 'Pick up yoga mats from the sports shop', x: 220, z: 40 },
      { id: 'm14-s2', kind: 'deliver', label: 'Set up on the beach at sunrise', x: -200, z: 360 },
    ],
  },
  {
    id: 'm15-storm-warning', name: 'Storm Warning', giver: 'Harbour Master Odo',
    blurb: 'Warn the boats before the storm hits the bay.',
    reward: { cash: 150, bonus: 50, rep: 85 },
    nightOnly: false,
    stages: [
      { id: 'm15-s1', kind: 'go', label: 'Warn the fishing boats at Pier 1', x: -320, z: 280 },
      { id: 'm15-s2', kind: 'go', label: 'Warn the sailboats at the marina', x: -240, z: 400 },
      { id: 'm15-s3', kind: 'talk', label: 'Report back to Harbour Master Odo', x: -280, z: 220 },
    ],
  },
  {
    id: 'm16-open-mic', name: 'Open Mic Night', giver: 'June of Coral Rock',
    blurb: 'The band\'s gear is in three places. The show is tonight.',
    reward: { cash: 135, bonus: 35, rep: 70 },
    nightOnly: false,
    stages: [
      { id: 'm16-s1', kind: 'collect', label: 'Fetch the amplifier from the rehearsal room', x: 180, z: 160 },
      { id: 'm16-s2', kind: 'deliver', label: 'Bring the gear to the Coral Plaza stage', x: 60, z: -40 },
    ],
  },
  {
    id: 'm17-midnight-harbour-run', name: 'Midnight Harbour Run', giver: 'The Night Dispatcher',
    blurb: 'NIGHT ONLY — a street race to the harbour, then a rush delivery back. The bay belongs to the night owls.',
    reward: { cash: 300, bonus: 100, rep: 150 },
    nightOnly: true,
    stages: [
      { id: 'm17-s1', kind: 'race', label: 'Night race: Meridian Avenue to the harbour gates', x: -300, z: 260 },
      { id: 'm17-s2', kind: 'deliver', label: 'Rush delivery: harbour parcel to the lighthouse', x: -420, z: 380 },
      { id: 'm17-s3', kind: 'escape', label: 'Slip away before the harbour patrol wakes up', x: -200, z: 200 },
    ],
  },
  {
    id: 'm18-harbour-lights', name: 'The Harbour Lights Job', giver: 'Whisper',
    blurb: 'SHOWCASE HEIST — pick your getaway, pick your door, and outrun the whole bay. No scripted route: reach the end any way you can.',
    reward: { cash: 900, bonus: 300, rep: 400 },
    nightOnly: false,
    showcase: true,
    phases: ['prep', 'execution', 'escape'],
    stages: [
      // Phase A — Prep: choose 1 of 2 getaway cars, park it yourself.
      { id: 'm18-s1', kind: 'choice', phase: 'prep', label: 'Choose your getaway: the fast Coral Coupe OR the tough Harbour Van', x: 100, z: 200, choices: ['coral-coupe', 'harbour-van'] },
      { id: 'm18-s2', kind: 'park', phase: 'prep', label: 'Park the getaway car at a spot YOU choose near the harbour', x: -260, z: 220 },
      // Phase B — Execution: 2 entrances, noise changes NPC reactions.
      { id: 'm18-s3', kind: 'rob', phase: 'execution', label: 'Enter the harbour shop — busy front door OR quiet back alley', x: -280, z: 240, entrances: ['front', 'alley'] },
      { id: 'm18-s4', kind: 'rob', phase: 'execution', label: 'Grab the till cash and get out — quiet means calm NPCs, loud means panic', x: -280, z: 240 },
      // Phase C — Escape: systemic pursuit, any route counts.
      { id: 'm18-s5', kind: 'escape', phase: 'escape', label: 'Escape the pursuit — swap cars to drop the vehicle trail', x: -100, z: -100 },
      { id: 'm18-s6', kind: 'hide', phase: 'escape', label: 'Reach the safehouse on Hill Road by ANY route', x: 320, z: 260 },
    ],
  },
];

export function totalStages() {
  return MISSIONS.reduce((n, m) => n + m.stages.length, 0);
}

export function validateMissions() {
  const errors = [];
  if (MISSIONS.length !== 18) errors.push('expected 18 missions, got ' + MISSIONS.length);
  if (totalStages() !== 49) errors.push('expected 49 stages, got ' + totalStages());
  const ids = new Set();
  for (const m of MISSIONS) {
    if (ids.has(m.id)) errors.push('duplicate mission id ' + m.id);
    ids.add(m.id);
    for (const s of m.stages) {
      if (!STAGE_KINDS.includes(s.kind)) errors.push(m.id + ' stage ' + s.id + ' bad kind ' + s.kind);
      if (ids.has(s.id)) errors.push('duplicate stage id ' + s.id);
      ids.add(s.id);
    }
  }
  const m1 = MISSIONS[0];
  if (!m1 || m1.reward.cash !== 150 || m1.reward.bonus !== 50 || m1.reward.rep !== 100) {
    errors.push('mission 1 reward must be +$150, +$50, REP +100');
  }
  const show = MISSIONS.find((m) => m.showcase);
  if (!show || show.stages.length !== 6) errors.push('showcase heist must have 6 stages');
  return { ok: errors.length === 0, errors, missions: MISSIONS.length, stages: totalStages() };
}

// --- Cop AI ----------------------------------------------------------
// Systemic, not scripted: cops steer toward the player's CURRENT
// position, with speed and numbers scaling by wanted level. At
// wanted >= 3 the AIR-1 helicopter joins with a sweeping spotlight.
export class CopAI {
  constructor() {
    this.cops = [];        // {x, z, speed, state}
    this.heliActive = false;
    this.heli = { x: 0, z: 0, spotlightAngle: 0, spotlightRadius: 60 };
    this.roadblocks = [];  // {x, z} spike-strip / roadblock points
    this.searchZone = null;
    this.searchTimer = 0;
  }

  wantedToCopCount(wanted) {
    return [0, 2, 3, 4, 6, 8][Math.max(0, Math.min(5, wanted))] || 0;
  }

  spawnForWanted(wanted, playerX, playerZ) {
    const n = this.wantedToCopCount(wanted);
    this.cops = [];
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      this.cops.push({
        x: playerX + Math.cos(a) * 120, z: playerZ + Math.sin(a) * 120,
        speed: 14 + wanted * 3, state: 'chase',
      });
    }
    this.heliActive = wanted >= AIR_HELI_WANTED;
    if (this.heliActive) { this.heli.x = playerX; this.heli.z = playerZ; }
    // 1-2 roadblocks ahead of the player during a hot pursuit.
    this.roadblocks = [];
    if (wanted >= 3) {
      this.roadblocks.push({ x: playerX + 180, z: playerZ + 60, kind: 'spike-strip' });
      if (wanted >= 4) this.roadblocks.push({ x: playerX - 150, z: playerZ + 180, kind: 'roadblock' });
    }
    this.searchZone = { x: playerX, z: playerZ, radius: 90 + wanted * 30 };
    this.searchTimer = 45 + wanted * 10;
    return this.cops;
  }

  // One tick (dt seconds). Cops chase the player's live position.
  update(dt, playerX, playerZ, playerSpeed) {
    for (const cop of this.cops) {
      const dx = playerX - cop.x, dz = playerZ - cop.z;
      const d = Math.hypot(dx, dz) || 1;
      const step = Math.min(d, cop.speed * dt);
      cop.x += (dx / d) * step;
      cop.z += (dz / d) * step;
      cop.state = d < 12 ? 'busted-near' : 'chase';
    }
    if (this.heliActive) {
      // Helicopter drifts above the player; spotlight sweeps the street.
      this.heli.x += (playerX - this.heli.x) * 0.5 * dt;
      this.heli.z += (playerZ - this.heli.z) * 0.5 * dt;
      this.heli.spotlightAngle += dt * 0.9;
      this.heli.spotlightRadius = 55 + Math.sin(Date.now() / 900) * 10;
    }
    if (this.searchTimer > 0) this.searchTimer = Math.max(0, this.searchTimer - dt);
    // Search zone follows the last known position while visible.
    if (this.searchZone && playerSpeed < 2) {
      this.searchZone.x += (playerX - this.searchZone.x) * 0.1 * dt;
      this.searchZone.z += (playerZ - this.searchZone.z) * 0.1 * dt;
    }
    return this.cops;
  }

  nearestCopDistance(playerX, playerZ) {
    let best = Infinity;
    for (const c of this.cops) best = Math.min(best, Math.hypot(c.x - playerX, c.z - playerZ));
    return best;
  }

  clear() {
    this.cops = []; this.heliActive = false;
    this.roadblocks = []; this.searchZone = null; this.searchTimer = 0;
  }
}

// --- Job system ------------------------------------------------------
export class JobSystem {
  constructor(callbacks) {
    this.cb = callbacks || {};
    this.money = 0;
    this.rep = 0;
    this.wanted = 0;
    // Wanted memory: what the police know. 'car' | 'clothes' | 'face'.
    this.wantedMemory = [];
    this.completed = new Set();
    this.active = null;       // { mission, stageIndex }
    this.hour = 12;
    this.cops = new CopAI();
    this.safehouse = { x: 320, z: 260, label: 'Hill Road Safehouse' };
    this.garage = { x: 100, z: 200, label: 'Sunset Garage' };
    this.cashPickups = [];    // {x, z, amount, taken}
    this.noise = 0;           // 0 quiet .. 1 loud; drives NPC reactions
    this.getawayChoice = null;
    this.getawayParkedAt = null;
  }

  emit(event, data) {
    if (typeof this.cb[event] === 'function') this.cb[event](data);
    if (typeof this.cb.onEvent === 'function') this.cb.onEvent(event, data);
  }

  availableMissions() {
    const isNight = this.hour >= 20 || this.hour < 6;
    return MISSIONS.filter((m) => !this.completed.has(m.id) && (!m.nightOnly || isNight));
  }

  setTime(hour) { this.hour = ((hour % 24) + 24) % 24; }

  startMission(missionId) {
    const m = MISSIONS.find((x) => x.id === missionId);
    if (!m) return { ok: false, error: 'unknown mission ' + missionId };
    if (this.completed.has(m.id)) return { ok: false, error: 'mission already completed' };
    if (m.nightOnly && !(this.hour >= 20 || this.hour < 6)) {
      return { ok: false, error: 'this mission only appears at night' };
    }
    if (this.active) return { ok: false, error: 'another mission is active' };
    this.active = { mission: m, stageIndex: 0 };
    this.noise = 0;
    this.emit('mission-start', { mission: m, stage: m.stages[0] });
    return { ok: true, mission: m, stage: m.stages[0] };
  }

  currentStage() {
    if (!this.active) return null;
    return this.active.mission.stages[this.active.stageIndex] || null;
  }

  // Advance one stage. `detail` carries stage-specific facts, e.g.
  // { choice: 'coral-coupe' } or { entrance: 'alley', loud: false }.
  completeStage(detail) {
    if (!this.active) return { ok: false, error: 'no active mission' };
    const { mission } = this.active;
    const stage = this.currentStage();
    if (!stage) return { ok: false, error: 'no current stage' };

    if (stage.kind === 'choice' && detail && detail.choice) {
      this.getawayChoice = detail.choice;
      this.emit('getaway-chosen', { choice: detail.choice });
    }
    if (stage.kind === 'park' && detail && detail.x != null) {
      this.getawayParkedAt = { x: detail.x, z: detail.z };
      this.emit('getaway-parked', this.getawayParkedAt);
    }
    if (stage.kind === 'rob' && detail) {
      // Noise drives NPC reactions: loud front-door entry panics the
      // shop; a quiet back-alley entry keeps NPCs calm.
      if (detail.entrance === 'front') this.noise = Math.min(1, this.noise + 0.7);
      if (detail.entrance === 'alley') this.noise = Math.min(1, this.noise + 0.15);
      if (detail.loud) this.noise = 1;
      this.emit('robbery-noise', { noise: this.noise, entrance: detail.entrance || null });
      if (this.noise > 0.6) this.raiseWanted(2, ['face', 'clothes']);
    }

    this.active.stageIndex++;
    this.emit('stage-complete', { mission, stage });
    if (this.active.stageIndex >= mission.stages.length) return this.completeMission();
    return { ok: true, mission, stage: this.currentStage() };
  }

  completeMission() {
    const { mission } = this.active;
    const r = mission.reward;
    this.money += r.cash + (r.bonus || 0);
    this.rep += r.rep || 0;
    this.completed.add(mission.id);
    this.active = null;
    this.emit('mission-complete', { mission, cash: r.cash + (r.bonus || 0), rep: r.rep || 0 });
    return { ok: true, completed: true, mission, cash: r.cash + (r.bonus || 0), rep: r.rep || 0 };
  }

  failMission(reason) {
    if (!this.active) return { ok: false };
    const mission = this.active.mission;
    this.active = null;
    this.emit('mission-fail', { mission, reason: reason || 'failed' });
    return { ok: true, mission, reason };
  }

  // --- Wanted + memory ----------------------------------------------
  raiseWanted(levels, knows) {
    this.wanted = Math.max(0, Math.min(MAX_WANTED, this.wanted + (levels || 1)));
    for (const k of knows || []) {
      if (!this.wantedMemory.includes(k)) this.wantedMemory.push(k);
    }
    this.emit('wanted-change', { wanted: this.wanted, memory: this.wantedMemory.slice() });
    return this.wanted;
  }

  // Swapping cars drops the vehicle trail.
  swapVehicle() {
    this.wantedMemory = this.wantedMemory.filter((k) => k !== 'car');
    this.emit('wanted-change', { wanted: this.wanted, memory: this.wantedMemory.slice() });
    return this.wantedMemory.slice();
  }

  // Changing clothes at a shop drops the outfit trail.
  changeClothes() {
    this.wantedMemory = this.wantedMemory.filter((k) => k !== 'clothes');
    this.emit('wanted-change', { wanted: this.wanted, memory: this.wantedMemory.slice() });
    return this.wantedMemory.slice();
  }

  // Hide outside the red search zone until the timer runs out:
  // everything is forgotten and wanted falls to zero.
  tickHiding(dt, insideSearchZone) {
    if (this.wanted === 0) return false;
    if (!insideSearchZone) {
      this.cops.searchTimer = Math.max(0, this.cops.searchTimer - dt);
      if (this.cops.searchTimer <= 0) {
        this.wanted = 0;
        this.wantedMemory = [];
        this.cops.clear();
        this.emit('wanted-change', { wanted: 0, memory: [] });
        this.emit('escaped', {});
        return true;
      }
    }
    return false;
  }

  // --- Safehouse / garage / shop -------------------------------------
  respray() {
    if (this.money < RESPRAY_COST) return { ok: false, error: 'need $' + RESPRAY_COST };
    this.money -= RESPRAY_COST;
    // A fresh paint job is a new car as far as the police are concerned.
    this.swapVehicle();
    this.emit('respray', { cost: RESPRAY_COST });
    return { ok: true, cost: RESPRAY_COST, money: this.money };
  }

  atSafehouse(x, z) {
    return Math.hypot(x - this.safehouse.x, z - this.safehouse.z) < 25;
  }

  restAtSafehouse() {
    this.wanted = 0;
    this.wantedMemory = [];
    this.cops.clear();
    this.emit('wanted-change', { wanted: 0, memory: [] });
    return { ok: true };
  }

  // --- Cash pickups ----------------------------------------------------
  spawnCashPickup(x, z, amount) {
    const p = { x, z, amount: amount || 25, taken: false };
    this.cashPickups.push(p);
    return p;
  }

  collectCashPickup(x, z, radius) {
    let gained = 0;
    for (const p of this.cashPickups) {
      if (!p.taken && Math.hypot(p.x - x, p.z - z) < (radius || 8)) {
        p.taken = true;
        gained += p.amount;
      }
    }
    if (gained > 0) {
      this.money += gained;
      this.emit('cash-pickup', { amount: gained, money: this.money });
    }
    return gained;
  }

  // Distance (metres) from the player to the current objective.
  distanceToObjective(px, pz) {
    const st = this.currentStage();
    if (!st || st.x == null) return null;
    return Math.hypot(st.x - px, st.z - pz);
  }

  // Route for the HUD minimap: straight waypoints player -> objective.
  // The showcase escape deliberately has NO fixed route — any path
  // counts, so the HUD draws a direct line, not a spline to follow.
  routeToObjective(px, pz) {
    const st = this.currentStage();
    if (!st || st.x == null) return [];
    return [{ x: px, z: pz }, { x: st.x, z: st.z }];
  }

  save() {
    return {
      money: this.money, rep: this.rep, wanted: this.wanted,
      wantedMemory: this.wantedMemory.slice(),
      completed: Array.from(this.completed),
      hour: this.hour, getawayChoice: this.getawayChoice,
      getawayParkedAt: this.getawayParkedAt,
    };
  }

  load(data) {
    if (!data) return;
    this.money = data.money || 0;
    this.rep = data.rep || 0;
    this.wanted = data.wanted || 0;
    this.wantedMemory = Array.isArray(data.wantedMemory) ? data.wantedMemory.slice() : [];
    this.completed = new Set(data.completed || []);
    if (data.hour != null) this.hour = data.hour;
    this.getawayChoice = data.getawayChoice || null;
    this.getawayParkedAt = data.getawayParkedAt || null;
  }
}

export function createJobSystem(callbacks) { return new JobSystem(callbacks); }

if (typeof window !== 'undefined') {
  window.SunsetJobs = window.SunsetJobs || {};
  window.SunsetJobs.MISSIONS = MISSIONS;
  window.SunsetJobs.JobSystem = JobSystem;
  window.SunsetJobs.CopAI = CopAI;
  window.SunsetJobs.validateMissions = validateMissions;
  window.SunsetJobs.RESPRAY_COST = RESPRAY_COST;
}

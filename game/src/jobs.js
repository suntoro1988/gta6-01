// Sunset Bay — missions & jobs system: 18 missions, 49 stages,
// plus repeatable taxi and delivery work.
// Written from scratch for v10. No dependencies except ./rng.js for
// procedural taxi / delivery generation.
//
// Money / REP rules:
//   Mission 1 pays $150 (stage 1) + $50 (stage 2) = $200, REP +100.
//   Every stage pays its own reward on arrival; the mission REP bonus
//   lands when the final stage completes.
//   Taxi fare  = $20 base + $2 per unit of trip distance.
//   Delivery   = $30 base + $3 per unit, with a time limit.
//
// The game owns the wallet: this module only reads / writes
//   game.cash, game.rep, game.player.{x,z}
// and never touches the renderer. A mission is active while
//   SB.Jobs.state.active is set.

import { rng } from "./rng.js";

const SB = (globalThis.SB = globalThis.SB || {});

const ARRIVE_RADIUS = 6;

function st(kind, text, x, z, reward, extra) {
  const stage = { kind, text, x, z, reward: reward || 0, radius: ARRIVE_RADIUS };
  if (extra) Object.assign(stage, extra);
  return stage;
}

// ---------------------------------------------------------------------------
// 18 missions / 49 stages. Stage counts per mission:
//   2,3,3,2,5,3,2,3,2,4,2,3,2,3,2,3,2,3  = 49
// ---------------------------------------------------------------------------

const MISSIONS = [
  {
    id: 1,
    title: "First Wheels",
    giver: "Rico",
    desc: "Rico needs a driver he can trust. Prove you can follow directions.",
    rep: 100,
    stages: [
      st("goto", "Meet Rico at the Sunset Diner", 24, 8, 150),
      // Stage 2 sits exactly 64 units east of stage 1: a fair first drive.
      st("goto", "Drive Rico's package to the Marina lockup", 88, 8, 50, { distance: 64 }),
    ],
  },
  {
    id: 2,
    title: "Sunset Cruise",
    giver: "Rico",
    desc: "Show the new coupe around the bay before the buyer sees it.",
    rep: 60,
    stages: [
      st("goto", "Pick up the coupe at the Docks", -40, 60, 60),
      st("goto", "Cruise past the Boardwalk", 10, 110, 60),
      st("goto", "Park it at Rico's garage", 24, 8, 80),
    ],
  },
  {
    id: 3,
    title: "Fish & Chips Run",
    giver: "Mama Lou",
    desc: "The diner is out of fish. Three stops, no excuses.",
    rep: 80,
    stages: [
      st("goto", "Buy fish at the Harbor Market", -70, 40, 50),
      st("goto", "Pick up potatoes at the Farm Stand", -110, -60, 50),
      st("deliver", "Deliver everything to Mama Lou's Diner", 24, 8, 100),
    ],
  },
  {
    id: 4,
    title: "Night Shift",
    giver: "Rico",
    desc: "Two drops after dark. Keep your headlights low.",
    rep: 70,
    stages: [
      st("goto", "Collect the briefcase at the Motel", 120, -40, 90),
      st("deliver", "Drop it at the Pier warehouse", -40, 120, 110),
    ],
  },
  {
    id: 5,
    title: "The Long Haul",
    giver: "Mama Lou",
    desc: "Five stops across the whole bay. The longest day yet.",
    rep: 150,
    stages: [
      st("goto", "Start at the Farm Stand", -110, -60, 60),
      st("goto", "Bakery on Palm Row", -30, -90, 60),
      st("goto", "Flower shop downtown", 40, -50, 60),
      st("goto", "Butcher near the Stadium", 110, 20, 60),
      st("deliver", "Finish at Mama Lou's Diner", 24, 8, 110),
    ],
  },
  {
    id: 6,
    title: "Hot Wheels",
    giver: "Dex",
    desc: "Dex's crew races at midnight. Scout the route first.",
    rep: 90,
    stages: [
      st("goto", "Check the start line at the Bridge", 0, -140, 70),
      st("goto", "Check the tunnel shortcut", 90, -90, 70),
      st("goto", "Report back to Dex at the Garage", 60, 60, 110),
    ],
  },
  {
    id: 7,
    title: "Bay Watch",
    giver: "Officer Kane",
    desc: "Help the police spot a stolen boat. Yes, really.",
    rep: 50,
    stages: [
      st("goto", "Search the North Marina", -90, 130, 80),
      st("goto", "Report to the Police Station", 10, -20, 120),
    ],
  },
  {
    id: 8,
    title: "Pizza Panic",
    giver: "Mama Lou",
    desc: "Three pizzas, three customers, all of them hungry.",
    rep: 90,
    stages: [
      st("deliver", "Pizza to the Beach House", -20, 150, 70),
      st("deliver", "Pizza to the Lighthouse", -150, 90, 70),
      st("deliver", "Pizza to the Hotel rooftop guest", 80, 110, 110),
    ],
  },
  {
    id: 9,
    title: "Silent Partner",
    giver: "Rico",
    desc: "Pick up a passenger who must not be seen. No questions.",
    rep: 110,
    stages: [
      st("goto", "Pick up the passenger at the Alley", 70, -30, 120),
      st("deliver", "Drop them at the Safehouse", -120, -110, 130),
    ],
  },
  {
    id: 10,
    title: "Grand Tour",
    giver: "Tour Office",
    desc: "Drive the tourist bus route: four viewpoints, one sunset.",
    rep: 140,
    stages: [
      st("goto", "Viewpoint 1: The Boardwalk", 10, 110, 60),
      st("goto", "Viewpoint 2: The Lighthouse", -150, 90, 60),
      st("goto", "Viewpoint 3: The Stadium", 110, 20, 60),
      st("goto", "Viewpoint 4: Sunset Hill", 60, 150, 120),
    ],
  },
  {
    id: 11,
    title: "Tow Job",
    giver: "Dex",
    desc: "A friend's car died on the bridge. Tow it back.",
    rep: 70,
    stages: [
      st("goto", "Hook up the broken car at the Bridge", 0, -140, 100),
      st("deliver", "Tow it to Dex's Garage", 60, 60, 100),
    ],
  },
  {
    id: 12,
    title: "The Photographer",
    giver: "Tour Office",
    desc: "A magazine photographer needs three golden-hour shots.",
    rep: 100,
    stages: [
      st("goto", "Photo spot: the Pier", -40, 120, 70),
      st("goto", "Photo spot: the Old Town", -60, -40, 70),
      st("goto", "Photo spot: the Marina", 88, 8, 110),
    ],
  },
  {
    id: 13,
    title: "Medicine Run",
    giver: "Mama Lou",
    desc: "The clinic is out of supplies. Drive fast, drive safe.",
    rep: 120,
    stages: [
      st("goto", "Pick up supplies at the Pharmacy", 30, -70, 110),
      st("deliver", "Deliver to the Bay Clinic", -10, 40, 140),
    ],
  },
  {
    id: 14,
    title: "Street King Qualifier",
    giver: "Dex",
    desc: "Three checkpoints. Beat the clock and you race tonight.",
    rep: 130,
    stages: [
      st("goto", "Checkpoint 1: Palm Row", -30, -90, 80, { timeLimit: 60 }),
      st("goto", "Checkpoint 2: the Tunnel", 90, -90, 80, { timeLimit: 60 }),
      st("goto", "Checkpoint 3: the Finish Arch", 10, 110, 140, { timeLimit: 75 }),
    ],
  },
  {
    id: 15,
    title: "The Informant",
    giver: "Officer Kane",
    desc: "Meet the informant, then get the evidence downtown.",
    rep: 110,
    stages: [
      st("goto", "Meet the informant at the Docks", -40, 60, 110),
      st("deliver", "Take the evidence to the Police Station", 10, -20, 140),
    ],
  },
  {
    id: 16,
    title: "Sunset Festival",
    giver: "Tour Office",
    desc: "Festival setup: three deliveries before the gates open.",
    rep: 120,
    stages: [
      st("goto", "Pick up fireworks at the Warehouse", 120, 80, 70),
      st("goto", "Pick up the stage kit at the Docks", -40, 60, 70),
      st("deliver", "Deliver everything to the Festival Ground", 0, 150, 110),
    ],
  },
  {
    id: 17,
    title: "The Getaway",
    giver: "Rico",
    desc: "One last job for Rico. Drive like the whole bay is watching.",
    rep: 160,
    stages: [
      st("goto", "Pick up Rico at the Casino", 140, -20, 140),
      st("deliver", "Lose the tail, reach the Safehouse", -120, -110, 210),
    ],
  },
  {
    id: 18,
    title: "King of Sunset Bay",
    giver: "Dex",
    desc: "The final race: three legs, winner takes the crown.",
    rep: 200,
    stages: [
      st("goto", "Race leg 1: the Bridge", 0, -140, 120, { timeLimit: 70 }),
      st("goto", "Race leg 2: the Stadium", 110, 20, 120, { timeLimit: 70 }),
      st("goto", "Race leg 3: the Finish at Sunset Hill", 60, 150, 260, { timeLimit: 90 }),
    ],
  },
];

function totalStages() {
  return MISSIONS.reduce((sum, m) => sum + m.stages.length, 0);
}

function listMissions() {
  return MISSIONS.map((m) => ({
    id: m.id,
    title: m.title,
    giver: m.giver,
    desc: m.desc,
    stages: m.stages.length,
    rep: m.rep,
    totalReward: m.stages.reduce((s, stg) => s + stg.reward, 0),
  }));
}

function getMission(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

// ---------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------

const state = {
  active: null, // { mission, stageIndex, stageTime }
  completed: [], // mission ids
  taxi: null, // { from, to, fare, pickedUp }
  delivery: null, // { from, to, pay, timeLeft }
};

function dist2d(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function currentStage() {
  if (!state.active) return null;
  return state.active.mission.stages[state.active.stageIndex] || null;
}

function missionProgress() {
  if (!state.active) return null;
  const m = state.active.mission;
  return {
    missionId: m.id,
    title: m.title,
    stageIndex: state.active.stageIndex,
    stageCount: m.stages.length,
    stage: currentStage(),
    stageTimeLeft:
      currentStage() && currentStage().timeLimit !== undefined
        ? Math.max(0, currentStage().timeLimit - state.active.stageTime)
        : null,
  };
}

function objectiveText() {
  const p = missionProgress();
  if (p) return "Mission " + p.missionId + " — " + p.title + ": " + p.stage.text;
  if (state.taxi) {
    return state.taxi.pickedUp
      ? "Taxi: drop the passenger at the marker ($" + state.taxi.fare + ")"
      : "Taxi: pick up the passenger at the marker ($" + state.taxi.fare + ")";
  }
  if (state.delivery) {
    return "Delivery: reach the marker in " + Math.ceil(state.delivery.timeLeft) + "s ($" + state.delivery.pay + ")";
  }
  return "Free roam — visit Rico at the Diner to start Mission 1.";
}

function startMission(game, id) {
  const mission = getMission(id);
  if (!mission) return { ok: false, error: "unknown mission " + id };
  if (state.completed.includes(id)) return { ok: false, error: "mission already completed" };
  if (state.active) return { ok: false, error: "another mission is active" };
  state.active = { mission, stageIndex: 0, stageTime: 0 };
  if (game && game.audio) game.audio.playSFX("mission");
  return { ok: true, mission: mission.title, stage: currentStage() };
}

function updateMission(game, dt) {
  if (!state.active || !game || !game.player) return null;
  const stage = currentStage();
  if (!stage) return null;
  state.active.stageTime += dt || 0;

  if (stage.timeLimit !== undefined && state.active.stageTime > stage.timeLimit) {
    const failed = state.active.mission;
    state.active = null;
    if (game.audio) game.audio.playSFX("fail");
    return { event: "failed", mission: failed.title, reason: "time ran out" };
  }

  const d = dist2d(game.player, stage);
  if (d > stage.radius) return { event: "progress", distance: Math.round(d) };

  // Arrived: pay the stage reward, advance or complete.
  game.cash = (game.cash || 0) + stage.reward;
  if (game.audio) game.audio.playSFX("cash");
  const reached = { event: "stage", mission: state.active.mission.title, stage: stage.text, reward: stage.reward };
  state.active.stageIndex++;
  state.active.stageTime = 0;
  if (state.active.stageIndex >= state.active.mission.stages.length) {
    return completeMission(game, reached);
  }
  return reached;
}

function completeMission(game, reached) {
  const mission = state.active.mission;
  game.rep = (game.rep || 0) + mission.rep;
  state.completed.push(mission.id);
  state.active = null;
  if (game && game.audio) game.audio.playSFX("mission");
  return {
    event: "completed",
    mission: mission.title,
    stageReward: reached ? reached.reward : 0,
    rep: mission.rep,
    totalCash: game.cash,
    totalRep: game.rep,
  };
}

function abandonMission() {
  if (!state.active) return false;
  state.active = null;
  return true;
}

// ---------------------------------------------------------------------------
// Taxi work (repeatable)
// ---------------------------------------------------------------------------

const TAXI_SPOTS = [
  { x: 24, z: 8, name: "Sunset Diner" },
  { x: -40, z: 120, name: "the Pier" },
  { x: 10, z: 110, name: "the Boardwalk" },
  { x: -150, z: 90, name: "the Lighthouse" },
  { x: 110, z: 20, name: "the Stadium" },
  { x: 60, z: 150, name: "Sunset Hill" },
  { x: -70, z: 40, name: "Harbor Market" },
  { x: 0, z: -140, name: "the Bridge" },
];

function startTaxiJob(game) {
  if (state.taxi || state.active) return { ok: false, error: "busy" };
  const r = rng(Date.now());
  const from = r.pick(TAXI_SPOTS);
  let to = r.pick(TAXI_SPOTS);
  let guard = 0;
  while (to === from && guard++ < 10) to = r.pick(TAXI_SPOTS);
  const trip = Math.round(dist2d(from, to));
  const fare = 20 + 2 * trip;
  state.taxi = { from, to, fare, pickedUp: false, name: to.name };
  return { ok: true, from: from.name, to: to.name, fare, distance: trip };
}

function updateTaxiJob(game) {
  if (!state.taxi || !game || !game.player) return null;
  const target = state.taxi.pickedUp ? state.taxi.to : state.taxi.from;
  const d = dist2d(game.player, target);
  if (d > ARRIVE_RADIUS) return { event: "progress", distance: Math.round(d) };
  if (!state.taxi.pickedUp) {
    state.taxi.pickedUp = true;
    if (game.audio) game.audio.playSFX("pickup");
    return { event: "pickedUp", to: state.taxi.to.name, fare: state.taxi.fare };
  }
  game.cash = (game.cash || 0) + state.taxi.fare;
  if (game.audio) game.audio.playSFX("cash");
  const done = { event: "completed", fare: state.taxi.fare, to: state.taxi.to.name };
  state.taxi = null;
  return done;
}

// ---------------------------------------------------------------------------
// Delivery work (repeatable, timed)
// ---------------------------------------------------------------------------

function startDeliveryJob(game) {
  if (state.delivery || state.active) return { ok: false, error: "busy" };
  const r = rng(Date.now() + 7);
  const from = r.pick(TAXI_SPOTS);
  let to = r.pick(TAXI_SPOTS);
  let guard = 0;
  while (to === from && guard++ < 10) to = r.pick(TAXI_SPOTS);
  const trip = Math.round(dist2d(from, to));
  const pay = 30 + 3 * trip;
  const timeLimit = Math.max(45, Math.round(trip * 0.9));
  state.delivery = { from, to, pay, timeLeft: timeLimit, timeLimit };
  return { ok: true, from: from.name, to: to.name, pay, timeLimit };
}

function updateDeliveryJob(game, dt) {
  if (!state.delivery || !game || !game.player) return null;
  state.delivery.timeLeft -= dt || 0;
  if (state.delivery.timeLeft <= 0) {
    state.delivery = null;
    if (game.audio) game.audio.playSFX("fail");
    return { event: "failed", reason: "delivery too slow" };
  }
  const d = dist2d(game.player, state.delivery.to);
  if (d > ARRIVE_RADIUS) {
    return { event: "progress", distance: Math.round(d), timeLeft: Math.ceil(state.delivery.timeLeft) };
  }
  game.cash = (game.cash || 0) + state.delivery.pay;
  if (game.audio) game.audio.playSFX("cash");
  const done = { event: "completed", pay: state.delivery.pay };
  state.delivery = null;
  return done;
}

/** Marker the HUD should draw: active stage / taxi / delivery target. */
function activeMarker() {
  if (state.active) {
    const s = currentStage();
    return s ? { x: s.x, z: s.z } : null;
  }
  if (state.taxi) {
    const t = state.taxi.pickedUp ? state.taxi.to : state.taxi.from;
    return { x: t.x, z: t.z };
  }
  if (state.delivery) return { x: state.delivery.to.x, z: state.delivery.to.z };
  return null;
}

SB.Jobs = {
  MISSIONS,
  totalStages,
  listMissions,
  getMission,
  startMission,
  updateMission,
  completeMission,
  abandonMission,
  missionProgress,
  objectiveText,
  activeMarker,
  startTaxiJob,
  updateTaxiJob,
  startDeliveryJob,
  updateDeliveryJob,
  state,
};

const Jobs = SB.Jobs;

export {
  Jobs,
  MISSIONS,
  totalStages,
  listMissions,
  getMission,
  startMission,
  updateMission,
  completeMission,
  abandonMission,
  missionProgress,
  objectiveText,
  activeMarker,
  startTaxiJob,
  updateTaxiJob,
  startDeliveryJob,
  updateDeliveryJob,
  state as jobsState,
};
export default SB.Jobs;

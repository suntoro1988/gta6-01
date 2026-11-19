// shots.js — Sunset Bay v6 (fresh rewrite, session-recorded)
// Screenshot staging only. Takes G as an argument; never imports game state
// modules, never overwrites the mission object with a number.
// Named exports: SHOTS, stageShot(name, G), applyShot(name, G).
// Shot state lives in separate fields: G.shotScene (string) and
// G.shotLabel (string). G.mission stays an object { name, stageLabel, target }.

export const SHOTS = {
  start: {
    label: 'Title / Downtown street, morning',
    player: { x: -56, z: -260, heading: 0 },
    vehicle: null,
    onFoot: true,
    wanted: 0,
    money: 250,
    hour: 9,
    mission: { name: 'First Wheels', stageLabel: 'Stage 1 of 4 — Meet the contact', target: { x: 60, z: -240 } },
  },
  play: {
    label: 'Driving along Beachfront, midday',
    player: { x: 310, z: -180, heading: 1.57 },
    vehicle: { kind: 'sedan', x: 310, z: -180, heading: 1.57 },
    onFoot: false,
    wanted: 1,
    money: 1840,
    hour: 13,
    mission: { name: 'Beachfront Run', stageLabel: 'Stage 2 of 5 — Lose the tail, reach the pier', target: { x: 430, z: 180 } },
  },
  foot: {
    label: 'On foot near the Pier, police nearby, afternoon',
    player: { x: 300, z: 220, heading: 0.785 },
    vehicle: null,
    onFoot: true,
    wanted: 2,
    money: 960,
    hour: 16,
    mission: { name: 'Pier Drop', stageLabel: 'Stage 3 of 4 — Deliver the package', target: { x: 460, z: 300 } },
    police: [{ x: 314, z: 236 }, { x: 312, z: 226 }],
  },
  end: {
    label: 'Sunset at Hillcrest Lookout, evening',
    player: { x: -180, z: 330, heading: 2.4 },
    vehicle: { kind: 'coupe', x: -173, z: 322, heading: 2.4 },
    onFoot: false,
    wanted: 0,
    money: 12500,
    hour: 18.5,
    mission: { name: 'Hillcrest Sunset', stageLabel: 'Complete — All jobs done', target: null },
  },
};

function hideOverlays() {
  // Hide every HUD / title / pause overlay so the shot is clean 3D only.
  const sels = ['.sb-hud', '.sb-title', '.sb-pause', '.sb-overlay', '#title-screen', '#pause-screen'];
  for (const s of sels) {
    const nodes = document.querySelectorAll(s);
    nodes.forEach((n) => { n.dataset.shotHidden = '1'; n.style.display = 'none'; });
  }
}

export function stageShot(name, G) {
  const shot = SHOTS[name];
  if (!shot || !G) return null;
  G.shotScene = name;
  G.shotLabel = shot.label;
  // Player placement (object fields only — never a bare number).
  G.player = G.player || {};
  G.player.x = shot.player.x;
  G.player.z = shot.player.z;
  G.player.heading = shot.player.heading;
  G.player.onFoot = shot.onFoot;
  G.player.inVehicle = !shot.onFoot;
  // Vehicle placement, if the scene has one.
  if (shot.vehicle) {
    G.vehicle = G.vehicle || {};
    G.vehicle.kind = shot.vehicle.kind;
    G.vehicle.x = shot.vehicle.x;
    G.vehicle.z = shot.vehicle.z;
    G.vehicle.heading = shot.vehicle.heading;
    G.vehicle.active = true;
  } else if (G.vehicle) {
    G.vehicle.active = false;
  }
  // Mission stays an OBJECT with name/stageLabel/target — never a number.
  G.mission = {
    name: shot.mission.name,
    stageLabel: shot.mission.stageLabel,
    target: shot.mission.target ? { x: shot.mission.target.x, z: shot.mission.target.z } : null,
    distance: shot.mission.target
      ? Math.hypot(shot.mission.target.x - shot.player.x, shot.mission.target.z - shot.player.z) : 0,
  };
  G.money = shot.money;
  G.wanted = shot.wanted;
  G.heat = shot.wanted * 20;
  G.timeOfDay = shot.hour;
  G.timeLabel = shot.hour < 12 ? `${Math.floor(shot.hour)}:00 AM` : `${Math.floor(shot.hour - 12) || 12}:00 PM`;
  if (shot.police) G.police = shot.police.map((p) => ({ x: p.x, z: p.z }));
  else if (name !== 'foot') G.police = [];
  G.paused = false;
  G.mapOpen = false;
  hideOverlays();
  return shot;
}

export function applyShot(name, G) {
  return stageShot(name, G);
}

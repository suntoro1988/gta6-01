// The HUD: cash, wanted stars + TRACE heat bar, rep, the mission card,
// the police response panel, radio widget, weapon slots, health/armour,
// speedometer, a minimap, the crew dialog card, score popups, the steal /
// interact prompts, the crosshair, and the full-screen city map (Tab).
// All DOM except the two map canvases; the 3D view stays a plain canvas
// underneath. The crosshair element is created here (not in index.html),
// so this file owns it end to end.
import { CITY_MAX, BEACH_X, PLACES, LINES, districtAt } from './city.js';
import { clamp01 } from './math3.js';

const MAP_SIZE = 150;
const WORLD_SPAN = 400;

function worldToMap(x, z, size = MAP_SIZE) {
  return [
    ((x + WORLD_SPAN / 2) / WORLD_SPAN) * size,
    ((z + WORLD_SPAN / 2) / WORLD_SPAN) * size,
  ];
}

// Shared map painter: the 150px minimap and the 520px full-screen map.
// big adds district colours + names and the POI markers.
function drawMap(ctx, game, size, big) {
  const s = size / WORLD_SPAN;
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, size, size);
  // Ocean and sand on the east edge.
  const [bx] = worldToMap(CITY_MAX, 0, size);
  ctx.fillStyle = '#2a6ea8';
  ctx.fillRect(worldToMap(BEACH_X, 0, size)[0], 0, size, size);
  ctx.fillStyle = '#c9b078';
  ctx.fillRect(bx, 0, worldToMap(BEACH_X, 0, size)[0] - bx, size);
  // Ground: light, so roads and buildings read at a glance.
  ctx.fillStyle = '#7d7d88';
  ctx.fillRect(0, 0, bx, size);
  if (big) {
    // District washes, one per block, from the real district lookup.
    ctx.font = `bold ${Math.round(size / 34)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = 'center';
    for (let ix = 0; ix < 6; ix += 1) {
      for (let iz = 0; iz < 6; iz += 1) {
        const [mx, my] = worldToMap(LINES[ix] + 6, LINES[iz] + 6, size);
        const d = districtAt(LINES[ix] + 26, LINES[iz] + 26);
        ctx.fillStyle = `rgba(${(d.colors[0][0] * 255) | 0},${(d.colors[0][1] * 255) | 0},${(d.colors[0][2] * 255) | 0},0.28)`;
        ctx.fillRect(mx, my, 40 * s, 40 * s);
      }
    }
    // Name each district once, near its middle block.
    const spots = [
      ['Old Town', -130, -130], ['Downtown', -26, -130], ['Marina', 130, -130],
      ['West End', -130, -26], ['The Strip', 130, -26], ['Southside', -130, 26],
      ['Midtown', -26, 78], ['Harbor South', 104, 104],
      ['Hillcrest', -130, 130],
    ];
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 3;
    for (const [name, x, z] of spots) {
      const [mx, my] = worldToMap(x, z, size);
      ctx.strokeText(name, mx, my);
      ctx.fillText(name, mx, my);
    }
  }
  // Buildings: darker than the ground.
  ctx.fillStyle = '#3f3f4c';
  for (const b of game.city.buildings) {
    const [mx, my] = worldToMap(b.x - b.w / 2, b.z - b.d / 2, size);
    ctx.fillRect(mx, my, Math.max(1, b.w * s), Math.max(1, b.d * s));
  }
  // Roads: pale strips.
  ctx.strokeStyle = '#e8e8ec';
  ctx.lineWidth = big ? 8 : 6;
  for (let k = -156; k <= 156; k += 52) {
    const [mx] = worldToMap(k, 0, size);
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, size);
    ctx.stroke();
    const [, my] = worldToMap(0, k, size);
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(size, my);
    ctx.stroke();
  }
  // Places: garage / shop / safehouse.
  if (big) {
    const marks = [
      [PLACES.garage, '#ff9a3c', 'GARAGE'],
      [PLACES.shop, '#2dd44f', 'SHOP'],
      [PLACES.safehouse, '#5a8cff', 'SAFEHOUSE'],
    ];
    ctx.font = `bold ${Math.round(size / 44)}px Trebuchet MS, sans-serif`;
    for (const [p, color, label] of marks) {
      const [mx, my] = worldToMap(p.x, p.z, size);
      ctx.fillStyle = color;
      ctx.fillRect(mx - 6, my - 6, 12, 12);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(mx - 6, my - 6, 12, 12);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, mx, my - 12);
      ctx.fillText(label, mx, my - 12);
    }
  } else {
    ctx.fillStyle = '#ff9a3c';
    const [gx, gy] = worldToMap(PLACES.garage.x, PLACES.garage.z, size);
    ctx.fillRect(gx - 2, gy - 2, 4, 4);
    ctx.fillStyle = '#5a8cff';
    const [hx, hy] = worldToMap(PLACES.safehouse.x, PLACES.safehouse.z, size);
    ctx.fillRect(hx - 2, hy - 2, 4, 4);
  }
  // Waypoint: bigger, pulsing.
  if (game.jobTarget) {
    const [wx, wy] = worldToMap(game.jobTarget.x, game.jobTarget.z, size);
    const pulse = (big ? 8 : 5) + Math.sin(game.time * 5) * 2;
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.arc(wx, wy, pulse + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#7a5c00';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Parked cars: teal dots, so the first car is findable.
  ctx.fillStyle = '#2dd4bf';
  for (const car of game.parked) {
    const [mx, my] = worldToMap(car.x, car.z, size);
    ctx.fillRect(mx - 2, my - 2, 4, 4);
  }
  // Traffic.
  ctx.fillStyle = '#20202a';
  for (const car of game.traffic) {
    const [mx, my] = worldToMap(car.x, car.z, size);
    ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  // Police.
  ctx.fillStyle = '#ff4030';
  for (const cop of game.police) {
    const [mx, my] = worldToMap(cop.x, cop.z, size);
    ctx.beginPath();
    ctx.arc(mx, my, big ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Helicopter.
  if (game.heli) {
    const [mx, my] = worldToMap(game.heli.x, game.heli.z, size);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.arc(mx, my, big ? 7 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Player arrow: bigger.
  const inCar = game.playerCar !== null;
  const px = inCar ? game.playerCar.x : game.player.x;
  const pz = inCar ? game.playerCar.z : game.player.z;
  const heading = inCar ? game.playerCar.heading : game.player.heading;
  const [mx, my] = worldToMap(px, pz, size);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.PI - heading); // map x = world x, map y = world z (down)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#20202a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, big ? -13 : -9);
  ctx.lineTo(big ? 9 : 6.5, big ? 10 : 7);
  ctx.lineTo(big ? -9 : -6.5, big ? 10 : 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// The crosshair: a small plus with a dot, built once and toggled by
// updateHud. It lives in the DOM (not the canvas) so it stays crisp and
// centred whatever the 3D camera does.
function buildCrosshair() {
  const el = document.createElement('div');
  el.id = 'crosshair';
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'width:22px', 'height:22px',
    'margin:-11px 0 0 -11px', 'pointer-events:none', 'z-index:30',
    'display:none',
  ].join(';');
  // Four arms + centre dot, white with a dark outline so it reads on
  // bright sand and dark asphalt alike.
  const arm = (w, h, l, t) => `<span style="position:absolute;width:${w};height:${h};left:${l};top:${t};background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,0.8);"></span>`;
  el.innerHTML =
    arm('2px', '7px', '10px', '0') + arm('2px', '7px', '10px', '15px') +
    arm('7px', '2px', '0', '10px') + arm('7px', '2px', '15px', '10px') +
    '<span style="position:absolute;width:3px;height:3px;left:9.5px;top:9.5px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,0.8);border-radius:50%;"></span>';
  document.body.appendChild(el);
  return el;
}

export function createHud() {
  const slots = document.getElementById('weapon-slots');
  const slotEls = [];
  if (slots) {
    for (let i = 0; i < 4; i += 1) {
      const el = document.createElement('div');
      el.className = 'wslot';
      el.innerHTML = `<span class="wkey">${i + 1}</span><span class="wname"></span><span class="wammo"></span>`;
      slots.appendChild(el);
      slotEls.push(el);
    }
  }
  return {
    cash: document.getElementById('cash'),
    stars: document.getElementById('stars'),
    heatFill: document.getElementById('heat-fill'),
    repLine: document.getElementById('rep-line'),
    repFill: document.getElementById('rep-fill'),
    missionCard: document.getElementById('mission-card'),
    missionNum: document.getElementById('mission-num'),
    missionName: document.getElementById('mission-name'),
    missionTimer: document.getElementById('mission-timer'),
    missionStage: document.getElementById('mission-stage'),
    missionStageFill: document.getElementById('mission-stage-fill'),
    missionNext: document.getElementById('mission-next'),
    district: document.getElementById('district'),
    speed: document.getElementById('speed'),
    speedNum: document.getElementById('speed-num'),
    vehicleName: document.getElementById('vehicle-name'),
    message: document.getElementById('message'),
    title: document.getElementById('title'),
    busted: document.getElementById('busted'),
    bustedStats: document.getElementById('busted-stats'),
    minimap: document.getElementById('minimap'),
    help: document.getElementById('help'),
    stats: document.getElementById('stats'),
    paused: document.getElementById('paused'),
    beaconArrow: document.getElementById('beacon-arrow'),
    stealPrompt: document.getElementById('steal-prompt'),
    interactPrompt: document.getElementById('interact-prompt'),
    policePanel: document.getElementById('police-panel'),
    policeList: document.getElementById('police-list'),
    heliLine: document.getElementById('heli-line'),
    radioStation: document.getElementById('radio-station'),
    radioTrack: document.getElementById('radio-track'),
    radioBtn: document.getElementById('radio-btn'),
    slotEls,
    healthFill: document.getElementById('health-fill'),
    armourFill: document.getElementById('armour-fill'),
    healthNum: document.getElementById('health-num'),
    stashLine: document.getElementById('stash-line'),
    popups: document.getElementById('popups'),
    dialog: document.getElementById('dialog'),
    dialogPortrait: document.getElementById('dialog-portrait'),
    dialogName: document.getElementById('dialog-name'),
    dialogText: document.getElementById('dialog-text'),
    mapOverlay: document.getElementById('map-overlay'),
    bigmap: document.getElementById('bigmap'),
    mapMissions: document.getElementById('map-missions'),
    mapStats: document.getElementById('map-stats'),
    crosshair: buildCrosshair(),
  };
}

const MISSION_NAMES = ['First Wheels', 'Package Run', 'Cool Down', 'Street Race', 'Stash Grab', 'Getaway', 'The Big Heist', 'Bay King', 'Dockside Deal', 'Neon Nights', 'Payback Run', 'Sunset Showdown', 'Pier Pressure', 'Beach Run', 'Midnight Courier'];

export function updateHud(hud, game, camYaw = 0, paused = false, mapOpen = false) {
  const onTitle = game.state === 'title';
  // On the title screen the HUD stays hidden: no cash, stars or job timer
  // over the menu, and no minimap blob behind it.
  hud.stats.style.display = onTitle ? 'none' : 'block';
  hud.minimap.style.display = onTitle ? 'none' : 'block';
  hud.help.style.display = onTitle ? 'none' : 'block';
  hud.policePanel.style.display = onTitle ? 'none' : 'block';
  hud.cash.textContent = `$${game.money.toLocaleString('en-US')}`;
  const stars = game.stars;
  hud.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  hud.stars.style.color = stars >= 3 ? '#ff5040' : '#ffd23e';
  hud.heatFill.style.width = `${Math.round(clamp01(game.heat / 500) * 100)}%`;
  hud.heatFill.style.background = stars >= 3 ? '#ff5040' : '#ffd23e';
  const rep = game.repLevel;
  hud.repLine.textContent = `REP LV ${rep.level} · ${rep.title}`;
  hud.repFill.style.width = `${Math.round(rep.progress * 100)}%`;
  // Stash hunt: how many of the 6 hidden packs this run has found.
  if (hud.stashLine) {
    hud.stashLine.textContent = `STASH ${game.stashesCollected}/${game.stashTotal}`;
    hud.stashLine.style.color = game.stashesCollected >= game.stashTotal ? '#ffd23e' : '#ffe9a8';
  }

  // Mission card: number, name, big timer, stage bar, next objective.
  const card = game.missionCard;
  hud.missionNum.textContent = `MISSION ${card.num}/${card.total}${card.cycle > 0 ? ` · CYCLE ${card.cycle + 1}` : ''}`;
  hud.missionName.textContent = `${card.name} — $${card.reward}`;
  const mm = Math.floor(card.timeLeft / 60);
  const ss = String(card.timeLeft % 60).padStart(2, '0');
  hud.missionTimer.textContent = `${mm}:${ss}`;
  hud.missionTimer.style.color = card.timeLeft <= 15 ? '#ff5040' : '#ffd23e';
  hud.missionStage.textContent = `STAGE ${card.stageCur}/${card.stageTotal} · ${card.stageText}`;
  hud.missionStageFill.style.width = `${Math.round(((card.stageCur - 1) / card.stageTotal) * 100)}%`;
  hud.missionNext.textContent = `NEXT: ${card.nextText}`;

  hud.district.textContent = game.district;
  const inCar = game.playerCar !== null;
  hud.speed.style.display = inCar && !onTitle ? 'block' : 'none';
  if (inCar) {
    hud.speedNum.textContent = `${Math.round(Math.abs(game.playerCar.speed) * 3.2)}`;
    hud.vehicleName.textContent = game.playerCar.model || 'Car';
  }

  // Crosshair (v4): dead centre whenever a gun is in hand on foot — the
  // player finally sees where a click will land. Hidden on the title
  // screen, in a car (no shooting from the driver's seat), with fists,
  // while paused, or with the map open.
  if (hud.crosshair) {
    const showCrosshair = !onTitle && game.state === 'playing' && !inCar
      && game.weaponIndex > 0 && !paused && !mapOpen;
    hud.crosshair.style.display = showCrosshair ? 'block' : 'none';
  }

  // Police response panel: named units, distance, tactic, sight status.
  if (game.police.length > 0) {
    hud.policeList.innerHTML = game.police.slice(0, 5).map((cop) => {
      const status = cop.down ? 'DOWN' : cop.dist < 45 ? 'IN SIGHT' : 'SEARCHING';
      const cls = cop.down ? 'down' : cop.dist < 45 ? 'sight' : 'search';
      return `<div class="unit"><span class="uname">${cop.name || 'UNIT'}</span><span class="utactic ${cls}">${cop.tactic}</span><span class="udist">${Math.round(cop.dist)}m</span><span class="ustatus ${cls}">${status}</span></div>`;
    }).join('');
  } else {
    hud.policeList.innerHTML = '<div class="unit quiet">No units responding — stay clean.</div>';
  }
  if (game.heli) {
    hud.heliLine.style.display = 'block';
    hud.heliLine.textContent = `AIR-1 HELICOPTER · ${Math.round(game.heli.dist)}m · SPOTLIGHT ON YOU`;
  } else {
    hud.heliLine.style.display = 'none';
  }

  // Radio widget: station, current track, and the station button.
  if (game.radioStationName) {
    hud.radioStation.textContent = `♪ ${game.radioStationName}`;
    hud.radioTrack.textContent = game.radioTrack
      ? `"${game.radioTrack.title}" — ${game.radioTrack.artist}` : '';
  } else {
    hud.radioStation.textContent = '♪ Radio off';
    hud.radioTrack.textContent = 'Press M for music';
  }

  // Weapon slots 1-4: name + ammo, locked ones dimmed.
  const weapons = [
    { name: 'FISTS', ammo: '∞', locked: false },
    { name: 'PISTOL', ammo: String(game.ammo.pistol), locked: !game.unlocked.pistol },
    { name: 'SHOTGUN', ammo: String(game.ammo.shotgun), locked: !game.unlocked.shotgun },
    { name: 'SMG', ammo: String(game.ammo.smg), locked: !game.unlocked.smg },
  ];
  hud.slotEls.forEach((el, i) => {
    el.querySelector('.wname').textContent = weapons[i].name;
    el.querySelector('.wammo').textContent = weapons[i].locked ? '—' : weapons[i].ammo;
    el.classList.toggle('active', game.weaponIndex === i);
    el.classList.toggle('locked', weapons[i].locked);
  });

  // Health + armour bars.
  hud.healthFill.style.width = `${Math.round(game.player.health)}%`;
  hud.healthFill.style.background = game.player.health < 30 ? '#ff5040' : '#2dd44f';
  hud.healthNum.textContent = `${Math.round(game.player.health)}`;
  hud.armourFill.style.width = `${Math.round(game.armour)}%`;

  // Score popups (drift / near-miss).
  hud.popups.innerHTML = game.popups.map((p) => `<div class="popup" style="opacity:${Math.min(1, p.t)}">${p.text}</div>`).join('');

  // Crew dialog card, while its timer runs.
  if (game.dialog && game.dialog.t > 0 && !onTitle) {
    hud.dialog.style.display = 'flex';
    hud.dialogPortrait.textContent = game.dialog.name[0];
    hud.dialogPortrait.style.background = game.dialog.color;
    hud.dialogName.textContent = game.dialog.name;
    hud.dialogText.textContent = game.dialog.text;
  } else {
    hud.dialog.style.display = 'none';
  }

  // The paused overlay is driven by the paused flag, never by the timed
  // message — updateHud must not overwrite it every frame.
  hud.paused.style.display = paused ? 'flex' : 'none';
  if (paused) {
    hud.message.textContent = 'Paused — press P to resume';
    hud.message.style.opacity = '1';
  } else if (game.messageT > 0) {
    hud.message.textContent = game.message;
    hud.message.style.opacity = '1';
  } else {
    hud.message.style.opacity = '0';
  }
  hud.title.style.display = onTitle ? 'flex' : 'none';
  const showBusted = game.state === 'busted';
  hud.busted.style.display = showBusted ? 'flex' : 'none';
  if (showBusted) {
    hud.bustedStats.textContent = `You made $${game.money.toLocaleString('en-US')} · ${game.jobsDone} jobs done · ${game.carsStolen} cars stolen`;
  }

  // "Press E to steal" prompt when on foot next to a parked car.
  let nearCar = false;
  if (!onTitle && game.state === 'playing' && !inCar) {
    for (const car of game.parked) {
      if (Math.hypot(car.x - game.player.x, car.z - game.player.z) < 4.5) { nearCar = true; break; }
    }
  }
  hud.stealPrompt.style.display = nearCar ? 'block' : 'none';

  // Context prompt: garage / shop / safehouse.
  let interact = '';
  if (!onTitle && game.state === 'playing') {
    if (game.nearGarage && inCar) interact = game.heat >= 200 ? 'G — Respray $200 (lose the heat)' : 'G — Garage: buy upgrade';
    else if (game.nearGarage) interact = 'Get in a car to use the garage';
    else if (game.nearShop && !inCar) interact = 'G — Shop: ammo $50 · armour $120';
    else if (game.nearSafehouse) interact = 'Safehouse — healing, heat fading, progress saved';
  }
  hud.interactPrompt.style.display = interact ? 'block' : 'none';
  hud.interactPrompt.textContent = interact;

  // Screen-edge beacon arrow: points at the job target from the camera's
  // point of view, with the distance, so the mission reads even when the
  // pillar itself is behind a building.
  const px = inCar ? game.playerCar.x : game.player.x;
  const pz = inCar ? game.playerCar.z : game.player.z;
  const job = game.jobTarget;
  if (!onTitle && game.state === 'playing' && job) {
    const dx = job.x - px;
    const dz = job.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist > 12) {
      const fx = -Math.sin(camYaw);
      const fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw);
      const rz = -Math.sin(camYaw);
      const fwd = dx * fx + dz * fz;
      const right = dx * rx + dz * rz;
      const angle = (Math.atan2(right, fwd) * 180) / Math.PI;
      hud.beaconArrow.style.display = 'block';
      hud.beaconArrow.style.transform = `translateX(-50%) rotate(${angle}deg)`;
      hud.beaconArrow.textContent = `▲ ${Math.round(dist)}m`;
    } else {
      hud.beaconArrow.style.display = 'none';
    }
  } else {
    hud.beaconArrow.style.display = 'none';
  }

  // Minimap.
  const ctx = hud.minimap.getContext('2d');
  drawMap(ctx, game, MAP_SIZE, false);

  // Full-screen map (Tab): districts, POIs, mission list, stats.
  hud.mapOverlay.style.display = mapOpen && !onTitle ? 'flex' : 'none';
  if (mapOpen && !onTitle) {
    const bctx = hud.bigmap.getContext('2d');
    drawMap(bctx, game, 520, true);
    const rep = game.repLevel;
    hud.mapMissions.innerHTML = MISSION_NAMES.map((name, i) => {
      const status = game.doneThisCycle[i] ? 'DONE' : i === game.missionIndex ? 'ACTIVE' : 'LOCKED';
      return `<div class="map-mission ${status.toLowerCase()}"><span>${i + 1}. ${name}</span><span>${status}</span></div>`;
    }).join('');
    const topDistrict = Object.entries(game.districtJobs).sort((a, b) => b[1] - a[1])[0];
    hud.mapStats.innerHTML = [
      ['Completion', `${game.completionPct}%`],
      ['Rep', `LV ${rep.level} ${rep.title}`],
      ['Missions done', String(game.jobsDone)],
      ['Cars stolen', String(game.carsStolen)],
      ['Cops down', String(game.copsDowned)],
      ['Near misses', String(game.nearMisses)],
      ['Drifts', String(game.drifts)],
      ['Coins', String(game.coinsCollected)],
      ['Stash packs', `${game.stashesCollected}/${game.stashTotal}`],
      ['Top district', topDistrict ? `${topDistrict[0]} (${topDistrict[1]})` : '—'],
    ].map(([k, v]) => `<div class="map-stat"><span>${k}</span><b>${v}</b></div>`).join('');
  }
}

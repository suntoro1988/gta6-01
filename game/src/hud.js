// The HUD: cash, wanted stars, the job, speed, a minimap and message banners.
// All DOM; the 3D view stays a plain canvas underneath.
import { CITY_MAX, BEACH_X } from './city.js';

const MAP_SIZE = 150;
const WORLD_SPAN = 400;

function worldToMap(x, z) {
  return [
    ((x + WORLD_SPAN / 2) / WORLD_SPAN) * MAP_SIZE,
    ((z + WORLD_SPAN / 2) / WORLD_SPAN) * MAP_SIZE,
  ];
}

export function createHud() {
  return {
    cash: document.getElementById('cash'),
    stars: document.getElementById('stars'),
    job: document.getElementById('job'),
    speed: document.getElementById('speed'),
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
  };
}

export function updateHud(hud, game, camYaw = 0, paused = false) {
  const onTitle = game.state === 'title';
  // On the title screen the HUD stays hidden: no cash, stars or job timer
  // over the menu, and no minimap blob behind it.
  hud.stats.style.display = onTitle ? 'none' : 'block';
  hud.minimap.style.display = onTitle ? 'none' : 'block';
  hud.help.style.display = onTitle ? 'none' : 'block';
  hud.cash.textContent = `$${game.money.toLocaleString('en-US')}`;
  const stars = game.stars;
  hud.stars.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  hud.stars.style.color = stars >= 3 ? '#ff5040' : '#ffd23e';
  const job = game.jobTarget;
  hud.job.textContent = job ? `${game.jobText}  ·  ${Math.max(0, Math.round(game.jobTimeLeft))}s` : '';
  const inCar = game.playerCar !== null;
  hud.speed.style.display = inCar && !onTitle ? 'block' : 'none';
  if (inCar) {
    hud.speed.textContent = `${Math.round(Math.abs(game.playerCar.speed) * 3.2)} mph`;
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

  // Screen-edge beacon arrow: points at the job target from the camera's
  // point of view, with the distance, so the mission reads even when the
  // pillar itself is behind a building.
  const px = inCar ? game.playerCar.x : game.player.x;
  const pz = inCar ? game.playerCar.z : game.player.z;
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
  const s = MAP_SIZE / WORLD_SPAN;
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  // Ocean and sand on the east edge.
  const [bx] = worldToMap(CITY_MAX, 0);
  ctx.fillStyle = '#2a6ea8';
  ctx.fillRect(worldToMap(BEACH_X, 0)[0], 0, MAP_SIZE, MAP_SIZE);
  ctx.fillStyle = '#c9b078';
  ctx.fillRect(bx, 0, worldToMap(BEACH_X, 0)[0] - bx, MAP_SIZE);
  // Ground: light, so roads and buildings read at a glance.
  ctx.fillStyle = '#7d7d88';
  ctx.fillRect(0, 0, bx, MAP_SIZE);
  // Buildings: darker than the ground.
  ctx.fillStyle = '#3f3f4c';
  for (const b of game.city.buildings) {
    const [mx, my] = worldToMap(b.x - b.w / 2, b.z - b.d / 2);
    ctx.fillRect(mx, my, b.w * s, b.d * s);
  }
  // Roads: pale strips.
  ctx.strokeStyle = '#e8e8ec';
  ctx.lineWidth = 6;
  for (let k = -156; k <= 156; k += 52) {
    const [mx] = worldToMap(k, 0);
    ctx.beginPath();
    ctx.moveTo(mx, 0);
    ctx.lineTo(mx, MAP_SIZE);
    ctx.stroke();
    const [, my] = worldToMap(0, k);
    ctx.beginPath();
    ctx.moveTo(0, my);
    ctx.lineTo(MAP_SIZE, my);
    ctx.stroke();
  }
  // Waypoint: bigger, pulsing.
  if (game.jobTarget) {
    const [wx, wy] = worldToMap(game.jobTarget.x, game.jobTarget.z);
    const pulse = 5 + Math.sin(game.time * 5) * 2;
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
    const [mx, my] = worldToMap(car.x, car.z);
    ctx.fillRect(mx - 2, my - 2, 4, 4);
  }
  // Traffic.
  ctx.fillStyle = '#20202a';
  for (const car of game.traffic) {
    const [mx, my] = worldToMap(car.x, car.z);
    ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  // Police.
  ctx.fillStyle = '#ff4030';
  for (const cop of game.police) {
    const [mx, my] = worldToMap(cop.x, cop.z);
    ctx.beginPath();
    ctx.arc(mx, my, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow: bigger.
  const heading = inCar ? game.playerCar.heading : game.player.heading;
  const [mx, my] = worldToMap(px, pz);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(Math.PI - heading); // map x = world x, map y = world z (down)
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#20202a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6.5, 7);
  ctx.lineTo(-6.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

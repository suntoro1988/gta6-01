window.SB = window.SB || {};
(function(){ 'use strict';
// ---------------------------------------------------------------------------
// SB.HUD — the on-screen interface of Sunset Bay, drawn as DOM over the
// WebGL canvas: three corners of live information, a mission banner, a
// toast feed, a damage vignette, and a canvas minimap with a route line.
// Layout (spec: "HUD 3 sudut" + minimap):
//   top-left     — money, wanted stars, health + armour bars
//   top-right    — clock, day, weather, radio station, heat meter
//   bottom-right — minimap (canvas) with player arrow, mission marker,
//                  route line, wanted zone tint
//   bottom-left  — mission tracker + toast feed + contextual hints
//   centre       — crosshair (only while armed on foot), mission banner
// API (spec): init(state), update(state), showMission(text),
// showToast(text), setWanted(n), setMoney(n), minimap(state).
// ---------------------------------------------------------------------------

var root = null;        // #sb-hud container
var el = {};            // named DOM nodes, built once in init()
var stateRef = null;
var money = 500;
var wanted = 0;
var health = 100;
var armor = 0;
var ammo = 24;
var weapon = 0;
var missionText = '';
var missionVisible = false;
var toasts = [];        // {node, until}
var bannerTimer = 0;
var bannerNode = null;
var lastUpdate = 0;
var minimapCtx = null;
var minimapCanvas = null;
var routePoints = [];   // world {x,z} waypoints for the active route
var blipPulse = 0;
var damageFlash = 0;    // 0..1, decays; drives the red vignette
var speedKmh = 0;
var clockCache = '';
var WEAPON_NAMES = ['Pistol', 'SMG', 'Shotgun', 'Rifle'];
var WEAPON_ICONS = ['P', 'S', 'SG', 'R'];
var DISTRICT_COLORS = {
  'Marina': '#37c8e8', 'Palm Parade': '#7ed957', 'Old Town': '#e8b64c',
  'Harbour': '#5b8def', 'Downtown': '#e86a92', 'Beachfront': '#ffd166'
};

// Small DOM helper: create an element with a class and optional text.
function mk(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) { n.className = cls; }
  if (text !== undefined && text !== null) { n.textContent = text; }
  return n;
}

// Format money as "$1,250" with thousands separators.
function fmtMoney(n) {
  var neg = n < 0;
  var s = String(Math.abs(Math.floor(n)));
  var out = '';
  while (s.length > 3) {
    out = ',' + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  out = s + out;
  return (neg ? '-$' : '$') + out;
}

// Format game clock: timeOfDay 18.33 -> "18:20".
function fmtClock(tod) {
  var h = Math.floor(tod) % 24;
  var m = Math.floor((tod - Math.floor(tod)) * 60);
  return (h < 10 ? '0' + h : '' + h) + ':' + (m < 10 ? '0' + m : '' + m);
}

// Stars string for a wanted level: ★★★☆☆.
function stars(n) {
  var s = '';
  var i;
  for (i = 0; i < 5; i++) { s += i < n ? '★' : '☆'; }
  return s;
}

// ---------------------------------------------------------------------------
// Styles. Injected once as a <style> tag so the HUD works without any
// extra CSS file. Colours follow the golden-hour palette: warm amber
// accents on deep translucent navy panels.
// ---------------------------------------------------------------------------
var CSS = [
  '#sb-hud{position:absolute;inset:0;pointer-events:none;font-family:"Segoe UI",Arial,sans-serif;color:#fff;z-index:10;overflow:hidden}',
  '#sb-hud .panel{background:rgba(8,16,32,.62);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:8px 12px;backdrop-filter:blur(2px)}',
  '#sb-hud .hud-tl{position:absolute;top:12px;left:12px;min-width:210px}',
  '#sb-hud .hud-money{font-size:22px;font-weight:700;color:#7dff8a;text-shadow:0 1px 2px #000}',
  '#sb-hud .hud-wanted{font-size:19px;letter-spacing:2px;color:#ffd23e;text-shadow:0 0 6px rgba(255,60,60,.8)}',
  '#sb-hud .hud-wanted.hot{color:#ff5340;animation:sb-pulse .7s infinite alternate}',
  '#sb-hud .bar{height:9px;border-radius:5px;background:rgba(0,0,0,.55);margin-top:5px;overflow:hidden;border:1px solid rgba(255,255,255,.25)}',
  '#sb-hud .bar>i{display:block;height:100%;border-radius:5px}',
  '#sb-hud .bar-hp>i{background:linear-gradient(90deg,#37e05b,#a5f2a5)}',
  '#sb-hud .bar-armor>i{background:linear-gradient(90deg,#4aa8ff,#a5d3ff)}',
  '#sb-hud .bar-heat>i{background:linear-gradient(90deg,#ffb13d,#ff5340)}',
  '#sb-hud .bar-label{font-size:10px;letter-spacing:1px;color:#cfe0ff;margin-top:3px}',
  '#sb-hud .hud-tr{position:absolute;top:12px;right:12px;text-align:right;min-width:180px}',
  '#sb-hud .hud-clock{font-size:22px;font-weight:700;text-shadow:0 1px 2px #000}',
  '#sb-hud .hud-sub{font-size:12px;color:#d8e6ff;margin-top:2px}',
  '#sb-hud .hud-radio{font-size:12px;color:#ffd23e;margin-top:4px;font-weight:600}',
  '#sb-hud .hud-br{position:absolute;right:12px;bottom:12px;text-align:right}',
  '#sb-hud #sb-minimap{display:block;border-radius:50%;border:3px solid rgba(255,255,255,.65);box-shadow:0 0 0 2px rgba(0,0,0,.45),0 4px 18px rgba(0,0,0,.5);background:#0a1a2e}',
  '#sb-hud .hud-speed{font-size:15px;font-weight:700;margin-top:5px;text-shadow:0 1px 2px #000}',
  '#sb-hud .hud-bl{position:absolute;left:12px;bottom:12px;max-width:380px}',
  '#sb-hud .hud-mission{font-size:15px;font-weight:600;line-height:1.35}',
  '#sb-hud .hud-mission .obj{color:#ffd23e}',
  '#sb-hud .hud-toasts{margin-top:8px}',
  '#sb-hud .toast{background:rgba(8,16,32,.72);border-left:3px solid #ffd23e;border-radius:6px;padding:6px 10px;font-size:13px;margin-top:5px;animation:sb-toast-in .25s ease-out}',
  '#sb-hud .toast.good{border-left-color:#37e05b}',
  '#sb-hud .toast.bad{border-left-color:#ff5340}',
  '#sb-hud .toast.info{border-left-color:#4aa8ff}',
  '#sb-hud .hud-hint{font-size:12px;color:#cfe0ff;margin-top:8px;opacity:.9}',
  '#sb-hud .hud-banner{position:absolute;top:22%;left:50%;transform:translate(-50%,-50%);text-align:center;display:none}',
  '#sb-hud .hud-banner h1{font-size:34px;letter-spacing:3px;margin:0;text-shadow:0 2px 10px #000;color:#ffd23e}',
  '#sb-hud .hud-banner p{font-size:16px;margin:4px 0 0;text-shadow:0 1px 4px #000}',
  '#sb-hud .hud-cross{position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;display:none}',
  '#sb-hud .hud-cross:before,#sb-hud .hud-cross:after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}',
  '#sb-hud .hud-cross:before{left:10px;top:0;width:2px;height:22px}',
  '#sb-hud .hud-cross:after{top:10px;left:0;width:22px;height:2px}',
  '#sb-hud .hud-vignette{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(255,0,0,.55) 100%)}',
  '#sb-hud .hud-ammo{font-size:14px;margin-top:5px;color:#ffe9a8}',
  '@keyframes sb-pulse{from{transform:scale(1)}to{transform:scale(1.08)}}',
  '@keyframes sb-toast-in{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}'
].join('\n');

// Build the whole DOM tree once. Safe to call twice (rebuilds cleanly).
function buildDom() {
  if (root && root.parentNode) { root.parentNode.removeChild(root); }
  root = mk('div', null, null);
  root.id = 'sb-hud';

  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);

  // Damage vignette (under everything else).
  el.vignette = mk('div', 'hud-vignette', null);
  root.appendChild(el.vignette);

  // --- Top-left: money / wanted / health / armour / weapon ---
  var tl = mk('div', 'panel hud-tl', null);
  el.money = mk('div', 'hud-money', fmtMoney(money));
  el.wanted = mk('div', 'hud-wanted', stars(wanted));
  var hpBar = mk('div', 'bar bar-hp', null);
  el.hpFill = mk('i', null, null);
  hpBar.appendChild(el.hpFill);
  var arBar = mk('div', 'bar bar-armor', null);
  el.armorFill = mk('i', null, null);
  arBar.appendChild(el.armorFill);
  el.ammo = mk('div', 'hud-ammo', 'Pistol — ammo 24');
  tl.appendChild(el.money);
  tl.appendChild(el.wanted);
  tl.appendChild(hpBar);
  tl.appendChild(mk('div', 'bar-label', 'HEALTH'));
  tl.appendChild(arBar);
  tl.appendChild(mk('div', 'bar-label', 'ARMOUR'));
  tl.appendChild(el.ammo);
  root.appendChild(tl);

  // --- Top-right: clock / day / weather / heat / radio ---
  var tr = mk('div', 'panel hud-tr', null);
  el.clock = mk('div', 'hud-clock', '18:20');
  el.day = mk('div', 'hud-sub', 'Day 1 — Golden Hour');
  el.weather = mk('div', 'hud-sub', 'Clear skies');
  var heatBar = mk('div', 'bar bar-heat', null);
  el.heatFill = mk('i', null, null);
  heatBar.appendChild(el.heatFill);
  el.heatLabel = mk('div', 'bar-label', 'HEAT 0');
  el.radio = mk('div', 'hud-radio', '♪ SUNSET FM 88.1');
  tr.appendChild(el.clock);
  tr.appendChild(el.day);
  tr.appendChild(el.weather);
  tr.appendChild(heatBar);
  tr.appendChild(el.heatLabel);
  tr.appendChild(el.radio);
  root.appendChild(tr);

  // --- Bottom-right: minimap + speed ---
  // Pakai kanvas minimap STATIS dari index.html (#minimap-canvas) supaya
  // tidak ada dua lingkaran minimap di layar (satu kosong, satu terisi).
  var br = mk('div', 'hud-br', null);
  minimapCanvas = document.getElementById('minimap-canvas');
  if (!minimapCanvas) {
    minimapCanvas = document.createElement('canvas');
    minimapCanvas.id = 'sb-minimap';
    br.appendChild(minimapCanvas);
  }
  minimapCanvas.width = 168;
  minimapCanvas.height = 168;
  minimapCtx = minimapCanvas.getContext('2d');
  el.speed = mk('div', 'hud-speed', '');
  // JANGAN appendChild kanvas statis ke br: itu memindahkannya dari
  // #hud-minimap ke dalam #sb-hud, lalu buildDom berikutnya menghapus
  // #sb-hud beserta kanvasnya (minimap hilang total).
  br.appendChild(el.speed);
  root.appendChild(br);

  // --- Bottom-left: mission tracker + toasts + hints ---
  var bl = mk('div', 'hud-bl', null);
  var missionPanel = mk('div', 'panel hud-mission', null);
  el.mission = mk('div', null, 'No active mission — find work at the marina.');
  missionPanel.appendChild(el.mission);
  el.toasts = mk('div', 'hud-toasts', null);
  el.hint = mk('div', 'hud-hint', 'WASD move · E enter car · Q radio · M mute');
  bl.appendChild(missionPanel);
  bl.appendChild(el.toasts);
  bl.appendChild(el.hint);
  root.appendChild(bl);

  // --- Centre: mission banner + crosshair ---
  bannerNode = mk('div', 'hud-banner', null);
  el.bannerTitle = mk('h1', null, '');
  el.bannerSub = mk('p', null, '');
  bannerNode.appendChild(el.bannerTitle);
  bannerNode.appendChild(el.bannerSub);
  root.appendChild(bannerNode);
  el.cross = mk('div', 'hud-cross', null);
  root.appendChild(el.cross);

  var host = document.getElementById('game-container') || document.body;
  host.appendChild(root);
}

// ---------------------------------------------------------------------------
// init(state): build the HUD DOM and sync it once with shared state.
// ---------------------------------------------------------------------------
function init(state) {
  stateRef = state || null;
  if (stateRef) {
    money = stateRef.money || 0;
    wanted = stateRef.wanted || 0;
    health = (stateRef.player && stateRef.player.hp) || 100;
    armor = (stateRef.player && stateRef.player.armor) || 0;
    ammo = (typeof stateRef.ammo === 'number') ? stateRef.ammo : 24;
    weapon = stateRef.weapon || 0;
  }
  buildDom();
  setMoney(money);
  setWanted(wanted);
  update(stateRef || {});
  return true;
}

// ---------------------------------------------------------------------------
// update(state): called every frame by SB.Game.frame(dt). Cheap on purpose:
// text nodes are only rewritten when their value actually changed, and
// the minimap redraws every frame (it is a small canvas).
// ---------------------------------------------------------------------------
function update(state) {
  if (!root || !state) { return; }
  stateRef = state;
  var now = (typeof performance !== 'undefined') ? performance.now() : 0;
  if (now - lastUpdate < 50 && now > lastUpdate) {
    // Still redraw the minimap every frame; throttle only text writes.
    minimap(state);
    return;
  }
  lastUpdate = now;
  blipPulse += 0.05;

  // Money / wanted / health / armour.
  if (state.money !== undefined && state.money !== money) { setMoney(state.money); }
  if (state.wanted !== undefined && state.wanted !== wanted) { setWanted(state.wanted); }
  if (state.player) {
    if (state.player.hp !== undefined && state.player.hp !== health) {
      if (state.player.hp < health) { damageFlash = 1; }
      health = state.player.hp;
      el.hpFill.style.width = Math.max(0, Math.min(100, health)) + '%';
    }
    if (state.player.armor !== undefined && state.player.armor !== armor) {
      armor = state.player.armor;
      el.armorFill.style.width = Math.max(0, Math.min(100, armor)) + '%';
    }
  }
  if (typeof state.ammo === 'number' && state.ammo !== ammo) { setAmmo(state.ammo); }
  if (typeof state.weapon === 'number' && state.weapon !== weapon) {
    weapon = state.weapon;
    setAmmo(ammo);
  }

  // Clock / day / weather / heat / radio.
  var clock = fmtClock(state.timeOfDay || 18.33);
  if (clock !== clockCache) {
    clockCache = clock;
    el.clock.textContent = clock;
    var tod = state.timeOfDay || 18.33;
    var phase = 'Golden Hour';
    if (tod >= 20 || tod < 5) { phase = 'Night — neon city'; }
    else if (tod >= 5 && tod < 8) { phase = 'Sunrise'; }
    else if (tod >= 8 && tod < 17) { phase = 'Daytime'; }
    else if (tod >= 17 && tod < 20) { phase = 'Golden Hour'; }
    el.day.textContent = 'Day ' + (state.day || 1) + ' — ' + phase;
  }
  if (state.weather) {
    var rain = state.weather.rain || 0;
    var wtext = rain > 0.6 ? 'Heavy rain' : rain > 0.15 ? 'Light rain' : 'Clear skies';
    if (state.weather.clouds > 0.7) { wtext = 'Overcast'; }
    if (el.weather.textContent !== wtext) { el.weather.textContent = wtext; }
    var heat = Math.round(state.heat || 0);
    el.heatFill.style.width = heat + '%';
    el.heatLabel.textContent = 'HEAT ' + heat;
  }
  if (window.SB && window.SB.Audio) {
    var label = '♪ ' + window.SB.Audio.stationLabel();
    if (el.radio.textContent !== label) { el.radio.textContent = label; }
  }

  // Speed (driving) or on-foot state.
  if (state.player && state.player.vehicle) {
    el.speed.textContent = Math.round(speedKmh) + ' km/h';
    el.cross.style.display = 'none';
  } else {
    el.speed.textContent = '';
    el.cross.style.display = (weapon > 0 || ammo > 0) ? 'block' : 'none';
  }

  // Damage vignette decay.
  if (damageFlash > 0) {
    damageFlash = Math.max(0, damageFlash - 0.02);
    el.vignette.style.opacity = String(damageFlash * 0.9);
  }

  // Banner lifetime.
  if (bannerTimer > 0) {
    bannerTimer -= 1;
    if (bannerTimer <= 0) { bannerNode.style.display = 'none'; }
  }

  // Expire old toasts.
  var t = now;
  var i;
  for (i = toasts.length - 1; i >= 0; i--) {
    if (t > toasts[i].until) {
      if (toasts[i].node.parentNode) { toasts[i].node.parentNode.removeChild(toasts[i].node); }
      toasts.splice(i, 1);
    }
  }

  minimap(state);
}

// Set the driving speed shown under the minimap (km/h, set by Vehicles).
function setSpeed(kmh) { speedKmh = kmh || 0; }

// ---------------------------------------------------------------------------
// setMoney(n): update the cash readout (and shared state). Green flash on
// gain, red flash on loss — feedback the player reads at a glance.
// ---------------------------------------------------------------------------
function setMoney(n) {
  var before = money;
  money = Math.floor(n);
  if (stateRef) { stateRef.money = money; }
  if (!el.money) { return money; }
  el.money.textContent = fmtMoney(money);
  if (money > before) {
    el.money.style.color = '#8dff9a';
    window.setTimeout(function () { el.money.style.color = '#7dff8a'; }, 600);
  } else if (money < before) {
    el.money.style.color = '#ff8a7a';
    window.setTimeout(function () { el.money.style.color = '#7dff8a'; }, 600);
  }
  return money;
}

// ---------------------------------------------------------------------------
// setWanted(n): 0-5 stars. Pulses red at 3+, plays the wanted sting via
// the audio module, and tints the minimap border while the heat is on.
// ---------------------------------------------------------------------------
function setWanted(n) {
  var before = wanted;
  wanted = Math.max(0, Math.min(5, n | 0));
  if (stateRef) { stateRef.wanted = wanted; }
  if (!el.wanted) { return wanted; }
  el.wanted.textContent = stars(wanted);
  el.wanted.className = 'hud-wanted' + (wanted >= 3 ? ' hot' : '');
  if (minimapCanvas) {
    minimapCanvas.style.borderColor = wanted >= 3
      ? 'rgba(255,70,50,.9)' : 'rgba(255,255,255,.65)';
  }
  if (window.SB && window.SB.Audio) {
    if (wanted > before) { window.SB.Audio.sfx('wantedUp'); }
    else if (wanted < before) { window.SB.Audio.sfx('wantedDown'); }
  }
  return wanted;
}

// Ammo readout: "SMG — ammo 48".
function setAmmo(n) {
  ammo = Math.max(0, n | 0);
  if (stateRef) { stateRef.ammo = ammo; }
  if (!el.ammo) { return ammo; }
  el.ammo.textContent = WEAPON_NAMES[weapon] + ' — ammo ' + ammo;
  return ammo;
}

function setWeapon(w) {
  weapon = Math.max(0, Math.min(3, w | 0));
  if (stateRef) { stateRef.weapon = weapon; }
  setAmmo(ammo);
  return weapon;
}

// ---------------------------------------------------------------------------
// showMission(text): set the objective line in the bottom-left tracker.
// showToast(text, kind): stack a short message above the tracker;
// kind is '', 'good', 'bad' or 'info'. Max 4 visible at once.
// ---------------------------------------------------------------------------
function showMission(text) {
  missionText = String(text || '');
  missionVisible = missionText.length > 0;
  if (!el.mission) { return missionText; }
  el.mission.innerHTML = '';
  var obj = document.createElement('span');
  obj.className = 'obj';
  obj.textContent = '◆ ';
  el.mission.appendChild(obj);
  el.mission.appendChild(document.createTextNode(missionText));
  return missionText;
}

function showToast(text, kind) {
  if (!el.toasts) { return 0; }
  var node = mk('div', 'toast' + (kind ? ' ' + kind : ''), String(text || ''));
  el.toasts.appendChild(node);
  var until = (typeof performance !== 'undefined' ? performance.now() : 0) + 5000;
  toasts.push({ node: node, until: until });
  while (toasts.length > 4) {
    var old = toasts.shift();
    if (old.node.parentNode) { old.node.parentNode.removeChild(old.node); }
  }
  return toasts.length;
}

// Big centre banner: mission start / completed / failed.
function showBanner(title, sub, seconds) {
  if (!bannerNode) { return; }
  el.bannerTitle.textContent = String(title || '');
  el.bannerSub.textContent = String(sub || '');
  bannerNode.style.display = 'block';
  bannerTimer = Math.max(1, Math.round((seconds || 3) * 20));
}

// Contextual hint line under the toasts ("Hold E to steal the car").
function setHint(text) {
  if (el.hint) { el.hint.textContent = String(text || ''); }
}

// Flash the red damage vignette (called by Player.takeDamage).
function flashDamage(amount) {
  damageFlash = Math.min(1, damageFlash + 0.25 + (amount || 0) / 100);
}

// Set the active route polyline for the minimap (world coords).
function setRoute(points) {
  routePoints = (points || []).slice();
}

// ---------------------------------------------------------------------------
// minimap(state): draw the round minimap. The world is ~1200x1200 units;
// the map shows a 360-unit window centred on the player, north-up.
// Drawn layers: sea, beach, streets grid, district tint, route line,
// mission marker (pulsing gold diamond), player arrow, police blips,
// wanted red zone when wanted >= 3.
// ---------------------------------------------------------------------------
function minimap(state) {
  if (!minimapCtx || !state || !state.player) { return; }
  var c = minimapCtx;
  var W = 168, H = 168, cx = W / 2, cy = H / 2;
  var range = 360;              // world units across the minimap
  var scale = W / range;
  var px = state.player.x || 0;
  var pz = state.player.z || 0;

  function wx(x) { return cx + (x - px) * scale; }
  function wz(z) { return cy + (z - pz) * scale; }

  // Clip to the circle.
  c.save();
  c.beginPath();
  c.arc(cx, cy, 82, 0, Math.PI * 2);
  c.clip();

  // Sea background, then land mass.
  c.fillStyle = '#0d3a5c';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#173a2c';
  c.fillRect(wx(-600), wz(-600), 1200 * scale, 1200 * scale);
  // Beach strip along the west edge (x < -460).
  c.fillStyle = '#c9b183';
  c.fillRect(wx(-600), wz(-600), 140 * scale, 1200 * scale);
  // Harbour water pocket at the south-east.
  c.fillStyle = '#0d3a5c';
  c.fillRect(wx(320), wz(280), 280 * scale, 320 * scale);

  // Street grid: avenues every 120 units, streets every 90.
  c.strokeStyle = 'rgba(255,255,255,.28)';
  c.lineWidth = 2;
  var gx, gz;
  for (gx = -600; gx <= 600; gx += 120) {
    c.beginPath(); c.moveTo(wx(gx), wz(-600)); c.lineTo(wx(gx), wz(600)); c.stroke();
  }
  for (gz = -600; gz <= 600; gz += 90) {
    c.beginPath(); c.moveTo(wx(-600), wz(gz)); c.lineTo(wx(600), wz(gz)); c.stroke();
  }
  // Coast road (highlighted, follows the beach).
  c.strokeStyle = '#ffd23e';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(wx(-460), wz(-600)); c.lineTo(wx(-460), wz(600)); c.stroke();
  // Bridge over the harbour mouth.
  c.strokeStyle = '#ff9a3c';
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(wx(320), wz(280)); c.lineTo(wx(600), wz(280)); c.stroke();

  // District tint: a soft dot at each known district centre.
  if (window.SB && window.SB.City && window.SB.City.districts) {
    var i, d;
    for (i = 0; i < window.SB.City.districts.length; i++) {
      d = window.SB.City.districts[i];
      if (typeof d === 'string') { continue; }
      c.fillStyle = DISTRICT_COLORS[d.name] || 'rgba(255,255,255,.25)';
      c.globalAlpha = 0.35;
      c.beginPath();
      c.arc(wx(d.x || 0), wz(d.z || 0), 10, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
  }

  // Wanted red zone: a pulsing ring around the player at wanted >= 3.
  if ((state.wanted || 0) >= 3) {
    c.strokeStyle = 'rgba(255,60,40,' + (0.5 + 0.4 * Math.sin(blipPulse * 2)) + ')';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, 46 + 6 * Math.sin(blipPulse * 2), 0, Math.PI * 2);
    c.stroke();
  }

  // Route polyline (gold, dashed).
  if (routePoints.length > 1) {
    c.strokeStyle = '#ffd23e';
    c.lineWidth = 3;
    c.setLineDash([7, 5]);
    c.beginPath();
    c.moveTo(wx(routePoints[0].x), wz(routePoints[0].z));
    var r;
    for (r = 1; r < routePoints.length; r++) {
      c.lineTo(wx(routePoints[r].x), wz(routePoints[r].z));
    }
    c.stroke();
    c.setLineDash([]);
  }

  // Mission marker: pulsing gold diamond at the active objective.
  var mx = null, mz = null;
  if (state.mission && state.mission.id && window.SB && window.SB.Jobs) {
    var target = window.SB.Jobs.missionTarget
      ? window.SB.Jobs.missionTarget()
      : null;
    if (target) { mx = target.x; mz = target.z; }
  }
  if (mx === null && state.mission && typeof state.mission.x === 'number') {
    mx = state.mission.x; mz = state.mission.z;
  }
  if (mx !== null) {
    var pulse = 7 + 3 * Math.sin(blipPulse * 3);
    var mxp = wx(mx), mzp = wz(mz);
    c.fillStyle = '#ffd23e';
    c.beginPath();
    c.moveTo(mxp, mzp - pulse);
    c.lineTo(mxp + pulse, mzp);
    c.lineTo(mxp, mzp + pulse);
    c.lineTo(mxp - pulse, mzp);
    c.closePath();
    c.fill();
    c.strokeStyle = '#7a5b00';
    c.lineWidth = 1.5;
    c.stroke();
  }

  // Police blips (blue) when wanted.
  if ((state.wanted || 0) > 0 && window.SB && window.SB.Police && window.SB.Police.cops) {
    c.fillStyle = '#4aa8ff';
    var cops = window.SB.Police.cops;
    for (var k = 0; k < cops.length; k++) {
      c.beginPath();
      c.arc(wx(cops[k].x || 0), wz(cops[k].z || 0), 3, 0, Math.PI * 2);
      c.fill();
    }
    // AIR-1 helicopter blip.
    if (window.SB.Police.heli) {
      c.fillStyle = '#ff5340';
      c.beginPath();
      c.arc(wx(window.SB.Police.heli.x || 0), wz(window.SB.Police.heli.z || 0), 4, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Player arrow (white, rotated by heading).
  var ang = (state.player.angle || 0);
  c.save();
  c.translate(cx, cy);
  c.rotate(-ang);
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#111111';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, -9);
  c.lineTo(6, 7);
  c.lineTo(0, 3);
  c.lineTo(-6, 7);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();

  // North tick.
  c.fillStyle = '#ffffff';
  c.font = 'bold 11px Arial';
  c.textAlign = 'center';
  c.fillText('N', cx, 14);

  c.restore();

  // Outer ring is drawn by CSS border; add a soft inner shadow ring.
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 4;
  c.beginPath();
  c.arc(cx, cy, 80, 0, Math.PI * 2);
  c.stroke();
}

// Tear the HUD down (used when returning to the start screen).
function destroy() {
  if (root && root.parentNode) { root.parentNode.removeChild(root); }
  root = null;
  el = {};
  minimapCtx = null;
  minimapCanvas = null;
  toasts = [];
}

// Current mission text, for other modules that need to echo it.
function currentMission() { return missionText; }

window.SB.HUD = {
  init: init,
  update: update,
  showMission: showMission,
  showToast: showToast,
  setWanted: setWanted,
  setMoney: setMoney,
  minimap: minimap,
  showBanner: showBanner,
  setHint: setHint,
  setAmmo: setAmmo,
  setWeapon: setWeapon,
  setSpeed: setSpeed,
  setRoute: setRoute,
  flashDamage: flashDamage,
  currentMission: currentMission,
  destroy: destroy,
  fmtMoney: fmtMoney,
  fmtClock: fmtClock
};
})();

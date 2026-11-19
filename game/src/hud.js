// hud.js — Sunset Bay v5 (Builder D)
// HUD DOM + minimap + peta layar penuh (Tab) + crosshair + pesan/popup.
// Modul mandiri, tanpa impor. Semua akses DOM defensif: elemen yang tidak
// ada diabaikan, supaya HUD tidak pernah melempar error saat integrasi.
// Ditulis fresh dari design-spec, sesi recording 01a1f13f-5466-77cb-9088-12e78d473c06.

'use strict';

// ---------- daftar misi (dari spec bagian 4, 18 misi berantai) ----------
export const MISSION_LIST = [
  { name: 'First Wheels', reward: 100 },
  { name: 'Package Run', reward: 250 },
  { name: 'Street Race', reward: 400 },
  { name: 'Getaway Driver', reward: 350 },
  { name: 'Night Shift', reward: 300 },
  { name: 'Repo Man', reward: 450 },
  { name: 'Hot Wheels', reward: 500 },
  { name: "Smuggler's Run", reward: 700 },
  { name: 'VIP Escort', reward: 600 },
  { name: 'Chase the Sunset', reward: 550 },
  { name: 'The Big Heist', reward: 800 },
  { name: 'Last Call', reward: 650 },
  { name: 'Pier Pressure', reward: 850 },
  { name: 'Beach Run', reward: 950 },
  { name: 'Midnight Courier', reward: 1100 },
  { name: 'Harbor Lights', reward: 900 },
  { name: 'Dockside Deal', reward: 1000 },
  { name: 'Sunset Heist', reward: 1500 },
];

// Nama distrik fallback bila S.city belum tersedia (posisi grid kasar,
// hanya dipakai bila city tidak ada — posisi asli selalu dari S.city).
const FALLBACK_DISTRICTS = [
  { name: 'Downtown', cx: 0, cz: -10, r: 26, color: '#7fb3ff' },
  { name: 'Old Town', cx: -45, cz: 5, r: 22, color: '#d9a066' },
  { name: 'Southside', cx: -40, cz: 55, r: 24, color: '#9a9a9a' },
  { name: 'Hillcrest', cx: 45, cz: -55, r: 24, color: '#c98a4b' },
  { name: 'Beachfront', cx: -70, cz: -45, r: 22, color: '#f2d38a' },
  { name: 'The Pier', cx: -85, cz: 0, r: 16, color: '#8ecae6' },
  { name: 'Sunset Mall', cx: 40, cz: 15, r: 24, color: '#e26fb5' },
  { name: 'Marina Bay', cx: 70, cz: -20, r: 24, color: '#4ecdc4' },
  { name: 'Northside', cx: 30, cz: -70, r: 24, color: '#9be15d' },
  { name: 'Uptown', cx: 55, cz: 45, r: 24, color: '#b8a7ff' },
];

const WEAPON_NAMES = ['Fists', 'Pistol', 'SMG', 'Shotgun'];

// ---------- util ----------
function $(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}
function setText(el, text) {
  if (el && el.textContent !== String(text)) el.textContent = String(text);
}
function moneyFmt(n) {
  const v = Math.floor(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function phaseFor(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  if (h >= 5 && h < 7) return 'DAWN';
  if (h >= 7 && h < 17) return 'DAY';
  if (h >= 17 && h < 19) return 'DUSK';
  return 'NIGHT';
}
function clockText(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return pad(hh) + ':' + pad(mm);
}
function repName(rep) {
  // Must match game.js repLevelName: KINGPIN >= 1000, HUSTLER >= 300.
  // (rep here is the numeric REP score, +100 per mission.)
  const r = Number(rep) || 0;
  if (r >= 1000) return 'KINGPIN';
  if (r >= 300) return 'HUSTLER';
  return 'ROOKIE';
}
function getTime(S) {
  if (S == null) return 18;
  if (typeof S.time === 'number') return S.time;
  if (typeof S.hour === 'number') return S.hour;
  if (typeof S.tod === 'number') return S.tod;
  return 18;
}
function getMoney(S) { return (S && typeof S.money === 'number') ? S.money : ((S && typeof S.cash === 'number') ? S.cash : 0); }
function getStars(S) {
  if (!S) return 0;
  if (typeof S.stars === 'number') return S.stars;
  if (typeof S.wanted === 'number') return S.wanted;
  if (typeof S.heat === 'number') return clamp(Math.floor(S.heat / 100), 0, 5);
  return 0;
}
function getMissionIndex(S) {
  if (!S) return 0;
  if (typeof S.missionIndex === 'number') return S.missionIndex;
  if (typeof S.mission === 'number') return S.mission;
  if (typeof S.missionsDone === 'number') return S.missionsDone;
  if (typeof S.missionsCompleted === 'number') return S.missionsCompleted;
  return 0;
}
function getDistrict(S) {
  if (!S) return '';
  if (typeof S.district === 'string' && S.district) return S.district;
  if (S.player && typeof S.player.district === 'string') return S.player.district;
  return '';
}
function getPlayerPos(S) {
  if (S && S.player) return { x: S.player.x || 0, z: S.player.z || 0, heading: S.player.heading || 0 };
  return { x: 0, z: 0, heading: 0 };
}
function isOnFoot(S) {
  if (!S) return true;
  if (S.player && typeof S.player.onFoot === 'boolean') return S.player.onFoot;
  if (typeof S.onFoot === 'boolean') return S.onFoot;
  if (typeof S.inCar === 'boolean') return !S.inCar;
  return !S.car;
}
function getWeaponIndex(S) {
  if (!S) return 0;
  // Canonical shape (game.js): S.weapons = { slot, ammo: {pistol, smg, shotgun} }
  if (S.weapons && typeof S.weapons.slot === 'number') return S.weapons.slot;
  if (typeof S.weaponIndex === 'number') return S.weaponIndex;
  if (typeof S.weapon === 'number') return S.weapon;
  if (S.player && typeof S.player.weapon === 'number') return S.player.weapon;
  return 0;
}
function getAmmo(S, i) {
  if (!S) return null;
  // Canonical: S.weapons.ammo keyed lowercase ('pistol','smg','shotgun').
  if (S.weapons && S.weapons.ammo && typeof S.weapons.ammo === 'object') {
    if (i === 0) return Infinity;
    const key = ['fists', 'pistol', 'smg', 'shotgun'][i];
    const v = S.weapons.ammo[key];
    return typeof v === 'number' ? v : null;
  }
  const list = S.ammo || S.ammos || (S.player && S.player.ammo);
  if (Array.isArray(list)) return list[i];
  if (list && typeof list === 'object') return list[i] ?? list[WEAPON_NAMES[i].toLowerCase()];
  return null;
}
function isPlaying(S) {
  if (!S) return false;
  // Canonical phase field (main.js sets S.phase = 'title'|'playing'|'paused').
  if (typeof S.phase === 'string') return S.phase === 'playing';
  const st = S.state || S.mode || S.screen;
  if (typeof st === 'string') return st === 'playing' || st === 'play';
  return true;
}

// ---------- elemen DOM (di-cache bindHud) ----------
let els = null;
let messageTimer = null;
let popupTimer = null;

const CANDIDATES = {
  money: ['money', 'cash', 'hud-money'],
  stars: ['stars', 'wanted', 'hud-stars'],
  rep: ['rep', 'hud-rep', 'rep-level'],
  mission: ['mission', 'hud-mission', 'mission-label'],
  district: ['district', 'hud-district'],
  clock: ['clock', 'hud-clock', 'time'],
  heat: ['heat', 'hud-heat'],
  stash: ['stash', 'hud-stash'],
  weapons: ['weapons', 'weapon-slots', 'hud-weapons'],
  radio: ['radio', 'radio-widget', 'hud-radio'],
  crosshair: ['crosshair'],
  message: ['message', 'hud-message', 'mission-message'],
  popup: ['popup', 'hud-popup'],
  minimap: ['minimap', 'hud-minimap'],
  fullmap: ['fullmap', 'map-canvas', 'full-map'],
  mapOverlay: ['map-overlay', 'fullmap-overlay', 'map'],
  mapMissions: ['map-mission-list', 'map-missions', 'fullmap-missions'],
  mapStats: ['map-stats', 'fullmap-stats'],
};

function pickFirst(ids) {
  for (let i = 0; i < ids.length; i++) {
    const el = $(ids[i]);
    if (el) return el;
  }
  return null;
}

export function bindHud(S) {
  els = {};
  for (const key in CANDIDATES) els[key] = pickFirst(CANDIDATES[key]);
  // Widget radio JANGAN menutupi klik tembak: pointer-events none.
  // (Aturan ini juga ada di CSS Builder E; di sini dipastikan via JS.)
  if (els.radio) {
    els.radio.style.pointerEvents = 'none';
    const kids = els.radio.querySelectorAll ? els.radio.querySelectorAll('*') : [];
    for (let i = 0; i < kids.length; i++) kids[i].style.pointerEvents = 'none';
  }
  if (els.crosshair) els.crosshair.style.pointerEvents = 'none';
  if (S) S._hudBound = true;
  return els;
}

function ensureEls() {
  if (!els) els = {};
  for (const key in CANDIDATES) {
    if (!els[key]) els[key] = pickFirst(CANDIDATES[key]);
  }
  return els;
}

// ---------- update HUD ----------
export function updateHud(S) {
  if (!S) return;
  ensureEls();

  setText(els.money, moneyFmt(getMoney(S)));

  const stars = getStars(S);
  if (els.stars) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < stars ? '★' : '☆';
    setText(els.stars, s);
    els.stars.style.color = stars >= 3 ? '#ff4444' : (stars > 0 ? '#ffcc00' : '#ffffff');
  }

  const rep = (S.rep != null ? S.rep : (S.repLevel != null ? S.repLevel : 0));
  setText(els.rep, repName(rep) + ' · REP ' + Math.floor(Number(rep) || 0));

  const mi = clamp(getMissionIndex(S), 0, 18);
  const missionName = (S.missionName && typeof S.missionName === 'string')
    ? S.missionName
    : (mi < 18 ? MISSION_LIST[mi].name : 'All missions done');
  setText(els.mission, (mi >= 18 ? '18/18 · DONE' : (mi + 1) + '/18 · ' + missionName));

  setText(els.district, getDistrict(S) || 'Sunset Bay');

  // Heat + stash pills (index.html has #hud-heat / #hud-stash; without
  // this they stay stuck at their static initial text).
  setText(els.heat, 'HEAT ' + Math.floor(Number((S && S.heat) || 0)));
  const stashGot = (S && Array.isArray(S.stashes)) ? S.stashes.filter(Boolean).length
    : ((S && typeof S.stashCount === 'number') ? S.stashCount : 0);
  setText(els.stash, 'STASH ' + stashGot + '/6');

  const hour = getTime(S);
  setText(els.clock, clockText(hour) + ' ' + phaseFor(hour));

  // Slot senjata + ammo.
  if (els.weapons) {
    const wi = getWeaponIndex(S);
    let html = '';
    for (let i = 0; i < 4; i++) {
      const ammo = getAmmo(S, i);
      const ammoTxt = i === 0 ? '∞' : (ammo == null ? '—' : String(ammo));
      const active = i === wi ? ' active' : '';
      html += '<span class="weapon-slot' + active + '" data-slot="' + i + '">'
        + (i + 1) + ' ' + WEAPON_NAMES[i] + ' ' + ammoTxt + '</span>';
    }
    if (els.weapons.innerHTML !== html) els.weapons.innerHTML = html;
  }

  // Widget radio: nama stasiun (+ lagu bila tersedia).
  if (els.radio) {
    let station = 'BAY FM';
    if (S.audio && typeof S.audio.stationName === 'function') {
      try { station = S.audio.stationName(S.audio) || station; } catch (e) { /* abaikan */ }
    } else if (typeof S.stationName === 'string') station = S.stationName;
    else if (S.audio && typeof S.audio.station === 'number') {
      station = ['BAY FM', 'SUNSET DRIVE', 'NEON NIGHTS', 'PALM COURT', 'TIDE FM'][S.audio.station] || station;
    }
    const song = (S.audio && S.audio.currentSong) || S.radioSong || '';
    const label = song ? station + ' — ' + song : station;
    const muted = S.audio && S.audio.muted;
    setText(els.radio, (muted ? '🔇 ' : '♪ ') + label);
  }

  // Crosshair: tampil HANYA saat jalan kaki + bersenjata (bukan tinju),
  // sembunyi di mobil / title / pause / tinju.
  if (els.crosshair) {
    const armed = getWeaponIndex(S) > 0;
    const show = isPlaying(S) && isOnFoot(S) && armed;
    els.crosshair.style.display = show ? 'block' : 'none';
  }

  // NOTE: main.js owns the Tab map overlay (class 'show'). Do NOT set
  // inline display here — updateHud runs every frame and would override
  // the class, making the map impossible to open.
}

// ---------- minimap ----------
function worldToMap(x, z, bounds, w, h, margin) {
  const minX = bounds.minX, maxX = bounds.maxX;
  const minZ = bounds.minZ, maxZ = bounds.maxZ;
  const sx = (w - margin * 2) / Math.max(1, maxX - minX);
  const sy = (h - margin * 2) / Math.max(1, maxZ - minZ);
  const s = Math.min(sx, sy);
  const ox = margin + ((w - margin * 2) - (maxX - minX) * s) / 2;
  const oy = margin + ((h - margin * 2) - (maxZ - minZ) * s) / 2;
  return { x: ox + (x - minX) * s, y: oy + (z - minZ) * s, s: s };
}

export function drawMinimap(S, canvas) {
  const cv = canvas || (els && els.minimap) || $('minimap');
  // Individual stat cells in index.html (#map-money, #map-missions, ...).
  const mi2 = clamp(getMissionIndex(S), 0, 18);
  const stashGot2 = (S && Array.isArray(S.stashes)) ? S.stashes.filter(Boolean).length
    : ((S && typeof S.stashFound === 'number') ? S.stashFound : 0);
  setText($('map-money'), moneyFmt(getMoney(S)));
  setText($('map-missions'), mi2 + ' / 18');
  setText($('map-rep'), repName(S && S.rep));
  setText($('map-stash'), stashGot2 + ' / 6');
  setText($('map-wanted'), getStars(S) + ' ★');
  if (!cv || typeof cv.getContext !== 'function') return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  const city = (S && S.city) || null;
  const bounds = (city && city.bounds) || { minX: -110, maxX: 110, minZ: -110, maxZ: 110 };
  const m = 6;
  const toMap = (x, z) => worldToMap(x, z, bounds, W, H, m);

  // Latar: darat gelap, air biru.
  ctx.fillStyle = '#12241c';
  ctx.fillRect(0, 0, W, H);
  if (city && city.water) {
    ctx.fillStyle = '#1d5f8a';
    for (let i = 0; i < city.water.length; i++) {
      const w = city.water[i];
      const a = toMap(w.x - (w.w || 0) / 2, w.z - (w.d || 0) / 2);
      const b = toMap(w.x + (w.w || 0) / 2, w.z + (w.d || 0) / 2);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
  // Jalan.
  if (city && city.roads) {
    ctx.strokeStyle = 'rgba(200,200,200,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i < city.roads.length; i++) {
      const r = city.roads[i];
      const a = toMap(r.x1, r.z1), b = toMap(r.x2, r.z2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // Target misi (kuning, berdenyut). Live mission target wins.
  const target = (S && ((S.mission && S.mission.target) || S.missionTarget || S.target)) || null;
  if (target && typeof target.x === 'number') {
    const p = toMap(target.x, target.z);
    const pulse = 4 + Math.sin(Date.now() / 250) * 1.5;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }
  // Stash yang belum diambil.
  if (S && Array.isArray(S.stashesLeft)) {
    ctx.fillStyle = '#7CFC00';
    for (let i = 0; i < S.stashesLeft.length; i++) {
      const p = toMap(S.stashesLeft[i].x, S.stashesLeft[i].z);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
  }
  // Penumpang taksi.
  if (S && S.taxi && S.taxi.passenger && S.taxi.state === 'waiting') {
    const p = toMap(S.taxi.passenger.x, S.taxi.passenger.z);
    ctx.fillStyle = '#ff9f1c';
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
  }
  // Polisi (merah).
  const cops = (S && (S.cops || S.police)) || [];
  ctx.fillStyle = '#ff3b30';
  for (let i = 0; i < cops.length; i++) {
    if (typeof cops[i].x !== 'number') continue;
    const p = toMap(cops[i].x, cops[i].z);
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // Heli (merah, lebih besar, dengan lingkaran) — hanya bila aktif.
  if (S && S.heli && S.heli.active && typeof S.heli.x === 'number') {
    const p = toMap(S.heli.x, S.heli.z);
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  // Pemain: panah putih searah heading.
  const pp = getPlayerPos(S);
  const p = toMap(pp.x, pp.z);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-pp.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4, 5);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  // Bingkai.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

// ---------- peta layar penuh (Tab) ----------
export function drawFullMap(S) {
  ensureEls();
  const cv = els.fullmap;
  // Daftar misi + statistik selalu di-update walau canvas tidak ada.
  if (els.mapMissions) {
    const mi = clamp(getMissionIndex(S), 0, 18);
    let html = '<h3>MISSIONS</h3><ol>';
    for (let i = 0; i < MISSION_LIST.length; i++) {
      const done = i < mi;
      const cur = i === mi && mi < 18;
      html += '<li class="' + (done ? 'done' : (cur ? 'current' : '')) + '">'
        + (done ? '✓ ' : (cur ? '▶ ' : ''))
        + MISSION_LIST[i].name + ' — $' + MISSION_LIST[i].reward.toLocaleString('en-US')
        + '</li>';
    }
    html += '</ol>';
    if (els.mapMissions.innerHTML !== html) els.mapMissions.innerHTML = html;
  }
  if (els.mapStats) {
    const mi = clamp(getMissionIndex(S), 0, 18);
    const stashGot = (S && typeof S.stashFound === 'number') ? S.stashFound
      : (S && typeof S.stashesFound === 'number' ? S.stashesFound
      : (S && Array.isArray(S.stashes) ? S.stashes.filter(Boolean).length : 0));
    const stats = 'Money ' + moneyFmt(getMoney(S))
      + '  ·  Missions ' + mi + '/18'
      + '  ·  REP ' + repName(S && S.rep) + ' (' + Math.floor(Number((S && S.rep) || 0)) + ')'
      + '  ·  Stash ' + stashGot + '/6'
      + '  ·  Wanted ' + getStars(S) + '★'
      + '  ·  ' + clockText(getTime(S)) + ' ' + phaseFor(getTime(S));
    setText(els.mapStats, stats);
  }
  if (!cv || typeof cv.getContext !== 'function') return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0d1f16';
  ctx.fillRect(0, 0, W, H);

  const city = (S && S.city) || null;
  const bounds = (city && city.bounds) || { minX: -110, maxX: 110, minZ: -110, maxZ: 110 };
  // Margin besar (46px) supaya label distrik di tepi tidak terpotong.
  const margin = 46;
  const toMap = (x, z) => worldToMap(x, z, bounds, W, H, margin);

  // Air.
  if (city && city.water) {
    ctx.fillStyle = '#1d5f8a';
    for (let i = 0; i < city.water.length; i++) {
      const w = city.water[i];
      const a = toMap(w.x - (w.w || 0) / 2, w.z - (w.d || 0) / 2);
      const b = toMap(w.x + (w.w || 0) / 2, w.z + (w.d || 0) / 2);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
  // Jalan.
  if (city && city.roads) {
    ctx.strokeStyle = 'rgba(220,220,220,0.6)';
    ctx.lineWidth = 3;
    for (let i = 0; i < city.roads.length; i++) {
      const r = city.roads[i];
      const a = toMap(r.x1, r.z1), b = toMap(r.x2, r.z2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  // Distrik: lingkaran warna + label — SEMUA 10 distrik wajib berlabel.
  const districts = (city && city.districts && city.districts.length) ? city.districts : FALLBACK_DISTRICTS;
  ctx.textAlign = 'center';
  for (let i = 0; i < districts.length; i++) {
    const d = districts[i];
    const c = toMap(d.cx, d.cz);
    const r = Math.max(10, (d.r || 20) * c.s);
    ctx.fillStyle = (d.color || '#888888') + '55';
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = d.color || '#888888';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Label dengan outline gelap agar terbaca; posisi dijepit di dalam canvas.
    const lx = clamp(c.x, margin - 10, W - margin + 10);
    const ly = clamp(c.y, margin - 14, H - margin + 14);
    ctx.font = 'bold 13px sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(d.name, lx, ly);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(d.name, lx, ly);
  }
  // POI: GARAGE / SHOP / SAFEHOUSE / MARINA.
  const pois = [];
  if (city) {
    if (city.garage) pois.push({ p: city.garage, label: 'GARAGE', color: '#ff9f1c' });
    if (city.shop) pois.push({ p: city.shop, label: 'SHOP', color: '#4ecdc4' });
    if (city.safehouse) pois.push({ p: city.safehouse, label: 'SAFEHOUSE', color: '#7CFC00' });
    if (city.marina) pois.push({ p: city.marina, label: 'MARINA', color: '#1f8fff' });
  }
  ctx.font = 'bold 11px sans-serif';
  for (let i = 0; i < pois.length; i++) {
    const pt = toMap(pois[i].p.x, pois[i].p.z);
    ctx.fillStyle = pois[i].color;
    ctx.fillRect(pt.x - 5, pt.y - 5, 10, 10);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(pt.x - 5, pt.y - 5, 10, 10);
    ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    ctx.strokeText(pois[i].label, pt.x, pt.y - 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pois[i].label, pt.x, pt.y - 10);
  }
  // Target misi (live mission target wins, staged shot target next).
  const target = (S && ((S.mission && S.mission.target) || S.missionTarget || S.target)) || null;
  if (target && typeof target.x === 'number') {
    const p = toMap(target.x, target.z);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('TARGET', p.x, p.y - 12);
  }
  // Pemain.
  const pp = getPlayerPos(S);
  const p = toMap(pp.x, pp.z);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(-pp.heading);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText('SUNSET BAY — press Tab to close', 12, 22);
}

// ---------- pesan & popup ----------
export function showMessage(S, text) {
  ensureEls();
  if (!els.message) return;
  setText(els.message, text || '');
  els.message.style.display = text ? 'block' : 'none';
  if (messageTimer) clearTimeout(messageTimer);
  if (text) {
    messageTimer = setTimeout(() => {
      if (els.message) els.message.style.display = 'none';
    }, 5000);
  }
}

export function showPopup(text) {
  ensureEls();
  if (!els.popup) return;
  setText(els.popup, text || '');
  els.popup.style.display = text ? 'block' : 'none';
  if (popupTimer) clearTimeout(popupTimer);
  if (text) {
    popupTimer = setTimeout(() => {
      if (els.popup) els.popup.style.display = 'none';
    }, 2600);
  }
}

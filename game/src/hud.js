// hud.js — Sunset Bay (v11)
// Contextual three-corner HUD for Sunset Bay, written from scratch.
//  * Top-left: health bar + stamina bar.
//  * Top-right: money, wanted stars (0-5), weapon + ammo.
//  * Bottom-left: 2D minimap canvas with a coloured route line to the
//    objective and the distance remaining.
//  * Auto-fade: when the player is strolling with no threat and no
//    active mission, health and weapon info fade out; they return the
//    moment there is a fight, fast driving, or a pursuit.
//  * Wanted with MEMORY: under the stars, 2-3 small icons show what
//    the police actually know — a car icon (your car is recognised),
//    a clothes icon (your outfit is recognised). Swap cars to clear
//    the car icon, change clothes at a shop to clear the clothes icon,
//    hide outside the red search zone until the timer ends to clear all.
//  * Minimap modes: On / Dynamic / Off. Dynamic hides the map while
//    strolling and shows it during missions and pursuits.
//  * During a pursuit the minimap draws the RED SEARCH ZONE.
// No dependencies: the HUD is fed one plain state object per frame via
// update(state). It builds its own DOM + canvas.

'use strict';

export const MINIMAP_MODES = ['on', 'dynamic', 'off'];

export const WANTED_MEMORY_ICONS = {
  car: { label: 'Car recognised', glyph: '🚗' },
  clothes: { label: 'Outfit recognised', glyph: '👕' },
  face: { label: 'Face seen', glyph: '🧑' },
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class Hud {
  constructor(options) {
    this.opts = Object.assign({ minimapMode: 'dynamic', container: null }, options || {});
    this.minimapMode = MINIMAP_MODES.includes(this.opts.minimapMode) ? this.opts.minimapMode : 'dynamic';
    this.root = null;
    this.healthFill = null;
    this.staminaFill = null;
    this.healthWrap = null;
    this.moneyEl = null;
    this.starsEl = null;
    this.memoryEl = null;
    this.weaponEl = null;
    this.weaponWrap = null;
    this.objectiveEl = null;
    this.minimapWrap = null;
    this.minimap = null;
    this.mapCtx = null;
    this.radioEl = null;
    this.timeEl = null;
    this._fade = 1;             // 0 = faded out, 1 = fully visible
    this._lastState = null;
    this._built = false;
  }

  // Build DOM once. Safe to call twice.
  build(container) {
    if (this._built) return this.root;
    const parent = container || this.opts.container || (typeof document !== 'undefined' ? document.body : null);
    if (!parent) return null;
    const root = el('div', 'sunset-hud');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;font-family:system-ui,sans-serif;color:#fff;z-index:20;';

    // --- Top-left: health + stamina -------------------------------
    this.healthWrap = el('div', 'hud-topleft');
    this.healthWrap.style.cssText = 'position:absolute;top:14px;left:14px;width:230px;transition:opacity .4s;';
    const hpLabel = el('div', 'hud-label', 'HEALTH');
    hpLabel.style.cssText = 'font-size:11px;letter-spacing:2px;opacity:.85;';
    const hpBar = el('div', 'hud-bar');
    hpBar.style.cssText = 'height:12px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);border-radius:6px;overflow:hidden;margin:3px 0 7px;';
    this.healthFill = el('div', 'hud-hp');
    this.healthFill.style.cssText = 'height:100%;width:100%;background:#37d67a;border-radius:6px;transition:width .2s;';
    hpBar.appendChild(this.healthFill);
    const stLabel = el('div', 'hud-label', 'STAMINA');
    stLabel.style.cssText = 'font-size:11px;letter-spacing:2px;opacity:.85;';
    const stBar = el('div', 'hud-bar');
    stBar.style.cssText = 'height:8px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.35);border-radius:4px;overflow:hidden;margin-top:3px;';
    this.staminaFill = el('div', 'hud-st');
    this.staminaFill.style.cssText = 'height:100%;width:100%;background:#ffd23c;border-radius:4px;transition:width .2s;';
    stBar.appendChild(this.staminaFill);
    this.healthWrap.append(hpLabel, hpBar, stLabel, stBar);
    root.appendChild(this.healthWrap);

    // --- Top-right: money, wanted, weapon -------------------------
    const tr = el('div', 'hud-topright');
    tr.style.cssText = 'position:absolute;top:14px;right:14px;text-align:right;';
    this.moneyEl = el('div', 'hud-money', '$0');
    this.moneyEl.style.cssText = 'font-size:24px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,.7);';
    this.starsEl = el('div', 'hud-stars', '☆☆☆☆☆');
    this.starsEl.style.cssText = 'font-size:22px;letter-spacing:3px;color:#ffd23c;text-shadow:0 2px 4px rgba(0,0,0,.7);';
    this.memoryEl = el('div', 'hud-memory');
    this.memoryEl.style.cssText = 'font-size:15px;letter-spacing:4px;margin-top:2px;min-height:20px;';
    this.memoryEl.title = 'What the police remember about you';
    this.weaponWrap = el('div', 'hud-weapon');
    this.weaponWrap.style.cssText = 'margin-top:6px;transition:opacity .4s;text-shadow:0 2px 4px rgba(0,0,0,.7);';
    this.weaponEl = el('div', 'hud-weapon-text', 'Fists');
    this.weaponEl.style.cssText = 'font-size:15px;font-weight:600;';
    this.weaponWrap.appendChild(this.weaponEl);
    this.timeEl = el('div', 'hud-time', '');
    this.timeEl.style.cssText = 'font-size:13px;opacity:.9;margin-top:4px;text-shadow:0 2px 4px rgba(0,0,0,.7);';
    tr.append(this.moneyEl, this.starsEl, this.memoryEl, this.weaponWrap, this.timeEl);
    root.appendChild(tr);

    // --- Bottom-left: minimap + objective -------------------------
    this.minimapWrap = el('div', 'hud-minimap-wrap');
    this.minimapWrap.style.cssText = 'position:absolute;left:14px;bottom:14px;transition:opacity .4s;';
    this.minimap = document.createElement('canvas');
    this.minimap.width = 210; this.minimap.height = 210;
    this.minimap.style.cssText = 'border-radius:50%;border:3px solid rgba(255,255,255,.55);background:#0c2233;box-shadow:0 4px 14px rgba(0,0,0,.5);display:block;';
    this.mapCtx = this.minimap.getContext('2d');
    this.objectiveEl = el('div', 'hud-objective', '');
    this.objectiveEl.style.cssText = 'margin-top:8px;max-width:230px;font-size:13px;font-weight:600;text-shadow:0 2px 4px rgba(0,0,0,.8);';
    this.minimapWrap.append(this.minimap, this.objectiveEl);
    root.appendChild(this.minimapWrap);

    // --- Bottom-right: radio readout (diegetic, from audio.js) -----
    this.radioEl = el('div', 'hud-radio', '');
    this.radioEl.style.cssText = 'position:absolute;right:14px;bottom:14px;font-size:13px;opacity:.95;text-align:right;text-shadow:0 2px 4px rgba(0,0,0,.8);';
    root.appendChild(this.radioEl);

    parent.appendChild(root);
    this.root = root;
    this._built = true;
    return root;
  }

  setMinimapMode(mode) {
    if (MINIMAP_MODES.includes(mode)) this.minimapMode = mode;
    return this.minimapMode;
  }

  cycleMinimapMode() {
    const i = MINIMAP_MODES.indexOf(this.minimapMode);
    return this.setMinimapMode(MINIMAP_MODES[(i + 1) % MINIMAP_MODES.length]);
  }

  // Decide whether the combat/driving HUD should be visible.
  // Visible during: fighting, fast driving, pursuit, low health,
  // active mission. Fades out during a calm stroll.
  _wantsVisible(s) {
    if (!s) return false;
    if (s.inCombat || s.wanted > 0 || s.inPursuit) return true;
    if (s.health != null && s.health < 50) return true;
    if (s.speed != null && s.speed > 0.55) return true;
    if (s.missionActive) return true;
    if (s.recentDamageAt && Date.now() - s.recentDamageAt < 5000) return true;
    return false;
  }

  // Main per-frame entry. `s` is a plain object; every field optional.
  // {
  //   health 0..100, stamina 0..100, money, wanted 0..5,
  //   wantedMemory: ['car','clothes','face'], searchTimer (seconds left),
  //   weapon: 'Pistol', ammo: 24, reserveAmmo: 48,
  //   inCombat, inPursuit, missionActive, speed 0..1,
  //   player: {x,z,heading}, objective: {x,z,label,distance},
  //   route: [{x,z}...], searchZone: {x,z,radius} | null,
  //   pois: [{x,z,kind}], mapBounds: {minX,maxX,minZ,maxZ},
  //   hour, district, radio: {station, dj} | null, objectiveText
  // }
  update(s) {
    if (!s) return;
    if (!this._built) this.build();
    this._lastState = s;

    const visible = this._wantsVisible(s);
    this._fade += (visible ? 1 : -1) * 0.08;
    this._fade = clamp(this._fade, 0, 1);
    const op = this._fade.toFixed(2);
    if (this.healthWrap) this.healthWrap.style.opacity = String(0.35 + 0.65 * this._fade);
    if (this.weaponWrap) this.weaponWrap.style.opacity = String(this._fade);

    if (s.health != null && this.healthFill) {
      const hp = clamp(s.health, 0, 100);
      this.healthFill.style.width = hp + '%';
      this.healthFill.style.background = hp > 50 ? '#37d67a' : hp > 25 ? '#ffb020' : '#ff4d4d';
    }
    if (s.stamina != null && this.staminaFill) {
      this.staminaFill.style.width = clamp(s.stamina, 0, 100) + '%';
    }
    if (s.money != null && this.moneyEl) {
      this.moneyEl.textContent = '$' + Math.floor(s.money).toLocaleString('en-US');
      this.moneyEl.style.color = s.money < 0 ? '#ff6b6b' : '#7dff9e';
    }
    if (s.wanted != null && this.starsEl) {
      const w = clamp(Math.round(s.wanted), 0, 5);
      this.starsEl.textContent = '★'.repeat(w) + '☆'.repeat(5 - w);
      this.starsEl.style.color = w === 0 ? 'rgba(255,255,255,.55)' : w >= 3 ? '#ff4d4d' : '#ffd23c';
    }
    if (this.memoryEl) this._renderMemory(s);
    if (this.weaponEl) {
      const w = s.weapon || 'Fists';
      const ammo = s.ammo;
      this.weaponEl.textContent = ammo != null
        ? w + '  •  ' + ammo + (s.reserveAmmo != null ? ' / ' + s.reserveAmmo : '') + ' ammo'
        : w;
    }
    if (this.timeEl) {
      const hh = s.hour != null ? String(Math.floor(s.hour)).padStart(2, '0') : '--';
      const mm = s.minute != null ? String(Math.floor(s.minute)).padStart(2, '0') : '00';
      this.timeEl.textContent = hh + ':' + mm + (s.district ? '  •  ' + s.district : '');
    }
    if (this.objectiveEl) {
      const label = s.objectiveText || (s.objective && s.objective.label) || '';
      const dist = s.objective && s.objective.distance != null
        ? ' — ' + Math.round(s.objective.distance) + 'm' : '';
      this.objectiveEl.textContent = label ? ('▶ ' + label + dist) : '';
    }
    if (this.radioEl) {
      this.radioEl.textContent = s.radio && s.radio.station
        ? '♪ ' + s.radio.station + (s.radio.dj ? ' — ' + s.radio.dj : '')
        : '';
    }
    this._updateMinimap(s, visible);
  }

  // Wanted memory icons. The game (jobs.js) clears entries when the
  // player swaps cars, changes clothes, or waits out the search timer.
  _renderMemory(s) {
    const mem = Array.isArray(s.wantedMemory) ? s.wantedMemory : [];
    if (mem.length === 0 || (s.wanted || 0) === 0) {
      this.memoryEl.textContent = '';
      this.memoryEl.title = 'The police have no description of you.';
      return;
    }
    this.memoryEl.textContent = mem
      .map((k) => (WANTED_MEMORY_ICONS[k] ? WANTED_MEMORY_ICONS[k].glyph : '•'))
      .join(' ');
    const names = mem.map((k) => (WANTED_MEMORY_ICONS[k] ? WANTED_MEMORY_ICONS[k].label : k)).join(', ');
    const timer = s.searchTimer != null ? ' — lose them in ' + Math.ceil(s.searchTimer) + 's' : '';
    this.memoryEl.title = 'Police know: ' + names + timer;
  }

  _updateMinimap(s, hudVisible) {
    if (!this.minimapWrap || !this.mapCtx) return;
    let show = false;
    if (this.minimapMode === 'on') show = true;
    else if (this.minimapMode === 'dynamic') show = !!(s.missionActive || s.inPursuit || (s.wanted || 0) > 0 || s.objective);
    else show = false;
    this.minimapWrap.style.opacity = show ? '1' : '0';
    this.minimapWrap.style.pointerEvents = 'none';
    if (!show) return;
    this._drawMinimap(s);
  }

  _drawMinimap(s) {
    const ctx = this.mapCtx;
    const W = this.minimap.width, H = this.minimap.height;
    const cx = W / 2, cy = H / 2, R = W / 2 - 4;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();

    // Sea / land background.
    ctx.fillStyle = '#0c2233'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#123f31'; ctx.fillRect(0, 0, W, H * 0.62);
    ctx.fillStyle = '#1b6b8a'; ctx.fillRect(0, H * 0.62, W, H * 0.38);

    const b = s.mapBounds || { minX: -600, maxX: 600, minZ: -600, maxZ: 600 };
    const toMap = (x, z) => ({
      x: cx + ((x - (b.minX + b.maxX) / 2) / (b.maxX - b.minX)) * (W - 10),
      y: cy + ((z - (b.minZ + b.maxZ) / 2) / (b.maxZ - b.minZ)) * (H - 10),
    });

    // Red search zone during a pursuit — the area to escape.
    if (s.searchZone && (s.inPursuit || (s.wanted || 0) > 0)) {
      const p = toMap(s.searchZone.x, s.searchZone.z);
      const rr = (s.searchZone.radius / (b.maxX - b.minX)) * (W - 10);
      ctx.fillStyle = 'rgba(255,45,45,.28)';
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, rr), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,45,45,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(8, rr), 0, Math.PI * 2); ctx.stroke();
    }

    // Points of interest.
    if (Array.isArray(s.pois)) {
      for (const poi of s.pois) {
        const p = toMap(poi.x, poi.z);
        ctx.fillStyle = poi.kind === 'safehouse' ? '#7dff9e' : poi.kind === 'shop' ? '#ffd23c' : '#ffffff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Coloured route line to the objective.
    const route = Array.isArray(s.route) && s.route.length > 0
      ? s.route
      : (s.objective ? [{ x: s.player ? s.player.x : 0, z: s.player ? s.player.z : 0 }, s.objective] : null);
    if (route && route.length > 1) {
      ctx.strokeStyle = '#ffd23c'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((pt, i) => {
        const p = toMap(pt.x, pt.z);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Objective marker.
    if (s.objective) {
      const p = toMap(s.objective.x, s.objective.z);
      const pulse = 5 + Math.sin(Date.now() / 300) * 1.5;
      ctx.fillStyle = '#ffd23c';
      ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.stroke();
    }

    // Player arrow, rotated by heading.
    if (s.player) {
      const p = toMap(s.player.x, s.player.z);
      const heading = (s.player.heading || 0) * Math.PI / 180;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(heading);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // North tick.
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.fillText('N', cx, 14);
  }

  // Small centre-screen toast (mission start, cash pickup, etc).
  toast(text, ms) {
    if (!this.root || typeof document === 'undefined') return;
    let t = this.root.querySelector('.hud-toast');
    if (!t) {
      t = el('div', 'hud-toast');
      t.style.cssText = 'position:absolute;left:50%;top:22%;transform:translateX(-50%);background:rgba(0,0,0,.72);padding:10px 18px;border-radius:8px;font-size:16px;font-weight:600;text-align:center;';
      this.root.appendChild(t);
    }
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.style.opacity = '0'; }, ms || 2600);
  }

  destroy() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null; this._built = false;
  }
}

export function createHud(options) { return new Hud(options); }

if (typeof window !== 'undefined') {
  window.SunsetHud = window.SunsetHud || {};
  window.SunsetHud.Hud = Hud;
  window.SunsetHud.MINIMAP_MODES = MINIMAP_MODES;
  window.SunsetHud.WANTED_MEMORY_ICONS = WANTED_MEMORY_ICONS;
  window.SunsetHud.createHud = createHud;
}

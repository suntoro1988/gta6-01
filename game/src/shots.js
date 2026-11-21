// shots.js — Sunset Bay (v11)
// Shooting system for Sunset Bay, written from scratch.
//  * Ammunition is spelled lowercase "ammo" everywhere (HUD, shop,
//    code) — the v10 convention, kept on purpose.
//  * buyAmmo: $50 for +24 ammo.
//  * Shooting a police officer: HP 100 -> 66 per hit (34 damage —
//    the v10 value, kept). Three hits take an officer down.
//  * Reload, crosshair (DOM + canvas-drawn), spread, range, cooldown.
//  * No dependencies except an optional audio hook: pass an object
//    with sfxGunshot() / sfxReload() (the audio.js engine) and the
//    system will call it; without one it runs silently.
//  * Hit detection is a plain ray-vs-target test over caller-supplied
//    targets, so it works with any world representation.

'use strict';

export const AMMO_PRICE = 50;
export const AMMO_PACK = 24;
export const MAG_SIZE = 12;
export const POLICE_HP = 100;
export const DAMAGE_PER_HIT = 34; // 100 -> 66 on the first hit (v10 value)
export const RELOAD_TIME_MS = 1100;
export const FIRE_COOLDOWN_MS = 180;
export const MAX_RANGE = 120;
export const BASE_SPREAD_DEG = 1.2;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export class ShootingSystem {
  constructor(options) {
    const o = options || {};
    this.audio = o.audio || null;      // optional audio.js engine
    this.onEvent = typeof o.onEvent === 'function' ? o.onEvent : null;
    this.money = o.money != null ? o.money : 0;
    this.ammo = o.ammo != null ? o.ammo : 48;          // reserve ammo
    this.mag = o.mag != null ? o.mag : MAG_SIZE;        // ammo in the magazine
    this.magSize = MAG_SIZE;
    this.reloading = false;
    this._reloadTimer = null;
    this._lastShotAt = 0;
    this._shotsFired = 0;
    this._shotsHit = 0;
    this.crosshair = { visible: false, spread: 8, hitMarkerAt: 0 };
    this._crossEl = null;
  }

  emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  // --- Ammunition shop ----------------------------------------------
  // $50 buys +24 ammo (reserve). Returns { ok, ammo, money }.
  buyAmmo() {
    if (this.money < AMMO_PRICE) {
      return { ok: false, error: 'need $' + AMMO_PRICE, money: this.money, ammo: this.ammo };
    }
    this.money -= AMMO_PRICE;
    this.ammo += AMMO_PACK;
    this.emit('ammo-bought', { price: AMMO_PRICE, gained: AMMO_PACK, ammo: this.ammo, money: this.money });
    return { ok: true, price: AMMO_PRICE, gained: AMMO_PACK, ammo: this.ammo, money: this.money };
  }

  // How many $50 packs the player can currently afford.
  affordablePacks() { return Math.floor(this.money / AMMO_PRICE); }

  // --- Firing ---------------------------------------------------------
  canFire(now) {
    if (this.reloading) return { ok: false, reason: 'reloading' };
    if (this.mag <= 0) return { ok: false, reason: 'empty' };
    const t = now || Date.now();
    if (t - this._lastShotAt < FIRE_COOLDOWN_MS) return { ok: false, reason: 'cooldown' };
    return { ok: true };
  }

  // Fire one shot along a ray. `aim` = { ox, oy, oz, dx, dy, dz }
  // (origin + normalised direction). `targets` = array of
  // { id, kind, x, y, z, radius, hp } — kind 'police' | 'npc' | 'prop'.
  // Returns { ok, hit, target, damage, remaining }.
  fire(aim, targets) {
    const check = this.canFire();
    if (!check.ok) {
      if (check.reason === 'empty') this.emit('dry-fire', {});
      return { ok: false, reason: check.reason };
    }
    this._lastShotAt = Date.now();
    this.mag -= 1;
    this._shotsFired += 1;
    this.crosshair.spread = 14;
    if (this.audio && typeof this.audio.sfxGunshot === 'function') this.audio.sfxGunshot();

    const hit = this._raycast(aim, targets || []);
    if (hit) {
      this._shotsHit += 1;
      this.crosshair.hitMarkerAt = Date.now();
      const result = this._applyHit(hit.target);
      this.emit('shot-hit', { target: hit.target, damage: result.damage, hp: result.hp, distance: hit.distance });
      if (result.down) this.emit('target-down', { target: hit.target });
      return { ok: true, hit: true, target: hit.target, damage: result.damage, hp: result.hp, down: result.down, mag: this.mag, ammo: this.ammo };
    }
    this.emit('shot-miss', {});
    return { ok: true, hit: false, mag: this.mag, ammo: this.ammo };
  }

  // Nearest target whose sphere the ray passes within `radius`.
  _raycast(aim, targets) {
    if (!aim) return null;
    const spreadRad = (BASE_SPREAD_DEG * Math.PI) / 180;
    // Deterministic-ish spread: rotate the direction slightly by a
    // pseudo-random amount scaled by the crosshair spread.
    const jx = (Math.random() - 0.5) * spreadRad * 2;
    const jz = (Math.random() - 0.5) * spreadRad * 2;
    const dx = aim.dx + jx, dy = aim.dy, dz = aim.dz + jz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ndx = dx / len, ndy = dy / len, ndz = dz / len;
    let best = null;
    for (const t of targets) {
      if (t.hp != null && t.hp <= 0) continue;
      const rx = t.x - aim.ox, ry = t.y - aim.oy, rz = t.z - aim.oz;
      const along = rx * ndx + ry * ndy + rz * ndz;
      if (along < 0 || along > MAX_RANGE) continue;
      const px = aim.ox + ndx * along, py = aim.oy + ndy * along, pz = aim.oz + ndz * along;
      const miss = Math.hypot(t.x - px, t.y - py, t.z - pz);
      const radius = t.radius || 1;
      if (miss <= radius && (!best || along < best.distance)) best = { target: t, distance: along };
    }
    return best;
  }

  // Damage model. Police: 100 -> 66 -> 32 -> 0 (34 per hit).
  // Civilians / props take the same base damage; only police have
  // the exact 100 HP the brief pins down.
  _applyHit(target) {
    const damage = DAMAGE_PER_HIT;
    if (target.hp == null) target.hp = target.kind === 'police' ? POLICE_HP : 50;
    target.hp = Math.max(0, target.hp - damage);
    return { damage, hp: target.hp, down: target.hp <= 0 };
  }

  // Convenience: shoot a police officer object directly (used by
  // tests and by simple callers that already did their own aiming).
  // officer = { hp } — starts at 100 if unset. Returns new HP.
  shootPolice(officer) {
    if (!officer) return { ok: false, error: 'no officer' };
    if (this.mag <= 0) return { ok: false, reason: 'empty' };
    this.mag -= 1;
    this._shotsFired += 1;
    if (officer.hp == null) officer.hp = POLICE_HP;
    officer.hp = Math.max(0, officer.hp - DAMAGE_PER_HIT);
    this._shotsHit += 1;
    if (this.audio && typeof this.audio.sfxGunshot === 'function') this.audio.sfxGunshot();
    this.emit('shot-hit', { target: officer, damage: DAMAGE_PER_HIT, hp: officer.hp });
    if (officer.hp <= 0) this.emit('target-down', { target: officer });
    return { ok: true, damage: DAMAGE_PER_HIT, hp: officer.hp, down: officer.hp <= 0, mag: this.mag };
  }

  // --- Reload ---------------------------------------------------------
  reload() {
    if (this.reloading) return { ok: false, reason: 'already reloading' };
    if (this.mag >= this.magSize) return { ok: false, reason: 'mag full' };
    if (this.ammo <= 0) return { ok: false, reason: 'no ammo' };
    this.reloading = true;
    if (this.audio && typeof this.audio.sfxReload === 'function') this.audio.sfxReload();
    this.emit('reload-start', {});
    this._reloadTimer = setTimeout(() => {
      const need = this.magSize - this.mag;
      const take = Math.min(need, this.ammo);
      this.mag += take;
      this.ammo -= take;
      this.reloading = false;
      this._reloadTimer = null;
      this.emit('reload-done', { mag: this.mag, ammo: this.ammo });
    }, RELOAD_TIME_MS);
    return { ok: true, ms: RELOAD_TIME_MS };
  }

  // Instant reload used by tests / save loading (no timer).
  reloadInstant() {
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    const need = this.magSize - this.mag;
    const take = Math.min(need, this.ammo);
    this.mag += take;
    this.ammo -= take;
    this.reloading = false;
    return { mag: this.mag, ammo: this.ammo };
  }

  cancelReload() {
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); this._reloadTimer = null; }
    this.reloading = false;
  }

  // --- Crosshair ------------------------------------------------------
  // A DOM crosshair: four ticks + a centre dot that blooms with
  // spread and flashes a hit marker (X) for 150ms after a hit.
  // Build once; show()/hide() toggle it; tick() eases the spread.
  buildCrosshair(container) {
    if (this._crossEl) return this._crossEl;
    const parent = container || (typeof document !== 'undefined' ? document.body : null);
    if (!parent) return null;
    const c = document.createElement('div');
    c.className = 'sunset-crosshair';
    c.style.cssText = 'position:fixed;left:50%;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;pointer-events:none;z-index:25;display:none;';
    c.innerHTML =
      '<div style="position:absolute;left:19px;top:19px;width:2px;height:2px;background:#fff;border-radius:50%;box-shadow:0 0 3px #000;"></div>' +
      '<div class="ch-t" style="position:absolute;left:19px;top:2px;width:2px;height:10px;background:#fff;box-shadow:0 0 3px #000;"></div>' +
      '<div class="ch-b" style="position:absolute;left:19px;bottom:2px;width:2px;height:10px;background:#fff;box-shadow:0 0 3px #000;"></div>' +
      '<div class="ch-l" style="position:absolute;top:19px;left:2px;height:2px;width:10px;background:#fff;box-shadow:0 0 3px #000;"></div>' +
      '<div class="ch-r" style="position:absolute;top:19px;right:2px;height:2px;width:10px;background:#fff;box-shadow:0 0 3px #000;"></div>' +
      '<div class="ch-x" style="position:absolute;inset:0;display:none;color:#ff4d4d;font-size:22px;line-height:40px;text-align:center;">✕</div>';
    parent.appendChild(c);
    this._crossEl = c;
    return c;
  }

  showCrosshair(show) {
    this.crosshair.visible = !!show;
    if (this._crossEl) this._crossEl.style.display = show ? 'block' : 'none';
    return this.crosshair.visible;
  }

  // Call once per frame: eases spread back down and clears the hit marker.
  tickCrosshair() {
    this.crosshair.spread += (8 - this.crosshair.spread) * 0.2;
    if (this._crossEl) {
      const s = Math.round(this.crosshair.spread);
      const set = (sel, v) => { const n = this._crossEl.querySelector(sel); if (n) n.style.transform = v; };
      set('.ch-t', 'translateY(' + (-s + 8) + 'px)');
      set('.ch-b', 'translateY(' + (s - 8) + 'px)');
      set('.ch-l', 'translateX(' + (-s + 8) + 'px)');
      set('.ch-r', 'translateX(' + (s - 8) + 'px)');
      const x = this._crossEl.querySelector('.ch-x');
      if (x) x.style.display = (Date.now() - this.crosshair.hitMarkerAt < 150) ? 'block' : 'none';
    }
    return this.crosshair.spread;
  }

  // --- Stats / persistence --------------------------------------------
  accuracy() {
    if (this._shotsFired === 0) return 0;
    return Math.round((this._shotsHit / this._shotsFired) * 100);
  }

  status() {
    return {
      mag: this.mag, magSize: this.magSize, ammo: this.ammo,
      reloading: this.reloading, money: this.money,
      shotsFired: this._shotsFired, shotsHit: this._shotsHit,
      accuracy: this.accuracy(),
    };
  }

  save() { return { mag: this.mag, ammo: this.ammo, money: this.money }; }

  load(data) {
    if (!data) return;
    if (data.mag != null) this.mag = clamp(data.mag, 0, this.magSize);
    if (data.ammo != null) this.ammo = Math.max(0, data.ammo);
    if (data.money != null) this.money = data.money;
  }
}

export function createShootingSystem(options) { return new ShootingSystem(options); }

if (typeof window !== 'undefined') {
  window.SunsetShots = window.SunsetShots || {};
  window.SunsetShots.ShootingSystem = ShootingSystem;
  window.SunsetShots.AMMO_PRICE = AMMO_PRICE;
  window.SunsetShots.AMMO_PACK = AMMO_PACK;
  window.SunsetShots.DAMAGE_PER_HIT = DAMAGE_PER_HIT;
  window.SunsetShots.POLICE_HP = POLICE_HP;
  window.SunsetShots.createShootingSystem = createShootingSystem;
}

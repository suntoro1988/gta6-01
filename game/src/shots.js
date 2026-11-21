// Sunset Bay — shooting system: fire, bullet tracers, hit detection,
// ammo economy, crosshair.
// Written from scratch for v10. Depends only on ./rng.js (shot spread).
//
// Ammo rules (note: the field is always lowercase `ammo`):
//   - Every shot costs 1 ammo.
//   - buyAmmo: $50 buys +24 ammo, only when the player can afford it.
//   - Firing with 0 ammo plays an empty click and fires nothing.
// Damage:
//   - A hit on police deals 34 damage: 100 HP -> 66 HP on the first hit,
//     dead on the third.
//   - A hit on a vehicle deals 25 damage.
//
// The game owns the targets: pass them in as plain objects
//   { id, type: 'police' | 'vehicle' | 'target', x, y, z, radius, hp }
// and this module returns hit results without touching the renderer.
// Tracers are kept in SB.Shots.tracers so the renderer can draw them.

import { rng } from "./rng.js";

const SB = (globalThis.SB = globalThis.SB || {});

const AMMO_PRICE = 50;
const AMMO_PACK = 24;
const POLICE_DAMAGE = 34;
const VEHICLE_DAMAGE = 25;
const TRACER_LIFE = 0.12;
const MAX_RANGE = 120;
const BASE_SPREAD = 0.012; // radians, grows while moving

const spreadRng = rng("sunset-bay-shots");

const state = {
  tracers: [], // { from:{x,y,z}, to:{x,y,z}, life, maxLife }
  shotsFired: 0,
  shotsHit: 0,
};

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Ray vs sphere: does the ray (origin + t*dir, t in [0, maxT]) hit the
 * sphere centered on target with the given radius? Returns t or null.
 */
function rayHitSphere(origin, dir, target) {
  const oc = sub(origin, { x: target.x, y: target.y || 0, z: target.z });
  const r = target.radius || 1;
  const b = dot(oc, dir);
  const c = dot(oc, oc) - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t = -b - root;
  if (t >= 0) return t;
  // Asal sinar sudah DI DALAM bola (target menempel / point-blank):
  // perpotongan masuk ada di belakang, pakai perpotongan keluar.
  const t2 = -b + root;
  if (t2 < 0) return null;
  return t2;
}

function damageFor(target) {
  if (target.type === "police") return POLICE_DAMAGE;
  if (target.type === "vehicle") return VEHICLE_DAMAGE;
  return POLICE_DAMAGE;
}

/**
 * Fire one shot.
 *   game: { ammo, cash?, audio?, player? } — ammo is read and decremented.
 *   origin: { x, y, z } muzzle position.
 *   dir: { x, y, z } aim direction (need not be normalized).
 *   targets: array of hittable objects (see header).
 *   opts: { moving: boolean } — moving widens the spread.
 * Returns { fired, hit, target?, damage?, hpLeft?, end, reason? }.
 */
function fire(game, origin, dir, targets, opts) {
  if (!game || game.ammo === undefined) return { fired: false, reason: "no ammo field" };
  if (game.ammo <= 0) {
    if (game.audio) game.audio.playSFX("emptyClick");
    return { fired: false, reason: "empty" };
  }
  game.ammo -= 1;
  state.shotsFired += 1;

  const moving = opts && opts.moving;
  const spread = BASE_SPREAD * (moving ? 2.2 : 1);
  const d = normalize(dir);
  const jittered = normalize({
    x: d.x + spreadRng.normal(0, spread),
    y: d.y + spreadRng.normal(0, spread * 0.7),
    z: d.z + spreadRng.normal(0, spread),
  });

  let best = null;
  let bestT = MAX_RANGE;
  for (const t of targets || []) {
    if (t.hp !== undefined && t.hp <= 0) continue;
    const hitT = rayHitSphere(origin, jittered, t);
    if (hitT !== null && hitT < bestT) {
      bestT = hitT;
      best = t;
    }
  }

  const end = add(origin, scale(jittered, best ? bestT : MAX_RANGE));
  state.tracers.push({ from: { x: origin.x, y: origin.y, z: origin.z }, to: end, life: TRACER_LIFE, maxLife: TRACER_LIFE });
  if (game.audio) game.audio.playSFX("shot");

  if (!best) return { fired: true, hit: false, end };

  const damage = damageFor(best);
  best.hp = (best.hp === undefined ? 100 : best.hp) - damage;
  state.shotsHit += 1;
  if (game.audio) game.audio.playSFX("hit");
  return {
    fired: true,
    hit: true,
    target: best,
    damage,
    hpLeft: Math.max(0, best.hp),
    killed: best.hp <= 0,
    end,
  };
}

/** $50 for +24 ammo. Returns { ok, ammo, cash } or { ok:false, reason }. */
function buyAmmo(game) {
  if (!game) return { ok: false, reason: "no game state" };
  if ((game.cash || 0) < AMMO_PRICE) {
    return { ok: false, reason: "not enough cash", price: AMMO_PRICE, pack: AMMO_PACK };
  }
  game.cash -= AMMO_PRICE;
  game.ammo = (game.ammo || 0) + AMMO_PACK;
  if (game.audio) game.audio.playSFX("cash");
  return { ok: true, price: AMMO_PRICE, pack: AMMO_PACK, ammo: game.ammo, cash: game.cash };
}

/** Advance tracer lifetimes; call once per frame with dt in seconds. */
function update(dt) {
  const step = dt || 0;
  for (let i = state.tracers.length - 1; i >= 0; i--) {
    state.tracers[i].life -= step;
    if (state.tracers[i].life <= 0) state.tracers.splice(i, 1);
  }
  return state.tracers.length;
}

/** Live tracers for the renderer (each has from/to in world space). */
function getTracers() {
  return state.tracers;
}

function accuracy() {
  if (state.shotsFired === 0) return 0;
  return state.shotsHit / state.shotsFired;
}

// ---------------------------------------------------------------------------
// Crosshair (2D overlay; the HUD also draws one — this is the standalone
// version the shooting system owns so it works even without the HUD).
// ---------------------------------------------------------------------------

let crosshairEl = null;

function showCrosshair() {
  if (typeof document === "undefined") return null;
  if (!crosshairEl) {
    crosshairEl = document.createElement("div");
    crosshairEl.id = "sb-shots-crosshair";
    crosshairEl.textContent = "+";
    crosshairEl.style.cssText =
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "font-size:28px;font-weight:700;color:rgba(255,255,255,.9);" +
      "text-shadow:0 0 3px #000,0 1px 2px #000;pointer-events:none;z-index:11;" +
      "font-family:Arial,Helvetica,sans-serif";
    document.body.appendChild(crosshairEl);
  }
  crosshairEl.style.display = "block";
  return crosshairEl;
}

function hideCrosshair() {
  if (crosshairEl) crosshairEl.style.display = "none";
  return true;
}

/** Widen the crosshair while moving / firing (spread in px, 0-40). */
function setCrosshairSpread(spread) {
  if (!crosshairEl) showCrosshair();
  if (!crosshairEl) return;
  const s = Math.max(0, Math.min(40, spread || 0));
  crosshairEl.style.letterSpacing = s + "px";
  crosshairEl.style.opacity = String(1 - s / 80);
}

SB.Shots = {
  fire,
  buyAmmo,
  update,
  getTracers,
  accuracy,
  showCrosshair,
  hideCrosshair,
  setCrosshairSpread,
  AMMO_PRICE,
  AMMO_PACK,
  POLICE_DAMAGE,
  VEHICLE_DAMAGE,
  state,
};

const Shots = SB.Shots;

export {
  Shots,
  fire,
  buyAmmo,
  update,
  getTracers,
  accuracy,
  showCrosshair,
  hideCrosshair,
  setCrosshairSpread,
  AMMO_PRICE,
  AMMO_PACK,
  POLICE_DAMAGE,
  VEHICLE_DAMAGE,
};
export default SB.Shots;

// Sunset Bay — HUD rendering: minimap, wanted stars, cash, health,
// mission objective, radio station, speed, crosshair.
// Written from scratch for v10. Pure DOM + 2D canvas, no dependencies.
// The game passes one plain state object per frame; HUD never reads
// game internals directly, so it stays decoupled from the renderer.
//
// Expected state shape (all fields optional, sane defaults apply):
// {
//   cash, health, maxHealth, wanted (0-5), speed, speedUnit ('km/h'),
//   radio: { name } | string | null,
//   objective: string,
//   ammo,
//   player: { x, z, heading },
//   police: [{ x, z }],
//   missionMarker: { x, z } | null,
//   worldSize: number (world is worldSize x worldSize, centered on 0),
//   crosshair: { visible, spread }
// }

const SB = (globalThis.SB = globalThis.SB || {});

const DEFAULTS = {
  cash: 0,
  health: 100,
  maxHealth: 100,
  wanted: 0,
  speed: 0,
  speedUnit: "km/h",
  radio: null,
  objective: "",
  ammo: 0,
  player: { x: 0, z: 0, heading: 0 },
  police: [],
  missionMarker: null,
  worldSize: 400,
  crosshair: { visible: true, spread: 6 },
};

let rootEl = null;
let els = {};
let minimapCanvas = null;
let minimapCtx = null;
let crosshairCanvas = null;
let crosshairCtx = null;

function el(id, tag, parent, className) {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement(tag || "div");
    node.id = id;
    if (className) node.className = className;
    (parent || document.body).appendChild(node);
  }
  return node;
}

function styleHud() {
  const css = [
    "#sb-hud{position:fixed;inset:0;pointer-events:none;font-family:Arial,Helvetica,sans-serif;color:#fff;z-index:10}",
    "#sb-hud .sb-panel{background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px}",
    "#sb-cash{position:absolute;top:12px;right:14px;font-size:22px;font-weight:700;color:#7dff8a;text-shadow:0 1px 2px #000}",
    "#sb-wanted{position:absolute;top:48px;right:14px;font-size:22px;letter-spacing:2px;text-shadow:0 1px 2px #000}",
    "#sb-health-wrap{position:absolute;bottom:16px;right:14px;width:220px}",
    "#sb-health-label{font-size:12px;margin-bottom:3px;text-shadow:0 1px 2px #000}",
    "#sb-health-bar{height:12px;background:rgba(0,0,0,.6);border:1px solid #fff;border-radius:6px;overflow:hidden}",
    "#sb-health-fill{height:100%;background:#37d67a;width:100%}",
    "#sb-ammo{position:fixed;bottom:16px;right:250px;font-size:16px;text-shadow:0 1px 2px #000;pointer-events:none;z-index:10}",
    "#sb-objective{position:absolute;top:12px;left:14px;max-width:340px;font-size:15px;line-height:1.35;text-shadow:0 1px 2px #000}",
    "#sb-radio{position:absolute;bottom:16px;left:14px;font-size:14px;text-shadow:0 1px 2px #000}",
    "#sb-speed{position:fixed;bottom:52px;right:250px;font-size:22px;font-weight:700;text-shadow:0 1px 3px #000;pointer-events:none;z-index:10}",
    "#sb-speed small{font-size:13px;font-weight:400}",
    "#sb-minimap{position:absolute;bottom:16px;left:14px;border:2px solid rgba(255,255,255,.7);border-radius:50%;background:rgba(10,20,30,.85)}",
    "#sb-crosshair{position:fixed;inset:0;pointer-events:none}",
  ].join("\n");
  const style = document.createElement("style");
  style.id = "sb-hud-style";
  style.textContent = css;
  document.head.appendChild(style);
}

/** Create HUD DOM (idempotent). Pass a minimap size in px, default 150.
 * v10 integration: the page (index.html) already ships a full HUD
 * (#hud-cash, #wanted-stars, #hud-rep, #hud-score, #hud-time,
 * #hud-weather, #health-bar, #hud-health, #hud-mission, #hud-radio,
 * #minimap). render() binds to THOSE elements instead of building a
 * second overlapping HUD, and draws the minimap into the existing
 * #minimap canvas. Only the crosshair layer and the ammo/speed
 * readouts (which have no HTML counterpart) are created here. */
function initHUD(options) {
  if (typeof document === "undefined") return null;
  const opts = options || {};
  if (!document.getElementById("sb-hud-style")) styleHud();
  rootEl = document.getElementById("hud") || document.body;
  const pick = (id) => document.getElementById(id);
  els.cash = pick("hud-cash");
  els.wanted = pick("wanted-stars");
  els.rep = pick("hud-rep");
  els.score = pick("hud-score");
  els.time = pick("hud-time");
  els.weather = pick("hud-weather");
  els.healthFill = pick("health-bar");
  els.healthLabel = pick("hud-health");
  els.objective = pick("hud-mission");
  els.radio = pick("hud-radio");
  els.radioStation = pick("radio-station");
  els.ammo = pick("sb-ammo") || el("sb-ammo", "div", document.body, "sb-panel");
  els.speed = pick("sb-speed") || el("sb-speed", "div", document.body);

  minimapCanvas = pick("minimap");
  if (!minimapCanvas) {
    minimapCanvas = el("sb-minimap", "canvas", document.body);
    const mapSize = opts.minimapSize || 150;
    minimapCanvas.width = mapSize;
    minimapCanvas.height = mapSize;
    minimapCanvas.style.bottom = "96px";
  }
  minimapCtx = minimapCanvas.getContext("2d");

  crosshairCanvas = el("sb-crosshair", "canvas", document.body);
  crosshairCanvas.width = globalThis.innerWidth || 800;
  crosshairCanvas.height = globalThis.innerHeight || 600;
  crosshairCtx = crosshairCanvas.getContext("2d");
  return rootEl;
}

function formatCash(cash) {
  const n = Math.max(0, Math.floor(cash || 0));
  return "$" + n.toLocaleString("en-US");
}

function wantedStars(wanted) {
  const w = Math.max(0, Math.min(5, Math.floor(wanted || 0)));
  let out = "";
  for (let i = 0; i < 5; i++) out += i < w ? "★" : "☆";
  return out;
}

function healthColor(frac) {
  if (frac > 0.55) return "#37d67a";
  if (frac > 0.28) return "#ffb020";
  return "#ff4444";
}

// ---------------------------------------------------------------------------
// Minimap: top-down city + player + police + mission marker
// ---------------------------------------------------------------------------

function worldToMap(x, z, size, worldSize) {
  const half = worldSize / 2;
  return {
    x: ((x + half) / worldSize) * size,
    y: ((z + half) / worldSize) * size,
  };
}

function drawMinimap(state) {
  if (!minimapCtx || !minimapCanvas) return;
  const size = minimapCanvas.width;
  const c = minimapCtx;
  const worldSize = state.worldSize || DEFAULTS.worldSize;
  c.clearRect(0, 0, size, size);

  // Water / land background.
  c.fillStyle = "#0d2b45";
  c.fillRect(0, 0, size, size);
  c.fillStyle = "#1d3a2f";
  c.beginPath();
  c.arc(size / 2, size / 2, size * 0.46, 0, Math.PI * 2);
  c.fill();

  // City street grid.
  c.strokeStyle = "rgba(220,220,200,0.55)";
  c.lineWidth = 1;
  const streets = 6;
  for (let i = 1; i < streets; i++) {
    const p = (i / streets) * size;
    c.beginPath();
    c.moveTo(p, size * 0.04);
    c.lineTo(p, size * 0.96);
    c.stroke();
    c.beginPath();
    c.moveTo(size * 0.04, p);
    c.lineTo(size * 0.96, p);
    c.stroke();
  }
  // Main avenue (diagonal).
  c.strokeStyle = "rgba(255,220,120,0.7)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(size * 0.06, size * 0.94);
  c.lineTo(size * 0.94, size * 0.06);
  c.stroke();

  // Mission marker (yellow diamond).
  if (state.missionMarker) {
    const m = worldToMap(state.missionMarker.x, state.missionMarker.z, size, worldSize);
    c.fillStyle = "#ffe14d";
    c.beginPath();
    c.moveTo(m.x, m.y - 6);
    c.lineTo(m.x + 5, m.y);
    c.lineTo(m.x, m.y + 6);
    c.lineTo(m.x - 5, m.y);
    c.closePath();
    c.fill();
    c.strokeStyle = "#000";
    c.lineWidth = 1;
    c.stroke();
  }

  // Police (red/blue flashing dots).
  const blink = Math.floor(Date.now() / 350) % 2 === 0;
  (state.police || []).forEach((p) => {
    const m = worldToMap(p.x, p.z, size, worldSize);
    c.fillStyle = blink ? "#ff4444" : "#4488ff";
    c.beginPath();
    c.arc(m.x, m.y, 3.5, 0, Math.PI * 2);
    c.fill();
  });

  // Player arrow (white, rotated by heading).
  const pp = worldToMap(state.player.x, state.player.z, size, worldSize);
  c.save();
  c.translate(pp.x, pp.y);
  c.rotate(state.player.heading || 0);
  c.fillStyle = "#ffffff";
  c.strokeStyle = "#000";
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, -7);
  c.lineTo(5, 6);
  c.lineTo(0, 3);
  c.lineTo(-5, 6);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();

  // North tick.
  c.fillStyle = "#fff";
  c.font = "bold 10px Arial";
  c.fillText("N", size / 2 - 3, 11);
}

// ---------------------------------------------------------------------------
// Crosshair
// ---------------------------------------------------------------------------

function drawCrosshair(state) {
  if (!crosshairCtx || !crosshairCanvas) return;
  const c = crosshairCtx;
  c.clearRect(0, 0, crosshairCanvas.width, crosshairCanvas.height);
  const ch = state.crosshair || DEFAULTS.crosshair;
  // Sembunyikan elemennya juga saat tak terlihat: clearRect saja
  // ternyata tak cukup — di headless/SwiftShader lapisan kanvas sempat
  // menampilkan tekstur terakhirnya (crosshair nyangkut saat mengemudi).
  crosshairCanvas.style.display = ch.visible ? 'block' : 'none';
  if (!ch.visible) return;
  const cx = crosshairCanvas.width / 2;
  const cy = crosshairCanvas.height / 2;
  const gap = ch.spread === undefined ? 6 : ch.spread;
  const len = 9;
  c.strokeStyle = "rgba(255,255,255,0.95)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx - gap - len, cy);
  c.lineTo(cx - gap, cy);
  c.moveTo(cx + gap, cy);
  c.lineTo(cx + gap + len, cy);
  c.moveTo(cx, cy - gap - len);
  c.lineTo(cx, cy - gap);
  c.moveTo(cx, cy + gap);
  c.lineTo(cx, cy + gap + len);
  c.stroke();
  c.fillStyle = "rgba(255,255,255,0.95)";
  c.beginPath();
  c.arc(cx, cy, 1.5, 0, Math.PI * 2);
  c.fill();
}

// ---------------------------------------------------------------------------
// Per-frame render
// ---------------------------------------------------------------------------

function render(rawState) {
  const state = Object.assign({}, DEFAULTS, rawState || {});
  state.player = Object.assign({}, DEFAULTS.player, (rawState && rawState.player) || {});
  state.crosshair = Object.assign({}, DEFAULTS.crosshair, (rawState && rawState.crosshair) || {});
  if (!rootEl) initHUD();
  if (!rootEl) return state;

  // Bound to the page's own HUD elements (see initHUD); each write
  // is guarded so a missing element can never break the frame.
  const setText = (node, text) => { if (node) node.textContent = text; };
  setText(els.cash, formatCash(state.cash));
  setText(els.wanted, wantedStars(state.wanted));
  if (els.wanted) els.wanted.style.color = state.wanted > 0 ? "#ffcf3d" : "rgba(255,255,255,0.75)";
  setText(els.rep, "REP " + Math.floor(state.rep || 0));
  setText(els.score, "SKOR " + Math.floor(state.score || 0));
  if (state.timeOfDay !== undefined && state.timeOfDay !== null) {
    const hh = String(Math.floor(state.timeOfDay) % 24).padStart(2, "0");
    const mm = String(Math.floor((state.timeOfDay % 1) * 60)).padStart(2, "0");
    setText(els.time, hh + ":" + mm);
  }
  const weatherLabel = { clear: "☀️ Cerah", sunset: "🌇 Sunset", cloudy: "☁️ Berawan", rain: "🌧️ Hujan" };
  setText(els.weather, weatherLabel[state.weather] || "🌇 Sunset");

  const frac = Math.max(0, Math.min(1, state.health / (state.maxHealth || 100)));
  if (els.healthFill) {
    els.healthFill.style.width = Math.round(frac * 100) + "%";
    els.healthFill.style.background = healthColor(frac);
  }
  setText(els.healthLabel, Math.ceil(state.health) + "%");

  setText(els.ammo, "AMMO " + Math.max(0, Math.floor(state.ammo || 0)));
  setText(els.objective, state.objective || "");
  if (els.objective) els.objective.style.display = state.objective ? "block" : "none";

  const radioName = typeof state.radio === "string" ? state.radio : state.radio && state.radio.name;
  const radioGenre = state.radio && typeof state.radio === "object" ? state.radio.genre : "";
  setText(els.radio, radioName || "RADIO OFF");
  setText(els.radioStation, radioGenre || (radioName ? "Sunset Bay" : ""));
  setText(els.speed,
    Math.round(Math.abs(state.speed || 0)) + " " + (state.speedUnit || "km/h"));

  drawMinimap(state);
  drawCrosshair(state);
  return state;
}

/** Per-frame alias used by main.js (HUD.update(state)). */
function update(state) {
  return render(state);
}

/** Alias used by main.js (HUD.init()). */
function init(options) {
  return initHUD(options);
}

/** Wanted-only update used by Game.onWantedChanged. */
function setWanted(level) {
  if (!rootEl) initHUD();
  if (els.wanted) {
    els.wanted.textContent = wantedStars(level);
    els.wanted.style.color = level > 0 ? "#ffcf3d" : "rgba(255,255,255,0.75)";
  }
  return level;
}

/** Resize the fullscreen crosshair layer (call on window resize). */
function resize() {
  if (!crosshairCanvas) return;
  crosshairCanvas.width = globalThis.innerWidth || 800;
  crosshairCanvas.height = globalThis.innerHeight || 600;
}

SB.HUD = {
  initHUD,
  init,
  update,
  setWanted,
  render,
  drawMinimap,
  drawCrosshair,
  resize,
  formatCash,
  wantedStars,
};

const HUD = SB.HUD;

export { HUD, initHUD, init, update, setWanted, render, drawMinimap, drawCrosshair, resize, formatCash, wantedStars };
export default SB.HUD;

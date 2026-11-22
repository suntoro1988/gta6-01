window.SB = window.SB || {};
(function(){ 'use strict';
// ---------------------------------------------------------------------------
// SB.Shots — the screenshot helper of Sunset Bay, plus the ammo shop.
// take(name) captures the game canvas (1280x719) and downloads it as a
// PNG, keeping a small in-memory gallery and a localStorage index so the
// pause screen can show the player's album. The four official captures
// (1-start, 2-play, 3-foot, 4-end) are scripted presets so every build
// produces comparable hero shots.
// buyAmmo(): $50 for +24 ammo (spec), deducted from shared state.
// NOTE (spec): `ammo` is lowercase everywhere in this module.
// API (spec): take(name), buyAmmo(), ammo (lowercase).
// ---------------------------------------------------------------------------

var AMMO_PRICE = 50;      // $ per box
var AMMO_PER_BOX = 24;    // rounds per box
var MAX_AMMO = 999;
var MAX_CARRY = 4;        // max ammo boxes carried at once (soft cap via price)
var ammo = 24;            // current reserve, lowercase, mirrors SB.state.ammo
var gallery = [];         // {name, dataUrl, at} newest first, max 12
var lastShot = null;
var stateRef = null;
var canvasRef = null;
var autoCounter = 0;

// The four official captures (spec): name, scene description, and the
// game moment each one is meant to show. The capture script (Builder B's
// shots.json) calls take() with these names in order.
var PRESETS = [
  {
    name: '1-start',
    title: 'Start screen',
    brief: 'Title screen over the city at golden hour, crowded beach below.'
  },
  {
    name: '2-play',
    title: 'Car chase',
    brief: 'Vehicle chase with heli AIR-1, wanted three stars, full HUD and minimap with a red zone.'
  },
  {
    name: '3-foot',
    title: 'On foot at sunset',
    brief: 'Walking the beachfront road at sunset, palms, lit windows, active mission, NPCs nearby.'
  },
  {
    name: '4-end',
    title: 'Helicopter spotlight',
    brief: 'Heli AIR-1 spotlight sweeping the street, wanted four stars, explosion and smoke.'
  }
];

function findCanvas() {
  if (typeof document === 'undefined') { return null; }
  if (canvasRef && canvasRef.parentNode) { return canvasRef; }
  canvasRef = document.getElementById('game-canvas')
    || document.querySelector('#game-container canvas')
    || document.querySelector('canvas');
  return canvasRef;
}

// init(state): remember shared state and the canvas. Optional — take()
// also works standalone (it re-finds the canvas each time).
function init(state) {
  stateRef = state || null;
  if (stateRef && typeof stateRef.ammo === 'number') {
    ammo = stateRef.ammo;
  }
  findCanvas();
  loadIndex();
  return true;
}

// ---------------------------------------------------------------------------
// take(name): capture the current frame.
// - name omitted -> auto name "shot-NNN" with a running counter.
// - Renders the WebGL canvas to a PNG data URL (preserveDrawingBuffer
//   is off, so we force a fresh frame first when the Game module offers
//   a render hook, then read the canvas synchronously).
// - Downloads the file (a.click) and records it in the gallery + index.
// Returns the data URL, or null when no canvas is available.
// ---------------------------------------------------------------------------
function take(name) {
  var canvas = findCanvas();
  if (!canvas) { return null; }
  var shotName = String(name || ('shot-' + (++autoCounter))).replace(/[^a-z0-9\-_]/gi, '-');
  // Ask the Game module for one fresh frame so the capture is current.
  if (window.SB && window.SB.Game && window.SB.Game.render) {
    try { window.SB.Game.render(); } catch (e) { /* keep the last frame */ }
  }
  var dataUrl;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
  var entry = { name: shotName, dataUrl: dataUrl, at: Date.now() };
  lastShot = entry;
  gallery.unshift(entry);
  if (gallery.length > 12) { gallery.pop(); }
  saveIndex();
  download(dataUrl, shotName + '.png');
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.showToast('Screenshot saved: ' + shotName + '.png', 'good');
  }
  if (window.SB && window.SB.Audio) { window.SB.Audio.sfx('click'); }
  return dataUrl;
}

// Trigger a browser download for a data URL.
function download(dataUrl, filename) {
  var a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Capture the four official presets in order, with a short pause between
// them so each scene can settle. `step` is called with (preset, index)
// before each capture so the driver can stage the scene.
function takeAll(step, gapMs) {
  var i = 0;
  var gap = gapMs || 1200;
  function next() {
    if (i >= PRESETS.length) { return; }
    var preset = PRESETS[i];
    if (typeof step === 'function') {
      try { step(preset, i); } catch (e) { /* driver error: still shoot */ }
    }
    window.setTimeout(function () {
      take(preset.name);
      i++;
      next();
    }, gap);
  }
  next();
  return PRESETS.length;
}

// Take one named preset (used by the capture script for a single scene).
function takePreset(name) {
  var i;
  for (i = 0; i < PRESETS.length; i++) {
    if (PRESETS[i].name === name) { return take(name); }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ammo shop. buyAmmo(): $50 for +24 rounds (spec). Fails (returns false)
// when the player cannot afford it; otherwise deducts, adds, syncs
// shared state, and toasts the result. `ammo` stays lowercase.
// ---------------------------------------------------------------------------
function buyAmmo() {
  var cash = stateRef ? (stateRef.money || 0) : 0;
  if (cash < AMMO_PRICE) {
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Not enough cash — ammo costs $' + AMMO_PRICE + '.', 'bad');
    }
    return false;
  }
  if (ammo >= MAX_AMMO) {
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showToast('Ammo full (' + MAX_AMMO + ').', 'info');
    }
    return false;
  }
  if (stateRef) {
    stateRef.money = cash - AMMO_PRICE;
    ammo = Math.min(MAX_AMMO, ammo + AMMO_PER_BOX);
    stateRef.ammo = ammo;
  } else {
    ammo = Math.min(MAX_AMMO, ammo + AMMO_PER_BOX);
  }
  if (window.SB && window.SB.HUD) {
    window.SB.HUD.setMoney(stateRef ? stateRef.money : 0);
    window.SB.HUD.setAmmo(ammo);
    window.SB.HUD.showToast('Ammo +24  (-$' + AMMO_PRICE + ')', 'good');
  }
  if (window.SB && window.SB.Audio) {
    window.SB.Audio.sfx('reload');
    window.SB.Audio.sfx('cash');
  }
  return true;
}

// Price / size of one box, for shop UI text.
function ammoPrice() { return AMMO_PRICE; }
function ammoPerBox() { return AMMO_PER_BOX; }

// How many boxes the player can afford right now.
function affordableBoxes() {
  var cash = stateRef ? (stateRef.money || 0) : 0;
  return Math.floor(cash / AMMO_PRICE);
}

// Spend rounds (called by Player.shoot). Returns false when empty.
function spendAmmo(n) {
  var need = n || 1;
  if (ammo < need) { return false; }
  ammo -= need;
  if (stateRef) { stateRef.ammo = ammo; }
  if (window.SB && window.SB.HUD) { window.SB.HUD.setAmmo(ammo); }
  return true;
}

// Add rounds without charging (pickups, mission rewards).
function addAmmo(n) {
  ammo = Math.min(MAX_AMMO, ammo + (n || 0));
  if (stateRef) { stateRef.ammo = ammo; }
  if (window.SB && window.SB.HUD) { window.SB.HUD.setAmmo(ammo); }
  return ammo;
}

// Current reserve (lowercase accessor; the property `ammo` is the source).
function getAmmo() { return ammo; }

// Sync from shared state (called when loading a save).
function syncFromState() {
  if (stateRef && typeof stateRef.ammo === 'number') {
    ammo = stateRef.ammo;
  }
  return ammo;
}

// ---------------------------------------------------------------------------
// Gallery index: localStorage keeps only names + timestamps (never the
// PNG bytes — those would blow the 5 MB quota). The pause screen reads
// this list to show the album.
// ---------------------------------------------------------------------------
var INDEX_KEY = 'sunset-bay-shots-index';

function saveIndex() {
  try {
    var slim = gallery.map(function (g) {
      return { name: g.name, at: g.at };
    });
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(slim));
  } catch (e) { /* storage full or blocked: gallery still works in memory */ }
}

function loadIndex() {
  try {
    var raw = window.localStorage.getItem(INDEX_KEY);
    if (!raw) { return []; }
    return JSON.parse(raw) || [];
  } catch (e) { return []; }
}

function clearGallery() {
  gallery = [];
  lastShot = null;
  try { window.localStorage.removeItem(INDEX_KEY); } catch (e) {}
  return true;
}

// Gallery entries (newest first), without the heavy data URLs.
function listShots() {
  return gallery.map(function (g) {
    return { name: g.name, at: g.at };
  });
}

function lastShotName() {
  return lastShot ? lastShot.name : null;
}

window.SB.Shots = {
  init: init,
  take: take,
  takeAll: takeAll,
  takePreset: takePreset,
  buyAmmo: buyAmmo,
  ammoPrice: ammoPrice,
  ammoPerBox: ammoPerBox,
  affordableBoxes: affordableBoxes,
  spendAmmo: spendAmmo,
  addAmmo: addAmmo,
  getAmmo: getAmmo,
  syncFromState: syncFromState,
  listShots: listShots,
  clearGallery: clearGallery,
  lastShotName: lastShotName,
  presets: PRESETS
};
// `ammo` is a live lowercase property: reading SB.Shots.ammo always
// returns the current reserve (a plain value copy would go stale after
// the first buyAmmo/spendAmmo call).
Object.defineProperty(window.SB.Shots, 'ammo', {
  get: function () { return ammo; },
  set: function (v) { ammo = Math.max(0, Math.min(MAX_AMMO, v | 0)); },
  enumerable: true,
  configurable: true
});
})();

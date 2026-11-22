// water.js — Sunset Bay v14, Builder F.
// Ocean, waves and boat motion for the bay and harbor.
// Water level is 0 everywhere (SB.World.WATER_LEVEL). The sea is a
// procedural surface: waves are sine sums, boats bob and roll on them,
// and a moving boat leaves a foam wake.
// Wake rendering lives in SB.FX — SB.Water.wake(pos) MUST delegate to
// SB.FX.wake(pos) and never implement the effect itself. That delegation
// is the fix for bug #49 in v13, where the call was dropped.

window.SB = window.SB || {};

(function () {
  "use strict";

  var WATER_LEVEL = 0;
  var TWO_PI = Math.PI * 2;

  // Three overlapping sine waves: a long swell from the west, a shorter
  // chop from the south-west, and a fine ripple. Amplitudes are small
  // so boats rock gently instead of capsizing.
  var WAVES = [
    { dirX: -0.9, dirZ: 0.3, freq: 0.055, speed: 0.9, amp: 0.32 },
    { dirX: -0.4, dirZ: -0.85, freq: 0.11, speed: 1.4, amp: 0.16 },
    { dirX: 0.7, dirZ: 0.6, freq: 0.23, speed: 2.1, amp: 0.06 }
  ];

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  var Water = {
    WATER_LEVEL: WATER_LEVEL,
    level: WATER_LEVEL,
    // Seconds since the game started; drives every wave phase.
    time: 0,
    // Overall sea state 0..1. Rain and wind raise it; calm golden
    // hour keeps it low. Render can scale sparkle by this.
    swell: 0.35,
    // Per-boat wake throttle so a fast boat does not spawn foam
    // every frame: each boat may leave a wake at most every 0.09 s.
    _wakeTimers: {},

    // Height of the water surface at (x, z) at the current time.
    // Boats, floating props and the renderer all use this one function.
    waveHeight: function (x, z) {
      var h = 0;
      for (var i = 0; i < WAVES.length; i++) {
        var w = WAVES[i];
        var phase = (x * w.dirX + z * w.dirZ) * w.freq + Water.time * w.speed;
        h += Math.sin(phase) * w.amp;
      }
      return WATER_LEVEL + h * (0.6 + Water.swell * 0.8);
    },

    getWaveHeight: function (x, z) {
      return Water.waveHeight(x, z);
    },

    // Surface slope at (x, z): used to tilt boats so they sit on the
    // wave instead of floating flat above it.
    waveSlope: function (x, z) {
      var e = 1.5;
      var hx = Water.waveHeight(x + e, z) - Water.waveHeight(x - e, z);
      var hz = Water.waveHeight(x, z + e) - Water.waveHeight(x, z - e);
      return { x: hx / (2 * e), z: hz / (2 * e) };
    },

    // True when a position is over open water (west and south of the
    // marina shoreline). The city code owns the exact shoreline; this
    // is the water module's own check for boats and splashes.
    isWater: function (x, z) {
      if (x < -260) return true;
      if (z > 260) return true;
      if (x < -200 && z > 120) return true;
      return false;
    },

    // Boat wake. Delegates to SB.FX.wake(pos) — the only place the foam
    // and spray effect is implemented. If FX is not registered yet,
    // the call is a safe no-op instead of an exception.
    wake: function (pos) {
      if (window.SB && SB.FX && typeof SB.FX.wake === "function") {
        return SB.FX.wake(pos);
      }
      return 0;
    },

    // Update the sea every frame: advance the clock, ease the swell
    // toward the weather, bob every boat in SB.World.BOATS, and leave
    // a wake behind each boat that is actually moving.
    update: function (dt) {
      var step = Math.max(0, Math.min(0.1, dt || 0.016));
      Water.time += step;

      // Rain roughens the sea; clear golden hour calms it again.
      var targetSwell = 0.35;
      try {
        if (window.SB && SB.Weather) {
          if (SB.Weather.rainIntensity > 0.3) targetSwell = 0.75;
          else if (SB.Weather.current === "fog") targetSwell = 0.45;
        }
      } catch (e) { /* weather is best-effort */ }
      Water.swell += (targetSwell - Water.swell) * Math.min(1, step * 0.2);

      var boats = null;
      try {
        if (window.SB && SB.World && Array.isArray(SB.World.BOATS)) boats = SB.World.BOATS;
      } catch (e) { boats = null; }
      if (!boats) return Water.time;

      for (var i = 0; i < boats.length; i++) {
        var boat = boats[i];
        if (!boat || !boat.pos) continue;
        // Drift forward along the boat heading when it has speed.
        var speed = boat.speed || 0;
        if (speed !== 0) {
          var heading = boat.rotY || 0;
          boat.pos.x += Math.sin(heading) * speed * step;
          boat.pos.z += Math.cos(heading) * speed * step;
          // Keep boats inside the bay instead of sailing into the city.
          boat.pos.x = clamp(boat.pos.x, -560, 120);
          boat.pos.z = clamp(boat.pos.z, -320, 560);
        }
        // Sit on the wave: height from waveHeight, tilt from slope.
        var slope = Water.waveSlope(boat.pos.x, boat.pos.z);
        boat.pos.y = Water.waveHeight(boat.pos.x, boat.pos.z);
        boat.pitch = clamp(-slope.z * 0.9, -0.25, 0.25);
        boat.roll = clamp(slope.x * 0.9, -0.25, 0.25);
        // Gentle extra rock so anchored boats still feel alive.
        var rockPhase = Water.time * 0.8 + i * 1.7;
        boat.roll += Math.sin(rockPhase) * 0.02 * (0.5 + Water.swell);
        boat.pitch += Math.cos(rockPhase * 0.9) * 0.015 * (0.5 + Water.swell);

        // Wake behind a moving boat, throttled per boat.
        if (Math.abs(speed) > 1.2) {
          var key = boat.id !== undefined ? String(boat.id) : "boat" + i;
          Water._wakeTimers[key] = (Water._wakeTimers[key] || 0) - step;
          if (Water._wakeTimers[key] <= 0) {
            Water._wakeTimers[key] = 0.09;
            var heading2 = boat.rotY || 0;
            var stern = {
              x: boat.pos.x - Math.sin(heading2) * 2.2,
              y: WATER_LEVEL,
              z: boat.pos.z - Math.cos(heading2) * 2.2
            };
            Water.wake(stern);
          }
        }
      }
      return Water.time;
    },

    // Splash where something hits the water: a ring of spray particles
    // via FX, sized by impact strength.
    splash: function (pos, strength) {
      var s = clamp(strength || 1, 0.2, 3);
      if (window.SB && SB.FX && typeof SB.FX.spawnParticles === "function") {
        try {
          SB.FX.spawnParticles(
            { x: pos.x || 0, y: WATER_LEVEL + 0.2, z: pos.z || 0 },
            [0.88, 0.94, 1.0],
            Math.floor(10 * s)
          );
        } catch (e) { /* FX is best-effort */ }
      }
      return s;
    },

    // Deep-water color at golden hour, with a glitter term the renderer
    // can add near the sun direction. Returns [r, g, b] 0..1.
    surfaceColor: function (x, z) {
      var h = Water.waveHeight(x, z);
      var base = 0.16 + clamp(h * 0.12, -0.04, 0.06);
      return [0.05 + base * 0.4, base + 0.12, 0.32 + base * 0.5];
    }
  };

  SB.Water = Water;
  // The world module reads the same constant from here when it exists.
  if (window.SB && !SB.World) {
    // Do not create SB.World here; only note the shared level.
  }
})();

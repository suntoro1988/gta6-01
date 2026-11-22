// weather.js — Sunset Bay v14, Builder F.
// Local weather: each of the 14 districts can have its own weather.
// Golden hour is the default: clear skies, low orange sun, thin haze.
// Rain makes roads wet and reduces grip; SB.Vehicles reads the grip
// factor from here every frame through SB.Weather.gripFactor.
// Weather drifts slowly on its own; setWeather() forces a change.

window.SB = window.SB || {};

(function () {
  "use strict";

  // 14 districts — name, centre (x, z) and radius, IDENTICAL to spec §3.
  // city.js and economy.js use the same list; keep all three in sync.
  var DISTRICT_CENTERS = [
    { name: "Marina Bay", x: 0, z: 0, radius: 120, center: { x: 0, z: 0 } },
    { name: "Old Town", x: -120, z: 40, radius: 90, center: { x: -120, z: 40 } },
    { name: "Fisherman's Wharf", x: -185, z: 40, radius: 55, center: { x: -185, z: 40 } },
    { name: "Sunset Strip", x: 120, z: -60, radius: 100, center: { x: 120, z: -60 } },
    { name: "North Hills", x: 60, z: 180, radius: 110, center: { x: 60, z: 180 } },
    { name: "East Market", x: 200, z: 80, radius: 90, center: { x: 200, z: 80 } },
    { name: "Harbor Point", x: -220, z: -80, radius: 80, center: { x: -220, z: -80 } },
    { name: "Palm Court", x: 40, z: -180, radius: 90, center: { x: 40, z: -180 } },
    { name: "Coral District", x: -60, z: -140, radius: 80, center: { x: -60, z: -140 } },
    { name: "Beacon Hill", x: 180, z: 180, radius: 100, center: { x: 180, z: 180 } },
    { name: "Little Havana", x: -160, z: 160, radius: 90, center: { x: -160, z: 160 } },
    { name: "Airport South", x: 260, z: -160, radius: 110, center: { x: 260, z: -160 } },
    { name: "University Row", x: -40, z: 220, radius: 90, center: { x: -40, z: 220 } },
    { name: "Industrial Docks", x: 240, z: 20, radius: 100, center: { x: 240, z: 20 } }
  ];

  // Canonical weather ids. Indonesian names from the design brief map
  // to the same ids so either spelling works at the call site.
  var ALIASES = {
    clear: "clear", cerah: "clear", sunny: "clear", sun: "clear",
    rain: "rain", hujan: "rain", rainy: "rain", storm: "rain",
    fog: "fog", berkabut: "fog", foggy: "fog", mist: "fog",
    cloudy: "cloudy", berawan: "cloudy", overcast: "cloudy"
  };

  var WEATHER_DEFS = {
    clear: {
      label: "Clear",
      sun: [1.0, 0.60, 0.24],
      skyTop: [0.16, 0.32, 0.62],
      skyHorizon: [1.0, 0.62, 0.30],
      fogNear: 180,
      fogFar: 900,
      fogDensity: 0.0012,
      fogColor: [0.98, 0.72, 0.48],
      rainIntensity: 0,
      gripFactor: 1.0,
      sunHeight: 0.18,
      brightness: 1.0
    },
    rain: {
      label: "Rain",
      sun: [0.55, 0.55, 0.58],
      skyTop: [0.22, 0.26, 0.34],
      skyHorizon: [0.55, 0.55, 0.58],
      fogNear: 60,
      fogFar: 420,
      fogDensity: 0.004,
      fogColor: [0.55, 0.58, 0.62],
      rainIntensity: 1.0,
      gripFactor: 0.72,
      sunHeight: 0.10,
      brightness: 0.62
    },
    fog: {
      label: "Foggy",
      sun: [0.95, 0.75, 0.5],
      skyTop: [0.55, 0.58, 0.62],
      skyHorizon: [0.85, 0.78, 0.68],
      fogNear: 25,
      fogFar: 190,
      fogDensity: 0.011,
      fogColor: [0.82, 0.80, 0.74],
      rainIntensity: 0,
      gripFactor: 0.88,
      sunHeight: 0.14,
      brightness: 0.78
    },
    cloudy: {
      label: "Cloudy",
      sun: [0.9, 0.72, 0.5],
      skyTop: [0.30, 0.38, 0.52],
      skyHorizon: [0.85, 0.66, 0.48],
      fogNear: 120,
      fogFar: 650,
      fogDensity: 0.0022,
      fogColor: [0.78, 0.68, 0.58],
      rainIntensity: 0,
      gripFactor: 0.95,
      sunHeight: 0.16,
      brightness: 0.85
    }
  };

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function normalizeWeather(w) {
    if (!w) return "clear";
    var key = String(w).toLowerCase().trim();
    if (ALIASES[key]) return ALIASES[key];
    if (WEATHER_DEFS[key]) return key;
    return "clear";
  }

  function findDistrict(name) {
    for (var i = 0; i < DISTRICT_CENTERS.length; i++) {
      if (DISTRICT_CENTERS[i].name === name) return DISTRICT_CENTERS[i];
    }
    return null;
  }

  // Per-district weather state, seeded clear everywhere (golden hour).
  var districtWeather = {};
  var districtBlend = {};
  DISTRICT_CENTERS.forEach(function (d) {
    districtWeather[d.name] = "clear";
    districtBlend[d.name] = 1.0;
  });

  var Weather = {
    DISTRICT_CENTERS: DISTRICT_CENTERS,
    // Alias used by some callers that expect the spec §3 name.
    DISTRICTS: DISTRICT_CENTERS,

    // Global weather: the weather at the player's current district.
    // Starts clear — golden hour default, low orange sun.
    current: "clear",
    // Indonesian label kept in step for HUD code that reads it.
    currentLabel: "Clear",

    // Live blended values. Vehicles read gripFactor; Render reads the
    // fog and sky values; the sun position comes from sunHeight.
    gripFactor: 1.0,
    wetRoads: false,
    rainIntensity: 0,
    fogDensity: 0.0012,
    fogNear: 180,
    fogFar: 900,
    fogColor: [0.98, 0.72, 0.48],
    sunHeight: 0.18,
    sunColor: [1.0, 0.60, 0.24],
    skyTop: [0.16, 0.32, 0.62],
    skyHorizon: [1.0, 0.62, 0.30],
    brightness: 1.0,

    // Golden hour sun: low in the west, warm orange. Render positions
    // the sun disc from this direction vector.
    sunDirection: { x: -0.85, y: 0.18, z: -0.35 },
    // Time of day in hours, 17.5 = 5:30 PM golden hour.
    timeOfDay: 17.5,
    dayNight: 0.35,

    // Internal clock for slow drift and rain splash spawning.
    elapsed: 0,
    changeTimer: 0,
    // Rain splash particles are spawned near the player, throttled here.
    splashTimer: 0,

    getDistrictAt: function (x, z) {
      var best = null;
      var bestDist = Infinity;
      for (var i = 0; i < DISTRICT_CENTERS.length; i++) {
        var d = DISTRICT_CENTERS[i];
        var dx = x - d.x;
        var dz = z - d.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < d.radius && dist < bestDist) {
          best = d;
          bestDist = dist;
        }
      }
      if (best) return best.name;
      // Outside every radius: nearest district still governs the sky.
      var nearest = null;
      var nearestDist = Infinity;
      for (var j = 0; j < DISTRICT_CENTERS.length; j++) {
        var e = DISTRICT_CENTERS[j];
        var ex = x - e.x;
        var ez = z - e.z;
        var ed = Math.sqrt(ex * ex + ez * ez) - e.radius;
        if (ed < nearestDist) {
          nearestDist = ed;
          nearest = e;
        }
      }
      return nearest ? nearest.name : "Marina Bay";
    },

    getWeatherAt: function (x, z) {
      return Weather.getDistrictWeather(Weather.getDistrictAt(x, z));
    },

    getDistrictWeather: function (name) {
      if (districtWeather[name]) return districtWeather[name];
      return Weather.current;
    },

    setDistrictWeather: function (name, w) {
      var id = normalizeWeather(w);
      if (!findDistrict(name)) return Weather.current;
      districtWeather[name] = id;
      districtBlend[name] = 0;
      Weather.refreshFromPlayerDistrict();
      return id;
    },

    // Force the global weather (and every district) to w.
    // Accepts "clear" / "rain" / "fog" / "cloudy" and the Indonesian
    // equivalents "cerah" / "hujan" / "berkabut".
    setWeather: function (w) {
      var id = normalizeWeather(w);
      Weather.current = id;
      Weather.currentLabel = WEATHER_DEFS[id].label;
      for (var i = 0; i < DISTRICT_CENTERS.length; i++) {
        districtWeather[DISTRICT_CENTERS[i].name] = id;
        districtBlend[DISTRICT_CENTERS[i].name] = 0;
      }
      Weather.applyDef(id, 1.0);
      Weather.changeTimer = 0;
      return Weather.current;
    },

    // Blend the live values toward a weather definition by t (0..1).
    applyDef: function (id, t) {
      var def = WEATHER_DEFS[id] || WEATHER_DEFS.clear;
      var k = clamp(t, 0, 1);
      Weather.gripFactor = lerp(Weather.gripFactor, def.gripFactor, k);
      Weather.rainIntensity = lerp(Weather.rainIntensity, def.rainIntensity, k);
      Weather.fogDensity = lerp(Weather.fogDensity, def.fogDensity, k);
      Weather.fogNear = lerp(Weather.fogNear, def.fogNear, k);
      Weather.fogFar = lerp(Weather.fogFar, def.fogFar, k);
      Weather.brightness = lerp(Weather.brightness, def.brightness, k);
      Weather.sunHeight = lerp(Weather.sunHeight, def.sunHeight, k);
      for (var i = 0; i < 3; i++) {
        Weather.fogColor[i] = lerp(Weather.fogColor[i], def.fogColor[i], k);
        Weather.sunColor[i] = lerp(Weather.sunColor[i], def.sun[i], k);
        Weather.skyTop[i] = lerp(Weather.skyTop[i], def.skyTop[i], k);
        Weather.skyHorizon[i] = lerp(Weather.skyHorizon[i], def.skyHorizon[i], k);
      }
      Weather.wetRoads = Weather.rainIntensity > 0.25;
      Weather.sunDirection.y = Weather.sunHeight;
    },

    // Recompute the global weather from the player's district, so
    // driving into a rainy district actually changes handling and fog.
    refreshFromPlayerDistrict: function () {
      var px = 0;
      var pz = 0;
      try {
        if (window.SB && SB.Game && SB.Game.state && SB.Game.state.player) {
          px = SB.Game.state.player.pos.x || 0;
          pz = SB.Game.state.player.pos.z || 0;
        } else if (window.SB && SB.Player && SB.Player.pos) {
          px = SB.Player.pos.x || 0;
          pz = SB.Player.pos.z || 0;
        }
      } catch (e) { /* player position is best-effort */ }
      var district = Weather.getDistrictAt(px, pz);
      var id = districtWeather[district] || "clear";
      if (id !== Weather.current) {
        Weather.current = id;
        Weather.currentLabel = WEATHER_DEFS[id].label;
      }
      // Blend toward the district weather rather than snapping, so a
      // border crossing fades in over about two seconds.
      Weather.applyDef(id, 0.04);
      // Rain splashes near the player while it rains here.
      if (Weather.rainIntensity > 0.3 && window.SB && SB.FX) {
        Weather.splashTimer -= 0.016;
        if (Weather.splashTimer <= 0) {
          Weather.splashTimer = 0.12;
          try {
            SB.FX.rainSplash({
              x: px + (Math.random() - 0.5) * 24,
              y: 0,
              z: pz + (Math.random() - 0.5) * 24
            });
          } catch (e) { /* FX is best-effort */ }
        }
      }
      return Weather.current;
    },

    // Slow drift: every 45–90 seconds one random district changes
    // weather; clear is the most likely outcome so golden hour returns.
    // Also advances the clock a little so day/night moves.
    update: function (dt) {
      var step = Math.max(0, Math.min(0.1, dt || 0.016));
      Weather.elapsed += step;
      Weather.changeTimer += step;
      // Golden hour drifts slowly toward dusk, then holds: the game is
      // set at sunset, so the clock creeps from 17.5 toward 18.4.
      Weather.timeOfDay = Math.min(18.4, Weather.timeOfDay + step * 0.004);
      var dusk = clamp((Weather.timeOfDay - 17.5) / 0.9, 0, 1);
      Weather.dayNight = 0.35 + dusk * 0.45;
      Weather.sunHeight = lerp(Weather.sunHeight, 0.18 - dusk * 0.10, step * 0.05);
      Weather.sunDirection.y = Weather.sunHeight;

      if (Weather.changeTimer > 60) {
        Weather.changeTimer = 0;
        var pick = DISTRICT_CENTERS[Math.floor(Math.random() * DISTRICT_CENTERS.length)];
        var roll = Math.random();
        var next = roll < 0.55 ? "clear" : roll < 0.8 ? "cloudy" : roll < 0.92 ? "rain" : "fog";
        districtWeather[pick.name] = next;
        districtBlend[pick.name] = 0;
      }
      Weather.refreshFromPlayerDistrict();
      return Weather.current;
    },

    // Visibility for the renderer and for gameplay (police sight range).
    // Returns an object; getFogDistance() returns the far plane as a
    // plain number for callers that only need one value.
    getFog: function () {
      return {
        near: Weather.fogNear,
        far: Weather.fogFar,
        distance: Weather.fogFar,
        density: Weather.fogDensity,
        color: [Weather.fogColor[0], Weather.fogColor[1], Weather.fogColor[2]]
      };
    },

    getFogDistance: function () {
      return Weather.fogFar;
    },

    isRaining: function () {
      return Weather.rainIntensity > 0.3;
    },

    isFoggy: function () {
      return Weather.current === "fog";
    },

    // Handling multiplier the vehicle code multiplies into grip.
    // 1.0 dry, ~0.72 in rain, ~0.88 in fog, ~0.95 under cloud.
    getGrip: function () {
      return Weather.gripFactor;
    },

    // Sky colors for the renderer, already blended toward the current
    // district weather and the dusk progression.
    getSky: function () {
      return {
        top: [Weather.skyTop[0], Weather.skyTop[1], Weather.skyTop[2]],
        horizon: [Weather.skyHorizon[0], Weather.skyHorizon[1], Weather.skyHorizon[2]],
        sun: [Weather.sunColor[0], Weather.sunColor[1], Weather.sunColor[2]],
        sunDirection: { x: Weather.sunDirection.x, y: Weather.sunDirection.y, z: Weather.sunDirection.z },
        brightness: Weather.brightness
      };
    }
  };

  SB.Weather = Weather;
})();

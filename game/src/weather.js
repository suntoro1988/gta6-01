window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.Weather — siklus siang-malam, cuaca LOKAL, genangan, pelangi, angin.
  // Sunset Bay v12. Ditulis dari nol dari design spec; tidak membaca modul lain.
  // Semua akses ke modul lain dijaga guard (SB.GL / SB.City / SB.Rng).
  // ---------------------------------------------------------------------------

  // Satu hari game = 24 menit waktu nyata (1 detik nyata = 1 menit game).
  var TIME_SCALE = 1 / 60;          // jam game per detik nyata
  var GOLDEN_HOUR = 18.33;          // 18:20 default — start golden hour
  var NIGHT_START = 19.5;           // 19:30
  var NIGHT_END = 5.5;              // 05:30
  var SUNRISE = 6.0;
  var SUNSET = 19.0;

  // Keyframe langit: [jam, langitAtas, langitBawah, matahari, kabut, ambient]
  // Warna hangat-dingin, bukan tengah hari datar.
  var SKY_KEYS = [
    // jam,   top                 horizon             sun                 fog                 ambient
    [0.0,   [0.016, 0.020, 0.055], [0.055, 0.055, 0.120], [0.10, 0.10, 0.16], [0.020, 0.024, 0.060], [0.10, 0.11, 0.16]],
    [4.5,   [0.020, 0.024, 0.070], [0.070, 0.060, 0.130], [0.10, 0.10, 0.18], [0.024, 0.028, 0.075], [0.11, 0.12, 0.17]],
    [6.0,   [0.180, 0.260, 0.470], [0.980, 0.560, 0.300], [1.00, 0.62, 0.30], [0.420, 0.300, 0.330], [0.35, 0.32, 0.38]],
    [8.0,   [0.300, 0.520, 0.820], [0.720, 0.820, 0.950], [1.00, 0.90, 0.72], [0.620, 0.700, 0.820], [0.62, 0.66, 0.72]],
    [12.0,  [0.260, 0.500, 0.860], [0.680, 0.800, 0.960], [1.00, 0.96, 0.85], [0.600, 0.690, 0.830], [0.66, 0.70, 0.76]],
    [16.0,  [0.300, 0.500, 0.800], [0.780, 0.740, 0.700], [1.00, 0.82, 0.55], [0.620, 0.620, 0.680], [0.60, 0.62, 0.68]],
    [17.5,  [0.380, 0.340, 0.620], [1.00, 0.580, 0.300], [1.00, 0.60, 0.24], [0.700, 0.480, 0.420], [0.55, 0.48, 0.55]],
    [18.33, [0.300, 0.210, 0.480], [1.00, 0.480, 0.180], [1.00, 0.55, 0.20], [0.640, 0.400, 0.330], [0.48, 0.40, 0.50]], // golden hour
    [19.0,  [0.200, 0.130, 0.380], [0.850, 0.320, 0.220], [0.95, 0.38, 0.14], [0.500, 0.300, 0.300], [0.38, 0.30, 0.42]],
    [19.5,  [0.070, 0.060, 0.200], [0.300, 0.130, 0.240], [0.45, 0.20, 0.16], [0.140, 0.120, 0.200], [0.20, 0.19, 0.28]],
    [21.0,  [0.020, 0.024, 0.070], [0.090, 0.070, 0.150], [0.12, 0.12, 0.20], [0.030, 0.032, 0.080], [0.12, 0.13, 0.19]],
    [24.0,  [0.016, 0.020, 0.055], [0.055, 0.055, 0.120], [0.10, 0.10, 0.16], [0.020, 0.024, 0.060], [0.10, 0.11, 0.16]]
  ];

  var stateRef = null;

  // Status internal cuaca — semua angka 0..1 kecuali yang berlabel lain.
  var W = {
    timeOfDay: GOLDEN_HOUR,
    day: 1,
    sunDir: { x: -0.55, y: 0.28, z: -0.45 },
    sunColor: [1.0, 0.55, 0.20],
    skyTop: [0.30, 0.21, 0.48],
    skyHorizon: [1.0, 0.48, 0.18],
    fogColor: [0.64, 0.40, 0.33],
    ambient: [0.48, 0.40, 0.50],
    fogNear: 60,
    fogFar: 420,
    clouds: 0.3,            // tutupan awan 0..1
    cloudDrift: 0,          // offset awan (digerakkan angin)
    wind: 0.2,              // kekuatan angin 0..1
    windDir: 0.6,           // arah angin (radian)
    windGust: 0,
    rain: 0,                // intensitas hujan global 0..1 (di dalam area)
    rainArea: null,         // {x, z, radius} | null = hujan merata / tidak ada
    rainTarget: 0,
    puddles: 0,             // genangan 0..1 — bertahan setelah hujan
    rainbowStrength: 0,
    rainbowPos: null,       // {x, y, z} ujung pelangi di langit
    phase: 'golden',        // dawn | day | golden | dusk | night
    stormTimer: 0,          // jeda acak antar hujan lokal
    nextStormIn: 240        // detik sampai badai lokal berikutnya
  };

  // -- util lokal -------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(out, a, b, t) {
    out[0] = lerp(a[0], b[0], t);
    out[1] = lerp(a[1], b[1], t);
    out[2] = lerp(a[2], b[2], t);
    return out;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }

  // Interpolasi keyframe langit pada jam h.
  function sampleSky(h) {
    var i, k0 = SKY_KEYS[0], k1 = SKY_KEYS[SKY_KEYS.length - 1];
    for (i = 0; i < SKY_KEYS.length - 1; i++) {
      if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) {
        k0 = SKY_KEYS[i];
        k1 = SKY_KEYS[i + 1];
        break;
      }
    }
    var span = k1[0] - k0[0];
    var t = span > 0 ? smooth(clamp((h - k0[0]) / span, 0, 1)) : 0;
    lerp3(W.skyTop, k0[1], k1[1], t);
    lerp3(W.skyHorizon, k0[2], k1[2], t);
    lerp3(W.sunColor, k0[3], k1[3], t);
    lerp3(W.fogColor, k0[4], k1[4], t);
    lerp3(W.ambient, k0[5], k1[5], t);
  }

  // Arah matahari dari jam: terbit timur (06.00), tenggelam barat (19.00).
  function computeSunDir(h) {
    var frac = clamp((h - SUNRISE) / (SUNSET - SUNRISE), 0, 1);
    var elev = Math.sin(frac * Math.PI);            // 0 di horizon, 1 di tengah hari
    var azim = lerp(-1.35, 1.35, frac);             // timur -> barat
    var ce = Math.cos(elev * 1.25);
    W.sunDir.x = Math.sin(azim) * ce;
    W.sunDir.y = Math.max(0.02, elev);
    W.sunDir.z = Math.cos(azim) * ce * 0.6 - 0.25;
    // Malam: bulan menggantikan matahari, tinggi & redup.
    if (isNightHour(h)) {
      var nf = clamp((h - NIGHT_START) / 2, 0, 1);
      if (h < NIGHT_END) nf = clamp((NIGHT_END - h) / 2, 0, 1) * 0.5 + 0.5;
      W.sunDir.x = -0.35;
      W.sunDir.y = 0.55 + nf * 0.2;
      W.sunDir.z = -0.55;
      W.sunColor[0] = 0.55; W.sunColor[1] = 0.62; W.sunColor[2] = 0.85;
    }
    return W.sunDir;
  }

  function isNightHour(h) { return h >= NIGHT_START || h < NIGHT_END; }

  function phaseFor(h) {
    if (isNightHour(h)) return 'night';
    if (h >= 17.0 && h < NIGHT_START) return 'golden';
    if (h >= SUNRISE && h < 8.0) return 'dawn';
    if (h >= NIGHT_START - 0.5 && h < NIGHT_START) return 'dusk';
    return 'day';
  }

  // Hujan lokal: pilih distrik acak sebagai pusat badai.
  function pickStormArea() {
    var area = null;
    if (window.SB && SB.City && SB.City.districts && SB.City.districts.length) {
      var name = SB.City.districts[Math.floor(Math.random() * SB.City.districts.length)];
      if (SB.City.districtAt) {
        // Cari posisi perwakilan distrik lewat jalan acak sampai cocok.
        for (var tries = 0; tries < 24; tries++) {
          var p = SB.City.randomStreetPos ? SB.City.randomStreetPos() : null;
          if (p && SB.City.districtAt(p.x, p.z) === name) {
            area = { x: p.x, z: p.z, radius: 90 + Math.random() * 70, name: name };
            break;
          }
        }
      }
      if (!area) area = { x: (Math.random() - 0.5) * 300, z: (Math.random() - 0.5) * 300, radius: 110, name: name };
    } else {
      area = { x: (Math.random() - 0.5) * 320, z: (Math.random() - 0.5) * 320, radius: 100 + Math.random() * 80, name: null };
    }
    return area;
  }

  // -- API wajib --------------------------------------------------------------

  function init(state) {
    stateRef = state || null;
    W.timeOfDay = (state && typeof state.timeOfDay === 'number') ? state.timeOfDay : GOLDEN_HOUR;
    W.day = (state && state.day) || 1;
    W.clouds = 0.3;
    W.wind = 0.2;
    W.windDir = 0.6;
    W.rain = 0;
    W.rainTarget = 0;
    W.rainArea = null;
    W.puddles = (state && state.weather) ? (state.weather.puddles || 0) : 0;
    W.rainbowStrength = 0;
    W.rainbowPos = null;
    W.cloudDrift = 0;
    W.stormTimer = 0;
    W.nextStormIn = 180 + Math.random() * 240;
    sampleSky(W.timeOfDay);
    computeSunDir(W.timeOfDay);
    W.phase = phaseFor(W.timeOfDay);
    syncState();
  }

  // Majukan jam game. dt dalam detik nyata.
  function advanceTime(dt) {
    var before = W.timeOfDay;
    W.timeOfDay += dt * TIME_SCALE;
    while (W.timeOfDay >= 24) {
      W.timeOfDay -= 24;
      W.day += 1;
      if (stateRef) stateRef.day = W.day;
    }
    // Lewat tengah malam -> genangan mengering lebih cepat (dingin + sepi).
    if (before < 24 && W.timeOfDay < before) {
      W.puddles = Math.max(0, W.puddles - 0.05);
    }
    if (stateRef) stateRef.timeOfDay = W.timeOfDay;
  }

  function update(dt, state) {
    if (state) stateRef = state;
    dt = Math.min(dt || 0.016, 0.25);
    advanceTime(dt);
    var h = W.timeOfDay;
    var t = (stateRef && stateRef.time) || 0;

    sampleSky(h);
    computeSunDir(h);
    W.phase = phaseFor(h);

    // -- Angin: berubah pelan (gelombang sinus bertumpuk) + hembusan sesaat.
    var gustWave = Math.sin(t * 0.11) * 0.5 + Math.sin(t * 0.031 + 1.7) * 0.5;
    W.windGust = clamp(gustWave, -1, 1);
    var baseWind = 0.18 + 0.10 * Math.sin(t * 0.007 + 2.0);
    W.wind = clamp(baseWind + W.windGust * 0.12 + W.rain * 0.25, 0, 1);
    W.windDir += Math.sin(t * 0.013) * 0.0006 * dt * 60;
    // Awan bergerak mengikuti angin.
    W.cloudDrift += W.wind * dt * 1.6;
    W.clouds = clamp(W.clouds + Math.sin(t * 0.005) * 0.0004 * dt * 60 + W.rain * 0.002, 0.05, 0.95);

    // -- Hujan lokal terjadwal: badai muncul di satu distrik, lalu reda.
    W.stormTimer += dt;
    if (!W.rainArea && W.stormTimer >= W.nextStormIn && !isNightHour(h)) {
      W.rainArea = pickStormArea();
      W.rainTarget = 0.35 + Math.random() * 0.55;
      W.stormTimer = 0;
    }
    if (W.rainArea) {
      W.rain += (W.rainTarget - W.rain) * Math.min(1, dt * 0.25);
      // Badai berlangsung 60-150 detik lalu reda.
      if (W.stormTimer > 60 + W.rainTarget * 120) {
        W.rainTarget = 0;
        if (W.rain < 0.03) {
          W.rainArea = null;
          W.rain = 0;
          W.stormTimer = 0;
          W.nextStormIn = 240 + Math.random() * 360;
        }
      }
    } else {
      W.rain += (0 - W.rain) * Math.min(1, dt * 0.4);
    }

    // -- Genangan: naik saat hujan, surut pelan setelah hujan berhenti.
    if (W.rain > 0.05) {
      W.puddles = clamp(W.puddles + W.rain * dt * 0.012, 0, 1);
    } else {
      var dryRate = isNightHour(h) ? 0.004 : 0.010; // siang lebih cepat kering
      W.puddles = Math.max(0, W.puddles - dryRate * dt);
    }

    // -- Pelangi: hujan + matahari rendah di belakang pengamat.
    var sunLow = W.sunDir.y > 0.03 && W.sunDir.y < 0.45;
    var rainbowTarget = (W.rain > 0.15 && sunLow && !isNightHour(h)) ? clamp(W.rain, 0, 1) : 0;
    W.rainbowStrength += (rainbowTarget - W.rainbowStrength) * Math.min(1, dt * 0.5);
    if (W.rainbowStrength > 0.05) {
      // Pelangi berlawanan arah matahari, busur di atas horizon.
      W.rainbowPos = {
        x: -W.sunDir.x * 260,
        y: 55 + W.rainbowStrength * 40,
        z: -W.sunDir.z * 260
      };
    } else {
      W.rainbowPos = null;
    }

    // -- Kabut: hujan memperpendek jarak pandang, malam lebih pekat.
    W.fogNear = lerp(60, 26, W.rain);
    W.fogFar = lerp(430, 190, W.rain);
    if (isNightHour(h)) W.fogFar = Math.min(W.fogFar, 300);

    // -- Dorong ke GL (guard): matahari + kabut + langit.
    if (window.SB && SB.GL) {
      if (SB.GL.setSun) SB.GL.setSun(W.sunDir, W.sunColor);
      if (SB.GL.setFog) SB.GL.setFog(W.fogColor, W.fogNear, W.fogFar);
    }

    syncState();
  }

  // Hujan lokal manual: area = {x,z,radius} atau nama distrik; amount 0..1.
  // amount 0 = berhentikan hujan.
  function setRain(area, amount) {
    amount = clamp(typeof amount === 'number' ? amount : 0.6, 0, 1);
    if (amount <= 0) {
      W.rainTarget = 0;
      W.rainArea = null;
      W.rain = 0;
      W.stormTimer = 0;
      W.nextStormIn = 300 + Math.random() * 300;
      syncState();
      return;
    }
    if (typeof area === 'string') {
      // Nama distrik -> cari pusatnya lewat jalan acak.
      var found = null;
      if (window.SB && SB.City && SB.City.randomStreetPos && SB.City.districtAt) {
        for (var i = 0; i < 40; i++) {
          var p = SB.City.randomStreetPos();
          if (p && SB.City.districtAt(p.x, p.z) === area) { found = p; break; }
        }
      }
      W.rainArea = found
        ? { x: found.x, z: found.z, radius: 110, name: area }
        : { x: 0, z: 0, radius: 130, name: area };
    } else if (area && typeof area.x === 'number' && typeof area.z === 'number') {
      W.rainArea = { x: area.x, z: area.z, radius: area.radius || 110, name: area.name || null };
    } else {
      W.rainArea = pickStormArea();
    }
    W.rainTarget = amount;
    W.rain = Math.max(W.rain, amount * 0.4);
    W.stormTimer = 0;
    syncState();
  }

  function isNight() { return isNightHour(W.timeOfDay); }

  // Pelangi saat ini: null bila tidak ada, atau {x,y,z,strength}.
  function rainbow() {
    if (!W.rainbowPos || W.rainbowStrength < 0.05) return null;
    return {
      x: W.rainbowPos.x,
      y: W.rainbowPos.y,
      z: W.rainbowPos.z,
      strength: W.rainbowStrength
    };
  }

  // -- Helper tambahan (dipakai modul lain via guard, bukan API wajib) --------
  function syncState() {
    if (!stateRef) return;
    stateRef.timeOfDay = W.timeOfDay;
    stateRef.day = W.day;
    if (!stateRef.weather) stateRef.weather = { rain: 0, rainArea: null, clouds: 0.3, wind: 0.2, puddles: 0 };
    stateRef.weather.rain = W.rain;
    stateRef.weather.rainArea = W.rainArea;
    stateRef.weather.clouds = W.clouds;
    stateRef.weather.wind = W.wind;
    stateRef.weather.puddles = W.puddles;
    stateRef.weather.windDir = W.windDir;
    stateRef.weather.rainbow = W.rainbowStrength;
    stateRef.weather.phase = W.phase;
  }

  // Apakah titik (x,z) sedang kehujanan? Hujan itu LOKAL.
  function isRainingAt(x, z) {
    if (!W.rainArea || W.rain < 0.05) return false;
    var dx = x - W.rainArea.x, dz = z - W.rainArea.z;
    return (dx * dx + dz * dz) < W.rainArea.radius * W.rainArea.radius;
  }

  function sunPosition() { return { x: W.sunDir.x, y: W.sunDir.y, z: W.sunDir.z }; }
  function skyColors() {
    return { top: W.skyTop.slice(), horizon: W.skyHorizon.slice(), sun: W.sunColor.slice(), fog: W.fogColor.slice(), ambient: W.ambient.slice() };
  }
  function phase() { return phaseFor(W.timeOfDay); }
  function windVector() {
    return { x: Math.cos(W.windDir) * W.wind, z: Math.sin(W.windDir) * W.wind, strength: W.wind, gust: W.windGust };
  }

  window.SB.Weather = {
    init: init,
    update: update,
    setRain: setRain,
    advanceTime: advanceTime,
    isNight: isNight,
    rainbow: rainbow,
    // helper
    isRainingAt: isRainingAt,
    sunPosition: sunPosition,
    skyColors: skyColors,
    phase: phase,
    windVector: windVector,
    // status baca-saja (game.js / HUD boleh intip)
    status: W
  };
})();

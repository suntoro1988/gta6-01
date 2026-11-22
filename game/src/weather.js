window.SB = window.SB || {};
(function(){ 'use strict';

  // ---------------------------------------------------------------------------
  // SB.Weather — cuaca lokal + siklus siang-malam Sunset Bay (v13, fresh).
  // Hujan LOKAL: satu area bisa hujan deras sementara distrik lain cerah.
  // Siklus waktu: golden hour default 18:20, neon menyala saat malam.
  // Modul ini TIDAK membaca modul lain; ia hanya menulis hasil hitungannya
  // ke state.weather supaya game.js / gl.js bisa memakainya saat menggambar.
  // ---------------------------------------------------------------------------

  var GOLDEN_HOUR = 18.33;      // 18:20 — jam default saat game dimulai
  var SUNSET_START = 17.75;     // matahari mulai merendah
  var NIGHT_START = 19.5;       // 19:30 — gelap penuh, neon menyala
  var DAWN_END = 5.75;          // 05:45 — fajar selesai
  var DAY_LENGTH = 24;          // jam dalam satu hari game
  var TIME_SCALE = 1;           // 1 detik nyata = 1 detik game (game atur)

  // Pusat distrik (x, z, radius) untuk hujan lokal berbasis nama distrik.
  // Koordinat mengikuti city.js DISTRICT_INFO (14 distrik Sunset Bay).
  var DISTRICT_CENTERS = {
    'Marina Bay':        { x: -150, z:  120, r: 70 },
    'Sunset Beach':      { x:   40, z:  185, r: 80 },
    'Downtown':          { x:    0, z:    0, r: 75 },
    'Old Town':          { x: -100, z:  -60, r: 60 },
    'Neon Strip':        { x:   80, z:  -40, r: 60 },
    'Harbour Heights':   { x: -140, z: -140, r: 65 },
    'Palm Court':        { x:  120, z:  100, r: 60 },
    "Fisherman's Wharf": { x: -185, z:   40, r: 55 },
    'University Hill':   { x:  140, z: -120, r: 60 },
    'Industrial Park':   { x:  160, z:   20, r: 65 },
    'Coral Gardens':     { x:  -40, z:  140, r: 55 },
    'Sunset Hills':      { x:   60, z: -160, r: 60 },
    'Boardwalk':         { x: -120, z:  175, r: 55 },
    'The Docks':         { x: -190, z: -100, r: 50 }
  };

  // Preset cuaca bernama: dipakai update() untuk transisi alami.
  var PRESETS = {
    clear:   { rain: 0.00, clouds: 0.15, wind: 0.20 },
    sunny:   { rain: 0.00, clouds: 0.10, wind: 0.15 },
    cloudy:  { rain: 0.00, clouds: 0.65, wind: 0.35 },
    overcast:{ rain: 0.05, clouds: 0.90, wind: 0.45 },
    drizzle: { rain: 0.30, clouds: 0.80, wind: 0.40 },
    storm:   { rain: 0.90, clouds: 1.00, wind: 0.85 },
    golden:  { rain: 0.00, clouds: 0.25, wind: 0.20 }
  };

  var _state = null;            // referensi SB.state (diset di init)
  var _t = 0;                   // waktu internal (detik)
  var _rainArea = null;         // {x, z, r, amount} | null
  var _rainTarget = 0;          // target intensitas hujan lokal
  var _rainCurrent = 0;         // intensitas hujan lokal saat ini (0..1)
  var _cloudDrift = 0;          // posisi awan (0..1, melayang ikut angin)
  var _windDir = 0.6;           // arah angin (radian)
  var _windGust = 0;            // hembusan sesaat (0..1)
  var _gustTimer = 0;           // penghitung hembusan berikutnya
  var _puddles = 0;             // genangan (0..1), bertahan setelah hujan
  var _rainbow = 0;             // intensitas pelangi (0..1)
  var _rainbowAngle = 0;        // sudut busur pelangi
  var _wasRaining = false;      // hujan baru saja berhenti?
  var _dryTimer = 0;            // jeda sebelum pelangi muncul
  var _stormTimer = 0;          // penghitung badai acak
  var _preset = 'golden';       // preset aktif
  var _presetTimer = 0;         // durasi preset berjalan
  var _lightning = 0;           // kilat sesaat (0..1)
  var _lightningTimer = 0;

  // -- util lokal ------------------------------------------------------------
  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function smooth(t){ t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  // Campur dua warna [r,g,b] dengan faktor t.
  function mixColor(c1, c2, t){
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
  }

  // Palet langit per fase hari: [atas, bawah, matahari, kabut].
  var SKY = {
    night:  { top: [0.03, 0.04, 0.12], low: [0.10, 0.08, 0.20], sun: [0.35, 0.45, 0.80], fog: [0.05, 0.06, 0.14] },
    dawn:   { top: [0.35, 0.30, 0.55], low: [0.98, 0.55, 0.35], sun: [1.00, 0.55, 0.30], fog: [0.45, 0.35, 0.45] },
    day:    { top: [0.30, 0.55, 0.90], low: [0.75, 0.85, 0.95], sun: [1.00, 0.95, 0.80], fog: [0.70, 0.78, 0.88] },
    golden: { top: [0.45, 0.25, 0.55], low: [1.00, 0.60, 0.25], sun: [1.00, 0.60, 0.24], fog: [0.85, 0.55, 0.40] },
    dusk:   { top: [0.15, 0.12, 0.35], low: [0.90, 0.35, 0.25], sun: [1.00, 0.45, 0.20], fog: [0.45, 0.30, 0.40] }
  };

  // Fase hari dari jam: 'night' | 'dawn' | 'day' | 'golden' | 'dusk'.
  function phaseOf(hour){
    if (hour < 5.0 || hour >= NIGHT_START) return 'night';
    if (hour < DAWN_END) return 'dawn';
    if (hour >= SUNSET_START && hour < 18.6) return 'golden';
    if (hour >= 18.6 && hour < NIGHT_START) return 'dusk';
    return 'day';
  }

  // Ketinggian matahari (-1 malam .. 1 siang) dari jam.
  function sunHeight(hour){
    // Siang pukul 12 = puncak; 06 terbit, 19 terbenam (kira-kira).
    var a = (hour - 6) / 13 * Math.PI;
    return Math.sin(a);
  }

  // -- API -------------------------------------------------------------------

  function init(state){
    _state = state || null;
    _t = 0;
    _rainArea = null;
    _rainTarget = 0;
    _rainCurrent = 0;
    _cloudDrift = 0.2;
    _windDir = 0.6;
    _windGust = 0;
    _gustTimer = 4;
    _puddles = 0;
    _rainbow = 0;
    _rainbowAngle = 0.6;
    _wasRaining = false;
    _dryTimer = 0;
    _stormTimer = 90 + Math.random() * 120;
    _preset = 'golden';
    _presetTimer = 0;
    _lightning = 0;
    _lightningTimer = 0;
    if (_state){
      if (typeof _state.timeOfDay !== 'number') _state.timeOfDay = GOLDEN_HOUR;
      if (!_state.weather) _state.weather = {};
      _state.weather.rain = 0;
      _state.weather.rainArea = null;
      _state.weather.clouds = 0.25;
      _state.weather.wind = 0.2;
      _state.weather.puddles = 0;
      _state.weather.rainbow = 0;
      _state.weather.neon = 0;
      _state.weather.sunDir = { x: -0.55, y: 0.35, z: -0.75 };
      _state.weather.sunColor = [1.0, 0.60, 0.24];
      _state.weather.skyTop = SKY.golden.top.slice();
      _state.weather.skyBottom = SKY.golden.low.slice();
      _state.weather.fogColor = SKY.golden.fog.slice();
      _state.weather.fogNear = 120;
      _state.weather.fogFar = 520;
      _state.weather.lightning = 0;
    }
    return true;
  }

  // Hujan LOKAL: area = {x,z,r} | nama distrik (string) | null (matikan).
  // amount 0..1. Hanya area itu yang hujan; distrik lain tetap cerah.
  function setRain(area, amount){
    var amt = clamp(typeof amount === 'number' ? amount : 0.6, 0, 1);
    if (area === null || area === undefined || amt <= 0){
      _rainTarget = 0;
      _rainArea = null;
      if (_state && _state.weather) _state.weather.rainArea = null;
      return true; // hujan berhasil dimatikan
    }
    var a = null;
    if (typeof area === 'string'){
      var c = DISTRICT_CENTERS[area];
      if (!c){ return false; }
      a = { x: c.x, z: c.z, r: c.r };
    } else if (typeof area === 'object'){
      a = {
        x: typeof area.x === 'number' ? area.x : 0,
        z: typeof area.z === 'number' ? area.z : 0,
        r: typeof area.r === 'number' ? area.r : (typeof area.radius === 'number' ? area.radius : 80)
      };
    } else {
      return false;
    }
    _rainArea = a;
    _rainTarget = amt;
    if (_state && _state.weather){
      _state.weather.rainArea = { x: a.x, z: a.z, r: a.r, amount: amt };
    }
    return true;
  }

  // Maju jam hari. dt detik nyata. 1 detik nyata = TIME_SCALE detik game.
  // Lewat tengah malam: day + 1, jam kembali 0.
  function advanceTime(dt){
    if (!_state) return GOLDEN_HOUR;
    var step = (dt || 0) * TIME_SCALE / 3600; // detik -> jam
    var h = (typeof _state.timeOfDay === 'number' ? _state.timeOfDay : GOLDEN_HOUR) + step;
    while (h >= DAY_LENGTH){
      h -= DAY_LENGTH;
      _state.day = (_state.day || 1) + 1;
    }
    _state.timeOfDay = h;
    return h;
  }

  // Malam: sebelum fajar selesai atau setelah 19:30.
  function isNight(){
    var h = _state && typeof _state.timeOfDay === 'number' ? _state.timeOfDay : GOLDEN_HOUR;
    return h < DAWN_END || h >= NIGHT_START;
  }

  // Pelangi: muncul setelah hujan berhenti + genangan masih ada.
  // Mengembalikan {visible, intensity, angle, colors} atau null bila tidak ada.
  function rainbow(){
    if (_rainbow <= 0.02) return null;
    return {
      visible: true,
      intensity: _rainbow,
      angle: _rainbowAngle,
      colors: [
        [1.0, 0.25, 0.25], [1.0, 0.55, 0.15], [1.0, 0.90, 0.20],
        [0.30, 0.85, 0.30], [0.25, 0.55, 1.00], [0.55, 0.30, 0.85]
      ]
    };
  }

  // Apakah titik (x,z) sedang kehujanan? (untuk FX / audio / gameplay)
  function isRainingAt(x, z){
    if (!_rainArea || _rainCurrent <= 0.05) return false;
    var dx = x - _rainArea.x, dz = z - _rainArea.z;
    return (dx * dx + dz * dz) <= _rainArea.r * _rainArea.r;
  }

  function update(dt, state){
    if (state) _state = state;
    if (!_state) return;
    dt = Math.min(typeof dt === 'number' ? dt : 0.016, 0.1);
    _t += dt;

    // 1) Waktu berjalan.
    advanceTime(dt);
    var hour = _state.timeOfDay;
    var phase = phaseOf(hour);
    var sh = sunHeight(hour);

    // 2) Preset cuaca berganti pelan (badai acak sesekali, siang hari saja).
    _presetTimer += dt;
    _stormTimer -= dt;
    if (_stormTimer <= 0){
      _stormTimer = 150 + Math.random() * 180;
      if (!isNight() && Math.random() < 0.4){
        _preset = 'storm';
        _presetTimer = 0;
        // Badai selalu lokal: pilih satu distrik acak.
        var names = Object.keys(DISTRICT_CENTERS);
        var pick = names[Math.floor(Math.random() * names.length)];
        setRain(pick, 0.7 + Math.random() * 0.3);
      }
    }
    if (_presetTimer > 60){
      _presetTimer = 0;
      // Kembali cerah / golden sesuai jam.
      _preset = (phase === 'golden' || phase === 'dusk') ? 'golden' : (Math.random() < 0.7 ? 'clear' : 'cloudy');
      if (_preset === 'clear' || _preset === 'golden'){ setRain(null, 0); }
    }

    // 3) Hujan lokal: intensitas mengejar target secara halus.
    var rate = dt * 0.5;
    if (_rainCurrent < _rainTarget) _rainCurrent = Math.min(_rainTarget, _rainCurrent + rate);
    else if (_rainCurrent > _rainTarget) _rainCurrent = Math.max(_rainTarget, _rainCurrent - rate * 0.8);

    // 4) Angin: arah berputar pelan + hembusan acak.
    _gustTimer -= dt;
    if (_gustTimer <= 0){
      _gustTimer = 3 + Math.random() * 6;
      _windGust = 0.3 + Math.random() * 0.7;
    }
    _windGust = Math.max(0, _windGust - dt * 0.15);
    _windDir += Math.sin(_t * 0.05) * dt * 0.02;
    var baseWind = PRESETS[_preset] ? PRESETS[_preset].wind : 0.2;
    var wind = clamp(baseWind + _windGust * 0.35, 0, 1);

    // 5) Awan melayang mengikuti angin.
    _cloudDrift = (_cloudDrift + dt * wind * 0.01) % 1;

    // 6) Genangan: naik saat hujan, mengering pelan setelah hujan berhenti.
    if (_rainCurrent > 0.2){
      _puddles = clamp(_puddles + dt * 0.08 * _rainCurrent, 0, 1);
      _wasRaining = true;
      _dryTimer = 0;
    } else {
      if (_wasRaining){
        _dryTimer += dt;
        // Pelangi muncul 2-6 detik setelah hujan reda.
        if (_dryTimer > 2 && _puddles > 0.25){
          _rainbow = clamp(_rainbow + dt * 0.2, 0, 1);
          _rainbowAngle = 0.5 + Math.sin(_t * 0.1) * 0.15;
        }
      }
      _puddles = clamp(_puddles - dt * 0.004, 0, 1);
      if (_puddles <= 0.05){ _wasRaining = false; }
    }
    // Pelangi bertahan selama genangan masih ada, lalu memudar pelan.
    if (_puddles > 0.2 && _dryTimer > 2){
      _rainbow = clamp(_rainbow + dt * 0.1, 0, 1);
    } else if (_puddles <= 0.2){
      _rainbow = Math.max(0, _rainbow - dt * 0.08);
    }
    if (_puddles <= 0.05){ _rainbow = 0; _wasRaining = false; }

    // 7) Kilat saat badai (hanya kilat, tanpa suara di modul ini).
    if (_preset === 'storm' && _rainCurrent > 0.5){
      _lightningTimer -= dt;
      if (_lightningTimer <= 0){
        _lightningTimer = 4 + Math.random() * 9;
        _lightning = 1;
      }
    }
    _lightning = Math.max(0, _lightning - dt * 3);

    // 8) Langit + matahari + kabut mengikuti fase hari.
    var sky = SKY[phase] || SKY.day;
    var next = phase === 'golden' ? SKY.dusk : (phase === 'dusk' ? SKY.night : SKY.day);
    var blend = 0;
    if (phase === 'golden') blend = smooth((hour - SUNSET_START) / 0.85);
    else if (phase === 'dusk') blend = smooth((hour - 18.6) / 0.9);
    else if (phase === 'dawn') blend = smooth((hour - 5.0) / 0.75);
    var top = mixColor(sky.top, next.top, blend);
    var low = mixColor(sky.low, next.low, blend);
    var sunC = mixColor(sky.sun, next.sun, blend);
    var fogC = mixColor(sky.fog, next.fog, blend);
    if (_lightning > 0){
      var f = _lightning * 0.6;
      top = mixColor(top, [0.9, 0.9, 1.0], f);
      fogC = mixColor(fogC, [0.85, 0.85, 0.95], f);
    }
    // Awan tebal meredupkan langit.
    var cloudCover = PRESETS[_preset] ? PRESETS[_preset].clouds : 0.3;
    var dim = 1 - cloudCover * 0.25;
    top = [top[0] * dim, top[1] * dim, top[2] * dim];

    // Arah matahari: rendah di barat saat golden hour, tinggi di siang.
    var sunAz = lerp(0.9, -0.4, clamp((hour - 6) / 13, 0, 1));
    var sunEl = Math.max(0.08, sh);
    var sunDir = {
      x: Math.cos(sunAz) * Math.cos(sunEl),
      y: Math.sin(sunEl),
      z: Math.sin(sunAz) * Math.cos(sunEl)
    };
    if (isNight()){
      // Bulan: tinggi, dingin, redup.
      sunDir = { x: 0.3, y: 0.75, z: -0.45 };
      sunC = [0.55, 0.65, 0.95];
    }

    // Neon malam: 0 siang -> 1 gelap penuh.
    var neon = isNight() ? 1 : (phase === 'dusk' ? smooth((hour - 18.6) / 0.9) : 0);

    // 9) Tulis semuanya ke state.weather (sumber kebenaran bersama).
    var w = _state.weather;
    w.rain = _rainCurrent;
    w.rainArea = _rainArea ? { x: _rainArea.x, z: _rainArea.z, r: _rainArea.r, amount: _rainCurrent } : null;
    w.clouds = cloudCover;
    w.cloudDrift = _cloudDrift;
    w.wind = wind;
    w.windDir = _windDir;
    w.windGust = _windGust;
    w.puddles = _puddles;
    w.rainbow = _rainbow;
    w.neon = neon;
    w.sunDir = sunDir;
    w.sunColor = sunC;
    w.sunHeight = sh;
    w.skyTop = top;
    w.skyBottom = low;
    w.fogColor = fogC;
    w.fogNear = isNight() ? 90 : 120;
    w.fogFar = isNight() ? 420 : 520;
    w.lightning = _lightning;
    w.phase = phase;
    w.isNight = isNight();
  }

  window.SB.Weather = {
    init: init,
    update: update,
    setRain: setRain,
    advanceTime: advanceTime,
    isNight: isNight,
    rainbow: rainbow,
    isRainingAt: isRainingAt
  };

})();

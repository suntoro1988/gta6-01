window.SB = window.SB || {};
(function(){ 'use strict';

  // ---------------------------------------------------------------------------
  // SB.FX — efek partikel Sunset Bay (v13, fresh).
  // Ledakan, asap, api, percikan, partikel atmosfer (debu/kunang/ember),
  // wake perahu, ombak, dan cipratan hujan.
  //
  // ATURAN ARRAY (pelajaran v12): array partikel TIDAK PERNAH diganti dengan
  // array baru setelah init. init() memakai kembali array yang sama bila
  // sudah ada (hanya dikosongkan), dan update() menghapus partikel mati
  // secara in-place (swap-remove). Referensi SB.FX.particles selalu valid.
  // ---------------------------------------------------------------------------

  var MAX_PARTICLES = 600;      // batas keras — buang yang tertua bila penuh
  var MAX_WAKES = 40;           // jejak wake perahu
  var MAX_WAVES = 24;           // puncak ombak di pantai

  var _state = null;
  var _t = 0;
  var _unitMesh = null;         // mesh kubus kecil (dibuat malas via SB.Meshes)
  var _ambientTimer = 0;        // penghitung spawn partikel atmosfer
  var _rainSplashTimer = 0;     // penghitung cipratan hujan

  // Tipe partikel: 'fire' | 'smoke' | 'spark' | 'ember' | 'dust' |
  // 'splash' | 'wake' | 'foam' | 'debris' | 'mote'.
  // Satu partikel: {x,y,z, vx,vy,vz, life,maxLife, size, r,g,b, a,
  //                type, grav, drag, grow, spin}
  var particles = [];

  // Jejak wake: {x, z, life, maxLife, size, strength}
  var wakes = [];
  // Puncak ombak: {x, z, phase, speed, size}
  var waves = [];

  // -- util lokal ------------------------------------------------------------
  function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t){ return a + (b - a) * t; }
  function rand(a, b){ return a + Math.random() * (b - a); }

  // Tambah satu partikel. Bila penuh, timpa partikel tertua (index 0).
  // TIDAK PERNAH mengganti array `particles` — hanya push / tulis ulang slot.
  function spawn(p){
    if (particles.length >= MAX_PARTICLES){
      particles[0] = p;         // daur ulang slot tertua, array tetap sama
      return p;
    }
    particles.push(p);
    return p;
  }

  function makeParticle(type, x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag, grow){
    return {
      x: x, y: y, z: z,
      vx: vx, vy: vy, vz: vz,
      life: life, maxLife: life,
      size: size, r: r, g: g, b: b, a: 1,
      type: type,
      grav: (typeof grav === 'number' ? grav : 0),
      drag: (typeof drag === 'number' ? drag : 0),
      grow: (typeof grow === 'number' ? grow : 0),
      spin: rand(0, Math.PI * 2)
    };
  }

  // -- API -------------------------------------------------------------------

  function init(state){
    _state = state || null;
    _t = 0;
    _ambientTimer = 0;
    _rainSplashTimer = 0;
    // PENTING: kelola array yang sama — jangan `particles = []`.
    particles.length = 0;
    wakes.length = 0;
    waves.length = 0;
    _unitMesh = null;
    // Ombak pantai: deretan puncak di garis pantai (z ~ -170).
    for (var i = 0; i < MAX_WAVES; i++){
      waves.push({
        x: -260 + i * 22 + rand(-6, 6),
        z: -170 + rand(-14, 14),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.5, 1.1),
        size: rand(2.5, 6)
      });
    }
    return true;
  }

  // Ledakan: bola api + asap tebal + percikan + puing.
  function explosion(x, y, z){
    var i;
    for (i = 0; i < 26; i++){
      var a = rand(0, Math.PI * 2), e = rand(-0.4, 1);
      var sp = rand(4, 14);
      spawn(makeParticle('fire', x, y, z,
        Math.cos(a) * sp, e * sp * 0.7 + 3, Math.sin(a) * sp,
        rand(0.4, 0.9), rand(1.2, 2.6), 1.0, rand(0.45, 0.75), 0.10,
        -6, 1.2, 1.5));
    }
    for (i = 0; i < 14; i++){
      spawn(makeParticle('smoke', x + rand(-1, 1), y + rand(0, 2), z + rand(-1, 1),
        rand(-1.5, 1.5), rand(2, 5), rand(-1.5, 1.5),
        rand(1.6, 3.2), rand(2.0, 3.5), 0.16, 0.16, 0.18,
        1.5, 0.6, 2.2));
    }
    for (i = 0; i < 30; i++){
      a = rand(0, Math.PI * 2); e = rand(0, 1);
      sp = rand(10, 26);
      spawn(makeParticle('spark', x, y + 0.5, z,
        Math.cos(a) * sp, e * sp, Math.sin(a) * sp,
        rand(0.3, 0.8), rand(0.12, 0.3), 1.0, rand(0.7, 0.9), 0.25,
        -18, 0.4, 0));
    }
    for (i = 0; i < 8; i++){
      spawn(makeParticle('debris', x, y + 1, z,
        rand(-9, 9), rand(6, 14), rand(-9, 9),
        rand(0.8, 1.6), rand(0.3, 0.7), 0.25, 0.22, 0.20,
        -22, 0.2, 0));
    }
    return true;
  }

  // Asap: gumpalan naik pelan, membesar, memudar.
  function smoke(x, y, z){
    for (var i = 0; i < 6; i++){
      spawn(makeParticle('smoke', x + rand(-0.6, 0.6), y + rand(0, 0.8), z + rand(-0.6, 0.6),
        rand(-0.6, 0.6), rand(1.2, 2.4), rand(-0.6, 0.6),
        rand(1.8, 3.4), rand(1.2, 2.2), 0.20, 0.20, 0.22,
        0.8, 0.5, 1.8));
    }
    return true;
  }

  // Api: lidah api naik cepat, oranye -> merah, hidup singkat.
  function fire(x, y, z){
    for (var i = 0; i < 8; i++){
      spawn(makeParticle('fire', x + rand(-0.7, 0.7), y + rand(0, 0.6), z + rand(-0.7, 0.7),
        rand(-0.8, 0.8), rand(2.5, 5), rand(-0.8, 0.8),
        rand(0.35, 0.8), rand(0.9, 1.8), 1.0, rand(0.35, 0.6), 0.08,
        2, 1.0, 1.2));
    }
    return true;
  }

  // Percikan: titik terang cepat, gravitasi kuat, memantul di tanah (y=0).
  function sparks(x, y, z){
    for (var i = 0; i < 16; i++){
      var a = rand(0, Math.PI * 2);
      var sp = rand(4, 14);
      spawn(makeParticle('spark', x, y, z,
        Math.cos(a) * sp, rand(2, 9), Math.sin(a) * sp,
        rand(0.25, 0.7), rand(0.1, 0.25), 1.0, rand(0.75, 0.95), 0.3,
        -20, 0.3, 0));
    }
    return true;
  }

  // Wake perahu: jejak buih di permukaan air (dipanggil SB.Water / game).
  function wake(x, z){
    if (wakes.length >= MAX_WAKES) wakes.shift();
    wakes.push({ x: x, z: z, life: 2.2, maxLife: 2.2, size: 1.6, strength: 1 });
    // Buih putih kecil di sekitar wake.
    for (var i = 0; i < 3; i++){
      spawn(makeParticle('foam', x + rand(-1.2, 1.2), 0.15, z + rand(-1.2, 1.2),
        rand(-0.5, 0.5), rand(0.1, 0.4), rand(-0.5, 0.5),
        rand(0.6, 1.2), rand(0.4, 0.9), 0.95, 0.97, 1.0,
        0, 1.5, 1.0));
    }
    return true;
  }

  // Ombak: dorong satu puncak ombak (untuk pantai / tabrakan perahu).
  function splash(x, y, z, strength){
    var n = Math.round(clamp(strength || 1, 0.2, 3) * 10);
    for (var i = 0; i < n; i++){
      var a = rand(0, Math.PI * 2);
      var sp = rand(1, 4) * (strength || 1);
      spawn(makeParticle('splash', x + rand(-0.5, 0.5), y, z + rand(-0.5, 0.5),
        Math.cos(a) * sp, rand(2, 6), Math.sin(a) * sp,
        rand(0.4, 0.9), rand(0.3, 0.7), 0.85, 0.92, 1.0,
        -14, 0.6, 0));
    }
    return true;
  }

  function update(dt, state){
    if (state) _state = state;
    dt = Math.min(typeof dt === 'number' ? dt : 0.016, 0.1);
    _t += dt;

    var w = _state && _state.weather ? _state.weather : null;
    var wind = w ? (w.wind || 0) : 0.2;
    var windDir = w ? (w.windDir || 0) : 0;
    var rain = w ? (w.rain || 0) : 0;
    var night = w ? !!w.isNight : false;
    var px = _state && _state.player ? _state.player.x : 0;
    var pz = _state && _state.player ? _state.player.z : 0;

    // 1) Partikel: integrasi in-place, hapus mati dengan swap-remove.
    //    Array `particles` TIDAK PERNAH diganti — hanya isinya yang berubah.
    var i = 0;
    while (i < particles.length){
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0){
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      var k = 1 - Math.min(1, p.drag * dt);
      p.vx = p.vx * k + Math.cos(windDir) * wind * dt * 2;
      p.vz = p.vz * k + Math.sin(windDir) * wind * dt * 2;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      p.spin += dt * 2;
      // Percikan & puing memantul sekali di tanah.
      if ((p.type === 'spark' || p.type === 'debris') && p.y < 0.05 && p.vy < 0){
        p.y = 0.05;
        p.vy = -p.vy * 0.35;
        p.vx *= 0.6; p.vz *= 0.6;
      }
      if (p.y < -0.5){ p.life = 0; continue; }
      // Alpha memudar di akhir hidup; api berubah oranye -> merah gelap.
      var frac = p.life / p.maxLife;
      p.a = frac < 0.4 ? frac / 0.4 : 1;
      if (p.type === 'fire'){
        p.r = 1.0;
        p.g = 0.15 + 0.55 * frac;
        p.b = 0.05 + 0.10 * frac;
      }
      if (p.type === 'smoke') p.a = 0.55 * (1 - frac * 0.6);
      i++;
    }

    // 2) Wake: memudar & membesar pelan.
    for (i = wakes.length - 1; i >= 0; i--){
      var wk = wakes[i];
      wk.life -= dt;
      wk.size += dt * 1.4;
      wk.strength = Math.max(0, wk.life / wk.maxLife);
      if (wk.life <= 0) wakes.splice(i, 1);
    }

    // 3) Ombak: puncak bergerak ke pantai, fase berjalan.
    for (i = 0; i < waves.length; i++){
      var wv = waves[i];
      wv.phase += dt * wv.speed;
      wv.x += Math.sin(wv.phase * 0.5) * dt * 0.6;
    }

    // 4) Partikel atmosfer di sekitar pemain (selalu ada, murah).
    _ambientTimer -= dt;
    if (_ambientTimer <= 0){
      _ambientTimer = night ? 0.25 : 0.4;
      if (night){
        // Kunang-kunang / ember melayang di malam hari (hangat, pelan).
        spawn(makeParticle('mote', px + rand(-14, 14), rand(0.5, 4), pz + rand(-14, 14),
          rand(-0.3, 0.3), rand(0.1, 0.5), rand(-0.3, 0.3),
          rand(2, 4), rand(0.12, 0.25), 1.0, rand(0.7, 0.85), 0.3,
          0.2, 0.2, 0));
      } else {
        // Debu beterbangan di udara golden hour / siang.
        spawn(makeParticle('dust', px + rand(-12, 12), rand(0.5, 5), pz + rand(-12, 12),
          rand(-0.4, 0.4), rand(-0.1, 0.2), rand(-0.4, 0.4),
          rand(2, 4), rand(0.1, 0.22), 0.95, 0.85, 0.65,
          -0.1, 0.3, 0));
      }
    }

    // 5) Cipratan hujan di sekitar pemain bila sedang hujan.
    if (rain > 0.15){
      _rainSplashTimer -= dt;
      if (_rainSplashTimer <= 0){
        _rainSplashTimer = 0.12 / rain;
        spawn(makeParticle('splash', px + rand(-10, 10), 0.1, pz + rand(-10, 10),
          rand(-0.4, 0.4), rand(1.5, 3), rand(-0.4, 0.4),
          rand(0.25, 0.5), rand(0.15, 0.35), 0.85, 0.92, 1.0,
          -12, 0.4, 0));
      }
    }
  }

  function draw(gl, state){
    if (state) _state = state;
    if (!gl || typeof gl.drawMesh !== 'function') return;
    // Mesh kubus kecil — dibuat malas dari SB.Meshes bila tersedia.
    if (!_unitMesh){
      if (window.SB.Meshes && typeof window.SB.Meshes.box === 'function'){
        try { _unitMesh = window.SB.Meshes.box(1, 1, 1); } catch (e){ _unitMesh = null; }
      }
      if (!_unitMesh) return;
    }
    var i, p;
    var M = window.SB.Math3;
    if (!M) return;
    // Partikel: gambar sebagai kubus kecil berwarna di posisinya.
    // Ukuran partikel diwakili lewat alpha + warna (shader titik);
    // matriks hanya membawa posisi agar drawMesh tetap generik.
    for (i = 0; i < particles.length; i++){
      p = particles[i];
      if (p.a <= 0.02) continue;
      var m = M.mat4Identity();
      m = M.mat4Translate(m, p.x, p.y, p.z);
      gl.drawMesh(_unitMesh, m, [p.r, p.g, p.b, p.a]);
    }
    // Wake: buih datar di permukaan air.
    for (i = 0; i < wakes.length; i++){
      var wk = wakes[i];
      if (wk.strength <= 0.02) continue;
      var wm = M ? M.mat4Identity() : null;
      if (!wm) break;
      wm = M.mat4Translate(wm, wk.x, 0.12, wk.z);
      gl.drawMesh(_unitMesh, wm, [0.95, 0.97, 1.0, wk.strength * 0.5]);
    }
    // Ombak: puncak putih bergerak di garis pantai.
    for (i = 0; i < waves.length; i++){
      var wv = waves[i];
      var bob = Math.sin(wv.phase) * 0.5;
      var om = M ? M.mat4Identity() : null;
      if (!om) break;
      om = M.mat4Translate(om, wv.x, 0.15 + bob * 0.2, wv.z);
      var bright = 0.75 + 0.25 * Math.max(0, Math.sin(wv.phase));
      gl.drawMesh(_unitMesh, om, [bright, bright, 1.0, 0.45]);
    }
  }

  window.SB.FX = {
    init: init,
    update: update,
    draw: draw,
    explosion: explosion,
    smoke: smoke,
    fire: fire,
    sparks: sparks,
    wake: wake,
    splash: splash,
    particles: particles,
    wakes: wakes,
    waves: waves
  };

})();

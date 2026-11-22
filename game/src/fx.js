window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.FX — sistem partikel pooled (TANPA alokasi per-frame) + efek dunia.
  // Sunset Bay v12. Ditulis dari nol dari design spec; tidak membaca modul lain.
  // Pool tetap: MAX partikel dialokasikan sekali di init, lalu dipakai ulang.
  // Semua akses ke modul lain dijaga guard (SB.GL / SB.Math3 / SB.Meshes /
  // SB.Weather / SB.Water).
  // ---------------------------------------------------------------------------

  var MAX = 512;              // ukuran pool partikel
  var MAX_RINGS = 24;         // shockwave ring (ledakan)
  var MAX_EMITTERS = 32;      // emitter kontinu (api, asap knalpot, rokok)

  // Tipe partikel.
  var T_FLAME = 0, T_SMOKE = 1, T_SPARK = 2, T_DEBRIS = 3,
      T_DUST = 4, T_SPLASH = 5, T_EMBER = 6, T_FOAM = 7;

  var stateRef = null;
  var particles = [];         // pool — diekspos sebagai SB.FX.particles
  var cursor = 0;             // ring cursor untuk reuse slot
  var rings = [];             // shockwave
  var emitters = [];          // emitter kontinu
  var unitMesh = null;        // mesh kotak satuan (dibuat sekali di init)
  var quadMesh = null;        // mesh bidang datar (asap/percik)
  var tmpColor = [1, 1, 1];
  var tmpMat = null;
  var timeNow = 0;

  // -- util lokal -------------------------------------------------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // Ambil slot partikel berikutnya (ring buffer — tidak pernah alokasi baru).
  function alloc() {
    for (var i = 0; i < MAX; i++) {
      cursor = (cursor + 1) % MAX;
      if (particles[cursor].life <= 0) return particles[cursor];
    }
    // Pool penuh: timpa slot tertua (cursor saat ini).
    cursor = (cursor + 1) % MAX;
    return particles[cursor];
  }

  // Spawn satu partikel ke pool. Semua field ditulis ulang (tidak ada objek baru).
  function spawn(type, x, y, z, vx, vy, vz, life, size, r, g, b, grav, drag) {
    var p = alloc();
    p.type = type;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.r = r; p.g = g; p.b = b;
    p.grav = grav;
    p.drag = drag;
    p.spin = rand(-3, 3);
    p.rot = rand(0, Math.PI * 2);
    p.grow = 0;
    return p;
  }

  // Semburan radial: n partikel menyebar dari titik dengan kecepatan acak.
  function burst(type, x, y, z, n, speed, up, life, size, r, g, b, grav, drag, grow) {
    for (var i = 0; i < n; i++) {
      var a = rand(0, Math.PI * 2);
      var el = rand(-0.4, 1);
      var s = speed * rand(0.3, 1);
      var p = spawn(type, x + rand(-0.3, 0.3), y + rand(-0.2, 0.4), z + rand(-0.3, 0.3),
        Math.cos(a) * s, up + el * s * 0.6, Math.sin(a) * s,
        life * rand(0.6, 1.3), size * rand(0.7, 1.4), r, g, b, grav, drag);
      p.grow = grow || 0;
    }
  }

  // -- API wajib --------------------------------------------------------------

  function init(state) {
    stateRef = state || null;
    timeNow = 0;
    cursor = 0;

    // Pool dialokasikan SEKALI — objek partikel tidak pernah dibuat lagi.
    // JANGAN reassign (particles = []) — SB.FX.particles menunjuk array
    // asli yang diekspor saat modul dimuat; reassign membuat ekspor basi
    // (length 0 selamanya) dan ledakan/asap tidak pernah terlihat.
    particles.length = 0;
    for (var i = 0; i < MAX; i++) {
      particles.push({
        type: T_SMOKE, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1,
        grav: 0, drag: 0, spin: 0, rot: 0, grow: 0
      });
    }
    rings.length = 0;
    for (var j = 0; j < MAX_RINGS; j++) {
      rings.push({ x: 0, y: -999, z: 0, radius: 0, maxRadius: 10, life: 0, maxLife: 1, r: 1, g: 0.8, b: 0.4 });
    }
    emitters.length = 0;
    for (var k = 0; k < MAX_EMITTERS; k++) {
      emitters.push({ active: false, kind: '', x: 0, y: 0, z: 0, rate: 0, acc: 0, life: 0, maxLife: 0 });
    }

    // Mesh render sekali; guard bila modul belum termuat.
    if (window.SB && SB.Meshes) {
      if (SB.Meshes.box && !unitMesh) unitMesh = SB.Meshes.box(1, 1, 1);
      if (SB.Meshes.plane && !quadMesh) quadMesh = SB.Meshes.plane(1, 1);
    }
    if (!unitMesh) {
      // Fallback kotak satuan inline (vertices/normals/indices, CCW).
      unitMesh = {
        vertices: [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5],
        normals: [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]
      };
    }
    if (!quadMesh) {
      quadMesh = {
        vertices: [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
        normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        indices: [0, 1, 2, 0, 2, 3]
      };
    }
  }

  function update(dt, state) {
    if (state) stateRef = state;
    dt = Math.min(dt || 0.016, 0.05);
    timeNow += dt;

    // Angin dari Weather (guard) — pengaruhi asap, debu, percikan ringan.
    var wx = 0, wz = 0, wind = 0.2;
    if (window.SB && SB.Weather && SB.Weather.windVector) {
      var wv = SB.Weather.windVector();
      if (wv) { wx = wv.x; wz = wv.z; wind = wv.strength || 0.2; }
    } else if (stateRef && stateRef.weather) {
      wind = stateRef.weather.wind || 0.2;
      wx = Math.cos(0.6) * wind; wz = Math.sin(0.6) * wind;
    }
    var rain = (stateRef && stateRef.weather) ? (stateRef.weather.rain || 0) : 0;

    // -- Integrasi partikel (tanpa alokasi).
    for (var i = 0; i < MAX; i++) {
      var p = particles[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.y = -999; continue; }
      var age = 1 - p.life / p.maxLife; // 0 lahir -> 1 mati

      // Seret udara + gravitasi per tipe.
      var dragF = 1 - p.drag * dt;
      p.vx *= dragF; p.vz *= dragF;
      p.vy = p.vy * (1 - p.drag * dt * 0.5) - p.grav * dt;

      // Angin mendorong asap/debu/percikan; api hampir tidak terpengaruh.
      var windK = (p.type === T_SMOKE || p.type === T_DUST) ? 1.0
        : (p.type === T_SPARK || p.type === T_EMBER) ? 0.25 : 0.08;
      p.vx += wx * windK * dt * 3;
      p.vz += wz * windK * dt * 3;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;

      // Lantai: serpihan memantul sekali lalu diam; percikan mati di tanah.
      if (p.y < 0.05) {
        if (p.type === T_DEBRIS) {
          p.y = 0.05;
          p.vy = Math.abs(p.vy) * 0.25;
          p.vx *= 0.6; p.vz *= 0.6;
          if (Math.abs(p.vy) < 0.4) { p.vy = 0; p.vx = 0; p.vz = 0; p.grav = 0; }
        } else if (p.type === T_SPARK || p.type === T_EMBER) {
          p.life = Math.min(p.life, 0.05);
          p.y = 0.05;
        } else if (p.type === T_SPLASH || p.type === T_FOAM) {
          p.life = Math.min(p.life, 0.1);
          p.y = 0.05;
        } else {
          p.y = 0.05;
          p.vy = Math.max(0, p.vy);
        }
      }

      // Api mengecil, asap membesar & memudar; hujan memadamkan api/ember.
      if (p.type === T_FLAME) {
        p.size = Math.max(0.05, p.size * (1 - dt * 1.6));
        if (rain > 0.3) p.life -= dt * 2;
      } else if (p.type === T_SMOKE) {
        p.size += p.grow * dt;
        p.vy += 0.35 * dt; // asap naik
      } else if (p.type === T_DUST) {
        p.size += p.grow * dt * 0.6;
      }
      void age;
    }

    // -- Shockwave ring membesar & memudar.
    for (var r = 0; r < MAX_RINGS; r++) {
      var ring = rings[r];
      if (ring.life <= 0) continue;
      ring.life -= dt;
      var t = 1 - Math.max(0, ring.life) / ring.maxLife;
      ring.radius = ring.maxRadius * (t * t * (3 - 2 * t));
      if (ring.life <= 0) ring.y = -999;
    }

    // -- Emitter kontinu: api kebakaran, asap knalpot, asap rokok NPC.
    for (var e = 0; e < MAX_EMITTERS; e++) {
      var em = emitters[e];
      if (!em.active) continue;
      em.life -= dt;
      if (em.life <= 0) { em.active = false; continue; }
      em.acc += dt * em.rate;
      while (em.acc >= 1) {
        em.acc -= 1;
        if (em.kind === 'fire') {
          spawn(T_FLAME, em.x + rand(-0.4, 0.4), em.y, em.z + rand(-0.4, 0.4),
            rand(-0.3, 0.3), rand(1.2, 2.6), rand(-0.3, 0.3),
            rand(0.4, 0.9), rand(0.5, 1.0), 1.0, rand(0.45, 0.65), 0.12, -1.5, 0.6);
          if (Math.random() < 0.4) {
            spawn(T_EMBER, em.x, em.y + 0.3, em.z, rand(-0.8, 0.8), rand(2, 4), rand(-0.8, 0.8),
              rand(0.6, 1.4), 0.12, 1.0, 0.55, 0.15, 3.5, 0.4);
          }
          if (Math.random() < 0.5) {
            spawn(T_SMOKE, em.x, em.y + 0.8, em.z, rand(-0.2, 0.2), rand(0.8, 1.4), rand(-0.2, 0.2),
              rand(1.5, 2.5), 0.8, 0.16, 0.15, 0.15, -0.4, 0.8);
            particles[cursor].grow = 1.2;
          }
        } else if (em.kind === 'exhaust') {
          spawn(T_SMOKE, em.x, em.y, em.z, rand(-0.2, 0.2) - wx, rand(0.4, 0.8), rand(-0.2, 0.2) - wz,
            rand(0.7, 1.3), 0.35, 0.32, 0.32, 0.34, -0.3, 1.2);
          particles[cursor].grow = 0.9;
        } else if (em.kind === 'cigarette') {
          spawn(T_SMOKE, em.x, em.y, em.z, rand(-0.05, 0.05), rand(0.25, 0.45), rand(-0.05, 0.05),
            rand(1.2, 2.0), 0.12, 0.75, 0.75, 0.78, -0.15, 0.4);
          particles[cursor].grow = 0.35;
        }
      }
    }
  }

  function draw(gl, state) {
    if (state) stateRef = state;
    if (!gl || !gl.drawMesh) return;
    if (!window.SB || !SB.Math3) return;
    var M = SB.Math3;
    if (!tmpMat) tmpMat = M.mat4Identity();

    // Gambar partikel hidup sebagai kotak satuan yang diskala + diwarnai.
    // Api & percikan: kotak kecil terang. Asap/debu: bidang datar redup.
    for (var i = 0; i < MAX; i++) {
      var p = particles[i];
      if (p.life <= 0) continue;
      var fade = p.life / p.maxLife;
      var s = p.size * (p.type === T_SMOKE || p.type === T_DUST ? (1.6 - fade * 0.6) : 1);
      var m = M.mat4Identity();
      m = M.mat4Translate(m, p.x, p.y, p.z);
      if (p.type === T_SMOKE || p.type === T_DUST || p.type === T_FOAM) {
        m = M.mat4RotateY(m, p.rot);
      }
      // Skala via translate matriks: pakai mat4 skala manual (kolom diagonal).
      m[0] *= s; m[5] *= s; m[10] *= s;
      var a = 1;
      // Api/percikan/bara adalah SUMBER CAHAYA: warnanya di-boost agar tetap
      // terlihat di malam hari. drawMesh memakai shader 'lit' yang mengalikan
      // tint dengan pencahayaan scene — di malam hari ambient ~0.12 sehingga
      // api berwarna (1.0, 0.85, 0.10) jatuh ke ~0.1 dan tidak terlihat sama
      // sekali (dua take 4-end 21:30/19:45 tanpa ledakan yang kelihatan).
      // Boost x4 membuat api tetap oranye terang di malam hari; di siang hari
      // ia ter-clamp jadi putih panas (wajar untuk api). Asap/debu tetap redup.
      if (p.type === T_FLAME) { tmpColor[0] = 4.0; tmpColor[1] = 4.0 * lerp(0.25, 0.85, fade); tmpColor[2] = 0.40 * fade; }
      else if (p.type === T_SMOKE) { var g = 0.14 + 0.10 * fade; tmpColor[0] = g; tmpColor[1] = g; tmpColor[2] = g + 0.02; a = 0.55 * fade + 0.15; }
      else if (p.type === T_SPARK || p.type === T_EMBER) { tmpColor[0] = 3.0; tmpColor[1] = 3.0 * lerp(0.3, 0.8, fade); tmpColor[2] = 0.36; }
      else if (p.type === T_DUST) { tmpColor[0] = 0.72; tmpColor[1] = 0.62; tmpColor[2] = 0.48; a = 0.4 * fade + 0.1; }
      else if (p.type === T_SPLASH || p.type === T_FOAM) { tmpColor[0] = 0.75; tmpColor[1] = 0.88; tmpColor[2] = 0.95; a = 0.7 * fade + 0.2; }
      else { tmpColor[0] = p.r; tmpColor[1] = p.g; tmpColor[2] = p.b; } // debris: warna asli
      void a;
      var mesh = (p.type === T_SMOKE || p.type === T_DUST || p.type === T_FOAM) ? quadMesh : unitMesh;
      gl.drawMesh(mesh, m, tmpColor);
    }

    // Shockwave: cincin datar membesar (kotak pipih).
    for (var r = 0; r < MAX_RINGS; r++) {
      var ring = rings[r];
      if (ring.life <= 0) continue;
      var f = ring.life / ring.maxLife;
      var rm = M.mat4Identity();
      rm = M.mat4Translate(rm, ring.x, ring.y + 0.15, ring.z);
      var rs = Math.max(0.1, ring.radius);
      rm[0] *= rs; rm[5] *= 0.12; rm[10] *= rs;
      tmpColor[0] = ring.r * f + 0.4 * (1 - f);
      tmpColor[1] = ring.g * f + 0.3 * (1 - f);
      tmpColor[2] = ring.b * f;
      gl.drawMesh(quadMesh, rm, tmpColor);
    }
  }

  // -- Efek sekali jalan ------------------------------------------------------

  // Ledakan: bola api + asap tebal + serpihan beterbangan + shockwave.
  function explosion(x, y, z) {
    burst(T_FLAME, x, y + 0.5, z, 14, 4.5, 2.5, 0.7, 1.1, 1.0, 0.55, 0.15, -1.2, 0.8);
    burst(T_SMOKE, x, y + 1.2, z, 12, 1.6, 2.2, 2.6, 1.2, 0.15, 0.14, 0.14, -0.5, 0.9, 1.4);
    burst(T_DEBRIS, x, y + 0.6, z, 16, 9, 5.5, 1.6, 0.28, 0.35, 0.30, 0.28, 14, 0.4);
    burst(T_SPARK, x, y + 0.5, z, 18, 11, 4, 0.9, 0.14, 1.0, 0.7, 0.2, 9, 0.3);
    burst(T_EMBER, x, y + 0.8, z, 8, 3, 3.5, 1.8, 0.12, 1.0, 0.5, 0.12, 4, 0.5);
    addRing(x, y + 0.3, z, 14, 0.55, 1.0, 0.75, 0.35);
    // Api besar juga menyalakan emitter kebakaran singkat di titik ledakan.
    startEmitter('fire', x, y, z, 26, 2.5);
  }

  // Kepulan asap sekali jalan (knalpot, cerobong, tabrakan ringan).
  function smoke(x, y, z) {
    burst(T_SMOKE, x, y, z, 6, 0.5, 1.0, 1.8, 0.7, 0.30, 0.30, 0.32, -0.35, 1.0, 1.0);
  }

  // Semburan api sekali jalan (tembakan senjata berat, tong meledak kecil).
  function fire(x, y, z) {
    burst(T_FLAME, x, y, z, 8, 1.2, 2.0, 0.55, 0.8, 1.0, 0.55, 0.12, -1.0, 0.7);
    burst(T_EMBER, x, y + 0.2, z, 4, 2, 3, 1.0, 0.11, 1.0, 0.5, 0.12, 4, 0.5);
  }

  // Percikan: tabrakan mobil, tembakan mengenai logam/beton, gerinda.
  function sparks(x, y, z) {
    burst(T_SPARK, x, y, z, 12, 7, 2.5, 0.6, 0.11, 1.0, 0.75, 0.25, 10, 0.3);
    burst(T_DEBRIS, x, y, z, 4, 4, 3, 0.8, 0.12, 0.6, 0.58, 0.55, 12, 0.5);
  }

  // -- Efek kontinu & dunia (helper, dipanggil modul lain via guard) ----------

  // Debu jalan di belakang kendaraan / kaki yang berlari.
  function dust(x, y, z, n) {
    n = n || 4;
    burst(T_DUST, x, y + 0.15, z, n, 0.9, 0.5, 1.1, 0.55, 0.72, 0.62, 0.48, -0.2, 1.4, 0.8);
  }

  // Ombak pecah di pantai + wake perahu: busa putih + cipratan air.
  function splash(x, y, z, n) {
    n = n || 6;
    burst(T_SPLASH, x, y, z, n, 1.8, 2.2, 0.7, 0.3, 0.8, 0.9, 0.95, 7, 0.5);
    burst(T_FOAM, x, y + 0.05, z, Math.ceil(n / 2), 0.7, 0.2, 1.6, 0.7, 0.85, 0.92, 0.96, -0.1, 1.2);
  }

  // Wake perahu: dipanggil tiap frame oleh Water lewat guard SB.FX.wake.
  function wake(x, z) {
    var y = 0.08;
    spawn(T_FOAM, x + rand(-0.6, 0.6), y, z + rand(-0.6, 0.6),
      rand(-0.3, 0.3), 0.1, rand(-0.3, 0.3), rand(1.0, 1.8), rand(0.5, 0.9),
      0.85, 0.92, 0.96, -0.05, 1.0);
    particles[cursor].grow = 0.7;
    if (Math.random() < 0.5) {
      spawn(T_SPLASH, x, y, z, rand(-0.5, 0.5), rand(0.8, 1.6), rand(-0.5, 0.5),
        rand(0.3, 0.6), 0.18, 0.8, 0.9, 0.95, 8, 0.4);
    }
  }

  // Asap knalpot kontinu (kendaraan): emitter 3 detik, diperbarui tiap frame.
  function exhaust(x, y, z) {
    startEmitter('exhaust', x, y, z, 14, 0.6);
  }

  // Api kebakaran kontinu di satu titik (gedung/mobil terbakar).
  function startFire(x, y, z, seconds) {
    startEmitter('fire', x, y, z, 30, seconds || 8);
  }

  // Asap rokok NPC: emitter tipis 6 detik.
  function cigarette(x, y, z) {
    startEmitter('cigarette', x, y, z, 3, 6);
  }

  // -- Internal emitter -------------------------------------------------------
  function startEmitter(kind, x, y, z, rate, seconds) {
    // Pakai ulang emitter sejenis di posisi dekat bila ada (hemat slot).
    for (var i = 0; i < MAX_EMITTERS; i++) {
      var em = emitters[i];
      if (em.active && em.kind === kind) {
        var dx = em.x - x, dz = em.z - z;
        if (dx * dx + dz * dz < 4) {
          em.life = Math.max(em.life, seconds);
          em.rate = Math.max(em.rate, rate);
          return;
        }
      }
    }
    for (var j = 0; j < MAX_EMITTERS; j++) {
      var e2 = emitters[j];
      if (!e2.active) {
        e2.active = true;
        e2.kind = kind;
        e2.x = x; e2.y = y; e2.z = z;
        e2.rate = rate;
        e2.acc = 0;
        e2.life = seconds;
        e2.maxLife = seconds;
        return;
      }
    }
  }

  function addRing(x, y, z, maxRadius, life, r, g, b) {
    for (var i = 0; i < MAX_RINGS; i++) {
      var ring = rings[i];
      if (ring.life <= 0) {
        ring.x = x; ring.y = y; ring.z = z;
        ring.radius = 0.5;
        ring.maxRadius = maxRadius;
        ring.life = life;
        ring.maxLife = life;
        ring.r = r; ring.g = g; ring.b = b;
        return;
      }
    }
  }

  // Jumlah partikel hidup (untuk HUD/debug, tanpa alokasi).
  function aliveCount() {
    var n = 0;
    for (var i = 0; i < MAX; i++) if (particles[i].life > 0) n++;
    return n;
  }

  window.SB.FX = {
    init: init,
    update: update,
    draw: draw,
    explosion: explosion,
    smoke: smoke,
    fire: fire,
    sparks: sparks,
    particles: particles,
    // helper dunia
    dust: dust,
    splash: splash,
    wake: wake,
    exhaust: exhaust,
    startFire: startFire,
    cigarette: cigarette,
    aliveCount: aliveCount
  };
})();

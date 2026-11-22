window.SB = window.SB || {};
(function () {
  'use strict';

  // SB.Police — kepolisian Sunset Bay.
  // Wanted 0-5 bintang + Heat 0-100 sebagai state machine. Polisi merespons:
  // patroli (wanted 0-1), kejar (wanted 2+), roadblock (wanted 3+),
  // PIT maneuver (wanted 4+), helikopter AIR-1 (wanted >= 3) + heli taktis AIR-2.

  var MAX_COPS = 10, CITY_HALF = 220;
  var COP_CHASE_SPEED = 13.5, COP_PATROL_SPEED = 6.0, PIT_RANGE = 7;
  var HEAT_DECAY = 4.0, HEAT_PER_STAR = 20;

  var _state = null, _time = 0, _rngState = 777;

  function rnd() {
    _rngState = (_rngState * 1664525 + 1013904223) >>> 0;
    return _rngState / 4294967296;
  }
  function rand(a, b) { return a + rnd() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }
  function angleLerp(a, b, t) {
    var d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // State machine wanted -> jumlah unit & mode perilaku.
  var WANTED_TABLE = [
    { stars: 0, cops: 2,  mode: 'patrol',    desc: 'Patroli rutin' },
    { stars: 1, cops: 3,  mode: 'pursue',    desc: 'Pengejaran ringan' },
    { stars: 2, cops: 4,  mode: 'pursue',    desc: 'Pengejaran aktif' },
    { stars: 3, cops: 6,  mode: 'intercept', desc: 'Roadblock + heli AIR-1' },
    { stars: 4, cops: 8,  mode: 'intercept', desc: 'PIT + roadblock + heli' },
    { stars: 5, cops: 10, mode: 'takedown',  desc: 'Semua unit + heli taktis' }
  ];

  function makeCop(x, z, kind) {
    return {
      x: x, z: z, angle: rand(0, Math.PI * 2), speed: 0, kind: kind || 'patrol',
      state: 'patrol', // 'patrol' | 'chase' | 'block' | 'pit' | 'ram'
      targetX: x, targetZ: z, siren: false, sirenPhase: rand(0, Math.PI * 2),
      pitTimer: 0, pitCooldown: 0, stuckT: 0, lastX: x, lastZ: z,
      health: 100, color: [0.08, 0.12, 0.35], onFoot: false
    };
  }

  function makeHeli(name, orbitR, tactical) {
    return {
      name: name, active: false, x: 0, y: 90, z: 0, angle: 0, rotor: 0,
      spotlight: false, spotX: 0, spotZ: 0, orbitR: orbitR, orbitA: 0,
      speed: 9, tactical: !!tactical, searchT: 0
    };
  }

  var Police = {
    cops: [],
    heli: null,            // AIR-1
    tacticalHeli: null,    // AIR-2
    roadblocks: [],
    wanted: 0,
    heat: 0,
    _cooldown: 0,

    init: function (state) {
      _state = state || null;
      _time = 0;
      Police.cops.length = 0;
      Police.roadblocks.length = 0;
      Police.wanted = 0;
      Police.heat = 0;
      Police._cooldown = 0;
      Police.heli = makeHeli('AIR-1', 26, false);
      Police.tacticalHeli = makeHeli('AIR-2', 34, true);
      Police.cops.push(makeCop(20, 10, 'patrol'), makeCop(-30, -20, 'patrol'));
      if (state) { state.wanted = 0; state.heat = 0; }
    },

    setWanted: function (n) {
      n = clamp(Math.round(n), 0, 5);
      var prev = Police.wanted;
      Police.wanted = n;
      // Heat hanya dihitung saat level BERUBAH: syncWanted() memanggil
      // setWanted tiap frame, dan rumus lama (n*20 + heat*0.3) menaikkan
      // heat tiap frame sampai 100 lalu wanted naik sendiri (ratchet) —
      // wanted 4 selalu merangkak jadi 5 tanpa kejahatan baru.
      if (n !== prev) {
        Police.heat = clamp(n * HEAT_PER_STAR, 0, 100);
      }
      if (_state) { _state.wanted = n; _state.heat = Police.heat; }
      if (n > prev) {
        Police.deploy(n);
        if (n >= 3) Police.heli.active = true;
        if (n >= 5) Police.tacticalHeli.active = true;
      }
      if (n === 0) {
        Police.heli.active = false;
        Police.tacticalHeli.active = false;
        Police.roadblocks.length = 0;
        for (var i = 0; i < Police.cops.length; i++) {
          Police.cops[i].state = 'patrol'; Police.cops[i].siren = false;
        }
      }
      return Police.wanted;
    },

    deploy: function (n) {
      var want = WANTED_TABLE[n].cops;
      var st = _state;
      var px = st && st.player ? st.player.x : 0;
      var pz = st && st.player ? st.player.z : 0;
      while (Police.cops.length < want && Police.cops.length < MAX_COPS) {
        var a = rand(0, Math.PI * 2), r = rand(45, 80);
        Police.cops.push(makeCop(
          clamp(px + Math.sin(a) * r, -CITY_HALF, CITY_HALF),
          clamp(pz + Math.cos(a) * r, -CITY_HALF, CITY_HALF),
          n >= 4 ? 'tactical' : 'pursuit'
        ));
      }
    },

    roadblock: function (x, z) {
      // Roadblock: 2 mobil polisi melintang + cone, unit siaga menempati posisi.
      if (Police.roadblocks.length >= 4) return null;
      var block = { x: x, z: z, angle: rand(0, Math.PI * 2), cars: 2, active: true, timer: 45, cones: 4 };
      Police.roadblocks.push(block);
      for (var i = 0; i < Police.cops.length && block.cars > 0; i++) {
        var c = Police.cops[i];
        if (c.state === 'patrol' || c.state === 'chase') {
          c.state = 'block';
          c.targetX = x + (block.cars === 2 ? -6 : 6);
          c.targetZ = z;
          block.cars--;
        }
      }
      return block;
    },

    pit: function (target) {
      // PIT: polisi terdekat membelokkan buronan dari samping belakang.
      if (!target) return false;
      var best = null, bestD = Infinity;
      for (var i = 0; i < Police.cops.length; i++) {
        var c = Police.cops[i];
        if (c.state !== 'chase' && c.state !== 'pit') continue;
        if (c.pitCooldown > 0) continue;
        var d = dist2(c.x, c.z, target.x, target.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best || bestD > PIT_RANGE * PIT_RANGE * 3) return false;
      best.state = 'pit'; best.pitTimer = 1.6; best.pitCooldown = 8;
      best.targetX = target.x; best.targetZ = target.z;
      return true;
    },

    update: function (dt, state) {
      _time += dt;
      if (state) _state = state;
      var st = _state || state;
      if (!st || !st.player) return;
      var px = st.player.x, pz = st.player.z;
      var wanted = Police.wanted;
      // Kejahatan (curi mobil, dll.) menaikkan state.wanted langsung —
      // adopsi kenaikan itu; kalau tidak, baris st.wanted = wanted di
      // bawah menimpa balik ke 0 di frame yang sama dan wanted hilang.
      if (st.wanted > wanted) { wanted = st.wanted; Police.wanted = wanted; }
      var mode = WANTED_TABLE[wanted].mode;

      // Heat: naik saat wanted aktif, turun saat pemain menghilang.
      if (wanted > 0) Police.heat = clamp(Police.heat + dt * 1.5, 0, 100);
      else Police.heat = clamp(Police.heat - dt * HEAT_DECAY, 0, 100);
      st.heat = Police.heat;
      st.wanted = wanted;

      // Heat penuh -> naik satu bintang (pemain makin dicari).
      if (Police.heat >= 100 && wanted > 0 && wanted < 5) {
        Police.setWanted(wanted + 1); wanted = Police.wanted; mode = WANTED_TABLE[wanted].mode;
      }

      // Wanted turun perlahan bila pemain lolos dari pandangan polisi 20 detik.
      if (wanted > 0) {
        var seen = false;
        for (var s = 0; s < Police.cops.length; s++) {
          if (dist2(Police.cops[s].x, Police.cops[s].z, px, pz) < 40 * 40) { seen = true; break; }
        }
        if (!seen && !Police.heli.active) {
          Police._cooldown += dt;
          if (Police._cooldown > 20) { Police.setWanted(wanted - 1); Police._cooldown = 0; }
        } else Police._cooldown = 0;
      }

      Police.deploy(wanted);
      for (var i = 0; i < Police.cops.length; i++) updateCop(Police.cops[i], dt, st, mode, px, pz);
      // Unit berlebih saat wanted turun kembali ke patroli (dihapus dari array).
      var wantCops = WANTED_TABLE[wanted].cops;
      if (Police.cops.length > wantCops) Police.cops.splice(wantCops, Police.cops.length - wantCops);

      // Roadblock otomatis saat wanted >= 3, di depan arah laju pemain.
      if (wanted >= 3 && Police.roadblocks.length < 2 && rnd() < dt * 0.08) {
        var pa = st.player.angle || 0;
        Police.roadblock(clamp(px + Math.sin(pa) * 55, -CITY_HALF, CITY_HALF),
          clamp(pz + Math.cos(pa) * 55, -CITY_HALF, CITY_HALF));
      }
      for (var r = Police.roadblocks.length - 1; r >= 0; r--) {
        var b = Police.roadblocks[r];
        b.timer -= dt;
        if (b.timer <= 0 || dist2(b.x, b.z, px, pz) > 160 * 160) Police.roadblocks.splice(r, 1);
      }

      // Helikopter AIR-1 (wanted >= 3) mengorbit pemain; AIR-2 taktis (wanted 5).
      updateHeli(Police.heli, dt, px, pz, wanted >= 3);
      updateHeli(Police.tacticalHeli, dt, px, pz, wanted >= 5);

      // NPC sekitar lari saat sirene mendekat.
      if (window.SB.NPC && wanted >= 2 && rnd() < dt * 2) window.SB.NPC.flee(px, pz);
    },

    draw: function (gl, state) {
      if (!gl || !gl.drawMesh || !window.SB.Meshes || !window.SB.Math3) return;
      var M = window.SB.Math3;
      var car = window.SB.Meshes.car, person = window.SB.Meshes.person;
      for (var i = 0; i < Police.cops.length; i++) {
        var c = Police.cops[i];
        var m = M.mat4Identity();
        m = M.mat4Translate(m, c.x, 0, c.z);
        m = M.mat4RotateY(m, c.angle);
        if (car) gl.drawMesh(car(c.color), m, c.color);
        // Lampu sirene: kilau merah/biru bergantian di atas mobil.
        if (c.siren && person) {
          var flash = Math.sin(_time * 10 + i * 2) > 0 ? [1, 0.15, 0.15] : [0.15, 0.35, 1];
          var lm = M.mat4Identity();
          lm = M.mat4Translate(lm, c.x, 1.05, c.z);
          gl.drawMesh(person(flash), lm, flash);
        }
        if (c.onFoot && person) {
          var pm = M.mat4Identity();
          pm = M.mat4Translate(pm, c.x + Math.sin(c.angle) * 1.2, 0, c.z + Math.cos(c.angle) * 1.2);
          pm = M.mat4RotateY(pm, c.angle);
          gl.drawMesh(person([0.1, 0.15, 0.4]), pm, [0.1, 0.15, 0.4]);
        }
      }
      // Roadblock: mobil polisi melintang.
      for (var r = 0; r < Police.roadblocks.length; r++) {
        var b = Police.roadblocks[r];
        for (var k = 0; k < 2; k++) {
          var bm = M.mat4Identity();
          bm = M.mat4Translate(bm, b.x + (k === 0 ? -5 : 5), 0, b.z);
          bm = M.mat4RotateY(bm, b.angle + Math.PI / 2);
          if (car) gl.drawMesh(car([0.08, 0.12, 0.35]), bm, [0.08, 0.12, 0.35]);
        }
      }
      drawHeli(gl, M, Police.heli);
      drawHeli(gl, M, Police.tacticalHeli);
    }
  };

  function updateCop(c, dt, st, mode, px, pz) {
    c.sirenPhase += dt * 9;
    c.pitCooldown = Math.max(0, c.pitCooldown - dt);
    var dPlayer = Math.sqrt(dist2(c.x, c.z, px, pz));
    var wantChase = Police.wanted > 0;

    if (c.state === 'pit') {
      c.pitTimer -= dt;
      var ta = st.player.angle || 0;   // sasar samping belakang target lalu dorong
      steerToward(c, px - Math.sin(ta) * 2.5 + Math.cos(ta) * 1.8,
        pz - Math.cos(ta) * 2.5 - Math.sin(ta) * 1.8, COP_CHASE_SPEED * 1.15, dt);
      if (c.pitTimer <= 0) {
        c.state = 'chase';
        if (dPlayer < 4 && st.player.vehicle) {   // PIT berhasil: target spin
          st.player.angle = (st.player.angle || 0) + 0.9;
          if (window.SB.FX) window.SB.FX.sparks(px, 1, pz);
        }
      }
      return;
    }

    if (c.state === 'block') {
      steerToward(c, c.targetX, c.targetZ, COP_PATROL_SPEED, dt);
      if (dist2(c.x, c.z, c.targetX, c.targetZ) < 4) { c.speed = 0; c.siren = true; }
      if (Police.wanted === 0) c.state = 'patrol';
      return;
    }

    if (wantChase && (mode === 'pursue' || mode === 'intercept' || mode === 'takedown')) {
      c.state = 'chase';
      c.siren = true;
      // Prediksi posisi pemain (intercept), bukan kejar ekor.
      var lead = clamp(dPlayer * 0.25, 0, 12);
      var pa = st.player.angle || 0;
      var spd = COP_CHASE_SPEED + (Police.wanted >= 4 ? 1.5 : 0);
      steerToward(c, px + Math.sin(pa) * lead, pz + Math.cos(pa) * lead, spd, dt);
      if (Police.wanted >= 4 && dPlayer < PIT_RANGE && c.pitCooldown <= 0) Police.pit(st.player);
      if (mode === 'takedown' && dPlayer < 3.5 && st.player.hp > 0) c.state = 'ram';
    } else {
      // Patroli: jalan pelan menyusuri grid, belok di persimpangan.
      c.state = 'patrol';
      c.siren = Police.wanted > 0;
      steerToward(c, c.targetX, c.targetZ, COP_PATROL_SPEED, dt);
      if (dist2(c.x, c.z, c.targetX, c.targetZ) < 6) {
        c.targetX = clamp(c.x + rand(-90, 90), -CITY_HALF, CITY_HALF);
        c.targetZ = clamp(c.z + rand(-90, 90), -CITY_HALF, CITY_HALF);
      }
    }

    if (c.state === 'ram') {
      steerToward(c, px, pz, COP_CHASE_SPEED * 1.25, dt);
      if (dPlayer > 8) c.state = 'chase';
      if (dPlayer < 2.2) { c.state = 'chase'; c.pitCooldown = 3; }
    }

    // Deteksi macet: tidak bergerak 4 detik -> cari target baru.
    if (dist2(c.x, c.z, c.lastX, c.lastZ) < 0.01) {
      c.stuckT += dt;
      if (c.stuckT > 4) {
        c.targetX = clamp(c.x + rand(-60, 60), -CITY_HALF, CITY_HALF);
        c.targetZ = clamp(c.z + rand(-60, 60), -CITY_HALF, CITY_HALF);
        c.stuckT = 0;
      }
    } else c.stuckT = 0;
    c.lastX = c.x;
    c.lastZ = c.z;
    c.x = clamp(c.x, -CITY_HALF - 10, CITY_HALF + 10);
    c.z = clamp(c.z, -CITY_HALF - 10, CITY_HALF + 10);
  }

  function steerToward(c, tx, tz, speed, dt) {
    var dx = tx - c.x, dz = tz - c.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.01) { c.speed = 0; return; }
    c.angle = angleLerp(c.angle, Math.atan2(dx, dz), Math.min(1, dt * 3.2));
    c.speed = speed;
    c.x += Math.sin(c.angle) * speed * dt;
    c.z += Math.cos(c.angle) * speed * dt;
  }

  function updateHeli(h, dt, px, pz, shouldBeActive) {
    if (!h) return;
    h.rotor += dt * 22;
    if (!shouldBeActive) {
      if (h.active) { h.y += dt * 8; if (h.y > 160) h.active = false; }
      return;
    }
    h.active = true;
    h.spotlight = true;
    h.orbitA += dt * 0.35;
    var tx = px + Math.sin(h.orbitA) * h.orbitR;
    var tz = pz + Math.cos(h.orbitA) * h.orbitR;
    var ty = 55 + Math.sin(_time * 0.7 + h.orbitA) * 6;
    h.x += (tx - h.x) * Math.min(1, dt * 1.2);
    h.z += (tz - h.z) * Math.min(1, dt * 1.2);
    h.y += (ty - h.y) * Math.min(1, dt * 1.5);
    h.angle = Math.atan2(px - h.x, pz - h.z);
    h.spotX = px;
    h.spotZ = pz;
    h.searchT += dt;
  }

  function drawHeli(gl, M, h) {
    if (!h || !h.active) return;
    var car = window.SB.Meshes && window.SB.Meshes.car;
    var plane = window.SB.Meshes && window.SB.Meshes.plane;
    if (!car) return;
    var body = h.tactical ? [0.15, 0.15, 0.18] : [0.9, 0.9, 0.92];
    var m = M.mat4Identity();
    m = M.mat4Translate(m, h.x, h.y, h.z);
    m = M.mat4RotateY(m, h.angle);
    gl.drawMesh(car(body), m, body);
    // Rotor: bilah tipis berputar di atas badan.
    if (plane) {
      var rm = M.mat4Identity();
      rm = M.mat4Translate(rm, h.x, h.y + 1.2, h.z);
      rm = M.mat4RotateY(rm, h.rotor);
      gl.drawMesh(plane(6, 0.4), rm, [0.2, 0.2, 0.22]);
      // Spotlight: bidang terang di tanah menyapu jalan.
      if (h.spotlight) {
        var sm = M.mat4Identity();
        sm = M.mat4Translate(sm, h.spotX, 0.15, h.spotZ);
        gl.drawMesh(plane(9, 9), sm, [1, 0.95, 0.7]);
      }
    }
  }

  window.SB.Police = Police;
})();

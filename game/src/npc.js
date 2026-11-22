window.SB = window.SB || {};
(function () {
  'use strict';

  // SB.NPC — warga Sunset Bay yang hidup.
  // 24+ pejalan kaki: jalan, selfie, lari saat takut, bersorak, turis pantai,
  // pedagang kaki lima, jogger, anak-anak, hewan peliharaan. Perilaku digerakkan
  // oleh SB.state (wanted, heat, timeOfDay, posisi pemain).

  var WALK_SPEED = 1.1, JOG_SPEED = 3.4, FLEE_SPEED = 5.2;
  var TARGET_COUNT = 28, CITY_HALF = 220;
  var KINDS = ['local', 'tourist', 'jogger', 'vendor', 'kid', 'elder', 'worker'];
  var SHIRT_COLORS = [
    [0.95, 0.35, 0.30], [0.30, 0.55, 0.95], [0.95, 0.80, 0.25],
    [0.35, 0.80, 0.45], [0.95, 0.55, 0.75], [0.60, 0.40, 0.85],
    [0.95, 0.95, 0.90], [0.20, 0.20, 0.25], [0.95, 0.60, 0.20],
    [0.25, 0.75, 0.70], [0.85, 0.30, 0.55], [0.55, 0.65, 0.30]
  ];
  var SKIN_TONES = [
    [0.92, 0.76, 0.62], [0.78, 0.58, 0.42], [0.62, 0.44, 0.32],
    [0.85, 0.66, 0.50], [0.55, 0.38, 0.28]
  ];
  var PET_COLORS = [
    [0.55, 0.38, 0.22], [0.90, 0.85, 0.75], [0.15, 0.15, 0.15],
    [0.75, 0.60, 0.40], [0.95, 0.95, 0.95]
  ];

  var _state = null, _time = 0, _rngState = 1337;

  function rnd() {
    _rngState = (_rngState * 1664525 + 1013904223) >>> 0;
    return _rngState / 4294967296;
  }
  function rand(a, b) { return a + rnd() * (b - a); }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }

  function makePet(owner) {
    return {
      x: owner.x + rand(-0.6, 0.6), z: owner.z + rand(-0.6, 0.6),
      angle: rand(0, Math.PI * 2), color: pick(PET_COLORS),
      size: rand(0.35, 0.6), kind: rnd() < 0.7 ? 'dog' : 'cat',
      wag: rand(0, Math.PI * 2), speed: rand(0.8, 1.4)
    };
  }

  function makePedestrian(x, z, kind) {
    kind = kind || pick(KINDS);
    var p = {
      x: x, z: z, angle: rand(0, Math.PI * 2),
      speed: kind === 'jogger' ? JOG_SPEED : (kind === 'kid' ? rand(1.4, 1.9) : rand(0.8, 1.4)),
      state: 'walk', kind: kind, shirt: pick(SHIRT_COLORS), skin: pick(SKIN_TONES),
      scale: kind === 'kid' ? 0.62 : (kind === 'elder' ? 0.92 : rand(0.95, 1.08)),
      timer: rand(2, 9), targetX: x, targetZ: z, panic: 0,
      selfieT: 0, cheerT: 0, chatWith: -1, pet: null, beach: false,
      phoneUp: false, bobPhase: rand(0, Math.PI * 2), steps: 0
    };
    if (kind === 'tourist') { p.beach = rnd() < 0.65; p.shirt = [0.98, 0.85, 0.55]; }
    if (kind === 'vendor') { p.state = 'idle'; p.timer = rand(8, 20); }
    if (rnd() < 0.22 && kind !== 'kid' && kind !== 'jogger') p.pet = makePet(p);
    pickTarget(p);
    return p;
  }

  function pickTarget(p) {
    if (p.beach && rnd() < 0.6) {
      p.targetX = rand(-140, 140);   // turis pantai berkumpul di garis pantai
      p.targetZ = rand(150, 205);
    } else {
      p.targetX = rand(-CITY_HALF, CITY_HALF);
      p.targetZ = rand(-CITY_HALF, CITY_HALF);
    }
  }

  function nearestStreet(x, z) {
    // Jalan grid tiap 40 unit; tarik pejalan kaki ke trotoar terdekat.
    var gx = Math.round(x / 40) * 40, gz = Math.round(z / 40) * 40;
    if (Math.abs(x - gx) < Math.abs(z - gz)) return { x: gx + 3.5, z: z };
    return { x: x, z: gz + 3.5 };
  }

  function moveToward(p, tx, tz, speed, dt) {
    var dx = tx - p.x, dz = tz - p.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return;
    p.angle = Math.atan2(dx, dz);
    var step = Math.min(len, speed * dt);
    p.x += (dx / len) * step;
    p.z += (dz / len) * step;
  }

  function reached(p, r) { return dist2(p.x, p.z, p.targetX, p.targetZ) < r * r; }

  function scaleMat(m, sx, sy, sz) {
    m[0] *= sx; m[1] *= sx; m[2] *= sx;   // skala kolom matriks 4x4 (column-major)
    m[4] *= sy; m[5] *= sy; m[6] *= sy;
    m[8] *= sz; m[9] *= sz; m[10] *= sz;
    return m;
  }

  function updatePet(pet, owner, dt) {
    pet.wag += dt * 6;
    var dx = owner.x - pet.x, dz = owner.z - pet.z;
    var len = Math.sqrt(dx * dx + dz * dz);
    if (len > 0.4) {
      pet.angle = Math.atan2(dx, dz);
      var step = Math.min(len, (len > 1.2 ? pet.speed * 2.4 : pet.speed) * dt);
      pet.x += (dx / len) * step;
      pet.z += (dz / len) * step;
    }
    // Anjing berlari kecil mengitari pemilik saat pemilik idle.
    if (owner.state === 'idle' && pet.kind === 'dog' && len < 0.8) {
      pet.angle += dt * 1.5;
      pet.x = owner.x + Math.sin(pet.angle) * 0.7;
      pet.z = owner.z + Math.cos(pet.angle) * 0.7;
    }
  }

  function drawPet(gl, pet, M) {
    if (!window.SB.Meshes || !window.SB.Meshes.person) return;
    var m = M.mat4Identity();
    m = M.mat4Translate(m, pet.x, 0.12, pet.z);
    m = M.mat4RotateY(m, pet.angle + Math.sin(pet.wag) * 0.1);
    m = scaleMat(m, pet.size, pet.size * 0.55, pet.size * 1.3);
    gl.drawMesh(window.SB.Meshes.person(pet.color), m, pet.color);
  }

  var NPC = {
    pedestrians: [],

    init: function (state) {
      _state = state || null;
      _time = 0;
      NPC.pedestrians.length = 0;
      // Pantai ramai di awal: 10 turis di garis pantai, sisanya tersebar di kota.
      for (var i = 0; i < 10; i++) {
        NPC.pedestrians.push(makePedestrian(rand(-130, 130), rand(150, 200), 'tourist'));
      }
      for (var j = 10; j < TARGET_COUNT; j++) {
        var pos = nearestStreet(rand(-CITY_HALF, CITY_HALF), rand(-CITY_HALF, CITY_HALF));
        NPC.pedestrians.push(makePedestrian(pos.x, pos.z));
      }
    },

    spawn: function (x, z) {
      if (NPC.pedestrians.length >= 64) return null;
      var p = makePedestrian(x, z);
      NPC.pedestrians.push(p);
      return p;
    },

    flee: function (x, z) {
      // Semua pejalan kaki dalam radius 26 unit lari menjauh dari (x, z).
      for (var i = 0; i < NPC.pedestrians.length; i++) {
        var p = NPC.pedestrians[i];
        if (dist2(p.x, p.z, x, z) >= 26 * 26) continue;
        p.state = 'flee';
        p.panic = 1;
        p.timer = rand(2.5, 5);
        var dx = p.x - x, dz = p.z - z;
        var len = Math.sqrt(dx * dx + dz * dz) || 1;
        p.targetX = clamp(p.x + (dx / len) * rand(30, 55), -CITY_HALF - 20, CITY_HALF + 20);
        p.targetZ = clamp(p.z + (dz / len) * rand(30, 55), -CITY_HALF - 20, CITY_HALF + 20);
        p.angle = Math.atan2(dx, dz);
        if (p.pet) p.pet.speed = 2.2;
      }
    },

    cheer: function (x, z) {
      // Pejalan kaki di sekitar (x, z) bersorak (mis. pemain menang balapan).
      for (var i = 0; i < NPC.pedestrians.length; i++) {
        var p = NPC.pedestrians[i];
        if (dist2(p.x, p.z, x, z) < 20 * 20 && p.state !== 'flee') {
          p.state = 'cheer';
          p.cheerT = rand(2, 4.5);
          p.timer = p.cheerT;
          p.angle = Math.atan2(x - p.x, z - p.z);
        }
      }
    },

    update: function (dt, state) {
      _time += dt;
      if (state) _state = state;
      var st = _state || state;
      var px = st && st.player ? st.player.x : 0;
      var pz = st && st.player ? st.player.z : 0;
      var wanted = st ? st.wanted : 0;
      var hour = st ? st.timeOfDay : 18.33;
      // Malam hari: sebagian warga pulang, jalanan lebih sepi.
      var nightFactor = (hour < 6 || hour >= 21) ? 0.55 : 1;

      for (var i = NPC.pedestrians.length - 1; i >= 0; i--) {
        var p = NPC.pedestrians[i];
        p.timer -= dt;
        p.bobPhase += dt * (p.state === 'walk' ? p.speed * 4 : 2);

        if (p.state === 'flee') {
          moveToward(p, p.targetX, p.targetZ, FLEE_SPEED, dt);
          if (p.timer <= 0 || reached(p, 2)) {
            p.state = 'walk'; p.panic = 0; p.timer = rand(3, 8);
            pickTarget(p);
            if (p.pet) p.pet.speed = 1.1;
          }
        } else if (p.state === 'cheer') {
          p.cheerT -= dt;
          if (p.cheerT <= 0) { p.state = 'walk'; p.timer = rand(2, 6); pickTarget(p); }
        } else if (p.state === 'selfie') {
          p.selfieT -= dt;
          p.phoneUp = true;
          p.angle += dt * 0.25;   // putar pelan menghadap sunset (barat, -x)
          if (p.selfieT <= 0) {
            p.state = 'walk'; p.phoneUp = false; p.timer = rand(4, 10); pickTarget(p);
          }
        } else if (p.state === 'idle') {
          if (p.timer <= 0) {
            if (p.kind === 'vendor') p.timer = rand(8, 20);
            else if (p.beach && rnd() < 0.5) { p.state = 'selfie'; p.selfieT = rand(2, 5); }
            else { p.state = 'walk'; pickTarget(p); }
          }
        } else {
          var sp = p.kind === 'jogger' ? JOG_SPEED : p.speed;
          moveToward(p, p.targetX, p.targetZ, sp, dt);
          p.steps += dt * sp;
          if (reached(p, 1.5) || p.timer <= 0) {
            var roll = rnd();
            if (roll < 0.14 && p.beach) { p.state = 'selfie'; p.selfieT = rand(2, 5); }
            else if (roll < 0.30) { p.state = 'idle'; p.timer = rand(1.5, 6); }
            else { pickTarget(p); p.timer = rand(6, 14); }
          }
          // Warga menghindar dari pemain yang berlari ke arah mereka.
          if (st && st.player && dist2(p.x, p.z, px, pz) < 4 && wanted === 0) p.angle += dt * 2;
        }

        // Reaksi terhadap wanted: warga menjauh saat polisi mengejar pemain.
        if (wanted >= 3 && dist2(p.x, p.z, px, pz) < 18 * 18 && p.state !== 'flee') {
          NPC.flee(px, pz);
        }
        if (p.pet) updatePet(p.pet, p, dt);
        p.x = clamp(p.x, -CITY_HALF - 25, CITY_HALF + 25);
        p.z = clamp(p.z, -CITY_HALF - 25, CITY_HALF + 25);
      }

      // Jaga populasi: tambah pejalan kaki sampai target (dikurangi malam hari).
      var want = Math.floor(TARGET_COUNT * nightFactor);
      while (NPC.pedestrians.length < want) {
        var sx = rand(-CITY_HALF, CITY_HALF), sz = rand(-CITY_HALF, CITY_HALF);
        if (dist2(sx, sz, px, pz) > 30 * 30) NPC.pedestrians.push(makePedestrian(sx, sz));
        else break;   // jangan spawn tepat di depan pemain
      }
      // Golden hour: warga pantai bertambah.
      if (hour >= 17 && hour <= 19 && rnd() < dt * 0.5 && NPC.pedestrians.length < 40) {
        NPC.pedestrians.push(makePedestrian(rand(-130, 130), rand(150, 200), 'tourist'));
      }
    },

    draw: function (gl, state) {
      if (!gl || !gl.drawMesh || !window.SB.Meshes || !window.SB.Meshes.person) return;
      var M = window.SB.Math3;
      var person = window.SB.Meshes.person;
      for (var i = 0; i < NPC.pedestrians.length; i++) {
        var p = NPC.pedestrians[i];
        var bob = 0, lean = 0;
        if (p.state === 'walk' || p.state === 'flee') {
          bob = Math.abs(Math.sin(p.bobPhase)) * 0.06;
          lean = Math.sin(p.bobPhase) * 0.06;
        } else if (p.state === 'cheer') {
          bob = Math.abs(Math.sin(_time * 9 + i)) * 0.22;
        }
        var m = M.mat4Identity();
        m = M.mat4Translate(m, p.x, bob, p.z);
        m = M.mat4RotateY(m, p.angle + lean);
        m = scaleMat(m, p.scale, p.scale, p.scale);
        gl.drawMesh(person(p.shirt), m, p.shirt);
        if (p.phoneUp) {
          var pm = M.mat4Identity();
          pm = M.mat4Translate(pm, p.x + Math.sin(p.angle) * 0.5, 1.5 * p.scale, p.z + Math.cos(p.angle) * 0.5);
          gl.drawMesh(person([0.1, 0.1, 0.12]), pm, [0.1, 0.1, 0.12]);
        }
        if (p.pet) drawPet(gl, p.pet, M);
      }
    }
  };

  window.SB.NPC = NPC;
})();

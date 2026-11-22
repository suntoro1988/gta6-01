window.SB = window.SB || {};
(function () {
  'use strict';
  // window.SB.NPC — Sunset Bay v12: living pedestrians.
  // 24+ walkers with body/clothing/hair variety; sidewalk walking, selfies,
  // fleeing from chases and gunfire, cheering race wins, beach tourists
  // (sunbathing, beach volleyball) and pet dogs that follow their owners.
  // NPCs react to the player's wanted level. Cross-module calls guarded.
  var pedestrians = [];
  var rng = null, stateRef = null, spawnTimer = 0, panicPulse = 0;
  var SKINS = [[0.96,0.80,0.64],[0.87,0.66,0.47],[0.72,0.50,0.34],[0.55,0.38,0.26],[0.98,0.86,0.72],[0.81,0.58,0.40]];
  var SHIRTS = [[0.85,0.25,0.30],[0.20,0.55,0.85],[0.95,0.75,0.20],[0.30,0.75,0.45],[0.90,0.90,0.92],[0.55,0.30,0.70],[0.95,0.45,0.15],[0.15,0.70,0.65],[0.95,0.55,0.65],[0.25,0.30,0.45],[0.75,0.90,0.30],[0.98,0.35,0.55]];
  var TROUSERS = [[0.15,0.20,0.35],[0.30,0.30,0.32],[0.85,0.85,0.80],[0.55,0.40,0.25],[0.20,0.35,0.55],[0.45,0.20,0.20]];
  var HAIRS = [[0.10,0.08,0.06],[0.30,0.20,0.10],[0.75,0.60,0.35],[0.55,0.55,0.55],[0.85,0.30,0.15],[0.15,0.12,0.25]];
  var DOG_COATS = [[0.55,0.40,0.22],[0.90,0.85,0.75],[0.15,0.12,0.10],[0.75,0.55,0.30],[0.95,0.95,0.95]];
  var SIDEWALK_OFFSETS = [3.4, -3.4, 6.8, -6.8];

  function rnd(a, b) { return rng ? rng.range(a, b) : a + Math.random() * (b - a); }
  function rndInt(a, b) { return rng ? rng.int(a, b) : a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return rng ? rng.pick(arr) : arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) {
    if (window.SB && window.SB.Math3 && window.SB.Math3.clamp) return window.SB.Math3.clamp(v, a, b);
    return v < a ? a : (v > b ? b : v);
  }
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
  function streetPos() {
    if (window.SB && window.SB.City && window.SB.City.randomStreetPos) {
      var p = window.SB.City.randomStreetPos();
      if (p && typeof p.x === 'number') return { x: p.x, z: p.z || 0 };
    }
    return { x: rnd(-90, 90), z: rnd(-90, 90) };
  }
  function beachPos() { return { x: rnd(-70, 70), z: rnd(78, 96) }; } // south edge, by the water

  function makePed(kind, x, z) {
    var p = {
      id: pedestrians.length + 1, kind: kind || 'walker',
      x: x, z: z, y: 0, angle: rnd(0, Math.PI * 2), speed: 0,
      baseSpeed: kind === 'jogger' ? rnd(2.6, 3.4) : rnd(0.9, 1.6),
      body: rnd(0.85, 1.18), // body-type scale: slim .. heavy
      height: rnd(1.62, 1.92) * (kind === 'child' ? 0.72 : 1),
      skin: pick(SKINS), shirt: pick(SHIRTS), trousers: pick(TROUSERS),
      hair: pick(HAIRS), hairStyle: rndInt(0, 3), // 0 short, 1 long, 2 cap, 3 bun
      state: 'walk', // walk|idle|selfie|flee|cheer|sunbathe|volley|sit|perform
      stateT: rnd(0, 6), walkPhase: rnd(0, Math.PI * 2),
      targetX: x, targetZ: z, selfieT: 0, cheerT: 0, fleeX: 0, fleeZ: 0,
      owner: null, dog: null, partner: null, instrument: null,
      mood: rnd(0.4, 1.0), district: ''
    };
    if (window.SB && window.SB.City && window.SB.City.districtAt) p.district = window.SB.City.districtAt(x, z) || '';
    if (p.kind === 'beach' || p.kind === 'tourist') p.state = 'sunbathe';
    if (p.kind === 'dog') { p.state = 'walk'; p.baseSpeed = 2.2; }
    return p;
  }
  function pickNewTarget(p) {
    var s = streetPos(), off = pick(SIDEWALK_OFFSETS);
    p.targetX = s.x + off; p.targetZ = s.z; // nudge onto a sidewalk lane
    p.angle = Math.atan2(p.targetX - p.x, p.targetZ - p.z);
  }
  function spawnDog(owner) {
    var dog = makePed('dog', owner.x + rnd(-1, 1), owner.z + rnd(-1, 1));
    dog.coat = pick(DOG_COATS); dog.owner = owner; owner.dog = dog;
    pedestrians.push(dog);
    return dog;
  }
  function spawn(x, z) {
    var kind = pick(['walker', 'walker', 'walker', 'tourist', 'jogger', 'child']);
    var s = streetPos();
    var px = (typeof x === 'number') ? x : s.x, pz = (typeof z === 'number') ? z : s.z;
    var p = makePed(kind, px, pz);
    pickNewTarget(p);
    pedestrians.push(p);
    if (kind === 'walker' && Math.random() < 0.2) spawnDog(p); // 1 in 5 brings a dog
    return p;
  }
  function spawnBeachCrowd() {
    for (var i = 0; i < 8; i++) {
      var pos = beachPos(), kind = (i < 2) ? 'volley' : 'beach';
      var p = makePed(kind, pos.x, pos.z);
      p.state = (kind === 'volley') ? 'volley' : 'sunbathe';
      p.stateT = rnd(4, 20); p.angle = rnd(0, Math.PI * 2);
      pedestrians.push(p);
    }
  }
  // Street performer: plays music on a corner; nearby walkers stop to watch.
  function spawnPerformer() {
    var s = streetPos();
    var p = makePed('performer', s.x, s.z);
    p.state = 'perform'; p.stateT = rnd(20, 40);
    p.instrument = pick(['guitar', 'drums', 'sax']);
    pedestrians.push(p);
    return p;
  }
  // Friends walking together: a pair sharing one destination, side by side.
  function spawnPair() {
    var s = streetPos(), off = pick(SIDEWALK_OFFSETS);
    var a = makePed('walker', s.x + off, s.z), b = makePed('walker', s.x + off + 0.9, s.z + 0.4);
    a.partner = b; b.partner = a;
    pickNewTarget(a);
    b.targetX = a.targetX + 0.9; b.targetZ = a.targetZ + 0.4;
    pedestrians.push(a); pedestrians.push(b);
    return [a, b];
  }
  function init(state) {
    stateRef = state || null;
    pedestrians.length = 0; rng = null;
    if (window.SB && window.SB.Rng && window.SB.Rng.make) rng = window.SB.Rng.make(20261121);
    for (var i = 0; i < 18; i++) spawn(); // street walkers
    spawnBeachCrowd(); // 8 beach tourists -> 26 pedestrians at start
    spawnPair(); // two friends walking together
    spawnPerformer(); // street musician on a corner
    spawnTimer = 0; panicPulse = 0;
  }
  // Everyone within radius 26 of (x,z) runs away from that point.
  function flee(x, z) {
    var r = 26;
    for (var i = 0; i < pedestrians.length; i++) {
      var p = pedestrians[i];
      if (p.kind === 'dog') continue; // dogs follow their owners
      if (dist2(p.x, p.z, x, z) < r * r) {
        p.state = 'flee'; p.stateT = rnd(2.5, 5);
        var dx = p.x - x, dz = p.z - z, len = Math.sqrt(dx * dx + dz * dz) || 1;
        p.fleeX = p.x + (dx / len) * 30; p.fleeZ = p.z + (dz / len) * 30;
        p.angle = Math.atan2(p.fleeX - p.x, p.fleeZ - p.z);
      }
    }
    panicPulse = 1;
  }
  // Everyone near (x,z) cheers: race wins, heist escapes, big stunts.
  function cheer(x, z) {
    for (var i = 0; i < pedestrians.length; i++) {
      var p = pedestrians[i];
      if (p.kind === 'dog') continue;
      if (dist2(p.x, p.z, x, z) < 30 * 30) {
        p.state = 'cheer'; p.cheerT = rnd(2.5, 4.5); p.stateT = p.cheerT;
        p.angle = Math.atan2(x - p.x, z - p.z);
      }
    }
    if (window.SB && window.SB.Audio && window.SB.Audio.sfx) window.SB.Audio.sfx('cheer');
  }
  function updatePed(p, dt, state) {
    var px = state && state.player ? state.player.x : 0;
    var pz = state && state.player ? state.player.z : 0;
    var wanted = state ? (state.wanted || 0) : 0;
    p.stateT -= dt;
    p.walkPhase += dt * (p.speed * 4 + 1);
    // Dogs: trot after their owner, never stray far.
    if (p.kind === 'dog' && p.owner) {
      var odx = p.owner.x - p.x, odz = p.owner.z - p.z;
      var od = Math.sqrt(odx * odx + odz * odz);
      if (od > 2.2) {
        p.angle = Math.atan2(odx, odz); p.speed = Math.min(3.2, od * 1.4);
        p.x += Math.sin(p.angle) * p.speed * dt; p.z += Math.cos(p.angle) * p.speed * dt;
      } else { p.speed = 0; p.angle = p.owner.angle; }
      return;
    }
    // Fleeing: sprint away, then calm down.
    if (p.state === 'flee') {
      var fdx = p.fleeX - p.x, fdz = p.fleeZ - p.z;
      var fd = Math.sqrt(fdx * fdx + fdz * fdz);
      p.speed = 4.2 * p.mood + 1.2;
      if (fd > 0.6 && p.stateT > 0) {
        p.angle = Math.atan2(fdx, fdz);
        p.x += Math.sin(p.angle) * p.speed * dt; p.z += Math.cos(p.angle) * p.speed * dt;
      } else { p.state = 'idle'; p.stateT = rnd(1, 3); p.speed = 0; }
      return;
    }
    // Cheering: jump, wave arms, face the action.
    if (p.state === 'cheer') {
      p.speed = 0;
      if (p.stateT <= 0) { p.state = 'idle'; p.stateT = rnd(1, 2); }
      return;
    }
    // Selfie: stop, raise the phone, hold the pose.
    if (p.state === 'selfie') {
      p.speed = 0; p.selfieT -= dt;
      if (p.selfieT <= 0) { p.state = 'walk'; p.stateT = rnd(4, 10); pickNewTarget(p); }
      return;
    }
    // Sunbathing: lie still on the sand, occasionally sit up / wander off.
    if (p.state === 'sunbathe') {
      p.speed = 0;
      if (p.stateT <= 0) {
        if (Math.random() < 0.35) { p.state = 'walk'; p.stateT = rnd(5, 12); pickNewTarget(p); }
        else { p.stateT = rnd(8, 20); p.angle += rnd(-1, 1); }
      }
      return;
    }
    // Beach volleyball: shuffle side to side, jump for the ball.
    if (p.state === 'volley') {
      p.speed = 0;
      p.x += Math.sin((stateRef ? stateRef.time : 0) * 1.6 + p.id) * 0.9 * dt;
      if (p.stateT <= 0) { p.state = 'sunbathe'; p.stateT = rnd(6, 14); }
      return;
    }
    // Idle: look around, maybe take a selfie or start walking.
    if (p.state === 'idle' || p.state === 'sit') {
      p.speed = 0;
      if (p.stateT <= 0) {
        if (Math.random() < 0.22 && p.kind !== 'child') {
          p.state = 'selfie'; p.selfieT = rnd(2, 4); p.stateT = p.selfieT;
        } else { p.state = 'walk'; p.stateT = rnd(6, 14); pickNewTarget(p); }
      }
      return;
    }
    // Street performer: plays on the spot; nearby walkers stop to watch.
    if (p.state === 'perform') {
      p.speed = 0;
      p.walkPhase += dt * 3; // swaying while playing
      if (p.stateT <= 0) { p.state = 'walk'; p.stateT = rnd(5, 10); pickNewTarget(p); }
      // A passing walker may pause to listen for a while.
      for (var w = 0; w < pedestrians.length; w++) {
        var q = pedestrians[w];
        if (q !== p && q.state === 'walk' && dist2(q.x, q.z, p.x, p.z) < 4 * 4 && Math.random() < dt * 0.3) {
          q.state = 'idle'; q.stateT = rnd(3, 8);
          q.angle = Math.atan2(p.x - q.x, p.z - q.z);
        }
      }
      return;
    }
    // Rain: pedestrians hurry for cover and the beach empties out.
    var raining = state.weather && state.weather.rain > 0.5;
    if (raining && (p.state === 'walk' || p.state === 'sunbathe' || p.state === 'volley')) {
      if (p.kind === 'beach' || p.kind === 'tourist') {
        p.state = 'walk'; p.stateT = rnd(5, 10); pickNewTarget(p); // off the sand
      }
      p.baseSpeed = Math.max(p.baseSpeed, 2.4); // hurry under cover
    }
    // Walking: head for the target along the sidewalk.
    var dx = p.targetX - p.x, dz = p.targetZ - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    p.speed = p.baseSpeed;
    if (d < 1.2) { p.state = 'idle'; p.stateT = rnd(1.5, 5); p.speed = 0; return; }
    p.angle = Math.atan2(dx, dz);
    // Partners walk in step: the second friend matches the first's pace.
    if (p.partner && p.partner.state === 'walk') p.speed = p.partner.speed || p.speed;
    p.x += Math.sin(p.angle) * p.speed * dt; p.z += Math.cos(p.angle) * p.speed * dt;
    p.x = clamp(p.x, -110, 110); p.z = clamp(p.z, -110, 110);
    // Wanted reaction: at 2+ stars nearby pedestrians panic and run.
    if (wanted >= 2 && dist2(p.x, p.z, px, pz) < 18 * 18 && Math.random() < dt * 2 * p.mood) flee(px, pz);
  }
  function update(dt, state) {
    if (!state) state = stateRef; else stateRef = state;
    if (!state) return;
    dt = Math.min(dt || 0.016, 0.1);
    panicPulse = Math.max(0, panicPulse - dt * 2);
    // Gunfire / explosions nearby scare the crowd (reported via flags.shotAt).
    var shot = state.flags && state.flags.shotAt;
    if (shot && typeof shot.x === 'number') { flee(shot.x, shot.z); state.flags.shotAt = null; }
    // A chase rolling past at speed also spooks walkers.
    if (state.wanted >= 1 && state.player && !state.player.onFoot && Math.random() < dt * 0.8) {
      flee(state.player.x, state.player.z);
    }
    for (var i = 0; i < pedestrians.length; i++) updatePed(pedestrians[i], dt, state);
    // Top the crowd back up if pedestrians wander off or get removed.
    spawnTimer -= dt;
    if (pedestrians.length < 24 && spawnTimer <= 0) { spawn(); spawnTimer = 1.5; }
    // Beach stays busy while the sun is up.
    if (state.timeOfDay >= 8 && state.timeOfDay <= 20 && pedestrians.length < 30 && Math.random() < dt * 0.2) {
      var pos = beachPos(), bp = makePed('beach', pos.x, pos.z);
      bp.state = 'sunbathe'; bp.stateT = rnd(8, 20);
      pedestrians.push(bp);
    }
  }
  function drawPed(gl, p) {
    if (!gl || !gl.drawMesh || !window.SB.Meshes || !window.SB.Meshes.person || !window.SB.Math3) return;
    var m, bob = 0;
    if (p.state === 'walk' || p.state === 'flee') bob = Math.abs(Math.sin(p.walkPhase)) * 0.05;
    if (p.state === 'cheer') bob = Math.abs(Math.sin(p.walkPhase * 2.2)) * 0.22;
    if (p.state === 'volley') bob = Math.abs(Math.sin(p.walkPhase * 1.8)) * 0.18;
    if (p.kind === 'dog') {
      // Low quadruped: person mesh in coat colour, squashed to the ground.
      var dm = window.SB.Math3.mat4Identity();
      dm = window.SB.Math3.mat4Translate(dm, p.x, 0.22, p.z);
      dm = window.SB.Math3.mat4RotateY(dm, p.angle);
      gl.drawMesh(window.SB.Meshes.person(p.coat || [0.5, 0.4, 0.25]), dm, p.coat || [0.5, 0.4, 0.25]);
      return;
    }
    if (p.state === 'sunbathe') {
      // Sunbathers lie flat on the sand.
      var lm = window.SB.Math3.mat4Identity();
      lm = window.SB.Math3.mat4Translate(lm, p.x, 0.18, p.z);
      lm = window.SB.Math3.mat4RotateY(lm, p.angle);
      gl.drawMesh(window.SB.Meshes.person(p.shirt), lm, p.shirt);
      return;
    }
    m = window.SB.Math3.mat4Identity();
    m = window.SB.Math3.mat4Translate(m, p.x, p.y, p.z);
    m = window.SB.Math3.mat4RotateY(m, p.angle);
    m = window.SB.Math3.mat4Translate(m, 0, bob, 0);
    gl.drawMesh(window.SB.Meshes.person(p.shirt), m, p.shirt);
    // Selfie phone: small bright slab held up beside the head.
    if (p.state === 'selfie' && window.SB.Meshes.box) {
      var pm = window.SB.Math3.mat4Identity();
      pm = window.SB.Math3.mat4Translate(pm, p.x + Math.sin(p.angle) * 0.35, 1.55 * p.height, p.z + Math.cos(p.angle) * 0.35);
      gl.drawMesh(window.SB.Meshes.box(0.12, 0.22, 0.03), pm, [0.1, 0.1, 0.12]);
    }
    // Performer instrument: guitar-shaped slab held across the body.
    if (p.state === 'perform' && p.instrument === 'guitar' && window.SB.Meshes.box) {
      var gm = window.SB.Math3.mat4Identity();
      gm = window.SB.Math3.mat4Translate(gm, p.x, 1.0, p.z);
      gm = window.SB.Math3.mat4RotateY(gm, p.angle + 0.6);
      gl.drawMesh(window.SB.Meshes.box(0.35, 0.9, 0.1), gm, [0.55, 0.35, 0.15]);
    }
  }
  function draw(gl, state) {
    if (!gl) return;
    for (var i = 0; i < pedestrians.length; i++) drawPed(gl, pedestrians[i]);
    void state;
  }
  window.SB.NPC = { init: init, update: update, draw: draw, spawn: spawn, flee: flee, cheer: cheer, pedestrians: pedestrians };
})();

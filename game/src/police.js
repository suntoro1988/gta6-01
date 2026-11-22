window.SB = window.SB || {};
(function () {
  'use strict';
  // window.SB.Police — Sunset Bay v12: law-enforcement AI.
  // Patrol cruisers, pursuit at wanted >= 1, roadblocks at wanted >= 2,
  // PIT maneuvers at wanted >= 3, tactical helicopter AIR-1 at wanted >= 3
  // (searchlight sweeping the streets, firing from the air), shared player
  // position between all units, and BUSTED when the player is caught
  // (HP 0, or surrounded and standing still). Cross-module calls guarded.
  var cops = [];
  var heli = null, roadblocks = [];
  var rng = null, stateRef = null, wantedLevel = 0;
  var spawnTimer = 0, bustedTimer = 0, busted = false, sirenT = 0;
  var lastKnownX = 0, lastKnownZ = 0, lastKnownT = 0;
  var LIGHTBAR = [[1, 0.15, 0.15], [0.2, 0.4, 1]]; // red / blue alternating

  function rnd(a, b) { return rng ? rng.range(a, b) : a + Math.random() * (b - a); }
  function clamp(v, a, b) {
    if (window.SB && window.SB.Math3 && window.SB.Math3.clamp) return window.SB.Math3.clamp(v, a, b);
    return v < a ? a : (v > b ? b : v);
  }
  function dist(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }
  function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }
  function turnToward(cur, target, maxStep) {
    var d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return cur + clamp(d, -maxStep, maxStep);
  }
  function streetPosNear(x, z, r) {
    if (window.SB && window.SB.City && window.SB.City.randomStreetPos) {
      for (var i = 0; i < 6; i++) {
        var p = window.SB.City.randomStreetPos();
        if (p && typeof p.x === 'number' && dist(p.x, p.z || 0, x, z) < r) return { x: p.x, z: p.z || 0 };
      }
    }
    var a = rnd(0, Math.PI * 2);
    return { x: x + Math.cos(a) * r * 0.6, z: z + Math.sin(a) * r * 0.6 };
  }
  function makeCop(x, z, onFoot) {
    return {
      id: cops.length + 1, x: x, z: z, y: 0, angle: rnd(0, Math.PI * 2), speed: 0,
      onFoot: !!onFoot, state: 'patrol', // patrol|pursue|roadblock|pit|arrest
      stateT: rnd(3, 8), targetX: x, targetZ: z, siren: false,
      sirenPhase: rnd(0, Math.PI * 2), ramCooldown: 0, stuckT: 0, lastX: x, lastZ: z
    };
  }
  function makeHeli() {
    return {
      name: 'AIR-1', active: false, x: 0, y: 42, z: 0, angle: 0, rotor: 0,
      spotlightX: 0, spotlightZ: 0, sweepT: 0, fireCooldown: 0, searchT: 0
    };
  }
  function init(state) {
    stateRef = state || null;
    cops.length = 0; roadblocks.length = 0; rng = null;
    if (window.SB && window.SB.Rng && window.SB.Rng.make) rng = window.SB.Rng.make(777001);
    heli = makeHeli();
    wantedLevel = state ? (state.wanted || 0) : 0;
    spawnTimer = 0; bustedTimer = 0; busted = false;
    for (var i = 0; i < 2; i++) { // two cruisers always on patrol, even at 0 stars
      var p = streetPosNear(0, 0, 80);
      cops.push(makeCop(p.x, p.z, false));
    }
    if (state && state.player) { lastKnownX = state.player.x; lastKnownZ = state.player.z; }
  }
  // Set the wanted level (0-5). Spawns / despawns units to match.
  function setWanted(n) {
    n = clamp(Math.round(n || 0), 0, 5);
    wantedLevel = n;
    if (stateRef) { stateRef.wanted = n; stateRef.heat = n * 20; }
    if (window.SB && window.SB.HUD && window.SB.HUD.setWanted) window.SB.HUD.setWanted(n);
    var wantCops = n === 0 ? 2 : 2 + n; // 3..7 units on the street
    while (cops.length < wantCops) {
      var px = stateRef && stateRef.player ? stateRef.player.x : 0;
      var pz = stateRef && stateRef.player ? stateRef.player.z : 0;
      var s = streetPosNear(px, pz, 55), c = makeCop(s.x, s.z, false);
      c.state = n >= 1 ? 'pursue' : 'patrol';
      cops.push(c);
    }
    while (cops.length > wantCops && cops.length > 2) cops.pop();
    if (heli) heli.active = n >= 3;
    if (n >= 2 && roadblocks.length === 0 && stateRef && stateRef.player) {
      roadblock(stateRef.player.x + 25, stateRef.player.z);
    }
    if (n === 0) roadblocks.length = 0;
  }
  // Park two cruisers across the road at (x,z) to block the player.
  function roadblock(x, z) {
    var a = rnd(0, Math.PI * 2);
    for (var i = 0; i < 2; i++) {
      var bx = x + Math.cos(a) * (i === 0 ? -3 : 3), bz = z + Math.sin(a) * (i === 0 ? -3 : 3);
      var c = makeCop(bx, bz, false);
      c.state = 'roadblock'; c.angle = a + Math.PI / 2; c.speed = 0;
      cops.push(c);
      roadblocks.push({ x: bx, z: bz, angle: c.angle, cop: c });
    }
    if (window.SB && window.SB.HUD && window.SB.HUD.showToast) window.SB.HUD.showToast('Roadblock ahead!');
    return roadblocks[roadblocks.length - 1];
  }
  // One cruiser pulls alongside target and shoves it sideways. target: {x,z,angle}.
  function pit(target) {
    if (!target) return false;
    var best = null, bestD = 1e9;
    for (var i = 0; i < cops.length; i++) {
      var c = cops[i];
      if (c.onFoot || c.state === 'roadblock') continue;
      var d = dist(c.x, c.z, target.x, target.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best || bestD > 60) return false;
    best.state = 'pit'; best.stateT = 6; best.ramCooldown = 0;
    return true;
  }
  // Coordination: every unit knows the player's last seen position, even
  // units that never had line of sight. It goes stale after 6 seconds.
  function sharePlayerPos(state) {
    if (!state || !state.player) return;
    lastKnownX = state.player.x; lastKnownZ = state.player.z; lastKnownT = state.time || 0;
    for (var i = 0; i < cops.length; i++) { cops[i].targetX = lastKnownX; cops[i].targetZ = lastKnownZ; }
  }
  function doPitShove(c) {
    // Push the player's vehicle sideways + spin it; sparks + crash sound.
    if (window.SB && window.SB.Vehicles && window.SB.Vehicles.cars) {
      var cars = window.SB.Vehicles.cars;
      for (var i = 0; i < cars.length; i++) {
        if (cars[i] && cars[i].player) {
          cars[i].x += Math.sin(c.angle) * 1.6; cars[i].z += Math.cos(c.angle) * 1.6;
          if (typeof cars[i].angle === 'number') cars[i].angle += 0.5;
        }
      }
    }
    if (window.SB && window.SB.FX && window.SB.FX.sparks) window.SB.FX.sparks(c.x, 0.6, c.z);
    if (window.SB && window.SB.Audio && window.SB.Audio.sfx) window.SB.Audio.sfx('crash');
  }
  function updateCop(c, dt, state) {
    var px = state.player ? state.player.x : lastKnownX;
    var pz = state.player ? state.player.z : lastKnownZ;
    var pAngle = state.player && typeof state.player.angle === 'number' ? state.player.angle : 0;
    c.ramCooldown = Math.max(0, c.ramCooldown - dt);
    c.sirenPhase += dt * 6;
    // Stuck detection: cruiser not moving -> pick a fresh target later.
    if (dist(c.x, c.z, c.lastX, c.lastZ) < 0.05 && c.speed > 1) c.stuckT += dt; else c.stuckT = 0;
    c.lastX = c.x; c.lastZ = c.z;
    if (c.state === 'roadblock') { c.speed = 0; c.siren = true; return; } // parked across the road
    if (c.state === 'arrest') { // on foot, closing in for the bust
      c.speed = 2.4;
      c.angle = turnToward(c.angle, angleTo(c.x, c.z, px, pz), dt * 5);
      c.x += Math.sin(c.angle) * c.speed * dt; c.z += Math.cos(c.angle) * c.speed * dt;
      return;
    }
    if (c.state === 'pit') { // pull alongside rear quarter, then shove sideways
      var tx = px + Math.sin(pAngle + Math.PI / 2) * 3.2, tz = pz + Math.cos(pAngle + Math.PI / 2) * 3.2;
      var pd = dist(c.x, c.z, tx, tz);
      c.angle = turnToward(c.angle, angleTo(c.x, c.z, tx, tz), dt * 4);
      c.speed = pd > 2 ? 9.5 : 7.5;
      c.x += Math.sin(c.angle) * c.speed * dt; c.z += Math.cos(c.angle) * c.speed * dt;
      if (pd < 2.4 && c.ramCooldown <= 0) { c.ramCooldown = 2.5; doPitShove(c); }
      c.stateT -= dt;
      if (c.stateT <= 0) c.state = 'pursue';
      return;
    }
    if (c.state === 'pursue') {
      var seen = dist(c.x, c.z, px, pz) < 55; // "seen" -> aim live, else last-known
      var gx = seen ? px : lastKnownX, gz = seen ? pz : lastKnownZ;
      var d = dist(c.x, c.z, gx, gz);
      c.siren = true;
      c.angle = turnToward(c.angle, angleTo(c.x, c.z, gx, gz), dt * 3.2);
      var chaseSpeed = state.player && !state.player.onFoot ? 11.5 : 6.5;
      if (wantedLevel >= 4) chaseSpeed += 1.5;
      c.speed = d > 3 ? chaseSpeed : 2;
      c.x += Math.sin(c.angle) * c.speed * dt; c.z += Math.cos(c.angle) * c.speed * dt;
      if (wantedLevel >= 3 && d < 14 && c.ramCooldown <= 0 && Math.random() < dt * 0.4) pit(state.player);
      if (d < 2.5 && state.player && state.player.onFoot) { c.state = 'arrest'; c.onFoot = true; c.speed = 0; }
      if (c.stuckT > 3) { c.state = 'patrol'; c.stuckT = 0; }
      return;
    }
    // Patrol: cruise between street points, siren off.
    c.siren = false;
    var td = dist(c.x, c.z, c.targetX, c.targetZ);
    if (td < 3 || c.stateT <= 0) {
      var s = streetPosNear(c.x, c.z, 60);
      c.targetX = s.x; c.targetZ = s.z; c.stateT = rnd(6, 12);
    }
    c.angle = turnToward(c.angle, angleTo(c.x, c.z, c.targetX, c.targetZ), dt * 2.2);
    c.speed = 5.5;
    c.x += Math.sin(c.angle) * c.speed * dt; c.z += Math.cos(c.angle) * c.speed * dt;
    c.stateT -= dt;
    if (wantedLevel >= 1) c.state = 'pursue'; // wanted went up: join the chase
  }
  function updateHeli(dt, state) {
    if (!heli) return;
    heli.rotor += dt * 22;
    if (!heli.active) { heli.y = 60; return; } // parked out of sight until called in
    var px = state.player ? state.player.x : 0, pz = state.player ? state.player.z : 0;
    heli.sweepT += dt;
    var orbitA = heli.sweepT * 0.35; // hover above, slightly behind, circling slowly
    heli.x += (px + Math.cos(orbitA) * 16 - heli.x) * Math.min(1, dt * 1.2);
    heli.z += (pz + Math.sin(orbitA) * 16 - heli.z) * Math.min(1, dt * 1.2);
    heli.y += (42 - heli.y) * Math.min(1, dt * 0.8);
    heli.angle = angleTo(heli.x, heli.z, px, pz);
    // Spotlight sweeps the street around the player in a slow circle.
    var sweepR = 9 + Math.sin(heli.sweepT * 0.9) * 4;
    heli.spotlightX = px + Math.cos(heli.sweepT * 0.7) * sweepR;
    heli.spotlightZ = pz + Math.sin(heli.sweepT * 0.7) * sweepR;
    // Tactical fire from the air: short bursts when the player is exposed.
    heli.fireCooldown -= dt;
    if (heli.fireCooldown <= 0 && state.player && state.player.onFoot) {
      heli.fireCooldown = rnd(2.2, 3.5);
      if (window.SB && window.SB.FX && window.SB.FX.sparks) window.SB.FX.sparks(px, 0.4, pz);
      if (window.SB && window.SB.Audio && window.SB.Audio.sfx) window.SB.Audio.sfx('heliShot');
      if (window.SB && window.SB.Player && window.SB.Player.takeDamage) window.SB.Player.takeDamage(6);
    }
    sirenT -= dt;
    if (sirenT <= 0 && window.SB && window.SB.Audio && window.SB.Audio.sfx) { sirenT = 4; window.SB.Audio.sfx('heli'); }
  }
  function doBusted(state, msg) {
    busted = true;
    state.wanted = 0; wantedLevel = 0; state.heat = 0;
    state.flags = state.flags || {};
    state.flags.busted = true;
    if (window.SB && window.SB.HUD && window.SB.HUD.showMission) window.SB.HUD.showMission(msg);
    if (window.SB && window.SB.HUD && window.SB.HUD.setWanted) window.SB.HUD.setWanted(0);
    if (window.SB && window.SB.Audio && window.SB.Audio.sfx) window.SB.Audio.sfx('busted');
    if (window.SB && window.SB.NPC && window.SB.NPC.cheer) window.SB.NPC.cheer(state.player.x, state.player.z);
    for (var i = 0; i < cops.length; i++) { cops[i].state = 'patrol'; cops[i].siren = false; }
    if (heli) heli.active = false;
    roadblocks.length = 0;
    if (state.money > 0) state.money = Math.max(0, Math.floor(state.money * 0.85)); // bail: lose 15%
    if (window.SB && window.SB.HUD && window.SB.HUD.setMoney) window.SB.HUD.setMoney(state.money);
  }
  function checkBusted(dt, state) {
    if (busted) return;
    var hp = (state.player && typeof state.player.hp === 'number') ? state.player.hp : 100;
    var px = state.player ? state.player.x : 0, pz = state.player ? state.player.z : 0;
    if (hp <= 0 && wantedLevel >= 1) { doBusted(state, 'You were knocked out and arrested.'); return; }
    // Surrounded on foot, standing still, cops closing in.
    if (wantedLevel >= 1 && state.player && state.player.onFoot) {
      var close = 0;
      for (var i = 0; i < cops.length; i++) if (dist(cops[i].x, cops[i].z, px, pz) < 4) close++;
      var moving = state.player.speed !== undefined && Math.abs(state.player.speed) > 0.4;
      if (close >= 2 && !moving) {
        bustedTimer += dt;
        if (bustedTimer > 2.5) doBusted(state, 'Surrounded. BUSTED!');
      } else bustedTimer = 0;
    } else bustedTimer = 0;
  }
  function update(dt, state) {
    if (!state) state = stateRef; else stateRef = state;
    if (!state) return;
    dt = Math.min(dt || 0.016, 0.1);
    if (typeof state.wanted === 'number' && state.wanted !== wantedLevel) setWanted(state.wanted);
    sharePlayerPos(state);
    for (var i = 0; i < cops.length; i++) updateCop(cops[i], dt, state);
    updateHeli(dt, state);
    checkBusted(dt, state);
    // Reinforcements trickle in while the heat stays high.
    spawnTimer -= dt;
    if (wantedLevel >= 2 && cops.length < 2 + wantedLevel && spawnTimer <= 0) {
      var s = streetPosNear(state.player.x, state.player.z, 60);
      var c = makeCop(s.x, s.z, false);
      c.state = 'pursue'; cops.push(c); spawnTimer = 4;
    }
    // Heat cools slowly once the chase is truly lost (no cop near for a while).
    if (wantedLevel > 0 && state.time - lastKnownT > 20) {
      var near = false;
      for (var j = 0; j < cops.length; j++) if (dist(cops[j].x, cops[j].z, state.player.x, state.player.z) < 30) near = true;
      if (!near && Math.random() < dt * 0.05) setWanted(wantedLevel - 1);
    }
  }
  function drawCop(gl, c) {
    if (!gl || !gl.drawMesh || !window.SB.Math3) return;
    var m = window.SB.Math3.mat4Identity();
    m = window.SB.Math3.mat4Translate(m, c.x, c.y || 0, c.z);
    m = window.SB.Math3.mat4RotateY(m, c.angle);
    if (c.onFoot) {
      if (window.SB.Meshes && window.SB.Meshes.person) gl.drawMesh(window.SB.Meshes.person([0.08, 0.12, 0.22]), m, [0.08, 0.12, 0.22]);
      return;
    }
    if (window.SB.Meshes && window.SB.Meshes.car) gl.drawMesh(window.SB.Meshes.car([0.92, 0.92, 0.95]), m, [0.92, 0.92, 0.95]);
    // Flashing light bar: red/blue alternating with the siren phase.
    if (c.siren && window.SB.Meshes && window.SB.Meshes.box) {
      var lm = window.SB.Math3.mat4Identity();
      lm = window.SB.Math3.mat4Translate(lm, c.x, 1.15, c.z);
      lm = window.SB.Math3.mat4RotateY(lm, c.angle);
      gl.drawMesh(window.SB.Meshes.box(0.9, 0.14, 0.3), lm, Math.sin(c.sirenPhase) > 0 ? LIGHTBAR[0] : LIGHTBAR[1]);
    }
  }
  function drawHeli(gl) {
    if (!gl || !gl.drawMesh || !window.SB.Math3 || !heli || !heli.active || !window.SB.Meshes || !window.SB.Meshes.box) return;
    var m = window.SB.Math3.mat4Identity();
    m = window.SB.Math3.mat4Translate(m, heli.x, heli.y, heli.z);
    m = window.SB.Math3.mat4RotateY(m, heli.angle);
    gl.drawMesh(window.SB.Meshes.box(3.4, 1.3, 1.6), m, [0.12, 0.13, 0.16]); // body, dark tactical
    var tm = window.SB.Math3.mat4Identity();
    tm = window.SB.Math3.mat4Translate(tm, heli.x - Math.sin(heli.angle) * 3.2, heli.y + 0.2, heli.z - Math.cos(heli.angle) * 3.2);
    tm = window.SB.Math3.mat4RotateY(tm, heli.angle);
    gl.drawMesh(window.SB.Meshes.box(2.6, 0.4, 0.4), tm, [0.12, 0.13, 0.16]); // tail
    var rm = window.SB.Math3.mat4Identity();
    rm = window.SB.Math3.mat4Translate(rm, heli.x, heli.y + 0.85, heli.z);
    rm = window.SB.Math3.mat4RotateY(rm, heli.rotor);
    gl.drawMesh(window.SB.Meshes.box(7.5, 0.08, 0.35), rm, [0.25, 0.25, 0.28]); // spinning rotor
    // Searchlight marker on the ground: bright disc where it sweeps.
    var sm = window.SB.Math3.mat4Identity();
    sm = window.SB.Math3.mat4Translate(sm, heli.spotlightX, 0.06, heli.spotlightZ);
    gl.drawMesh(window.SB.Meshes.box(3.2, 0.05, 3.2), sm, [1.0, 0.95, 0.6]);
  }
  function draw(gl, state) {
    if (!gl) return;
    for (var i = 0; i < cops.length; i++) drawCop(gl, cops[i]);
    drawHeli(gl);
    void state;
  }
  window.SB.Police = {
    init: init, update: update, draw: draw, setWanted: setWanted,
    roadblock: roadblock, pit: pit, heli: null, cops: cops
  };
  // Expose the live heli object: init() swaps the reference, and game.js
  // always reads the current AIR-1 state via window.SB.Police.heli.
  Object.defineProperty(window.SB.Police, 'heli', {
    get: function () { return heli; }, configurable: true
  });
})();

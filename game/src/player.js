(function () {
  "use strict";
  var SB = window.SB = window.SB || {};
  var WALK = 4, RUN = 12, TURN = 2.8, RADIUS = 0.7;

  function G() { return SB.G; }

  function key(input, names) {
    if (!input) return false;
    for (var i = 0; i < names.length; i++) {
      if (input[names[i]]) return true;
    }
    return false;
  }

  // True when point (x,z) would clip a building (AABB + player radius).
  function blocked(x, z) {
    var C = SB.City;
    if (!C || !C.buildings) return false;
    var b = C.buildings;
    for (var i = 0; i < b.length; i++) {
      var hw = (b[i].w || 10) / 2 + RADIUS;
      var hd = (b[i].d || 10) / 2 + RADIUS;
      if (Math.abs(x - b[i].x) < hw && Math.abs(z - b[i].z) < hd) return true;
    }
    return false;
  }

  SB.Player = {
    // input: booleans under any of these aliases:
    // forward: up/w/forward | back: down/s/back
    // turn: left/a/turnLeft | right/d/turnRight | run: run/shift
    update: function (dt, input) {
      var g = G();
      if (!g || !g.player) return;
      var p = g.player;
      if (p.inCar) { p.speed = 0; return; }
      // Naik speedboat: flag-nya SB.G.player.inBoat (dipakai Water);
      // SB.Water.riding tidak pernah ada — cek itu membuat pemain tetap
      // jalan kaki selagi di kapal.
      if (p.inBoat) { p.speed = 0; return; }
      var fwd = key(input, ["up", "w", "forward", "W"]);
      var back = key(input, ["down", "s", "back", "S"]);
      var left = key(input, ["left", "a", "turnLeft", "A"]);
      var right = key(input, ["right", "d", "turnRight", "D"]);
      var run = key(input, ["run", "shift", "Shift"]);
      if (left) p.yaw += TURN * dt;
      if (right) p.yaw -= TURN * dt;
      var sp = 0;
      if (fwd) sp = run ? RUN : WALK;
      else if (back) sp = -(run ? RUN : WALK) * 0.6;
      var nx = p.x + Math.sin(p.yaw) * sp * dt;
      var nz = p.z + Math.cos(p.yaw) * sp * dt;
      // Move axis by axis so the player slides along walls instead of sticking.
      if (!blocked(nx, p.z)) p.x = nx;
      if (!blocked(p.x, nz)) p.z = nz;
      p.speed = Math.abs(sp);
      if (sp !== 0) g.dist = (g.dist || 0) + Math.abs(sp) * dt;
    },
    pos: function () {
      var g = G();
      if (!g || !g.player) return { x: 0, z: 0 };
      return { x: g.player.x, z: g.player.z };
    }
  };
})();

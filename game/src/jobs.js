(function () {
  "use strict";
  var SB = window.SB = window.SB || {};

  function G() { return SB.G; }

  function msg(t) {
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage(t);
  }

  function sfx(n) {
    if (SB.Audio && SB.Audio.sfx) SB.Audio.sfx(n);
  }

  // Snap a point to a collision-free spot when City can help.
  function spot(x, z) {
    if (SB.City && SB.City.findClearSpot) {
      var s = SB.City.findClearSpot(x, z, 4);
      if (s) return { x: s.x, z: s.z };
    }
    return { x: x, z: z };
  }

  function rndSpot() {
    return spot((Math.random() * 320) - 160, (Math.random() * 320) - 160);
  }

  function distTo(p) {
    var g = G();
    if (!g || !p) return 1e9;
    return Math.hypot(g.player.x - p.x, g.player.z - p.z);
  }

  function pay(amount, label) {
    var g = G();
    if (!g) return;
    g.money += amount;
    g.rep = (g.rep || 0) + 2;
    msg(label + ": +$" + amount);
    sfx("mission");
  }

  SB.Jobs = {
    // Taxi job: pick a passenger up, then drop them at the destination.
    taxi: { active: false, phase: "", fare: 0, pickup: null, dest: null },
    // Side job: carry a package to a drop point.
    packageJob: { active: false, dest: null, reward: 0 },

    startTaxi: function () {
      var g = G();
      if (!g) return false;
      var t = SB.Jobs.taxi;
      if (t.active) { msg("Taxi job already running."); return false; }
      var px = g.player.x + (Math.random() * 60 - 30);
      var pz = g.player.z + (Math.random() * 60 - 30);
      t.pickup = spot(px, pz);
      t.dest = rndSpot();
      var d = Math.hypot(t.dest.x - t.pickup.x, t.dest.z - t.pickup.z);
      t.fare = 50 + Math.round(d * 0.4);
      t.phase = "pickup";
      t.active = true;
      msg("Taxi job: pick up the passenger at the marker.");
      return true;
    },

    startPackage: function () {
      var g = G();
      if (!g) return false;
      var j = SB.Jobs.packageJob;
      if (j.active) { msg("Package job already running."); return false; }
      j.dest = rndSpot();
      j.reward = 60 + Math.floor(Math.random() * 60);
      j.active = true;
      msg("Package job: deliver the package to the marker ($" + j.reward + ").");
      return true;
    },

    cancelTaxi: function () {
      var t = SB.Jobs.taxi;
      t.active = false; t.phase = ""; t.pickup = null; t.dest = null; t.fare = 0;
    },

    cancelPackage: function () {
      var j = SB.Jobs.packageJob;
      j.active = false; j.dest = null; j.reward = 0;
    },

    update: function (dt) {
      var g = G();
      if (!g) return;
      var t = SB.Jobs.taxi;
      if (t.active) {
        if (t.phase === "pickup" && t.pickup && distTo(t.pickup) < 5) {
          t.phase = "dropoff";
          msg("Passenger aboard. Drive to the destination.");
          sfx("pickup");
        } else if (t.phase === "dropoff" && t.dest && distTo(t.dest) < 5) {
          var fare = t.fare;
          SB.Jobs.cancelTaxi();
          pay(fare, "Taxi fare paid");
        }
      }
      var j = SB.Jobs.packageJob;
      if (j.active && j.dest && distTo(j.dest) < 5) {
        var rw = j.reward;
        SB.Jobs.cancelPackage();
        pay(rw, "Package delivered");
      }
    }
  };
})();

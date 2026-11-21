// Sunset Bay v8 — jobs.js
// Side jobs: taksi (antar penumpang) + antar paket.
// Menempel ke namespace global window.SB. State di SB.G.
(function () {
  'use strict';

  var ARRIVE_DIST = 6; // jarak dianggap sampai di tujuan

  function G() { return window.SB.G; }

  function showMessage(t) {
    if (window.SB.HUD && window.SB.HUD.showMessage) window.SB.HUD.showMessage(t);
  }

  function distTo(x, z) {
    var p = window.SB.Player ? window.SB.Player.pos() : { x: 0, z: 0 };
    var dx = x - p.x, dz = z - p.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // Titik tujuan acak yang bebas tabrakan (pakai City bila ada).
  function randomDest() {
    var city = window.SB.City;
    var x = (Math.random() * 2 - 1) * 140;
    var z = (Math.random() * 2 - 1) * 140;
    if (city && city.findClearSpot) {
      var spot = city.findClearSpot(x, z, 4);
      if (spot) { x = spot.x; z = spot.z; }
    }
    return { x: Math.round(x), z: Math.round(z) };
  }

  function fareFor(a, b) {
    var d = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    return Math.max(20, Math.round(d * 0.6));
  }

  window.SB.Jobs = {
    // Job taksi aktif: { active, phase: 'pickup'|'dropoff', fare, dest, pickup }
    taxi: { active: false, phase: 'pickup', fare: 0, dest: null, pickup: null },

    // Side job antar paket: { active, dest, reward }
    package: { active: false, dest: null, reward: 0 },

    startTaxi: function () {
      var g = G();
      if (!g) return false;
      if (this.taxi.active) return false;
      var pickup = randomDest();
      // Titik jemput tidak boleh terlalu dekat dengan pemain.
      var tries = 0;
      while (distTo(pickup.x, pickup.z) < 20 && tries < 8) {
        pickup = randomDest();
        tries++;
      }
      this.taxi.active = true;
      this.taxi.phase = 'pickup';
      this.taxi.pickup = pickup;
      this.taxi.dest = pickup;
      this.taxi.fare = 0;
      showMessage('Taxi job: jemput penumpang di titik kuning!');
      return true;
    },

    startPackage: function () {
      var g = G();
      if (!g) return false;
      if (this.package.active) return false;
      var dest = randomDest();
      var p = window.SB.Player ? window.SB.Player.pos() : { x: 0, z: 0 };
      this.package.active = true;
      this.package.dest = dest;
      this.package.reward = fareFor(p, dest) + 15;
      showMessage('Side job: antar paket ke titik hijau! Bayaran $' + this.package.reward);
      return true;
    },

    cancelTaxi: function () {
      this.taxi.active = false;
      this.taxi.phase = 'pickup';
      this.taxi.dest = null;
      this.taxi.pickup = null;
      this.taxi.fare = 0;
    },

    cancelPackage: function () {
      this.package.active = false;
      this.package.dest = null;
      this.package.reward = 0;
    },

    update: function (dt) {
      var g = G();
      if (!g) return;

      // --- Taksi ---
      if (this.taxi.active && this.taxi.dest) {
        if (distTo(this.taxi.dest.x, this.taxi.dest.z) < ARRIVE_DIST) {
          if (this.taxi.phase === 'pickup') {
            // Penumpang naik: tentukan tujuan antar + fare.
            var drop = randomDest();
            var tries = 0;
            while (distTo(drop.x, drop.z) < 30 && tries < 8) {
              drop = randomDest();
              tries++;
            }
            this.taxi.phase = 'dropoff';
            this.taxi.dest = drop;
            this.taxi.fare = fareFor(this.taxi.pickup, drop);
            showMessage('Penumpang naik! Antar ke tujuan — fare $' + this.taxi.fare);
          } else {
            // Sampai tujuan: bayar fare (+ tip bila cepat / tanpa tabrakan).
            var pay = this.taxi.fare;
            g.money = (g.money || 0) + pay;
            g.rep = (g.rep || 0) + 5;
            showMessage('Taxi selesai! +$' + pay + ' (+5 REP)');
            if (window.SB.Audio) window.SB.Audio.sfx('pickup');
            this.taxi.active = false;
            this.taxi.phase = 'pickup';
            this.taxi.dest = null;
            this.taxi.pickup = null;
            this.taxi.fare = 0;
          }
        }
      }

      // --- Antar paket ---
      if (this.package.active && this.package.dest) {
        if (distTo(this.package.dest.x, this.package.dest.z) < ARRIVE_DIST) {
          var reward = this.package.reward;
          g.money = (g.money || 0) + reward;
          g.rep = (g.rep || 0) + 5;
          showMessage('Paket terkirim! +$' + reward + ' (+5 REP)');
          if (window.SB.Audio) window.SB.Audio.sfx('pickup');
          this.package.active = false;
          this.package.dest = null;
          this.package.reward = 0;
        }
      }
    }
  };
})();

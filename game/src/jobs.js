// Sunset Bay — jobs.js (v9, ditulis fresh dari SPEC-v8)
// Pekerjaan sampingan: taksi (jemput + antar penumpang), antar paket,
// pickup uang di jalan, dan toko garage (beli ammo Pistol $50/+24).
// Menempel ke namespace global window.SB. State permainan di SB.G;
// state job aktif disimpan di objek SB.Jobs sendiri.
(function () {
  'use strict';

  var ARRIVE_DIST = 6;   // jarak (satuan dunia) yang dihitung "sampai tujuan"
  var PICKUP_DIST = 4;   // jarak ambil pickup uang
  var MAX_CASH = 5;      // jumlah pickup uang yang beredar di kota
  var CASH_RESPAWN = 20; // detik sampai pickup baru muncul gantikan yang diambil

  function G() { return window.SB.G; }

  function showMessage(t) {
    if (window.SB.HUD && window.SB.HUD.showMessage) window.SB.HUD.showMessage(t);
  }

  function playSfx(name) {
    if (window.SB.Audio) window.SB.Audio.sfx(name);
  }

  function playerPos() {
    return window.SB.Player ? window.SB.Player.pos() : { x: 0, z: 0 };
  }

  function distTo(x, z) {
    var p = playerPos();
    var dx = x - p.x, dz = z - p.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  // Titik acak yang bebas tabrakan (pakai City bila tersedia).
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

  // Ongkos berdasarkan jarak tempuh (minimal $20).
  function fareFor(a, b) {
    var d = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
    return Math.max(20, Math.round(d * 0.6));
  }

  // Harga & isi ulang ammo Pistol di garage (SPEC v8, tidak berubah).
  var AMMO_PRICE = 50;
  var AMMO_AMOUNT = 24;

  var Jobs = {
    // Job taksi aktif: { active, phase: 'pickup'|'dropoff', fare, dest, pickup }
    taxi: { active: false, phase: 'pickup', fare: 0, dest: null, pickup: null },

    // Job antar paket: { active, dest, reward }
    package: { active: false, dest: null, reward: 0 },

    // Pickup uang di jalan: [{ x, z, amount }]. Diambil dengan mendekat.
    pickups: [],
    _cashTimer: 0,
    _spawned: false,
    _ammoLinked: false,

    // --- Taksi ---
    startTaxi: function () {
      if (!G()) return false;
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

    cancelTaxi: function () {
      this.taxi.active = false;
      this.taxi.phase = 'pickup';
      this.taxi.dest = null;
      this.taxi.pickup = null;
      this.taxi.fare = 0;
    },

    // --- Antar paket ---
    startPackage: function () {
      if (!G()) return false;
      if (this.package.active) return false;
      var dest = randomDest();
      var p = playerPos();
      this.package.active = true;
      this.package.dest = dest;
      this.package.reward = fareFor(p, dest) + 15;
      showMessage('Side job: antar paket ke titik hijau! Bayaran $' + this.package.reward);
      return true;
    },

    cancelPackage: function () {
      this.package.active = false;
      this.package.dest = null;
      this.package.reward = 0;
    },

    // --- Pickup uang ---
    // Sebar pickup uang baru sampai kuota MAX_CASH terpenuhi.
    spawnCash: function () {
      var made = 0;
      while (this.pickups.length < MAX_CASH) {
        var spot = randomDest();
        var tries = 0;
        while (distTo(spot.x, spot.z) < 15 && tries < 8) {
          spot = randomDest();
          tries++;
        }
        this.pickups.push({
          x: spot.x,
          z: spot.z,
          amount: 15 + Math.floor(Math.random() * 46) // $15..$60
        });
        made++;
      }
      return made;
    },

    // --- Garage / shop: beli ammo Pistol ---
    // $50 untuk +24 ammo. Hanya berlaku untuk Pistol (SPEC v8).
    // Dipanggil main.js lewat SB.Game.buyAmmo; fungsi ini juga dipasang ke
    // SB.Game bila game.js belum menyediakannya (lazy-link di update()).
    buyAmmo: function () {
      var g = G();
      if (!g) return false;
      if ((g.weapon || 'pistol') !== 'pistol') {
        showMessage('Isi ulang ammo hanya untuk Pistol!');
        return false;
      }
      if ((g.money || 0) < AMMO_PRICE) {
        showMessage('Beli ammo butuh $' + AMMO_PRICE + '!');
        return false;
      }
      if (!g.ammo) g.ammo = { pistol: 0 };
      if (typeof g.ammo.pistol !== 'number') g.ammo.pistol = 0;
      g.money -= AMMO_PRICE;
      g.ammo.pistol += AMMO_AMOUNT;
      showMessage('Ammo Pistol +24! -$' + AMMO_PRICE + ' (total ' + g.ammo.pistol + ')');
      playSfx('pickup');
      return true;
    },

    update: function (dt) {
      var g = G();
      if (!g) return;

      // Pasang buyAmmo ke SB.Game sekali saja, bila game.js tidak punya.
      // jobs.js dimuat SEBELUM game.js, jadi tidak bisa dipasang saat load.
      if (!this._ammoLinked) {
        this._ammoLinked = true;
        if (window.SB.Game && !window.SB.Game.buyAmmo) {
          window.SB.Game.buyAmmo = Jobs.buyAmmo;
        }
      }

      // Sebar pickup uang saat pertama kali jalan.
      if (!this._spawned) {
        this._spawned = true;
        this.spawnCash();
      }

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
            // Sampai tujuan: bayar fare (+5 REP).
            var pay = this.taxi.fare;
            g.money = (g.money || 0) + pay;
            g.rep = (g.rep || 0) + 5;
            showMessage('Taxi selesai! +$' + pay + ' (+5 REP)');
            playSfx('pickup');
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
          playSfx('pickup');
          this.package.active = false;
          this.package.dest = null;
          this.package.reward = 0;
        }
      }

      // --- Pickup uang: ambil bila pemain cukup dekat ---
      for (var i = this.pickups.length - 1; i >= 0; i--) {
        var c = this.pickups[i];
        if (distTo(c.x, c.z) < PICKUP_DIST) {
          g.money = (g.money || 0) + c.amount;
          showMessage('Uang ditemukan! +$' + c.amount);
          playSfx('pickup');
          this.pickups.splice(i, 1);
          this._cashTimer = CASH_RESPAWN;
        }
      }
      // Isi ulang pickup yang sudah diambil, satu per satu.
      if (this.pickups.length < MAX_CASH) {
        this._cashTimer -= dt || 0.016;
        if (this._cashTimer <= 0) {
          this.spawnCash();
          this._cashTimer = CASH_RESPAWN;
        }
      }
    }
  };

  window.SB.Jobs = Jobs;
})();

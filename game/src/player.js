// Sunset Bay — SB.Player
// Pejalan kaki: jalan WASD + mouse, lari Shift, lompat Space.
// Masuk/keluar mobil, tabrakan dengan bangunan via SB.City.collide.
// Komunikasi antar modul HANYA lewat namespace SB (design spec §4).

window.SB = window.SB || {};

(function () {
  "use strict";

  var WALK_SPEED = 4.2; // meter/detik
  var RUN_SPEED = 7.5;
  var JUMP_SPEED = 6.5;
  var GRAVITY = 18;
  var ACCEL = 40;
  var FRICTION = 26;
  var RADIUS = 0.6; // radius tabrakan pemain
  var MAX_HEALTH = 100;
  var MAX_STAMINA = 100;
  var STAMINA_DRAIN = 14; // per detik saat lari
  var STAMINA_REGEN = 10; // per detik saat tidak lari
  var STAMINA_MIN_RUN = 5; // butuh stamina segini untuk mulai lari

  function config() {
    return (window.SB && window.SB.Config) || {};
  }

  function physics() {
    var c = config();
    if (c.PHYSICS) return c.PHYSICS;
    return {};
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // Uji tabrakan di posisi (x, z). SB.City.collide bisa mengembalikan boolean
  // atau objek penetrasi {x, z} / {pushX, pushZ}; semua bentuk ditangani.
  function collideAt(x, z) {
    var City = window.SB && window.SB.City;
    if (!City || typeof City.collide !== "function") return null;
    try {
      var r = City.collide({ x: x, y: 0, z: z }, RADIUS);
      if (r === true) return { blocked: true };
      if (r && typeof r === "object") {
        if (r.blocked) return r;
        if (typeof r.x === "number" || typeof r.z === "number") return r;
        if (typeof r.pushX === "number" || typeof r.pushZ === "number") return r;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Coba pindah ke (nx, nz); bila bertabrakan, coba geser per-sumbu.
  // Mengembalikan posisi akhir {x, z, hit:boolean}.
  function moveWithCollision(px, pz, nx, nz) {
    var hit = collideAt(nx, nz);
    if (!hit) return { x: nx, z: nz, hit: false };
    // Penetrasi eksplisit dari SB.City: dorong keluar.
    if (typeof hit.x === "number" && typeof hit.z === "number" &&
        (hit.x !== nx || hit.z !== nz)) {
      return { x: hit.x, z: hit.z, hit: true };
    }
    if (typeof hit.pushX === "number" || typeof hit.pushZ === "number") {
      return { x: nx + (hit.pushX || 0), z: nz + (hit.pushZ || 0), hit: true };
    }
    // Coba sumbu X saja, lalu sumbu Z saja (sliding di dinding).
    if (!collideAt(nx, pz)) return { x: nx, z: pz, hit: true };
    if (!collideAt(px, nz)) return { x: px, z: nz, hit: true };
    return { x: px, z: pz, hit: true };
  }

  function keyDown(input, key) {
    if (!input) return false;
    if (input.keys) {
      if (typeof input.keys.has === "function") return input.keys.has(key);
      if (Array.isArray(input.keys)) return input.keys.indexOf(key) !== -1;
    }
    if (input[key]) return true;
    return false;
  }

  var Player = {
    pos: { x: 0, y: 0, z: 20 },
    vel: { x: 0, y: 0, z: 0 },
    rotY: 0,
    onFoot: true,
    health: MAX_HEALTH,
    stamina: MAX_STAMINA,
    vehicleId: null,
    vehicle: null,
    grounded: true,
    moving: false,
    running: false,

    // Reset ke titik spawn Marina Bay.
    reset: function () {
      this.pos.x = 0; this.pos.y = 0; this.pos.z = 20;
      this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
      this.rotY = 0;
      this.onFoot = true;
      this.health = MAX_HEALTH;
      this.stamina = MAX_STAMINA;
      this.vehicleId = null;
      this.vehicle = null;
      this.grounded = true;
      return this;
    },

    update: function (dt, input) {
      if (!dt || dt <= 0) dt = 0.016;
      if (dt > 0.25) dt = 0.25;

      // Di dalam mobil: posisi dikendalikan SB.Vehicles / SB.Game.
      if (!this.onFoot) {
        this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
        this.moving = false;
        this.running = false;
        return;
      }

      var phys = physics();
      var walkSpeed = phys.WALK_SPEED || WALK_SPEED;
      var runSpeed = phys.RUN_SPEED || RUN_SPEED;
      var gravity = phys.GRAVITY || GRAVITY;

      // Arah hadap dari mouse / kamera: input.yaw (radian) bila ada.
      if (input && typeof input.yaw === "number") {
        this.rotY = input.yaw;
      }
      // Putar manual dengan panah kiri/kanan bila tidak ada mouse.
      if (keyDown(input, "ArrowLeft")) this.rotY += 2.4 * dt;
      if (keyDown(input, "ArrowRight")) this.rotY -= 2.4 * dt;

      var fwdX = Math.sin(this.rotY);
      var fwdZ = Math.cos(this.rotY);
      var rightX = Math.cos(this.rotY);
      var rightZ = -Math.sin(this.rotY);

      var mx = 0;
      var mz = 0;
      if (keyDown(input, "KeyW") || keyDown(input, "ArrowUp")) { mx += fwdX; mz += fwdZ; }
      if (keyDown(input, "KeyS") || keyDown(input, "ArrowDown")) { mx -= fwdX; mz -= fwdZ; }
      if (keyDown(input, "KeyA")) { mx -= rightX; mz -= rightZ; }
      if (keyDown(input, "KeyD")) { mx += rightX; mz += rightZ; }

      var len = Math.sqrt(mx * mx + mz * mz);
      this.moving = len > 0;
      if (len > 0) { mx /= len; mz /= len; }

      // Lari (Shift) menguras stamina; jalan kaki memulihkan.
      var wantRun = keyDown(input, "ShiftLeft") || keyDown(input, "ShiftRight");
      this.running = wantRun && this.moving && this.stamina > STAMINA_MIN_RUN;
      if (this.running) {
        this.stamina = clamp(this.stamina - STAMINA_DRAIN * dt, 0, MAX_STAMINA);
        if (this.stamina <= 0) this.running = false;
      } else {
        this.stamina = clamp(this.stamina + STAMINA_REGEN * dt, 0, MAX_STAMINA);
      }

      var speed = this.running ? runSpeed : walkSpeed;
      var targetVX = mx * speed;
      var targetVZ = mz * speed;
      var accel = this.grounded ? ACCEL : ACCEL * 0.4;
      this.vel.x += (targetVX - this.vel.x) * Math.min(1, accel * dt / Math.max(1, speed));
      this.vel.z += (targetVZ - this.vel.z) * Math.min(1, accel * dt / Math.max(1, speed));
      // Gesekan saat tidak ada input.
      if (!this.moving) {
        var f = Math.max(0, 1 - FRICTION * dt / Math.max(1, speed));
        this.vel.x *= f;
        this.vel.z *= f;
        if (Math.abs(this.vel.x) < 0.05) this.vel.x = 0;
        if (Math.abs(this.vel.z) < 0.05) this.vel.z = 0;
      }

      // Lompat (Space) hanya bila jalan kaki dan menyentuh tanah.
      if (this.grounded && (keyDown(input, "Space") || (input && input.jump))) {
        this.vel.y = JUMP_SPEED;
        this.grounded = false;
        if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
          try { window.SB.Audio.sfx("pickup"); } catch (e) { /* abaikan */ }
        }
      }

      // Gravitasi + tanah (y = 0).
      this.vel.y -= gravity * dt;
      var nextY = this.pos.y + this.vel.y * dt;
      if (nextY <= 0) {
        nextY = 0;
        this.vel.y = 0;
        this.grounded = true;
      }

      // Gerak horizontal + tabrakan bangunan.
      var nx = this.pos.x + this.vel.x * dt;
      var nz = this.pos.z + this.vel.z * dt;
      var moved = moveWithCollision(this.pos.x, this.pos.z, nx, nz);
      if (moved.hit) {
        // Bunyi benturan pelan bila menabrak sambil berlari.
        if (this.running && window.SB && window.SB.Audio &&
            typeof window.SB.Audio.sfx === "function") {
          try { window.SB.Audio.sfx("crash"); } catch (e) { /* abaikan */ }
        }
        // Matikan komponen kecepatan ke arah dinding.
        if (moved.x === this.pos.x) this.vel.x = 0;
        if (moved.z === this.pos.z) this.vel.z = 0;
      }
      this.pos.x = moved.x;
      this.pos.z = moved.z;
      this.pos.y = nextY;

      // Batas dunia 1200x1200 (pusat 0,0).
      var bound = 590;
      this.pos.x = clamp(this.pos.x, -bound, bound);
      this.pos.z = clamp(this.pos.z, -bound, bound);

      // Sinkronkan kembali ke SB.Game.state bila ada.
      if (window.SB && window.SB.Game && window.SB.Game.state) {
        var sp = window.SB.Game.state.player;
        sp.pos.x = this.pos.x; sp.pos.y = this.pos.y; sp.pos.z = this.pos.z;
        sp.vel.x = this.vel.x; sp.vel.y = this.vel.y; sp.vel.z = this.vel.z;
        sp.rotY = this.rotY;
        sp.health = this.health;
        sp.stamina = this.stamina;
        sp.onFoot = this.onFoot;
        sp.vehicleId = this.vehicleId;
      }
    },

    // Masuk ke mobil: pemain menempel pada mobil, kontrol beralih ke SB.Vehicles.
    enterVehicle: function (v) {
      if (!v) return false;
      this.onFoot = false;
      this.vehicleId = v.id != null ? v.id : null;
      this.vehicle = v;
      this.pos.x = v.pos.x;
      this.pos.y = v.pos.y;
      this.pos.z = v.pos.z;
      this.rotY = v.rotY || 0;
      this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
      if (window.SB && window.SB.Game && window.SB.Game.state) {
        var sp = window.SB.Game.state.player;
        sp.onFoot = false;
        sp.vehicleId = this.vehicleId;
        sp.pos.x = this.pos.x; sp.pos.y = this.pos.y; sp.pos.z = this.pos.z;
        sp.rotY = this.rotY;
      }
      if (window.SB && window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("engine"); } catch (e) { /* abaikan */ }
      }
      return true;
    },

    // Keluar mobil: muncul di sisi kiri mobil, jalan kaki lagi.
    exitVehicle: function () {
      if (this.onFoot) return false;
      var car = null;
      if (window.SB && window.SB.Vehicles && window.SB.Vehicles.CARS) {
        var cars = window.SB.Vehicles.CARS;
        for (var i = 0; i < cars.length; i++) {
          if (cars[i].id === this.vehicleId) { car = cars[i]; break; }
        }
      }
      var sideX = -Math.cos(this.rotY) * 2.2;
      var sideZ = Math.sin(this.rotY) * 2.2;
      var nx = this.pos.x + sideX;
      var nz = this.pos.z + sideZ;
      // Jangan keluar di dalam bangunan.
      if (!collideAt(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      this.pos.y = 0;
      this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
      this.onFoot = true;
      this.vehicleId = null;
      this.vehicle = null;
      if (car) car.driver = null;
      if (window.SB && window.SB.Game && window.SB.Game.state) {
        var sp = window.SB.Game.state.player;
        sp.onFoot = true;
        sp.vehicleId = null;
        sp.pos.x = this.pos.x; sp.pos.y = this.pos.y; sp.pos.z = this.pos.z;
      }
      return true;
    },

    damage: function (n) {
      this.health = clamp(this.health - (n || 0), 0, MAX_HEALTH);
      if (window.SB && window.SB.Game && typeof window.SB.Game.damagePlayer === "function") {
        // Game.damagePlayer sudah sinkron; hindari loop ganda dengan menulis langsung.
        window.SB.Game.state.player.health = this.health;
      }
      return this.health;
    },

    heal: function (n) {
      this.health = clamp(this.health + (n || 0), 0, MAX_HEALTH);
      if (window.SB && window.SB.Game && window.SB.Game.state) {
        window.SB.Game.state.player.health = this.health;
      }
      return this.health;
    },

    // Jarak ke sebuah titik (dipakai NPC/polisi bila perlu).
    distanceTo: function (x, z) {
      var dx = this.pos.x - x;
      var dz = this.pos.z - z;
      return Math.sqrt(dx * dx + dz * dz);
    }
  };

  window.SB.Player = Player;
})();

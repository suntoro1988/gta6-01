// player.js — Pemain "Sunset Bay" v11
// Jalan kaki (WASD + mouse), lari (Shift), masuk/keluar mobil (E — mencuri),
// berenang di pantai (pakaian basah setelah berenang), tembak (klik),
// ganti pakaian di toko (menghilangkan jejak "baju dikenali" dari wanted).
// Health + stamina. Respons NPC terhadap pemain berdasarkan jarak + senjata.
// Modul logika murni: tidak bergantung pada renderer; game loop memanggil
// update(dt, input, world) tiap frame.

(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  // ---------- pakaian ----------
  const OUTFITS = [
    { id: 'kaos-biru', name: 'Kaos Biru + Jeans', shirt: [0.2, 0.45, 0.85], pants: [0.15, 0.2, 0.35], price: 0 },
    { id: 'kemeja-krem', name: 'Kemeja Krem + Celana Cokelat', shirt: [0.9, 0.85, 0.7], pants: [0.45, 0.32, 0.2], price: 60 },
    { id: 'hoodie-hijau', name: 'Hoodie Hijau + Jogger', shirt: [0.2, 0.55, 0.3], pants: [0.25, 0.25, 0.25], price: 80 },
    { id: 'jaket-kulit', name: 'Jaket Kulit + Jeans Hitam', shirt: [0.15, 0.12, 0.12], pants: [0.1, 0.1, 0.14], price: 150 },
    { id: 'baju-pantai', name: 'Baju Pantai + Celana Pendek', shirt: [0.95, 0.6, 0.25], pants: [0.9, 0.8, 0.6], price: 45 },
  ];

  // ---------- pemain ----------
  class Player {
    constructor(spawn) {
      const s = spawn || { x: 0, z: 20 };
      this.x = s.x; this.z = s.z; this.y = 0;
      this.yaw = 0;            // arah hadap (radian, 0 = -Z)
      this.pitch = 0;
      this.vx = 0; this.vz = 0;
      this.health = 100;
      this.stamina = 100;
      this.money = 250;
      this.wanted = 0;         // level 0-5
      this.outfitRecognized = false; // true bila saksi melihat baju saat kejahatan
      this.outfit = OUTFITS[0];
      this.wet = false;        // pakaian basah setelah berenang
      this.wetTimer = 0;
      this.swimming = false;
      this.inVehicle = null;   // referensi kendaraan (dari vehicles.js) atau null
      this.inBoat = null;      // referensi perahu (dari water.js) atau null
      this.inInterior = null;  // id interior yang sedang dimasuki
      this.weapon = 'none';    // 'none' | 'pistol'
      this.ammo = 0;
      this.shootCooldown = 0;
      this.stealCooldown = 0;
      this.footstepTimer = 0;
      this.isRunning = false;
      this.alive = true;
      this.lastDamageAt = -999;
    }

    // input: {forward,back,left,right,run,mouseDX,mouseDY,shoot,interact}
    // world: {city, vehicles, water, npcs, time, onEvent}
    update(dt, input, world) {
      if (!this.alive) return;
      dt = Math.min(dt, 0.05);
      this.shootCooldown = Math.max(0, this.shootCooldown - dt);
      this.stealCooldown = Math.max(0, this.stealCooldown - dt);

      // Mouse look.
      if (input) {
        this.yaw -= (input.mouseDX || 0) * 0.0028;
        this.pitch = clamp(this.pitch - (input.mouseDY || 0) * 0.0028, -1.2, 1.2);
      }

      // Pakaian basah mengering perlahan (60 detik).
      if (this.wet) {
        this.wetTimer -= dt;
        if (this.wetTimer <= 0) { this.wet = false; this.wetTimer = 0; }
      }

      // Di dalam mobil / perahu: kendali diserahkan ke vehicles/water.
      if (this.inVehicle || this.inBoat) {
        if (input && input.interact) this.exitCurrentRide(world);
        return;
      }

      // --- gerak jalan kaki ---
      const inWater = world && world.water ? world.water.isInWater(this.x, this.z) : false;
      this.swimming = inWater && this.y <= 0.2;
      const wantRun = !!(input && input.run) && this.stamina > 1 && !this.swimming;
      this.isRunning = wantRun;
      const speed = this.swimming ? 2.2 : wantRun ? 7.5 : 4.2;

      let mx = 0, mz = 0;
      if (input) {
        if (input.forward) mz -= 1;
        if (input.back) mz += 1;
        if (input.left) mx -= 1;
        if (input.right) mx += 1;
      }
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = mx * cos - mz * sin;
      const wz = mx * sin + mz * cos;
      this.vx = wx * speed;
      this.vz = wz * speed;
      this.x += this.vx * dt;
      this.z += this.vz * dt;

      // Stamina: lari menguras, jalan memulihkan.
      if (wantRun && (mx !== 0 || mz !== 0)) this.stamina = Math.max(0, this.stamina - 14 * dt);
      else this.stamina = Math.min(100, this.stamina + 9 * dt);

      // Berenang: masuk air pantai -> basah.
      if (this.swimming && !this.wet) {
        this.wet = true; this.wetTimer = 60;
        if (world && world.onEvent) world.onEvent('swim-start', { x: this.x, z: this.z });
      }

      // Tembak (klik).
      if (input && input.shoot) this.shoot(world);

      // Interaksi (E): masuk mobil / perahu / interior terdekat.
      if (input && input.interact) this.tryInteract(world);
    }

    // ---- tembak ----
    shoot(world) {
      if (this.weapon === 'none' || this.ammo <= 0 || this.shootCooldown > 0) return false;
      this.shootCooldown = 0.25;
      this.ammo--;
      if (world && world.onEvent) {
        world.onEvent('shoot', { x: this.x, z: this.z, yaw: this.yaw, weapon: this.weapon });
      }
      // Menembak di depan saksi menaikkan wanted + menandai baju dikenali.
      if (world && world.npcs) {
        for (const npc of world.npcs) {
          if (npc && dist2(this.x, this.z, npc.x, npc.z) < 25 * 25) {
            this.raiseWanted(1);
            this.outfitRecognized = true;
            break;
          }
        }
      }
      return true;
    }

    giveWeapon(kind, ammo) {
      this.weapon = kind;
      this.ammo = ammo;
    }

    // ---- interaksi (E) ----
    tryInteract(world) {
      if (!world) return null;
      // 1) Perahu terdekat (di dermaga/pantai).
      if (world.water && world.water.nearestBoat) {
        const boat = world.water.nearestBoat(this.x, this.z, 4);
        if (boat) { this.boardBoat(boat, world); return 'boat'; }
      }
      // 2) Mobil terdekat -> mencuri (E).
      if (world.vehicles && world.vehicles.nearestCar) {
        const car = world.vehicles.nearestCar(this.x, this.z, 4);
        if (car && this.stealCooldown <= 0) {
          this.stealCar(car, world);
          return 'car';
        }
      }
      // 3) Pintu interior terdekat (toko/kafe).
      if (world.city && world.city.interiorAt) {
        const it = world.city.interiorAt(this.x, this.z, 3);
        if (it) {
          if (it.closedAfterRobbery) {
            if (world.onEvent) world.onEvent('interior-closed', { id: it.id, name: it.name });
            return 'closed';
          }
          this.inInterior = it.id;
          if (world.onEvent) world.onEvent('enter-interior', { id: it.id, name: it.name });
          return 'interior';
        }
      }
      return null;
    }

    stealCar(car, world) {
      this.inVehicle = car;
      this.stealCooldown = 1.0;
      car.driver = this;
      this.raiseWanted(1);
      this.outfitRecognized = true; // saksi melihat baju saat mencuri
      if (world && world.onEvent) world.onEvent('car-stolen', { carId: car.id, x: this.x, z: this.z });
    }

    boardBoat(boat, world) {
      this.inBoat = boat;
      boat.rider = this;
      if (world && world.onEvent) world.onEvent('board-boat', { boatId: boat.id });
    }

    // Keluar dari mobil/perahu. Anti-soft-lock: selalu berhasil, posisi
    // aman dicari di sekitar kendaraan (atau di dermaga/pantai terdekat).
    exitCurrentRide(world) {
      if (this.inVehicle) {
        const car = this.inVehicle;
        car.driver = null;
        this.inVehicle = null;
        this.x = car.x + Math.sin(car.heading + Math.PI / 2) * 2.5;
        this.z = car.z + Math.cos(car.heading + Math.PI / 2) * 2.5;
      }
      if (this.inBoat) {
        const boat = this.inBoat;
        boat.rider = null;
        this.inBoat = null;
        // Keluar di dermaga/pantai terdekat — tidak pernah di tengah laut.
        const spot = world && world.water && world.water.nearestShore
          ? world.water.nearestShore(boat.x, boat.z)
          : { x: boat.x + 3, z: boat.z };
        this.x = spot.x; this.z = spot.z; this.y = 0;
        this.wet = true; this.wetTimer = 60;
      }
      this.stealCooldown = 0.5;
    }

    exitInterior() { this.inInterior = null; }

    // ---- ganti pakaian di toko ----
    // Menghilangkan jejak "baju dikenali": wanted turun 1 level dan saksi
    // tidak lagi mengenali pemain dari bajunya.
    changeOutfit(outfitId, world) {
      const outfit = OUTFITS.find(o => o.id === outfitId);
      if (!outfit) return { ok: false, reason: 'outfit-not-found' };
      if (this.money < outfit.price) return { ok: false, reason: 'not-enough-money' };
      this.money -= outfit.price;
      this.outfit = outfit;
      if (this.outfitRecognized) {
        this.outfitRecognized = false;
        this.wanted = Math.max(0, this.wanted - 1);
      }
      if (world && world.onEvent) world.onEvent('outfit-changed', { outfit: outfit.id, wanted: this.wanted });
      return { ok: true, outfit: outfit.name, wanted: this.wanted };
    }

    // ---- wanted / damage ----
    raiseWanted(levels) {
      this.wanted = clamp(this.wanted + (levels || 1), 0, 5);
    }
    lowerWanted(levels) {
      this.wanted = clamp(this.wanted - (levels || 1), 0, 5);
      if (this.wanted === 0) this.outfitRecognized = false;
    }
    takeDamage(amount, from) {
      if (!this.alive) return;
      this.health = Math.max(0, this.health - amount);
      this.lastDamageAt = Date.now() / 1000;
      if (this.health <= 0) {
        this.alive = false;
        if (this.inVehicle) this.inVehicle.driver = null;
        if (this.inBoat) this.inBoat.rider = null;
        this.inVehicle = null; this.inBoat = null;
      }
    }
    heal(amount) {
      this.health = clamp(this.health + amount, 0, 100);
      if (this.health > 0) this.alive = true;
    }
    respawn(spawn) {
      const s = spawn || { x: 0, z: 20 };
      this.x = s.x; this.z = s.z; this.y = 0;
      this.health = 100; this.stamina = 100; this.alive = true;
      this.wanted = 0; this.outfitRecognized = false;
      this.inVehicle = null; this.inBoat = null; this.inInterior = null;
    }

    // ---- respons NPC terhadap pemain ----
    // Mengembalikan aksi yang sebaiknya dilakukan NPC:
    // 'ignore' | 'flee' | 'confront' | 'warn'
    // Berdasarkan jarak + apakah pemain bersenjata / wanted / basah kuyup.
    static npcReaction(npc, player) {
      if (!npc || !player) return 'ignore';
      const d2 = dist2(npc.x, npc.z, player.x, player.z);
      const armed = player.weapon !== 'none';
      const threatening = armed || player.wanted >= 2;
      if (d2 < 3 * 3) {
        if (threatening) return 'flee';
        if (npc.blocked) return 'warn'; // pemain menghalangi jalan NPC
        return 'ignore';
      }
      if (d2 < 10 * 10) {
        if (threatening) return 'flee';
        if (player.isRunning) return 'ignore';
        return 'ignore';
      }
      if (d2 < 25 * 25 && threatening) return 'flee';
      return 'ignore';
    }

    // NPC memaki / menghindar bila dihalangi: dipanggil saat pemain berdiri
    // di jalur NPC lebih dari 1,5 detik.
    static npcBlockedResponse(npc, player, blockedSeconds) {
      if (blockedSeconds > 1.5) return { action: 'warn', line: 'Hei, minggir dong!' };
      if (blockedSeconds > 0.5) return { action: 'sidestep', line: '' };
      return { action: 'wait', line: '' };
    }

    status() {
      return {
        x: +this.x.toFixed(2), z: +this.z.toFixed(2),
        health: this.health, stamina: Math.round(this.stamina),
        money: this.money, wanted: this.wanted,
        outfit: this.outfit.id, outfitRecognized: this.outfitRecognized,
        wet: this.wet, swimming: this.swimming,
        inVehicle: !!this.inVehicle, inBoat: !!this.inBoat,
        inInterior: this.inInterior, weapon: this.weapon, ammo: this.ammo,
        alive: this.alive,
      };
    }
  }

  const api = { Player, OUTFITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SunsetPlayer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Sunset Bay v14 — SB.Weapons
// 3 slot senjata: pistol, SMG, shotgun. equip(i) memilih slot,
// shoot() melakukan raycast sederhana ke arah kamera / arah hadap pemain:
// target dalam jangkauan dan dalam kerucut arah tembak kehilangan HP.
// Setiap tembakan memanggil SB.FX.muzzle + SB.Audio.sfx('gunshot').
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).

window.SB = window.SB || {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Sudut kerucut tembak (cosinus): target harus berada dalam ~10 derajat
// dari arah tembak agar dianggap kena.
const AIM_COS = 0.985;

// 3 senjata. dmg = damage per peluru, range = jangkauan meter,
// mag = isi magasin, reserve = amunisi cadangan awal, rate = detik antar tembakan.
const WEAPONS = {
  pistol:  { id: "pistol",  name: "Pistol",  dmg: 25, range: 60, mag: 12, reserve: 48,  rate: 0.25, price: 250 },
  smg:     { id: "smg",     name: "SMG",     dmg: 15, range: 45, mag: 30, reserve: 120, rate: 0.09, price: 600 },
  shotgun: { id: "shotgun", name: "Shotgun", dmg: 60, range: 20, mag: 6,  reserve: 24,  rate: 0.8,  price: 800 },
};

// 3 slot senjata. Slot 0 selalu pistol (dimiliki sejak awal);
// slot 1 dan 2 kosong sampai senjatanya dibeli (SB.Economy.buy -> unlock).
const SLOTS = [
  { slot: 0, weapon: "pistol",  owned: true  },
  { slot: 1, weapon: "smg",     owned: false },
  { slot: 2, weapon: "shotgun", owned: false },
];

const Weapons = {
  SLOTS,
  WEAPONS,

  // Slot yang sedang aktif (0..2).
  current: 0,

  // Amunisi per senjata: { weaponId: { mag, reserve } }.
  ammo: {
    pistol:  { mag: WEAPONS.pistol.mag,  reserve: WEAPONS.pistol.reserve },
    smg:     { mag: 0, reserve: 0 },
    shotgun: { mag: 0, reserve: 0 },
  },

  // Waktu (detik, dari jam internal) kapan boleh menembak lagi.
  nextShotAt: 0,

  // Jam internal (diperbarui update(dt)); dipakai cooldown tembak.
  time: 0,

  // Senjata di slot aktif (objek WEAPONS) atau null.
  currentWeapon() {
    const slot = this.SLOTS[this.current];
    if (!slot) return null;
    return this.WEAPONS[slot.weapon] || null;
  },

  // Nama senjata aktif, atau null.
  currentName() {
    const w = this.currentWeapon();
    return w ? w.name : null;
  },

  // Pilih slot senjata (0..2). Hanya bisa bila slot dimiliki.
  // Mengembalikan true bila berhasil.
  equip(i) {
    const idx = Math.floor(i);
    if (idx < 0 || idx >= this.SLOTS.length) return false;
    if (!this.SLOTS[idx].owned) return false;
    this.current = idx;
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("pickup"); } catch (e) { /* audio belum init */ }
    }
    return true;
  },

  // Buka senjata (dipanggil SB.Economy.buy saat pemain membeli senjata).
  // Mengisi magasin + cadangan awal dan langsung equip bila slot kosong.
  unlock(weaponId) {
    const slot = this.SLOTS.find((s) => s.weapon === weaponId);
    const def = this.WEAPONS[weaponId];
    if (!slot || !def) return false;
    slot.owned = true;
    this.ammo[weaponId] = { mag: def.mag, reserve: def.reserve };
    return true;
  },

  // Apakah senjata dimiliki?
  owns(weaponId) {
    const slot = this.SLOTS.find((s) => s.weapon === weaponId);
    return !!slot && slot.owned;
  },

  // Amunisi di magasin senjata aktif (atau senjata tertentu).
  magAmmo(weaponId) {
    const id = weaponId || (this.currentWeapon() && this.currentWeapon().id);
    if (!id || !this.ammo[id]) return 0;
    return this.ammo[id].mag;
  },

  // Amunisi cadangan senjata aktif (atau senjata tertentu).
  reserveAmmo(weaponId) {
    const id = weaponId || (this.currentWeapon() && this.currentWeapon().id);
    if (!id || !this.ammo[id]) return 0;
    return this.ammo[id].reserve;
  },

  // Isi ulang magasin dari cadangan. Mengembalikan true bila ada peluru dipindah.
  reload() {
    const w = this.currentWeapon();
    if (!w) return false;
    const a = this.ammo[w.id];
    if (!a || a.reserve <= 0 || a.mag >= w.mag) return false;
    const need = w.mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take;
    a.reserve -= take;
    return true;
  },

  // Tambah amunisi cadangan (dipakai saat beli Ammo Pack).
  addAmmo(weaponId, n) {
    const def = this.WEAPONS[weaponId];
    if (!def) return false;
    if (!this.ammo[weaponId]) this.ammo[weaponId] = { mag: 0, reserve: 0 };
    this.ammo[weaponId].reserve += Math.max(0, Math.round(n));
    return true;
  },

  // Posisi + arah tembak: dari kamera render bila ada, kalau tidak dari
  // arah hadap pemain. Mengembalikan { pos: {x,y,z}, dir: {x,y,z} }.
  aimFrom() {
    const cam = window.SB.Render && window.SB.Render.camera;
    const player = window.SB.Player;
    let pos = { x: 0, y: 1.5, z: 0 };
    let yaw = 0;
    if (player && player.pos) {
      pos = { x: player.pos.x, y: (player.pos.y || 0) + 1.5, z: player.pos.z };
      yaw = player.rotY || 0;
    }
    if (cam) {
      if (cam.pos) pos = { x: cam.pos.x, y: cam.pos.y, z: cam.pos.z };
      if (typeof cam.yaw === "number") yaw = cam.yaw;
    }
    // Arah hadap: yaw 0 = menghadap -z (konvensi dunia).
    const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    return { pos, dir };
  },

  // Kumpulkan target yang bisa ditembak: pejalan kaki NPC + mobil polisi.
  // Tiap target: { ref, pos: {x,y,z}, hp, onHit }.
  collectTargets() {
    const targets = [];
    if (window.SB.NPC && Array.isArray(window.SB.NPC.PEDESTRIANS)) {
      for (const p of window.SB.NPC.PEDESTRIANS) {
        if (!p || !p.pos) continue;
        if (typeof p.health === "number" && p.health <= 0) continue;
        targets.push({
          ref: p,
          kind: "pedestrian",
          pos: { x: p.pos.x, y: (p.pos.y || 0) + 1.2, z: p.pos.z },
          hp: typeof p.health === "number" ? p.health : 100,
        });
      }
    }
    if (window.SB.Police && Array.isArray(window.SB.Police.COP_CARS)) {
      for (const c of window.SB.Police.COP_CARS) {
        if (!c || !c.pos) continue;
        if (typeof c.health === "number" && c.health <= 0) continue;
        targets.push({
          ref: c,
          kind: "cop-car",
          pos: { x: c.pos.x, y: (c.pos.y || 0) + 1.0, z: c.pos.z },
          hp: typeof c.health === "number" ? c.health : 100,
        });
      }
    }
    return targets;
  },

  // Tembak! Raycast sederhana: cari target terdekat dalam jangkauan senjata
  // dan dalam kerucut arah tembak, kurangi HP-nya sebesar damage.
  // Selalu memanggil SB.FX.muzzle + SB.Audio.sfx('gunshot').
  // Mengembalikan { hit, target, damage, remainingHp } atau null bila
  // tidak bisa menembak (cooldown / magasin kosong / tanpa senjata).
  shoot() {
    const w = this.currentWeapon();
    if (!w) return null;
    if (this.time < this.nextShotAt) return null; // masih cooldown
    const a = this.ammo[w.id];
    if (!a || a.mag <= 0) {
      // Magasin kosong: coba reload otomatis, kalau tidak bisa -> klik kosong.
      this.reload();
      if (!a || a.mag <= 0) return null;
    }
    this.nextShotAt = this.time + w.rate;
    a.mag -= 1;

    const aim = this.aimFrom();
    const muzzlePos = {
      x: aim.pos.x + aim.dir.x * 0.6,
      y: aim.pos.y - 0.1,
      z: aim.pos.z + aim.dir.z * 0.6,
    };

    // Efek tembakan (wajib dipanggil setiap shoot()).
    if (window.SB.FX && typeof window.SB.FX.muzzle === "function") {
      try { window.SB.FX.muzzle(muzzlePos); } catch (e) { /* abaikan */ }
    }
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("gunshot"); } catch (e) { /* audio belum init */ }
    }

    // Bonus damage dari gunman kru (SB.Crew.gunmanBonus).
    let dmg = w.dmg;
    if (window.SB.Crew && typeof window.SB.Crew.gunmanBonus === "function") {
      try { dmg = Math.round(w.dmg * window.SB.Crew.gunmanBonus()); } catch (e) { /* abaikan */ }
    }

    // Raycast sederhana: target terdekat dalam range + dalam kerucut arah.
    let best = null;
    let bestDist = Infinity;
    for (const t of this.collectTargets()) {
      const dx = t.pos.x - aim.pos.x;
      const dy = t.pos.y - aim.pos.y;
      const dz = t.pos.z - aim.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > w.range || dist <= 0.01) continue;
      const dot = (dx * aim.dir.x + dy * aim.dir.y + dz * aim.dir.z) / dist;
      if (dot < AIM_COS) continue; // di luar kerucut arah tembak
      if (dist < bestDist) { bestDist = dist; best = t; }
    }

    if (!best) {
      return { hit: false, target: null, damage: 0, remainingHp: null };
    }

    // Kena: kurangi HP target.
    const newHp = Math.max(0, best.hp - dmg);
    if (typeof best.ref.health === "number") {
      best.ref.health = newHp;
    } else {
      best.ref.health = newHp;
    }
    // NPC yang tertembak bereaksi (lari) bila modul NPC mendukung.
    if (best.kind === "pedestrian" && window.SB.NPC &&
        typeof window.SB.NPC.react === "function") {
      try { window.SB.NPC.react("gunshot"); } catch (e) { /* abaikan */ }
    }
    // Menembak menaikkan wanted sedikit.
    if (window.SB.Game && typeof window.SB.Game.setWanted === "function" &&
        window.SB.Game.state && typeof window.SB.Game.state.wanted === "number") {
      try {
        if (window.SB.Game.state.wanted < 2) window.SB.Game.setWanted(2);
      } catch (e) { /* abaikan */ }
    }
    // Efek darah / benturan di titik target.
    if (window.SB.FX && typeof window.SB.FX.spawnParticles === "function") {
      try { window.SB.FX.spawnParticles(best.pos, [0.8, 0.1, 0.1], 8); } catch (e) { /* abaikan */ }
    }

    this.lastShot = { hit: true, kind: best.kind, damage: dmg, remainingHp: newHp, at: this.time };
    return { hit: true, target: best.kind, damage: dmg, remainingHp: newHp };
  },

  // Hasil tembakan terakhir (null bila belum pernah menembak).
  lastShot: null,

  // Update per frame: majukan jam internal (cooldown tembak).
  update(dt) {
    if (dt && dt > 0) this.time += dt;
  },

  // Ringkasan senjata untuk HUD.
  status() {
    const w = this.currentWeapon();
    const a = w ? this.ammo[w.id] : null;
    return {
      weapon: w ? w.id : null,
      name: w ? w.name : null,
      slot: this.current,
      mag: a ? a.mag : 0,
      reserve: a ? a.reserve : 0,
      slots: this.SLOTS.map((s) => ({ slot: s.slot, weapon: s.weapon, owned: s.owned })),
    };
  },

  // Reset senjata ke awal (new game): hanya pistol, amunisi awal.
  reset() {
    this.current = 0;
    this.nextShotAt = 0;
    this.time = 0;
    this.lastShot = null;
    for (const s of this.SLOTS) s.owned = s.slot === 0;
    this.ammo = {
      pistol:  { mag: WEAPONS.pistol.mag,  reserve: WEAPONS.pistol.reserve },
      smg:     { mag: 0, reserve: 0 },
      shotgun: { mag: 0, reserve: 0 },
    };
  },

  // Muat dari save (dipakai SB.Game.load).
  loadFrom(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.current === "number") this.current = clamp(data.current, 0, 2);
    if (data.slots && Array.isArray(data.slots)) {
      for (const saved of data.slots) {
        const slot = this.SLOTS.find((s) => s.slot === saved.slot);
        if (slot && typeof saved.owned === "boolean") slot.owned = saved.owned;
      }
    }
    if (data.ammo && typeof data.ammo === "object") {
      for (const id of Object.keys(this.WEAPONS)) {
        const savedAmmo = data.ammo[id];
        if (savedAmmo && typeof savedAmmo.mag === "number") {
          this.ammo[id] = {
            mag: Math.max(0, Math.round(savedAmmo.mag)),
            reserve: Math.max(0, Math.round(savedAmmo.reserve || 0)),
          };
        }
      }
    }
  },

  // Ekspor untuk save.
  saveTo() {
    return {
      current: this.current,
      slots: this.SLOTS.map((s) => ({ slot: s.slot, weapon: s.weapon, owned: s.owned })),
      ammo: JSON.parse(JSON.stringify(this.ammo)),
    };
  },
};

window.SB.Weapons = Weapons;

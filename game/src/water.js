// water.js — Laut "Sunset Bay" v11
// Plane air dengan pantulan (specular tinggi), ombak (vertex sin sederhana),
// perahu yang bergerak, dermaga. Water.draw HARUS dipanggil tiap frame.
// Anti-soft-lock: exitBoat selalu bisa — tombol keluar perahu bekerja di
// mana saja di dekat dermaga/pantai (nearestShore selalu mengembalikan
// titik darat yang valid, tidak pernah null).
// Modul logika + data mesh; renderer disuntikkan lewat Water.attachRenderer().

(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------- perahu ----------
  let boatSeq = 0;
  class Boat {
    constructor(opts) {
      const o = opts || {};
      this.id = 'boat-' + (++boatSeq);
      this.x = o.x || -40; this.z = o.z || -190;
      this.heading = o.heading || 0;
      this.speed = o.speed || 0;
      this.baseSpeed = o.baseSpeed || rand(2, 4);
      this.color = o.color || [0.9, 0.85, 0.7];
      this.rider = null;       // Player bila dinaiki
      this.drifting = !!o.drifting; // perahu nelayan hanyut pelan
      this.anchorX = this.x; this.anchorZ = this.z;
      this.bobPhase = rand(0, Math.PI * 2);
      this.y = 0;              // tinggi ombak saat ini
    }

    update(dt, time) {
      // Ombak: naik-turun sinusoidal.
      this.y = Math.sin(time * 1.3 + this.bobPhase) * 0.25;
      if (this.rider) {
        // Perahu dikendarai pemain: gerak lurus pelan, belok lambat.
        this.speed = this.baseSpeed;
        this.x += Math.sin(this.heading) * this.speed * dt;
        this.z += -Math.cos(this.heading) * this.speed * dt;
      } else if (this.drifting) {
        // Hanyut melingkar pelan di sekitar jangkar.
        const t = time * 0.05 + this.bobPhase;
        this.x = this.anchorX + Math.cos(t) * 8;
        this.z = this.anchorZ + Math.sin(t) * 5;
        this.heading = t + Math.PI / 2;
      } else {
        // Perahu patroli: bolak-balik sejajar pantai.
        this.x += Math.sin(this.heading) * this.baseSpeed * dt;
        this.z += -Math.cos(this.heading) * this.speed * 0; // tetap di jalur z
        if (this.x > 120) this.heading = Math.PI;
        if (this.x < -160) this.heading = 0;
      }
    }

    // Kemudi pemain (dipanggil dari game loop saat rider aktif).
    steer(dt, input) {
      if (!input) return;
      if (input.left) this.heading += 0.9 * dt;
      if (input.right) this.heading -= 0.9 * dt;
      if (input.forward) this.baseSpeed = Math.min(7, this.baseSpeed + 2 * dt);
      else if (input.back) this.baseSpeed = Math.max(1, this.baseSpeed - 2 * dt);
    }
  }

  // ---------- air ----------
  class Water {
    constructor(opts) {
      const o = opts || {};
      // Laut: bidang besar di sisi -Z kota (pantai di z ~ -150..-200).
      this.x = o.x || 0;
      this.z = o.z || -260;
      this.width = o.width || 560;
      this.depth = o.depth || 200;
      this.shoreZ = o.shoreZ || -168; // garis pantai (z lebih besar = darat)
      this.level = 0;                  // y permukaan air
      this.specular = 0.9;             // pantulan tinggi
      this.shininess = 64;
      this.time = 0;
      this.waveAmp = 0.35;
      this.waveFreq = 0.08;
      this.waveSpeed = 1.1;
      this.boats = [];
      this.pier = { x: -20, z: -168, len: 60, w: 6 };
      this.renderer = null;
      this.drawCalls = 0;              // penghitung: draw() terpanggil tiap frame
      this._initBoats();
    }

    attachRenderer(renderer) { this.renderer = renderer; }

    _initBoats() {
      // 3 perahu nelayan hanyut + 1 perahu patroli + 1 perahu pemain di dermaga.
      this.boats.push(new Boat({ x: -90, z: -210, drifting: true, color: [0.85, 0.7, 0.5] }));
      this.boats.push(new Boat({ x: -40, z: -230, drifting: true, color: [0.7, 0.75, 0.8] }));
      this.boats.push(new Boat({ x: 30, z: -220, drifting: true, color: [0.9, 0.6, 0.4] }));
      this.boats.push(new Boat({ x: 0, z: -200, heading: 0, baseSpeed: 3, color: [0.95, 0.95, 0.95] }));
      this.boats.push(new Boat({ x: -20, z: -180, heading: 0, baseSpeed: 3, color: [0.6, 0.8, 0.6] })); // di dermaga
    }

    // Tinggi ombak di satu titik (vertex sin sederhana).
    waveHeight(x, z, time) {
      const t = time == null ? this.time : time;
      return Math.sin(x * this.waveFreq + t * this.waveSpeed) * this.waveAmp
        + Math.sin(z * this.waveFreq * 1.3 + t * this.waveSpeed * 0.8) * this.waveAmp * 0.6;
    }

    // Grid vertex air (untuk renderer): posisi + normal pendekatan dari sin.
    waterGrid(segments) {
      const seg = segments || 24;
      const verts = [];
      for (let i = 0; i <= seg; i++) {
        for (let j = 0; j <= seg; j++) {
          const x = this.x - this.width / 2 + (i / seg) * this.width;
          const z = this.z - this.depth / 2 + (j / seg) * this.depth;
          verts.push({ x, y: this.waveHeight(x, z, this.time), z });
        }
      }
      return verts;
    }

    isInWater(x, z) {
      return z < this.shoreZ + 2 && z > this.z - this.depth / 2 - 40
        && Math.abs(x - this.x) < this.width / 2 + 40;
    }

    nearestBoat(x, z, maxDist) {
      let best = null, bestD = (maxDist || 4) * (maxDist || 4);
      for (const b of this.boats) {
        const dx = b.x - x, dz = b.z - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD) { bestD = d2; best = b; }
      }
      return best;
    }

    // Anti-soft-lock: SELALU mengembalikan titik darat yang valid.
    // Prioritas: ujung dermaga -> garis pantai terdekat -> pantai (0, -160).
    nearestShore(x, z) {
      // 1) Dekat dermaga -> ujung dermaga.
      const pier = this.pier;
      if (Math.abs(x - pier.x) < 30 && z < pier.z + 10) {
        return { x: pier.x, z: pier.z + pier.len / 2 + 2 };
      }
      // 2) Garis pantai terdekat: jaga x, z = shoreZ + 2 (darat).
      if (Math.abs(x - this.x) < this.width / 2) {
        return { x: clamp(x, -170, 170), z: this.shoreZ + 2 };
      }
      // 3) Fallback mutlak: pantai tengah — tidak pernah null.
      return { x: 0, z: this.shoreZ + 2 };
    }

    // Keluar perahu: bekerja di mana saja. Mengembalikan posisi darat.
    // Dipanggil Player.exitCurrentRide() dan juga langsung oleh game loop
    // bila tombol keluar ditekan saat menaiki perahu.
    exitBoat(boat, player) {
      if (!boat) return { ok: false, reason: 'no-boat' };
      const spot = this.nearestShore(boat.x, boat.z);
      boat.rider = null;
      if (player) {
        player.inBoat = null;
        player.x = spot.x; player.z = spot.z; player.y = 0;
        player.wet = true; player.wetTimer = 60;
      }
      // Perahu ditambatkan di dekat titik keluar agar tidak hilang.
      boat.anchorX = boat.x; boat.anchorZ = boat.z;
      boat.drifting = true;
      return { ok: true, x: spot.x, z: spot.z };
    }

    update(dt) {
      this.time += dt;
      for (const b of this.boats) b.update(dt, this.time);
    }

    // HARUS dipanggil tiap frame oleh game loop. Merender air + perahu +
    // dermaga lewat renderer yang disuntikkan; bila belum ada renderer,
    // tetap menghitung state (ombak, perahu) agar tidak ada frame kosong.
    draw(frameState) {
      this.drawCalls++;
      this.update((frameState && frameState.dt) || 0.016);
      const state = {
        time: this.time,
        level: this.level,
        specular: this.specular,
        shininess: this.shininess,
        waveAmp: this.waveAmp,
        boats: this.boats.map(b => ({ id: b.id, x: b.x, z: b.z, y: b.y, heading: b.heading, color: b.color, rider: !!b.rider })),
        pier: this.pier,
        grid: this.waterGrid(16),
      };
      if (this.renderer && typeof this.renderer.drawWater === 'function') {
        this.renderer.drawWater(state);
      } else if (this.renderer && typeof this.renderer.drawMesh === 'function') {
        // Fallback: gambar plane air sebagai mesh datar + perahu via meshes.js.
        const M = global.SunsetMeshes;
        if (M) {
          for (const b of this.boats) {
            this.renderer.drawMesh(M.createBoatMesh(b.color), { x: b.x, y: b.y, z: b.z, rotY: b.heading });
          }
        }
      }
      return state;
    }

    // Camar terbang saat pemain mendekat (dipanggil game loop / ambient).
    // Mengembalikan posisi camar; bila pemain dalam 8m, camar lepas landas.
    seagullNear(playerX, playerZ, gull) {
      if (!gull) return null;
      const dx = playerX - gull.x, dz = playerZ - gull.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 8 * 8 && !gull.flying) {
        gull.flying = true;
        gull.vx = dx > 0 ? -3 : 3;
        gull.vz = -4;
      }
      if (gull.flying) {
        gull.x += (gull.vx || 0) * 0.016;
        gull.z += (gull.vz || 0) * 0.016;
        gull.y = (gull.y || 2) + 0.05;
      }
      return gull;
    }

    status() {
      return {
        time: +this.time.toFixed(2), drawCalls: this.drawCalls,
        boats: this.boats.length, specular: this.specular,
        shoreZ: this.shoreZ, waveAmp: this.waveAmp,
      };
    }
  }

  // ---------- event ambient (state machine murah) ----------
  // 8 event: 4 subtle, 3 loud, 1 cuaca. Spawn di luar pandangan pemain,
  // cooldown per distrik. Dikelola di sini agar city/vehicles/player tetap
  // fokus; game loop memanggil AmbientEvents.update(dt, ctx) tiap frame.
  const AMBIENT_DEFS = [
    { id: 'turis-foto', kind: 'subtle', district: 'pantai-senja', cooldown: 45, desc: 'Turis berfoto di pantai' },
    { id: 'penjual-keliling', kind: 'subtle', district: 'pasar-pagi', cooldown: 60, desc: 'Penjual keliling menawarkan dagangan' },
    { id: 'anjing-kejar', kind: 'subtle', district: 'taman-anggrek', cooldown: 50, desc: 'Anjing mengejar pemain yang terlalu dekat' },
    { id: 'camar-terbang', kind: 'subtle', district: 'pantai-senja', cooldown: 20, desc: 'Camar terbang saat pemain mendekat' },
    { id: 'pencuri-kabur', kind: 'loud', district: 'jalan-kenanga', cooldown: 180, desc: 'Pencuri mobil kabur, tas uang berserakan' },
    { id: 'balapan-jalanan', kind: 'loud', district: 'terminal-selatan', cooldown: 240, desc: 'Balapan jalanan menantang pemain' },
    { id: 'polisi-kejar', kind: 'loud', district: 'alun-alun', cooldown: 200, desc: 'Polisi mengejar pelanggar lalu lintas' },
    { id: 'hujan-lokal', kind: 'weather', district: 'bukit-melati', cooldown: 300, desc: 'Hujan lokal di satu zona, bergerak perlahan' },
  ];

  class AmbientEvents {
    constructor() {
      this.events = AMBIENT_DEFS.map(d => Object.assign({}, d, { timer: Math.random() * d.cooldown, active: false, x: 0, z: 0 }));
      this.activeCount = 0;
    }
    // ctx: {player:{x,z}, city, timeOfDay, onEvent}
    update(dt, ctx) {
      for (const ev of this.events) {
        ev.timer -= dt;
        if (!ev.active && ev.timer <= 0) {
          // Spawn di luar pandangan pemain: minimal 30m dari pemain.
          const spot = this._spawnSpot(ev, ctx);
          if (spot) {
            ev.active = true; ev.x = spot.x; ev.z = spot.z;
            ev.duration = ev.kind === 'loud' ? 30 : 20;
            if (ctx && ctx.onEvent) ctx.onEvent('ambient-start', { id: ev.id, kind: ev.kind, x: ev.x, z: ev.z });
          } else {
            ev.timer = 5; // coba lagi sebentar lagi
          }
        } else if (ev.active) {
          ev.duration -= dt;
          if (ev.duration <= 0) {
            ev.active = false;
            ev.timer = ev.cooldown;
            if (ctx && ctx.onEvent) ctx.onEvent('ambient-end', { id: ev.id });
          }
        }
      }
      this.activeCount = this.events.filter(e => e.active).length;
    }
    _spawnSpot(ev, ctx) {
      if (!ctx || !ctx.city) return { x: 0, z: -150 };
      const d = ctx.city.districts.find(x => x.id === ev.district);
      if (!d) return null;
      const px = ctx.player ? ctx.player.x : 0;
      const pz = ctx.player ? ctx.player.z : 0;
      for (let i = 0; i < 8; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = d.r * (0.3 + Math.random() * 0.6);
        const x = d.cx + Math.cos(ang) * rad;
        const z = d.cz + Math.sin(ang) * rad;
        const dx = x - px, dz = z - pz;
        if (dx * dx + dz * dz > 30 * 30) return { x, z };
      }
      return null; // pemain terlalu dekat dengan seluruh distrik; tunda
    }
    activeEvents() { return this.events.filter(e => e.active); }
  }

  const api = { Water, Boat, AmbientEvents, AMBIENT_DEFS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SunsetWater = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

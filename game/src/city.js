// city.js — Kota "Sunset Bay" v11
// Kota pantai kompak: 10 distrik original, 219+ gedung, jalan utama,
// jalan pantai, pelabuhan kecil + dermaga, 2-3 interior yang bisa dimasuki.
// Semua nama original. Raw WebGL, tanpa library eksternal.
// Modul data + logika kota; rendering dilakukan lewat mesh yang diekspor
// (lihat meshes.js) dan renderer yang disuntikkan lewat City.attachRenderer().

(function (global) {
  'use strict';

  // ---------- util ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ---------- distrik ----------
  // 10 distrik original. Tiap distrik: pusat (x,z), radius, karakter,
  // palet warna gedung, densitas pejalan kaki siang/malam.
  const DISTRICTS = [
    { id: 'pantai-senja', name: 'Pantai Senja', cx: 0,    cz: -150, r: 95,  kind: 'beach',
      palette: [[0.98, 0.85, 0.62], [0.95, 0.75, 0.55], [1.0, 0.9, 0.7]],
      walkDay: 0.9, walkNight: 0.35, note: 'Pasir, warung pantai, dermaga kayu.' },
    { id: 'dermaga', name: 'Dermaga Tua', cx: -120, cz: -110, r: 70, kind: 'harbor',
      palette: [[0.55, 0.5, 0.45], [0.45, 0.42, 0.4], [0.6, 0.55, 0.5]],
      walkDay: 0.45, walkNight: 0.15, note: 'Pelabuhan kecil, gudang, perahu nelayan.' },
    { id: 'pasar-pagi', name: 'Pasar Pagi', cx: -60,  cz: -20,  r: 80, kind: 'market',
      palette: [[0.85, 0.6, 0.35], [0.9, 0.7, 0.4], [0.75, 0.5, 0.3]],
      walkDay: 1.0, walkNight: 0.1, note: 'Kios sayur, ikan, kain; ramai pagi hari.' },
    { id: 'bukit-melati', name: 'Bukit Melati', cx: 110, cz: -90,  r: 85, kind: 'residential',
      palette: [[0.9, 0.85, 0.8], [0.85, 0.8, 0.72], [0.95, 0.9, 0.85]],
      walkDay: 0.5, walkNight: 0.3, note: 'Perumahan tenang di bukit, taman kecil.' },
    { id: 'alun-alun', name: 'Alun-Alun Merdeka', cx: 0,   cz: 10,   r: 75, kind: 'civic',
      palette: [[0.8, 0.78, 0.72], [0.7, 0.68, 0.62], [0.88, 0.85, 0.8]],
      walkDay: 0.8, walkNight: 0.4, note: 'Balai kota, taman, air mancur.' },
    { id: 'jalan-kenanga', name: 'Jalan Kenanga', cx: 90,  cz: 40,   r: 80, kind: 'commercial',
      palette: [[0.75, 0.7, 0.85], [0.85, 0.75, 0.6], [0.65, 0.7, 0.8]],
      walkDay: 0.85, walkNight: 0.55, note: 'Toko, kafe, butik; jalan belanja utama.' },
    { id: 'kampung-nelayan', name: 'Kampung Nelayan', cx: -140, cz: 40,  r: 70, kind: 'village',
      palette: [[0.7, 0.6, 0.5], [0.6, 0.55, 0.48], [0.8, 0.7, 0.55]],
      walkDay: 0.6, walkNight: 0.25, note: 'Rumah kayu, jaring, jemuran ikan.' },
    { id: 'neon-senja', name: 'Neon Senja', cx: 60,  cz: 120,  r: 80, kind: 'nightlife',
      palette: [[0.35, 0.3, 0.45], [0.45, 0.35, 0.5], [0.3, 0.3, 0.4]],
      walkDay: 0.3, walkNight: 1.0, note: 'Klub, bar, neon; hidup setelah gelap.' },
    { id: 'taman-anggrek', name: 'Taman Anggrek', cx: -70, cz: 120,  r: 75, kind: 'park',
      palette: [[0.6, 0.7, 0.55], [0.7, 0.75, 0.6], [0.55, 0.65, 0.5]],
      walkDay: 0.7, walkNight: 0.2, note: 'Taman kota, kolam, jalur jogging.' },
    { id: 'terminal-selatan', name: 'Terminal Selatan', cx: 140, cz: 130, r: 70, kind: 'transit',
      palette: [[0.65, 0.62, 0.58], [0.55, 0.55, 0.52], [0.7, 0.68, 0.65]],
      walkDay: 0.75, walkNight: 0.3, note: 'Terminal bus, bengkel, gudang.' },
  ];

  // ---------- poster original ----------
  const POSTERS = [
    'FESTIVAL LAYANG-LAYANG — PANTAI SENJA',
    'KOPI PAGI Rp8rb — WARUNG BU SITI',
    'TURNAMEN FUTSAL ANTAR KAMPUNG',
    'LELANG IKAN SEGAR — DERMAGA TUA',
    'KELAS MENARI — SANGGAR MELATI',
    'DISKON BUKU — TOKO BACA KENANGA',
    'MALAM JAZZ — KLUB LAMPION',
    'DONOR DARAH — BALAI KOTA',
    'PASAR MALAM — ALUN-ALUN MERDEKA',
    'KURSUS BERENANG ANAK — PANTAI SENJA',
  ];

  // ---------- kota ----------
  class City {
    constructor(seed) {
      this.seed = seed || 20261121;
      this.rng = mulberry32(this.seed);
      this.districts = DISTRICTS.map(d => Object.assign({}, d));
      this.buildings = [];   // {x,z,w,d,h,rot,color,district,windows,lit,interiorId}
      this.lamps = [];       // {x,z,district,on}
      this.kiosks = [];      // {x,z,kind,district,queue}
      this.benches = [];     // {x,z,rot}
      this.bins = [];        // {x,z}
      this.posters = [];     // {x,z,rot,text}
      this.palms = [];       // {x,z,h}
      this.roads = [];       // {x1,z1,x2,z2,width,kind}
      this.interiors = [];   // {id,name,buildingId,props:[],door:{x,z}}
      this.pier = null;      // {x,z,len,w}
      this.harbor = null;    // {x,z,r}
      this.beach = null;     // {x,z,w,d}
      this.timeOfDay = 12;   // jam 0-24
      this.isNight = false;
      this.rainZone = null;  // {x,z,r,vx,vz}
      this.renderer = null;
      this._build();
    }

    attachRenderer(renderer) { this.renderer = renderer; }

    // ---- pembangunan kota ----
    _build() {
      const rng = this.rng;
      let id = 0;
      // Gedung per distrik: grid blok dengan jitter, jalan antar blok.
      for (const d of this.districts) {
        const count = d.kind === 'park' ? 6 : d.kind === 'beach' ? 14 : 22;
        const grid = Math.ceil(Math.sqrt(count * 1.6));
        const spacing = (d.r * 2) / grid;
        for (let i = 0; i < grid; i++) {
          for (let j = 0; j < grid; j++) {
            if (this.buildings.filter(b => b.district === d.id).length >= count) break;
            // sisakan koridor jalan di tengah distrik
            const gx = d.cx - d.r + spacing * (i + 0.5);
            const gz = d.cz - d.r + spacing * (j + 0.5);
            if (Math.abs(gx - d.cx) < 7 && d.kind !== 'park') continue; // jalan N-S
            if (Math.abs(gz - d.cz) < 7 && d.kind !== 'park') continue; // jalan E-W
            const w = 6 + rng() * 8;
            const dep = 6 + rng() * 8;
            const h = d.kind === 'residential' || d.kind === 'village'
              ? 4 + rng() * 6
              : d.kind === 'nightlife' || d.kind === 'commercial'
                ? 10 + rng() * 18
                : 6 + rng() * 14;
            const col = d.palette[Math.floor(rng() * d.palette.length)];
            this.buildings.push({
              id: id++, x: gx + (rng() - 0.5) * 3, z: gz + (rng() - 0.5) * 3,
              w, d: dep, h, rot: (rng() - 0.5) * 0.08,
              color: col, district: d.id, kind: d.kind,
              windows: Math.max(2, Math.floor(h / 3)),
              lit: false, interiorId: null,
            });
          }
        }
        this._fillBlock(d, rng);
      }
      // Pastikan total >= 219 gedung: tambah deretan ruko di jalan utama.
      let guard = 0;
      while (this.buildings.length < 222 && guard++ < 300) {
        const d = this.districts[Math.floor(rng() * this.districts.length)];
        const ang = rng() * Math.PI * 2;
        const rad = d.r * (0.55 + rng() * 0.4);
        const x = d.cx + Math.cos(ang) * rad;
        const z = d.cz + Math.sin(ang) * rad;
        if (this._tooClose(x, z, 9)) continue;
        const col = d.palette[Math.floor(rng() * d.palette.length)];
        this.buildings.push({
          id: id++, x, z, w: 5 + rng() * 7, d: 5 + rng() * 7,
          h: 5 + rng() * 12, rot: rng() * Math.PI,
          color: col, district: d.id, kind: d.kind,
          windows: 3 + Math.floor(rng() * 4), lit: false, interiorId: null,
        });
      }

      // Jalan utama (N-S + E-W), jalan pantai, jalan pelabuhan.
      this.roads.push(
        { x1: 0, z1: -200, x2: 0, z2: 200, width: 10, kind: 'main' },
        { x1: -180, z1: 10, x2: 180, z2: 10, width: 10, kind: 'main' },
        { x1: -180, z1: -140, x2: 180, z2: -140, width: 8, kind: 'beach' },
        { x1: -140, z1: -110, x2: -60, z2: -110, width: 8, kind: 'harbor' },
        { x1: -140, z1: 40, x2: 140, z2: 130, width: 7, kind: 'side' },
        { x1: 90, z1: -90, x2: 90, z2: 130, width: 7, kind: 'side' },
      );

      // Pantai, pelabuhan, dermaga.
      this.beach = { x: 0, z: -175, w: 340, d: 55 };
      this.harbor = { x: -120, z: -135, r: 45 };
      this.pier = { x: -20, z: -168, len: 60, w: 6 };

      // Interior yang bisa dimasuki (3): butik, kafe, toko kelontong.
      this._makeInterior('toko-baju', 'Butik Kenanga', 'jalan-kenanga', [
        { kind: 'rack', x: -2, z: -1, label: 'Rak baju' },
        { kind: 'mirror', x: 2, z: -2, label: 'Cermin besar' },
        { kind: 'photo', x: 0, z: -2.5, label: 'Foto pemilik toko 1998' },
        { kind: 'counter', x: 0, z: 2, label: 'Kasir' },
      ]);
      this._makeInterior('kafe-senja', 'Kafe Senja', 'pantai-senja', [
        { kind: 'cup', x: -1, z: 0, label: 'Cangkir kopi hangat' },
        { kind: 'newspaper', x: 1, z: 0, label: 'Koran pagi: Festival Layang-layang' },
        { kind: 'photo', x: -2, z: -2, label: 'Foto pantai tahun 1987' },
        { kind: 'table', x: 0, z: 0, label: 'Meja kayu' },
        { kind: 'plant', x: 2, z: 2, label: 'Tanaman gantung' },
      ]);
      this._makeInterior('toko-kelontong', 'Toko Bu Siti', 'pasar-pagi', [
        { kind: 'shelf', x: -2, z: -1, label: 'Rak sembako' },
        { kind: 'basket', x: 1, z: 1, label: 'Keranjang sayur' },
        { kind: 'photo', x: 0, z: -2.5, label: 'Foto keluarga Bu Siti' },
        { kind: 'counter', x: 0, z: 2, label: 'Kasir' },
      ]);

      // Zona hujan lokal (bergerak perlahan).
      this.rainZone = { x: -40, z: 60, r: 55, vx: 0.6, vz: 0.25 };
    }

    _tooClose(x, z, min) {
      for (const b of this.buildings) {
        const dx = b.x - x, dz = b.z - z;
        if (dx * dx + dz * dz < min * min) return true;
      }
      return false;
    }

    _fillBlock(d, rng) {
      // Trotoar, kios, bangku, tempat sampah, poster, lampu, palma per distrik.
      const n = d.kind === 'market' ? 14 : d.kind === 'beach' ? 10 : 8;
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const rad = d.r * (0.3 + rng() * 0.6);
        const x = d.cx + Math.cos(ang) * rad;
        const z = d.cz + Math.sin(ang) * rad;
        const roll = rng();
        if (roll < 0.25) {
          this.kiosks.push({ x, z, kind: d.kind === 'market' ? 'sayur' : d.kind === 'beach' ? 'es-kelapa' : 'kopi', district: d.id, queue: 0 });
        } else if (roll < 0.5) {
          this.benches.push({ x, z, rot: rng() * Math.PI });
        } else if (roll < 0.65) {
          this.bins.push({ x, z });
        } else if (roll < 0.85) {
          this.posters.push({ x, z, rot: rng() * Math.PI * 2, text: POSTERS[Math.floor(rng() * POSTERS.length)] });
        } else {
          this.palms.push({ x, z, h: 4 + rng() * 3 });
        }
      }
      // Lampu jalan di sekeliling distrik.
      const lampCount = 10;
      for (let i = 0; i < lampCount; i++) {
        const ang = (i / lampCount) * Math.PI * 2;
        this.lamps.push({ x: d.cx + Math.cos(ang) * d.r * 0.8, z: d.cz + Math.sin(ang) * d.r * 0.8, district: d.id, on: false });
      }
      // Palma ekstra di pantai.
      if (d.kind === 'beach') {
        for (let i = 0; i < 18; i++) {
          this.palms.push({ x: d.cx - d.r + rng() * d.r * 2, z: d.cz - 20 + rng() * 30, h: 5 + rng() * 3 });
        }
      }
    }

    _makeInterior(id, name, districtId, props) {
      // Cari gedung terdekat di distrik itu, jadikan interior.
      let best = null, bestD = Infinity;
      const d = this.districts.find(x => x.id === districtId);
      for (const b of this.buildings) {
        if (b.district !== districtId || b.interiorId) continue;
        const dx = b.x - d.cx, dz = b.z - d.cz;
        const dd = dx * dx + dz * dz;
        if (dd < bestD) { bestD = dd; best = b; }
      }
      if (!best) return;
      best.interiorId = id;
      this.interiors.push({
        id, name, district: districtId, buildingId: best.id,
        door: { x: best.x, z: best.z + best.d / 2 + 0.5 },
        props: props.map(p => Object.assign({}, p)),
        closedAfterRobbery: false, guarded: false,
      });
    }

    // ---- waktu ----
    setTimeOfDay(hours) {
      this.timeOfDay = ((hours % 24) + 24) % 24;
      const h = this.timeOfDay;
      this.isNight = h < 6 || h >= 18.5;
      const lit = this.isNight;
      for (const b of this.buildings) b.lit = lit && this.rng() < 0.55;
      for (const l of this.lamps) l.on = lit;
      // Hujan lokal bergerak perlahan.
      if (this.rainZone) {
        this.rainZone.x += this.rainZone.vx * 0.016;
        this.rainZone.z += this.rainZone.vz * 0.016;
        if (this.rainZone.x > 160) this.rainZone.x = -160;
        if (this.rainZone.z > 180) this.rainZone.z = -180;
      }
    }

    isRainingAt(x, z) {
      if (!this.rainZone) return false;
      const dx = x - this.rainZone.x, dz = z - this.rainZone.z;
      return dx * dx + dz * dz < this.rainZone.r * this.rainZone.r;
    }

    districtAt(x, z) {
      let best = null, bestD = Infinity;
      for (const d of this.districts) {
        const dx = x - d.cx, dz = z - d.cz;
        const dd = dx * dx + dz * dz;
        if (dd < bestD && dd < d.r * d.r) { bestD = dd; best = d; }
      }
      return best;
    }

    // Densitas pejalan kaki target untuk satu distrik pada jam tertentu.
    walkDensity(districtId, hour) {
      const d = this.districts.find(x => x.id === districtId);
      if (!d) return 0.4;
      const h = hour == null ? this.timeOfDay : hour;
      let base = (h >= 6 && h < 18) ? d.walkDay : d.walkNight;
      // Jam makan siang: antrean di kios pasar & jalan belanja.
      if (h >= 11.5 && h <= 13.5 && (d.kind === 'market' || d.kind === 'commercial')) base *= 1.4;
      // Sunset: pantai ramai.
      if (h >= 17 && h < 19 && d.kind === 'beach') base *= 1.5;
      // Dini hari: jalan sepi.
      if (h >= 1 && h < 5) base *= 0.3;
      return clamp(base, 0, 1.6);
    }

    // Antrean kecil di depan kios saat jam makan siang.
    updateKioskQueues(hour) {
      const lunch = hour >= 11.5 && hour <= 13.5;
      for (const k of this.kiosks) {
        const d = this.districts.find(x => x.id === k.district);
        k.queue = lunch && (d.kind === 'market' || d.kind === 'commercial' || d.kind === 'beach')
          ? 2 + Math.floor(this.rng() * 3)
          : 0;
      }
    }

    // Toko tutup + polisi berjaga setelah dirampok.
    markRobbed(interiorId) {
      const it = this.interiors.find(x => x.id === interiorId);
      if (it) { it.closedAfterRobbery = true; it.guarded = true; }
    }
    reopen(interiorId) {
      const it = this.interiors.find(x => x.id === interiorId);
      if (it) { it.closedAfterRobbery = false; it.guarded = false; }
    }

    interiorAt(x, z, radius) {
      const r = radius || 3;
      for (const it of this.interiors) {
        const dx = x - it.door.x, dz = z - it.door.z;
        if (dx * dx + dz * dz < r * r) return it;
      }
      return null;
    }

    buildingCount() { return this.buildings.length; }

    // Ringkasan untuk HUD / debug.
    summary() {
      return {
        buildings: this.buildings.length,
        districts: this.districts.length,
        lamps: this.lamps.length,
        kiosks: this.kiosks.length,
        benches: this.benches.length,
        palms: this.palms.length,
        posters: this.posters.length,
        interiors: this.interiors.map(i => i.id),
        isNight: this.isNight,
        timeOfDay: this.timeOfDay,
      };
    }
  }

  function createCity(seed) { return new City(seed); }

  const api = { City, createCity, DISTRICTS, POSTERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SunsetCity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

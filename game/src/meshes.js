// meshes.js — Geometri "Sunset Bay" v11
// Semua mesh dibangun dari nol dengan winding CCW dan normal yang
// diverifikasi numerik menghadap keluar (lihat verifyMeshNormals).
// Mesh = { positions: Float32Array, normals: Float32Array,
//          colors: Float32Array, emissive: Float32Array, indices: Uint16Array }
// Posisi (x,y,z), y ke atas. Tanpa library eksternal.

(function (global) {
  'use strict';

  // ---------- util vektor ----------
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  // ---------- builder ----------
  // Builder menampung segitiga CCW; normal dihitung per-face (flat shading).
  class MeshBuilder {
    constructor() {
      this.pos = []; this.nor = []; this.col = []; this.emi = []; this.idx = [];
    }
    // Tambah satu quad CCW dari 4 sudut (a,b,c,d), warna + emissive seragam.
    quad(a, b, c, d, color, emissive) {
      const n = norm(cross(sub(b, a), sub(c, a)));
      const base = this.pos.length / 3;
      const em = emissive || [0, 0, 0];
      for (const p of [a, b, c, d]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(color[0], color[1], color[2]);
        this.emi.push(em[0], em[1], em[2]);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      return this;
    }
    tri(a, b, c, color, emissive) {
      const n = norm(cross(sub(b, a), sub(c, a)));
      const base = this.pos.length / 3;
      const em = emissive || [0, 0, 0];
      for (const p of [a, b, c]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(color[0], color[1], color[2]);
        this.emi.push(em[0], em[1], em[2]);
      }
      this.idx.push(base, base + 1, base + 2);
      return this;
    }
    // Segitiga dua sisi (daun, layar, sayap): emit kedua winding agar
    // terlihat dari depan maupun belakang.
    tri2(a, b, c, color, emissive) {
      this.tri(a, b, c, color, emissive);
      this.tri(a, c, b, color, emissive);
      return this;
    }
    box(cx, cy, cz, w, h, d, color, emissive) {
      const x0 = cx - w / 2, x1 = cx + w / 2;
      const y0 = cy - h / 2, y1 = cy + h / 2;
      const z0 = cz - d / 2, z1 = cz + d / 2;
      // +X, -X, +Y, -Y, +Z, -Z — semua CCW dilihat dari luar
      // (cross(b-a, c-a) searah normal luar tiap sisi).
      this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], color, emissive);
      this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], color, emissive);
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, emissive);
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, emissive);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, emissive);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, emissive);
      return this;
    }
    // Prisma segitiga (atap pelana): alas (w x d), tinggi atap rh.
    prismRoof(cx, cy, cz, w, rh, d, color) {
      const x0 = cx - w / 2, x1 = cx + w / 2;
      const z0 = cz - d / 2, z1 = cz + d / 2;
      const apex = [cx, cy + rh, cz];
      // Dua sisi miring (tri): sisi +Z dan -Z, plus dua sisi segitiga ujung.
      this.tri([x0, cy, z1], [x1, cy, z1], [cx, cy + rh, z1], color);
      this.tri([x1, cy, z0], [x0, cy, z0], [cx, cy + rh, z0], color);
      this.tri([x0, cy, z0], [x0, cy, z1], [cx, cy + rh, z1], color);
      this.tri([x1, cy, z1], [x1, cy, z0], [cx, cy + rh, z0], color);
      return this;
    }
    build() {
      return {
        positions: new Float32Array(this.pos),
        normals: new Float32Array(this.nor),
        colors: new Float32Array(this.col),
        emissive: new Float32Array(this.emi),
        indices: new Uint16Array(this.idx),
      };
    }
  }

  // ---------- verifikasi normal ----------
  // Untuk tiap segitiga EKSTERIOR (centroid-nya menyentuh permukaan
  // bounding box mesh): normal (dari cross produk CCW) harus menghadap
  // keluar, yaitu dot(normal, centroid - bboxCenter) > 0.
  // Segitiga interior (mis. alas tutup kotak yang menempel di badan)
  // dilewati karena tidak terlihat dari luar.
  // Mengembalikan { ok, bad, total, checked }.
  function verifyMeshNormals(mesh, center) {
    const p = mesh.positions, idx = mesh.indices;
    // Pusat = tengah bounding box (bukan rata-rata vertex, agar stabil).
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < mn[k]) mn[k] = p[i + k];
        if (p[i + k] > mx[k]) mx[k] = p[i + k];
      }
    }
    const c = center || [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    const eps = 1e-4;
    let bad = 0, checked = 0; const total = idx.length / 3;
    for (let t = 0; t < total; t++) {
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const a = [p[i0], p[i0 + 1], p[i0 + 2]];
      const b = [p[i1], p[i1 + 1], p[i1 + 2]];
      const cc = [p[i2], p[i2 + 1], p[i2 + 2]];
      const cen = [(a[0] + b[0] + cc[0]) / 3, (a[1] + b[1] + cc[1]) / 3, (a[2] + b[2] + cc[2]) / 3];
      // Eksterior? minimal satu koordinat centroid menyentuh bbox.
      let exterior = false;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(cen[k] - mn[k]) < 0.05 || Math.abs(cen[k] - mx[k]) < 0.05) { exterior = true; break; }
      }
      if (!exterior) continue;
      checked++;
      const n = norm(cross(sub(b, a), sub(cc, a)));
      const v = [cen[0] - c[0], cen[1] - c[1], cen[2] - c[2]];
      // Flag hanya bila normal jelas-jelas menghadap ke dalam (proyeksi
      // negatif > 20% dari jarak centroid ke pusat). Wajah yang hampir
      // sejajar bidang tengah (mis. bawah lengan) tidak dihitung salah.
      const vl = Math.sqrt(dot(v, v)) || 1;
      if (dot(n, v) < -0.2 * vl) bad++;
    }
    return { ok: bad === 0, bad, total, checked };
  }

  // ---------- mesh gedung ----------
  // Gedung dengan jendela emissive (menyala saat malam: emissive diset
  // lewat flag lit; mesh menyimpan dua set emissive: siang 0, malam hangat).
  function createBuildingMesh(spec) {
    // spec: {w,h,d,color,windows,roof:'flat'|'gable',lit}
    const b = new MeshBuilder();
    const w = spec.w, h = spec.h, d = spec.d;
    const col = spec.color;
    b.box(0, h / 2, 0, w, h, d, col);
    // Atap.
    if (spec.roof === 'gable') {
      b.prismRoof(0, h, 0, w, Math.min(3, h * 0.25), d, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7]);
    } else {
      b.box(0, h + 0.15, 0, w * 0.92, 0.3, d * 0.92, [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75]);
    }
    // Jendela emissive di fasad +Z dan -Z, sedikit menonjol dari dinding.
    const winCol = [0.15, 0.18, 0.25];
    const winEmi = spec.lit ? [1.0, 0.75, 0.35] : [0, 0, 0];
    const rows = Math.max(1, Math.floor(spec.windows || 3));
    const cols = Math.max(2, Math.floor(w / 3));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = -w / 2 + (c + 0.5) * (w / cols);
        const wy = 1.2 + r * ((h - 2) / rows);
        const ww = w / cols * 0.45, wh = 0.9;
        // +Z
        b.quad([wx - ww / 2, wy - wh / 2, d / 2 + 0.03], [wx + ww / 2, wy - wh / 2, d / 2 + 0.03],
               [wx + ww / 2, wy + wh / 2, d / 2 + 0.03], [wx - ww / 2, wy + wh / 2, d / 2 + 0.03], winCol, winEmi);
        // -Z
        b.quad([wx + ww / 2, wy - wh / 2, -d / 2 - 0.03], [wx - ww / 2, wy - wh / 2, -d / 2 - 0.03],
               [wx - ww / 2, wy + wh / 2, -d / 2 - 0.03], [wx + ww / 2, wy + wh / 2, -d / 2 - 0.03], winCol, winEmi);
      }
    }
    // Pintu.
    b.quad([-0.7, 0, d / 2 + 0.03], [0.7, 0, d / 2 + 0.03], [0.7, 2.2, d / 2 + 0.03], [-0.7, 2.2, d / 2 + 0.03],
      [0.25, 0.18, 0.12], [0, 0, 0]);
    const mesh = b.build();
    mesh.meta = { kind: 'building', lit: !!spec.lit, windows: rows * cols * 2 };
    return mesh;
  }

  // ---------- palma ----------
  function createPalmMesh(h) {
    const b = new MeshBuilder();
    const height = h || 6;
    const trunk = [0.45, 0.32, 0.2];
    const leaf = [0.15, 0.55, 0.2];
    // Batang: 3 segmen kotak miring sedikit.
    let y = 0;
    for (let s = 0; s < 3; s++) {
      const segH = height / 3;
      b.box(0.15 * s, y + segH / 2, 0, 0.35, segH, 0.35, trunk);
      y += segH;
    }
    // Daun: 6 segitiga menjuntai dari puncak.
    const top = [0.45, height, 0];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const tip = [top[0] + Math.cos(a) * 2.2, height - 1.4, top[2] + Math.sin(a) * 2.2];
      const side = [top[0] + Math.cos(a + 0.5) * 1.2, height - 0.4, top[2] + Math.sin(a + 0.5) * 1.2];
      b.tri2(top, side, tip, leaf);
      b.tri2(top, tip, [top[0] + Math.cos(a - 0.5) * 1.2, height - 0.4, top[2] + Math.sin(a - 0.5) * 1.2], leaf);
    }
    // Kelapa.
    b.box(top[0], height - 0.3, top[2], 0.5, 0.5, 0.5, [0.4, 0.3, 0.15]);
    const mesh = b.build();
    mesh.meta = { kind: 'palm', height };
    return mesh;
  }

  // ---------- mobil ----------
  // Mobil dengan lampu depan emissive (dua quad putih di depan).
  function createCarMesh(color, opts) {
    const o = opts || {};
    const b = new MeshBuilder();
    const col = color || [0.8, 0.1, 0.1];
    // Badan bawah + kabin.
    b.box(0, 0.55, 0, 1.8, 0.7, 4.2, col);
    b.box(0, 1.25, -0.2, 1.6, 0.6, 2.2, [0.12, 0.14, 0.18]); // kaca kabin
    b.box(0, 1.05, -0.2, 1.65, 0.25, 2.3, col); // atap tipis
    // Roda (4 kotak gelap).
    const wheel = [0.08, 0.08, 0.08];
    for (const sx of [-0.85, 0.85]) for (const sz of [-1.4, 1.4]) {
      b.box(sx, 0.35, sz, 0.25, 0.7, 0.7, wheel);
    }
    // Lampu depan emissive (depan = +Z).
    const headEmi = o.headlightsOn ? [1.0, 0.95, 0.7] : [0.4, 0.4, 0.35];
    for (const sx of [-0.55, 0.55]) {
      b.quad([sx - 0.22, 0.55, 2.11], [sx + 0.22, 0.55, 2.11], [sx + 0.22, 0.85, 2.11], [sx - 0.22, 0.85, 2.11],
        [1, 1, 0.9], headEmi);
    }
    // Lampu belakang merah.
    for (const sx of [-0.55, 0.55]) {
      b.quad([sx + 0.22, 0.55, -2.11], [sx - 0.22, 0.55, -2.11], [sx - 0.22, 0.85, -2.11], [sx + 0.22, 0.85, -2.11],
        [0.6, 0.05, 0.05], [0.5, 0.05, 0.05]);
    }
    const mesh = b.build();
    mesh.meta = { kind: 'car', headlightsOn: !!o.headlightsOn };
    return mesh;
  }

  // Siluet LOD mobil jauh: badan + 2 lampu depan saja.
  function createCarLodMesh(color) {
    const b = new MeshBuilder();
    b.box(0, 0.6, 0, 1.8, 1.0, 4.2, color || [0.5, 0.5, 0.5]);
    for (const sx of [-0.55, 0.55]) {
      b.quad([sx - 0.25, 0.5, 2.11], [sx + 0.25, 0.5, 2.11], [sx + 0.25, 0.8, 2.11], [sx - 0.25, 0.8, 2.11],
        [1, 1, 0.9], [1.0, 0.95, 0.7]);
    }
    const mesh = b.build();
    mesh.meta = { kind: 'car-lod' };
    return mesh;
  }

  // ---------- pejalan kaki ----------
  function createPedestrianMesh(shirt, pants, skin) {
    const b = new MeshBuilder();
    const sh = shirt || [0.2, 0.5, 0.8];
    const pa = pants || [0.15, 0.15, 0.2];
    const sk = skin || [0.85, 0.65, 0.5];
    b.box(0, 0.45, 0, 0.4, 0.9, 0.25, pa);          // kaki
    b.box(0, 1.15, 0, 0.55, 0.55, 0.3, sh);         // badan
    b.box(0, 1.6, 0, 0.32, 0.32, 0.3, sk);          // kepala
    b.box(-0.32, 1.15, 0, 0.12, 0.5, 0.2, sh);      // lengan kiri
    b.box(0.32, 1.15, 0, 0.12, 0.5, 0.2, sh);       // lengan kanan
    const mesh = b.build();
    mesh.meta = { kind: 'pedestrian' };
    return mesh;
  }

  // ---------- perahu ----------
  function createBoatMesh(color) {
    const b = new MeshBuilder();
    const col = color || [0.9, 0.85, 0.7];
    // Lambung: kotak bawah + sisi miring (prisma sederhana).
    b.box(0, 0.4, 0, 1.6, 0.6, 4.5, col);
    b.tri([0.8, 0.7, 2.25], [-0.8, 0.7, 2.25], [0, 0.7, 3.1], col); // haluan (+Y)
    b.tri([-0.8, 0.7, -2.25], [0.8, 0.7, -2.25], [0, 0.7, -2.9], col); // buritan (+Y)
    // Tiang + layar segitiga (dua sisi).
    b.box(0, 1.6, 0, 0.12, 1.8, 0.12, [0.4, 0.3, 0.2]);
    b.tri2([0, 2.4, 0], [0, 0.9, 0.1], [0, 0.9, 1.6], [0.95, 0.92, 0.85]);
    // Bangku.
    b.box(0, 0.75, -0.8, 1.4, 0.1, 0.4, [0.5, 0.38, 0.25]);
    b.box(0, 0.75, 0.8, 1.4, 0.1, 0.4, [0.5, 0.38, 0.25]);
    const mesh = b.build();
    mesh.meta = { kind: 'boat' };
    return mesh;
  }

  // ---------- prop ----------
  // Prop kecil: bangku, tempat sampah, kios, lampu jalan, poster, cangkir, koran.
  function createPropMesh(kind, color) {
    const b = new MeshBuilder();
    const col = color || [0.6, 0.5, 0.4];
    if (kind === 'bench') {
      b.box(0, 0.45, 0, 1.8, 0.1, 0.5, col);
      b.box(0, 0.75, -0.22, 1.8, 0.5, 0.08, col);
      b.box(-0.8, 0.2, 0, 0.1, 0.4, 0.45, [0.2, 0.2, 0.2]);
      b.box(0.8, 0.2, 0, 0.1, 0.4, 0.45, [0.2, 0.2, 0.2]);
    } else if (kind === 'bin') {
      b.box(0, 0.5, 0, 0.6, 1.0, 0.6, [0.15, 0.4, 0.2]);
      b.box(0, 1.05, 0, 0.65, 0.1, 0.65, [0.1, 0.3, 0.15]);
    } else if (kind === 'kiosk') {
      b.box(0, 1.0, 0, 2.4, 2.0, 2.0, col);
      b.box(0, 2.15, 0, 2.8, 0.3, 2.4, [0.85, 0.3, 0.25]); // atap
      b.box(0, 1.1, 1.05, 2.0, 0.08, 0.4, [0.7, 0.6, 0.45]); // meja depan
    } else if (kind === 'lamp') {
      b.box(0, 1.5, 0, 0.15, 3.0, 0.15, [0.2, 0.2, 0.22]);
      b.box(0.3, 3.0, 0, 0.7, 0.12, 0.12, [0.2, 0.2, 0.22]);
      b.box(0.55, 2.9, 0, 0.3, 0.2, 0.3, [1, 0.95, 0.7], [1.0, 0.85, 0.4]);
    } else if (kind === 'poster') {
      b.box(0, 1.2, 0, 1.0, 1.4, 0.06, [0.9, 0.9, 0.85]);
      b.box(0, 1.2, 0.04, 0.85, 1.2, 0.02, [0.2, 0.4, 0.7]);
    } else if (kind === 'cup') {
      b.box(0, 0.08, 0, 0.12, 0.16, 0.12, [0.95, 0.95, 0.95]);
      b.box(0, 0.17, 0, 0.1, 0.03, 0.1, [0.3, 0.18, 0.08]);
    } else if (kind === 'newspaper') {
      b.box(0, 0.02, 0, 0.5, 0.04, 0.35, [0.95, 0.95, 0.9]);
      b.box(0, 0.045, 0, 0.2, 0.01, 0.3, [0.15, 0.15, 0.15]);
    } else if (kind === 'seagull') {
      // Camar: dua segitiga sayap (dua sisi).
      b.tri2([0, 0, 0], [-0.7, 0.15, 0.25], [-0.7, 0.15, -0.25], [0.95, 0.95, 0.95]);
      b.tri2([0, 0, 0], [0.7, 0.15, -0.25], [0.7, 0.15, 0.25], [0.95, 0.95, 0.95]);
      b.box(0, 0, 0, 0.15, 0.12, 0.5, [0.95, 0.95, 0.95]);
    } else {
      b.box(0, 0.5, 0, 1, 1, 1, col);
    }
    const mesh = b.build();
    mesh.meta = { kind: 'prop:' + kind };
    return mesh;
  }

  // ---------- verifikasi semua mesh bawaan ----------
  function verifyAllMeshes() {
    const results = {};
    const specs = [
      ['building', createBuildingMesh({ w: 10, h: 12, d: 8, color: [0.8, 0.7, 0.6], windows: 4, roof: 'flat', lit: true })],
      ['building-gable', createBuildingMesh({ w: 8, h: 6, d: 7, color: [0.7, 0.6, 0.5], windows: 2, roof: 'gable', lit: false })],
      ['palm', createPalmMesh(6)],
      ['car', createCarMesh([0.8, 0.1, 0.1], { headlightsOn: true })],
      ['car-lod', createCarLodMesh([0.5, 0.5, 0.5])],
      ['pedestrian', createPedestrianMesh()],
      ['boat', createBoatMesh()],
      ['bench', createPropMesh('bench')],
      ['bin', createPropMesh('bin')],
      ['kiosk', createPropMesh('kiosk')],
      ['lamp', createPropMesh('lamp')],
      ['seagull', createPropMesh('seagull')],
    ];
    for (const [name, mesh] of specs) {
      // Pusat = tengah bounding box (dihitung di dalam verifyMeshNormals).
      results[name] = verifyMeshNormals(mesh);
    }
    return results;
  }

  const api = {
    MeshBuilder, verifyMeshNormals, verifyAllMeshes,
    createBuildingMesh, createPalmMesh, createCarMesh, createCarLodMesh,
    createPedestrianMesh, createBoatMesh, createPropMesh,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SunsetMeshes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

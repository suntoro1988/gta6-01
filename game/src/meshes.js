// Sunset Bay v8 — meshes.js
// Pembangun mesh segitiga warna-flat: {pos: Float32Array, col: Float32Array}.
(function () {
  'use strict';
  window.SB = window.SB || {};

  // Builder: kumpulkan posisi + warna per vertex.
  function Builder() {
    this.pos = [];
    this.col = [];
  }
  Builder.prototype.tri = function (a, b, c, color) {
    var p = this.pos, cl = this.col;
    p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (var i = 0; i < 3; i++) cl.push(color[0], color[1], color[2]);
  };
  // Satu sisi kotak (quad -> 2 segitiga), warna sisi bisa dibedakan.
  Builder.prototype.quad = function (a, b, c, d, color) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  };
  // Kotak berpusat di (cx, cy, cz) ukuran (w,h,d). faceCol: warna per sisi opsional.
  Builder.prototype.boxAt = function (cx, cy, cz, w, h, d, color, faceCol) {
    var x0 = cx - w / 2, x1 = cx + w / 2;
    var y0 = cy - h / 2, y1 = cy + h / 2;
    var z0 = cz - d / 2, z1 = cz + d / 2;
    var f = faceCol || {};
    var top = f.top || shade(color, 1.15);
    var bot = f.bottom || shade(color, 0.6);
    var n = f.north || shade(color, 0.85);
    var s = f.south || shade(color, 0.95);
    var e = f.east || shade(color, 0.8);
    var wcol = f.west || shade(color, 0.9);
    // atas (y1)
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], top);
    // bawah (y0)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], bot);
    // utara (z1)
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], n);
    // selatan (z0)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], s);
    // timur (x1)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], e);
    // barat (x0)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], wcol);
  };
  Builder.prototype.finish = function () {
    return { pos: new Float32Array(this.pos), col: new Float32Array(this.col) };
  };

  function shade(color, k) {
    return [
      Math.min(1, color[0] * k),
      Math.min(1, color[1] * k),
      Math.min(1, color[2] * k)
    ];
  }
  function vary(color, amt, rng) {
    var f = 1 + (rng ? (rng.next() * 2 - 1) * amt : 0);
    return [Math.min(1, color[0] * f), Math.min(1, color[1] * f), Math.min(1, color[2] * f)];
  }

  // Kotak sederhana berpusat di origin, alas di y=0.
  function box(w, h, d) {
    var b = new Builder();
    b.boxAt(0, h / 2, 0, w, h, d, [0.75, 0.75, 0.78]);
    return b.finish();
  }

  // Bangunan: badan + atap + strip jendela gelap di sisi depan.
  function building(w, h, d, seed) {
    var rng = window.SB.RNG;
    rng.seed((seed || 1) * 2654435761 >>> 0);
    var palette = [
      [0.62, 0.58, 0.52], [0.55, 0.60, 0.66], [0.68, 0.55, 0.45],
      [0.48, 0.55, 0.60], [0.70, 0.65, 0.55], [0.60, 0.52, 0.58],
      [0.52, 0.58, 0.50], [0.66, 0.62, 0.60]
    ];
    var base = vary(palette[Math.floor(rng.next() * palette.length)], 0.12, rng);
    var b = new Builder();
    b.boxAt(0, h / 2, 0, w, h, d, base, { top: shade(base, 0.55) });
    // atap: kotak tipis lebih gelap
    b.boxAt(0, h + 0.15, 0, w * 0.92, 0.3, d * 0.92, shade(base, 0.45));
    // strip jendela: beberapa quad gelap di sisi depan (z+)
    var win = [0.12, 0.16, 0.22];
    var floors = Math.max(1, Math.floor(h / 4));
    var cols = Math.max(1, Math.floor(w / 2.5));
    var i, j;
    for (i = 0; i < floors; i++) {
      for (j = 0; j < cols; j++) {
        if (rng.next() < 0.35) continue; // sebagian jendela gelap
        var wx = -w / 2 + (j + 0.5) * (w / cols);
        var wy = 1.2 + i * 4;
        if (wy + 1.2 > h - 0.6) continue;
        var ww = Math.min(1.4, w / cols * 0.6);
        var z = d / 2 + 0.02;
        b.quad(
          [wx - ww / 2, wy, z], [wx + ww / 2, wy, z],
          [wx + ww / 2, wy + 1.2, z], [wx - ww / 2, wy + 1.2, z],
          rng.next() < 0.25 ? [0.95, 0.8, 0.4] : win
        );
      }
    }
    return b.finish();
  }

  // Mobil: badan + kabin + 4 roda. Warna badan dari argumen [r,g,b].
  function car(color) {
    var c = color || [0.8, 0.2, 0.2];
    var b = new Builder();
    // badan (alas y=0.35)
    b.boxAt(0, 0.65, 0, 1.9, 0.6, 4.2, c);
    // kabin
    b.boxAt(0, 1.2, -0.2, 1.7, 0.55, 2.2, shade(c, 0.85), { top: [0.15, 0.18, 0.25] });
    // kaca depan/belakang gelap
    b.quad([-0.8, 0.95, 0.95], [0.8, 0.95, 0.95], [0.8, 1.45, 0.95], [-0.8, 1.45, 0.95], [0.1, 0.12, 0.18]);
    // roda
    var dark = [0.08, 0.08, 0.09];
    var wx = [-0.85, 0.85], wz = [-1.35, 1.35];
    var i, j;
    for (i = 0; i < 2; i++) {
      for (j = 0; j < 2; j++) {
        b.boxAt(wx[i], 0.35, wz[j], 0.3, 0.7, 0.7, dark);
      }
    }
    // lampu depan
    b.quad([-0.7, 0.7, 2.11], [0.7, 0.7, 2.11], [0.7, 0.9, 2.11], [-0.7, 0.9, 2.11], [1.0, 0.95, 0.7]);
    return b.finish();
  }

  // Orang: kaki, badan, kepala. Tinggi ~1.8.
  function person() {
    var b = new Builder();
    var skin = [0.85, 0.65, 0.5];
    var shirt = [0.25, 0.45, 0.75];
    var pants = [0.2, 0.22, 0.3];
    b.boxAt(-0.12, 0.4, 0, 0.2, 0.8, 0.2, pants); // kaki kiri
    b.boxAt(0.12, 0.4, 0, 0.2, 0.8, 0.2, pants);  // kaki kanan
    b.boxAt(0, 1.15, 0, 0.55, 0.7, 0.3, shirt);    // badan
    b.boxAt(0, 1.72, 0, 0.34, 0.34, 0.34, skin);   // kepala
    return b.finish();
  }

  // Speedboat: lambung + kabin + jok.
  function boat() {
    var b = new Builder();
    var hull = [0.9, 0.9, 0.92];
    b.boxAt(0, 0.5, 0, 2.2, 0.7, 5.5, hull, { top: shade(hull, 0.9) });
    b.boxAt(0, 1.0, -0.6, 1.8, 0.5, 2.0, [0.2, 0.35, 0.6], { top: [0.1, 0.14, 0.2] });
    b.boxAt(0, 0.95, 1.2, 1.6, 0.35, 1.2, [0.75, 0.3, 0.25]);
    // garis merah di lambung
    b.quad([-1.11, 0.55, -2.7], [-1.11, 0.55, 2.7], [-1.11, 0.75, 2.7], [-1.11, 0.75, -2.7], [0.85, 0.2, 0.15]);
    b.quad([1.11, 0.55, 2.7], [1.11, 0.55, -2.7], [1.11, 0.75, -2.7], [1.11, 0.75, 2.7], [0.85, 0.2, 0.15]);
    return b.finish();
  }

  // Pohon: batang + 2 tingkat dedaunan (kotak).
  function tree() {
    var b = new Builder();
    b.boxAt(0, 1.0, 0, 0.35, 2.0, 0.35, [0.45, 0.3, 0.18]);
    b.boxAt(0, 2.6, 0, 1.9, 1.4, 1.9, [0.2, 0.55, 0.25]);
    b.boxAt(0, 3.6, 0, 1.3, 1.0, 1.3, [0.25, 0.62, 0.3]);
    return b.finish();
  }

  window.SB.Meshes = {
    box: box, building: building, car: car, person: person, boat: boat, tree: tree
  };
})();

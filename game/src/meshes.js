// Sunset Bay — meshes: geometri segitiga warna flat (tanpa tekstur).
// Setiap mesh = {pos: Float32Array, col: Float32Array}, y=0 di alas.
(function () {
  var SB = window.SB = window.SB || {};

  function Builder() {
    this.p = [];
    this.c = [];
  }
  Builder.prototype.shade = function (rgb, f) {
    return [rgb[0] * f, rgb[1] * f, rgb[2] * f];
  };
  Builder.prototype.tri = function (a, b, c, rgb) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (var i = 0; i < 3; i++) this.c.push(rgb[0], rgb[1], rgb[2]);
  };
  Builder.prototype.quad = function (a, b, c, d, rgb) {
    this.tri(a, b, c, rgb);
    this.tri(a, c, d, rgb);
  };
  // Kotak: x,z berpusat di 0, y dari y0 sampai y0+h.
  Builder.prototype.box = function (w, h, d, y0, rgb, topRgb) {
    var x = w / 2, z = d / 2, y = y0, yt = y0 + h;
    var top = topRgb || this.shade(rgb, 1.25);
    var side = this.shade(rgb, 0.82);
    var side2 = this.shade(rgb, 0.68);
    var bot = this.shade(rgb, 0.5);
    // atas
    this.quad([-x, yt, -z], [x, yt, -z], [x, yt, z], [-x, yt, z], top);
    // bawah
    this.quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], bot);
    // depan (+z) & belakang (-z)
    this.quad([-x, y, z], [x, y, z], [x, yt, z], [-x, yt, z], side);
    this.quad([x, y, -z], [-x, y, -z], [-x, yt, -z], [x, yt, -z], side);
    // kanan (+x) & kiri (-x)
    this.quad([x, y, z], [x, y, -z], [x, yt, -z], [x, yt, z], side2);
    this.quad([-x, y, -z], [-x, y, z], [-x, yt, z], [-x, yt, -z], side2);
  };
  Builder.prototype.finish = function () {
    return { pos: new Float32Array(this.p), col: new Float32Array(this.c) };
  };

  function box(w, h, d) {
    var b = new Builder();
    b.box(w, h, d, 0, [0.75, 0.75, 0.75]);
    return b.finish();
  }

  // Bangunan: badan + atap + jendela bercahaya di 2 sisi (variasi dari seed).
  // RNG lokal (mulberry32) — JANGAN sentuh SB.RNG global, agar urutan
  // deterministik pemanggil lain tidak rusak.
  function building(w, h, d, seed) {
    var s = ((seed || 1) * 2654435761 + 97) | 0;
    var rnd = function () {
      s = s + 0x6D2B79F5 | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    var b = new Builder();
    var palettes = [
      [0.62, 0.58, 0.52], [0.55, 0.60, 0.68], [0.68, 0.55, 0.50],
      [0.50, 0.58, 0.55], [0.70, 0.65, 0.55], [0.58, 0.55, 0.62]
    ];
    var base = palettes[Math.floor(rnd() * palettes.length)];
    b.box(w, h, d, 0, base);
    // atap: slab tipis sedikit lebih lebar, warna gelap
    b.box(w + 0.4, 0.5, d + 0.4, h, [0.22, 0.22, 0.26]);
    // antena kecil kadang-kadang
    if (rnd() < 0.4) {
      b.box(0.3, 2.2, 0.3, h + 0.5, [0.35, 0.35, 0.38]);
    }
    // jendela: grid di sisi depan (+z) dan belakang (-z)
    var rows = Math.max(1, Math.floor(h / 3.2));
    var cols = Math.max(1, Math.floor(w / 2.6));
    var lit = rnd() < 0.5 ? [1.0, 0.85, 0.45] : [0.75, 0.85, 0.95];
    var dark = [0.12, 0.14, 0.18];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var wx = -w / 2 + (c + 0.5) * (w / cols);
        var wy = 1.6 + r * 3.2;
        if (wy > h - 1) continue;
        var on = rnd() < 0.55;
        var col = on ? lit : dark;
        var s = 0.55, eps = 0.06;
        // depan
        b.quad([wx - s, wy - s, d / 2 + eps], [wx + s, wy - s, d / 2 + eps],
               [wx + s, wy + s, d / 2 + eps], [wx - s, wy + s, d / 2 + eps], col);
        // belakang
        b.quad([wx + s, wy - s, -d / 2 - eps], [wx - s, wy - s, -d / 2 - eps],
               [wx - s, wy + s, -d / 2 - eps], [wx + s, wy + s, -d / 2 - eps], col);
      }
    }
    return b.finish();
  }

  // Mobil: badan bawah + kabin + 4 roda (kotak kecil gelap). Menghadap +z.
  // color boleh array [r,g,b] 0..1, angka hex 0xRRGGBB, atau string '#RRGGBB'
  // (vehicles menyimpan warna sebagai angka hex).
  function car(color) {
    var c = color || [0.8, 0.2, 0.2];
    if (typeof c === 'number') {
      c = [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
    } else if (typeof c === 'string' && c.charAt(0) === '#' && c.length === 7) {
      var n = parseInt(c.slice(1), 16);
      c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    var b = new Builder();
    b.box(1.9, 0.55, 4.2, 0.35, c);                       // badan
    b.box(1.6, 0.55, 2.1, 0.9, [0.15, 0.18, 0.22]);      // kabin/kaca
    b.box(1.7, 0.12, 2.2, 1.42, b.shade(c, 1.15));        // atap kabin
    // Roda sebagai kotak di posisi absolut (4 sudut):
    var wheels = [
      [-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]
    ];
    for (var k = 0; k < wheels.length; k++) {
      var ox = wheels[k][0], oz = wheels[k][1];
      var xw = 0.18, zw = 0.3, yb = 0.05, yt = 0.6;
      b.quad([ox - xw, yt, oz - zw], [ox + xw, yt, oz - zw], [ox + xw, yt, oz + zw], [ox - xw, yt, oz + zw], [0.05, 0.05, 0.05]);
      b.quad([ox - xw, yb, oz + zw], [ox + xw, yb, oz + zw], [ox + xw, yt, oz + zw], [ox - xw, yt, oz + zw], [0.1, 0.1, 0.1]);
      b.quad([ox + xw, yb, oz - zw], [ox - xw, yb, oz - zw], [ox - xw, yt, oz - zw], [ox + xw, yt, oz - zw], [0.1, 0.1, 0.1]);
      b.quad([ox + xw, yb, oz + zw], [ox + xw, yb, oz - zw], [ox + xw, yt, oz - zw], [ox + xw, yt, oz + zw], [0.07, 0.07, 0.07]);
      b.quad([ox - xw, yb, oz - zw], [ox - xw, yb, oz + zw], [ox - xw, yt, oz + zw], [ox - xw, yt, oz - zw], [0.07, 0.07, 0.07]);
    }
    return b.finish();
  }

  // Pejalan kaki: kaki, badan, kepala. Tinggi ~1.8.
  // Warna baju acak via Math.random (bukan SB.RNG) agar tidak mengganggu
  // urutan deterministik pemanggil lain.
  function person() {
    var b = new Builder();
    var shirt = [[0.8, 0.3, 0.3], [0.3, 0.5, 0.85], [0.9, 0.75, 0.3], [0.35, 0.7, 0.4]][Math.floor(Math.random() * 4)];
    b.box(0.5, 0.75, 0.28, 0, [0.2, 0.22, 0.3]);        // kaki
    b.box(0.55, 0.65, 0.32, 0.75, shirt);                // badan
    b.box(0.36, 0.36, 0.36, 1.4, [0.92, 0.75, 0.6]);     // kepala
    return b.finish();
  }

  // Speedboat: lambung runcing (pakai kotak + haluan segitiga) + konsol.
  function boat() {
    var b = new Builder();
    var hull = [0.95, 0.95, 0.95];
    // lambung: kotak utama
    b.box(2.0, 0.7, 4.6, 0.1, hull);
    // haluan: prisma segitiga di depan (+z)
    var tip = [0, 0.8, 3.4];
    var bw = 1.0, by = 0.1, ty = 0.8, bz = 2.3;
    b.tri([-bw, by, bz], [bw, by, bz], tip, b.shade(hull, 0.9));
    b.tri([bw, by, bz], [bw, ty, bz], tip, b.shade(hull, 0.75));
    b.tri([-bw, ty, bz], [-bw, by, bz], tip, b.shade(hull, 0.75));
    b.tri([-bw, ty, bz], [bw, ty, bz], tip, b.shade(hull, 1.15));
    // konsol + kursi
    b.box(1.1, 0.7, 0.9, 0.8, [0.2, 0.25, 0.3]);
    b.box(1.2, 0.15, 1.0, 1.5, [0.15, 0.2, 0.25]);
    // mesin belakang
    b.box(0.7, 0.6, 0.5, 0.35, [0.12, 0.12, 0.14]);
    return b.finish();
  }

  // Pohon: batang + 2 lapis tajuk kotak.
  function tree() {
    var b = new Builder();
    b.box(0.35, 1.6, 0.35, 0, [0.45, 0.3, 0.18]);
    b.box(1.9, 1.3, 1.9, 1.5, [0.25, 0.55, 0.25]);
    b.box(1.3, 1.0, 1.3, 2.7, [0.3, 0.62, 0.28]);
    return b.finish();
  }

  SB.Meshes = {
    box: box, building: building, car: car,
    person: person, boat: boat, tree: tree
  };
})();

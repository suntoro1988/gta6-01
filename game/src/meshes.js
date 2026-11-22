window.SB = window.SB || {};
(function(){ 'use strict';

// SB.Meshes — pembangun geometri prosedural Sunset Bay.
// Setiap fungsi mengembalikan { vertices, normals, indices, colors }.
//   vertices : array datar [x,y,z, x,y,z, ...]
//   normals  : array datar [nx,ny,nz, ...] (satu normal per vertex)
//   indices  : array segitiga [i0,i1,i2, ...], winding CCW dilihat dari luar
//   colors   : array datar [r,g,b, ...] (satu warna per vertex, 0..1)
// Semua mesh dibangun dari NOL (base y = 0, berpusat di x = 0, z = 0) kecuali
// plane() yang berpusat di titik asal dan membentang di bidang XZ.

// Util warna

// Ubah '#rrggbb' (atau '#rgb') menjadi [r, g, b] 0..1.
function hexToRgb(hex) {
  if (typeof hex !== 'string') { return [0.8, 0.8, 0.8]; }
  var h = hex.replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  if (h.length !== 6) { return [0.8, 0.8, 0.8]; }
  var r = parseInt(h.slice(0, 2), 16) / 255;
  var g = parseInt(h.slice(2, 4), 16) / 255;
  var b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

// Terangkan / gelapkan warna [r,g,b] dengan faktor f (f > 1 lebih terang).
function shade(col, f) {
  return [
    Math.min(1, Math.max(0, col[0] * f)),
    Math.min(1, Math.max(0, col[1] * f)),
    Math.min(1, Math.max(0, col[2] * f))
  ];
}

// Campur dua warna: mix(a, b, t) -> a*(1-t) + b*t.
function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

// MeshBuilder — penampung verteks sementara sebelum difinalisasi.

function MeshBuilder() {
  this.vertices = [];
  this.normals = [];
  this.indices = [];
  this.colors = [];
}

// Tambah satu verteks (p = [x,y,z], n = [nx,ny,nz], c = [r,g,b]).
// Mengembalikan indeks verteks baru.
MeshBuilder.prototype.vertex = function(p, n, c) {
  this.vertices.push(p[0], p[1], p[2]);
  this.normals.push(n[0], n[1], n[2]);
  this.colors.push(c[0], c[1], c[2]);
  return (this.vertices.length / 3) - 1;
};

// Tambah satu segitiga dari tiga titik + satu normal + satu warna.
// Urutan a -> b -> c HARUS CCW bila dilihat dari arah normal (dari luar).
MeshBuilder.prototype.tri = function(a, b, c, n, col) {
  var ia = this.vertex(a, n, col);
  var ib = this.vertex(b, n, col);
  var ic = this.vertex(c, n, col);
  this.indices.push(ia, ib, ic);
};

// Tambah satu quad (dua segitiga: a-b-c dan a-c-d), CCW dari arah normal.
MeshBuilder.prototype.quad = function(a, b, c, d, n, col) {
  this.tri(a, b, c, n, col);
  this.tri(a, c, d, n, col);
};

// Tambah kotak solid.
// (cx, cy, cz) = tengah alas kotak; w = lebar (x), h = tinggi (y), d = dalam (z).
// Warna atap sedikit lebih terang, warna alas sedikit lebih gelap.
MeshBuilder.prototype.box = function(cx, cy, cz, w, h, d, col) {
  var x0 = cx - w / 2, x1 = cx + w / 2;
  var y0 = cy, y1 = cy + h;
  var z0 = cz - d / 2, z1 = cz + d / 2;
  var top = shade(col, 1.18), side = col, dark = shade(col, 0.72);
  // Atas (+y). Dilihat dari atas, urutan CCW.
  this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
    [0, 1, 0], top);
  // Bawah (-y).
  this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [0, -1, 0], dark);
  // Depan (+z).
  this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    [0, 0, 1], side);
  // Belakang (-z).
  this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [0, 0, -1], side);
  // Kanan (+x).
  this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
    [1, 0, 0], shade(col, 0.92));
  // Kiri (-x).
  this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0],
    [-1, 0, 0], shade(col, 0.92));
};

// Tambah silinder tegak (sumbu Y).
// (cx, cy, cz) = tengah alas; rTop/rBot = jari-jari atas/bawah; h = tinggi.
// seg = jumlah segmen keliling. Tutup atas + bawah dibuat dari kipas segitiga.
MeshBuilder.prototype.cylinder = function(cx, cy, cz, rTop, rBot, h, seg, col) {
  var i, a0, a1;
  var y0 = cy, y1 = cy + h;
  var side = col, topCol = shade(col, 1.15), botCol = shade(col, 0.7);
  for (i = 0; i < seg; i++) {
    a0 = (i / seg) * Math.PI * 2;
    a1 = ((i + 1) / seg) * Math.PI * 2;
    var bx0 = cx + Math.cos(a0) * rBot, bz0 = cz + Math.sin(a0) * rBot;
    var bx1 = cx + Math.cos(a1) * rBot, bz1 = cz + Math.sin(a1) * rBot;
    var tx0 = cx + Math.cos(a0) * rTop, tz0 = cz + Math.sin(a0) * rTop;
    var tx1 = cx + Math.cos(a1) * rTop, tz1 = cz + Math.sin(a1) * rTop;
    // Normal sisi = arah radial rata-rata segmen (dinormalisasi kasar).
    var nm = Math.cos((a0 + a1) / 2), nn = Math.sin((a0 + a1) / 2);
    var len = Math.sqrt(nm * nm + nn * nn) || 1;
    var n = [nm / len, 0, nn / len];
    // Sisi: CCW dilihat dari luar (urutan bawah-luar -> atas).
    this.quad([bx0, y0, bz0], [bx1, y0, bz1], [tx1, y1, tz1], [tx0, y1, tz0],
      n, side);
    // Tutup atas (kipas, normal +y).
    this.tri([cx, y1, cz], [tx0, y1, tz0], [tx1, y1, tz1], [0, 1, 0], topCol);
    // Tutup bawah (kipas, normal -y, urutan dibalik).
    this.tri([cx, y0, cz], [bx1, y0, bz1], [bx0, y0, bz0], [0, -1, 0], botCol);
  }
};

// Tambah prisma segitiga memanjang (dipakai lambung perahu): penampang segitiga
// di bidang XY (alas lebar, puncak di tengah bawah) diekstrusi sepanjang Z.
MeshBuilder.prototype.wedge = function(cx, cy, cz, w, h, d, col) {
  var x0 = cx - w / 2, x1 = cx + w / 2;
  var y0 = cy, y1 = cy + h;
  var z0 = cz - d / 2, z1 = cz + d / 2;
  var side = col, top = shade(col, 1.15);
  // Dek atas (datar).
  this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
    [0, 1, 0], top);
  // Sisi miring kiri bawah: dari tepi dek ke garis lunas tengah bawah.
  this.quad([x0, y1, z0], [x0, y1, z1], [cx, y0, z1], [cx, y0, z0],
    [-0.7, -0.7, 0], shade(col, 0.85));
  // Sisi miring kanan bawah.
  this.quad([x1, y1, z1], [x1, y1, z0], [cx, y0, z0], [cx, y0, z1],
    [0.7, -0.7, 0], shade(col, 0.85));
  // Ujung haluan (+z): segitiga tegak.
  this.tri([x0, y1, z1], [x1, y1, z1], [cx, y0, z1], [0, 0, 1], side);
  // Ujung buritan (-z): segitiga tegak.
  this.tri([x1, y1, z0], [x0, y1, z0], [cx, y0, z0], [0, 0, -1], side);
};

// Finalisasi: kembalikan objek mesh polos { vertices, normals, indices, colors }.
MeshBuilder.prototype.finish = function() {
  return {
    vertices: this.vertices,
    normals: this.normals,
    indices: this.indices,
    colors: this.colors
  };
};

// box(w, h, d) — kotak satuan prosedural, alas di y = 0.

function box(w, h, d) {
  var m = new MeshBuilder();
  var grey = [0.82, 0.82, 0.84];
  m.box(0, 0, 0, w, h, d, grey);
  return m.finish();
}

// car(color) — mobil sedan low-poly: bodi, kabin + kaca, 4 roda, lampu.
// Panjang ~4.2 (sumbu Z = arah maju), lebar ~1.9, tinggi total ~1.45.
// color: string hex '#rrggbb' atau array [r,g,b].

function car(color) {
  var m = new MeshBuilder();
  var body = (typeof color === 'string') ? hexToRgb(color) : color;
  if (!body || body.length !== 3) { body = [0.85, 0.2, 0.25]; }
  var glass = [0.12, 0.16, 0.22];
  var tyre = [0.08, 0.08, 0.09];
  var hub = [0.75, 0.75, 0.78];
  var chrome = [0.9, 0.92, 0.95];
  var lightF = [1.0, 0.95, 0.6];   // lampu depan hangat
  var lightR = [0.9, 0.1, 0.12];   // lampu belakang merah

  // Bodi utama (chassis): rendah, memanjang.
  m.box(0, 0.35, 0, 1.9, 0.55, 4.2, body);
  // Kap mesin depan (sedikit lebih rendah, menonjol ke +z).
  m.box(0, 0.55, 1.35, 1.7, 0.3, 1.1, shade(body, 1.05));
  // Bagasi belakang.
  m.box(0, 0.55, -1.45, 1.7, 0.3, 0.9, shade(body, 1.05));
  // Kabin + kaca (kotak lebih sempit di tengah, atap lebih gelap).
  m.box(0, 0.9, -0.2, 1.6, 0.55, 2.0, glass);
  // Atap tipis sewarna bodi di atas kabin.
  m.box(0, 1.42, -0.2, 1.65, 0.06, 1.9, shade(body, 1.1));
  // Pilar kaca depan / belakang (strip tipis sewarna bodi).
  m.box(0, 0.9, 0.82, 1.62, 0.55, 0.08, body);
  m.box(0, 0.9, -1.22, 1.62, 0.55, 0.08, body);
  // Bumper depan + belakang (chrome).
  m.box(0, 0.32, 2.12, 1.92, 0.16, 0.12, chrome);
  m.box(0, 0.32, -2.12, 1.92, 0.16, 0.12, chrome);
  // Gril depan.
  m.box(0, 0.62, 2.11, 1.1, 0.18, 0.06, [0.15, 0.15, 0.16]);
  // Lampu depan (dua kotak kecil menyala) + lampu belakang.
  m.box(-0.6, 0.72, 2.11, 0.42, 0.14, 0.06, lightF);
  m.box(0.6, 0.72, 2.11, 0.42, 0.14, 0.06, lightF);
  m.box(-0.6, 0.72, -2.11, 0.42, 0.14, 0.06, lightR);
  m.box(0.6, 0.72, -2.11, 0.42, 0.14, 0.06, lightR);
  // Spion kiri / kanan.
  m.box(-1.0, 1.05, 0.55, 0.12, 0.1, 0.22, body);
  m.box(1.0, 1.05, 0.55, 0.12, 0.1, 0.22, body);
  // Knalpot.
  m.cylinder(0.55, 0.3, -2.14, 0.06, 0.06, 0.12, 8, [0.3, 0.3, 0.32]);

  // Roda: silinder diputar 90 derajat (sumbu X) — dibuat manual dari cylinder
  // dengan menukar sumbu: kami memakai cylinder tegak lalu posisi y rendah,
  // tapi agar tapak terlihat benar, roda dibuat dari box pipih + hub.
  // (Silinder tegak tetap dipakai untuk pelek: diputar via posisi.)
  var wheelPos = [
    [-0.95, 0.35, 1.35], [0.95, 0.35, 1.35],
    [-0.95, 0.35, -1.35], [0.95, 0.35, -1.35]
  ];
  var i, wp;
  for (i = 0; i < wheelPos.length; i++) {
    wp = wheelPos[i];
    // Ban: kotak pipih (lebar x 0.28, tinggi 0.7, dalam 0.7).
    m.box(wp[0], wp[1] - 0.35, wp[2], 0.28, 0.7, 0.7, tyre);
    // Pelek: silinder kecil menempel di sisi luar roda.
    var px = wp[0] + (wp[0] < 0 ? -0.15 : 0.15);
    m.box(px, wp[1] - 0.12, wp[2], 0.04, 0.46, 0.46, hub);
  }
  return m.finish();
}

// palm() — pohon palem: batang melengkung (3 segmen silinder miring via
// offset x bertahap), 7 pelepah (kotak tipis miring), 3 kelapa.
// Tinggi total ~6. Daun hijau, batang cokelat.

function palm() {
  var m = new MeshBuilder();
  var trunk = [0.45, 0.32, 0.2];
  var trunkDark = [0.36, 0.25, 0.16];
  var leaf = [0.16, 0.55, 0.2];
  var leafDark = [0.1, 0.42, 0.16];
  var nut = [0.55, 0.38, 0.2];

  // Batang: 3 segmen, makin ke atas makin miring ke +x (lengkung alami).
  m.cylinder(0.0, 0.0, 0.0, 0.22, 0.3, 2.0, 8, trunkDark);
  m.cylinder(0.18, 1.9, 0.0, 0.18, 0.22, 2.0, 8, trunk);
  m.cylinder(0.42, 3.8, 0.0, 0.14, 0.18, 1.6, 8, trunkDark);
  // Cincin batang (tekstur kasar): 4 torus kasar = kotak pipih melingkar.
  var ry, ringY = [0.6, 1.5, 2.5, 3.4, 4.3, 5.0];
  for (var r = 0; r < ringY.length; r++) {
    ry = ringY[r];
    m.box(0.1 + ry * 0.07, ry, 0, 0.5, 0.09, 0.5, trunkDark);
  }

  // Pelepah: 7 helai, menyebar radial dari puncak (0.55, 5.4, 0).
  // Tiap helai = 2 kotak tipis: pangkal naik, ujung menjuntai ke bawah.
  var topX = 0.55, topY = 5.4;
  var fronds = 7;
  for (var f = 0; f < fronds; f++) {
    var a = (f / fronds) * Math.PI * 2 + 0.35;
    var dx = Math.cos(a), dz = Math.sin(a);
    var col = (f % 2 === 0) ? leaf : leafDark;
    // Pangkal pelepah: dari puncak miring naik ke luar.
    m.box(topX + dx * 0.9, topY + 0.35, dz * 0.9, 0.5, 0.08, 1.9, col);
    // Ujung pelepah: menjuntai ke bawah (kotak lebih panjang, ujung rendah).
    // Disusun sebagai kotak yang digeser: tengah di radius 2.1, y lebih rendah.
    m.box(topX + dx * 2.1, topY - 0.35, dz * 2.1, 0.42, 0.07, 1.7, col);
    // Tulang tengah pelepah (garis lebih gelap di tengah helai).
    m.box(topX + dx * 1.5, topY + 0.02, dz * 1.5, 0.1, 0.06, 3.4, leafDark);
  }

  // Kelapa: 3 bola kasar (kotak kecil) menggantung di bawah tajuk.
  m.box(topX + 0.25, topY - 0.25, 0.2, 0.28, 0.28, 0.28, nut);
  m.box(topX - 0.28, topY - 0.3, -0.15, 0.26, 0.26, 0.26, nut);
  m.box(topX + 0.05, topY - 0.32, -0.35, 0.26, 0.26, 0.26, nut);
  return m.finish();
}

// building(w, h, d, style) — gedung kotak dengan jendela + atap.
// style: 'glass' | 'brick' | 'concrete' | 'neon' | 'hotel' | 'shack'.
// Jendela = quad kecil sedikit di luar dinding (offset 0.02) agar tidak
// z-fighting. Gedung tinggi mendapat antena / AC di atap.

function building(w, h, d, style) {
  var m = new MeshBuilder();
  style = style || 'concrete';
  var wall, win, roof, trim;
  if (style === 'glass') {
    wall = [0.2, 0.32, 0.45]; win = [0.65, 0.85, 1.0]; roof = [0.12, 0.16, 0.22];
    trim = [0.8, 0.85, 0.9];
  } else if (style === 'brick') {
    wall = [0.62, 0.32, 0.24]; win = [1.0, 0.85, 0.45]; roof = [0.3, 0.22, 0.18];
    trim = [0.85, 0.8, 0.7];
  } else if (style === 'neon') {
    wall = [0.16, 0.14, 0.24]; win = [1.0, 0.35, 0.75]; roof = [0.1, 0.1, 0.16];
    trim = [1.0, 0.3, 0.8];
  } else if (style === 'hotel') {
    wall = [0.92, 0.85, 0.7]; win = [0.35, 0.55, 0.75]; roof = [0.75, 0.35, 0.2];
    trim = [1.0, 0.6, 0.25];
  } else if (style === 'shack') {
    wall = [0.55, 0.45, 0.32]; win = [0.9, 0.75, 0.4]; roof = [0.5, 0.25, 0.15];
    trim = [0.4, 0.3, 0.2];
  } else { // concrete
    wall = [0.68, 0.67, 0.62]; win = [0.45, 0.6, 0.75]; roof = [0.4, 0.4, 0.42];
    trim = [0.85, 0.85, 0.8];
  }

  // Badan gedung.
  m.box(0, 0, 0, w, h, d, wall);
  // Atap: pelat tipis + lis trim di tepi atas.
  m.box(0, h, 0, w + 0.3, 0.25, d + 0.3, roof);
  m.box(0, h + 0.25, 0, w + 0.34, 0.08, d + 0.34, trim);
  // Alas / podium lantai dasar (sedikit lebih lebar).
  m.box(0, 0, 0, w + 0.4, 0.6, d + 0.4, shade(wall, 0.8));

  // Jendela: grid di keempat sisi. Jarak antar jendela 1.6 (x) / 2.2 (y).
  var cols = Math.max(1, Math.floor((w - 1.2) / 1.6));
  var rows = Math.max(1, Math.floor((h - 2.0) / 2.2));
  var colsD = Math.max(1, Math.floor((d - 1.2) / 1.6));
  var ww = 0.9, wh = 1.2;
  var off = 0.03; // offset keluar dinding
  var i, j;
  var lit = [1.0, 0.8, 0.4]; // jendela menyala (golden hour / malam)
  for (i = 0; i < cols; i++) {
    for (j = 0; j < rows; j++) {
      var wx = -((cols - 1) * 1.6) / 2 + i * 1.6;
      var wy = 1.6 + j * 2.2;
      var wc = ((i * 7 + j * 3) % 5 === 0) ? lit : win; // ~20% menyala
      // Depan (+z).
      m.quad([wx - ww / 2, wy - wh / 2, d / 2 + off],
        [wx + ww / 2, wy - wh / 2, d / 2 + off],
        [wx + ww / 2, wy + wh / 2, d / 2 + off],
        [wx - ww / 2, wy + wh / 2, d / 2 + off], [0, 0, 1], wc);
      // Belakang (-z).
      m.quad([wx + ww / 2, wy - wh / 2, -d / 2 - off],
        [wx - ww / 2, wy - wh / 2, -d / 2 - off],
        [wx - ww / 2, wy + wh / 2, -d / 2 - off],
        [wx + ww / 2, wy + wh / 2, -d / 2 - off], [0, 0, -1], wc);
    }
  }
  for (i = 0; i < colsD; i++) {
    for (j = 0; j < rows; j++) {
      var wz = -((colsD - 1) * 1.6) / 2 + i * 1.6;
      var wy2 = 1.6 + j * 2.2;
      var wc2 = ((i * 5 + j * 7) % 5 === 0) ? lit : win;
      // Kanan (+x).
      m.quad([w / 2 + off, wy2 - wh / 2, wz - ww / 2],
        [w / 2 + off, wy2 - wh / 2, wz + ww / 2],
        [w / 2 + off, wy2 + wh / 2, wz + ww / 2],
        [w / 2 + off, wy2 + wh / 2, wz - ww / 2], [1, 0, 0], wc2);
      // Kiri (-x).
      m.quad([-w / 2 - off, wy2 - wh / 2, wz + ww / 2],
        [-w / 2 - off, wy2 - wh / 2, wz - ww / 2],
        [-w / 2 - off, wy2 + wh / 2, wz - ww / 2],
        [-w / 2 - off, wy2 + wh / 2, wz + ww / 2], [-1, 0, 0], wc2);
    }
  }

  // Pintu masuk (depan, lantai dasar).
  m.quad([-0.7, 0.6, d / 2 + off], [0.7, 0.6, d / 2 + off],
    [0.7, 2.6, d / 2 + off], [-0.7, 2.6, d / 2 + off],
    [0, 0, 1], [0.12, 0.1, 0.12]);
  // Kanopi pintu.
  m.box(0, 2.7, d / 2 + 0.5, 2.2, 0.12, 1.1, trim);

  // Detail atap untuk gedung tinggi: unit AC + antena.
  if (h >= 12) {
    m.box(-w / 4, h + 0.33, -d / 4, 1.6, 0.9, 1.2, [0.55, 0.55, 0.58]);
    m.box(w / 4, h + 0.33, d / 4, 1.2, 0.7, 1.0, [0.55, 0.55, 0.58]);
    m.cylinder(w / 3, h + 0.33, -d / 3, 0.06, 0.06, 3.2, 6, [0.8, 0.2, 0.2]);
    // Lampu antena merah (bola kecil).
    m.box(w / 3, h + 3.5, -d / 3, 0.22, 0.22, 0.22, [1.0, 0.1, 0.1]);
  }
  // Papan neon untuk style neon: strip menyala di fasad depan.
  if (style === 'neon') {
    m.box(0, h * 0.75, d / 2 + 0.08, w * 0.8, 0.5, 0.1, [1.0, 0.25, 0.7]);
    m.box(0, h * 0.45, d / 2 + 0.08, w * 0.6, 0.35, 0.1, [0.2, 0.9, 1.0]);
  }
  return m.finish();
}

// boat() — speedboat: lambung wedge, dek, kabin kecil, tiang + kursi.
// Panjang ~5 (sumbu Z = arah maju), lebar ~2.

function boat() {
  var m = new MeshBuilder();
  var hull = [0.9, 0.92, 0.95];      // lambung putih
  var hullStripe = [0.1, 0.45, 0.8]; // garis biru
  var deck = [0.75, 0.7, 0.6];       // dek kayu muda
  var cabin = [0.15, 0.2, 0.28];     // kabin kaca gelap
  var seat = [0.85, 0.3, 0.2];       // jok merah
  var metal = [0.7, 0.72, 0.75];

  // Lambung (wedge: dek datar, lunas runcing ke bawah).
  m.wedge(0, 0.15, 0, 2.0, 0.85, 5.0, hull);
  // Garis biru di sisi lambung (strip tipis di kedua sisi).
  m.box(-1.0, 0.55, 0, 0.06, 0.18, 4.6, hullStripe);
  m.box(1.0, 0.55, 0, 0.06, 0.18, 4.6, hullStripe);
  // Dek kayu.
  m.box(0, 0.95, 0, 1.8, 0.12, 4.7, deck);
  // Kabin depan (kaca gelap miring = kotak pendek).
  m.box(0, 1.05, 1.15, 1.5, 0.6, 1.3, cabin);
  // Atap kabin putih tipis.
  m.box(0, 1.65, 1.15, 1.6, 0.08, 1.4, hull);
  // Jok pengemudi + penumpang (dua kotak merah).
  m.box(-0.45, 1.05, -0.35, 0.7, 0.55, 0.6, seat);
  m.box(0.45, 1.05, -0.35, 0.7, 0.55, 0.6, seat);
  // Sandaran jok.
  m.box(-0.45, 1.35, -0.7, 0.7, 0.6, 0.15, seat);
  m.box(0.45, 1.35, -0.7, 0.7, 0.6, 0.15, seat);
  // Kemudi (roda kecil miring di depan jok kiri).
  m.cylinder(-0.45, 1.5, 0.15, 0.22, 0.22, 0.06, 10, [0.15, 0.15, 0.16]);
  // Tiang bendera di buritan + bendera merah kecil.
  m.cylinder(0, 1.0, -2.2, 0.04, 0.04, 1.6, 6, metal);
  m.box(0.25, 2.3, -2.2, 0.5, 0.3, 0.04, [0.95, 0.2, 0.2]);
  // Mesin tempel (kotak hitam di buritan).
  m.box(0, 0.7, -2.55, 0.5, 0.7, 0.3, [0.12, 0.12, 0.13]);
  // Lampu navigasi: hijau kanan, merah kiri.
  m.box(0.95, 1.0, 1.9, 0.1, 0.1, 0.1, [0.1, 1.0, 0.2]);
  m.box(-0.95, 1.0, 1.9, 0.1, 0.1, 0.1, [1.0, 0.1, 0.1]);
  return m.finish();
}

// person(color) — manusia low-poly: kepala, torso, 2 kaki, 2 lengan.
// Tinggi total ~1.8. color = warna baju (string hex / array).

function person(color) {
  var m = new MeshBuilder();
  var shirt = (typeof color === 'string') ? hexToRgb(color) : color;
  if (!shirt || shirt.length !== 3) { shirt = [0.2, 0.5, 0.9]; }
  var skin = [0.85, 0.65, 0.5];
  var hair = [0.15, 0.1, 0.08];
  var pants = [0.15, 0.2, 0.35];
  var shoe = [0.1, 0.1, 0.1];

  // Kaki kiri / kanan (celana).
  m.box(-0.14, 0.0, 0, 0.22, 0.8, 0.26, pants);
  m.box(0.14, 0.0, 0, 0.22, 0.8, 0.26, pants);
  // Sepatu (menonjol ke depan +z).
  m.box(-0.14, 0.0, 0.06, 0.24, 0.12, 0.38, shoe);
  m.box(0.14, 0.0, 0.06, 0.24, 0.12, 0.38, shoe);
  // Torso (baju).
  m.box(0, 0.8, 0, 0.62, 0.62, 0.32, shirt);
  // Kerah baju (strip tipis).
  m.box(0, 1.38, 0, 0.5, 0.08, 0.34, shade(shirt, 1.2));
  // Lengan kiri / kanan (baju, menggantung di sisi torso).
  m.box(-0.4, 0.82, 0, 0.18, 0.58, 0.2, shade(shirt, 0.9));
  m.box(0.4, 0.82, 0, 0.18, 0.58, 0.2, shade(shirt, 0.9));
  // Tangan (kulit).
  m.box(-0.4, 0.5, 0, 0.16, 0.14, 0.18, skin);
  m.box(0.4, 0.5, 0, 0.16, 0.14, 0.18, skin);
  // Leher + kepala.
  m.box(0, 1.42, 0, 0.16, 0.12, 0.16, skin);
  m.box(0, 1.54, 0, 0.34, 0.34, 0.32, skin);
  // Rambut (kotak menutupi atas + belakang kepala).
  m.box(0, 1.82, -0.02, 0.36, 0.12, 0.34, hair);
  m.box(0, 1.68, -0.14, 0.36, 0.2, 0.06, hair);
  // Mata (dua titik gelap di wajah +z).
  m.box(-0.08, 1.68, 0.17, 0.05, 0.05, 0.02, [0.05, 0.05, 0.05]);
  m.box(0.08, 1.68, 0.17, 0.05, 0.05, 0.02, [0.05, 0.05, 0.05]);
  return m.finish();
}

// plane(w, d) — bidang tanah datar (satu quad besar, normal +y) dengan
// subdivisi grid 8x8 agar bisa diwarnai per-sel (mis. pola jalan / rumput).
// Warna dasar abu-abu muda; selang-seling sedikit lebih gelap.

function plane(w, d) {
  var m = new MeshBuilder();
  var segX = 8, segZ = 8;
  var cw = w / segX, cd = d / segZ;
  var base = [0.55, 0.58, 0.55];
  var alt = [0.5, 0.53, 0.5];
  for (var ix = 0; ix < segX; ix++) {
    for (var iz = 0; iz < segZ; iz++) {
      var x0 = -w / 2 + ix * cw, x1 = x0 + cw;
      var z0 = -d / 2 + iz * cd, z1 = z0 + cd;
      var col = ((ix + iz) % 2 === 0) ? base : alt;
      m.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0],
        [0, 1, 0], col);
    }
  }
  return m.finish();
}

// Export namespace.

window.SB.Meshes = {
  box: box,
  car: car,
  palm: palm,
  building: building,
  boat: boat,
  person: person,
  plane: plane
};

})();

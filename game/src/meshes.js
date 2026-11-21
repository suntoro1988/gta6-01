// Sunset Bay v9 — meshes.js
// Pembangun mesh segitiga warna-flat: tiap fungsi mengembalikan
// {pos: Float32Array, col: Float32Array} yang siap diproses SB.GL.mesh.
// Geometri, urutan vertex (winding — penting karena backface culling aktif),
// dan urutan pemakaian RNG dipertahankan sama seperti v8.
(function () {
  'use strict';
  window.SB = window.SB || {};

  // Kalikan tiap kanal warna dengan faktor, dijepit ke [0, 1].
  function shade(rgb, k) {
    return [
      Math.min(1, rgb[0] * k),
      Math.min(1, rgb[1] * k),
      Math.min(1, rgb[2] * k)
    ];
  }

  // Acak warna sedikit (variasi antar bangunan) memakai RNG deterministik.
  function jitter(rgb, amt, rng) {
    var f = 1 + (rng ? (rng.next() * 2 - 1) * amt : 0);
    return [Math.min(1, rgb[0] * f), Math.min(1, rgb[1] * f), Math.min(1, rgb[2] * f)];
  }

  // Akumulator segitiga: kumpulkan posisi + warna per vertex, lalu bekukan.
  function collector() {
    var pos = [];
    var col = [];
    function tri(a, b, c, rgb) {
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (var i = 0; i < 3; i++) col.push(rgb[0], rgb[1], rgb[2]);
    }
    // Quad = dua segitiga (a,b,c) + (a,c,d).
    function quad(a, b, c, d, rgb) {
      tri(a, b, c, rgb);
      tri(a, c, d, rgb);
    }
    // Kotak berpusat di (cx, cy, cz), ukuran (w, h, d). Warna tiap sisi
    // diturunkan dari warna dasar (atas lebih terang, bawah lebih gelap);
    // faceCol boleh menimpa warna sisi tertentu.
    function boxAt(cx, cy, cz, w, h, d, rgb, faceCol) {
      var x0 = cx - w / 2, x1 = cx + w / 2;
      var y0 = cy - h / 2, y1 = cy + h / 2;
      var z0 = cz - d / 2, z1 = cz + d / 2;
      var f = faceCol || {};
      var top = f.top || shade(rgb, 1.15);
      var bot = f.bottom || shade(rgb, 0.6);
      var n = f.north || shade(rgb, 0.85);
      var s = f.south || shade(rgb, 0.95);
      var e = f.east || shade(rgb, 0.8);
      var wc = f.west || shade(rgb, 0.9);
      // WINDING: sisi atas normal +y, sisi bawah normal -y (backface
      // culling aktif). Urutan lama tertukar — atap ter-cull dari atas
      // dan alas terlihat dari atas — cacat nyata temuan QA v9.
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);    // atas
      quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], bot);    // bawah
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], n);      // utara (z+)
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], s);      // selatan (z-)
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], e);      // timur (x+)
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], wc);     // barat (x-)
    }
    return {
      tri: tri,
      quad: quad,
      boxAt: boxAt,
      done: function () {
        return { pos: new Float32Array(pos), col: new Float32Array(col) };
      }
    };
  }

  // Kotak polos berpusat di origin, alas di y = 0.
  function makeBox(w, h, d) {
    var c = collector();
    c.boxAt(0, h / 2, 0, w, h, d, [0.75, 0.75, 0.78]);
    return c.done();
  }

  // Bangunan: badan + atap tipis + strip jendela di sisi depan (z+).
  // Seed menentukan palet & pola jendela; bangunan yang sama selalu sama.
  function makeBuilding(w, h, d, seed) {
    var rng = window.SB.RNG;
    rng.seed((seed || 1) * 2654435761 >>> 0);
    var palette = [
      [0.62, 0.58, 0.52], [0.55, 0.60, 0.66], [0.68, 0.55, 0.45],
      [0.48, 0.55, 0.60], [0.70, 0.65, 0.55], [0.60, 0.52, 0.58],
      [0.52, 0.58, 0.50], [0.66, 0.62, 0.60]
    ];
    var base = jitter(palette[Math.floor(rng.next() * palette.length)], 0.12, rng);
    var c = collector();
    c.boxAt(0, h / 2, 0, w, h, d, base, { top: shade(base, 0.55) });
    c.boxAt(0, h + 0.15, 0, w * 0.92, 0.3, d * 0.92, shade(base, 0.45)); // atap
    var dark = [0.12, 0.16, 0.22];
    var lit = [0.95, 0.8, 0.4];
    var floors = Math.max(1, Math.floor(h / 4));
    var cols = Math.max(1, Math.floor(w / 2.5));
    var i, j;
    for (i = 0; i < floors; i++) {
      for (j = 0; j < cols; j++) {
        if (rng.next() < 0.35) continue; // sebagian jendela dibiarkan gelap
        var wx = -w / 2 + (j + 0.5) * (w / cols);
        var wy = 1.2 + i * 4;
        if (wy + 1.2 > h - 0.6) continue;
        var ww = Math.min(1.4, w / cols * 0.6);
        var z = d / 2 + 0.02;
        c.quad(
          [wx - ww / 2, wy, z], [wx + ww / 2, wy, z],
          [wx + ww / 2, wy + 1.2, z], [wx - ww / 2, wy + 1.2, z],
          rng.next() < 0.25 ? lit : dark
        );
      }
    }
    return c.done();
  }

  // Mobil: badan + kabin + kaca depan + 4 roda + lampu depan (z+ = depan).
  function makeCar(rgb) {
    var paint = rgb || [0.8, 0.2, 0.2];
    var c = collector();
    c.boxAt(0, 0.65, 0, 1.9, 0.6, 4.2, paint); // badan, alas y = 0.35
    c.boxAt(0, 1.2, -0.2, 1.7, 0.55, 2.2, shade(paint, 0.85), { top: [0.15, 0.18, 0.25] }); // kabin
    c.quad([-0.8, 0.95, 0.95], [0.8, 0.95, 0.95], [0.8, 1.45, 0.95], [-0.8, 1.45, 0.95], [0.1, 0.12, 0.18]); // kaca
    var dark = [0.08, 0.08, 0.09];
    var xs = [-0.85, 0.85], zs = [-1.35, 1.35];
    var i, j;
    for (i = 0; i < 2; i++) {
      for (j = 0; j < 2; j++) {
        c.boxAt(xs[i], 0.35, zs[j], 0.3, 0.7, 0.7, dark); // roda
      }
    }
    c.quad([-0.7, 0.7, 2.11], [0.7, 0.7, 2.11], [0.7, 0.9, 2.11], [-0.7, 0.9, 2.11], [1.0, 0.95, 0.7]); // lampu
    return c.done();
  }

  // Orang: dua kaki, badan, kepala. Tinggi total ~1.9.
  function makePerson() {
    var c = collector();
    var skin = [0.85, 0.65, 0.5];
    var shirt = [0.25, 0.45, 0.75];
    var pants = [0.2, 0.22, 0.3];
    c.boxAt(-0.12, 0.4, 0, 0.2, 0.8, 0.2, pants); // kaki kiri
    c.boxAt(0.12, 0.4, 0, 0.2, 0.8, 0.2, pants);  // kaki kanan
    c.boxAt(0, 1.15, 0, 0.55, 0.7, 0.3, shirt);    // badan
    c.boxAt(0, 1.72, 0, 0.34, 0.34, 0.34, skin);   // kepala
    return c.done();
  }

  // Speedboat: lambung putih + konsol biru + jok merah + garis merah lambung.
  function makeBoat() {
    var c = collector();
    var hull = [0.9, 0.9, 0.92];
    c.boxAt(0, 0.5, 0, 2.2, 0.7, 5.5, hull, { top: shade(hull, 0.9) });
    c.boxAt(0, 1.0, -0.6, 1.8, 0.5, 2.0, [0.2, 0.35, 0.6], { top: [0.1, 0.14, 0.2] }); // konsol
    c.boxAt(0, 0.95, 1.2, 1.6, 0.35, 1.2, [0.75, 0.3, 0.25]); // jok
    var stripe = [0.85, 0.2, 0.15];
    c.quad([-1.11, 0.55, -2.7], [-1.11, 0.55, 2.7], [-1.11, 0.75, 2.7], [-1.11, 0.75, -2.7], stripe);
    c.quad([1.11, 0.55, 2.7], [1.11, 0.55, -2.7], [1.11, 0.75, -2.7], [1.11, 0.75, 2.7], stripe);
    return c.done();
  }

  // Pohon: batang + dua tingkat dedaunan kotak.
  function makeTree() {
    var c = collector();
    c.boxAt(0, 1.0, 0, 0.35, 2.0, 0.35, [0.45, 0.3, 0.18]); // batang
    c.boxAt(0, 2.6, 0, 1.9, 1.4, 1.9, [0.2, 0.55, 0.25]);   // daun bawah
    c.boxAt(0, 3.6, 0, 1.3, 1.0, 1.3, [0.25, 0.62, 0.3]);   // daun atas
    return c.done();
  }

  window.SB.Meshes = {
    box: makeBox,
    building: makeBuilding,
    car: makeCar,
    person: makePerson,
    boat: makeBoat,
    tree: makeTree
  };
})();

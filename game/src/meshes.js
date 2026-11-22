window.SB = window.SB || {};
(function(){
'use strict';

/* =========================================================================
   SB.Meshes — Sunset Bay v12 (Builder C, dunia)
   Geometri prosedural murni, TANPA library. Semua mesh dibangun manual
   dari quad/triangle dengan winding CCW dan normal menghadap keluar.
   Setiap fungsi return { vertices, normals, indices }.
   vertices: flat [x,y,z,...] ; normals: flat [nx,ny,nz,...] per vertex ;
   indices: flat [i0,i1,i2,...] segitiga, CCW dilihat dari luar.
   Verifikasi numerik: Builder.quad() menghitung cross(b-a, c-a) dan
   membalik urutan vertex bila dot dengan normal luar < 0, sehingga
   winding selalu CCW terhadap normal yang dinyatakan.
   Konvensi: sumbu Y ke atas, box() berpusat di origin, building()
   beralas di y=0 (lantai), car()/boat() beralas di y=0.
   ========================================================================= */

function Builder(){
  this.vertices = [];
  this.normals = [];
  this.indices = [];
}

Builder.prototype.base = function(){ return this.vertices.length / 3; };

/* Quad a,b,c,d dengan normal luar n. Urutan diperbaiki otomatis bila
   cross product menunjuk ke dalam (dot < 0). */
Builder.prototype.quad = function(a, b, c, d, n){
  var ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  var ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  var cr = [
    ab[1]*ac[2] - ab[2]*ac[1],
    ab[2]*ac[0] - ab[0]*ac[2],
    ab[0]*ac[1] - ab[1]*ac[0]
  ];
  var dot = cr[0]*n[0] + cr[1]*n[1] + cr[2]*n[2];
  var p = [a, b, c, d];
  if (dot < 0) { p = [a, d, c, b]; }
  var base = this.base();
  for (var i = 0; i < 4; i++){
    this.vertices.push(p[i][0], p[i][1], p[i][2]);
    this.normals.push(n[0], n[1], n[2]);
  }
  this.indices.push(base, base+1, base+2, base, base+2, base+3);
};

/* Segitiga a,b,c dengan normal luar n (diperbaiki otomatis juga). */
Builder.prototype.tri = function(a, b, c, n){
  var ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  var ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  var cr = [
    ab[1]*ac[2] - ab[2]*ac[1],
    ab[2]*ac[0] - ab[0]*ac[2],
    ab[0]*ac[1] - ab[1]*ac[0]
  ];
  var dot = cr[0]*n[0] + cr[1]*n[1] + cr[2]*n[2];
  var p = [a, b, c];
  if (dot < 0) { p = [a, c, b]; }
  var base = this.base();
  for (var i = 0; i < 3; i++){
    this.vertices.push(p[i][0], p[i][1], p[i][2]);
    this.normals.push(n[0], n[1], n[2]);
  }
  this.indices.push(base, base+1, base+2);
};

/* Box berpusat di (cx,cy,cz), ukuran w x h x d. 6 sisi, 24 vertex. */
Builder.prototype.box = function(cx, cy, cz, w, h, d){
  var hx = w/2, hy = h/2, hz = d/2;
  var x0 = cx-hx, x1 = cx+hx, y0 = cy-hy, y1 = cy+hy, z0 = cz-hz, z1 = cz+hz;
  // +X
  this.quad([x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0],[1,0,0]);
  // -X
  this.quad([x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[-1,0,0]);
  // +Y (atas)
  this.quad([x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1],[0,1,0]);
  // -Y (bawah)
  this.quad([x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0],[0,-1,0]);
  // +Z
  this.quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]);
  // -Z
  this.quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]);
  return this;
};

/* Box berpusat di origin lalu dirotasi: pitch (X) dulu, lalu yaw (Y),
   lalu ditranslasikan ke (cx,cy,cz). Dipakai untuk daun palma, atap,
   spoiler, dan bagian miring lain. */
Builder.prototype.boxRot = function(cx, cy, cz, w, h, d, yaw, pitch){
  var tmp = new Builder();
  tmp.box(0, 0, 0, w, h, d);
  var cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
  var cp = Math.cos(pitch), sp = Math.sin(pitch);
  for (var i = 0; i < tmp.vertices.length; i += 3){
    var x = tmp.vertices[i], y = tmp.vertices[i+1], z = tmp.vertices[i+2];
    // pitch terhadap sumbu X
    var y1 = y*cp - z*sp, z1 = y*sp + z*cp;
    // yaw terhadap sumbu Y
    var x2 = x*cyaw + z1*syaw, z2 = -x*syaw + z1*cyaw;
    tmp.vertices[i] = x2 + cx; tmp.vertices[i+1] = y1 + cy; tmp.vertices[i+2] = z2 + cz;
    var nx = tmp.normals[i], ny = tmp.normals[i+1], nz = tmp.normals[i+2];
    var ny1 = ny*cp - nz*sp, nz1 = ny*sp + nz*cp;
    var nx2 = nx*cyaw + nz1*syaw, nz2 = -nx*syaw + nz1*cyaw;
    tmp.normals[i] = nx2; tmp.normals[i+1] = ny1; tmp.normals[i+2] = nz2;
  }
  this.merge(tmp);
  return this;
};

/* Gabungkan builder lain ke builder ini (offset index otomatis). */
Builder.prototype.merge = function(other){
  var base = this.base();
  for (var i = 0; i < other.vertices.length; i++) this.vertices.push(other.vertices[i]);
  for (var j = 0; j < other.normals.length; j++) this.normals.push(other.normals[j]);
  for (var k = 0; k < other.indices.length; k++) this.indices.push(other.indices[k] + base);
  return this;
};

/* Prisma segitiga (atap rumah / haluan perahu): penampang segitiga
   di bidang X-Y dengan alas di y0, puncak di y1, panjang d. */
Builder.prototype.prism = function(cx, y0, y1, cz, w, d){
  var hx = w/2, hz = d/2;
  var x0 = cx-hx, x1 = cx+hx, z0 = cz-hz, z1 = cz+hz;
  var apexL = [cx, y1, z0], apexR = [cx, y1, z1];
  // sisi miring kiri
  this.quad([x0,y0,z1],[x0,y0,z0],apexL,apexR,[-0.7,0.7,0]);
  // sisi miring kanan
  this.quad([x1,y0,z0],[x1,y0,z1],apexR,apexL,[0.7,0.7,0]);
  // alas
  this.quad([x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0],[0,-1,0]);
  // ujung depan (+Z) segitiga
  this.tri([x0,y0,z1],[x1,y0,z1],apexR,[0,0,1]);
  // ujung belakang (-Z) segitiga
  this.tri([x1,y0,z0],[x0,y0,z0],apexL,[0,0,-1]);
  return this;
};

Builder.prototype.finish = function(color){
  var mesh = {
    vertices: this.vertices,
    normals: this.normals,
    indices: this.indices
  };
  if (color) mesh.color = color;
  return mesh;
};

/* ------------------------------------------------------------------ */
/* API PUBLIK                                                          */
/* ------------------------------------------------------------------ */

/* Box sederhana berpusat di origin. */
function box(w, h, d){
  var b = new Builder();
  b.box(0, 0, 0, w, h, d);
  return b.finish();
}

/* Mobil: bodi + kabin + 4 roda + lampu + spoiler.
   Panjang sumbu Z = arah depan mobil. Alas di y=0. */
function car(color){
  var b = new Builder();
  // bodi bawah
  b.box(0, 0.55, 0, 1.9, 0.55, 4.3);
  // kap depan (sedikit lebih rendah)
  b.box(0, 0.72, 1.55, 1.7, 0.25, 1.1);
  // kabin
  b.box(0, 1.15, -0.25, 1.65, 0.6, 2.1);
  // atap kabin
  b.box(0, 1.48, -0.25, 1.5, 0.08, 1.9);
  // bumper depan / belakang
  b.box(0, 0.32, 2.18, 1.9, 0.22, 0.18);
  b.box(0, 0.32, -2.18, 1.9, 0.22, 0.18);
  // roda (kotak gelap, 4 buah)
  var wx = 0.95, wz = 1.35;
  b.box(-wx, 0.32, wz, 0.28, 0.64, 0.64);
  b.box(wx, 0.32, wz, 0.28, 0.64, 0.64);
  b.box(-wx, 0.32, -wz, 0.28, 0.64, 0.64);
  b.box(wx, 0.32, -wz, 0.28, 0.64, 0.64);
  // lampu depan
  b.box(-0.6, 0.62, 2.16, 0.4, 0.16, 0.06);
  b.box(0.6, 0.62, 2.16, 0.4, 0.16, 0.06);
  // lampu belakang
  b.box(-0.6, 0.62, -2.16, 0.4, 0.16, 0.06);
  b.box(0.6, 0.62, -2.16, 0.4, 0.16, 0.06);
  // spoiler di belakang
  b.box(0, 1.02, -1.95, 1.7, 0.07, 0.45);
  b.box(-0.7, 0.9, -1.95, 0.08, 0.22, 0.08);
  b.box(0.7, 0.9, -1.95, 0.08, 0.22, 0.08);
  return b.finish(color);
}

/* Pohon palma: batang melengkung (4 segmen mengecil) + 7 pelepah
   miring ke bawah + 3 kelapa. Tinggi total ~7 unit. */
function palm(){
  var b = new Builder();
  var x = 0, z = 0, y = 0;
  var segH = [2.0, 1.8, 1.6, 1.4];
  var segW = [0.42, 0.36, 0.30, 0.24];
  var lean = [0.0, 0.12, 0.26, 0.42];
  for (var i = 0; i < 4; i++){
    b.box(x + lean[i], y + segH[i]/2, z, segW[i], segH[i], segW[i]);
    y += segH[i];
  }
  var topX = x + lean[3], topY = y, topZ = z;
  // pelepah: 7 helai, yaw merata, pitch menukik ~ -0.55 rad
  for (var f = 0; f < 7; f++){
    var yaw = (f / 7) * Math.PI * 2;
    var dirX = Math.cos(yaw), dirZ = Math.sin(yaw);
    b.boxRot(
      topX + dirX * 1.5, topY + 0.15, topZ + dirZ * 1.5,
      3.2, 0.08, 0.55, -yaw, -0.55
    );
  }
  // kelapa
  b.box(topX + 0.25, topY - 0.15, topZ, 0.3, 0.3, 0.3);
  b.box(topX - 0.25, topY - 0.15, topZ + 0.15, 0.3, 0.3, 0.3);
  b.box(topX, topY - 0.15, topZ - 0.28, 0.3, 0.3, 0.3);
  return b.finish();
}

/* Gedung beralas di y=0. style:
   'tower'      : pencakar langit, setback + antena
   'slab'       : blok apartemen, unit AC di atap
   'house'      : rumah 1-2 lantai, atap prisma
   'neon'       : ruko dengan papan tanda di atas
   'industrial' : gudang + cerobong
   'hotel'      : menara lebar + balkon bertingkat */
function building(w, h, d, style){
  var b = new Builder();
  style = style || 'slab';
  b.box(0, h/2, 0, w, h, d);
  if (style === 'tower'){
    var sw = w * 0.62, sd = d * 0.62;
    b.box(0, h + h*0.09, 0, sw, h*0.18, sd);
    b.box(0, h + h*0.22, 0, sw*0.55, h*0.08, sd*0.55);
    // antena
    b.box(0, h + h*0.34, 0, 0.18, h*0.16, 0.18);
    b.box(0, h + h*0.44, 0, 0.3, 0.06, 0.3);
  } else if (style === 'slab'){
    // unit AC / tandon di atap
    b.box(-w*0.22, h + 0.35, -d*0.15, w*0.3, 0.7, d*0.3);
    b.box(w*0.25, h + 0.28, d*0.2, w*0.22, 0.55, d*0.22);
    // parapet atap
    b.box(0, h + 0.18, d/2 - 0.1, w, 0.36, 0.2);
    b.box(0, h + 0.18, -d/2 + 0.1, w, 0.36, 0.2);
  } else if (style === 'house'){
    // atap prisma membujur sumbu Z
    b.prism(0, h, h + Math.min(2.2, w*0.28), 0, w + 0.6, d + 0.6);
    // cerobong kecil
    b.box(w*0.28, h + 1.1, -d*0.2, 0.5, 1.6, 0.5);
    // teras depan
    b.box(0, 0.18, d/2 + 0.7, w*0.5, 0.36, 1.4);
  } else if (style === 'neon'){
    // papan tanda vertikal di fasad depan
    b.box(0, h*0.72, d/2 + 0.35, w*0.55, h*0.42, 0.5);
    // kanopi toko di lantai dasar
    b.box(0, 1.1, d/2 + 0.8, w*0.9, 0.25, 1.6);
    b.box(-w*0.32, h + 0.3, 0, w*0.2, 0.6, d*0.3);
  } else if (style === 'industrial'){
    // cerobong tinggi
    b.box(w*0.3, h*0.75, -d*0.25, 1.4, h*0.5, 1.4);
    b.box(w*0.3, h + 0.4, -d*0.25, 1.8, 0.8, 1.8);
    // ventilasi atap
    b.box(-w*0.2, h + 0.3, d*0.1, w*0.35, 0.6, d*0.3);
    // dock loading di samping
    b.box(w/2 + 0.9, 0.5, 0, 1.8, 1.0, d*0.5);
  } else if (style === 'hotel'){
    // balkon menjorok tiap 2 lantai
    var floors = Math.max(2, Math.floor(h / 6));
    for (var i = 0; i < floors; i++){
      var by = 3 + i * 6;
      if (by < h - 1) b.box(0, by, d/2 + 0.45, w*0.92, 0.3, 0.9);
    }
    b.box(0, h + 0.4, 0, w*0.4, 0.8, d*0.4);
  }
  return b.finish();
}

/* Perahu: lambung + haluan miring + dek + kabin + tiang layar.
   Panjang sumbu Z, alas di y=0 (garis air). */
function boat(){
  var b = new Builder();
  // lambung utama
  b.box(0, 0.55, 0, 2.6, 1.1, 6.4);
  // haluan meruncing (baji miring di depan)
  b.boxRot(0, 0.75, 3.9, 2.2, 0.9, 1.8, 0, 0.5);
  // buritan tegak
  b.box(0, 0.9, -3.35, 2.6, 0.9, 0.3);
  // dek
  b.box(0, 1.14, 0, 2.3, 0.12, 5.9);
  // kabin
  b.box(0, 1.75, -0.8, 1.8, 1.1, 2.2);
  b.box(0, 2.36, -0.8, 1.6, 0.1, 2.0);
  // tiang layar
  b.box(0, 3.4, 1.2, 0.16, 3.6, 0.16);
  // palang layar
  b.box(0, 4.4, 1.2, 0.16, 0.16, 2.4);
  // kursi
  b.box(-0.6, 1.35, 1.6, 0.7, 0.3, 0.7);
  b.box(0.6, 1.35, 1.6, 0.7, 0.3, 0.7);
  return b.finish();
}

/* Orang pejalan kaki: kaki, torso, lengan, kepala, topi.
   Tinggi total ~1.8 unit. Alas di y=0. */
function person(color){
  var b = new Builder();
  // kaki kiri / kanan
  b.box(-0.14, 0.4, 0, 0.22, 0.8, 0.24);
  b.box(0.14, 0.4, 0, 0.22, 0.8, 0.24);
  // torso
  b.box(0, 1.15, 0, 0.62, 0.7, 0.34);
  // lengan kiri / kanan
  b.box(-0.42, 1.15, 0, 0.18, 0.65, 0.2);
  b.box(0.42, 1.15, 0, 0.18, 0.65, 0.2);
  // kepala
  b.box(0, 1.68, 0, 0.36, 0.36, 0.36);
  // topi / rambut
  b.box(0, 1.9, 0, 0.42, 0.1, 0.42);
  return b.finish(color);
}

/* Bidang datar (tanah / jalan / laut): pelat tipis beralas y=0. */
function plane(w, d){
  var b = new Builder();
  b.box(0, -0.05, 0, w, 0.1, d);
  return b.finish();
}

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

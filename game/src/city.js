window.SB = window.SB || {};
(function(){
'use strict';

/* =========================================================================
   SB.City — Sunset Bay v12 (Builder C, dunia)
   Kota pesisir fiktif "Sunset Bay": 12 distrik bernama, 300+ gedung,
   jalan grid + trotoar + lampu jalan, 3 interior, pelabuhan + dermaga,
   pantai barat. Golden hour default 18:20 — jendela menyala saat malam.
   Modul mandiri: RNG lokal (mulberry32), tidak membaca modul lain
   kecuali SB.Meshes / SB.Math3 / SB.GL saat draw (dengan guard).
   Peta: x,z dalam [-180, 180]. Laut di barat (x < -172), pantai di
   x [-172,-158]. Pelabuhan di tenggara. Jalan grid tiap 30 unit.
   ========================================================================= */

var GRID = 30;          // jarak antar jalan
var HALF = 180;         // setengah lebar kota
var SEA_X = -172;       // garis pantai (laut di barat)
var BEACH_X = -158;     // batas timur pasir pantai

/* RNG deterministik lokal — kota yang sama di setiap load. */
function mulberry32(seed){
  var a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rng = mulberry32(1337);
function rr(a, b){ return a + rng() * (b - a); }
function ri(a, b){ return Math.floor(rr(a, b + 1)); }
function pick(arr){ return arr[Math.floor(rng() * arr.length)]; }

/* ------------------------- 12 DISTRIK --------------------------------- */
/* name, batas x/z, gaya gedung dominan, palet warna gedung. */
var districts = [
  { name: 'Downtown',        x0: -30,  z0: -30,  x1:  60,  z1:  60, style: 'tower',      palette: [[0.62,0.66,0.72],[0.45,0.5,0.58],[0.75,0.72,0.66]] },
  { name: 'Vice Port',       x0:  90,  z0:  90,  x1: 180,  z1: 180, style: 'industrial', palette: [[0.55,0.42,0.32],[0.48,0.48,0.45],[0.6,0.5,0.4]] },
  { name: 'Sunset Beach',    x0: -180, z0: -60,  x1: -120, z1:  90, style: 'hotel',      palette: [[0.95,0.85,0.7],[0.9,0.75,0.6],[0.98,0.9,0.78]] },
  { name: 'Palm Grove',      x0: -120, z0: -60,  x1: -30,  z1:  60, style: 'house',      palette: [[0.9,0.8,0.65],[0.85,0.7,0.55],[0.95,0.88,0.75]] },
  { name: 'Old Town',        x0: -120, z0:  60,  x1: -30,  z1: 150, style: 'house',      palette: [[0.8,0.65,0.45],[0.75,0.6,0.5],[0.88,0.75,0.6]] },
  { name: 'Marina Bay',      x0: -30,  z0:  90,  x1:  90,  z1: 180, style: 'slab',       palette: [[0.7,0.78,0.85],[0.6,0.68,0.78],[0.8,0.82,0.85]] },
  { name: 'Harbour Lights',  x0:  60,  z0: -30,  x1: 150,  z1:  90, style: 'neon',       palette: [[0.85,0.4,0.5],[0.4,0.6,0.85],[0.9,0.6,0.35]] },
  { name: 'North Hills',     x0: -120, z0: -180, x1: -30,  z1: -60, style: 'house',     palette: [[0.85,0.8,0.7],[0.7,0.75,0.65],[0.9,0.85,0.72]] },
  { name: 'Little Havana',   x0: -30,  z0: -180, x1:  60,  z1: -30, style: 'neon',       palette: [[0.95,0.75,0.4],[0.9,0.55,0.35],[0.85,0.85,0.6]] },
  { name: 'Casino Row',      x0:  60,  z0: -180, x1: 150,  z1: -30, style: 'neon',       palette: [[0.95,0.8,0.3],[0.85,0.35,0.55],[0.5,0.8,0.9]] },
  { name: 'Fishermans Wharf',x0: -180, z0:  90,  x1: -120, z1: 180, style: 'slab',       palette: [[0.65,0.6,0.55],[0.55,0.62,0.6],[0.75,0.7,0.62]] },
  { name: 'Airport Flats',   x0:  90,  z0: -180, x1: 180,  z1: -60, style: 'industrial', palette: [[0.6,0.6,0.6],[0.5,0.55,0.6],[0.7,0.65,0.55]] }
];

/* ------------------------- STATE MODUL -------------------------------- */
var buildings = [];     // {x,z,w,h,d,style,color,mesh,windowMesh,district}
var streetlights = [];  // {x,z}
var palms = [];         // {x,z,rot}
var interiors = [];     // 3 interior
var containers = [];    // kontainer pelabuhan {x,z,color,rot}
var cranes = [];        // {x,z,h}
var piers = [];         // dermaga {x,z,len}
var beachProps = [];    // payung/kursi pantai {x,z,kind}
var neonSigns = [];     // papan neon {x,y,z,color}
var initialized = false;
var meshes = null;      // cache mesh bersama
var lightTimer = 0;     // fase lampu lalu lintas

function districtFor(x, z){
  for (var i = 0; i < districts.length; i++){
    var d = districts[i];
    if (x >= d.x0 && x < d.x1 && z >= d.z0 && z < d.z1) return d;
  }
  return districts[0];
}

function districtAt(x, z){
  return districtFor(x, z).name;
}

/* ------------------------- GENERASI KOTA ------------------------------ */
function generateBuildings(){
  buildings = [];
  // Blok kota: jalan tiap 30 unit, blok 30x30. Tiap blok 2 gedung.
  for (var bx = -HALF; bx < HALF; bx += GRID){
    for (var bz = -HALF; bz < HALF; bz += GRID){
      // Lewati area laut/pantai (barat) dan koridor pelabuhan
      var cx = bx + GRID/2, cz = bz + GRID/2;
      if (cx < BEACH_X + 6) continue;              // pantai, bukan blok
      if (cx > 120 && cz > 120) continue;          // area pelabuhan
      // Blok landmark dikosongkan — diisi menara kembar + HQ di bawah
      if ((cx === 15 && cz === 15) || (cx === 45 && cz === -15) ||
          (cx === -15 && cz === 45)) continue;
      var d = districtFor(cx, cz);
      var n = 2;
      for (var k = 0; k < n; k++){
        var w, h, dep;
        if (d.style === 'tower'){
          w = rr(10, 16); dep = rr(10, 16); h = rr(28, 62);
        } else if (d.style === 'hotel'){
          w = rr(14, 20); dep = rr(10, 14); h = rr(14, 26);
        } else if (d.style === 'house'){
          w = rr(7, 11); dep = rr(7, 11); h = rr(4, 9);
        } else if (d.style === 'industrial'){
          w = rr(14, 22); dep = rr(12, 18); h = rr(6, 11);
        } else if (d.style === 'neon'){
          w = rr(9, 14); dep = rr(9, 13); h = rr(8, 20);
        } else {
          w = rr(10, 15); dep = rr(10, 15); h = rr(10, 22);
        }
        var ox = (k === 0 ? -6 : 6) + rr(-2, 2);
        var oz = (k === 0 ? 5 : -5) + rr(-2, 2);
        var style = d.style;
        // Variasi: 15% gedung distrik jadi tower/slab acak
        if (rng() < 0.12 && d.style !== 'house') style = pick(['tower','slab','neon']);
        if (rng() < 0.1 && d.style === 'house') style = 'slab';
        buildings.push({
          x: cx + ox, z: cz + oz, w: w, h: h, d: dep,
          style: style,
          color: pick(d.palette),
          district: d.name,
          mesh: null,
          win: rng() < 0.7   // punya jendela menyala
        });
      }
    }
  }
  // Gedung landmark di blok yang dikosongkan di atas (jauh dari spawn 0,6)
  buildings.push({ x: 15, z: 15, w: 18, h: 74, d: 18, style: 'tower',
    color: [0.55,0.6,0.7], district: 'Downtown', mesh: null, win: true });
  buildings.push({ x: 45, z: -15, w: 16, h: 66, d: 16, style: 'tower',
    color: [0.7,0.65,0.55], district: 'Downtown', mesh: null, win: true });
  buildings.push({ x: -15, z: 45, w: 22, h: 20, d: 16, style: 'hotel',
    color: [0.9,0.8,0.6], district: 'Downtown', mesh: null, win: true });
}

function generateStreets(){
  streetlights = [];
  palms = [];
  // Lampu jalan di tiap persimpangan, palma di sepanjang jalan pantai
  for (var x = -HALF; x <= HALF; x += GRID){
    for (var z = -HALF; z <= HALF; z += GRID){
      if (x < BEACH_X) continue;
      streetlights.push({ x: x + 7, z: z + 7 });
      streetlights.push({ x: x - 7, z: z - 7 });
    }
  }
  // Palma: jalan pantai (x ~ -152) + Palm Grove + Marina Bay
  for (var pz = -170; pz <= 170; pz += 12){
    palms.push({ x: -152 + rr(-2, 2), z: pz + rr(-3, 3), rot: rr(0, 6.28) });
  }
  for (var i = 0; i < 40; i++){
    palms.push({ x: rr(-115, -35), z: rr(-55, 55), rot: rr(0, 6.28) });
  }
  for (var j = 0; j < 18; j++){
    palms.push({ x: rr(-25, 85), z: rr(95, 175), rot: rr(0, 6.28) });
  }
}

function generatePort(){
  containers = [];
  cranes = [];
  piers = [];
  var cols = [[0.85,0.25,0.2],[0.2,0.5,0.8],[0.85,0.7,0.25],[0.3,0.7,0.35],[0.8,0.5,0.2]];
  for (var i = 0; i < 26; i++){
    containers.push({
      x: rr(125, 172), z: rr(125, 172),
      color: pick(cols), rot: pick([0, 0, Math.PI/2])
    });
  }
  cranes.push({ x: 140, z: 178, h: 34 });
  cranes.push({ x: 165, z: 150, h: 30 });
  cranes.push({ x: 128, z: 140, h: 26 });
  // Dermaga menjorok ke selatan (z > 180) dan ke barat laut pelabuhan
  piers.push({ x: 150, z: 186, len: 26 });
  piers.push({ x: -140, z: 150, len: 22 });
  piers.push({ x: -150, z: -40, len: 18 });
}

function generateBeach(){
  beachProps = [];
  for (var i = 0; i < 16; i++){
    beachProps.push({ x: rr(-168, -160), z: rr(-55, 85), kind: 'umbrella' });
    beachProps.push({ x: rr(-168, -160), z: rr(-55, 85), kind: 'chair' });
  }
  for (var j = 0; j < 8; j++){
    beachProps.push({ x: rr(-168, -162), z: rr(-55, 85), kind: 'towel' });
  }
}

function generateInteriors(){
  interiors = [
    { name: 'Garage',    type: 'garage',    x: 12,  z: -42, w: 16, d: 12,
      props: ['lift','toolbox','tires','workbench'] },
    { name: 'Shop',      type: 'shop',      x: -48, z: 108, w: 14, d: 10,
      props: ['shelf','shelf','counter','fridge'] },
    { name: 'Safehouse', type: 'safehouse', x: -72, z: 18,  w: 12, d: 10,
      props: ['bed','couch','tv','table'] }
  ];
}

function generateNeon(){
  neonSigns = [];
  var cols = [[1,0.25,0.5],[0.25,0.8,1],[1,0.75,0.2],[0.5,1,0.5],[0.8,0.4,1]];
  for (var i = 0; i < 24; i++){
    var d = pick([districts[6], districts[8], districts[9]]);
    neonSigns.push({
      x: rr(d.x0 + 8, d.x1 - 8), z: rr(d.z0 + 8, d.z1 - 8),
      y: rr(6, 16), color: pick(cols)
    });
  }
}

/* ------------------------- API ---------------------------------------- */
function init(state){
  if (initialized) return;
  initialized = true;
  generateBuildings();
  generateStreets();
  generatePort();
  generateBeach();
  generateInteriors();
  generateNeon();
  // Cache mesh bersama (dibangun sekali, dipakai tiap frame)
  if (window.SB && SB.Meshes){
    meshes = {
      ground: SB.Meshes.plane(560, 560),
      road: SB.Meshes.plane(1, 1),
      window: SB.Meshes.box(0.9, 1.2, 0.15),
      lampPole: SB.Meshes.box(0.18, 5.2, 0.18),
      lampHead: SB.Meshes.box(0.9, 0.25, 0.4),
      palm: SB.Meshes.palm(),
      container: SB.Meshes.box(6, 2.6, 2.6),
      pierPlank: SB.Meshes.box(4, 0.4, 4),
      roadV: SB.Meshes.plane(7, 380),
      roadH: SB.Meshes.plane(380, 7),
      dashV: SB.Meshes.plane(0.4, 3),
      dashH: SB.Meshes.plane(3, 0.4),
      walk: SB.Meshes.plane(2, 380),
      sand: SB.Meshes.plane(16, 380),
      umbrella: SB.Meshes.box(2.4, 0.12, 2.4),
      chair: SB.Meshes.box(0.7, 0.5, 1.6),
      towel: SB.Meshes.box(1.8, 0.08, 0.9),
      wall: SB.Meshes.box(1, 1, 1),
      floor: SB.Meshes.plane(1, 1),
      craneArm: SB.Meshes.box(18, 1, 1.4),
      cranePost: SB.Meshes.box(1, 1, 1),
      propLift: SB.Meshes.box(2, 0.8, 4),
      propToolbox: SB.Meshes.box(1.2, 1, 0.6),
      propTires: SB.Meshes.box(0.8, 0.8, 0.8),
      propBench: SB.Meshes.box(2.4, 1, 0.8),
      propShelf: SB.Meshes.box(2, 2.2, 0.8),
      propCounter: SB.Meshes.box(3, 1.1, 1),
      propFridge: SB.Meshes.box(1.2, 2.2, 1),
      propBed: SB.Meshes.box(2, 0.6, 3.4),
      propCouch: SB.Meshes.box(2.6, 0.9, 1),
      propTv: SB.Meshes.box(1.8, 1.1, 0.2),
      propTable: SB.Meshes.box(1.6, 0.8, 1.6)
    };
    // Mesh per interior (ukuran unik) — dibangun sekali di init
    for (var k = 0; k < interiors.length; k++){
      var IN = interiors[k];
      IN.floorMesh = SB.Meshes.plane(IN.w, IN.d);
      IN.wallNS = SB.Meshes.box(IN.w, 3, 0.4);
      IN.wallEW = SB.Meshes.box(0.4, 3, IN.d);
    }
    // Tiang crane (tinggi unik per crane)
    for (var c2 = 0; c2 < cranes.length; c2++){
      cranes[c2].postMesh = SB.Meshes.box(1.2, cranes[c2].h, 1.2);
    }
    // Mesh per gedung (ukuran unik) — dibangun sekali di init
    for (var i = 0; i < buildings.length; i++){
      var b = buildings[i];
      b.mesh = SB.Meshes.building(b.w, b.h, b.d, b.style);
    }
  }
  // generate* memakai reassign array; arahkan ulang referensi export
  // agar SB.City.buildings / interiors / piers menunjuk data terbaru.
  SB.City.buildings = buildings;
  SB.City.interiors = interiors;
  SB.City.piers = piers;
}

function update(dt, state){
  lightTimer += dt;
  // Neon berkedip pelan di malam hari (dipakai draw lewat lightTimer)
  if (!state) return;
}

/* Posisi jalan acak: pilih persimpangan grid lalu offset sepanjang jalan. */
function randomStreetPos(){
  var gx = ri(-6, 6) * GRID;
  var gz = ri(-6, 6) * GRID;
  if (Math.random() < 0.5){
    return { x: gx + rr(-12, 12), z: gz + rr(-1.5, 1.5) };
  }
  return { x: gx + rr(-1.5, 1.5), z: gz + rr(-12, 12) };
}

function isNight(state){
  if (!state) return false;
  var t = state.timeOfDay || 18.33;
  return (t >= 19 || t < 6);
}

function nightFactor(state){
  if (!state) return 0;
  var t = state.timeOfDay || 18.33;
  if (t >= 19 || t < 5.5) return 1;
  if (t >= 18) return (t - 18) / 1.0;   // senja -> malam
  if (t >= 5.5 && t < 6.5) return 1 - (t - 5.5);
  return 0;
}

function draw(gl, state){
  if (!gl || !SB.GL || !SB.Math3 || !meshes) return;
  var M = SB.Math3;
  var night = nightFactor(state);
  var cam = state && state.camera ? state.camera.look : { x: 0, z: 0 };
  var px = cam.x || 0, pz = cam.z || 0;

  function mat(x, y, z, ry){
    var m = M.mat4Identity();
    m = M.mat4Translate(m, x, y, z);
    if (ry) m = M.mat4RotateY(m, ry);
    return m;
  }

  // Tanah dasar kota (abu-abu hangat) + pasir pantai (pita barat)
  SB.GL.drawMesh(meshes.ground, mat(0, -0.1, 0, 0), [0.42, 0.42, 0.4]);
  SB.GL.drawMesh(meshes.sand, mat(-165, 0.0, 0, 0), [0.92, 0.82, 0.6]);

  // Jalan: pita gelap di tiap garis grid (digambar sebagai plane panjang)
  var roadCol = [0.16, 0.16, 0.18];
  for (var gx = -HALF; gx <= HALF; gx += GRID){
    SB.GL.drawMesh(meshes.roadV, mat(gx, 0.02, 0, 0), roadCol);
    SB.GL.drawMesh(meshes.roadH, mat(0, 0.02, gx, 0), roadCol);
  }
  // Marka tengah jalan (garis putus-putus kuning, tiap 6 unit)
  for (var mx = -HALF; mx <= HALF; mx += GRID){
    for (var mz = -HALF; mz <= HALF; mz += 12){
      SB.GL.drawMesh(meshes.dashV, mat(mx, 0.05, mz, 0), [0.85, 0.7, 0.2]);
      SB.GL.drawMesh(meshes.dashH, mat(mz, 0.05, mx, 0), [0.85, 0.7, 0.2]);
    }
  }
  // Trotoar: pita terang di sisi jalan
  for (var tx = -HALF; tx <= HALF; tx += GRID){
    SB.GL.drawMesh(meshes.walk, mat(tx + 4.5, 0.03, 0, 0), [0.55, 0.55, 0.52]);
    SB.GL.drawMesh(meshes.walk, mat(tx - 4.5, 0.03, 0, 0), [0.55, 0.55, 0.52]);
  }

  // Gedung (cull kasar: hanya dalam 220 unit dari kamera)
  for (var i = 0; i < buildings.length; i++){
    var b = buildings[i];
    var dx = b.x - px, dz = b.z - pz;
    if (dx*dx + dz*dz > 220*220) continue;
    SB.GL.drawMesh(b.mesh, mat(b.x, 0, b.z, 0), b.color);
    // Jendela menyala: strip tipis di fasad, emissive saat malam
    if (b.win && b.h > 6){
      var glow = night;
      var winCol = [0.25 + 0.75*glow, 0.55 + 0.35*glow, 0.35 + 0.55*glow];
      if (glow > 0.05){
        var floors = Math.min(6, Math.floor(b.h / 4));
        for (var f = 0; f < floors; f++){
          var wy = 3 + f * 4;
          if (wy > b.h - 1) break;
          SB.GL.drawMesh(meshes.window,
            mat(b.x, wy, b.z + b.d/2 + 0.1, 0), winCol);
        }
      }
    }
  }

  // Lampu jalan (tiang + kepala lampu; kepala menyala kuning saat malam)
  var lampCol = night > 0.05 ? [1.0, 0.85, 0.45] : [0.35, 0.35, 0.3];
  for (var li = 0; li < streetlights.length; li++){
    var L = streetlights[li];
    var ldx = L.x - px, ldz = L.z - pz;
    if (ldx*ldx + ldz*ldz > 160*160) continue;
    SB.GL.drawMesh(meshes.lampPole, mat(L.x, 2.6, L.z, 0), [0.2, 0.2, 0.22]);
    SB.GL.drawMesh(meshes.lampHead, mat(L.x, 5.3, L.z, 0), lampCol);
  }

  // Palma (cull kasar)
  for (var pi = 0; pi < palms.length; pi++){
    var P = palms[pi];
    var pdx = P.x - px, pdz = P.z - pz;
    if (pdx*pdx + pdz*pdz > 180*180) continue;
    SB.GL.drawMesh(meshes.palm, mat(P.x, 0, P.z, P.rot), [0.35, 0.6, 0.25]);
  }

  // Papan neon (berkedip halus, hanya malam)
  if (night > 0.05){
    for (var ni = 0; ni < neonSigns.length; ni++){
      var N = neonSigns[ni];
      var ndx = N.x - px, ndz = N.z - pz;
      if (ndx*ndx + ndz*ndz > 150*150) continue;
      var blink = 0.75 + 0.25 * Math.sin(lightTimer * 3 + ni);
      SB.GL.drawMesh(meshes.window,
        mat(N.x, N.y, N.z, 0),
        [N.color[0]*blink, N.color[1]*blink, N.color[2]*blink]);
    }
  }

  // Pelabuhan: kontainer + crane
  for (var ci = 0; ci < containers.length; ci++){
    var C = containers[ci];
    SB.GL.drawMesh(meshes.container, mat(C.x, 1.3, C.z, C.rot), C.color);
  }
  for (var cr = 0; cr < cranes.length; cr++){
    var K = cranes[cr];
    SB.GL.drawMesh(K.postMesh, mat(K.x, K.h/2, K.z, 0), [0.9, 0.6, 0.15]);
    // lengan crane menjorok ke laut
    SB.GL.drawMesh(meshes.craneArm, mat(K.x - 6, K.h, K.z, 0), [0.9, 0.6, 0.15]);
  }
  // Dermaga: papan kayu menjorok ke air
  for (var di = 0; di < piers.length; di++){
    var D = piers[di];
    for (var s = 0; s < D.len; s += 4){
      SB.GL.drawMesh(meshes.pierPlank, mat(D.x, 0.6, D.z + s, 0), [0.5, 0.38, 0.24]);
    }
  }

  // Properti pantai: payung, kursi, handuk
  for (var bi = 0; bi < beachProps.length; bi++){
    var BP = beachProps[bi];
    if (BP.kind === 'umbrella'){
      SB.GL.drawMesh(meshes.umbrella, mat(BP.x, 2.0, BP.z, 0), [1.0, 0.4, 0.4]);
      SB.GL.drawMesh(meshes.lampPole, mat(BP.x, 1.0, BP.z, 0), [0.7, 0.7, 0.7]);
    } else if (BP.kind === 'chair'){
      SB.GL.drawMesh(meshes.chair, mat(BP.x, 0.25, BP.z, 0), [0.9, 0.85, 0.7]);
    } else {
      SB.GL.drawMesh(meshes.towel, mat(BP.x, 0.06, BP.z, 0), [0.3, 0.6, 0.9]);
    }
  }

  // Interior: hanya digambar saat pemain dekat (< 30 unit) — ruangan
  // terbuka tanpa atap: lantai + dinding rendah + properti.
  if (state && state.player){
    for (var ii = 0; ii < interiors.length; ii++){
      var IN = interiors[ii];
      var idx = state.player.x - IN.x, idz = state.player.z - IN.z;
      if (idx*idx + idz*idz > 30*30) continue;
      SB.GL.drawMesh(IN.floorMesh, mat(IN.x, 0.08, IN.z, 0),
        IN.type === 'garage' ? [0.35, 0.35, 0.38] :
        IN.type === 'shop' ? [0.8, 0.75, 0.65] : [0.6, 0.5, 0.42]);
      // dinding keliling (tinggi 3, tebal 0.4)
      SB.GL.drawMesh(IN.wallNS, mat(IN.x, 1.5, IN.z - IN.d/2, 0), [0.75, 0.72, 0.68]);
      SB.GL.drawMesh(IN.wallNS, mat(IN.x, 1.5, IN.z + IN.d/2, 0), [0.75, 0.72, 0.68]);
      SB.GL.drawMesh(IN.wallEW, mat(IN.x - IN.w/2, 1.5, IN.z, 0), [0.75, 0.72, 0.68]);
      SB.GL.drawMesh(IN.wallEW, mat(IN.x + IN.w/2, 1.5, IN.z, 0), [0.75, 0.72, 0.68]);
      // properti interior
      for (var pr = 0; pr < IN.props.length; pr++){
        var prop = IN.props[pr];
        var ppx = IN.x - IN.w/2 + 2 + pr * 3;
        var ppz = IN.z - IN.d/2 + 2;
        if (prop === 'lift') SB.GL.drawMesh(meshes.propLift, mat(ppx, 0.4, ppz, 0), [0.9, 0.6, 0.1]);
        else if (prop === 'toolbox') SB.GL.drawMesh(meshes.propToolbox, mat(ppx, 0.5, ppz, 0), [0.8, 0.2, 0.2]);
        else if (prop === 'tires') SB.GL.drawMesh(meshes.propTires, mat(ppx, 0.4, ppz, 0), [0.1, 0.1, 0.1]);
        else if (prop === 'workbench') SB.GL.drawMesh(meshes.propBench, mat(ppx, 0.5, ppz, 0), [0.5, 0.35, 0.2]);
        else if (prop === 'shelf') SB.GL.drawMesh(meshes.propShelf, mat(ppx, 1.1, ppz, 0), [0.4, 0.3, 0.2]);
        else if (prop === 'counter') SB.GL.drawMesh(meshes.propCounter, mat(ppx, 0.55, ppz, 0), [0.85, 0.8, 0.7]);
        else if (prop === 'fridge') SB.GL.drawMesh(meshes.propFridge, mat(ppx, 1.1, ppz, 0), [0.9, 0.9, 0.92]);
        else if (prop === 'bed') SB.GL.drawMesh(meshes.propBed, mat(ppx, 0.3, ppz, 0), [0.3, 0.4, 0.8]);
        else if (prop === 'couch') SB.GL.drawMesh(meshes.propCouch, mat(ppx, 0.45, ppz, 0), [0.6, 0.3, 0.3]);
        else if (prop === 'tv') SB.GL.drawMesh(meshes.propTv, mat(ppx, 1.4, ppz, 0), [0.1, 0.1, 0.12]);
        else if (prop === 'table') SB.GL.drawMesh(meshes.propTable, mat(ppx, 0.4, ppz, 0), [0.55, 0.4, 0.25]);
      }
    }
  }
}

window.SB.City = {
  init: init,
  update: update,
  draw: draw,
  districts: districts,
  buildings: buildings,
  randomStreetPos: randomStreetPos,
  districtAt: districtAt,
  // Akses baca tambahan untuk modul lain (interior & pelabuhan)
  interiors: interiors,
  piers: piers,
  isNight: isNight
};

})();

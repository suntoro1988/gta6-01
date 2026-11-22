window.SB = window.SB || {};
(function(){
'use strict';

/* =========================================================================
   SB.Player — Sunset Bay v12 (Builder C, dunia)
   Pejalan kaki: WASD + lari (Shift), lompat (Spasi), tembak (klik mouse),
   HP + armor, animasi jalan sederhana (bob + ayun lengan via rotasi),
   tabrakan gedung (AABB dari SB.City.buildings), batas peta, respawn
   di safehouse saat HP habis.
   Input (dari main.js via SB.Game -> update(dt,state,input)):
     input.keys  : objek {w,a,s,d,shift,space,e,...} (boolean)
     input.mouse : { dx, dy, clicked } — klik kiri = tembak
     input.camAngle : sudut yaw kamera (radian) untuk gerak relatif kamera
   Kontrak dengan Vehicles: modul ini menulis state.input = input agar
   Vehicles.update(dt,state) bisa membaca tombol mengemudi.
   ========================================================================= */

var WALK_SPEED = 5.0;
var RUN_SPEED = 9.5;
var JUMP_VEL = 7.5;
var GRAVITY = 20.0;
var MAP_HALF = 178;

var WEAPONS = [
  { name: 'Pistol',  damage: 25, rate: 0.28, range: 40, spread: 0.02 },
  { name: 'SMG',     damage: 14, rate: 0.09, range: 34, spread: 0.06 },
  { name: 'Shotgun', damage: 16, rate: 0.8,  range: 20, spread: 0.14, pellets: 6 },
  { name: 'Rifle',   damage: 40, rate: 0.16, range: 70, spread: 0.01 }
];

var state = null;
var pos = { x: 0, y: 0, z: 6 };
var velY = 0;
var onGround = true;
var angle = 0;            // arah hadap pemain (radian, yaw)
var walkPhase = 0;        // fase animasi jalan (0..2PI)
var moving = false;
var running = false;
var shootCooldown = 0;
var hurtTimer = 0;        // jeda singkat antar damage (anti insta-kill)
var muzzleTimer = 0;
var meshPerson = null;
var meshGun = null;
var initialized = false;

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

/* Tabrakan AABB sederhana dengan gedung: kembalikan true bila titik
   (x,z) dengan radius r berada di dalam footprint gedung. */
function hitsBuilding(x, z, r){
  if (!window.SB || !SB.City || !SB.City.buildings) return false;
  var list = SB.City.buildings;
  for (var i = 0; i < list.length; i++){
    var b = list[i];
    if (Math.abs(x - b.x) < b.w/2 + r && Math.abs(z - b.z) < b.d/2 + r){
      return true;
    }
  }
  return false;
}

/* Geser posisi dengan tabrakan per-sumbu (bisa meluncur di dinding). */
function move(dx, dz){
  if (!state) return;
  var p = state.player;
  var r = 0.6;
  var nx = p.x + dx;
  if (!hitsBuilding(nx, p.z, r)) p.x = nx;
  var nz = p.z + dz;
  if (!hitsBuilding(p.x, nz, r)) p.z = nz;
  p.x = clamp(p.x, -MAP_HALF, MAP_HALF);
  p.z = clamp(p.z, -MAP_HALF, MAP_HALF);
  pos.x = p.x; pos.z = p.z;
}

function init(st){
  state = st || null;
  if (initialized) return;
  initialized = true;
  if (state && state.player){
    pos.x = state.player.x || 0;
    pos.y = state.player.y || 0;
    pos.z = state.player.z || 6;
    angle = state.player.angle || 0;
  }
  if (window.SB && SB.Meshes){
    meshPerson = SB.Meshes.person([0.2, 0.5, 0.9]);
    meshGun = SB.Meshes.box(0.12, 0.12, 0.7);
  }
}

/* Cari target tembak terdekat di depan pemain (NPC / polisi).
   Return objek {x,z,dist} atau null. Hanya baca modul lain via guard. */
function findTarget(){
  var range = WEAPONS[state.weapon || 0].range;
  var best = null, bestD = range;
  var fx = Math.sin(angle), fz = Math.cos(angle);
  function consider(list){
    if (!list) return;
    for (var i = 0; i < list.length; i++){
      var e = list[i];
      if (e.dead || e.hp !== undefined && e.hp <= 0) continue;
      var dx = e.x - pos.x, dz = e.z - pos.z;
      var d = Math.sqrt(dx*dx + dz*dz);
      if (d > range || d < 0.5) continue;
      var dot = (dx*fx + dz*fz) / d;   // cos sudut ke target
      if (dot < 0.86) continue;        // di luar kerucut bidik ~30 derajat
      if (d < bestD){ bestD = d; best = e; }
    }
  }
  if (window.SB && SB.NPC) consider(SB.NPC.pedestrians);
  if (window.SB && SB.Police) consider(SB.Police.cops);
  return best;
}

function shoot(){
  if (!state) return;
  if (state.player.vehicle || state.player.boat) return; // tidak bisa tembak dari kendaraan
  if (shootCooldown > 0) return;
  var w = WEAPONS[state.weapon || 0];
  if (state.ammo <= 0){
    if (window.SB && SB.HUD) SB.HUD.showToast('AMMO HABIS — beli di toko ($50 / +24)');
    if (window.SB && SB.Audio) SB.Audio.sfx('dryfire');
    shootCooldown = 0.3;
    return;
  }
  state.ammo -= 1;
  shootCooldown = w.rate;
  muzzleTimer = 0.07;
  if (window.SB && SB.Audio) SB.Audio.sfx('shoot');
  // Muzzle flash + asap kecil
  if (window.SB && SB.FX){
    var fx = pos.x + Math.sin(angle) * 1.2;
    var fz = pos.z + Math.cos(angle) * 1.2;
    SB.FX.sparks(fx, pos.y + 1.4, fz);
  }
  var target = findTarget();
  if (target){
    var pellets = w.pellets || 1;
    var dmg = w.damage * pellets;
    if (target.hp !== undefined) target.hp -= dmg;
    else target.hp = 100 - dmg;
    if (target.hp <= 0){
      target.dead = true;
      state.stats.kills = (state.stats.kills || 0) + 1;
      state.rep = (state.rep || 0) + 5;
      if (window.SB && SB.HUD) SB.HUD.showToast('Target down! REP +5');
      if (window.SB && SB.FX) SB.FX.smoke(target.x, 1, target.z);
    } else if (window.SB && SB.NPC && SB.NPC.flee){
      SB.NPC.flee(pos.x, pos.z);
    }
  }
}

function takeDamage(n){
  if (!state) return;
  if (hurtTimer > 0) return;      // invulnerable singkat 0.4 detik
  hurtTimer = 0.4;
  var p = state.player;
  var remaining = n;
  if (p.armor > 0){
    var absorbed = Math.min(p.armor, remaining);
    p.armor -= absorbed;
    remaining -= absorbed;
  }
  p.hp -= remaining;
  if (window.SB && SB.HUD) SB.HUD.showToast('HP -' + remaining);
  if (window.SB && SB.Audio) SB.Audio.sfx('hurt');
  if (p.hp <= 0) die();
}

function die(){
  var p = state.player;
  p.hp = 100;
  p.armor = 0;
  // Respawn di safehouse (interior ke-3) atau titik awal bila belum ada
  var sx = 0, sz = 6;
  if (window.SB && SB.City && SB.City.interiors && SB.City.interiors[2]){
    sx = SB.City.interiors[2].x;
    sz = SB.City.interiors[2].z;
  }
  p.x = sx; p.z = sz; p.y = 0;
  pos.x = sx; pos.z = sz; pos.y = 0;
  velY = 0;
  // Denda rumah sakit + wanted hilang
  state.money = Math.max(0, (state.money || 0) - 100);
  state.wanted = 0;
  state.heat = 0;
  if (window.SB && SB.HUD){
    SB.HUD.showToast('Kamu tumbang! -$100 biaya rumah sakit. Respawn di safehouse.');
  }
  if (window.SB && SB.Police) SB.Police.setWanted(0);
}

function update(dt, st, input){
  if (st) state = st;
  if (!state) return;
  // Teruskan input ke state agar Vehicles bisa membaca tombol mengemudi
  if (input) state.input = input;
  var p = state.player;
  if (!p) return;

  // Sinkron posisi lokal dari state (game.js bisa memindahkan pemain)
  pos.x = p.x; pos.y = p.y || 0; pos.z = p.z;
  angle = p.angle || angle;

  if (shootCooldown > 0) shootCooldown -= dt;
  if (hurtTimer > 0) hurtTimer -= dt;
  if (muzzleTimer > 0) muzzleTimer -= dt;

  // Di kendaraan/perahu: modul Vehicles/Water yang menggerakkan pemain
  if (p.vehicle || p.boat){
    walkPhase = 0;
    moving = false;
    return;
  }

  var keys = (input && input.keys) || {};
  var camAngle = (input && input.camAngle !== undefined) ? input.camAngle : angle;

  // Arah gerak relatif kamera: W = maju menjauhi kamera
  var fwdX = Math.sin(camAngle), fwdZ = Math.cos(camAngle);
  var rightX = Math.cos(camAngle), rightZ = -Math.sin(camAngle);
  var ix = 0, iz = 0;
  if (keys.w || keys.arrowup){ ix += fwdX; iz += fwdZ; }
  if (keys.s || keys.arrowdown){ ix -= fwdX; iz -= fwdZ; }
  if (keys.a || keys.arrowleft){ ix -= rightX; iz -= rightZ; }
  if (keys.d || keys.arrowright){ ix += rightX; iz += rightZ; }

  moving = (ix !== 0 || iz !== 0);
  running = !!(keys.shift) && moving;
  var speed = running ? RUN_SPEED : WALK_SPEED;
  if (moving){
    var len = Math.sqrt(ix*ix + iz*iz);
    ix /= len; iz /= len;
    move(ix * speed * dt, iz * speed * dt);
    // Hadap ke arah gerak (lerp sudut terpendek)
    var targetAngle = Math.atan2(ix, iz);
    var diff = targetAngle - angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    angle += diff * Math.min(1, dt * 12);
    walkPhase += dt * (running ? 13 : 8);
  }

  // Lompat (Spasi) — hanya dari tanah
  if ((keys.space || keys[' ']) && onGround){
    velY = JUMP_VEL;
    onGround = false;
    if (window.SB && SB.Audio) SB.Audio.sfx('jump');
  }
  // Gravitasi
  if (!onGround){
    velY -= GRAVITY * dt;
    pos.y += velY * dt;
    if (pos.y <= 0){ pos.y = 0; velY = 0; onGround = true; }
  }
  p.y = pos.y;
  p.angle = angle;

  // Tembak: klik mouse (sekali per klik) atau tahan tombol mouse
  if (input && input.mouse && input.mouse.clicked){
    shoot();
    input.mouse.clicked = false;
  }
  // Ganti senjata (tombol 1-4)
  if (keys['1']) state.weapon = 0;
  if (keys['2']) state.weapon = 1;
  if (keys['3']) state.weapon = 2;
  if (keys['4']) state.weapon = 3;

  // Jatuh ke laut (x < -172): dorong kembali ke pantai + damage kecil
  if (p.x < -172 && !p.boat){
    p.x = -171;
    pos.x = -171;
    takeDamage(5);
    if (window.SB && SB.HUD) SB.HUD.showToast('Air laut! Kembali ke pantai.');
  }
}

function draw(gl, st){
  if (st) state = st;
  if (!gl || !SB.GL || !SB.Math3 || !state) return;
  var p = state.player;
  if (!p) return;
  // Jangan gambar model pejalan kaki saat di kendaraan/perahu
  if (p.vehicle || p.boat) return;
  if (!meshPerson) return;
  var M = SB.Math3;
  // Animasi jalan: bob naik-turun + goyang kecil
  var bob = moving ? Math.abs(Math.sin(walkPhase)) * 0.08 : 0;
  var sway = moving ? Math.sin(walkPhase) * 0.06 : 0;
  var m = M.mat4Identity();
  m = M.mat4Translate(m, p.x, (p.y || 0) + bob, p.z);
  m = M.mat4RotateY(m, angle + sway);
  // Warna baju: biru saat sehat, merah berkedip saat baru kena damage
  var flash = hurtTimer > 0.2;
  var col = flash ? [0.95, 0.2, 0.2] : [0.2, 0.5, 0.9];
  SB.GL.drawMesh(meshPerson, m, col);
  // Senjata di tangan (kotak kecil di depan dada)
  if (meshGun){
    var gm = M.mat4Identity();
    gm = M.mat4Translate(gm,
      p.x + Math.sin(angle) * 0.35,
      (p.y || 0) + 1.25 + bob,
      p.z + Math.cos(angle) * 0.35);
    gm = M.mat4RotateY(gm, angle);
    SB.GL.drawMesh(meshGun, gm, [0.12, 0.12, 0.14]);
  }
  // Muzzle flash: kotak kuning terang singkat di ujung senjata
  if (muzzleTimer > 0 && meshGun){
    var fm = M.mat4Identity();
    fm = M.mat4Translate(fm,
      p.x + Math.sin(angle) * 0.9,
      (p.y || 0) + 1.3,
      p.z + Math.cos(angle) * 0.9);
    fm = M.mat4RotateY(fm, angle);
    SB.GL.drawMesh(meshGun, fm, [1.0, 0.85, 0.3]);
  }
}

window.SB.Player = {
  init: init,
  update: update,
  draw: draw,
  move: move,
  shoot: shoot,
  takeDamage: takeDamage,
  weapons: WEAPONS
};

})();

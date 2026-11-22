window.SB = window.SB || {};
(function(){ 'use strict';

// SB.Player — karakter utama Sunset Bay: jalan kaki, mengemudi, naik perahu,
// menembak, menerima damage, dan kamera third-person.
// Kamera: mengikuti dari belakang-bawah (eye di belakang pemain, look ke
// depan pemain), dihaluskan dengan lerp agar terasa berat dan sinematik —
// bukan kamera kaku yang menempel.
// Input (dari main.js via SB.Game.frame): input = {
//   moveX: -1..1 (strafe kanan+ / kiri-), moveZ: -1..1 (maju+ / mundur-),
//   sprint: bool, shoot: bool, action: bool (tombol E, edge-triggered),
//   lookDX: number (gerakan mouse X, untuk putar kamera)
// }
// Semua posisi/HP/ammo hidup di SB.state.player (state bersama).

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

// Sudut terpendek dari a ke b (radian, -PI..PI).
function angleDelta(a, b) {
  var d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) { d -= Math.PI * 2; }
  if (d < -Math.PI) { d += Math.PI * 2; }
  return d;
}

var WALK_SPEED = 5.2;     // jalan kaki (unit/detik)
var SPRINT_SPEED = 8.5;   // lari (tahan Shift)
var SWIM_SPEED = 2.0;     // (tidak dipakai berenang — pantai dangkal saja)
var CAM_DIST = 7.5;       // jarak kamera di belakang pemain
var CAM_HEIGHT = 3.2;     // tinggi kamera di atas pemain
var CAM_DRIVE_DIST = 10.5;
var CAM_DRIVE_HEIGHT = 4.2;

var player = {
  ready: false,
  // Kamera internal (dihaluskan): sudut orbit + jarak saat ini.
  camAngle: Math.PI,   // orbit kamera (di belakang pemain menghadap laut)
  camDist: CAM_DIST,
  camHeight: CAM_HEIGHT,
  eye: { x: 0, y: 8, z: 12 },
  look: { x: 0, y: 1, z: 0 },
  // Animasi jalan: fase langkah (ayunan kaki visual via bobbing).
  walkPhase: 0,
  bob: 0,
  muzzle: 0,           // timer kilat moncong senjata (detik)
  muzzleSide: 1,
  hurtTimer: 0,        // timer merah saat kena damage
  dead: false,
  respawnTimer: 0,
  personMesh: null,
  gunMesh: null,
  // Senjata: 0 pistol, 1 smg, 2 shotgun, 3 rifle (selaras SB.state).
  weapons: [
    { name: 'Pistol', damage: 12, rate: 0.35, range: 30, spread: 0.02 },
    { name: 'SMG', damage: 8, rate: 0.12, range: 26, spread: 0.06 },
    { name: 'Shotgun', damage: 9, rate: 0.8, range: 16, spread: 0.14, pellets: 6 },
    { name: 'Rifle', damage: 25, rate: 0.5, range: 55, spread: 0.01 }
  ]
};

// API publik

// init(state): reset pemain ke spawn Boardwalk, kamera di belakangnya.
function init(state) {
  player.ready = true;
  player.dead = false;
  player.respawnTimer = 0;
  player.muzzle = 0;
  player.hurtTimer = 0;
  player.walkPhase = 0;
  player.bob = 0;
  if (window.SB && window.SB.Meshes) {
    player.personMesh = window.SB.Meshes.person('#2e86de');
    player.gunMesh = window.SB.Meshes.box(0.12, 0.1, 0.5);
  }
  if (state && state.player) {
    var p = state.player;
    p.x = -40; p.y = 0; p.z = 150;
    p.angle = Math.PI;
    p.onFoot = true;
    p.vehicle = null;
    p.hp = 100;
    p.armor = 0;
    if (state.ammo === undefined) { state.ammo = 24; }
    if (state.weapon === undefined) { state.weapon = 0; }
    if (!state.camera) {
      state.camera = { eye: { x: 0, y: 8, z: 12 }, look: { x: 0, y: 1, z: 0 } };
    }
    // Kamera awal: di belakang pemain (selatan = +z dari pemain).
    player.camAngle = Math.PI;
    player.eye = { x: p.x, y: CAM_HEIGHT + 1, z: p.z + CAM_DIST };
    player.look = { x: p.x, y: 1.2, z: p.z };
    state.camera.eye = player.eye;
    state.camera.look = player.look;
  }
}

// move(dx, dz): geser pemain (ruang dunia) — dipakai misi/teleport & update.
// Dijaga tetap di darat: tidak bisa jalan ke laut (z > 203) saat jalan kaki,
// dan tidak bisa keluar peta.
function move(dx, dz) {
  var state = window.SB.state;
  if (!state || !state.player) { return; }
  var p = state.player;
  if (!p.onFoot) { return; } // di kendaraan, gerakan diatur modul kendaraan
  p.x = clamp(p.x + dx, -238, 238);
  p.z = clamp(p.z + dz, -238, 203);
  p.y = 0;
}

// shoot(): tembak senjata aktif ke arah hadap pemain.
// Mengembalikan true bila peluru keluar, false bila tidak bisa menembak
// (tidak ada amunisi / sedang mengemudi / mati).
function shoot() {
  var state = window.SB.state;
  if (!state || !state.player) { return false; }
  var p = state.player;
  if (player.dead) { return false; }
  if (!p.onFoot) { return false; } // tidak bisa menembak dari kendaraan
  if (!state.ammo || state.ammo <= 0) {
    // Klik kosong: beri tahu HUD lewat flag + sfx bila ada.
    state.flags.noAmmo = true;
    if (window.SB.Audio) { window.SB.Audio.sfx('empty'); }
    return false;
  }
  state.flags.noAmmo = false;
  var w = player.weapons[state.weapon || 0] || player.weapons[0];
  state.ammo -= 1;
  player.muzzle = 0.09;
  player.muzzleSide *= -1;
  if (window.SB.Audio) { window.SB.Audio.sfx('shoot'); }
  // Tembakan menaikkan heat sedikit (suara tembakan menarik perhatian).
  if (typeof state.heat === 'number') {
    state.heat = Math.min(100, state.heat + 2);
  }
  // Hit sederhana: cari NPC/polisi terdekat di kerucut depan 25 derajat.
  var hit = findTargetInCone(state, w.range);
  if (hit) {
    var dmg = w.damage * (w.pellets || 1);
    if (hit.hp !== undefined) {
      hit.hp -= dmg;
      if (hit.hp <= 0 && state.stats) {
        state.stats.kills = (state.stats.kills || 0) + 1;
      }
    } else if (hit.health !== undefined) {
      // Polisi memakai `health`, bukan `hp` — tanpa cabang ini tembakan
      // tidak pernah melukai polisi.
      hit.health -= dmg;
      if (hit.health <= 0 && state.stats) {
        state.stats.kills = (state.stats.kills || 0) + 1;
      }
    }
    if (window.SB.FX) { window.SB.FX.sparks(hit.x, 1.2, hit.z); }
  }
  return true;
}

// Cari target (NPC / polisi) di depan pemain dalam jarak range.
function findTargetInCone(state, range) {
  var p = state.player;
  var fx = Math.sin(p.angle), fz = Math.cos(p.angle);
  var best = null, bestD = range;
  var pools = [];
  if (window.SB.NPC && window.SB.NPC.pedestrians) {
    pools.push(window.SB.NPC.pedestrians);
  }
  if (window.SB.Police && window.SB.Police.cops) {
    pools.push(window.SB.Police.cops);
  }
  for (var pi = 0; pi < pools.length; pi++) {
    var pool = pools[pi];
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i];
      if (t.hp !== undefined && t.hp <= 0) { continue; }
      var dx = t.x - p.x, dz = t.z - p.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD || d < 0.5) { continue; }
      var dot = (dx * fx + dz * fz) / d; // cos sudut ke target
      if (dot > 0.88) { bestD = d; best = t; } // dalam ~28 derajat
    }
  }
  return best;
}

// takeDamage(n): pemain kena damage n. Armor menyerap dulu (50%),
// lalu HP. HP 0 -> mati: respawn di rumah sakit Downtown, denda $100,
// wanted dihapus. Mengembalikan HP sisa.
function takeDamage(n) {
  var state = window.SB.state;
  if (!state || !state.player) { return 0; }
  var p = state.player;
  if (player.dead || n <= 0) { return p.hp; }
  var remaining = n;
  // Armor menyerap 50% damage sampai habis.
  if (p.armor > 0) {
    var absorbed = Math.min(p.armor, remaining * 0.5);
    p.armor -= absorbed;
    remaining -= absorbed;
  }
  p.hp -= remaining;
  player.hurtTimer = 0.5;
  if (window.SB.Audio) { window.SB.Audio.sfx('hurt'); }
  if (p.hp <= 0) {
    p.hp = 0;
    player.dead = true;
    player.respawnTimer = 2.0; // jeda 2 detik sebelum respawn
    // Keluar dari kendaraan/perahu bila sedang di dalamnya.
    if (p.vehicle) {
      if (window.SB.Vehicles) { window.SB.Vehicles.exitCar(); }
      if (window.SB.Water) { window.SB.Water.exitBoat(); }
      p.vehicle = null;
    }
    p.onFoot = true;
    p.onBoat = false;
    if (state) {
      state.wanted = 0;
      state.heat = 0;
      if (typeof state.money === 'number') {
        state.money = Math.max(0, state.money - 100); // biaya rumah sakit
      }
    }
  }
  return p.hp;
}

// Respawn: rumah sakit Downtown, HP penuh, armor 0.
function respawn(state) {
  var p = state.player;
  p.x = 10; p.y = 0; p.z = 10;
  p.angle = 0;
  p.hp = 100;
  p.armor = 0;
  p.onFoot = true;
  p.vehicle = null;
  p.onBoat = false;
  player.dead = false;
  player.hurtTimer = 0;
  player.camAngle = p.angle + Math.PI;
  if (window.SB.HUD) { window.SB.HUD.showToast('Kamu dirawat di RS Downtown (-$100)'); }
}

// update(dt, state, input): gerak + kamera + aksi.

function update(dt, state, input) {
  if (!player.ready || !state || !state.player) { return; }
  var p = state.player;
  input = input || {};
  var mx = input.moveX || 0;
  var mz = input.moveZ || 0;

  // --- Mati: hitung mundur respawn, kamera tetap di tempat ---
  if (player.dead) {
    player.respawnTimer -= dt;
    if (player.respawnTimer <= 0) { respawn(state); }
    updateCamera(dt, state, 0);
    return;
  }

  // --- Timer efek ---
  if (player.muzzle > 0) { player.muzzle -= dt; }
  if (player.hurtTimer > 0) { player.hurtTimer -= dt; }

  // --- Aksi (tombol E, edge-triggered oleh main.js): masuk/keluar kendaraan,
  // naik/turun perahu. Prioritas: keluar dulu bila sedang di kendaraan. ---
  if (input.action) {
    if (p.vehicle && p.onBoat) {
      if (window.SB.Water) { window.SB.Water.exitBoat(); }
    } else if (p.vehicle) {
      if (window.SB.Vehicles) { window.SB.Vehicles.exitCar(); }
    } else if (window.SB.Water && state.flags && state.flags.nearBoat) {
      window.SB.Water.boardBoat();
    } else if (window.SB.Vehicles) {
      // Coba curi/masuk mobil terdekat (stealCar mengembalikan objek mobil).
      window.SB.Vehicles.stealCar();
    }
  }

  // --- Tembak (tahan tombol) dengan fire-rate senjata ---
  player._shootCd = Math.max(0, (player._shootCd || 0) - dt);
  if (input.shoot && p.onFoot && player._shootCd <= 0) {
    var w = player.weapons[state.weapon || 0] || player.weapons[0];
    if (shoot()) { player._shootCd = w.rate; }
    else { player._shootCd = 0.25; } // klik kosong: jeda pendek
  }

  // --- Gerak jalan kaki (relatif terhadap sudut kamera) ---
  if (p.onFoot && !p.vehicle) {
    var moving = (mx !== 0 || mz !== 0);
    var speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    if (moving) {
      // Arah gerak di ruang dunia dari input + sudut kamera.
      var len = Math.sqrt(mx * mx + mz * mz) || 1;
      var nx = mx / len, nz = mz / len;
      // Kamera di belakang pemain: maju = menjauhi kamera.
      var camSin = Math.sin(player.camAngle), camCos = Math.cos(player.camAngle);
      // Input Z+ = menjauhi kamera (ke depan), X+ = ke kanan kamera.
      var wx = (-camSin * nz) + (camCos * nx);
      var wz = (-camCos * nz) + (-camSin * nx);
      p.x = clamp(p.x + wx * speed * dt, -238, 238);
      p.z = clamp(p.z + wz * speed * dt, -238, 203);
      p.y = 0;
      // Hadap ke arah gerak (putar halus).
      var targetAngle = Math.atan2(wx, wz);
      p.angle += angleDelta(p.angle, targetAngle) * Math.min(1, dt * 12);
      // Animasi langkah + bobbing.
      player.walkPhase += dt * speed * 1.6;
      player.bob = Math.abs(Math.sin(player.walkPhase)) * 0.06;
    } else {
      player.bob = lerp(player.bob, 0, Math.min(1, dt * 8));
    }
    // Putar kamera dengan mouse (lookDX): orbit mengelilingi pemain.
    if (input.lookDX) {
      player.camAngle += input.lookDX * 0.004;
    }
  }

  // --- Mengemudi: teruskan input ke mobil (Vehicles yang menggerakkan) ---
  if (p.vehicle && !p.onBoat) {
    state._carInput = {
      f: clamp(mz, -1, 1),
      turn: clamp(-mx, -1, 1)
    };
  } else if (p.vehicle && p.onBoat) {
    // Di perahu: teruskan input ke perahu (Water yang menggerakkan).
    state._boatInput = {
      f: clamp(mz, -1, 1),
      turn: clamp(-mx, -1, 1)
    };
  } else {
    state._carInput = { f: 0, turn: 0 };
    state._boatInput = { f: 0, turn: 0 };
  }

  // --- Kamera third-person ---
  updateCamera(dt, state, p.onFoot ? 1 : 0);
}

// Kamera: eye di belakang pemain (searah camAngle), look ke depan pemain.
// Dihaluskan dengan lerp; saat mengemudi kamera menjauh + naik sedikit.
function updateCamera(dt, state, onFoot) {
  var p = state.player;
  var dist = onFoot ? CAM_DIST : CAM_DRIVE_DIST;
  var height = onFoot ? CAM_HEIGHT : CAM_DRIVE_HEIGHT;
  // Jarak/tinggi menuju target secara halus (tidak lompat saat naik mobil).
  player.camDist = lerp(player.camDist, dist, Math.min(1, dt * 3));
  player.camHeight = lerp(player.camHeight, height, Math.min(1, dt * 3));
  // Saat mengemudi, kamera mengikuti arah mobil, bukan orbit bebas.
  var followAngle = onFoot ? player.camAngle : (p.angle + Math.PI);
  if (!onFoot) {
    player.camAngle += angleDelta(player.camAngle, followAngle)
      * Math.min(1, dt * 4);
  }
  var tx = p.x + Math.sin(player.camAngle) * player.camDist;
  var tz = p.z + Math.cos(player.camAngle) * player.camDist;
  var ty = p.y + player.camHeight;
  // Haluskan posisi mata (kamera berat, sinematik).
  var k = Math.min(1, dt * 7);
  player.eye.x = lerp(player.eye.x, tx, k);
  player.eye.y = lerp(player.eye.y, ty, k);
  player.eye.z = lerp(player.eye.z, tz, k);
  // Titik lihat: sedikit di depan pemain, setinggi dada.
  var lx = p.x - Math.sin(player.camAngle) * 2.5;
  var lz = p.z - Math.cos(player.camAngle) * 2.5;
  player.look.x = lerp(player.look.x, lx, Math.min(1, dt * 10));
  player.look.y = lerp(player.look.y, p.y + 1.4, Math.min(1, dt * 10));
  player.look.z = lerp(player.look.z, lz, Math.min(1, dt * 10));
  if (!state.camera) {
    state.camera = { eye: player.eye, look: player.look };
  } else {
    state.camera.eye = player.eye;
    state.camera.look = player.look;
  }
}

// draw(gl, state): gambar pemain (jalan kaki saja; di kendaraan, pemain
// tidak digambar — ia "di dalam" mobil/perahu). Senjata + kilat moncong.

function draw(gl, state) {
  if (!player.ready || !gl || !gl.drawMesh) { return; }
  var M = window.SB.Math3;
  if (!M) { return; }
  var p = state ? state.player : null;
  if (!p || player.dead) { return; }
  if (!p.onFoot) { return; } // di mobil/perahu: tidak digambar
  if (!player.personMesh) { return; }

  var white = [1, 1, 1];
  var m4 = M.mat4Identity();
  // Bobbing langkah: naik-turun kecil saat berjalan.
  m4 = M.mat4Translate(m4, p.x, p.y + player.bob, p.z);
  m4 = M.mat4RotateY(m4, p.angle);
  gl.drawMesh(player.personMesh, m4, white);

  // Senjata di tangan kanan (kotak kecil ke arah depan).
  if (player.gunMesh) {
    var g4 = M.mat4Identity();
    g4 = M.mat4Translate(g4, p.x, p.y + 1.15 + player.bob, p.z);
    g4 = M.mat4RotateY(g4, p.angle);
    // Geser ke tangan kanan + depan.
    g4 = M.mat4Translate(g4, 0.42, 0, 0.3);
    gl.drawMesh(player.gunMesh, g4, [0.15, 0.15, 0.16]);
    // Kilat moncong saat baru menembak: kotak kuning terang di ujung laras.
    if (player.muzzle > 0) {
      var f4 = M.mat4Identity();
      f4 = M.mat4Translate(f4, p.x, p.y + 1.15 + player.bob, p.z);
      f4 = M.mat4RotateY(f4, p.angle);
      f4 = M.mat4Translate(f4, 0.42 * player.muzzleSide, 0, 0.75);
      gl.drawMesh(player.gunMesh, f4, [1.0, 0.85, 0.2]);
    }
  }
}

// Export namespace.

window.SB.Player = {
  init: init,
  update: update,
  draw: draw,
  move: move,
  shoot: shoot,
  takeDamage: takeDamage
};

})();

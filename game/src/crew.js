window.SB = window.SB || {};
(function(){
'use strict';

// ---------------------------------------------------------------------------
// SB.Crew — sistem kru / rekan tim Sunset Bay
//
// Empat anggota bisa direkrut, masing-masing punya peran, kemampuan unik,
// dan perilaku mengikuti pemain. Perintah kru: ikut (follow), serang
// (attack), tunggu (wait). Anggota kru ikut bertarung, menyetir, menyembuh,
// dan memberi bonus pasif selama mereka aktif di lapangan.
// ---------------------------------------------------------------------------

var FOLLOW_DIST = 3.2;    // jarak ideal anggota di belakang pemain
var CATCHUP_DIST = 26;    // di atas jarak ini anggota berlari mengejar
var TELEPORT_DIST = 60;   // di atas jarak ini anggota "menyusul" (teleport)
var COMBAT_RANGE = 34;    // jarak anggota menyerang musuh terdekat
var HEAL_TICK = 1.0;      // interval penyembuhan Tasha (detik)

// Definisi empat anggota yang bisa direkrut. `cost` adalah biaya rekrut
// sekali bayar; `unlock` adalah syarat respect minimum (0 = terbuka).
var ROSTER = [
  {
    name: 'Rico', role: 'Wheelman', color: 0xd94f30,
    cost: 300, unlock: 0, hp: 120,
    bio: 'Pembalap jalanan Sunset Bay. Pernah menang 14 balapan liar.',
    ability: 'Slipstream',
    abilityDesc: 'Slipstream: +25% kecepatan kendaraan saat Rico ikut di mobil.',
    passive: 'Kendaraan pemain +12% akselerasi selama Rico aktif.'
  },
  {
    name: 'Lena', role: 'Hacker', color: 0x3fa7d6,
    cost: 500, unlock: 150, hp: 90,
    bio: 'Peretas sistem kota. Bisa mematikan kamera dan membuka kunci.',
    ability: 'Blackout',
    abilityDesc: 'Blackout: matikan lampu jalan & kamera 30 detik, wanted -1.',
    passive: 'Wanted naik 20% lebih lambat selama Lena aktif.'
  },
  {
    name: 'Marcus', role: 'Muscle', color: 0x8a5a2b,
    cost: 450, unlock: 100, hp: 200,
    bio: 'Mantan petinju pelabuhan. Satu pukulan cukup untuk kebanyakan orang.',
    ability: 'Haymaker',
    abilityDesc: 'Haymaker: pukulan dahsyat, damage 3x ke target terdekat.',
    passive: 'Damage jarak dekat pemain +25% selama Marcus aktif.'
  },
  {
    name: 'Tasha', role: 'Medic', color: 0x7bc47f,
    cost: 400, unlock: 200, hp: 100,
    bio: 'Perawat lapangan. Selalu bawa tas medis dan kopi dingin.',
    ability: 'Field Dressing',
    abilityDesc: 'Field Dressing: pulihkan 40 HP pemain seketika.',
    passive: 'Regenerasi +2 HP/detik selama Tasha aktif.'
  }
];

// Cooldown tiap ability (detik).
var ABILITY_COOLDOWN = {
  Slipstream: 20,
  Blackout: 45,
  Haymaker: 12,
  'Field Dressing': 30
};

var stateRef = null;      // referensi SB.state (dibuat game.js)
var members = [];         // anggota aktif (subset ROSTER + status runtime)
var order = 'follow';     // perintah aktif: 'follow' | 'attack' | 'wait'
var healTimer = 0;        // timer regenerasi Tasha
var combatTimer = 0;      // timer serangan kru
var recruitLog = [];      // riwayat rekrut (untuk HUD / statistik)

// ---------------------------------------------------------------------------
// Util kecil (lokal, tanpa dependensi modul lain)
// ---------------------------------------------------------------------------

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

function dist2d(ax, az, bx, bz){
  var dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function findRoster(name){
  for (var i = 0; i < ROSTER.length; i++){
    if (ROSTER[i].name === name) return ROSTER[i];
  }
  return null;
}

function findMember(name){
  for (var i = 0; i < members.length; i++){
    if (members[i].name === name) return members[i];
  }
  return null;
}

function toast(text){
  if (window.SB && window.SB.HUD && typeof window.SB.HUD.showToast === 'function'){
    window.SB.HUD.showToast(text);
  }
}

// ---------------------------------------------------------------------------
// init(state)
// ---------------------------------------------------------------------------

function init(state){
  stateRef = state;
  // JANGAN reassign `members`: SB.Crew.members diekspor sebagai referensi
  // ke array ini, jadi kosongkan di tempat agar referensi tetap hidup.
  members.length = 0;
  order = 'follow';
  healTimer = 0;
  combatTimer = 0;
  recruitLog.length = 0;
  if (state){
    state.crew = members;
    if (!state.flags) state.flags = {};
    state.flags.crewOrder = order;
  }
}

// ---------------------------------------------------------------------------
// recruit(name) — rekrut anggota dari ROSTER
// ---------------------------------------------------------------------------

function recruit(name){
  if (!stateRef) return false;
  var def = findRoster(name);
  if (!def) return false;
  if (findMember(name)) { toast(name + ' sudah bergabung dengan kru.'); return false; }
  if (members.length >= 4) { toast('Kru sudah penuh (4 anggota).'); return false; }
  if ((stateRef.respect || 0) < def.unlock){
    toast(name + ' butuh respect ' + def.unlock + ' (sekarang ' + (stateRef.respect || 0) + ').');
    return false;
  }
  if ((stateRef.money || 0) < def.cost){
    toast('Butuh $' + def.cost + ' untuk merekrut ' + name + '.');
    return false;
  }

  stateRef.money -= def.cost;
  var m = {
    name: def.name, role: def.role, color: def.color,
    hp: def.hp, maxHp: def.hp,
    ability: def.ability, abilityDesc: def.abilityDesc,
    passive: def.passive,
    x: stateRef.player.x + 2, y: 0, z: stateRef.player.z + 2,
    angle: stateRef.player.angle || 0,
    mode: 'follow',            // follow | attack | wait (per anggota)
    cooldown: 0,               // cooldown ability
    active: true,
    kills: 0,
    joinedDay: stateRef.day || 1
  };
  members.push(m);
  stateRef.crew = members;
  recruitLog.push({ name: name, day: stateRef.day || 1, cost: def.cost });
  toast(name + ' (' + def.role + ') bergabung! Ability: ' + def.ability + '.');
  if (stateRef.flags) stateRef.flags['crew_' + name.toLowerCase()] = true;
  return true;
}

// ---------------------------------------------------------------------------
// command(cmd) — perintah ke seluruh kru
//   'follow' / 'ikut'  : ikuti pemain
//   'attack' / 'serang': serang musuh terdekat
//   'wait'   / 'tunggu': diam di tempat
// ---------------------------------------------------------------------------

function command(cmd){
  var c = String(cmd || '').toLowerCase();
  var norm = null;
  if (c === 'follow' || c === 'ikut' || c === 'follow me') norm = 'follow';
  else if (c === 'attack' || c === 'serang' || c === 'fight') norm = 'attack';
  else if (c === 'wait' || c === 'tunggu' || c === 'hold' || c === 'stay') norm = 'wait';
  if (!norm) return false;
  order = norm;
  for (var i = 0; i < members.length; i++) members[i].mode = norm;
  if (stateRef && stateRef.flags) stateRef.flags.crewOrder = norm;
  var label = norm === 'follow' ? 'Ikut aku!' : (norm === 'attack' ? 'Serang!' : 'Tunggu di sini.');
  toast('Kru: ' + label);
  return true;
}

// ---------------------------------------------------------------------------
// ability(name) — aktifkan ability anggota bernama `name`
// ---------------------------------------------------------------------------

function ability(name){
  if (!stateRef) return false;
  var m = findMember(name);
  if (!m || !m.active) return false;
  if (m.cooldown > 0) return false;
  var p = stateRef.player;
  var cd = ABILITY_COOLDOWN[m.ability] || 20;
  m.cooldown = cd;

  if (m.ability === 'Slipstream'){
    if (stateRef.flags) stateRef.flags.slipstreamUntil = (stateRef.time || 0) + 20;
    toast('Rico: Slipstream! Kendaraan +25% kecepatan 20 detik.');
  } else if (m.ability === 'Blackout'){
    if (stateRef.flags) stateRef.flags.blackoutUntil = (stateRef.time || 0) + 30;
    stateRef.wanted = Math.max(0, (stateRef.wanted || 0) - 1);
    if (window.SB.HUD && window.SB.HUD.setWanted) window.SB.HUD.setWanted(stateRef.wanted);
    toast('Lena: Blackout! Kamera mati 30 detik, wanted -1.');
  } else if (m.ability === 'Haymaker'){
    if (stateRef.flags) stateRef.flags.haymakerUntil = (stateRef.time || 0) + 5;
    toast('Marcus: Haymaker! Damage jarak dekat 3x selama 5 detik.');
  } else if (m.ability === 'Field Dressing'){
    p.hp = clamp((p.hp || 0) + 40, 0, 100);
    toast('Tasha: Field Dressing! +40 HP.');
  }
  return true;
}

// ---------------------------------------------------------------------------
// Perilaku anggota (dipanggil dari update)
// ---------------------------------------------------------------------------

function stepFollow(m, dt, p){
  var d = dist2d(m.x, m.z, p.x, p.z);
  if (d > TELEPORT_DIST){
    m.x = p.x + 2; m.z = p.z + 2; m.y = 0;
    return;
  }
  if (d > FOLLOW_DIST){
    var speed = d > CATCHUP_DIST ? 9.0 : 5.0;
    var dx = p.x - m.x, dz = p.z - m.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var step = Math.min(speed * dt, d - FOLLOW_DIST * 0.5);
    m.x += (dx / len) * step;
    m.z += (dz / len) * step;
    m.angle = Math.atan2(dx, dz);
  }
}

function stepWait(m, dt){
  // Diam di tempat; hanya sedikit menghadap arah pemain.
  if (!stateRef) return;
  var p = stateRef.player;
  var dx = p.x - m.x, dz = p.z - m.z;
  if (Math.abs(dx) + Math.abs(dz) > 0.01) m.angle = Math.atan2(dx, dz);
}

function stepAttack(m, dt){
  // Cari "musuh" terdekat: polisi terdekat bila wanted > 0, atau titik
  // panas terakhir. Tanpa modul police, kru bergerak ke arah depan pemain
  // dan menyerang target dalam jangkauan.
  var p = stateRef.player;
  var target = null, best = COMBAT_RANGE;
  if (window.SB.Police && window.SB.Police.cops){
    var cops = window.SB.Police.cops;
    for (var i = 0; i < cops.length; i++){
      var d = dist2d(m.x, m.z, cops[i].x, cops[i].z);
      if (d < best){ best = d; target = cops[i]; }
    }
  }
  if (target){
    var dx = target.x - m.x, dz = target.z - m.z;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    if (best > 2.0){
      m.x += (dx / len) * 7.0 * dt;
      m.z += (dz / len) * 7.0 * dt;
    } else if (combatTimer <= 0){
      target.hp = (target.hp || 50) - (m.role === 'Muscle' ? 25 : 12);
      m.kills += 0; // kill dihitung saat target tumbang oleh police/npc
      if (stateRef.flags) stateRef.flags.crewHit = (stateRef.flags.crewHit || 0) + 1;
    }
    m.angle = Math.atan2(dx, dz);
  } else {
    // Tidak ada musuh: maju sedikit ke depan pemain (formasi serang).
    var fx = Math.sin(p.angle || 0), fz = Math.cos(p.angle || 0);
    var tx = p.x + fx * 6, tz = p.z + fz * 6;
    var d2 = dist2d(m.x, m.z, tx, tz);
    if (d2 > 1.5){
      var ex = tx - m.x, ez = tz - m.z;
      var l2 = Math.sqrt(ex * ex + ez * ez) || 1;
      m.x += (ex / l2) * 6.0 * dt;
      m.z += (ez / l2) * 6.0 * dt;
      m.angle = Math.atan2(ex, ez);
    }
  }
}

function applyPassives(dt){
  if (!stateRef) return;
  var p = stateRef.player;
  var hasTasha = false, hasRico = false, hasMarcus = false, hasLena = false;
  for (var i = 0; i < members.length; i++){
    if (!members[i].active) continue;
    if (members[i].name === 'Tasha') hasTasha = true;
    if (members[i].name === 'Rico') hasRico = true;
    if (members[i].name === 'Marcus') hasMarcus = true;
    if (members[i].name === 'Lena') hasLena = true;
  }
  if (hasTasha){
    healTimer += dt;
    if (healTimer >= HEAL_TICK){
      healTimer = 0;
      p.hp = clamp((p.hp || 0) + 2, 0, 100);
    }
  }
  if (stateRef.flags){
    stateRef.flags.crewRicoActive = hasRico;
    stateRef.flags.crewMarcusActive = hasMarcus;
    stateRef.flags.crewLenaActive = hasLena;
    stateRef.flags.crewTashaActive = hasTasha;
    stateRef.flags.crewCount = members.length;
  }
}

// ---------------------------------------------------------------------------
// update(dt, state)
// ---------------------------------------------------------------------------

function update(dt, state){
  if (!state) return;
  stateRef = state;
  var p = state.player;
  if (!p) return;

  combatTimer -= dt;
  for (var i = 0; i < members.length; i++){
    var m = members[i];
    if (!m.active) continue;
    if (m.cooldown > 0) m.cooldown -= dt;
    // Regenerasi HP anggota pelan-pelan saat tidak bertarung.
    if (m.hp < m.maxHp && m.mode !== 'attack') m.hp = Math.min(m.maxHp, m.hp + 3 * dt);
    if (m.mode === 'follow') stepFollow(m, dt, p);
    else if (m.mode === 'wait') stepWait(m, dt);
    else if (m.mode === 'attack') stepAttack(m, dt);
  }
  applyPassives(dt);
  state.crew = members;
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

window.SB.Crew = {
  init: init,
  update: update,
  recruit: recruit,
  command: command,
  members: members,
  ability: ability,
  roster: ROSTER,
  order: function(){ return order; },
  count: function(){ return members.length; }
};

})();

window.SB = window.SB || {};
(function(){
'use strict';

// ---------------------------------------------------------------------------
// SB.Races — balapan jalanan Sunset Bay
//
// 6 balapan jalanan, masing-masing dengan rute checkpoint, hadiah uang,
// 3 lawan AI, dan syarat respect. Menang balapan: +$ hadiah, +40 respect,
// +rep distrik tempat finis, dan hitungan stats.racesWon. Kalah: tidak ada
// hadiah, tapi tetap dapat +5 respect (pengalaman) bila finis.
// ---------------------------------------------------------------------------

// Definisi balapan. `checkpoints` adalah titik (x,z) di peta kota;
// `laps` = jumlah putaran; `entryFee` dibayar sekali saat start.
var RACE_DEFS = [
  {
    id: 'sunset_sprint', name: 'Sunset Sprint', district: 'Sunset Beach',
    entryFee: 100, prize: 500, respectNeeded: 0, laps: 1,
    desc: 'Sprint lurus di Ocean Drive saat golden hour.',
    checkpoints: [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 120, z: 20 }, { x: 150, z: 80 }, { x: 120, z: 140 }, { x: 40, z: 150 }],
    rivals: ['Vex', 'Milo', 'Sasha']
  },
  {
    id: 'neon_nights', name: 'Neon Nights', district: 'Neon Strip',
    entryFee: 200, prize: 900, respectNeeded: 100, laps: 2,
    desc: 'Dua putaran menembus gang neon yang sempit.',
    checkpoints: [{ x: -40, z: -20 }, { x: 10, z: -60 }, { x: 70, z: -40 }, { x: 90, z: 20 }, { x: 30, z: 60 }, { x: -50, z: 40 }],
    rivals: ['Vex', 'Rook', 'Luna']
  },
  {
    id: 'harbour_drift', name: 'Harbour Drift', district: 'The Docks',
    entryFee: 300, prize: 1400, respectNeeded: 250, laps: 2,
    desc: 'Lintasan pelabuhan licin — drift adalah kunci.',
    checkpoints: [{ x: -120, z: 80 }, { x: -80, z: 140 }, { x: -10, z: 150 }, { x: 30, z: 100 }, { x: -20, z: 40 }, { x: -100, z: 30 }],
    rivals: ['Milo', 'Rook', 'Sasha']
  },
  {
    id: 'palm_circuit', name: 'Palm Circuit', district: 'Palm Court',
    entryFee: 500, prize: 2200, respectNeeded: 500, laps: 3,
    desc: 'Sirkuit bukit palem, tiga putaran penuh tikungan.',
    checkpoints: [{ x: 40, z: -120 }, { x: 110, z: -90 }, { x: 140, z: -20 }, { x: 90, z: 40 }, { x: 20, z: 10 }, { x: -10, z: -80 }],
    rivals: ['Vex', 'Luna', 'Rook']
  },
  {
    id: 'airport_run', name: 'Airport Run', district: 'Industrial Park',
    entryFee: 800, prize: 3500, respectNeeded: 800, laps: 1,
    desc: 'Satu putaran panjang di jalan lingkar bandara. Kecepatan murni.',
    checkpoints: [{ x: -160, z: -100 }, { x: -60, z: -160 }, { x: 60, z: -150 }, { x: 160, z: -80 }, { x: 120, z: 20 }, { x: 0, z: 60 }, { x: -120, z: 0 }],
    rivals: ['Vex', 'Milo', 'Luna']
  },
  {
    id: 'kingpin_gp', name: 'Kingpin Grand Prix', district: 'Downtown',
    entryFee: 1500, prize: 8000, respectNeeded: 1500, laps: 3,
    desc: 'Grand prix kota. Hanya untuk Kingpin sejati.',
    checkpoints: [{ x: 0, z: 0 }, { x: 80, z: -40 }, { x: 120, z: 40 }, { x: 60, z: 110 }, { x: -40, z: 120 }, { x: -100, z: 60 }, { x: -80, z: -30 }],
    rivals: ['Vex', 'Rook', 'Sasha']
  }
];

var CHECKPOINT_RADIUS = 14;  // radius "menyentuh" checkpoint
var RIVAL_SKILL = { Vex: 0.97, Milo: 0.88, Sasha: 0.91, Rook: 0.94, Luna: 0.86 };
var RIVAL_COLORS = { Vex: 0xff2e63, Milo: 0xffd23f, Sasha: 0x08d9d6, Rook: 0x6a2c70, Luna: 0xf9ed69 };

var stateRef = null;
var races = [];            // status tiap balapan (def + best time + wins)
var active = null;         // balapan aktif (state.race) atau null
var raceTimer = 0;         // waktu sejak start (detik)
var resultsLog = [];       // riwayat hasil balapan

// ---------------------------------------------------------------------------
// Util lokal
// ---------------------------------------------------------------------------

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

function dist2d(ax, az, bx, bz){
  var dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

function findDef(id){
  for (var i = 0; i < RACE_DEFS.length; i++){
    if (RACE_DEFS[i].id === id) return RACE_DEFS[i];
  }
  return null;
}

function findStatus(id){
  for (var i = 0; i < races.length; i++){
    if (races[i].id === id) return races[i];
  }
  return null;
}

function toast(text){
  if (window.SB && window.SB.HUD && typeof window.SB.HUD.showToast === 'function'){
    window.SB.HUD.showToast(text);
  }
}

function fmtTime(t){
  var m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
}

// ---------------------------------------------------------------------------
// init(state)
// ---------------------------------------------------------------------------

function init(state){
  stateRef = state;
  races.length = 0;
  active = null;
  raceTimer = 0;
  resultsLog.length = 0;
  for (var i = 0; i < RACE_DEFS.length; i++){
    races.push({
      id: RACE_DEFS[i].id, name: RACE_DEFS[i].name,
      district: RACE_DEFS[i].district, prize: RACE_DEFS[i].prize,
      entryFee: RACE_DEFS[i].entryFee, respectNeeded: RACE_DEFS[i].respectNeeded,
      laps: RACE_DEFS[i].laps, checkpoints: RACE_DEFS[i].checkpoints.length,
      bestTime: null, wins: 0, attempts: 0, unlocked: RACE_DEFS[i].respectNeeded === 0
    });
  }
  if (state){
    state.race = null;
    if (!state.flags) state.flags = {};
    state.flags.raceActive = false;
  }
}

// ---------------------------------------------------------------------------
// startRace(id)
// ---------------------------------------------------------------------------

function startRace(id){
  if (!stateRef) return false;
  if (active){ toast('Balapan sedang berjalan!'); return false; }
  var def = findDef(id);
  if (!def) return false;
  var status = findStatus(id);
  if ((stateRef.respect || 0) < def.respectNeeded){
    toast(def.name + ' butuh respect ' + def.respectNeeded + '.');
    return false;
  }
  if ((stateRef.money || 0) < def.entryFee){
    toast('Biaya masuk ' + def.name + ': $' + def.entryFee + '.');
    return false;
  }
  stateRef.money -= def.entryFee;
  status.attempts += 1;

  // Bangun lawan AI: kecepatan dasar + variasi skill, posisi start
  // di belakang garis start dengan jarak antar mobil.
  var rivals = [];
  for (var i = 0; i < def.rivals.length; i++){
    var rn = def.rivals[i];
    rivals.push({
      name: rn, color: RIVAL_COLORS[rn] || 0xffffff,
      skill: RIVAL_SKILL[rn] || 0.9,
      checkpoint: 0, lap: 1, progress: 0,
      x: def.checkpoints[0].x - 4 - i * 3, z: def.checkpoints[0].z + 6 + i * 4,
      finished: false, finishTime: null, speed: 0
    });
  }

  var p = stateRef.player;
  active = {
    id: def.id, name: def.name, district: def.district,
    prize: def.prize, entryFee: def.entryFee,
    laps: def.laps, checkpoints: def.checkpoints,
    rivals: rivals,
    checkpoint: 0, lap: 1,
    time: 0, finished: false
  };
  raceTimer = 0;
  stateRef.race = active;
  stateRef.flags.raceActive = true;
  if (p){
    p.x = def.checkpoints[0].x;
    p.z = def.checkpoints[0].z + 8;
  }
  toast('Balapan dimulai: ' + def.name + '! ' + def.laps + ' putaran, ' +
    def.checkpoints.length + ' checkpoint.');
  return true;
}

// ---------------------------------------------------------------------------
// checkpoint(i) — tandai checkpoint ke-i dilewati pemain
// ---------------------------------------------------------------------------

function checkpoint(i){
  if (!active || active.finished) return false;
  // Hanya checkpoint berikutnya yang dihitung; yang lain diabaikan.
  if (i !== active.checkpoint) return false;
  active.checkpoint += 1;
  if (active.checkpoint >= active.checkpoints.length){
    active.checkpoint = 0;
    active.lap += 1;
    if (active.lap > active.laps){
      finishRace();
      return true;
    }
    toast('Putaran ' + active.lap + '/' + active.laps + ' — ' + active.name);
  } else {
    toast('Checkpoint ' + active.checkpoint + '/' + active.checkpoints.length);
  }
  return true;
}

// Posisi pemain saat ini terhadap checkpoint berikutnya; dipakai update()
// untuk auto-deteksi saat pemain masuk radius checkpoint.
function checkPlayerCheckpoint(){
  if (!active || active.finished || !stateRef || !stateRef.player) return;
  var p = stateRef.player;
  var cp = active.checkpoints[active.checkpoint];
  if (!cp) return;
  if (dist2d(p.x, p.z, cp.x, cp.z) <= CHECKPOINT_RADIUS){
    checkpoint(active.checkpoint);
  }
}

// ---------------------------------------------------------------------------
// finishRace() — hitung hasil, hadiah, respect
// ---------------------------------------------------------------------------

function finishRace(){
  if (!active) return null;
  active.finished = true;
  var def = findDef(active.id);
  var status = findStatus(active.id);
  var time = raceTimer;

  // Posisi akhir: bandingkan waktu pemain dengan waktu lawan AI.
  // Waktu lawan = waktu pemain * (1/skill) + variasi — lawan yang lebih
  // cepat dari pemain bila skill-nya cukup tinggi & pemain lambat.
  var place = 1;
  var rivalTimes = [];
  for (var i = 0; i < active.rivals.length; i++){
    var r = active.rivals[i];
    var rt = r.finishTime;
    if (rt === null){
      // Lawan belum finis: perkirakan dari progres checkpoint-nya.
      var totalCp = active.checkpoints.length * active.laps;
      var doneCp = (r.lap - 1) * active.checkpoints.length + r.checkpoint;
      var frac = clamp(doneCp / totalCp, 0.05, 1);
      rt = time / frac * (1.02 - r.skill * 0.12);
      r.finishTime = rt;
    }
    rivalTimes.push({ name: r.name, time: rt });
    if (rt < time) place += 1;
  }
  rivalTimes.sort(function(a, b){ return a.time - b.time; });

  var won = (place === 1);
  var result = {
    id: active.id, name: active.name, time: time, place: place,
    won: won, prize: won ? active.prize : 0,
    rivals: rivalTimes, day: stateRef.day || 1
  };
  resultsLog.push(result);
  if (status){
    status.attempts = Math.max(status.attempts, 1);
    if (status.bestTime === null || time < status.bestTime) status.bestTime = time;
    if (won) status.wins += 1;
  }

  if (won){
    stateRef.money = (stateRef.money || 0) + active.prize;
    if (window.SB.Economy && window.SB.Economy.addRespect){
      window.SB.Economy.addRespect(40);
    } else {
      stateRef.respect = (stateRef.respect || 0) + 40;
    }
    if (window.SB.Economy && window.SB.Economy.changeRep){
      window.SB.Economy.changeRep(active.district, 6);
    }
    if (stateRef.stats) stateRef.stats.racesWon = (stateRef.stats.racesWon || 0) + 1;
    toast('MENANG! ' + active.name + ' — +$' + active.prize + ', +40 respect. Waktu ' + fmtTime(time) + '.');
  } else {
    if (window.SB.Economy && window.SB.Economy.addRespect){
      window.SB.Economy.addRespect(5);
    } else {
      stateRef.respect = (stateRef.respect || 0) + 5;
    }
    toast('Finis #' + place + ' di ' + active.name + ' (' + fmtTime(time) + '). +5 respect.');
  }
  if (window.SB.HUD && window.SB.HUD.showMission){
    window.SB.HUD.showMission(result.won ? 'RACE WON: ' + active.name : 'Race selesai #' + place);
  }
  stateRef.race = null;
  stateRef.flags.raceActive = false;
  active = null;
  return result;
}

// ---------------------------------------------------------------------------
// update(dt, state) — gerakkan lawan AI + deteksi checkpoint pemain
// ---------------------------------------------------------------------------

function update(dt, state){
  if (!state) return;
  stateRef = state;
  if (!active || active.finished) return;
  raceTimer += dt;
  active.time = raceTimer;

  var totalCp = active.checkpoints.length * active.laps;
  // Lawan AI maju sepanjang rute: kecepatan ~ (32 + skill*10) unit/detik
  // dengan sedikit goyangan, lalu "menyentuh" checkpoint satu per satu.
  for (var i = 0; i < active.rivals.length; i++){
    var r = active.rivals[i];
    if (r.finished) continue;
    var baseSpeed = 30 + r.skill * 14;
    // Goyangan kecepatan ala pembalap manusia (sinus + waktu).
    var wobble = 1 + 0.08 * Math.sin(raceTimer * 0.7 + i * 2.1);
    r.speed = baseSpeed * wobble;
    r.progress += r.speed * dt;

    // Jarak antar checkpoint dihitung kasar 55 unit; majukan checkpoint
    // bila progres melewati ambang checkpoint berikutnya.
    var cpDist = 55;
    while (r.progress >= cpDist && !r.finished){
      r.progress -= cpDist;
      r.checkpoint += 1;
      if (r.checkpoint >= active.checkpoints.length){
        r.checkpoint = 0;
        r.lap += 1;
        if (r.lap > active.laps){
          r.finished = true;
          r.finishTime = raceTimer;
        }
      }
    }
    // Interpolasi posisi lawan di antara checkpoint untuk draw().
    var idx = r.checkpoint;
    var next = active.checkpoints[(idx + 1) % active.checkpoints.length];
    var cur = active.checkpoints[idx];
    var t = clamp(r.progress / cpDist, 0, 1);
    r.x = cur.x + (next.x - cur.x) * t;
    r.z = cur.z + (next.z - cur.z) * t;
  }

  checkPlayerCheckpoint();
  if (stateRef) stateRef.race = active;
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

window.SB.Races = {
  init: init,
  update: update,
  startRace: startRace,
  checkpoint: checkpoint,
  finishRace: finishRace,
  races: races,
  defs: RACE_DEFS,
  active: function(){ return active; },
  results: resultsLog,
  bestTime: function(id){
    var s = findStatus(id);
    return s ? s.bestTime : null;
  }
};

})();

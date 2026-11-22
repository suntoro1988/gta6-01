// Sunset Bay v14 — SB.Races
// 6 trek balap jalanan: checkpoint, lap, timer, hadiah cash + respect.
// Balapan dimulai dari SB.Races.startRace(id); posisi pemain dibaca dari
// SB.Player (atau SB.Game.state.player). Checkpoint tercapai bila pemain
// masuk radius 12 meter dari titik checkpoint.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).

window.SB = window.SB || {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Radius (meter) untuk menganggap sebuah checkpoint tercapai.
const CHECKPOINT_RADIUS = 12;

// 6 trek balap jalanan. checkpoints mengikuti jalan kota (koordinat x,z).
// laps = jumlah putaran; reward = hadiah cash bila menang (finis).
const TRACKS = [
  {
    id: "marina-sprint",
    name: "Marina Sprint",
    district: "Marina Bay",
    desc: "Flat-out sprint along the marina waterfront.",
    checkpoints: [
      { x: 0, z: 0 }, { x: 60, z: -40 }, { x: 100, z: -80 },
      { x: 60, z: -110 }, { x: 0, z: -100 }, { x: -50, z: -60 },
    ],
    laps: 2,
    reward: 300,
  },
  {
    id: "sunset-strip-run",
    name: "Sunset Strip Run",
    district: "Sunset Strip",
    desc: "Neon run down the Strip at golden hour.",
    checkpoints: [
      { x: 120, z: -60 }, { x: 160, z: -20 }, { x: 180, z: 40 },
      { x: 140, z: 80 }, { x: 90, z: 40 }, { x: 100, z: -20 },
    ],
    laps: 2,
    reward: 350,
  },
  {
    id: "harbor-drift",
    name: "Harbor Drift",
    district: "Harbor Point",
    desc: "Tight corners around the harbor docks.",
    checkpoints: [
      { x: -220, z: -80 }, { x: -180, z: -110 }, { x: -140, z: -90 },
      { x: -150, z: -40 }, { x: -190, z: -30 }, { x: -210, z: -50 },
    ],
    laps: 3,
    reward: 400,
  },
  {
    id: "north-hills-climb",
    name: "North Hills Climb",
    district: "North Hills",
    desc: "Uphill climb through the wealthy hills.",
    checkpoints: [
      { x: 60, z: 180 }, { x: 100, z: 150 }, { x: 140, z: 180 },
      { x: 120, z: 220 }, { x: 70, z: 230 }, { x: 40, z: 200 },
    ],
    laps: 2,
    reward: 450,
  },
  {
    id: "airport-express",
    name: "Airport Express",
    district: "Airport South",
    desc: "Long straights past the airport runways.",
    checkpoints: [
      { x: 260, z: -160 }, { x: 300, z: -120 }, { x: 280, z: -60 },
      { x: 230, z: -80 }, { x: 220, z: -140 }, { x: 240, z: -170 },
    ],
    laps: 2,
    reward: 500,
  },
  {
    id: "industrial-gp",
    name: "Industrial GP",
    district: "Industrial Docks",
    desc: "The championship loop through the docks.",
    checkpoints: [
      { x: 240, z: 20 }, { x: 280, z: 60 }, { x: 260, z: 110 },
      { x: 210, z: 90 }, { x: 200, z: 40 }, { x: 220, z: 0 },
    ],
    laps: 3,
    reward: 600,
  },
];

const Races = {
  TRACKS,

  // State balapan yang sedang berjalan (null bila tidak ada balapan).
  active: null,

  // Catatan waktu terbaik per trek: { trackId: detik }.
  bestTimes: {},

  // Jumlah balapan yang sudah dimenangkan.
  wins: 0,

  // Cari trek berdasarkan id. null bila tidak ada.
  getTrack(id) {
    return TRACKS.find((t) => t.id === id) || null;
  },

  // Apakah sedang ada balapan berjalan?
  isRacing() {
    return !!this.active;
  },

  // Mulai balapan di sebuah trek. Mengembalikan state balapan, atau null
  // bila id tidak dikenal / sudah ada balapan berjalan.
  startRace(id) {
    const track = this.getTrack(id);
    if (!track) return null;
    if (this.active) return null; // selesaikan / batalkan dulu balapan lama
    const start = this.playerPos() || { x: track.checkpoints[0].x, z: track.checkpoints[0].z };
    this.active = {
      trackId: track.id,
      name: track.name,
      district: track.district,
      reward: track.reward,
      laps: track.laps,
      lap: 1,
      checkpointIndex: 0,
      checkpointsHit: 0,
      totalCheckpoints: track.checkpoints.length * track.laps,
      time: 0,
      startedAt: Date.now(),
      startPos: start,
      finished: false,
    };
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("mission"); } catch (e) { /* audio belum init */ }
    }
    return this.active;
  },

  // Batalkan balapan yang sedang berjalan (tanpa hadiah).
  cancelRace() {
    if (!this.active) return false;
    this.active = null;
    return true;
  },

  // Posisi pemain saat ini {x, z} atau null bila tidak diketahui.
  playerPos() {
    if (window.SB.Player && window.SB.Player.pos) {
      return { x: window.SB.Player.pos.x, z: window.SB.Player.pos.z };
    }
    if (window.SB.Game && window.SB.Game.state && window.SB.Game.state.player) {
      const p = window.SB.Game.state.player;
      if (p.pos) return { x: p.pos.x, z: p.pos.z };
      return { x: p.x || 0, z: p.z || 0 };
    }
    return null;
  },

  // Checkpoint yang sedang dituju (atau null bila tidak balapan).
  nextCheckpoint() {
    if (!this.active) return null;
    const track = this.getTrack(this.active.trackId);
    if (!track) return null;
    return track.checkpoints[this.active.checkpointIndex];
  },

  // Jarak pemain ke checkpoint berikutnya (meter), Infinity bila tidak balapan.
  distanceToNext() {
    const cp = this.nextCheckpoint();
    const pos = this.playerPos();
    if (!cp || !pos) return Infinity;
    return dist2D(pos.x, pos.z, cp.x, cp.z);
  },

  // Update per frame: timer jalan, cek checkpoint, hitung lap.
  // Bila lap terakhir selesai -> finishRace() otomatis.
  update(dt) {
    if (!this.active || this.active.finished) return;
    if (!dt || dt <= 0) return;
    this.active.time += dt;

    const track = this.getTrack(this.active.trackId);
    if (!track) { this.active = null; return; }
    const pos = this.playerPos();
    if (!pos) return;

    const cp = track.checkpoints[this.active.checkpointIndex];
    if (dist2D(pos.x, pos.z, cp.x, cp.z) <= CHECKPOINT_RADIUS) {
      this.active.checkpointIndex += 1;
      this.active.checkpointsHit += 1;
      if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
        try { window.SB.Audio.sfx("pickup"); } catch (e) { /* audio belum init */ }
      }
      // Satu putaran penuh selesai -> lap berikutnya / finis.
      if (this.active.checkpointIndex >= track.checkpoints.length) {
        this.active.checkpointIndex = 0;
        this.active.lap += 1;
        if (this.active.lap > track.laps) {
          this.finishRace();
        }
      }
    }
  },

  // Selesaikan balapan: beri hadiah cash + respect distrik trek.
  // Mengembalikan { won, time, reward, respectGained } atau null bila tidak balapan.
  finishRace() {
    if (!this.active) return null;
    const race = this.active;
    this.active = null;
    race.finished = true;

    const time = race.time;
    const prevBest = this.bestTimes[race.trackId];
    const isBest = prevBest == null || time < prevBest;
    if (isBest) this.bestTimes[race.trackId] = time;
    this.wins += 1;

    // Hadiah: reward dasar + bonus 10% bila memecahkan rekor pribadi.
    const reward = isBest ? Math.round(race.reward * 1.1) : race.reward;
    if (window.SB.Economy && typeof window.SB.Economy.earn === "function") {
      try { window.SB.Economy.earn("race", reward); } catch (e) { /* abaikan */ }
    } else if (window.SB.Game && typeof window.SB.Game.addCash === "function") {
      try { window.SB.Game.addCash(reward); } catch (e) { /* abaikan */ }
    }

    // Respect naik di distrik trek (+12, +6 bila bukan rekor).
    let respectGained = 0;
    if (window.SB.Respect && typeof window.SB.Respect.gain === "function") {
      try {
        const before = window.SB.Respect.getStanding(race.district);
        window.SB.Respect.gain(race.district, isBest ? 12 : 6);
        respectGained = window.SB.Respect.getStanding(race.district) - before;
      } catch (e) { /* abaikan */ }
    }

    // Kru ikut senang: loyalty naik sedikit.
    if (window.SB.Crew && typeof window.SB.Crew.onMissionSuccess === "function") {
      try { window.SB.Crew.onMissionSuccess(); } catch (e) { /* abaikan */ }
    }

    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("mission"); } catch (e) { /* audio belum init */ }
    }

    this.lastResult = {
      won: true,
      trackId: race.trackId,
      name: race.name,
      time,
      best: isBest,
      reward,
      respectGained,
    };
    return this.lastResult;
  },

  // Hasil balapan terakhir (null bila belum pernah finis).
  lastResult: null,

  // Waktu terbaik sebuah trek (detik), atau null bila belum pernah finis.
  bestTime(id) {
    const t = this.bestTimes[id];
    return t == null ? null : t;
  },

  // Progress balapan aktif 0..1 (untuk HUD bar).
  progress() {
    if (!this.active) return 0;
    return clamp(this.active.checkpointsHit / this.active.totalCheckpoints, 0, 1);
  },

  // Ringkasan trek untuk menu balap (nama, distrik, laps, reward, best time).
  listTracks() {
    return TRACKS.map((t) => ({
      id: t.id,
      name: t.name,
      district: t.district,
      laps: t.laps,
      reward: t.reward,
      checkpoints: t.checkpoints.length,
      bestTime: this.bestTimes[t.id] || null,
    }));
  },

  // Reset state balapan (new game).
  reset() {
    this.active = null;
    this.bestTimes = {};
    this.wins = 0;
    this.lastResult = null;
  },

  // Muat dari save (dipakai SB.Game.load).
  loadFrom(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.wins === "number") this.wins = data.wins;
    if (data.bestTimes && typeof data.bestTimes === "object") this.bestTimes = data.bestTimes;
  },

  // Ekspor untuk save.
  saveTo() {
    return { wins: this.wins, bestTimes: this.bestTimes };
  },
};

window.SB.Races = Races;

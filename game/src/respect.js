// Sunset Bay v14 — SB.Respect
// District standing (0-100 per district) + 5 respect ranks.
// Standing naik dari misi / balap di distrik itu; rank naik dari total standing.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).
// Daftar distrik HARUS SAMA PERSIS dengan spec §3 (14 distrik).

window.SB = window.SB || {};

// 14 distrik — NAMA + pusat x,z + radius, PERSIS spec §3.
// (x, z; y = 0 tanah. Radius dalam meter.)
const DISTRICTS = [
  { name: "Marina Bay",        x: 0,    z: 0,    r: 120 },
  { name: "Old Town",          x: -120, z: 40,   r: 90  },
  { name: "Fisherman's Wharf", x: -185, z: 40,   r: 55  },
  { name: "Sunset Strip",      x: 120,  z: -60,  r: 100 },
  { name: "North Hills",       x: 60,   z: 180,  r: 110 },
  { name: "East Market",       x: 200,  z: 80,   r: 90  },
  { name: "Harbor Point",      x: -220, z: -80,  r: 80  },
  { name: "Palm Court",        x: 40,   z: -180, r: 90  },
  { name: "Coral District",    x: -60,  z: -140, r: 80  },
  { name: "Beacon Hill",       x: 180,  z: 180,  r: 100 },
  { name: "Little Havana",     x: -160, z: 160,  r: 90  },
  { name: "Airport South",     x: 260,  z: -160, r: 110 },
  { name: "University Row",    x: -40,  z: 220,  r: 90  },
  { name: "Industrial Docks",  x: 240,  z: 20,   r: 100 },
];

// 5 tingkat respect. `min` = total standing minimum untuk mencapai tingkat itu.
const RANKS = [
  { level: 0, name: "Street",    min: 0,    title: "Street Nobody",   perk: "No perks yet. Prove yourself." },
  { level: 1, name: "Hustler",   min: 150,  title: "Local Hustler",   perk: "5% shop discount city-wide." },
  { name: "Respected", level: 2, min: 400,  title: "Respected Face",  perk: "10% shop discount, new missions open." },
  { level: 3, name: "Boss",      min: 800,  title: "Neighborhood Boss", perk: "15% shop discount, crew loyalty rises faster." },
  { level: 4, name: "Kingpin",   min: 1400, title: "Sunset Bay Kingpin", perk: "25% shop discount, every district respects you." },
];

// Standing awal: pemain dikenal sedikit di Marina Bay (distrik awal), 0 di tempat lain.
const START_STANDING = { "Marina Bay": 10 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function buildStanding() {
  const s = {};
  for (const d of DISTRICTS) s[d.name] = START_STANDING[d.name] || 0;
  return s;
}

const Respect = {
  DISTRICTS,
  RANKS,

  // Standing per distrik, 0-100. Kunci = nama distrik persis §3.
  STANDING: buildStanding(),

  // Total standing di semua distrik (maks 14 x 100 = 1400).
  total() {
    let sum = 0;
    for (const d of DISTRICTS) sum += this.STANDING[d.name] || 0;
    return sum;
  },

  // Total maksimum yang mungkin (dipakai HUD progress bar).
  maxTotal() {
    return DISTRICTS.length * 100;
  },

  // Standing satu distrik (0 kalau nama tidak dikenal).
  getStanding(district) {
    if (!district) return 0;
    return this.STANDING[district] || 0;
  },

  // Nama distrik yang dikenali (persis §3), atau null.
  isDistrict(name) {
    return DISTRICTS.some((d) => d.name === name);
  },

  // Naikkan standing sebuah distrik sebesar n (clamp 0-100).
  // Dipanggil misi / balap / heist saat berhasil di distrik itu.
  // Mengembalikan standing baru. Naik rank -> notifikasi + bonus loyalty crew.
  gain(district, n) {
    if (!district || !this.isDistrict(district)) return 0;
    const before = this.STANDING[district];
    const rankBefore = this.rank();
    this.STANDING[district] = clamp(before + n, 0, 100);
    const gained = this.STANDING[district] - before;
    if (gained > 0) {
      const rankAfter = this.rank();
      if (rankAfter.level > rankBefore.level) {
        this.onRankUp(rankAfter, rankBefore);
      }
      // Simpan ke save game bila modul Game tersedia.
      if (window.SB.Game && typeof window.SB.Game.save === "function") {
        try { window.SB.Game.save(); } catch (e) { /* save gagal: abaikan, standing tetap di memori */ }
      }
    }
    return this.STANDING[district];
  },

  // Turunkan standing (mis. misi gagal, warga dikhianati). Clamp 0-100.
  lose(district, n) {
    if (!district || !this.isDistrict(district)) return 0;
    this.STANDING[district] = clamp(this.STANDING[district] - n, 0, 100);
    return this.STANDING[district];
  },

  // Rank saat ini dari total standing.
  rank() {
    const t = this.total();
    let cur = RANKS[0];
    for (const r of RANKS) {
      if (t >= r.min) cur = r;
    }
    return cur;
  },

  // Rank berikutnya + berapa standing lagi yang dibutuhkan (null bila sudah Kingpin).
  nextRank() {
    const cur = this.rank();
    if (cur.level >= RANKS.length - 1) return null;
    const next = RANKS[cur.level + 1];
    return { rank: next, needed: next.min - this.total() };
  },

  // Apakah rank tertentu sudah tercapai (dipakai Missions untuk membuka misi).
  hasRank(level) {
    return this.rank().level >= level;
  },

  // Apakah standing distrik mencapai ambang (dipakai Missions / Economy).
  hasStanding(district, min) {
    return this.getStanding(district) >= min;
  },

  // Distrik dengan standing tertinggi (markas / basis pemain).
  homeDistrict() {
    let best = DISTRICTS[0].name;
    let bestVal = -1;
    for (const d of DISTRICTS) {
      const v = this.STANDING[d.name] || 0;
      if (v > bestVal) { bestVal = v; best = d.name; }
    }
    return best;
  },

  // Dipanggil saat rank naik: bunyi + pesan + loyalty crew ikut naik.
  onRankUp(rankAfter, rankBefore) {
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("mission"); } catch (e) { /* audio belum init */ }
    }
    if (window.SB.Game && window.SB.Game.state) {
      window.SB.Game.state.lastRankUp = {
        from: rankBefore.name,
        to: rankAfter.name,
        at: Date.now(),
      };
    }
    // Crew ikut bangga: loyalty semua anggota naik sedikit.
    if (window.SB.Crew && typeof window.SB.Crew.boostLoyalty === "function") {
      try { window.SB.Crew.boostLoyalty(5); } catch (e) { /* crew belum siap */ }
    }
    this.lastRankUp = { from: rankBefore.name, to: rankAfter.name };
  },

  // Reset semua standing ke awal (dipakai new game).
  reset() {
    this.STANDING = buildStanding();
    this.lastRankUp = null;
  },

  // Muat standing dari save (dipakai SB.Game.load).
  loadFrom(data) {
    if (!data || typeof data !== "object") return;
    for (const d of DISTRICTS) {
      if (typeof data[d.name] === "number") {
        this.STANDING[d.name] = clamp(data[d.name], 0, 100);
      }
    }
  },

  // Ekspor standing untuk save.
  saveTo() {
    const out = {};
    for (const d of DISTRICTS) out[d.name] = this.STANDING[d.name] || 0;
    return out;
  },
};

window.SB.Respect = Respect;

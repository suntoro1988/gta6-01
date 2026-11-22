// Sunset Bay v14 — SB.Economy
// Uang pemain: cash, gaji job (taksi / kurir / balap), beli & jual item.
// Harga dipengaruhi standing distrik (SB.Respect): makin dihormati di sebuah
// distrik, makin murah harga di sana. Juga dipengaruhi rank global.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).
// Daftar distrik HARUS SAMA PERSIS dengan spec §3 (14 distrik).

window.SB = window.SB || {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 14 distrik — NAMA + pusat x,z + radius, PERSIS spec §3.
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

// Pekerjaan harian: gaji per job (bukan per jam). `pay` = gaji dasar;
// gaji akhir naik sedikit mengikuti rank pemain.
const JOBS = [
  { id: "taxi",    name: "Taxi Driver",   desc: "Drive passengers across the city.",      pay: 60,  time: 90  },
  { id: "courier", name: "Courier",       desc: "Deliver packages on foot or by car.",    pay: 45,  time: 60  },
  { id: "race",    name: "Street Racer",  desc: "Win street races for big payouts.",      pay: 150, time: 180 },
];

// Katalog toko: item yang bisa dibeli (senjata, amunisi, perbaikan, respray).
const SHOP = [
  { id: "pistol",   name: "Pistol",          price: 250,  kind: "weapon" },
  { id: "smg",      name: "SMG",             price: 600,  kind: "weapon" },
  { id: "shotgun",  name: "Shotgun",         price: 800,  kind: "weapon" },
  { id: "ammo",     name: "Ammo Pack",       price: 50,   kind: "ammo"   },
  { id: "medkit",   name: "Medkit",          price: 80,   kind: "health" },
  { id: "armor",    name: "Body Armor",      price: 200,  kind: "armor"  },
  { id: "respray",  name: "Respray (car)",   price: 150,  kind: "service" },
  { id: "repair",   name: "Car Repair",      price: 120,  kind: "service" },
];

const START_CASH = 250;

const Economy = {
  DISTRICTS,
  JOBS,
  SHOP,

  // Uang pemain saat ini.
  cash: START_CASH,

  // Riwayat transaksi terakhir (untuk HUD / debug), maks 20 entri.
  history: [],

  // Item yang dimiliki pemain: { itemId: jumlah }.
  owned: {},

  // ---- Saldo ----
  getBalance() {
    this.syncFromGame();
    return this.cash;
  },

  // Sinkronisasi dengan SB.Game.state.cash bila modul Game sudah jalan.
  // Game adalah sumber save; Economy memegang angka yang sedang dipakai.
  syncFromGame() {
    if (window.SB.Game && window.SB.Game.state &&
        typeof window.SB.Game.state.cash === "number") {
      this.cash = window.SB.Game.state.cash;
    }
  },

  syncToGame() {
    if (window.SB.Game && window.SB.Game.state) {
      window.SB.Game.state.cash = this.cash;
    }
  },

  // ---- Harga & standing ----
  // Standing pemain di sebuah distrik (0-100). Baca dari SB.Respect bila ada.
  standingIn(district) {
    if (window.SB.Respect && typeof window.SB.Respect.getStanding === "function") {
      return window.SB.Respect.getStanding(district);
    }
    return 0;
  },

  // Diskon di sebuah distrik dari standing: 0% di 0, sampai 25% di 100.
  // Plus diskon rank global: Hustler +5%, Respected +10%, Boss +15%, Kingpin +25%
  // (diambil dari rank tertinggi, bukan dijumlah dengan diskon distrik).
  discountIn(district) {
    const standing = this.standingIn(district);
    let discount = (standing / 100) * 0.25;
    if (window.SB.Respect && typeof window.SB.Respect.rank === "function") {
      const rank = window.SB.Respect.rank();
      const rankBonus = [0, 0.05, 0.10, 0.15, 0.25][rank.level] || 0;
      discount = Math.max(discount, rankBonus);
    }
    return clamp(discount, 0, 0.25);
  },

  // Harga akhir sebuah item di sebuah distrik (setelah diskon standing/rank).
  // district boleh null -> harga dasar (tanpa diskon distrik, hanya rank).
  priceFor(basePrice, district) {
    const discount = district ? this.discountIn(district) : 0;
    return Math.max(1, Math.round(basePrice * (1 - discount)));
  },

  // Harga item katalog di distrik tertentu (atau harga dasar bila tanpa distrik).
  shopPrice(itemId, district) {
    const item = SHOP.find((s) => s.id === itemId);
    if (!item) return null;
    return this.priceFor(item.price, district);
  },

  // ---- Pemasukan ----
  // Terima gaji / hadiah. job = id job ('taxi'/'courier'/'race') atau nama bebas
  // ('mission', 'heist', 'pickup', ...). amount = jumlah cash.
  // Mengembalikan saldo baru.
  earn(job, amount) {
    const n = Math.round(amount || 0);
    if (n <= 0) return this.cash;
    // Bonus gaji job: +2% per level rank (Kingpin = +8%).
    let final = n;
    if (job && window.SB.Respect && typeof window.SB.Respect.rank === "function") {
      const level = window.SB.Respect.rank().level;
      final = Math.round(n * (1 + level * 0.02));
    }
    this.cash += final;
    this.syncToGame();
    this.log("earn", job || "cash", final);
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("pickup"); } catch (e) { /* audio belum init */ }
    }
    return this.cash;
  },

  // Gaji dasar sebuah job (tanpa bonus rank).
  jobPay(jobId) {
    const job = JOBS.find((j) => j.id === jobId);
    return job ? job.pay : 0;
  },

  // Kerjakan satu job sampai selesai (dipanggil Missions / Game saat job tamat).
  completeJob(jobId) {
    const pay = this.jobPay(jobId);
    if (!pay) return 0;
    return this.earn(jobId, pay);
  },

  // ---- Pengeluaran ----
  // Keluarkan uang. Mengembalikan true bila saldo cukup, false bila tidak.
  spend(amount) {
    const n = Math.round(amount || 0);
    if (n <= 0) return true;
    this.syncFromGame();
    if (this.cash < n) return false;
    this.cash -= n;
    this.syncToGame();
    this.log("spend", "cash", -n);
    return true;
  },

  // Beli item dari katalog. price boleh diisi harga khusus (mis. harga distrik);
  // bila tidak diisi, dipakai harga katalog (+ diskon distrik bila district diisi).
  // Mengembalikan true bila berhasil (uang cukup + item ada).
  buy(item, price, district) {
    const itemId = typeof item === "string" ? item : (item && item.id);
    const entry = SHOP.find((s) => s.id === itemId);
    if (!entry && price == null) return false;
    const finalPrice = price != null
      ? Math.round(price)
      : this.priceFor(entry.price, district);
    if (!this.spend(finalPrice)) return false;
    this.owned[itemId] = (this.owned[itemId] || 0) + 1;
    this.log("buy", itemId, -finalPrice);
    // Senjata yang dibeli langsung masuk ke SB.Weapons bila modulnya ada.
    if (window.SB.Weapons && entry && entry.kind === "weapon" &&
        typeof window.SB.Weapons.unlock === "function") {
      try { window.SB.Weapons.unlock(itemId); } catch (e) { /* abaikan */ }
    }
    return true;
  },

  // Jual item yang dimiliki kembali seharga 50% harga katalog.
  // Mengembalikan jumlah cash yang diterima, atau 0 bila tidak punya itemnya.
  sell(item, price) {
    const itemId = typeof item === "string" ? item : (item && item.id);
    if (!itemId || !this.owned[itemId]) return 0;
    const entry = SHOP.find((s) => s.id === itemId);
    const value = price != null
      ? Math.round(price)
      : (entry ? Math.round(entry.price * 0.5) : 0);
    if (value <= 0) return 0;
    this.owned[itemId] -= 1;
    if (this.owned[itemId] <= 0) delete this.owned[itemId];
    this.cash += value;
    this.syncToGame();
    this.log("sell", itemId, value);
    return value;
  },

  // Apakah pemain memiliki item (jumlah > 0)?
  has(itemId) {
    return (this.owned[itemId] || 0) > 0;
  },

  // Jumlah item yang dimiliki.
  count(itemId) {
    return this.owned[itemId] || 0;
  },

  // ---- Util ----
  log(type, label, amount) {
    this.history.unshift({ type, label, amount, at: Date.now() });
    if (this.history.length > 20) this.history.length = 20;
  },

  // Distrik tempat pemain berada saat ini (dipakai untuk harga toko lokal).
  // Membaca posisi pemain bila tersedia, kalau tidak kembalikan null.
  currentDistrict() {
    const pos = window.SB.Player && window.SB.Player.pos;
    if (pos && window.SB.City && typeof window.SB.City.getDistrictAt === "function") {
      try { return window.SB.City.getDistrictAt(pos.x, pos.z); } catch (e) { return null; }
    }
    if (pos) {
      // Fallback tanpa City: distrik terdekat dari pusatnya.
      let best = null;
      let bestD = Infinity;
      for (const d of DISTRICTS) {
        const dx = pos.x - d.x;
        const dz = pos.z - d.z;
        const dist = dx * dx + dz * dz;
        if (dist < bestD) { bestD = dist; best = d.name; }
      }
      return best;
    }
    return null;
  },

  // Reset ekonomi ke awal (new game).
  reset() {
    this.cash = START_CASH;
    this.history = [];
    this.owned = {};
    this.syncToGame();
  },

  // Muat dari save (dipakai SB.Game.load).
  loadFrom(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.cash === "number") this.cash = Math.max(0, Math.round(data.cash));
    if (data.owned && typeof data.owned === "object") this.owned = data.owned;
    this.syncToGame();
  },

  // Ekspor untuk save.
  saveTo() {
    return { cash: this.cash, owned: this.owned };
  },
};

window.SB.Economy = Economy;

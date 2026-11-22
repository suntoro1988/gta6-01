// Sunset Bay v14 — SB.Crew
// Kru 5 anggota: rekrut, tugaskan, loyalty naik saat misi sukses,
// turun bila anggota diabaikan. Anggota memberi bonus nyata:
// driver = mobil lebih cepat, hacker = buka jalan / matikan alarm,
// gunman = damage senjata naik, lookout = wanted turun lebih cepat,
// mechanic = mobil lebih awet / respray lebih murah.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).

window.SB = window.SB || {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Skill yang dikenal + deskripsi bonusnya.
const SKILLS = {
  driver:   { label: "Driver",   bonus: "Getaway driving: +12% top speed, sharper handling." },
  hacker:   { label: "Hacker",   bonus: "Opens locked routes, kills alarms, cuts heist prep time." },
  gunman:   { label: "Gunman",   bonus: "+20% weapon damage while assigned as backup." },
  lookout:  { label: "Lookout",  bonus: "Wanted heat fades 25% faster, warns of police nearby." },
  mechanic: { label: "Mechanic", bonus: "Cars take less damage, respray costs 40% less." },
};

// Tugas yang bisa diberikan ke anggota.
const JOBS = [
  "getaway driver",
  "hacker",
  "backup",
  "lookout",
  "mechanic",
  "idle",
];

// Urutan skill default untuk rekrut tanpa skill eksplisit.
const RECRUIT_SKILL_ORDER = ["driver", "hacker", "gunman", "lookout", "mechanic"];

function makeMember(name, skill, loyalty) {
  const s = SKILLS[skill] ? skill : "driver";
  return {
    name,
    skill: s,
    skillLabel: SKILLS[s].label,
    loyalty: clamp(loyalty == null ? 50 : loyalty, 0, 100),
    job: "idle",        // tugas saat ini (lihat JOBS)
    busy: false,        // sedang menjalankan tugas (timer berjalan)
    busyTimer: 0,       // detik tersisa sampai tugas selesai
    missionsDone: 0,    // misi sukses bersama anggota ini
    ignoredTime: 0,     // detik sejak terakhir diberi tugas / dipakai
    recruitedAt: Date.now(),
  };
}

const Crew = {
  SKILLS,
  JOBS,

  // 5 anggota awal. Loyalty awal 50 (netral) — naik lewat misi sukses.
  MEMBERS: [
    makeMember("Rico",   "driver",   55),
    makeMember("Maya",   "hacker",   50),
    makeMember("Dante",  "gunman",   45),
    makeMember("Lena",   "lookout",  60),
    makeMember("Otis",   "mechanic", 50),
  ],

  // Cari anggota berdasarkan nama (case-insensitive). null bila tidak ada.
  getMember(name) {
    if (!name) return null;
    const lower = String(name).toLowerCase();
    return this.MEMBERS.find((m) => m.name.toLowerCase() === lower) || null;
  },

  // Rekrut anggota baru. Nama wajib unik; skill opsional (default bergilir).
  // Mengembalikan member baru, atau null bila nama sudah ada / kosong.
  recruit(name, skill) {
    if (!name || typeof name !== "string") return null;
    const clean = name.trim();
    if (!clean) return null;
    if (this.getMember(clean)) return null; // sudah jadi anggota
    const s = skill && SKILLS[skill]
      ? skill
      : RECRUIT_SKILL_ORDER[this.MEMBERS.length % RECRUIT_SKILL_ORDER.length];
    const member = makeMember(clean, s, 40); // rekrutan baru mulai di 40
    this.MEMBERS.push(member);
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("pickup"); } catch (e) { /* audio belum init */ }
    }
    return member;
  },

  // Tugaskan anggota ke sebuah pekerjaan.
  // Bentuk pemakaian: assign("Rico", "getaway driver")
  // atau assign({ member: "Rico", task: "getaway driver" }).
  // Mengembalikan true bila berhasil.
  assign(job, memberName) {
    let member = null;
    let task = null;
    if (typeof job === "object" && job) {
      member = this.getMember(job.member || job.name);
      task = job.task || job.job || null;
    } else if (typeof job === "string" && typeof memberName === "string") {
      member = this.getMember(memberName);
      task = job;
    } else if (typeof job === "string") {
      // assign("getaway driver") saja: tugaskan anggota idle pertama yang cocok.
      task = job;
      member = this.MEMBERS.find((m) => !m.busy && m.job === "idle") || null;
    }
    if (!member || !task) return false;
    if (JOBS.indexOf(task) === -1) return false;
    member.job = task;
    member.busy = task !== "idle";
    member.busyTimer = task === "idle" ? 0 : 30; // tugas berlangsung ~30 detik
    member.ignoredTime = 0;
    return true;
  },

  // Lepaskan anggota dari tugasnya (kembali idle).
  unassign(name) {
    const member = this.getMember(name);
    if (!member) return false;
    member.job = "idle";
    member.busy = false;
    member.busyTimer = 0;
    return true;
  },

  // Anggota yang sedang bertugas pada pekerjaan tertentu (atau semua yang sibuk).
  assigned(job) {
    if (!job) return this.MEMBERS.filter((m) => m.busy);
    return this.MEMBERS.filter((m) => m.job === job);
  },

  // Apakah ada anggota dengan skill tertentu yang sedang bertugas.
  hasActive(skill) {
    return this.MEMBERS.some((m) => m.skill === skill && m.busy && m.loyalty >= 30);
  },

  // ---- Bonus anggota (dipakai modul lain lewat SB.Crew.*) ----
  // Bonus hanya aktif bila anggota loyal (>= 30) dan sedang ditugaskan,
  // kecuali driverBonus yang memakai anggota driver yang ditugaskan getaway.

  // Pengali top speed mobil dari driver yang ditugaskan (1.0 = tanpa bonus).
  driverBonus() {
    const d = this.MEMBERS.find((m) => m.skill === "driver" && m.job === "getaway driver");
    if (!d || d.loyalty < 30) return 1;
    return 1 + 0.12 * (d.loyalty / 100);
  },

  // Pengali damage senjata dari gunman yang ditugaskan sebagai backup.
  gunmanBonus() {
    const g = this.MEMBERS.find((m) => m.skill === "gunman" && m.job === "backup");
    if (!g || g.loyalty < 30) return 1;
    return 1 + 0.2 * (g.loyalty / 100);
  },

  // Pengali kecepatan hilangnya wanted dari lookout yang ditugaskan.
  lookoutBonus() {
    const l = this.MEMBERS.find((m) => m.skill === "lookout" && m.job === "lookout");
    if (!l || l.loyalty < 30) return 1;
    return 1 + 0.25 * (l.loyalty / 100);
  },

  // Pengali biaya respray dari mechanic yang ditugaskan (1.0 = harga penuh).
  mechanicBonus() {
    const m = this.MEMBERS.find((x) => x.skill === "mechanic" && x.job === "mechanic");
    if (!m || m.loyalty < 30) return 1;
    return 1 - 0.4 * (m.loyalty / 100);
  },

  // Hacker aktif? (dipakai SB.Heist: prep lebih cepat, alarm mati.)
  hackerBonus() {
    const h = this.MEMBERS.find((m) => m.skill === "hacker" && m.job === "hacker");
    if (!h || h.loyalty < 30) return 1;
    return 1 + 0.3 * (h.loyalty / 100);
  },

  // Bonus umum: rata-rata loyalty kru (0..1), dipakai Missions untuk bonus cash.
  morale() {
    if (!this.MEMBERS.length) return 0;
    let sum = 0;
    for (const m of this.MEMBERS) sum += m.loyalty;
    return sum / this.MEMBERS.length / 100;
  },

  // ---- Loyalty ----
  // Naikkan loyalty satu anggota (clamp 0-100).
  raiseLoyalty(name, n) {
    const m = this.getMember(name);
    if (!m) return false;
    m.loyalty = clamp(m.loyalty + n, 0, 100);
    m.ignoredTime = 0;
    return true;
  },

  // Turunkan loyalty satu anggota (clamp 0-100).
  lowerLoyalty(name, n) {
    const m = this.getMember(name);
    if (!m) return false;
    m.loyalty = clamp(m.loyalty - n, 0, 100);
    return true;
  },

  // Naikkan loyalty SEMUA anggota (dipakai saat rank naik / heist sukses).
  boostLoyalty(n) {
    for (const m of this.MEMBERS) m.loyalty = clamp(m.loyalty + n, 0, 100);
  },

  // Dipanggil saat misi sukses: anggota yang ikut (atau semua yang bertugas)
  // naik loyalty +8 dan dihitung missionsDone-nya.
  onMissionSuccess(memberName) {
    const involved = memberName
      ? [this.getMember(memberName)].filter(Boolean)
      : this.MEMBERS.filter((m) => m.busy);
    const list = involved.length ? involved : this.MEMBERS;
    for (const m of list) {
      m.loyalty = clamp(m.loyalty + 8, 0, 100);
      m.missionsDone += 1;
      m.ignoredTime = 0;
    }
    return list.map((m) => m.name);
  },

  // Dipanggil saat misi gagal: anggota yang ikut turun loyalty -6.
  onMissionFailed(memberName) {
    const involved = memberName
      ? [this.getMember(memberName)].filter(Boolean)
      : this.MEMBERS.filter((m) => m.busy);
    for (const m of involved) {
      m.loyalty = clamp(m.loyalty - 6, 0, 100);
    }
    return involved.map((m) => m.name);
  },

  // Anggota dengan loyalty < 25 dianggap "di ambang pergi": tidak memberi bonus
  // dan bisa keluar kru bila terus diabaikan (lihat update()).
  atRisk() {
    return this.MEMBERS.filter((m) => m.loyalty < 25);
  },

  // ---- Update per frame ----
  // dt dalam detik. Menjalankan timer tugas dan penurunan loyalty anggota
  // yang diabaikan (idle lebih dari 120 detik tanpa tugas).
  update(dt) {
    if (!dt || dt <= 0) return;
    for (const m of this.MEMBERS) {
      if (m.busy) {
        m.busyTimer -= dt;
        if (m.busyTimer <= 0) {
          m.busy = false;
          m.busyTimer = 0;
          m.job = "idle";
          // Tugas selesai dengan baik: loyalty naik sedikit.
          m.loyalty = clamp(m.loyalty + 2, 0, 100);
        }
      } else {
        m.ignoredTime += dt;
        // Diabaikan lebih dari 2 menit: loyalty turun pelan (1 per 10 detik).
        if (m.ignoredTime > 120) {
          m.loyalty = clamp(m.loyalty - dt * 0.1, 0, 100);
        }
      }
    }
    // Anggota yang loyalty-nya 0 dan diabaikan lama keluar dari kru
    // (tapi kru tidak boleh kosong: minimal 1 anggota tersisa).
    for (let i = this.MEMBERS.length - 1; i >= 0; i--) {
      const m = this.MEMBERS[i];
      if (m.loyalty <= 0 && m.ignoredTime > 300 && this.MEMBERS.length > 1) {
        this.MEMBERS.splice(i, 1);
        this.lastLeft = m.name;
      }
    }
  },

  // Ringkasan kru untuk HUD (nama, skill, loyalty, job).
  summary() {
    return this.MEMBERS.map((m) => ({
      name: m.name,
      skill: m.skill,
      loyalty: Math.round(m.loyalty),
      job: m.job,
      busy: m.busy,
    }));
  },

  lastLeft: null,
};

window.SB.Crew = Crew;

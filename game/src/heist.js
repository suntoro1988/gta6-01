// Sunset Bay v14 — SB.Heist
// Heist besar sebagai misi puncak: 3 fase (recon -> prep -> execute).
// Tiap fase punya daftar tugas; advance() hanya bisa lanjut bila semua tugas
// fase saat ini selesai. Saat fase execute berjalan, wanted naik tinggi dan
// timer berjalan; sukses = hadiah besar + respect besar.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).

window.SB = window.SB || {};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// 3 fase heist. Tiap fase: { id, title, desc, tasks: [{id, text, done}] }.
// `reward` hanya di fase execute (hadiah akhir heist).
const PHASES = [
  {
    id: "recon",
    title: "Recon",
    desc: "Scout the Marina Bay vault: map the cameras, guards and escape route.",
    tasks: [
      { id: "scout-vault",   text: "Photograph the vault entrance",      done: false },
      { id: "map-cameras",   text: "Mark all security cameras",         done: false },
      { id: "guard-routine", text: "Learn the guard patrol routine",    done: false },
      { id: "escape-route",  text: "Plan the getaway route to the docks", done: false },
    ],
  },
  {
    id: "prep",
    title: "Prep",
    desc: "Get the crew and gear ready: masks, a fast car and a hacker on the inside.",
    tasks: [
      { id: "get-masks",     text: "Buy masks and gloves",              done: false },
      { id: "fast-car",      text: "Steal a fast getaway car",          done: false },
      { id: "hire-hacker",   text: "Assign Maya to kill the alarms",    done: false },
      { id: "buy-gear",      text: "Buy weapons and body armor",        done: false },
    ],
  },
  {
    id: "execute",
    title: "Execute",
    desc: "Hit the vault at sunset, grab the cash and outrun the whole city.",
    tasks: [
      { id: "enter-vault",   text: "Enter the vault undetected",        done: false },
      { id: "crack-safe",    text: "Crack the safe",                    done: false },
      { id: "grab-cash",     text: "Grab the cash",                     done: false },
      { id: "escape",        text: "Escape to the docks and lose the cops", done: false },
    ],
    reward: 5000,
    respect: 40,
    district: "Marina Bay",
  },
];

// Batas waktu fase execute (detik) sebelum polisi menutup jalan keluar.
const EXECUTE_TIME_LIMIT = 240;

// Wanted saat fase execute dimulai.
const EXECUTE_WANTED = 4;

const Heist = {
  PHASES,

  // State heist yang sedang berjalan (null bila belum dimulai).
  active: null,

  // Berapa heist yang sudah berhasil diselesaikan.
  completed: 0,

  // Apakah heist sedang berjalan?
  isActive() {
    return !!this.active;
  },

  // Fase saat ini (objek dari PHASES) atau null bila tidak ada heist aktif.
  currentPhase() {
    if (!this.active) return null;
    return PHASES[this.active.phaseIndex] || null;
  },

  // Nama fase saat ini ('recon' | 'prep' | 'execute') atau null.
  currentPhaseId() {
    const p = this.currentPhase();
    return p ? p.id : null;
  },

  // Mulai heist dari fase recon. Mengembalikan state heist, atau null bila
  // sudah ada heist berjalan.
  start() {
    if (this.active) return null;
    // Salin fase + tugas agar `done` tidak mencemari definisi PHASES.
    const phases = PHASES.map((p) => ({
      id: p.id,
      title: p.title,
      desc: p.desc,
      tasks: p.tasks.map((t) => ({ id: t.id, text: t.text, done: false })),
    }));
    this.active = {
      phases,
      phaseIndex: 0,
      startedAt: Date.now(),
      time: 0,          // total waktu sejak heist dimulai (detik)
      executeTime: 0,   // waktu di fase execute (detik)
      wantedRaised: false,
      finished: false,
      failed: false,
    };
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("mission"); } catch (e) { /* audio belum init */ }
    }
    return this.active;
  },

  // Tandai satu tugas selesai di fase saat ini. Mengembalikan true bila
  // tugas ditemukan dan belum selesai.
  completeTask(taskId) {
    if (!this.active) return false;
    const phase = this.active.phases[this.active.phaseIndex];
    if (!phase) return false;
    const task = phase.tasks.find((t) => t.id === taskId);
    if (!task || task.done) return false;
    task.done = true;
    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("pickup"); } catch (e) { /* audio belum init */ }
    }
    return true;
  },

  // Apakah semua tugas fase saat ini selesai?
  phaseDone() {
    if (!this.active) return false;
    const phase = this.active.phases[this.active.phaseIndex];
    if (!phase) return false;
    return phase.tasks.every((t) => t.done);
  },

  // Lanjut ke fase berikutnya. Hanya bisa bila semua tugas fase saat ini selesai.
  // Bila fase terakhir selesai -> heist sukses (complete()).
  // Mengembalikan fase baru, atau null bila belum bisa lanjut.
  advance() {
    if (!this.active || this.active.finished) return null;
    if (!this.phaseDone()) return null;
    // Fase execute selesai = heist sukses.
    if (this.active.phaseIndex >= this.active.phases.length - 1) {
      this.complete();
      return null;
    }
    this.active.phaseIndex += 1;
    const phase = this.currentPhase();
    // Memasuki fase execute: wanted langsung naik tinggi.
    if (phase && phase.id === "execute") {
      this.raiseWanted();
    }
    return phase;
  },

  // Naikkan wanted saat execute (dipakai advance() dan update()).
  raiseWanted() {
    if (!this.active || this.active.wantedRaised) return;
    this.active.wantedRaised = true;
    if (window.SB.Game && typeof window.SB.Game.setWanted === "function") {
      try { window.SB.Game.setWanted(EXECUTE_WANTED); } catch (e) { /* abaikan */ }
    } else if (window.SB.Police && typeof window.SB.Police.heat === "function") {
      try { window.SB.Police.heat(); } catch (e) { /* abaikan */ }
    }
  },

  // Update per frame: timer jalan; di fase execute, wanted dijaga tetap
  // tinggi dan batas waktu dihitung. Lewat batas waktu -> heist gagal.
  update(dt) {
    if (!this.active || this.active.finished || !dt || dt <= 0) return;
    this.active.time += dt;
    const phase = this.currentPhase();
    if (!phase) return;
    if (phase.id === "execute") {
      this.active.executeTime += dt;
      // Wanted dijaga tetap tinggi selama pelarian.
      if (window.SB.Game && window.SB.Game.state &&
          typeof window.SB.Game.state.wanted === "number" &&
          window.SB.Game.state.wanted < 3) {
        try { window.SB.Game.setWanted(3); } catch (e) { /* abaikan */ }
      }
      if (this.active.executeTime >= EXECUTE_TIME_LIMIT && !this.phaseDone()) {
        this.fail("The police sealed the escape route. The crew got away, but empty-handed.");
      }
    }
  },

  // Selesaikan heist dengan sukses: hadiah besar + respect + loyalty kru.
  // Mengembalikan hasil { reward, respectGained, time }.
  complete() {
    if (!this.active) return null;
    const heist = this.active;
    this.active = null;
    heist.finished = true;
    this.completed += 1;

    const execPhase = PHASES.find((p) => p.id === "execute") || {};
    const reward = execPhase.reward || 5000;

    if (window.SB.Economy && typeof window.SB.Economy.earn === "function") {
      try { window.SB.Economy.earn("heist", reward); } catch (e) { /* abaikan */ }
    } else if (window.SB.Game && typeof window.SB.Game.addCash === "function") {
      try { window.SB.Game.addCash(reward); } catch (e) { /* abaikan */ }
    }

    let respectGained = 0;
    if (window.SB.Respect && typeof window.SB.Respect.gain === "function") {
      try {
        const before = window.SB.Respect.getStanding(execPhase.district || "Marina Bay");
        window.SB.Respect.gain(execPhase.district || "Marina Bay", execPhase.respect || 40);
        respectGained = window.SB.Respect.getStanding(execPhase.district || "Marina Bay") - before;
      } catch (e) { /* abaikan */ }
    }

    if (window.SB.Crew && typeof window.SB.Crew.onMissionSuccess === "function") {
      try { window.SB.Crew.onMissionSuccess(); } catch (e) { /* abaikan */ }
    }
    if (window.SB.Crew && typeof window.SB.Crew.boostLoyalty === "function") {
      try { window.SB.Crew.boostLoyalty(5); } catch (e) { /* abaikan */ }
    }

    // Setelah heist sukses, wanted perlahan turun (pemain lolos).
    if (window.SB.Game && typeof window.SB.Game.setWanted === "function") {
      try { window.SB.Game.setWanted(1); } catch (e) { /* abaikan */ }
    }

    if (window.SB.Audio && typeof window.SB.Audio.sfx === "function") {
      try { window.SB.Audio.sfx("mission"); } catch (e) { /* audio belum init */ }
    }

    this.lastResult = {
      won: true,
      reward,
      respectGained,
      time: heist.time,
    };
    return this.lastResult;
  },

  // Heist gagal: tanpa hadiah, loyalty kru turun, wanted tetap.
  fail(reason) {
    if (!this.active) return null;
    this.active = null;
    if (window.SB.Crew && typeof window.SB.Crew.onMissionFailed === "function") {
      try { window.SB.Crew.onMissionFailed(); } catch (e) { /* abaikan */ }
    }
    this.lastResult = { won: false, reason: reason || "Heist failed.", reward: 0, respectGained: 0, time: 0 };
    return this.lastResult;
  },

  // Batalkan heist yang sedang berjalan (tanpa hadiah, tanpa penalti gagal).
  cancel() {
    if (!this.active) return false;
    this.active = null;
    return true;
  },

  // Hasil heist terakhir (null bila belum pernah selesai / gagal).
  lastResult: null,

  // Progress fase saat ini 0..1 (tugas selesai / total tugas).
  progress() {
    if (!this.active) return 0;
    const phase = this.active.phases[this.active.phaseIndex];
    if (!phase || !phase.tasks.length) return 0;
    const done = phase.tasks.filter((t) => t.done).length;
    return clamp(done / phase.tasks.length, 0, 1);
  },

  // Progress keseluruhan heist 0..1 (semua tugas di semua fase).
  totalProgress() {
    if (!this.active) return 0;
    let done = 0;
    let total = 0;
    for (const p of this.active.phases) {
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return total ? clamp(done / total, 0, 1) : 0;
  },

  // Sisa waktu fase execute (detik), Infinity bila bukan fase execute.
  executeTimeLeft() {
    if (!this.active) return Infinity;
    const phase = this.currentPhase();
    if (!phase || phase.id !== "execute") return Infinity;
    return Math.max(0, EXECUTE_TIME_LIMIT - this.active.executeTime);
  },

  // Ringkasan fase + tugas untuk HUD.
  status() {
    if (!this.active) return null;
    const phase = this.currentPhase();
    return {
      phase: phase ? phase.id : null,
      title: phase ? phase.title : null,
      tasks: phase ? phase.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done })) : [],
      phaseDone: this.phaseDone(),
      progress: this.progress(),
      totalProgress: this.totalProgress(),
      time: this.active.time,
      executeTimeLeft: this.executeTimeLeft(),
    };
  },

  // Reset state heist (new game).
  reset() {
    this.active = null;
    this.completed = 0;
    this.lastResult = null;
  },

  // Muat dari save (dipakai SB.Game.load).
  loadFrom(data) {
    if (!data || typeof data !== "object") return;
    if (typeof data.completed === "number") this.completed = data.completed;
  },

  // Ekspor untuk save.
  saveTo() {
    return { completed: this.completed };
  },
};

window.SB.Heist = Heist;

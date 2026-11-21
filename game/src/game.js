// Sunset Bay — game.js (v9, ditulis ulang)
// Inti permainan: rantai misi, wanted/polisi/heli, busted/wasted,
// tembak & ammo, respray, save/load localStorage. State hidup di SB.G
// dan dipakai modul lain (main, hud, player, vehicles, jobs).
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  // ---- konstanta tuning ----
  var SAVE_KEY = 'sunset-bay-save-v1';
  var HOME = { x: 0, z: 0, yaw: 0 };      // safehouse
  var ARRIVE_RADIUS = 6;                  // jarak anggap "sampai" di target stage
  var AMMO_PRICE = 50;                    // $50 ...
  var AMMO_PACK = 24;                     // ... untuk +24 peluru pistol
  var RESPRAY_PRICE = 150;                // bersihkan wanted
  var REP_STAGE = 15;                     // REP tiap stage selesai
  var REP_MISSION = 40;                   // REP tiap misi selesai
  var BUST_FINE = 0.10;                   // busted: kehilangan 10% uang
  var MAX_WANTED = 5;
  var HELI_WANTED = 3;                    // heli AIR-1 muncul dari wanted 3
  var DAY_LENGTH = 0.02;                  // jam game per detik nyata (1 jam / 50 dtk)

  // ---- helper kecil ----
  function state() { return SB.G; }

  function notify(text) {
    if (SB.HUD && SB.HUD.showMessage) SB.HUD.showMessage(text);
  }

  function play(name) {
    if (SB.Audio && SB.Audio.sfx) SB.Audio.sfx(name);
  }

  function flatDist(ax, az, bx, bz) {
    var dx = ax - bx;
    var dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function freshState() {
    return {
      money: 250, rep: 0, wanted: 0,
      mission: 0, missionStage: 0,
      clock: 18.0,
      player: { x: HOME.x, z: HOME.z, yaw: HOME.yaw, hp: 100,
                inCar: false, car: null, speed: 0 },
      police: [], heli: null,
      dist: 0, drifts: 0, busted: 0,
      ammo: { pistol: 48 }, weapon: 'pistol'
    };
  }

  // ---------------------------------------------------------------------------
  // Rantai misi: 18 misi, total 49 stage.
  // Jumlah stage per misi: 4,3,3,3,3,3,3,2,3,2,3,2,3,2,3,2,3,2.
  // Misi 1 = 4 stage x 15 REP + 40 REP bonus misi = +100 REP total.
  // Catatan jarak: stage 2 misi 1 (60,40) berjarak ~64 unit dari stage 1
  // (20,-10), jadi tidak mungkin terpicu otomatis saat stage 1 selesai.
  // ---------------------------------------------------------------------------
  var MISSION_LIST = [
    { name: 'First Wheels', fastBonus: 50, stages: [
      { text: 'Pergi ke mobil parkir di sudut jalan', target: { x: 20, z: -10 }, reward: 25 },
      { text: 'Bawa mobil ke garasi di seberang kota', target: { x: 60, z: 40 }, reward: 50 },
      { text: 'Antar mobil ke titik drop-off pelabuhan', target: { x: -60, z: 70 }, reward: 25 },
      { text: 'Kembali ke safehouse', target: { x: 0, z: 0 }, reward: 50 }
    ] },
    { name: 'Package Run', stages: [
      { text: 'Ambil paket di Downtown', target: { x: 30, z: 30 }, reward: 40 },
      { text: 'Antar paket ke Marina Bay', target: { x: -80, z: -40 }, reward: 60 },
      { text: 'Lapor kembali ke safehouse', target: { x: 0, z: 0 }, reward: 40 }
    ] },
    { name: 'Harbor Lights', stages: [
      { text: 'Cek dermaga Harbor', target: { x: -100, z: 60 }, reward: 40 },
      { text: 'Ambil kiriman di gudang pelabuhan', target: { x: -120, z: 20 }, reward: 60 },
      { text: 'Antar kiriman ke Old Town', target: { x: 50, z: -60 }, reward: 50 }
    ] },
    { name: 'Night Shift', stages: [
      { text: 'Mulai shift malam di Uptown', target: { x: 70, z: -80 }, reward: 40 },
      { text: 'Jemput penumpang di Northside', target: { x: 90, z: 40 }, reward: 60 },
      { text: 'Antar penumpang ke Beachfront', target: { x: -30, z: 110 }, reward: 50 }
    ] },
    { name: 'Marina Run', stages: [
      { text: 'Ke Marina Bay', target: { x: -70, z: -70 }, reward: 40 },
      { text: 'Ikuti rute pesisir ke selatan', target: { x: -40, z: 100 }, reward: 60 },
      { text: 'Selesai di dermaga selatan', target: { x: -110, z: 90 }, reward: 50 }
    ] },
    { name: 'Hillcrest Climb', stages: [
      { text: 'Naik ke Hillcrest', target: { x: 100, z: 90 }, reward: 50 },
      { text: 'Turun ke titik pandang', target: { x: 60, z: 110 }, reward: 50 },
      { text: 'Kembali ke jalan utama', target: { x: 20, z: 60 }, reward: 50 }
    ] },
    { name: 'Downtown Dash', stages: [
      { text: 'Sprint melintasi Downtown', target: { x: 40, z: 10 }, reward: 50 },
      { text: 'Lewati persimpangan Old Town', target: { x: -20, z: -50 }, reward: 50 },
      { text: 'Finish di alun-alun', target: { x: 10, z: -20 }, reward: 50 }
    ] },
    { name: 'Beachfront Cruise', stages: [
      { text: 'Cruise di Beachfront', target: { x: -10, z: 120 }, reward: 60 },
      { text: 'Parkir di ujung pantai', target: { x: 50, z: 130 }, reward: 60 }
    ] },
    { name: 'Old Town Tour', stages: [
      { text: 'Mulai tur di Old Town', target: { x: -50, z: -80 }, reward: 40 },
      { text: 'Mampir ke pasar lama', target: { x: -30, z: -100 }, reward: 60 },
      { text: 'Akhiri tur di gerbang kota', target: { x: -70, z: -30 }, reward: 50 }
    ] },
    { name: 'Industrial Haul', stages: [
      { text: 'Ambil muatan di Industrial', target: { x: 120, z: -20 }, reward: 60 },
      { text: 'Antar muatan ke gudang Harbor', target: { x: -100, z: 40 }, reward: 70 }
    ] },
    { name: 'Northside Nights', stages: [
      { text: 'Patroli Northside', target: { x: 80, z: 60 }, reward: 50 },
      { text: 'Cek taman utara', target: { x: 110, z: 70 }, reward: 50 },
      { text: 'Kembali ke base', target: { x: 0, z: 0 }, reward: 50 }
    ] },
    { name: 'Southside Sprint', stages: [
      { text: 'Sprint ke Southside', target: { x: -20, z: -120 }, reward: 60 },
      { text: 'Putar balik di ujung selatan', target: { x: 40, z: -130 }, reward: 60 }
    ] },
    { name: 'Uptown Express', stages: [
      { text: 'Ekspres ke Uptown', target: { x: 90, z: -60 }, reward: 50 },
      { text: 'Ambil dokumen penting', target: { x: 120, z: -90 }, reward: 60 },
      { text: 'Serahkan dokumen di Downtown', target: { x: 30, z: 20 }, reward: 50 }
    ] },
    { name: 'Sunset Delivery', stages: [
      { text: 'Ambil pesanan saat senja', target: { x: -60, z: 30 }, reward: 50 },
      { text: 'Antar sebelum gelap', target: { x: 70, z: 100 }, reward: 70 }
    ] },
    { name: 'Midnight Rider', stages: [
      { text: 'Riding tengah malam ke Marina', target: { x: -80, z: -60 }, reward: 60 },
      { text: 'Lewati jembatan pelabuhan', target: { x: -110, z: -10 }, reward: 60 },
      { text: 'Parkir di dermaga', target: { x: -90, z: 50 }, reward: 60 }
    ] },
    { name: 'Harbor Heist', stages: [
      { text: 'Menyusup ke gudang Harbor', target: { x: -120, z: 60 }, reward: 70 },
      { text: 'Kabur ke Hillcrest', target: { x: 100, z: 100 }, reward: 80 }
    ] },
    { name: 'Bay City Legend', stages: [
      { text: 'Buktikan diri di Downtown', target: { x: 20, z: 40 }, reward: 60 },
      { text: 'Tantangan di Northside', target: { x: 100, z: 30 }, reward: 70 },
      { text: 'Penutup di Beachfront', target: { x: 0, z: 120 }, reward: 70 }
    ] },
    { name: 'Sunset Finale', stages: [
      { text: 'Putaran terakhir keliling kota', target: { x: -40, z: -40 }, reward: 80 },
      { text: 'Kembali ke safehouse — legenda Sunset Bay!', target: { x: 0, z: 0 }, reward: 100 }
    ] }
  ];

  function activeMission(g) {
    return MISSION_LIST[g.mission] || null;
  }

  function activeStage(g) {
    var m = activeMission(g);
    if (!m) return null;
    return m.stages[g.missionStage] || null;
  }

  // Kembalikan pemain ke safehouse setelah busted / wasted.
  function sendHome(reason) {
    var g = state();
    if (!g || !g.player) return;
    var p = g.player;
    if (p.car && SB.Vehicles && SB.Vehicles.exitCar) SB.Vehicles.exitCar();
    p.x = HOME.x;
    p.z = HOME.z;
    p.yaw = HOME.yaw;
    p.hp = 100;
    p.inCar = false;
    p.car = null;
    p.speed = 0;
    g.police = [];
    g.heli = null;
    g.wanted = 0;
    Game._bustTimer = 0;
    if (reason === 'busted') {
      var fine = Math.floor((g.money || 0) * BUST_FINE);
      g.money = (g.money || 0) - fine;
      g.busted = (g.busted || 0) + 1;
      notify('BUSTED! Polisi menyita $' + fine + ' (-10%)');
    } else if (reason === 'wasted') {
      notify('WASTED! Kamu bangun di safehouse.');
    }
    play('busted');
  }

  var Game = {
    MISSIONS: MISSION_LIST,
    SAVE_KEY: SAVE_KEY,
    _missionStart: 0,
    _bustTimer: 0,

    // ---- mulai permainan baru ----
    start: function () {
      var g = state();
      if (!g) {
        g = SB.G = freshState();
      } else {
        // Reset penuh ke kondisi awal (bukan menimpa field satu-satu dari
        // state lama): panggil freshState lalu ganti referensinya.
        var clean = freshState();
        for (var key in clean) g[key] = clean[key];
      }
      this._missionStart = Date.now();
      this._bustTimer = 0;
      if (SB.Jobs) {
        SB.Jobs.taxi.active = false;
        SB.Jobs.package.active = false;
      }
      notify('Misi 1: First Wheels — pergi ke mobil parkir!');
    },

    // ---- tick utama (dipanggil main.js tiap frame) ----
    update: function (dt) {
      var g = state();
      if (!g || !g.player) return;

      // Siklus siang-malam.
      g.clock = (g.clock + dt * DAY_LENGTH) % 24;

      // Stage selesai bila pemain cukup dekat dengan targetnya.
      var stage = activeStage(g);
      if (stage && stage.target) {
        if (flatDist(g.player.x, g.player.z, stage.target.x, stage.target.z) < ARRIVE_RADIUS) {
          this.completeStage();
        }
      }

      if (SB.Jobs) SB.Jobs.update(dt);
      this.updatePolice(dt);
      this.bustCheck(dt);

      // HP habis -> WASTED.
      if (g.player.hp <= 0) sendHome('wasted');

      // Heli selalu melayang tepat di atas pemain selama aktif.
      if (g.heli) {
        g.heli.x = g.player.x;
        g.heli.z = g.player.z;
        g.heli.y = 60;
      }
    },

    // ---- misi ----
    completeStage: function () {
      var g = state();
      var m = activeMission(g);
      var stage = activeStage(g);
      if (!g || !m || !stage) return;

      g.money = (g.money || 0) + (stage.reward || 0);
      g.rep = (g.rep || 0) + REP_STAGE;
      play('mission');

      var isLast = g.missionStage >= m.stages.length - 1;
      if (isLast) {
        g.rep = (g.rep || 0) + REP_MISSION;
        var extra = '';
        if (m.fastBonus) {
          var elapsedSec = (Date.now() - this._missionStart) / 1000;
          if (elapsedSec < 300) {
            g.money = (g.money || 0) + m.fastBonus;
            extra = ' Fast bonus +$' + m.fastBonus + '!';
          }
        }
        notify('Misi selesai: ' + m.name + '! +$' + (stage.reward || 0) +
          ' (+15 REP stage, +40 REP misi).' + extra);
        g.mission++;
        g.missionStage = 0;
        this._missionStart = Date.now();
        if (g.mission >= MISSION_LIST.length) {
          notify('SEMUA MISI SELESAI! Kamu legenda Sunset Bay!');
        } else {
          notify('Misi ' + (g.mission + 1) + ': ' + MISSION_LIST[g.mission].name);
        }
      } else {
        notify('Stage selesai! +$' + (stage.reward || 0) + ' (+15 REP)');
        g.missionStage++;
      }
      this.save();
    },

    // ---- wanted ----
    wantedUp: function (n) {
      var g = state();
      if (!g) return;
      g.wanted = Math.max(0, Math.min(MAX_WANTED, (g.wanted || 0) + (n || 1)));
      if (g.wanted >= HELI_WANTED) this.spawnHeli();
    },

    wantedDown: function (n) {
      var g = state();
      if (!g) return;
      g.wanted = Math.max(0, (g.wanted || 0) - (n || 1));
      if (g.wanted < HELI_WANTED) g.heli = null;
    },

    // Respray di garage: bersihkan wanted sampai 0, biaya $150.
    // Gagal bila uang kurang atau memang tidak ada wanted.
    respray: function () {
      var g = state();
      if (!g) return false;
      if ((g.money || 0) < RESPRAY_PRICE) {
        notify('Respray butuh $' + RESPRAY_PRICE + '!');
        return false;
      }
      if ((g.wanted || 0) === 0) {
        notify('Tidak ada wanted untuk dibersihkan.');
        return false;
      }
      g.money -= RESPRAY_PRICE;
      g.wanted = 0;
      g.police = [];
      g.heli = null;
      notify('Respray selesai! Wanted bersih. -$' + RESPRAY_PRICE);
      play('pickup');
      return true;
    },

    // ---- heli polisi ----
    spawnHeli: function () {
      var g = state();
      if (!g || !g.player) return;
      if (!g.heli) {
        g.heli = { x: g.player.x, y: 60, z: g.player.z };
        notify('AIR-1 di udara! Heli polisi mengawasimu.');
      }
    },

    // ---- polisi ----
    updatePolice: function (dt) {
      var g = state();
      if (!g || !g.player) return;
      var wanted = g.wanted || 0;
      if (wanted <= 0) {
        if (g.police.length > 0) g.police = [];
        return;
      }
      // Jumlah mobil polisi aktif mengikuti level wanted (maks 5).
      var target = Math.min(wanted, MAX_WANTED);
      while (g.police.length < target) {
        var angle = Math.random() * Math.PI * 2;
        g.police.push({
          x: g.player.x + Math.cos(angle) * 40,
          z: g.player.z + Math.sin(angle) * 40,
          hp: 100
        });
      }
      while (g.police.length > target) g.police.pop();

      var chaseSpeed = 7 + wanted * 1.5;
      for (var i = 0; i < g.police.length; i++) {
        var cop = g.police[i];
        var dx = g.player.x - cop.x;
        var dz = g.player.z - cop.z;
        var d = Math.sqrt(dx * dx + dz * dz) || 1;
        cop.x += (dx / d) * chaseSpeed * dt;
        cop.z += (dz / d) * chaseSpeed * dt;
        // Polisi menembak bila dekat (wanted >= 2): HP pemain terkikis.
        if (d < 25 && wanted >= 2) {
          g.player.hp = Math.max(0, g.player.hp - 2 * dt);
        }
      }
    },

    // Tembak satu polisi: HP-nya berkurang, wanted naik +1 (sekali per
    // tembakan, bukan per polisi yang tumbang). Mengembalikan true bila
    // polisi itu tumbang.
    damagePolice: function (index, dmg) {
      var g = state();
      if (!g || !g.police || !g.police[index]) return false;
      var cop = g.police[index];
      cop.hp -= (dmg || 25);
      this.wantedUp(1);
      if (cop.hp <= 0) {
        g.police.splice(index, 1);
        notify('Polisi tumbang! Wanted +1');
        return true;
      }
      return false;
    },

    // Cari polisi terdekat dalam jangkauan lalu tembak.
    shootNearestPolice: function (range, dmg) {
      var g = state();
      if (!g || !g.player || !g.police || g.police.length === 0) return false;
      var best = -1;
      var bestD = range || 40;
      for (var i = 0; i < g.police.length; i++) {
        var d = flatDist(g.player.x, g.player.z, g.police[i].x, g.police[i].z);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return false;
      return this.damagePolice(best, dmg || 25);
    },

    // Tembak (tombol F / klik): 1 peluru pistol, kenai polisi terdekat.
    fire: function () {
      var g = state();
      if (!g || !g.player) return false;
      if (!g.ammo) g.ammo = { pistol: 0 };
      if ((g.ammo.pistol || 0) <= 0) {
        notify('Pistol kehabisan ammo! Beli di garage (G) — $50/+24.');
        play('click');
        return false;
      }
      g.ammo.pistol--;
      play('shoot');
      this.shootNearestPolice(40, 34);
      return true;
    },

    // Busted: polisi menangkap bila sangat dekat (<3 unit) sementara
    // pemain jalan kaki dan lambat — tahan 3 detik baru tertangkap.
    bustCheck: function (dt) {
      var g = state();
      if (!g || !g.player) return;
      if ((g.wanted || 0) <= 0 || !g.police || g.police.length === 0) {
        this._bustTimer = 0;
        return;
      }
      var cornered = false;
      for (var i = 0; i < g.police.length; i++) {
        if (flatDist(g.player.x, g.player.z, g.police[i].x, g.police[i].z) < 3) {
          cornered = true;
          break;
        }
      }
      var speed = g.player.speed || 0;
      if (cornered && speed < 4 && !g.player.inCar) {
        this._bustTimer += dt;
        if (this._bustTimer > 3) {
          this._bustTimer = 0;
          sendHome('busted');
        }
      } else {
        this._bustTimer = Math.max(0, this._bustTimer - dt * 2);
      }
    },

    // ---- ammo: $50 untuk +24 peluru pistol (hanya untuk pistol) ----
    buyAmmo: function () {
      var g = state();
      if (!g) return false;
      if ((g.weapon || 'pistol') !== 'pistol') {
        notify('Isi ulang ammo hanya untuk Pistol!');
        return false;
      }
      if ((g.money || 0) < AMMO_PRICE) {
        notify('Beli ammo butuh $' + AMMO_PRICE + '!');
        return false;
      }
      if (!g.ammo) g.ammo = { pistol: 0 };
      if (typeof g.ammo.pistol !== 'number') g.ammo.pistol = 0;
      g.money -= AMMO_PRICE;
      g.ammo.pistol += AMMO_PACK;
      notify('Ammo Pistol +24! -$' + AMMO_PRICE + ' (total ' + g.ammo.pistol + ')');
      play('pickup');
      return true;
    },

    // ---- save / load ----
    save: function () {
      var g = state();
      if (!g) return;
      try {
        var snapshot = {
          money: g.money, rep: g.rep, wanted: g.wanted,
          mission: g.mission, missionStage: g.missionStage, clock: g.clock,
          player: {
            x: g.player.x, z: g.player.z, yaw: g.player.yaw,
            hp: g.player.hp, inCar: false, car: null, speed: 0
          },
          dist: g.dist, drifts: g.drifts, busted: g.busted,
          ammo: g.ammo, weapon: g.weapon
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      } catch (e) { /* storage tidak tersedia: abaikan */ }
    },

    load: function () {
      try {
        var raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        this.applySave(data);
        return data;
      } catch (e) {
        return null;
      }
    },

    applySave: function (data) {
      var g = state();
      if (!data) return;
      if (!g) {
        g = SB.G = freshState();
      }
      g.money = (typeof data.money === 'number') ? data.money : 250;
      g.rep = data.rep || 0;
      g.wanted = data.wanted || 0;
      g.mission = data.mission || 0;
      g.missionStage = data.missionStage || 0;
      g.clock = (typeof data.clock === 'number') ? data.clock : 18.0;
      if (data.player) {
        g.player = {
          x: data.player.x || 0, z: data.player.z || 0, yaw: data.player.yaw || 0,
          hp: (typeof data.player.hp === 'number') ? data.player.hp : 100,
          inCar: false, car: null, speed: 0
        };
      }
      g.dist = data.dist || 0;
      g.drifts = data.drifts || 0;
      g.busted = data.busted || 0;
      g.ammo = data.ammo || { pistol: 48 };
      g.weapon = data.weapon || 'pistol';
      g.police = [];
      g.heli = null;
      if (g.wanted >= HELI_WANTED) this.spawnHeli();
      this._missionStart = Date.now();
      this._bustTimer = 0;
    }
  };

  SB.Game = Game;
})();

// police.js — Sunset Bay v14
// Builder G (AI & city life).
// Sistem wanted 0–5 bintang + heat, mobil patroli, pengejaran, dan pelarian.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).
// Modul ini tidak meng-import modul lain dan tidak membaca file sumber lain.

(function () {
  "use strict";

  window.SB = window.SB || {};
  var SB = window.SB;

  // ---------------------------------------------------------------------------
  // Util kecil (mandiri)
  // ---------------------------------------------------------------------------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2D(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function angleTo(ax, az, bx, bz) { return Math.atan2(bx - ax, bz - az); }

  // ---------------------------------------------------------------------------
  // Konstanta wanted (selaras dengan SB.Config.WANTED bila tersedia)
  // ---------------------------------------------------------------------------
  var MAX_WANTED = 5;
  var MAX_HEAT = 100;
  var CITY_HALF = 560;
  var ROAD_STEP = 100;

  // Heat yang ditambahkan tiap jenis kejahatan, dan bintang minimum yang
  // langsung didapat karenanya.
  var CRIME_TABLE = {
    steal_car_seen:   { heat: 25, stars: 1, label: "Grand theft auto" },
    steal_car_unseen: { heat: 8,  stars: 0, label: "Car stolen quietly" },
    hit_pedestrian:   { heat: 35, stars: 2, label: "Hit and run" },
    shoot:            { heat: 30, stars: 2, label: "Shots fired" },
    shoot_cop:        { heat: 55, stars: 3, label: "Shot at police" },
    heist:            { heat: 70, stars: 4, label: "Heist in progress" },
    crash_cop:        { heat: 20, stars: 1, label: "Ram police car" },
    speeding:         { heat: 5,  stars: 0, label: "Reckless driving" }
  };

  // Ambang heat untuk tiap bintang (dipakai bila SB.Config.WANTED tidak ada).
  var HEAT_THRESHOLDS = [0, 20, 40, 60, 80, 95]; // index = bintang

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  var WANTED = 0;              // 0–5 bintang (angka; publik via SB.Police.WANTED)
  var heatValue = 0;           // 0–100
  var lastCrimeAt = -9999;     // waktu game terakhir ada kejahatan
  var timeNow = 0;             // jam game internal (detik sejak start modul)
  var sirenTimer = 0;          // throttle bunyi sirene
  var bustedTimer = 0;         // polisi menempel player jalan kaki
  var wantedCooldown = 0;      // jeda antar penurunan bintang
  var lastReport = "";         // deskripsi kejahatan terakhir (untuk HUD/log)
  var hiddenTimer = 0;         // akumulasi waktu player tersembunyi
  var pursuitLog = [];         // riwayat singkat (maks 20 entri)

  function logPursuit(text) {
    pursuitLog.push({ t: timeNow, text: text });
    if (pursuitLog.length > 20) pursuitLog.shift();
  }

  // ---------------------------------------------------------------------------
  // Heat
  // ---------------------------------------------------------------------------
  function heat() {
    return Math.round(heatValue);
  }

  function addHeat(n) {
    heatValue = clamp(heatValue + n, 0, MAX_HEAT);
    syncWantedFromHeat();
  }

  function syncWantedFromHeat() {
    // Bintang naik mengikuti heat, tapi tidak pernah turun lewat jalur ini
    // (penurunan bintang hanya lewat loseHeat).
    var stars = 0;
    for (var s = MAX_WANTED; s >= 1; s--) {
      if (heatValue >= HEAT_THRESHOLDS[s]) { stars = s; break; }
    }
    if (stars > WANTED) {
      setWanted(stars);
    }
  }

  // ---------------------------------------------------------------------------
  // Wanted: naik / turun
  // ---------------------------------------------------------------------------
  function setWanted(n) {
    n = clamp(Math.round(n), 0, MAX_WANTED);
    if (n === WANTED) {
      syncCopCars();
      return;
    }
    var old = WANTED;
    WANTED = n;
    SB.Police.WANTED = n;
    if (n > old) {
      // Naikkan heat polisi ke ambang bintang baru, supaya loseHeat tidak
      // langsung menurunkan wanted (heatValue 0 = heat habis = turun bintang).
      heatValue = Math.max(heatValue, HEAT_THRESHOLDS[n] || 0);
      logPursuit("Wanted level rose to " + n + " star" + (n > 1 ? "s" : ""));
      if (SB.Audio && typeof SB.Audio.sfx === "function") {
        try { SB.Audio.sfx("siren"); } catch (e) { /* abaikan */ }
      }
      if (SB.Game && typeof SB.Game.setWanted === "function") {
        try { SB.Game.setWanted(n); } catch (e) { /* abaikan */ }
      }
    } else {
      logPursuit("Wanted level dropped to " + n + " star" + (n === 1 ? "" : "s"));
      if (SB.Game && typeof SB.Game.setWanted === "function") {
        try { SB.Game.setWanted(n); } catch (e) { /* abaikan */ }
      }
    }
    syncCopCars();
  }

  // Kejahatan yang menaikkan wanted. Dipanggil modul lain (Vehicles saat curi
  // mobil, Weapons saat menembak, Heist saat heist, NPC saat tabrak pejalan).
  // type: kunci CRIME_TABLE. pos: lokasi kejadian (untuk saksi & respons).
  function commitCrime(type, pos) {
    var crime = CRIME_TABLE[type];
    if (!crime) return false;
    lastCrimeAt = timeNow;
    lastReport = crime.label;

    // Curi mobil hanya menaikkan wanted bila ada saksi (pejalan kaki / polisi
    // dalam radius 40 m). Tanpa saksi, heat naik sedikit saja.
    if (type === "steal_car_seen" || type === "steal_car_unseen") {
      var witnessed = isWitnessed(pos);
      if (!witnessed) {
        addHeat(CRIME_TABLE.steal_car_unseen.heat);
        logPursuit("Car stolen unseen — heat +" + CRIME_TABLE.steal_car_unseen.heat);
        return true;
      }
    }

    addHeat(crime.heat);
    if (crime.stars > WANTED) setWanted(crime.stars);
    logPursuit(crime.label + " — heat +" + crime.heat + ", wanted " + WANTED + " stars");

    // Pejalan kaki di sekitar bereaksi terhadap kejahatan keras.
    if (SB.NPC && typeof SB.NPC.react === "function" && pos) {
      try {
        var evType = type === "shoot" || type === "shoot_cop" ? "gunshot" : "chase";
        SB.NPC.react({ type: evType, pos: pos, radius: 70 });
      } catch (e) { /* abaikan */ }
    }
    return true;
  }

  // Ada saksi? Pejalan kaki atau mobil polisi dalam radius 40 m dari kejadian.
  function isWitnessed(pos) {
    if (!pos) return true; // tanpa info lokasi, anggap terlihat
    if (SB.NPC && SB.NPC.PEDESTRIANS) {
      for (var i = 0; i < SB.NPC.PEDESTRIANS.length; i++) {
        var ped = SB.NPC.PEDESTRIANS[i];
        if (ped.state !== "down" && dist2D(pos.x, pos.z, ped.pos.x, ped.pos.z) < 40) return true;
      }
    }
    for (var j = 0; j < COP_CARS.length; j++) {
      if (dist2D(pos.x, pos.z, COP_CARS[j].pos.x, COP_CARS[j].pos.z) < 60) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Mobil patroli
  // ---------------------------------------------------------------------------
  var COP_COLORS = [[0.05, 0.05, 0.08]]; // hitam-putih khas patroli (bodi gelap)
  var COP_ACCENT = [0.95, 0.95, 0.95];

  function makeCopCar(id, spawnPos) {
    return {
      id: id,
      kind: "cop",
      pos: { x: spawnPos.x, y: 0, z: spawnPos.z },
      rotY: 0,
      speed: 0,
      targetSpeed: 0,
      color: COP_COLORS[0],
      accent: COP_ACCENT,
      state: "patrol",      // patrol | pursue | search | ram
      searchTimer: 0,
      stuckTimer: 0,
      lastPos: { x: spawnPos.x, z: spawnPos.z },
      sirenOn: false,
      ramCooldown: 0
    };
  }

  // Titik spawn: di jalan terdekat dari player, tapi di luar pandangan dekat
  // (60–160 m), agar polisi "datang" dari kejauhan, bukan muncul di depan mata.
  function copSpawnPoint(playerPos) {
    for (var attempt = 0; attempt < 12; attempt++) {
      var ang = rand(0, Math.PI * 2);
      var d = rand(70, 170);
      var x = clamp(playerPos.x + Math.cos(ang) * d, -CITY_HALF, CITY_HALF);
      var z = clamp(playerPos.z + Math.sin(ang) * d, -CITY_HALF, CITY_HALF);
      // Geser ke jalan terdekat (kelipatan 100).
      var gx = Math.round(x / ROAD_STEP) * ROAD_STEP;
      var gz = Math.round(z / ROAD_STEP) * ROAD_STEP;
      if (Math.abs(x - gx) < Math.abs(z - gz)) x = gx; else z = gz;
      if (dist2D(x, z, playerPos.x, playerPos.z) > 55) {
        return { x: x, z: z };
      }
    }
    return { x: clamp(playerPos.x + 90, -CITY_HALF, CITY_HALF), z: playerPos.z };
  }

  var COP_CARS = [];

  // Jumlah patroli = wanted + 1 saat wanted ≥ 1 (1 bintang → 2 mobil, dst),
  // dibatasi 6 mobil agar kota tidak penuh polisi.
  function desiredCopCount() {
    if (WANTED <= 0) return 0;
    return Math.min(WANTED + 1, 6);
  }

  function syncCopCars() {
    var want = desiredCopCount();
    var player = currentPlayer();
    var base = player ? player.pos : { x: 0, z: 0 };
    while (COP_CARS.length < want) {
      var spawn = copSpawnPoint(base);
      var cop = makeCopCar(COP_CARS.length, spawn);
      cop.state = WANTED >= 1 ? "pursue" : "patrol";
      cop.sirenOn = true;
      COP_CARS.push(cop);
    }
    while (COP_CARS.length > want) {
      COP_CARS.pop();
    }
    // Sinkronkan state dengan wanted saat ini.
    for (var i = 0; i < COP_CARS.length; i++) {
      COP_CARS[i].sirenOn = WANTED >= 1;
      if (WANTED === 0) COP_CARS[i].state = "patrol";
      else if (COP_CARS[i].state === "patrol") COP_CARS[i].state = "pursue";
    }
  }

  // ---------------------------------------------------------------------------
  // Player (dibaca saat runtime dari SB.Player / SB.Game.state)
  // ---------------------------------------------------------------------------
  function currentPlayer() {
    try {
      if (SB.Player && SB.Player.pos) {
        return {
          pos: SB.Player.pos,
          onFoot: SB.Player.onFoot !== false,
          vehicle: SB.Player.currentVehicle || null,
          speed: Math.abs(SB.Player.speed || 0),
          health: SB.Player.health
        };
      }
      if (SB.Game && SB.Game.state && SB.Game.state.player) {
        var p = SB.Game.state.player;
        return {
          pos: p.pos || { x: 0, y: 0, z: 0 },
          onFoot: p.onFoot !== false,
          vehicle: p.vehicle || null,
          speed: Math.abs(p.speed || 0),
          health: p.health
        };
      }
    } catch (e) { /* modul lain belum siap */ }
    return null;
  }

  function playerVehicleSpeed(player) {
    if (!player) return 0;
    if (player.vehicle && typeof player.vehicle.speed === "number") {
      return Math.abs(player.vehicle.speed);
    }
    return player.speed || 0;
  }

  // ---------------------------------------------------------------------------
  // Pengejaran
  // ---------------------------------------------------------------------------
  // Satu mobil polisi mengejar player. Dipanggil dari update(); tersedia juga
  // sebagai API publik pursue(player).
  function pursue(player) {
    if (!player || !player.pos) return;
    for (var i = 0; i < COP_CARS.length; i++) {
      chaseTarget(COP_CARS[i], player, 0.016);
    }
  }

  function chaseTarget(cop, player, dt) {
    var target = player.pos;
    var d = dist2D(cop.pos.x, cop.pos.z, target.x, target.z);

    // Kecepatan kejar: sedikit di atas kecepatan player agar bisa mendekat,
    // tapi tidak mustahil dilepas. Di atas 4 bintang polisi lebih agresif.
    var playerSpeed = playerVehicleSpeed(player);
    var chaseSpeed = player.onFoot
      ? 5.2 + WANTED * 0.35                      // kejar jalan kaki: lari cepat
      : Math.min(24 + WANTED * 1.5, playerSpeed + 4 + WANTED); // kejar mobil

    if (cop.state === "search") {
      // Kehilangan jejak: berkeliling di titik terakhir terlihat.
      cop.searchTimer -= dt;
      cop.targetSpeed = 7;
      if (cop.searchTimer <= 0) {
        cop.state = "pursue";
      }
    } else {
      cop.targetSpeed = chaseSpeed;
    }

    // Belok menuju player (dengan batas laju belok agar tidak berputar instan).
    var desiredRot = angleTo(cop.pos.x, cop.pos.z, target.x, target.z);
    var diff = desiredRot - cop.rotY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    cop.rotY += clamp(diff, -2.4 * dt, 2.4 * dt);

    // Percepat / perlambat.
    if (cop.speed < cop.targetSpeed) cop.speed = Math.min(cop.targetSpeed, cop.speed + 10 * dt);
    else if (cop.speed > cop.targetSpeed) cop.speed = Math.max(cop.targetSpeed, cop.speed - 16 * dt);

    cop.pos.x += Math.sin(cop.rotY) * cop.speed * dt;
    cop.pos.z += Math.cos(cop.rotY) * cop.speed * dt;
    cop.pos.x = clamp(cop.pos.x, -CITY_HALF - 40, CITY_HALF + 40);
    cop.pos.z = clamp(cop.pos.z, -CITY_HALF - 40, CITY_HALF + 40);

    // Deteksi macet (tidak bergerak padahal harus mengejar): mundur & belok.
    var moved = dist2D(cop.pos.x, cop.pos.z, cop.lastPos.x, cop.lastPos.z);
    if (cop.speed > 3 && moved < 0.05) {
      cop.stuckTimer += dt;
      if (cop.stuckTimer > 1.2) {
        cop.rotY += Math.PI / 2; // putar untuk keluar dari jebakan
        cop.stuckTimer = 0;
      }
    } else {
      cop.stuckTimer = 0;
    }
    cop.lastPos = { x: cop.pos.x, z: cop.pos.z };

    // Menabrak mobil player dari samping/belakang saat sudah sangat dekat
    // (ram): dorong lewat event + bunyi, dengan cooldown.
    cop.ramCooldown -= dt;
    if (!player.onFoot && d < 4 && cop.ramCooldown <= 0) {
      cop.ramCooldown = 2;
      cop.state = "ram";
      if (SB.Audio && typeof SB.Audio.sfx === "function") {
        try { SB.Audio.sfx("crash"); } catch (e) { /* abaikan */ }
      }
      if (SB.FX && typeof SB.FX.spawnParticles === "function") {
        try { SB.FX.spawnParticles(cop.pos, [1.0, 0.8, 0.2], 8); } catch (e) { /* abaikan */ }
      }
      setTimeout(function () { if (cop.state === "ram") cop.state = "pursue"; }, 600);
    }

    // Jarak pengejaran terlalu jauh: polisi kehilangan jejak, masuk mode cari.
    if (d > 260 && cop.state === "pursue") {
      cop.state = "search";
      cop.searchTimer = rand(6, 12);
    } else if (d < 120 && cop.state === "search") {
      cop.state = "pursue";
    }
  }

  function busted(reason) {
    if (WANTED <= 0) return;
    logPursuit("BUSTED — " + reason);
    bustedTimer = 0;
    if (SB.Game && typeof SB.Game.gameOver === "function") {
      try { SB.Game.gameOver("busted"); } catch (e) { /* abaikan */ }
    }
  }

  // Patroli santai saat wanted 0: mobil polisi berkeliling kota pelan.
  function patrolUpdate(cop, dt) {
    cop.targetSpeed = 8;
    cop.rotY += Math.sin(timeNow * 0.15 + cop.id) * 0.15 * dt;
    if (cop.speed < cop.targetSpeed) cop.speed = Math.min(cop.targetSpeed, cop.speed + 5 * dt);
    cop.pos.x += Math.sin(cop.rotY) * cop.speed * dt;
    cop.pos.z += Math.cos(cop.rotY) * cop.speed * dt;
    // Pantul di batas kota.
    if (Math.abs(cop.pos.x) > CITY_HALF || Math.abs(cop.pos.z) > CITY_HALF) {
      cop.rotY += Math.PI;
      cop.pos.x = clamp(cop.pos.x, -CITY_HALF, CITY_HALF);
      cop.pos.z = clamp(cop.pos.z, -CITY_HALF, CITY_HALF);
    }
  }

  // ---------------------------------------------------------------------------
  // Kehilangan heat (sembunyi / menjauh)
  // ---------------------------------------------------------------------------
  // Jarak ke polisi terdekat; Infinity bila tidak ada patroli.
  function nearestCopDistance(playerPos) {
    if (!playerPos || COP_CARS.length === 0) return Infinity;
    var best = Infinity;
    for (var i = 0; i < COP_CARS.length; i++) {
      var d = dist2D(playerPos.x, playerPos.z, COP_CARS[i].pos.x, COP_CARS[i].pos.z);
      if (d < best) best = d;
    }
    return best;
  }

  // Player dianggap bersembunyi bila: jauh dari semua polisi (>140 m), atau
  // sudah lama tidak melakukan kejahatan dan tidak terlihat (polisi dalam
  // mode search, bukan pursue).
  function isHiding(player) {
    if (!player || !player.pos) return false;
    if (timeNow - lastCrimeAt < 8) return false; // baru berbuat kejahatan
    var d = nearestCopDistance(player.pos);
    if (d > 140) return true;
    var anyPursuing = false;
    for (var i = 0; i < COP_CARS.length; i++) {
      if (COP_CARS[i].state === "pursue" || COP_CARS[i].state === "ram") { anyPursuing = true; break; }
    }
    return !anyPursuing && d > 80;
  }

  function loseHeat(dt) {
    if (WANTED <= 0 && heatValue <= 0) return;
    var player = currentPlayer();
    var hiding = isHiding(player);
    var decay = 0;

    if (hiding) {
      hiddenTimer += dt;
      // Makin lama sembunyi, makin cepat heat turun.
      decay = 2.2 + Math.min(hiddenTimer / 10, 2.5);
    } else if (WANTED > 0) {
      hiddenTimer = 0;
      // Saat dikejar aktif heat praktis tidak turun; hanya merayap saat
      // player menjauh (>200 m dari polisi terdekat).
      var d = player ? nearestCopDistance(player.pos) : Infinity;
      if (d > 200) decay = 0.4;
    } else {
      hiddenTimer = 0;
      decay = 1.0;
    }

    if (decay > 0) {
      heatValue = clamp(heatValue - decay * dt, 0, MAX_HEAT);
    }

    // Bila heat habis, wanted turun satu bintang (dengan jeda antar penurunan).
    wantedCooldown -= dt;
    if (heatValue <= 0 && WANTED > 0 && wantedCooldown <= 0) {
      wantedCooldown = 4;
      setWanted(WANTED - 1);
      // Heat tidak langsung penuh lagi: mulai dari ambang bintang baru.
      heatValue = WANTED > 0 ? HEAT_THRESHOLDS[WANTED] : 0;
      hiddenTimer = 0;
      logPursuit("Heat cleared — wanted now " + WANTED + " star" + (WANTED === 1 ? "" : "s"));
    }
  }

  // Ganti mobil + respray menurunkan wanted: polisi kehilangan jejak kendaraan.
  function clearWantedAfterRespray() {
    if (WANTED <= 0) return false;
    heatValue = 0;
    setWanted(Math.max(0, WANTED - 1));
    hiddenTimer = 0;
    logPursuit("Respray + vehicle swap — wanted reduced to " + WANTED);
    return true;
  }

  // Ganti kendaraan saja (tanpa respray) mengurangi heat separuh.
  function vehicleSwapHeatCut() {
    heatValue = Math.floor(heatValue / 2);
    syncWantedFromHeat();
    logPursuit("Vehicle swapped — heat halved to " + heatValue);
  }

  // ---------------------------------------------------------------------------
  // Update utama — dipanggil tiap frame oleh game loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    if (!dt || dt <= 0) return;
    dt = Math.min(dt, 0.05);
    syncCopCars();
    timeNow += dt;

    var player = currentPlayer();

    // Sirene berkala selama pengejaran aktif.
    sirenTimer -= dt;
    if (WANTED >= 1 && sirenTimer <= 0) {
      sirenTimer = 2.8;
      if (SB.Audio && typeof SB.Audio.sfx === "function") {
        try { SB.Audio.sfx("siren"); } catch (e) { /* abaikan */ }
      }
    }

    // Saat wanted naik, heat ikut merayap naik selama pengejaran terlihat.
    if (WANTED >= 1 && player) {
      var nearest = nearestCopDistance(player.pos);
      if (nearest < 90) {
        heatValue = clamp(heatValue + dt * 0.8, 0, MAX_HEAT);
      }
    }

    for (var i = 0; i < COP_CARS.length; i++) {
      var cop = COP_CARS[i];
      if (WANTED >= 1 && player) {
        chaseTarget(cop, player, dt);
      } else {
        patrolUpdate(cop, dt);
      }
    }

    loseHeat(dt);

    // Tertangkap (sekali per frame, pakai cop terdekat — jangan per-cop,
    // supaya cop jauh tidak membatalkan cop dekat).
    if (WANTED >= 1 && player && player.onFoot) {
      var nd = nearestCopDistance(player.pos);
      var anyClose = false;
      for (var j = 0; j < COP_CARS.length; j++) {
        var cc = COP_CARS[j];
        if (cc.speed > 1 && dist2D(cc.pos.x, cc.pos.z, player.pos.x, player.pos.z) < 2.5) { anyClose = true; break; }
      }
      if (anyClose) {
        bustedTimer += dt;
        if (bustedTimer > 2) busted("caught by police on foot");
      } else if (nd < 6) {
        bustedTimer += dt * 0.5;
      } else {
        bustedTimer = Math.max(0, bustedTimer - dt);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helper publik
  // ---------------------------------------------------------------------------
  function isPursuing() {
    for (var i = 0; i < COP_CARS.length; i++) {
      if (COP_CARS[i].state === "pursue" || COP_CARS[i].state === "ram") return true;
    }
    return false;
  }

  function nearestCop(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < COP_CARS.length; i++) {
      var d = dist2D(x, z, COP_CARS[i].pos.x, COP_CARS[i].pos.z);
      if (d < bestD) { bestD = d; best = COP_CARS[i]; }
    }
    return best;
  }

  function status() {
    return {
      wanted: WANTED,
      heat: Math.round(heatValue),
      cops: COP_CARS.length,
      pursuing: isPursuing(),
      hiddenFor: Math.round(hiddenTimer),
      lastCrime: lastReport
    };
  }

  function reset() {
    WANTED = 0;
    SB.Police.WANTED = 0;
    heatValue = 0;
    lastCrimeAt = -9999;
    bustedTimer = 0;
    wantedCooldown = 0;
    hiddenTimer = 0;
    lastReport = "";
    pursuitLog.length = 0;
    COP_CARS.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Registrasi namespace
  // ---------------------------------------------------------------------------
  SB.Police = {
    WANTED: WANTED,
    COP_CARS: COP_CARS,
    heat: heat,
    update: update,
    pursue: pursue,
    loseHeat: loseHeat,
    setWanted: setWanted,
    commitCrime: commitCrime,
    isWitnessed: isWitnessed,
    clearWantedAfterRespray: clearWantedAfterRespray,
    vehicleSwapHeatCut: vehicleSwapHeatCut,
    isPursuing: isPursuing,
    nearestCop: nearestCop,
    nearestCopDistance: nearestCopDistance,
    isHiding: isHiding,
    status: status,
    log: pursuitLog,
    reset: reset
  };

})();

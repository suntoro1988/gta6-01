// npc.js — Sunset Bay v14
// Builder G (AI & city life).
// Kota hidup: pejalan kaki di trotoar + zebra cross, dan lalu lintas AI.
// Komunikasi antar modul HANYA lewat namespace SB (lihat design spec §4).
// Modul ini tidak meng-import modul lain dan tidak membaca file sumber lain.

(function () {
  "use strict";

  window.SB = window.SB || {};
  var SB = window.SB;

  // ---------------------------------------------------------------------------
  // Util kecil (mandiri, tanpa dependensi modul lain)
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
  // Grid jalan (fallback mandiri).
  // Kota 1200x1200: jalan lurus tiap 100 m, lebar ~14 m, trotoar di ±9 m dari
  // garis tengah. Bila SB.City.isRoad tersedia saat runtime, fungsi itu yang
  // dipakai untuk validasi; grid di bawah hanya penopang internal.
  // ---------------------------------------------------------------------------
  var ROAD_STEP = 100;
  var ROAD_HALF = 7;      // setengah lebar jalan
  var WALK_OFFSET = 10;   // jarak trotoar dari garis tengah jalan
  var CITY_HALF = 560;    // batas area pejalan kaki / lalu lintas

  function nearestRoadCoord(v) {
    return Math.round(v / ROAD_STEP) * ROAD_STEP;
  }
  function isOnRoadGrid(x, z) {
    var dx = Math.abs(x - nearestRoadCoord(x));
    var dz = Math.abs(z - nearestRoadCoord(z));
    return dx <= ROAD_HALF || dz <= ROAD_HALF;
  }
  function isRoadAt(x, z) {
    if (SB.City && typeof SB.City.isRoad === "function") {
      try { return !!SB.City.isRoad(x, z); } catch (e) { /* jatuh ke grid */ }
    }
    return isOnRoadGrid(x, z);
  }
  function districtAt(x, z) {
    if (SB.City && typeof SB.City.getDistrictAt === "function") {
      try { return SB.City.getDistrictAt(x, z); } catch (e) { /* lanjut */ }
    }
    return null;
  }

  // Titik trotoar: di samping sebuah jalan lurus, pada koordinat grid.
  function sidewalkPoint() {
    var along = randInt(-5, 5) * ROAD_STEP;
    var cross = randInt(-5, 5) * ROAD_STEP;
    var side = Math.random() < 0.5 ? -1 : 1;
    if (Math.random() < 0.5) {
      // Berjalan sejajar sumbu X: jalan di z = cross, trotoar z = cross ± 10.
      return { x: clamp(along, -CITY_HALF, CITY_HALF), z: clamp(cross + side * WALK_OFFSET, -CITY_HALF, CITY_HALF) };
    }
    // Berjalan sejajar sumbu Z: jalan di x = cross, trotoar x = cross ± 10.
    return { x: clamp(cross + side * WALK_OFFSET, -CITY_HALF, CITY_HALF), z: clamp(along, -CITY_HALF, CITY_HALF) };
  }

  // Titik zebra cross: persimpangan dua jalan (kelipatan 100,100).
  function crosswalkPoint() {
    return {
      x: randInt(-5, 5) * ROAD_STEP,
      z: randInt(-5, 5) * ROAD_STEP
    };
  }

  // ---------------------------------------------------------------------------
  // PEJALAN KAKI
  // ---------------------------------------------------------------------------
  var MOODS = ["calm", "happy", "hurried", "tourist", "chatting", "selfie", "phone"];
  var SHIRT_COLORS = [
    [0.85, 0.25, 0.25], [0.25, 0.45, 0.85], [0.95, 0.85, 0.30],
    [0.30, 0.75, 0.40], [0.90, 0.55, 0.85], [0.95, 0.95, 0.95],
    [0.15, 0.15, 0.20], [0.95, 0.55, 0.20], [0.45, 0.80, 0.85],
    [0.70, 0.30, 0.70], [0.55, 0.75, 0.30], [0.85, 0.65, 0.35]
  ];
  var SKIN_COLORS = [
    [0.95, 0.80, 0.65], [0.80, 0.60, 0.45], [0.60, 0.42, 0.30],
    [0.98, 0.88, 0.78], [0.72, 0.52, 0.38]
  ];
  var NAMES = [
    "Maya", "Rico", "Sinta", "Dimas", "Luna", "Beto", "Nadia", "Fajar",
    "Cleo", "Andre", "Rosa", "Kiki", "Tomas", "Ira", "Yusuf", "Dewi",
    "Marco", "Lia", "Hugo", "Tania", "Eko", "Sari", "Pablo", "Nina",
    "Omar", "Vera", "Dante", "Mira", "Seno", "Alya", "Rudi", "Citra",
    "Joko", "Elsa", "Bima", "Rani", "Doni", "Lulu"
  ];

  function makePedestrian(id) {
    var start = sidewalkPoint();
    var mood = pick(MOODS);
    var ped = {
      id: id,
      kind: "pedestrian",
      name: NAMES[id % NAMES.length],
      pos: { x: start.x, y: 0, z: start.z },
      dest: sidewalkPoint(),
      rotY: 0,
      speed: mood === "hurried" ? rand(1.9, 2.6) : mood === "tourist" ? rand(0.5, 0.9) : rand(1.0, 1.6),
      walkSpeed: 0,
      mood: mood,
      state: "walking",       // walking | idle | crossing | selfie | recording | fleeing | down | chatting
      color: pick(SHIRT_COLORS),
      skin: pick(SKIN_COLORS),
      scale: rand(0.92, 1.08),
      idleTimer: 0,
      selfieTimer: mood === "selfie" ? rand(2, 6) : 0,
      phoneOut: mood === "selfie" || mood === "phone" || mood === "tourist",
      panic: 0,               // 0..1, naik saat react() memicu lari
      panicTime: 0,
      fleeTarget: null,
      recordTimer: 0,         // durasi merekam dengan HP saat ada kejadian
      recordTarget: null,
      waitAtCrossing: 0,
      crossing: false,
      downTimer: 0,
      chatPartner: null,
      homeDistrict: null,
      stepPhase: Math.random() * Math.PI * 2
    };
    ped.walkSpeed = ped.speed;
    ped.rotY = angleTo(ped.pos.x, ped.pos.z, ped.dest.x, ped.dest.z);
    var d = districtAt(ped.pos.x, ped.pos.z);
    ped.homeDistrict = d && d.name ? d.name : null;
    return ped;
  }

  var PEDESTRIANS = [];
  for (var i = 0; i < 36; i++) {
    PEDESTRIANS.push(makePedestrian(i));
  }

  // Pilih tujuan baru: sebagian besar titik trotoar, kadang zebra cross
  // (menyeberang), kadang berhenti sebentar di tempat (idle / selfie).
  function pickNewDestination(ped) {
    var roll = Math.random();
    if (roll < 0.16) {
      // Menyeberang lewat zebra cross: dest di seberang jalan.
      var cross = crosswalkPoint();
      ped.dest = cross;
      ped.crossing = true;
      ped.waitAtCrossing = rand(0, 1.5); // tunggu sejenak sebelum menyeberang
      ped.state = "walking";
    } else if (roll < 0.26) {
      // Berhenti: selfie / lihat HP / ngobrol.
      ped.state = ped.mood === "selfie" ? "selfie" : (Math.random() < 0.5 ? "idle" : "chatting");
      ped.idleTimer = rand(2, 7);
      ped.selfieTimer = ped.state === "selfie" ? rand(2, 6) : 0;
      ped.dest = { x: ped.pos.x, z: ped.pos.z };
      ped.crossing = false;
    } else {
      ped.dest = sidewalkPoint();
      ped.crossing = false;
      ped.state = "walking";
    }
  }

  // Pejalan kaki menghindar dari mobil AI & mobil player yang mendekat.
  function avoidCars(ped, dt) {
    var danger = null;
    var dangerDist = 6;
    for (var i = 0; i < CARS_AI.length; i++) {
      var car = CARS_AI[i];
      var d = dist2D(ped.pos.x, ped.pos.z, car.pos.x, car.pos.z);
      if (d < dangerDist) { danger = car; dangerDist = d; }
    }
    var player = currentPlayer();
    if (player && !player.onFoot && player.vehicle) {
      var v = player.vehicle;
      var dp = dist2D(ped.pos.x, ped.pos.z, v.pos.x, v.pos.z);
      if (dp < dangerDist) { danger = v; dangerDist = dp; }
    }
    if (!danger) return;
    // Melangkah tegak lurus menjauhi arah datang mobil.
    var away = angleTo(danger.pos.x, danger.pos.z, ped.pos.x, ped.pos.z);
    var side = away + Math.PI / 2;
    ped.pos.x += Math.cos(side) * ped.speed * 1.4 * dt;
    ped.pos.z += Math.sin(side) * ped.speed * 1.4 * dt;
    ped.pos.x = clamp(ped.pos.x, -CITY_HALF, CITY_HALF);
    ped.pos.z = clamp(ped.pos.z, -CITY_HALF, CITY_HALF);
  }

  // Ambil info player dari SB.Game.state / SB.Player bila tersedia.
  function currentPlayer() {
    try {
      if (SB.Player && SB.Player.pos) {
        return {
          pos: SB.Player.pos,
          onFoot: SB.Player.onFoot !== false,
          vehicle: SB.Player.currentVehicle || null,
          speed: SB.Player.speed || 0
        };
      }
      if (SB.Game && SB.Game.state && SB.Game.state.player) {
        var p = SB.Game.state.player;
        return { pos: p.pos || { x: 0, y: 0, z: 0 }, onFoot: p.onFoot !== false, vehicle: p.vehicle || null, speed: p.speed || 0 };
      }
    } catch (e) { /* modul lain belum siap */ }
    return null;
  }

  // Tabrakan dengan mobil player: pejalan kaki jatuh, polisi dipanggil.
  function checkPlayerHit(ped) {
    var player = currentPlayer();
    if (!player || player.onFoot || !player.vehicle) return;
    var v = player.vehicle;
    var speed = Math.abs(v.speed || player.speed || 0);
    if (speed < 2) return;
    var d = dist2D(ped.pos.x, ped.pos.z, v.pos.x, v.pos.z);
    if (d < 1.6 && ped.state !== "down") {
      knockDown(ped, v);
    }
  }

  function knockDown(ped, vehicle) {
    ped.state = "down";
    ped.downTimer = rand(4, 8);
    ped.panic = 1;
    ped.dest = { x: ped.pos.x, z: ped.pos.z };
    if (SB.FX && typeof SB.FX.spawnParticles === "function") {
      try { SB.FX.spawnParticles(ped.pos, [1.0, 0.3, 0.2], 10); } catch (e) { /* abaikan */ }
    }
    if (SB.Audio && typeof SB.Audio.sfx === "function") {
      try { SB.Audio.sfx("crash"); } catch (e) { /* abaikan */ }
    }
    if (SB.Police && typeof SB.Police.commitCrime === "function") {
      try { SB.Police.commitCrime("hit_pedestrian", ped.pos); } catch (e) { /* abaikan */ }
    }
    // Pejalan kaki di sekitar ikut panik.
    react({ type: "crash", pos: { x: ped.pos.x, y: 0, z: ped.pos.z }, radius: 25 });
  }

  // ---------------------------------------------------------------------------
  // Update pejalan kaki
  // ---------------------------------------------------------------------------
  function updatePedestrian(ped, dt) {
    // Terjatuh: berbaring sebentar lalu bangkit dan kabur.
    if (ped.state === "down") {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.state = "fleeing";
        ped.panic = 0.9;
        ped.panicTime = 3;
        ped.fleeTarget = sidewalkPoint();
      }
      return;
    }

    // Merekam kejadian dengan HP: berdiri diam menghadap sumber kejadian.
    if (ped.state === "recording") {
      ped.recordTimer -= dt;
      if (ped.recordTarget) {
        ped.rotY = angleTo(ped.pos.x, ped.pos.z, ped.recordTarget.x, ped.recordTarget.z);
      }
      if (ped.recordTimer <= 0) {
        ped.state = "fleeing";
        ped.panic = 0.6;
        ped.panicTime = 2.5;
        ped.fleeTarget = sidewalkPoint();
        ped.recordTarget = null;
      }
      return;
    }

    // Lari panik menjauh dari sumber bahaya.
    if (ped.state === "fleeing") {
      ped.panicTime -= dt;
      ped.panic = Math.max(0, ped.panicTime / 3);
      var target = ped.fleeTarget || sidewalkPoint();
      moveToward(ped, target, ped.speed * 3.1, dt);
      if (ped.panicTime <= 0 || dist2D(ped.pos.x, ped.pos.z, target.x, target.z) < 2) {
        ped.state = "walking";
        ped.panic = 0;
        ped.fleeTarget = null;
        pickNewDestination(ped);
      }
      return;
    }

    // Diam: selfie / idle / ngobrol.
    if (ped.state === "idle" || ped.state === "selfie" || ped.state === "chatting") {
      ped.idleTimer -= dt;
      if (ped.state === "selfie") {
        ped.selfieTimer -= dt;
        // Putar badan pelan seolah mencari angle foto terbaik.
        ped.rotY += dt * 0.6;
        if (ped.selfieTimer <= 0) {
          ped.state = "walking";
          pickNewDestination(ped);
        }
      } else if (ped.idleTimer <= 0) {
        pickNewDestination(ped);
      }
      return;
    }

    // Menunggu sebelum menyeberang di zebra cross.
    if (ped.crossing && ped.waitAtCrossing > 0) {
      ped.waitAtCrossing -= dt;
      return;
    }

    // Berjalan menuju tujuan.
    moveToward(ped, ped.dest, ped.speed, dt);
    avoidCars(ped, dt);
    checkPlayerHit(ped);

    var arrived = dist2D(ped.pos.x, ped.pos.z, ped.dest.x, ped.dest.z) < 1.5;
    if (arrived) {
      if (ped.crossing) {
        // Sampai di seberang: lanjut ke trotoar berikutnya.
        ped.crossing = false;
        ped.dest = sidewalkPoint();
      } else {
        pickNewDestination(ped);
      }
    }
  }

  function moveToward(ped, target, speed, dt) {
    var dx = target.x - ped.pos.x;
    var dz = target.z - ped.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.01) return;
    var step = Math.min(d, speed * dt);
    ped.pos.x += (dx / d) * step;
    ped.pos.z += (dz / d) * step;
    ped.rotY = angleTo(ped.pos.x - (dx / d) * step, ped.pos.z - (dz / d) * step, ped.pos.x, ped.pos.z);
    ped.stepPhase += dt * speed * 4;
  }

  // ---------------------------------------------------------------------------
  // Reaksi terhadap kejadian (tembakan / ledakan / kejar-kejaran / tabrakan)
  // event: { type: 'gunshot'|'explosion'|'chase'|'crash', pos: {x,y,z}, radius? }
  // ---------------------------------------------------------------------------
  function react(event) {
    if (!event || !event.pos) return;
    var type = event.type || "gunshot";
    var radius = event.radius || (type === "explosion" ? 90 : type === "chase" ? 60 : 45);
    var ex = event.pos.x, ez = event.pos.z;

    for (var i = 0; i < PEDESTRIANS.length; i++) {
      var ped = PEDESTRIANS[i];
      if (ped.state === "down") continue;
      var d = dist2D(ped.pos.x, ped.pos.z, ex, ez);
      if (d > radius) continue;

      // Sebagian pejalan kaki (terutama turis & yang pegang HP) merekam dulu
      // sebelum lari — ciri khas kota Sunset Bay.
      var willRecord = ped.phoneOut && Math.random() < 0.45 && type !== "explosion";
      if (willRecord && d > 12) {
        ped.state = "recording";
        ped.recordTimer = rand(2, 5);
        ped.recordTarget = { x: ex, z: ez };
        ped.dest = { x: ped.pos.x, z: ped.pos.z };
        continue;
      }

      // Sisanya lari menjauh dari sumber kejadian.
      ped.state = "fleeing";
      ped.panic = 1;
      ped.panicTime = rand(2.5, 5);
      var away = angleTo(ex, ez, ped.pos.x, ped.pos.z);
      var fleeDist = rand(40, 90);
      ped.fleeTarget = {
        x: clamp(ped.pos.x + Math.cos(away) * fleeDist, -CITY_HALF, CITY_HALF),
        z: clamp(ped.pos.z + Math.sin(away) * fleeDist, -CITY_HALF, CITY_HALF)
      };
      ped.mood = "panicked";
    }

    if (type === "gunshot" && SB.Audio && typeof SB.Audio.sfx === "function") {
      try { SB.Audio.sfx("gunshot"); } catch (e) { /* abaikan */ }
    }
    if (type === "explosion" && SB.FX && typeof SB.FX.explosion === "function") {
      try { SB.FX.explosion({ x: ex, y: 0, z: ez }); } catch (e) { /* abaikan */ }
    }
  }

  // ---------------------------------------------------------------------------
  // MOBIL LALU LINTAS AI (38 mobil)
  // ---------------------------------------------------------------------------
  var CAR_COLORS = [
    [0.80, 0.10, 0.10], [0.10, 0.20, 0.70], [0.90, 0.90, 0.90],
    [0.15, 0.15, 0.15], [0.95, 0.75, 0.10], [0.10, 0.60, 0.30],
    [0.85, 0.40, 0.05], [0.40, 0.75, 0.90], [0.60, 0.60, 0.65],
    [0.55, 0.15, 0.55], [0.25, 0.55, 0.85], [0.95, 0.55, 0.65]
  ];
  var CAR_MODELS = ["sedan", "taxi", "van", "pickup", "coupe", "bus"];

  // Rute: urutan persimpangan grid (x,z kelipatan 100) yang dilalui mobil.
  function makeRoute() {
    var route = [];
    var x = randInt(-5, 5) * ROAD_STEP;
    var z = randInt(-5, 5) * ROAD_STEP;
    route.push({ x: x, z: z });
    var n = randInt(4, 8);
    for (var i = 0; i < n; i++) {
      if (Math.random() < 0.5) {
        x = clamp(x + pick([-1, 1]) * ROAD_STEP * randInt(1, 3), -500, 500);
      } else {
        z = clamp(z + pick([-1, 1]) * ROAD_STEP * randInt(1, 3), -500, 500);
      }
      route.push({ x: x, z: z });
    }
    return route;
  }

  function makeAICar(id) {
    var route = makeRoute();
    var start = route[0];
    var next = route[1] || route[0];
    var model = pick(CAR_MODELS);
    var car = {
      id: id,
      kind: "traffic",
      model: model,
      pos: { x: start.x, y: 0, z: start.z },
      rotY: angleTo(start.x, start.z, next.x, next.z),
      speed: 0,
      targetSpeed: model === "bus" ? rand(6, 8) : model === "van" ? rand(7, 9) : rand(8, 13),
      route: route,
      routeIndex: 1,
      color: model === "taxi" ? [0.95, 0.80, 0.10] : pick(CAR_COLORS),
      stopped: false,
      waitTimer: 0,
      brakeLight: false,
      honkCooldown: rand(5, 20)
    };
    car.speed = car.targetSpeed;
    return car;
  }

  var CARS_AI = [];
  for (var j = 0; j < 38; j++) {
    CARS_AI.push(makeAICar(j));
  }

  // Mobil di depan pada jalur yang sama (untuk menghindar / menjaga jarak).
  function carAhead(car) {
    var best = null;
    var bestD = 14;
    for (var i = 0; i < CARS_AI.length; i++) {
      var other = CARS_AI[i];
      if (other === car) continue;
      var dx = other.pos.x - car.pos.x;
      var dz = other.pos.z - car.pos.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d > bestD || d < 0.01) continue;
      // Hanya yang berada di depan (searah hadap mobil ini).
      var fx = Math.sin(car.rotY), fz = Math.cos(car.rotY);
      var dot = (dx / d) * fx + (dz / d) * fz;
      if (dot > 0.7) { best = other; bestD = d; }
    }
    return best;
  }

  function updateAICar(car, dt) {
    car.honkCooldown -= dt;

    // Berhenti di persimpangan: jeda singkat tiap sampai di titik rute yang
    // merupakan persimpangan (kedua koordinat kelipatan 100).
    if (car.waitTimer > 0) {
      car.waitTimer -= dt;
      car.speed = Math.max(0, car.speed - 20 * dt);
      car.brakeLight = true;
      if (car.waitTimer <= 0) car.stopped = false;
      return;
    }

    var target = car.route[car.routeIndex];
    if (!target) {
      car.route = makeRoute();
      car.routeIndex = 1;
      return;
    }

    var dx = target.x - car.pos.x;
    var dz = target.z - car.pos.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    var desiredRot = Math.atan2(dx, dz);
    // Belok halus ke arah tujuan.
    var diff = desiredRot - car.rotY;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    car.rotY += clamp(diff, -1.8 * dt, 1.8 * dt);

    // Menghindar: pelan bila ada mobil di depan, berhenti bila terlalu dekat.
    var ahead = carAhead(car);
    var desiredSpeed = car.targetSpeed;
    if (ahead) {
      var gap = dist2D(car.pos.x, car.pos.z, ahead.pos.x, ahead.pos.z);
      if (gap < 7) desiredSpeed = 0;
      else if (gap < 12) desiredSpeed = car.targetSpeed * 0.35;
      car.brakeLight = desiredSpeed < car.speed;
    } else {
      car.brakeLight = false;
    }

    // Pejalan kaki menyeberang di depan: berhenti.
    for (var p = 0; p < PEDESTRIANS.length; p++) {
      var ped = PEDESTRIANS[p];
      if (ped.crossing && ped.state === "walking") {
        var pd = dist2D(car.pos.x, car.pos.z, ped.pos.x, ped.pos.z);
        if (pd < 9) { desiredSpeed = 0; car.brakeLight = true; break; }
      }
    }

    // Percepat / perlambat menuju kecepatan yang diinginkan.
    if (car.speed < desiredSpeed) car.speed = Math.min(desiredSpeed, car.speed + 6 * dt);
    else if (car.speed > desiredSpeed) car.speed = Math.max(desiredSpeed, car.speed - 14 * dt);

    car.pos.x += Math.sin(car.rotY) * car.speed * dt;
    car.pos.z += Math.cos(car.rotY) * car.speed * dt;

    // Klakson sesekali bila macet.
    if (car.speed < 0.5 && ahead && car.honkCooldown <= 0) {
      car.honkCooldown = rand(8, 25);
      if (SB.Audio && typeof SB.Audio.sfx === "function") {
        try { SB.Audio.sfx("horn"); } catch (e) { /* abaikan */ }
      }
    }

    // Sampai di titik rute: lanjut ke titik berikut, kadang berhenti sebentar
    // di persimpangan (simulasi lampu lalu lintas / persimpangan).
    if (d < 3) {
      var atJunction = (Math.abs(target.x) % ROAD_STEP === 0) && (Math.abs(target.z) % ROAD_STEP === 0);
      if (atJunction && Math.random() < 0.4) {
        car.stopped = true;
        car.waitTimer = rand(1, 3.5);
      }
      car.routeIndex++;
      if (car.routeIndex >= car.route.length) {
        car.route = makeRoute();
        // Sambung rute baru dari posisi saat ini agar tidak teleport jauh.
        car.route[0] = { x: Math.round(car.pos.x / ROAD_STEP) * ROAD_STEP, z: Math.round(car.pos.z / ROAD_STEP) * ROAD_STEP };
        car.routeIndex = 1;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update utama — dipanggil tiap frame oleh game loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    if (!dt || dt <= 0) return;
    dt = Math.min(dt, 0.05); // clamp agar tidak lompat saat frame tersendat
    for (var i = 0; i < PEDESTRIANS.length; i++) {
      updatePedestrian(PEDESTRIANS[i], dt);
    }
    for (var j = 0; j < CARS_AI.length; j++) {
      updateAICar(CARS_AI[j], dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper publik (untuk render / QA / modul lain)
  // ---------------------------------------------------------------------------
  function nearestPedestrian(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < PEDESTRIANS.length; i++) {
      var d = dist2D(x, z, PEDESTRIANS[i].pos.x, PEDESTRIANS[i].pos.z);
      if (d < bestD) { bestD = d; best = PEDESTRIANS[i]; }
    }
    return best;
  }

  function countByState(state) {
    var n = 0;
    for (var i = 0; i < PEDESTRIANS.length; i++) {
      if (PEDESTRIANS[i].state === state) n++;
    }
    return n;
  }

  function reset() {
    PEDESTRIANS.length = 0;
    for (var i = 0; i < 36; i++) PEDESTRIANS.push(makePedestrian(i));
    CARS_AI.length = 0;
    for (var j = 0; j < 38; j++) CARS_AI.push(makeAICar(j));
  }

  // ---------------------------------------------------------------------------
  // Registrasi namespace
  // ---------------------------------------------------------------------------
  SB.NPC = {
    PEDESTRIANS: PEDESTRIANS,
    CARS_AI: CARS_AI,
    update: update,
    react: react,
    nearestPedestrian: nearestPedestrian,
    countByState: countByState,
    isRoadAt: isRoadAt,
    reset: reset
  };

})();

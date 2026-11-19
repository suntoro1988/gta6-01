// vehicles.js — Sunset Bay v5 (Builder D)
// Fisika kendaraan + traffic AI + speedboat. Modul mandiri, tanpa impor.
// Ditulis fresh dari design-spec, sesi recording 01a1f13f-5466-77cb-9088-12e78d473c06.

'use strict';

// ---------- util lokal ----------
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function lerp(a, b, t) { return a + (b - a) * t; }

// Palet warna mobil (24 warna, dari spec: warna acak dari palet).
export const CAR_COLORS = [
  '#e33e2b', '#f2a007', '#f5d90a', '#2fae4e', '#1f8fff', '#2447d6',
  '#7a3fd1', '#e26fb5', '#f2f2f2', '#1c1c22', '#8a8f98', '#5b3a1e',
  '#0fa3a3', '#9be15d', '#ff7a1a', '#b3123f', '#3a6ea5', '#c9a227',
  '#6b7c93', '#d94f70', '#2b2b4a', '#a8e063', '#ffcf3f', '#4ecdc4',
];

export const CAR_MODELS = ['sport', 'sedan', 'truck', 'taxi'];

// Spesifikasi per model: akselerasi, top speed, grip, ukuran.
const MODEL_SPEC = {
  sport: { accel: 26, topSpeed: 38, reverse: 12, grip: 3.4, len: 4.4, wid: 2.0, brake: 34 },
  sedan: { accel: 20, topSpeed: 30, reverse: 10, grip: 3.0, len: 4.6, wid: 2.0, brake: 30 },
  truck: { accel: 14, topSpeed: 24, reverse: 8,  grip: 2.4, len: 6.2, wid: 2.4, brake: 24 },
  taxi:  { accel: 20, topSpeed: 30, reverse: 10, grip: 3.0, len: 4.6, wid: 2.0, brake: 30 },
  police:{ accel: 24, topSpeed: 34, reverse: 11, grip: 3.2, len: 4.6, wid: 2.0, brake: 32 },
  boat:  { accel: 18, topSpeed: 32, reverse: 8,  grip: 1.6, len: 6.0, wid: 2.4, brake: 18 },
};

// ---------- tabrakan / dinding ----------
// Gedung dianggap kotak axis-aligned {x, z, w, d}. Air dianggap penghalang mobil.
function blockedAt(city, x, z, margin) {
  if (!city) return false;
  const b = city.bounds;
  if (b) {
    if (x < b.minX + margin || x > b.maxX - margin) return true;
    if (z < b.minZ + margin || z > b.maxZ - margin) return true;
  }
  const list = city.buildings || [];
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const hw = (g.w || 10) / 2 + margin;
    const hd = (g.d || 10) / 2 + margin;
    if (Math.abs(x - g.x) < hw && Math.abs(z - g.z) < hd) return true;
  }
  return false;
}

function inWaterAt(city, x, z) {
  if (!city) return false;
  if (typeof city.isWater === 'function') {
    try { return !!city.isWater(city, x, z); } catch (e) { /* jatuh ke cek manual */ }
  }
  const areas = city.water || [];
  for (let i = 0; i < areas.length; i++) {
    const w = areas[i];
    const hw = (w.w || 0) / 2, hd = (w.d || 0) / 2;
    if (Math.abs(x - (w.x || 0)) < hw && Math.abs(z - (w.z || 0)) < hd) return true;
  }
  return false;
}

// Geser posisi dengan wall-slide: coba gerak penuh, bila tertabrak coba
// sumbu X saja lalu sumbu Z saja, sehingga mobil meluncur sepanjang dinding
// dan tidak pernah macet menempel dinding.
function moveWithSlide(obj, nx, nz, city, margin) {
  if (!blockedAt(city, nx, nz, margin) && !inWaterAt(city, nx, nz)) {
    obj.x = nx; obj.z = nz;
    return;
  }
  // Coba X saja.
  if (!blockedAt(city, nx, obj.z, margin) && !inWaterAt(city, nx, obj.z)) {
    obj.x = nx;
    return;
  }
  // Coba Z saja.
  if (!blockedAt(city, obj.x, nz, margin) && !inWaterAt(city, obj.x, nz)) {
    obj.z = nz;
    return;
  }
  // Kedua sumbu tertabrak: diam di tempat (kecepatan dipotong pemanggil).
  obj._hitWall = true;
}

// ---------- mobil pemain ----------

export function createCar(x, z, heading, model, color) {
  const m = MODEL_SPEC[model] ? model : 'sedan';
  const spec = MODEL_SPEC[m];
  return {
    x: x || 0,
    z: z || 0,
    heading: heading || 0,
    speed: 0,
    model: m,
    color: color || CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    steer: 0,            // sudut kemudi saat ini (rad, visual + fisika)
    driftTime: 0,        // durasi drift berjalan (detik)
    drifting: false,
    driftCount: 0,       // total drift berbayar yang terjadi
    driftRewarded: false,// drift berjalan sudah dibayar atau belum
    driftPayout: 0,      // $ yang menunggu diklaim game.js (50 per drift)
    topSpeedBonus: 0,    // tambahan dari upgrade garage (diisi game.js)
    upgrade: 0,          // level engine 0..3 (diisi game.js)
    len: spec.len,
    wid: spec.wid,
    _hitWall: false,
  };
}

// input: {up, down, left, right, handbrake} — semua boolean.
// dt: detik. city: objek kota dari buildCity (boleh null saat tes).
export function stepCar(car, input, dt, city) {
  if (!car || !dt || dt <= 0) return car;
  input = input || {};
  const spec = MODEL_SPEC[car.model] || MODEL_SPEC.sedan;
  // Top speed: base + garage upgrade. game.js sets BOTH car.upgrade and
  // car.engineLevel (same level 0..3); honour either so upgrades work
  // whichever field the caller filled.
  const top = spec.topSpeed + (car.topSpeedBonus || 0) + Math.max(car.upgrade || 0, car.engineLevel || 0) * 3;
  car._hitWall = false;

  const forward = car.speed >= 0 ? 1 : -1;
  const absSpeed = Math.abs(car.speed);

  // --- akselerasi / rem / mundur ---
  if (input.up) {
    car.speed += spec.accel * dt * (car.speed < 0 ? 2.2 : 1);
  } else if (input.down) {
    if (car.speed > 0.5) car.speed -= spec.brake * dt;      // rem
    else car.speed -= spec.accel * 0.55 * dt;                // mundur
  } else {
    // Gesekan gelinding + hambatan udara.
    const drag = 2.2 + absSpeed * 0.045;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - drag * dt);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + drag * dt);
  }
  car.speed = clamp(car.speed, -spec.reverse, top);

  // --- kemudi progresif: makin cepat, makin kecil sudut belok ---
  // Pada 0 u/s belok penuh, pada top speed hanya ~28% — mobil tetap
  // terkendali di kecepatan tinggi dan tidak spin liar.
  const steerAuthority = 1 / (1 + absSpeed * 0.055);
  const maxSteer = 0.62 * steerAuthority + 0.10;
  const steerTarget = (input.left ? 1 : 0) * maxSteer - (input.right ? 1 : 0) * maxSteer;
  const steerRate = input.handbrake ? 6.5 : 5.0;
  car.steer += clamp(steerTarget - car.steer, -steerRate * dt, steerRate * dt);

  const handbrake = !!input.handbrake && absSpeed > 6;
  const grip = handbrake ? spec.grip * 0.45 : spec.grip;

  // Putaran heading sebanding kecepatan & kemudi, dibagi grip saat drift.
  const turnRate = (car.steer * car.speed) / (spec.len * (handbrake ? 0.75 : 1));
  car.heading = wrapAngle(car.heading + turnRate * dt);

  // --- drift: handbrake + belok + kecepatan ---
  const wantDrift = handbrake && Math.abs(car.steer) > 0.12 && absSpeed > 8;
  if (wantDrift) {
    car.drifting = true;
    car.driftTime += dt;
    // Saat drift, mobil sedikit meluncur menyamping: kurangi kecepatan
    // lebih lambat dan tambah selip lateral kecil ke arah luar belokan.
    car.speed -= car.speed * 0.12 * dt;
    if (car.driftTime >= 0.5 && !car.driftRewarded) {
      // Payout dicatat di sini; game.js yang mengklaimnya ke uang pemain
      // (stepCar tidak memegang state S, jadi tidak menyentuh S.money).
      car.driftRewarded = true;
      car.driftCount += 1;
      car.driftPayout += 50;
    }
  } else {
    if (car.drifting && car.driftTime < 0.5) {
      // Drift putus sebelum 0,5 detik: tidak dibayar.
    }
    car.drifting = false;
    car.driftTime = 0;
    car.driftRewarded = false;
  }
  void grip;

  // --- gerak maju + wall slide ---
  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  moveWithSlide(car, nx, nz, city, 1.6);
  if (car._hitWall) {
    // Menabrak dinding: potong kecepatan sebagian, jangan sampai nol total
    // supaya wall-slide tetap terasa meluncur.
    car.speed *= 0.55;
  }
  return car;
}

// ---------- speedboat ----------

export function createBoat(x, z, heading) {
  return {
    x: x || 0,
    z: z || 0,
    heading: heading || 0,
    speed: 0,
    model: 'boat',
    color: '#f2f2f2',
    steer: 0,
    bobPhase: Math.random() * Math.PI * 2,
    bobY: 0,          // tinggi ombak saat ini (dipakai renderer)
    wake: 0,          // intensitas jejak air
    len: 6.0,
    wid: 2.4,
    _hitWall: false,
  };
}

// Fisika boat: akselerasi lebih lambat, belok lebih lebar dari mobil,
// ada goyangan ombak (bobY) dan hambatan air yang kuat saat gas dilepas.
export function stepBoat(boat, input, dt, city) {
  if (!boat || !dt || dt <= 0) return boat;
  input = input || {};
  const spec = MODEL_SPEC.boat;
  boat._hitWall = false;

  if (input.up) boat.speed += spec.accel * dt;
  else if (input.down) boat.speed -= spec.accel * 0.5 * dt;
  else {
    // Hambatan air: boat melambat jelas tanpa gas.
    const drag = 3.0 + Math.abs(boat.speed) * 0.08;
    if (boat.speed > 0) boat.speed = Math.max(0, boat.speed - drag * dt);
    else if (boat.speed < 0) boat.speed = Math.min(0, boat.speed + drag * dt);
  }
  boat.speed = clamp(boat.speed, -spec.reverse, spec.topSpeed);

  // Belok lebar: otoritas kemudi lebih kecil dan respons lebih lambat.
  const absSpeed = Math.abs(boat.speed);
  const maxSteer = 0.42 / (1 + absSpeed * 0.03);
  const steerTarget = (input.left ? 1 : 0) * maxSteer - (input.right ? 1 : 0) * maxSteer;
  boat.steer += clamp(steerTarget - boat.steer, -2.2 * dt, 2.2 * dt);
  boat.heading = wrapAngle(boat.heading + (boat.steer * boat.speed * dt) / 7.5);

  // Ombak: naik-turun sinusoidal, amplitudo membesar saat laju.
  boat.bobPhase += dt * (1.6 + absSpeed * 0.06);
  boat.bobY = Math.sin(boat.bobPhase) * (0.12 + absSpeed * 0.012);
  boat.wake = clamp(absSpeed / spec.topSpeed, 0, 1);

  const nx = boat.x + Math.sin(boat.heading) * boat.speed * dt;
  const nz = boat.z + Math.cos(boat.heading) * boat.speed * dt;

  // Boat hanya boleh di air; darat / dermaga = dinding (slide di tepi).
  if (!inWaterAt(city, nx, nz) && city && (city.water || []).length) {
    // Coba slide sepanjang tepi air.
    if (inWaterAt(city, nx, boat.z)) boat.x = nx;
    else if (inWaterAt(city, boat.x, nz)) boat.z = nz;
    else { boat._hitWall = true; boat.speed *= 0.5; }
  } else {
    boat.x = nx; boat.z = nz;
  }
  // Jaga tetap di dalam bounds kota.
  if (city && city.bounds) {
    boat.x = clamp(boat.x, city.bounds.minX + 2, city.bounds.maxX - 2);
    boat.z = clamp(boat.z, city.bounds.minZ + 2, city.bounds.maxZ - 2);
  }
  return boat;
}

// ---------- traffic AI ----------

function randomRoadPoint(city, rng) {
  const roads = (city && city.roads) || [];
  if (!roads.length) return { x: 0, z: 0 };
  const r = roads[Math.floor((rng ? rng.next() : Math.random()) * roads.length)];
  const t = rng ? rng.next() : Math.random();
  return { x: lerp(r.x1, r.x2, t), z: lerp(r.z1, r.z2, t) };
}

function roadHeading(road) {
  return Math.atan2(road.x2 - road.x1, road.z2 - road.z1);
}

// Satu mobil traffic: mengikuti satu ruas jalan dari ujung ke ujung,
// lalu memilih ruas lanjutan yang tersambung di persimpangan.
function makeTrafficCar(city, rng) {
  const roads = (city && city.roads) || [];
  const pickModel = () => {
    const roll = rng ? rng.next() : Math.random();
    if (roll < 0.55) return 'sedan';
    if (roll < 0.75) return 'taxi';
    if (roll < 0.92) return 'sport';
    return 'truck';
  };
  let car;
  if (roads.length) {
    const road = roads[Math.floor((rng ? rng.next() : Math.random()) * roads.length)];
    const t = rng ? rng.next() : Math.random();
    const x = lerp(road.x1, road.x2, t);
    const z = lerp(road.z1, road.z2, t);
    const dir = (rng ? rng.next() : Math.random()) < 0.5 ? 1 : -1;
    // Heading awal HARUS searah dir, kalau tidak mobil berputar dulu dan
    // langsung keluar dari garis jalan.
    car = createCar(x, z, roadHeading(road) + (dir === -1 ? Math.PI : 0), pickModel());
    car.road = road;
    car.roadT = t;
    car.dir = dir;
  } else {
    car = createCar((rng ? rng.range(-60, 60) : 0), (rng ? rng.range(-60, 60) : 0), 0, pickModel());
    car.road = null;
    car.dir = 1;
  }
  car.cruise = 9 + (rng ? rng.next() : Math.random()) * 7; // 9..16 u/s
  car.wait = 0;          // jeda berhenti di persimpangan
  car.stuck = 0;
  car.isTraffic = true;
  return car;
}

export function createTraffic(city, rng) {
  const count = 14;
  const cars = [];
  for (let i = 0; i < count; i++) cars.push(makeTrafficCar(city, rng));
  return { cars: cars };
}

// Cari ruas jalan yang tersambung di ujung ruas saat ini (persimpangan).
function nextRoad(city, road, endX, endZ) {
  const roads = (city && city.roads) || [];
  const near = [];
  for (let i = 0; i < roads.length; i++) {
    const r = roads[i];
    if (r === road) continue;
    const d1 = Math.hypot(r.x1 - endX, r.z1 - endZ);
    const d2 = Math.hypot(r.x2 - endX, r.z2 - endZ);
    if (Math.min(d1, d2) < 6) near.push(r);
  }
  if (!near.length) return null;
  return near[Math.floor(Math.random() * near.length)];
}

function stepTrafficCar(car, city, S, dt) {
  const roads = (city && city.roads) || [];
  if (!car.road || !roads.length) {
    // Tanpa jalan: jalan pelan mengitari pusat kota.
    car.heading = wrapAngle(car.heading + 0.25 * dt);
    car.speed = 8;
    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    moveWithSlide(car, nx, nz, city, 1.6);
    return;
  }

  if (car.wait > 0) {
    car.wait -= dt;
    car.speed = 0;
    return;
  }

  // Berhenti sejenak bila ada mobil pemain / traffic lain di depan.
  const aheadX = car.x + Math.sin(car.heading) * 9;
  const aheadZ = car.z + Math.cos(car.heading) * 9;
  let blocked = false;
  if (S) {
    const others = [];
    if (S.car) others.push(S.car);
    if (S.player) others.push(S.player);
    const cops = S.cops || S.police || [];
    for (let i = 0; i < cops.length; i++) others.push(cops[i]);
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (!o || o === car) continue;
      if (Math.hypot((o.x || 0) - aheadX, (o.z || 0) - aheadZ) < 4.5) { blocked = true; break; }
    }
  }
  if (blocked) { car.speed = Math.max(0, car.speed - 20 * dt); }
  else car.speed = lerp(car.speed, car.cruise, clamp(dt * 1.5, 0, 1));

  // Pure pursuit: bidik titik 8 unit di depan pada ruas jalan. Ini yang
  // menjaga mobil tetap di garis tengah jalan — bila terdorong keluar
  // (mis. habis berputar di ujung ruas), kemudi otomatis mengarahkannya
  // kembali ke jalan, bukan sekadar mengikuti heading ruas.
  const road = car.road;
  const dx = road.x2 - road.x1, dz = road.z2 - road.z1;
  const segLen = Math.hypot(dx, dz) || 1;
  let tt = ((car.x - road.x1) * dx + (car.z - road.z1) * dz) / (segLen * segLen);
  tt = clamp(tt, 0, 1);
  const along = tt * segLen;
  const look = car.dir === 1 ? Math.min(segLen, along + 8) : Math.max(0, along - 8);
  const tx = road.x1 + dx * (look / segLen);
  const tz = road.z1 + dz * (look / segLen);
  const targetHeading = Math.atan2(tx - car.x, tz - car.z);
  let dh = wrapAngle(targetHeading - car.heading);
  car.heading = wrapAngle(car.heading + clamp(dh, -2.2 * dt, 2.2 * dt));

  const nx = car.x + Math.sin(car.heading) * car.speed * dt;
  const nz = car.z + Math.cos(car.heading) * car.speed * dt;
  moveWithSlide(car, nx, nz, city, 1.6);
  if (car._hitWall) car.speed *= 0.4;

  // Sampai ujung ruas? Pilih ruas lanjutan atau putar balik.
  const endX = car.dir === 1 ? road.x2 : road.x1;
  const endZ = car.dir === 1 ? road.z2 : road.z1;
  if (Math.hypot(car.x - endX, car.z - endZ) < 4) {
    const nxt = nextRoad(city, road, endX, endZ);
    if (nxt) {
      // Berhenti sejenak di persimpangan (20% peluang, 0,8–2 detik).
      if (Math.random() < 0.2) car.wait = 0.8 + Math.random() * 1.2;
      car.road = nxt;
      // Masuk dari ujung ruas baru yang terdekat dengan posisi sekarang.
      const d1 = Math.hypot(nxt.x1 - car.x, nxt.z1 - car.z);
      const d2 = Math.hypot(nxt.x2 - car.x, nxt.z2 - car.z);
      car.dir = d1 <= d2 ? 1 : -1;
    } else {
      car.dir = -car.dir; // jalan buntu: putar balik
      car.wait = 0.5;
    }
  }
}

export function stepTraffic(T, S, dt) {
  if (!T || !T.cars || !dt || dt <= 0) return;
  const city = (S && S.city) || null;
  for (let i = 0; i < T.cars.length; i++) {
    stepTrafficCar(T.cars[i], city, S, dt);
  }
}

// Sunset Bay v5 — jobs.js
// Pekerjaan sampingan taksi: penumpang muncul di pinggir jalan, pemain
// menjemput dengan mobil, mengantar ke tujuan, dan menerima fare.
// Bisa dilakukan kapan saja di luar misi.
//
// State taksi: 'idle' | 'toPickup' | 'toDropoff'
//   idle     — menunggu, timer jalan sampai penumpang berikutnya muncul
//   toPickup — penumpang menunggu di pinggir jalan, jemput dengan mobil
//   toDropoff— penumpang di dalam mobil, antar ke tujuan untuk dibayar
//
// Asumsi bentuk state S (dibagikan dari game.js):
//   S.city   — objek kota (roads, bounds)
//   S.player — {x, z, inCar} atau {x, z, car} saat mengemudi
//   S.car    — objek mobil pemain (bila S.player.car tidak dipakai)
//   S.money  — uang pemain (angka); fare langsung ditambahkan ke sini

const PASSENGER_NAMES = [
  'Maya', 'Dimas', 'Sinta', 'Budi', 'Rani', 'Agus',
  'Laras', 'Fajar', 'Nina', 'Raka', 'Dewi', 'Ilham',
];

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Posisi + status berkendara pemain, toleran terhadap variasi bentuk S.
function playerInfo(S) {
  const p = S.player || {};
  const x = typeof p.x === 'number' ? p.x : (typeof S.px === 'number' ? S.px : 0);
  const z = typeof p.z === 'number' ? p.z : (typeof S.pz === 'number' ? S.pz : 0);
  const inCar = !!(p.inCar || p.car || p.driving || S.car);
  return { x, z, inCar };
}

// Satu titik di pinggir jalan: pilih jalan acak, titik acak di sepanjangnya,
// lalu geser 6 unit ke sisi jalan (trotoar) supaya penumpang berdiri di
// tempat yang masuk akal, bukan di tengah aspal.
function roadsidePoint(city, nearX, nearZ, minDist, maxDist) {
  const roads = (city && city.roads) || [];
  if (roads.length === 0) {
    return { x: nearX + rand(-40, 40), z: nearZ + rand(-40, 40) };
  }
  for (let tries = 0; tries < 24; tries++) {
    const road = pick(roads);
    const t = Math.random();
    const x = road.x1 + (road.x2 - road.x1) * t;
    const z = road.z1 + (road.z2 - road.z1) * t;
    const d = dist2d(x, z, nearX, nearZ);
    if (d < minDist || d > maxDist) continue;
    // Arah tegak lurus jalan.
    const len = Math.hypot(road.x2 - road.x1, road.z2 - road.z1) || 1;
    const px = -(road.z2 - road.z1) / len;
    const pz = (road.x2 - road.x1) / len;
    const side = Math.random() < 0.5 ? 1 : -1;
    return { x: x + px * 6 * side, z: z + pz * 6 * side };
  }
  return { x: nearX + 30, z: nearZ + 10 };
}

export function createTaxi(S) {
  return {
    passenger: null,   // {x, z, name, destX, destZ} saat ada penumpang
    state: 'idle',
    fare: 0,
    timer: 6,          // penumpang pertama muncul ~6 detik setelah mulai
    waitTimer: 0,      // berapa lama penumpang menunggu dijemput
    lastFare: 0,       // fare terakhir yang dibayar (untuk popup/HUD)
    message: '',       // pesan singkat terakhir (mis. 'Fare +$80')
    city: (S && S.city) || null,
  };
}

export function stepTaxi(T, S, dt) {
  if (!S) return;
  if (!T.city && S.city) T.city = S.city;
  const me = playerInfo(S);

  if (T.state === 'idle') {
    T.timer -= dt;
    if (T.timer <= 0) {
      const spot = roadsidePoint(T.city, me.x, me.z, 25, 90);
      T.passenger = {
        x: spot.x, z: spot.z,
        name: pick(PASSENGER_NAMES),
        destX: 0, destZ: 0,
      };
      T.state = 'toPickup';
      T.waitTimer = 0;
      T.message = '';
    }
    return;
  }

  if (T.state === 'toPickup') {
    if (!T.passenger) { T.state = 'idle'; T.timer = 8; return; }
    T.waitTimer += dt;
    const d = dist2d(me.x, me.z, T.passenger.x, T.passenger.z);
    // Jemput: pemain harus datang dengan mobil dan berhenti dekat penumpang.
    if (me.inCar && d < 7) {
      const dest = roadsidePoint(T.city, T.passenger.x, T.passenger.z, 60, 160);
      T.passenger.destX = dest.x;
      T.passenger.destZ = dest.z;
      const trip = dist2d(T.passenger.x, T.passenger.z, dest.x, dest.z);
      // Fare $40..$120, naik dengan jarak tempuh.
      T.fare = Math.round(Math.min(120, Math.max(40, 40 + trip * 0.5)) / 5) * 5;
      T.state = 'toDropoff';
      T.message = T.passenger.name + ' naik — antar ke tujuan!';
      return;
    }
    // Penumpang bosan menunggu 45 detik lalu pergi.
    if (T.waitTimer > 45) {
      T.passenger = null;
      T.state = 'idle';
      T.timer = rand(8, 15);
      T.message = 'Penumpang pergi — terlambat menjemput.';
    }
    return;
  }

  if (T.state === 'toDropoff') {
    if (!T.passenger) { T.state = 'idle'; T.timer = 8; return; }
    const d = dist2d(me.x, me.z, T.passenger.destX, T.passenger.destZ);
    // Sampai tujuan dengan mobil: terima fare.
    if (me.inCar && d < 9) {
      if (typeof S.money === 'number') S.money += T.fare;
      T.lastFare = T.fare;
      T.message = 'Fare +$' + T.fare + ' — terima kasih, ' + T.passenger.name + '!';
      T.passenger = null;
      T.fare = 0;
      T.state = 'idle';
      T.timer = rand(10, 20);
      return;
    }
    // Pemain turun dari mobil / kabur jauh: penumpang turun dan pergi.
    if (!me.inCar) {
      T.waitTimer += dt;
      if (T.waitTimer > 10) {
        T.passenger = null;
        T.fare = 0;
        T.state = 'idle';
        T.timer = rand(8, 15);
        T.message = 'Penumpang turun — butuh mobil untuk mengantar.';
        T.waitTimer = 0;
      }
    } else {
      T.waitTimer = 0;
    }
  }
}

export function taxiStatus(T) {
  if (!T) return '';
  if (T.state === 'toPickup' && T.passenger) {
    return 'TAXI: jemput ' + T.passenger.name + ' di pinggir jalan!';
  }
  if (T.state === 'toDropoff' && T.passenger) {
    return 'TAXI: antar ' + T.passenger.name + ' — fare $' + T.fare;
  }
  return 'TAXI: menunggu penumpang…';
}

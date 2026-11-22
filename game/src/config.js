// Sunset Bay — konfigurasi bersama semua modul.
// Satu-satunya sumber kebenaran untuk konstanta dunia, distrik, warna,
// fisika, ekonomi, wanted level, dan tombol. Modul lain HANYA membaca
// SB.Config, tidak pernah mendefinisikan ulang angka-angka ini sendiri.
window.SB = window.SB || {};

SB.Config = {
  // Dunia: kota 1200 x 1200 meter, tanah di y = 0, laut di tepi barat.
  WORLD: {
    SIZE: 1200,
    HALF: 600,
    MIN_X: -600,
    MAX_X: 600,
    MIN_Z: -600,
    MAX_Z: 600,
    GROUND_Y: 0,
    WATER_LEVEL: 0,
    ROAD_SPACING: 60,
    ROAD_WIDTH: 12,
    // Jembatan hero di tepi barat, tempat kejar-kejaran helikopter saat sunset.
    BRIDGE: { x: -260, z: 0, length: 220, width: 16 },
  },

  // 14 distrik. NAMA + pusat (x, z) + radius HARUS sama persis di city.js,
  // economy.js, dan weather.js. Jangan ubah satu angka pun tanpa mengubah
  // ketiga modul itu juga.
  DISTRICTS: [
    { name: 'Marina Bay',        x: 0,    z: 0,    radius: 120 },
    { name: 'Old Town',          x: -120, z: 40,   radius: 90  },
    { name: "Fisherman's Wharf", x: -185, z: 40,   radius: 55  },
    { name: 'Sunset Strip',      x: 120,  z: -60,  radius: 100 },
    { name: 'North Hills',       x: 60,   z: 180,  radius: 110 },
    { name: 'East Market',       x: 200,  z: 80,   radius: 90  },
    { name: 'Harbor Point',      x: -220, z: -80,  radius: 80  },
    { name: 'Palm Court',        x: 40,   z: -180, radius: 90  },
    { name: 'Coral District',    x: -60,  z: -140, radius: 80  },
    { name: 'Beacon Hill',       x: 180,  z: 180,  radius: 100 },
    { name: 'Little Havana',     x: -160, z: 160,  radius: 90  },
    { name: 'Airport South',     x: 260,  z: -160, radius: 110 },
    { name: 'University Row',    x: -40,  z: 220,  radius: 90  },
    { name: 'Industrial Docks',  x: 240,  z: 20,   radius: 100 },
  ],

  // Palet golden hour: matahari rendah oranye, langit biru dingin di atas,
  // laut jingga, neon menyala saat senja.
  COLORS: {
    SUN: '#ff9a3c',
    SUN_RGB: [1.0, 0.604, 0.235],
    SKY_TOP: [0.16, 0.32, 0.62],
    SKY_HORIZON: [1.0, 0.55, 0.25],
    SKY_NIGHT_TOP: [0.02, 0.03, 0.10],
    FOG_DAY: [0.98, 0.62, 0.38],
    FOG_NIGHT: [0.05, 0.06, 0.14],
    SEA: [0.10, 0.35, 0.55],
    SEA_SUNSET: [0.95, 0.45, 0.20],
    SAND: [0.85, 0.72, 0.52],
    ASPHALT: [0.16, 0.16, 0.18],
    SIDEWALK: [0.45, 0.44, 0.42],
    NEON_PINK: [1.0, 0.25, 0.65],
    NEON_CYAN: [0.15, 0.85, 1.0],
    NEON_YELLOW: [1.0, 0.85, 0.20],
    NEON_GREEN: [0.25, 1.0, 0.55],
    PALM_TRUNK: [0.45, 0.32, 0.20],
    PALM_LEAF: [0.15, 0.55, 0.25],
    // Warna fasad bangunan per distrik (dipakai city.js).
    BUILDING_PALETTE: [
      [0.85, 0.75, 0.62], [0.72, 0.62, 0.52], [0.90, 0.80, 0.70],
      [0.55, 0.65, 0.75], [0.95, 0.70, 0.55], [0.65, 0.55, 0.70],
      [0.80, 0.85, 0.88], [0.60, 0.58, 0.50], [0.88, 0.60, 0.60],
      [0.50, 0.60, 0.62],
    ],
    WINDOW_LIT: [1.0, 0.80, 0.35],
    WINDOW_DARK: [0.12, 0.16, 0.25],
  },

  // Fisika: jalan kaki, lari, dan handling mobil.
  PHYSICS: {
    GRAVITY: 22,
    WALK_SPEED: 6,
    RUN_SPEED: 10,
    SPRINT_MULTIPLIER: 1.5,
    JUMP_VELOCITY: 8,
    PLAYER_RADIUS: 0.6,
    PLAYER_HEIGHT: 1.8,
    CAR_ACCEL: 18,
    CAR_REVERSE_ACCEL: 10,
    CAR_MAX_SPEED: 42,
    CAR_MAX_REVERSE: 12,
    CAR_BRAKE: 30,
    CAR_TURN_RATE: 2.1,
    CAR_GRIP: 0.92,
    // Hujan membuat jalan licin: grip turun, jarak rem memanjang.
    RAIN_GRIP: 0.65,
    RAIN_BRAKE: 20,
    COLLISION_BOUNCE: 0.35,
    BOAT_SPEED: 9,
    HELICOPTER_SPEED: 26,
  },

  // Ekonomi: gaji job, harga senjata, hadiah balap & misi.
  ECONOMY: {
    START_CASH: 250,
    TAXI_FARE: 45,
    COURIER_PAY: 60,
    RACE_PRIZE: [500, 300, 150, 75, 50, 25],
    MISSION_PAY_BASE: 200,
    MISSION_PAY_PER_STAGE: 60,
    HEIST_PAYOUT: 5000,
    CASH_PICKUP_VALUES: [25, 50, 100],
    WEAPON_PRICES: { pistol: 300, smg: 900, shotgun: 1200 },
    AMMO_PRICE: 50,
    AMMO_PACK: 24,
    // Diskon toko naik mengikuti respect rank (0..0.25).
    RESPECT_DISCOUNT_PER_RANK: 0.05,
  },

  // Wanted: 0-5 bintang. Heat 0-100; tiap bintang butuh ambang heat.
  // Heat naik saat kejahatan, turun saat bersembunyi / tidak terlihat polisi.
  WANTED: {
    MAX_STARS: 5,
    STAR_THRESHOLDS: [0, 15, 35, 55, 75, 92],
    HEAT_PER_CRIME: { stealCar: 12, hitPedestrian: 18, shoot: 25, killCop: 40, speeding: 2 },
    HEAT_DECAY_PER_SEC: 0.6,
    HEAT_HIDDEN_DECAY_PER_SEC: 2.5,
    COP_SPAWN_PER_STAR: 1,
    COP_CAR_SPEED: 34,
    COP_FOOT_SPEED: 8.5,
    LOSE_HEAT_RADIUS: 120,
  },

  // Tombol (event.code). WASD jalan/nyetir, E curi mobil, Space rem,
  // Shift lari, R respray, 1-3 ganti senjata, Q ganti stasiun radio,
  // M mute, Esc/P pause, F interaksi.
  KEYS: {
    FORWARD: 'KeyW',
    BACK: 'KeyS',
    LEFT: 'KeyA',
    RIGHT: 'KeyD',
    SPRINT: 'ShiftLeft',
    STEAL: 'KeyE',
    BRAKE: 'Space',
    INTERACT: 'KeyF',
    RESPRAY: 'KeyR',
    WEAPON_1: 'Digit1',
    WEAPON_2: 'Digit2',
    WEAPON_3: 'Digit3',
    RADIO_NEXT: 'KeyQ',
    MUTE: 'KeyM',
    PAUSE: 'KeyP',
    PAUSE_ESC: 'Escape',
    HORN: 'KeyH',
  },

  // Kunci save di localStorage. JANGAN diubah: save lama harus tetap kebaca.
  SAVE_KEY: 'sunset-bay-save-v1',

  // Biaya ganti warna mobil (respray). Dipakai SB.Vehicles.respray().
  RESPRAY_COST: 150,

  // Jam permainan: mulai 17:30 (golden hour), satu hari game = 10 menit nyata.
  TIME: {
    START_HOUR: 17,
    START_MINUTE: 30,
    DAY_LENGTH_SEC: 600,
    SUNSET_HOUR: 18,
    SUNRISE_HOUR: 6,
    NIGHT_START_HOUR: 19,
  },

  // Cuaca: peluang & durasi tiap kondisi. Hujan mengubah handling (lihat PHYSICS).
  WEATHER: {
    CONDITIONS: ['sunny', 'cloudy', 'rainy', 'foggy'],
    DEFAULT: 'sunny',
    CHANGE_EVERY_SEC: 120,
    RAIN_FOG_DENSITY: 0.020,
    CLEAR_FOG_DENSITY: 0.004,
  },

  // Audio: 6 stasiun radio.
  RADIO_STATIONS: [
    'Sunset FM',
    'Vice Vibes',
    'Palm Wave',
    'Neon Nights',
    'Harbor Talk',
    'Bay Beats',
  ],

  // Batas jumlah entitas di dunia.
  LIMITS: {
    BUILDINGS_MIN: 301,
    CARS: 42,
    PEDESTRIANS_MIN: 34,
    TRAFFIC_CARS: 38,
    BOATS: 6,
    MISSIONS: 22,
    MISSION_STAGES: 79,
    RACE_TRACKS: 6,
    CREW_MEMBERS: 5,
    WEAPON_SLOTS: 3,
    RESPECT_RANKS: 5,
  },
};

// Cari distrik berdasarkan nama — dipakai modul yang butuh pusat distrik
// tanpa mengulang tabel. Mengembalikan objek distrik atau null.
SB.Config.districtByName = function (name) {
  for (var i = 0; i < SB.Config.DISTRICTS.length; i++) {
    if (SB.Config.DISTRICTS[i].name === name) return SB.Config.DISTRICTS[i];
  }
  return null;
};

// Cari distrik yang menaungi titik (x, z); null bila di luar semua distrik.
SB.Config.districtAt = function (x, z) {
  var best = null;
  var bestD = Infinity;
  for (var i = 0; i < SB.Config.DISTRICTS.length; i++) {
    var d = SB.Config.DISTRICTS[i];
    var dx = x - d.x;
    var dz = z - d.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= d.radius && dist < bestD) {
      best = d;
      bestD = dist;
    }
  }
  return best;
};

window.SB = window.SB || {};
(function(){
'use strict';

// ---------------------------------------------------------------------------
// SB.Economy — ekonomi Sunset Bay: bisnis pasif, properti/safehouse,
// garasi, respect & rank, serta reputasi per distrik (district standing).
//
// Respect naik lewat misi (+100), balapan menang (+40), dan bisnis yang
// dimiliki (+5/hari per bisnis). Rank: Rookie -> Street -> Boss -> Kingpin.
// Reputasi distrik 0-100 memengaruhi harga di distrik itu dan reaksi NPC:
// rep tinggi = diskon & NPC ramah; rep rendah = harga naik & NPC curiga.
// ---------------------------------------------------------------------------

// Ambang respect untuk tiap rank.
var RANKS = [
  { name: 'Rookie', min: 0 }, { name: 'Street', min: 300 },
  { name: 'Boss', min: 800 }, { name: 'Kingpin', min: 1800 }
];

// 14 distrik Sunset Bay (nama sama dengan SB.City.districts).
var DISTRICTS = [
  'Marina Bay', 'Sunset Beach', 'Downtown', 'Old Town', 'Neon Strip',
  'Harbour Heights', 'Palm Court', "Fisherman's Wharf", 'University Hill',
  'Industrial Park', 'Coral Gardens', 'Sunset Hills', 'Boardwalk', 'The Docks'
];

// Bisnis yang bisa dibeli: pemasukan pasif per hari game.
var BUSINESS_DEFS = [
  { id: 'taco', name: 'Taco Stand', district: 'Sunset Beach', cost: 800, incomePerDay: 120, respectPerDay: 5,
    desc: 'Gerobak taco di pinggir pantai. Kecil tapi selalu ramai.' },
  { id: 'bar', name: 'Neon Bar', district: 'Neon Strip', cost: 2500, incomePerDay: 350, respectPerDay: 8,
    desc: 'Bar neon di sudut kota. Tempat nongkrong kru dan info jalanan.' },
  { id: 'garage', name: 'Auto Garage', district: 'The Docks', cost: 4000, incomePerDay: 520, respectPerDay: 10,
    desc: 'Bengkel modifikasi mobil. Buka jasa upgrade kendaraan.' },
  { id: 'arcade', name: 'Sunset Arcade', district: 'Sunset Beach', cost: 6000, incomePerDay: 780, respectPerDay: 12,
    desc: 'Arcade retro + mesin slot. Mesin uang di kawasan turis.' },
  { id: 'hotel', name: 'Palm Hotel', district: 'Palm Court', cost: 12000, incomePerDay: 1500, respectPerDay: 20,
    desc: 'Hotel butik 12 kamar dengan pemandangan marina.' }
];

// Properti / safehouse + upgrade garasi.
var PROPERTY_DEFS = [
  { id: 'safehouse_beach', name: 'Beach Safehouse', district: 'Sunset Beach', cost: 1500, type: 'safehouse',
    desc: 'Rumah kecil dekat pantai. Titik save + isi HP penuh.' },
  { id: 'safehouse_downtown', name: 'Downtown Loft', district: 'Downtown', cost: 5000, type: 'safehouse',
    desc: 'Loft di atas kota. Titik save + isi HP & armor penuh.' },
  { id: 'safehouse_marina', name: 'Marina Penthouse', district: 'Marina Bay', cost: 15000, type: 'safehouse',
    desc: 'Penthouse marina. Save + HP/armor penuh + garasi 4 mobil.' },
  { id: 'garage_2slot', name: 'Garasi +2 Slot', district: 'The Docks', cost: 1200, type: 'garage',
    desc: 'Perluas garasi: simpan 2 kendaraan tambahan.' },
  { id: 'garage_workshop', name: 'Workshop Upgrade', district: 'The Docks', cost: 3000, type: 'garage',
    desc: 'Workshop bengkel: unlock modifikasi performa kendaraan.' }
];

var DAY_LENGTH = 600;   // detik game per hari (10 menit) — selaras timeOfDay
var stateRef = null;
var businesses = [];    // bisnis yang dimiliki (objek dari BUSINESS_DEFS + runtime)
var properties = [];    // properti yang dimiliki
var pendingIncome = 0;  // pemasukan pasif yang menunggu diambil
var lastDay = 1;        // hari terakhir pemasukan dihitung
var incomeTimer = 0;    // akumulasi detik sejak pemasukan terakhir

// ---------------------------------------------------------------------------
// Util lokal
// ---------------------------------------------------------------------------

function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }

function findBusinessDef(id){
  for (var i = 0; i < BUSINESS_DEFS.length; i++){
    if (BUSINESS_DEFS[i].id === id) return BUSINESS_DEFS[i];
  }
  return null;
}

function findPropertyDef(id){
  for (var i = 0; i < PROPERTY_DEFS.length; i++){
    if (PROPERTY_DEFS[i].id === id) return PROPERTY_DEFS[i];
  }
  return null;
}

function ownedBusiness(id){
  for (var i = 0; i < businesses.length; i++){
    if (businesses[i].id === id) return businesses[i];
  }
  return null;
}

function ownedProperty(id){
  for (var i = 0; i < properties.length; i++){
    if (properties[i].id === id) return properties[i];
  }
  return null;
}

function toast(text){
  if (window.SB && window.SB.HUD && typeof window.SB.HUD.showToast === 'function'){
    window.SB.HUD.showToast(text);
  }
}

function rankForRespect(respect){
  var rank = RANKS[0].name;
  for (var i = 0; i < RANKS.length; i++){
    if (respect >= RANKS[i].min) rank = RANKS[i].name;
  }
  return rank;
}

// ---------------------------------------------------------------------------
// init(state)
// ---------------------------------------------------------------------------

function init(state){
  stateRef = state;
  businesses.length = 0;
  properties.length = 0;
  pendingIncome = 0;
  lastDay = (state && state.day) || 1;
  incomeTimer = 0;
  if (state){
    state.businesses = businesses;
    if (!state.districtRep) state.districtRep = {};
    // Inisialisasi reputasi semua distrik di 10 (netral rendah) bila kosong.
    for (var i = 0; i < DISTRICTS.length; i++){
      if (typeof state.districtRep[DISTRICTS[i]] !== 'number'){
        state.districtRep[DISTRICTS[i]] = 10;
      }
    }
    if (!state.flags) state.flags = {};
    state.flags.garageSlots = 2;
    state.flags.workshop = false;
    if (!state.properties) state.properties = properties;
    if (typeof state.respect !== 'number') state.respect = 0;
    state.respectRank = rankForRespect(state.respect);
  }
}

// ---------------------------------------------------------------------------
// District standing
// ---------------------------------------------------------------------------

// Ubah reputasi satu distrik (-100..+100 delta), dijepit 0-100.
// Dipakai misi, balapan, dan interaksi NPC.
function changeRep(district, delta){
  if (!stateRef) return 0;
  if (!stateRef.districtRep) stateRef.districtRep = {};
  var cur = stateRef.districtRep[district];
  if (typeof cur !== 'number') cur = 10;
  cur = clamp(cur + delta, 0, 100);
  stateRef.districtRep[district] = cur;
  return cur;
}

function getRep(district){
  if (!stateRef || !stateRef.districtRep) return 10;
  var v = stateRef.districtRep[district];
  return (typeof v === 'number') ? v : 10;
}

// Pengali harga di sebuah distrik: rep 100 -> 0.85 (diskon 15%),
// rep 0 -> 1.20 (harga naik 20%). Rep 50 -> 1.00 (netral).
function priceMultiplier(district){
  var rep = getRep(district);
  return 1.20 - (rep / 100) * 0.35;
}

// Reaksi NPC terhadap pemain di distrik itu:
// 'hostile' | 'wary' | 'neutral' | 'friendly' | 'revered'
function npcReaction(district){
  var rep = getRep(district);
  if (rep >= 80) return 'revered';
  if (rep >= 55) return 'friendly';
  if (rep >= 30) return 'neutral';
  if (rep >= 10) return 'wary';
  return 'hostile';
}

// Harga beli bisnis/properti setelah diskon distrik (dibulatkan).
function adjustedPrice(def){
  var mult = priceMultiplier(def.district);
  return Math.round(def.cost * mult);
}

// ---------------------------------------------------------------------------
// buyBusiness(id) — beli bisnis, pemasukan pasif per hari
// ---------------------------------------------------------------------------

function buyBusiness(id){
  if (!stateRef) return false;
  var def = findBusinessDef(id);
  if (!def) return false;
  if (ownedBusiness(id)){ toast(def.name + ' sudah kamu miliki.'); return false; }
  var price = adjustedPrice(def);
  if ((stateRef.money || 0) < price){
    toast('Butuh $' + price + ' untuk membeli ' + def.name + '.');
    return false;
  }
  stateRef.money -= price;
  var b = {
    id: def.id, name: def.name, district: def.district,
    incomePerDay: def.incomePerDay, respectPerDay: def.respectPerDay,
    boughtDay: stateRef.day || 1, earned: 0
  };
  businesses.push(b);
  stateRef.businesses = businesses;
  changeRep(def.district, 8);   // membeli bisnis menaikkan reputasi distrik
  setRespect((stateRef.respect || 0) + 25);
  toast(def.name + ' dibeli! Pemasukan $' + def.incomePerDay + '/hari.');
  return true;
}

// ---------------------------------------------------------------------------
// collectIncome() — ambil semua pemasukan pasif yang terkumpul
// ---------------------------------------------------------------------------

function collectIncome(){
  if (!stateRef) return 0;
  var amount = Math.floor(pendingIncome);
  if (amount <= 0) return 0;
  pendingIncome -= amount;
  stateRef.money = (stateRef.money || 0) + amount;
  toast('Pemasukan bisnis: +$' + amount + '.');
  return amount;
}

// Bonus harian per pergantian hari game: HANYA respect (uang sudah
// menetes per detik di update, jadi jangan tambah pemasukan di sini
// supaya tidak terhitung ganda).
function dailyIncome(){
  var repGain = 0;
  for (var i = 0; i < businesses.length; i++){
    repGain += businesses[i].respectPerDay;
    businesses[i].earned += businesses[i].incomePerDay;
  }
  if (repGain > 0) setRespect((stateRef.respect || 0) + repGain);
  return repGain;
}

// ---------------------------------------------------------------------------
// buyProperty(id) — beli safehouse / upgrade garasi
// ---------------------------------------------------------------------------

function buyProperty(id){
  if (!stateRef) return false;
  var def = findPropertyDef(id);
  if (!def) return false;
  if (ownedProperty(id)){ toast(def.name + ' sudah kamu miliki.'); return false; }
  var price = adjustedPrice(def);
  if ((stateRef.money || 0) < price){
    toast('Butuh $' + price + ' untuk ' + def.name + '.');
    return false;
  }
  stateRef.money -= price;
  var p = {
    id: def.id, name: def.name, district: def.district, type: def.type,
    boughtDay: stateRef.day || 1
  };
  properties.push(p);
  stateRef.properties = properties;
  if (def.type === 'safehouse'){
    changeRep(def.district, 10);
    if (stateRef.player){
      stateRef.player.hp = 100;
      if (def.id !== 'safehouse_beach') stateRef.player.armor = 100;
    }
    toast(def.name + ' dibeli! Safehouse aktif — HP dipulihkan.');
  } else if (def.type === 'garage'){
    if (def.id === 'garage_2slot'){
      stateRef.flags.garageSlots = (stateRef.flags.garageSlots || 2) + 2;
    } else if (def.id === 'garage_workshop'){
      stateRef.flags.workshop = true;
    }
    toast(def.name + ' dipasang! Garasi ditingkatkan.');
  }
  setRespect((stateRef.respect || 0) + 15);
  return true;
}

// ---------------------------------------------------------------------------
// Respect & rank
// ---------------------------------------------------------------------------

function setRespect(n){
  if (!stateRef) return;
  var before = stateRef.respectRank;
  stateRef.respect = Math.max(0, Math.floor(n));
  stateRef.respectRank = rankForRespect(stateRef.respect);
  if (stateRef.respectRank !== before && before){
    toast('RANK UP! Kamu sekarang ' + stateRef.respectRank + '.');
    if (window.SB.HUD && window.SB.HUD.showMission){
      window.SB.HUD.showMission('Respect Rank: ' + stateRef.respectRank);
    }
  }
}

// Naikkan respect satu tingkat (dipanggil saat misi/balapan besar selesai).
// Mengembalikan rank baru.
function rankUp(){
  if (!stateRef) return stateRef ? stateRef.respectRank : 'Rookie';
  var idx = 0;
  for (var i = 0; i < RANKS.length; i++){
    if (stateRef.respectRank === RANKS[i].name) idx = i;
  }
  if (idx >= RANKS.length - 1) return stateRef.respectRank;
  setRespect(RANKS[idx + 1].min);
  return stateRef.respectRank;
}

// Bonus respect dari sumber lain (dipakai jobs.js / races.js):
// misi +100, balapan menang +40.
function addRespect(n){ setRespect((stateRef.respect || 0) + n); }

// ---------------------------------------------------------------------------
// update(dt, state) — akumulasi pemasukan + pergantian hari
// ---------------------------------------------------------------------------

function update(dt, state){
  if (!state) return;
  stateRef = state;
  incomeTimer += dt;
  // Tiap DAY_LENGTH detik = 1 hari game; pemasukan dihitung per hari.
  var day = state.day || 1;
  if (day !== lastDay){
    var diff = day - lastDay;
    if (diff > 0 && diff <= 7){
      for (var i = 0; i < diff; i++) dailyIncome();
    } else if (diff > 7){
      dailyIncome();
    }
    lastDay = day;
  }
  // Pemasukan menetes sedikit demi sedikit agar HUD terasa hidup:
  // total harian dibagi DAY_LENGTH detik.
  if (businesses.length > 0){
    var perSec = 0;
    for (var j = 0; j < businesses.length; j++){
      perSec += businesses[j].incomePerDay / DAY_LENGTH;
    }
    pendingIncome += perSec * dt;
  }
}

// ---------------------------------------------------------------------------
// API publik
// ---------------------------------------------------------------------------

window.SB.Economy = {
  init: init,
  update: update,
  buyBusiness: buyBusiness,
  collectIncome: collectIncome,
  buyProperty: buyProperty,
  setRespect: setRespect,
  rankUp: rankUp,
  addRespect: addRespect,
  changeRep: changeRep,
  getRep: getRep,
  priceMultiplier: priceMultiplier,
  npcReaction: npcReaction,
  dailyIncome: dailyIncome,
  businesses: businesses,
  properties: properties,
  businessDefs: BUSINESS_DEFS,
  propertyDefs: PROPERTY_DEFS,
  districts: DISTRICTS,
  ranks: RANKS,
  pendingIncome: function(){ return Math.floor(pendingIncome); }
};

})();

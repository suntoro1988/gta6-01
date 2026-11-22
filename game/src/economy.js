window.SB = window.SB || {};
(function () {
  'use strict';
  // SB.Economy — Sunset Bay v12. Money, passive businesses, safehouse
  // properties, garage upgrades and the Respect ladder:
  // Rookie -> Street -> Boss -> Kingpin. Businesses pay per in-game
  // minute (60s of play) into pendingIncome; collectIncome() banks it.
  // Each business needs a minimum districtRep in its home district.
  // Respect comes from missions, races and owned businesses; each rank
  // unlocks new districts, crew, businesses and properties.
  var RANKS = [
    { name: 'Rookie', min: 0, color: '#9fb3c8', perk: 'Beli bisnis pertama & rekrut Rico.' },
    { name: 'Street', min: 250, color: '#4dd0ff', perk: 'Buka distrik Marina & bisnis bengkel.' },
    { name: 'Boss', min: 750, color: '#ff9a3c', perk: 'Buka distrik Harbour & properti Beach House.' },
    { name: 'Kingpin', min: 1500, color: '#ffd23c', perk: 'Buka semua distrik, Penthouse & semua upgrade.' }
  ];
  var BUSINESSES = [
    { id: 'bar', name: 'Sunset Bar', type: 'bar', district: 'Ocean Drive',
      cost: 400, incomePerMin: 12, districtRepNeeded: 0, color: '#ff9a3c',
      desc: 'Bar pantai di Ocean Drive. Turis haus sepanjang malam.' },
    { id: 'laundry', name: 'Bay Laundry', type: 'laundry', district: 'Little Havana',
      cost: 300, incomePerMin: 8, districtRepNeeded: 10, color: '#4dd0ff',
      desc: 'Laundromat 24 jam. Uang kecil tapi tidak pernah berhenti.' },
    { id: 'bengkel', name: 'Rico Auto Works', type: 'workshop', district: 'Marina',
      cost: 800, incomePerMin: 22, districtRepNeeded: 25, color: '#b8ff5e',
      desc: 'Bengkel modifikasi. Anak balap rela bayar mahal.' },
    { id: 'taco', name: 'Taco Sunset', type: 'food', district: 'Vice Port',
      cost: 550, incomePerMin: 15, districtRepNeeded: 20, color: '#ff4d6d',
      desc: 'Food truck taco di pelabuhan. Antrean tidak pernah habis.' },
    { id: 'carwash', name: 'Wave Car Wash', type: 'carwash', district: 'Harbour',
      cost: 1200, incomePerMin: 30, districtRepNeeded: 40, color: '#c58cff',
      desc: 'Cuci mobil premium dekat pelabuhan. Margin paling tebal.' }
  ];
  var PROPERTIES = [
    { id: 'apartment', name: 'Sunset Apartment', type: 'safehouse', cost: 600,
      district: 'Ocean Drive', garageSlots: 1, color: '#4dd0ff',
      desc: 'Safehouse pertama. Save point + 1 slot garasi.' },
    { id: 'beach-house', name: 'Beach House', type: 'safehouse', cost: 2500,
      district: 'Marina', garageSlots: 2, rankNeeded: 'Boss', color: '#ff9a3c',
      desc: 'Rumah pantai, garasi 2 mobil. Save point + fast travel.' },
    { id: 'penthouse', name: 'Kingpin Penthouse', type: 'safehouse', cost: 8000,
      district: 'Harbour', garageSlots: 4, rankNeeded: 'Kingpin', color: '#ffd23c',
      desc: 'Penthouse tertinggi di Sunset Bay. Garasi 4 mobil, view pelabuhan.' }
  ];
  var UPGRADES = [
    { id: 'armor', name: 'Armor Plating', cost: 500, maxLevel: 3,
      desc: 'Pelat baja: mobil tahan tembakan & tabrakan lebih lama.', perLevel: '+25% daya tahan' },
    { id: 'speed', name: 'Turbo Engine', cost: 700, maxLevel: 3,
      desc: 'Mesin turbo: top speed dan akselerasi naik.', perLevel: '+12% top speed' },
    { id: 'handling', name: 'Sport Suspension', cost: 450, maxLevel: 3,
      desc: 'Suspensi sport: handling & drift jauh lebih stabil.', perLevel: '+15% grip' },
    { id: 'nitro', name: 'Nitro Kit', cost: 900, maxLevel: 2,
      desc: 'Tabung nitro: boost mendadak dengan tombol boost.', perLevel: '+1 tabung nitro' }
  ];
  var stateRef = null, ownedBusinesses = [], ownedProperties = [];
  var garage = { armor: 0, speed: 0, handling: 0, nitro: 0 };
  var pendingIncome = 0, incomeAccumulator = 0, totalEarned = 0, totalSpent = 0;
  var rankIndex = 0, initialized = false;
  function rankOf(respect) {
    var idx = 0;
    for (var i = 0; i < RANKS.length; i++) if (respect >= RANKS[i].min) idx = i;
    return idx;
  }
  function rankNameAt(idx) { return RANKS[Math.max(0, Math.min(idx, RANKS.length - 1))].name; }
  function findIn(list, id) {
    if (!id) return null;
    var key = String(id).trim().toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === key || list[i].name.toLowerCase() === key) return list[i];
    }
    return null;
  }
  function districtRepOf(district) {
    if (!stateRef || !stateRef.districtRep) return 0;
    return stateRef.districtRep[district] || 0;
  }
  function toast(text) { if (window.SB && SB.HUD && SB.HUD.showToast) SB.HUD.showToast(text); }
  function sfx(name) { if (window.SB && SB.Audio && SB.Audio.sfx) SB.Audio.sfx(name); }
  function syncState() {
    if (!stateRef) return;
    stateRef.businesses = ownedBusinesses;
    stateRef.properties = ownedProperties;
    stateRef.garage = garage;
    stateRef.pendingIncome = Math.floor(pendingIncome);
    stateRef.respectRank = rankNameAt(rankIndex);
    stateRef.flags = stateRef.flags || {};
    stateRef.flags.rankIndex = rankIndex;
    stateRef.flags.totalEarned = totalEarned;
    stateRef.flags.totalSpent = totalSpent;
  }
  function passivePerMinute() {
    var sum = 0;
    for (var i = 0; i < ownedBusinesses.length; i++) sum += ownedBusinesses[i].incomePerMin;
    return sum;
  }
  function announceRank() {
    var rank = RANKS[rankIndex];
    toast('RANK UP! Kamu sekarang ' + rank.name.toUpperCase() + ' — ' + rank.perk);
    sfx('rankup');
    if (window.SB && SB.HUD && SB.HUD.showMission) SB.HUD.showMission('Respect Rank: ' + rank.name);
  }
  function addRespect(amount) {
    if (!stateRef || !amount) return;
    stateRef.respect = Math.max(0, (stateRef.respect || 0) + amount);
    var newIdx = rankOf(stateRef.respect);
    if (newIdx > rankIndex) { rankIndex = newIdx; announceRank(); }
    syncState();
  }
  // District standing changes prices: high rep = cheaper buys here.
  // 0 rep -> full price; 100 rep -> 20% discount. Used by buyBusiness,
  // buyProperty and buyUpgrade through effectiveCost().
  function priceModifier(district) {
    var rep = districtRepOf(district);
    return 1 - (rep / 100) * 0.2;
  }
  function effectiveCost(baseCost, district) {
    return Math.max(1, Math.round(baseCost * priceModifier(district)));
  }
  function sellBusiness(id) {
    if (!stateRef) return 0;
    var def = findIn(BUSINESSES, id);
    if (!def) { toast('Bisnis tidak dikenal: "' + id + '".'); return 0; }
    var idx = ownedBusinesses.indexOf(def);
    if (idx < 0) { toast(def.name + ' bukan milikmu, tidak bisa dijual.'); return 0; }
    var refund = Math.floor(def.cost * 0.5);
    ownedBusinesses.splice(idx, 1);
    stateRef.money = (stateRef.money || 0) + refund;
    if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
    toast(def.name + ' dijual, kembali $' + refund + ' (50% harga beli).');
    sfx('cash'); syncState(); return refund;
  }
  function districtBonus(district) {
    // Extra passive income while standing in a district is high.
    var rep = districtRepOf(district);
    if (rep >= 80) return 1.5;
    if (rep >= 50) return 1.25;
    if (rep >= 25) return 1.1;
    return 1.0;
  }
  window.SB.Economy = {
    businesses: BUSINESSES, properties: PROPERTIES, upgrades: UPGRADES, ranks: RANKS,
    owned: ownedBusinesses, garageUpgrades: garage,
    init: function (state) {
      stateRef = state || null;
      ownedBusinesses.length = 0; ownedProperties.length = 0;
      garage = { armor: 0, speed: 0, handling: 0, nitro: 0 };
      pendingIncome = 0; incomeAccumulator = 0; totalEarned = 0; totalSpent = 0;
      rankIndex = 0; initialized = true;
      if (stateRef) {
        stateRef.respect = stateRef.respect || 0;
        stateRef.money = stateRef.money == null ? 500 : stateRef.money;
        stateRef.districtRep = stateRef.districtRep || {};
        rankIndex = rankOf(stateRef.respect);
        stateRef.respectRank = rankNameAt(rankIndex);
        if (Array.isArray(stateRef.businessesSaved)) {
          for (var i = 0; i < stateRef.businessesSaved.length; i++) {
            var b = findIn(BUSINESSES, stateRef.businessesSaved[i]);
            if (b && ownedBusinesses.indexOf(b) < 0) ownedBusinesses.push(b);
          }
        }
        if (Array.isArray(stateRef.propertiesSaved)) {
          for (var j = 0; j < stateRef.propertiesSaved.length; j++) {
            var p = findIn(PROPERTIES, stateRef.propertiesSaved[j]);
            if (p && ownedProperties.indexOf(p) < 0) ownedProperties.push(p);
          }
        }
        if (stateRef.garageSaved) {
          for (var k in garage) if (stateRef.garageSaved[k] != null) garage[k] = stateRef.garageSaved[k];
        }
      }
      syncState();
      return { rank: rankNameAt(rankIndex), businesses: ownedBusinesses.length };
    },
    update: function (dt, state) {
      if (!initialized) this.init(state);
      if (state) stateRef = state;
      if (!stateRef) return;
      dt = Math.max(0, Math.min(dt || 0, 0.1));
      if (ownedBusinesses.length === 0) { syncState(); return; }
      incomeAccumulator += dt;
      while (incomeAccumulator >= 60) {
        incomeAccumulator -= 60;
        var perMin = passivePerMinute();
        pendingIncome += perMin; totalEarned += perMin;
        addRespect(1); // owning businesses slowly builds respect
      }
      syncState();
    },
    buyBusiness: function (id) {
      if (!stateRef) return null;
      var def = findIn(BUSINESSES, id);
      if (!def) { toast('Bisnis tidak dikenal: "' + id + '". Pilihan: bar, laundry, bengkel, taco, carwash.'); return null; }
      if (ownedBusinesses.indexOf(def) >= 0) { toast(def.name + ' sudah kamu miliki.'); return def; }
      var rep = districtRepOf(def.district);
      if (rep < def.districtRepNeeded) {
        toast(def.name + ' butuh reputasi ' + def.district + ' minimal ' + def.districtRepNeeded + ' (kamu: ' + rep + ').'); return null;
      }
      if ((stateRef.money || 0) < def.cost) {
        toast(def.name + ' harganya $' + def.cost + ' (kamu: $' + (stateRef.money || 0) + ').'); return null;
      }
      stateRef.money -= def.cost; totalSpent += def.cost;
      ownedBusinesses.push(def);
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      toast('Bisnis dibeli: ' + def.name + ' (+$' + def.incomePerMin + '/menit). ' + def.desc);
      sfx('buy'); addRespect(15); syncState(); return def;
    },
    collectIncome: function () {
      if (!stateRef) return 0;
      var amount = Math.floor(pendingIncome);
      if (amount <= 0) { toast('Belum ada pemasukan untuk dikumpulkan.'); return 0; }
      pendingIncome -= amount;
      stateRef.money = (stateRef.money || 0) + amount;
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      toast('Pemasukan bisnis dikumpulkan: +$' + amount + '!');
      sfx('cash'); syncState(); return amount;
    },
    buyProperty: function (id) {
      if (!stateRef) return null;
      var def = findIn(PROPERTIES, id);
      if (!def) { toast('Properti tidak dikenal: "' + id + '". Pilihan: apartment, beach-house, penthouse.'); return null; }
      if (ownedProperties.indexOf(def) >= 0) { toast(def.name + ' sudah kamu miliki.'); return def; }
      if (def.rankNeeded) {
        var needIdx = 0;
        for (var i = 0; i < RANKS.length; i++) if (RANKS[i].name === def.rankNeeded) needIdx = i;
        if (rankIndex < needIdx) { toast(def.name + ' butuh rank ' + def.rankNeeded + ' (kamu: ' + rankNameAt(rankIndex) + ').'); return null; }
      }
      if ((stateRef.money || 0) < def.cost) {
        toast(def.name + ' harganya $' + def.cost + ' (kamu: $' + (stateRef.money || 0) + ').'); return null;
      }
      stateRef.money -= def.cost; totalSpent += def.cost;
      ownedProperties.push(def);
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      toast('Safehouse dibeli: ' + def.name + '! Save point + garasi ' + def.garageSlots + ' mobil. ' + def.desc);
      sfx('buy'); addRespect(25);
      if (window.SB && SB.Game && SB.Game.save) SB.Game.save();
      syncState(); return def;
    },
    setRespect: function (n) {
      if (!stateRef) return rankNameAt(rankIndex);
      var before = rankIndex;
      stateRef.respect = Math.max(0, Math.floor(n || 0));
      rankIndex = rankOf(stateRef.respect);
      if (rankIndex > before) announceRank();
      stateRef.respectRank = rankNameAt(rankIndex);
      syncState(); return stateRef.respectRank;
    },
    rankUp: function () {
      if (!stateRef) return rankNameAt(rankIndex);
      if (rankIndex >= RANKS.length - 1) { toast('Kamu sudah KINGPIN — rank tertinggi di Sunset Bay!'); return rankNameAt(rankIndex); }
      var next = RANKS[rankIndex + 1];
      var needed = next.min - (stateRef.respect || 0);
      if (needed > 0) {
        toast('Butuh ' + needed + ' respect lagi untuk jadi ' + next.name + '. Selesaikan misi, menangi balapan, atau beli bisnis.');
        return rankNameAt(rankIndex);
      }
      rankIndex++;
      stateRef.respect = Math.max(stateRef.respect || 0, next.min);
      stateRef.respectRank = next.name;
      announceRank(); syncState(); return next.name;
    },
    addRespect: function (n) { addRespect(n); return stateRef ? stateRef.respect : 0; },
    sellBusiness: function (id) { return sellBusiness(id); },
    priceModifier: function (district) { return priceModifier(district); },
    effectiveCost: function (cost, district) { return effectiveCost(cost, district); },
    districtBonus: function (district) { return districtBonus(district); },
    incomePerMinute: function () { return passivePerMinute(); },
    pending: function () { return Math.floor(pendingIncome); },
    buyUpgrade: function (id) {
      if (!stateRef) return null;
      var def = findIn(UPGRADES, id);
      if (!def) { toast('Upgrade tidak dikenal: "' + id + '". Pilihan: armor, speed, handling, nitro.'); return null; }
      if (ownedProperties.length === 0) { toast('Beli safehouse dulu sebelum upgrade garasi.'); return null; }
      var level = garage[def.id] || 0;
      if (level >= def.maxLevel) { toast(def.name + ' sudah level maks (' + def.maxLevel + ').'); return null; }
      var cost = def.cost * (level + 1);
      if ((stateRef.money || 0) < cost) {
        toast(def.name + ' Lv' + (level + 1) + ' harganya $' + cost + ' (kamu: $' + (stateRef.money || 0) + ').'); return null;
      }
      stateRef.money -= cost; totalSpent += cost;
      garage[def.id] = level + 1;
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      toast('Garasi upgrade: ' + def.name + ' Lv' + garage[def.id] + ' (' + def.perLevel + ').');
      sfx('upgrade'); addRespect(5); syncState();
      return { id: def.id, level: garage[def.id] };
    },
    addDistrictRep: function (district, amount) {
      if (!stateRef) return 0;
      stateRef.districtRep = stateRef.districtRep || {};
      var cur = stateRef.districtRep[district] || 0;
      stateRef.districtRep[district] = Math.max(0, Math.min(100, cur + (amount || 0)));
      return stateRef.districtRep[district];
    },
    summary: function () {
      return {
        money: stateRef ? stateRef.money : 0, respect: stateRef ? stateRef.respect : 0,
        rank: rankNameAt(rankIndex),
        nextRank: rankIndex < RANKS.length - 1 ? RANKS[rankIndex + 1].name : null,
        respectToNext: rankIndex < RANKS.length - 1 ? Math.max(0, RANKS[rankIndex + 1].min - (stateRef ? stateRef.respect || 0 : 0)) : 0,
        businesses: ownedBusinesses.length, incomePerMinute: passivePerMinute(),
        pendingIncome: Math.floor(pendingIncome), properties: ownedProperties.length,
        garage: { armor: garage.armor, speed: garage.speed, handling: garage.handling, nitro: garage.nitro },
        totalEarned: totalEarned, totalSpent: totalSpent
      };
    }
  };
})();

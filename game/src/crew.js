window.SB = window.SB || {};
(function () {
  'use strict';
  // SB.Crew — Sunset Bay v12. Recruit 4 specialists, give orders, trigger
  // each member's unique active ability. Crew follows on foot, joins
  // missions and street races, and fights beside the player. All cross-
  // module calls are guarded: SB.Player/Vehicles/City/HUD/Audio/Police
  // may not be loaded yet when this module runs.
  var ROSTER = [
    { id: 'rico', name: 'Rico', nickname: 'El Volante', role: 'driver',
      skill: 'Driving', skillLevel: 92, cost: 200, respectNeeded: 0,
      ability: 'drift-boost', abilityName: 'Drift Boost', cooldown: 45, color: '#ff9a3c',
      abilityDesc: '10s extra grip + top speed while driving. Perfect getaway.',
      bio: 'Ex-street racer from Ocean Drive. Never lost a getaway.' },
    { id: 'maya', name: 'Maya', nickname: 'La Bala', role: 'shooter',
      skill: 'Shooting', skillLevel: 95, cost: 250, respectNeeded: 100,
      ability: 'deadeye', abilityName: 'Deadeye', cooldown: 40, color: '#ff4d6d',
      abilityDesc: '+40% shooting accuracy and +25% damage for 15s.',
      bio: 'Former range instructor. One shot, one problem solved.' },
    { id: 'dex', name: 'Dex', nickname: 'Ghost', role: 'hacker',
      skill: 'Hacking', skillLevel: 88, cost: 300, respectNeeded: 250,
      ability: 'ghost-signal', abilityName: 'Ghost Signal', cooldown: 60, color: '#4dd0ff',
      abilityDesc: 'Instantly drops wanted by 1 star and cools Heat by 30.',
      bio: 'Can mute a camera grid before the guard blinks.' },
    { id: 'luna', name: 'Luna', nickname: 'Ojo', role: 'lookout',
      skill: 'Awareness', skillLevel: 90, cost: 250, respectNeeded: 150,
      ability: 'eagle-eye', abilityName: 'Eagle Eye', cooldown: 50, color: '#b8ff5e',
      abilityDesc: 'Marks every police unit on the minimap for 30s.',
      bio: 'Sees the cops three blocks before the cops see you.' }
  ];
  // Orders: English + Indonesian (spec: ikut/serang/tunggu/bersembunyi).
  var COMMANDS = {
    follow: ['follow', 'ikut', 'follow me', 'ikut aku'],
    attack: ['attack', 'serang', 'serang mereka', 'engage'],
    wait: ['wait', 'tunggu', 'tunggu di sini', 'hold'],
    hide: ['hide', 'bersembunyi', 'sembunyi', 'low profile']
  };
  var FORMATION = [{ dx: -2.2, dz: 1.6 }, { dx: 2.2, dz: 1.6 },
                   { dx: -2.2, dz: -1.8 }, { dx: 2.2, dz: -1.8 }];
  var stateRef = null, members = [], currentCommand = 'follow';
  var abilityTimers = {}, effectTimers = {};
  var markedUntil = 0, driftBoostUntil = 0, deadeyeUntil = 0;
  var combatTarget = null, shoutCooldown = 0, initialized = false;
  function now() { return stateRef ? stateRef.time : 0; }
  function findTemplate(name) {
    if (!name) return null;
    var key = String(name).trim().toLowerCase();
    for (var i = 0; i < ROSTER.length; i++) {
      var t = ROSTER[i];
      if (t.id === key || t.name.toLowerCase() === key || t.nickname.toLowerCase() === key ||
          t.role === key || t.ability === key || t.abilityName.toLowerCase() === key) return t;
    }
    return null;
  }
  function findMember(name) {
    if (!name) return null;
    var key = String(name).trim().toLowerCase();
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (m.id === key || m.name.toLowerCase() === key ||
          m.nickname.toLowerCase() === key || m.role === key) return m;
    }
    return null;
  }
  function toast(text) { if (window.SB && SB.HUD && SB.HUD.showToast) SB.HUD.showToast(text); }
  function sfx(name) { if (window.SB && SB.Audio && SB.Audio.sfx) SB.Audio.sfx(name); }
  function spawnMember(t) {
    var px = 0, pz = 0, angle = 0;
    if (stateRef && stateRef.player) {
      px = stateRef.player.x || 0; pz = stateRef.player.z || 0; angle = stateRef.player.angle || 0;
    }
    var off = FORMATION[members.length % FORMATION.length];
    return { id: t.id, name: t.name, nickname: t.nickname, role: t.role,
      skill: t.skill, skillLevel: t.skillLevel, ability: t.ability,
      abilityName: t.abilityName, abilityDesc: t.abilityDesc, cooldown: t.cooldown,
      color: t.color, x: px + off.dx, y: 0, z: pz + off.dz, angle: angle,
      hp: 100, maxHp: 100, alive: true, following: true, inVehicle: false,
      kills: 0, missionsWith: 0, racesWith: 0, cooldownLeft: 0, morale: 80, state: 'follow' };
  }
  function syncState() {
    if (!stateRef) return;
    stateRef.crew = members;
    stateRef.flags = stateRef.flags || {};
    stateRef.flags.crewCommand = currentCommand;
    stateRef.flags.driftBoost = now() < driftBoostUntil;
    stateRef.flags.deadeye = now() < deadeyeUntil;
    stateRef.flags.eagleEye = now() < markedUntil;
    stateRef.flags.crewPerks = crewPerks();
  }
  function applyFormationTarget(m, i, dt) {
    if (!stateRef || !stateRef.player) return;
    var p = stateRef.player, off = FORMATION[i % FORMATION.length];
    var cos = Math.cos(p.angle || 0), sin = Math.sin(p.angle || 0);
    var tx = p.x + off.dx * cos - off.dz * sin, tz = p.z + off.dx * sin + off.dz * cos;
    var dx = tx - m.x, dz = tz - m.z, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.4) return;
    var speed = dist > 8 ? 9.5 : 5.2;
    if (currentCommand === 'attack') speed = 10.5;
    var step = Math.min(dist, speed * dt);
    m.x += (dx / dist) * step; m.z += (dz / dist) * step;
    m.angle = Math.atan2(dx, dz);
    m.state = dist > 8 ? 'running' : 'follow';
  }
  function updateCombat(dt) {
    if (currentCommand !== 'attack') { combatTarget = null; return; }
    if (!stateRef || !stateRef.player) return;
    var target = null, best = 26;
    if (window.SB && SB.Police && SB.Police.cops) {
      var cops = SB.Police.cops;
      for (var i = 0; i < cops.length; i++) {
        var dx = cops[i].x - stateRef.player.x, dz = cops[i].z - stateRef.player.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < best) { best = d; target = cops[i]; }
      }
    }
    combatTarget = target;
    if (!target) return;
    for (var j = 0; j < members.length; j++) {
      var m = members[j];
      if (!m.alive) continue;
      var dmg = m.role === 'shooter' ? 22 : 8;
      var hitChance = m.role === 'shooter' ? 0.55 : 0.25;
      if (now() < deadeyeUntil) { dmg *= 1.25; hitChance += 0.40; }
      if (Math.random() < hitChance * dt * 2) {
        target.hp = (target.hp == null ? 100 : target.hp) - dmg;
        if (target.hp <= 0 && !target.down) {
          target.down = true; m.kills++;
          if (stateRef.stats) stateRef.stats.kills++;
          toast(m.name + ' took down a cop!');
        }
      }
    }
  }
  function updateCooldowns(dt) {
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (m.cooldownLeft > 0) m.cooldownLeft = Math.max(0, m.cooldownLeft - dt);
    }
    for (var k in abilityTimers) if (abilityTimers[k] > 0) abilityTimers[k] = Math.max(0, abilityTimers[k] - dt);
    for (var k2 in effectTimers) if (effectTimers[k2] > 0) effectTimers[k2] = Math.max(0, effectTimers[k2] - dt);
    if (shoutCooldown > 0) shoutCooldown -= dt;
  }
  function updateMorale(dt) {
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if (!m.alive) continue;
      var target = 80;
      if (stateRef && stateRef.wanted >= 3) target = 65;
      if (stateRef && stateRef.stats && stateRef.stats.racesWon > 0) target = 88;
      m.morale += (target - m.morale) * Math.min(1, dt * 0.05);
      if (m.hp < 100) m.hp = Math.min(100, m.hp + dt * 2.0);
    }
  }
  function abilityDriftBoost() {
    driftBoostUntil = now() + 10; effectTimers['drift-boost'] = 10;
    toast('Rico: DRIFT BOOST! 10 detik gas pol!'); sfx('boost'); return true;
  }
  function abilityDeadeye() {
    deadeyeUntil = now() + 15; effectTimers['deadeye'] = 15;
    toast('Maya: DEADEYE — akurasi +40% selama 15 detik!'); sfx('deadeye'); return true;
  }
  function abilityGhostSignal() {
    if (!stateRef) return false;
    if (stateRef.wanted <= 0) { toast('Dex: tidak ada wanted untuk dihapus.'); return false; }
    stateRef.wanted = Math.max(0, stateRef.wanted - 1);
    stateRef.heat = Math.max(0, (stateRef.heat || 0) - 30);
    if (window.SB && SB.Police && SB.Police.setWanted) SB.Police.setWanted(stateRef.wanted);
    if (window.SB && SB.HUD && SB.HUD.setWanted) SB.HUD.setWanted(stateRef.wanted);
    toast('Dex: GHOST SIGNAL — wanted turun 1 bintang!'); sfx('hack'); return true;
  }
  function abilityEagleEye() {
    markedUntil = now() + 30; effectTimers['eagle-eye'] = 30;
    if (window.SB && SB.Police && SB.Police.cops) {
      for (var i = 0; i < SB.Police.cops.length; i++) {
        SB.Police.cops[i].marked = true; SB.Police.cops[i].markedUntil = markedUntil;
      }
    }
    toast('Luna: EAGLE EYE — semua polisi ditandai di minimap 30 detik!'); sfx('ping'); return true;
  }
  // Passive perks: each recruited member quietly helps the whole crew.
  // Vehicles / Player read these through state.flags.crewPerks.
  var PERKS = {
    driver: { speedBonus: 0.05, desc: '+5% top speed mobil' },
    shooter: { damageBonus: 0.10, desc: '+10% damage senjata' },
    hacker: { heatDecay: 1.5, desc: 'Heat turun 1,5/detik lebih cepat' },
    lookout: { policeRadius: 25, desc: 'Polisi terlihat 25m lebih jauh' }
  };
  function crewPerks() {
    var perks = { speedBonus: 0, damageBonus: 0, heatDecay: 0, policeRadius: 0 };
    for (var i = 0; i < members.length; i++) {
      var perk = PERKS[members[i].role];
      if (!perk) continue;
      perks.speedBonus += perk.speedBonus || 0;
      perks.damageBonus += perk.damageBonus || 0;
      perks.heatDecay += perk.heatDecay || 0;
      perks.policeRadius += perk.policeRadius || 0;
    }
    return perks;
  }
  function healMember(name, amount) {
    var m = findMember(name);
    if (!m || !m.alive) return false;
    m.hp = Math.min(100, m.hp + (amount || 25));
    return true;
  }
  function trainMember(name) {
    // Missions and races slowly raise a member's skill (cap 99).
    var m = findMember(name);
    if (!m) return null;
    m.skillLevel = Math.min(99, m.skillLevel + 1);
    m.morale = Math.min(100, m.morale + 5);
    return m.skillLevel;
  }
  window.SB.Crew = {
    members: members,
    roster: ROSTER,
    commandName: function () { return currentCommand; },
    isAbilityActive: function (id) {
      if (id === 'drift-boost') return now() < driftBoostUntil;
      if (id === 'deadeye') return now() < deadeyeUntil;
      if (id === 'eagle-eye') return now() < markedUntil;
      return (effectTimers[id] || 0) > 0;
    },
    init: function (state) {
      stateRef = state || null;
      members.length = 0; currentCommand = 'follow';
      abilityTimers = {}; effectTimers = {};
      markedUntil = 0; driftBoostUntil = 0; deadeyeUntil = 0;
      combatTarget = null; shoutCooldown = 0; initialized = true;
      if (stateRef) { stateRef.crew = members; stateRef.flags = stateRef.flags || {}; }
      if (stateRef && Array.isArray(stateRef.crewSaved)) {
        for (var i = 0; i < stateRef.crewSaved.length; i++) {
          var t = findTemplate(stateRef.crewSaved[i]);
          if (t && !findMember(t.id)) members.push(spawnMember(t));
        }
      }
      syncState(); return members;
    },
    update: function (dt, state) {
      if (!initialized) this.init(state);
      if (state) stateRef = state;
      if (!stateRef) return;
      dt = Math.max(0, Math.min(dt || 0, 0.1));
      updateCooldowns(dt); updateMorale(dt); updateCombat(dt);
      for (var i = 0; i < members.length; i++) {
        var m = members[i];
        if (!m.alive) continue;
        if (currentCommand === 'wait') { m.state = 'wait'; continue; }
        if (currentCommand === 'hide') {
          m.state = 'hide';
          var px = stateRef.player ? stateRef.player.x : m.x;
          var pz = stateRef.player ? stateRef.player.z : m.z;
          var dx = px - m.x, dz = pz - m.z, d = Math.sqrt(dx * dx + dz * dz);
          if (d > 1.2) { m.x += (dx / d) * Math.min(d, 3 * dt); m.z += (dz / d) * Math.min(d, 3 * dt); }
          continue;
        }
        applyFormationTarget(m, i, dt);
        if (currentCommand === 'attack' && combatTarget) m.state = 'attack';
      }
      if (shoutCooldown <= 0 && members.length > 0 && Math.random() < dt * 0.02) {
        var shouts = ['Siap, bos!', 'Kita di belakangmu!', 'Sunset Bay milik kita!'];
        toast(members[Math.floor(Math.random() * members.length)].name + ': ' +
          shouts[Math.floor(Math.random() * shouts.length)]);
        shoutCooldown = 25;
      }
      syncState();
    },
    recruit: function (name) {
      if (!stateRef) return null;
      var template = findTemplate(name);
      if (!template) { toast('Tidak ada anggota crew bernama "' + name + '". Coba: Rico, Maya, Dex, Luna.'); return null; }
      if (findMember(template.id)) { toast(template.name + ' sudah bergabung dengan crew.'); return findMember(template.id); }
      if (members.length >= 4) { toast('Crew sudah penuh (maks 4 anggota).'); return null; }
      if ((stateRef.respect || 0) < template.respectNeeded) {
        toast(template.name + ' butuh respect ' + template.respectNeeded + ' (kamu: ' + (stateRef.respect || 0) + ').'); return null;
      }
      if ((stateRef.money || 0) < template.cost) {
        toast('Rekrut ' + template.name + ' butuh $' + template.cost + ' (kamu: $' + (stateRef.money || 0) + ').'); return null;
      }
      stateRef.money -= template.cost;
      var member = spawnMember(template);
      members.push(member);
      if (window.SB && SB.HUD && SB.HUD.setMoney) SB.HUD.setMoney(stateRef.money);
      toast(template.name + ' "' + template.nickname + '" bergabung! (' + template.role + ' — ' + template.skill + ' ' + template.skillLevel + ')');
      sfx('recruit'); syncState(); return member;
    },
    command: function (cmd) {
      var key = String(cmd || '').trim().toLowerCase(), resolved = null;
      for (var c in COMMANDS) if (COMMANDS[c].indexOf(key) >= 0 || c === key) { resolved = c; break; }
      if (!resolved) { toast('Perintah tidak dikenal: "' + cmd + '". Pakai: ikut / serang / tunggu / bersembunyi.'); return currentCommand; }
      currentCommand = resolved;
      var labels = { follow: 'Ikut aku!', attack: 'Serang!', wait: 'Tunggu di sini.', hide: 'Bersembunyi, jangan kelihatan.' };
      toast('Crew: ' + labels[resolved]); sfx('order'); syncState(); return currentCommand;
    },
    ability: function (name) {
      var member = findMember(name);
      if (!member) {
        var template = findTemplate(name);
        if (template && !findMember(template.id)) { toast(template.name + ' belum direkrut. Rekrut dulu lewat SB.Crew.recruit("' + template.name + '").'); return false; }
        toast('Ability tidak dikenal: "' + name + '".'); return false;
      }
      if (!member.alive) { toast(member.name + ' sedang down, tidak bisa memakai ability.'); return false; }
      if (member.cooldownLeft > 0) { toast(member.abilityName + ' cooldown ' + Math.ceil(member.cooldownLeft) + ' detik lagi.'); return false; }
      var ok = false;
      if (member.ability === 'drift-boost') ok = abilityDriftBoost();
      else if (member.ability === 'deadeye') ok = abilityDeadeye();
      else if (member.ability === 'ghost-signal') ok = abilityGhostSignal();
      else if (member.ability === 'eagle-eye') ok = abilityEagleEye();
      if (ok) { member.cooldownLeft = member.cooldown; abilityTimers[member.ability] = member.cooldown; }
      syncState(); return ok;
    },
    dismiss: function (name) {
      var m = findMember(name);
      if (!m) return false;
      members.splice(members.indexOf(m), 1);
      toast(m.name + ' keluar dari crew.'); syncState(); return true;
    },
    reviveAll: function () {
      for (var i = 0; i < members.length; i++) { members[i].alive = true; members[i].hp = 100; }
      syncState();
    },
    onMissionStart: function () { for (var i = 0; i < members.length; i++) members[i].missionsWith++; syncState(); },
    onRaceStart: function () { for (var i = 0; i < members.length; i++) members[i].racesWith++; syncState(); },
    count: function () { return members.length; },
    perks: function () { return crewPerks(); },
    heal: function (name, amount) { var ok = healMember(name, amount); syncState(); return ok; },
    train: function (name) { var lvl = trainMember(name); syncState(); return lvl; }
  };
})();

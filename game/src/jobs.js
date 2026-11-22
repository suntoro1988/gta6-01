window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.Jobs — missions for Sunset Bay v12. 22 missions, 79 stages.
  // 3 SHOWCASE missions:
  //  1. "The Harbour Lights Job" — 3-phase heist: recon -> execution -> escape.
  //  2. "Neon Mile Grand Prix"   — street-race showcase across the bay.
  //  3. "Tide Line Rescue"      — rescue showcase: save a stranded crew.
  // Mission 1 ("First Light Courier") pays +$200 & REP +100, exactly as spec.
  // Every mission: id, name, description, stages[], money reward, REP.
  // Stages are { text, sub, type, target:{x,z}, radius, timeLimit }.
  // Types: go (reach the marker), wait (survive the timer), collect
  // (reach + press E / auto-pickup), escape (lose the wanted level),
  // race (handed to SB.Races), talk (reach an NPC marker).
  // update(dt, state) advances stages by proximity / timer / flags, and
  // writes the live objective into state.mission so SB.HUD can show it.
  // ---------------------------------------------------------------------------

  var stateRef = null;
  var active = null;      // active mission object (from MISSIONS)
  var stageIdx = 0;
  var stageTimer = 0;
  var stageDone = false;
  var completedIds = {};
  var failedIds = {};
  var availableCache = null;

  function S(text, sub, type, x, z, extra) {
    var st = {
      text: text,
      sub: sub || '',
      type: type || 'go',
      target: { x: x || 0, z: z || 0 },
      radius: 14,
      timeLimit: 0
    };
    if (extra) {
      var k;
      for (k in extra) st[k] = extra[k];
    }
    return st;
  }

  function M(id, name, desc, money, rep, stages, extra) {
    var m = {
      id: id, name: name, desc: desc,
      money: money, rep: rep,
      stages: stages,
      showcase: false,
      district: 'Downtown',
      difficulty: 1
    };
    if (extra) {
      var k;
      for (k in extra) m[k] = extra[k];
    }
    return m;
  }

  // --- SHOWCASE 1: THE HARBOUR LIGHTS JOB (3-phase heist) -------------------
  var HARBOUR_LIGHTS = M('heist-harbour-lights', 'The Harbour Lights Job',
    'The big one. A vault of harbour cash moves through the port at dusk. ' +
    'Recon the yard, hit the convoy, then vanish across the bridge before AIR-1 arrives.',
    1200, 300,
    [
      // PHASE 1 — RECON (3 stages)
      S('Phase 1 — Recon: reach the harbour overlook',
        'Scout the port from the overlook. Stay out of sight — no wanted stars.',
        'go', 168, -142, { phase: 1 }),
      S('Phase 1 — Recon: photograph the convoy route',
        'Hold position at the overlook for 20 seconds and log the patrol times.',
        'wait', 168, -142, { phase: 1, timeLimit: 20 }),
      S('Phase 1 — Recon: mark the getaway bridge',
        'Drive to the north bridge and mark the escape route for the crew.',
        'go', -40, -210, { phase: 1 }),
      // PHASE 2 — EXECUTION (3 stages)
      S('Phase 2 — Execute: intercept the convoy at the docks',
        'The cash convoy is rolling. Block the road and take the truck.',
        'go', 150, -90, { phase: 2, wanted: 2 }),
      S('Phase 2 — Execute: crack the truck vault',
        'Hold the docks for 30 seconds while the crew cracks the vault.',
        'wait', 150, -90, { phase: 2, timeLimit: 30, wanted: 3 }),
      S('Phase 2 — Execute: load the cash into the getaway car',
        'Grab the bags and get back in the car. Cops are coming.',
        'collect', 138, -78, { phase: 2 }),
      // PHASE 3 — ESCAPE (3 stages)
      S('Phase 3 — Escape: cross the north bridge at full speed',
        'AIR-1 is in the air. Cross the bridge before the roadblock closes.',
        'go', -40, -210, { phase: 3, wanted: 4 }),
      S('Phase 3 — Escape: lose the helicopter over the water',
        'Shake AIR-1 along the coastal highway — stay fast, stay low.',
        'escape', -180, 120, { phase: 3, timeLimit: 45 }),
      S('Phase 3 — Escape: reach the safehouse',
        'Bring the cash home. The crew is waiting at the safehouse.',
        'go', -190, 180, { phase: 3 })
    ],
    { showcase: true, district: 'Harbour', difficulty: 5 });

  // --- SHOWCASE 2: NEON MILE GRAND PRIX (race) -------------------------------
  var NEON_GRAND_PRIX = M('race-neon-grand-prix', 'Neon Mile Grand Prix',
    'The bay\'s biggest illegal street race. Five checkpoints, one rival crew, ' +
    'and the whole neon mile watching. Win it and the bay knows your name.',
    900, 220,
    [
      S('Line up at the Neon Mile start',
        'Get to the start line on the neon strip. The crowd is already loud.',
        'go', 60, 40, { phase: 1 }),
      S('Race: checkpoint 1 — Harbour turn',
        'Flat out through the harbour turn. Don\'t clip the containers.',
        'race', 150, -90, { phase: 2, checkpoint: 1 }),
      S('Race: checkpoint 2 — bridge straight',
        'Full throttle across the north bridge. Slipstream the leader.',
        'race', -40, -210, { phase: 2, checkpoint: 2 }),
      S('Race: checkpoint 3 — coastal highway',
        'Sunset on your left, rivals on your bumper. Hold the racing line.',
        'race', -180, 120, { phase: 2, checkpoint: 3 }),
      S('Race: final sprint to the finish',
        'Last 400 metres down the boardwalk. Win the Grand Prix.',
        'race', 40, 190, { phase: 2, checkpoint: 4 }),
      S('Collect the trophy at the finish',
        'Park at the finish line and collect the Neon Mile trophy.',
        'collect', 40, 190, { phase: 3 })
    ],
    { showcase: true, district: 'Neon Mile', difficulty: 4 });

  // --- SHOWCASE 3: TIDE LINE RESCUE -----------------------------------------
  var TIDE_RESCUE = M('rescue-tide-line', 'Tide Line Rescue',
    'A tour boat broke down off the beach with a full deck of tourists — ' +
    'including your crew\'s little sister. Get out there and bring them home.',
    650, 180,
    [
      S('Reach the marina and take a boat',
        'Sprint to the marina. Any boat will do — time is the tide.',
        'go', 120, 170, { phase: 1 }),
      S('Reach the stranded tour boat',
        'Push out past the breakwater to the drifting tour boat.',
        'go', 60, 230, { phase: 2 }),
      S('Rescue the passengers',
        'Hold alongside for 25 seconds while everyone climbs aboard.',
        'wait', 60, 230, { phase: 2, timeLimit: 25 }),
      S('Bring everyone back to the beach',
        'Ride the swell home and beach the boat by the lifeguard tower.',
        'go', -20, 195, { phase: 3 }),
      S('Check on the little sister',
        'Find her on the sand and make sure she is all right.',
        'talk', -30, 185, { phase: 3 })
    ],
    { showcase: true, district: 'Boardwalk', difficulty: 3 });

  // --- THE FULL MISSION LIST (22 missions, 79 stages) ------------------------
  var MISSIONS = [
    // Mission 1 — the opener. Reward fixed by spec: +$200 & REP +100.
    M('courier-first-light', 'First Light Courier',
      'Your first job in the bay. Deliver a sealed package across town before sunrise. Simple — if you drive clean.',
      200, 100,
      [
        S('Pick up the package at the diner', 'The package is waiting behind the counter at the Sunrise Diner.', 'go', -60, 30),
        S('Deliver it to the harbour office', 'Cross town to the harbour office. No scratches, no cops.', 'go', 150, -90),
        S('Report back to the diner', 'Job done. Collect your cut and your first REP.', 'go', -60, 30)
      ],
      { district: 'Downtown', difficulty: 1 }),

    HARBOUR_LIGHTS,
    NEON_GRAND_PRIX,
    TIDE_RESCUE,

    M('taxi-sunset-run', 'Sunset Taxi Run',
      'Three fares, one golden hour. Drive tourists along the coast before the light dies.',
      180, 60,
      [
        S('Pick up the couple at the hotel', 'They are waiting outside the Palma Hotel.', 'go', 30, -20),
        S('Drop them at the beach bar', 'Coastal road, easy pace — they want the view.', 'go', -120, 160),
        S('Pick up the last fare at the pier', 'One more fare, then the meter stops.', 'go', 90, 150)
      ],
      { district: 'Boardwalk', difficulty: 1 }),

    M('smuggler-cove-drop', 'Cove Drop',
      'Move a crate from the cove to the warehouse. Quiet roads, quiet radio.',
      320, 90,
      [
        S('Collect the crate at Smuggler\'s Cove', 'Park at the cove and load the crate.', 'collect', -210, -60),
        S('Deliver to the warehouse', 'Avoid the main road — patrols sweep it at dusk.', 'go', 120, -40),
        S('Lose any tail, then confirm delivery', 'If anyone followed you, shake them first.', 'escape', 120, -40, { timeLimit: 30 })
      ],
      { district: 'Harbour', difficulty: 2 }),

    M('photo-golden-hour', 'Golden Hour Shots',
      'A magazine wants the bay at its best. Shoot three postcard spots before dark.',
      150, 70,
      [
        S('Photograph the lighthouse', 'Frame the lighthouse against the sunset.', 'collect', -230, 40),
        S('Photograph the neon strip', 'Catch the first neon flickering on.', 'collect', 60, 40),
        S('Photograph the marina', 'Last light on the masts. Make it count.', 'collect', 120, 170)
      ],
      { district: 'Boardwalk', difficulty: 1 }),

    M('pizza-midnight-rush', 'Midnight Pizza Rush',
      'Four pizzas, four addresses, one very impatient night shift. Go.',
      140, 50,
      [
        S('Collect the pizzas', 'Hot box is ready at the pizzeria.', 'go', -20, -60),
        S('Deliver to the tower block', 'Third floor, no lift. Leave it at the door.', 'go', 80, -120),
        S('Deliver to the beach party', 'Last drop — the party is on the sand.', 'go', -140, 180)
      ],
      { district: 'Downtown', difficulty: 1 }),

    M('repo-night-shift', 'Repo Night Shift',
      'The loan shark\'s cars are parked all over the bay. Tow three before dawn.',
      380, 110,
      [
        S('Tow the convertible on Neon Mile', 'Hook it fast — the owner is inside the club.', 'collect', 60, 40),
        S('Tow the sedan by the marina', 'Second car, second warning. Keep it quick.', 'collect', 120, 170),
        S('Drop both at the impound lot', 'Park them in the lot and get paid.', 'go', 180, -160)
      ],
      { district: 'Neon Mile', difficulty: 2 }),

    M('street-race-rookie', 'Rookie Street Race',
      'Your first race. Three checkpoints around the block — prove you can drive.',
      250, 80,
      [
        S('Reach the start line', 'The others are already revving.', 'go', 0, 80),
        S('Race: checkpoint 1', 'First turn is tight. Brake late.', 'race', 100, 80, { checkpoint: 1 }),
        S('Race: finish line', 'Bring it home in first place.', 'race', 0, 80, { checkpoint: 2 })
      ],
      { district: 'Downtown', difficulty: 2 }),

    M('street-race-harbour-sprint', 'Harbour Sprint',
      'A short, sharp sprint through the container yard. No room for error.',
      300, 90,
      [
        S('Reach the harbour start', 'Engines on at the container gate.', 'go', 140, -120),
        S('Race: checkpoint 1 — container slalom', 'Thread the containers at speed.', 'race', 170, -60, { checkpoint: 1 }),
        S('Race: finish at the crane', 'Finish under the big crane.', 'race', 150, -90, { checkpoint: 2 })
      ],
      { district: 'Harbour', difficulty: 2 }),

    M('vigilante-alley', 'Alley Vigilante',
      'A protection crew is shaking down the market stalls. Run them off.',
      260, 100,
      [
        S('Reach the market alley', 'The stalls are on the east side of the market.', 'go', -90, -80),
        S('Confront the crew', 'Stand your ground for 20 seconds — they will back down.', 'wait', -90, -80, { timeLimit: 20 }),
        S('Escort the stall owner home', 'Walk her home so the crew knows the alley is watched.', 'go', -120, -40)
      ],
      { district: 'Old Town', difficulty: 2 }),

    M('fish-market-dawn', 'Dawn Fish Market',
      'The catch comes in at dawn. Buy low at the market, sell high uptown.',
      200, 60,
      [
        S('Buy the morning catch', 'Pick up the crates at the fish market.', 'collect', 160, -130),
        S('Deliver to the uptown restaurant', 'Fresh fish, still cold. Don\'t dawdle.', 'go', 40, -160),
        S('Collect the payment', 'Cash in hand, back before the gulls wake.', 'go', 160, -130)
      ],
      { district: 'Harbour', difficulty: 1 }),

    M('tour-guide-day', 'Bay Tour Guide',
      'Drive a tour group to the three sights every visitor asks for.',
      170, 60,
      [
        S('Pick up the tour group', 'They are waiting by the visitor centre.', 'go', 10, 10),
        S('Show them the lighthouse', 'Slow down — they want photos.', 'go', -230, 40),
        S('End the tour at the boardwalk', 'Drop them at the ice-cream stand.', 'go', -40, 185)
      ],
      { district: 'Boardwalk', difficulty: 1 }),

    M('garage-chop-shop', 'Chop Shop Run',
      'A client wants a specific car. Steal it, lose the heat, deliver it.',
      420, 120,
      [
        S('Steal the target car', 'It is parked outside the casino. Be quick.', 'collect', 100, -20),
        S('Lose the wanted level', 'Duck down the side streets until the stars fade.', 'escape', 0, 0, { timeLimit: 40 }),
        S('Deliver to the chop shop', 'Park it inside and take the cash.', 'go', 190, -40)
      ],
      { district: 'Neon Mile', difficulty: 3 }),

    M('beach-cleanup-crew', 'Beach Cleanup Crew',
      'The tide brought in a mess. Help the lifeguards clear three spots.',
      120, 50,
      [
        S('Clear the north beach', 'Grab the bags by the lifeguard tower.', 'collect', -80, 190),
        S('Clear the pier', 'Debris under the pier, watch the waves.', 'collect', 90, 150),
        S('Clear the cove', 'Last spot — the cove is the worst.', 'collect', -210, -60)
      ],
      { district: 'Boardwalk', difficulty: 1 }),

    M('heli-spotlight-run', 'Spotlight Run',
      'AIR-1 is sweeping the bridge. Cross it in the dark without being lit up.',
      500, 150,
      [
        S('Reach the bridge approach', 'Wait for the spotlight to swing away.', 'go', -20, -180),
        S('Cross the bridge', 'Keep moving — the spotlight is sweeping.', 'go', -40, -220),
        S('Vanish into Old Town', 'Lose the helicopter in the narrow streets.', 'escape', -140, -100, { timeLimit: 35 })
      ],
      { district: 'Old Town', difficulty: 3 }),

    M('casino-vip-escort', 'Casino VIP Escort',
      'A high roller needs a quiet ride from the casino to the marina yacht.',
      450, 130,
      [
        S('Pick up the VIP at the casino', 'Black car, back door, no photos.', 'go', 100, -20),
        S('Drive to the marina', 'Smooth and fast — the yacht leaves in ten minutes.', 'go', 120, 170),
        S('Confirm the handover', 'Watch him board, then disappear.', 'wait', 120, 170, { timeLimit: 15 })
      ],
      { district: 'Neon Mile', difficulty: 3 }),

    M('storm-surge-rescue', 'Storm Surge Rescue',
      'The storm hit the pier. Two fishermen are stranded on the breakwater.',
      550, 160,
      [
        S('Reach the pier in the storm', 'Rain is hammering the boards. Hold on.', 'go', 90, 150),
        S('Rescue the first fisherman', 'Get him off the breakwater.', 'collect', 110, 190),
        S('Rescue the second fisherman', 'One more — the waves are rising.', 'collect', 130, 200),
        S('Get everyone to shelter', 'Bring them to the lifeguard station.', 'go', -20, 195)
      ],
      { district: 'Boardwalk', difficulty: 4 }),

    M('kingpin-audition', 'Kingpin Audition',
      'The bay\'s boss wants to see what you are made of. Three tests, one night.',
      800, 250,
      [
        S('Test 1 — win the midnight race', 'Beat the boss\'s driver on the coastal highway.', 'race', -180, 120, { checkpoint: 1 }),
        S('Test 2 — deliver the package under heat', 'Two stars and a package. Deliver it anyway.', 'go', 180, -160),
        S('Test 3 — meet the boss at the penthouse', 'Park at the tower and take the lift. Do not keep him waiting.', 'go', 40, -160)
      ],
      { district: 'Downtown', difficulty: 5 }),

    M('sunset-finale', 'Sunset Finale',
      'One last job before the sun goes down: the whole bay, end to end.',
      1000, 300,
      [
        S('Start at the lighthouse', 'The finale begins where the bay begins.', 'go', -230, 40),
        S('Race the coast to the harbour', 'Full send down the coastal highway.', 'race', 150, -90, { checkpoint: 1 }),
        S('Escape across the bridge', 'AIR-1 is up. Cross the bridge and do not look back.', 'escape', -40, -210, { timeLimit: 40 }),
        S('Finish at the boardwalk as the sun sets', 'Park on the boardwalk. The bay is yours.', 'go', -40, 185)
      ],
      { district: 'Boardwalk', difficulty: 5 }),

    M('night-shift-patrol', 'Night Shift Patrol',
      'The neighbourhood watch asked for help. Patrol three corners before midnight.',
      220, 80,
      [
        S('Patrol the market corner', 'Check in at the market.', 'go', -90, -80),
        S('Patrol the school corner', 'Check in at the school gate.', 'go', -30, -140),
        S('Patrol the park corner', 'Last corner, then home.', 'go', 20, -60)
      ],
      { district: 'Old Town', difficulty: 1 })
  ];

  var SHOWCASE = [HARBOUR_LIGHTS, NEON_GRAND_PRIX, TIDE_RESCUE];

  // --- Helpers ---------------------------------------------------------------

  function findMission(id) {
    var i;
    for (i = 0; i < MISSIONS.length; i++) {
      if (MISSIONS[i].id === id) return MISSIONS[i];
    }
    return null;
  }

  function totalStages() {
    var n = 0, i;
    for (i = 0; i < MISSIONS.length; i++) n += MISSIONS[i].stages.length;
    return n;
  }

  function currentStage() {
    if (!active) return null;
    return active.stages[stageIdx] || null;
  }

  function setStateMission() {
    if (!stateRef) return;
    if (!active) {
      stateRef.mission = { id: null, stage: 0, text: '', reward: 0 };
      return;
    }
    var st = currentStage();
    stateRef.mission = {
      id: active.id,
      stage: stageIdx,
      text: active.name + ' — ' + (st ? st.text : ''),
      sub: st ? st.sub : '',
      reward: active.money,
      target: st ? st.target : null,
      totalStages: active.stages.length
    };
  }

  function hudSay(text) {
    if (window.SB && window.SB.HUD) window.SB.HUD.showMission(text);
  }

  function toast(text) {
    if (window.SB && window.SB.HUD) window.SB.HUD.showToast(text);
  }

  function sfx(name) {
    if (window.SB && window.SB.Audio) window.SB.Audio.sfx(name);
  }

  function applyWantedForStage(st) {
    if (!st || !stateRef) return;
    if (st.wanted && stateRef.wanted < st.wanted) {
      stateRef.wanted = st.wanted;
      stateRef.heat = Math.max(stateRef.heat || 0, st.wanted * 18);
      if (window.SB && window.SB.Police) window.SB.Police.setWanted(st.wanted);
    }
  }

  // --- Public API ------------------------------------------------------------

  function init(state) {
    stateRef = state || null;
    active = null;
    stageIdx = 0;
    stageTimer = 0;
    if (stateRef) {
      stateRef.mission = { id: null, stage: 0, text: '', reward: 0 };
      if (stateRef.stats) stateRef.stats.missionsDone = stateRef.stats.missionsDone || 0;
    }
  }

  function update(dt, state) {
    if (state) stateRef = state;
    if (!active || !stateRef) return;
    var st = currentStage();
    if (!st) { completeMission(); return; }
    var p = stateRef.player || { x: 0, z: 0 };
    var dx = (st.target.x || 0) - (p.x || 0);
    var dz = (st.target.z || 0) - (p.z || 0);
    var dist = Math.sqrt(dx * dx + dz * dz);

    if (st.type === 'go' || st.type === 'collect' || st.type === 'talk') {
      if (dist <= st.radius) advanceStage();
    } else if (st.type === 'wait') {
      // Must stay near the marker for the full timer.
      if (dist <= st.radius + 10) {
        stageTimer += dt;
        if (stageTimer >= (st.timeLimit || 10)) advanceStage();
      } else {
        stageTimer = Math.max(0, stageTimer - dt * 0.5);
      }
    } else if (st.type === 'escape') {
      stageTimer += dt;
      var wanted = stateRef.wanted || 0;
      if (wanted === 0 && stageTimer > 5) {
        advanceStage();
      } else if (st.timeLimit && stageTimer >= st.timeLimit && wanted <= 1) {
        advanceStage(); // close enough — the tail is cold
      }
    } else if (st.type === 'race') {
      // Race stages are driven by SB.Races; Jobs watches its flag.
      if (stateRef.flags && stateRef.flags['raceCheckpoint' + (st.checkpoint || 1)]) {
        stateRef.flags['raceCheckpoint' + (st.checkpoint || 1)] = false;
        advanceStage();
      } else if (dist <= st.radius && stateRef.race) {
        advanceStage();
      }
    }
    setStateMission();
  }

  function startMission(id) {
    var m = findMission(id);
    if (!m) return false;
    if (active) {
      toast('Finish "' + active.name + '" first — one job at a time.');
      return false;
    }
    if (completedIds[id]) {
      toast('"' + m.name + '" is already done. Pick another job.');
      return false;
    }
    active = m;
    stageIdx = 0;
    stageTimer = 0;
    stageDone = false;
    setStateMission();
    applyWantedForStage(currentStage());
    hudSay(m.name + ' — ' + (currentStage() ? currentStage().text : ''));
    toast('Mission started: ' + m.name + '  ·  Reward ' +
      '$' + m.money + '  ·  REP +' + m.rep);
    sfx('pickup');
    return true;
  }

  function advanceStage() {
    if (!active) return false;
    stageIdx++;
    stageTimer = 0;
    if (stageIdx >= active.stages.length) {
      completeMission();
      return true;
    }
    var st = currentStage();
    setStateMission();
    applyWantedForStage(st);
    if (st) {
      hudSay(active.name + ' — ' + st.text);
      toast('Stage ' + (stageIdx + 1) + '/' + active.stages.length + ': ' + st.text);
    }
    sfx('checkpoint');
    return true;
  }

  function completeMission() {
    if (!active) return false;
    var m = active;
    if (stateRef) {
      stateRef.money = (stateRef.money || 0) + m.money;
      stateRef.rep = (stateRef.rep || 0) + m.rep;
      stateRef.respect = (stateRef.respect || 0) + m.rep;
      if (stateRef.stats) stateRef.stats.missionsDone = (stateRef.stats.missionsDone || 0) + 1;
      if (stateRef.districtRep && m.district) {
        stateRef.districtRep[m.district] = Math.min(100,
          (stateRef.districtRep[m.district] || 0) + 8);
      }
    }
    completedIds[m.id] = true;
    active = null;
    stageIdx = 0;
    stageTimer = 0;
    setStateMission();
    toast('MISSION COMPLETE: ' + m.name + '  ·  +$' + m.money + '  ·  REP +' + m.rep);
    if (window.SB && window.SB.HUD) {
      window.SB.HUD.showMission('Sunset Bay', 'Mission complete — press M for the next job.');
    }
    sfx('win');
    sfx('money');
    return true;
  }

  function failMission(reason) {
    if (!active) return false;
    var m = active;
    failedIds[m.id] = true;
    active = null;
    stageIdx = 0;
    stageTimer = 0;
    setStateMission();
    toast('MISSION FAILED: ' + m.name + (reason ? ' — ' + reason : ''));
    sfx('fail');
    return true;
  }

  function abortMission() {
    if (!active) return false;
    var name = active.name;
    active = null;
    stageIdx = 0;
    stageTimer = 0;
    setStateMission();
    toast('Mission abandoned: ' + name);
    return true;
  }

  function available() {
    if (availableCache) return availableCache;
    var out = [];
    var i;
    for (i = 0; i < MISSIONS.length; i++) {
      if (!completedIds[MISSIONS[i].id]) out.push(MISSIONS[i]);
    }
    return out;
  }

  function currentTarget() {
    var st = currentStage();
    return st ? st.target : null;
  }

  function progress() {
    var done = 0, id;
    for (id in completedIds) if (completedIds[id]) done++;
    return { done: done, total: MISSIONS.length, active: active ? active.id : null };
  }

  window.SB.Jobs = {
    init: init,
    update: update,
    startMission: startMission,
    advanceStage: advanceStage,
    completeMission: completeMission,
    failMission: failMission,
    abortMission: abortMission,
    available: available,
    currentTarget: currentTarget,
    progress: progress,
    findMission: findMission,
    missions: MISSIONS,
    showcase: SHOWCASE,
    get active() { return active; },
    get stage() { return stageIdx; },
    get totalStages() { return totalStages(); },
    get completed() { return completedIds; }
  };
})();

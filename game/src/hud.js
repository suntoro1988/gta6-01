window.SB = window.SB || {};
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // SB.HUD — professional 3-corner DOM HUD for Sunset Bay v12.
  //  Top-left:    active mission + money + REP + respect rank.
  //  Top-right:   wanted stars + Heat meter + clock + radio station.
  //  Bottom-left: minimap (190x190 canvas) + mission route line.
  // Plus: toast / notification queue, BUSTED overlay, pause overlay,
  // damage vignette flash, and a small centre prompt line.
  // All DOM is built once in init(); update(state) only touches text /
  // styles that changed, so the HUD costs almost nothing per frame.
  // The minimap draws from state: player, mission target, cops, districts.
  // ---------------------------------------------------------------------------

  var root = null;
  var els = {};
  var minimapCtx = null;
  var stateRef = null;
  var toastQueue = [];
  var toastTimer = null;
  var missionText = '';
  var missionSub = '';
  var lastWanted = -1;
  var lastMoney = -1;
  var lastRank = '';
  var lastClock = '';
  var lastHeat = -1;
  var lastStation = -1;
  var bustedShown = false;
  var pausedShown = false;
  var promptTimer = null;

  var RANKS = ['Rookie', 'Street', 'Boss', 'Kingpin'];
  var RANK_COLORS = ['#c9d1d9', '#7ee787', '#ffd166', '#ff6b9d'];

  function rankFor(respect) {
    if (respect >= 900) return 'Kingpin';
    if (respect >= 500) return 'Boss';
    if (respect >= 150) return 'Street';
    return 'Rookie';
  }

  function rankIndex(rank) {
    var i = RANKS.indexOf(rank);
    return i < 0 ? 0 : i;
  }

  function fmtMoney(n) {
    var v = Math.floor(n || 0);
    var neg = v < 0;
    var s = String(Math.abs(v));
    var out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    out = s + out;
    return (neg ? '-$' : '$') + out;
  }

  function fmtClock(timeOfDay) {
    var h = Math.floor(timeOfDay || 0) % 24;
    var m = Math.floor(((timeOfDay || 0) % 1) * 60);
    var hh = (h < 10 ? '0' : '') + h;
    var mm = (m < 10 ? '0' : '') + m;
    return hh + ':' + mm;
  }

  function el(tag, cls, parent, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    if (parent) parent.appendChild(d);
    return d;
  }

  function injectCSS() {
    if (document.getElementById('sb-hud-css')) return;
    var css = [
      '#sb-hud{position:fixed;inset:0;pointer-events:none;z-index:20;',
      ' font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#fff;}',
      '#sb-hud .sb-panel{background:rgba(8,12,20,.62);border:1px solid rgba(255,255,255,.14);',
      ' border-radius:10px;backdrop-filter:blur(3px);box-shadow:0 4px 18px rgba(0,0,0,.35);}',
      '#sb-hud-tl{position:absolute;top:14px;left:14px;min-width:250px;max-width:330px;padding:10px 12px;}',
      '#sb-hud-mission{font-size:15px;font-weight:700;letter-spacing:.3px;line-height:1.25;}',
      '#sb-hud-mission-sub{font-size:12px;color:#ffd166;margin-top:3px;line-height:1.35;}',
      '#sb-hud-stats{display:flex;gap:14px;margin-top:8px;font-size:13px;}',
      '#sb-hud-money{color:#7ee787;font-weight:700;}',
      '#sb-hud-rep{color:#79c0ff;}',
      '#sb-hud-rank{font-weight:700;}',
      '#sb-hud-rankbar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:7px;overflow:hidden;}',
      '#sb-hud-rankfill{height:100%;background:linear-gradient(90deg,#ff9a3c,#ffd166);width:0%;transition:width .4s;}',
      '#sb-hud-tr{position:absolute;top:14px;right:14px;text-align:right;padding:10px 12px;min-width:210px;}',
      '#sb-hud-stars{font-size:21px;letter-spacing:3px;color:#ffd166;line-height:1;}',
      '#sb-hud-stars .sb-off{color:rgba(255,255,255,.22);}',
      '#sb-hud-heat{margin-top:6px;font-size:11px;color:#ffb4b4;}',
      '#sb-hud-heatbar{height:5px;background:rgba(255,255,255,.15);border-radius:3px;margin-top:3px;overflow:hidden;}',
      '#sb-hud-heatfill{height:100%;background:linear-gradient(90deg,#ffb020,#ff3b30);width:0%;transition:width .3s;}',
      '#sb-hud-clock{font-size:19px;font-weight:700;margin-top:6px;}',
      '#sb-hud-radio{font-size:12px;color:#a5d6ff;margin-top:2px;}',
      '#sb-hud-bl{position:absolute;left:14px;bottom:14px;}',
      '#sb-hud-minimap{display:block;border-radius:10px;border:1px solid rgba(255,255,255,.2);',
      ' background:#0a1420;box-shadow:0 4px 18px rgba(0,0,0,.45);}',
      '#sb-hud-route{font-size:11px;color:#a5d6ff;margin-top:5px;padding:4px 8px;display:inline-block;}',
      '#sb-hud-toasts{position:absolute;top:76px;left:50%;transform:translateX(-50%);',
      ' display:flex;flex-direction:column;gap:8px;align-items:center;width:min(480px,86vw);}',
      '.sb-toast{background:rgba(8,12,20,.85);border:1px solid rgba(255,209,102,.5);border-radius:8px;',
      ' padding:9px 16px;font-size:14px;font-weight:600;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.4);',
      ' animation:sb-toast-in .25s ease-out;}',
      '@keyframes sb-toast-in{from{opacity:0;transform:translateY(-8px);}to{opacity:1;transform:none;}}',
      '#sb-hud-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);',
      ' font-size:14px;background:rgba(8,12,20,.7);padding:7px 14px;border-radius:8px;display:none;}',
      '#sb-hud-vignette{position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .18s;',
      ' background:radial-gradient(ellipse at center,transparent 52%,rgba(255,0,0,.5) 100%);}',
      '#sb-hud-busted,#sb-hud-pause{position:fixed;inset:0;display:none;align-items:center;justify-content:center;',
      ' flex-direction:column;background:rgba(5,5,12,.72);z-index:40;pointer-events:auto;text-align:center;}',
      '#sb-hud-busted h1{font-size:64px;letter-spacing:14px;color:#ff3b30;margin:0;text-shadow:0 0 30px rgba(255,59,48,.7);}',
      '#sb-hud-busted p{font-size:17px;color:#eee;}',
      '#sb-hud-pause h1{font-size:44px;letter-spacing:8px;margin:0;}',
      '#sb-hud-pause p{font-size:15px;color:#bbb;line-height:1.7;}',
      '#sb-hud-pause kbd{background:#222;border:1px solid #555;border-radius:4px;padding:1px 7px;}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = 'sb-hud-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildDOM() {
    injectCSS();
    root = document.createElement('div');
    root.id = 'sb-hud';

    // Top-left panel.
    var tl = el('div', 'sb-panel', root);
    tl.id = 'sb-hud-tl';
    els.mission = el('div', '', tl, 'Sunset Bay');
    els.mission.id = 'sb-hud-mission';
    els.missionSub = el('div', '', tl, 'Explore the bay — press M for a mission.');
    els.missionSub.id = 'sb-hud-mission-sub';
    var stats = el('div', '', tl);
    stats.id = 'sb-hud-stats';
    els.money = el('span', '', stats, '$500');
    els.money.id = 'sb-hud-money';
    els.rep = el('span', '', stats, 'REP 0');
    els.rep.id = 'sb-hud-rep';
    els.rank = el('span', '', stats, 'Rookie');
    els.rank.id = 'sb-hud-rank';
    var bar = el('div', '', tl);
    bar.id = 'sb-hud-rankbar';
    els.rankFill = el('div', '', bar);
    els.rankFill.id = 'sb-hud-rankfill';

    // Top-right panel.
    var tr = el('div', 'sb-panel', root);
    tr.id = 'sb-hud-tr';
    els.stars = el('div', '', tr, '☆☆☆☆☆');
    els.stars.id = 'sb-hud-stars';
    els.heat = el('div', '', tr, 'HEAT 0');
    els.heat.id = 'sb-hud-heat';
    var heatbar = el('div', '', tr);
    heatbar.id = 'sb-hud-heatbar';
    els.heatFill = el('div', '', heatbar);
    els.heatFill.id = 'sb-hud-heatfill';
    els.clock = el('div', '', tr, '18:20');
    els.clock.id = 'sb-hud-clock';
    els.radio = el('div', '', tr, 'Bay FM 88.1');
    els.radio.id = 'sb-hud-radio';

    // Bottom-left: minimap + route.
    var bl = el('div', '', root);
    bl.id = 'sb-hud-bl';
    var canvas = document.createElement('canvas');
    canvas.id = 'sb-hud-minimap';
    canvas.width = 190; canvas.height = 190;
    bl.appendChild(canvas);
    minimapCtx = canvas.getContext('2d');
    els.route = el('div', 'sb-panel', bl, '');
    els.route.id = 'sb-hud-route';
    els.route.style.display = 'none';

    // Toasts, centre prompt, vignette.
    els.toasts = el('div', '', root);
    els.toasts.id = 'sb-hud-toasts';
    els.prompt = el('div', '', root, '');
    els.prompt.id = 'sb-hud-prompt';
    var vig = el('div', '', root);
    vig.id = 'sb-hud-vignette';
    els.vignette = vig;

    // BUSTED overlay.
    var busted = el('div', '', root);
    busted.id = 'sb-hud-busted';
    el('h1', '', busted, 'BUSTED');
    el('p', '', busted, 'The Sunset Bay PD caught up with you. Press R to try again.');
    els.busted = busted;

    // Pause overlay.
    var pause = el('div', '', root);
    pause.id = 'sb-hud-pause';
    el('h1', '', pause, 'PAUSED');
    var ptext = el('p', '', pause, '');
    ptext.innerHTML = '<kbd>P</kbd> resume &nbsp;·&nbsp; <kbd>M</kbd> missions &nbsp;·&nbsp; ' +
      '<kbd>R</kbd> radio &nbsp;·&nbsp; <kbd>Q</kbd> / <kbd>E</kbd> switch weapon<br>' +
      'Sunset Bay — golden hour never ends if you keep driving.';
    els.pause = pause;

    document.body.appendChild(root);
  }

  // --- Minimap ---------------------------------------------------------------

  function worldToMap(x, z, range) {
    // World spans roughly -range..+range in x/z; map is 190px with a margin.
    var m = 8;
    var s = (190 - m * 2) / (range * 2);
    return { x: 95 + x * s, y: 95 + z * s };
  }

  function minimap(state) {
    if (!minimapCtx || !state) return;
    var g = minimapCtx;
    var range = 260;
    g.clearRect(0, 0, 190, 190);
    // Sea / land background.
    g.fillStyle = '#0d2b45';
    g.fillRect(0, 0, 190, 190);
    g.fillStyle = '#14351f';
    g.beginPath();
    g.ellipse(95, 108, 88, 76, 0, 0, Math.PI * 2);
    g.fill();
    // Beach strip along the south edge.
    g.fillStyle = '#c9a86a';
    g.fillRect(0, 168, 190, 22);
    // Harbour (north-east).
    g.fillStyle = '#1d4a6b';
    g.fillRect(138, 18, 44, 26);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.strokeRect(138, 18, 44, 26);

    // Roads: a simple grid + the coastal highway.
    g.strokeStyle = 'rgba(255,255,255,.28)';
    g.lineWidth = 3;
    var i, p1, p2;
    for (i = -2; i <= 2; i++) {
      p1 = worldToMap(i * 80, -range, range);
      p2 = worldToMap(i * 80, range, range);
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
      p1 = worldToMap(-range, i * 80, range);
      p2 = worldToMap(range, i * 80, range);
      g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke();
    }
    // Coastal highway (curved, golden).
    g.strokeStyle = '#ffd166';
    g.lineWidth = 2.5;
    g.beginPath();
    for (i = 0; i <= 20; i++) {
      var x = -range + (i / 20) * range * 2;
      var z = 170 + Math.sin(x * 0.012) * 22;
      var p = worldToMap(x, z, range);
      if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
    }
    g.stroke();

    // District dots (from SB.City when available, else a fixed ring).
    var districts = (window.SB && window.SB.City && window.SB.City.districts) || [];
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (i = 0; i < districts.length; i++) {
      var ang = (i / Math.max(1, districts.length)) * Math.PI * 2;
      var dp = worldToMap(Math.cos(ang) * 150, Math.sin(ang) * 120, range);
      g.fillRect(dp.x - 1, dp.y - 1, 2, 2);
    }

    // Mission route: player -> mission target (red dashed line).
    var target = missionTarget(state);
    var pp = state.player ? worldToMap(state.player.x || 0, state.player.z || 0, range) : null;
    if (target && pp) {
      var tp = worldToMap(target.x, target.z, range);
      g.strokeStyle = '#ff3b30';
      g.lineWidth = 2;
      g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(pp.x, pp.y); g.lineTo(tp.x, tp.y); g.stroke();
      g.setLineDash([]);
      // Target marker: pulsing diamond.
      var pulse = 4 + Math.sin((state.time || 0) * 5) * 1.5;
      g.fillStyle = '#ff3b30';
      g.beginPath();
      g.moveTo(tp.x, tp.y - pulse); g.lineTo(tp.x + pulse, tp.y);
      g.lineTo(tp.x, tp.y + pulse); g.lineTo(tp.x - pulse, tp.y);
      g.closePath(); g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 9px sans-serif';
      g.fillText('★', tp.x - 4, tp.y - pulse - 3);
    }

    // Cops (blue dots) when wanted.
    if (state.wanted > 0 && window.SB && window.SB.Police && window.SB.Police.cops) {
      g.fillStyle = '#4da3ff';
      window.SB.Police.cops.forEach(function (cop) {
        var cp = worldToMap(cop.x || 0, cop.z || 0, range);
        g.beginPath(); g.arc(cp.x, cp.y, 2.5, 0, Math.PI * 2); g.fill();
      });
    }

    // Player arrow (white triangle, rotated by heading).
    if (pp) {
      var ang2 = state.player ? (state.player.angle || 0) : 0;
      g.save();
      g.translate(pp.x, pp.y);
      g.rotate(-ang2);
      g.fillStyle = '#fff';
      g.strokeStyle = '#111';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6); g.closePath();
      g.fill(); g.stroke();
      g.restore();
    }

    // North marker.
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = 'bold 10px sans-serif';
    g.fillText('N', 92, 12);
  }

  function missionTarget(state) {
    if (state.mission && state.mission.target) return state.mission.target;
    if (state.race && state.race.nextCheckpoint) return state.race.nextCheckpoint;
    if (window.SB && window.SB.Jobs && window.SB.Jobs.currentTarget) {
      return window.SB.Jobs.currentTarget();
    }
    return null;
  }

  // --- Toasts ----------------------------------------------------------------

  function showToast(text) {
    if (!els.toasts || !text) return;
    toastQueue.push(String(text));
    pumpToast();
  }

  function pumpToast() {
    if (toastTimer || toastQueue.length === 0 || !els.toasts) return;
    var text = toastQueue.shift();
    var t = document.createElement('div');
    t.className = 'sb-toast';
    t.textContent = text;
    els.toasts.appendChild(t);
    // Keep at most 3 visible.
    while (els.toasts.children.length > 3) {
      els.toasts.removeChild(els.toasts.firstChild);
    }
    toastTimer = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      toastTimer = null;
      pumpToast();
    }, 3200);
  }

  function showPrompt(text, ms) {
    if (!els.prompt) return;
    els.prompt.textContent = text;
    els.prompt.style.display = 'block';
    if (promptTimer) clearTimeout(promptTimer);
    promptTimer = setTimeout(function () {
      els.prompt.style.display = 'none';
    }, ms || 3500);
  }

  function flashDamage() {
    if (!els.vignette) return;
    els.vignette.style.opacity = '1';
    setTimeout(function () { els.vignette.style.opacity = '0'; }, 180);
  }

  // --- Public API ------------------------------------------------------------

  function init(state) {
    stateRef = state || null;
    if (typeof document === 'undefined') return;
    if (!root) buildDOM();
    if (state) update(state);
  }

  function update(state) {
    if (!root || !state) return;
    stateRef = state;

    // Mission (top-left).
    var mText = (state.mission && state.mission.text) || missionText || 'Sunset Bay';
    var mSub = (state.mission && state.mission.sub) || missionSub || '';
    if (els.mission && els.mission.textContent !== mText) els.mission.textContent = mText;
    if (els.missionSub && els.missionSub.textContent !== mSub) els.missionSub.textContent = mSub;

    // Money / REP / rank.
    if (els.money && state.money !== lastMoney) {
      els.money.textContent = fmtMoney(state.money);
      lastMoney = state.money;
    }
    if (els.rep) els.rep.textContent = 'REP ' + Math.floor(state.rep || 0);
    var rank = state.respectRank || rankFor(state.respect || 0);
    if (els.rank && rank !== lastRank) {
      els.rank.textContent = rank;
      els.rank.style.color = RANK_COLORS[rankIndex(rank)];
      lastRank = rank;
    }
    if (els.rankFill) {
      var thresholds = [0, 150, 500, 900, 1400];
      var ri = rankIndex(rank);
      var lo = thresholds[ri], hi = thresholds[ri + 1] || 1400;
      var pct = Math.max(0, Math.min(100, ((state.respect || 0) - lo) / (hi - lo) * 100));
      els.rankFill.style.width = pct + '%';
    }

    // Wanted stars.
    var w = Math.max(0, Math.min(5, Math.floor(state.wanted || 0)));
    if (w !== lastWanted && els.stars) {
      var stars = '';
      var s;
      for (s = 0; s < 5; s++) {
        stars += s < w
          ? '<span>★</span>'
          : '<span class="sb-off">☆</span>';
      }
      els.stars.innerHTML = stars;
      els.stars.style.color = w >= 3 ? '#ff3b30' : '#ffd166';
      lastWanted = w;
    }

    // Heat.
    var heat = Math.max(0, Math.min(100, Math.floor(state.heat || 0)));
    if (heat !== lastHeat) {
      if (els.heat) els.heat.textContent = 'HEAT ' + heat + (heat >= 70 ? ' — LAY LOW' : '');
      if (els.heatFill) els.heatFill.style.width = heat + '%';
      lastHeat = heat;
    }

    // Clock + radio.
    var clock = fmtClock(state.timeOfDay) + (state.day ? '  ·  Day ' + state.day : '');
    if (clock !== lastClock && els.clock) { els.clock.textContent = clock; lastClock = clock; }
    var stIdx = (typeof state.radio === 'number') ? state.radio : 0;
    if (stIdx !== lastStation && els.radio) {
      var names = (window.SB && window.SB.Audio && window.SB.Audio.stations) || [];
      els.radio.textContent = '♪ ' + (names[stIdx] || ('Radio ' + (stIdx + 1)));
      lastStation = stIdx;
    }

    // Route hint under the minimap.
    var target = missionTarget(state);
    if (els.route) {
      if (target && state.mission && state.mission.id) {
        els.route.style.display = 'inline-block';
        var dist = state.player
          ? Math.round(Math.hypot((target.x || 0) - (state.player.x || 0),
              (target.z || 0) - (state.player.z || 0)))
          : 0;
        els.route.textContent = '➤ ' + (state.mission.text || 'Mission') + ' — ' + dist + 'm';
      } else {
        els.route.style.display = 'none';
      }
    }

    // Busted state follows wanted + hp.
    if (state.player && state.player.hp <= 0 && !bustedShown) showBusted(true);
    minimap(state);
  }

  function showMission(text, sub) {
    missionText = text || '';
    missionSub = sub || '';
    if (els.mission) els.mission.textContent = missionText;
    if (els.missionSub) els.missionSub.textContent = missionSub;
    if (text) showToast('★ ' + text);
  }

  function setWanted(n) {
    if (stateRef) stateRef.wanted = Math.max(0, Math.min(5, Math.floor(n || 0)));
    lastWanted = -1; // force refresh on next update
    if (stateRef) update(stateRef);
  }

  function setMoney(n) {
    if (stateRef) stateRef.money = Math.floor(n || 0);
    lastMoney = -1;
    if (stateRef) update(stateRef);
  }

  function showBusted(show) {
    bustedShown = !!show;
    if (els.busted) els.busted.style.display = show ? 'flex' : 'none';
    if (show) {
      if (window.SB && window.SB.Audio) window.SB.Audio.sfx('busted');
    }
  }

  function showPause(show) {
    pausedShown = !!show;
    if (els.pause) els.pause.style.display = show ? 'flex' : 'none';
    return pausedShown;
  }

  function hideOverlays() {
    showBusted(false);
    showPause(false);
  }

  window.SB.HUD = {
    init: init,
    update: update,
    showMission: showMission,
    showToast: showToast,
    showPrompt: showPrompt,
    setWanted: setWanted,
    setMoney: setMoney,
    minimap: minimap,
    showBusted: showBusted,
    showPause: showPause,
    hideOverlays: hideOverlays,
    flashDamage: flashDamage,
    get busted() { return bustedShown; },
    get paused() { return pausedShown; }
  };
})();

// Sunset Bay — HUD (v8, written fresh from SPEC-v8)
// window.SB.HUD: { update, draw, showMessage }
// DOM HUD + minimap (canvas 2D) + fullscreen map (Tab) + pause (P) + crosshair.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};
  var G = function () { return SB.G; };

  var msgTimer = null;
  var mapOpen = false;
  var paused = false;

  function $(id) { return document.getElementById(id); }

  function fmtClock(h) {
    var hh = Math.floor(h) % 24;
    var mm = Math.floor((h - Math.floor(h)) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  function stars(n) {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    return s;
  }

  function missionText() {
    var g = G();
    var M = SB.Game && SB.Game.MISSIONS;
    if (!M || !M[g.mission]) return 'Free roam';
    var m = M[g.mission];
    var st = m.stages && m.stages[g.missionStage];
    return m.name + (st ? ' — ' + st.text : '');
  }

  function vehicleName() {
    var g = G();
    if (!g.player) return '';
    if (g.player.inCar && g.player.car) return g.player.car.name || 'Car';
    if (g.player.inBoat) return 'Speedboat';
    return 'On foot';
  }

  function currentWeapon() {
    var g = G();
    return g.weapon || g.currentWeapon ||
      (g.weapons && g.weapons[g.weaponSlot || 0] && g.weapons[g.weaponSlot || 0].name) || '';
  }

  var HUD = {
    mapOpen: false,
    paused: false,

    update: function () {
      var g = G();
      if (!g) return;
      var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
      set('hud-money', '$' + Math.floor(g.money || 0));
      set('hud-rep', 'REP ' + Math.floor(g.rep || 0));
      set('hud-drifts', 'Drifts ' + (g.drifts || 0));
      set('hud-wanted', stars(g.wanted || 0));
      set('hud-clock', fmtClock(g.clock == null ? 18 : g.clock));
      var spd = g.player ? Math.round(Math.abs(g.player.speed || 0) * 3.6) : 0;
      set('hud-speed', spd + ' km/h');
      set('hud-vehicle', vehicleName());
      set('hud-mission', missionText());
      var st = SB.Audio && SB.Audio.stations ? SB.Audio.stations[SB.Audio.station || 0] : '';
      set('hud-radio', st ? '♪ ' + st : '');
      var dist = g.district || (SB.City && SB.City.districtAt && g.player
        ? SB.City.districtAt(g.player.x, g.player.z) : '');
      set('hud-district', dist || '');
      // crosshair only when Pistol equipped (weapon disimpan lowercase 'pistol')
      var ch = $('crosshair');
      if (ch) {
        var w = currentWeapon();
        ch.style.display = (w === 'Pistol' || w === 'pistol') ? 'block' : 'none';
      }
      // pause overlay
      var pv = $('pause');
      if (pv) pv.style.display = paused ? 'flex' : 'none';
      var mv = $('map');
      if (mv) mv.style.display = mapOpen ? 'flex' : 'none';
      if (mapOpen) HUD.drawMap();
    },

    draw: function () {
      // minimap (small 2D canvas)
      var cv = $('minimap');
      if (!cv) return;
      var ctx = cv.getContext('2d');
      if (!ctx) return;
      var W = cv.width, H = cv.height;
      var g = G();
      ctx.fillStyle = '#0d2733';
      ctx.fillRect(0, 0, W, H);
      var range = 220; // world units visible
      var px = g.player ? g.player.x : 0;
      var pz = g.player ? g.player.z : 0;
      function toMap(x, z) {
        return [W / 2 + (x - px) / range * W / 2, H / 2 + (z - pz) / range * H / 2];
      }
      // water (west + south edges)
      ctx.fillStyle = '#14506e';
      ctx.fillRect(0, 0, W * 0.08, H);
      ctx.fillRect(0, H * 0.92, W, H * 0.08);
      // buildings
      if (SB.City && SB.City.buildings) {
        ctx.fillStyle = '#3a4a55';
        for (var i = 0; i < SB.City.buildings.length; i++) {
          var b = SB.City.buildings[i];
          var p = toMap(b.x, b.z);
          if (p[0] < -4 || p[0] > W + 4 || p[1] < -4 || p[1] > H + 4) continue;
          ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
        }
      }
      // mission target
      var M = SB.Game && SB.Game.MISSIONS;
      if (M && M[g.mission] && M[g.mission].stages && M[g.mission].stages[g.missionStage]) {
        var t = M[g.mission].stages[g.missionStage].target;
        if (t) {
          var tp = toMap(t.x, t.z);
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath(); ctx.arc(tp[0], tp[1], 5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#000'; ctx.stroke();
        }
      }
      // police
      if (g.police) {
        ctx.fillStyle = '#ff4757';
        for (var j = 0; j < g.police.length; j++) {
          var pp = toMap(g.police[j].x, g.police[j].z);
          ctx.beginPath(); ctx.arc(pp[0], pp[1], 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      // player arrow
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-(g.player ? g.player.yaw || 0 : 0));
      ctx.fillStyle = '#2ed573';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
      // north marker
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('N', W - 12, 12);
    },

    drawMap: function () {
      var cv = $('mapCanvas');
      if (!cv) return;
      var ctx = cv.getContext('2d');
      if (!ctx) return;
      var W = cv.width, H = cv.height;
      var g = G();
      ctx.fillStyle = '#0a1a24';
      ctx.fillRect(0, 0, W, H);
      // water west + south
      ctx.fillStyle = '#14506e';
      ctx.fillRect(0, 0, W * 0.10, H);
      ctx.fillRect(0, H * 0.90, W, H * 0.10);
      // city bounds: assume world ~ -260..260
      function toMap(x, z) {
        return [(x + 260) / 520 * W, (z + 260) / 520 * H];
      }
      // district labels
      var names = (SB.City && SB.City.districts) || [];
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '11px sans-serif';
      for (var d = 0; d < names.length; d++) {
        var gx = (d % 5) * (W / 5) + 10;
        var gy = Math.floor(d / 5) * (H / 2) + 20;
        ctx.fillText(names[d], gx, gy);
      }
      // buildings
      if (SB.City && SB.City.buildings) {
        ctx.fillStyle = '#5a7180';
        for (var i = 0; i < SB.City.buildings.length; i++) {
          var b = SB.City.buildings[i];
          var p = toMap(b.x, b.z);
          ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
        }
      }
      // POI markers: safehouse, garage, marina, beach
      var pois = [
        { x: 0, z: 0, label: 'Safehouse', color: '#2ed573' },
        { x: 120, z: -80, label: 'Garage', color: '#ffa502' },
        { x: -240, z: 60, label: 'Marina', color: '#70a1ff' },
        { x: -180, z: 220, label: 'Beach', color: '#eccc68' }
      ];
      ctx.font = 'bold 12px sans-serif';
      for (var k = 0; k < pois.length; k++) {
        var q = toMap(pois[k].x, pois[k].z);
        ctx.fillStyle = pois[k].color;
        ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(pois[k].label, q[0] + 9, q[1] + 4);
      }
      // mission target
      var M = SB.Game && SB.Game.MISSIONS;
      if (M && M[g.mission] && M[g.mission].stages && M[g.mission].stages[g.missionStage]) {
        var t = M[g.mission].stages[g.missionStage].target;
        if (t) {
          var tp = toMap(t.x, t.z);
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath(); ctx.arc(tp[0], tp[1], 9, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
        }
      }
      // player
      if (g.player) {
        var pp = toMap(g.player.x, g.player.z);
        ctx.fillStyle = '#2ed573';
        ctx.beginPath(); ctx.arc(pp[0], pp[1], 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      // mission list (DOM)
      var ml = $('map-missions');
      if (ml && M) {
        var html = '';
        for (var m = 0; m < M.length; m++) {
          var done = m < g.mission;
          var cur = m === g.mission;
          html += '<div style="color:' + (cur ? '#ffd23f' : done ? '#2ed573' : '#aaa') + '">' +
            (cur ? '▶ ' : done ? '✓ ' : '') + (m + 1) + '. ' + M[m].name + '</div>';
        }
        ml.innerHTML = html;
      }
      var st = $('map-stats');
      if (st) {
        st.textContent = 'Money $' + Math.floor(g.money || 0) +
          '  •  REP ' + Math.floor(g.rep || 0) +
          '  •  Drifts ' + (g.drifts || 0) +
          '  •  Wanted ' + (g.wanted || 0) + '★' +
          '  •  Walked ' + Math.floor(g.dist || 0) + ' m' +
          '  •  Busted ' + (g.busted || 0) + '×' +
          '  •  Time ' + fmtClock(g.clock == null ? 18 : g.clock);
      }
    },

    toggleMap: function () {
      mapOpen = !mapOpen;
      HUD.mapOpen = mapOpen;
      HUD.update();
    },

    togglePause: function () {
      paused = !paused;
      HUD.paused = paused;
      var g = G();
      if (g) g.paused = paused;
      HUD.update();
    },

    isPaused: function () { return paused; },
    isMapOpen: function () { return mapOpen; },

    showMessage: function (t) {
      var el = $('hud-message');
      if (!el) return;
      el.textContent = t;
      el.style.opacity = '1';
      if (msgTimer) clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { el.style.opacity = '0'; }, 2600);
    }
  };

  SB.HUD = HUD;
})();

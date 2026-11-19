// Sunset Bay — HUD (ditulis fresh untuk v7, dari SPEC)
// SB.HUD: uang, bintang wanted, jam, kecepatan, nama kendaraan, radio,
// misi aktif, minimap canvas 2D, peta fullscreen (Tab), pause (P),
// crosshair saat senjata Pistol.
(function () {
  'use strict';
  var SB = window.SB = window.SB || {};

  var root = null, moneyEl, wantedEl, clockEl, speedEl, vehEl, radioEl,
      missionEl, mini, mctx, mapOv, mapCanvas, pauseOv, cross, toastEl,
      toastTimer = null;
  var mapOpen = false;
  var WORLD = 340; // setengah lebar dunia untuk skala peta

  function $(id) { return document.getElementById(id); }

  function mk(tag, id, parent, css) {
    var e = document.createElement(tag);
    if (id) e.id = id;
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    return e;
  }

  function ensure() {
    if (root) return;
    root = mk('div', 'hud', document.body,
      'position:fixed;inset:0;pointer-events:none;z-index:20;' +
      'font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#fff;');
    var tl = mk('div', null, root,
      'position:absolute;top:10px;left:12px;text-shadow:0 1px 3px #000;');
    moneyEl = mk('div', 'hud-money', tl,
      'font-size:22px;font-weight:700;color:#7CFC9A;');
    wantedEl = mk('div', 'hud-wanted', tl,
      'font-size:18px;letter-spacing:2px;color:#FFD23F;margin-top:2px;');
    clockEl = mk('div', 'hud-clock', tl, 'font-size:14px;opacity:.92;');
    var tr = mk('div', null, root,
      'position:absolute;top:10px;right:12px;text-align:right;' +
      'text-shadow:0 1px 3px #000;');
    speedEl = mk('div', 'hud-speed', tr, 'font-size:26px;font-weight:700;');
    vehEl = mk('div', 'hud-veh', tr, 'font-size:13px;opacity:.92;');
    radioEl = mk('div', 'hud-radio', tr, 'font-size:13px;color:#8FD3FF;');
    var bl = mk('div', null, root,
      'position:absolute;left:12px;bottom:12px;max-width:48vw;' +
      'text-shadow:0 1px 3px #000;');
    missionEl = mk('div', 'hud-mission', bl,
      'font-size:14px;background:rgba(0,0,0,.45);padding:6px 9px;' +
      'border-radius:6px;border-left:3px solid #FFD23F;');
    mini = mk('canvas', 'minimap', root,
      'position:absolute;right:12px;bottom:12px;width:150px;height:150px;' +
      'border:2px solid rgba(255,255,255,.5);border-radius:8px;' +
      'background:rgba(10,20,30,.85);');
    mini.width = 150; mini.height = 150;
    mctx = mini.getContext('2d');
    cross = mk('div', 'crosshair', root,
      'position:absolute;left:50%;top:50%;width:22px;height:22px;' +
      'margin:-11px 0 0 -11px;display:none;');
    cross.innerHTML =
      '<div style="position:absolute;left:10px;top:0;width:2px;height:22px;' +
      'background:#fff;box-shadow:0 0 2px #000"></div>' +
      '<div style="position:absolute;top:10px;left:0;width:22px;height:2px;' +
      'background:#fff;box-shadow:0 0 2px #000"></div>';
    toastEl = mk('div', 'hud-toast', root,
      'position:absolute;left:50%;top:18%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.65);padding:8px 16px;border-radius:20px;' +
      'font-size:15px;display:none;white-space:nowrap;');
    pauseOv = mk('div', 'pause-overlay', document.body,
      'position:fixed;inset:0;display:none;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.55);color:#fff;' +
      'font-size:32px;font-weight:700;z-index:40;' +
      'font-family:system-ui,sans-serif;text-align:center;');
    pauseOv.textContent = 'PAUSED — tekan P untuk lanjut';
    mapOv = mk('div', 'map-overlay', document.body,
      'position:fixed;inset:0;display:none;background:rgba(5,12,20,.94);' +
      'color:#fff;z-index:30;font-family:system-ui,sans-serif;overflow:auto;');
    mapOv.innerHTML =
      '<div style="max-width:920px;margin:24px auto;padding:0 16px;">' +
      '<h2 style="margin:0 0 4px">PETA SUNSET BAY ' +
      '<span style="font-size:13px;color:#8FD3FF">— Tab untuk menutup</span></h2>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
      '<canvas id="bigmap" width="560" height="560" ' +
      'style="border:2px solid #445;background:#0A1420;border-radius:8px">' +
      '</canvas>' +
      '<div style="flex:1;min-width:250px">' +
      '<h3 style="margin:6px 0">Legenda POI</h3>' +
      '<div id="map-legend" style="font-size:14px;line-height:1.9"></div>' +
      '<h3 style="margin:14px 0 6px">Misi</h3>' +
      '<div id="map-missions" style="font-size:13px;line-height:1.7"></div>' +
      '<h3 style="margin:14px 0 6px">Statistik</h3>' +
      '<div id="map-stats" style="font-size:13px;line-height:1.7"></div>' +
      '</div></div></div>';
    mapCanvas = $('bigmap');
  }

  function fmtClock(h) {
    var hh = Math.floor(h) % 24;
    var mm = Math.floor((h % 1) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm +
      (hh >= 6 && hh < 18 ? ' ☀' : ' ☾');
  }

  function stars(n) {
    var s = '';
    for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    return s;
  }

  function missionInfo() {
    var G = SB.G;
    var ms = SB.Game && SB.Game.MISSIONS;
    if (!ms || !ms[G.mission]) return { name: '—', text: 'Tidak ada misi aktif' };
    var m = ms[G.mission];
    var st = m.stages[G.missionStage] || m.stages[0];
    return { name: m.name, text: st ? st.text : '' };
  }

  function drawMapInto(ctx, size) {
    var G = SB.G;
    var sc = size / (WORLD * 2);
    function X(x) { return (x + WORLD) * sc; }
    function Z(z) { return (z + WORLD) * sc; }
    ctx.clearRect(0, 0, size, size);
    // laut di barat + selatan
    ctx.fillStyle = '#0B2A4A';
    ctx.fillRect(0, 0, size, size);
    // daratan
    ctx.fillStyle = '#1E3325';
    ctx.fillRect(X(-WORLD), Z(-WORLD), size, size * 0.92);
    ctx.fillStyle = '#274A33';
    ctx.fillRect(X(-WORLD), Z(-WORLD), size, size * 0.92);
    // jalan utama (grid)
    ctx.strokeStyle = '#3A3A3A';
    ctx.lineWidth = Math.max(2, size / 90);
    var roads = (SB.City && SB.City.roads) || [];
    for (var i = 0; i < roads.length; i++) {
      var r = roads[i];
      ctx.beginPath();
      ctx.moveTo(X(r.x1 !== undefined ? r.x1 : r.x), Z(r.z1 !== undefined ? r.z1 : r.z));
      ctx.lineTo(X(r.x2 !== undefined ? r.x2 : r.x), Z(r.z2 !== undefined ? r.z2 : r.z));
      ctx.stroke();
    }
    if (!roads.length) {
      for (var g = -300; g <= 300; g += 60) {
        ctx.beginPath(); ctx.moveTo(X(g), Z(-300)); ctx.lineTo(X(g), Z(300)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(-300), Z(g)); ctx.lineTo(X(300), Z(g)); ctx.stroke();
      }
    }
    // bangunan
    var bs = (SB.City && SB.City.buildings) || [];
    ctx.fillStyle = '#8A93A3';
    for (var b = 0; b < bs.length; b++) {
      var bd = bs[b];
      ctx.fillRect(X(bd.x - bd.w / 2), Z(bd.z - bd.d / 2),
        Math.max(1, bd.w * sc), Math.max(1, bd.d * sc));
    }
    // dermaga / marina (barat)
    ctx.fillStyle = '#C9A227';
    ctx.fillRect(X(-WORLD), Z(-40), 10 * sc + 6, 80 * sc);
    // safehouse
    ctx.fillStyle = '#7CFC9A';
    ctx.beginPath(); ctx.arc(X(0), Z(0), 5, 0, 6.2832); ctx.fill();
    // target misi aktif
    var mi = missionInfo();
    var ms = SB.Game && SB.Game.MISSIONS;
    if (ms && ms[G.mission]) {
      var st = ms[G.mission].stages[G.missionStage];
      if (st && st.target) {
        ctx.fillStyle = '#FFD23F';
        ctx.beginPath(); ctx.arc(X(st.target.x), Z(st.target.z), 7, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    // polisi
    ctx.fillStyle = '#FF4444';
    var pol = G.police || [];
    for (var p = 0; p < pol.length; p++) {
      ctx.beginPath(); ctx.arc(X(pol[p].x), Z(pol[p].z), 3.5, 0, 6.2832); ctx.fill();
    }
    // heli
    if (G.heli) {
      ctx.fillStyle = '#FF8888';
      ctx.beginPath(); ctx.arc(X(G.heli.x), Z(G.heli.z), 5, 0, 6.2832); ctx.fill();
    }
    // pemain (panah)
    var px = X(G.player.x), pz = Z(G.player.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-G.player.yaw);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
    return mi;
  }

  function fillMapPanel() {
    var G = SB.G;
    var lg = $('map-legend');
    if (lg) {
      lg.innerHTML =
        '<span style="color:#fff">▲</span> Kamu &nbsp; ' +
        '<span style="color:#FFD23F">●</span> Target misi &nbsp; ' +
        '<span style="color:#FF4444">●</span> Polisi<br>' +
        '<span style="color:#7CFC9A">●</span> Safehouse &nbsp; ' +
        '<span style="color:#C9A227">■</span> Dermaga / Marina &nbsp; ' +
        '<span style="color:#FF8888">●</span> Heli AIR-1<br>' +
        '<span style="color:#8A93A3">■</span> Bangunan &nbsp; ' +
        '<span style="color:#3A3A3A">—</span> Jalan';
    }
    var mm = $('map-missions');
    var ms = SB.Game && SB.Game.MISSIONS;
    if (mm && ms) {
      var html = '';
      for (var i = 0; i < ms.length; i++) {
        var mark = i < G.mission ? '✓' : (i === G.mission ? '▶' : '·');
        var col = i < G.mission ? '#7CFC9A' : (i === G.mission ? '#FFD23F' : '#AAA');
        html += '<div style="color:' + col + '">' + mark + ' ' + (i + 1) +
          '. ' + ms[i].name + '</div>';
      }
      mm.innerHTML = html;
    }
    var st = $('map-stats');
    if (st) {
      var dist = SB.City && SB.City.districtAt ?
        SB.City.districtAt(G.player.x, G.player.z) : '—';
      st.innerHTML =
        'Uang: $' + G.money + '<br>' +
        'Reputasi: ' + G.rep + '<br>' +
        'Wanted: ' + stars(G.wanted) + '<br>' +
        'Jam: ' + fmtClock(G.clock) + '<br>' +
        'Distrik: ' + dist + '<br>' +
        'Jarak jalan kaki: ' + Math.round(G.dist) + ' m<br>' +
        'Drift: ' + G.drifts + ' &nbsp; Busted: ' + G.busted + '<br>' +
        'Misi: ' + (G.mission + 1) + ' / ' + (ms ? ms.length : 18);
    }
  }

  SB.HUD = {
    mapOpen: false,

    update: function () {
      ensure();
      var G = SB.G;
      if (!G) return;
      moneyEl.textContent = '$' + G.money;
      wantedEl.textContent = stars(G.wanted);
      clockEl.textContent = fmtClock(G.clock) +
        '  ·  ' + (SB.City && SB.City.districtAt ?
          SB.City.districtAt(G.player.x, G.player.z) : '');
      var kmh = Math.round((G.player.speed || 0) * 3.6);
      speedEl.textContent = (G.player.inCar || G.player.inBoat) ? kmh + ' km/h' : '';
      var car = G.player.car;
      vehEl.textContent = G.player.inBoat ? 'Speedboat' :
        (G.player.inCar ? (car && (car.name || car.model) || 'Mobil') : 'Jalan kaki');
      radioEl.textContent = '♪ ' + (SB.Audio ? SB.Audio.stationName() : '—');
      var mi = missionInfo();
      missionEl.innerHTML = '<b>Misi ' + (G.mission + 1) + ': ' + mi.name + '</b><br>' + mi.text;
      // crosshair hanya saat Pistol
      var w = G.weapon || (SB.Game && SB.Game.weapon);
      cross.style.display = (w === 'Pistol' && !G.player.inCar) ? 'block' : 'none';
      if (mapOpen) fillMapPanel();
    },

    draw: function () {
      ensure();
      var G = SB.G;
      if (!G || !mctx) return;
      drawMapInto(mctx, 150);
      if (mapOpen && mapCanvas) {
        var c2 = mapCanvas.getContext('2d');
        if (c2) drawMapInto(c2, 560);
      }
    },

    showMessage: function (t) {
      ensure();
      toastEl.textContent = t;
      toastEl.style.display = 'block';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 3200);
    },

    toggleMap: function () {
      ensure();
      mapOpen = !mapOpen;
      SB.HUD.mapOpen = mapOpen;
      mapOv.style.display = mapOpen ? 'block' : 'none';
      if (mapOpen) { fillMapPanel(); SB.HUD.draw(); }
    },

    openMap: function () {
      ensure();
      mapOpen = true;
      SB.HUD.mapOpen = true;
      mapOv.style.display = 'block';
      fillMapPanel();
      SB.HUD.draw();
    },

    closeMap: function () {
      ensure();
      mapOpen = false;
      SB.HUD.mapOpen = false;
      mapOv.style.display = 'none';
    },

    togglePause: function () {
      ensure();
      var G = SB.G;
      if (!G) return;
      G.paused = !G.paused; // P membekukan clock (loop utama cek flag ini)
      pauseOv.style.display = G.paused ? 'flex' : 'none';
    },

    setPaused: function (b) {
      ensure();
      var G = SB.G;
      if (!G) return;
      G.paused = !!b;
      pauseOv.style.display = G.paused ? 'flex' : 'none';
    }
  };
})();

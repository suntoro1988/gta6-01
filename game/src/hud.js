// hud.js — Sunset Bay v6: binds to the HUD elements already in game/index.html
// (money, district, clock, wanted, health/armor bars, mission panel,
// minimap, speed, vehicle/radio name, crosshair, toast, prompt, map overlay).
// No imports, no network. Named export: createHud.
// State G shape (from game.js via main.js): money, wanted, heat, health,
// armor, weapons[{name,ammo,active}], mission{name,stageLabel,target,distance,
// stageIndex,stageTotal}|null, districts[{name,cx,cz,r,hue}], roads[{axis,at}],
// pois[{name,x,z}], police[{x,z}], player{pos{x,z},yaw,heading}, clock,
// timeLabel, speed, vehicle, stash, rep, missionsDone, worldSize, radioName.
export function createHud(rootEl) {
  const $ = (id) => document.getElementById(id);
  const moneyEl = $('money'), districtEl = $('district'), clockEl = $('clock');
  const wantedEl = $('wanted'), hpEl = $('health-bar'), arEl = $('armor-bar');
  const panelEl = $('mission-panel'), mTitle = $('mission-title'), mText = $('mission-text');
  const mObj = $('objective'), mProg = $('mission-progress');
  const mini = $('minimap'), cross = $('crosshair'), toastEl = $('toast'), promptEl = $('prompt');
  const speedEl = $('speed'), vehEl = $('vehicle-name'), radioEl = $('radio-name');
  const mapEl = $('map-overlay'), bigMap = $('map-canvas'), legendEl = $('map-legend');
  const mctx = mini ? mini.getContext('2d') : null;
  const bctx = bigMap ? bigMap.getContext('2d') : null;
  let toastTimer = 0, missionList = [], lastMini = 0, lastWanted = -1;
  // Small weapon readout appended to the top-right HUD cluster.
  const wEl = document.createElement('div');
  wEl.style.cssText = 'font-size:12px;color:#ffe9a8;text-align:right;margin-top:2px;text-shadow:0 1px 3px rgba(0,0,0,.85)';
  const hudTr = $('hud-tr');
  if (hudTr) hudTr.appendChild(wEl);

  function fmt(n) { return '$' + Math.floor(n || 0).toLocaleString('en-US'); }
  function fmtClock(h) {
    h = ((h % 24) + 24) % 24;
    const hh = Math.floor(h) % 12 || 12, mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    return hh + ':' + mm + ' ' + (h < 12 ? 'AM' : 'PM');
  }
  const clamp01 = (n) => Math.max(0, Math.min(1, n || 0));
  function districtAt(G, x, z) {
    let best = null, bd = Infinity, near = null, nd = Infinity;
    for (const d of (G.districts || [])) {
      const dd = Math.hypot(x - d.cx, z - d.cz);
      if (dd < nd) { nd = dd; near = d; }
      if (dd < (d.r || 120) && dd < bd) { bd = dd; best = d; }
    }
    return (best || near) ? (best || near).name : 'Sunset Bay';
  }
  function drawMap(ctx, size, G, big) {
    if (!ctx) return;
    const W = G.worldSize || 840;
    const px = (x) => ((x + W / 2) / W) * size;
    const pz = (z) => ((z + W / 2) / W) * size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0a1420'; ctx.fillRect(0, 0, size, size);
    for (const d of (G.districts || [])) {
      ctx.fillStyle = 'hsl(' + (d.hue || 200) + ',45%,20%)';
      ctx.beginPath(); ctx.arc(px(d.cx), pz(d.cz), Math.max(4, ((d.r || 100) / W) * size), 0, 7); ctx.fill();
      if (big) {
        ctx.fillStyle = '#cfe0ee'; ctx.font = 'bold 13px system-ui';
        ctx.fillText(d.name, px(d.cx) - 24, pz(d.cz) + 4);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = big ? 3 : 1.5;
    for (const r of (G.roads || [])) {
      ctx.beginPath();
      if (r.axis === 'x') { ctx.moveTo(px(-336), pz(r.at)); ctx.lineTo(px(336), pz(r.at)); }
      else { ctx.moveTo(px(r.at), pz(-336)); ctx.lineTo(px(r.at), pz(336)); }
      ctx.stroke();
    }
    ctx.fillStyle = '#0e4a6b'; ctx.fillRect(px(318), 0, size - px(318), size);
    for (const p of (G.pois || [])) {
      ctx.fillStyle = '#ff7ad9';
      ctx.beginPath();
      ctx.moveTo(px(p.x), pz(p.z) - 6);
      ctx.lineTo(px(p.x) + 6, pz(p.z) + 5);
      ctx.lineTo(px(p.x) - 6, pz(p.z) + 5);
      ctx.closePath(); ctx.fill();
    }
    const tgt = G.mission && G.mission.target;
    if (tgt) {
      ctx.fillStyle = '#ffd23e';
      ctx.save(); ctx.translate(px(tgt.x), pz(tgt.z)); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-6, -6, 12, 12); ctx.restore();
    }
    if (G.taxi) {
      const t = G.taxi.stage === 'pickup' ? G.taxi.pickup : G.taxi.dropoff;
      ctx.fillStyle = '#4ac8ff';
      ctx.save(); ctx.translate(px(t.x), pz(t.z)); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10); ctx.restore();
    }
    for (const c of (G.police || [])) {
      ctx.fillStyle = '#4aa8ff';
      ctx.beginPath(); ctx.arc(px(c.x), pz(c.z), big ? 6 : 3, 0, 7); ctx.fill();
    }
    const p = G.player || {};
    const pxp = p.pos ? p.pos.x : (p.x || 0), pzp = p.pos ? p.pos.z : (p.z || 0);
    const hd = p.heading || p.yaw || 0;
    ctx.fillStyle = '#37e08b'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px(pxp), pz(pzp), big ? 8 : 5, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#37e08b'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(px(pxp), pz(pzp));
    ctx.lineTo(px(pxp) + Math.sin(hd) * 14, pz(pzp) + Math.cos(hd) * 14); ctx.stroke();
  }
  function renderStars(n) {
    if (n === lastWanted || !wantedEl) return;
    lastWanted = n;
    let html = '';
    for (let i = 0; i < 5; i++) html += '<span class="' + (i < n ? '' : 'off') + '">★</span>';
    wantedEl.innerHTML = html;
  }
  function update(G) {
    if (!G) return;
    if (moneyEl) moneyEl.textContent = fmt(G.money);
    const pl = G.player || {};
    const pxp = pl.pos ? pl.pos.x : (pl.x || 0), pzp = pl.pos ? pl.pos.z : (pl.z || 0);
    if (districtEl) districtEl.textContent = districtAt(G, pxp, pzp);
    if (clockEl) clockEl.textContent = fmtClock(G.clock || 0);
    renderStars(Math.max(0, Math.min(5, G.wanted | 0)));
    if (hpEl) hpEl.style.width = (clamp01((G.health ?? 100) / 100) * 100).toFixed(0) + '%';
    if (arEl) arEl.style.width = (clamp01((G.armor ?? 0) / 100) * 100).toFixed(0) + '%';
    const ws = G.weapons || [];
    const cur = ws.find((w) => w.active) || ws[0];
    if (wEl) wEl.textContent = cur ? (cur.name + '  ' + (cur.ammo === Infinity ? '∞' : cur.ammo)) : '';
    if (speedEl) speedEl.innerHTML = Math.round((G.speed || 0) * 2.2) + ' <small>mph</small>';
    if (vehEl) vehEl.textContent = G.vehicle ? (G.vehicle.kind === 'boat' ? 'Speedboat' : 'Car') : 'On foot';
    if (radioEl) radioEl.textContent = G.radioName || '';
    const m = G.mission;
    if (panelEl) {
      if (m && m.name) {
        panelEl.classList.remove('hidden');
        if (mTitle) mTitle.textContent = m.name.toUpperCase();
        if (mText) mText.textContent = m.stageLabel || '';
        if (mObj) mObj.textContent = m.distance != null ? Math.round(m.distance) + ' m to target' : '';
        if (mProg) mProg.style.width = (m.stageTotal ? (m.stageIndex / m.stageTotal) * 100 : 0).toFixed(0) + '%';
      } else panelEl.classList.add('hidden');
    }
    const now = performance.now();
    if (mctx && now - lastMini > 66) { lastMini = now; drawMap(mctx, 180, G, false); }
    if (mapEl && bctx && !mapEl.classList.contains('hidden')) drawMap(bctx, 720, G, true);
  }
  function toast(text, kind) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    toastEl.classList.toggle('good', kind === 'good');
    toastEl.classList.toggle('bad', kind === 'bad');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }
  function setCrosshair(on) { if (cross) cross.classList.toggle('hidden', !on); }
  function setPrompt(text) {
    if (!promptEl) return;
    if (text) { promptEl.textContent = text; promptEl.classList.remove('hidden'); }
    else promptEl.classList.add('hidden');
  }
  function showMap(on, G) {
    if (!mapEl) return;
    mapEl.classList.toggle('hidden', !on);
    if (on && G) {
      drawMap(bctx, 720, G, true);
      if (legendEl) {
        legendEl.innerHTML = '<b>10 districts</b> &middot; ' +
          (G.districts || []).map((d) => d.name).join(' &middot; ') +
          '<br>Press <b>TAB</b> or <b>Esc</b> to close &middot; yellow marker is you' +
          '<br><br><b>JOBS</b><br>' + (missionList.length
            ? missionList.map((j) => '◆ ' + j.name + ' — ' + (j.stageLabel || '') + (j.done ? ' (done)' : '')).join('<br>')
            : 'No jobs listed yet.') +
          '<br><br><b>STATS</b><br>Cash: ' + fmt(G.money) + '<br>REP: ' + (G.rep || 0) +
          '<br>Jobs done: ' + (G.missionsDone || 0) + '<br>Stash: ' + fmt(G.stash) +
          '<br>Heat: ' + Math.round(G.heat || 0) + '%<br>Time: ' + (G.timeLabel || '');
      }
    }
  }
  function refreshMissions(list) { missionList = Array.isArray(list) ? list.slice() : []; }
  return { update, toast, setCrosshair, showMap, refreshMissions, setPrompt };
}

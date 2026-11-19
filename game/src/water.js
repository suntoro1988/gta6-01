// Sunset Bay v5 — water.js
// Sistem air: area perairan, ombak animasi, dan kapal yang mengapung di
// Marina Bay. Ombak murni visual (fase sinus per titik); kapal tertambat
// naik-turun mengikuti ombak, kapal pemain ikut dihitung di sini juga.

export function createWater(city) {
  const waves = [];
  // Sebar titik ombak di seluruh rect air: laut barat, laut selatan,
  // dan cekungan marina. Tiap titik punya fase, amplitudo, dan kecepatan
  // sendiri supaya permukaan terlihat hidup, bukan seragam.
  for (const rect of city.water) {
    const count = Math.max(6, Math.round((rect.w * rect.d) / 90));
    for (let i = 0; i < count; i++) {
      const fx = ((i * 0.6180339887) % 1); // golden-ratio spread, deterministik
      const fz = ((i * 0.3819660113) % 1);
      waves.push({
        x: rect.x - rect.w / 2 + fx * rect.w,
        z: rect.z - rect.d / 2 + fz * rect.d,
        phase: (i * 1.7) % (Math.PI * 2),
        amp: 0.25 + (i % 5) * 0.08,
        speed: 0.7 + (i % 4) * 0.25,
      });
    }
  }

  // Kapal tertambat di dermaga marina + satu kapal di ujung The Pier.
  const boats = [];
  const dockSpots = [
    { x: -148, z: 192, heading: 0 },
    { x: -128, z: 194, heading: 0.3 },
    { x: -108, z: 194, heading: -0.3 },
    { x: -88, z: 192, heading: 0.1 },
    { x: -192, z: -6, heading: 1.57 },
  ];
  for (const s of dockSpots) {
    boats.push({
      x: s.x, z: s.z, heading: s.heading,
      y: 0, bob: 0, bobPhase: Math.random() * Math.PI * 2,
      moored: true, speed: 0,
    });
  }

  return { waves, boats, t: 0 };
}

// Tinggi ombak di satu titik (dipakai kapal + renderer bila perlu).
function waveHeightAt(W, x, z) {
  let h = 0;
  let n = 0;
  for (const w of W.waves) {
    const dx = w.x - x, dz = w.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 900) { // hanya ombak dalam radius 30 unit yang berpengaruh
      h += Math.sin(W.t * w.speed + w.phase + d2 * 0.01) * w.amp;
      n++;
    }
  }
  return n > 0 ? h / n : 0;
}

export function stepWater(W, S, dt) {
  W.t += dt;
  // Maju fase tiap ombak.
  for (const w of W.waves) {
    w.phase += dt * w.speed * 0.15;
    if (w.phase > Math.PI * 2) w.phase -= Math.PI * 2;
  }
  // Kapal tertambat mengapung: naik-turun + sedikit oleng.
  for (const b of W.boats) {
    if (!b.moored) continue;
    b.bobPhase += dt * 1.1;
    b.bob = Math.sin(b.bobPhase) * 0.22 + waveHeightAt(W, b.x, b.z) * 0.5;
    b.y = b.bob;
  }
  // Kapal pemain (bila ada di state) ikut mengapung di atas ombak.
  const pb = S && S.boat;
  if (pb) {
    pb.y = waveHeightAt(W, pb.x, pb.z) * 0.8 + Math.sin(W.t * 1.3 + pb.x * 0.05) * 0.12;
  }
}

export function inWaterArea(city, x, z) {
  for (const r of city.water) {
    if (Math.abs(x - r.x) <= r.w / 2 && Math.abs(z - r.z) <= r.d / 2) return true;
  }
  return false;
}

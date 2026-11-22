// fx.js — Sunset Bay v14, Builder F.
// Particle effects: sparks, smoke, foam, fire, muzzle flash, explosions.
// Everything is drawn procedurally through SB.GL; no textures, no files.
// Particles are plain data: position, velocity, age, life, size, color.
// SB.FX.update(dt) advances them and draws them every frame, so the
// render loop only has to call update once per frame.

window.SB = window.SB || {};

(function () {
  "use strict";

  var MAX_PARTICLES = 900;
  var MAX_FLASHES = 24;

  // Small unit quad in the XZ plane, reused for every particle billboard.
  // Vertices are (x, y, z); the render path scales it by particle size.
  var QUAD_MESH = {
    positions: [
      -0.5, 0.0, -0.5,
       0.5, 0.0, -0.5,
       0.5, 0.0,  0.5,
      -0.5, 0.0, -0.5,
       0.5, 0.0,  0.5,
      -0.5, 0.0,  0.5
    ],
    colors: [
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1,
      1, 1, 1
    ],
    indices: [0, 1, 2, 3, 4, 5]
  };

  // A single shared mesh object with a mutable color slot is not enough
  // when particles have individual colors, so drawMesh is given a fresh
  // color array per particle through the transform color argument where
  // the GL module supports it; the fallback below uses the raw context.
  function clonePos(p) {
    if (!p) return { x: 0, y: 0, z: 0 };
    return { x: p.x || 0, y: (p.y === undefined ? 0 : p.y), z: p.z || 0 };
  }

  function cloneColor(c) {
    if (!c) return [1, 1, 1];
    if (Array.isArray(c)) return [c[0] || 0, c[1] || 0, c[2] || 0];
    if (typeof c === "object") return [c.r || 0, c.g || 0, c.b || 0];
    return [1, 1, 1];
  }

  function hexToRgb(hex) {
    if (Array.isArray(hex)) return cloneColor(hex);
    if (typeof hex !== "string") return [1, 1, 1];
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return [1, 1, 1];
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }

  function randRange(a, b) {
    return a + Math.random() * (b - a);
  }

  function makeParticle(pos, vel, color, life, size, gravity, drag, kind) {
    return {
      pos: clonePos(pos),
      vel: { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 },
      color: cloneColor(color),
      baseColor: cloneColor(color),
      life: life,
      maxLife: life,
      age: 0,
      size: size,
      gravity: gravity,
      drag: drag,
      kind: kind || "spark"
    };
  }

  var FX = {
    // Live particle list. Other modules read length only for diagnostics.
    particles: [],
    // Short-lived light flashes (explosions, muzzle). Render reads these
    // to brighten the scene briefly; each entry decays in update().
    flashes: [],
    maxParticles: MAX_PARTICLES,
    // True while at least one particle is alive.
    active: false,

    count: function () {
      return FX.particles.length;
    },

    clear: function () {
      FX.particles.length = 0;
      FX.flashes.length = 0;
      FX.active = false;
    },

    // Generic burst. pos is a Vec3, color is [r,g,b] or "#rrggbb",
    // n is the particle count. Velocities fan out in a sphere with an
    // upward bias so bursts read as fire, spray or debris.
    spawnParticles: function (pos, color, n) {
      var origin = clonePos(pos);
      var rgb = hexToRgb(color);
      var count = Math.max(1, Math.min(200, Math.floor(n || 12)));
      for (var i = 0; i < count; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var angle = Math.random() * Math.PI * 2;
        var up = randRange(0.2, 1.0);
        var speed = randRange(1.5, 7.0);
        var vel = {
          x: Math.cos(angle) * speed * randRange(0.4, 1.0),
          y: up * speed,
          z: Math.sin(angle) * speed * randRange(0.4, 1.0)
        };
        var life = randRange(0.35, 1.1);
        var size = randRange(0.08, 0.28);
        // Slight per-particle color jitter so bursts do not look flat.
        var jitter = randRange(0.85, 1.1);
        var varied = [
          Math.min(1, rgb[0] * jitter),
          Math.min(1, rgb[1] * jitter),
          Math.min(1, rgb[2] * jitter)
        ];
        FX.particles.push(makeParticle(origin, vel, varied, life, size, -6.0, 0.6, "spark"));
      }
      FX.active = FX.particles.length > 0;
      return FX.particles.length;
    },

    // Boat wake: white foam churned up at the stern plus a fan of spray.
    // Called by SB.Water.wake(pos) — this is the single implementation.
    // pos is the stern position at water level.
    wake: function (pos) {
      var origin = clonePos(pos);
      origin.y = 0.15;
      // Foam: slow, wide, long-lived, almost no gravity, heavy drag.
      for (var i = 0; i < 7; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var angle = Math.random() * Math.PI * 2;
        var speed = randRange(0.4, 1.8);
        var vel = {
          x: Math.cos(angle) * speed,
          y: randRange(0.05, 0.5),
          z: Math.sin(angle) * speed
        };
        var life = randRange(0.9, 1.8);
        var size = randRange(0.35, 0.9);
        var shade = randRange(0.82, 1.0);
        FX.particles.push(makeParticle(
          { x: origin.x + randRange(-0.4, 0.4), y: origin.y, z: origin.z + randRange(-0.4, 0.4) },
          vel, [shade, shade, shade * 0.98], life, size, 0.4, 2.2, "foam"
        ));
      }
      // Spray: fast droplets thrown up and out, then falling back.
      for (var j = 0; j < 4; j++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var a2 = Math.random() * Math.PI * 2;
        var s2 = randRange(2.0, 4.5);
        FX.particles.push(makeParticle(
          origin,
          { x: Math.cos(a2) * s2, y: randRange(1.5, 3.5), z: Math.sin(a2) * s2 },
          [0.92, 0.97, 1.0], randRange(0.4, 0.8), randRange(0.06, 0.14), -9.0, 0.3, "spray"
        ));
      }
      FX.active = true;
      return FX.particles.length;
    },

    // Explosion: orange fireball particles, dark smoke rising, and a
    // bright flash that fades over a fraction of a second. Also plays
    // the crash sound when audio is ready.
    explosion: function (pos) {
      var origin = clonePos(pos);
      origin.y = Math.max(0.4, origin.y);
      // Fire: fast orange/yellow core.
      for (var i = 0; i < 42; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var angle = Math.random() * Math.PI * 2;
        var tilt = randRange(-0.4, 1.0);
        var speed = randRange(3.0, 11.0);
        var hot = Math.random();
        var fireColor = hot < 0.45
          ? [1.0, randRange(0.75, 0.95), 0.15]
          : [1.0, randRange(0.35, 0.6), 0.05];
        FX.particles.push(makeParticle(
          { x: origin.x + randRange(-0.3, 0.3), y: origin.y + randRange(0, 0.5), z: origin.z + randRange(-0.3, 0.3) },
          { x: Math.cos(angle) * speed, y: tilt * speed, z: Math.sin(angle) * speed },
          fireColor, randRange(0.5, 1.2), randRange(0.25, 0.7), -2.0, 1.4, "fire"
        ));
      }
      // Smoke: slow, large, dark grey, rising and expanding.
      for (var j = 0; j < 16; j++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var a2 = Math.random() * Math.PI * 2;
        var s2 = randRange(0.5, 2.0);
        var grey = randRange(0.12, 0.3);
        FX.particles.push(makeParticle(
          { x: origin.x + randRange(-0.5, 0.5), y: origin.y + randRange(0.5, 1.5), z: origin.z + randRange(-0.5, 0.5) },
          { x: Math.cos(a2) * s2, y: randRange(1.5, 3.5), z: Math.sin(a2) * s2 },
          [grey, grey, grey], randRange(1.6, 3.0), randRange(0.8, 1.6), 1.2, 0.8, "smoke"
        ));
      }
      // Debris sparks thrown far and fast.
      for (var k = 0; k < 14; k++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var a3 = Math.random() * Math.PI * 2;
        var s3 = randRange(8.0, 16.0);
        FX.particles.push(makeParticle(
          origin,
          { x: Math.cos(a3) * s3, y: randRange(4.0, 10.0), z: Math.sin(a3) * s3 },
          [1.0, 0.8, 0.3], randRange(0.6, 1.4), randRange(0.05, 0.12), -12.0, 0.15, "spark"
        ));
      }
      FX.addFlash(origin, 1.0, 26.0, [1.0, 0.62, 0.18]);
      FX.active = true;
      if (window.SB && SB.Audio && typeof SB.Audio.sfx === "function") {
        try { SB.Audio.sfx("crash"); } catch (e) { /* audio is best-effort */ }
      }
      return FX.particles.length;
    },

    // Muzzle flash: a bright yellow-white flash at the barrel plus a
    // short fan of hot sparks and one small smoke puff.
    muzzle: function (pos) {
      var origin = clonePos(pos);
      for (var i = 0; i < 8; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var angle = Math.random() * Math.PI * 2;
        var speed = randRange(4.0, 9.0);
        FX.particles.push(makeParticle(
          origin,
          { x: Math.cos(angle) * speed, y: randRange(0.5, 2.5), z: Math.sin(angle) * speed },
          [1.0, randRange(0.8, 0.95), 0.35], randRange(0.12, 0.3), randRange(0.06, 0.14), -4.0, 0.4, "spark"
        ));
      }
      // One grey puff drifting up from the barrel.
      if (FX.particles.length < MAX_PARTICLES) {
        FX.particles.push(makeParticle(
          { x: origin.x, y: origin.y + 0.15, z: origin.z },
          { x: randRange(-0.3, 0.3), y: randRange(0.8, 1.4), z: randRange(-0.3, 0.3) },
          [0.55, 0.55, 0.55], randRange(0.7, 1.1), randRange(0.25, 0.4), 0.8, 1.0, "smoke"
        ));
      }
      FX.addFlash(origin, 0.55, 7.0, [1.0, 0.9, 0.45]);
      FX.active = true;
      return FX.particles.length;
    },

    // A short-lived point light. Render can read FX.flashes and add the
    // brightest one to its lighting; the flash decays in update().
    addFlash: function (pos, intensity, radius, color) {
      if (FX.flashes.length >= MAX_FLASHES) FX.flashes.shift();
      FX.flashes.push({
        pos: clonePos(pos),
        intensity: intensity,
        maxIntensity: intensity,
        radius: radius,
        color: cloneColor(color),
        life: 0.22,
        maxLife: 0.22
      });
      return FX.flashes.length;
    },

    // Brightest currently alive flash, or null when there is none.
    brightestFlash: function () {
      var best = null;
      for (var i = 0; i < FX.flashes.length; i++) {
        if (!best || FX.flashes[i].intensity > best.intensity) best = FX.flashes[i];
      }
      return best;
    },

    // Advance every particle by dt seconds: integrate velocity, apply
    // gravity and drag, grow smoke/foam, fade color with age, and drop
    // dead particles. Then draw everything that is still alive.
    update: function (dt) {
      var step = Math.max(0, Math.min(0.1, dt || 0.016));
      var i;
      for (i = FX.particles.length - 1; i >= 0; i--) {
        var p = FX.particles[i];
        p.age += step;
        if (p.age >= p.life) {
          FX.particles.splice(i, 1);
          continue;
        }
        var dragFactor = Math.max(0, 1 - p.drag * step);
        p.vel.x *= dragFactor;
        p.vel.z *= dragFactor;
        p.vel.y = p.vel.y * dragFactor + p.gravity * step;
        p.pos.x += p.vel.x * step;
        p.pos.y += p.vel.y * step;
        p.pos.z += p.vel.z * step;
        // Foam and spray die at the water surface instead of sinking.
        if ((p.kind === "foam" || p.kind === "spray") && p.pos.y < 0.05) {
          p.pos.y = 0.05;
          p.vel.y = Math.abs(p.vel.y) * 0.2;
        }
        // Smoke and foam grow as they age; sparks and fire shrink.
        var t = p.age / p.maxLife;
        if (p.kind === "smoke" || p.kind === "foam") {
          p.size = p.size * (1 + step * 0.9);
        } else {
          p.size = Math.max(0.03, p.size * (1 - step * 0.6));
        }
        // Fade toward the sky/water tone as the particle dies.
        var fade = 1 - t;
        p.color = [
          p.baseColor[0] * fade + 0.05 * t,
          p.baseColor[1] * fade + 0.05 * t,
          p.baseColor[2] * fade + 0.08 * t
        ];
      }
      for (i = FX.flashes.length - 1; i >= 0; i--) {
        var f = FX.flashes[i];
        f.life -= step;
        if (f.life <= 0) {
          FX.flashes.splice(i, 1);
          continue;
        }
        f.intensity = f.maxIntensity * (f.life / f.maxLife);
      }
      FX.active = FX.particles.length > 0 || FX.flashes.length > 0;
      FX.draw();
      return FX.particles.length;
    },

    // Draw all live particles. Prefers the raw WebGL context when it is
    // available (points are cheapest for hundreds of particles); falls
    // back to SB.GL.drawMesh quads when only that path exists.
    draw: function () {
      if (FX.particles.length === 0 && FX.flashes.length === 0) return;
      var gl = null;
      if (window.SB && SB.GL) {
        gl = SB.GL.ctx || null;
      }
      if (gl && typeof gl.drawArrays === "function") {
        FX.drawWithContext(gl);
        return;
      }
      if (window.SB && SB.GL && typeof SB.GL.drawMesh === "function") {
        FX.drawWithMeshes();
      }
    },

    drawWithContext: function (gl) {
      // The GL module owns the shader program and its attribute layout;
      // drawing points here would need that program's attribute locations,
      // which FX does not own. Instead, hand each particle to drawMesh as
      // a small quad so the shader path stays single-sourced.
      FX.drawWithMeshes();
    },

    drawWithMeshes: function () {
      if (!window.SB || !SB.GL || typeof SB.GL.drawMesh !== "function") return;
      for (var i = 0; i < FX.particles.length; i++) {
        var p = FX.particles[i];
        var s = Math.max(0.03, p.size);
        var transform = {
          pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
          rotY: 0,
          scale: { x: s, y: s, z: s }
        };
        try {
          SB.GL.drawMesh(QUAD_MESH, transform, p.color);
        } catch (e) {
          // One bad particle must never break the frame.
          return;
        }
      }
    },

    // Convenience bursts used by gameplay code.
    impact: function (pos, color) {
      return FX.spawnParticles(pos, color || [0.9, 0.85, 0.7], 10);
    },
    smoke: function (pos, n) {
      var origin = clonePos(pos);
      var count = Math.max(1, Math.min(40, Math.floor(n || 8)));
      for (var i = 0; i < count; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var grey = randRange(0.2, 0.4);
        FX.particles.push(makeParticle(
          { x: origin.x + randRange(-0.3, 0.3), y: origin.y + randRange(0, 0.4), z: origin.z + randRange(-0.3, 0.3) },
          { x: randRange(-0.5, 0.5), y: randRange(1.0, 2.2), z: randRange(-0.5, 0.5) },
          [grey, grey, grey], randRange(1.2, 2.4), randRange(0.4, 0.8), 1.0, 0.9, "smoke"
        ));
      }
      FX.active = true;
      return FX.particles.length;
    },
    blood: function (pos) {
      return FX.spawnParticles(pos, [0.55, 0.05, 0.05], 14);
    },
    pickupSparkle: function (pos) {
      return FX.spawnParticles(pos, [1.0, 0.85, 0.25], 18);
    },
    rainSplash: function (pos) {
      var origin = clonePos(pos);
      origin.y = 0.06;
      for (var i = 0; i < 3; i++) {
        if (FX.particles.length >= MAX_PARTICLES) FX.particles.shift();
        var a = Math.random() * Math.PI * 2;
        FX.particles.push(makeParticle(
          origin,
          { x: Math.cos(a) * randRange(0.5, 1.2), y: randRange(0.8, 1.6), z: Math.sin(a) * randRange(0.5, 1.2) },
          [0.85, 0.92, 1.0], randRange(0.25, 0.5), randRange(0.05, 0.1), -8.0, 0.3, "spray"
        ));
      }
      FX.active = true;
      return FX.particles.length;
    }
  };

  SB.FX = FX;
})();

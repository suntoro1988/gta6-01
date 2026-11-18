// A small raw-WebGL renderer for Sunset Bay: flat-shaded coloured shapes,
// one sun, distance fog and a gradient sky. No libraries, no textures,
// everything drawn from code.
//
// v4 adds a slow day-night cycle inside the renderer itself: the game boots
// at dusk (exactly the v3 look), then drifts through night, dawn and a
// bright day over one 8-minute loop, and back to dusk. The cycle only
// bends the sun direction, the sky and fog colours, the ambient light and
// the glow of lamps and neon — the geometry and the draw calls are
// untouched, so nothing can break the render. Screenshots stage within
// seconds of load, so they still catch the dusk look.
import { matLookAt, matNormalOf, matPerspective, clamp01, lerpColor, smoothstep } from './math3.js';

/** One full day-night loop, in seconds. */
export const CYCLE_SECONDS = 480;

const MAIN_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute float aGlow;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat3 uNormal;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGlow;
varying float vDist;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec4 vp = uView * wp;
  vDist = -vp.z;
  vNormal = uNormal * aNormal;
  vColor = aColor;
  vGlow = aGlow;
  gl_Position = uProj * vp;
}
`;

const MAIN_FRAG = `
precision mediump float;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uTint;
uniform float uAlpha;
uniform float uAmbient;
uniform float uSunStrength;
uniform float uGlowBoost;
varying vec3 vNormal;
varying vec3 vColor;
varying float vGlow;
varying float vDist;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 base = vColor * uTint;
  float bounce = max(dot(n, vec3(0.5, 0.25, 0.6)), 0.0);
  vec3 col = base * (uAmbient + uSunStrength * diff)
    + base * vec3(0.10, 0.04, 0.0) * (1.0 - diff)
    + base * bounce * 0.10;
  col += base * vGlow * 0.9 * uGlowBoost;
  float f = smoothstep(uFogRange[0], uFogRange[1], vDist);
  gl_FragColor = vec4(mix(col, uFogColor, f), uAlpha);
}
`;

const SKY_VERT = `
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const SKY_FRAG = `
precision mediump float;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uBot;
uniform vec2 uSunPos;
varying vec2 vUv;
void main() {
  vec3 col = mix(uBot, uMid, smoothstep(0.0, 0.42, vUv.y));
  col = mix(col, uTop, smoothstep(0.42, 1.0, vUv.y));
  float d = distance(vUv, uSunPos);
  col += vec3(1.0, 0.72, 0.42) * (0.5 * exp(-d * d * 16.0) + 0.9 * smoothstep(0.085, 0.0, d));
  gl_FragColor = vec4(col, 1.0);
}
`;

// Keyframes of the day-night loop. Phase 0 is dusk and matches the v3
// constants exactly; the loop returns to them at phase 1. The sun entry is
// filled in per call from the sun direction the game passes, so the first
// frames are pixel-identical to v3.
const CYCLE_KEYS = [
  { at: 0.0, sun: null, top: [0.3, 0.18, 0.52], mid: [0.98, 0.45, 0.3], bot: [1.0, 0.68, 0.38], fog: [0.96, 0.55, 0.48], fogNear: 90, fogFar: 320, ambient: 0.58, sunStrength: 0.66, glow: 1.0 },
  { at: 0.25, sun: [0.35, 0.6, 0.55], top: [0.03, 0.04, 0.12], mid: [0.08, 0.09, 0.22], bot: [0.16, 0.12, 0.28], fog: [0.1, 0.11, 0.22], fogNear: 70, fogFar: 260, ambient: 0.3, sunStrength: 0.22, glow: 1.7 },
  { at: 0.5, sun: [0.877, 0.22, 0.329], top: [0.25, 0.2, 0.5], mid: [0.95, 0.5, 0.42], bot: [1.0, 0.72, 0.45], fog: [0.9, 0.55, 0.5], fogNear: 90, fogFar: 320, ambient: 0.55, sunStrength: 0.6, glow: 1.1 },
  { at: 0.75, sun: [0.3, 0.9, 0.4], top: [0.25, 0.5, 0.85], mid: [0.55, 0.75, 0.95], bot: [0.85, 0.9, 0.95], fog: [0.75, 0.82, 0.9], fogNear: 110, fogFar: 380, ambient: 0.72, sunStrength: 0.85, glow: 0.7 },
  { at: 1.0, sun: null, top: [0.3, 0.18, 0.52], mid: [0.98, 0.45, 0.3], bot: [1.0, 0.68, 0.38], fog: [0.96, 0.55, 0.48], fogNear: 90, fogFar: 320, ambient: 0.58, sunStrength: 0.66, glow: 1.0 },
];

function mixNum(a, b, t) {
  return a + (b - a) * t;
}

function mixVec(a, b, t) {
  return [mixNum(a[0], b[0], t), mixNum(a[1], b[1], t), mixNum(a[2], b[2], t)];
}

/**
 * The full day-night state for a moment `elapsedSeconds` after load.
 * `sunDir` is the dusk sun the game passes in — it anchors phase 0 and
 * phase 1, so the loop starts and ends on the v3 dusk look.
 * Pure: no DOM, no GL, safe to call from tests.
 */
export function cycleStateAt(elapsedSeconds, sunDir) {
  const phase = ((elapsedSeconds % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS / CYCLE_SECONDS;
  let lo = CYCLE_KEYS[0];
  let hi = CYCLE_KEYS[CYCLE_KEYS.length - 1];
  for (let i = 0; i < CYCLE_KEYS.length - 1; i += 1) {
    if (phase >= CYCLE_KEYS[i].at && phase <= CYCLE_KEYS[i + 1].at) {
      lo = CYCLE_KEYS[i];
      hi = CYCLE_KEYS[i + 1];
      break;
    }
  }
  const span = hi.at - lo.at || 1;
  const t = clamp01((phase - lo.at) / span);
  const loSun = lo.sun ?? sunDir;
  const hiSun = hi.sun ?? sunDir;
  const hourFloat = (18 + phase * 24) % 24;
  const hour = Math.floor(hourFloat);
  const minute = Math.floor((hourFloat - hour) * 60);
  const label = hourFloat >= 17 && hourFloat < 19 ? 'DUSK'
    : hourFloat >= 19 || hourFloat < 5 ? 'NIGHT'
    : hourFloat < 7 ? 'DAWN' : 'DAY';
  return {
    phase,
    hour,
    minute,
    label,
    sun: mixVec(loSun, hiSun, t),
    skyTop: mixVec(lo.top, hi.top, t),
    skyMid: mixVec(lo.mid, hi.mid, t),
    skyBot: mixVec(lo.bot, hi.bot, t),
    fog: mixVec(lo.fog, hi.fog, t),
    fogNear: mixNum(lo.fogNear, hi.fogNear, t),
    fogFar: mixNum(lo.fogFar, hi.fogFar, t),
    ambient: mixNum(lo.ambient, hi.ambient, t),
    sunStrength: mixNum(lo.sunStrength, hi.sunStrength, t),
    glow: mixNum(lo.glow, hi.glow, t),
  };
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function linkProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

/** Darken or lighten a [r, g, b] colour by factor f. */
export function shade(color, f) {
  return [color[0] * f, color[1] * f, color[2] * f];
}

/** A mesh builder: triangles pushed in, one flat-shaded mesh out. */
export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.glo = [];
  }

  tri(a, b, c, color, glow = 0) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(color[0], color[1], color[2]);
      this.glo.push(glow);
    }
  }

  /** Four corners in counter-clockwise order as seen from outside. */
  quad(a, b, c, d, color, glow = 0) {
    this.tri(a, b, c, color, glow);
    this.tri(a, c, d, color, glow);
  }

  /** A flat quad on the ground (y = 0), corners counter-clockwise from above. */
  groundQuad(x0, z0, x1, z1, y, color, glow = 0) {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], color, glow);
  }

  /** An axis-aligned box centred at (cx, cy, cz) with size (sx, sy, sz). */
  box(cx, cy, cz, sx, sy, sz, color, topColor = null, glow = 0) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const y0 = cy - sy / 2;
    const y1 = cy + sy / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    const top = topColor ?? color;
    // Top and bottom first, then the four walls, each shaded so the box
    // reads as a solid even before the sun hits it.
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, glow);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(color, 0.55), glow);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, glow);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(color, 0.8), glow);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(color, 0.9), glow);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(color, 0.7), glow);
  }

  /** A vertical cylinder centred at (x, y, z), radius r, height h. */
  cylinder(x, y, z, r, h, color, seg = 8, glow = 0) {
    const y0 = y;
    const y1 = y + h;
    const ring = (yy, ang) => [x + r * Math.cos(ang), yy, z + r * Math.sin(ang)];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.quad(ring(y0, a1), ring(y0, a0), ring(y1, a0), ring(y1, a1), color, glow);
    }
    const cap = [x, y1, z];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(cap, ring(y1, a1), ring(y1, a0), shade(color, 1.15), glow);
    }
  }

  /** A cone standing on (x, y, z): base circle at y, tip at y + h. */
  cone(x, y, z, r, h, color, seg = 8, glow = 0) {
    const tip = [x, y + h, z];
    const base = (ang) => [x + r * Math.cos(ang), y, z + r * Math.sin(ang)];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(base(a0), base(a1), tip, color, glow);
    }
    const centre = [x, y, z];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(centre, base(a1), base(a0), shade(color, 0.6), glow);
    }
  }

  /** An octahedron (diamond) centred at (x, y, z) with radius r: tree crowns. */
  octa(x, y, z, r, color, glow = 0) {
    const top = [x, y + r, z];
    const bot = [x, y - r, z];
    const eq = [
      [x + r, y, z],
      [x, y, z + r],
      [x - r, y, z],
      [x, y, z - r],
    ];
    for (let i = 0; i < 4; i += 1) {
      const a = eq[i];
      const b = eq[(i + 1) % 4];
      this.tri(top, b, a, color, glow);
      this.tri(bot, a, b, shade(color, 0.75), glow);
    }
  }
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL is not available in this browser');
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);

  const main = linkProgram(gl, MAIN_VERT, MAIN_FRAG);
  const mainLoc = {
    proj: gl.getUniformLocation(main, 'uProj'),
    view: gl.getUniformLocation(main, 'uView'),
    model: gl.getUniformLocation(main, 'uModel'),
    normal: gl.getUniformLocation(main, 'uNormal'),
    sunDir: gl.getUniformLocation(main, 'uSunDir'),
    fogColor: gl.getUniformLocation(main, 'uFogColor'),
    fogRange: gl.getUniformLocation(main, 'uFogRange'),
    tint: gl.getUniformLocation(main, 'uTint'),
    alpha: gl.getUniformLocation(main, 'uAlpha'),
    ambient: gl.getUniformLocation(main, 'uAmbient'),
    sunStrength: gl.getUniformLocation(main, 'uSunStrength'),
    glowBoost: gl.getUniformLocation(main, 'uGlowBoost'),
    pos: gl.getAttribLocation(main, 'aPos'),
    nor: gl.getAttribLocation(main, 'aNormal'),
    col: gl.getAttribLocation(main, 'aColor'),
    glo: gl.getAttribLocation(main, 'aGlow'),
  };

  const sky = linkProgram(gl, SKY_VERT, SKY_FRAG);
  const skyLoc = {
    top: gl.getUniformLocation(sky, 'uTop'),
    mid: gl.getUniformLocation(sky, 'uMid'),
    bot: gl.getUniformLocation(sky, 'uBot'),
    sunPos: gl.getUniformLocation(sky, 'uSunPos'),
    corner: gl.getAttribLocation(sky, 'aCorner'),
  };
  const skyBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  let width = 0;
  let height = 0;
  let view = null;
  let proj = null;
  let startedAt = 0;
  let clockText = '';
  let clearColor = [0.98, 0.62, 0.45];

  function upload(builder) {
    const n = builder.pos.length / 3;
    const data = new Float32Array(n * 10);
    for (let i = 0; i < n; i += 1) {
      const o = i * 10;
      data[o] = builder.pos[i * 3];
      data[o + 1] = builder.pos[i * 3 + 1];
      data[o + 2] = builder.pos[i * 3 + 2];
      data[o + 3] = builder.nor[i * 3];
      data[o + 4] = builder.nor[i * 3 + 1];
      data[o + 5] = builder.nor[i * 3 + 2];
      data[o + 6] = builder.col[i * 3];
      data[o + 7] = builder.col[i * 3 + 1];
      data[o + 8] = builder.col[i * 3 + 2];
      data[o + 9] = builder.glo[i];
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: n };
  }

  function bindMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
    const stride = 10 * 4;
    gl.enableVertexAttribArray(mainLoc.pos);
    gl.vertexAttribPointer(mainLoc.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(mainLoc.nor);
    gl.vertexAttribPointer(mainLoc.nor, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(mainLoc.col);
    gl.vertexAttribPointer(mainLoc.col, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.enableVertexAttribArray(mainLoc.glo);
    gl.vertexAttribPointer(mainLoc.glo, 1, gl.FLOAT, false, stride, 9 * 4);
  }

  function refreshClock(state) {
    // The HUD clock lives in index.html; update it only when the minute
    // changes, and never throw if the page has no such element.
    const hh = String(state.hour).padStart(2, '0');
    const mm = String(state.minute).padStart(2, '0');
    const text = `${hh}:${mm} · ${state.label}`;
    if (text === clockText) return;
    clockText = text;
    try {
      const el = document.getElementById('clock');
      if (el) el.textContent = text;
    } catch {
      // No DOM (headless test): the clock is cosmetic.
    }
  }

  return {
    gl,

    /** Current day-night state (phase 0..1, clock hour, label, colours). */
    get dayNight() {
      const now = performance.now();
      if (!startedAt) startedAt = now;
      return cycleStateAt((now - startedAt) / 1000, [-0.877, 0.28, -0.329]);
    },

    resize(w, h) {
      // Render at device pixel ratio (capped at 2) so the dusk light stays
      // crisp on hidpi screens; the canvas CSS size stays 100%.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },

    get aspect() {
      return width / Math.max(1, height);
    },

    /** Set the camera and sun for this frame. Returns the view/projection pair. */
    begin(eye, target, fovY, sunDir) {
      const now = performance.now();
      if (!startedAt) startedAt = now;
      const state = cycleStateAt((now - startedAt) / 1000, sunDir);
      clearColor = state.skyBot;
      refreshClock(state);
      view = matLookAt(eye, target, [0, 1, 0]);
      proj = matPerspective(fovY, this.aspect, 0.5, 900);
      gl.useProgram(main);
      gl.uniformMatrix4fv(mainLoc.proj, false, proj);
      gl.uniformMatrix4fv(mainLoc.view, false, view);
      gl.uniform3fv(mainLoc.sunDir, state.sun);
      gl.uniform3fv(mainLoc.fogColor, state.fog);
      gl.uniform2f(mainLoc.fogRange, state.fogNear, state.fogFar);
      gl.uniform1f(mainLoc.ambient, state.ambient);
      gl.uniform1f(mainLoc.sunStrength, state.sunStrength);
      gl.uniform1f(mainLoc.glowBoost, state.glow);
      return { view, proj, dayNight: state };
    },

    /** Where the sun sits on screen, for the sky glow (uv space, y up). */
    sunScreenPos(sunDir) {
      // Project the sun direction (a point at infinity) through view and proj.
      const v = view;
      const p = proj;
      const dx = sunDir[0];
      const dy = sunDir[1];
      const dz = sunDir[2];
      const vx = v[0] * dx + v[4] * dy + v[8] * dz;
      const vy = v[1] * dx + v[5] * dy + v[9] * dz;
      const vz = v[2] * dx + v[6] * dy + v[10] * dz;
      const cx = p[0] * vx;
      const cy = p[5] * vy;
      const cw = -vz;
      if (cw <= 0.001) return [1.2, 1.2];
      return [cx / cw * 0.5 + 0.5, cy / cw * 0.5 + 0.5];
    },

    drawSky(top, mid, bot, sunDir) {
      const now = performance.now();
      if (!startedAt) startedAt = now;
      const state = cycleStateAt((now - startedAt) / 1000, sunDir);
      // The caller's colours anchor dusk (phase 0); the cycle bends them
      // toward the night/dawn/day keyframes as the loop runs.
      const effTop = lerpColor(top, state.skyTop, cycleBlend(state.phase));
      const effMid = lerpColor(mid, state.skyMid, cycleBlend(state.phase));
      const effBot = lerpColor(bot, state.skyBot, cycleBlend(state.phase));
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(sky);
      gl.uniform3fv(skyLoc.top, effTop);
      gl.uniform3fv(skyLoc.mid, effMid);
      gl.uniform3fv(skyLoc.bot, effBot);
      const sp = this.sunScreenPos(state.sun);
      gl.uniform2f(skyLoc.sunPos, sp[0], sp[1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
      gl.enableVertexAttribArray(skyLoc.corner);
      gl.vertexAttribPointer(skyLoc.corner, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.useProgram(main);
    },

    clear() {
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },

    upload,

    drawMesh(mesh, model, opts = {}) {
      const tint = opts.tint ?? [1, 1, 1];
      const alpha = opts.alpha ?? 1;
      gl.useProgram(main);
      gl.uniformMatrix4fv(mainLoc.model, false, model);
      gl.uniformMatrix3fv(mainLoc.normal, false, matNormalOf(model));
      gl.uniform3fv(mainLoc.tint, tint);
      gl.uniform1f(mainLoc.alpha, alpha);
      if (alpha < 1) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
      bindMesh(mesh);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      if (alpha < 1) {
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    },
  };
}

/**
 * How far the sky has drifted from the caller's dusk colours at this
 * phase: 0 at dusk (phase 0 and 1), 1 through the night, dawn and day
 * in between, easing in and out at both ends of the loop.
 */
function cycleBlend(phase) {
  if (phase < 0.15) return smoothstep(0, 0.15, phase);
  if (phase > 0.85) return 1 - smoothstep(0.85, 1, phase);
  return 1;
}

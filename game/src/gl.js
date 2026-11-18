// A small raw-WebGL renderer, written for this game: flat-shaded boxes and
// shapes with vertex colours, one sun, distance fog and a gradient sunset sky.
// No libraries, no textures, everything from code.
import { matLookAt, matNormalOf, matPerspective } from './math3.js';

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
varying vec3 vNormal;
varying vec3 vColor;
varying float vGlow;
varying float vDist;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 base = vColor * uTint;
  vec3 col = base * (0.52 + 0.72 * diff) + base * vGlow * 0.9;
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

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function program(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
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
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, glow); // top
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], shade(color, 0.55), glow); // bottom
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, glow); // +z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(color, 0.8), glow); // -z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(color, 0.9), glow); // +x
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(color, 0.7), glow); // -x
  }

  /** A vertical cylinder centred at (x, y, z), radius r, height h. */
  cylinder(x, y, z, r, h, color, seg = 8, glow = 0) {
    const y0 = y;
    const y1 = y + h;
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const b0 = [x + r * Math.cos(a0), y0, z + r * Math.sin(a0)];
      const b1 = [x + r * Math.cos(a1), y0, z + r * Math.sin(a1)];
      const t0 = [x + r * Math.cos(a0), y1, z + r * Math.sin(a0)];
      const t1 = [x + r * Math.cos(a1), y1, z + r * Math.sin(a1)];
      this.quad(b1, b0, t0, t1, color, glow);
    }
    // Top cap as a fan around the centre.
    const c = [x, y1, z];
    for (let i = 0; i < seg; i += 1) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri(c, [x + r * Math.cos(a1), y1, z + r * Math.sin(a1)], [x + r * Math.cos(a0), y1, z + r * Math.sin(a0)], shade(color, 1.15), glow);
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

  const main = program(gl, MAIN_VERT, MAIN_FRAG);
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
    pos: gl.getAttribLocation(main, 'aPos'),
    nor: gl.getAttribLocation(main, 'aNormal'),
    col: gl.getAttribLocation(main, 'aColor'),
    glo: gl.getAttribLocation(main, 'aGlow'),
  };

  const sky = program(gl, SKY_VERT, SKY_FRAG);
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

  return {
    gl,
    resize(w, h) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    },
    get aspect() {
      return width / Math.max(1, height);
    },
    /** Set the camera and sun for this frame. Returns the view/projection pair. */
    begin(eye, target, fovY, sunDir) {
      view = matLookAt(eye, target, [0, 1, 0]);
      proj = matPerspective(fovY, this.aspect, 0.5, 900);
      gl.useProgram(main);
      gl.uniformMatrix4fv(mainLoc.proj, false, proj);
      gl.uniformMatrix4fv(mainLoc.view, false, view);
      gl.uniform3fv(mainLoc.sunDir, sunDir);
      gl.uniform3f(mainLoc.fogColor, 0.98, 0.62, 0.45);
      gl.uniform2f(mainLoc.fogRange, 90, 320);
      return { view, proj };
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
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(sky);
      gl.uniform3fv(skyLoc.top, top);
      gl.uniform3fv(skyLoc.mid, mid);
      gl.uniform3fv(skyLoc.bot, bot);
      const sp = this.sunScreenPos(sunDir);
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
      gl.clearColor(0.98, 0.62, 0.45, 1);
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

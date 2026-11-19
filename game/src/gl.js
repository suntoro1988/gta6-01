// gl.js — raw WebGL renderer, no libraries. One shader program:
// per-vertex color, directional sun light, distance fog.
// Mesh format: { verts: Float32Array, idx: Uint16Array, colors: Float32Array }.
// Normals are computed here from the index list (averaged per vertex),
// so mesh builders never need to supply them.
import { mat4Identity, mat4Mul, mat4Persp, mat4LookAt, norm } from './math3.js';

const VS = `
attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aNrm;
uniform mat4 uMVP; uniform mat4 uModel; uniform vec3 uSunDir;
uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uTint;
varying vec3 vCol; varying vec3 vWp;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(uModel) * aNrm);
  float diff = max(dot(n, uSunDir), 0.0);
  vCol = aCol * uTint * (uAmb + uSunCol * diff);
  vWp = wp.xyz;
  gl_Position = uMVP * wp;
}`;
const FS = `
precision mediump float;
varying vec3 vCol; varying vec3 vWp; uniform vec3 uFogCol; uniform vec3 uEye; uniform vec2 uFog;
void main(){
  float d = distance(vWp, uEye);
  float f = clamp((d - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  gl_FragColor = vec4(mix(vCol, uFogCol, f), 1.0);
}`;

// Keyframes: [hour, sky, sunColor, ambient]. 18:00 is golden sunset.
const KEYS = [
  [0, [0.07, 0.06, 0.16], [0.22, 0.25, 0.5], [0.16, 0.16, 0.26]],
  [5, [0.10, 0.08, 0.22], [0.25, 0.28, 0.5], [0.18, 0.18, 0.28]],
  [7, [0.95, 0.62, 0.45], [1.0, 0.62, 0.35], [0.38, 0.32, 0.3]],
  [12, [0.55, 0.8, 0.95], [1.0, 0.95, 0.85], [0.45, 0.45, 0.45]],
  [17, [0.85, 0.65, 0.55], [1.0, 0.8, 0.55], [0.42, 0.4, 0.38]],
  [18, [1.0, 0.55, 0.25], [1.0, 0.55, 0.2], [0.35, 0.28, 0.28]],
  [19.5, [0.35, 0.2, 0.45], [0.7, 0.4, 0.5], [0.25, 0.22, 0.32]],
  [21, [0.1, 0.08, 0.22], [0.25, 0.28, 0.5], [0.17, 0.17, 0.27]],
  [24, [0.07, 0.06, 0.16], [0.22, 0.25, 0.5], [0.16, 0.16, 0.26]],
];
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true });
  if (!gl) throw new Error('WebGL unavailable');
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);
  const loc = (n) => gl.getUniformLocation(prog, n);
  const U = {
    mvp: loc('uMVP'), model: loc('uModel'), sunDir: loc('uSunDir'),
    sunCol: loc('uSunCol'), amb: loc('uAmb'), tint: loc('uTint'),
    eye: loc('uEye'), fogCol: loc('uFogCol'), fog: loc('uFog'),
  };
  const A = {
    pos: gl.getAttribLocation(prog, 'aPos'),
    col: gl.getAttribLocation(prog, 'aCol'),
    nrm: gl.getAttribLocation(prog, 'aNrm'),
  };
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE); // mesh winding is not guaranteed
  const cache = new WeakMap();
  let proj = mat4Persp(1.05, 1, 0.1, 500);
  let viewProj = mat4Identity();
  let eye = [0, 5, 10];
  let sky = [0.55, 0.8, 0.95];
  gl.uniform2fv(U.fog, [70, 420]);
  gl.uniform3fv(U.tint, [1, 1, 1]);

  function buffersFor(mesh) {
    let b = cache.get(mesh);
    if (b) return b;
    const n = mesh.verts.length;
    const nrm = new Float32Array(n);
    const idx = mesh.idx;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, c = idx[t + 1] * 3, d = idx[t + 2] * 3;
      const ux = mesh.verts[c] - mesh.verts[a], uy = mesh.verts[c + 1] - mesh.verts[a + 1], uz = mesh.verts[c + 2] - mesh.verts[a + 2];
      const vx = mesh.verts[d] - mesh.verts[a], vy = mesh.verts[d + 1] - mesh.verts[a + 1], vz = mesh.verts[d + 2] - mesh.verts[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, c, d]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz; }
    }
    for (let i = 0; i < n; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    const mk = (data, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buf;
    };
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.STATIC_DRAW);
    b = { pos: mk(mesh.verts, 3), col: mk(mesh.colors, 3), nrm: mk(nrm, 3), ib, count: mesh.idx.length };
    cache.set(mesh, b);
    return b;
  }
  function bind(buf, attr, size) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, size, gl.FLOAT, false, 0, 0);
  }

  return {
    draw(mesh, matrix, color) {
      const b = buffersFor(mesh);
      gl.uniformMatrix4fv(U.model, false, matrix);
      // uMVP is the view-projection only: the vertex shader already applies
      // uModel to get the world position, so including the model here would
      // transform every mesh twice (objects rendered at 2x their position).
      gl.uniformMatrix4fv(U.mvp, false, viewProj);
      gl.uniform3fv(U.tint, color || [1, 1, 1]);
      bind(b.pos, A.pos, 3); bind(b.col, A.col, 3); bind(b.nrm, A.nrm, 3);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ib);
      gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_SHORT, 0);
    },
    setCamera(e, target, up) {
      eye = e;
      viewProj = mat4Mul(proj, mat4LookAt(e, target, up || [0, 1, 0]));
      gl.uniform3fv(U.eye, eye);
    },
    setSun(t) {
      const h = ((t % 24) + 24) % 24;
      let k0 = KEYS[0], k1 = KEYS[KEYS.length - 1];
      for (let i = 0; i + 1 < KEYS.length; i++) {
        if (h >= KEYS[i][0] && h <= KEYS[i + 1][0]) { k0 = KEYS[i]; k1 = KEYS[i + 1]; break; }
      }
      const f = (h - k0[0]) / Math.max(k1[0] - k0[0], 0.001);
      sky = lerp3(k0[1], k1[1], f);
      const sunCol = lerp3(k0[2], k1[2], f);
      const amb = lerp3(k0[3], k1[3], f);
      const day = h >= 6 && h <= 18;
      const a = ((h - 6) / 12) * Math.PI;
      const dir = day
        ? norm([Math.cos(a), Math.max(Math.sin(a), 0.08), 0.35])
        : norm([-0.3, 0.55, 0.2]);
      gl.uniform3fv(U.sunDir, dir);
      gl.uniform3fv(U.sunCol, sunCol);
      gl.uniform3fv(U.amb, amb);
      gl.uniform3fv(U.fogCol, sky);
    },
    clear() {
      gl.clearColor(sky[0], sky[1], sky[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    },
    resize(w, h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
      proj = mat4Persp(1.05, w / Math.max(h, 1), 0.1, 500);
    },
  };
}

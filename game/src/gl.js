// gl.js — Sunset Bay v11 (Builder B: game core + rendering)
// Wrapper WebGL2: shader, mesh, instancing, tekstur prosedural, skybox
// gradien golden hour, satu shadow map directional, blob shadow,
// genangan reflektif murah, hujan, dan awan billboard.
//
// TANPA library eksternal, TANPA request eksternal: semua tekstur dibuat
// prosedural dari canvas 2D. Target: WebGL2 (fallback: null + pesan).

import * as M from './math3.js';

export const VERSION = '11.0.0';
export const SHADOW_SIZE = 1024;

// ------------------------------------------------------------- GLSL ------
const VS_LIT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uLightSpace;
out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vColor;
out vec2 vUv;
out vec4 vLightSpacePos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vUv = aUv;
  vLightSpacePos = uLightSpace * wp;
  gl_Position = uProj * uView * wp;
}`;

const VS_LIT_INSTANCED = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;
layout(location = 4) in vec3 aOffset;
layout(location = 5) in vec2 aScaleRot;
layout(location = 6) in vec3 aInstColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
uniform mat4 uLightSpace;
out vec3 vNormal;
out vec3 vWorldPos;
out vec3 vColor;
out vec2 vUv;
out vec4 vLightSpacePos;
void main() {
  float c = cos(aScaleRot.y);
  float s = sin(aScaleRot.y);
  vec3 p = aPos * aScaleRot.x;
  vec3 rp = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec3 rn = vec3(c * aNormal.x + s * aNormal.z, aNormal.y, -s * aNormal.x + c * aNormal.z);
  vec4 wp = uModel * vec4(rp + aOffset, 1.0);
  vWorldPos = wp.xyz;
  vNormal = mat3(uModel) * rn;
  vColor = aColor * aInstColor;
  vUv = aUv;
  vLightSpacePos = uLightSpace * wp;
  gl_Position = uProj * uView * wp;
}`;

// Fragment shader utama: directional sun + hemisphere + fog +
// specular (naik saat basah) + emissive (neon / jendela malam) +
// satu shadow map directional (PCF 3x3).
const FS_LIT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
in vec3 vColor;
in vec2 vUv;
in vec4 vLightSpacePos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uCamPos;
uniform vec3 uEmissive;
uniform float uEmissiveStrength;
uniform float uSpecular;
uniform float uShininess;
uniform float uWetness;
uniform float uAlpha;
uniform float uUseShadow;
uniform sampler2D uShadowMap;
uniform float uUseTex;
uniform sampler2D uTex;
out vec4 fragColor;

float sampleShadow(vec4 lightPos) {
  vec3 proj = lightPos.xyz / lightPos.w;
  proj = proj * 0.5 + 0.5;
  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 0.0;
  float bias = 0.0018;
  vec2 texel = 1.0 / vec2(textureSize(uShadowMap, 0));
  float shadow = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float d = texture(uShadowMap, proj.xy + vec2(float(x), float(y)) * texel).r;
      shadow += (proj.z - bias > d) ? 1.0 : 0.0;
    }
  }
  return shadow / 9.0;
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 base = vColor;
  if (uUseTex > 0.5) base *= texture(uTex, vUv).rgb;

  float hemi = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi) * 0.7;

  vec3 L = normalize(-uSunDir);
  float diff = max(dot(N, L), 0.0);
  float shadow = 0.0;
  if (uUseShadow > 0.5) shadow = sampleShadow(vLightSpacePos);
  float lit = 1.0 - shadow * 0.6;
  vec3 light = ambient + uSunColor * (uSunIntensity * diff * lit);

  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), uShininess) * uSpecular * (1.0 + uWetness * 2.5) * lit;
  vec3 col = base * light + uSunColor * spec;

  col += uEmissive * uEmissiveStrength;
  col *= (1.0 - uWetness * 0.10);

  float dist = distance(uCamPos, vWorldPos);
  float f = smoothstep(uFogRange.x, uFogRange.y, dist);
  col = mix(col, uFogColor, f);

  fragColor = vec4(col, uAlpha);
}`;

const VS_DEPTH = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightProj;
uniform mat4 uLightView;
uniform mat4 uModel;
void main() {
  gl_Position = uLightProj * uLightView * uModel * vec4(aPos, 1.0);
}`;

const VS_DEPTH_INSTANCED = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 4) in vec3 aOffset;
layout(location = 5) in vec2 aScaleRot;
uniform mat4 uLightProj;
uniform mat4 uLightView;
uniform mat4 uModel;
void main() {
  float c = cos(aScaleRot.y);
  float s = sin(aScaleRot.y);
  vec3 p = aPos * aScaleRot.x;
  vec3 rp = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  gl_Position = uLightProj * uLightView * uModel * vec4(rp + aOffset, 1.0);
}`;

const FS_DEPTH = `#version 300 es
precision highp float;
void main() {}`;

const VS_FLAT = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorldPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vColor = aColor;
  vUv = aUv;
  gl_Position = uProj * uView * wp;
}`;

const VS_FLAT_INSTANCED = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 2) in vec3 aColor;
layout(location = 3) in vec2 aUv;
layout(location = 4) in vec3 aOffset;
layout(location = 5) in vec2 aScaleRot;
layout(location = 6) in vec3 aInstColor;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uModel;
out vec3 vColor;
out vec2 vUv;
out vec3 vWorldPos;
void main() {
  float c = cos(aScaleRot.y);
  float s = sin(aScaleRot.y);
  vec3 p = aPos * aScaleRot.x;
  vec3 rp = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec4 wp = uModel * vec4(rp + aOffset, 1.0);
  vWorldPos = wp.xyz;
  vColor = aColor * aInstColor;
  vUv = aUv;
  gl_Position = uProj * uView * wp;
}`;

const FS_FLAT = `#version 300 es
precision highp float;
in vec3 vColor;
in vec2 vUv;
in vec3 vWorldPos;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uCamPos;
uniform float uUseFog;
uniform float uAlpha;
uniform float uUseTex;
uniform sampler2D uTex;
uniform vec3 uTint;
out vec4 fragColor;
void main() {
  vec3 col = vColor * uTint;
  if (uUseTex > 0.5) {
    vec4 t = texture(uTex, vUv);
    col *= t.rgb;
    fragColor = vec4(col, t.a * uAlpha);
  } else {
    fragColor = vec4(col, uAlpha);
  }
  if (uUseFog > 0.5) {
    float dist = distance(uCamPos, vWorldPos);
    float f = smoothstep(uFogRange.x, uFogRange.y, dist);
    fragColor.rgb = mix(fragColor.rgb, uFogColor, f);
  }
}`;

const VS_SKY = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform mat4 uInvViewProj;
out vec3 vDir;
void main() {
  vec4 d = uInvViewProj * vec4(aPos, 0.0, 1.0);
  vDir = d.xyz / d.w;
  gl_Position = vec4(aPos, 1.0, 1.0);
}`;

const FS_SKY = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uTime;
out vec4 fragColor;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.12, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
  col = mix(col, uZenith, smoothstep(0.22, 0.8, h));
  col = mix(uHorizon * 0.5, col, smoothstep(-0.10, 0.02, d.y));

  float s = max(dot(d, normalize(-uSunDir)), 0.0);
  col += uSunColor * (pow(s, 600.0) * 2.0 + pow(s, 32.0) * 0.55 + pow(s, 6.0) * 0.16);

  if (uNight > 0.02 && d.y > 0.04) {
    vec3 cell = floor(d * 160.0);
    float star = hash13(cell);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + star * 40.0);
    float m = step(0.997, star) * twinkle;
    col += vec3(0.9, 0.95, 1.0) * m * uNight * smoothstep(0.04, 0.3, d.y);
  }

  fragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------- helpers ------
function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile gagal: ' + log);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link gagal: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

function getUniforms(gl, prog, names) {
  const out = {};
  for (const n of names) out[n] = gl.getUniformLocation(prog, n);
  return out;
}

function toRGB(c, fallback = [1, 1, 1]) {
  if (!c) return fallback;
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  if (typeof c.r === 'number') return [c.r, c.g, c.b];
  return fallback;
}

// hash deterministik untuk posisi hujan / awan (tanpa alokasi per frame)
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// ------------------------------------------------- geometri prosedural ----
// Semua fungsi geo* mengembalikan data mentah {positions, normals, colors,
// uvs, indices} yang siap ke createMesh(). Warna per-vertex (pastel).

export function geoBox(w, h, d, color, faceColors) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const c = faceColors || [color, color, color, color, color, color];
  const faces = [
    { n: [0, 0, 1], v: [[-hw, -hh, hd], [hw, -hh, hd], [hw, hh, hd], [-hw, hh, hd]] },
    { n: [0, 0, -1], v: [[hw, -hh, -hd], [-hw, -hh, -hd], [-hw, hh, -hd], [hw, hh, -hd]] },
    { n: [1, 0, 0], v: [[hw, -hh, hd], [hw, -hh, -hd], [hw, hh, -hd], [hw, hh, hd]] },
    { n: [-1, 0, 0], v: [[-hw, -hh, -hd], [-hw, -hh, hd], [-hw, hh, hd], [-hw, hh, -hd]] },
    { n: [0, 1, 0], v: [[-hw, hh, hd], [hw, hh, hd], [hw, hh, -hd], [-hw, hh, -hd]] },
    { n: [0, -1, 0], v: [[-hw, -hh, -hd], [hw, -hh, -hd], [hw, -hh, hd], [-hw, -hh, hd]] },
  ];
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  faces.forEach((f, fi) => {
    const base = positions.length / 3;
    const col = toRGB(c[fi]);
    f.v.forEach((p, k) => {
      positions.push(p[0], p[1], p[2]);
      normals.push(f.n[0], f.n[1], f.n[2]);
      colors.push(col[0], col[1], col[2]);
      uvs.push(k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

// Bidang datar di XZ (normal +Y). origin di tengah.
export function geoPlane(w, d, color) {
  const hw = w / 2, hd = d / 2;
  const col = toRGB(color);
  return {
    positions: new Float32Array([-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    colors: new Float32Array([...col, ...col, ...col, ...col]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    // Winding HARUS normal +Y: [0,1,2] memberi normal -Y sehingga bidang
    // ter-cull oleh CULL_FACE bila dilihat dari atas (tanah/jalan/laut
    // hilang total — bug integrasi v11, ketahuan dari QA piksel).
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
  };
}

// Quad vertikal di XY menghadap +Z (untuk awan, billboard, hujan).
export function geoQuad(w, h, color) {
  const hw = w / 2, hh = h / 2;
  const col = toRGB(color);
  return {
    positions: new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    colors: new Float32Array([...col, ...col, ...col, ...col]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

// Silinder low-poly (tiang lampu, batang palma). segments = 8 default.
export function geoCylinder(radiusTop, radiusBottom, height, color, segments = 8) {
  const col = toRGB(color);
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  const hh = height / 2;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    positions.push(ca * radiusTop, hh, sa * radiusTop, ca * radiusBottom, -hh, sa * radiusBottom);
    normals.push(ca, 0, sa, ca, 0, sa);
    colors.push(...col, ...col);
    uvs.push(i / segments, 1, i / segments, 0);
  }
  for (let i = 0; i < segments; i++) {
    const b = i * 2;
    indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  // tutup atas
  const topBase = positions.length / 3;
  positions.push(0, hh, 0);
  normals.push(0, 1, 0);
  colors.push(...col);
  uvs.push(0.5, 0.5);
  for (let i = 0; i < segments; i++) {
    indices.push(topBase, i * 2 + 2, i * 2);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors), uvs: new Float32Array(uvs), indices: new Uint16Array(indices) };
}

// ----------------------------------------------------------- renderer ----
export function createRenderer(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) {
    console.error('[gl] WebGL2 tidak tersedia di browser ini.');
    if (opts.onError) opts.onError('WebGL2 tidak tersedia. Coba browser modern (Chrome/Edge/Firefox terbaru).');
    return null;
  }

  const extAniso = gl.getExtension('EXT_texture_filter_anisotropic');

  // --- program ---
  const progLit = createProgram(gl, VS_LIT, FS_LIT);
  const progLitI = createProgram(gl, VS_LIT_INSTANCED, FS_LIT);
  const progDepth = createProgram(gl, VS_DEPTH, FS_DEPTH);
  const progDepthI = createProgram(gl, VS_DEPTH_INSTANCED, FS_DEPTH);
  const progFlat = createProgram(gl, VS_FLAT, FS_FLAT);
  const progFlatI = createProgram(gl, VS_FLAT_INSTANCED, FS_FLAT);
  const progSky = createProgram(gl, VS_SKY, FS_SKY);

  const U_LIT = getUniforms(gl, progLit, ['uProj', 'uView', 'uModel', 'uLightSpace', 'uSunDir', 'uSunColor', 'uSunIntensity', 'uSkyColor', 'uGroundColor', 'uFogColor', 'uFogRange', 'uCamPos', 'uEmissive', 'uEmissiveStrength', 'uSpecular', 'uShininess', 'uWetness', 'uAlpha', 'uUseShadow', 'uShadowMap', 'uUseTex', 'uTex']);
  const U_LITI = getUniforms(gl, progLitI, Object.keys(U_LIT));
  const U_DEPTH = getUniforms(gl, progDepth, ['uLightProj', 'uLightView', 'uModel']);
  const U_DEPTHI = getUniforms(gl, progDepthI, ['uLightProj', 'uLightView', 'uModel']);
  const U_FLAT = getUniforms(gl, progFlat, ['uProj', 'uView', 'uModel', 'uFogColor', 'uFogRange', 'uCamPos', 'uUseFog', 'uAlpha', 'uUseTex', 'uTex', 'uTint']);
  const U_FLATI = getUniforms(gl, progFlatI, Object.keys(U_FLAT));
  const U_SKY = getUniforms(gl, progSky, ['uInvViewProj', 'uHorizon', 'uMid', 'uZenith', 'uSunDir', 'uSunColor', 'uNight', 'uTime']);

  // --- shadow map: satu directional saja ---
  const shadowTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const shadowFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // --- tekstur prosedural (canvas 2D, tanpa request eksternal) ---
  function canvasTexture(w, h, drawFn) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    drawFn(cv.getContext('2d'), w, h);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    return tex;
  }

  const cloudTex = canvasTexture(128, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const blobs = [[64, 70, 46], [36, 78, 30], [94, 78, 32], [58, 52, 30], [84, 58, 24]];
    for (const [x, y, r] of blobs) {
      const g = c.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
  });

  const blobTex = canvasTexture(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });

  const streakTex = canvasTexture(16, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(180,200,255,0)');
    g.addColorStop(0.5, 'rgba(180,200,255,0.9)');
    g.addColorStop(1, 'rgba(180,200,255,0)');
    c.fillStyle = g;
    c.fillRect(6, 0, 4, h);
  });

  // --- mesh util ---
  function createBuffer(data, target, usage) {
    const buf = gl.createBuffer();
    gl.bindBuffer(target, buf);
    gl.bufferData(target, data, usage || gl.STATIC_DRAW);
    return buf;
  }

  function setupMeshAttributes(vao, mesh) {
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers.position);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers.normal);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers.color);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers.uv);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    if (mesh.indexed) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    gl.bindVertexArray(null);
  }

  function createMesh(data) {
    const vertexCount = data.positions.length / 3;
    const mesh = {
      vertexCount,
      indexed: !!data.indices,
      indexCount: data.indices ? data.indices.length : 0,
      buffers: {
        position: createBuffer(data.positions, gl.ARRAY_BUFFER),
        normal: createBuffer(data.normals || new Float32Array(vertexCount * 3), gl.ARRAY_BUFFER),
        color: createBuffer(data.colors || new Float32Array(vertexCount * 3).fill(1), gl.ARRAY_BUFFER),
        uv: createBuffer(data.uvs || new Float32Array(vertexCount * 2), gl.ARRAY_BUFFER),
      },
      indexBuffer: null,
      vao: gl.createVertexArray(),
    };
    if (data.indices) {
      const idx = data.indices instanceof Uint32Array || vertexCount > 65535
        ? new Uint32Array(data.indices) : new Uint16Array(data.indices);
      mesh.indexBuffer = createBuffer(idx, gl.ELEMENT_ARRAY_BUFFER);
      mesh.indexType = idx instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    setupMeshAttributes(mesh.vao, mesh);
    return mesh;
  }

  function createInstancedMesh(baseMesh, maxCount) {
    const inst = {
      base: baseMesh,
      maxCount,
      count: 0,
      offsets: new Float32Array(maxCount * 3),
      scaleRot: new Float32Array(maxCount * 2),
      colors: new Float32Array(maxCount * 3),
      vao: gl.createVertexArray(),
      buffers: {},
    };
    inst.buffers.offset = createBuffer(inst.offsets, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    inst.buffers.scaleRot = createBuffer(inst.scaleRot, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    inst.buffers.color = createBuffer(inst.colors, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(inst.vao);
    // atribut dasar (lokasi 0..3) — pinjam buffer mesh dasar
    gl.bindBuffer(gl.ARRAY_BUFFER, baseMesh.buffers.position);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, baseMesh.buffers.normal);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, baseMesh.buffers.color);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, baseMesh.buffers.uv);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    if (baseMesh.indexed) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseMesh.indexBuffer);
    // atribut instance (lokasi 4..6) dengan divisor 1
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.offset);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.scaleRot);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(5, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.color);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
    return inst;
  }

  // list: [{offset:{x,y,z}, scale, rotY, color:[r,g,b]}]
  function setInstances(inst, list) {
    const n = Math.min(list.length, inst.maxCount);
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const o = it.offset || it.pos || { x: 0, y: 0, z: 0 };
      inst.offsets[i * 3] = o.x; inst.offsets[i * 3 + 1] = o.y; inst.offsets[i * 3 + 2] = o.z;
      inst.scaleRot[i * 2] = it.scale !== undefined ? it.scale : 1;
      inst.scaleRot[i * 2 + 1] = it.rotY || it.yaw || 0;
      const col = toRGB(it.color, [1, 1, 1]);
      inst.colors[i * 3] = col[0]; inst.colors[i * 3 + 1] = col[1]; inst.colors[i * 3 + 2] = col[2];
    }
    inst.count = n;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.offset);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.offsets.subarray(0, n * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.scaleRot);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.scaleRot.subarray(0, n * 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.buffers.color);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.colors.subarray(0, n * 3));
    return n;
  }

  // --- state renderer ---
  const state = {
    view: M.m4Identity(),
    proj: M.m4Identity(),
    camPos: { x: 0, y: 5, z: 10 },
    env: null,
    lightSpace: M.m4Identity(),
    lightView: M.m4Identity(),
    lightProj: M.m4Identity(),
    shadowPass: false,
    shadowsEnabled: true,
    width: 0,
    height: 0,
  };

  const IDENTITY = M.m4Identity();
  const WHITE = [1, 1, 1];

  function applyLitUniforms(U, model, material, useShadow) {
    const mat = material || {};
    gl.uniformMatrix4fv(U.uProj, false, state.proj);
    gl.uniformMatrix4fv(U.uView, false, state.view);
    gl.uniformMatrix4fv(U.uModel, false, model || IDENTITY);
    gl.uniformMatrix4fv(U.uLightSpace, false, state.lightSpace);
    const env = state.env || {};
    gl.uniform3fv(U.uSunDir, toRGB(env.sunDir || [0.3, -0.8, 0.2]));
    gl.uniform3fv(U.uSunColor, toRGB(env.sunColor || [1, 0.6, 0.35]));
    gl.uniform1f(U.uSunIntensity, env.sunIntensity !== undefined ? env.sunIntensity : 1.1);
    gl.uniform3fv(U.uSkyColor, toRGB(env.skyColor || [0.5, 0.4, 0.7]));
    gl.uniform3fv(U.uGroundColor, toRGB(env.groundColor || [0.85, 0.5, 0.3]));
    gl.uniform3fv(U.uFogColor, toRGB(env.fogColor || [0.95, 0.55, 0.45]));
    gl.uniform2f(U.uFogRange, env.fogNear !== undefined ? env.fogNear : 120, env.fogFar !== undefined ? env.fogFar : 520);
    gl.uniform3f(U.uCamPos, state.camPos.x, state.camPos.y, state.camPos.z);
    gl.uniform3fv(U.uEmissive, toRGB(mat.emissive, [0, 0, 0]));
    gl.uniform1f(U.uEmissiveStrength, mat.emissiveStrength !== undefined ? mat.emissiveStrength : 0);
    gl.uniform1f(U.uSpecular, mat.specular !== undefined ? mat.specular : 0.25);
    gl.uniform1f(U.uShininess, mat.shininess !== undefined ? mat.shininess : 24);
    gl.uniform1f(U.uWetness, env.wetness !== undefined ? env.wetness : 0);
    gl.uniform1f(U.uAlpha, mat.alpha !== undefined ? mat.alpha : 1);
    gl.uniform1f(U.uUseShadow, useShadow && state.shadowsEnabled ? 1 : 0);
    if (mat.texture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mat.texture);
      gl.uniform1i(U.uTex, 1);
      gl.uniform1f(U.uUseTex, 1);
    } else {
      gl.uniform1f(U.uUseTex, 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.uniform1i(U.uShadowMap, 0);
  }

  function applyFlatUniforms(U, model, material) {
    const mat = material || {};
    const env = state.env || {};
    gl.uniformMatrix4fv(U.uProj, false, state.proj);
    gl.uniformMatrix4fv(U.uView, false, state.view);
    gl.uniformMatrix4fv(U.uModel, false, model || IDENTITY);
    gl.uniform3fv(U.uFogColor, toRGB(env.fogColor || [0.95, 0.55, 0.45]));
    gl.uniform2f(U.uFogRange, env.fogNear !== undefined ? env.fogNear : 120, env.fogFar !== undefined ? env.fogFar : 520);
    gl.uniform3f(U.uCamPos, state.camPos.x, state.camPos.y, state.camPos.z);
    gl.uniform1f(U.uUseFog, mat.useFog ? 1 : 0);
    gl.uniform1f(U.uAlpha, mat.alpha !== undefined ? mat.alpha : 1);
    gl.uniform3fv(U.uTint, toRGB(mat.tint, WHITE));
    if (mat.texture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mat.texture);
      gl.uniform1i(U.uTex, 1);
      gl.uniform1f(U.uUseTex, 1);
    } else {
      gl.uniform1f(U.uUseTex, 0);
    }
  }

  function setupBlend(material) {
    const mat = material || {};
    const blend = mat.blend || (mat.alpha !== undefined && mat.alpha < 1);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.depthMask(mat.depthWrite !== undefined ? mat.depthWrite : true);
  }

  function drawIndexed(mesh, count) {
    if (mesh.indexed) {
      if (count !== undefined) gl.drawElementsInstanced(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0, count);
      else gl.drawElements(gl.TRIANGLES, mesh.indexCount, mesh.indexType, 0);
    } else {
      if (count !== undefined) gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.vertexCount, count);
      else gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
    }
  }

  function drawMesh(mesh, model, material) {
    if (!mesh) return;
    const mat = material || {};
    if (state.shadowPass) {
      if (mat.noShadow) return; // transparan / emissive-only tidak melempar bayangan
      gl.useProgram(progDepth);
      gl.uniformMatrix4fv(U_DEPTH.uLightProj, false, state.lightProj);
      gl.uniformMatrix4fv(U_DEPTH.uLightView, false, state.lightView);
      gl.uniformMatrix4fv(U_DEPTH.uModel, false, model || IDENTITY);
      gl.bindVertexArray(mesh.vao);
      drawIndexed(mesh);
      gl.bindVertexArray(null);
      return;
    }
    setupBlend(mat);
    gl.useProgram(progLit);
    applyLitUniforms(U_LIT, model, mat, mat.castShadow !== false);
    gl.bindVertexArray(mesh.vao);
    drawIndexed(mesh);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function drawInstanced(inst, count, model, material) {
    if (!inst || inst.count === 0) return;
    const n = Math.min(count !== undefined ? count : inst.count, inst.count);
    const mat = material || {};
    if (state.shadowPass) {
      if (mat.noShadow) return;
      gl.useProgram(progDepthI);
      gl.uniformMatrix4fv(U_DEPTHI.uLightProj, false, state.lightProj);
      gl.uniformMatrix4fv(U_DEPTHI.uLightView, false, state.lightView);
      gl.uniformMatrix4fv(U_DEPTHI.uModel, false, model || IDENTITY);
      gl.bindVertexArray(inst.vao);
      drawIndexed(inst.base, n);
      gl.bindVertexArray(null);
      return;
    }
    setupBlend(mat);
    gl.useProgram(progLitI);
    applyLitUniforms(U_LITI, model, mat, mat.castShadow !== false);
    gl.bindVertexArray(inst.vao);
    drawIndexed(inst.base, n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function drawFlat(mesh, model, material) {
    if (!mesh || state.shadowPass) return; // flat = transparan/dekor, tidak ikut shadow pass
    const mat = material || {};
    setupBlend(mat);
    gl.useProgram(progFlat);
    applyFlatUniforms(U_FLAT, model, mat);
    gl.bindVertexArray(mesh.vao);
    drawIndexed(mesh);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function drawFlatInstanced(inst, count, model, material) {
    if (!inst || inst.count === 0 || state.shadowPass) return;
    const n = Math.min(count !== undefined ? count : inst.count, inst.count);
    const mat = material || {};
    setupBlend(mat);
    gl.useProgram(progFlatI);
    applyFlatUniforms(U_FLATI, model, mat);
    gl.bindVertexArray(inst.vao);
    drawIndexed(inst.base, n);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  // --- skybox gradien fullscreen ---
  const skyVao = gl.createVertexArray();
  const skyVbo = createBuffer(new Float32Array([-1, -1, 3, -1, -1, 3]), gl.ARRAY_BUFFER);
  gl.bindVertexArray(skyVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyVbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  function drawSky(env) {
    const vp = M.m4Multiply(state.proj, state.view);
    const inv = M.m4Invert(vp) || IDENTITY;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(progSky);
    gl.uniformMatrix4fv(U_SKY.uInvViewProj, false, inv);
    gl.uniform3fv(U_SKY.uHorizon, toRGB(env.horizon || [1, 0.55, 0.3]));
    gl.uniform3fv(U_SKY.uMid, toRGB(env.mid || [0.75, 0.4, 0.55]));
    gl.uniform3fv(U_SKY.uZenith, toRGB(env.zenith || [0.35, 0.25, 0.6]));
    gl.uniform3fv(U_SKY.uSunDir, toRGB(env.sunDir || [0.3, -0.8, 0.2]));
    gl.uniform3fv(U_SKY.uSunColor, toRGB(env.sunColor || [1, 0.6, 0.35]));
    gl.uniform1f(U_SKY.uNight, env.night !== undefined ? env.night : 0);
    gl.uniform1f(U_SKY.uTime, env.time !== undefined ? env.time : 0);
    gl.bindVertexArray(skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  // --- mesh sekali pakai untuk efek ---
  const quadMesh = createMesh(geoQuad(1, 1, [1, 1, 1]));
  const rainQuad = createMesh(geoQuad(0.08, 1.4, [1, 1, 1]));
  const rainInst = createInstancedMesh(rainQuad, 600);

  // Awan: 14 gumpalan, posisi tetap (hash), melayang perlahan.
  const CLOUDS = [];
  for (let i = 0; i < 14; i++) {
    CLOUDS.push({
      x: (hash1(i * 3 + 1) - 0.5) * 1100,
      y: 70 + hash1(i * 7 + 2) * 55,
      z: (hash1(i * 5 + 3) - 0.5) * 1100,
      size: 45 + hash1(i * 11 + 4) * 55,
      speed: 0.6 + hash1(i * 13 + 5) * 1.1,
      tint: 0.75 + hash1(i * 17 + 6) * 0.25,
    });
  }

  function drawClouds(env, time) {
    if (state.shadowPass) return;
    const night = env.night || 0;
    const tintBase = [
      M.lerp(1, 0.25, night),
      M.lerp(0.82, 0.28, night),
      M.lerp(0.85, 0.45, night),
    ];
    for (const c of CLOUDS) {
      // melayang ke +X, wrap di sekitar kamera
      let x = c.x + time * c.speed;
      const rel = x - state.camPos.x;
      x = state.camPos.x + ((((rel + 550) % 1100) + 1100) % 1100 - 550);
      const dx = state.camPos.x - x;
      const dz = state.camPos.z - c.z;
      const yaw = Math.atan2(dx, dz);
      const tint = [tintBase[0] * c.tint, tintBase[1] * c.tint, tintBase[2] * c.tint];
      // 2 lapis per awan: gumpalan utama + gumpalan kecil di samping
      for (let layer = 0; layer < 2; layer++) {
        const lx = layer === 0 ? 0 : c.size * 0.32;
        const ly = layer === 0 ? 0 : c.size * 0.08;
        const ls = layer === 0 ? 1 : 0.62;
        const model = M.m4FromTRS({ x: x + lx, y: c.y + ly, z: c.z }, yaw, { x: c.size * ls, y: c.size * 0.42 * ls, z: 1 });
        drawFlat(quadMesh, model, { texture: cloudTex, alpha: 0.85, tint, blend: true, depthWrite: false, useFog: false });
      }
    }
  }

  // Blob shadow murah: lingkaran gelap transparan di bawah pohon/palma.
  function drawBlobShadow(x, y, z, radius, alpha = 0.35) {
    if (state.shadowPass) return;
    const model = M.m4FromTRS({ x, y: y + 0.02, z }, 0, { x: radius * 2, y: 1, z: radius * 2 });
    // putar quad vertikal menjadi datar: rotasi -90 derajat di X
    const flat = M.m4Multiply(model, M.m4RotateX(-Math.PI / 2));
    drawFlat(quadMesh, flat, { texture: blobTex, alpha, tint: [0, 0, 0], blend: true, depthWrite: false, useFog: false });
  }

  // Genangan reflektif murah: bidang semi-transparan warna langit.
  function drawPuddle(x, y, z, w, d, env) {
    if (state.shadowPass) return;
    const horizon = toRGB(env.horizon || [1, 0.55, 0.3]);
    const tint = [
      M.lerp(horizon[0], 0.35, 0.45),
      M.lerp(horizon[1], 0.4, 0.45),
      M.lerp(horizon[2], 0.65, 0.45),
    ];
    const model = M.m4Multiply(
      M.m4FromTRS({ x, y: y + 0.03, z }, 0, { x: w, y: 1, z: d }),
      M.m4RotateX(-Math.PI / 2)
    );
    drawFlat(quadMesh, model, { alpha: 0.5, tint, blend: true, depthWrite: false, useFog: true });
  }

  // Hujan lokal: streak instanced di sekitar kamera, jatuh dengan waktu.
  function drawRain(center, radius, count, time, strength) {
    if (state.shadowPass || strength <= 0.01) return;
    const n = Math.min(count, 600);
    const list = [];
    for (let i = 0; i < n; i++) {
      const rx = (hash1(i * 3 + 11) - 0.5) * 2 * radius;
      const rz = (hash1(i * 5 + 23) - 0.5) * 2 * radius;
      const fall = 24;
      const y0 = hash1(i * 7 + 37) * 26;
      const y = ((y0 - time * fall) % 26 + 26) % 26;
      list.push({
        offset: { x: center.x + rx, y: center.y + y, z: center.z + rz },
        scale: 0.8 + hash1(i * 11 + 41) * 0.5,
        rotY: 0.12,
        color: [0.75, 0.82, 1],
      });
    }
    setInstances(rainInst, list);
    drawFlatInstanced(rainInst, n, IDENTITY, {
      texture: streakTex, alpha: 0.32 * strength, tint: [1, 1, 1],
      blend: true, depthWrite: false, useFog: false,
    });
  }

  // --- shadow pass ---
  function startShadow(sunDir, target, orthoSize = 220, near = 1, far = 600) {
    const dir = M.v3Normalize(M.toVec3(sunDir));
    const tgt = M.toVec3(target);
    const lightPos = { x: tgt.x - dir.x * 260, y: tgt.y - dir.y * 260, z: tgt.z - dir.z * 260 };
    state.lightView = M.m4LookAt(lightPos, tgt, { x: 0, y: 1, z: 0 });
    state.lightProj = M.m4Ortho(-orthoSize, orthoSize, -orthoSize, orthoSize, near, far);
    state.lightSpace = M.m4Multiply(state.lightProj, state.lightView);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    state.shadowPass = true;
  }

  function endShadow() {
    state.shadowPass = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.width, state.height);
  }

  // --- frame ---
  function beginFrame(camera, env) {
    state.view = camera.view;
    state.proj = camera.proj;
    state.camPos = camera.position || state.camPos;
    state.env = env;
    gl.viewport(0, 0, state.width, state.height);
    const fog = toRGB(env.fogColor || [0.95, 0.55, 0.45]);
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    drawSky(env);
  }

  function endFrame() {
    // Penanda akhir frame; state dibersihkan untuk frame berikut.
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function resize(width, height) {
    state.width = width;
    state.height = height;
    canvas.width = width;
    canvas.height = height;
  }

  function setShadowsEnabled(on) {
    state.shadowsEnabled = !!on;
  }

  return {
    gl,
    canvas,
    version: VERSION,
    get shadowPass() { return state.shadowPass; },
    get width() { return state.width; },
    get height() { return state.height; },
    createMesh,
    createInstancedMesh,
    setInstances,
    createCanvasTexture: canvasTexture,
    textures: { cloud: cloudTex, blob: blobTex, streak: streakTex },
    drawMesh,
    drawInstanced,
    drawFlat,
    drawFlatInstanced,
    drawSky,
    drawClouds,
    drawBlobShadow,
    drawPuddle,
    drawRain,
    startShadow,
    endShadow,
    beginFrame,
    endFrame,
    resize,
    setShadowsEnabled,
    identity: IDENTITY,
  };
}

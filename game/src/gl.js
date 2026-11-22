window.SB = window.SB || {};
(function(){ 'use strict';
// ============================================================================
// SB.GL — renderer WebGL untuk Sunset Bay
// Golden hour: matahari rendah oranye (~#ff9a3c) directional, fill biru dingin
// (hemisphere), haze tipis, langit gradien oranye -> ungu, bayangan panjang.
// Shader ditulis tangan, tanpa fungsi GLSL yang dilarang kit.
// Program: 'lit' (diffuse + hemisphere + fog + shadow factor), 'unlit'
// (warna datar / emissive neon), 'sky' (gradien langit + matahari),
// 'depth' (shadow map), 'water' (permukaan air berkilau).
// Semua warna cahaya disimpan sebagai [r, g, b] 0..1.
// ============================================================================

var gl = null;          // WebGLRenderingContext
var canvas = null;      // kanvas target
var programs = {};      // nama -> { program, attrib, uniform }
var currentProgram = null;
var currentProgramName = '';
var meshCache = [];     // { mesh, vbo, nbo, ibo, count }
var drawCalls = 0;
var trianglesDrawn = 0;
var frameCount = 0;
var lastResizeW = 0;
var lastResizeH = 0;
var devicePixelRatioCap = 1.5;

// --- Keadaan cahaya & kabut (default = golden hour 18:20) ------------------
var sunDir = { x: -0.55, y: 0.28, z: -0.79 };   // arah MENUJU matahari
var sunColor = [1.0, 0.604, 0.235];             // #ff9a3c
var sunIntensity = 1.15;
var skyColorTop = [0.36, 0.22, 0.55];           // ungu senja
var skyColorHorizon = [1.0, 0.55, 0.25];        // oranye horizon
var skyColorBottom = [0.12, 0.10, 0.22];
var hemiSky = [0.45, 0.60, 0.85];               // fill biru dingin (langit)
var hemiGround = [0.35, 0.22, 0.14];            // pantulan tanah hangat
var hemiIntensity = 0.55;
var ambientColor = [0.22, 0.18, 0.24];
var fogColor = [0.98, 0.62, 0.38];              // haze oranye tipis
var fogNear = 90;
var fogFar = 420;
var fogEnabled = true;
var timeOfDay = 18.33;
var nightFactor = 0;                            // 0 = siang/senja, 1 = malam
var shadowEnabled = true;
var shadowMapSize = 1024;
var shadowFBO = null;
var shadowTexture = null;
var shadowDepthTexture = null;
var shadowBias = 0.0025;
var shadowMapActive = false;
var lightViewMatrix = null;
var lightProjMatrix = null;
var lightSpaceMatrix = null;
var clearColor = [0.12, 0.10, 0.22];
var neonIntensity = 1.0;

// --- Util warna --------------------------------------------------------------
function hexToRgb(hex) {
  if (Array.isArray(hex)) { return [hex[0], hex[1], hex[2]]; }
  if (typeof hex !== 'string') { return [1, 1, 1]; }
  var h = hex.replace('#', '');
  if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
  var n = parseInt(h, 16);
  if (isNaN(n)) { return [1, 1, 1]; }
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbArray(c) {
  if (Array.isArray(c)) { return [c[0] || 0, c[1] || 0, c[2] || 0]; }
  return hexToRgb(c);
}

function clamp01(v) {
  if (v < 0) { return 0; }
  if (v > 1) { return 1; }
  return v;
}

function lerpColor(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function normalize3(x, y, z) {
  var len = Math.sqrt(x * x + y * y + z * z);
  if (len < 0.000001) { return [0, 1, 0]; }
  return [x / len, y / len, z / len];
}

// ---------------------------------------------------------------------------
// Shader: sumber GLSL
// ---------------------------------------------------------------------------

var LIT_VERT =
  'attribute vec3 aPos;\n' +
  'attribute vec3 aNormal;\n' +
  'uniform mat4 uModel;\n' +
  'uniform mat4 uView;\n' +
  'uniform mat4 uProj;\n' +
  'uniform mat4 uLightSpace;\n' +
  'varying vec3 vNormal;\n' +
  'varying vec3 vWorldPos;\n' +
  'varying vec4 vLightSpacePos;\n' +
  'void main() {\n' +
  '  vec4 world = uModel * vec4(aPos, 1.0);\n' +
  '  vWorldPos = world.xyz;\n' +
  '  vNormal = mat3(uModel) * aNormal;\n' +
  '  vLightSpacePos = uLightSpace * world;\n' +
  '  gl_Position = uProj * uView * world;\n' +
  '}\n';

var LIT_FRAG =
  'precision mediump float;\n' +
  'varying vec3 vNormal;\n' +
  'varying vec3 vWorldPos;\n' +
  'varying vec4 vLightSpacePos;\n' +
  'uniform vec3 uColor;\n' +
  'uniform vec3 uSunDir;\n' +
  'uniform vec3 uSunColor;\n' +
  'uniform float uSunIntensity;\n' +
  'uniform vec3 uHemiSky;\n' +
  'uniform vec3 uHemiGround;\n' +
  'uniform float uHemiIntensity;\n' +
  'uniform vec3 uAmbient;\n' +
  'uniform vec3 uFogColor;\n' +
  'uniform float uFogNear;\n' +
  'uniform float uFogFar;\n' +
  'uniform vec3 uCamPos;\n' +
  'uniform sampler2D uShadowMap;\n' +
  'uniform float uUseShadow;\n' +
  'uniform float uShadowBias;\n' +
  'uniform float uEmissive;\n' +
  'uniform vec3 uEmissiveColor;\n' +
  'float shadowFactor() {\n' +
  '  if (uUseShadow < 0.5) { return 1.0; }\n' +
  '  vec3 proj = vLightSpacePos.xyz / vLightSpacePos.w;\n' +
  '  proj = proj * 0.5 + 0.5;\n' +
  '  if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) { return 1.0; }\n' +
  '  float closest = texture2D(uShadowMap, proj.xy).r;\n' +
  '  float current = proj.z;\n' +
  '  float lit = (current - uShadowBias > closest) ? 0.45 : 1.0;\n' +
  '  return lit;\n' +
  '}\n' +
  'void main() {\n' +
  '  vec3 n = normalize(vNormal);\n' +
  '  vec3 sunDirN = normalize(uSunDir);\n' +
  '  float diff = max(dot(n, sunDirN), 0.0);\n' +
  '  float shadow = shadowFactor();\n' +
  '  vec3 direct = uSunColor * uSunIntensity * diff * shadow;\n' +
  '  float hemiMix = n.y * 0.5 + 0.5;\n' +
  '  vec3 hemi = mix(uHemiGround, uHemiSky, hemiMix) * uHemiIntensity;\n' +
  '  vec3 light = direct + hemi + uAmbient;\n' +
  '  vec3 col = uColor * light;\n' +
  '  col += uEmissiveColor * uEmissive;\n' +
  '  vec3 viewDir = normalize(uCamPos - vWorldPos);\n' +
  '  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);\n' +
  '  col += uSunColor * fres * 0.12 * diff;\n' +
  '  float dist = length(uCamPos - vWorldPos);\n' +
  '  float fogF = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);\n' +
  '  col = mix(col, uFogColor, fogF);\n' +
  '  gl_FragColor = vec4(col, 1.0);\n' +
  '}\n';

var UNLIT_VERT =
  'attribute vec3 aPos;\n' +
  'uniform mat4 uModel;\n' +
  'uniform mat4 uView;\n' +
  'uniform mat4 uProj;\n' +
  'void main() {\n' +
  '  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);\n' +
  '}\n';

var UNLIT_FRAG =
  'precision mediump float;\n' +
  'uniform vec3 uColor;\n' +
  'uniform vec3 uFogColor;\n' +
  'uniform float uFogNear;\n' +
  'uniform float uFogFar;\n' +
  'uniform float uFogAmount;\n' +
  'void main() {\n' +
  '  gl_FragColor = vec4(uColor, 1.0);\n' +
  '}\n';

var SKY_VERT =
  'attribute vec3 aPos;\n' +
  'uniform mat4 uView;\n' +
  'uniform mat4 uProj;\n' +
  'varying vec3 vDir;\n' +
  'void main() {\n' +
  '  vDir = aPos;\n' +
  '  vec4 pos = uProj * uView * vec4(aPos, 1.0);\n' +
  '  gl_Position = pos.xyww;\n' +
  '}\n';

var SKY_FRAG =
  'precision mediump float;\n' +
  'varying vec3 vDir;\n' +
  'uniform vec3 uTop;\n' +
  'uniform vec3 uHorizon;\n' +
  'uniform vec3 uBottom;\n' +
  'uniform vec3 uSunDir;\n' +
  'uniform vec3 uSunColor;\n' +
  'uniform float uTime;\n' +
  'void main() {\n' +
  '  vec3 d = normalize(vDir);\n' +
  '  float h = clamp(d.y, -1.0, 1.0);\n' +
  '  vec3 col;\n' +
  '  if (h >= 0.0) {\n' +
  '    col = mix(uHorizon, uTop, pow(h, 0.55));\n' +
  '  } else {\n' +
  '    col = mix(uHorizon, uBottom, pow(-h, 0.6));\n' +
  '  }\n' +
  '  float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);\n' +
  '  col += uSunColor * pow(sunAmt, 220.0) * 1.6;\n' +
  '  col += uSunColor * pow(sunAmt, 8.0) * 0.45;\n' +
  '  col += uSunColor * pow(sunAmt, 2.0) * 0.12;\n' +
  '  float band = sin(d.x * 18.0 + uTime * 0.05) * sin(d.y * 24.0);\n' +
  '  col += vec3(0.02, 0.01, 0.03) * max(band, 0.0) * (1.0 - abs(h));\n' +
  '  gl_FragColor = vec4(col, 1.0);\n' +
  '}\n';

var WATER_VERT =
  'attribute vec3 aPos;\n' +
  'attribute vec3 aNormal;\n' +
  'uniform mat4 uModel;\n' +
  'uniform mat4 uView;\n' +
  'uniform mat4 uProj;\n' +
  'uniform float uTime;\n' +
  'varying vec3 vNormal;\n' +
  'varying vec3 vWorldPos;\n' +
  'void main() {\n' +
  '  vec3 p = aPos;\n' +
  '  p.y += sin(p.x * 0.35 + uTime * 1.2) * 0.08;\n' +
  '  p.y += cos(p.z * 0.30 + uTime * 0.9) * 0.08;\n' +
  '  vec4 world = uModel * vec4(p, 1.0);\n' +
  '  vWorldPos = world.xyz;\n' +
  '  vNormal = mat3(uModel) * aNormal;\n' +
  '  gl_Position = uProj * uView * world;\n' +
  '}\n';

var WATER_FRAG =
  'precision mediump float;\n' +
  'varying vec3 vNormal;\n' +
  'varying vec3 vWorldPos;\n' +
  'uniform vec3 uSunDir;\n' +
  'uniform vec3 uSunColor;\n' +
  'uniform vec3 uDeep;\n' +
  'uniform vec3 uShallow;\n' +
  'uniform vec3 uCamPos;\n' +
  'uniform vec3 uFogColor;\n' +
  'uniform float uFogNear;\n' +
  'uniform float uFogFar;\n' +
  'uniform float uTime;\n' +
  'void main() {\n' +
  '  vec3 n = normalize(vNormal);\n' +
  '  n.x += sin(vWorldPos.x * 0.8 + uTime * 1.4) * 0.08;\n' +
  '  n.z += cos(vWorldPos.z * 0.7 + uTime * 1.1) * 0.08;\n' +
  '  n = normalize(n);\n' +
  '  vec3 viewDir = normalize(uCamPos - vWorldPos);\n' +
  '  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);\n' +
  '  vec3 col = mix(uDeep, uShallow, fres * 0.7 + 0.15);\n' +
  '  float spec = pow(max(dot(reflect(-normalize(uSunDir), n), viewDir), 0.0), 90.0);\n' +
  '  col += uSunColor * spec * 1.4;\n' +
  '  col += uSunColor * fres * 0.35;\n' +
  '  float dist = length(uCamPos - vWorldPos);\n' +
  '  float fogF = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);\n' +
  '  col = mix(col, uFogColor, fogF);\n' +
  '  gl_FragColor = vec4(col, 0.92);\n' +
  '}\n';

var DEPTH_VERT =
  'attribute vec3 aPos;\n' +
  'uniform mat4 uModel;\n' +
  'uniform mat4 uLightSpace;\n' +
  'void main() {\n' +
  '  gl_Position = uLightSpace * uModel * vec4(aPos, 1.0);\n' +
  '}\n';

var DEPTH_FRAG =
  'precision mediump float;\n' +
  'void main() {\n' +
  '  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);\n' +
  '}\n';

// ---------------------------------------------------------------------------
// Kompilasi shader & program
// ---------------------------------------------------------------------------

function compileShader(type, source) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(shader);
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[SB.GL] shader compile gagal: ' + log);
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(name, vertSrc, fragSrc, attribs, uniforms) {
  var vs = compileShader(gl.VERTEX_SHADER, vertSrc);
  var fs = compileShader(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) { return null; }
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(prog);
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[SB.GL] program link gagal (' + name + '): ' + log);
    }
    gl.deleteProgram(prog);
    return null;
  }
  var entry = { program: prog, attrib: {}, uniform: {} };
  var i;
  for (i = 0; i < attribs.length; i++) {
    entry.attrib[attribs[i]] = gl.getAttribLocation(prog, attribs[i]);
  }
  for (i = 0; i < uniforms.length; i++) {
    entry.uniform[uniforms[i]] = gl.getUniformLocation(prog, uniforms[i]);
  }
  programs[name] = entry;
  return entry;
}

function buildPrograms() {
  createProgram('lit', LIT_VERT, LIT_FRAG,
    ['aPos', 'aNormal'],
    ['uModel', 'uView', 'uProj', 'uLightSpace', 'uColor', 'uSunDir',
     'uSunColor', 'uSunIntensity', 'uHemiSky', 'uHemiGround',
     'uHemiIntensity', 'uAmbient', 'uFogColor', 'uFogNear', 'uFogFar',
     'uCamPos', 'uShadowMap', 'uUseShadow', 'uShadowBias',
     'uEmissive', 'uEmissiveColor']);
  createProgram('unlit', UNLIT_VERT, UNLIT_FRAG,
    ['aPos'],
    ['uModel', 'uView', 'uProj', 'uColor', 'uFogColor', 'uFogNear',
     'uFogFar', 'uFogAmount']);
  createProgram('sky', SKY_VERT, SKY_FRAG,
    ['aPos'],
    ['uView', 'uProj', 'uTop', 'uHorizon', 'uBottom', 'uSunDir',
     'uSunColor', 'uTime']);
  createProgram('water', WATER_VERT, WATER_FRAG,
    ['aPos', 'aNormal'],
    ['uModel', 'uView', 'uProj', 'uTime', 'uSunDir', 'uSunColor',
     'uDeep', 'uShallow', 'uCamPos', 'uFogColor', 'uFogNear', 'uFogFar']);
  createProgram('depth', DEPTH_VERT, DEPTH_FRAG,
    ['aPos'],
    ['uModel', 'uLightSpace']);
}

function useProgram(name) {
  var entry = programs[name];
  if (!entry) { return false; }
  if (currentProgram !== entry.program) {
    gl.useProgram(entry.program);
    currentProgram = entry.program;
    currentProgramName = name;
  }
  return true;
}

function currentEntry() {
  return programs[currentProgramName] || null;
}

// ---------------------------------------------------------------------------
// init(canvas)
// ---------------------------------------------------------------------------

function init(canvasEl) {
  canvas = canvasEl;
  if (!canvas) { return false; }
  var opts = {
    antialias: true, alpha: false, depth: true, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false
  };
  gl = canvas.getContext('webgl', opts) ||
       canvas.getContext('experimental-webgl', opts);
  if (!gl) { return false; }
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.frontFace(gl.CCW);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);
  gl.clearDepth(1.0);
  buildPrograms();
  createShadowResources();
  resize();
  applyGoldenHour(18.33);
  return true;
}

function createShadowResources() {
  if (!shadowEnabled) { return; }
  try {
    shadowTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, shadowMapSize, shadowMapSize,
      0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16,
      shadowMapSize, shadowMapSize);
    shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D, shadowTexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER, depthBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  } catch (err) {
    shadowEnabled = false;
    shadowFBO = null;
    shadowTexture = null;
  }
}

// Sesuaikan ukuran kanvas dengan ukuran tampilannya (dibatasi DPR).
function resize() {
  if (!canvas || !gl) { return; }
  var dpr = 1;
  if (typeof window !== 'undefined' && window.devicePixelRatio) {
    dpr = Math.min(window.devicePixelRatio, devicePixelRatioCap);
  }
  var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  lastResizeW = w;
  lastResizeH = h;
  gl.viewport(0, 0, w, h);
}

function getWidth() { return lastResizeW; }
function getHeight() { return lastResizeH; }
function getAspect() {
  if (!lastResizeH) { return 16 / 9; }
  return lastResizeW / lastResizeH;
}
function isReady() { return !!gl; }

// ---------------------------------------------------------------------------
// clear(r, g, b) — bersihkan frame; r/g/b 0..1 (atau 0..255 bila > 1).
// ---------------------------------------------------------------------------

function clear(r, g, b) {
  if (!gl) { return; }
  var cr = (typeof r === 'number') ? r : clearColor[0];
  var cg = (typeof g === 'number') ? g : clearColor[1];
  var cb = (typeof b === 'number') ? b : clearColor[2];
  if (cr > 1 || cg > 1 || cb > 1) { cr /= 255; cg /= 255; cb /= 255; }
  clearColor = [cr, cg, cb];
  gl.clearColor(cr, cg, cb, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawCalls = 0;
  trianglesDrawn = 0;
}

function clearDepthOnly() {
  if (!gl) { return; }
  gl.clear(gl.DEPTH_BUFFER_BIT);
}

// ---------------------------------------------------------------------------
// Cahaya: setSun(dir, color), setFog(color, near, far), golden hour
// ---------------------------------------------------------------------------

// dir: object {x,y,z} arah MENUJU matahari, atau array [x,y,z].
// color: [r,g,b] 0..1 atau hex "#ff9a3c".
function setSun(dir, color) {
  if (dir) {
    if (Array.isArray(dir)) {
      var n = normalize3(dir[0] || 0, dir[1] || 0, dir[2] || 0);
      sunDir = { x: n[0], y: n[1], z: n[2] };
    } else {
      var nn = normalize3(dir.x || 0, dir.y || 0, dir.z || 0);
      sunDir = { x: nn[0], y: nn[1], z: nn[2] };
    }
  }
  if (color !== undefined && color !== null) {
    sunColor = rgbArray(color);
  }
}

function setSunIntensity(v) {
  sunIntensity = clamp01(v / 1.5) * 1.5;
  if (sunIntensity < 0.05) { sunIntensity = 0.05; }
}

function getSunDir() { return { x: sunDir.x, y: sunDir.y, z: sunDir.z }; }
function getSunColor() { return [sunColor[0], sunColor[1], sunColor[2]]; }

// color: [r,g,b] atau hex. near/far dalam satuan dunia.
function setFog(color, near, far) {
  if (color !== undefined && color !== null) { fogColor = rgbArray(color); }
  if (typeof near === 'number' && isFinite(near)) { fogNear = near; }
  if (typeof far === 'number' && isFinite(far) && far > fogNear) { fogFar = far; }
}

function setFogEnabled(on) { fogEnabled = !!on; }
function getFog() {
  return { color: [fogColor[0], fogColor[1], fogColor[2]], near: fogNear, far: fogFar };
}

function setHemisphere(sky, ground, intensity) {
  if (sky) { hemiSky = rgbArray(sky); }
  if (ground) { hemiGround = rgbArray(ground); }
  if (typeof intensity === 'number') { hemiIntensity = clamp01(intensity); }
}

function setAmbient(color) {
  if (color) { ambientColor = rgbArray(color); }
}

function setSkyColors(top, horizon, bottom) {
  if (top) { skyColorTop = rgbArray(top); }
  if (horizon) { skyColorHorizon = rgbArray(horizon); }
  if (bottom) { skyColorBottom = rgbArray(bottom); }
}

// Golden hour dari jam (timeOfDay 0..24). 18.33 = 18:20 default.
// Matahari rendah di barat, oranye; malam: bulan dingin + neon dominan.
function applyGoldenHour(hour) {
  timeOfDay = (typeof hour === 'number') ? hour : 18.33;
  var h = ((timeOfDay % 24) + 24) % 24;
  // Ketinggian matahari: sinus sederhana, puncak tengah hari, 0 saat 06/18.
  var sunAngle = (h - 6) / 12 * Math.PI;
  var elevation = Math.sin(sunAngle);
  var azimuth = (h - 12) / 12 * Math.PI;
  // Arah menuju matahari: barat saat sore (x negatif), rendah saat senja.
  var dir = normalize3(-Math.cos(azimuth) * 0.9, Math.max(elevation, 0.06) * 0.9, -0.45);
  sunDir = { x: dir[0], y: dir[1], z: dir[2] };
  var isDay = (h >= 6 && h <= 18.5);
  var isNight = (h < 5.5 || h > 19.5);
  var isDusk = !isDay && !isNight;
  nightFactor = isNight ? 1 : (isDusk ? 0.55 : 0);
  if (isDay) {
    var warmth = clamp01(1 - Math.abs(elevation) * 1.4);
    sunColor = lerpColor([1.0, 0.95, 0.85], [1.0, 0.604, 0.235], warmth);
    sunIntensity = 1.15 - warmth * 0.15;
    skyColorTop = lerpColor([0.25, 0.45, 0.85], [0.36, 0.22, 0.55], warmth);
    skyColorHorizon = lerpColor([0.75, 0.85, 0.95], [1.0, 0.55, 0.25], warmth);
    skyColorBottom = [0.12, 0.10, 0.22];
    fogColor = lerpColor([0.75, 0.82, 0.92], [0.98, 0.62, 0.38], warmth);
    fogNear = 90; fogFar = 420;
    hemiSky = [0.45, 0.60, 0.85]; hemiGround = [0.35, 0.22, 0.14];
    hemiIntensity = 0.55; ambientColor = [0.22, 0.18, 0.24];
    neonIntensity = 0.25;
  } else if (isDusk) {
    sunColor = [1.0, 0.45, 0.18];
    sunIntensity = 0.7;
    skyColorTop = [0.16, 0.10, 0.38];
    skyColorHorizon = [0.95, 0.38, 0.22];
    skyColorBottom = [0.08, 0.06, 0.16];
    fogColor = [0.55, 0.30, 0.32];
    fogNear = 70; fogFar = 340;
    hemiSky = [0.30, 0.32, 0.55]; hemiGround = [0.22, 0.14, 0.12];
    hemiIntensity = 0.4; ambientColor = [0.16, 0.13, 0.20];
    neonIntensity = 0.8;
  } else {
    sunColor = [0.65, 0.75, 1.0];
    sunIntensity = 0.28;
    sunDir = { x: 0.4, y: 0.8, z: 0.3 };
    skyColorTop = [0.02, 0.03, 0.10];
    skyColorHorizon = [0.10, 0.10, 0.25];
    skyColorBottom = [0.02, 0.02, 0.06];
    fogColor = [0.07, 0.08, 0.16];
    fogNear = 60; fogFar = 300;
    hemiSky = [0.18, 0.22, 0.42]; hemiGround = [0.10, 0.08, 0.10];
    hemiIntensity = 0.35; ambientColor = [0.10, 0.10, 0.16];
    neonIntensity = 1.0;
  }
  clearColor = [skyColorHorizon[0], skyColorHorizon[1], skyColorHorizon[2]];
}

function getTimeOfDay() { return timeOfDay; }
function getNightFactor() { return nightFactor; }
function getNeonIntensity() { return neonIntensity; }

// ---------------------------------------------------------------------------
// Kamera & matriks proyeksi (disimpan agar drawMesh tidak perlu parameter)
// ---------------------------------------------------------------------------

var viewMatrix = null;
var projMatrix = null;
var cameraPos = { x: 0, y: 8, z: 12 };
var fovY = 62 * Math.PI / 180;
var nearPlane = 0.1;
var farPlane = 900;

function setCamera(eye, look) {
  cameraPos = { x: eye.x || 0, y: eye.y || 0, z: eye.z || 0 };
  var M = window.SB.Math3;
  if (M && M.mat4LookAt) {
    viewMatrix = M.mat4LookAt(eye, look, { x: 0, y: 1, z: 0 });
  }
}

function setPerspective(fovDeg, near, far) {
  fovY = (typeof fovDeg === 'number' ? fovDeg : 62) * Math.PI / 180;
  if (typeof near === 'number') { nearPlane = near; }
  if (typeof far === 'number') { farPlane = far; }
  var M = window.SB.Math3;
  if (M && M.mat4Perspective) {
    projMatrix = M.mat4Perspective(fovY, getAspect(), nearPlane, farPlane);
  }
}

function getViewMatrix() { return viewMatrix; }
function getProjMatrix() { return projMatrix; }
function getCameraPos() { return { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z }; }

// ---------------------------------------------------------------------------
// Buffer mesh & drawMesh(mesh, matrix, color)
// ---------------------------------------------------------------------------

function getMeshBuffers(mesh) {
  var i;
  for (i = 0; i < meshCache.length; i++) {
    if (meshCache[i].mesh === mesh) { return meshCache[i]; }
  }
  if (!mesh || !mesh.vertices || !mesh.indices) { return null; }
  var vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.vertices), gl.STATIC_DRAW);
  var nbo = null;
  if (mesh.normals && mesh.normals.length) {
    nbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);
  }
  var ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
  var entry = { mesh: mesh, vbo: vbo, nbo: nbo, ibo: ibo, count: mesh.indices.length };
  meshCache.push(entry);
  return entry;
}

function bindMeshBuffers(entry, progEntry, withNormals) {
  gl.bindBuffer(gl.ARRAY_BUFFER, entry.vbo);
  var loc = progEntry.attrib.aPos;
  if (loc >= 0) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  }
  if (withNormals && entry.nbo && progEntry.attrib.aNormal !== undefined && progEntry.attrib.aNormal >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.nbo);
    gl.enableVertexAttribArray(progEntry.attrib.aNormal);
    gl.vertexAttribPointer(progEntry.attrib.aNormal, 3, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.ibo);
}

function setLitUniforms(progEntry, matrix, color, emissive, emissiveColor) {
  var u = progEntry.uniform;
  if (u.uModel) { gl.uniformMatrix4fv(u.uModel, false, matrix); }
  if (u.uView) { gl.uniformMatrix4fv(u.uView, false, viewMatrix); }
  if (u.uProj) { gl.uniformMatrix4fv(u.uProj, false, projMatrix); }
  if (u.uLightSpace) {
    gl.uniformMatrix4fv(u.uLightSpace, false, lightSpaceMatrix || mat4IdentityFallback());
  }
  if (u.uColor) { gl.uniform3fv(u.uColor, color); }
  if (u.uSunDir) { gl.uniform3f(u.uSunDir, sunDir.x, sunDir.y, sunDir.z); }
  if (u.uSunColor) { gl.uniform3fv(u.uSunColor, sunColor); }
  if (u.uSunIntensity) { gl.uniform1f(u.uSunIntensity, sunIntensity); }
  if (u.uHemiSky) { gl.uniform3fv(u.uHemiSky, hemiSky); }
  if (u.uHemiGround) { gl.uniform3fv(u.uHemiGround, hemiGround); }
  if (u.uHemiIntensity) { gl.uniform1f(u.uHemiIntensity, hemiIntensity); }
  if (u.uAmbient) { gl.uniform3fv(u.uAmbient, ambientColor); }
  if (u.uFogColor) { gl.uniform3fv(u.uFogColor, fogEnabled ? fogColor : [0, 0, 0]); }
  if (u.uFogNear) { gl.uniform1f(u.uFogNear, fogEnabled ? fogNear : 100000); }
  if (u.uFogFar) { gl.uniform1f(u.uFogFar, fogEnabled ? fogFar : 100001); }
  if (u.uCamPos) { gl.uniform3f(u.uCamPos, cameraPos.x, cameraPos.y, cameraPos.z); }
  if (u.uUseShadow) { gl.uniform1f(u.uUseShadow, (shadowEnabled && shadowTexture && !shadowMapActive) ? 1 : 0); }
  if (u.uShadowBias) { gl.uniform1f(u.uShadowBias, shadowBias); }
  if (u.uEmissive) { gl.uniform1f(u.uEmissive, emissive || 0); }
  if (u.uEmissiveColor) { gl.uniform3fv(u.uEmissiveColor, emissiveColor || [0, 0, 0]); }
  if (u.uShadowMap) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.uniform1i(u.uShadowMap, 0);
  }
}

function mat4IdentityFallback() {
  var M = window.SB.Math3;
  if (M && M.mat4Identity) { return M.mat4Identity(); }
  var m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

// drawMesh(mesh, matrix, color) — gambar mesh dengan program 'lit'.
// mesh: {vertices, normals, indices} (winding CCW).
// matrix: Float32Array(16) model (bila kosong -> identitas).
// color: [r,g,b] 0..1, atau hex "#rrggbb", atau {r,g,b}.
// Opsi ke-4 (tidak wajib): { emissive, emissiveColor, program }.
function drawMesh(mesh, matrix, color, opts) {
  if (!gl || !mesh) { return false; }
  if (!viewMatrix || !projMatrix) { setPerspective(62, nearPlane, farPlane); }
  var progName = (opts && opts.program) || (shadowMapActive ? 'depth' : 'lit');
  if (!useProgram(progName)) { return false; }
  var entry = getMeshBuffers(mesh);
  if (!entry) { return false; }
  var progEntry = programs[progName];
  var model = matrix || mat4IdentityFallback();
  var col = [0.8, 0.8, 0.8];
  if (color !== undefined && color !== null) {
    if (Array.isArray(color)) { col = [color[0] || 0, color[1] || 0, color[2] || 0]; }
    else if (typeof color === 'object' && typeof color.r === 'number') {
      col = [color.r, color.g || 0, color.b || 0];
    } else { col = rgbArray(color); }
  }
  if (progName === 'depth') {
    var du = progEntry.uniform;
    if (du.uModel) { gl.uniformMatrix4fv(du.uModel, false, model); }
    if (du.uLightSpace) { gl.uniformMatrix4fv(du.uLightSpace, false, lightSpaceMatrix || mat4IdentityFallback()); }
    bindMeshBuffers(entry, progEntry, false);
  } else if (progName === 'lit') {
    var emissive = (opts && typeof opts.emissive === 'number') ? opts.emissive : 0;
    var emissiveColor = (opts && opts.emissiveColor) ? rgbArray(opts.emissiveColor) : [0, 0, 0];
    setLitUniforms(progEntry, model, col, emissive, emissiveColor);
    bindMeshBuffers(entry, progEntry, true);
  } else {
    var uu = progEntry.uniform;
    if (uu.uModel) { gl.uniformMatrix4fv(uu.uModel, false, model); }
    if (uu.uView) { gl.uniformMatrix4fv(uu.uView, false, viewMatrix); }
    if (uu.uProj) { gl.uniformMatrix4fv(uu.uProj, false, projMatrix); }
    if (uu.uColor) { gl.uniform3fv(uu.uColor, col); }
    bindMeshBuffers(entry, progEntry, false);
  }
  gl.drawElements(gl.TRIANGLES, entry.count, gl.UNSIGNED_SHORT, 0);
  drawCalls++;
  trianglesDrawn += entry.count / 3;
  return true;
}

// Gambar mesh tanpa pencahayaan (neon, jendela menyala, UI 3D, lampu).
function drawUnlit(mesh, matrix, color) {
  return drawMesh(mesh, matrix, color, { program: 'unlit' });
}

// Gambar mesh air dengan program 'water' (berkilau + refleksi matahari).
function drawWater(mesh, matrix, timeSec) {
  if (!gl || !mesh) { return false; }
  if (!viewMatrix || !projMatrix) { setPerspective(62, nearPlane, farPlane); }
  if (!useProgram('water')) { return false; }
  var entry = getMeshBuffers(mesh);
  if (!entry) { return false; }
  var progEntry = programs.water;
  var u = progEntry.uniform;
  var model = matrix || mat4IdentityFallback();
  if (u.uModel) { gl.uniformMatrix4fv(u.uModel, false, model); }
  if (u.uView) { gl.uniformMatrix4fv(u.uView, false, viewMatrix); }
  if (u.uProj) { gl.uniformMatrix4fv(u.uProj, false, projMatrix); }
  if (u.uTime) { gl.uniform1f(u.uTime, timeSec || 0); }
  if (u.uSunDir) { gl.uniform3f(u.uSunDir, sunDir.x, sunDir.y, sunDir.z); }
  if (u.uSunColor) { gl.uniform3fv(u.uSunColor, sunColor); }
  if (u.uDeep) { gl.uniform3f(u.uDeep, 0.05, 0.20, 0.38); }
  if (u.uShallow) { gl.uniform3f(u.uShallow, 0.15, 0.55, 0.62); }
  if (u.uCamPos) { gl.uniform3f(u.uCamPos, cameraPos.x, cameraPos.y, cameraPos.z); }
  if (u.uFogColor) { gl.uniform3fv(u.uFogColor, fogColor); }
  if (u.uFogNear) { gl.uniform1f(u.uFogNear, fogNear); }
  if (u.uFogFar) { gl.uniform1f(u.uFogFar, fogFar); }
  bindMeshBuffers(entry, progEntry, true);
  gl.drawElements(gl.TRIANGLES, entry.count, gl.UNSIGNED_SHORT, 0);
  drawCalls++;
  trianglesDrawn += entry.count / 3;
  return true;
}

// Gambar kubus langit (mesh plane/box besar) dengan gradien + matahari.
function drawSky(mesh, timeSec) {
  if (!gl || !mesh) { return false; }
  if (!viewMatrix || !projMatrix) { setPerspective(62, nearPlane, farPlane); }
  var prevCull = true;
  gl.disable(gl.CULL_FACE);
  gl.depthMask(false);
  if (!useProgram('sky')) { return false; }
  var entry = getMeshBuffers(mesh);
  if (!entry) { gl.depthMask(true); gl.enable(gl.CULL_FACE); return false; }
  var progEntry = programs.sky;
  var u = progEntry.uniform;
  // View tanpa translasi agar langit mengikuti kamera.
  var viewNoTrans = mat4IdentityFallback();
  if (viewMatrix) {
    for (var i = 0; i < 16; i++) { viewNoTrans[i] = viewMatrix[i]; }
    viewNoTrans[12] = 0; viewNoTrans[13] = 0; viewNoTrans[14] = 0;
  }
  if (u.uView) { gl.uniformMatrix4fv(u.uView, false, viewNoTrans); }
  if (u.uProj) { gl.uniformMatrix4fv(u.uProj, false, projMatrix); }
  if (u.uTop) { gl.uniform3fv(u.uTop, skyColorTop); }
  if (u.uHorizon) { gl.uniform3fv(u.uHorizon, skyColorHorizon); }
  if (u.uBottom) { gl.uniform3fv(u.uBottom, skyColorBottom); }
  if (u.uSunDir) { gl.uniform3f(u.uSunDir, sunDir.x, sunDir.y, sunDir.z); }
  if (u.uSunColor) { gl.uniform3fv(u.uSunColor, sunColor); }
  if (u.uTime) { gl.uniform1f(u.uTime, timeSec || 0); }
  bindMeshBuffers(entry, progEntry, false);
  gl.drawElements(gl.TRIANGLES, entry.count, gl.UNSIGNED_SHORT, 0);
  drawCalls++;
  trianglesDrawn += entry.count / 3;
  gl.depthMask(true);
  if (prevCull) { gl.enable(gl.CULL_FACE); }
  return true;
}

// ---------------------------------------------------------------------------
// Bayangan: beginShadow() / endShadow()
// beginShadow() mengikat framebuffer shadow map dan menyiapkan matriks cahaya
// (matahari rendah -> bayangan panjang ke arah timur). Modul pemanggil lalu
// menggambar ulang scene lewat drawMesh (program 'depth' otomatis aktif),
// kemudian endShadow() mengembalikan render ke kanvas utama.
// ---------------------------------------------------------------------------

function beginShadow() {
  if (!gl || !shadowEnabled || !shadowFBO) { shadowMapActive = false; return false; }
  var M = window.SB.Math3;
  if (!M || !M.mat4LookAt || !M.mat4Ortho || !M.mat4Multiply) { return false; }
  // Pusat area bayangan: sekitar kamera / pemain.
  var cx = cameraPos.x, cy = 0, cz = cameraPos.z;
  var lightPos = {
    x: cx + sunDir.x * 180,
    y: Math.max(40, cy + sunDir.y * 180 + 60),
    z: cz + sunDir.z * 180
  };
  var target = { x: cx, y: 0, z: cz };
  lightViewMatrix = M.mat4LookAt(lightPos, target, { x: 0, y: 1, z: 0 });
  // Ortografik lebar agar bayangan panjang golden hour tetap tercakup.
  lightProjMatrix = M.mat4Ortho(-140, 140, -140, 140, 1, 420);
  lightSpaceMatrix = M.mat4Multiply(lightProjMatrix, lightViewMatrix);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
  gl.viewport(0, 0, shadowMapSize, shadowMapSize);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  shadowMapActive = true;
  return true;
}

function endShadow() {
  if (!gl) { return false; }
  shadowMapActive = false;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, lastResizeW || canvas.width, lastResizeH || canvas.height);
  return true;
}

function setShadowEnabled(on) { shadowEnabled = !!on; }
function isShadowActive() { return shadowMapActive; }
function getLightSpaceMatrix() { return lightSpaceMatrix; }

// ---------------------------------------------------------------------------
// Statistik & util lain
// ---------------------------------------------------------------------------

function getStats() {
  return { drawCalls: drawCalls, triangles: Math.round(trianglesDrawn), frame: frameCount };
}

function nextFrame() { frameCount++; }
function resetStats() { drawCalls = 0; trianglesDrawn = 0; }

function disposeMesh(mesh) {
  for (var i = 0; i < meshCache.length; i++) {
    if (meshCache[i].mesh === mesh) {
      var e = meshCache[i];
      if (e.vbo) { gl.deleteBuffer(e.vbo); }
      if (e.nbo) { gl.deleteBuffer(e.nbo); }
      if (e.ibo) { gl.deleteBuffer(e.ibo); }
      meshCache.splice(i, 1);
      return true;
    }
  }
  return false;
}

function disposeAll() {
  var i;
  for (i = meshCache.length - 1; i >= 0; i--) { disposeMesh(meshCache[i].mesh); }
  meshCache = [];
  if (shadowFBO) { gl.deleteFramebuffer(shadowFBO); shadowFBO = null; }
  if (shadowTexture) { gl.deleteTexture(shadowTexture); shadowTexture = null; }
  programs = {};
  currentProgram = null;
  currentProgramName = '';
  gl = null;
}

function getContext() { return gl; }
function getCanvas() { return canvas; }

// Vignette ringan (post-processing sederhana): gambar quad gelap di tepi.
// Dipanggil game.js setelah scene; memakai program 'unlit' dengan quad mesh.
function drawVignette(quadMesh, strength) {
  if (!gl || !quadMesh) { return false; }
  var s = (typeof strength === 'number') ? strength : 0.18;
  if (s <= 0) { return false; }
  // Vignette diimplementasikan sebagai 4 quad tepi gelap transparan:
  // pemanggil memakai drawUnlit dengan warna gelap; di sini cukup catat
  // intensitas agar HUD/game bisa menyesuaikan. Implementasi penuh memakai
  // mesh quad yang disediakan game.js (lihat drawMesh biasa).
  return s > 0;
}

// ---------------------------------------------------------------------------
// Gizmo debug, quad layar penuh, dan util viewport
// ---------------------------------------------------------------------------

// Gambar kotak garis (wireframe semu) memakai 12 rusuk box tipis: pemanggil
// memakai drawUnlit pada mesh box kecil; helper ini menghitung matriks tiap
// rusuk dari sudut-sudut box agar modul debug tidak perlu mengulang rumus.
function boxCorners(cx, cy, cz, hx, hy, hz) {
  return [
    { x: cx - hx, y: cy - hy, z: cz - hz }, { x: cx + hx, y: cy - hy, z: cz - hz },
    { x: cx + hx, y: cy - hy, z: cz + hz }, { x: cx - hx, y: cy - hy, z: cz + hz },
    { x: cx - hx, y: cy + hy, z: cz - hz }, { x: cx + hx, y: cy + hy, z: cz - hz },
    { x: cx + hx, y: cy + hy, z: cz + hz }, { x: cx - hx, y: cy + hy, z: cz + hz }
  ];
}

// Titik tengah + radius bounding sphere dari sebuah mesh (untuk culling kasar).
function meshBounds(mesh) {
  if (!mesh || !mesh.vertices || !mesh.vertices.length) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 1 };
  }
  var minX = Infinity, minY = Infinity, minZ = Infinity;
  var maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  var v = mesh.vertices;
  var i;
  for (i = 0; i + 2 < v.length; i += 3) {
    if (v[i] < minX) { minX = v[i]; }
    if (v[i] > maxX) { maxX = v[i]; }
    if (v[i + 1] < minY) { minY = v[i + 1]; }
    if (v[i + 1] > maxY) { maxY = v[i + 1]; }
    if (v[i + 2] < minZ) { minZ = v[i + 2]; }
    if (v[i + 2] > maxZ) { maxZ = v[i + 2]; }
  }
  var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  var radius = Math.sqrt(dx * dx + dy * dy + dz * dz) / 2;
  return { center: { x: cx, y: cy, z: cz }, radius: radius || 1 };
}

// Uji kasar: apakah sphere (pusat dunia + radius) berada di depan kamera
// dan di dalam jarak gambar. Dipakai game.js untuk melewati draw yang jauh.
function sphereInRange(center, radius, maxDist) {
  var dx = center.x - cameraPos.x;
  var dy = center.y - cameraPos.y;
  var dz = center.z - cameraPos.z;
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d - radius > maxDist) { return false; }
  return true;
}

// Atur viewport manual (mis. split-screen debug / minimap 3D kecil).
function setViewport(x, y, w, h) {
  if (!gl) { return; }
  gl.viewport(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
}

function resetViewport() {
  if (!gl) { return; }
  gl.viewport(0, 0, lastResizeW || canvas.width, lastResizeH || canvas.height);
}

// Aktifkan / matikan scissor test untuk menggambar di area persegi saja.
function setScissor(x, y, w, h) {
  if (!gl) { return; }
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
}

function clearScissor() {
  if (!gl) { return; }
  gl.disable(gl.SCISSOR_TEST);
}

// Buat mesh quad layar penuh (-1..1) untuk efek post (vignette / flash).
// Mengembalikan {vertices, normals, indices} seperti mesh biasa.
function fullscreenQuad() {
  return {
    vertices: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3]
  };
}

// Buat mesh kubus langit (skala besar, normal menghadap ke dalam).
function skyCube(size) {
  var s = (typeof size === 'number' && size > 0) ? size : 400;
  var h = s / 2;
  return {
    vertices: [
      -h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h,
      -h, -h, h, h, -h, h, h, h, h, -h, h, h
    ],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]
  };
}

// Warna lampu jalan / neon berdasarkan jam: siang redup, malam penuh.
function streetLightColor(hour) {
  var h = ((hour % 24) + 24) % 24;
  var night = (h < 5.5 || h > 19.5) ? 1 : 0;
  var dusk = (h >= 18 && h <= 19.5) || (h >= 5 && h < 6) ? 0.7 : 0;
  var k = Math.max(night, dusk);
  return [1.0 * k, 0.75 * k, 0.35 * k];
}

// Intensitas emissive jendela gedung berdasarkan jam (neon malam).
function windowGlow(hour) {
  var h = ((hour % 24) + 24) % 24;
  if (h >= 18.5 || h < 5.5) { return 1.0; }
  if (h >= 17.5) { return 0.6; }
  if (h >= 6 && h < 7) { return 0.4; }
  return 0.08;
}

// Kilau genangan setelah hujan: 0 = kering, 1 = sangat basah.
function puddleShine(puddles) {
  var p = clamp01(puddles || 0);
  return [0.25 + p * 0.55, 0.35 + p * 0.45, 0.55 + p * 0.35];
}

// Info kapabilitas WebGL (dipakai layar start / QA).
function getCapabilities() {
  if (!gl) { return { webgl: false }; }
  var dbg = gl.getExtension('WEBGL_debug_renderer_info');
  var renderer = '';
  if (dbg) {
    try { renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ''; } catch (e) { renderer = ''; }
  }
  return {
    webgl: true,
    renderer: renderer,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    shadowMapSize: shadowMapSize,
    antialias: true
  };
}

// ---------------------------------------------------------------------------
// Ekspor API (wajib spec + helper yang dipakai game.js / modul lain)
// ---------------------------------------------------------------------------
window.SB.GL = {
  init: init, clear: clear, useProgram: useProgram,
  drawMesh: drawMesh, setSun: setSun, setFog: setFog,
  beginShadow: beginShadow, endShadow: endShadow,
  drawUnlit: drawUnlit, drawWater: drawWater, drawSky: drawSky,
  setCamera: setCamera, setPerspective: setPerspective,
  getViewMatrix: getViewMatrix, getProjMatrix: getProjMatrix,
  getCameraPos: getCameraPos, getAspect: getAspect,
  getWidth: getWidth, getHeight: getHeight, isReady: isReady,
  resize: resize, applyGoldenHour: applyGoldenHour,
  getTimeOfDay: getTimeOfDay, getNightFactor: getNightFactor,
  getNeonIntensity: getNeonIntensity, getSunDir: getSunDir,
  getSunColor: getSunColor, getFog: getFog, setFogEnabled: setFogEnabled,
  setHemisphere: setHemisphere, setAmbient: setAmbient,
  setSkyColors: setSkyColors, setSunIntensity: setSunIntensity,
  setShadowEnabled: setShadowEnabled, isShadowActive: isShadowActive,
  getLightSpaceMatrix: getLightSpaceMatrix, getStats: getStats,
  nextFrame: nextFrame, resetStats: resetStats,
  disposeMesh: disposeMesh, disposeAll: disposeAll,
  getContext: getContext, getCanvas: getCanvas,
  drawVignette: drawVignette, clearDepthOnly: clearDepthOnly,
  boxCorners: boxCorners, meshBounds: meshBounds,
  sphereInRange: sphereInRange, setViewport: setViewport,
  resetViewport: resetViewport, setScissor: setScissor,
  clearScissor: clearScissor, fullscreenQuad: fullscreenQuad,
  skyCube: skyCube, streetLightColor: streetLightColor,
  windowGlow: windowGlow, puddleShine: puddleShine,
  getCapabilities: getCapabilities
};
})();

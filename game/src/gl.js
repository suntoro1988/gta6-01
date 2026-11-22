window.SB = window.SB || {};
// gl.js — Sunset Bay v12 (Builder B: graphics engine)
// WebGL murni, tanpa library eksternal. Mesin render golden hour:
//  - directional matahari oranye rendah (#ff9a3c) + hemisphere biru dingin
//  - fog / haze hangat, langit gradien oranye -> ungu
//  - shadow map directional 1024x1024, bayangan panjang
//  - emissive (jendela & neon menyala), warna per-vertex
//  - post-processing: vignette ringan lewat render-to-texture
//
// API spec (WAJIB): init(canvas), clear(r,g,b), useProgram(name),
//   drawMesh(mesh, matrix, color), setSun(dir, color),
//   setFog(color, near, far), beginShadow(), endShadow().
// Tambahan internal: beginFrame(view, proj), endFrame(), drawSky(),
//   createMesh(data), setTimeOfDay(h), resize(), stats.
(function () {
  'use strict';

  var M3 = null; // diisi saat init dari window.SB.Math3

  // ------------------------------------------------------------------
  // State internal
  // ------------------------------------------------------------------
  var gl = null;
  var canvas = null;
  var isWebGL2 = false;
  var programs = {};       // nama -> { program, attribs, uniforms }
  var currentProgram = null;
  var currentProgramName = '';
  var meshCache = {};      // key -> mesh GL
  var meshCacheOrder = [];
  var MAX_MESH_CACHE = 512;

  // Kamera & pencahayaan frame aktif
  var viewMatrix = null;
  var projMatrix = null;
  var viewProj = null;
  var cameraPos = { x: 0, y: 8, z: 12 };
  var timeOfDay = 18.33;   // jam; 18.33 = 18:20 golden hour
  var sunDir = { x: -0.55, y: -0.28, z: -0.79 }; // arah KE matahari (dinormalisasi)
  var sunColor = [1.0, 0.60, 0.24];              // oranye #ff9a3c
  var sunIntensity = 1.15;
  var hemiSky = [0.42, 0.55, 0.85];              // biru dingin langit
  var hemiGround = [0.32, 0.20, 0.16];           // pantulan tanah hangat
  var hemiIntensity = 0.55;
  var fogColor = [0.98, 0.62, 0.38];
  var fogNear = 90, fogFar = 420;
  var fogDensity = 1.0;
  var ambientBoost = 0.06;

  // Shadow map
  var SHADOW_SIZE = 1024;
  var shadowFBO = null;
  var shadowTex = null;
  var shadowDepthRB = null;
  var lightView = null;
  var lightProj = null;
  var lightViewProj = null;
  var shadowBias = 0.0016;
  var shadowEnabled = true;
  var softwareRenderer = false; // true bila GL init mendeteksi SwiftShader/dll
  var inShadowPass = false;
  var shadowBounds = 130; // setengah lebar ortho shadow (meter)

  // Post-processing (render scene ke texture, lalu blit + vignette)
  var sceneFBO = null;
  var sceneTex = null;
  var sceneDepthRB = null;
  var sceneW = 0, sceneH = 0;
  var postEnabled = true;
  var vignetteStrength = 0.42;
  var vignetteSoftness = 0.55;
  var exposure = 1.06;
  var inScenePass = false;

  // Statistik frame (untuk HUD debug / fps badge)
  var stats = { drawCalls: 0, triangles: 0, meshes: 0, shadowCalls: 0 };

  // Warna langit per fase hari (dipakai drawSky + clear fallback)
  var SKY_STOPS = [
    // [jam, horizonTop, horizonBottom, fog]
    { h: 0,  top: [0.05, 0.07, 0.22], mid: [0.13, 0.12, 0.32], low: [0.22, 0.16, 0.38] },
    { h: 5,  top: [0.10, 0.12, 0.30], mid: [0.25, 0.20, 0.38], low: [0.42, 0.28, 0.38] },
    { h: 7,  top: [0.35, 0.55, 0.85], mid: [0.75, 0.72, 0.78], low: [0.98, 0.80, 0.60] },
    { h: 12, top: [0.25, 0.55, 0.95], mid: [0.55, 0.75, 0.95], low: [0.85, 0.88, 0.95] },
    { h: 16, top: [0.30, 0.55, 0.90], mid: [0.65, 0.72, 0.88], low: [0.99, 0.82, 0.55] },
    { h: 18.33, top: [0.45, 0.22, 0.55], mid: [0.98, 0.45, 0.30], low: [1.00, 0.62, 0.24] },
    { h: 19.5, top: [0.16, 0.10, 0.38], mid: [0.55, 0.22, 0.42], low: [0.95, 0.38, 0.30] },
    { h: 21, top: [0.04, 0.05, 0.18], mid: [0.10, 0.08, 0.28], low: [0.20, 0.12, 0.34] },
    { h: 24, top: [0.05, 0.07, 0.22], mid: [0.13, 0.12, 0.32], low: [0.22, 0.16, 0.38] }
  ];

  // ------------------------------------------------------------------
  // SHADER: program utama (lit) — per-vertex color + emissive + fog + shadow
  // ------------------------------------------------------------------
  var VERT_LIT = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec3 aColor;',
    'attribute float aEmissive;',
    'uniform mat4 uModel;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform mat4 uLightVP;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying float vEmissive;',
    'varying vec3 vWorld;',
    'varying vec4 vShadowCoord;',
    'varying float vFogDepth;',
    'void main() {',
    '  vec4 world = uModel * vec4(aPos, 1.0);',
    '  vWorld = world.xyz;',
    '  vNormal = mat3(uModel) * aNormal;',
    '  vColor = aColor;',
    '  vEmissive = aEmissive;',
    '  vShadowCoord = uLightVP * world;',
    '  vec4 viewPos = uView * world;',
    '  vFogDepth = -viewPos.z;',
    '  gl_Position = uProj * viewPos;',
    '}'
  ].join('\n');

  var FRAG_LIT = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying float vEmissive;',
    'varying vec3 vWorld;',
    'varying vec4 vShadowCoord;',
    'varying float vFogDepth;',
    'uniform vec3 uSunDir;',      // arah KE matahari (ternormalisasi)
    'uniform vec3 uSunColor;',
    'uniform float uSunIntensity;',
    'uniform vec3 uHemiSky;',
    'uniform vec3 uHemiGround;',
    'uniform float uHemiIntensity;',
    'uniform vec3 uTint;',        // tint per-draw (warna mobil dll)
    'uniform vec3 uFogColor;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform sampler2D uShadowMap;',
    'uniform float uUseShadow;',
    'uniform float uShadowBias;',
    'uniform float uTime;',
    'uniform float uNightGlow;',  // 0 siang .. 1 malam (neon menyala)
    'float shadowFactor(vec4 sc) {',
    '  if (uUseShadow < 0.5) return 1.0;',
    '  vec3 p = sc.xyz / sc.w;',
    '  p = p * 0.5 + 0.5;',
    '  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;',
    '  float closest = texture2D(uShadowMap, p.xy).r;',
    '  float cur = p.z - uShadowBias;',
    '  float s = 0.0;',
    '  vec2 texel = vec2(1.0 / 1024.0);',
    '  s += step(cur, texture2D(uShadowMap, p.xy + vec2(-texel.x, -texel.y)).r);',
    '  s += step(cur, texture2D(uShadowMap, p.xy + vec2( texel.x, -texel.y)).r);',
    '  s += step(cur, texture2D(uShadowMap, p.xy + vec2(-texel.x,  texel.y)).r);',
    '  s += step(cur, texture2D(uShadowMap, p.xy + vec2( texel.x,  texel.y)).r);',
    '  s += step(cur, closest);',
    '  return mix(0.42, 1.0, s / 5.0);',
    '}',
    'void main() {',
    '  vec3 N = normalize(vNormal);',
    '  vec3 L = normalize(uSunDir);',
    '  float ndl = max(dot(N, L), 0.0);',
    // Golden hour: matahari rendah -> diffuse hangat kuat di sisi
    // menghadap matahari, sisi berlawanan jatuh ke biru dingin.
    '  float wrap = pow(max(dot(N, L) * 0.5 + 0.5, 0.0), 1.6);',
    '  vec3 diffuse = uSunColor * (ndl * 0.85 + wrap * 0.35) * uSunIntensity;',
    '  float shadow = shadowFactor(vShadowCoord);',
    '  diffuse *= mix(0.55, 1.0, shadow);',
    // Hemisphere: langit biru dingin dari atas, tanah hangat dari bawah.
    '  float hemiT = N.y * 0.5 + 0.5;',
    '  vec3 hemi = mix(uHemiGround, uHemiSky, hemiT) * uHemiIntensity;',
    // Specular Blinn-Phong halus: pantulan kaca / bodi mobil basah.
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  vec3 H = normalize(L + V);',
    '  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.35 * shadow;',
    '  vec3 base = vColor * uTint;',
    '  vec3 col = base * (diffuse + hemi + 0.10);',
    '  col += uSunColor * spec * 0.9;',
    // Emissive: jendela & neon. Malam hari menyala penuh, siang redup.
    '  float glow = vEmissive * (0.25 + 0.85 * uNightGlow);',
    '  col += base * glow * 1.6;',
    '  col += uSunColor * glow * 0.35;',
    // Fog / haze hangat golden hour.
    '  float fogF = clamp((vFogDepth - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);',
    '  fogF = fogF * fogF * (3.0 - 2.0 * fogF);',
    '  col = mix(col, uFogColor, fogF);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Uniform kamera ditambahkan ke FRAG_LIT lewat string replace saat
  // kompilasi (menjaga shader tetap satu blok di atas).
  var FRAG_LIT_CAM = 'uniform vec3 uCamPos;\n';

  // ------------------------------------------------------------------
  // SHADER: depth (shadow map) — hanya posisi
  // ------------------------------------------------------------------
  var VERT_DEPTH = [
    'attribute vec3 aPos;',
    'uniform mat4 uModel;',
    'uniform mat4 uLightVP;',
    'void main() {',
    '  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);',
    '}'
  ].join('\n');

  var FRAG_DEPTH = [
    'precision mediump float;',
    'void main() {',
    '  gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------
  // SHADER: langit gradien (fullscreen triangle, tanpa depth)
  // ------------------------------------------------------------------
  var VERT_SKY = [
    'attribute vec2 aPos;',
    'varying vec2 vUV;',
    'void main() {',
    '  vUV = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.9999, 1.0);',
    '}'
  ].join('\n');

  var FRAG_SKY = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform vec3 uTop;',
    'uniform vec3 uMid;',
    'uniform vec3 uLow;',
    'uniform vec3 uSunDirView;', // arah matahari dalam view space (xy)'
    'uniform vec3 uSunColor;',
    'uniform float uTime;',
    'uniform float uStars;',     // 0..1 intensitas bintang malam
    'float hash21(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    'void main() {',
    '  float y = vUV.y;',
    // Gradien 3-stop: zenith -> horizon -> bawah cakrawala.
    '  vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.42, y));',
    '  col = mix(col, uTop, smoothstep(0.42, 1.0, y));',
    // Piringan matahari + halo hangat di sekitarnya.
    '  vec2 dir = vUV - vec2(0.5 + uSunDirView.x * 0.28, 0.42 + uSunDirView.y * 0.22);',
    '  float d = length(dir * vec2(1.6, 1.0));',
    '  float disc = smoothstep(0.055, 0.035, d);',
    '  float halo = pow(max(1.0 - d * 1.7, 0.0), 2.6);',
    '  col += uSunColor * (disc * 1.5 + halo * 0.85);',
    // Awan tipis prosedural (pita horizontal yang melayang pelan).
    '  float band = sin(vUV.y * 34.0 + uTime * 0.05 + sin(vUV.x * 9.0) * 1.4);',
    '  float cloud = smoothstep(0.55, 0.95, band) * smoothstep(0.25, 0.6, y) * (1.0 - smoothstep(0.8, 1.0, y));',
    '  col = mix(col, vec3(1.0, 0.82, 0.72), cloud * 0.16);',
    // Bintang saat malam.
    '  vec2 g = floor(vUV * vec2(160.0, 90.0));',
    '  float star = step(0.9975, hash21(g));',
    '  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + hash21(g + 7.0) * 20.0);',
    '  col += vec3(star * tw * uStars * smoothstep(0.35, 0.75, y));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------
  // SHADER: post-processing — blit scene texture + vignette + exposure
  // ------------------------------------------------------------------
  var VERT_POST = [
    'attribute vec2 aPos;',
    'varying vec2 vUV;',
    'void main() {',
    '  vUV = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG_POST = [
    'precision mediump float;',
    'varying vec2 vUV;',
    'uniform sampler2D uScene;',
    'uniform float uVignette;',
    'uniform float uSoftness;',
    'uniform float uExposure;',
    'uniform float uTime;',
    'void main() {',
    '  vec3 col = texture2D(uScene, vUV).rgb;',
    // Exposure + lift bayangan tipis (filmic-ish, murah).
    '  col = 1.0 - exp(-col * uExposure);',
    '  col = pow(col, vec3(0.96));',
    // Vignette ringan: gelapkan tepi, jaga tengah tetap terang.
    '  vec2 c = vUV - 0.5;',
    '  float r = length(c * vec2(1.25, 1.45));',
    '  float vig = 1.0 - uVignette * smoothstep(1.0 - uSoftness, 1.05, r);',
    '  col *= vig;',
    // Sedikit warm tint di tepi (golden hour bleed).
    '  col = mix(col, col * vec3(1.05, 0.94, 0.86), r * 0.22);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------
  // SHADER: air — dipakai modul water lewat useProgram('water')
  // (gelombang + fresnel + refleksi warna langit, tanpa tekstur)
  // ------------------------------------------------------------------
  var VERT_WATER = [
    'attribute vec3 aPos;',
    'attribute vec3 aNormal;',
    'attribute vec3 aColor;',
    'attribute float aEmissive;',
    'uniform mat4 uModel;',
    'uniform mat4 uView;',
    'uniform mat4 uProj;',
    'uniform mediump float uTime;', // mediump eksplisit: samakan dengan
    // 'precision mediump float' di FRAG_WATER — kalau tidak, linker
    // menolak (presisi uniform uTime beda antar shader).
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vWorld;',
    'varying float vFogDepth;',
    'void main() {',
    '  vec3 p = aPos;',
    '  float w1 = sin(p.x * 0.22 + uTime * 1.3) * 0.14;',
    '  float w2 = cos(p.z * 0.18 - uTime * 0.9) * 0.12;',
    '  float w3 = sin((p.x + p.z) * 0.09 + uTime * 0.5) * 0.18;',
    '  p.y += w1 + w2 + w3;',
    '  vec4 world = uModel * vec4(p, 1.0);',
    '  vWorld = world.xyz;',
    '  vNormal = mat3(uModel) * aNormal;',
    '  vColor = aColor;',
    '  vec4 viewPos = uView * world;',
    '  vFogDepth = -viewPos.z;',
    '  gl_Position = uProj * viewPos;',
    '}'
  ].join('\n');

  var FRAG_WATER = [
    'precision mediump float;',
    'varying vec3 vNormal;',
    'varying vec3 vColor;',
    'varying vec3 vWorld;',
    'varying float vFogDepth;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uHemiSky;',
    'uniform vec3 uFogColor;',
    'uniform float uFogNear;',
    'uniform float uFogFar;',
    'uniform vec3 uCamPos;',
    'uniform float uTime;',
    'void main() {',
    '  vec3 N = normalize(vNormal + vec3(',
    '    sin(vWorld.x * 0.6 + uTime * 1.7) * 0.18,',
    '    0.0,',
    '    cos(vWorld.z * 0.5 - uTime * 1.3) * 0.18));',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);',
    '  vec3 deep = vColor * 0.55;',
    '  vec3 skyRef = mix(vec3(0.98, 0.55, 0.30), uHemiSky, 0.45);',
    '  vec3 col = mix(deep, skyRef, clamp(0.25 + fres * 0.75, 0.0, 1.0));',
    '  vec3 L = normalize(uSunDir);',
    '  vec3 H = normalize(L + V);',
    '  float glitter = pow(max(dot(N, H), 0.0), 90.0) * 1.4;',
    '  col += uSunColor * glitter;',
    '  float fogF = clamp((vFogDepth - uFogNear) / max(uFogFar - uFogNear, 1.0), 0.0, 1.0);',
    '  fogF = fogF * fogF * (3.0 - 2.0 * fogF);',
    '  col = mix(col, uFogColor, fogF);',
    '  gl_FragColor = vec4(col, 0.92);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------
  // Kompilasi shader
  // ------------------------------------------------------------------
  function compileShader(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      var kind = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
      if (typeof console !== 'undefined' && console.error) {
        console.error('[SB.GL] compile ' + kind + ' gagal: ' + log);
      }
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function linkProgram(vsSrc, fsSrc) {
    var vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    var fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[SB.GL] link gagal: ' + gl.getProgramInfoLog(prog));
      }
      gl.deleteProgram(prog);
      return null;
    }
    // Kumpulkan lokasi attribute & uniform yang dipakai.
    var info = { program: prog, attribs: {}, uniforms: {} };
    var nA = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
    for (var i = 0; i < nA; i++) {
      var a = gl.getActiveAttrib(prog, i);
      if (a) info.attribs[a.name] = gl.getAttribLocation(prog, a.name);
    }
    var nU = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (var j = 0; j < nU; j++) {
      var u = gl.getActiveUniform(prog, j);
      if (u) info.uniforms[u.name] = gl.getUniformLocation(prog, u.name);
    }
    return info;
  }

  function getUniform(prog, name) {
    var u = prog.uniforms[name];
    return (u === undefined || u === null) ? null : u;
  }

  function setUniform3f(prog, name, v) {
    var u = getUniform(prog, name);
    if (u) gl.uniform3f(u, v[0], v[1], v[2]);
  }
  function setUniform1f(prog, name, v) {
    var u = getUniform(prog, name);
    if (u) gl.uniform1f(u, v);
  }
  function setUniformMat4(prog, name, m) {
    var u = getUniform(prog, name);
    if (u) gl.uniformMatrix4fv(u, false, m);
  }



  // ------------------------------------------------------------------
  // Langit: interpolasi warna berdasarkan jam
  // ------------------------------------------------------------------
  function skyStopsFor(h) {
    var hh = ((h % 24) + 24) % 24;
    var prev = SKY_STOPS[0], next = SKY_STOPS[SKY_STOPS.length - 1];
    for (var i = 0; i < SKY_STOPS.length; i++) {
      if (SKY_STOPS[i].h <= hh) prev = SKY_STOPS[i];
      if (SKY_STOPS[i].h >= hh) { next = SKY_STOPS[i]; break; }
    }
    var span = next.h - prev.h;
    var t = span > 0 ? (hh - prev.h) / span : 0;
    if (t < 0) t = 0; if (t > 1) t = 1;
    function mix3(a, b) {
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
      ];
    }
    return {
      top: mix3(prev.top, next.top),
      mid: mix3(prev.mid, next.mid),
      low: mix3(prev.low, next.low)
    };
  }

  // 0 = siang penuh, 1 = malam penuh. Golden hour ~0.15.
  function nightFactor(h) {
    var hh = ((h % 24) + 24) % 24;
    if (hh >= 20.5 || hh < 5.5) return 1;
    if (hh >= 19.5) return (hh - 19.5) / 1.0;
    if (hh < 6.5) return 1 - (hh - 5.5) / 1.0;
    if (hh >= 17.5 && hh < 18.8) return 0.15;
    return 0;
  }

  // Posisi matahari dari jam: terbit timur (06.00), tenggelam barat (19.00).
  // Mengembalikan arah KE matahari (ternormalisasi).
  function sunDirFor(h) {
    var hh = ((h % 24) + 24) % 24;
    var frac = (hh - 6) / 13;             // 0 saat terbit, 1 saat tenggelam
    if (frac < 0) frac = 0; if (frac > 1) frac = 1;
    var elev = Math.sin(frac * Math.PI) * 0.95;   // ketinggian 0..~1
    var azim = frac * Math.PI;                    // timur -> barat
    var d = {
      x: Math.cos(azim) * 0.85,
      y: 0.12 + elev * 0.85,
      z: -0.45
    };
    return M3.normalize(d);
  }

  // ------------------------------------------------------------------
  // Framebuffer helpers
  // ------------------------------------------------------------------
  function createDepthTexture(size) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function createColorTexture(w, h) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  function createDepthRenderbuffer(w, h) {
    var rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    return rb;
  }

  function buildShadowFBO() {
    if (shadowFBO) {
      gl.deleteFramebuffer(shadowFBO);
      gl.deleteTexture(shadowTex);
      gl.deleteRenderbuffer(shadowDepthRB);
    }
    shadowTex = createDepthTexture(SHADOW_SIZE);
    shadowDepthRB = createDepthRenderbuffer(SHADOW_SIZE, SHADOW_SIZE);
    shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowDepthRB);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { shadowEnabled = false; }
  }

  function buildSceneFBO(w, h) {
    if (sceneFBO) {
      gl.deleteFramebuffer(sceneFBO);
      gl.deleteTexture(sceneTex);
      gl.deleteRenderbuffer(sceneDepthRB);
    }
    sceneW = w; sceneH = h;
    sceneTex = createColorTexture(w, h);
    sceneDepthRB = createDepthRenderbuffer(w, h);
    sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepthRB);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { postEnabled = false; }
  }

  // ------------------------------------------------------------------
  // init(canvas) — API spec
  // ------------------------------------------------------------------
  function init(c) {
    M3 = window.SB.Math3;
    canvas = c;
    var opts = { antialias: true, alpha: false, depth: true, stencil: false,
                 preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) ||
         canvas.getContext('experimental-webgl', opts);
    if (!gl) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[SB.GL] WebGL tidak tersedia di browser ini.');
      }
      return false;
    }
    isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined') &&
               (gl instanceof WebGL2RenderingContext);

    // Renderer software (SwiftShader / llvmpipe) tidak kuat menjalankan
    // shadow pass 1024 + PCF 5-tap: satu frame bisa macet puluhan detik
    // dan tab headless tidak pernah lanjut (frame 2 tidak pernah tiba).
    // Di renderer software, matikan shadow & post sejak awal; GPU asli
    // tetap jalan kualitas penuh. Flag ini juga mengunci setShadowEnabled
    // / setPostEnabled agar adaptive-perf tidak menyalakannya lagi.
    try {
      var dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
      var rendererStr = '';
      if (dbgInfo) {
        rendererStr = String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || '');
      }
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererStr)) {
        softwareRenderer = true;
        shadowEnabled = false;
        postEnabled = false;
        if (typeof console !== 'undefined' && console.info) {
          console.info('[SB.GL] renderer software terdeteksi — shadow & post dimatikan: ' + rendererStr);
        }
      }
    } catch (e) { /* abaikan: lanjut kualitas penuh */ }

    // Kompilasi semua program. FRAG_LIT butuh uniform kamera.
    var fragLit = FRAG_LIT.replace('precision mediump float;',
      'precision mediump float;\nuniform vec3 uCamPos;');
    programs.lit = linkProgram(VERT_LIT, fragLit);
    programs.depth = linkProgram(VERT_DEPTH, FRAG_DEPTH);
    programs.sky = linkProgram(VERT_SKY, FRAG_SKY);
    programs.post = linkProgram(VERT_POST, FRAG_POST);
    programs.water = linkProgram(VERT_WATER, FRAG_WATER);
    if (!programs.lit || !programs.depth || !programs.sky ||
        !programs.post || !programs.water) {
      return false;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1.0);
    gl.clearDepth(1.0);

    buildShadowFBO();
    resize();
    updateSunFromTime();
    return true;
  }

  // Sinkronkan matahari + fog + hemisphere dengan jam hari ini.
  function updateSunFromTime() {
    var d = sunDirFor(timeOfDay);
    sunDir = d;
    var night = nightFactor(timeOfDay);
    var golden = 1 - Math.abs(timeOfDay - 18.33) / 2.2;
    if (golden < 0) golden = 0; if (golden > 1) golden = 1;
    // Siang: matahari putih-kuning tinggi. Golden hour: oranye rendah.
    // Malam: bulan pucat kebiruan, intensitas kecil.
    if (night >= 0.99) {
      sunColor = [0.55, 0.62, 0.85];
      sunIntensity = 0.22;
      hemiSky = [0.10, 0.12, 0.28];
      hemiGround = [0.08, 0.07, 0.12];
      hemiIntensity = 0.35;
      fogColor = [0.10, 0.10, 0.20];
    } else if (golden > 0.4) {
      sunColor = [1.0, 0.60, 0.24];
      sunIntensity = 1.15 + golden * 0.25;
      hemiSky = [0.42, 0.55, 0.85];
      hemiGround = [0.34, 0.20, 0.15];
      hemiIntensity = 0.55;
      fogColor = [0.98, 0.62, 0.38];
    } else {
      var warm = 1 - night;
      sunColor = [1.0, 0.85 - 0.25 * (1 - warm), 0.55];
      sunIntensity = 0.55 + 0.6 * warm;
      hemiSky = [0.42, 0.58, 0.9];
      hemiGround = [0.30, 0.26, 0.22];
      hemiIntensity = 0.6;
      fogColor = [0.82, 0.85, 0.92];
    }
    ambientBoost = 0.06 + night * 0.02;
  }

  // Sesuaikan ukuran drawing buffer dengan ukuran CSS canvas.
  function resize() {
    if (!gl || !canvas) return;
    var w = canvas.clientWidth || canvas.width || 1280;
    var h = canvas.clientHeight || canvas.height || 720;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var bw = Math.floor(w * dpr);
    var bh = Math.floor(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (postEnabled && (sceneW !== canvas.width || sceneH !== canvas.height)) {
      buildSceneFBO(canvas.width, canvas.height);
    }
  }

  // ------------------------------------------------------------------
  // clear(r, g, b) — API spec
  // ------------------------------------------------------------------
  function clear(r, g, b) {
    if (!gl) return;
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  // ------------------------------------------------------------------
  // useProgram(name) — API spec
  // ------------------------------------------------------------------
  function useProgram(name) {
    var p = programs[name];
    if (!p) return false;
    if (currentProgramName !== name) {
      gl.useProgram(p.program);
      currentProgram = p;
      currentProgramName = name;
    }
    return true;
  }

  // ------------------------------------------------------------------
  // Mesh: upload data {vertices, normals, colors?, emissive?, indices}
  // ------------------------------------------------------------------
  function meshKey(data) {
    // Kunci murah: jumlah vertex + jumlah index + checksum kasar.
    var sum = 0;
    var v = data.vertices || [];
    var step = Math.max(1, Math.floor(v.length / 64));
    for (var i = 0; i < v.length; i += step) sum += v[i] * 1000;
    return 'm' + v.length + '_' + (data.indices ? data.indices.length : 0) +
           '_' + Math.floor(sum);
  }

  function createMesh(data) {
    if (!gl || !data || !data.vertices || !data.indices) return null;
    var key = meshKey(data);
    var cached = meshCache[key];
    if (cached) return cached;

    var vCount = data.vertices.length / 3;
    var colors = data.colors;
    if (!colors || colors.length !== vCount * 3) {
      colors = new Float32Array(vCount * 3);
      for (var i = 0; i < vCount; i++) {
        colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
      }
    }
    var emissive = data.emissive;
    if (!emissive || emissive.length !== vCount) {
      emissive = new Float32Array(vCount);
    }
    var normals = data.normals;
    if (!normals || normals.length !== vCount * 3) {
      normals = computeNormals(data.vertices, data.indices);
    }

    var mesh = {
      key: key,
      vbo: gl.createBuffer(),
      nbo: gl.createBuffer(),
      cbo: gl.createBuffer(),
      ebo: gl.createBuffer(),
      ibo: gl.createBuffer(),
      indexCount: data.indices.length,
      vertexCount: vCount
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.cbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.ebo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(emissive), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    var idx = data.indices.length > 65535
      ? new Uint32Array(data.indices) : new Uint16Array(data.indices);
    mesh.indexType = data.indices.length > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    meshCache[key] = mesh;
    meshCacheOrder.push(key);
    if (meshCacheOrder.length > MAX_MESH_CACHE) {
      var old = meshCacheOrder.shift();
      var om = meshCache[old];
      if (om) {
        gl.deleteBuffer(om.vbo); gl.deleteBuffer(om.nbo);
        gl.deleteBuffer(om.cbo); gl.deleteBuffer(om.ebo);
        gl.deleteBuffer(om.ibo);
      }
      delete meshCache[old];
    }
    stats.meshes = meshCacheOrder.length;
    return mesh;
  }

  // Hitung normal per-vertex dari segitiga (rata-rata face normal).
  function computeNormals(vertices, indices) {
    var vCount = vertices.length / 3;
    var n = new Float32Array(vCount * 3);
    for (var i = 0; i + 2 < indices.length; i += 3) {
      var a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      var abx = vertices[b] - vertices[a];
      var aby = vertices[b + 1] - vertices[a + 1];
      var abz = vertices[b + 2] - vertices[a + 2];
      var acx = vertices[c] - vertices[a];
      var acy = vertices[c + 1] - vertices[a + 1];
      var acz = vertices[c + 2] - vertices[a + 2];
      var nx = aby * acz - abz * acy;
      var ny = abz * acx - abx * acz;
      var nz = abx * acy - aby * acx;
      var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
      n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
      n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    for (var j = 0; j < vCount; j++) {
      var x = n[j * 3], y = n[j * 3 + 1], z = n[j * 3 + 2];
      var l = Math.sqrt(x * x + y * y + z * z) || 1;
      n[j * 3] = x / l; n[j * 3 + 1] = y / l; n[j * 3 + 2] = z / l;
    }
    return n;
  }

  // Ikat attribute mesh ke program aktif.
  function bindMeshAttribs(prog, mesh) {
    var aPos = prog.attribs.aPos;
    if (aPos !== undefined && aPos >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    }
    var aNormal = prog.attribs.aNormal;
    if (aNormal !== undefined && aNormal >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
      gl.enableVertexAttribArray(aNormal);
      gl.vertexAttribPointer(aNormal, 3, gl.FLOAT, false, 0, 0);
    }
    var aColor = prog.attribs.aColor;
    if (aColor !== undefined && aColor >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.cbo);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0);
    }
    var aEm = prog.attribs.aEmissive;
    if (aEm !== undefined && aEm >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.ebo);
      gl.enableVertexAttribArray(aEm);
      gl.vertexAttribPointer(aEm, 1, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
  }

  // ------------------------------------------------------------------
  // drawMesh(mesh, matrix, color) — API spec
  // mesh: data mentah {vertices, normals, indices} ATAU mesh GL hasil
  // createMesh. matrix: Float32Array(16) model. color: [r,g,b] tint
  // atau hex "#rrggbb". Saat shadow pass aktif, digambar ke depth map.
  // ------------------------------------------------------------------
  function drawMesh(mesh, matrix, color) {
    if (!gl || !mesh) return;
    var m = matrix || M3.mat4Identity();
    if (inShadowPass) {
      var dp = programs.depth;
      if (!dp) return;
      useProgram('depth');
      setUniformMat4(dp, 'uModel', m);
      // lightViewProj null bila shadow pass tidak jalan (bayangan mati) —
      // jangan upload null: uniformMatrix4fv(null) melempar dan seluruh
      // draw modul gagal (dunia jadi tak terlihat sama sekali).
      if (lightViewProj) setUniformMat4(dp, 'uLightVP', lightViewProj);
      var gm = mesh.key ? mesh : createMesh(mesh);
      if (!gm) return;
      bindMeshAttribs(dp, gm);
      gl.drawElements(gl.TRIANGLES, gm.indexCount, gm.indexType, 0);
      stats.shadowCalls++;
      stats.triangles += gm.indexCount / 3;
      return;
    }

    var progName = currentProgramName === 'water' ? 'water' : 'lit';
    var prog = programs[progName];
    if (!prog) return;
    useProgram(progName);

    var gm2 = mesh.key ? mesh : createMesh(mesh);
    if (!gm2) return;

    var tint = [1, 1, 1];
    if (color) {
      if (typeof color === 'string') tint = M3.hexToRgb(color);
      else if (Array.isArray(color) && color.length >= 3) tint = [color[0], color[1], color[2]];
    }

    setUniformMat4(prog, 'uModel', m);
    setUniformMat4(prog, 'uView', viewMatrix);
    setUniformMat4(prog, 'uProj', projMatrix);
    if (progName === 'lit') {
      // uLightVP hanya dipakai shader bila uUseShadow=1; bila bayangan
      // mati, lightViewProj masih null (beginShadow tidak jalan) — upload
      // null akan melempar dan menggagalkan seluruh draw modul ini.
      if (lightViewProj) setUniformMat4(prog, 'uLightVP', lightViewProj);
      setUniform3f(prog, 'uSunDir', [sunDir.x, sunDir.y, sunDir.z]);
      setUniform3f(prog, 'uSunColor', sunColor);
      setUniform1f(prog, 'uSunIntensity', sunIntensity);
      setUniform3f(prog, 'uHemiSky', hemiSky);
      setUniform3f(prog, 'uHemiGround', hemiGround);
      setUniform1f(prog, 'uHemiIntensity', hemiIntensity);
      setUniform3f(prog, 'uTint', tint);
      setUniform3f(prog, 'uFogColor', fogColor);
      setUniform1f(prog, 'uFogNear', fogNear);
      setUniform1f(prog, 'uFogFar', fogFar);
      setUniform1f(prog, 'uUseShadow', shadowEnabled ? 1 : 0);
      setUniform1f(prog, 'uShadowBias', shadowBias);
      setUniform1f(prog, 'uNightGlow', nightFactor(timeOfDay));
      setUniform3f(prog, 'uCamPos', [cameraPos.x, cameraPos.y, cameraPos.z]);
      setUniform1f(prog, 'uTime', SB.state ? SB.state.time : 0);
      var su = getUniform(prog, 'uShadowMap');
      if (su) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);
        gl.uniform1i(su, 0);
      }
    } else {
      // water
      setUniform3f(prog, 'uSunDir', [sunDir.x, sunDir.y, sunDir.z]);
      setUniform3f(prog, 'uSunColor', sunColor);
      setUniform3f(prog, 'uHemiSky', hemiSky);
      setUniform3f(prog, 'uFogColor', fogColor);
      setUniform1f(prog, 'uFogNear', fogNear);
      setUniform1f(prog, 'uFogFar', fogFar);
      setUniform3f(prog, 'uCamPos', [cameraPos.x, cameraPos.y, cameraPos.z]);
      setUniform1f(prog, 'uTime', SB.state ? SB.state.time : 0);
    }

    bindMeshAttribs(prog, gm2);
    gl.drawElements(gl.TRIANGLES, gm2.indexCount, gm2.indexType, 0);
    stats.drawCalls++;
    stats.triangles += gm2.indexCount / 3;
  }

  // Gambar mesh dengan program air (dipakai SB.Water).
  function drawWaterMesh(mesh, matrix, color) {
    var prev = currentProgramName;
    useProgram('water');
    drawMesh(mesh, matrix, color);
    if (prev && prev !== 'water') useProgram(prev);
  }

  // ------------------------------------------------------------------
  // Shadow pass — API spec: beginShadow() / endShadow()
  // ------------------------------------------------------------------
  function updateLightMatrices(focus) {
    var f = focus || cameraPos;
    var lightPos = {
      x: f.x + sunDir.x * 160,
      y: f.y + sunDir.y * 160 + 60,
      z: f.z + sunDir.z * 160
    };
    // Matahari rendah -> bayangan panjang: naikkan posisi cahaya
    // sedikit agar ortho tetap mencakup kota di sekitar kamera.
    lightView = M3.mat4LookAt(lightPos, { x: f.x, y: 0, z: f.z }, { x: 0, y: 1, z: 0 });
    lightProj = M3.mat4Ortho(-shadowBounds, shadowBounds, -shadowBounds,
      shadowBounds, 1, 420);
    lightViewProj = M3.mat4Multiply(lightProj, lightView);
  }

  function beginShadow() {
    if (!gl || !shadowEnabled || !shadowFBO) return false;
    updateLightMatrices(cameraPos);
    inShadowPass = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFBO);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT); // kurangi acne bayangan
    return true;
  }

  function endShadow() {
    if (!gl) return;
    inShadowPass = false;
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, inScenePass ? sceneFBO : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // ------------------------------------------------------------------
  // Frame: beginFrame(view, proj, eye) / endFrame() — post vignette
  // ------------------------------------------------------------------
  function beginFrame(view, proj, eye) {
    if (!gl) return;
    resize();
    viewMatrix = view;
    projMatrix = proj;
    viewProj = M3.mat4Multiply(proj, view);
    if (eye) cameraPos = { x: eye.x, y: eye.y, z: eye.z };
    stats.drawCalls = 0;
    stats.triangles = 0;
    stats.shadowCalls = 0;

    if (postEnabled && sceneFBO) {
      inScenePass = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFBO);
      gl.viewport(0, 0, canvas.width, canvas.height);
    } else {
      inScenePass = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    var sky = skyStopsFor(timeOfDay);
    gl.clearColor(sky.mid[0], sky.mid[1], sky.mid[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSky();
  }

  function endFrame() {
    if (!gl) return;
    if (postEnabled && sceneFBO && inScenePass) {
      inScenePass = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      useProgram('post');
      var prog = programs.post;
      var su = getUniform(prog, 'uScene');
      if (su) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sceneTex);
        gl.uniform1i(su, 0);
      }
      setUniform1f(prog, 'uVignette', vignetteStrength);
      setUniform1f(prog, 'uSoftness', vignetteSoftness);
      setUniform1f(prog, 'uExposure', exposure);
      setUniform1f(prog, 'uTime', SB.state ? SB.state.time : 0);
      drawFullscreenQuad(prog);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    currentProgramName = '';
    currentProgram = null;
  }

  // Quad fullscreen: segitiga besar (3 vertex, tanpa buffer indeks).
  var quadVBO = null;
  function drawFullscreenQuad(prog) {
    if (!quadVBO) {
      quadVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    var aPos = prog.attribs.aPos;
    if (aPos !== undefined && aPos >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // Langit gradien golden hour + matahari + bintang.
  function drawSky() {
    var prog = programs.sky;
    if (!prog) return;
    useProgram('sky');
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    var sky = skyStopsFor(timeOfDay);
    setUniform3f(prog, 'uTop', sky.top);
    setUniform3f(prog, 'uMid', sky.mid);
    setUniform3f(prog, 'uLow', sky.low);
    setUniform3f(prog, 'uSunColor', sunColor);
    setUniform1f(prog, 'uTime', SB.state ? SB.state.time : 0);
    setUniform1f(prog, 'uStars', nightFactor(timeOfDay));
    // Proyeksikan arah matahari ke view space (x, y saja).
    var sd = M3.mat4TransformDir(viewMatrix, sunDir);
    setUniform3f(prog, 'uSunDirView', [sd.x, sd.y, sd.z]);
    drawFullscreenQuad(prog);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }

  // ------------------------------------------------------------------
  // Setter API spec: setSun(dir, color), setFog(color, near, far)
  // ------------------------------------------------------------------
  function setSun(dir, color) {
    if (dir) {
      var d = M3.vec3From(dir);
      if (M3.lengthSq(d) > 1e-8) sunDir = M3.normalize(d);
    }
    if (color) {
      if (typeof color === 'string') sunColor = M3.hexToRgb(color);
      else if (Array.isArray(color)) sunColor = [color[0], color[1], color[2]];
    }
  }

  function setSunIntensity(v) {
    sunIntensity = Math.max(0, v);
  }

  function setFog(color, near, far) {
    if (color) {
      if (typeof color === 'string') fogColor = M3.hexToRgb(color);
      else if (Array.isArray(color)) fogColor = [color[0], color[1], color[2]];
    }
    if (typeof near === 'number') fogNear = near;
    if (typeof far === 'number') fogFar = far;
  }

  function setTimeOfDay(h) {
    timeOfDay = ((h % 24) + 24) % 24;
    updateSunFromTime();
  }

  function setVignette(strength, softness) {
    if (typeof strength === 'number') vignetteStrength = strength;
    if (typeof softness === 'number') vignetteSoftness = softness;
  }

  function setExposure(v) {
    if (typeof v === 'number') exposure = v;
  }

  // Di renderer software, shadow/post terkunci mati (lihat init):
  // adaptive-perf tidak boleh menyalakannya lagi.
  function setShadowEnabled(v) { shadowEnabled = softwareRenderer ? false : !!v; }
  function setPostEnabled(v) { postEnabled = softwareRenderer ? false : !!v; }
  function setShadowBounds(v) {
    if (typeof v === 'number' && v > 10) shadowBounds = v;
  }

  // Proyeksi titik dunia ke layar (0..1). Berguna untuk HUD marker.
  function projectToScreen(p) {
    if (!viewProj) return null;
    var clip = M3.mat4TransformPoint(viewProj, p);
    return { x: clip.x * 0.5 + 0.5, y: 0.5 - clip.y * 0.5, z: clip.z, behind: clip.z > 1 || clip.z < -1 };
  }

  function getStats() {
    return {
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      meshes: stats.meshes,
      shadowCalls: stats.shadowCalls,
      webgl2: isWebGL2,
      width: canvas ? canvas.width : 0,
      height: canvas ? canvas.height : 0
    };
  }

  function getContext() { return gl; }
  function getCanvas() { return canvas; }

  // ------------------------------------------------------------------
  // Ekspor namespace
  // ------------------------------------------------------------------
  window.SB.GL = {
    // API spec
    init: init,
    clear: clear,
    useProgram: useProgram,
    drawMesh: drawMesh,
    setSun: setSun,
    setFog: setFog,
    beginShadow: beginShadow,
    endShadow: endShadow,
    // Frame & utilitas
    beginFrame: beginFrame,
    endFrame: endFrame,
    drawSky: drawSky,
    drawWaterMesh: drawWaterMesh,
    createMesh: createMesh,
    computeNormals: computeNormals,
    resize: resize,
    setTimeOfDay: setTimeOfDay,
    setSunIntensity: setSunIntensity,
    setVignette: setVignette,
    setExposure: setExposure,
    setShadowEnabled: setShadowEnabled,
    setPostEnabled: setPostEnabled,
    setShadowBounds: setShadowBounds,
    updateSunFromTime: updateSunFromTime,
    projectToScreen: projectToScreen,
    skyStopsFor: skyStopsFor,
    nightFactor: nightFactor,
    sunDirFor: sunDirFor,
    getStats: getStats,
    getContext: getContext,
    getCanvas: getCanvas,
    get softwareRenderer() { return softwareRenderer; },
    get timeOfDay() { return timeOfDay; },
    get sunDir() { return sunDir; },
    get sunColor() { return sunColor; },
    get fogColor() { return fogColor; }
  };
})();

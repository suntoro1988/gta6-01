// Sunset Bay — gl.js
// Wrapper WebGL mentah (tanpa three.js) untuk Sunset Bay (v10, ditulis dari nol).
// Menyediakan: initGL(canvas), compileShader, createProgram, createBuffer,
// drawMesh(mesh, matrix), setUniforms. Shader warna-per-vertex sederhana
// dengan pencahayaan difus dari arah matahari tetap.

const SB = (typeof window !== 'undefined' ? (window.SB = window.SB || {}) : (globalThis.SB = globalThis.SB || {}));

const VERTEX_SHADER_SRC = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
varying vec3 vColor;
varying vec3 vNormal;
void main() {
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vColor = aColor;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * worldPos;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
uniform vec3 uSunDir;
uniform float uBrightness;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  float light = 0.45 + 0.55 * diff;
  gl_FragColor = vec4(vColor * light * uBrightness, 1.0);
}
`;

const GLState = {
  gl: null,
  canvas: null,
  program: null,
  attribs: { position: -1, color: -1, normal: -1 },
  uniforms: { model: null, view: null, proj: null, sunDir: null, brightness: null },
  view: null,
  proj: null,
  sunDir: { x: 0.5, y: 0.8, z: 0.3 },
  brightness: 1.0,
  clearColor: [0.53, 0.75, 0.94, 1.0],
};

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile failed: ' + log);
  }
  return shader;
}

function createProgram(gl, vertexSrc, fragmentSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link failed: ' + log);
  }
  return program;
}

function createBuffer(gl, data, usage) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  return buffer;
}

function createIndexBuffer(gl, data, usage) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  return buffer;
}

// mesh: { positions: Float32Array, colors: Float32Array, normals: Float32Array,
//         indices: Uint16Array, count: number }
// Jika mesh belum punya buffer GL, buat dan cache di mesh._gl.
function prepareMesh(gl, mesh) {
  if (mesh._gl) return mesh._gl;
  const prepared = {
    positionBuffer: createBuffer(gl, mesh.positions),
    colorBuffer: createBuffer(gl, mesh.colors),
    normalBuffer: createBuffer(gl, mesh.normals),
    indexBuffer: mesh.indices ? createIndexBuffer(gl, mesh.indices) : null,
    count: mesh.count || (mesh.indices ? mesh.indices.length : mesh.positions.length / 3),
  };
  mesh._gl = prepared;
  return prepared;
}

function setUniforms(gl, program, uniforms) {
  const locs = GLState.uniforms;
  if (uniforms.model && locs.model) gl.uniformMatrix4fv(locs.model, false, uniforms.model);
  if (uniforms.view && locs.view) gl.uniformMatrix4fv(locs.view, false, uniforms.view);
  if (uniforms.proj && locs.proj) gl.uniformMatrix4fv(locs.proj, false, uniforms.proj);
  if (uniforms.sunDir && locs.sunDir) gl.uniform3f(locs.sunDir, uniforms.sunDir.x, uniforms.sunDir.y, uniforms.sunDir.z);
  if (typeof uniforms.brightness === 'number' && locs.brightness) gl.uniform1f(locs.brightness, uniforms.brightness);
}

function drawMesh(mesh, matrix) {
  const gl = GLState.gl;
  if (!gl || !GLState.program) return;
  const prepared = prepareMesh(gl, mesh);
  gl.useProgram(GLState.program);
  if (GLState.view) gl.uniformMatrix4fv(GLState.uniforms.view, false, GLState.view);
  if (GLState.proj) gl.uniformMatrix4fv(GLState.uniforms.proj, false, GLState.proj);
  gl.uniformMatrix4fv(GLState.uniforms.model, false, matrix);
  gl.uniform3f(GLState.uniforms.sunDir, GLState.sunDir.x, GLState.sunDir.y, GLState.sunDir.z);
  gl.uniform1f(GLState.uniforms.brightness, GLState.brightness);

  gl.bindBuffer(gl.ARRAY_BUFFER, prepared.positionBuffer);
  gl.enableVertexAttribArray(GLState.attribs.position);
  gl.vertexAttribPointer(GLState.attribs.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, prepared.colorBuffer);
  gl.enableVertexAttribArray(GLState.attribs.color);
  gl.vertexAttribPointer(GLState.attribs.color, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, prepared.normalBuffer);
  gl.enableVertexAttribArray(GLState.attribs.normal);
  gl.vertexAttribPointer(GLState.attribs.normal, 3, gl.FLOAT, false, 0, 0);

  if (prepared.indexBuffer) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prepared.indexBuffer);
    gl.drawElements(gl.TRIANGLES, prepared.count, gl.UNSIGNED_SHORT, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, prepared.count);
  }
}

function resizeCanvasToDisplaySize(canvas) {
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    return true;
  }
  return false;
}

function beginFrame() {
  const gl = GLState.gl;
  if (!gl) return;
  resizeCanvasToDisplaySize(GLState.canvas);
  gl.viewport(0, 0, GLState.canvas.width, GLState.canvas.height);
  gl.clearColor(GLState.clearColor[0], GLState.clearColor[1], GLState.clearColor[2], GLState.clearColor[3]);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

function setView(viewMatrix) {
  GLState.view = viewMatrix;
}

function setProj(projMatrix) {
  GLState.proj = projMatrix;
}

function setSunDir(dir) {
  // dir adalah objek {x,y,z}
  GLState.sunDir = { x: dir.x, y: dir.y, z: dir.z };
}

function setBrightness(value) {
  GLState.brightness = value;
}

function setClearColor(r, g, b, a) {
  GLState.clearColor = [r, g, b, a === undefined ? 1 : a];
}

function initGL(canvas) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) ||
    canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
  if (!gl) throw new Error('WebGL tidak tersedia di browser ini');
  GLState.gl = gl;
  GLState.canvas = canvas;
  const program = createProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC);
  GLState.program = program;
  gl.useProgram(program);
  GLState.attribs.position = gl.getAttribLocation(program, 'aPosition');
  GLState.attribs.color = gl.getAttribLocation(program, 'aColor');
  GLState.attribs.normal = gl.getAttribLocation(program, 'aNormal');
  GLState.uniforms.model = gl.getUniformLocation(program, 'uModel');
  GLState.uniforms.view = gl.getUniformLocation(program, 'uView');
  GLState.uniforms.proj = gl.getUniformLocation(program, 'uProj');
  GLState.uniforms.sunDir = gl.getUniformLocation(program, 'uSunDir');
  GLState.uniforms.brightness = gl.getUniformLocation(program, 'uBrightness');
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.53, 0.75, 0.94, 1.0);
  return { gl, program };
}

const GL = {
  state: GLState,
  initGL,
  compileShader,
  createProgram,
  createBuffer,
  createIndexBuffer,
  prepareMesh,
  drawMesh,
  setUniforms,
  beginFrame,
  setView,
  setProj,
  setSunDir,
  setBrightness,
  setClearColor,
  resizeCanvasToDisplaySize,
  VERTEX_SHADER_SRC,
  FRAGMENT_SHADER_SRC,
};

SB.GL = GL;

export { GL, initGL, compileShader, createProgram, createBuffer, createIndexBuffer, prepareMesh, drawMesh, setUniforms, beginFrame, setView, setProj, setSunDir, setBrightness, setClearColor };
export default GL;

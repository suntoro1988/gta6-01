// meshes.js — procedural mesh builders. Every function returns
// { verts: Float32Array, idx: Uint16Array, colors: Float32Array }
// in the format gl.js draw() expects. All colors are [r,g,b] 0..1.
// Y is up. Boxes are centered on (cx, cy, cz) unless noted.
function mk() {
  const v = [], i = [], c = [];
  function quad(p0, p1, p2, p3, col) {
    const b = v.length / 3;
    v.push(...p0, ...p1, ...p2, ...p3);
    for (let k = 0; k < 4; k++) c.push(col[0], col[1], col[2]);
    i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  function tri(p0, p1, p2, col) {
    const b = v.length / 3;
    v.push(...p0, ...p1, ...p2);
    for (let k = 0; k < 3; k++) c.push(col[0], col[1], col[2]);
    i.push(b, b + 1, b + 2);
  }
  function box(cx, cy, cz, w, h, d, col) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], col); // top
    quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], col); // bottom
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col); // front
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col); // back
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col); // left
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col); // right
  }
  return { quad, tri, box, done() { return { verts: new Float32Array(v), idx: new Uint16Array(i), colors: new Float32Array(c) }; } };
}

export function box(w, h, d, color) {
  const m = mk(); m.box(0, 0, 0, w, h, d, color); return m.done();
}

// Triangular prism: triangle cross-section in XY, extruded along Z.
// Base sits at y=0, apex at y=h.
export function prism(w, h, d, color) {
  const m = mk();
  const a = [-w / 2, 0, 0], b = [w / 2, 0, 0], p = [0, h, 0];
  const z0 = -d / 2, z1 = d / 2;
  m.tri([a[0], a[1], z1], [b[0], b[1], z1], [p[0], p[1], z1], color);
  m.tri([b[0], b[1], z0], [a[0], a[1], z0], [p[0], p[1], z0], color);
  m.quad([a[0], 0, z0], [b[0], 0, z0], [b[0], 0, z1], [a[0], 0, z1], color);
  m.quad([b[0], 0, z1], [b[0], 0, z0], [p[0], h, z0], [p[0], h, z1], color);
  m.quad([a[0], 0, z0], [a[0], 0, z1], [p[0], h, z1], [p[0], h, z0], color);
  return m.done();
}

// Cylinder centered on origin, y from -h/2 to h/2.
export function cyl(r, h, seg, color) {
  const m = mk();
  const y0 = -h / 2, y1 = h / 2;
  const top = [], bot = [];
  for (let s = 0; s < seg; s++) {
    const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r];
    const p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
    const p2 = [Math.cos(a1) * r, y1, Math.sin(a1) * r];
    const p3 = [Math.cos(a0) * r, y1, Math.sin(a0) * r];
    m.quad(p0, p1, p2, p3, color);
    top.push([Math.cos(a0) * r, y1, Math.sin(a0) * r]);
    bot.push([Math.cos(a0) * r, y0, Math.sin(a0) * r]);
  }
  for (let s = 1; s + 1 < seg; s++) {
    m.tri([0, y1, 0], top[s], top[s + 1], color);
    m.tri([0, y0, 0], bot[s + 1], bot[s], color);
  }
  return m.done();
}

// Car: body + cabin + 4 dark wheels. Faces +X, length along X.
export function carMesh(bodyColor) {
  const m = mk();
  const dark = [0.08, 0.08, 0.09];
  m.box(0, 0.62, 0, 2.2, 0.55, 1.1, bodyColor); // body, y 0.35..0.9
  m.box(-0.1, 1.15, 0, 1.2, 0.5, 1.0, [0.15, 0.2, 0.25]); // cabin
  for (const sx of [-0.7, 0.7]) for (const sz of [-0.55, 0.55]) {
    m.box(sx, 0.18, sz, 0.35, 0.36, 0.2, dark);
  }
  return m.done();
}

// Building: plain box + lit windows (different color) on front/back.
export function buildingMesh(w, h, d, winColor) {
  const m = mk();
  m.box(0, h / 2, 0, w, h, d, [0.72, 0.72, 0.76]);
  const cols = Math.max(1, Math.floor(w / 1.4)), rows = Math.max(1, Math.floor(h / 1.6));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -w / 2 + ((c + 0.5) / cols) * w;
    const y = 1.0 + r * 1.6 + 0.35;
    if (y + 0.35 > h - 0.3) continue;
    const ww = 0.55, wh = 0.7;
    m.quad([x - ww / 2, y - wh / 2, d / 2 + 0.02], [x + ww / 2, y - wh / 2, d / 2 + 0.02],
      [x + ww / 2, y + wh / 2, d / 2 + 0.02], [x - ww / 2, y + wh / 2, d / 2 + 0.02], winColor);
    m.quad([x + ww / 2, y - wh / 2, -d / 2 - 0.02], [x - ww / 2, y - wh / 2, -d / 2 - 0.02],
      [x - ww / 2, y + wh / 2, -d / 2 - 0.02], [x + ww / 2, y + wh / 2, -d / 2 - 0.02], winColor);
  }
  return m.done();
}

export function treeMesh() {
  const m = mk();
  // Trunk is a box (keeps one builder); canopy is two green boxes.
  const green = [0.16, 0.5, 0.2], green2 = [0.2, 0.6, 0.24];
  m.box(0, 0.5, 0, 0.28, 1.0, 0.28, [0.4, 0.26, 0.14]);
  m.box(0, 1.6, 0, 1.5, 1.3, 1.5, green);
  m.box(0, 2.5, 0, 0.95, 0.8, 0.95, green2);
  return m.done();
}

// Simple person: legs, shirt torso, arms, skin head. ~1.8 tall.
export function personMesh(shirtColor, skinColor) {
  const m = mk();
  const pants = [0.15, 0.18, 0.25];
  m.box(-0.12, 0.3, 0, 0.18, 0.6, 0.2, pants);
  m.box(0.12, 0.3, 0, 0.18, 0.6, 0.2, pants);
  m.box(0, 0.95, 0, 0.55, 0.7, 0.32, shirtColor); // torso
  m.box(-0.36, 0.95, 0, 0.14, 0.6, 0.18, shirtColor); // arms
  m.box(0.36, 0.95, 0, 0.14, 0.6, 0.18, shirtColor);
  m.box(0, 1.55, 0, 0.36, 0.36, 0.36, skinColor); // head
  return m.done();
}

// Boat: hull box + bow prism + cabin + mast. Faces +X.
export function boatMesh(color) {
  const m = mk();
  m.box(-0.2, 0.3, 0, 2.2, 0.55, 1.0, color); // hull
  m.box(-0.1, 0.75, 0, 0.9, 0.35, 0.8, [0.9, 0.9, 0.88]); // cabin
  m.box(0.1, 1.35, 0, 0.08, 1.3, 0.08, [0.35, 0.25, 0.15]); // mast
  m.tri([0.1, 1.9, 0], [0.1, 1.0, 0], [0.95, 1.0, 0], [0.95, 0.95, 0.9]); // sail
  return m.done();
}

// Road segment: flat dark strip with a center line, 40 long (X) x 6 wide (Z).
export function roadMesh() {
  const m = mk();
  m.box(0, -0.05, 0, 40, 0.1, 6, [0.16, 0.16, 0.18]);
  m.box(0, 0.02, 0, 40, 0.02, 0.16, [0.9, 0.8, 0.2]); // center line
  m.box(0, 0.02, -2.75, 40, 0.02, 0.12, [0.85, 0.85, 0.85]); // edges
  m.box(0, 0.02, 2.75, 40, 0.02, 0.12, [0.85, 0.85, 0.85]);
  return m.done();
}

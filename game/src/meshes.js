// Sunset Bay — meshes.js (v10, written from scratch)
// 3D mesh builder for the Sunset Bay renderer.
//
// WINDING RULE (critical — wrong winding = culled / invisible faces):
// Every triangle is emitted counter-clockwise when viewed from OUTSIDE
// the solid, i.e. from the side its normal points to. WebGL treats
// counter-clockwise triangles as front-facing, so a face whose winding
// is reversed disappears as soon as back-face culling is on. That is
// what broke the sea / pier (flatQuad) and the roofs (boxAt) in v8:
// a flat quad wound clockwise from above is culled from above.
//   * flatQuad: wound like the TOP face of a box — CCW seen from +Y.
//   * boxAt: six faces, each wound CCW seen from outside that face
//     (the classic WebGL-cube face order, verified face by face).
//   * cylinder / pyramid: side faces wound CCW seen from outside,
//     caps wound CCW seen from above / below respectively.
// Vertex format: positions (x,y,z), colours (r,g,b per vertex, 0..1)
// and a triangle index list. A mesh is { positions: Float32Array,
// colors: Float32Array, indices: Uint16Array, vertexCount,
// triangleCount }.

const SB = (globalThis.SB = globalThis.SB || {});

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// "#rrggbb" or [r,g,b] (0..255 or 0..1) -> [r,g,b] in 0..1.
function toRGB(color) {
  if (Array.isArray(color)) {
    const s = color[0] > 1 || color[1] > 1 || color[2] > 1 ? 255 : 1;
    return [clamp01(color[0] / s), clamp01(color[1] / s), clamp01(color[2] / s)];
  }
  if (typeof color === "string" && color[0] === "#") {
    const n = parseInt(color.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return [0.8, 0.8, 0.8];
}

function shade(rgb, f) {
  return [clamp01(rgb[0] * f), clamp01(rgb[1] * f), clamp01(rgb[2] * f)];
}

// Accumulates vertices. quad(a, b, c, d) expects the four corners
// in counter-clockwise order seen from the face's outside; it emits
// triangles (a, b, c) and (a, c, d), which keeps that winding.
class MeshBuilder {
  constructor() {
    this.positions = [];
    this.colors = [];
    this.indices = [];
  }

  get vertexCount() {
    return this.positions.length / 3;
  }

  vertex(x, y, z, rgb) {
    this.positions.push(x, y, z);
    this.colors.push(rgb[0], rgb[1], rgb[2]);
    return this.vertexCount - 1;
  }

  tri(a, b, c) {
    this.indices.push(a, b, c);
    return this;
  }

  quad(a, b, c, d) {
    // a-b-c-d CCW from outside -> (a,b,c) and (a,c,d) stay CCW.
    this.indices.push(a, b, c, a, c, d);
    return this;
  }

  // A coloured quad from four corner positions (CCW from outside).
  quadAt(p0, p1, p2, p3, color) {
    const rgb = toRGB(color);
    const a = this.vertex(p0[0], p0[1], p0[2], rgb);
    const b = this.vertex(p1[0], p1[1], p1[2], rgb);
    const c = this.vertex(p2[0], p2[1], p2[2], rgb);
    const d = this.vertex(p3[0], p3[1], p3[2], rgb);
    return this.quad(a, b, c, d);
  }

  // Axis-aligned box centred at (x, y + h / 2, z): base sits on y.
  // Faces are listed in the verified WebGL-cube order — each face
  // CCW seen from outside. The top face keeps full brightness so
  // roofs read as roofs instead of glowing slabs.
  boxAt(x, y, z, w, h, d, color) {
    const rgb = toRGB(color);
    const x0 = x - w / 2, x1 = x + w / 2;
    const y0 = y, y1 = y + h;
    const z0 = z - d / 2, z1 = z + d / 2;
    const side = shade(rgb, 0.92);
    const top = shade(rgb, 1.0);
    const bottom = shade(rgb, 0.55);
    // Front (+Z): bottom-left, bottom-right, top-right, top-left.
    this.quadAt([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], side);
    // Back (-Z): wound the opposite way so it is CCW seen from -Z.
    this.quadAt([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], side);
    // Top (+Y): CCW seen from above — same order as flatQuad.
    this.quadAt([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top);
    // Bottom (-Y): CCW seen from below.
    this.quadAt([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bottom);
    // Right (+X): CCW seen from +X.
    this.quadAt([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], side);
    // Left (-X): CCW seen from -X.
    this.quadAt([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side);
    return this;
  }

  // Flat horizontal quad centred at (x, y, z), size w x d.
  // Wound exactly like a box top face: CCW seen from ABOVE (+Y),
  // so the sea surface and the wooden pier are visible from above
  // and never culled by the renderer. y is the plane height.
  flatQuad(x, y, z, w, d, color) {
    const rgb = toRGB(color);
    const x0 = x - w / 2, x1 = x + w / 2;
    const z0 = z - d / 2, z1 = z + d / 2;
    this.quadAt([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], rgb);
    return this;
  }

  // Flat quad from explicit corners (must already be CCW from above).
  flatQuadCorners(p0, p1, p2, p3, color) {
    return this.quadAt(p0, p1, p2, p3, color);
  }

  // Upright cylinder centred at (cx, y, cz), base on y, height h.
  // Side quads are wound CCW seen from outside; the top cap is
  // wound CCW seen from above and the bottom cap CCW seen from below.
  cylinder(cx, y, cz, radius, h, color, segments = 12) {
    const rgb = toRGB(color);
    const y0 = y, y1 = y + h;
    const top = [];
    const bottom = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const nx = cx + Math.cos(a) * radius;
      const nz = cz + Math.sin(a) * radius;
      top.push(this.vertex(nx, y1, nz, shade(rgb, 1.0)));
      bottom.push(this.vertex(nx, y0, nz, shade(rgb, 0.85)));
    }
    const topCenter = this.vertex(cx, y1, cz, shade(rgb, 1.0));
    const bottomCenter = this.vertex(cx, y0, cz, shade(rgb, 0.5));
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      // Side: bottom[j] -> bottom[i] -> top[i] -> top[j] is CCW
      // seen from outside the cylinder wall. (The opposite order
      // winds the wall inward and culls it — verified by computing
      // the first side triangle's normal: it must point outward.)
      this.quad(bottom[j], bottom[i], top[i], top[j]);
      // Top cap fan: centre, top[j], top[i] is CCW seen from above.
      this.tri(topCenter, top[j], top[i]);
      // Bottom cap fan: centre, bottom[i], bottom[j] is CCW from below.
      this.tri(bottomCenter, bottom[i], bottom[j]);
    }
    return this;
  }

  // Four-sided pyramid: square base on y, apex at y + h.
  // Each side triangle is wound CCW seen from outside.
  pyramid(cx, y, cz, w, h, color) {
    const rgb = toRGB(color);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - w / 2, z1 = cz + w / 2;
    const apex = this.vertex(cx, y + h, cz, shade(rgb, 1.05));
    const b0 = this.vertex(x0, y, z0, rgb);
    const b1 = this.vertex(x1, y, z0, rgb);
    const b2 = this.vertex(x1, y, z1, rgb);
    const b3 = this.vertex(x0, y, z1, rgb);
    // Sides: apex + base edge, ordered so each face is CCW outside.
    this.tri(apex, b1, b0); // north (-Z) slope
    this.tri(apex, b2, b1); // east (+X) slope
    this.tri(apex, b3, b2); // south (+Z) slope
    this.tri(apex, b0, b3); // west (-X) slope
    // Base (CCW seen from below, so it is not culled from underneath).
    this.quad(b0, b1, b2, b3);
    return this;
  }

  // Sloped gable roof: ridge runs along X, eaves at y, apex at y + h.
  gableRoof(cx, y, cz, w, h, d, color) {
    const rgb = toRGB(color);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    const ridgeY = y + h;
    const r0 = this.vertex(x0, ridgeY, cz, shade(rgb, 1.0));
    const r1 = this.vertex(x1, ridgeY, cz, shade(rgb, 1.0));
    const e0 = this.vertex(x0, y, z0, rgb);
    const e1 = this.vertex(x1, y, z0, rgb);
    const e2 = this.vertex(x1, y, z1, rgb);
    const e3 = this.vertex(x0, y, z1, rgb);
    // North slope (-Z side) and south slope (+Z side), CCW outside.
    this.quad(e0, e1, r1, r0);
    this.quad(e3, r1, r0, e2);
    // West gable triangle (-X end) and east gable triangle (+X end).
    this.tri(e0, r0, e3);
    this.tri(e1, e2, r1);
    return this;
  }

  build() {
    return makeMesh(this.positions, this.colors, this.indices);
  }
}

function makeMesh(positions, colors, indices) {
  // Per-vertex normals, computed from the triangles (flat shading).
  // MeshBuilder never shares vertices between faces (each quadAt adds
  // fresh vertices), so accumulating each triangle's face normal onto
  // its three vertices and normalising gives the correct flat normal.
  // gl.js requires a normals array; without it drawMesh throws.
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    normals[a * 3] += nx; normals[a * 3 + 1] += ny; normals[a * 3 + 2] += nz;
    normals[b * 3] += nx; normals[b * 3 + 1] += ny; normals[b * 3 + 2] += nz;
    normals[c * 3] += nx; normals[c * 3 + 1] += ny; normals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < vertexCount; i++) {
    const len = Math.sqrt(
      normals[i * 3] * normals[i * 3] +
      normals[i * 3 + 1] * normals[i * 3 + 1] +
      normals[i * 3 + 2] * normals[i * 3 + 2]
    ) || 1;
    normals[i * 3] /= len; normals[i * 3 + 1] /= len; normals[i * 3 + 2] /= len;
  }
  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    normals,
    indices: Uint16Array.from(indices),
    vertexCount,
    triangleCount: indices.length / 3,
  };
}

// Convenience one-shot builders (each returns a finished mesh).
function boxAt(x, y, z, w, h, d, color) {
  return new MeshBuilder().boxAt(x, y, z, w, h, d, color).build();
}

function flatQuad(x, y, z, w, d, color) {
  return new MeshBuilder().flatQuad(x, y, z, w, d, color).build();
}

function cylinder(cx, y, cz, radius, h, color, segments = 12) {
  return new MeshBuilder().cylinder(cx, y, cz, radius, h, color, segments).build();
}

function pyramid(cx, y, cz, w, h, color) {
  return new MeshBuilder().pyramid(cx, y, cz, w, h, color).build();
}

function mergeMeshes(meshes) {
  const positions = [];
  const colors = [];
  const indices = [];
  let offset = 0;
  for (const m of meshes) {
    positions.push(...m.positions);
    colors.push(...m.colors);
    for (const i of m.indices) indices.push(i + offset);
    offset += m.vertexCount;
  }
  return makeMesh(positions, colors, indices);
}

SB.Meshes = {
  MeshBuilder,
  makeMesh,
  mergeMeshes,
  boxAt,
  flatQuad,
  cylinder,
  pyramid,
  toRGB,
  shade,
};

const Meshes = SB.Meshes;

export { Meshes, MeshBuilder, makeMesh, mergeMeshes, boxAt, flatQuad, cylinder, pyramid };
export default SB.Meshes;

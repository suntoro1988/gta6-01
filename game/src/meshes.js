// Sunset Bay v5 — procedural primitive builders.
// Written fresh for v5 from the design spec.
//
// Every function returns an array of primitives:
//   { k, x, y, z, sx, sy, sz, r, h, s, color }  with k = 'box' | 'cyl' | 'pyr'
// - 'box' uses sx, sy, sz (full sizes); 'cyl' uses r, h; 'pyr' uses s (square
//   base side), h.
// - (x, y, z) is the CENTER of the primitive's bounding volume, matching the
//   renderer convention in gl.js: a box spans y +/- sy/2, a cylinder
//   y +/- h/2, a pyramid has its base at y - h/2 and apex at y + h/2.
// - carPrims / pedPrims are LOCAL to the vehicle/pedestrian origin: origin
//   at ground level, forward along +Z, centred on x = 0.
// - buildingPrims / treePrims / propPrims take ABSOLUTE world x, z (ground y = 0).
// - Colors are [r, g, b] floats in 0..1; the renderer also accepts hex strings.

function toRgb(color) {
  if (Array.isArray(color) && color.length >= 3) return [color[0], color[1], color[2]];
  if (typeof color === 'string') {
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const n = parseInt(hex, 16);
    if (Number.isFinite(n)) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return [0.5, 0.5, 0.5];
}

// Darken (f < 1) or lighten (f > 1) a color.
function shade(color, f) {
  const c = toRgb(color);
  return [
    Math.min(1, c[0] * f),
    Math.min(1, c[1] * f),
    Math.min(1, c[2] * f),
  ];
}

function box(x, y, z, sx, sy, sz, color) {
  return { k: 'box', x, y, z, sx, sy, sz, color: toRgb(color) };
}

function cyl(x, y, z, r, h, color) {
  return { k: 'cyl', x, y, z, r, h, color: toRgb(color) };
}

function pyr(x, y, z, s, h, color) {
  return { k: 'pyr', x, y, z, s, h, color: toRgb(color) };
}

const GLASS = [0.62, 0.76, 0.86]; // pale window glass
const GLASS_DARK = [0.13, 0.17, 0.24]; // tinted car glass
const TYRE = [0.08, 0.08, 0.09];

// b = { x, z, w, d, h, color, roof }
// roof: 'pyr' | true | <height number> => pyramid roof; anything else => flat
// with a parapet trim. The front face (+Z) gets a glass strip and a door.
export function buildingPrims(b) {
  const w = b.w || 10;
  const d = b.d || 10;
  const h = b.h || 12;
  const color = toRgb(b.color || [0.7, 0.65, 0.6]);
  const out = [];
  out.push(box(b.x, h / 2, b.z, w, h, d, color));

  const roof = b.roof;
  const roofH =
    typeof roof === 'number' ? roof
    : roof === 'pyr' || roof === true ? Math.max(1.5, Math.min(w, d) * 0.28)
    : 0;
  if (roofH > 0) {
    out.push(pyr(b.x, h + roofH / 2, b.z, Math.min(w, d) * 1.04, roofH, shade(color, 0.55)));
  } else {
    // Flat roof: a thin parapet lip so the skyline does not look razor-flat.
    out.push(box(b.x, h + 0.18, b.z, w + 0.3, 0.36, d + 0.3, shade(color, 0.7)));
  }

  // Window band across the front facade.
  if (h > 4) {
    out.push(box(b.x, h * 0.58, b.z + d / 2 + 0.05, w * 0.68, Math.min(h * 0.45, 6), 0.12, GLASS));
  }
  // Door, centred on the front face at street level.
  out.push(box(b.x, 1.1, b.z + d / 2 + 0.05, 1.4, 2.2, 0.14, [0.16, 0.13, 0.11]));
  return out;
}

// Local coordinates: origin at ground centre, forward = +Z (length along Z).
// model: 'sport' | 'sedan' | 'truck' | 'taxi' | 'boat'.
export function carPrims(color, model) {
  const body = toRgb(color || [0.8, 0.2, 0.2]);
  const out = [];

  function wheels(zFront, zRear, halfW) {
    for (const sx of [-1, 1]) {
      for (const zz of [zFront, zRear]) {
        out.push(box(sx * halfW, 0.32, zz, 0.28, 0.64, 0.7, TYRE));
      }
    }
  }

  if (model === 'truck') {
    // Cargo box at the rear, tall cab at the front (+Z).
    out.push(box(0, 1.15, -0.95, 2.1, 1.5, 2.7, shade(body, 0.85)));
    out.push(box(0, 1.0, 1.35, 2.0, 1.5, 1.5, body));
    out.push(box(0, 1.35, 2.02, 1.7, 0.55, 0.12, GLASS_DARK)); // windshield
    out.push(box(0, 0.55, 0.35, 2.05, 0.5, 3.9, shade(body, 0.9))); // chassis skirt
    wheels(1.5, -1.5, 0.95);
    return out;
  }

  if (model === 'boat') {
    // Speedboat: hull, deck, low cabin, windshield, outboard motor.
    out.push(box(0, 0.45, 0, 2.2, 0.7, 5.0, body)); // hull
    out.push(box(0, 0.85, -0.4, 1.9, 0.18, 4.2, shade(body, 1.25))); // deck
    out.push(box(0, 1.25, -0.7, 1.5, 0.6, 1.8, GLASS_DARK)); // cabin
    out.push(box(0, 1.05, 0.35, 1.6, 0.5, 0.9, shade(body, 0.9))); // bow deck
    out.push(box(0, 0.55, -2.6, 0.5, 0.7, 0.4, TYRE)); // outboard motor
    return out;
  }

  if (model === 'sport') {
    out.push(box(0, 0.5, 0, 1.9, 0.5, 4.4, body)); // low wide body
    out.push(box(0, 0.95, -0.35, 1.6, 0.45, 2.0, GLASS_DARK)); // cabin glass
    out.push(box(0, 0.82, 0.6, 1.7, 0.18, 1.2, shade(body, 1.15))); // hood
    out.push(box(0, 0.95, -2.1, 1.8, 0.08, 0.3, TYRE)); // rear spoiler
    out.push(box(0, 0.35, 2.2, 1.7, 0.18, 0.15, [1.0, 0.9, 0.6])); // headlight bar
    wheels(1.45, -1.45, 0.85);
    return out;
  }

  // 'sedan' and 'taxi' share the sedan shell; taxi adds a roof sign.
  out.push(box(0, 0.55, 0, 1.9, 0.6, 4.2, body));
  out.push(box(0, 1.1, -0.15, 1.7, 0.5, 2.2, GLASS_DARK)); // cabin glass
  out.push(box(0, 0.9, 0.35, 1.75, 0.22, 1.5, shade(body, 1.1))); // hood/trunk line
  out.push(box(0, 0.4, 2.12, 1.5, 0.16, 0.12, [1.0, 0.9, 0.6])); // headlights
  out.push(box(0, 0.4, -2.12, 1.5, 0.16, 0.12, [0.85, 0.12, 0.12])); // tail lights
  wheels(1.4, -1.4, 0.85);
  if (model === 'taxi') {
    out.push(box(0, 1.5, -0.15, 0.9, 0.22, 0.35, [1.0, 0.85, 0.1])); // roof sign
    out.push(box(0, 0.86, 0, 1.94, 0.1, 4.24, [0.95, 0.85, 0.2])); // yellow band
  }
  return out;
}

// Pedestrian, local origin at the feet, facing +Z. ~1.8 units tall.
export function pedPrims(shirt, skin) {
  const shirtC = toRgb(shirt || [0.3, 0.5, 0.9]);
  const skinC = toRgb(skin || [0.85, 0.65, 0.5]);
  const pants = [0.16, 0.16, 0.2];
  const hair = [0.12, 0.09, 0.07];
  return [
    box(-0.11, 0.38, 0, 0.17, 0.76, 0.17, pants), // left leg
    box(0.11, 0.38, 0, 0.17, 0.76, 0.17, pants), // right leg
    box(0, 1.06, 0, 0.56, 0.6, 0.3, shirtC), // torso
    box(-0.36, 1.06, 0, 0.13, 0.55, 0.13, shirtC), // left arm
    box(0.36, 1.06, 0, 0.13, 0.55, 0.13, shirtC), // right arm
    box(0, 1.56, 0, 0.32, 0.34, 0.3, skinC), // head
    box(0, 1.76, -0.02, 0.34, 0.12, 0.32, hair), // hair
  ];
}

// Tree at absolute (x, z): trunk + two stacked pyramid canopies (cypress/palm read).
export function treePrims(x, z) {
  const trunk = [0.36, 0.23, 0.13];
  const leaf = [0.14, 0.44, 0.17];
  const leafTop = [0.2, 0.52, 0.2];
  return [
    cyl(x, 0.7, z, 0.16, 1.4, trunk),
    pyr(x, 2.3, z, 1.9, 1.8, leaf), // lower canopy: base 1.4, apex 3.2
    pyr(x, 3.7, z, 1.3, 1.4, leafTop), // upper canopy: base 3.0, apex 4.4
  ];
}

// Street prop at absolute (x, z). kind: 'lamp' | 'sign' | 'hydrant' | 'crate' | 'dock' | 'crane'.
export function propPrims(kind, x, z) {
  switch (kind) {
    case 'lamp': {
      const pole = [0.2, 0.2, 0.22];
      return [
        cyl(x, 2.3, z, 0.09, 4.6, pole),
        box(x + 0.55, 4.5, z, 1.2, 0.12, 0.12, pole), // arm
        box(x + 1.05, 4.42, z, 0.5, 0.15, 0.26, [1.0, 0.85, 0.5]), // lamp head
      ];
    }
    case 'sign': {
      return [
        cyl(x, 1.3, z, 0.07, 2.6, [0.35, 0.35, 0.38]),
        box(x, 2.55, z, 0.9, 0.6, 0.08, [0.8, 0.15, 0.15]), // red board
        box(x, 2.55, z + 0.06, 0.7, 0.4, 0.02, [0.95, 0.95, 0.95]), // inner plate
      ];
    }
    case 'hydrant': {
      const red = [0.75, 0.12, 0.12];
      return [
        cyl(x, 0.35, z, 0.25, 0.7, red),
        box(x, 0.78, z, 0.3, 0.18, 0.3, shade(red, 0.8)),
        box(x + 0.3, 0.45, z, 0.14, 0.14, 0.14, shade(red, 0.8)),
        box(x - 0.3, 0.45, z, 0.14, 0.14, 0.14, shade(red, 0.8)),
      ];
    }
    case 'dock': {
      const wood = [0.5, 0.35, 0.18];
      return [
        box(x, 0.15, z, 3.0, 0.3, 6.0, wood), // planks
        cyl(x - 1.3, 0.6, z - 2.7, 0.12, 1.2, shade(wood, 0.7)),
        cyl(x + 1.3, 0.6, z - 2.7, 0.12, 1.2, shade(wood, 0.7)),
        cyl(x - 1.3, 0.6, z + 2.7, 0.12, 1.2, shade(wood, 0.7)),
        cyl(x + 1.3, 0.6, z + 2.7, 0.12, 1.2, shade(wood, 0.7)),
      ];
    }
    case 'crane': {
      const yellow = [0.9, 0.7, 0.2];
      return [
        box(x, 0.4, z, 2.0, 0.8, 2.0, shade(yellow, 0.8)), // base
        box(x, 4.8, z, 0.8, 8.0, 0.8, yellow), // tower
        box(x + 2.6, 8.6, z, 6.0, 0.5, 0.5, yellow), // jib
        box(x - 1.7, 8.6, z, 2.0, 0.5, 0.5, shade(yellow, 0.7)), // counter-jib
        box(x + 5.2, 7.5, z, 0.08, 2.0, 0.08, [0.2, 0.2, 0.2]), // cable
        box(x + 5.2, 6.4, z, 0.35, 0.3, 0.35, [0.25, 0.25, 0.25]), // hook block
      ];
    }
    case 'crate':
    default: {
      const wood = [0.55, 0.38, 0.2];
      return [
        box(x, 0.5, z, 1.0, 1.0, 1.0, wood),
        box(x, 1.02, z, 1.06, 0.08, 1.06, shade(wood, 0.8)), // lid
      ];
    }
  }
}

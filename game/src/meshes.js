// Mesh builders for the moving things: cars, people and blob shadows.
// Local space: forward is +Z, ground is y = 0. All vertex colours are baked in.
import { MeshBuilder, shade } from './gl.js';

/** A low-poly car: body, glass cabin, wheels, lights. */
export function buildCarMesh(bodyColor) {
  const m = new MeshBuilder();
  const dark = shade(bodyColor, 0.55);
  // Body.
  m.box(0, 0.55, 0, 1.9, 0.55, 4.2, bodyColor, shade(bodyColor, 1.15));
  // Lower trim and bumpers.
  m.box(0, 0.32, 2.12, 1.92, 0.22, 0.18, dark);
  m.box(0, 0.32, -2.12, 1.92, 0.22, 0.18, dark);
  // Glass cabin.
  m.box(0, 1.08, -0.35, 1.7, 0.55, 2.1, [0.14, 0.18, 0.26], [0.2, 0.26, 0.36]);
  // Wheels.
  const wheel = [0.08, 0.08, 0.09];
  m.box(-0.88, 0.32, 1.35, 0.32, 0.62, 0.85, wheel);
  m.box(0.88, 0.32, 1.35, 0.32, 0.62, 0.85, wheel);
  m.box(-0.88, 0.32, -1.35, 0.32, 0.62, 0.85, wheel);
  m.box(0.88, 0.32, -1.35, 0.32, 0.62, 0.85, wheel);
  // Headlights and taillights.
  m.box(-0.6, 0.62, 2.13, 0.45, 0.16, 0.08, [1.0, 0.95, 0.75], [1.0, 0.95, 0.75], 0.85);
  m.box(0.6, 0.62, 2.13, 0.45, 0.16, 0.08, [1.0, 0.95, 0.75], [1.0, 0.95, 0.75], 0.85);
  m.box(-0.6, 0.62, -2.13, 0.45, 0.16, 0.08, [1.0, 0.15, 0.15], [1.0, 0.15, 0.15], 0.85);
  m.box(0.6, 0.62, -2.13, 0.45, 0.16, 0.08, [1.0, 0.15, 0.15], [1.0, 0.15, 0.15], 0.85);
  return m;
}

/** A police light bar, drawn separately so it can flash red and blue. */
export function buildLightBarMesh() {
  const m = new MeshBuilder();
  m.box(0, 1.45, -0.35, 1.5, 0.3, 0.7, [0.95, 0.95, 0.95], [0.95, 0.95, 0.95], 0.9);
  return m;
}

/** A low-poly person: legs, torso, arms, head. */
export function buildPersonMesh(shirt, skin) {
  const m = new MeshBuilder();
  const pants = [0.16, 0.18, 0.24];
  m.box(-0.14, 0.42, 0, 0.22, 0.84, 0.26, pants);
  m.box(0.14, 0.42, 0, 0.22, 0.84, 0.26, pants);
  m.box(0, 1.16, 0, 0.62, 0.62, 0.34, shirt, shade(shirt, 1.12));
  m.box(-0.4, 1.16, 0, 0.16, 0.58, 0.18, shade(shirt, 0.8));
  m.box(0.4, 1.16, 0, 0.16, 0.58, 0.18, shade(shirt, 0.8));
  m.box(0, 1.68, 0, 0.34, 0.34, 0.32, skin);
  m.box(0, 1.88, 0, 0.36, 0.1, 0.34, [0.12, 0.1, 0.1]);
  return m;
}

/** A flat dark ellipse that sits on the ground under a car or a person. */
export function buildShadowMesh() {
  const m = new MeshBuilder();
  const seg = 12;
  const c = [0, 0.02, 0];
  for (let i = 0; i < seg; i += 1) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    m.tri(c, [Math.cos(a1), 0.02, Math.sin(a1)], [Math.cos(a0), 0.02, Math.sin(a0)], [0.05, 0.04, 0.05]);
  }
  return m;
}

/** A glowing cash pickup: a spinning golden coin. */
export function buildCoinMesh() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 0.55, 0.3, [1.0, 0.8, 0.2], 12, 0.9);
  return m;
}

/** A waypoint beacon: a tall, wide glowing pillar with floating diamonds,
 * built to read from 100+ units away, above the rooftops. */
export function buildBeaconMesh() {
  const m = new MeshBuilder();
  m.cylinder(0, 0, 0, 2.0, 120, [1.0, 0.85, 0.2], 10, 0.95);
  m.octa(0, 5, 0, 2.0, [1.0, 0.85, 0.2], 0.9);
  m.octa(0, 36, 0, 2.6, [1.0, 0.85, 0.2], 0.9);
  m.octa(0, 72, 0, 2.2, [1.0, 0.85, 0.2], 0.9);
  return m;
}

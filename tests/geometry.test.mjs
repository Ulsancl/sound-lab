import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, DEFAULT_VIEW, GEOMETRY as G, tubeLayout, particlePosition, probePosition, pressureColor, hollowTubeMesh } from '../src/geometry.js';

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const subtract = (a, b) => a.map((n, i) => n - b[i]);
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);

test('fourteen stable component identities and six observation fields are immutable', () => {
  assert.deepEqual(COMPONENTS.map(part => part.id), ['bench-base', 'rail', 'scale', 'tube-wall', 'tube-collars', 'left-support', 'right-support', 'end-cap', 'cap-stand', 'probe-carriage', 'probe-tip', 'probe-cable', 'readout', 'particles']);
  assert.deepEqual(DEFAULT_VIEW, { cutaway: true, particles: true, pressure: true, exploded: false, labels: true, selectedPart: 'tube-wall' });
  assert.ok(COMPONENTS.every(part => part.name && part.description && part.material && Object.isFrozen(part))); assert.ok(Object.isFrozen(G.tube));
});

test('all tube lengths are constant-bore hollow metal with explicit correctly oriented annular and cut faces', () => {
  for (const L of [.3, .6, 1.2]) for (const cut of [false, true]) {
    const mesh = hollowTubeMesh(L, cut); assert.equal(mesh.positions.length, mesh.normals.length);
    const radii = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [x, y, z] = mesh.positions.slice(i, i + 3); near(Math.abs(x), L / 2);
      const r = Math.hypot(y, z); radii.push(r); assert.ok(Math.abs(r - .020) < 1e-12 || Math.abs(r - .023) < 1e-12, 'no cap vertex or filled bore');
      near(Math.hypot(...mesh.normals.slice(i, i + 3)), 1);
      if (cut) assert.ok(z <= .023 * .5 + 1e-12, 'front 120 degree opening must be empty');
    }
    near(Math.min(...radii), .020); near(Math.max(...radii), .023);
    for (let i = 0; i < mesh.positions.length; i += 9) {
      const a = mesh.positions.slice(i, i + 3), b = mesh.positions.slice(i + 3, i + 6), c = mesh.positions.slice(i + 6, i + 9);
      const normal = cross(subtract(b, a), subtract(c, a)); assert.ok(Math.hypot(...normal) > 1e-12, 'triangle has area');
      assert.ok(dot(normal, mesh.normals.slice(i, i + 3)) > 0, 'winding agrees with the physical surface normal');
    }
  }
});

test('closed cap inside face coincides with left endpoint while open cap is on its separate stand', () => {
  for (const L of [.3, .6, 1.2]) {
    const closed = tubeLayout(L, 'closed-open'), open = tubeLayout(L, 'open-open');
    near(closed.capFace[0], -L / 2); near(closed.capFace[1], .15); near(closed.capFace[2], 0);
    assert.equal(closed.capClosed, true); assert.equal(open.capClosed, false);
    near(open.capCenter[1] - G.cap.radiusM, G.capStand.center[1] + G.capStand.size[1] / 2);
    assert.ok(Math.hypot(open.capCenter[1] - .15, open.capCenter[2]) > G.cap.radiusM + G.tube.outerRadiusM);
  }
});

test('support and collar stations lie inside every tube and the rail and bench support them', () => {
  for (const L of [.3, .6, 1.2]) {
    const layout = tubeLayout(L, 'open-open'); near(layout.rightX - layout.leftX, L);
    for (const x of layout.supportXs) { assert.ok(x - G.collar.widthM / 2 > layout.leftX); assert.ok(x + G.collar.widthM / 2 < layout.rightX); assert.ok(Math.abs(x) + .033 < layout.railLengthM / 2); }
    assert.ok(layout.railLengthM < layout.benchLengthM); near(G.collar.innerRadiusM, G.tube.outerRadiusM);
    assert.ok(Math.abs(layout.storedCapCenter[0]) + G.capStand.size[0] / 2 < layout.benchLengthM / 2);
    assert.ok(Math.abs(layout.readoutCenter[0]) + G.readout.size[0] / 2 < layout.benchLengthM / 2);
  }
});

test('probe is the equilibrium point, while particle movement is strictly longitudinal and separately exaggerated', () => {
  for (const L of [.3, .6, 1.2]) for (const r of [0, .25, .5, 1]) for (const displacement of [-1, 0, 1]) {
    const probe = probePosition(L, r), particle = particlePosition(L, r, displacement);
    near(probe[0], (r - .5) * L); near(particle[0] - probe[0], .01 * L * displacement); near(particle[1], probe[1]); near(particle[2], probe[2]);
  }
  assert.ok(G.particleRadiusM + Math.hypot(.007, .005) < G.tube.innerRadiusM, 'all three visible rows stay inside the bore');
});

test('display amplitude preserves particle order and the closed wall for all three independent analytic modes', () => {
  for (const L of [.3, .6, 1.2]) for (const closed of [false, true]) for (const n of [1, 2, 3]) {
    const k = (closed ? (2 * n - 1) * Math.PI / 2 : n * Math.PI) / L; assert.ok(.01 * L * k < 1);
    for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      let previous = -Infinity;
      for (let i = 0; i <= 256; i++) {
        const r = i / 256, displacement = (closed ? -Math.sin(k * r * L) : Math.cos(k * r * L)) * Math.cos(phase);
        const x = particlePosition(L, r, displacement)[0]; assert.ok(x > previous); previous = x;
        if (closed) assert.ok(x >= -L / 2 - 1e-12, 'closed wall is never crossed');
      }
    }
  }
});

test('explosion changes only inspection offsets and preserves tube length, probe equilibrium X and relative marker motion', () => {
  const a = tubeLayout(.6, 'closed-open'), b = tubeLayout(.6, 'closed-open', true);
  near(a.lengthM, b.lengthM); assert.deepEqual(a.supportXs, b.supportXs); near(b.center[1] - a.center[1], .075);
  near(b.capFace[0] - a.capFace[0], -.09); near(b.capFace[1] - a.capFace[1], .075); assert.ok(b.collarY > b.center[1]);
  for (const r of [0, .5, 1]) { const a = probePosition(.6, r), b = probePosition(.6, r, true); near(a[0], b[0]); near(b[1] - a[1], .075); }
});

test('relative pressure uses a fixed signed palette without automatic per-frame normalization', () => {
  assert.equal(pressureColor(-1), '#55a0e7'); assert.equal(pressureColor(0), '#d3e4e4'); assert.equal(pressureColor(1), '#ee8a51');
  assert.equal(pressureColor(-.5), '#94c2e6'); assert.equal(pressureColor(.5), '#e1b79b');
  for (const bad of [NaN, Infinity, -1.01, 1.01, '0', null]) assert.throws(() => pressureColor(bad), RangeError);
});

test('public pure geometry helpers reject nonfinite, coerced or out-of-contract inputs', () => {
  for (const bad of [.29, 1.21, NaN, Infinity, '.6', null]) assert.throws(() => tubeLayout(bad, 'open-open'));
  for (const bad of [-.01, 1.01, NaN, '.5']) assert.throws(() => probePosition(.6, bad));
  assert.throws(() => tubeLayout(.6, 'closed-closed')); assert.throws(() => tubeLayout(.6, 'open-open', 1));
  assert.throws(() => hollowTubeMesh(.6, 'true')); assert.throws(() => hollowTubeMesh(.6, true, 3));
  assert.throws(() => particlePosition(.6, .5, NaN));
});

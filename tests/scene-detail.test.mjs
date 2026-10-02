import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { GEOMETRY as G, tubeLayout, probePosition } from '../src/geometry.js';
import { sleeveGeometry, boredBlockGeometry, supportBodyGeometry, probeBodyGeometry, collarSaddleGeometry, capGeometry, capSealGeometry } from '../src/geometry-meshes.js';

const near = (a, b, tolerance = 2e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const rayHits = (geometry, origin, direction = [1, 0, 0]) => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(true);
  const result = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, 2).intersectObject(mesh); material.dispose(); return result;
};
const bounds = geometry => { geometry.computeBoundingBox(); return geometry.boundingBox; };

test('every new turned, bored and saddle mesh has finite outward normals and closed surfaces', () => {
  const geometries = [supportBodyGeometry(), probeBodyGeometry(), collarSaddleGeometry(), capGeometry(), capSealGeometry(), sleeveGeometry(.0082, .012, .070), sleeveGeometry(.0062, .010, .038)];
  for (const geometry of geometries) {
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), edges = new Map();
    assert.ok(p.count < 50000); assert.equal(p.count, n.count);
    const key = v => v.toArray().map(x => Math.round(x * 1e7)).join(',');
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const normal = b.clone().sub(a).cross(c.clone().sub(a)); assert.ok(normal.length() > 1e-13, 'no collapsed triangle');
      assert.ok(normal.dot(new THREE.Vector3().fromBufferAttribute(n, i)) > 0, 'winding points out of the material');
      for (let j = 0; j < 3; j++) { const v = new THREE.Vector3().fromBufferAttribute(n, i + j); near(v.length(), 1, 2e-7); assert.ok(v.toArray().every(Number.isFinite)); }
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const pair = [key(u), key(v)].sort().join('|'); edges.set(pair, (edges.get(pair) ?? 0) + 1); }
    }
    assert.ok([...edges.values()].every(count => count === 2), 'every geometric edge has exactly two incident triangles'); geometry.dispose();
  }
});

test('support castings have two complete axial bores and real hollow sliding bushes', () => {
  const body = supportBodyGeometry(), bush = sleeveGeometry(G.support.bushInnerRadiusM, G.support.bushOuterRadiusM, G.support.bushLengthM);
  for (const z of G.rails.z) {
    for (let i = 0; i < 128; i++) { const theta = i * Math.PI / 64, y = G.rails.centerY + .0119 * Math.sin(theta), pz = z + .0119 * Math.cos(theta); assert.equal(rayHits(body, [-.1, y, pz]).length, 0, 'body is open along the full bore'); }
    assert.ok(rayHits(body, [-.1, G.rails.centerY, z + .0125]).length >= 2);
  }
  for (let i = 0; i < 128; i++) { const t = i * Math.PI / 64; assert.equal(rayHits(bush, [-.1, .00805 * Math.sin(t), .00805 * Math.cos(t)]).length, 0); }
  assert.ok(rayHits(bush, [-.1, 0, .010]).length >= 2); near(G.support.bushInnerRadiusM - G.rails.radiusM, .0002);
  body.dispose(); bush.dispose();
});

test('rail end pedestals reach the bench and use bored rather than overlapping solid blocks', () => {
  for (const radius of [G.rails.radiusM, G.guide.radiusM]) {
    const geometry = boredBlockGeometry({ length: .020, bottom: G.bench.topY, top: G.rails.centerY + radius + .006, halfWidth: radius + .007, bores: [{ y: G.rails.centerY, radius }] });
    near(bounds(geometry).min.y, G.bench.topY);
    for (let i = 0; i < 64; i++) { const a = i * Math.PI / 32; assert.equal(rayHits(geometry, [-.1, G.rails.centerY + (radius - .00001) * Math.sin(a), (radius - .00001) * Math.cos(a)]).length, 0); }
    assert.ok(rayHits(geometry, [-.1, G.bench.topY + .001, 0]).length >= 2); geometry.dispose();
  }
});

test('probe sweep clears fixed supports, end pedestals and the tube for every supported length and display pose', () => {
  const body = probeBodyGeometry(), guideBush = sleeveGeometry(G.guide.bushInnerRadiusM, G.guide.bushOuterRadiusM, G.guide.bushLengthM);
  const support = supportBodyGeometry(), b = bounds(body), s = bounds(support);
  assert.equal(rayHits(body, [-.1, G.guide.centerY, 0]).length, 0);
  near(G.guide.bushInnerRadiusM - G.guide.radiusM, .0002);
  for (const length of [.3, .6, 1.2]) for (const exploded of [false, true]) for (let i = 0; i <= 100; i++) {
    const layout = tubeLayout(length, 'closed-open', exploded), probe = probePosition(length, i / 100, exploded);
    near(probe[0], length * (i / 100 - .5));
    assert.ok(s.min.z - (G.guide.centerZ + b.max.z) > .0229, '23 mm separation remains even at a support station');
    assert.ok(layout.railLengthM / 2 - .012 - G.guide.bracketWidthM / 2 - Math.abs(probe[0]) - G.guide.bushLengthM / 2 > .0189, 'end stops outside the entire carriage sweep');
    assert.ok(probe[1] + .042 - .007 / 2 - (layout.center[1] + G.tube.outerRadiusM) >= .0154, 'boom clears the tube, including exploded view');
  }
  assert.equal(rayHits(guideBush, [-.1, 0, .00605]).length, 0); body.dispose(); guideBush.dispose(); support.dispose();
});

test('concave saddle is tangent to the collar and never enters its circular underside', () => {
  const geometry = collarSaddleGeometry(), p = geometry.getAttribute('position'); let nearest = Infinity;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getY(i) - G.tube.centerY, p.getZ(i)); assert.ok(r >= G.collar.outerRadiusM - 2e-8); nearest = Math.min(nearest, r);
  }
  near(nearest, G.collar.outerRadiusM);
  for (let i = 1; i < 200; i++) {
    const z = (i / 200 - .5) * G.support.saddleHalfWidthM * 2, y = G.tube.centerY - Math.sqrt(G.collar.outerRadiusM ** 2 - z ** 2);
    const hits = rayHits(geometry, [0, y + .002, z], [0, -1, 0]); assert.ok(hits.length > 0); assert.ok(hits[0].point.y <= y + 2e-8); assert.ok(y - hits[0].point.y < .00001, 'faceted tangent seat stays within 10 microns of nominal support');
  }
  geometry.dispose();
});

test('cap has a recessed annular groove, flush compressed seal and unchanged acoustic end plane', () => {
  const cap = capGeometry(), seal = capSealGeometry(), c = G.cap;
  near(bounds(cap).max.x, .005); near(bounds(seal).max.x, bounds(cap).max.x);
  for (const radius of [.0204, .0215, .0226]) {
    const hit = rayHits(cap, [.020, 0, radius], [-1, 0, 0])[0]; near(hit.point.x, c.thicknessM / 2 - c.grooveDepthM);
    near(rayHits(seal, [.020, 0, radius], [-1, 0, 0])[0].point.x, .005);
  }
  near(rayHits(cap, [.020, 0, .018], [-1, 0, 0])[0].point.x, .005, 2e-8);
  for (const length of [.3, .6, 1.2]) {
    const layout = tubeLayout(length, 'closed-open'); near(layout.capCenter[0] + bounds(cap).max.x, -length / 2);
  }
  assert.ok(c.sealInnerRadiusM > c.grooveInnerRadiusM && c.sealOuterRadiusM < c.grooveOuterRadiusM);
  assert.ok(c.sealInnerRadiusM > G.tube.innerRadiusM && c.sealOuterRadiusM < G.tube.outerRadiusM);
  cap.dispose(); seal.dispose();
});

test('pure geometry and project codec remain free of Three and browser-only dependencies', async () => {
  const source = await readFile(new URL('../src/geometry.js', import.meta.url), 'utf8');
  assert.ok(!/^import\s/m.test(source));
  const { createProject, serializeProject, parseProject } = await import('../src/project.js');
  assert.equal(typeof createProject, 'function'); assert.equal(typeof serializeProject, 'function'); assert.equal(typeof parseProject, 'function');
});

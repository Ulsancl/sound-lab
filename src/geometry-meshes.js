import * as THREE from 'three';
import { GEOMETRY as G } from './geometry.js';

// Section points [axial X, radius] run around the outside of a solid. Each
// segment has its own normal: smooth around the axis, crisp across machined edges.
export function turnedGeometry(profile, segments = 96) {
  const positions = [], normals = [], uv = [];
  const point = (p, a) => [p[0], p[1] * Math.sin(a), p[1] * Math.cos(a)];
  const vertex = (p, n, u, v) => { positions.push(...p); normals.push(...n); uv.push(u, v); };
  for (let j = 0; j < profile.length; j++) {
    const a = profile[j], b = profile[(j + 1) % profile.length], dx = b[0] - a[0], dr = b[1] - a[1], d = Math.hypot(dx, dr);
    if (d < 1e-12 || (a[1] === 0 && b[1] === 0)) continue;
    for (let i = 0; i < segments; i++) {
      const t0 = 2 * Math.PI * i / segments, t1 = 2 * Math.PI * (i + 1) / segments;
      const n0 = [-dr / d, dx / d * Math.sin(t0), dx / d * Math.cos(t0)], n1 = [-dr / d, dx / d * Math.sin(t1), dx / d * Math.cos(t1)];
      const points = [point(a, t0), point(b, t0), point(b, t1), point(a, t1)], ns = [n0, n0, n1, n1];
      // Axis fans contain only one triangle; no zero-area pole triangles.
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        if ((a[1] === 0 && tri[2] === 3) || (b[1] === 0 && tri[1] === 1)) continue;
        for (const k of tri) vertex(points[k], ns[k], k < 2 ? i / segments : (i + 1) / segments, k === 0 || k === 3 ? j / profile.length : (j + 1) / profile.length);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  result.computeBoundingBox(); result.computeBoundingSphere(); return result;
}

export function sleeveGeometry(innerRadius, outerRadius, length, bevel = .00035) {
  const h = length / 2, b = Math.min(bevel, (outerRadius - innerRadius) / 3, length / 4);
  return turnedGeometry([[-h, innerRadius + b], [-h, outerRadius - b], [-h + b, outerRadius], [h - b, outerRadius], [h, outerRadius - b], [h, innerRadius + b], [h - b, innerRadius], [-h + b, innerRadius]], 64);
}

// Cross section in Z/Y, extruded along X. Holes go through the whole part.
function extrudeSection(shape, length, segments = 64) {
  const result = new THREE.ExtrudeGeometry(shape, { depth: length, steps: 1, bevelEnabled: false, curveSegments: segments });
  result.translate(0, 0, -length / 2); result.rotateY(Math.PI / 2); result.computeBoundingBox(); result.computeBoundingSphere(); return result;
}
export function boredBlockGeometry({ length, bottom, top, halfWidth, bores }) {
  const shape = new THREE.Shape(), chamfer = .0008;
  shape.moveTo(-halfWidth + chamfer, bottom); shape.lineTo(halfWidth - chamfer, bottom); shape.lineTo(halfWidth, bottom + chamfer); shape.lineTo(halfWidth, top - chamfer); shape.lineTo(halfWidth - chamfer, top); shape.lineTo(-halfWidth + chamfer, top); shape.lineTo(-halfWidth, top - chamfer); shape.lineTo(-halfWidth, bottom + chamfer); shape.closePath();
  for (const { y, z = 0, radius } of bores) { const hole = new THREE.Path(); hole.absarc(-z, y, radius, 0, Math.PI * 2, true); shape.holes.push(hole); }
  return extrudeSection(shape, length);
}
export function supportBodyGeometry() {
  const s = G.support; return boredBlockGeometry({ length: s.lengthM, bottom: s.bottomY, top: s.topY, halfWidth: s.halfWidthM, bores: G.rails.z.map(z => ({ z, y: G.rails.centerY, radius: s.bushOuterRadiusM })) });
}
export function probeBodyGeometry() {
  const s = G.guide; return boredBlockGeometry({ length: s.bodyLengthM, bottom: s.bodyBottomY, top: s.bodyTopY, halfWidth: s.bodyHalfWidthM, bores: [{ y: s.centerY, radius: s.bushOuterRadiusM }] });
}
export function collarSaddleGeometry() {
  const s = G.support, shape = new THREE.Shape(); shape.moveTo(-s.saddleHalfWidthM, s.saddleBottomY); shape.lineTo(s.saddleHalfWidthM, s.saddleBottomY);
  // A polygonal approximation lies below the matching circular underside.
  // Use tangent intersections so no chord enters the collar at any angle.
  const radius = G.collar.outerRadiusM, maxAngle = Math.asin(s.saddleHalfWidthM / radius), count = 48;
  const points = Array.from({ length: count + 1 }, (_, i) => { const angle = maxAngle - 2 * maxAngle * i / count; return { z: radius * Math.sin(angle), y: G.tube.centerY - radius * Math.cos(angle), angle }; });
  shape.lineTo(points[0].z, points[0].y);
  for (let i = 0; i < count; i++) {
    const a = points[i].angle, b = points[i + 1].angle, angle = (a + b) / 2, r = radius / Math.cos((a - b) / 2);
    shape.lineTo(r * Math.sin(angle), G.tube.centerY - r * Math.cos(angle));
  }
  shape.lineTo(points.at(-1).z, points.at(-1).y);
  shape.closePath(); return extrudeSection(shape, s.saddleLengthM, 1);
}
export function capGeometry() {
  const c = G.cap, h = c.thicknessM / 2, b = .0006;
  return turnedGeometry([[-h, 0], [-h, c.radiusM - b], [-h + b, c.radiusM], [h - b, c.radiusM], [h, c.radiusM - b], [h, c.grooveOuterRadiusM], [h - c.grooveDepthM, c.grooveOuterRadiusM], [h - c.grooveDepthM, c.grooveInnerRadiusM], [h, c.grooveInnerRadiusM], [h, 0]]);
}
export function capSealGeometry() {
  const c = G.cap, h = c.thicknessM / 2, b = .00015;
  // Representative compressed seal, flush with the closure plane. This is not
  // a simulated elastomer deformation or a prediction of leakage.
  return turnedGeometry([[h - c.sealDepthM, c.sealInnerRadiusM + b], [h - c.sealDepthM, c.sealOuterRadiusM - b], [h - c.sealDepthM + b, c.sealOuterRadiusM], [h - b, c.sealOuterRadiusM], [h, c.sealOuterRadiusM - b], [h, c.sealInnerRadiusM + b], [h - b, c.sealInnerRadiusM], [h - c.sealDepthM + b, c.sealInnerRadiusM]]);
}

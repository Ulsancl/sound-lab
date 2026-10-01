import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, createGuide, lessonReady, confirmObservation, guideText } from '../src/lessons.js';
const exp = (rule) => ({ config: { lengthM: rule.lengthM, boundary: rule.boundary, mode: rule.mode }, phaseRad: rule.phaseRad ?? 0, probeRatio: rule.probeRatio ?? .5 });
test('length experiment requires both actual conditions and freezes independent observations', () => {
  const guide = createGuide('length'), first = exp(LESSONS.length.steps[0]);
  assert.equal(confirmObservation(guide, { ...first, config: { ...first.config, lengthM: .6 } }), false);
  assert.equal(confirmObservation(guide, first), true); first.config.lengthM = 1;
  assert.equal(guide.evidence[0].experiment.config.lengthM, .5);
  assert.equal(confirmObservation(guide, first), true); assert.equal(guide.status, 'completed');
  assert.deepEqual(guide.evidence.map(e => e.frequencyHz), [343,171.5]);
  const frozen = JSON.stringify(guide); assert.equal(confirmObservation(guide, first), false); assert.equal(JSON.stringify(guide), frozen);
});
test('cap experiment independently records the integer and odd harmonic series', () => {
  const guide = createGuide('cap');
  for (const rule of LESSONS.cap.steps) assert.equal(confirmObservation(guide, exp(rule)), true);
  assert.deepEqual(guide.evidence.map(e => e.frequencyHz), [343,686,1029,171.5,514.5,857.5]);
  assert.equal(guide.status, 'completed'); assert.match(guideText(guide).result, /3배/);
});
test('node experiment needs paused phases and actual equilibrium probe positions', () => {
  const guide = createGuide('nodes');
  for (const rule of LESSONS.nodes.steps) {
    assert.equal(lessonReady(guide, exp(rule), true), false);
    assert.equal(confirmObservation(guide, exp(rule)), true);
  }
  const [left, middle, quarter, opposite, right, closed] = guide.evidence;
  assert.ok(Math.abs(left.probe.pressureRelative) < 1e-12 && Math.abs(right.probe.pressureRelative) < 1e-12);
  assert.equal(middle.probe.pressureRelative, 1); assert.ok(Math.abs(middle.probe.displacementRelative) < 1e-12);
  assert.ok(Math.abs(quarter.probe.pressureRelative) < 1e-12); assert.equal(opposite.probe.pressureRelative, -1);
  assert.deepEqual(quarter.nodes.pressureRatios, [0,1]); assert.ok(Math.abs(closed.probe.displacementRelative) < 1e-12); assert.equal(closed.probe.pressureRelative, 1);
});
test('unknown guides fail clearly without modifying another active guide', () => { assert.throws(() => createGuide('unknown')); assert.equal(lessonReady(null, {}), false); });

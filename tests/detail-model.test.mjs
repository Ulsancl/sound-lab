import test from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshot, sampleAt, wrapPhase } from '../src/model.js';
import { COMPONENTS, GEOMETRY } from '../src/geometry.js';
import { createProject, serializeProject } from '../src/project.js';
import { soundDetail, describeSoundDetail } from '../src/detail-model.js';

const TAU = 2 * Math.PI;
const near = (a, b, tolerance = 1e-10) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const variants = () => ['open-open', 'closed-open'].flatMap(boundary => [1, 2, 3].map(mode => ({ lengthM: .6, boundary, mode })));
const snapshot = (config = variants()[0], probeRatio = .137, phaseRad = .731, sampleCount = 2) => getSnapshot(config, { probeRatio, phaseRad, sampleCount });
const detailAt = (config, ratio, phase) => soundDetail(snapshot(config, ratio, wrapPhase(phase)));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const simpson = (fn, a, b, segments = 600) => {
  const step = (b - a) / segments; let sum = fn(a) + fn(b);
  for (let i = 1; i < segments; i++) sum += (i % 2 ? 4 : 2) * fn(a + i * step);
  return sum * step / 3;
};

test('independent quarter-position reference fixes RMS, acceleration, energy and flux signs', () => {
  const d = detailAt(variants()[0], .25, Math.PI / 4);
  for (const field of ['pressureRelative', 'displacementRelative', 'pressureRmsRelative', 'displacementRmsRelative', 'velocityRmsRelative', 'accelerationRmsRelative']) near(d.probe[field], .5);
  near(d.probe.velocityRelative, -.5); near(d.probe.accelerationRelative, -.5);
  near(d.energy.probeCompression, .25); near(d.energy.probeKinetic, .25); near(d.energy.probeTotal, .5);
  near(d.flux.instantaneousRelative, -.25); assert.equal(d.flux.cycleMeanRelative, 0);
  near(d.energy.wholeCompressionFraction, .5); near(d.energy.wholeKineticFraction, .5);
  near(d.mode.frequencyHz, 285.8333333333333); near(d.mode.periodS, 1.2 / 343);
  near(d.mode.realPhaseTimeS, 1.2 / (343 * 8)); near(d.mode.displayPhaseTimeS, .25);
  near(d.mode.slowdownRatio, 571.6666666666666);
  const closed = detailAt({ lengthM: .6, boundary: 'closed-open', mode: 1 }, .5, Math.PI / 4);
  near(closed.probe.pressureRelative, .5); near(closed.probe.displacementRelative, -.5);
  near(closed.probe.velocityRelative, .5); near(closed.probe.accelerationRelative, .5); near(closed.flux.instantaneousRelative, .25);
});

test('tabulated analytic nodes and antinodes produce physical positions and nearest distances', () => {
  const expected = {
    'open-open': [ [[0, 1], [.5]], [[0, .5, 1], [.25, .75]], [[0, 1/3, 2/3, 1], [1/6, .5, 5/6]] ],
    'closed-open': [ [[1], [0]], [[1/3, 1], [0, 2/3]], [[.2, .6, 1], [0, .4, .8]] ],
  };
  for (const config of variants()) {
    const d = soundDetail(snapshot(config)), [pressure, motion] = expected[config.boundary][config.mode - 1];
    assert.deepEqual(d.positions.pressureNodes, pressure.map(ratio => ({ ratio, xM: ratio * .6 })));
    assert.deepEqual(d.positions.motionNodes, motion.map(ratio => ({ ratio, xM: ratio * .6 })));
    assert.deepEqual(d.positions.pressureAntinodes, d.positions.motionNodes);
    assert.deepEqual(d.positions.motionAntinodes, d.positions.pressureNodes);
    for (const [points, key] of [[pressure, 'nearestPressureNode'], [motion, 'nearestMotionNode']]) {
      const minimum = Math.min(...points.map(r => Math.abs(r - .137) * .6));
      near(d.probe[key].distanceM, minimum); assert.ok(points.includes(d.probe[key].ratio));
    }
  }
  const tied = detailAt(variants()[0], .5, 0);
  assert.deepEqual(tied.probe.nearestPressureNode, { ratio: 0, xM: 0, distanceM: .3 });
  assert.deepEqual(tied.probe.nearestMotionAntinode, { ratio: 0, xM: 0, distanceM: .3 });
  const thirds = detailAt({ lengthM: .6, boundary: 'open-open', mode: 3 }, .5, 0);
  assert.equal(thirds.probe.nearestPressureNode.ratio, 1/3);
  const fifths = detailAt({ lengthM: .6, boundary: 'closed-open', mode: 3 }, .4, 0);
  assert.equal(fifths.probe.nearestPressureNode.ratio, .2);
});

test('exact structural classification never turns a near node or rounded antinode into an exact one', () => {
  for (const config of variants()) {
    const base = soundDetail(snapshot(config));
    for (const point of base.positions.pressureNodes) for (const phase of [0, Math.PI / 2, Math.PI, 4.9]) {
      const exact = detailAt(config, point.ratio, phase);
      assert.equal(exact.probe.pressureIsNode, true); assert.equal(exact.probe.motionIsAntinode, true);
      assert.equal(exact.probe.nearestPressureNode.distanceM, 0); assert.equal(exact.probe.pressureRmsRelative, 0);
      const ratio = point.ratio + (point.ratio === 1 ? -1 : 1) * 1e-9, close = detailAt(config, ratio, phase);
      assert.equal(close.probe.pressureIsNode, false); assert.equal(close.probe.motionIsAntinode, false);
      assert.ok(close.probe.nearestPressureNode.distanceM > 0);
    }
    for (const point of base.positions.motionNodes) {
      const exact = detailAt(config, point.ratio, 0), close = detailAt(config, point.ratio + 1e-9, 0);
      assert.equal(exact.probe.motionIsNode, true); assert.equal(exact.probe.pressureIsAntinode, true);
      assert.equal(close.probe.motionIsNode, false); assert.equal(close.probe.pressureIsAntinode, false);
    }
    const zeroInstant = detailAt(config, .137, Math.PI / 2);
    assert.equal(zeroInstant.probe.pressureRelative, 0); assert.equal(zeroInstant.probe.displacementRelative, 0);
    assert.equal(zeroInstant.probe.pressureIsNode, false); assert.equal(zeroInstant.probe.motionIsNode, false);
  }
  const rounded = detailAt(variants()[0], 1e-9, 0);
  assert.equal(rounded.probe.displacementEnvelope, 1, 'IEEE cosine can round a near-antinode amplitude to one');
  assert.equal(rounded.probe.motionIsAntinode, false);
});

test('RMS and cycle means match independent temporal quadrature of original samples', () => {
  const count = 1024;
  for (const config of variants()) for (const ratio of [0, .137, .5, .837, 1]) {
    const d = detailAt(config, ratio, .61); let p2 = 0, x2 = 0, u2 = 0, flux = 0;
    for (let i = 0; i < count; i++) {
      const s = sampleAt(config, ratio, TAU * (i + .5) / count);
      p2 += s.pressureRelative ** 2 / count; x2 += s.displacementRelative ** 2 / count;
      u2 += s.velocityRelative ** 2 / count; flux += s.pressureRelative * s.velocityRelative / count;
    }
    near(d.probe.pressureRmsRelative, Math.sqrt(p2), 2e-14);
    near(d.probe.displacementRmsRelative, Math.sqrt(x2), 2e-14); near(d.probe.velocityRmsRelative, Math.sqrt(u2), 2e-14);
    near(d.energy.cycleCompression, p2, 2e-14); near(d.energy.cycleKinetic, u2, 2e-14);
    near(d.energy.cycleTotal, p2 + u2, 2e-14); near(d.energy.cycleTotal, .5, 2e-14);
    near(d.flux.cycleMeanRelative, flux, 2e-14);
  }
});

test('global fractions match independent spatial integration instead of the probe energy', () => {
  for (const config of variants()) for (const phase of [0, .731, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    const d = detailAt(config, .137, phase);
    const potential = simpson(r => sampleAt(config, r, phase).pressureRelative ** 2, 0, 1);
    const kinetic = simpson(r => sampleAt(config, r, phase).velocityRelative ** 2, 0, 1);
    near(d.energy.wholeCompressionFraction, 2 * potential, 2e-13);
    near(d.energy.wholeKineticFraction, 2 * kinetic, 2e-13); near(d.energy.wholeTotalFraction, 1, 2e-15);
  }
  const antinode = detailAt(variants()[0], .5, Math.PI / 2);
  assert.equal(antinode.energy.probeTotal, 0); assert.equal(antinode.energy.wholeKineticFraction, 1);
  assert.equal(antinode.energy.wholeCompressionFraction, 0); assert.equal(antinode.energy.cycleTotal, .5);
});

test('two independent counterpropagating waves reconstruct instantaneous signed transfer', () => {
  for (const config of variants()) for (const ratio of [0, .173, .421, 1]) for (const phase of [.21, 1.7, 4.2]) {
    const harmonic = config.boundary === 'closed-open' ? 2 * config.mode - 1 : config.mode;
    const k = config.boundary === 'closed-open' ? harmonic * Math.PI / (2 * config.lengthM) : harmonic * Math.PI / config.lengthM;
    const basis = config.boundary === 'closed-open' ? Math.cos : Math.sin;
    const right = .5 * basis(k * ratio * config.lengthM - phase), left = .5 * basis(k * ratio * config.lengthM + phase);
    const d = detailAt(config, ratio, phase);
    near(d.probe.pressureRelative, right + left); near(d.probe.velocityRelative, right - left);
    near(d.flux.instantaneousRelative, right ** 2 - left ** 2);
    assert.ok(Math.abs(d.flux.instantaneousRelative) <= .25 + 1e-15);
  }
});

test('local energy obeys the differential conservation law with the correct normalization factor', () => {
  for (const config of variants()) for (const ratio of [.137, .421, .837]) for (const phase of [.3, 1.2, 2.7]) {
    const d = detailAt(config, ratio, phase), k = d.mode.waveNumberRadPerM, hp = 1e-5, hx = 1e-5 / k;
    const ePhase = (detailAt(config, ratio, phase + hp).energy.probeTotal - detailAt(config, ratio, phase - hp).energy.probeTotal) / (2 * hp);
    const fluxX = (detailAt(config, ratio + hx / config.lengthM, phase).flux.instantaneousRelative - detailAt(config, ratio - hx / config.lengthM, phase).flux.instantaneousRelative) / (2 * hx);
    near(ePhase + 2 * fluxX / k, 0, 2e-9);
  }
});

test('finite-region energy change equals the integrated boundary transfer', () => {
  for (const config of variants()) {
    const x0 = .13 * config.lengthM, x1 = .71 * config.lengthM, a = .2, b = 2.1;
    const k = detailAt(config, .5, a).mode.waveNumberRadPerM;
    const energyChange = simpson(x => detailAt(config, x / config.lengthM, b).energy.probeTotal
      - detailAt(config, x / config.lengthM, a).energy.probeTotal, x0, x1);
    const boundary = simpson(phase => {
      const left = sampleAt(config, x0 / config.lengthM, phase), right = sampleAt(config, x1 / config.lengthM, phase);
      return right.pressureRelative * right.velocityRelative - left.pressureRelative * left.velocityRelative;
    }, a, b);
    near(energyChange, -2 * boundary / k, 2e-11);
  }
});

test('acceleration is the physical-time velocity derivative divided by its own amplitude scale', () => {
  for (const config of variants()) for (const ratio of [.137, .421, .837]) {
    const phase = .731, d = detailAt(config, ratio, phase), omega = d.mode.omegaRadPerS;
    const dt = 1e-5 / omega;
    const earlier = sampleAt(config, ratio, phase - omega * dt), later = sampleAt(config, ratio, phase + omega * dt);
    near((later.velocityRelative - earlier.velocityRelative) / (2 * dt * omega), d.probe.accelerationRelative, 1e-9);
    const h = 1e-3, previous = sampleAt(config, ratio, phase - h), next = sampleAt(config, ratio, phase + h);
    near((next.displacementRelative - 2 * d.probe.displacementRelative + previous.displacementRelative) / h ** 2, d.probe.accelerationRelative, 1e-7);
  }
});

test('length scaling changes physical distances and periods but never invents absolute amplitudes', () => {
  for (const config of variants()) {
    const a = detailAt({ ...config, lengthM: .3 }, .137, 1.2), b = detailAt({ ...config, lengthM: 1.2 }, .137, 1.2);
    assert.equal(a.mode.frequencyHz, 4 * b.mode.frequencyHz); assert.equal(b.mode.periodS, 4 * a.mode.periodS);
    assert.equal(b.mode.realPhaseTimeS, 4 * a.mode.realPhaseTimeS); assert.equal(a.mode.displayPhaseTimeS, b.mode.displayPhaseTimeS);
    assert.equal(a.mode.displayPeriodS, 2); assert.equal(b.probe.xM, 4 * a.probe.xM);
    assert.equal(b.probe.nearestPressureNode.distanceM, 4 * a.probe.nearestPressureNode.distanceM);
    for (const key of ['pressureRmsRelative', 'velocityRmsRelative', 'accelerationRelative']) assert.equal(a.probe[key], b.probe[key]);
    assert.deepEqual(a.energy, b.energy); assert.deepEqual(a.flux, b.flux);
    near(a.mode.omegaRadPerS / a.mode.waveNumberRadPerM, 343);
  }
});

test('exact quarter phases keep whole-energy zeros exact and phase time is cyclic rather than cumulative', () => {
  for (const config of variants()) {
    for (const [phase, compression, kinetic] of [[0, 1, 0], [Math.PI / 2, 0, 1], [Math.PI, 1, 0], [3 * Math.PI / 2, 0, 1]]) {
      const d = detailAt(config, .137, phase);
      assert.equal(d.energy.wholeCompressionFraction, compression); assert.equal(d.energy.wholeKineticFraction, kinetic);
      assert.equal(d.flux.instantaneousRelative, 0); assert.equal(Object.is(d.flux.instantaneousRelative, -0), false);
    }
    const d = detailAt(config, .137, TAU - 1e-10);
    assert.ok(d.mode.realPhaseTimeS < d.mode.periodS); assert.ok(d.mode.displayPhaseTimeS < 2);
    assert.equal(detailAt(config, .137, TAU).mode.realPhaseTimeS, 0);
  }
});

test('drawing sample density and off-grid probe positions cannot bias exact diagnostics', () => {
  for (const config of variants()) {
    const sparse = snapshot(config, .173829, 1.234, 2), dense = snapshot(config, .173829, 1.234, 513);
    assert.deepEqual(soundDetail(sparse), soundDetail(dense));
    sparse.samples = [{ pressureRelative: 12345 }];
    assert.deepEqual(soundDetail(sparse), soundDetail(dense), 'unused chart samples are not a diagnostic source');
  }
});

test('invalid or internally mismatched solved observations are rejected without normalization', () => {
  for (const bad of [null, [], new Date(), undefined]) assert.throws(() => soundDetail(bad));
  const mutations = [s => { s.config.lengthM = '0.6'; }, s => { s.config.mode = 4; }, s => { s.phaseRad = -0; },
    s => { s.phaseRad = TAU; }, s => { s.probeRatio = Infinity; }, s => { s.probeRatio = .3; },
    s => { s.frequencyHz *= 2; }, s => { delete s.harmonic; }, s => { s.probe.velocityRelative = NaN; },
    s => { s.nodes.pressureRatios[0] = 1e-9; }, s => { s.nodes.displacementRatios = []; }, s => { s.probe = null; }];
  for (const mutate of mutations) { const s = snapshot(); mutate(s); const before = structuredClone(s); assert.throws(() => soundDetail(s)); assert.deepEqual(s, before); }
  assert.throws(() => describeSoundDetail('not-a-part', snapshot()), RangeError);
});

test('frozen snapshots, project records and comparison observations remain byte-for-byte unchanged', () => {
  const record = createProject({ experiment: { config: variants()[4], probeRatio: .173829, phaseRad: .731 },
    comparison: { label: '원래 조건', experiment: { config: variants()[0], probeRatio: .5, phaseRad: Math.PI / 2 } } });
  const before = serializeProject(record), s = freeze(getSnapshot(record.experiment.config,
    { phaseRad: record.experiment.phaseRad, probeRatio: record.experiment.probeRatio })), original = structuredClone(s);
  const d = soundDetail(s), reference = soundDetail(s);
  for (const part of COMPONENTS) describeSoundDetail(part.id, s, d);
  d.positions.pressureNodes[0].xM = 100; d.probe.nearestPressureNode.xM = 200; d.mode.frequencyHz = 123;
  assert.deepEqual(soundDetail(s), reference); assert.deepEqual(s, original); assert.equal(serializeProject(record), before);
  assert.notStrictEqual(reference.positions.pressureNodes, reference.positions.motionAntinodes);
  assert.notStrictEqual(reference.positions.pressureNodes[0], reference.positions.motionAntinodes[0]);
});

test('all fourteen component descriptions stay finite and within six facts at every supported mode boundary', () => {
  for (const config of variants()) for (const lengthM of [.3, 1.2]) for (const phase of [0, Math.PI / 2, 1.137]) for (const ratio of [0, .137, 1]) {
    const s = freeze(snapshot({ ...config, lengthM }, ratio, phase)), d = freeze(soundDetail(s));
    for (const { id } of COMPONENTS) {
      const result = describeSoundDetail(id, s, d);
      assert.ok(result.facts.length >= 4 && result.facts.length <= 6); assert.ok(result.note.length > 20);
      for (const fact of result.facts) {
        assert.ok(fact.label); assert.ok(typeof fact.value === 'string' || Number.isFinite(fact.value));
        assert.ok(Number.isInteger(fact.digits) && fact.digits >= 0 && fact.digits <= 6);
        assert.ok(!['Pa', 'dB', 'J', 'W', 'm/s', 'm/s²'].includes(fact.unit), `${id} invents calibrated units`);
      }
    }
  }
});

test('component geometry facts use SI-to-millimeter conversions without making acoustic amplitude claims', () => {
  const s = snapshot({ lengthM: .9, boundary: 'closed-open', mode: 2 });
  const values = id => Object.fromEntries(describeSoundDetail(id, s).facts.map(f => [f.label, f.value]));
  const tube = values('tube-wall'); near(tube['관 길이'], 900); near(tube['관 내경'], 40);
  near(tube['내부 단면적'], 400 * Math.PI); near(tube['관 길이 / 파장'], .75);
  near(values('rail')['레일 길이'], (.9 + GEOMETRY.rails.lengthMarginM) * 1000);
  near(values('left-support')['왼쪽 끝에서 지지축까지'], GEOMETRY.supportInsetM * 1000);
  near(values('right-support')['왼쪽 끝에서 지지축까지'], (.9 - GEOMETRY.supportInsetM) * 1000);
  near(values('tube-collars')['고정 링 내경'], 2 * GEOMETRY.collar.innerRadiusM * 1000);
  near(values('readout')['화면 한 주기'], 2);
});

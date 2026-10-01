import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { MODEL_VERSION, DEFAULT_CONFIG, DEFAULT_PHASE_RAD, DEFAULT_PROBE_RATIO,
  normalizeConfig, assertConfig, wrapPhase, normalizeProbeRatio, solveMode, sampleAt, getSnapshot } from '../src/model.js';

const TAU = 2 * Math.PI;
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (±${tolerance})`);
const config = (boundary = 'open-open', mode = 1, lengthM = .6) => ({ lengthM, boundary, mode });
const variants = () => ['open-open', 'closed-open'].flatMap(boundary => [1, 2, 3].map(mode => config(boundary, mode)));

test('stable identity and frozen defaults describe the selected air-column eigenmode', () => {
  assert.equal(MODEL_VERSION, 'sound-standing-wave-1');
  assert.deepEqual(DEFAULT_CONFIG, { lengthM: .6, boundary: 'open-open', mode: 1 });
  assert.ok(Object.isFrozen(DEFAULT_CONFIG)); assert.equal(DEFAULT_PHASE_RAD, 0); assert.equal(DEFAULT_PROBE_RATIO, .5);
  assert.throws(() => { DEFAULT_CONFIG.mode = 2; }, TypeError);
  assert.equal(assertConfig(DEFAULT_CONFIG), DEFAULT_CONFIG);
});

test('strict config accepts only its exact shape and finite supported values without mutation', () => {
  for (const lengthM of [.3, 1.2]) for (const boundary of ['open-open', 'closed-open']) for (const mode of [1, 2, 3]) {
    const value = Object.freeze(config(boundary, mode, lengthM)); assert.equal(assertConfig(value), value);
  }
  const valid = config(), original = structuredClone(valid);
  for (const value of [null, undefined, [], new Date(), 'config', {}, { ...valid, unknown: true }, { ...valid, [Symbol('extra')]: 1 },
    { boundary: 'open-open', mode: 1 }, { ...valid, lengthM: .2999 }, { ...valid, lengthM: 1.2001 }, { ...valid, lengthM: '0.6' },
    { ...valid, lengthM: NaN }, { ...valid, lengthM: Infinity }, { ...valid, lengthM: -0 },
    { ...valid, boundary: 'closed-closed' }, { ...valid, boundary: true }, { ...valid, mode: 0 }, { ...valid, mode: 4 },
    { ...valid, mode: 1.5 }, { ...valid, mode: '1' }, { ...valid, mode: NaN }, Object.create(valid)]) assert.throws(() => assertConfig(value));
  const hiddenExtra = { ...valid }; Object.defineProperty(hiddenExtra, 'secret', { value: 1 }); assert.throws(() => assertConfig(hiddenExtra));
  const nullPrototype = Object.assign(Object.create(null), valid); assert.equal(assertConfig(nullPrototype), nullPrototype);
  assert.deepEqual(valid, original);
});

test('live config normalization clamps length but never coerces string numbers or invents unsupported modes', () => {
  for (const value of [undefined, null, [], '0.6', {}, { lengthM: NaN, boundary: null, mode: 2.2 }]) assert.deepEqual(normalizeConfig(value), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ lengthM: 0, boundary: 'closed-open', mode: 3, extra: 1 }), config('closed-open', 3, .3));
  assert.deepEqual(normalizeConfig({ lengthM: 2, boundary: 'open-open', mode: 2 }), config('open-open', 2, 1.2));
  assert.deepEqual(normalizeConfig({ lengthM: '1.2', boundary: 'wrong', mode: '3' }), DEFAULT_CONFIG);
  const input = config('closed-open', 2, .5), normalized = normalizeConfig(input); normalized.lengthM = .9;
  assert.equal(input.lengthM, .5); assert.notStrictEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('independently tabulated first three frequencies match both endpoint families', () => {
  const references = [
    [.5, [343, 686, 1029], [171.5, 514.5, 857.5]],
    [.6, [285.8333333333333, 571.6666666666666, 857.5], [142.91666666666666, 428.75, 714.5833333333334]],
    [1, [171.5, 343, 514.5], [85.75, 257.25, 428.75]],
  ];
  for (const [length, open, closed] of references) for (let index = 0; index < 3; index++) {
    near(solveMode(config('open-open', index + 1, length)).frequencyHz, open[index]);
    near(solveMode(config('closed-open', index + 1, length)).frequencyHz, closed[index]);
  }
  near(solveMode(config('closed-open', 1, 1.2)).frequencyHz, 71.45833333333333);
  near(solveMode(config('open-open', 3, .3)).frequencyHz, 1715);
});

test('wavelength, angular wavenumber and period have consistent SI units and inverse length scaling', () => {
  for (const boundary of ['open-open', 'closed-open']) for (const mode of [1, 2, 3]) {
    const a = solveMode(config(boundary, mode, .5)), b = solveMode(config(boundary, mode, 1));
    near(a.frequencyHz * a.wavelengthM, 343); near(a.frequencyHz * a.periodS, 1);
    near(a.waveNumberRadPerM * a.wavelengthM, TAU); near(343 * a.waveNumberRadPerM, TAU * a.frequencyHz, 1e-9);
    assert.equal(b.wavelengthM, 2 * a.wavelengthM); assert.equal(b.frequencyHz, a.frequencyHz / 2); assert.equal(b.periodS, 2 * a.periodS);
    assert.equal(a.harmonic, boundary === 'open-open' ? mode : [1, 3, 5][mode - 1]);
  }
  near(solveMode(config('open-open', 1, .5)).periodS * 1000, 2.9154518950437316);
  near(solveMode(config('closed-open', 1, .5)).periodS * 1000, 5.830903790087463);
});

test('analytic node coordinates agree with independent first-three-mode fractions', () => {
  const expected = {
    'open-open': [ [[0, 1], [.5]], [[0, .5, 1], [.25, .75]], [[0, 1/3, 2/3, 1], [1/6, .5, 5/6]] ],
    'closed-open': [ [[1], [0]], [[1/3, 1], [0, 2/3]], [[.2, .6, 1], [0, .4, .8]] ],
  };
  for (const value of variants()) {
    const { nodes } = solveMode(value), [pressure, displacement] = expected[value.boundary][value.mode - 1];
    assert.deepEqual(nodes.pressureRatios, pressure); assert.deepEqual(nodes.displacementRatios, displacement);
    for (const ratio of pressure) assert.equal(sampleAt(value, ratio, 0).pressureShape, 0);
    for (const ratio of displacement) {
      assert.equal(sampleAt(value, ratio, 0).displacementShape, 0);
      assert.equal(sampleAt(value, ratio, Math.PI / 2).velocityRelative, 0);
    }
  }
});

test('open pressure and closed displacement boundary conditions hold at every tested phase', () => {
  for (const value of variants()) for (const phase of [0, .31, Math.PI / 2, Math.PI, 3 * Math.PI / 2, TAU - 1e-6]) {
    assert.equal(sampleAt(value, 1, phase).pressureRelative, 0);
    const left = sampleAt(value, 0, phase);
    if (value.boundary === 'open-open') assert.equal(left.pressureRelative, 0);
    else { assert.equal(left.displacementRelative, 0); assert.equal(left.velocityRelative, 0); }
  }
});

test('independent quarter-position values establish compression, displacement and velocity signs', () => {
  const halfRoot = Math.SQRT1_2;
  const open = sampleAt(config('open-open', 1), .25, 0);
  near(open.pressureRelative, halfRoot); near(open.displacementRelative, halfRoot); assert.equal(open.velocityRelative, 0);
  const closed = sampleAt(config('closed-open', 1), .5, 0);
  near(closed.pressureRelative, halfRoot); near(closed.displacementRelative, -halfRoot); assert.equal(closed.velocityRelative, 0);
  const openMoving = sampleAt(config('open-open', 1), .25, Math.PI / 2);
  const closedMoving = sampleAt(config('closed-open', 1), .5, Math.PI / 2);
  assert.equal(openMoving.pressureRelative, 0); assert.equal(openMoving.displacementRelative, 0); near(openMoving.velocityRelative, -halfRoot);
  assert.equal(closedMoving.pressureRelative, 0); assert.equal(closedMoving.displacementRelative, 0); near(closedMoving.velocityRelative, halfRoot);
  near(sampleAt(config('closed-open', 1), .5, Math.PI).pressureRelative, -halfRoot);
  near(sampleAt(config('closed-open', 1), .5, Math.PI).displacementRelative, halfRoot);
});

test('nodes and nonnegative envelopes stay fixed when instantaneous fields cross zero', () => {
  for (const value of variants()) {
    const a = getSnapshot(value), b = getSnapshot(value, { phaseRad: Math.PI / 2 });
    assert.deepEqual(b.nodes, a.nodes);
    for (let i = 0; i < a.samples.length; i++) {
      const zero = b.samples[i], initial = a.samples[i];
      assert.equal(zero.pressureRelative, 0); assert.equal(zero.displacementRelative, 0);
      assert.equal(zero.pressureEnvelope, initial.pressureEnvelope); assert.equal(zero.displacementEnvelope, initial.displacementEnvelope);
      assert.equal(zero.pressureEnvelope, Math.abs(zero.pressureShape)); assert.equal(zero.displacementEnvelope, Math.abs(zero.displacementShape));
      assert.ok(zero.pressureEnvelope >= 0 && zero.pressureEnvelope <= 1);
    }
    assert.ok(b.samples.some(point => Math.abs(point.velocityRelative) > .9));
    assert.ok(b.samples.filter(point => point.pressureEnvelope > .1).length > b.nodes.pressureRatios.length);
  }
});

test('finite differences independently satisfy compression and momentum spatial relations', () => {
  for (const value of variants()) for (const ratio of [.13, .31, .57, .83]) {
    const k = solveMode(value).waveNumberRadPerM, hM = 1e-5 / k, hRatio = hM / value.lengthM;
    const center = sampleAt(value, ratio, 0), left = sampleAt(value, ratio - hRatio, 0), right = sampleAt(value, ratio + hRatio, 0);
    near((right.displacementShape - left.displacementShape) / (2 * hM * k), -center.pressureShape, 1e-9);
    near((right.pressureShape - left.pressureShape) / (2 * hM * k), center.displacementShape, 1e-9);
  }
});

test('velocity is the phase derivative of displacement and both fields satisfy the wave equation', () => {
  for (const value of variants()) for (const ratio of [.13, .31, .57, .83]) {
    const phase = .72, hPhase = 1e-5, center = sampleAt(value, ratio, phase);
    const earlier = sampleAt(value, ratio, phase - hPhase), later = sampleAt(value, ratio, phase + hPhase);
    near((later.displacementRelative - earlier.displacementRelative) / (2 * hPhase), center.velocityRelative, 1e-9);
    const k = solveMode(value).waveNumberRadPerM, hM = 1e-3 / k;
    const left = sampleAt(value, ratio - hM / value.lengthM, phase), right = sampleAt(value, ratio + hM / value.lengthM, phase);
    for (const field of ['pressureRelative', 'displacementRelative']) near((right[field] - 2 * center[field] + left[field]) / (hM * hM * k * k), -center[field], 1e-6);
  }
});

test('independent spatial quadrature has constant normalized energy while pressure and kinetic terms exchange', () => {
  const segments = 2400;
  for (const value of variants()) {
    const shapes = Array.from({ length: segments + 1 }, (_, i) => sampleAt(value, i / segments, 0));
    for (const phase of [0, .71, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      let potential = 0, kinetic = 0;
      shapes.forEach((point, i) => { const weight = i === 0 || i === segments ? .5 : 1;
        potential += weight * (point.pressureShape * Math.cos(phase)) ** 2 / segments;
        kinetic += weight * (point.displacementShape * Math.sin(phase)) ** 2 / segments;
      });
      near(potential, .5 * Math.cos(phase) ** 2, 1e-12); near(kinetic, .5 * Math.sin(phase) ** 2, 1e-12); near(potential + kinetic, .5, 1e-12);
    }
  }
});

test('snapshot has exact public fields, uniform physical positions and an independently sampled probe', () => {
  const value = config('closed-open', 3, .9), result = getSnapshot(value, { phaseRad: 1.2, probeRatio: .173, sampleCount: 17 });
  assert.deepEqual(Object.keys(result).sort(), ['config', 'harmonic', 'frequencyHz', 'wavelengthM', 'periodS', 'waveNumberRadPerM', 'nodes', 'phaseRad', 'probeRatio', 'probe', 'samples'].sort());
  assert.deepEqual(Object.keys(result.probe).sort(), ['positionRatio', 'xM', 'pressureShape', 'displacementShape', 'pressureEnvelope', 'displacementEnvelope', 'pressureRelative', 'displacementRelative', 'velocityRelative'].sort());
  assert.equal(result.phaseRad, 1.2); assert.equal(result.probeRatio, .173); assert.equal(result.samples.length, 17);
  assert.deepEqual(result.probe, sampleAt(value, .173, 1.2));
  for (let i = 0; i < 17; i++) { assert.equal(result.samples[i].positionRatio, i / 16); assert.equal(result.samples[i].xM, .9 * i / 16); }
  const defaults = getSnapshot(DEFAULT_CONFIG); assert.equal(defaults.samples.length, 129); assert.equal(defaults.phaseRad, 0); assert.equal(defaults.probeRatio, .5);
  assert.deepEqual(defaults.probe, defaults.samples[64]); assert.notStrictEqual(defaults.probe, defaults.samples[64]);
  assert.equal(getSnapshot(value, { sampleCount: 2 }).samples.length, 2); assert.equal(getSnapshot(value, { sampleCount: 513 }).samples.length, 513);
});

test('length changes preserve normalized shape exactly while scaling only physical position and frequency', () => {
  for (const value of variants()) {
    const short = getSnapshot({ ...value, lengthM: .3 }, { phaseRad: 1.123, sampleCount: 31 });
    const long = getSnapshot({ ...value, lengthM: 1.2 }, { phaseRad: 1.123, sampleCount: 31 });
    assert.deepEqual(short.nodes, long.nodes); assert.equal(short.frequencyHz, 4 * long.frequencyHz);
    short.samples.forEach((point, i) => { const { xM, ...shape } = point, { xM: longX, ...longShape } = long.samples[i];
      assert.deepEqual(shape, longShape); assert.equal(longX, 4 * xM);
    });
  }
});

test('all returned arrays, configuration and probe records are detached from inputs and other calls', () => {
  const input = Object.freeze(config('closed-open', 2)), options = Object.freeze({ phaseRad: .7, probeRatio: .2 });
  const one = getSnapshot(input, options), two = getSnapshot(input, options), original = structuredClone(two);
  one.config.mode = 1; one.nodes.pressureRatios[0] = 100; one.samples[0].pressureRelative = 100; one.probe.xM = 100;
  assert.deepEqual(two, original); assert.deepEqual(getSnapshot(input, options), original); assert.equal(input.mode, 2);
  const mode = solveMode(input); mode.config.lengthM = 99; mode.nodes.displacementRatios.length = 0;
  assert.equal(input.lengthM, .6); assert.deepEqual(solveMode(input).nodes.displacementRatios, [0, 2/3]);
});

test('strict sample and snapshot input rejects missing, out-of-range, nonfinite, negative zero and unknown fields', () => {
  for (const invalid of [undefined, null, '0', NaN, Infinity, -Infinity, -0, -.001, 1.001]) {
    assert.throws(() => sampleAt(DEFAULT_CONFIG, invalid, 0)); assert.throws(() => getSnapshot(DEFAULT_CONFIG, { probeRatio: invalid === undefined ? null : invalid }));
  }
  for (const invalid of [undefined, null, '0', NaN, Infinity, -Infinity, -0, -.001, TAU, TAU + 1]) {
    assert.throws(() => sampleAt(DEFAULT_CONFIG, .5, invalid)); assert.throws(() => getSnapshot(DEFAULT_CONFIG, { phaseRad: invalid === undefined ? null : invalid }));
  }
  for (const options of [null, [], 'options', new Date(), { unknown: true }, { [Symbol('extra')]: 1 },
    { sampleCount: 1 }, { sampleCount: 514 }, { sampleCount: 129.1 }, { sampleCount: '129' }, { sampleCount: NaN }, { sampleCount: Infinity }]) assert.throws(() => getSnapshot(DEFAULT_CONFIG, options));
  assert.deepEqual(getSnapshot(DEFAULT_CONFIG, { phaseRad: undefined, probeRatio: undefined, sampleCount: undefined }), getSnapshot(DEFAULT_CONFIG));
  assert.throws(() => solveMode({ ...DEFAULT_CONFIG, mode: 4 })); assert.throws(() => getSnapshot({ ...DEFAULT_CONFIG, lengthM: 2 }));
});

test('phase wrapping is canonical, periodic and finite without erasing tiny positive phases', () => {
  assert.equal(wrapPhase(0), 0); assert.equal(Object.is(wrapPhase(-0), -0), false);
  assert.equal(wrapPhase(TAU), 0); assert.equal(wrapPhase(-TAU), 0); near(wrapPhase(-Math.PI / 2), 3 * Math.PI / 2);
  assert.equal(wrapPhase(1e-20), 1e-20); assert.equal(wrapPhase(-Number.MIN_VALUE), 0);
  for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE, 1e12, -1e12, -8.51, .123]) {
    const phase = wrapPhase(value); assert.ok(phase >= 0 && phase < TAU); assert.equal(Object.is(phase, -0), false);
  }
  for (const turns of [-100, -1, 0, 1, 100]) near(wrapPhase(.123 + turns * TAU), .123, 1e-12);
  for (const value of [undefined, null, '0', NaN, Infinity, -Infinity]) assert.throws(() => wrapPhase(value), TypeError);
  assert.deepEqual(sampleAt(DEFAULT_CONFIG, .3, wrapPhase(TAU)), sampleAt(DEFAULT_CONFIG, .3, 0));
});

test('live probe normalization preserves valid values and repairs only live inputs', () => {
  assert.equal(normalizeProbeRatio(.173), .173); assert.equal(normalizeProbeRatio(-2), 0); assert.equal(normalizeProbeRatio(2), 1);
  assert.equal(Object.is(normalizeProbeRatio(-0), -0), false);
  for (const value of [undefined, null, '0.2', NaN, Infinity, -Infinity, {}]) assert.equal(normalizeProbeRatio(value), .5);
});

test('513-sample snapshots remain bounded and require no history replay', () => {
  const started = performance.now(); let count = 0;
  for (let i = 0; i < 100; i++) {
    const value = getSnapshot(config('closed-open', 3, .3), { phaseRad: wrapPhase(i * .173), sampleCount: 513 });
    count += value.samples.length;
    for (const point of value.samples) for (const key of ['pressureRelative', 'displacementRelative', 'velocityRelative']) assert.ok(Number.isFinite(point[key]) && Math.abs(point[key]) <= 1);
  }
  assert.equal(count, 51300);
  console.log(`CPU: 100 × 513-sample snapshots plus field assertions in ${(performance.now() - started).toFixed(3)} ms`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, parseProject, serializeProject, normalizeView, DEFAULT_VIEW, ProjectError } from '../src/project.js';
import { DEFAULT_CONFIG, MODEL_VERSION, getSnapshot } from '../src/model.js';
import { COMPONENTS } from '../src/geometry.js';
const TAU = Math.PI * 2, roundtrip = value => parseProject(serializeProject(value));
const experiment = () => ({ config: { lengthM: .875123, boundary: 'closed-open', mode: 3 }, phaseRad: 1.23456789, probeRatio: .314159 });
const rejects = edit => { const value = createProject(); edit(value); const raw = JSON.stringify(value); assert.throws(() => parseProject(raw), e => e instanceof ProjectError && e.preserveOriginal); assert.equal(JSON.stringify(value), raw); };

test('default envelope contains only the selected standing-wave experiment and observation', () => {
  const value = createProject();
  assert.deepEqual(value, { type: 'sound-lab-project', schemaVersion: 1, modelVersion: MODEL_VERSION,
    experiment: { config: { ...DEFAULT_CONFIG }, phaseRad: 0, probeRatio: .5 }, comparison: null,
    observation: { view: { ...DEFAULT_VIEW }, camera: null } });
  assert.deepEqual(roundtrip(value), value);
});

test('both boundaries and all modes preserve finite phase and probe endpoints exactly', () => {
  for (const boundary of ['open-open', 'closed-open']) for (const mode of [1, 2, 3]) for (const lengthM of [.3, 1.2]) for (const phaseRad of [0, Math.PI / 2, TAU - 1e-12]) for (const probeRatio of [0, .5, 1]) {
    const value = { config: { lengthM, boundary, mode }, phaseRad, probeRatio };
    assert.deepEqual(roundtrip(createProject({ experiment: value })).experiment, value);
  }
});

test('fractional observations and a different frozen comparison rebuild the same derived samples', () => {
  const current = experiment(), comparison = { label: '0.5 m 열린 관', experiment: { config: { lengthM: .5, boundary: 'open-open', mode: 1 }, phaseRad: Math.PI, probeRatio: 1 } };
  const value = createProject({ experiment: current, comparison }), restored = roundtrip(value);
  assert.deepEqual(restored, value);
  for (const observed of [restored.experiment, restored.comparison.experiment]) {
    const source = observed === restored.experiment ? current : comparison.experiment;
    assert.deepEqual(getSnapshot(observed.config, { phaseRad: observed.phaseRad, probeRatio: observed.probeRatio }), getSnapshot(source.config, { phaseRad: source.phaseRad, probeRatio: source.probeRatio }));
  }
  assert.equal(getSnapshot(restored.comparison.experiment.config).frequencyHz, 343);
});

test('strict imports reject invalid lengths, modes and boundary types instead of repairing them', () => {
  for (const edit of [p => { p.experiment.config.lengthM = .299; }, p => { p.experiment.config.lengthM = 1.201; }, p => { p.experiment.config.lengthM = '0.6'; },
    p => { p.experiment.config.mode = 1.5; }, p => { p.experiment.config.mode = 0; }, p => { p.experiment.config.mode = 4; },
    p => { p.experiment.config.boundary = 'open-closed'; }, p => { p.experiment.config.speed = 343; }, p => { delete p.experiment.config.mode; }]) rejects(edit);
});

test('saved phase and probe ranges reject wrapping, clamping and nonfinite or signed-zero input', () => {
  for (const phaseRad of [-1, TAU, TAU + .1, '0', null]) rejects(p => { p.experiment.phaseRad = phaseRad; });
  for (const probeRatio of [-.01, 1.01, '0.5', null]) rejects(p => { p.experiment.probeRatio = probeRatio; });
  for (const field of ['phaseRad', 'probeRatio']) for (const number of [NaN, Infinity, -Infinity, -0]) {
    const value = createProject(); value.experiment[field] = number; assert.throws(() => serializeProject(value), ProjectError);
  }
});

test('live defaults normalize inputs while valid selected observations remain exact', () => {
  const value = createProject({ experiment: { config: { lengthM: 99, boundary: 'closed-open', mode: 3 }, phaseRad: TAU, probeRatio: 2 } });
  assert.deepEqual(value.experiment, { config: { lengthM: 1.2, boundary: 'closed-open', mode: 3 }, phaseRad: 0, probeRatio: 1 });
  assert.deepEqual(createProject({ experiment: experiment() }).experiment, experiment());
  assert.deepEqual(createProject(null), createProject());
  const invalid = createProject({ experiment: { config: null, phaseRad: Infinity, probeRatio: NaN } });
  assert.deepEqual(invalid.experiment, createProject().experiment);
});

test('all fourteen real and virtual component selections and flags roundtrip independently', () => {
  assert.equal(COMPONENTS.length, 14); assert.deepEqual(normalizeView(null), DEFAULT_VIEW);
  for (const { id } of COMPONENTS) {
    const view = { cutaway: false, particles: false, pressure: false, exploded: true, labels: false, selectedPart: id };
    assert.deepEqual(roundtrip(createProject({ view })).observation.view, view);
  }
  rejects(p => { p.observation.view.selectedPart = 'heat-sink'; }); rejects(p => { p.observation.view.pressure = 1; }); rejects(p => { p.observation.view.mode = 'assembled'; });
});

test('manual camera boundary positions and optional zoom preserve exact values', () => {
  for (const camera of [null, { position: [.05, 0, 0], target: [0, 0, 0] }, { position: [100, 100, 100], target: [90, 100, 100], zoom: .25 },
    { position: [.7323456789, .55, 1.4], target: [.1, .2, -.3], zoom: 4 }]) assert.deepEqual(roundtrip(createProject({ camera })).observation.camera, camera);
  for (const camera of [{ position: [0, 0, 0], target: [0, 0, 0] }, { position: [.049, 0, 0], target: [0, 0, 0] },
    { position: [10.01, 0, 0], target: [0, 0, 0] }, { position: [1, 0], target: [0, 0, 0] }, { position: [1, 0, 0], target: [0, 0, 0], zoom: 5 }]) rejects(p => { p.observation.camera = camera; });
});

test('comparison has its own strict experiment and no state or camera aliases caller data', () => {
  const input = { experiment: experiment(), comparison: { label: ' 보관 조건 ', experiment: experiment() }, camera: { position: [1, 1, 1], target: [0, 0, 0] } };
  const before = structuredClone(input), value = createProject(input);
  value.experiment.config.lengthM = .4; value.comparison.experiment.phaseRad = 0; value.observation.camera.position[0] = 2;
  assert.deepEqual(input, before); assert.equal(roundtrip(value).comparison.label, input.comparison.label);
  for (const label of ['', ' ', 'a'.repeat(81), 'bad\nname']) rejects(p => { p.comparison = { label, experiment: experiment() }; });
  rejects(p => { p.comparison = { label: 'bad', experiment: { ...experiment(), probeRatio: 2 } }; });
  assert.equal(createProject({ comparison: { label: 'bad', experiment: null } }).comparison, null);
});

test('derived frequencies, traces, audio, clock and guide fields are not accepted as saved state', () => {
  for (const key of ['running', 'audio', 'gain', 'playbackRate', 'elapsedS', 'guide']) rejects(p => { p[key] = 1; });
  for (const key of ['frequencyHz', 'samples', 'events', 'snapshot']) rejects(p => { p.experiment[key] = []; });
  rejects(p => { p.comparison = { label: 'derived', experiment: experiment(), frequencyHz: 343 }; });
});

test('future format and model versions protect originals and unrelated products are refused', () => {
  for (const [key, value, code] of [['schemaVersion', 2, 'FUTURE_SCHEMA'], ['modelVersion', 'sound-standing-wave-2', 'FUTURE_MODEL']]) {
    assert.throws(() => parseProject(JSON.stringify({ ...createProject(), [key]: value })), e => e instanceof ProjectError && e.futureVersion && e.preserveOriginal && e.code === code);
  }
  rejects(p => { p.type = 'thermal-lab-project'; }); rejects(p => { p.modelVersion = 'thermal-two-node-1'; }); rejects(p => { p.schemaVersion = '1'; }); rejects(p => { delete p.comparison; });
});

test('one BOM and the UTF-8 byte cap preserve malformed text without changing it', () => {
  const value = createProject(), raw = serializeProject(value); assert.deepEqual(parseProject('\ufeff' + raw), value);
  for (const input of ['\ufeff\ufeff' + raw, '{원본\r\n', null, 4]) assert.throws(() => parseProject(input), e => e.code === 'INVALID_JSON');
  for (const input of [' '.repeat(10 * 1024 * 1024 + 1), '가'.repeat(4 * 1024 * 1024)]) assert.throws(() => parseProject(input), e => e.code === 'PROJECT_TOO_LARGE');
});

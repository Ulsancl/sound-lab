import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, getSnapshot, normalizeConfig, solveMode, soundSpeedMps } from '../src/model.js';
import { createProject, DISPLAY_PERIOD_S, parseProject, serializeProject, ProjectError } from '../src/project.js';

const near = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('dry air temperature changes the acoustic clock and pitch while fixed geometry sets the mode shapes', () => {
  assert.equal(soundSpeedMps(), 343);
  near(soundSpeedMps(-20), 318.74, .01);
  near(soundSpeedMps(40), 354.51, .01);
  for (const [boundary, harmonics] of [['open-open', [1, 2, 3]], ['closed-open', [1, 3, 5]]]) {
    for (const temperatureC of [-20, 20, 40]) {
      const config = { ...DEFAULT_CONFIG, boundary, temperatureC };
      const fundamental = solveMode(config);
      for (const [index, harmonic] of harmonics.entries()) {
        const mode = index + 1;
        const options = { phaseRad: Math.PI / 2, probeRatio: 1 / 3 };
        const observed = getSnapshot({ ...config, mode }, options);
        const legacy = getSnapshot({ ...DEFAULT_CONFIG, boundary, mode }, options);
        const c = 343 * Math.sqrt((273.15 + temperatureC) / 293.15);
        near(observed.frequencyHz, c / legacy.wavelengthM);
        near(observed.frequencyHz / fundamental.frequencyHz, harmonic);
        near(observed.periodS, legacy.wavelengthM / c);
        assert.equal(observed.wavelengthM, legacy.wavelengthM);
        assert.equal(observed.waveNumberRadPerM, legacy.waveNumberRadPerM);
        assert.deepEqual(observed.nodes, legacy.nodes);
        assert.deepEqual(observed.probe, legacy.probe);
        assert.deepEqual(observed.samples, legacy.samples);
        assert.equal(observed.config.temperatureC, temperatureC);
      }
    }
  }
});

test('legacy projects stay readable and explicit settings round-trip with independent frozen conditions', () => {
  const legacy = createProject();
  const comparison = { label: '보관 실험', experiment: legacy.experiment };
  const legacyRaw = JSON.stringify({ ...legacy, comparison });
  const restoredLegacy = parseProject(legacyRaw);
  assert.equal(restoredLegacy.observation.displayPeriodS ?? DISPLAY_PERIOD_S.default, 2);
  assert.equal(getSnapshot(restoredLegacy.experiment.config).frequencyHz, 343 / 1.2);
  assert.deepEqual(restoredLegacy.comparison.experiment, legacy.experiment);

  const experiment = { config: { ...DEFAULT_CONFIG, temperatureC: 37.25 }, phaseRad: Math.PI, probeRatio: .73 };
  const coldComparison = { label: '보관 실험', experiment: { ...legacy.experiment, config: { ...DEFAULT_CONFIG, temperatureC: -9.5 } } };
  const extended = createProject({ experiment, comparison: coldComparison, displayPeriodS: 4.25 });
  const restored = parseProject(serializeProject(extended));
  assert.deepEqual(restored, extended);
  assert.deepEqual(restored.experiment, experiment);
  assert.deepEqual(restored.comparison, coldComparison);
  assert.equal(restored.observation.displayPeriodS, 4.25);
  assert.ok(getSnapshot(restored.experiment.config).frequencyHz > getSnapshot(restored.comparison.experiment.config).frequencyHz);
});

test('live edits clamp to supported bounds while malformed stored values protect the original', () => {
  assert.equal(normalizeConfig({ ...DEFAULT_CONFIG, temperatureC: -100 }).temperatureC, -20);
  assert.equal(normalizeConfig({ ...DEFAULT_CONFIG, temperatureC: 100 }).temperatureC, 40);
  assert.equal(createProject({ displayPeriodS: .1 }).observation.displayPeriodS, .5);
  assert.equal(createProject({ displayPeriodS: 99 }).observation.displayPeriodS, 8);
  const legacy = createProject();
  const comparison = { label: '보관 실험', experiment: legacy.experiment };
  for (const invalid of [-20.01, 40.01, '20', null]) {
    const project = structuredClone({ ...legacy, comparison });
    project.comparison.experiment.config = { ...legacy.experiment.config, temperatureC: invalid };
    assert.throws(() => parseProject(JSON.stringify(project)), error => error instanceof ProjectError && error.preserveOriginal);
  }
  for (const invalid of [.499, 8.001, '2', null]) {
    const project = structuredClone(legacy);
    project.observation.displayPeriodS = invalid;
    assert.throws(() => parseProject(JSON.stringify(project)), error => error instanceof ProjectError && error.preserveOriginal);
  }
  assert.throws(() => serializeProject({ ...legacy, observation: { ...legacy.observation, displayPeriodS: NaN } }), ProjectError);
});

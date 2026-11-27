/** Ideal, lossless, one-dimensional air-column eigenmodes. All display fields
 * are normalized; no calibrated pressure or particle travel is predicted. */
export const MODEL_VERSION = 'sound-standing-wave-1';
export const DEFAULT_CONFIG = Object.freeze({ lengthM: .6, boundary: 'open-open', mode: 1 });
export const DEFAULT_PHASE_RAD = 0;
export const DEFAULT_PROBE_RATIO = .5;
export const AIR_TEMPERATURE_C = Object.freeze({ min: -20, max: 40, default: 20 });

const TAU = 2 * Math.PI, HALF_PI = Math.PI / 2, REFERENCE_SOUND_SPEED_MPS = 343;
const CELSIUS_OFFSET_K = 273.15;
const boundaries = ['open-open', 'closed-open'];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const cleanZero = value => value === 0 ? 0 : value;
function shape(value, required, label, optional = []) {
  if (!record(value)) throw new TypeError(`${label} must be a plain object`);
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => !required.includes(key) && !optional.includes(key)) || required.some(key => !Object.hasOwn(value, key)))
    throw new TypeError(`${label} has missing or unknown fields`);
}
function bounded(value, minimum, maximum, label, exclusiveMaximum = false) {
  if (!finite(value)) throw new TypeError(`${label} must be a finite number`);
  if (Object.is(value, -0) || value < minimum || (exclusiveMaximum ? value >= maximum : value > maximum))
    throw new RangeError(`${label} is outside its supported range`);
}

/** Live UI defaults only. Stored records must use strict validation. */
export function normalizeConfig(input) {
  const value = record(input) ? input : {};
  const config = {
    lengthM: finite(value.lengthM) ? Math.min(1.2, Math.max(.3, value.lengthM)) : DEFAULT_CONFIG.lengthM,
    boundary: boundaries.includes(value.boundary) ? value.boundary : DEFAULT_CONFIG.boundary,
    mode: [1, 2, 3].includes(value.mode) ? value.mode : DEFAULT_CONFIG.mode,
  };
  if (finite(value.temperatureC)) config.temperatureC = cleanZero(Math.min(AIR_TEMPERATURE_C.max, Math.max(AIR_TEMPERATURE_C.min, value.temperatureC)));
  return config;
}
export function assertConfig(config) {
  shape(config, ['lengthM', 'boundary', 'mode'], 'config', ['temperatureC']);
  bounded(config.lengthM, .3, 1.2, 'lengthM');
  if (typeof config.boundary !== 'string') throw new TypeError('boundary must be a string');
  if (!boundaries.includes(config.boundary)) throw new RangeError('boundary must be open-open or closed-open');
  bounded(config.mode, 1, 3, 'mode');
  if (!Number.isInteger(config.mode)) throw new RangeError('mode must be an integer');
  if (Object.hasOwn(config, 'temperatureC')) bounded(config.temperatureC, AIR_TEMPERATURE_C.min, AIR_TEMPERATURE_C.max, 'temperatureC');
  return config;
}
export function wrapPhase(phaseRad) {
  if (!finite(phaseRad)) throw new TypeError('phaseRad must be a finite number');
  const remainder = phaseRad % TAU;
  const wrapped = remainder < 0 ? remainder + TAU : remainder;
  // Adding a tiny negative remainder can round to TAU; use its equivalent 0.
  return wrapped >= TAU ? 0 : cleanZero(wrapped);
}
export function normalizeProbeRatio(input) {
  return finite(input) ? cleanZero(Math.min(1, Math.max(0, input))) : DEFAULT_PROBE_RATIO;
}

/** Dry-air ideal gas scaling, anchored at the original 343 m/s at 20 °C. */
export function soundSpeedMps(temperatureC = AIR_TEMPERATURE_C.default) {
  bounded(temperatureC, AIR_TEMPERATURE_C.min, AIR_TEMPERATURE_C.max, 'temperatureC');
  return REFERENCE_SOUND_SPEED_MPS * Math.sqrt((temperatureC + CELSIUS_OFFSET_K) / (AIR_TEMPERATURE_C.default + CELSIUS_OFFSET_K));
}

function modeValues(config) {
  const closed = config.boundary === 'closed-open', harmonic = closed ? 2 * config.mode - 1 : config.mode;
  const lengthFactor = closed ? 4 : 2;
  const wavelengthM = lengthFactor * config.lengthM / harmonic;
  const speed = soundSpeedMps(config.temperatureC);
  const selected = { lengthM: config.lengthM, boundary: config.boundary, mode: config.mode };
  if (Object.hasOwn(config, 'temperatureC')) selected.temperatureC = config.temperatureC;
  return {
    config: selected, harmonic,
    frequencyHz: speed / wavelengthM,
    wavelengthM, periodS: wavelengthM / speed,
    waveNumberRadPerM: 2 * Math.PI / wavelengthM,
    nodes: {
      pressureRatios: closed
        ? Array.from({ length: config.mode }, (_, j) => (2 * j + 1) / harmonic)
        : Array.from({ length: config.mode + 1 }, (_, j) => j / config.mode),
      displacementRatios: closed
        ? Array.from({ length: config.mode }, (_, j) => 2 * j / harmonic)
        : Array.from({ length: config.mode }, (_, j) => (2 * j + 1) / (2 * config.mode)),
    },
  };
}
export function solveMode(config) { assertConfig(config); return modeValues(config); }

function sinCos(angle, quarterTurns) {
  // Known quadrant points are exact, including analytic nodes and the phase
  // slider's 0/90/180/270 degrees. No tolerance-based node classification.
  if (Number.isInteger(quarterTurns)) {
    const quadrant = quarterTurns % 4;
    return { sin: [0, 1, 0, -1][quadrant], cos: [1, 0, -1, 0][quadrant] };
  }
  return { sin: Math.sin(angle), cos: Math.cos(angle) };
}
function sample(config, positionRatio, phase) {
  // Evaluate by normalized position so a length edit cannot alter mode shape.
  const closed = config.boundary === 'closed-open';
  const quarterTurns = (closed ? 2 * config.mode - 1 : 2 * config.mode) * positionRatio;
  const spatial = sinCos(quarterTurns * HALF_PI, quarterTurns);
  const pressureShape = closed ? spatial.cos : spatial.sin;
  const displacementShape = cleanZero(closed ? -spatial.sin : spatial.cos);
  return {
    positionRatio, xM: config.lengthM * positionRatio,
    pressureShape, displacementShape,
    pressureEnvelope: Math.abs(pressureShape), displacementEnvelope: Math.abs(displacementShape),
    pressureRelative: cleanZero(pressureShape * phase.cos),
    displacementRelative: cleanZero(displacementShape * phase.cos),
    velocityRelative: cleanZero(-displacementShape * phase.sin),
  };
}
export function sampleAt(config, positionRatio, phaseRad) {
  assertConfig(config); bounded(positionRatio, 0, 1, 'positionRatio'); bounded(phaseRad, 0, TAU, 'phaseRad', true);
  return sample(config, positionRatio, sinCos(phaseRad, phaseRad / HALF_PI));
}
export function getSnapshot(config, options = {}) {
  assertConfig(config); shape(options, [], 'options', ['phaseRad', 'probeRatio', 'sampleCount']);
  const { phaseRad = DEFAULT_PHASE_RAD, probeRatio = DEFAULT_PROBE_RATIO, sampleCount = 129 } = options;
  bounded(phaseRad, 0, TAU, 'phaseRad', true); bounded(probeRatio, 0, 1, 'probeRatio');
  bounded(sampleCount, 2, 513, 'sampleCount');
  if (!Number.isInteger(sampleCount)) throw new RangeError('sampleCount must be an integer');
  const phase = sinCos(phaseRad, phaseRad / HALF_PI);
  return { ...modeValues(config), phaseRad, probeRatio,
    probe: sample(config, probeRatio, phase),
    samples: Array.from({ length: sampleCount }, (_, i) => sample(config, i / (sampleCount - 1), phase)),
  };
}

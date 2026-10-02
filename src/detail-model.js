import { solveMode, sampleAt } from './model.js';
import { GEOMETRY, tubeLayout } from './geometry.js';

const TAU = 2 * Math.PI;
const DISPLAY_PERIOD_S = 2;
const cleanZero = value => value === 0 ? 0 : value;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

// Validate the small solved state used here, not the optional drawing samples.
// Neither a nearest drawing sample nor live-input normalization may replace it.
function checkedSnapshot(snapshot) {
  if (!record(snapshot)) throw new TypeError('snapshot must be a plain object');
  const mode = solveMode(snapshot.config);
  const probe = sampleAt(snapshot.config, snapshot.probeRatio, snapshot.phaseRad);
  for (const key of ['harmonic', 'frequencyHz', 'wavelengthM', 'periodS', 'waveNumberRadPerM']) {
    if (!finite(snapshot[key]) || snapshot[key] !== mode[key]) throw new RangeError(`snapshot.${key} does not match its mode`);
  }
  if (!record(snapshot.probe)) throw new TypeError('snapshot.probe must be a plain object');
  for (const [key, value] of Object.entries(probe)) {
    if (!finite(snapshot.probe[key]) || snapshot.probe[key] !== value) throw new RangeError(`snapshot.probe.${key} does not match its observation`);
  }
  if (!record(snapshot.nodes)) throw new TypeError('snapshot.nodes must be a plain object');
  for (const key of ['pressureRatios', 'displacementRatios']) {
    const values = snapshot.nodes[key], expected = mode.nodes[key];
    if (!Array.isArray(values) || values.length !== expected.length || expected.some((v, i) => values[i] !== v))
      throw new RangeError(`snapshot.nodes.${key} does not match its mode`);
  }
  return { mode, probe };
}

function nearest(positions, ratio, lengthM) {
  let selected = positions[0];
  // Sorted analytic positions; midpoint boundaries keep symmetric ties left
  // even when two separately subtracted distances round in opposite directions.
  for (const point of positions.slice(1)) {
    if (ratio <= (selected.ratio + point.ratio) / 2) break;
    selected = point;
  }
  // Subtract ratios before scaling, retaining very small distances near a node.
  return { ...selected, distanceM: Math.abs(selected.ratio - ratio) * lengthM };
}

/** Pure diagnostics of the existing ideal mode. Energies and flux are
 * dimensionless coefficients, not calibrated J, J/m³, W or W/m².
 * realPhaseTimeS is a location within one acoustic cycle, not elapsed history. */
export function soundDetail(snapshot) {
  const { mode: solved, probe: p } = checkedSnapshot(snapshot);
  const { lengthM } = snapshot.config, phaseFraction = snapshot.phaseRad / TAU;
  const positionsOf = ratios => ratios.map(ratio => ({ ratio, xM: ratio * lengthM }));
  const positions = {
    pressureNodes: positionsOf(solved.nodes.pressureRatios),
    pressureAntinodes: positionsOf(solved.nodes.displacementRatios),
    motionNodes: positionsOf(solved.nodes.displacementRatios),
    motionAntinodes: positionsOf(solved.nodes.pressureRatios),
  };
  // A pressure node has |D|=1. Reuse the model's exact quarter-cycle values.
  const reference = sampleAt(snapshot.config, solved.nodes.pressureRatios[0], snapshot.phaseRad);
  const cos = reference.displacementRelative / reference.displacementShape;
  const sin = -reference.velocityRelative / reference.displacementShape;
  const wholeCompressionFraction = cos * cos, wholeKineticFraction = sin * sin;
  const probeCompression = p.pressureRelative ** 2, probeKinetic = p.velocityRelative ** 2;
  const cycleCompression = p.pressureShape ** 2 / 2, cycleKinetic = p.displacementShape ** 2 / 2;
  const isAt = points => points.some(point => point.ratio === snapshot.probeRatio);
  return {
    mode: {
      frequencyHz: solved.frequencyHz, wavelengthM: solved.wavelengthM, periodS: solved.periodS,
      omegaRadPerS: TAU * solved.frequencyHz, waveNumberRadPerM: solved.waveNumberRadPerM, harmonic: solved.harmonic,
      quarterWavelengthM: solved.wavelengthM / 4, halfWavelengthM: solved.wavelengthM / 2,
      phaseFraction, realPhaseTimeS: phaseFraction * solved.periodS,
      displayPeriodS: DISPLAY_PERIOD_S, displayPhaseTimeS: phaseFraction * DISPLAY_PERIOD_S,
      slowdownRatio: DISPLAY_PERIOD_S / solved.periodS,
    },
    probe: {
      positionRatio: p.positionRatio, xM: p.xM,
      pressureRelative: p.pressureRelative, displacementRelative: p.displacementRelative, velocityRelative: p.velocityRelative,
      accelerationRelative: cleanZero(-p.displacementRelative),
      pressureEnvelope: p.pressureEnvelope, displacementEnvelope: p.displacementEnvelope, velocityEnvelope: p.displacementEnvelope,
      pressureRmsRelative: p.pressureEnvelope / Math.SQRT2,
      displacementRmsRelative: p.displacementEnvelope / Math.SQRT2,
      velocityRmsRelative: p.displacementEnvelope / Math.SQRT2,
      accelerationRmsRelative: p.displacementEnvelope / Math.SQRT2,
      pressureIsNode: isAt(positions.pressureNodes), motionIsNode: isAt(positions.motionNodes),
      pressureIsAntinode: isAt(positions.pressureAntinodes), motionIsAntinode: isAt(positions.motionAntinodes),
      nearestPressureNode: nearest(positions.pressureNodes, p.positionRatio, lengthM),
      nearestMotionNode: nearest(positions.motionNodes, p.positionRatio, lengthM),
      nearestPressureAntinode: nearest(positions.pressureAntinodes, p.positionRatio, lengthM),
      nearestMotionAntinode: nearest(positions.motionAntinodes, p.positionRatio, lengthM),
    },
    positions,
    energy: {
      probeCompression, probeKinetic, probeTotal: probeCompression + probeKinetic,
      cycleCompression, cycleKinetic, cycleTotal: cycleCompression + cycleKinetic,
      wholeCompressionFraction, wholeKineticFraction, wholeTotalFraction: wholeCompressionFraction + wholeKineticFraction,
    },
    flux: { instantaneousRelative: cleanZero(p.pressureRelative * p.velocityRelative), cycleMeanRelative: 0 },
  };
}

const fact = (label, value, unit = '', digits = 3) => ({ label, value, unit, digits });
const mm = value => value * 1000;
const relative = (label, value) => fact(label, value, '상대값');
const coefficient = (label, value) => fact(label, value, '무차원');
const relativeNote = '각 물리량은 별도 진폭으로 정규화한 값입니다. 실제 Pa·dB·m·m/s·m/s²를 예측하지 않습니다.';

/** Component facts refer to the selected existing mode and representative
 * geometry. The optional detail must come from soundDetail of this snapshot. */
export function describeSoundDetail(partId, snapshot, detail = soundDetail(snapshot)) {
  const { mode: m, probe: p, energy: e, flux: f } = detail;
  const config = snapshot.config, layout = tubeLayout(config.lengthM, config.boundary);
  const closed = config.boundary === 'closed-open';
  const left = sampleAt(config, 0, snapshot.phaseRad), right = sampleAt(config, 1, snapshot.phaseRad);
  const descriptors = {
    'bench-base': () => ({ facts: [fact('실험대 길이', mm(layout.benchLengthM), 'mm', 1),
      fact('관 전체 압축 에너지 비율', 100 * e.wholeCompressionFraction, '%', 1),
      fact('관 전체 운동 에너지 비율', 100 * e.wholeKineticFraction, '%', 1),
      coefficient('전체 에너지 비율의 합', e.wholeTotalFraction), coefficient('주기 평균 전달 계수', f.cycleMeanRelative)],
    note: '비율은 관 안 이상적 음장의 일정한 전체 에너지를 기준으로 합니다. 실험대 진동·에너지와 보정된 J 값은 계산하지 않습니다.' }),
    'rail': () => ({ facts: [fact('레일 길이', mm(layout.railLengthM), 'mm', 1), fact('탐침 위치', mm(p.xM), 'mm', 2),
      fact('관 안 위치 비율', p.positionRatio * 100, '%', 2), fact('압력 마디까지 거리', mm(p.nearestPressureNode.distanceM), 'mm', 3),
      fact('운동 마디까지 거리', mm(p.nearestMotionNode.distanceM), 'mm', 3)],
    note: '탐침은 평형 위치 x/L을 가리킵니다. 가장 가까운 해석적 마디까지의 거리이며 레일 마찰·이송 오차·관의 음향 부하는 없습니다.' }),
    'scale': () => ({ facts: [fact('관 길이', mm(config.lengthM), 'mm', 1), fact('파장', mm(m.wavelengthM), 'mm', 2),
      fact('같은 종류 마디 반복 간격', mm(m.halfWavelengthM), 'mm', 2), fact('인접 마디와 배 간격', mm(m.quarterWavelengthM), 'mm', 2),
      fact('탐침 위치', mm(p.xM), 'mm', 2)],
    note: '마디와 배는 공간 진폭으로 정한 고정 위치입니다. 반복 간격은 λ/2, 인접 마디와 배 간격은 λ/4이며 관 밖의 위치를 추가 관내 마디로 세지 않습니다.' }),
    'tube-wall': () => ({ facts: [fact('관 길이', mm(config.lengthM), 'mm', 1), fact('관 내경', mm(2 * GEOMETRY.tube.innerRadiusM), 'mm', 1),
      fact('내부 단면적', Math.PI * GEOMETRY.tube.innerRadiusM ** 2 * 1e6, 'mm²', 1), fact('관 길이 / 파장', config.lengthM / m.wavelengthM, '무차원'),
      fact('압력 마디 수', detail.positions.pressureNodes.length, '개', 0), fact('운동 마디 수', detail.positions.motionNodes.length, '개', 0)],
    note: '일정한 단면의 이상적 1차원 관입니다. 내경은 구조 치수이며 이 고유주파수 식의 입력이 아닙니다. 절개·분해는 경계조건을 바꾸지 않습니다.' }),
    'tube-collars': () => ({ facts: [fact('고정 링 내경', mm(2 * GEOMETRY.collar.innerRadiusM), 'mm', 1),
      fact('관 외경', mm(2 * GEOMETRY.tube.outerRadiusM), 'mm', 1), fact('링 폭', mm(GEOMETRY.collar.widthM), 'mm', 1),
      fact('끝에서 지지축까지', mm(GEOMETRY.supportInsetM), 'mm', 1)],
    note: '대표 조립 형상의 치수입니다. 조임력·접촉 응력·벽 진동·음향 손실은 계산하지 않으며 제조 공차나 체결 성능을 뜻하지 않습니다.' }),
    'left-support': () => ({ facts: [fact('왼쪽 끝에서 지지축까지', mm(GEOMETRY.supportInsetM), 'mm', 1),
      fact('관축 높이', mm(GEOMETRY.tube.centerY), 'mm', 1), fact('왼쪽 끝 조건', closed ? '막힘' : '열림'),
      relative('왼쪽 끝 압력 진폭', left.pressureEnvelope), relative('왼쪽 끝 운동 진폭', left.displacementEnvelope)],
    note: '막힌 끝은 운동 마디, 열린 끝은 압력 마디입니다. 지지대 자체의 힘·진동·음향 전달은 계산하지 않습니다.' }),
    'right-support': () => ({ facts: [fact('왼쪽 끝에서 지지축까지', mm(config.lengthM - GEOMETRY.supportInsetM), 'mm', 1),
      fact('관축 높이', mm(GEOMETRY.tube.centerY), 'mm', 1), fact('오른쪽 끝 조건', '열림'),
      relative('오른쪽 끝 압력 진폭', right.pressureEnvelope), relative('오른쪽 끝 운동 진폭', right.displacementEnvelope)],
    note: '오른쪽은 항상 이상적인 열린 끝입니다. 압력 변동분 0은 진공이 아니며 실제 관 밖 방사나 끝단 보정은 생략합니다.' }),
    'end-cap': () => ({ facts: [fact('왼쪽 끝 조건', closed ? '막힘' : '열림'), fact('선택한 모드', config.mode, '번째', 0),
      fact('기본음의 배수', m.harmonic, '배', 0), relative('왼쪽 끝 압력 진폭', left.pressureEnvelope),
      relative('왼쪽 끝 운동 진폭', left.displacementEnvelope), coefficient('왼쪽 끝 순간 전달 계수', cleanZero(left.pressureRelative * left.velocityRelative))],
    note: '왼쪽을 막으면 허용 고조파는 1·3·5배입니다. 압력과 속도의 곱은 이상적 양 끝에서 0이며 실제 방사 손실·마개 변형은 계산하지 않습니다.' }),
    'cap-stand': () => ({ facts: [fact('끝마개 위치', closed ? '관 왼쪽에 조립' : '보관대'),
      fact('마개 외경', mm(2 * GEOMETRY.cap.radiusM), 'mm', 1), fact('마개 두께', mm(GEOMETRY.cap.thicknessM), 'mm', 1),
      fact('관 왼쪽 끝 조건', closed ? '막힘' : '열림')],
    note: '보관대와 마개 치수는 구조 표현입니다. 보관대는 음향 경계가 아니며 마개의 보관·분해 표시를 새로운 공명 조건으로 계산하지 않습니다.' }),
    'probe-carriage': () => ({ facts: [fact('탐침 위치', mm(p.xM), 'mm', 2), fact('관 안 위치 비율', p.positionRatio * 100, '%', 2),
      fact('가장 가까운 압력 마디', mm(p.nearestPressureNode.xM), 'mm', 2), fact('압력 마디까지 거리', mm(p.nearestPressureNode.distanceM), 'mm', 3),
      fact('가장 가까운 운동 마디', mm(p.nearestMotionNode.xM), 'mm', 2), fact('운동 마디까지 거리', mm(p.nearestMotionNode.distanceM), 'mm', 3)],
    note: '좌표는 관 왼쪽 끝이 0입니다. 마디를 표본에서 찾지 않으며 순간값 0과 고정 마디를 구분합니다. 같은 거리의 마디는 왼쪽 것을 표시합니다.' }),
    'probe-tip': () => ({ facts: [relative('순간 상대 압력', p.pressureRelative), relative('압력 진폭', p.pressureEnvelope),
      relative('압력 RMS', p.pressureRmsRelative), relative('순간 상대 변위', p.displacementRelative),
      relative('순간 상대 속도', p.velocityRelative), relative('순간 상대 가속도', p.accelerationRelative)],
    note: `RMS는 이 위치의 완전한 한 주기 평균제곱근이며 현재 순간값의 절댓값이 아닙니다. ${relativeNote}` }),
    'probe-cable': () => ({ facts: [coefficient('탐침 압축 에너지 계수', e.probeCompression), coefficient('탐침 운동 에너지 계수', e.probeKinetic),
      coefficient('탐침 전체 에너지 계수', e.probeTotal), coefficient('탐침 주기 평균 에너지 계수', e.cycleTotal),
      coefficient('순간 전달 계수', f.instantaneousRelative), coefficient('주기 평균 전달 계수', f.cycleMeanRelative)],
    note: '전달 계수는 압력×속도이며 양수는 오른쪽, 음수는 왼쪽입니다. 에너지와 전달은 서로 다른 무차원 기준입니다. 케이블의 전기 신호·전력·지연은 계산하지 않습니다.' }),
    'readout': () => ({ facts: [fact('실제 고유주파수', m.frequencyHz, 'Hz', 2), fact('실제 한 주기', m.periodS * 1000, 'ms', 4),
      fact('화면 한 주기', m.displayPeriodS, 's', 1), fact('화면의 느린 배율', m.slowdownRatio, '배', 2),
      fact('실제 주기 안 위상 위치', m.realPhaseTimeS * 1000, 'ms', 4), fact('관찰 위상', m.phaseFraction * 360, '°', 2)],
    note: '주기 안의 위상 위치는 누적 경과시간이 아닙니다. 음높이 예시는 이 Hz의 별도 순음이며 탐침 녹음·예측 음량·느린 화면의 소리가 아닙니다.' }),
    'particles': () => ({ facts: [relative('순간 상대 변위', p.displacementRelative), relative('순간 상대 속도', p.velocityRelative),
      relative('순간 상대 가속도', p.accelerationRelative), relative('운동 진폭', p.displacementEnvelope),
      relative('변위 RMS', p.displacementRmsRelative), relative('속도 RMS', p.velocityRmsRelative)],
    note: `가속도는 변위와 반대 위상이고 속도는 1/4주기 차이입니다. 입자 왕복은 축 방향의 확대 표시입니다. ${relativeNote}` }),
  };
  if (!Object.hasOwn(descriptors, partId)) throw new RangeError(`Unknown sound component: ${partId}`);
  return descriptors[partId]();
}

const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const finite = (value, minimum, maximum, name) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`${name} is outside its finite range`); return value; };
const length = value => finite(value, .30, 1.20, 'lengthM');
const ratio = value => finite(value, 0, 1, 'positionRatio');
const explodedValue = value => { if (typeof value !== 'boolean') throw new TypeError('exploded must be boolean'); return value; };

export const COMPONENTS = freeze([
  { id: 'bench-base', name: '금속 실험대', description: '관과 레일을 지지하는 원본 구조의 실험대입니다. 진동하는 실험대 자체의 음향은 계산하지 않습니다.', material: '도장 금속 · 고무 받침' },
  { id: 'rail', name: '이동 레일', description: '두 관 지지대와 가상 탐침 캐리지를 안내하는 금속 레일입니다.', material: '스테인리스 레일' },
  { id: 'scale', name: '길이 눈금', description: '관의 왼쪽 끝을 0, 오른쪽 끝을 L로 표시합니다. 길이 변경은 내경이 일정한 다른 관으로 교체하는 가상 실험입니다.', material: '금속 눈금판' },
  { id: 'tube-wall', name: '원통 관', description: '내경 40 mm, 외경 46 mm의 균일 관입니다. 절개는 안을 보기 위한 표시이며 관 옆을 실제로 여는 경계조건 변화가 아닙니다.', material: '절개 알루미늄 관' },
  { id: 'tube-collars', name: '관 고정 링', description: '관의 양끝 부근을 지지대에 고정하는 링입니다. 분해 보기에서는 링을 들어 올려 관과 지지대를 구분합니다.', material: '강철 링 · 고정 볼트' },
  { id: 'left-support', name: '왼쪽 지지대', description: '왼쪽 고정 링을 레일 위에 받칩니다. 관 길이에 맞춰 지지 위치가 이동합니다.', material: '도장 받침 · 금속 스템' },
  { id: 'right-support', name: '오른쪽 지지대', description: '오른쪽 고정 링을 받칩니다. 오른쪽 끝은 두 경계조건 모두 열려 있습니다.', material: '도장 받침 · 금속 스템' },
  { id: 'end-cap', name: '탈착 끝마개', description: '닫으면 왼쪽 끝의 공기 운동을 막고, 열면 별도 받침에 놓입니다. 선택만으로 경계조건은 바뀌지 않습니다.', material: '금속 마개 · 밀봉 링' },
  { id: 'cap-stand', name: '마개 보관대', description: '열린 관에서 분리한 끝마개를 받칩니다.', material: '도장 금속 · 보호 패드' },
  { id: 'probe-carriage', name: '탐침 이동 캐리지', description: '선택한 관 안 위치를 가리키는 가상 탐침의 이동 장치입니다. 모형은 탐침의 음향 부하를 포함하지 않습니다.', material: '금속 슬라이드 · 조절 손잡이' },
  { id: 'probe-tip', name: '가상 압력 탐침', description: '표식의 평형 위치에서 상대 압력과 공기 운동을 읽습니다. 표시선은 관 벽을 뚫는 실제 구멍이 아닙니다.', material: '비침습 가상 측정점' },
  { id: 'probe-cable', name: '탐침 연결선', description: '캐리지와 표시 장치를 잇는 대표 신호선입니다. 전기·마이크 성능은 계산하지 않습니다.', material: '절연 케이블' },
  { id: 'readout', name: '관측 표시 장치', description: '계산한 주파수와 가상 탐침 위치·상대 압력을 표시합니다. 실제 음압계의 Pa 또는 dB 값이 아닙니다.', material: '금속 하우징 · 표시창' },
  { id: 'particles', name: '공기 운동 표식', description: '공기의 종방향 왕복을 확대해 보여 주는 가상 표식입니다. 이동은 관 축 방향이며 실제 입자 크기나 이동거리를 뜻하지 않습니다.', material: '가상 공기 표식' },
]);
export const DEFAULT_VIEW = freeze({ cutaway: true, particles: true, pressure: true, exploded: false, labels: true, selectedPart: 'tube-wall' });
export const GEOMETRY = freeze({
  tube: { centerY: .15, centerZ: 0, innerRadiusM: .020, outerRadiusM: .023, cutawayStartRad: Math.PI / 3, cutawaySweepRad: Math.PI * 4 / 3 },
  bench: { center: [0, .021, .025], lengthMarginM: .26, size: [1.46, .025, .40], topY: .0335 },
  rails: { lengthM: 1.32, lengthMarginM: .12, centerY: .052, z: [-.075, .075], radiusM: .008 },
  supportInsetM: .055,
  collar: { innerRadiusM: .023, outerRadiusM: .030, widthM: .018 },
  cap: { thicknessM: .010, radiusM: .031, storedCenter: [-.625, .076, .155] },
  capStand: { center: [-.625, .03925, .155], size: [.092, .0115, .065] },
  readout: { center: [.47, .072, .150], size: [.188, .076, .108] },
  displayAmplitudeRatio: .01,
  particleRadiusM: .0017,
  exploded: { tubeY: .075, collarsY: .118, capOutwardX: -.090 },
});

export function tubeLayout(lengthM, boundary, exploded = false) {
  length(lengthM); explodedValue(exploded); if (!['open-open', 'closed-open'].includes(boundary)) throw new RangeError('unsupported boundary');
  const leftX = -lengthM / 2, rightX = lengthM / 2, offsetY = exploded ? GEOMETRY.exploded.tubeY : 0;
  const closed = boundary === 'closed-open';
  const storedCapCenter = [leftX - .025, GEOMETRY.cap.storedCenter[1], GEOMETRY.cap.storedCenter[2]];
  const capCenter = closed ? [leftX - GEOMETRY.cap.thicknessM / 2 + (exploded ? GEOMETRY.exploded.capOutwardX : 0), GEOMETRY.tube.centerY + offsetY, 0] : storedCapCenter;
  return { lengthM, leftX, rightX, center: [0, GEOMETRY.tube.centerY + offsetY, 0], offsetY,
    supportXs: [leftX + GEOMETRY.supportInsetM, rightX - GEOMETRY.supportInsetM],
    collarY: GEOMETRY.tube.centerY + (exploded ? GEOMETRY.exploded.collarsY : 0),
    benchLengthM: lengthM + GEOMETRY.bench.lengthMarginM, railLengthM: lengthM + GEOMETRY.rails.lengthMarginM,
    capClosed: closed, capCenter, storedCapCenter, readoutCenter: [rightX - .12, GEOMETRY.readout.center[1], GEOMETRY.readout.center[2]],
    capFace: [capCenter[0] + GEOMETRY.cap.thicknessM / 2, capCenter[1], capCenter[2]] };
}
export function particlePosition(lengthM, positionRatio, displacementRelative, exploded = false) {
  length(lengthM); ratio(positionRatio); finite(displacementRelative, -1 - 1e-12, 1 + 1e-12, 'displacementRelative'); explodedValue(exploded);
  return [(positionRatio - .5) * lengthM + GEOMETRY.displayAmplitudeRatio * lengthM * displacementRelative, GEOMETRY.tube.centerY + (exploded ? GEOMETRY.exploded.tubeY : 0), 0];
}
export function probePosition(lengthM, probeRatio, exploded = false) {
  length(lengthM); ratio(probeRatio); explodedValue(exploded);
  return [(probeRatio - .5) * lengthM, GEOMETRY.tube.centerY + (exploded ? GEOMETRY.exploded.tubeY : 0), 0];
}
export function pressureColor(relative) {
  finite(relative, -1 - 1e-12, 1 + 1e-12, 'relative pressure');
  const value = Math.max(-1, Math.min(1, relative));
  const cold = [85, 160, 231], zero = [211, 228, 228], warm = [238, 138, 81];
  const from = value <= 0 ? cold : zero, to = value <= 0 ? zero : warm, t = value <= 0 ? value + 1 : value;
  return '#' + from.map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Pure mesh data: true inner/outer walls, annular end faces and exposed cut faces.
// X is the tube axis; radial normals are analytic so metal does not look faceted.
export function hollowTubeMesh(lengthM, cutaway = false, segments = 96) {
  length(lengthM); if (typeof cutaway !== 'boolean') throw new TypeError('cutaway must be boolean');
  if (!Number.isInteger(segments) || segments < 12 || segments > 256) throw new RangeError('segments out of range');
  const { innerRadiusM: inner, outerRadiusM: outer } = GEOMETRY.tube;
  const start = cutaway ? GEOMETRY.tube.cutawayStartRad : 0, sweep = cutaway ? GEOMETRY.tube.cutawaySweepRad : Math.PI * 2;
  const positions = [], normals = [];
  const point = (x, r, a) => [x, r * Math.sin(a), r * Math.cos(a)];
  const vertex = (p, n) => { positions.push(...p); normals.push(...n); };
  const quad = (a, b, c, d, ns) => { const p = [a, b, c, d]; for (const i of [0, 1, 2, 0, 2, 3]) vertex(p[i], ns.length === 3 ? ns : ns[i]); };
  const x0 = -lengthM / 2, x1 = lengthM / 2;
  for (let i = 0; i < segments; i++) {
    const a = start + sweep * i / segments, b = start + sweep * (i + 1) / segments;
    const na = [0, Math.sin(a), Math.cos(a)], nb = [0, Math.sin(b), Math.cos(b)];
    quad(point(x0, outer, a), point(x1, outer, a), point(x1, outer, b), point(x0, outer, b), [na, na, nb, nb]);
    quad(point(x1, inner, a), point(x0, inner, a), point(x0, inner, b), point(x1, inner, b), [na.map(n => -n), na.map(n => -n), nb.map(n => -n), nb.map(n => -n)]);
    quad(point(x0, inner, a), point(x0, outer, a), point(x0, outer, b), point(x0, inner, b), [-1, 0, 0]);
    quad(point(x1, outer, a), point(x1, inner, a), point(x1, inner, b), point(x1, outer, b), [1, 0, 0]);
  }
  if (cutaway) {
    const a = start, b = start + sweep;
    quad(point(x0, outer, a), point(x0, inner, a), point(x1, inner, a), point(x1, outer, a), [0, -Math.cos(a), Math.sin(a)]);
    quad(point(x0, inner, b), point(x0, outer, b), point(x1, outer, b), point(x1, inner, b), [0, Math.cos(b), -Math.sin(b)]);
  }
  return { positions, normals, lengthM, innerRadiusM: inner, outerRadiusM: outer, cutaway, segments };
}

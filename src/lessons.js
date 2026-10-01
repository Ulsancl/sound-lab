import { getSnapshot } from './model.js';
const step = (action, lengthM, boundary, mode, probeRatio = null, phaseRad = null) => ({ action, lengthM, boundary, mode, probeRatio, phaseRad });
export const LESSONS = {
  length: { title: '길이를 두 배로 늘리면?', config: { lengthM: .5, boundary: 'open-open', mode: 1 },
    steps: [step('길이 0.50 m · 양끝 열림 · 첫 모드의 음높이를 확인하세요. 비교 보관 버튼으로 남길 수도 있습니다.', .5, 'open-open', 1),
      step('길이를 1.00 m로 바꾸세요. 주파수와 파장이 어떻게 달라졌는지 관찰하세요.', 1, 'open-open', 1)],
    result: '길이가 두 배가 되어 주파수는 343 → 171.5 Hz, 파장은 1 → 2 m가 됐습니다. 느린 관찰 속도는 여전히 한 주기 2초입니다.' },
  cap: { title: '한쪽을 막으면?', config: { lengthM: .5, boundary: 'open-open', mode: 1 },
    steps: [step('0.50 m 양끝 열림에서 첫 번째 모드를 확인하세요.', .5, 'open-open', 1),
      step('양끝 열림을 유지하고 두 번째 모드를 선택하세요.', .5, 'open-open', 2),
      step('양끝 열림의 세 번째 모드를 선택하세요.', .5, 'open-open', 3),
      step('왼쪽 끝마개를 닫고 첫 번째 모드를 선택하세요.', .5, 'closed-open', 1),
      step('왼쪽 막힘의 두 번째 모드를 선택하세요. 기본음의 몇 배인지 읽어보세요.', .5, 'closed-open', 2),
      step('왼쪽 막힘의 세 번째 모드를 선택하세요.', .5, 'closed-open', 3)],
    result: '열린 관은 343·686·1029 Hz, 한쪽 막힌 관은 171.5·514.5·857.5 Hz입니다. 막힌 관의 두 번째 모드는 기본음의 3배입니다.' },
  nodes: { title: '움직이지 않는 곳은 조용할까?', config: { lengthM: .5, boundary: 'open-open', mode: 1 },
    steps: [step('느린 관찰을 멈추고 위상 0°, 탐침 0%로 두세요. 열린 끝의 압력과 입자 변위를 확인하세요.', .5, 'open-open', 1, 0, 0),
      step('위상 0°에서 탐침을 50%로 옮기세요. 가운데 입자의 변위와 압력 포락선을 비교하세요.', .5, 'open-open', 1, .5, 0),
      step('가운데에서 위상을 90°로 바꾸세요. 순간 압력 0과 고정 마디 표시를 구분하세요.', .5, 'open-open', 1, .5, Math.PI / 2),
      step('위상을 180°로 바꾸세요. 압력 부호가 바뀌어도 가운데는 계속 변위 마디입니다.', .5, 'open-open', 1, .5, Math.PI),
      step('위상 0°, 탐침 100%로 오른쪽 열린 끝을 확인하세요.', .5, 'open-open', 1, 1, 0),
      step('왼쪽 마개를 닫고 탐침 0%, 위상 0°로 두세요. 막힌 끝의 운동과 압력을 확인하세요.', .5, 'closed-open', 1, 0, 0)],
    result: '열린 관의 가운데는 변위 마디·압력 배, 열린 끝은 압력 마디·변위 배입니다. 막힌 끝은 변위와 속도가 0인 압력 배입니다. 순간값이 0인 것과 마디는 다릅니다.' }
};
export function createGuide(id) {
  if (!Object.hasOwn(LESSONS, id)) throw new RangeError('알 수 없는 안내 실험입니다.');
  return { id, stage: 0, status: 'active', evidence: [] };
}
export function lessonReady(guide, experiment, running = false) {
  if (!guide || guide.status !== 'active') return false;
  const rule = LESSONS[guide.id]?.steps[guide.stage]; if (!rule) return false;
  const config = experiment.config, near = (a, b) => Math.abs(a - b) < 1e-7;
  return near(config.lengthM, rule.lengthM) && config.boundary === rule.boundary && config.mode === rule.mode
    && (rule.probeRatio === null || near(experiment.probeRatio, rule.probeRatio))
    && (rule.phaseRad === null || (!running && near(experiment.phaseRad, rule.phaseRad)));
}
export function confirmObservation(guide, experiment, running = false) {
  if (!lessonReady(guide, experiment, running)) return false;
  const snapshot = getSnapshot(experiment.config, { phaseRad: experiment.phaseRad, probeRatio: experiment.probeRatio });
  guide.evidence.push({ experiment: structuredClone(experiment), frequencyHz: snapshot.frequencyHz, wavelengthM: snapshot.wavelengthM,
    probe: structuredClone(snapshot.probe), nodes: structuredClone(snapshot.nodes) });
  guide.stage += 1; if (guide.stage === LESSONS[guide.id].steps.length) guide.status = 'completed'; return true;
}
export function guideText(guide) {
  const lesson = LESSONS[guide.id];
  return { action: guide.status === 'completed' ? '관찰을 마쳤습니다. 조건을 더 바꿔 자유롭게 실험해 보세요.' : lesson.steps[guide.stage].action,
    result: guide.status === 'completed' ? lesson.result : '', total: lesson.steps.length };
}

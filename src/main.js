import './style.css';
import { DEFAULT_CONFIG, normalizeConfig, getSnapshot, wrapPhase, normalizeProbeRatio } from './model.js';
import { createProject, parseProject, serializeProject, normalizeView, DEFAULT_VIEW } from './project.js';
import { COMPONENTS } from './geometry.js';
import { SoundScene } from './scene.js';
import { WaveChart } from './chart.js';
import { TonePlayer } from './audio.js';
import { LESSONS, createGuide, lessonReady, confirmObservation, guideText } from './lessons.js';

const $ = selector => document.querySelector(selector), $$ = selector => [...document.querySelectorAll(selector)];
const text = (selector, value) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
const copy = value => structuredClone(value), fmt = (value, digits = 1) => (Math.abs(value) < .5 * 10 ** -digits ? 0 : value).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const boundaryName = config => config.boundary === 'open-open' ? '양끝 열림' : '왼쪽 막힘';
const conditionName = exp => `${fmt(exp.config.lengthM, 2)} m · ${boundaryName(exp.config)} · ${exp.config.mode}모드 · 위상 ${fmt(exp.phaseRad * 180 / Math.PI, 1)}°`;
const STORAGE_KEY = 'sound-lab-project-v1', desktop = window.soundDesktop;
const initialExperiment = config => ({ config: copy(config), phaseRad: 0, probeRatio: .5 });
let experiment = initialExperiment(DEFAULT_CONFIG), view = normalizeView(DEFAULT_VIEW), comparison = null, snapshot;
let scene = null, initialCamera = null, guide = null, previous = null, busy = false, restoring = false, chartDisplay = 'both';
let running = false, frameId = null, lastTick = 0, lastPaint = 0, lastSave = 0;
let saveTimer, toastTimer, recoveredRaw = null, storageBlocked = false;
const chart = new WaveChart($('#wave-chart'), $('#frequency-chart'));
const tone = new TonePlayer({ onChange: state => {
  $('#listen').disabled = state.pending || busy; $('#stop-tone').hidden = !state.playing && !state.pending;
  text('#audio-status', state.error || (state.pending ? '소리 예시 준비 중…' : state.playing ? `${fmt(state.frequencyHz, 1)} Hz 순음 재생 중 · 2초 후 종료` : '계산한 Hz의 순음 예시 · 탐침 녹음이나 예측 음압이 아닙니다.'));
} });

function toast(message) {
  clearTimeout(toastTimer); const close = Object.assign(document.createElement('button'), { textContent: '닫기', type: 'button' });
  close.addEventListener('click', () => { $('#toast').hidden = true; });
  $('#toast').replaceChildren(Object.assign(document.createElement('span'), { textContent: message }), close); $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
function updateSnapshot() { snapshot = getSnapshot(experiment.config, { phaseRad: experiment.phaseRad, probeRatio: experiment.probeRatio }); }
function capture() { return createProject({ experiment, comparison, view, camera: scene?.getCameraState() ?? initialCamera }); }
function saveLocal() {
  clearTimeout(saveTimer); if (storageBlocked || restoring) return;
  try { localStorage.setItem(STORAGE_KEY, serializeProject(capture())); text('#save-status', '이 기기에 자동 저장됨'); }
  catch { text('#save-status', '자동 저장을 완료하지 못했습니다 · 파일로 보관하세요'); }
}
function scheduleSave() { if (!restoring && !storageBlocked) { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 230); } }
function protectOriginal(raw, future) {
  storageBlocked = true; recoveredRaw = raw;
  try { localStorage.setItem(`${STORAGE_KEY}-original-${Date.now()}`, raw); } catch { /* Original remains exportable in memory. */ }
  $('#storage-recovery').hidden = false;
  if (future) text('#storage-recovery strong', '더 새로운 버전의 실험입니다. 원문을 보존합니다.');
  text('#save-status', '자동 저장 원문 보호 중 · 현재 실험은 파일로 보관하세요');
}
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) try { const saved = parseProject(raw); ({ experiment, comparison } = saved); ({ view, camera: initialCamera } = saved.observation); }
  catch (error) { protectOriginal(raw, error.futureVersion); }
} catch { storageBlocked = true; text('#save-status', '자동 저장을 사용할 수 없습니다 · 파일로 보관하세요'); }
updateSnapshot();

function syncTime(now = performance.now()) {
  if (!running || now <= lastTick) return;
  experiment.phaseRad = wrapPhase(experiment.phaseRad + (now - lastTick) * Math.PI / 1000); lastTick = now; updateSnapshot();
}
function frame(now) {
  frameId = null; syncTime(now); scene?.update(snapshot, view);
  if (now - lastPaint >= 100) { refresh(false); lastPaint = now; }
  if (now - lastSave >= 1000) { saveLocal(); lastSave = now; }
  if (running) frameId = requestAnimationFrame(frame);
}
function pause() {
  syncTime(); running = false; if (frameId !== null) cancelAnimationFrame(frameId); frameId = null;
  refresh(); saveLocal();
}
function togglePlay() {
  if (busy) return;
  if (running) { pause(); return; }
  running = true; lastTick = performance.now(); lastSave = lastTick; refresh(); frameId = requestAnimationFrame(frame);
}
function setPhase(degrees) {
  if (busy || !Number.isFinite(degrees)) return;
  pause(); experiment.phaseRad = wrapPhase(degrees * Math.PI / 180); updateSnapshot(); refresh(); scheduleSave();
}
function setProbe(ratio) {
  if (busy) return; syncTime(); experiment.probeRatio = normalizeProbeRatio(ratio); updateSnapshot(); refresh(); scheduleSave();
}
function changeConfig(patch) {
  if (busy) return;
  const config = normalizeConfig({ ...experiment.config, ...patch });
  if (Object.keys(config).every(key => config[key] === experiment.config[key])) { syncControls(); return; }
  pause(); tone.stop(); experiment.config = config; updateSnapshot(); syncControls(); refresh(); scheduleSave();
}
function remember() { syncTime(); previous = { project: capture(), guide: copy(guide) }; $('#undo-new').hidden = false; }
function readProject(project, restoredGuide = null) {
  const saved = parseProject(serializeProject(project));
  pause(); tone.stop(); restoring = true;
  try { ({ experiment, comparison } = saved); ({ view, camera: initialCamera } = saved.observation); guide = restoredGuide; chartDisplay = 'both'; updateSnapshot(); syncControls(); refresh(); if (initialCamera) scene?.setCameraState(initialCamera); else scene?.resetCamera(); }
  finally { restoring = false; }
  saveLocal();
}
function newExperiment() {
  if (busy) return; pause(); tone.stop(); remember(); experiment = initialExperiment(DEFAULT_CONFIG); comparison = null; guide = null;
  view = normalizeView(DEFAULT_VIEW); chartDisplay = 'both'; updateSnapshot(); syncControls(); refresh(); scene?.resetCamera(); saveLocal(); toast('새 실험을 시작했습니다. 직전 실험은 되돌릴 수 있습니다.');
}
function setBusy(value) {
  if (value) { pause(); tone.stop(); }
  busy = value; $('#save-project').disabled = value; $('#open-project').disabled = value; $('#listen').disabled = value;
  if (desktop?.setBusy) Promise.resolve(desktop.setBusy(value)).catch(() => {});
}
function syncControls() {
  $('#length').value = experiment.config.lengthM; $('#length-number').value = experiment.config.lengthM;
  $('#boundary').value = experiment.config.boundary; $('#mode').value = experiment.config.mode;
  $('#part-select').value = view.selectedPart;
  for (const input of $$('[data-view]')) input.checked = view[input.dataset.view];
  for (const button of $$('[data-lesson]')) button.setAttribute('aria-pressed', String(button.dataset.lesson === guide?.id));
}
function drawChart() {
  const saved = comparison ? getSnapshot(comparison.experiment.config, { phaseRad: comparison.experiment.phaseRad, probeRatio: comparison.experiment.probeRatio }) : null;
  chart.update(snapshot, saved, chartDisplay);
}
function renderGuide() {
  $('#lesson-guide').hidden = !guide; if (!guide) return;
  const info = guideText(guide); text('#guide-title', LESSONS[guide.id].title);
  text('#guide-progress', guide.status === 'completed' ? '관찰 완료' : `관찰 ${guide.stage + 1} / ${info.total}`);
  text('#guide-action', info.action); text('#guide-result', info.result);
  $('#guide-next').hidden = guide.status !== 'active'; $('#guide-next').disabled = !lessonReady(guide, experiment, running);
  text('#guide-next', lessonReady(guide, experiment, running) ? '관찰 확인 · 다음으로' : '조건을 맞춘 뒤 관찰 확인');
  $('#guide-evidence').replaceChildren(...guide.evidence.map((evidence, index) => Object.assign(document.createElement('li'), { textContent: `${index + 1}차 ${fmt(evidence.frequencyHz, 1)} Hz · 탐침 ${fmt(evidence.experiment.probeRatio * 100, 0)}%` })));
}
function refresh(paint = true) {
  const frequencyText = `${fmt(snapshot.frequencyHz, 1)} Hz`;
  const harmonicText = `${experiment.config.mode}번째 모드 · 기본음의 ${snapshot.harmonic}배${snapshot.harmonic > 1 ? ` (${snapshot.harmonic}차 고조파)` : ''}`;
  text('#frequency', frequencyText); text('#wavelength', `${fmt(snapshot.wavelengthM, 3)} m`); text('#period', `${fmt(snapshot.periodS * 1000, 3)} ms`);
  text('#harmonic', harmonicText);
  text('#condition-frequency', frequencyText); text('#condition-harmonic', harmonicText);
  text('#condition-boundary', `${boundaryName(experiment.config)} · ${fmt(experiment.config.lengthM, 2)} m`);
  text('#boundary-reading', boundaryName(experiment.config)); text('#length-reading', `관 길이 ${fmt(experiment.config.lengthM, 2)} m · 내경 40 mm`);
  text('#play', running ? '일시정지' : '재생'); text('#play-state', running ? '한 주기 2초' : '정지');
  text('#phase-reading', `${fmt(experiment.phaseRad * 180 / Math.PI, 1)}°`); $('#phase').value = experiment.phaseRad * 180 / Math.PI;
  $('#probe').value = experiment.probeRatio * 100; text('#probe-position', `${fmt(experiment.probeRatio * 100, 1)}%`); text('#probe-meters', `왼쪽에서 ${fmt(snapshot.probe.xM, 3)} m`);
  text('#probe-pressure', fmt(snapshot.probe.pressureRelative, 3)); text('#probe-displacement', fmt(snapshot.probe.displacementRelative, 3)); text('#probe-velocity', fmt(snapshot.probe.velocityRelative, 3));
  const node = field => snapshot.nodes[field].some(ratio => Math.abs(ratio - experiment.probeRatio) < 1e-8);
  text('#node-reading', `${node('pressureRatios') ? '압력 마디' : snapshot.probe.pressureEnvelope > 1 - 1e-8 ? '압력 배' : '압력 마디 사이'} · ${node('displacementRatios') ? '변위·속도 마디' : snapshot.probe.displacementEnvelope > 1 - 1e-8 ? '변위·속도 배' : '변위 마디 사이'} (고정 포락선 기준)`);
  const part = COMPONENTS.find(item => item.id === view.selectedPart);
  text('#part-description', part.description); text('#part-material', part.material); $('#part-action').hidden = part.id !== 'end-cap'; text('#part-action', experiment.config.boundary === 'open-open' ? '왼쪽 끝마개 닫기' : '왼쪽 끝마개 열기');
  $('#comparison-panel').hidden = !comparison;
  if (comparison) text('#comparison-summary', `현재 ${conditionName(experiment)} / 보관 ${conditionName(comparison.experiment)}`);
  for (const button of $$('[data-chart-mode]')) button.setAttribute('aria-pressed', String(button.dataset.chartMode === chartDisplay));
  drawChart(); renderGuide(); if (paint) scene?.update(snapshot, view);
}
function startLesson(id) {
  if (busy || !LESSONS[id]) return; pause(); tone.stop(); remember();
  experiment = initialExperiment(LESSONS[id].config); if (id === 'nodes') experiment.probeRatio = 0;
  guide = createGuide(id); comparison = null; chartDisplay = 'both'; view = normalizeView(DEFAULT_VIEW);
  updateSnapshot(); syncControls(); refresh(); scene?.resetCamera(); saveLocal();
  $('#lesson-guide').scrollIntoView({ block: 'nearest' });
}
function pinComparison() {
  if (busy) return; syncTime(); comparison = { label: conditionName(experiment), experiment: copy(experiment) }; chartDisplay = 'both'; refresh(false); scheduleSave();
}
function browserDownload(contents, name, mime = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function saveFile() {
  if (busy) return; setBusy(true);
  try { const contents = serializeProject(capture()), name = `sound-lab-${new Date().toISOString().slice(0,10)}.sound.json`;
    if (desktop) { const result = await desktop.saveProject({ contents, name }); if (result.canceled) { toast('저장을 취소했습니다. 현재 실험은 유지합니다.'); return; } }
    else browserDownload(contents, name);
    saveLocal(); toast('관 조건·위상·탐침·비교·관찰 시점을 저장했습니다.');
  } catch (error) { toast(`저장하지 못했습니다. ${error.message}`); } finally { setBusy(false); }
}
async function openFile() {
  if (busy) return; pause(); tone.stop();
  if (!desktop) { $('#project-file').click(); return; }
  setBusy(true);
  try { const result = await desktop.openProject(); if (result.canceled) { toast('열기를 취소했습니다. 현재 실험은 유지합니다.'); return; } const saved = parseProject(result.content); remember(); readProject(saved); toast('저장한 소리 실험을 복원했습니다.'); }
  catch (error) { toast(`열지 못했습니다. ${error.message}`); } finally { setBusy(false); }
}
function toggleFocus() { document.body.classList.toggle('focus-mode'); text('#focus', document.body.classList.contains('focus-mode') ? '실험 화면으로' : '3D 크게 보기'); $('#scene').scrollIntoView({ block: 'nearest' }); }
function help() { pause(); tone.stop(); $('#help-dialog').showModal(); }

$('#part-select').replaceChildren(...COMPONENTS.map(part => Object.assign(document.createElement('option'), { value: part.id, textContent: part.name })));
try { scene = new SoundScene($('#scene'), { onSelect: id => { view.selectedPart = id; syncControls(); refresh(); scheduleSave(); }, onCameraChange: scheduleSave }); if (initialCamera) scene.setCameraState(initialCamera); }
catch (error) { $('#scene-error').hidden = false; text('#scene-error', `3D 화면을 시작하지 못했습니다. ${error.message}`); }
syncControls(); refresh(); if (!initialCamera) scene?.resetCamera();
$('#length').addEventListener('input', event => changeConfig({ lengthM: Number(event.target.value) }));
$('#length-number').addEventListener('change', event => { const value = Number(event.target.value); if (event.target.value.trim() && Number.isFinite(value)) changeConfig({ lengthM: value }); else syncControls(); });
$('#boundary').addEventListener('change', event => changeConfig({ boundary: event.target.value }));
$('#mode').addEventListener('change', event => changeConfig({ mode: Number(event.target.value) }));
$('#play').addEventListener('click', togglePlay); $('#reset-phase').addEventListener('click', () => setPhase(0));
$('#phase').addEventListener('input', event => setPhase(Number(event.target.value)));
$('#probe').addEventListener('input', event => setProbe(Number(event.target.value) / 100));
for (const button of $$('[data-phase]')) button.addEventListener('click', () => setPhase(Number(button.dataset.phase)));
for (const button of $$('[data-probe]')) button.addEventListener('click', () => setProbe(Number(button.dataset.probe) / 100));
$('#listen').addEventListener('click', () => { if (!busy) tone.play(snapshot.frequencyHz); }); $('#stop-tone').addEventListener('click', () => tone.stop());
for (const input of $$('[data-view]')) input.addEventListener('change', () => { if (busy) { syncControls(); return; } view[input.dataset.view] = input.checked; refresh(); scheduleSave(); });
for (const button of $$('[data-camera]')) button.addEventListener('click', () => scene?.resetCamera(button.dataset.camera));
$('#part-select').addEventListener('change', event => { view.selectedPart = event.target.value; refresh(); scheduleSave(); });
$('#focus-part').addEventListener('click', () => { scene?.focusPart(view.selectedPart); $('#toast').hidden = true; $('#scene').scrollIntoView({ block: 'nearest' }); }); $('#focus').addEventListener('click', toggleFocus);
$('#part-action').addEventListener('click', () => changeConfig({ boundary: experiment.config.boundary === 'open-open' ? 'closed-open' : 'open-open' }));
for (const button of $$('[data-lesson]')) button.addEventListener('click', () => startLesson(button.dataset.lesson));
$('#guide-next').addEventListener('click', () => { if (busy) return; syncTime(); if (confirmObservation(guide, experiment, running)) { pause(); refresh(false); } });
$('#guide-restart').addEventListener('click', () => { if (guide) startLesson(guide.id); }); $('#guide-exit').addEventListener('click', () => { guide = null; syncControls(); refresh(false); });
$('#pin-comparison').addEventListener('click', pinComparison); $('#clear-comparison').addEventListener('click', () => { comparison = null; chartDisplay = 'both'; refresh(false); scheduleSave(); });
for (const button of $$('[data-chart-mode]')) button.addEventListener('click', () => { chartDisplay = button.dataset.chartMode; refresh(false); });
$('#new-project').addEventListener('click', newExperiment);
$('#undo-new').addEventListener('click', () => { if (!previous || busy) return; const saved = previous; previous = null; readProject(saved.project, saved.guide); $('#undo-new').hidden = true; toast('직전 실험을 복원했습니다.'); });
$('#save-project').addEventListener('click', saveFile); $('#open-project').addEventListener('click', openFile);
$('#project-file').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file || busy) return; setBusy(true);
  try { if (file.size > 10 * 1024 * 1024) throw new Error('실험 파일은 10 MiB 이하여야 합니다.'); const saved = parseProject(await file.text()); remember(); readProject(saved); toast('저장한 소리 실험을 복원했습니다.'); }
  catch (error) { toast(`열지 못했습니다. ${error.message}`); } finally { event.target.value = ''; setBusy(false); }
});
$('#recover-original').addEventListener('click', () => { if (recoveredRaw !== null) { tone.stop(); browserDownload(recoveredRaw, 'sound-lab-original.txt', 'text/plain;charset=utf-8'); } });
$('#help').addEventListener('click', help); $('#close-help').addEventListener('click', () => $('#help-dialog').close());
desktop?.onCommand(command => { if (busy) return; const commands = { 'new-project': newExperiment, 'open-project': openFile, 'save-project': saveFile, 'toggle-play': togglePlay, focus: toggleFocus, help }; commands[command]?.(); });
window.addEventListener('beforeunload', () => { syncTime(); saveLocal(); tone.dispose(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); tone.stop(); } });
new ResizeObserver(drawChart).observe($('#wave-chart'));
window.soundLab = { getState: () => copy({ experiment, snapshot, view, comparison, running }), project: () => { syncTime(); return copy(capture()); },
  loadProject: raw => { const saved = parseProject(raw); remember(); readProject(saved); return copy(capture()); }, sceneDebug: () => scene?.getDebug() ?? null,
  guide: () => copy(guide), chartDebug: () => copy(chart.debug), audioState: () => tone.getState(), setPhase };

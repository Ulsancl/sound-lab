import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { COMPONENTS } from '../src/geometry.js';
import { getSnapshot } from '../src/model.js';
import { createProject, serializeProject } from '../src/project.js';
import { describeSoundDetail } from '../src/detail-model.js';

const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'output/detail-browser');
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5246, strictPort: true, hmr: false } });
await server.listen();
const hardware = process.env.SOUND_BROWSER_HARDWARE === '1';
let browser, page, gpu, failure;
const checks = [], errors = [], externalRequests = [];
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`); };
const near = (a, b, tolerance = 1e-9) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${a} != ${b} (±${tolerance})`);
const state = () => page.evaluate(() => window.soundLab.getState());
const detail = () => page.evaluate(() => window.soundLab.getDetail());
const project = () => page.evaluate(() => window.soundLab.project());
const debug = () => page.evaluate(() => window.soundLab.sceneDebug());
const inspection = () => page.evaluate(() => window.soundLab.getInspection());
const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
const phase = degrees => page.locator(`#sound-details [data-detail-phase="${degrees}"]`).click();
const load = value => page.evaluate(raw => window.soundLab.loadProject(raw), serializeProject(value));
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const rawValue = async key => Number(await page.locator(`#sound-details [data-detail-value="${key}"]`).getAttribute('data-raw'));
async function length(value) { await page.locator('#length-number').fill(String(value)); await page.locator('#length-number').press('Tab'); }
async function capture(name, selector) {
  if (selector) { await page.locator(selector).scrollIntoViewIfNeeded(); await paint(); await page.locator(selector).screenshot({ path: path.join(output, name), timeout: 15000 }); }
  else await page.screenshot({ path: path.join(output, name), fullPage: true, timeout: 15000 });
}
async function orbit() {
  const canvas = page.locator('#scene canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  assert.ok(box); const x = box.x + box.width * .8, y = box.y + box.height * .25;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x - 43, y + 27, { steps: 5 }); await page.mouse.up(); await paint();
}
function fixture(patch = {}) {
  return createProject({ experiment: { config: { lengthM: .75, boundary: 'closed-open', mode: 3 }, phaseRad: .731, probeRatio: .173829 },
    comparison: { label: '열린 관 90도 기준', experiment: { config: { lengthM: .5, boundary: 'open-open', mode: 1 }, phaseRad: Math.PI / 2, probeRatio: .5 } },
    view: { cutaway: false, particles: false, pressure: false, exploded: false, labels: false, selectedPart: 'tube-wall' },
    camera: { position: [1, .8, 1.3], target: [.1, .1, -.2], zoom: 1.4 }, ...patch });
}
async function parity() {
  const s = await state(), d = await detail(), { config, phaseRad: phi, probeRatio: r } = s.experiment;
  // Independent analytic values, rather than asking the new API to validate itself.
  const closed = config.boundary === 'closed-open', harmonic = closed ? 2 * config.mode - 1 : config.mode;
  const wavelength = (closed ? 4 : 2) * config.lengthM / harmonic;
  const angle = (closed ? harmonic / 2 : harmonic) * Math.PI * r;
  const P = closed ? Math.cos(angle) : Math.sin(angle), D = closed ? -Math.sin(angle) : Math.cos(angle);
  const expected = { 'probe.pressureRelative': P * Math.cos(phi), 'probe.displacementRelative': D * Math.cos(phi),
    'probe.velocityRelative': -D * Math.sin(phi), 'probe.pressureEnvelope': Math.abs(P), 'probe.displacementEnvelope': Math.abs(D),
    'probe.velocityEnvelope': Math.abs(D), 'probe.pressureRmsRelative': Math.abs(P) / Math.SQRT2,
    'probe.displacementRmsRelative': Math.abs(D) / Math.SQRT2, 'probe.velocityRmsRelative': Math.abs(D) / Math.SQRT2,
    'energy.probeCompression': (P * Math.cos(phi)) ** 2, 'energy.probeKinetic': (D * Math.sin(phi)) ** 2,
    'energy.cycleTotal': .5, 'flux.instantaneousRelative': -P * D * Math.cos(phi) * Math.sin(phi) };
  for (const [key, value] of Object.entries(expected)) { const [group, field] = key.split('.'); near(d[group][field], value); near(await rawValue(key), value); }
  near(d.mode.frequencyHz, 343 / wavelength); near(d.mode.periodS, wavelength / 343);
  near(d.mode.slowdownRatio, 2 * 343 / wavelength); near(d.mode.realPhaseTimeS, phi / (2 * Math.PI) * wavelength / 343);
  near(d.energy.wholeCompressionFraction, Math.cos(phi) ** 2); near(d.energy.wholeKineticFraction, Math.sin(phi) ** 2);
  near(Number(await page.locator('#compression-share').getAttribute('data-raw')), Math.cos(phi) ** 2);
  near(Number(await page.locator('#kinetic-share').getAttribute('data-raw')), Math.sin(phi) ** 2);
  near(Number(await page.locator('#probe-phase-point').getAttribute('cx')), 110 + 63 * expected['probe.pressureRelative'], .00051);
  near(Number(await page.locator('#probe-phase-point').getAttribute('cy')), 88 - 63 * expected['probe.velocityRelative'], .00051);
  assert.match(await page.locator('#detail-clock').textContent(), /ms.*2초.*누적 경과시간이 아닙니다/);
  assert.deepEqual(await page.evaluate(() => ({ playing: window.soundLab.audioState().playing, pending: window.soundLab.audioState().pending })), { playing: false, pending: false });
  return { s, d };
}
async function factParity(id) {
  const s = await state(), { config, phaseRad, probeRatio } = s.experiment;
  // Reconstruct the portable experiment locally; trigonometric ULPs may differ
  // between Node and Chromium, while each runtime's solved snapshot is strict.
  const expected = describeSoundDetail(id, getSnapshot(config, { phaseRad, probeRatio }));
  const facts = await page.locator('#part-facts > div').evaluateAll(rows => rows.map(row => ({ label: row.querySelector('dt').textContent,
    raw: row.querySelector('dd').dataset.raw, text: row.querySelector('dd').textContent })));
  assert.equal(facts.length, expected.facts.length); assert.ok(facts.length <= 6);
  facts.forEach((actual, i) => { const fact = expected.facts[i]; assert.equal(actual.label, fact.label);
    if (typeof fact.value === 'number') near(Number(actual.raw), fact.value); else assert.equal(actual.raw, fact.value);
    if (fact.unit) assert.ok(actual.text.endsWith(` ${fact.unit}`), actual.text);
    assert.doesNotMatch(actual.text, /NaN|Infinity|undefined/);
  });
  assert.equal(await page.locator('#part-detail-note').textContent(), expected.note);
}
const groups = [
  ['rail', 'rail', ['rail']], ['tube-wall', 'tube', ['tube-wall']],
  ['tube-collars', 'collar', ['tube-collars', 'left-support']], ['left-support', 'support', ['left-support']],
  ['right-support', 'support', ['right-support']], ['end-cap', 'cap', ['end-cap']], ['probe-carriage', 'probe', ['probe-carriage']],
];

try {
  browser = await chromium.launch({ headless: true, ...(hardware ? { args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:5246/'); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready);
  await check('new panel distinguishes instantaneous amplitude, cycle RMS and whole-column energy while paused', async () => {
    const { s, d } = await parity(); assert.equal(s.running, false); assert.equal(d.probe.pressureRelative, 1);
    near(d.probe.pressureRmsRelative, Math.SQRT1_2); assert.equal(d.energy.probeTotal, 1);
    assert.equal(d.energy.wholeCompressionFraction, 1); assert.equal(d.energy.wholeKineticFraction, 0);
    assert.equal(await inspection(), null);
    gpu = await page.evaluate(() => { const gl = document.querySelector('#scene canvas').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info'); return { webgl2: !!gl, renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) }; });
    if (hardware) assert.match(gpu.renderer, /RTX 5080.*D3D11|D3D11.*RTX 5080/);
    await paint(); await page.waitForTimeout(150); const before = await state(); await page.waitForTimeout(150); assert.deepEqual(await state(), before);
  });
  await check('actual mode and length controls preserve normalized observations and update the real-cycle scale', async () => {
    await page.locator('#probe').fill('25'); await page.locator('#phase').fill('45');
    for (const boundary of ['open-open', 'closed-open']) for (const mode of [1, 2, 3]) {
      await select('boundary', boundary); await select('mode', mode); await parity();
    }
    const before = await detail(); await length(.3); const short = await detail(); await parity();
    near(short.mode.frequencyHz, 2 * before.mode.frequencyHz); assert.deepEqual(short.energy, before.energy);
    assert.deepEqual(short.flux, before.flux); assert.equal(short.probe.xM, before.probe.xM / 2);
    await length(1.2); const long = await detail(); await parity(); near(long.mode.periodS, 4 * short.mode.periodS);
    assert.deepEqual(long.energy, short.energy); assert.equal(long.mode.displayPeriodS, 2);
  });
  await check('detail phase buttons trace pressure versus velocity and transfer whole energy without changing RMS', async () => {
    await length(.6); await select('boundary', 'open-open'); await select('mode', 1); await page.locator('#probe').fill('25');
    const before = await detail();
    for (const [degrees, compression, kinetic] of [[0, 1, 0], [90, 0, 1], [180, 1, 0], [270, 0, 1]]) {
      await phase(degrees); const { d } = await parity();
      assert.equal(d.energy.wholeCompressionFraction, compression); assert.equal(d.energy.wholeKineticFraction, kinetic);
      assert.equal(d.probe.pressureRmsRelative, before.probe.pressureRmsRelative); assert.equal(d.flux.instantaneousRelative, 0);
      assert.equal((await state()).running, false);
    }
    await page.locator('#phase').fill('45'); const { d } = await parity(); near(d.flux.instantaneousRelative, -.25);
    const points = (await page.locator('#probe-phase-orbit').getAttribute('d')).match(/[ML]([^ML]+)/g).map(point => point.slice(1).split(',').map(Number));
    assert.equal(points.length, 97);
    points.forEach(([x, y], i) => { const phi = i / 96 * 2 * Math.PI; near(x, 110 + 63 * Math.SQRT1_2 * Math.cos(phi), .00051); near(y, 88 + 63 * Math.SQRT1_2 * Math.sin(phi), .00051); });
    await page.locator('.sound-local-energy summary').click();
    assert.match(await page.locator('.sound-local-energy').textContent(), /서로 다른 기준/);
    await capture('sound-detail-overview.png');
  });
  await check('imported near-node positions stay non-nodes and tiny nonzero values remain visible', async () => {
    await load(fixture({ experiment: { config: { lengthM: .6, boundary: 'open-open', mode: 1 }, phaseRad: 0, probeRatio: 1e-9 } }));
    const { d } = await parity(); assert.equal(d.probe.pressureIsNode, false); assert.equal(d.probe.motionIsAntinode, false);
    assert.match(await page.locator('#node-reading').textContent(), /^압력 마디 사이/);
    assert.ok(await rawValue('probe.pressureRelative') > 0);
    assert.match(await page.locator('[data-detail-value="probe.pressureRelative"]').textContent(), /e-9/);
    await page.locator('.sound-nodes summary').click(); await page.locator('[data-node-kind="pressure"][data-node-ratio="0"]').click();
    assert.equal((await state()).experiment.probeRatio, 0); assert.equal((await detail()).probe.pressureIsNode, true);
    assert.equal(await rawValue('probe.pressureRmsRelative'), 0); assert.match(await page.locator('#node-reading').textContent(), /^압력 마디 ·/);
  });
  await check('exact node jumps cover both boundaries and all modes without moving camera, phase or saved reference', async () => {
    for (const boundary of ['open-open', 'closed-open']) for (const mode of [1, 2, 3]) {
      await select('boundary', boundary); await select('mode', mode); const before = await project(), nodes = (await detail()).positions;
      for (const [kind, points] of [['pressure', nodes.pressureNodes], ['motion', nodes.motionNodes]]) for (const node of points) {
        const button = page.locator(`[data-node-kind="${kind}"]`).filter({ hasText: `x/L` }).nth(points.indexOf(node));
        await button.click(); const current = await project(), d = await detail();
        assert.equal(current.experiment.probeRatio, node.ratio); assert.equal(d.probe[kind === 'pressure' ? 'pressureIsNode' : 'motionIsNode'], true);
        assert.equal(await button.getAttribute('aria-pressed'), 'true'); assert.equal(current.experiment.phaseRad, before.experiment.phaseRad);
        assert.deepEqual(current.comparison, before.comparison); assert.deepEqual(current.observation.camera, before.observation.camera);
      }
    }
    await parity();
  });
  await check('saved-only quarter-cycle chart retains the saved envelope and square nodes behind zero instantaneous curves', async () => {
    await phase(90); await page.locator('#pin-comparison').click(); const saved = (await state()).comparison;
    await select('boundary', 'open-open'); await select('mode', 1); await length(.3); await phase(0);
    await page.locator('[data-chart-mode="saved"]').click();
    const chart = await page.evaluate(() => window.soundLab.chartDebug());
    assert.equal(chart.currentVisible, false); assert.equal(chart.savedVisible, true); assert.equal(chart.envelopes.saved, true);
    assert.deepEqual(chart.nodes.saved.pressureRatios, [.2, .6, 1]); assert.deepEqual(chart.nodes.saved.displacementRatios, [0, .4, .8]);
    for (const [quantity, center] of [['pressure', 75], ['displacement', 194]]) {
      assert.equal(await page.locator(`[data-saved-envelope="${quantity}"]`).count(), 2);
      const ys = (await page.locator(`[data-saved-wave="${quantity}"]`).getAttribute('d')).match(/[ML]([^ML]+)/g).map(point => Number(point.slice(1).split(',')[1]));
      assert.ok(ys.every(y => y === center));
      const envelope = await page.locator(`[data-saved-envelope="${quantity}"]`).first().getAttribute('d');
      assert.ok(envelope.match(/[ML]([^ML]+)/g).some(point => Math.abs(Number(point.slice(1).split(',')[1]) - center) > 38));
      const nodes = await page.locator(`rect[data-saved-node="${quantity}"]`).evaluateAll(elements => elements.map(el => Number(el.dataset.ratio)));
      assert.deepEqual(nodes, quantity === 'pressure' ? [.2, .6, 1] : [0, .4, .8]);
    }
    assert.equal(await page.locator('#wave-chart circle').count(), 0); assert.deepEqual((await state()).comparison, saved);
    await capture('saved-quarter-cycle.png', '.chart-card');
    await page.locator('[data-chart-mode="current"]').click(); assert.equal(await page.locator('[data-saved-envelope]').count(), 0);
    await page.locator('[data-chart-mode="both"]').click(); assert.deepEqual((await state()).comparison, saved);
  });
  await check('fourteen component fact tables preserve the original mode, comparison and manual camera', async () => {
    await load(fixture()); const before = await project();
    for (const { id } of COMPONENTS) {
      await select('part-select', id); await factParity(id);
      const current = await project(); assert.deepEqual(current.experiment, before.experiment); assert.deepEqual(current.comparison, before.comparison);
      assert.deepEqual(current.observation.camera, before.observation.camera);
    }
    await parity();
  });
  await check('seven inspection groups expose their structure while temporary orbit and displayed seal withdrawal preserve the saved camera', async () => {
    await load(fixture());
    for (const [id, kind, visible] of groups) {
      await select('part-select', id); const before = await project(); await page.locator('#inspect-part').click(); await paint();
      const scene = await debug(); assert.equal((await inspection()).id, id); assert.equal((await inspection()).kind, kind);
      assert.deepEqual(scene.visibleParts, visible); assert.equal(scene.groundVisible, false);
      assert.deepEqual(scene.projectCamera, before.observation.camera); assert.notDeepEqual(scene.camera, before.observation.camera);
      near(scene.mechanical.cap.assembledSealGapM, 0, 1e-7); near(scene.mechanical.cap.sealDisplayWithdrawalM, id === 'end-cap' ? .003 : 0);
      if (id === 'end-cap') { assert.match(await page.locator('#inspection-note').textContent(), /3 mm/); await capture('cap-detail.png', '.scene-card'); }
      if (id === 'probe-carriage') { const original = scene.camera; await orbit(); assert.notDeepEqual((await debug()).camera, original); await capture('probe-carriage-detail.png', '.scene-card'); }
      assert.deepEqual(await project(), before); assert.equal(await page.locator('#inspect-part').getAttribute('aria-pressed'), 'true');
      await page.locator('#inspect-part').click(); assert.equal(await inspection(), null);
      assert.equal(await page.locator('#inspection-strip').isVisible(), false); assert.deepEqual((await debug()).camera, before.observation.camera);
      near((await debug()).mechanical.cap.sealDisplayWithdrawalM, 0);
    }
  });
  await check('inspection switches, current view choices and mode edits restore correctly through every exit path', async () => {
    await load(fixture()); const before = await project(); await select('part-select', 'tube-collars'); await page.locator('#inspect-part').click();
    await page.locator('[data-view="exploded"]').check(); await page.locator('[data-view="cutaway"]').check(); await page.locator('[data-view="particles"]').check();
    await phase(90); await select('mode', 2); assert.equal((await inspection()).id, 'tube-collars');
    await select('part-select', 'left-support'); assert.equal((await inspection()).id, 'left-support');
    assert.deepEqual((await project()).observation.camera, before.observation.camera); assert.deepEqual((await state()).comparison, before.comparison);
    await page.locator('#end-inspection').click(); assert.equal(await inspection(), null);
    assert.deepEqual((await debug()).camera, before.observation.camera); const view = (await state()).view;
    assert.equal(view.exploded, true); assert.equal(view.cutaway, true); assert.equal(view.particles, true); assert.equal(view.pressure, false); assert.equal(view.labels, false);
    await page.locator('#inspect-part').click(); await page.locator('#focus-part').click();
    assert.equal(await inspection(), null); assert.equal(await page.locator('#inspection-strip').isVisible(), false);
    await page.locator('#inspect-part').click(); await page.locator('[data-camera="side"]').click(); assert.equal(await inspection(), null);
    await page.locator('#inspect-part').click(); await select('part-select', 'probe-tip');
    assert.equal(await inspection(), null); assert.equal(await page.locator('#inspect-part').isEnabled(), false);
    await select('part-select', 'end-cap'); await page.locator('#inspect-part').click(); await select('boundary', 'open-open');
    assert.equal(await inspection(), null); assert.deepEqual((await state()).comparison, before.comparison);
  });
  await check('inspection download, reload, native file input, new and undo all retain the original observation', async () => {
    await load(fixture()); await select('part-select', 'probe-carriage'); const before = await project(); await page.locator('#inspect-part').click(); await orbit();
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click(); const download = await pending;
    const filename = path.join(output, 'inspection-original.sound.json'); await download.saveAs(filename);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), before); assert.equal((await inspection()).id, 'probe-carriage');
    await page.reload(); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready);
    assert.equal(await inspection(), null); assert.deepEqual(await project(), before);
    await page.locator('#inspect-part').click(); await page.locator('#project-file').setInputFiles(filename);
    await page.waitForFunction(() => window.soundLab.getInspection() === null && !document.querySelector('#save-project').disabled);
    assert.deepEqual(await project(), before); assert.equal((await state()).running, false);
    await page.locator('#inspect-part').click(); await page.locator('#new-project').click(); assert.equal(await inspection(), null);
    await page.locator('#undo-new').click(); assert.deepEqual(await project(), before); assert.equal(await inspection(), null); await parity();
  });
  await check('deterministic visual advance updates phase diagnostics only and never redefines real frequency or RMS', async () => {
    await phase(0); const before = await state(), previous = await detail();
    await page.evaluate(() => window.advanceTime(500)); const { s, d } = await parity();
    assert.equal(s.experiment.phaseRad, Math.PI / 2); assert.deepEqual(s.experiment.config, before.experiment.config);
    assert.equal(d.mode.frequencyHz, previous.mode.frequencyHz); assert.equal(d.probe.pressureRmsRelative, previous.probe.pressureRmsRelative);
    assert.deepEqual(s.comparison, before.comparison); assert.equal(s.running, false);
    const text = await page.evaluate(() => JSON.parse(window.render_game_to_text())); assert.equal(text.mode, 'paused');
    assert.match(text.coordinateSystem, /independently normalized.*2 s/); assert.equal(text.audio.playing, false);
  });
  await check('390-pixel layout and focus mode keep detail values and inspection exit reachable without overflow', async () => {
    await load(fixture()); await page.setViewportSize({ width: 390, height: 844 }); await paint(); await parity();
    await select('part-select', 'probe-carriage'); await factParity('probe-carriage'); await page.locator('#inspect-part').click();
    await page.locator('#focus').click(); assert.equal(await page.locator('#sound-details').isVisible(), false);
    assert.equal(await page.locator('#end-inspection').isVisible(), true); await page.locator('#end-inspection').click(); assert.equal(await inspection(), null);
    await page.locator('#focus').click(); assert.equal(await page.locator('#sound-details').isVisible(), true);
    await page.locator('#sound-details').scrollIntoViewIfNeeded();
    const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('#sound-details td,#part-facts dd,#inspection-strip button')].filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent) }));
    assert.ok(overflow.document <= overflow.width + 1, JSON.stringify(overflow)); assert.deepEqual(overflow.clipped, []);
    await capture('sound-detail-mobile.png'); assert.deepEqual((await project()).observation.camera, fixture().observation.camera);
  });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error; process.exitCode = 1; console.error(error.stack);
  const diagnostic = page ? await page.evaluate(() => ({ state: window.soundLab?.getState(), inspection: window.soundLab?.getInspection(), scene: window.soundLab?.sceneDebug(), toast: document.querySelector('#toast')?.textContent })).catch(() => null) : null;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 3000 }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, stack: error.stack, checks, errors, externalRequests, diagnostic }, null, 2));
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'FAILED' : 'PASSED', checks, errors, externalRequests, hardware, gpu, ...(failure ? { failure: failure.message } : {}) }, null, 2));
  await browser?.close(); await server.close(); console.log(`Detail browser: ${checks.length} checks ${failure ? 'completed before failure' : 'passed'}.`);
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/browser-integration');
const baseURL = 'http://127.0.0.1:5243/';
const storageKey = 'sound-lab-project-v1';
await fs.mkdir(output, { recursive: true });
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5243, strictPort: true, hmr: false } });
await server.listen();
const hardware = process.env.SOUND_BROWSER_HARDWARE === '1';
let browser, context, page, gpu, failure, offlineAudio;
const checks = [], errors = [], externalRequests = [];
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`); };
const state = () => page.evaluate(() => window.soundLab.getState());
const project = () => page.evaluate(() => window.soundLab.project());
const guide = () => page.evaluate(() => window.soundLab.guide());
const debug = () => page.evaluate(() => window.soundLab.sceneDebug());
const chart = () => page.evaluate(() => window.soundLab.chartDebug());
const audio = () => page.evaluate(() => window.soundLab.audioState());
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
const phase = degrees => page.locator(`[data-phase="${degrees}"]`).click();
const probe = percent => page.locator(`[data-probe="${percent}"]`).click();
const choose = name => page.locator(`[data-lesson="${name}"]`).click();
async function length(value) {
  await page.locator('#length-number').fill(String(value));
  await page.locator('#length-number').press('Tab');
  assert.equal((await state()).experiment.config.lengthM, value);
}
async function dismissToast() { if (await page.locator('#toast').isVisible()) await page.locator('#toast button').click(); }
function watch(target) {
  target.on('pageerror', error => errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  target.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
}
async function frequency(expected, wavelength) {
  const current = await state(); near(current.snapshot.frequencyHz, expected); near(current.snapshot.wavelengthM, wavelength);
  near(current.snapshot.periodS, 1 / expected); near(current.snapshot.frequencyHz * current.snapshot.wavelengthM, 343);
  near(Number((await page.locator('#frequency').textContent()).replaceAll(',', '').replace(/[^\d.\-]/g, '')), expected, .051);
}
async function confirm() { assert.equal(await page.locator('#guide-next').isEnabled(), true); await page.locator('#guide-next').click(); }
async function hidden(target = page) {
  // Exercise the actual visibility listener without depending on headless window-manager focus.
  await target.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
}

try {
  browser = await chromium.launch({ headless: true, ...(hardware ? { args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] } : {}) });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page = await context.newPage(); page.setDefaultTimeout(20000); watch(page);
  await page.goto(baseURL); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready);

  await check('initial bench is paused and silent with fourteen parts, independent sound values, and no idle redraw loop', async () => {
    const initial = await state(); assert.equal(initial.running, false);
    assert.deepEqual(initial.experiment, { config: { lengthM: .6, boundary: 'open-open', mode: 1 }, phaseRad: 0, probeRatio: .5 });
    assert.equal(initial.comparison, null); assert.equal((await debug()).componentCount, 14); assert.equal((await audio()).playing, false);
    await frequency(343 / 1.2, 1.2); near(initial.snapshot.probe.pressureRelative, 1); near(initial.snapshot.probe.displacementRelative, 0);
    const mesh = await debug(); near(mesh.lengthM, .6, 1e-7); near(mesh.innerRadiusM, .020, 1e-7); near(mesh.outerRadiusM, .023, 1e-7); near(mesh.probeWorld[0], 0, 1e-7);
    for (const particle of mesh.particlePositions) near(particle.world[0], .6 * particle.positionRatio - .3 + .006 * Math.cos(Math.PI * particle.positionRatio), 1e-7);
    gpu = await page.evaluate(() => { const gl = document.querySelector('#scene canvas').getContext('webgl2'), extension = gl.getExtension('WEBGL_debug_renderer_info'); return { webgl2: Boolean(gl), renderer: gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER) }; });
    assert.equal(gpu.webgl2, true); if (hardware) assert.match(gpu.renderer, /RTX 5080.*D3D11|D3D11.*RTX 5080/);
    await paint(); await page.waitForTimeout(150); const before = await debug(); await page.waitForTimeout(150); assert.equal((await debug()).renderFrame, before.renderFrame);
  });

  await check('actual length, cap and mode controls match independent frequency and wavelength tables', async () => {
    await length(.5);
    for (const [boundary, rows] of [['open-open', [[1,343,1],[2,686,.5],[3,1029,1/3]]], ['closed-open', [[1,171.5,2],[2,514.5,2/3],[3,857.5,.4]]]]) {
      await select('boundary', boundary);
      for (const [mode, hz, wavelength] of rows) { await select('mode', mode); await frequency(hz, wavelength); assert.equal((await state()).snapshot.harmonic, boundary === 'open-open' ? mode : 2 * mode - 1); }
    }
    await select('part-select', 'end-cap'); assert.equal(await page.locator('#part-action').isVisible(), true); await page.locator('#part-action').click();
    assert.equal((await state()).experiment.config.boundary, 'open-open'); await frequency(1029, 1/3);
  });

  await check('probe and phase controls distinguish instantaneous zeros from fixed pressure and displacement nodes', async () => {
    await select('mode', 1); await phase(0); await probe(0);
    let current = await state(); near(current.snapshot.probe.pressureRelative, 0); near(current.snapshot.probe.displacementRelative, 1); near(current.snapshot.probe.velocityRelative, 0);
    await probe(50); current = await state(); near(current.snapshot.probe.pressureRelative, 1); near(current.snapshot.probe.displacementRelative, 0);
    assert.deepEqual(current.snapshot.nodes.pressureRatios, [0, 1]); assert.deepEqual(current.snapshot.nodes.displacementRatios, [.5]);
    await phase(90); current = await state(); near(current.snapshot.probe.pressureRelative, 0); near(current.snapshot.probe.pressureEnvelope, 1);
    assert.match(await page.locator('#node-reading').textContent(), /압력 배.*변위·속도 마디/);
    await phase(180); near((await state()).snapshot.probe.pressureRelative, -1);
    await probe(100); await phase(0); near((await state()).snapshot.probe.displacementRelative, -1);
    await select('boundary', 'closed-open'); await probe(0); current = await state(); near(current.snapshot.probe.pressureRelative, 1); near(current.snapshot.probe.displacementRelative, 0); near(current.snapshot.probe.velocityRelative, 0);
    const mesh = await debug(); near(mesh.capFaceWorld[0], -.25, 1e-7); near(mesh.probeWorld[0], -.25, 1e-7); assert.equal(mesh.capClosed, true);
  });

  await check('slow playback accounts for a blocked frame, remains paused without drift, and pauses on hidden notification', async () => {
    await phase(0);
    const measured = await page.evaluate(() => {
      const before = performance.now(); document.querySelector('#play').click();
      const until = performance.now() + 220; while (performance.now() < until) { /* Deliberately blocked frame. */ }
      const elapsedS = (performance.now() - before) / 1000; document.querySelector('#play').click(); return { elapsedS, actual: window.soundLab.getState() };
    });
    assert.equal(measured.actual.running, false); assert.ok(measured.actual.experiment.phaseRad >= .22 * Math.PI);
    near(measured.actual.experiment.phaseRad, measured.elapsedS * Math.PI, .08);
    const stopped = (await state()).experiment; await page.waitForTimeout(160); assert.deepEqual((await state()).experiment, stopped);
    await page.locator('#play').click(); await page.waitForTimeout(120); await hidden(); assert.equal((await state()).running, false);
    const hiddenState = (await state()).experiment; await page.waitForTimeout(100); assert.deepEqual((await state()).experiment, hiddenState);
    await phase(270); near((await state()).experiment.phaseRad, 1.5 * Math.PI); assert.equal((await state()).running, false);
  });

  await check('length guide records two explicit valid observations and preserves completed evidence after further edits', async () => {
    await choose('length'); assert.deepEqual((await guide()).evidence, []); await page.waitForTimeout(100); assert.equal((await guide()).stage, 0);
    await length(.6); assert.equal(await page.locator('#guide-next').isEnabled(), false); await length(.5); await confirm();
    assert.equal((await guide()).stage, 1); assert.equal(await page.locator('#guide-next').isEnabled(), false); await length(1); await confirm();
    const completed = await guide(); assert.equal(completed.status, 'completed'); assert.deepEqual(completed.evidence.map(item => item.frequencyHz), [343,171.5]); assert.deepEqual(completed.evidence.map(item => item.wavelengthM), [1,2]);
    const result = await page.locator('#guide-result').textContent(); assert.match(result, /343 → 171.5 Hz/);
    await length(.8); assert.deepEqual(await guide(), completed); assert.equal(await page.locator('#guide-result').textContent(), result);
    await page.locator('#guide-restart').click(); assert.equal((await guide()).stage, 0); assert.deepEqual((await guide()).evidence, []);
  });

  await check('cap guide requires all six actual mode observations and identifies the odd harmonic sequence', async () => {
    await choose('cap');
    for (const boundary of ['open-open', 'closed-open']) {
      await select('boundary', boundary);
      for (const mode of [1,2,3]) { await select('mode', mode); await confirm(); }
    }
    const completed = await guide(); assert.equal(completed.status, 'completed'); assert.equal(completed.evidence.length, 6);
    completed.evidence.forEach((item, i) => near(item.frequencyHz, [343,686,1029,171.5,514.5,857.5][i]));
    assert.match(await page.locator('#guide-result').textContent(), /두 번째 모드는 기본음의 3배/);
  });

  await check('node guide rejects running or mismatched observations and records six physical boundary states', async () => {
    await choose('nodes'); await page.locator('#play').click(); assert.equal(await page.locator('#guide-next').isEnabled(), false); await phase(0); await confirm();
    await probe(50); await confirm(); assert.equal(await page.locator('#guide-next').isEnabled(), false);
    await phase(90); await confirm(); await phase(180); await confirm(); await probe(100); await phase(0); await confirm();
    await select('boundary', 'closed-open'); await probe(0); await confirm();
    const completed = await guide(); assert.equal(completed.status, 'completed'); assert.equal(completed.evidence.length, 6);
    completed.evidence.forEach((item, i) => { near(item.probe.pressureRelative, [0,1,0,-1,0,1][i]); near(item.probe.displacementRelative, [1,0,0,0,-1,0][i]); });
    assert.deepEqual(completed.evidence[2].nodes.pressureRatios, [0,1]); near(completed.evidence[2].probe.pressureEnvelope, 1);
    const saved = await project(); await page.locator('#new-project').click(); assert.equal(await guide(), null); await dismissToast(); await page.locator('#undo-new').click(); assert.deepEqual(await project(), saved); assert.deepEqual(await guide(), completed);
    await page.locator('#guide-exit').click(); assert.equal(await guide(), null);
  });

  await check('manual camera, selection and view controls preserve the experiment while explicit focus changes the viewpoint', async () => {
    await dismissToast(); await page.locator('#scene').scrollIntoViewIfNeeded();
    const box = await page.locator('#scene canvas').boundingBox(), beforeDrag = (await project()).observation.camera;
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .65); await page.mouse.down(); await page.mouse.move(box.x + box.width * .57, box.y + box.height * .58, { steps: 12 }); await page.mouse.up(); await paint();
    assert.notDeepEqual((await project()).observation.camera, beforeDrag);
    const before = await project(); await select('part-select', 'probe-tip'); assert.deepEqual((await project()).observation.camera, before.observation.camera);
    for (const key of ['cutaway','particles','pressure','exploded','labels']) { const control = page.locator(`[data-view="${key}"]`), previous = await control.isChecked(); await control.setChecked(!previous); assert.equal((await state()).view[key], !previous); await control.setChecked(previous); }
    await page.setViewportSize({ width: 1280, height: 720 }); await paint(); assert.deepEqual((await project()).observation.camera, before.observation.camera); assert.deepEqual((await state()).experiment, before.experiment);
    await page.locator('#focus-part').click(); assert.notDeepEqual((await project()).observation.camera, before.observation.camera); assert.deepEqual((await state()).experiment, before.experiment);
    await page.locator('#focus').click(); assert.equal(await page.locator('body').evaluate(el => el.classList.contains('focus-mode')), true); await page.locator('#focus').click();
  });

  await check('comparison stays frozen and rendered traces and frequency bars use shared fixed axes', async () => {
    await length(.5); await select('boundary', 'open-open'); await select('mode', 1); await phase(0); await probe(50); await page.locator('#pin-comparison').click();
    const saved = (await state()).comparison; await length(1); await phase(180); assert.deepEqual((await state()).comparison, saved);
    let plot = await chart(); assert.deepEqual(plot.xDomain, [0,1]); assert.deepEqual(plot.yDomains, [[-1,1],[-1,1]]); assert.deepEqual(plot.frequencyDomainHz, [0,1800]); near(plot.current.frequencyHz, 171.5); near(plot.saved.frequencyHz, 343);
    const bars = await page.locator('#frequency-chart svg line').evaluateAll(lines => lines.map(line => ({ width: Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')), stroke: line.getAttribute('stroke') })));
    const currentBar = bars.find(line => line.stroke === '#65d8e4'), savedBar = bars.find(line => line.stroke === '#df9acc'); near(currentBar.width / savedBar.width, .5);
    assert.ok(await page.locator('#wave-chart svg path').count() >= 10);
    for (const [display, currentVisible, savedVisible] of [['current',true,false],['saved',false,true],['both',true,true]]) {
      await page.locator(`[data-chart-mode="${display}"]`).click(); plot = await chart(); assert.equal(plot.currentVisible, currentVisible); assert.equal(plot.savedVisible, savedVisible); assert.deepEqual(plot.yDomains, [[-1,1],[-1,1]]);
    }
    await page.screenshot({ path: path.join(output, 'sound-comparison.png'), fullPage: true });
  });

  await check('file download, BOM import, reload and failed imports preserve exact experiment, comparison and camera', async () => {
    await page.locator('[data-view="exploded"]').check(); const saved = await project();
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click(); const file = path.join(output, 'saved.sound.json'); await (await pending).saveAs(file);
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), saved);
    await page.locator('#new-project').click(); await page.locator('#project-file').setInputFiles({ name: 'bom.sound.json', mimeType: 'application/json', buffer: Buffer.from('\ufeff' + JSON.stringify(saved)) });
    await page.waitForFunction(expected => JSON.stringify(window.soundLab.project()) === JSON.stringify(expected), saved); assert.deepEqual(await project(), saved);
    await page.reload(); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready); assert.deepEqual(await project(), saved); assert.equal((await state()).running, false); assert.equal((await audio()).playing, false); assert.equal(await guide(), null);
    for (const raw of ['{invalid JSON', JSON.stringify({ ...saved, schemaVersion: 99 }), JSON.stringify({ ...saved, experiment: { ...saved.experiment, phaseRad: 2 * Math.PI } })]) {
      const before = await project(); const message = await page.evaluate(raw => { try { window.soundLab.loadProject(raw); return ''; } catch (error) { return error.message; } }, raw);
      assert.ok(message.length > 0); assert.deepEqual(await project(), before);
    }
  });

  await check('future and corrupt automatic-save originals remain byte-exact and exportable after edits', async () => {
    for (const [name, raw] of [['future', '\ufeff{"type":"sound-lab-project","schemaVersion":99,"original":"한글 원문"}'], ['corrupt', '{"original":"손상 원문"']]) {
      const isolated = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
      try {
        const other = await isolated.newPage(); watch(other);
        await other.addInitScript(({ key, raw }) => { if (location.hostname === '127.0.0.1') localStorage.setItem(key, raw); }, { key: storageKey, raw });
        await other.goto(baseURL); await other.waitForFunction(() => window.soundLab?.sceneDebug()?.ready && !document.querySelector('#storage-recovery').hidden);
        await other.locator('#mode').selectOption('2'); await other.locator('[data-phase="90"]').click(); await other.waitForTimeout(300);
        assert.equal(await other.evaluate(key => localStorage.getItem(key), storageKey), raw);
        const pending = other.waitForEvent('download'); await other.locator('#recover-original').click(); const file = path.join(output, `${name}-original.txt`); await (await pending).saveAs(file); assert.equal(await fs.readFile(file, 'utf8'), raw);
      } finally { await isolated.close(); }
    }
  });

  await check('loaded offline app continues condition, probe and comparison observations without network requests', async () => {
    await context.setOffline(true);
    try {
      await length(.5); await select('boundary', 'closed-open'); await select('mode', 2); await phase(0); await probe(0); await frequency(514.5, 2/3);
      near((await state()).snapshot.probe.pressureRelative, 1); await page.locator('#pin-comparison').click(); assert.equal((await state()).comparison.experiment.config.mode, 2);
      await page.locator('#help').click(); assert.equal(await page.locator('#help-dialog').isVisible(), true); await page.locator('#close-help').click();
    } finally { await context.setOffline(false); }
  });

  await check('OfflineAudioContext samples independently verify sine frequency, gain, fades and exact two-second stop', async () => {
    offlineAudio = await page.evaluate(async () => {
      const { createToneGraph } = await import('/src/audio.js'); const results = [];
      for (const requestedHz of [343,514.5]) {
        const sampleRate = 48000, context = new OfflineAudioContext(1, Math.ceil(sampleRate * 2.1), sampleRate);
        createToneGraph(context, requestedHz); const data = (await context.startRendering()).getChannelData(0);
        const crossings = []; let peak = 0, tailPeak = 0;
        for (let i = 1; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i])); if (i >= 2 * sampleRate) tailPeak = Math.max(tailPeak, Math.abs(data[i]));
          if (i >= .1 * sampleRate && i < 1.8 * sampleRate && data[i-1] <= 0 && data[i] > 0) crossings.push(i - 1 - data[i-1] / (data[i] - data[i-1]));
        }
        const rms = (start, end) => { let energy = 0, count = 0; for (let i = Math.floor(start * sampleRate); i < Math.floor(end * sampleRate); i++) { energy += data[i] ** 2; count++; } return Math.sqrt(energy / count); };
        results.push({ requestedHz, measuredHz: (crossings.length - 1) * sampleRate / (crossings.at(-1) - crossings[0]), peak, tailPeak, first: data[0], steadyRms: rms(.2,.4), attackRms: rms(0,.01), releaseRms: rms(1.99,2) });
      }
      return results;
    });
    for (const result of offlineAudio) { near(result.measuredHz, result.requestedHz, .01); assert.ok(result.peak > .0249 && result.peak <= .025001); near(result.steadyRms, .025 / Math.sqrt(2), .0002); assert.equal(result.first, 0); assert.equal(result.tailPeak, 0); assert.ok(result.attackRms < result.steadyRms * .4); assert.ok(result.releaseRms < result.steadyRms * .3); }
  });

  await check('explicit tone playback stays independent of probe and slow phase, and stops on config, file and hidden actions', async () => {
    await length(.5); await select('boundary', 'open-open'); await select('mode', 1);
    await page.locator('#listen').click(); await page.waitForFunction(() => window.soundLab.audioState().playing); near((await audio()).frequencyHz, 343);
    await probe(100); await phase(90); near((await audio()).frequencyHz, 343); assert.equal((await audio()).playing, true);
    await select('mode', 2); assert.equal((await audio()).playing, false); await page.locator('#listen').click(); await page.waitForFunction(() => window.soundLab.audioState().playing); near((await audio()).frequencyHz, 686);
    await page.locator('#play').click(); await hidden(); assert.equal((await audio()).playing, false); assert.equal((await state()).running, false);
    await page.locator('#listen').click(); await page.waitForFunction(() => window.soundLab.audioState().playing); const pending = page.waitForEvent('download'); await page.locator('#save-project').click(); await pending; assert.equal((await audio()).playing, false);
    await page.locator('#listen').click(); await page.waitForFunction(() => window.soundLab.audioState().playing); await page.waitForFunction(() => !window.soundLab.audioState().playing, undefined, { timeout: 5000 });
    assert.equal((await audio()).error, null);
  });

  await check('1024 and 390 pixel layouts keep all controls reachable and narrow-screen edits are effective', async () => {
    await dismissToast();
    for (const [width, height] of [[1600,1000],[1024,768],[390,844]]) {
      await page.setViewportSize({ width, height }); await paint(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, `horizontal overflow at ${width}`);
      for (const id of ['length','length-number','boundary','mode','play','phase','listen','probe','part-select','focus-part','save-project','open-project','help']) {
        const control = page.locator(`#${id}`); await control.scrollIntoViewIfNeeded(); assert.equal(await control.isVisible(), true, `${id} at ${width}`);
        const box = await control.boundingBox(); assert.ok(box.width > 0 && box.x >= -1 && box.x + box.width <= width + 1, `${id} clipped at ${width}`);
      }
      for (const name of ['length','cap','nodes']) assert.equal(await page.locator(`[data-lesson="${name}"]`).isVisible(), true);
      await page.screenshot({ path: path.join(output, `sound-${width}.png`), fullPage: true });
    }
    await length(.75); await select('boundary', 'closed-open'); await select('mode', 3); await frequency(343 * 5 / 3, .6); await phase(180); await probe(100);
    near((await state()).experiment.phaseRad, Math.PI); assert.equal((await state()).experiment.probeRatio, 1);
    await page.locator('#help').click(); assert.equal(await page.locator('#help-dialog').isVisible(), true); await page.locator('#close-help').click();
  });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.locator('#new-project').click(); await dismissToast(); await page.locator('[data-camera="iso"]').click(); await page.evaluate(() => scrollTo(0, 0)); await paint();
  await page.screenshot({ path: path.join(output, 'sound-default-viewport.png') }); await page.screenshot({ path: path.join(output, 'sound-default-full.png'), fullPage: true });
  await select('boundary', 'closed-open'); await page.locator('[data-camera="cap"]').click(); await page.locator('#scene').scrollIntoViewIfNeeded(); await paint(); await page.locator('#scene').screenshot({ path: path.join(output, 'sound-cap-interior.png') });
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error; console.error(error.stack); await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'FAILED' : 'PASSED', failure: failure?.stack, checks, gpu, offlineAudio, errors, externalRequests }, null, 2));
  await context?.close(); await browser?.close(); await server.close();
}
if (failure) process.exitCode = 1;

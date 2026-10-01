import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/consumer');
const hardware = process.env.SOUND_BROWSER_HARDWARE === '1';
const checks = [], errors = [], externalRequests = [], evidence = [];
let server, browser, page, gpu, failure;
const state = () => page.evaluate(() => window.soundLab.getState());
const project = () => page.evaluate(() => window.soundLab.project());
const debug = () => page.evaluate(() => window.soundLab.sceneDebug());
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} (tolerance ${tolerance})`);
const check = async (name, action) => { await action(); checks.push(name); console.log(`PASS ${name}`); };
const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
async function dismissToast() { if (await page.locator('#toast').isVisible()) await page.locator('#toast button').click(); }
async function length(value) {
  await page.locator('#length-number').fill(String(value));
  await page.locator('#length-number').press('Tab');
  assert.equal((await state()).experiment.config.lengthM, value);
}
async function feedback(expectedHz, mode, harmonic, boundary, lengthM) {
  const content = await page.locator('#condition-feedback').innerText();
  const frequency = await page.locator('#condition-frequency').innerText();
  const harmonicText = await page.locator('#condition-harmonic').innerText();
  const boundaryText = await page.locator('#condition-boundary').innerText();
  assert.match(frequency, /Hz/);
  near(Number(frequency.replaceAll(',', '').replace(/[^\d.\-]/g, '')), expectedHz, .051);
  assert.match(harmonicText, new RegExp(`${mode}\\s*번째 모드`));
  assert.match(harmonicText, new RegExp(`기본음의\\s*${harmonic}배`));
  if (harmonic > 1) assert.match(harmonicText, new RegExp(`${harmonic}차 고조파`));
  assert.ok(boundaryText.includes(boundary === 'open-open' ? '양끝 열림' : '왼쪽 막힘'));
  assert.ok(boundaryText.includes(`${lengthM.toFixed(2)} m`), boundaryText);
  assert.equal(frequency, await page.locator('#frequency').innerText(), 'local and top frequency differ');
  assert.equal(harmonicText, await page.locator('#harmonic').innerText(), 'local and top harmonic differ');
  near((await state()).snapshot.frequencyHz, expectedHz);
  return { content, frequency, harmonicText, boundaryText };
}
function sameCamera(actual, expected) {
  for (const key of ['position', 'target']) actual[key].forEach((value, index) => near(value, expected[key][index], 1e-9));
  near(actual.zoom ?? 1, expected.zoom ?? 1, 1e-12);
}
function sameProject(actual, expected) {
  assert.deepEqual(actual.experiment, expected.experiment);
  assert.deepEqual(actual.comparison, expected.comparison);
  assert.deepEqual(actual.observation.view, expected.observation.view);
  sameCamera(actual.observation.camera, expected.observation.camera);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of ['type', 'schemaVersion', 'modelVersion']) assert.equal(actual[key], expected[key]);
}
async function sameViewport(width) {
  const boxes = await page.evaluate(() => {
    const ids = ['length-number', 'length', 'boundary', 'mode', 'condition-feedback', 'condition-frequency', 'condition-harmonic', 'condition-boundary'];
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      boxes: ids.map(id => { const element = document.getElementById(id), r = element.getBoundingClientRect(), style = getComputedStyle(element); return { id, x: r.x, y: r.y, width: r.width, height: r.height, display: style.display, visibility: style.visibility }; }) };
  });
  assert.ok(boxes.scrollWidth <= width + 1, `horizontal overflow at ${width}`);
  for (const box of boxes.boxes) {
    assert.ok(box.width > 0 && box.height > 0 && box.display !== 'none' && box.visibility !== 'hidden', `${box.id} hidden at ${width}`);
    assert.ok(box.x >= -1 && box.x + box.width <= boxes.width + 1, `${box.id} horizontally clipped at ${width}`);
    assert.ok(box.y >= -1 && box.y + box.height <= boxes.height + 1, `${box.id} not alongside controls in viewport ${width}: ${JSON.stringify(box)}`);
  }
  return boxes;
}
async function capture(name, fullPage = false) {
  await paint(); await page.screenshot({ path: path.join(output, `${name}.png`), fullPage });
  evidence.push({ name, viewport: page.viewportSize(), experiment: (await state()).experiment,
    feedback: await page.locator('#condition-feedback').innerText() });
}

await fs.mkdir(output, { recursive: true });
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5242, strictPort: true, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true, ...(hardware ? { args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] } : {}) });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url()); });
  await page.goto('http://127.0.0.1:5242/'); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready);
  gpu = await page.locator('#scene canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: !!gl, renderer: gl?.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
  });
  assert.equal(gpu.webgl2, true); if (hardware) assert.match(gpu.renderer, /RTX 5080.*D3D11|D3D11.*RTX 5080/);

  await check('default local feedback gives actual Hz, harmonic and boundary without starting playback or idle rendering', async () => {
    assert.equal(await page.locator('#condition-feedback').getAttribute('aria-live'), 'polite');
    await feedback(343 / 1.2, 1, 1, 'open-open', .6);
    assert.equal((await state()).running, false); assert.equal(await page.evaluate(() => window.soundLab.audioState().playing), false);
    const before = await project(); await paint(); await page.waitForTimeout(150); const frame = (await debug()).renderFrame;
    await page.waitForTimeout(150); assert.deepEqual(await project(), before); assert.equal((await debug()).renderFrame, frame);
    await capture('sound-default-1600'); await capture('sound-default-full', true);
  });

  await check('390, 1280 and 1600 layouts keep changed frequency and condition controls in the same viewport', async () => {
    for (const [width, height] of [[390,844],[1280,720],[1600,1000]]) {
      const camera = (await project()).observation.camera;
      await page.setViewportSize({ width, height }); await paint(); sameCamera((await project()).observation.camera, camera);
      await page.locator('#condition-feedback').evaluate(element => element.closest('.control-card').scrollIntoView({ block: 'center' }));
      await length(.5); await select('boundary', 'open-open'); await select('mode', 1);
      await feedback(343, 1, 1, 'open-open', .5); await sameViewport(width);
      await length(1); await feedback(171.5, 1, 1, 'open-open', 1); await sameViewport(width);
      await select('boundary', 'closed-open'); await feedback(85.75, 1, 1, 'closed-open', 1); await sameViewport(width);
      await select('mode', 2); await feedback(257.25, 2, 3, 'closed-open', 1);
      evidence.push({ name: `condition-layout-${width}`, boxes: await sameViewport(width) });
      await capture(`condition-feedback-${width}`);
    }
  });

  await check('independent frequency tables update local feedback while preserving phase, probe, view, manual camera and saved comparison', async () => {
    await page.locator('[data-phase="90"]').click(); await page.locator('[data-probe="100"]').click();
    await page.locator('#pin-comparison').click();
    await page.locator('#scene').scrollIntoViewIfNeeded();
    const box = await page.locator('#scene canvas').boundingBox(), cameraBefore = (await project()).observation.camera;
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .65); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .55, box.y + box.height * .58, { steps: 10 }); await page.mouse.up(); await paint();
    assert.notDeepEqual((await project()).observation.camera, cameraBefore);
    const before = await project(); await length(.5);
    // Independent textbook values, intentionally not imported from the model under test.
    for (const [boundary, rows] of [
      ['open-open', [[1,343,1],[2,686,2],[3,1029,3]]],
      ['closed-open', [[1,171.5,1],[2,514.5,3],[3,857.5,5]]],
    ]) {
      await select('boundary', boundary);
      for (const [mode, hz, harmonic] of rows) {
        await select('mode', mode); await feedback(hz, mode, harmonic, boundary, .5);
        const actual = await project(); assert.equal(actual.experiment.phaseRad, before.experiment.phaseRad);
        assert.equal(actual.experiment.probeRatio, before.experiment.probeRatio);
        assert.deepEqual(actual.comparison, before.comparison); assert.deepEqual(actual.observation, before.observation);
      }
    }
  });

  await check('phase, probe, part selection and observation controls leave local sound conditions and the saved reference unchanged', async () => {
    const before = await project(), textBefore = await page.locator('#condition-feedback').innerText();
    await page.locator('[data-phase="180"]').click(); await page.locator('[data-probe="0"]').click(); await select('part-select', 'end-cap');
    for (const key of ['cutaway','pressure','particles','exploded','labels']) {
      const control = page.locator(`[data-view="${key}"]`), initial = await control.isChecked();
      await control.setChecked(!initial); assert.equal((await state()).view[key], !initial); await control.setChecked(initial);
    }
    const actual = await project(); assert.deepEqual(actual.experiment.config, before.experiment.config);
    assert.deepEqual(actual.comparison, before.comparison); assert.deepEqual(actual.observation.camera, before.observation.camera);
    assert.equal(await page.locator('#condition-feedback').innerText(), textBefore);
    assert.equal(actual.experiment.phaseRad, Math.PI); assert.equal(actual.experiment.probeRatio, 0);
    await page.locator('#part-action').click(); await feedback(1029, 3, 3, 'open-open', .5);
    assert.deepEqual((await project()).comparison, before.comparison);
  });

  await check('saved files, new experiment, undo and reload synchronize local feedback without changing stored observations', async () => {
    await select('boundary', 'closed-open'); await select('mode', 2); await length(.75);
    await page.locator('[data-phase="90"]').click(); await page.locator('[data-probe="100"]').click();
    await page.locator('[data-view="exploded"]').check(); const saved = await project();
    await feedback(343, 2, 3, 'closed-open', .75);
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click();
    const file = path.join(output, 'consumer-saved.sound.json'); await (await pending).saveAs(file);
    const originalBytes = await fs.readFile(file); assert.deepEqual(JSON.parse(originalBytes.toString('utf8')), saved);
    await page.locator('#new-project').click(); await feedback(343 / 1.2, 1, 1, 'open-open', .6);
    assert.equal((await state()).comparison, null); await dismissToast(); await page.locator('#undo-new').click();
    sameProject(await project(), saved); await feedback(343, 2, 3, 'closed-open', .75);
    await page.locator('#new-project').click();
    await page.locator('#project-file').setInputFiles({ name: 'consumer-bom.sound.json', mimeType: 'application/json', buffer: Buffer.concat([Buffer.from('\ufeff'), originalBytes]) });
    await page.waitForFunction(() => window.soundLab.getState().experiment.config.lengthM === .75);
    sameProject(await project(), saved); await feedback(343, 2, 3, 'closed-open', .75);
    await page.reload(); await page.waitForFunction(() => window.soundLab?.sceneDebug()?.ready);
    sameProject(await project(), saved); await feedback(343, 2, 3, 'closed-open', .75);
    assert.equal((await state()).running, false); assert.equal(await page.evaluate(() => window.soundLab.audioState().playing), false);
    assert.deepEqual(await fs.readFile(file), originalBytes);
  });

  await check('explicit selected-part focus returns from the narrow inspector to the actual scene and closes a prior notification', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await paint();
    const beforeSelect = await project(); await select('part-select', 'probe-tip');
    assert.deepEqual((await project()).observation.camera, beforeSelect.observation.camera);
    const pending = page.waitForEvent('download'); await page.locator('#save-project').click(); await pending;
    assert.equal(await page.locator('#toast').isVisible(), true);
    await page.locator('#focus-part').scrollIntoViewIfNeeded();
    const before = await project(), beforeBox = await page.locator('#scene').boundingBox();
    assert.ok(beforeBox.y + beforeBox.height <= 0, 'fixture must start with scene above the viewport');
    await page.locator('#focus-part').click(); await paint();
    const after = await project(), sceneBox = await page.locator('#scene').boundingBox();
    assert.ok(sceneBox.y >= -1 && sceneBox.y + sceneBox.height <= 845, 'focused scene is not visible');
    assert.equal(await page.locator('#toast').isVisible(), false);
    assert.notDeepEqual(after.observation.camera, before.observation.camera);
    assert.deepEqual(after.experiment, before.experiment); assert.deepEqual(after.comparison, before.comparison);
    assert.deepEqual(after.observation.view, before.observation.view);
    await feedback(343, 2, 3, 'closed-open', .75); await capture('focused-part-390');
  });

  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
} catch (error) {
  failure = error; console.error(error.stack);
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ status: failure ? 'FAILED' : 'PASSED', failure: failure?.stack, checks, gpu, evidence, errors, externalRequests }, null, 2));
  await browser?.close(); await server?.close();
}
if (failure) process.exitCode = 1;

import test from 'node:test';
import assert from 'node:assert/strict';
import { createToneGraph, TonePlayer, TONE_DURATION_S, TONE_GAIN } from '../src/audio.js';
function context() {
  const events = [], parameter = name => Object.fromEntries(['setValueAtTime','linearRampToValueAtTime','cancelScheduledValues'].map(method => [method, (...args) => events.push([name, method, ...args])]));
  const nodes = [];
  return { events, nodes, currentTime: 5, sampleRate: 48000, destination: {}, resume: async () => {}, close: async () => {},
    createOscillator() { const value = { frequency: parameter('frequency'), connect() {}, disconnect() {}, start: t => events.push(['start', t]), stop: t => events.push(['stop', t]) }; nodes.push(value); return value; },
    createGain() { return { gain: parameter('gain'), connect() {}, disconnect() {} }; } };
}
test('pure tone has bounded digital amplitude, exact frequency, finite duration and quiet endpoints', () => {
  const ctx = context(), graph = createToneGraph(ctx, 343);
  assert.equal(graph.oscillator.type, 'sine'); assert.equal(graph.endTime - graph.startTime, 2);
  assert.ok(ctx.events.some(e => e[0] === 'frequency' && e[2] === 343));
  const levels = ctx.events.filter(e => e[0] === 'gain' && e[1] !== 'cancelScheduledValues').map(e => e[2]);
  assert.equal(levels[0], 0); assert.equal(levels.at(-1), 0); assert.ok(levels.every(n => n >= 0 && n <= .025));
  assert.equal(TONE_DURATION_S, 2); assert.equal(TONE_GAIN, .025);
});
test('explicit cancellation ends within ten milliseconds even during the attack', () => {
  const ctx = context(), graph = createToneGraph(ctx, 171.5); ctx.currentTime += .005; graph.stop();
  assert.ok(ctx.events.at(-1)[1] <= 5.016); assert.ok(ctx.events.some(e => e[1] === 'cancelScheduledValues'));
});
test('invalid frequency fails before creating nodes', () => {
  for (const hz of [0,-1,NaN,Infinity,'343',24000]) { const ctx = context(); assert.throws(() => createToneGraph(ctx, hz), RangeError); assert.equal(ctx.nodes.length, 0); }
});
test('a condition change during pending permission/resume never starts delayed audio', async () => {
  const ctx = context(); let resume; ctx.resume = () => new Promise(resolve => { resume = resolve; });
  const player = new TonePlayer({ createContext: () => ctx }), pending = player.play(343);
  assert.equal(player.getState().pending, true); player.stop(); resume(); assert.equal(await pending, false);
  assert.equal(ctx.nodes.length, 0); assert.equal(player.getState().playing, false); player.dispose();
});
test('completion and an unavailable audio device leave a reusable non-playing state', async () => {
  const ctx = context(), player = new TonePlayer({ createContext: () => ctx });
  assert.equal(await player.play(343), true); ctx.nodes[0].onended(); assert.equal(player.getState().playing, false);
  assert.equal(await player.play(514.5), true); player.stop(); assert.equal(player.getState().frequencyHz, null); player.dispose();
  const missing = new TonePlayer({ createContext() { throw new Error('unavailable'); } });
  assert.equal(await missing.play(343), false); assert.match(missing.getState().error, /화면 실험/); missing.dispose();
});

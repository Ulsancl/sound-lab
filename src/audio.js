export const TONE_DURATION_S = 2;
export const TONE_GAIN = .025;
export const ATTACK_S = .03;
export const RELEASE_S = .05;

/** Shared by live and OfflineAudioContext verification. Gain is digital, not a predicted SPL. */
export function createToneGraph(context, frequencyHz, { onEnded = () => {} } = {}) {
  if (typeof frequencyHz !== 'number' || !Number.isFinite(frequencyHz) || frequencyHz <= 0 || frequencyHz >= context.sampleRate / 2) throw new RangeError('유효한 음높이가 필요합니다.');
  const startTime = context.currentTime, endTime = startTime + TONE_DURATION_S;
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequencyHz, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(TONE_GAIN, startTime + ATTACK_S);
  gain.gain.setValueAtTime(TONE_GAIN, endTime - RELEASE_S);
  gain.gain.linearRampToValueAtTime(0, endTime);
  oscillator.connect(gain); gain.connect(context.destination);
  let ended = false;
  oscillator.onended = () => { if (ended) return; ended = true; oscillator.disconnect(); gain.disconnect(); onEnded(); };
  oscillator.start(startTime); oscillator.stop(endTime);
  return { oscillator, gain, startTime, endTime, frequencyHz,
    stop() {
      if (ended) return;
      const now = context.currentTime;
      // Cancel future envelope points, fade from the bounded current level and stop.
      const elapsed = Math.max(0, now - startTime);
      const level = elapsed < ATTACK_S ? TONE_GAIN * elapsed / ATTACK_S : elapsed > TONE_DURATION_S - RELEASE_S ? TONE_GAIN * Math.max(0, (TONE_DURATION_S - elapsed) / RELEASE_S) : TONE_GAIN;
      gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(level, now); gain.gain.linearRampToValueAtTime(0, now + .01);
      oscillator.stop(Math.min(endTime, now + .01));
    } };
}

export class TonePlayer {
  constructor({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(), onChange = () => {} } = {}) {
    this.createContext = createContext; this.onChange = onChange; this.context = null; this.graph = null; this.generation = 0; this.disposed = false;
    this.state = { playing: false, pending: false, frequencyHz: null, error: null };
  }
  report(patch) { Object.assign(this.state, patch); this.onChange(this.getState()); }
  getState() { return { ...this.state }; }
  async play(frequencyHz) {
    if (this.disposed) return false;
    this.stop(); const generation = this.generation;
    this.report({ pending: true, error: null });
    try {
      this.context ??= this.createContext();
      await this.context.resume();
      if (this.disposed || generation !== this.generation) return false;
      this.graph = createToneGraph(this.context, frequencyHz, { onEnded: () => {
        if (generation !== this.generation) return;
        this.graph = null; this.report({ playing: false, pending: false, frequencyHz: null });
      } });
      this.report({ playing: true, pending: false, frequencyHz }); return true;
    } catch (error) {
      if (generation === this.generation) this.report({ playing: false, pending: false, frequencyHz: null, error: '소리 예시를 사용할 수 없습니다. 화면 실험은 계속할 수 있습니다.' });
      return false;
    }
  }
  stop() {
    this.generation += 1;
    const graph = this.graph; this.graph = null;
    if (graph) graph.stop();
    this.report({ playing: false, pending: false, frequencyHz: null });
  }
  dispose() { this.stop(); this.disposed = true; this.context?.close().catch(() => {}); }
}

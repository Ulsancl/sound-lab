const ns = 'http://www.w3.org/2000/svg';
function element(name, attributes = {}, text = null) { const el = document.createElementNS(ns, name); for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value); if (text !== null) el.textContent = text; return el; }
const number = value => Math.abs(value) < .0005 ? '0' : value.toFixed(3);
export class WaveChart {
  constructor(container, frequencyContainer) { this.container = container; this.frequencyContainer = frequencyContainer; this.debug = null; }
  update(snapshot, saved = null, display = 'both') {
    const width = Math.max(300, this.container.clientWidth), height = 280, left = 43, right = width - 20, x = ratio => left + ratio * (right - left), centers = [75, 194], scale = 39;
    const svg = element('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '상대 위치 x/L의 압력과 입자 변위. 각 세로축 -1에서 +1.' });
    const add = (name, attrs, text) => svg.append(element(name, attrs, text));
    const currentVisible = !saved || display !== 'saved', savedVisible = saved && display !== 'current';
    for (const [index, quantity] of ['pressure', 'displacement'].entries()) {
      const center = centers[index], color = index === 0 ? '#65d8e4' : '#f2b971';
      add('text', { x: 7, y: center - 54, fill: color, 'font-size': 11 }, index === 0 ? '상대 압력' : '상대 변위');
      for (const value of [-1,0,1]) { const y = center - scale * value; add('line', { x1: left, y1: y, x2: right, y2: y, stroke: value === 0 ? '#607982' : '#314751', 'stroke-width': 1 }); add('text', { x: left - 8, y: y + 4, fill: '#a8bdc5', 'font-size': 10, 'text-anchor': 'end' }, String(value)); }
      const path = (source, field) => source.samples.map((sample, i) => `${i ? 'L' : 'M'}${x(sample.positionRatio).toFixed(2)},${(center - scale * sample[field]).toFixed(2)}`).join(' ');
      if (currentVisible) {
        for (const sign of [1,-1]) { const d = snapshot.samples.map((sample, i) => `${i ? 'L' : 'M'}${x(sample.positionRatio).toFixed(2)},${(center - scale * sign * sample[quantity + 'Envelope']).toFixed(2)}`).join(' '); add('path', { d, fill: 'none', stroke: color, 'stroke-width': 1, 'stroke-dasharray': '2 4', opacity: .48 }); }
        add('path', { d: path(snapshot, quantity + 'Relative'), fill: 'none', stroke: color, 'stroke-width': 2.4 });
        for (const ratio of snapshot.nodes[quantity + 'Ratios']) add('circle', { cx: x(ratio), cy: center, r: 4, stroke: color, fill: '#182930', 'stroke-width': 1.8 });
        add('line', { x1: x(snapshot.probeRatio), y1: center - scale - 3, x2: x(snapshot.probeRatio), y2: center + scale + 3, stroke: '#b3d1d9', 'stroke-dasharray': '3 4', opacity: .6 });
        add('circle', { cx: x(snapshot.probeRatio), cy: center - scale * snapshot.probe[quantity + 'Relative'], r: 4, fill: color });
      }
      if (savedVisible) { const d = path(saved, quantity + 'Relative'); add('path', { d, fill: 'none', stroke: '#10212a', 'stroke-width': 5, 'stroke-dasharray': '7 5' }); add('path', { d, fill: 'none', stroke: '#e49ccd', 'stroke-width': 2, 'stroke-dasharray': '7 5' }); const px = x(saved.probeRatio), py = center - scale * saved.probe[quantity + 'Relative']; add('path', { d: `M${px},${py-5}L${px+5},${py}L${px},${py+5}L${px-5},${py}Z`, fill: '#182930', stroke: '#e49ccd', 'stroke-width': 1.6 }); }
      for (const ratio of [0,.25,.5,.75,1]) add('text', { x: x(ratio), y: center + 55, fill: '#9cb1bb', 'font-size': 10, 'text-anchor': 'middle' }, `${ratio}`);
    }
    add('text', { x: (left + right) / 2, y: 278, fill: '#aac4cf', 'font-size': 10, 'text-anchor': 'middle' }, '관 안의 상대 위치 x/L');
    this.container.replaceChildren(svg);
    this.debug = { display, xDomain: [0,1], yDomains: [[-1,1],[-1,1]], currentVisible, savedVisible: Boolean(savedVisible), current: { frequencyHz: snapshot.frequencyHz, lengthM: snapshot.config.lengthM, phaseRad: snapshot.phaseRad, probeRatio: snapshot.probeRatio, probePressure: number(snapshot.probe.pressureRelative) }, saved: saved ? { frequencyHz: saved.frequencyHz, lengthM: saved.config.lengthM, phaseRad: saved.phaseRad, probeRatio: saved.probeRatio } : null };
    if (saved) this.drawFrequencies(snapshot, saved); else this.frequencyContainer.replaceChildren();
  }
  drawFrequencies(current, saved) {
    const width = Math.max(280, this.frequencyContainer.clientWidth), left = 39, right = width - 83, length = right - left, svg = element('svg', { viewBox: `0 0 ${width} 92` });
    for (const [index, sample] of [current, saved].entries()) { const y = 20 + index * 28, end = left + length * sample.frequencyHz / 1800;
      svg.append(element('text', { x: 0, y: y + 4, fill: '#bdd0d6', 'font-size': 11 }, index ? '보관' : '현재'), element('line', { x1: left, y1: y, x2: right, y2: y, stroke: '#30454e', 'stroke-width': 8 }), element('line', { x1: left, y1: y, x2: end, y2: y, stroke: index ? '#df9acc' : '#65d8e4', 'stroke-width': 8 }), element('text', { x: right + 8, y: y + 4, fill: '#dce9ed', 'font-size': 11 }, `${sample.frequencyHz.toFixed(1)} Hz`)); }
    for (const hz of [0,600,1200,1800]) svg.append(element('text', { x: left + length * hz / 1800, y: 78, fill: '#9cb1bb', 'font-size': 10, 'text-anchor': 'middle' }, String(hz)));
    this.frequencyContainer.replaceChildren(svg); this.debug.frequencyDomainHz = [0,1800];
  }
}

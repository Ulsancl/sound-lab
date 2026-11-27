import './chart.css';

const ns = 'http://www.w3.org/2000/svg';
const pressureColor = '#65d8e4';
const savedColor = '#e49ccd';
const frequencyMaximum = 1800;
const waveHeight = 399;
const scale = 39;
const rows = [
  { quantity: 'pressure', envelope: 'pressureEnvelope', nodes: 'pressureRatios', label: '상대 압력 p', color: pressureColor, center: 75, offset: 0 },
  // In a lossless eigenmode, particle velocity and displacement have the same spatial envelope.
  { quantity: 'velocity', envelope: 'displacementEnvelope', nodes: 'displacementRatios', label: '상대 입자 속도 u', color: '#b9c6ff', center: 194, offset: 0 },
  { quantity: 'displacement', envelope: 'displacementEnvelope', nodes: 'displacementRatios', label: '상대 입자 변위', color: '#f2b971', center: 194, offset: 119 },
];
const relativePosition = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 });
const frequency = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const frequencyRatio = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = value => Math.abs(value) < .0005 ? '0' : value.toFixed(3);
const shapeKey = ({ config }) => `${config.boundary}|${config.mode}`;
const nodePositionsKey = source => `${shapeKey(source)}|${source.config.lengthM}`;
const observationKey = source => `${source.phaseRad}|${source.probeRatio}`;

function element(name, attributes = {}, text = null) {
  const el = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== null) el.textContent = text;
  return el;
}

function append(parent, name, attributes, text) {
  const child = element(name, attributes, text);
  parent.append(child);
  return child;
}

function wavePath(samples, x, center, field, sign = 1) {
  return samples.map((sample, i) =>
    `${i ? 'L' : 'M'}${x(sample.positionRatio).toFixed(2)},${(center - scale * sign * sample[field]).toFixed(2)}`,
  ).join(' ');
}

function diamond(x, y) {
  return `M${x},${y - 5}L${x + 5},${y}L${x},${y + 5}L${x - 5},${y}Z`;
}

function drawAxes(svg, row, x) {
  const { quantity, label, color, center, offset } = row;
  const axis = append(svg, 'g', { 'data-wave-quantity': quantity, transform: `translate(0 ${offset})` });
  append(axis, 'text', { x: 8, y: center - 50, class: 'wave-row-title', fill: color }, label);
  for (const ratio of [0, .25, .5, .75, 1]) {
    const px = x(ratio);
    append(axis, 'line', { x1: px, y1: center - scale, x2: px, y2: center + scale, class: 'wave-grid' });
    append(axis, 'text', { x: px, y: center + 55, class: 'wave-tick', 'text-anchor': 'middle' }, String(ratio));
  }
  for (const value of [-1, 0, 1]) {
    const y = center - scale * value;
    append(axis, 'line', { x1: x(0), y1: y, x2: x(1), y2: y, class: value === 0 ? 'wave-zero' : 'wave-grid' });
    append(axis, 'text', { x: x(0) - 8, y: y + 4, class: 'wave-tick', 'text-anchor': 'end' }, String(value));
  }
  return { ...row, current: append(axis, 'g', { 'data-wave-layer': 'current' }), saved: append(axis, 'g', { 'data-wave-layer': 'saved' }) };
}

function drawLayer(group, source, row, x, saved) {
  const { quantity, envelope, nodes, center } = row;
  const color = saved ? savedColor : row.color;
  group.replaceChildren();
  for (const sign of [1, -1]) {
    append(group, 'path', {
      d: wavePath(source.samples, x, center, envelope, sign), stroke: color,
      class: saved ? 'wave-envelope wave-envelope-saved' : 'wave-envelope',
      ...(saved ? { 'data-saved-envelope': quantity } : {}),
    });
  }
  const guide = saved ? null : append(group, 'line', { class: 'wave-probe-guide', y1: center - scale - 3, y2: center + scale + 3 });
  const underlay = saved ? append(group, 'path', { class: 'wave-saved-underlay' }) : null;
  const trace = append(group, 'path', {
    stroke: color, class: saved ? 'wave-trace wave-trace-saved' : 'wave-trace',
    [saved ? 'data-saved-wave' : 'data-current-wave']: quantity,
  });
  for (const ratio of source.nodes[nodes]) {
    const attrs = { stroke: color, class: 'wave-node', 'data-ratio': ratio };
    if (saved) append(group, 'rect', { ...attrs, x: x(ratio) - 3.5, y: center - 3.5, width: 7, height: 7, 'data-saved-node': quantity });
    else append(group, 'circle', { ...attrs, cx: x(ratio), cy: center, r: 4.5, 'data-current-node': quantity });
  }
  const marker = saved
    ? append(group, 'path', { class: 'wave-node', stroke: color, 'data-saved-probe': quantity })
    : append(group, 'circle', { r: 3.3, fill: color, class: 'wave-probe', 'data-current-probe': quantity });
  return { trace, underlay, guide, marker };
}

function updateTrace(layer, source, { quantity, center }, x) {
  const field = quantity + 'Relative';
  const d = wavePath(source.samples, x, center, field);
  const px = x(source.probeRatio), py = center - scale * source.probe[field];
  layer.trace.setAttribute('d', d);
  if (layer.guide) {
    layer.guide.setAttribute('x1', px);
    layer.guide.setAttribute('x2', px);
    layer.marker.setAttribute('cx', px);
    layer.marker.setAttribute('cy', py);
  } else {
    layer.underlay.setAttribute('d', d);
    layer.marker.setAttribute('d', diamond(px, py));
  }
}

function pressureNodeRow(source, kind) {
  const row = document.createElement('div');
  row.className = 'wave-node-row';
  row.dataset.condition = kind;
  const label = document.createElement('strong');
  const boundary = source.config.boundary === 'open-open' ? '양끝 열림' : '왼쪽 막힘';
  label.textContent = `${kind === 'current' ? '현재' : '보관'} · ${boundary} · ${source.config.mode}모드`;
  const list = document.createElement('ul');
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', '압력 마디의 상대 위치와 왼쪽 끝 기준 거리');
  for (const ratio of source.nodes.pressureRatios) {
    const item = document.createElement('li');
    const position = document.createElement('span');
    const distance = document.createElement('span');
    const meters = ratio * source.config.lengthM;
    position.textContent = relativePosition.format(ratio);
    distance.textContent = `${meters.toFixed(3)} m`;
    item.dataset.ratio = ratio;
    item.dataset.meters = meters;
    item.append(position, distance);
    list.append(item);
  }
  row.append(label, list);
  return row;
}

export class WaveChart {
  constructor(container, frequencyContainer) {
    this.container = container;
    this.frequencyContainer = frequencyContainer;
    this.debug = null;
    this.layers = {};
    this.plot = element('svg', {
      role: 'img', 'aria-label': '상대 위치 x/L의 압력, 입자 속도와 입자 변위. 각 세로축 -1에서 +1.',
    });
    this.nodeSummary = document.createElement('div');
    this.nodeSummary.className = 'wave-node-summary';
    this.nodeSummary.innerHTML = '<h3>압력 마디 위치</h3><p>상대 위치 x/L · 왼쪽 끝에서 잰 거리</p><div class="wave-node-rows"></div>';
    this.nodeRows = this.nodeSummary.querySelector('.wave-node-rows');
    container.replaceChildren(this.plot, this.nodeSummary);
    container.setAttribute('aria-label', '상대 압력, 입자 속도와 입자 변위 그래프');
    const card = container.closest('.chart-card');
    const title = card?.querySelector('h2');
    if (title) title.textContent = '압력과 입자 운동을 나란히';
    const pressureKey = card?.querySelector('.chart-legend .cyan');
    if (pressureKey) {
      const velocityKey = document.createElement('span');
      velocityKey.className = 'chart-velocity-key';
      velocityKey.textContent = '● 현재 속도';
      pressureKey.after(velocityKey);
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (this.latest) this.update(...this.latest);
    });
    this.resizeObserver.observe(container);
    this.resizeObserver.observe(frequencyContainer);
  }

  update(snapshot, saved = null, display = 'both') {
    this.latest = [snapshot, saved, display];
    const width = Math.max(260, this.container.clientWidth);
    const frequencyWidth = saved ? Math.max(250, this.frequencyContainer.clientWidth) : 0;
    if (width !== this.width) {
      this.width = width;
      this.x = ratio => 38 + ratio * (width - 55);
      this.plot.setAttribute('viewBox', `0 0 ${width} ${waveHeight}`);
      this.plot.replaceChildren();
      this.axes = rows.map(row => drawAxes(this.plot, row, this.x));
      append(this.plot, 'text', { x: this.x(.5), y: 392, class: 'wave-axis-title', 'text-anchor': 'middle' }, '관 안의 상대 위치 x/L');
      this.layers = {};
    }
    const currentVisible = !saved || display !== 'saved', savedVisible = Boolean(saved && display !== 'current');
    this.updateLayer('current', currentVisible ? snapshot : null);
    this.updateLayer('saved', savedVisible ? saved : null);
    const nodeKey = `${currentVisible ? nodePositionsKey(snapshot) : ''}/${savedVisible ? nodePositionsKey(saved) : ''}`;
    if (nodeKey !== this.nodeKey) {
      this.nodeKey = nodeKey;
      const items = [];
      if (currentVisible) items.push(pressureNodeRow(snapshot, 'current'));
      if (savedVisible) items.push(pressureNodeRow(saved, 'saved'));
      this.nodeRows.replaceChildren(...items);
    }

    this.debug = {
      display, xDomain: [0, 1], yDomains: [[-1, 1], [-1, 1]], currentVisible, savedVisible,
      velocityDomain: [-1, 1],
      current: { frequencyHz: snapshot.frequencyHz, lengthM: snapshot.config.lengthM, phaseRad: snapshot.phaseRad, probeRatio: snapshot.probeRatio, probePressure: number(snapshot.probe.pressureRelative), probeVelocity: number(snapshot.probe.velocityRelative) },
      saved: saved ? { frequencyHz: saved.frequencyHz, lengthM: saved.config.lengthM, phaseRad: saved.phaseRad, probeRatio: saved.probeRatio, probeVelocity: number(saved.probe.velocityRelative) } : null,
      envelopes: { current: currentVisible, saved: savedVisible },
      nodes: { current: currentVisible ? snapshot.nodes : null, saved: savedVisible ? saved.nodes : null },
    };
    const comparisonKey = saved ? `${frequencyWidth}|${snapshot.frequencyHz}|${saved.frequencyHz}` : '';
    if (comparisonKey !== this.comparisonKey) {
      this.comparisonKey = comparisonKey;
      if (saved) this.drawFrequencies(snapshot, saved, frequencyWidth);
      else this.frequencyContainer.replaceChildren();
    }
    if (saved) this.debug.frequencyDomainHz = [0, frequencyMaximum];
  }

  updateLayer(kind, source) {
    if (!source) {
      if (this.layers[kind]) {
        this.axes.forEach(row => row[kind].replaceChildren());
        delete this.layers[kind];
      }
      return;
    }
    const geometry = shapeKey(source), observation = observationKey(source);
    let layer = this.layers[kind];
    if (layer?.geometry !== geometry) {
      layer = { geometry, traces: this.axes.map(row => drawLayer(row[kind], source, row, this.x, kind === 'saved')) };
      this.layers[kind] = layer;
    }
    if (layer.observation === observation) return;
    layer.observation = observation;
    this.axes.forEach((row, index) => updateTrace(layer.traces[index], source, row, this.x));
  }

  drawFrequencies(current, saved, width) {
    const left = 39, right = width - 78;
    const x = hz => left + (right - left) * hz / frequencyMaximum;
    const svg = element('svg', {
      viewBox: `0 0 ${width} 86`, role: 'img',
      'aria-label': `동일한 0에서 1800 Hz 축. 현재 ${frequency.format(current.frequencyHz)} Hz, 보관 ${frequency.format(saved.frequencyHz)} Hz.`,
    });
    for (const [index, sample] of [current, saved].entries()) {
      const y = 19 + index * 26;
      append(svg, 'text', { x: 0, y: y + 4, class: 'wave-axis-title' }, index ? '보관' : '현재');
      append(svg, 'line', { x1: left, y1: y, x2: right, y2: y, stroke: '#30454e', 'stroke-width': 8 });
      append(svg, 'line', { x1: left, y1: y, x2: x(sample.frequencyHz), y2: y, stroke: index ? '#df9acc' : pressureColor, 'stroke-width': 8 });
      append(svg, 'text', { x: right + 8, y: y + 4, class: 'wave-frequency-value' }, `${frequency.format(sample.frequencyHz)} Hz`);
    }
    for (const hz of [0, 600, 1200, frequencyMaximum]) {
      append(svg, 'line', { x1: x(hz), y1: 58, x2: x(hz), y2: 62, class: 'wave-zero' });
      const label = hz === frequencyMaximum ? `${hz} Hz` : String(hz);
      append(svg, 'text', { x: x(hz), y: 75, class: 'wave-tick', 'text-anchor': 'middle' }, label);
    }
    const ratio = document.createElement('p');
    ratio.className = 'wave-frequency-ratio';
    ratio.textContent = `보관 대비 현재 주파수 ${frequencyRatio.format(current.frequencyHz / saved.frequencyHz)}배`;
    this.frequencyContainer.replaceChildren(svg, ratio);
  }
}

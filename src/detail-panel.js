import { soundDetail, describeSoundDetail } from './detail-model.js';

const number = (value, digits = 3) => typeof value !== 'number' ? String(value)
  : value !== 0 && Math.abs(value) < .5 * 10 ** -digits ? value.toExponential(2)
    : value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const point = (x, y) => `${(110 + 63 * x).toFixed(3)},${(88 - 63 * y).toFixed(3)}`;

export class SoundDetailPanel {
  constructor(root, facts, note, { onPhase, onProbe }) {
    this.root = root; this.facts = facts; this.note = note; this.onProbe = onProbe; this.nodesKey = null;
    root.innerHTML = `<div class="section-head"><div><span class="eyebrow">03 / 한 위치에서 한 주기까지</span><h2 id="sound-detail-title">압력이 0일 때 공기도 멈출까요?</h2></div><span class="badge">정규화 관찰</span></div>
      <p class="muted">같은 탐침에서 압력과 입자 속도는 서로 다른 순간에 가장 커집니다. 위상을 바꾸며 순간값과 한 주기의 크기를 구분하세요.</p>
      <div class="phase-observation"><figure class="phase-portrait"><svg viewBox="0 0 220 184" role="img" aria-label="가로축 상대 압력, 세로축 상대 속도. 한 탐침의 한 주기 궤적과 현재 위상."><path d="M38 88H182M110 160V16" fill="none" stroke="#476370"/><text x="186" y="92">p</text><text x="115" y="17">u</text><text x="30" y="102">−1</text><text x="172" y="102">+1</text><text x="115" y="30">+1</text><text x="115" y="155">−1</text><path id="probe-phase-orbit" fill="none" stroke="#8dbbc4" stroke-width="2"/><line id="probe-phase-radius" x1="110" y1="88" stroke="#4c7886" stroke-dasharray="3 3"/><circle id="probe-phase-point" r="5" fill="#f2cc91" stroke="#182930" stroke-width="2"/></svg><figcaption id="phase-portrait-caption"></figcaption><div class="phase-presets">${[0,90,180,270].map(phase => `<button type="button" data-detail-phase="${phase}">${phase}°</button>`).join('')}</div></figure>
      <div class="amplitude-table"><table><caption>현재 탐침 · 모드 전체의 물리량별 최대 진폭을 1로 정규화</caption><thead><tr><th scope="col">물리량</th><th scope="col">순간</th><th scope="col">진폭</th><th scope="col">주기 RMS</th></tr></thead><tbody>${[
        ['압력','pressureRelative','pressureEnvelope','pressureRmsRelative'],
        ['변위','displacementRelative','displacementEnvelope','displacementRmsRelative'],
        ['속도','velocityRelative','velocityEnvelope','velocityRmsRelative'],
      ].map(([label,...keys]) => `<tr><th scope="row">${label}</th>${keys.map(key => `<td data-detail-value="probe.${key}"></td>`).join('')}</tr>`).join('')}</tbody></table><p>RMS는 한 주기의 제곱평균을 제곱근한 값입니다. 순간값 0과 진폭 0인 마디는 다릅니다. 압력·변위·속도의 같은 숫자는 같은 물리 단위를 뜻하지 않습니다.</p><p id="detail-clock"></p></div></div>
      <div class="sound-energy"><div class="energy-heading"><strong>관 전체에 남아 있는 에너지의 형태</strong><span id="whole-energy-total"></span></div><div class="sound-energy-bar" aria-hidden="true"><i id="compression-share"></i><i id="kinetic-share"></i></div><div class="energy-key"><span>압축 <b id="whole-compression"></b></span><span>입자 운동 <b id="whole-kinetic"></b></span></div><p>한 고유모드의 손실 없는 관 전체를 적분한 비율입니다. 한쪽 끝으로 에너지가 계속 빠져나가는 비율이 아닙니다.</p></div>
      <details class="sound-local-energy"><summary>이 탐침의 에너지와 순간 전달</summary><dl class="detail-values"><div><dt>압축 에너지 계수 p²</dt><dd data-detail-value="energy.probeCompression"></dd></div><div><dt>운동 에너지 계수 u²</dt><dd data-detail-value="energy.probeKinetic"></dd></div><div><dt>한 주기 평균 합계</dt><dd data-detail-value="energy.cycleTotal"></dd></div><div><dt>순간 전달 계수 p·u</dt><dd data-detail-value="flux.instantaneousRelative"></dd></div></dl><p>모두 무차원 계수입니다. 에너지 밀도는 p₀²/(2ρc²), 전달은 p₀²/(ρc)로 나눈 서로 다른 기준입니다. 실제 진폭과 공기 밀도를 입력하지 않으므로 J·W·음압을 예측하지 않습니다. 순간 전달의 양수는 오른쪽, 음수는 왼쪽이며 한 주기 평균은 0입니다.</p></details>
      <details class="sound-nodes"><summary>움직이지 않는 마디를 정확히 찾아보기</summary><p>버튼을 누르면 해당 해석 좌표로 탐침만 이동합니다. 위상이 바뀌어도 마디 위치는 고정입니다.</p><div id="pressure-node-list" class="node-button-list"></div><div id="motion-node-list" class="node-button-list"></div><p id="nearest-node-reading"></p></details>`;
    root.querySelectorAll('[data-detail-phase]').forEach(button => button.addEventListener('click', () => onPhase(Number(button.dataset.detailPhase))));
  }
  render(snapshot, partId) {
    const d = soundDetail(snapshot);
    this.root.querySelectorAll('[data-detail-value]').forEach(element => {
      const [group, key] = element.dataset.detailValue.split('.'), value = d[group][key];
      element.textContent = number(value); element.dataset.raw = String(value);
    });
    const probe = snapshot.probe;
    const orbit = Array.from({ length: 97 }, (_, i) => { const phase = i / 96 * Math.PI * 2; return `${i ? 'L' : 'M'}${point(probe.pressureShape * Math.cos(phase), -probe.displacementShape * Math.sin(phase))}`; }).join(' ');
    this.root.querySelector('#probe-phase-orbit').setAttribute('d', orbit);
    const [x, y] = point(probe.pressureRelative, probe.velocityRelative).split(',');
    const marker = this.root.querySelector('#probe-phase-point'); marker.setAttribute('cx', x); marker.setAttribute('cy', y); marker.dataset.pressure = probe.pressureRelative; marker.dataset.velocity = probe.velocityRelative;
    const radius = this.root.querySelector('#probe-phase-radius'); radius.setAttribute('x2', x); radius.setAttribute('y2', y);
    this.root.querySelector('#phase-portrait-caption').textContent = `탐침 x/L=${number(d.probe.positionRatio, 4)} · 현재 ${number(d.mode.phaseFraction * 360, 1)}°`;
    this.root.querySelector('#detail-clock').textContent = `실제 한 주기 ${number(d.mode.periodS * 1000)} ms를 화면 2초로 관찰합니다(${number(d.mode.slowdownRatio, 1)}배 느림). 현재 주기 안의 실제 위상 위치는 ${number(d.mode.realPhaseTimeS * 1000)} ms이며 누적 경과시간이 아닙니다.`;
    for (const [id, value] of [['compression', d.energy.wholeCompressionFraction], ['kinetic', d.energy.wholeKineticFraction]]) {
      this.root.querySelector(`#${id}-share`).style.width = `${100 * value}%`;
      this.root.querySelector(`#${id}-share`).dataset.raw = String(value);
      this.root.querySelector(`#whole-${id}`).textContent = `${number(value * 100, 1)}%`;
    }
    this.root.querySelector('#whole-energy-total').textContent = `전체 ${number(100 * d.energy.wholeTotalFraction, 1)}%`;
    const nodesKey = `${snapshot.config.lengthM}|${snapshot.config.boundary}|${snapshot.config.mode}`;
    if (nodesKey !== this.nodesKey) {
      this.nodesKey = nodesKey;
      for (const [id, label, nodes] of [['pressure','압력 마디',d.positions.pressureNodes],['motion','변위·속도 마디',d.positions.motionNodes]]) {
        const heading = document.createElement('strong'); heading.textContent = label;
        this.root.querySelector(`#${id}-node-list`).replaceChildren(heading, ...nodes.map(node => {
          const button = document.createElement('button'); button.type = 'button'; button.dataset.nodeRatio = String(node.ratio); button.dataset.nodeKind = id;
          button.textContent = `x/L ${number(node.ratio, 4)} · ${number(node.xM * 1000, 1)} mm`;
          button.addEventListener('click', () => this.onProbe(node.ratio)); return button;
        }));
      }
    }
    this.root.querySelectorAll('[data-node-ratio]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.nodeRatio) === snapshot.probeRatio)));
    this.root.querySelector('#nearest-node-reading').textContent = `가까운 압력 마디까지 ${number(d.probe.nearestPressureNode.distanceM * 1000, 4)} mm · 변위·속도 마디까지 ${number(d.probe.nearestMotionNode.distanceM * 1000, 4)} mm. 표시는 반올림하며 마디 판정은 해석 좌표와 정확히 일치할 때만 합니다.`;
    const description = describeSoundDetail(partId, snapshot, d);
    this.facts.replaceChildren(...description.facts.map(fact => {
      const row = document.createElement('div'), term = document.createElement('dt'), value = document.createElement('dd');
      term.textContent = fact.label; value.textContent = `${number(fact.value, fact.digits)}${fact.unit ? ` ${fact.unit}` : ''}`; value.dataset.raw = String(fact.value); row.append(term, value); return row;
    }));
    this.note.textContent = description.note;
    return d;
  }
}

# Sound Lab 상세 계측

상세 계측은 기존 `sound-standing-wave-1`의 해석값을 읽는다. 새로운 음향 해석기·시간 적분·감쇠·구동원·실제 진폭을 추가하지 않는다. 저장 형식은 그대로이며, 상세값은 파일에 저장하지 않고 현재 조건·위상·탐침 위치에서 다시 계산한다.

## 순간값, 진폭, RMS

기존 모형의 공간형상을 P, D, 위상을 φ라 하면 상대 압력 p=P cosφ, 상대 변위 ξ=D cosφ, 상대 속도 u=−D sinφ이다. 각 값은 서로 다른 물리 진폭을 기준으로 정규화했다. 여기서 p, ξ, u는 무차원이며 Pa·m·m/s가 아니다.

- 진폭 포락선은 압력 |P|, 변위·속도 |D|이다.
- 한 주기 RMS는 압력 |P|/√2, 변위·속도 |D|/√2이다. 현재 순간값의 절댓값과 다르다.
- 정규화 가속도는 a=−D cosφ=−ξ이다. 가속도의 기준 진폭은 ω²ξ₀=ωu₀이며 실제 m/s² 값이 아니다.
- 압력과 속도는 진폭이 0이 아닌 위치에서 1/4주기 차이다. 변위와 가속도는 반대 위상이다. 진폭이 0인 마디에서 그 물리량의 시간 위상을 정의하지 않는다.

예를 들어 열린 관 첫 모드의 x/L=1/4, φ=45°에서 p=ξ=0.5, u=a=−0.5이고 압력·변위·속도 RMS는 모두 0.5다. 상대값이 같더라도 같은 물리량이나 같은 단위를 뜻하지 않는다.

RMS의 정의와 순간 음향 전달 `I=p_physical u_physical`의 근거는 [UNSW Physclips: acoustic impedance and intensity](https://www.animations.physics.unsw.edu.au/jw/sound-impedance-intensity.htm)를 참조한다. 진행파의 `I=p²/(ρc)` 관계를 이 정상파의 국소 압력에 그대로 적용하지 않는다.

## 마디·배와 가까운 위치

압력 마디와 운동 마디는 기존 `solveMode`의 해석 좌표를 사용한다. 압력 마디는 운동 배, 운동 마디는 압력 배다. 여기서 운동은 변위·속도·가속도의 공간 진폭을 뜻한다.

정확한 판정은 탐침 x/L이 해당 해석 좌표와 일치하는지 검사한다. 순간값이 0인지, 반올림한 진폭이 0 또는 1인지로 마디·배를 정하지 않는다. 예를 들어 열린 첫 모드의 x/L=10⁻⁹는 압력 마디 근처지만 마디가 아니다. 부동소수점 cos가 운동 진폭을 1로 반올림하더라도 운동 배로 분류하지 않는다.

최근접 마디·배는 관 안의 해석 위치 중에서 선택한다. 좌표 x는 왼쪽 끝을 0으로 하고, 거리는 `L |r−r_node|`로 구한다. 같은 거리인 위치 사이에서는 왼쪽을 선택한다. 같은 종류의 마디 반복 간격 λ/2와 인접 마디·배 간격 λ/4를 제공하지만, 관 밖의 주기적 위치를 관내 마디 수에 포함하지 않는다.

## 에너지와 전달의 정규화 기준

실제 압력 진폭 p₀와 밀도 ρ를 **기호로만** 도입하면 기존 모형의 진폭 관계는 u₀=p₀/(ρc), ξ₀=u₀/ω다. 앱은 이 진폭이나 밀도를 측정·설정하지 않는다. 다음 값은 특정한 공통 기준으로 나눈 계수이다.

| 상세값 | 계산 | 정규화 기준과 의미 |
| --- | --- | --- |
| 탐침 압축 에너지 계수 | p² | 에너지 밀도 기준 E₀=p₀²/(2ρc²) |
| 탐침 운동 에너지 계수 | u² | 같은 E₀ 기준 |
| 탐침 전체 에너지 계수 | p²+u² | 현재 위치·위상의 국소 합, 0–1 |
| 압축·운동 계수의 주기 평균 | P²/2, D²/2 | 완전한 한 주기 평균 |
| 전체 계수의 주기 평균 | 1/2 | 이 모형에서 모든 위치에 동일 |
| 관 전체 압축·운동 에너지 비율 | cos²φ, sin²φ | 관 안의 일정한 전체 에너지로 각각 나눈 비율 |
| 순간 전달 계수 j | p u | 전달 기준 I₀=p₀²/(ρc)=2cE₀ |
| 주기 평균 전달 계수 | 0 | 반대 방향의 동일 진폭 진행파가 만드는 이상적 정상파 |

에너지 계수와 전달 계수는 서로 다른 기준이다. 이를 J·W로 표시하거나 같은 단위처럼 더하지 않는다. 전달의 양수는 +x(오른쪽), 음수는 −x(왼쪽)이다. 가능한 순간 전달 범위는 −1/4…+1/4이며 평균 0이라고 매 순간의 내부 전달까지 0인 것은 아니다.

관 전체 에너지의 압축·운동 비율은 항상 합이 1이다. 탐침 국소 에너지는 0이 될 수 있다. 예를 들어 열린 첫 모드의 중앙은 압력 배·운동 마디이므로 φ=90°에서 국소 두 계수 모두 0이지만, 관 전체는 운동 에너지를 가진다. 국소 순간값과 전체 공간 적분을 구분해야 한다.

이 계수들의 국소 보존식은 `∂e/∂φ + (2/k) ∂j/∂x = 0`이다. e=p²+u²이며 서로 다른 기준 때문에 2가 필요하다. 열린 끝에서는 p=0, 막힌 끝에서는 u=0이어서 양 끝의 j는 0이다. 실제 관의 끝단 방사·열·점성 손실은 이 식의 계산 범위에 없다.

보존 관계는 **고정한 조건과 진폭 기준의 한 모드 안에서** 성립한다. 길이·경계·모드 변경은 별도의 고유모드를 선택한다. 그 사이의 물리적 에너지 변화·구동 일이 계산되었다고 해석할 수 없다. 실제 J·W·dB, 감쇠 시간·Q값·공명 폭을 추가하지 않는다.

## 실제 시간과 화면 시간

실제 각주파수는 ω=2πf=ck다. 화면은 기존과 같이 한 주기를 2초에 보여준다. `slowdownRatio=2/T`는 화면 한 주기와 실제 주기의 비이며 화면의 느린 움직임을 실제 입자 속도로 변환하는 계수가 아니다.

`realPhaseTimeS=(φ/2π)T`와 `displayPhaseTimeS=(φ/2π)2`는 각각 **현재 한 주기 안의 위치**이다. 누적 경과시간·녹음 시각·새 시간 이력이 아니다. 2π에서 다시 0으로 돌아간다. 일시정지는 관찰 위상을 고정할 뿐 f·RMS·모드의 물리 관계를 바꾸지 않는다.

기존 오디오는 계산한 Hz의 별도 2초 순음이다. 디지털 gain 0.025와 시작·끝 완화는 재생 설정이며 예측 음압이 아니다. 탐침 마디에 놓거나 관찰 위상을 바꾸어도 음량을 그 위치의 물리 소리처럼 조절하지 않는다. 실제 고유모드와 열린/막힌 경계의 관계는 [OpenStax: Normal Modes of a Standing Sound Wave](https://openstax.org/books/university-physics-volume-1/pages/17-4-normal-modes-of-a-standing-sound-wave)를 참조한다.

## API와 구조 읽기값

`src/detail-model.js`는 두 순수 함수를 내보낸다.

```js
soundDetail(snapshot)
describeSoundDetail(partId, snapshot, detail = soundDetail(snapshot))
// -> { facts: [{ label, value, unit, digits }], note }
```

`soundDetail`은 config, phaseRad, probeRatio, 모드 수치, 해석 마디, 독립 탐침 값이 기존 모델과 일치하는지 검사한다. 잘못된 상태를 정규화하거나 고치지 않는다. 렌더링용 samples를 보간하거나 다시 검사하지 않으므로 표본 수가 2든 513이든 같은 결과를 얻는다. 입력을 수정하지 않고, 반환 위치 배열과 최근접 위치 객체도 입력 및 다른 배열과 분리된다.

| 그룹 | 필드 |
| --- | --- |
| `mode` | frequencyHz, wavelengthM, periodS, omegaRadPerS, waveNumberRadPerM, harmonic, quarterWavelengthM, halfWavelengthM, phaseFraction, realPhaseTimeS, displayPeriodS, displayPhaseTimeS, slowdownRatio |
| `probe` | positionRatio, xM, pressureRelative, displacementRelative, velocityRelative, accelerationRelative, pressureEnvelope, displacementEnvelope, velocityEnvelope, pressureRmsRelative, displacementRmsRelative, velocityRmsRelative, accelerationRmsRelative, pressureIsNode, motionIsNode, pressureIsAntinode, motionIsAntinode, nearestPressureNode, nearestMotionNode, nearestPressureAntinode, nearestMotionAntinode |
| `positions` | pressureNodes, pressureAntinodes, motionNodes, motionAntinodes |
| `energy` | probeCompression, probeKinetic, probeTotal, cycleCompression, cycleKinetic, cycleTotal, wholeCompressionFraction, wholeKineticFraction, wholeTotalFraction |
| `flux` | instantaneousRelative, cycleMeanRelative |

위치 배열 항목은 `{ratio,xM}`, 최근접 항목은 `{ratio,xM,distanceM}`이다. `describeSoundDetail`에 미리 계산한 detail을 넘기는 경우 같은 snapshot의 결과여야 한다.

14개 실제·가상 부품마다 최대 6개 사실과 범위 설명을 제공한다. 구조 치수는 기존 `GEOMETRY`와 `tubeLayout`에서 읽어 m→mm, m²→mm²로 변환한다. 관 내경·링 폭·지지축 위치 등은 구조 치수이지 음압·조임력·제조 공차의 해석 결과가 아니다. 탐침 연결선의 값은 탐침의 음장 진단이며 케이블 전력·마이크 응답이 아니다.

## 독립 검증

`tests/detail-model.test.mjs`는 2개 경계×3개 모드와 길이 범위 양 끝, 정확/근접 마디, 네 사분위상, 임의 탐침 위치를 확인한다.

- 수작업으로 고정한 1/4 위치·45° 참조값, 해석 마디 좌표표와 최근접 거리
- 기존 표본의 주기 수치 적분으로 RMS·평균 에너지·평균 전달 확인
- 공간 수치 적분으로 관 전체 압축·운동 에너지 비율 확인
- 서로 반대 방향의 진행파 두 개를 독립 구성하여 전달의 크기·부호 재구성
- 국소 보존식 유한차분과 유한 구간의 에너지 변화/경계 전달 적분
- 물리 시간의 속도 미분과 변위 2차 미분으로 정규화 가속도 확인
- 길이에 따른 시간·좌표 스케일과 정규화 진폭 불변, 그림 표본 수 독립
- 동결 snapshot·비교·프로젝트 직렬화 보존 및 14개 부품 사실표의 단위·경계 검사

이 수치 검사는 실제 오디오 청취, 3D 조립 형상이나 브라우저 조작 검증을 대신하지 않는다.

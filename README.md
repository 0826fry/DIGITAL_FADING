# DIGITAL FADING — Single Surface Edition

> **A website that wears like denim.**

사용자의 이동, 클릭, 드래그, 머무름, 휠 입력이 하나의 디지털 데님 표면에 누적되는 GitHub Pages용 인터랙티브 웹사이트입니다. HTML, CSS, Vanilla JavaScript, Canvas API, `localStorage`만 사용하며 빌드 과정이나 서버가 필요하지 않습니다.

## 이번 수정의 핵심

### 1. Click & Drag를 독립적인 마모 모드로 구현

기존 `WearMap`, `pointerDown`, `processPointerSegments()` 구조를 유지하면서 각 포인터 구간에 `move` 또는 `drag` 모드를 기록합니다.

- **Normal movement:** 좁고 매우 약한 마모입니다. 같은 경로를 반복해야 보입니다.
- **Click:** 포인터가 거의 이동하지 않았을 때만 작은 비정형 마모 군집을 적용합니다.
- **Click & drag:** 넓고 조밀한 거친 브러시와 섬유 방향의 보조 마모를 함께 적용합니다.
- **Slow rubbing:** 구간 속도가 낮을수록 반경과 강도가 증가합니다.
- **Release / cancel:** `pointerup`, `pointercancel`, `lostpointercapture`에서 드래그 상태와 포인터 캡처를 정리합니다.

자동화 검증에서 같은 크기의 영역을 비교했을 때 드래그 영역의 렌더링 알파가 일반 이동 영역보다 약 **5.1배** 높게 측정되었습니다. 이는 경로, 속도, 반복 횟수에 따라 달라질 수 있습니다.

### 2. 하나의 전체 화면으로 레이아웃 축소

기존의 Hero / Friction / Accumulation 세 섹션과 반복 설명을 제거했습니다. 화면에는 다음만 남습니다.

- 왼쪽 위: `DIGITAL FADING`
- 중앙: `EVERY TOUCH LEAVES A TRACE.`
- 중앙 아래: `CLICK AND DRAG TO WEAR THE SURFACE`
- 왼쪽 아래: `WEAR LEVEL`
- 오른쪽 아래: `RESET`

`totalInteractions`와 `activeTimeMs`는 계속 내부적으로 기록되지만 상시 UI에는 노출하지 않습니다.

### 3. 데님 원단과 페이딩 렌더링 강화

`denim-weave.png`는 대각 능직, 세로·가로 실 구조, 미세한 색 편차와 섬유를 포함하는 512×512 반복 텍스처로 교체했습니다.

Canvas의 페이딩은 다음 레이어를 사용합니다.

1. Wear Map 원본 마스크
2. 원단 결에 맞춰 알파를 끊어 주는 Mask Grain
3. 약한 마모용 Medium / Washed Blue 텍스처
4. `alpha²` 마스크 기반 Pale Blue 텍스처
5. `alpha³` 마스크 기반 Off-white Core 텍스처
6. 강한 마모 영역에만 나타나는 짧은 노출 섬유

페이딩 색을 단순히 흰색으로 칠하지 않고, Wear Map의 누적값에 따라 단계적으로 다른 직조 텍스처가 노출됩니다.

## 파일 구조

저장소 루트에 다음 파일들이 바로 있어야 합니다.

```text
DIGITAL_FADING/
├── .nojekyll
├── index.html
├── style.css
├── script.js
├── denim-weave.png
├── favicon.svg
└── README.md
```

현재 GitHub 저장소에서 이미지 파일이 루트에 있으므로, HTML과 CSS의 경로도 `favicon.svg`, `denim-weave.png`로 통일했습니다. 이전처럼 `assets/...`를 참조하면 이미지가 루트에 있는 저장소에서 404가 발생합니다.

## 입력 방식

### 데스크톱

- 마우스 이동: 약한 마모
- 짧은 클릭: 작은 국소 마모
- 왼쪽 버튼 드래그: 강한 문지르기
- 느린 드래그: 빠른 드래그보다 강한 마모
- 오래 머무르기: 매우 약한 압력 마모
- 휠: 마지막 포인터 위치 주변에 약한 세로 마모

드래그 중에는 포인터 캡처를 사용하여 요소 바깥으로 잠시 이동해도 경로가 끊기지 않게 합니다. 텍스트 선택과 기본 이미지 드래그는 CSS와 `pointerdown` 처리로 방지합니다.

### 모바일

`touch-action: pan-y pinch-zoom`을 유지합니다.

- 수평 의도가 분명한 한 손가락 드래그: 문지르기
- 수직 의도가 분명한 제스처: 브라우저의 세로 이동으로 분류하며 Wear Map에 기록하지 않음
- 짧은 탭: 작은 국소 마모

따라서 터치 마모를 위해 페이지 전체의 기본 스크롤을 강제로 차단하는 `preventDefault()`를 사용하지 않습니다.

## 기존 저장 데이터 호환

기존 저장 키와 버전은 그대로 유지합니다.

```js
storageKey: "digital-fading:state:v3"
storageVersion: 3
```

새 상태에는 다음 레이아웃 서명이 추가됩니다.

```js
layout: "single-surface-v1"
```

기존 세로 3개 섹션에서 만들어진 Wear Map은 새 단일 화면에 그대로 압축하지 않습니다. 저장 지도의 세로 비율을 분석해 2–4개의 화면 구간으로 나눈 뒤, 각 구간의 흔적을 하나의 표면 위에 겹치는 **fold migration**을 수행합니다. 모든 구간의 흔적을 남긴 뒤 새 형식으로 한 번 저장합니다.

새 레이아웃으로 변환된 기록을 원하지 않는 경우 화면 오른쪽 아래의 `RESET`을 사용하면 됩니다.

## 로컬 실행

```bash
cd DIGITAL_FADING
python3 -m http.server 8080
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:8080
```

## GitHub Pages에 반영하는 방법

현재 저장소 `0826fry/DIGITAL_FADING`의 루트에서 기존 파일들을 다음 파일로 교체합니다.

```text
index.html
style.css
script.js
denim-weave.png
favicon.svg
README.md
.nojekyll
```

GitHub 웹 업로드를 사용할 때는 ZIP 파일 자체를 올리지 말고, 압축을 푼 뒤 위 파일들이 저장소 첫 화면에 바로 보이도록 올립니다.

Pages 설정은 다음과 같습니다.

```text
Settings → Pages
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

배포 후 강력 새로고침을 하거나 브라우저 캐시가 갱신될 때까지 잠시 기다립니다.

## 주요 조절 값

`script.js` 상단의 `CONFIG`에서 해상도와 저장 주기를 조절할 수 있습니다.

```js
mapWidth: 512,
mapMinHeight: 240,
mapMaxHeight: 1120,
saveDelayMs: 3800,
touchRubThresholdPx: 11,
clickDistancePx: 7,
```

마모 강도는 `processPointerSegments()`에서 조절합니다.

```js
// 일반 이동
strength: lerp(0.0066, 0.0025, speedFactor)

// 클릭 드래그
strength: lerp(0.0145, 0.0315, slowFactor)
```

드래그 값에는 더 넓은 반경, 더 좁은 간격, `fiberPass`가 함께 적용되므로 숫자 비율만큼 단순히 선형으로 보이지는 않습니다.

## 성능 설계

- Pointer Events와 coalesced events 사용
- 프레임당 처리할 포인터 구간 수 제한
- Wear Map과 표시 Canvas의 해상도 분리
- 데스크톱 DPR 1.5, 모바일 DPR 1.25로 제한
- 현재 뷰포트에 해당하는 Wear Map만 렌더링
- 저장 요청을 3.8초 단위로 지연
- WebP 저장을 우선하고 미지원 시 PNG로 자동 대체
- 데이터가 클 경우 저장용 캔버스를 축소

## 브라우저 대응

- `getCoalescedEvents`, Pointer Capture, `<dialog>`는 기능 감지 후 사용합니다.
- `<dialog>`가 없으면 `window.confirm()`으로 Reset 확인을 대체합니다.
- `100dvh` 앞에 `100vh` 대체값을 둡니다.
- `backdrop-filter`에는 `-webkit-` 접두사를 함께 둡니다.
- Canvas WebP가 지원되지 않으면 PNG로 저장합니다.

Chromium 기반 자동화 검증 결과는 `TEST_REPORT.md`에 정리되어 있습니다. 실제 macOS Safari 최종 확인은 배포 후 별도로 수행하는 것을 권장합니다.

# DIGITAL FADING

> **A website that wears like denim.**  
> 사용자의 이동, 머무름, 클릭, 스크롤, 터치가 데님 표면의 마찰처럼 누적되는 인터랙티브 웹사이트입니다.

이 프로젝트는 별도의 서버, 로그인, 유료 API, 프레임워크 없이 **HTML + CSS + Vanilla JavaScript + Canvas API + localStorage**만으로 작동합니다. GitHub Pages에 그대로 배포할 수 있습니다.

---

## 1. 디자인 및 인터랙션 구조

사이트는 세 개의 세로 패널로 구성됩니다.

1. **Hero / First Contact**  
   `EVERY TOUCH LEAVES A TRACE.`를 중심으로 최초 접촉을 유도합니다.
2. **Friction Field**  
   반복 이동과 머무름이 점차 보이는 마모로 변하는 넓은 인터랙션 영역입니다.
3. **Accumulated Memory**  
   기록이 브라우저에 남고 다시 방문했을 때 이어진다는 개념을 전달합니다.

기본 표면은 사진이 아니라 직접 제작한 작은 데님 직조 텍스처와 CSS 레이어로 구성됩니다. 마모 표현은 그 위의 고정 Canvas에서 렌더링됩니다.

---

## 2. Wear Map 시스템

`script.js`의 `WearMap` 클래스가 페이지 전체를 저해상도 정규화 좌표계로 관리합니다.

- 가로 해상도: `384px`
- 세로 해상도: 현재 문서의 종횡비에 따라 자동 계산
- 저장 값: Canvas의 알파 채널 `0–1`
- 누적 방식: 낮은 알파의 거친 브러시를 반복 합성
- 포화 방식: Canvas의 `source-over` 합성으로 변화량이 자연스럽게 감소
- 리사이즈: 기존 지도를 새 종횡비로 재표본화하여 흔적 유지

페이지 좌표는 다음처럼 정규화됩니다.

```text
x = pointerX / viewportWidth
y = (scrollY + pointerY) / documentHeight
```

따라서 브라우저 크기가 바뀌어도 흔적은 페이지 내 상대 위치에 최대한 유지됩니다.

---

## 3. 행동과 마모의 연결

### Mouse / Pointer movement

이동 경로를 보간한 뒤, 속도에 따라 반경과 마모량을 조절합니다.

- 빠른 이동: 좁고 매우 약한 흔적
- 느린 이동: 조금 넓고 깊은 흔적
- 같은 경로 반복: 기존 알파 위에 누적

### Hover duration

포인터가 약 `480ms` 이상 거의 움직이지 않으면 작은 비정형 브러시가 반복 적용됩니다. 오래 머무를수록 반경과 압력이 조금씩 증가하지만 상한이 있습니다.

### Click / Touch press

서로 다른 크기·회전·종횡비의 브러시를 여러 번 겹쳐 국소 마모를 만듭니다. 단순한 흰색 원을 그리지 않습니다.

### Scroll

현재 화면 중앙과 가까운 콘텐츠 블록 또는 화면 가장자리 주변에 세로 방향 마찰을 소량 축적합니다. 스크롤만으로 전체 화면이 균일하게 밝아지지 않습니다.

### Mobile touch

Pointer Events를 사용하며 `touch-action: pan-y pinch-zoom`을 유지합니다. 터치 효과가 일반적인 세로 스크롤과 확대 동작을 막지 않습니다.

---

## 4. 데님 페이딩 렌더링

화면에 보이는 페이딩은 한 개의 흰색 오버레이가 아닙니다.

1. 저장된 Wear Map에서 현재 뷰포트에 해당하는 부분만 추출
2. 중간 블루 텍스처를 원래 마스크로 클리핑
3. 마스크를 자기 자신과 `source-in` 합성하여 `alpha²` 고마모 마스크 생성
4. 회청색·밝은 섬유 텍스처를 고마모 마스크로 추가 클리핑
5. 두 레이어와 미세 섬유선을 기본 인디고 위에 합성

이 때문에 낮은 마모는 중간 블루로, 반복 마모는 연한 블루와 회백색 섬유로 이동합니다.

---

## 5. 저장과 복구

브라우저의 `localStorage`에 다음을 저장합니다.

- 압축된 Wear Map 이미지
- 총 인터랙션 수
- 실제 활동 중 누적 시간
- 생성 및 마지막 방문 시각

저장은 매 입력마다 실행하지 않고 약 `4.2초` 단위로 제한합니다. 페이지가 숨겨지거나 닫힐 때도 한 번 저장합니다. 데이터가 너무 커지면 저장용 Wear Map을 자동 축소합니다.

모든 기록은 사용자의 현재 브라우저 안에만 존재하며 서버로 전송되지 않습니다.

`RESET DENIM`을 누른 뒤 확인하면 해당 브라우저의 저장 기록이 삭제됩니다.

---

## 6. 파일 구조

```text
digital-fading/
├── index.html
├── style.css
├── script.js
├── README.md
├── .nojekyll
└── assets/
    ├── denim-weave.png
    └── favicon.svg
```

- `index.html`: 콘텐츠, 통계 UI, 초기화 대화상자
- `style.css`: 레이아웃, 타이포그래피, 기본 데님 표면, 반응형 UI
- `script.js`: Wear Map, 브러시, Canvas 렌더링, 저장, 입력 처리
- `assets/denim-weave.png`: 직접 생성한 반복형 디지털 데님 텍스처
- `assets/favicon.svg`: 프로젝트 파비콘
- `.nojekyll`: GitHub Pages가 파일을 그대로 정적 배포하도록 지정

외부 폰트, CDN, 이미지 API는 사용하지 않습니다.

---

## 7. 로컬 실행

파일을 더블 클릭해도 열리지만, 브라우저의 저장 정책과 GitHub Pages 환경을 비슷하게 확인하려면 로컬 서버를 권장합니다.

### Python 사용

```bash
cd digital-fading
python3 -m http.server 8080
```

브라우저에서 다음 주소를 엽니다.

```text
http://localhost:8080
```

### Node.js 사용

```bash
npx serve .
```

---

## 8. GitHub Pages 배포

### GitHub 웹사이트에서 업로드하는 방법

1. GitHub에서 새 저장소를 만듭니다. 예: `digital-fading`
2. 이 폴더 **안의 파일들**을 저장소 최상위에 업로드합니다. `index.html`이 저장소 루트에 있어야 합니다.
3. 저장소의 **Settings → Pages**로 이동합니다.
4. **Build and deployment**의 Source를 **Deploy from a branch**로 선택합니다.
5. Branch를 `main`, 폴더를 `/(root)`로 선택하고 저장합니다.
6. 배포가 끝나면 `https://사용자이름.github.io/digital-fading/` 형식의 주소로 접속합니다.

### 터미널에서 올리는 방법

```bash
cd digital-fading
git init
git add .
git commit -m "Build Digital Fading"
git branch -M main
git remote add origin https://github.com/사용자이름/digital-fading.git
git push -u origin main
```

그다음 GitHub의 **Settings → Pages**에서 `main / (root)`를 선택합니다.

공식 안내: <https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site>

---

## 9. 주요 조절 지점

`script.js` 상단의 `CONFIG`에서 성능과 저장 주기를 조절할 수 있습니다.

```js
mapWidth: 384,
mapMaxHeight: 1700,
saveDelayMs: 4200,
hoverDelayMs: 480,
movementInteractionDistance: 30,
```

마모 강도는 다음 메서드의 옵션에서 조절합니다.

- 이동: `processPointerSegments()`의 `radius`, `strength`
- 머무름: `processHover()`의 `pressure`, `radius`
- 클릭: `WearMap.clickCluster()`
- 스크롤: `paintScrollWear()`

값을 지나치게 높이면 한 번의 행동만으로 표면이 빠르게 밝아지므로, 현재 설정은 반복 사용을 전제로 약하게 조정되어 있습니다.

---

## 10. 브라우저 및 성능 설계

- Chrome 및 Safari의 표준 Canvas 2D / Pointer Events / `<dialog>` 사용
- Canvas의 DPR을 데스크톱 `1.75`, 모바일 `1.35`로 제한
- 포인터 이벤트를 큐에 넣고 `requestAnimationFrame`에서 묶어 처리
- Wear Map은 화면보다 낮은 해상도로 유지
- 저장을 지연·압축하여 `localStorage` 쓰기 횟수 제한
- 일반 스크롤과 터치 제스처에서 `preventDefault()`를 사용하지 않음
- `prefers-reduced-motion` 환경에서는 불필요한 UI 전환을 최소화

---

## 11. 개인정보 및 기록 범위

이 사이트는 입력 내용을 수집하지 않습니다. 기록되는 것은 대략적인 위치별 마모 지도, 인터랙션 수, 활동 시간뿐입니다. 이 데이터는 현재 브라우저의 `localStorage`에만 저장되며 다른 기기나 브라우저에는 동기화되지 않습니다.

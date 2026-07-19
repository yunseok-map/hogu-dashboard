---
name: ui-work
description: hogu-dashboard 프런트(public/) UI·UX 수정 작업 규칙. 디자인 변경, 스타일 수정, 반응형/애니메이션 작업 전에 로드해서 따른다. 토큰 절약이 목적.
---

# ui-work — 호구체크 UI 수정 규칙

## 1. 파일 전체를 읽지 말 것
- **수정 전 `./docs/DESIGN.md`만 읽는다** — 구조·토큰·파일 지도·모션 규칙이 전부 있다.
- style.css는 섹션 주석(`/* ---------- 이름 ---------- */`)으로 나뉘어 있다. Grep으로 해당 섹션 헤더를 찾아 그 범위만 Read(offset/limit)한다.
- app.js도 함수 단위로 Grep(`function renderChart` 등) 후 해당 함수만 읽는다.

## 2. 수정 원칙
- 색은 반드시 CSS 변수로 — 하드코딩 hex 금지. 새 색이 필요하면 `:root` 3블록(light/dark/prefers) 모두에 추가.
- 차트 색(`--series-*`)과 앱 크롬 색을 혼용하지 않는다.
- 모션 추가 시 `prefers-reduced-motion` 무효화 블록이 이미 있으니 별도 처리 불필요. JS 애니메이션은 `REDUCED` 플래그를 체크.
- 마크업 구조를 바꾸면 DESIGN.md의 구조/지도 표를 갱신한다.

## 3. 검증 (필수, 저비용 순서)
1. `node --check public/app.js` (문법)
2. preview 탭에서 read_console_messages로 JS 에러 확인
3. resize_window 375 → 스크린샷, 1280 → 스크린샷 (다크는 `document.documentElement.dataset.theme='dark'` 후 1장)
4. 가로 오버플로 검사: `document.body.scrollWidth <= innerWidth`
- 결과 화면은 재분석하지 말고 히스토리 재렌더로 확인:
  `fetch('/api/history').then(r=>r.json()).then(l=>fetch('/api/history/'+l[0].id).then(x=>x.json()).then(r=>{currentResult=r;renderResult(r)}))`

## 4. 금지
- 외부 UI 라이브러리/프레임워크 추가 (vanilla 유지)
- 스크린샷 대신 전체 페이지 HTML 덤프로 확인하는 것
- lib/(백엔드) 파일을 UI 작업에서 건드리는 것

# 호구체크 UI 스펙 (docs/DESIGN.md)

> UI 수정 전 이 문서만 읽으면 된다. style.css(~470줄)/app.js(~400줄) 전체를 읽지 말 것.
> 구조 변경 시 이 문서도 같이 갱신할 것.

## v5 콘셉트: 키네틱 브루탈리즘 (사용자 확정 — AskUserQuestion으로 선택됨)

해외 어워즈(Awwwards) 에이전시 사이트 문법. v1(카드 대시보드)·v2(토스풍)·v3(다크 글로우)·v4(종이 감정서)는
전부 사용자가 반려했고 v5를 직접 골랐다. **이 방향을 유지할 것.**

- 팔레트: 아이보리 `--paper(#f2efe6)` + 잉크 `--ink(#141412)` + 일렉트릭 블루 `--blue(#2337ff)` + 라임 `--lime(#d7f53f)`.
- 문법: **2px 잉크 보더 + 하드 오프셋 섀도(`--shadow: 4px 4px 0`)**, 라운드 0, 그라데이션/블러 금지.
- 버튼 공통 인터랙션: hover `translate(-2,-2)`+섀도 확대 / active `translate(3,3)`+섀도 0 (= 눌림). `--snap` 오버슈트 이징.
- 초대형 타이포: `.mega`(clamp 58~128px), `.outline`(-webkit-text-stroke, hover 시 라임 채움), `.big-num`(점수 96~170px).
- 하이라이터 밑줄: `linear-gradient(transparent 62%, var(--lime) 62%)` — 링크 hover/강조 공용.
- 판정 등급 배경: `--t-great(라임)/meh(노랑)/bad(주황)/hogu(빨강)/none(회)` — 스티커·미니스티커·미터 채움 공용.

## 시그니처 컴포넌트

| 컴포넌트 | 구현 |
|---|---|
| 마퀴 티커 | `.ticker`+`.ticker-track`(내용 2벌, translateX(-50%) 무한 루프, hover 일시정지). 상단=잉크bg 고정문구(HTML), 결과=라임bg 시세(`buildTicker()`가 #priceTicker 채움, stats 없으면 hidden) |
| 판정 스티커 | `.sticker` — 3px 보더+하드섀도+rotate(-3deg), `slap` 애니메이션(크게→쾅, `--snap`). 재렌더 시 animation 리셋 트릭. 인덱스용 `.mini-stamp` |
| 바버폴 미터 | `.meter-fill` — 등급색 사선 스트라이프(`--fillc` CSS 변수, JS `TIER_FILL`로 주입) + `barber` 배경 이동 애니메이션, width=score% 트랜지션 |
| 로딩바/상태 | `.loadbar.on`(블루·라임 사선), `.status-bar`(미니 바버폴) |
| 번호 뱃지 | findings/대안의 `::before` — 라임 사각+잉크 보더 counter |
| 통계 블록 | `.blocks`(2px 그리드 셀) — 아낄 수 있는 돈은 `.hl`(라임) |
| 쿠폰·이벤트 배지 | `.promo`(라임 배경+잉크 보더, 서버 `extractPromos`가 채운 `item.promos`/`product.promos`). 상품요약 `#pPromos`, 대안 `.alt-t` 안, 테이블 `.cell-promos` |

## 구조

```
ticker-top → .page
  ├ .hdr      로고(hover 자간 벌어짐) + [기록 N](#homeBtn)
  ├ .intake   보더 인풋 2개(포커스 시 하드섀도 lift) + 라임 CTA / #statusLine / #errorBox
  ├ #empty    .mega 헤드라인 + .lede + 견본 .try + 기록 인덱스(.index: 번호+점선리더+미니스티커)
  ├ #skeleton 보더 블록 쉬머
  └ #result   .hero(거대 점수+스티커+미터) → findings → ticker-data(시세 마퀴)
              → 01 검사대상(.subject 폴라로이드 이미지+.blocks) → 02 차트 → 03 .alts
              → 04 리뷰(.statements ○△✕ +.tags) → 05 테이블 → 06 각주 → .ftr
```

전환 `showView('empty'|'loading'|'result')`. 라이트 온리(다크 없음). 드로어 없음 — 기록은 홈 화면 인덱스.

## 파일 → 역할 지도

| 무엇을 고치나 | 어디를 보나 |
|---|---|
| 색/섀도 토큰 | style.css 최상단 `:root` 한 블록 |
| 스티커/미터/티커 | 위 표 + app.js `renderVerdict()`/`buildTicker()` |
| 차트 | app.js `renderChart()` — 점 `--blue`(잉크 테두리), 마커 `--t-hogu`, body ResizeObserver |
| 테이블/모바일 스택 | `renderTable()`(td data-th) + style.css `≤680px` 블록 |
| 기록 인덱스 | `loadHistory()` — #historyList/#histCount/#indexCount, 삭제 `.idx-del` |
| 딥링크 | `?id=` — init() 로드, replaceState |

## 브레이크포인트

- **≤680px**: 폼 랩(URL 한 줄 전체), 점수 88px, 블록 2열, idx-time/alt-meta 숨김,
  테이블 → 하드섀도 카드 스택(td[data-th] 라벨).
- 마퀴/미터/스티커는 전 구간 동일.

## 검증 루틴 (UI 수정 후)

`node --check public/app.js` → preview 콘솔 에러 0 → 스크린샷 375/1280(결과 화면은 재분석 말고
`fetch('/api/history')` 첫 항목 `openResult(id)`로 재렌더) → `document.body.scrollWidth <= innerWidth`.

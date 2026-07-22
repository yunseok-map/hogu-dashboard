# 호구체크 UI 스펙 (docs/design/DESIGN.md)

> UI 수정 전 이 문서만 읽으면 된다. style.css(~560줄)/app.js(~500줄) 전체를 읽지 말 것.
> 구조 변경 시 이 문서도 같이 갱신할 것.
> ⚠ **app.js가 참조하는 클래스/ID/CSS변수 이름은 계약이다.** 값·스타일만 바꾸고 이름은 유지한다.

## v6 콘셉트: 일렉트릭 리소 (Electric Riso) — 키네틱 브루탈리즘 계승

v5(키네틱 브루탈리즘)를 사용자 요청("한 눈에·안티AI·신박·최신 트렌드·전면 개편 허용")으로 격상한 판.
브루탈리즘 DNA(2px 잉크 보더 · 하드 오프셋 섀도 · 초대형 타이포 · 마퀴 · 스티커 · 바버폴)는 **유지**하고
①팔레트 리프레시 ②타이포 3중 시스템 ③결과 상단 "판정 콕핏" 벤토 ④풀-플루이드 반응형으로 재작성했다.

- **팔레트(일렉트릭 리소)** — 본지(bone) 바탕 + 근흑 잉크 + 브랜드 2색(의미 티어와 축이 겹치지 않게 분리):
  - `--paper #f2f1ea`(따뜻한 뉴스프린트, 크림 아님) + 방안지 도트그리드(html 직접, body 투명)
  - `--ink #141018` / `--ink-2` / `--faint #79737f`
  - **PRIMARY `--blue #2b28ff`**(일렉트릭 울트라마린) — 검사 CTA·링크·포커스·번호·차트 점
  - **HIGHLIGHT `--lime #ceff2e`**(애시드 라임) — 하이라이터 밑줄·딜카드·배지·칩·findings 번호
  - 티어색(브랜드와 분리된 초록→빨강 의미 스케일): `--t-great #46e07d`(great·fair) / `--t-meh #ffc22e` / `--t-bad #ff8a3c` / `--t-hogu #ff3b52` / `--t-none`. **app.js `TIER_FILL`에도 동일 hex가 하드코딩**돼 있으니 티어색 바꾸면 거기도 같이 바꾼다.
- **타이포 3중 시스템**:
  - `--display` = **Space Grotesk**(라틴 디스플레이) — 한글은 자동으로 Pretendard 폴백(로고/메가/섹션헤더/스티커/라벨)
  - `--mono` = **Space Mono**(데이터/수치) — 점수·가격·통계·테이블 숫자·티커·등록증(감정소 REG)
  - `--sans` = **Pretendard**(한글 본문). ⚠ app.js 인라인 스타일이 `var(--sans)` 참조 → 이름 유지 필수.
  - 웹폰트: `<head>`에서 Google Fonts(Space Grotesk 400–700 + Space Mono 400/700) + Pretendard(jsdelivr). preconnect 포함.
- **문법**: 2px 잉크 보더 + 하드 오프셋 섀도(`--shadow: 4px 4px 0`), 라운드 0, 그라데이션/블러 금지(안티-AI).
- 버튼 인터랙션: hover `translate(-2,-2)`+섀도 확대 / active `translate(3,3)`+섀도 0(눌림). `--snap` 오버슈트 이징.
- 하이라이터 밑줄: `linear-gradient(transparent 62%, var(--lime) 62%)` — 링크 hover/강조 공용.

## 시그니처 컴포넌트

| 컴포넌트 | 구현 |
|---|---|
| 판정 콕핏 | `.cockpit`(flex-wrap) → `.cockpit-main`(히어로+findings+warns, `flex:1 1 460px`) + `#dealBox`(`flex:1 1 340px`). ≤1024px에서 딜이 아래로 랩. **딜 없으면 #dealBox `display:none` → main이 전폭**(flex라 그레이스풀) |
| 마퀴 티커 | `.ticker`+`.ticker-track`(내용 2벌, translateX(-50%) 무한, hover 정지, `overflow:clip`). 상단=잉크bg 고정문구(HTML, Grotesk 대문자), 결과=라임bg 시세(`buildTicker()`가 #priceTicker 채움, stats 없으면 hidden) |
| 판정 스티커 | `.sticker`(Grotesk) — 3px 보더+하드섀도+rotate(-3deg), `slap` 애니메이션. 인덱스용 `.mini-stamp`. 티어색은 `.tier-*` |
| 바버폴 미터 | `.meter-fill` — 등급색 사선(`--fillc` CSS변수, JS `TIER_FILL`로 주입) + `barber` 이동, width=score% |
| 딜 헤드 | `.deal-head`(Grotesk) + `::before` 다이아 마커(이모지 제거). `.deal-head-hot`=더싼딜 / `.deal-head-ok`=이미최저 |
| 번호 뱃지 | findings/대안의 `::before` — 라임 사각+잉크 보더 counter(Mono) |
| KPI 블록 | `.blocks`(2px 그리드 셀, auto-fit) — 아낄 돈은 `.hl`(라임). 값은 Mono. 로드 시 rise 스태거 |
| 쿠폰·이벤트 배지 | `.promo`(라임+잉크 보더). 상품요약 `#pPromos`, 대안 `.alt-t` 안, 테이블 `.cell-promos` |
| 등록증 마크 | 헤더 `.hdr-reg`(Mono "시세감정소 · REG.2026") — 아이덴티티, ≤720 숨김 |
| 가격 추이(일자별) | `#historyBlock`(섹션02 내, 관측 2시점 이상일 때만). 수제 SVG 라인차트 `drawHistoryChart()` — 라임 최저–최고 밴드 + 블루 중앙값선 + 하구red 점선 내 가격. 서버가 매 분석마다 `data/prices/{hash}.json`에 하루 1점 적립(패시브) |
| 핫딜 레이더(2트랙) | 홈(#empty) 최상단 `#dealRadar`(잉크 헤더 + 가로스크롤 카드). `loadDeals()`→`GET /api/deals`. **①검색 기반**(`#radarList`)=저장된 분석결과에서 추출한 실제 딜(better-deal·쿠폰·파격가). **②자동 크롤 특가**(`#radarListKw`)=키워드 자동 크롤 + 공홈. 카드 소스배지 포착/키워드/공식몰. `↻ 새로고침`은 비블로킹(백그라운드)+폴링. 빈 그룹/전체 자동 숨김 |
| 관심상품 담기 | 결과 히어로 `#watchBtn` 토글 → `/api/watch`(+`/remove`). 담으면 스케줄러/수동 refresh가 주기적으로 재분석해 가격추이 적립. 초기 상태는 `result.watched` |

## 구조

```
ticker-top → .page
  ├ .hdr      로고 + .hdr-right(.hdr-reg 등록증 + [기록 N]#homeBtn)
  ├ .intake   보더 인풋 2개(포커스 시 하드섀도 lift) + 블루 CTA / #statusLine / #errorBox / deep-check
  ├ #empty    #dealRadar 핫딜 레이더(가로스크롤) + .mega 헤드라인(outline "호구") + .lede + 견본 .try + 기록 인덱스(.index)
  ├ #skeleton 보더 블록 쉬머
  └ #result
      ├ .cockpit → .cockpit-main(.hero 점수+스티커+미터 / #reasons / #verdictWarnings) + #dealBox
      ├ ticker-data(시세 마퀴)
      ├ 01 검사대상(.subject 폴라로이드 + .blocks KPI)
      ├ 02 차트(.chart-box 시세분포 + #historyBlock 가격추이 라인, 둘 다 보더 카드·내부 가로스크롤)
      ├ 03 .alts 더싸게사기
      ├ 04 리뷰(.statements ○△✕ + .quotes 그리드 + .tags)
      ├ 05 테이블(.tbl-wrap 보더 카드 → ≤720 카드 스택)
      ├ 06 참고자료(.foot-refs 그리드)
      └ .ftr(Mono)
```

전환 `showView('empty'|'loading'|'result')`. 라이트 온리(다크 없음). 드로어 없음 — 기록은 홈 인덱스.

## 파일 → 역할 지도

| 무엇을 고치나 | 어디를 보나 |
|---|---|
| 색/섀도/폰트 토큰 | style.css 최상단 `:root` 한 블록 |
| 티어색(스티커·미터·미니스탬프) | style.css `:root` `--t-*` **+ app.js `TIER_FILL`(hex 하드코딩)** |
| 콕핏 벤토 레이아웃 | style.css `.cockpit`/`.cockpit-main`/`#dealBox` + index.html `.cockpit` 래퍼 |
| 스티커/미터/티커 | 위 표 + app.js `renderVerdict()`/`buildTicker()` |
| 차트 | app.js `renderChart()` — 점 `--blue`, 마커 `--t-hogu`, 눈금 `--hair`, body ResizeObserver |
| 가격 추이 | app.js `renderPriceHistory()`/`drawHistoryChart()`(`r.priceHistory`+`?priceKey`로 최신 재조회). 데이터=server가 적립, `store.js` `recordPricePoint/readPriceSeriesByHash` |
| 핫딜 레이더/관심상품 | app.js `loadDeals`/`renderRadar`/`dealCardHtml`/`setWatchBtn` + `src/deals/{collect,registry,keywords}.js` + server `/api/deals`(+refresh)·`/api/watch`(+remove/refresh). 스타일 `.radar*`/`.rd-*`/`.radar-group`/`.watch-btn` |
| 테이블/모바일 스택 | `renderTable()`(td data-th) + style.css `≤720px` 블록 |
| 기록 인덱스 | `loadHistory()` — #historyList/#histCount/#indexCount, 삭제 `.idx-del` |
| 딥링크 | `?id=` — init() 로드, replaceState |

## 브레이크포인트 (플루이드 우선 — clamp로 대부분 해결, 브레이크는 레이아웃 전환에만)

- **≤1024px**: 콕핏 딜(`#dealBox`)이 메인 아래로 랩(flex-basis 100%).
- **≤720px**: 등록증 숨김, 폼 랩(URL 한 줄 전체), idx-time/alt-meta 숨김, **더싸게사기 점선 리더 숨김+제목 flex**(가로 오버플로 방지), 테이블 → 하드섀도 카드 스택(td[data-th] 라벨).
- **≤520px**: 점수/블록 압축(블록 2열), quotes/foot-refs 1열.
- 마퀴/미터/스티커는 전 구간 동일. 차트 SVG는 `.chart-box{overflow-x:auto}` 내부 스크롤(문서 폭에 기여 안 함).

## 검증 루틴 (UI 수정 후)

`node --check public/app.js` → 서버 기동(`PORT=<빈포트> node server.js`) → 헤드리스 크롬으로 375/768/1280 스크린샷
(결과 화면은 재분석 말고 `window.renderResult(mock)` 또는 `/api/history` 첫 항목 `openResult(id)`로 재렌더)
→ **`document.documentElement.scrollWidth <= innerWidth` 3뷰포트 모두 확인** → 콘솔 에러 0 → `document.fonts.check`로 Space Grotesk/Mono 로드 확인. 스크래치 `_*.mjs`/`_*.png`는 gitignore, 작업 후 삭제.

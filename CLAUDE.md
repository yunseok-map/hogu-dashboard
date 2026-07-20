# hogu-dashboard — 호구체크 (호구 방지 대시보드)

상품 URL/키워드를 받아 시세·유사 상품·리뷰를 크롤링하고 "호구지수"를 자동 판정하는 로컬 대시보드.

> **새 세션에서 이어받을 때는 `HANDOFF.md`를 먼저 읽어라** — 저장소 2개 구조/배포 절차/불가 목록/디자인 히스토리까지 전부 정리돼 있다.

## 작업 시 필수
- **이 폴더 작업 전에 `token-diet` 스킬을 로드**하고 그 규칙을 따를 것 (크롤링 프로젝트라 원본 HTML이 컨텍스트에 들어오면 토큰 폭발).
- 라이브 페이지/검색 검증은 `tools/probe.mjs`, `tools/search-probe.mjs`만 사용.
- 반복 검증은 `cheap-probe` 에이전트(haiku)에 위임.

## 실행
- 서버: `node server.js` (포트 3311, `.claude/launch.json`의 "hogu"로 preview 가능)
- 네이버 쇼핑 API 키는 선택 (`.env.example` 참고) — 없으면 다나와 크롤링+웹 검색으로 동작.
- `src/` 수정 후에는 서버 재시작 필요.

## 아키텍처 (탐색 대신 이 표 사용)
| 파일 | 역할 |
|---|---|
| server.js | Express, SSE 스트리밍 분석(`/api/analyze/stream`), POST `/api/analyze`, 히스토리 CRUD, `.env` 로더 |
| src/crawl/fetchPage.js | 브라우저 헤더 위장 fetch + EUC-KR 처리 (1차) |
| src/crawl/browserFetch.js | 봇 차단 시 2차: ①열린 CDP Chrome → ②서버가 실제 Chrome 자동 spawn(화면밖, 전용 프로필)+CDP → ③headless 폴백. 오리진 홈 방문 워밍업(Akamai 쿠키)+차단 감지 1회 재시도. 60s 유휴/서버종료 시 정리. `HOGU_NO_AUTO_CHROME=1`로 자동실행 차단 |
| src/search/productParser.js | 1차 HTTP → 차단·가격누락 시 2차 브라우저 재시도. JSON-LD → OG → 사이트 어댑터(스마트스토어/쿠팡) → 인라인 JSON 순 파싱. 추출 품질 점수로 더 나은 결과 채택 |
| src/search/searchProviders.js | 기본: 다나와+에누리 크롤링(키 불필요)+DuckDuckGo+네이버API(선택). 정밀(deep=1, UI 체크박스): SSG(__NEXT_DATA__ 딥스캔)+11번가(.c-card-item)+옥션+G마켓(searchEbayKorea 공용, **상품 링크 앵커**로 카드 잡음 — 옥션/G마켓 클래스가 서로 달라서). deep 제공자는 한 Chrome 공유라 **반드시 순차 실행**(동시 실행 시 렌더 방해로 0건). extractPromos로 쿠폰/이벤트 문구를 각 item.promos에 담음. 유사도 엔진(정밀 — **규칙/케이스는 docs/SEARCH-PRECISION.md, 검증은 test/precision-test.mjs**): tok이 한글-숫자 분리("아이폰15"→"아이폰 15") + 가중 자카드(STOP=카테고리/색상/에디션/해외) + 모델코드(modelCodes, 다른 모델 0.3캡) + 스펙(extractSpecs: 용량/크기/oz·ml·L→ml버킷, 같으면 +0.12·다르면 ×0.5) + **변형 키워드**(VARIANT: 프로/에어/프로맥스/맥스/세대…, 한쪽에만 ×0.4) + **세대번호**(seriesNumbers: 아이폰15 vs 14 다르면 0.3캡) + 부속품 3중 방어(ACC→0.15캡→`it.accessory` 배제). buildSearchQuery도 동일 헬퍼로 조립. verdict 이상치는 2단계(중앙값 재계산 0.35x~3x)로 컷. **유사도 수정 시 `node test/precision-test.mjs` 통과 필수.** **불가 확정(재시도 금지, 2026-07-18 실측)**: 네이버쇼핑(로그인+캡차), G마켓(실제 Chrome으로도 connection 안 열림 — goto 행 유발 주의), 삼성닷컴/LG몰(Chrome+스크롤 트리거로도 가격 미렌더 → 대신 브랜드 감지 시 공식몰 검색 링크를 reviewSearchLinks에 추가함) |
| src/verdict.js | 호구지수(백분위50+중앙값프리미엄25+최저가과지불20±평점10), 등급/사유/추천대안/리뷰판단. **buildDealPitch**: 쿠폰 반영 실구매가(item.effPrice=price−promoDiscount) 최저 딜을 골라 "이래서 이득" 설득 문구 생성. 대안·savingsPotential도 effPrice 기준 |
| src/store.js | data/history.json + data/results/{id}.json |
| public/app.js | 앱 셸 SPA: showView 상태전환, SSE, 게이지/차트(SVG 수제+애니메이션), 드로어 히스토리, ?id= 딥링크, 단축키(/,h,Esc) |
| public/ 디자인 | **UI 수정 전 `ui-work` 스킬 로드 + docs/DESIGN.md 읽기** (파일 전체 읽기 금지). 브랜드 "호구체크", Pretendard, 반응형 720/1020 |

## 봇 차단 사이트 (쿠팡)
- 쿠팡은 Akamai 차단이라 일반 HTTP·playwright launch(headed 포함) 모두 403. **OS가 정상 실행한 Chrome을 CDP로 연결**해야 통과 → 서버가 자동 spawn하므로 사용자는 URL만 넣으면 됨 (검증 완료: 콜드스타트에서 제목/가격/평점/리뷰수 정상 추출).
- 핵심: 딥링크 상품 URL 직행은 차단됨 → **오리진 홈 먼저 방문(워밍업)** 후 상품 이동해야 _abck 쿠키 획득. warmedOrigins로 오리진당 1회.
- 쿠팡 신버전 DOM은 `twc-*` Tailwind 클래스. 가격은 JSON-LD offers.price가 가장 안정적.

## 알려진 한계
- 다나와 리뷰수는 "999+" 캡 표시를 999로 파싱함
- 쿠팡 리뷰 본문(스니펫)은 지연 로딩+탭 뒤라 미추출 — 리뷰는 평점/개수 + 후기 검색 링크로 대체
- playwright-core는 브라우저 번들 미포함 → 설치된 Chrome/Edge 사용 (없으면 `npx playwright install chromium`)

# 호구체크 — 작업 인수인계 (HANDOFF)

> **새 채팅에서 이 프로젝트를 이어갈 때 이 파일을 먼저 읽으면 된다.**
> 상세 규칙은 아래 문서들에 나눠져 있다: 아키텍처=`CLAUDE.md`, UI=`docs/design/DESIGN.md`, 검색 정밀도=`docs/search/SEARCH-PRECISION.md`.
> 작업 전 프로젝트 스킬 `token-diet`(항상)·`ui-work`(UI 작업 시) 로드 필수.

## 0. 한 줄 요약
상품 링크/키워드를 넣으면 시세·유사 상품·리뷰·쿠폰을 크롤링해 **호구지수(0~100)** 를 매기고, **쿠폰 적용 실구매가 기준 최저 딜**과 "왜 이득인지" 설득 문구까지 뽑아주는 로컬 웹앱(Node+Express, 포트 3311). 외부 LLM/유료 API 없음.

## 1. 어디서 작업하고, 어떻게 배포하나 (단일 저장소 — 단순)

- **개발 폴더 = GitHub 저장소** (2025년 이후 통합). 경로: **`C:\Users\A\Desktop\hogu-check`**
  → origin = **https://github.com/yunseok-map/hogu-dashboard** (브랜치 main). `node_modules`/`data`/`.claude`/`.env` 다 여기 있음.
- 예전엔 all-food-map 워크트리 + %TEMP% 클린 저장소로 복사→push 하는 2단계였으나, **독립 폴더로 clone해 정리함**(복사 과정 폐기). 이제 여기서 바로 커밋·push.

### 배포 절차 (바로 push)
```bash
cd C:/Users/A/Desktop/hogu-check
git add -A
git -c user.name="yunseok-map" -c user.email="yunseok1312@gmail.com" commit -m "<메시지>
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```
- 커밋 author는 `yunseok-map / yunseok1312@gmail.com`.
- **커밋 안 되는 것**(.gitignore): `node_modules/`, `data/`(로컬 분석 기록), `.env`, `_*.png`/`_*.mjs`(스크래치).
- (참고) 옛 워크트리 `...\worktrees\...\hogu-dashboard`에도 사본이 남아있을 수 있으나 **이제 안 씀** — 개발은 `Desktop\hogu-check`에서만.

## 2. 실행 & 검증

```bash
cd C:/Users/A/Desktop/hogu-check
npm install            # 최초 1회 (cheerio, express, playwright-core)
node server.js         # → http://localhost:3311  (포트 3311)
```
- **봇 차단 사이트(쿠팡 등)**: 서버가 실제 Chrome을 자동 실행(headless 아님, 화면 밖)해 CDP(9222)로 붙어 크롤링. `npm run chrome`으로 직접 띄워 둬도 됨. `HOGU_NO_AUTO_CHROME=1`로 끔.
- **네이버 쇼핑 API**(선택): `.env`에 `NAVER_CLIENT_ID/SECRET` 넣으면 활성. 없어도 동작.

### 환경 분리 (QA/prod) & 배포
- `HOGU_ENV=qa`(기본, 로컬 개발) | `prod`(배포). `src/env.js`가 `.env.<env>`→`.env` 로드(최상단 import). 설정 템플릿=`.env.{qa,prod}.example`.
- **prod 방어**(`src/guard.js`): IP 레이트리밋 + 동시성 캡 + SSRF(사설IP+쇼핑몰 allowlist) + 관리자 토큰(`HOGU_ADMIN_TOKEN`, 쓰기/딜갱신/기록삭제). QA는 무제한(사설IP만 차단).
- 데이터 분리: `HOGU_DATA_DIR=./data-prod`(gitignore `data-*/`).
- **배포=Cloudflare Tunnel**(크롤러가 로컬 크롬 의존 → 서버리스 불가): `npm run start:prod`(=`node start-prod.mjs`, .env.prod 필요) → `cloudflared tunnel --url http://localhost:3390`.
- **운영자 수동 셋업 체크리스트 = `docs/ops/DEPLOY.md`**(Cloudflare 계정·named tunnel, GitHub 저장소/환경 전략(저장소 분리 비권장), 상시구동, allowlist·rate·history 공개여부, 법무). 런처 `start-{qa,prod}.mjs` + `npm run start:{qa,prod}`.

### 저비용 검증 도구 (토큰 절약 — 원본 HTML 안 뽑음)
```bash
node tools/probe.mjs "<상품URL>"              # 파서 압축 요약
node tools/search-probe.mjs "<검색어>" [--deep] [--full]   # 검색/유사도 요약
node test/precision-test.mjs                 # 유사도 24케이스 회귀 테스트 (유사도 수정 시 필수)
node tools/mall-probe.mjs "<검색어>" [몰...]  # 신규 몰 크롤링 가능성 정찰
node tools/launch-chrome.mjs                  # = npm run chrome
```
- UI 스크린샷 검증: headless로 `chromium.launch({channel:'chrome',headless:true})` 후 localhost:3311 캡처(스크래치 `_*.mjs`/`_*.png`는 gitignore됨, 작업 후 삭제). 결과 화면은 재분석 말고 `fetch('/api/history')` 첫 항목 `renderResult`로 재렌더.

## 3. 아키텍처 (파일 지도)

```
hogu-dashboard/
  server.js              Express + SSE(/api/analyze/stream), POST /api/analyze, 히스토리 CRUD, .env 로더
  src/crawl/fetchPage.js       브라우저 헤더 위장 fetch + EUC-KR
  src/crawl/browserFetch.js    2차 크롤: CDP(자동실행 Chrome)→headless 폴백. 오리진 워밍업+차단 재시도. warmup 옵션
  src/search/productParser.js   상품 파싱(JSON-LD→OG→쿠팡/스마트스토어 어댑터→인라인JSON), buildSearchQuery
  src/search/searchProviders.js 검색 제공자 + 유사도 엔진(핵심). extractPromos/promoDiscount 쿠폰 파싱
  src/verdict.js         호구지수 스코어링, 이상치 2단계 컷, buildDealPitch(딜+설득)
  src/store.js           data/history.json + data/results/{id}.json
  public/                index.html · app.js · style.css (프런트, vanilla)
  docs/design/DESIGN.md         UI 스펙 (팔레트·컴포넌트·반응형)
  docs/search/SEARCH-PRECISION.md  유사도 규칙 + 검증 케이스
  tools/                 probe·search-probe·mall-probe·launch-chrome (진단·실행 도구)
  test/                  precision-test.mjs (유사도 회귀 테스트)
  .claude/               skills(token-diet, ui-work) + agents(cheap-probe) + launch.json  (저장소에 포함 — clone 시 따라옴)
```

## 4. 핵심 동작

**크롤링(LLM/유료API 없음, 3단계 자동)**: ①일반 HTTP → ②차단 시 실제 Chrome 자동실행+CDP(오리진 워밍업) → ③headless 폴백.

**가격 소스**: 기본 = 다나와·에누리(HTTP) + 웹(DuckDuckGo). **정밀검색(UI 체크박스, deep=1)** = + SSG·11번가·옥션·G마켓(실제 Chrome, **반드시 순차 실행** — 동시 실행 시 렌더 방해로 0건). 검색당 최대 ~150건.

**유사도 엔진**(`similarity`, 규칙은 docs/search/SEARCH-PRECISION.md): tok 한글-숫자 분리 → 가중 자카드(STOP 하향) → 모델코드 정규화(다른 모델 0.3캡) → 스펙(용량/크기/oz·ml·L→ml, 같으면 +0.12·다르면 ×0.5) → 변형 키워드(프로/에어/맥스/세대, 한쪽만 ×0.4) → 세대번호(아이폰15 vs 14, 0.3캡) → 부속품 3중 방어(어댑터/필터 등 `it.accessory`로 verdict 비교군 원천 배제).

**호구지수**: 백분위50 + 중앙값프리미엄25 + 최저가과지불20 ± 평점10. 등급 개이득→적정가→조금비쌈→호구주의→호구확정.

**쿠폰·딜**: `promoDiscount`가 "N원/N% 쿠폰" 파싱 → `effPrice`(실구매가). `buildDealPitch`가 **실구매가 최저** 딜 선정. 단, **내 가격이 이미 최저면** `kind:'already-best'`("지금이 최저가", 흰 카드, 오해 방지), 더 싼 딜 있을 때만 `kind:'better-deal'`("여기서 사면 더 쌉니다", 사러 가기).

**가격 히스토리(일자별, 패시브 MVP)**: 매 분석마다 정규화 검색어 키로 `data/prices/{hash}.json`에 시세 통계 1점 적립(당일이면 최신으로 대체, 최대 180점). `result.priceKey`/`priceHistory` 부착 → 프런트 '가격 추이' 라인차트가 **2시점 이상일 때** 표시.

**핫딜 레이더 + 관심상품**: 홈 상단 `#dealRadar`가 `GET /api/deals`로 딜 노출 — 백본은 저장된 분석결과에서 실제 딜(better-deal·쿠폰·파격가) 추출(즉시·신뢰), `?malls=1` 새로고침은 공홈 레지스트리 크롤 병합(베스트에포트). 결과 화면 '관심상품 담기'(`/api/watch`)로 담으면 스케줄러(`HOGU_REFRESH_MIN`)/수동 `/api/watch/refresh`가 재분석해 가격추이를 채운다.

## 5. UI (v6 일렉트릭 리소 — 키네틱 브루탈리즘 계승)
- 브루탈리즘 구조 유지: 2px 잉크 보더 + 하드 오프셋 섀도, 초대형 타이포, 마퀴 티커, 스티커 판정, 바버폴 미터.
- **팔레트(일렉트릭 리소)**: 바탕 본지 `#f2f1ea`(+방안지 도트) · PRIMARY 일렉트릭 울트라마린 `#2b28ff`(검사버튼/링크/번호/차트) · HIGHLIGHT 애시드 라임 `#ceff2e`(딜/하이라이트/배지) · 잉크 `#141018`. 티어색(개이득~호구 = `#46e07d/#ffc22e/#ff8a3c/#ff3b52`)은 브랜드와 분리된 의미 스케일 — **app.js `TIER_FILL`에도 동일 hex 하드코딩**.
- **타이포 3중**: Space Grotesk(라틴 디스플레이) + Space Mono(수치/데이터) + Pretendard(한글). `var(--sans)`는 app.js가 참조하므로 이름 유지.
- **결과 상단 "판정 콕핏"**: 히어로(점수·스티커·미터)+사유+딜을 벤토(flex)로 묶어 한 눈에. ≤1024에서 딜 아래로 랩.
- 라이트 온리(다크 없음). 반응형 플루이드 우선 + 브레이크 1024/720/520. `?id=` 딥링크.
- **UI 수정은 `ui-work` 스킬 로드 + `docs/design/DESIGN.md`만 읽고** (style.css/app.js 전체 읽기 금지).

## 6. 크롤링 불가 목록 (재시도 금지 — 실측 완료)
- **네이버 쇼핑 직접 크롤링**: 로그인 강제 + 캡차. (API 키는 별개, 가능)
- **삼성닷컴 / LG전자몰**: 실제 Chrome+스크롤로도 검색 가격 미렌더 → 상품명에 브랜드 감지 시 공식몰 **검색 링크**만 reviewSearchLinks에 추가함.
- **롯데온·티몬·위메프·GS샵·홈플러스·카카오·알리익스프레스**: SPA 인증벽/통화표기로 가격 못 뽑음.
- (참고) G마켓은 `browser.gmarket.co.kr` 서브도메인이 CDP goto 행 유발 → `www.gmarket.co.kr/n/search`로 해결됨(현재 정상).

## 7. 디자인 결정 히스토리 (되돌리지 말 것)
- UI 방향은 v1(카드 대시보드)·v2(토스풍)·v3(다크 글로우)·v4(종이 감정서)를 사용자가 전부 반려한 끝에 **v5 키네틱 브루탈리즘**을 AskUserQuestion에서 직접 선택.
- 색은 크림톤이 "Claude 티" 난다고 반려 → v5는 **네온 시트러스**(라일락/바이올렛/옐로우)를 직접 선택.
- **v6 일렉트릭 리소**(ui-ux-pro-max 스킬 기반): 사용자가 "한 눈에·안티AI·신박·최신 트렌드·전면 개편 허용"을 명시적으로 요청 → 브루탈리즘 DNA는 유지하되 팔레트를 **일렉트릭 울트라마린+애시드 라임+본지**로 리프레시, 타이포 3중(Grotesk/Mono/Pretendard), 결과 상단을 **판정 콕핏 벤토**로 재구성, 풀-플루이드 반응형. 크림톤·보라 그라데이션·이모지 아이콘은 여전히 금지(안티-AI).

## 8. 남은 아이디어 / 다음 스텝
- **가격 히스토리(완료, 2026-07-21)**: 패시브 적립 + '가격 추이' 라인차트 + **관심상품 watch(`/api/watch`) + 옵션 스케줄러(`HOGU_REFRESH_MIN`분, 기본 off)**. 진짜 매일 표 = 스케줄러 켜거나 OS크론으로 `POST /api/watch/refresh` 호출. 남은 것: 몰 간 canonical 키(현재 검색어 정규화라 표기 다르면 분리).
- **핫딜 레이더 2트랙(완료, 2026-07-21)**: 홈 상단 `#dealRadar`.
  - **①검색 기반(신뢰 백본)** = 저장된 분석결과에서 실제 딜 추출(`collect.js`, 브라우저 없이 즉시).
  - **②자동 크롤 특가** = **키워드 자동 크롤**(`keywords.js`, 큐레이션 `KEYWORDS` 로테이션 → `searchSimilar`) + 공홈(`registry.js`). **키워드는 `deep=true`라야 실쿠폰**(11번가·G마켓 extractPromos; 실측 G마켓 갤버즈3 -36%·-9만·쿠폰). 부속품/저가오인은 컷(유사도0.45+가격하한). 느려서 **백그라운드/스케줄러 전용**(`kickDealsRefresh`, `HOGU_REFRESH_MIN`), `GET /api/deals`는 캐시 즉시반환+stale시 백그라운드 갱신.
  - **⚠ 공홈 자동수집은 비신뢰 확정**(4라운드 정찰): 쿠쿠도 표준목록 정가=판매가(할인0·부속품), 할인은 기획전(JS·배너파일명 제목)뿐. LG/삼성 가격 미렌더(§6). → registry에 되는 몰만 베스트에포트(쿠쿠 기획전). **키워드 딥크롤이 오픈마켓 딜을 이미 커버**하므로 쇼킹딜/슈퍼딜 전용 파서는 선택. 약관/robots 검토 선행.
- **성능**: 정밀검색 4개 몰 순차 크롤로 ~28초. 실서비스엔 결과 캐싱(같은 검색어 재요청 즉시 응답)이 큰 개선.
- **수익화**(사용자 목표): 광고 붙일 계획 → 각 몰 이용약관·robots 검토, 어필리에이트(쿠팡파트너스·네이버 등) 전환 고려 권장.
- 저장소 Public이라 크롤링 코드 공개됨.

## 9. 사용자 컨텍스트
- 사용자(yunseok-map)는 한국어로 소통, 빠른 진행 선호(작업 중 멈추면 답답해함 — 끝까지 진행할 것).
- "저장소에도 올려줘/커밋해줘" 하면 위 §1 배포 절차로 GitHub에 push.

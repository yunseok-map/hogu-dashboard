# 호구체크 — 작업 인수인계 (HANDOFF)

> **새 채팅에서 이 프로젝트를 이어갈 때 이 파일을 먼저 읽으면 된다.**
> 상세 규칙은 아래 문서들에 나눠져 있다: 아키텍처=`CLAUDE.md`, UI=`docs/DESIGN.md`, 검색 정밀도=`docs/SEARCH-PRECISION.md`.
> 작업 전 프로젝트 스킬 `token-diet`(항상)·`ui-work`(UI 작업 시) 로드 필수.

## 0. 한 줄 요약
상품 링크/키워드를 넣으면 시세·유사 상품·리뷰·쿠폰을 크롤링해 **호구지수(0~100)** 를 매기고, **쿠폰 적용 실구매가 기준 최저 딜**과 "왜 이득인지" 설득 문구까지 뽑아주는 로컬 웹앱(Node+Express, 포트 3311). 외부 LLM/유료 API 없음.

## 1. 어디서 작업하고, 어떻게 배포하나 (제일 중요 — 저장소가 2개다)

| 구분 | 경로 / URL | 용도 |
|---|---|---|
| **개발 워크트리** | `C:\Users\A\Desktop\claude-test\.claude\worktrees\product-price-comparison-dashboard-d6196a\hogu-dashboard` | 실제 개발·실행·테스트. `node_modules`/`data`/`.env`/`.claude`(스킬·에이전트) 여기 있음. 이 워크트리 git은 **all-food-map** 저장소(브랜치 `claude/product-price-comparison-dashboard-d6196a`)이고 hogu-dashboard는 그 하위 폴더 |
| **배포용 클린 저장소** | `C:\Users\A\AppData\Local\Temp\hogu-dashboard-repo` → **https://github.com/yunseok-map/hogu-dashboard** (브랜치 main) | 호구체크만 루트로 담은 깨끗한 저장소. **여기가 공개 제품 저장소.** `%TEMP%`라 지워질 수 있음(아래 재생성) |

**개발은 워크트리에서** 하고, GitHub에 올릴 땐 바뀐 파일을 클린 저장소로 복사→커밋→push 한다(경로 매핑: 워크트리의 `hogu-dashboard/X` → 클린 저장소의 `X`).

### 배포(동기화) 절차
```bash
SRC="C:/Users/A/Desktop/claude-test/.claude/worktrees/product-price-comparison-dashboard-d6196a/hogu-dashboard"
DST="/c/Users/A/AppData/Local/Temp/hogu-dashboard-repo"
# 클린 저장소가 사라졌으면 재생성:
[ -d "$DST/.git" ] || git clone https://github.com/yunseok-map/hogu-dashboard.git "$DST"
# 바뀐 파일만 복사 (예시) — git status로 확인 후:
cp "$SRC/src/search/searchProviders.js" "$DST/src/search/searchProviders.js"   # 필요한 파일들
cd "$DST" && git add -A
git -c user.name="yunseok-map" -c user.email="yunseok1312@gmail.com" commit -m "<메시지>
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```
- 커밋 author는 `yunseok-map / yunseok1312@gmail.com`.
- **절대 올리지 말 것**: `node_modules/`, `data/`(분석 기록·API키 무관), `.env`, `_*.png`(스크래치) — `.gitignore`가 잡지만 확인.
- 워크트리 자체(all-food-map)에 커밋할 필요는 보통 없음. GitHub 제품 저장소(클린)만 관리.

## 2. 실행 & 검증

```bash
cd <워크트리>/hogu-dashboard
npm install            # 최초 1회 (cheerio, express, playwright-core)
node server.js         # → http://localhost:3311  (포트 3311)
```
- **봇 차단 사이트(쿠팡 등)**: 서버가 실제 Chrome을 자동 실행(headless 아님, 화면 밖)해 CDP(9222)로 붙어 크롤링. `npm run chrome`으로 직접 띄워 둬도 됨. `HOGU_NO_AUTO_CHROME=1`로 끔.
- **네이버 쇼핑 API**(선택): `.env`에 `NAVER_CLIENT_ID/SECRET` 넣으면 활성. 없어도 동작.

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
  docs/DESIGN.md         UI 스펙 (팔레트·컴포넌트·반응형)
  docs/SEARCH-PRECISION.md  유사도 규칙 + 검증 케이스
  tools/                 probe·search-probe·mall-probe·launch-chrome (진단·실행 도구)
  test/                  precision-test.mjs (유사도 회귀 테스트)
  .claude/               skills(token-diet, ui-work) + agents(cheap-probe) + launch.json  (워크트리에만)
```

## 4. 핵심 동작

**크롤링(LLM/유료API 없음, 3단계 자동)**: ①일반 HTTP → ②차단 시 실제 Chrome 자동실행+CDP(오리진 워밍업) → ③headless 폴백.

**가격 소스**: 기본 = 다나와·에누리(HTTP) + 웹(DuckDuckGo). **정밀검색(UI 체크박스, deep=1)** = + SSG·11번가·옥션·G마켓(실제 Chrome, **반드시 순차 실행** — 동시 실행 시 렌더 방해로 0건). 검색당 최대 ~150건.

**유사도 엔진**(`similarity`, 규칙은 SEARCH-PRECISION.md): tok 한글-숫자 분리 → 가중 자카드(STOP 하향) → 모델코드 정규화(다른 모델 0.3캡) → 스펙(용량/크기/oz·ml·L→ml, 같으면 +0.12·다르면 ×0.5) → 변형 키워드(프로/에어/맥스/세대, 한쪽만 ×0.4) → 세대번호(아이폰15 vs 14, 0.3캡) → 부속품 3중 방어(어댑터/필터 등 `it.accessory`로 verdict 비교군 원천 배제).

**호구지수**: 백분위50 + 중앙값프리미엄25 + 최저가과지불20 ± 평점10. 등급 개이득→적정가→조금비쌈→호구주의→호구확정.

**쿠폰·딜**: `promoDiscount`가 "N원/N% 쿠폰" 파싱 → `effPrice`(실구매가). `buildDealPitch`가 **실구매가 최저** 딜 선정. 단, **내 가격이 이미 최저면** `kind:'already-best'`("지금이 최저가", 흰 카드, 오해 방지), 더 싼 딜 있을 때만 `kind:'better-deal'`("여기서 사면 더 쌉니다", 사러 가기).

## 5. UI (v5 키네틱 브루탈리즘 + 네온 시트러스 팔레트)
- 브루탈리즘 구조: 2px 잉크 보더 + 하드 오프셋 섀도, 초대형 타이포, 마퀴 티커, 스티커 판정, 바버폴 미터.
- **팔레트(네온 시트러스)**: 바탕 라일락 `#f6f5ff`(+방안지 도트) · 메인 바이올렛 `#6d3bff`(검사버튼/링크/번호) · 포인트 옐로우 `#ffd43a`(딜/하이라이트/배지) · 잉크 `#17141f`. 티어색(개이득~호구)은 의미 스케일이라 별도 유지.
- 라이트 온리(다크 없음). 반응형 브레이크 680/980. `?id=` 딥링크.
- **UI 수정은 `ui-work` 스킬 로드 + `docs/DESIGN.md`만 읽고** (style.css/app.js 전체 읽기 금지).

## 6. 크롤링 불가 목록 (재시도 금지 — 실측 완료)
- **네이버 쇼핑 직접 크롤링**: 로그인 강제 + 캡차. (API 키는 별개, 가능)
- **삼성닷컴 / LG전자몰**: 실제 Chrome+스크롤로도 검색 가격 미렌더 → 상품명에 브랜드 감지 시 공식몰 **검색 링크**만 reviewSearchLinks에 추가함.
- **롯데온·티몬·위메프·GS샵·홈플러스·카카오·알리익스프레스**: SPA 인증벽/통화표기로 가격 못 뽑음.
- (참고) G마켓은 `browser.gmarket.co.kr` 서브도메인이 CDP goto 행 유발 → `www.gmarket.co.kr/n/search`로 해결됨(현재 정상).

## 7. 디자인 결정 히스토리 (되돌리지 말 것)
- UI 방향은 v1(카드 대시보드)·v2(토스풍)·v3(다크 글로우)·v4(종이 감정서)를 사용자가 전부 반려한 끝에 **v5 키네틱 브루탈리즘**을 AskUserQuestion에서 직접 선택.
- 색은 크림톤이 "Claude 티" 난다고 반려 → **네온 시트러스**(라일락/바이올렛/옐로우)를 직접 선택.

## 8. 남은 아이디어 / 다음 스텝
- **성능**: 정밀검색 4개 몰 순차 크롤로 ~28초. 실서비스엔 결과 캐싱(같은 검색어 재요청 즉시 응답)이 큰 개선.
- **수익화**(사용자 목표): 광고 붙일 계획 → 각 몰 이용약관·robots 검토, 어필리에이트(쿠팡파트너스·네이버 등) 전환 고려 권장.
- 저장소 Public이라 크롤링 코드 공개됨.

## 9. 사용자 컨텍스트
- 사용자(yunseok-map)는 한국어로 소통, 빠른 진행 선호(작업 중 멈추면 답답해함 — 끝까지 진행할 것).
- "저장소에도 올려줘/커밋해줘" 하면 위 §1 배포 절차로 GitHub에 push.

# 호구체크 — 호구 방지 대시보드

상품 링크(또는 키워드)를 넣으면:

1. **상품 정보 크롤링** — 제목·가격·이미지·평점·리뷰 수 (JSON-LD / OpenGraph / 사이트별 어댑터)
2. **유사 상품 검색** — 다나와 + 에누리 크롤링(키 불필요) + 웹 검색 + 네이버 쇼핑 API(선택).
   **정밀검색(기본 켜짐)**: SSG·11번가·옥션·G마켓을 실제 Chrome으로 직접 뒤져서 합산(+15초쯤). 검색당 최대 ~150개 추출해 유사도 계산
3. **쿠폰·이벤트 표시** — 각 판매처의 쿠폰/할인/무료배송/사은품 문구를 뽑아 상품 옆 배지로 표시
4. **호구 판정** — 가격 분포에서 내 가격의 위치를 계산해 호구지수(0~100) 산출 (부속품은 시세 비교에서 자동 제외)
   - 🎉 개이득 → ✅ 적정가 → 🤔 조금 비쌈 → ⚠️ 호구 주의 → 🚨 호구 확정
5. **리뷰 판단** — 평점/리뷰 수 기반 평판 요약 + 구글/네이버/유튜브 후기 검색 링크
6. **대시보드** — 가격 분포 차트, 더 싼 대안 추천, 전체 유사 상품 정렬 테이블, 분석 히스토리

## 실행

```bash
cd hogu-dashboard
npm install
npm start        # → http://localhost:3311
```

크롤링은 **외부 LLM/유료 API 없이** 순수 Node 코드가 사이트를 직접 훑습니다. 3단계 자동 처리라 사용자는 URL만 넣으면 됩니다:

1. **일반 HTTP 요청**(빠름) — 대부분의 쇼핑몰
2. 차단·실패 시 → **서버가 실제 Chrome을 백그라운드(화면 밖)로 자동 실행**하고 CDP로 붙어 렌더링.
   OS가 정상 실행한 Chrome이라 자동화 지문이 없고, 대상 사이트 홈페이지를 먼저 방문해 세션 쿠키를 받은 뒤(워밍업) 상품 페이지로 이동 → **쿠팡(Akamai)급 차단도 통과**.
3. Chrome이 없으면 → playwright headless로 폴백. 그래도 실패하면 키워드+수동 가격 모드로 안내.

즉 **쿠팡 URL을 그냥 붙여넣으면 자동으로 크롤링**됩니다(첫 요청만 Chrome 실행·워밍업으로 수 초 소요). 자동 실행된 Chrome은 60초 유휴 시/서버 종료 시 정리됩니다.

### 참고
- Chrome 창을 직접 띄워 로그인 상태로 쓰고 싶으면 `npm run chrome` 후 서버를 켜면 그 Chrome에 붙습니다(선택).
- 자동 실행을 끄려면 환경변수 `HOGU_NO_AUTO_CHROME=1`.

## 네이버 쇼핑 API — 완전 선택사항

**필요 없음.** 다나와+에누리 크롤링만으로 검색당 유사 상품 ~80개(가격·평점·리뷰 수 포함)가 나온다.
네이버 쇼핑 자체는 로그인 강제 + 캡차라서 크롤링이 구조적으로 막혀 있고(실측 검증됨),
네이버 몰별 가격까지 원하면 무료 API 키를 넣는 방법뿐이다:

1. https://developers.naver.com/apps 에서 애플리케이션 등록 (검색 API, 무료)
2. `.env.example`을 `.env`로 복사하고 `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` 입력
3. 서버 재시작

## 사용 팁

- **쿠팡 등 봇 차단 사이트**: URL 대신 상품명을 키워드로 넣고 "내가 본 가격"을 직접 입력하면 판정 가능
- 가격 추출에 실패한 URL도 가격 수동 입력으로 판정 가능
- 히스토리는 `data/`에 로컬 저장 (100건 유지)

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/analyze/stream?url=…&price=…&deep=1` 또는 `?query=…` | SSE 진행상황 + 결과 (deep=1: 메이저몰 포함) |
| POST | `/api/analyze` `{url \| query, priceOverride?, deep?}` | 단발 분석 (스크립트용) |
| GET | `/api/history` / `/api/history/:id` | 히스토리 목록 / 상세 |
| DELETE | `/api/history/:id` | 기록 삭제 *(prod: 관리자)* |
| GET | `/api/price-history/:key` | 일자별 가격 시계열 |
| GET | `/api/deals` | 핫딜 레이더(검색기반 + 키워드/공홈) |
| POST | `/api/deals/refresh?malls=1` | 딜 강제 갱신(비블로킹) *(prod: 관리자)* |
| GET | `/api/watch` | 관심상품 목록 |
| POST | `/api/watch` / `/api/watch/remove` / `/api/watch/refresh` | 관심상품 담기/제외/재수집 *(prod: 관리자)* |
| GET | `/api/health` | 서버·환경·방어 상태 |

## 환경 분리 (QA / prod)

`HOGU_ENV`로 **QA(로컬 개발)** 와 **prod(배포/운영)** 를 나눈다. `.env.<env>` → `.env` 순으로 로드.

```bash
node server.js                 # 기본 QA (방어 off, 무제한)
HOGU_ENV=prod node server.js   # 운영 (방어계층 ON)
```

- **QA**: 모든 엔드포인트 개방(개발 편의). 단 사설/루프백 IP 크롤은 항상 차단.
- **prod**: ①IP 레이트리밋 ②전역 동시성 캡 ③SSRF 차단(사설IP + 쇼핑몰 allowlist) ④쓰기/무거운 엔드포인트 관리자 토큰(`HOGU_ADMIN_TOKEN`, `x-hogu-admin` 헤더). 관심상품·딜 새로고침 버튼은 자동 숨김.
- 데이터도 분리 가능: `HOGU_DATA_DIR=./data-prod`. 설정값은 **`.env.qa.example` / `.env.prod.example`** 참고(복사해서 `.env.qa` / `.env.prod`로).

## 배포 — Cloudflare Tunnel (권장)

크롤러가 **로컬 실제 Chrome**에 의존하므로 compute는 이 PC에 두고 공개만 Cloudflare로 낸다. 서버리스(Pages/Workers)엔 그대로 못 올라간다.

```bash
# 1) 운영 서버 실행 (관리자 토큰 필수)
#    .env.prod 준비 후:
HOGU_ENV=prod node server.js

# 2) 터널로 공개 URL 발급
winget install --id Cloudflare.cloudflared        # 최초 1회
cloudflared tunnel --url http://localhost:3311    # 즉석 https://*.trycloudflare.com
#   영구 도메인: cloudflared tunnel login → create → route dns → run → service install
```

> ⚠️ 공개 시 앱엔 계정이 없으므로 **prod 모드 + 관리자 토큰**이 안전장치다. 한 대에서 **순차 크롤**이라 대량 동시접속용은 아니며, 각 쇼핑몰 이용약관·robots 확인은 운영자 책임.

> 📋 **운영자가 직접 해야 할 것**(Cloudflare 계정·도메인, GitHub 저장소/환경 전략, 상시구동, 운영정책, 법무) 전체 체크리스트는 **[docs/ops/DEPLOY.md](docs/ops/DEPLOY.md)** 참고.

## 개발용 프로브 (토큰 절약)

```bash
node tools/probe.mjs <상품URL>          # 파서 검증 — 압축 요약만 출력
node tools/search-probe.mjs "<검색어>"   # 검색 제공자 검증
```

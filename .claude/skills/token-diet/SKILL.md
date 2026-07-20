---
name: token-diet
description: hogu-dashboard 개발 시 토큰 소모를 최소화하는 작업 규칙. 크롤러 디버깅, 파서 수정, 검색 제공자 테스트, 대시보드 기능 추가 등 이 저장소 작업 전에 로드해서 따른다.
---

# 토큰 다이어트 — hogu-dashboard 개발 규칙

이 프로젝트는 외부 사이트 크롤링을 다루므로 **원본 HTML/대용량 JSON을 컨텍스트에 넣는 순간 토큰이 폭발**한다. 아래 규칙을 따른다.

## 1. 라이브 페이지 확인은 무조건 프로브로
- 파서가 잘 되는지: `node tools/probe.mjs <URL>` (압축 요약 JSON만 출력, HTML 미노출)
- 검색이 잘 되는지: `node tools/search-probe.mjs "<검색어>"` (제공자별 카운트+통계만)
- WebFetch로 쇼핑몰 페이지를 직접 가져오지 말 것 — 수만 토큰짜리 HTML이 컨텍스트에 들어온다.

## 2. 반복 검증은 cheap-probe 에이전트에 위임
같은 프로브를 여러 URL/키워드로 반복 실행해야 하면 `cheap-probe` 에이전트(haiku)를 사용한다.
메인 세션에는 요약만 돌아온다.

## 3. 파서 디버깅이 필요할 때 (프로브로 부족한 경우)
HTML 구조를 봐야 하면 전체 덤프 대신 **필요한 조각만** 추출한다:
```powershell
# 예: 특정 셀렉터 주변 200자만
node -e "fetch('URL',{headers:{'User-Agent':'Mozilla/5.0'}}).then(r=>r.text()).then(h=>{const i=h.indexOf('prod_item');console.log(h.slice(i,i+200))})"
```
스크래치패드에 저장 후 Grep으로 패턴만 확인하는 것도 좋다. Read로 통째로 열지 말 것.

## 4. 읽기 금지 목록
- `node_modules/**` — 절대 읽지 않는다
- `data/results/*.json` — 분석 결과 원본(수백 KB). 필드가 필요하면 PowerShell `ConvertFrom-Json | Select`로 추출
- `data/history.json` — 요약이 필요하면 `Invoke-RestMethod http://localhost:3311/api/history | Select -First 3`

## 5. 서버 재시작
src/ 수정 후에는 서버 재시작 필요 (ESM 모듈 캐시). 브라우저 preview_stop → preview_start (launch.json의 "hogu" 설정 사용).

## 6. 파일 구조 (다시 탐색하지 말 것)
```
hogu-dashboard/
  server.js            Express + SSE, API 엔드포인트 전부 여기
  src/crawl/           fetchPage.js(위장 fetch), browserFetch.js(CDP/headless 크롤)
  src/search/          productParser.js(상품 파싱), searchProviders.js(몰 검색 + 유사도)
  src/verdict.js       호구지수 스코어링 + 딜 선정
  src/store.js         히스토리 저장
  public/              프런트 (index.html, app.js, style.css)
  docs/DESIGN.md       UI 스펙 — UI 작업은 ui-work 스킬 로드 후 이것만 읽기
  tools/               probe.mjs, search-probe.mjs, mall-probe.mjs, launch-chrome.mjs
  test/                precision-test.mjs (유사도 회귀 테스트)
```

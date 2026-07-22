# 배포 상태 & 재개 리포트 (2026-07-22)

> **재부팅/새 세션에서 이어갈 때 이 파일 + `HANDOFF.md`를 먼저 읽으면 된다.**
> 목적: 무인 배포가 라이브인 상태에서, 재부팅 검증 → 이어서 **보안 패치(S1·S2·S3)** 진행.

## 1. 현재 배포 (라이브)
- **공개 URL**: https://hogu-check.tailac5115.ts.net  (Tailscale Funnel, 무료·고정)
- **prod 서버**: `HOGU_ENV=prod`, 포트 **3390**, 데이터 `data-prod/`, 스케줄러 180분. 방어 ON(레이트리밋·동시성캡·SSRF·관리자게이트), **히스토리 목록 비공개**.
- **QA(개발)**: 포트 3311 (`npm run start:qa`), 방어 off.
- **origin**: github.com/yunseok-map/hogu-dashboard (main). 최신 커밋에 배포/방어/문서 전부 포함.

## 2. 무인 구동 구성 (재부팅해도 살아남게)
| 요소 | 방법 | 상태 |
|---|---|---|
| 로그온 자동 실행 | 시작프로그램 바로가기 `호구체크-prod.lnk` → `start-hogu-prod.bat` | ✅ |
| 크래시 자동 재시작 | `.bat` 무한 루프(node 죽으면 5초 후 재시작) | ✅ |
| 절전 안 함 | `powercfg /change standby-timeout-ac/dc 0` + hibernate 0 | ✅ |
| 자동 로그인 | **Sysinternals Autologon**(`C:\Users\A\Downloads\Autologon64.exe`)로 설정함 — **재부팅으로 검증 필요** | ⏳ |
| 터널 유지 | tailscaled 윈도우 서비스가 Funnel 설정 유지(서버만 살아있으면 됨) | ✅ |

> 참고: 이 앱 크롤러는 실제 데스크톱 크롬이 필요 → SYSTEM 무인 실행은 쿠팡·정밀검색이 깨져서, **자동 로그인 + 로그온 자동실행**으로 감(크롤러 온전).

## 3. 재부팅 후 확인 체크리스트
1. 부팅 시 **로그인 화면 없이 바로 데스크톱** 뜨나? (자동 로그인 성공)
   - 안 되면: 설정 → 계정 → 로그인 옵션 → "Windows Hello 로그인만 허용" **끄고** Autologon 다시 Enable.
2. 최소화된 검은 창 **`HOGU PROD 3390`** 떠 있나? (= 서버 실행 중)
3. 로컬 확인: `curl -s localhost:3390/api/health` → `"env":"prod"`
4. 공개 확인: 브라우저로 **https://hogu-check.tailac5115.ts.net** → 정상 로딩
   - 502 뜨면 서버가 안 뜬 것 → `C:\Users\A\Desktop\hogu-check\start-hogu-prod.bat` 더블클릭.
5. (문제 진단) 좀비 node가 3390을 물면: 작업관리자에서 node 전부 종료 후 `.bat` 재실행.

## 4. 비밀·파일 위치
- **관리자 토큰**: `.env.prod`의 `HOGU_ADMIN_TOKEN` (gitignore, 커밋 안 됨). 관리 API는 `x-hogu-admin` 헤더로.
- 런처: `start-hogu-prod.bat`(운영) / `start-hogu-qa.bat`(개발) / `npm run start:{prod,qa}`.
- 운영 셋업 가이드: `docs/ops/DEPLOY.md`.

---

## 5. ▶ 다음 작업: 보안 패치 S1 · S2 · S3 (재부팅 후 바로)

> 새 세션에서 "보안 S1 S2 S3 가자" 하면 진행. 아래는 구현 메모.

### S1. 관리자 토큰 교체 (임시→본인) — ⚡1분
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# → .env.prod 의 HOGU_ADMIN_TOKEN= 값 교체 → prod 서버 재시작(.bat 창 닫고 재실행)
```

### S2. 보안 헤더 (server.js, zero-dep 미들웨어) — ⚡낮음
`app` 생성 직후·`express.static` 앞에 추가:
```js
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; " +
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; " +
    "script-src 'self'; connect-src 'self'");
  next();
});
```
⚠ 적용 후 **홈 로드해서 콘솔 CSP 위반 없나 확인**(외부 폰트: Pretendard=jsdelivr, Google Fonts=googleapis/gstatic 허용해둠. 인라인 style 속성 있어 style-src에 'unsafe-inline' 포함). 위반 뜨면 해당 소스 추가.

### S3. deep 요청 강한 레이트리밋 (guard.js + server.js) — ⚡낮음
deep=1(크롬 ~30초, 무거움)만 별도 더 낮은 상한.
- `guard.js`: `hitRateLimit`을 name별 커스텀 상한 받게 확장하거나, `hitRateLimitDeep(ip)`(예: 3회/5분) 추가.
- `server.js` analyze(SSE/POST)에서 `input.deep`면 일반 리밋 + deep 리밋 둘 다 통과해야 진행.
- env: `HOGU_DEEP_MAX`(기본 3) 추가.

---

## 6. 전체 개선/보안 리스트업 (백로그)
**보안**: S1 토큰교체 · S2 보안헤더 · S3 deep리밋 · S4 전역 분당상한+대기열 · S5 접근로그+이상알림 · S6 리다이렉트 검증(오픈리다이렉트) · S7 결과 id 랜덤성↑ · S8 npm audit/업데이트 · S9 크롤러 리소스 상한 · S10 커지면 Cloudflare named tunnel+WAF.
**고도화**: P1 결과 캐싱(임팩트 최대) · P2 요청 대기열+진행순번 · P3 관심상품 일자별 자동수집 완성 · P4 핫딜 소스 확장(쇼킹딜/슈퍼딜·키워드 UI) · P5 몰간 canonical 상품키 · P6 어필리에이트 전환(수익화) · P7 a11y/모바일 · P8 관측 대시보드 · P9 데이터 보존·백업 · P10 통합테스트 · P11 공홈 확장 · P12 OG태그/PWA.

**추천 순서**: (지금) S1+S2+S3 → P1 결과캐싱 + S5 로그/모니터링 → (원하면) P6 수익화.

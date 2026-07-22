# 배포 & 운영자 셋업 가이드 (호구체크)

> 이 문서는 **운영자가 직접 해야 하는 것**과 **이미 코드/서버에 반영된 것**을 나눠 정리한다.
> 앱은 **로컬 실제 Chrome 크롤러 의존**이라 Cloudflare Pages/Workers(서버리스)엔 못 올라간다 →
> compute는 항상 켜지는 PC/서버에 두고, 공개만 **Cloudflare Tunnel**로 낸다.

---

## A. 이미 반영돼 있는 것 (당신이 안 해도 됨)

- [x] **환경 분리** `HOGU_ENV=qa|prod` (`src/env.js`, `.env.<env>`→`.env` 로드)
- [x] **운영 방어계층**(prod 전용, `src/guard.js`): IP 레이트리밋 · 전역 동시성 캡 · SSRF 차단(사설IP+쇼핑몰 allowlist) · 관리자 토큰 게이트(fail-closed)
- [x] 프런트: prod에서 관리자 전용 버튼 자동 숨김, `/api/health`에 env·guard 노출
- [x] 데이터 분리 지원: `HOGU_DATA_DIR`
- [x] 런처/스크립트: `npm run start:qa` / `npm run start:prod`
- [x] 예시 설정: `.env.qa.example` · `.env.prod.example` · `deploy/cloudflared-config.example.yml`

---

## B. 당신이 직접 해야 하는 것 (체크리스트)

### B1. 시크릿 / 토큰
- [ ] **관리자 토큰 교체**: 지금 임시로 생성돼 `.env.prod`에 들어가 있음 → 본인 값으로 바꿀 것.
  생성: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
  → `.env.prod`의 `HOGU_ADMIN_TOKEN=` 에 붙이고 prod 서버 재시작.
- [ ] `.env.prod` / `.env.qa` 는 **절대 커밋 금지**(이미 `.gitignore` 처리됨). 예시 파일만 저장소에.
- [ ] (선택) 네이버 쇼핑 API 키: https://developers.naver.com/apps 에서 발급 → `.env.prod`에 `NAVER_CLIENT_ID/SECRET`.

### B2. GitHub 저장소 & 환경 전략  ← "prod/qa 저장소 분리" 관련
> **권장: 저장소를 쪼개지 마라.** 이 앱은 코드가 환경-무관(behavior는 `HOGU_ENV`로만 갈림)이라
> 저장소를 2개로 나누면 **코드가 갈라져(drift) 유지보수만 2배**가 된다. 환경 차이는 **`.env.<env>`**에만 둔다.

권장 구조(한 저장소):
- [ ] `main` = 개발/QA 라인. 여기서 개발 → QA에서 검증.
- [ ] `prod`(또는 `release`) 브랜치 = 운영 배포 라인. QA 통과분만 `main`→`prod`로 머지/태그.
- [ ] 운영 서버는 **`prod` 브랜치를 pull** 해서 `npm run start:prod`.
- [ ] (CI/CD 쓸 경우) GitHub → Settings → **Environments**에 `qa`/`production` 만들고 **시크릿은 여기**(코드/파일 아님)에 저장. 배포 승인 게이트도 여기서.
- [ ] 배포 흐름: `main`에 개발 → QA 확인 → `prod`로 승격(merge/tag) → 운영 서버에서 `git pull` + 재시작.

정말로 물리 분리를 원하면(비권장): dev=`hogu-dashboard`, 운영 미러=`hogu-dashboard-prod` 를 만들고
`git push prod main` 같은 **미러 remote**로 단방향 동기화. (드리프트 위험 감수)

### B3. Cloudflare 계정 + 영구 도메인(Named Tunnel)
> 지금 떠 있는 `*.trycloudflare.com`은 **임시**(재부팅/프로세스 종료 시 사라지고 URL도 바뀜).
> 상시 공개하려면 아래를 **직접**(브라우저 로그인 필요) 해야 한다.

- [ ] Cloudflare 무료 계정 생성.
- [ ] 도메인을 Cloudflare에 연결(보유 도메인 네임서버를 Cloudflare로 이전, 또는 신규 구매).
- [ ] 로그인: `cloudflared tunnel login`  ← 브라우저 인증(운영자만 가능)
- [ ] 터널 생성: `cloudflared tunnel create hogu`  → `<UUID>.json` 크레덴셜 생김
- [ ] DNS 라우팅: `cloudflared tunnel route dns hogu hogu.내도메인.com`
- [ ] `deploy/cloudflared-config.example.yml`를 복사해 `%USERPROFILE%\.cloudflared\config.yml`로 저장하고 UUID/도메인 채움(ingress → `http://localhost:3390`).
- [ ] 실행: `cloudflared tunnel run hogu`
- [ ] 부팅 시 자동: `cloudflared service install`  ← 관리자 권한(윈도우 서비스 등록)
- [ ] (강력 권장) **Cloudflare Access(Zero Trust)** 로 접근 정책 추가, **WAF/Rate Limiting Rules**로 전역 남용 차단. (named tunnel + proxied 도메인이라야 사용 가능)

### B4. "항상 켜짐" 구성 (crawler는 상시 구동 필요)
- [ ] **머신 선택**: 크롤러는 실제 Chrome이 필요하고, **데이터센터 헤드리스는 쿠팡류에 차단**됨(문서 §6).
  → 실 데스크톱급 **Windows 머신(내 PC 또는 상시 켜두는 미니PC/윈도우 VPS)** 권장.
- [ ] **절전 방지**: 설정 → 전원 → 절전 "안 함", 디스크/네트워크 유지.
- [x] **자동 시작**(반영됨): `start-hogu-prod.bat`(크래시 자동 재시작 루프 + Funnel 재확인)을 **시작프로그램 폴더**(`shell:startup`)에 바로가기로 등록 → 로그온 시 최소화 실행. Tailscale은 윈도우 서비스라 자동 복구되고 Funnel 설정도 유지됨 → **재부팅 후 로그온만 하면 공개 URL 자동 부활**.
  - 배포=Tailscale Funnel일 때는 `cloudflared service install` 불필요(Tailscale 서비스가 담당).
- [x] **크래시 복구**(반영됨): `.bat` 루프가 서버 종료 감지 시 5초 후 재시작.
- [ ] (선택) 로그아웃 상태에서도 돌리려면 작업 스케줄러 "사용자 로그온 여부와 무관하게 실행" 또는 `nssm`으로 서비스화.

### B5. 운영 정책 결정(값만 정하면 됨 — `.env.prod`)
- [ ] `HOGU_ALLOWED_HOSTS` — 공개 크롤 허용 쇼핑몰 도메인. 미설정 시 내장 기본(쿠팡·11번가·G마켓·옥션·SSG·다나와·네이버 등). 좁히거나 넓힐지 결정.
- [ ] `HOGU_RATE_MAX` / `HOGU_RATE_WINDOW_MS` — IP당 분석 허용량(기본 8회/5분). 예상 트래픽에 맞게.
- [ ] `HOGU_CONCURRENCY` — 동시 크롤 상한(기본 2). 머신 성능/IP 차단 위험 고려.
- [ ] `HOGU_REFRESH_MIN` — 딜/관심상품 자동 재수집 주기(기본 180분).
- [x] **히스토리 공개 범위**: (반영됨) prod에선 `기록(history)` 목록이 **기본 비공개**(방문자에게 안 보임). 홈 RECORDS 인덱스·기록 배지·관심상품/새로고침 버튼 자동 숨김. 개별 공유 링크 `?id=` 와 딜 레이더(익명 딜 카드)는 유지. 공개(커뮤니티 피드처럼)로 바꾸려면 `.env.prod`에 `HOGU_PUBLIC_HISTORY=1`.

### B6. 법무 / 약관 (운영자 책임)
- [ ] 각 쇼핑몰 **이용약관 · robots.txt** 검토(공개 서비스로 크롤 시). 
- [ ] 수익화(광고/제휴) 시 **어필리에이트 정식 가입**(쿠팡파트너스·네이버 등)으로 전환 권장.
- [ ] 저장소가 **Public**이면 크롤링 코드가 공개됨 — 필요 시 Private 전환 검토.

---

## C. 실행 명령 요약

```bash
# 개발/QA (로컬, 방어 off)
npm run start:qa            # → http://localhost:3311

# 운영 (prod, 방어 on) — .env.prod 필요(토큰 포함)
npm run start:prod         # → http://localhost:3390  (PORT은 .env.prod)

# 공개(임시) — quick tunnel
cloudflared tunnel --url http://localhost:3390

# 공개(영구) — named tunnel (B3 완료 후)
cloudflared tunnel run hogu
```

## D. 내리기 / 롤백
- 공개 중단: `cloudflared`(터널) 프로세스 종료 → URL 즉시 무효.
- 서버 중단: 해당 `node`(prod) 종료.
- 코드 롤백: `git revert <커밋>` 후 운영 서버 재시작.

---

## E. 지금 상태 (2026-07-22 기준, 이 머신)
- prod 서버: `HOGU_ENV=prod` 로 **:3390** 구동(방어 ON, 데이터 `data-prod`, 스케줄러 180분).
- 임시 공개 URL: quick tunnel(`*.trycloudflare.com`) — **임시**. 영구화는 B3.
- `.env.prod`: 임시 관리자 토큰 포함(**B1에서 본인 값으로 교체 권장**).
- QA 서버: `:3311`(개발용).

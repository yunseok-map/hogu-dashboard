// 운영(prod) 런처 — 실행: `npm run start:prod`  또는  `node start-prod.mjs`
// HOGU_ENV를 강제로 prod로 지정한 뒤 서버를 로드한다(env.js가 .env.prod → .env 로드).
// ⚠ .env.prod에 HOGU_ADMIN_TOKEN을 반드시 설정하라(미설정 시 관리 엔드포인트 잠김).
process.env.HOGU_ENV = 'prod';
await import('./server.js');

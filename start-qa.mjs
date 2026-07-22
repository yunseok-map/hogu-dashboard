// QA(로컬 개발) 런처 — 실행: `npm run start:qa`  또는  `node start-qa.mjs`
// HOGU_ENV를 강제로 qa로 지정한 뒤 서버를 로드한다(env.js가 .env.qa → .env 로드).
process.env.HOGU_ENV = 'qa';
await import('./server.js');

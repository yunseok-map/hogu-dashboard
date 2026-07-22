// 검색 정밀도 자동 검증 — docs/search/SEARCH-PRECISION.md의 케이스와 동기화.
// 사용법: node test/precision-test.mjs   (실패 시 exit 1)
import { similarity } from '../src/search/searchProviders.js';

// 밴드: same ≥0.55 / variant <0.45 / accessory ≤0.20 / unrelated ≤0.15
const BAND = {
  same: (s) => s >= 0.55,
  variant: (s) => s < 0.45,
  accessory: (s) => s <= 0.20,
  unrelated: (s) => s <= 0.15,
};

const CASES = [
  ['아이폰 15 프로 256GB', [
    ['same', '애플 아이폰 15 프로 256GB 자급제'],
    ['same', 'APPLE 아이폰15 프로 256GB 자급제'],   // 붙여쓰기 정규화
    ['variant', '아이폰 15 프로맥스 256GB'],
    ['variant', '아이폰 15 에어 256GB'],
    ['variant', '아이폰 14 프로 256GB'],             // 다른 세대
    ['variant', 'APPLE 아이폰12 프로 256GB 공기계'], // 다른 세대(붙여쓰기)
    ['variant', '아이폰 15 128GB'],
    ['variant', '아이폰 15 프로 128GB'],
    ['accessory', '아이폰 15 프로 케이스'],
  ]],
  ['갤럭시 S24 울트라 256GB', [
    ['same', '삼성 갤럭시 S24 울트라 256GB 자급제'],
    ['variant', '갤럭시 S24 플러스 256GB'],
    ['variant', '갤럭시 S24 FE 128GB'],
    ['variant', '갤럭시 S24 울트라 512GB'],
  ]],
  ['에어팟 프로 2세대', [
    ['same', '애플 에어팟 프로 2세대 정품'],
    ['variant', '에어팟 3세대'],
    ['variant', '에어팟 맥스'],
  ]],
  ['스탠리 퀜처 40oz 텀블러', [
    ['same', '[해외]스탠리 홀리데이 데코 퀜처 텀블러 40oz Blush'],
    ['same', '스탠리 퀜처 H2.0 플로우스테이트 40oz 텀블러 1.18L 크림'],
    ['variant', '스탠리 퀜처 30oz 텀블러'],
  ]],
  ['다이슨 에어랩 스타일러 컴플리트', [
    ['variant', '다이슨 에어랩 스타일러 컴플리트 롱'],
    ['variant', '다이슨 에어랩 멀티 스타일러 컴플리트'],
  ]],
  ['갤럭시 버즈3 프로 SM-R630N', [
    ['same', '삼성전자 갤럭시 버즈3 프로 SM-R630N 정품'],
    ['variant', '삼성 갤럭시 버즈2 프로 SM-R510'],
    ['accessory', '갤럭시 버즈3 프로 실리콘 케이스'],
  ]],
];

let pass = 0, fail = 0;
for (const [ref, cands] of CASES) {
  console.log('\n■ ' + ref);
  for (const [want, cand] of cands) {
    const s = similarity(ref, cand);
    const ok = BAND[want](s);
    (ok ? pass++ : fail++);
    console.log(`  ${ok ? '✅' : '❌'} ${want.padEnd(9)} ${String(Math.round(s * 100) + '%').padStart(4)}  ${cand}`);
  }
}
console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);

/**
 * 호구 판정 엔진.
 * 유사 상품 가격 분포에서 내 가격의 위치(백분위) + 평점/리뷰 신호를 종합해
 * 호구지수(0~100, 높을수록 호구)와 한국어 판정문을 만든다.
 */

const won = (n) => (n == null ? '?' : n.toLocaleString('ko-KR') + '원');
const pct = (x) => Math.round(x * 100) + '%';

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

/**
 * @param {{price:number|null, rating:number|null, reviewCount:number|null, title:string}} product
 * @param {Array<{price:number|null, similarity:number, rating:number|null, reviewCount:number|null, title:string, link:string, mall:string|null, provider:string}>} items
 */
export function judge(product, items) {
  const myPrice = product.price;

  // 0) 부속품(어댑터/필터/케이스 등)은 시세 비교에서 원천 배제 — 본품 시세를 오염시킨다
  const pool = items.filter((it) => !it.accessory);
  const excludedAcc = items.filter((it) => it.accessory && it.price).length;

  // 1) 비교군 선정: 유사도 임계값을 점점 낮추며 최소 3개 확보
  let threshold = 0.45;
  let comparable = [];
  while (threshold >= 0.1) {
    comparable = pool.filter((it) => it.price && it.similarity >= threshold);
    if (comparable.length >= 3) break;
    threshold -= 0.1;
  }
  // 3개 미만이어도 "유사도 최소선(0.15)"은 지킨다 — 검색에 딸려온 무관 상품(타이어 등, 유사도 0)이
  // 시세를 오염시키거나 "최저 딜"로 뽑히는 것을 막는다. 정확한 소수가 부정확한 다수보다 낫다.
  if (comparable.length < 3) comparable = pool.filter((it) => it.price && it.similarity >= 0.15);

  // 2) 가격 이상치 제거 — 2단계(중앙값 재계산)로 오등록·벌크·기프트번들 극단값을 걷어낸다.
  //    액세서리는 이미 제외됐으므로 밴드를 좁게(0.35x~3x) 잡아 시세 왜곡을 줄인다.
  for (let pass = 0; pass < 2; pass++) {
    const sorted = comparable.map((it) => it.price).sort((a, b) => a - b);
    const m = quantile(sorted, 0.5);
    if (!m) break;
    comparable = comparable.filter((it) => it.price >= m * 0.35 && it.price <= m * 3);
  }
  const prices = comparable.map((it) => it.price).sort((a, b) => a - b);

  const stats = prices.length
    ? {
        count: prices.length,
        min: prices[0],
        max: prices[prices.length - 1],
        median: quantile(prices, 0.5),
        p25: quantile(prices, 0.25),
        p75: quantile(prices, 0.75),
        avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
      }
    : null;

  const reasons = [];
  const warnings = [];
  let score = null;
  let label, emoji, tier;

  if (myPrice == null) {
    warnings.push('내 상품 가격을 크롤링하지 못해 가격 판정을 건너뜁니다. 가격을 직접 입력하면 판정할 수 있습니다.');
  }
  if (!stats || stats.count < 3) {
    warnings.push(`비교 가능한 유사 상품이 ${stats?.count ?? 0}개뿐이라 판정 신뢰도가 낮습니다.`);
  }
  if (excludedAcc > 0) {
    warnings.push(`어댑터·필터 같은 부속품 ${excludedAcc}개는 시세 비교에서 제외했습니다.`);
  }

  if (myPrice != null && stats && stats.count >= 1) {
    // 3) 가격 백분위: 나보다 싼 상품 비율
    const cheaper = prices.filter((p) => p < myPrice).length;
    const percentile = cheaper / prices.length;
    const overpayVsMin = (myPrice - stats.min) / stats.min;
    const overpayVsMedian = (myPrice - stats.median) / stats.median;

    // 4) 스코어 조합: 백분위 50점 + 중앙값 프리미엄 25점 + 최저가 과지불 20점 + 평점 보정 ±10점
    score = percentile * 50;
    score += Math.max(0, Math.min(25, overpayVsMedian * 100 * 0.5));
    score += Math.max(0, Math.min(20, overpayVsMin * 100 * 0.4));
    if (product.rating != null) {
      if (product.rating >= 4.5 && (product.reviewCount ?? 0) >= 50) score -= 8;
      else if (product.rating >= 4.2) score -= 4;
      else if (product.rating < 3.5) score += 10;
    }
    score = Math.round(Math.max(0, Math.min(100, score)));

    // 5) 판정 문구
    if (myPrice <= stats.min) {
      reasons.push(`비교군 최저가(${won(stats.min)})와 같거나 더 쌉니다. 지금이 살 타이밍입니다.`);
    } else {
      reasons.push(`유사 상품 ${stats.count}개 중 ${pct(percentile)}가 이 상품보다 쌉니다.`);
      reasons.push(`최저가 ${won(stats.min)} 대비 ${won(myPrice - stats.min)} (+${pct(overpayVsMin)}) 더 비쌉니다.`);
      if (overpayVsMedian > 0) reasons.push(`중앙값 ${won(stats.median)} 대비 +${pct(overpayVsMedian)} 프리미엄이 붙어 있습니다.`);
      else reasons.push(`중앙값 ${won(stats.median)}보다는 ${pct(-overpayVsMedian)} 저렴한 편입니다.`);
    }
    if (product.rating != null) {
      if (product.rating >= 4.5) reasons.push(`평점 ${product.rating}점(리뷰 ${product.reviewCount ?? '?'}개) — 평판은 우수합니다.`);
      else if (product.rating < 3.5) reasons.push(`평점 ${product.rating}점 — 가격과 무관하게 품질 리스크가 있습니다.`);
    }
  }

  // 6) 등급
  if (score == null) {
    tier = 'unknown'; emoji = '❓'; label = '판정 불가';
  } else if (score <= 12) {
    tier = 'great'; emoji = '🎉'; label = '개이득';
  } else if (score <= 32) {
    tier = 'fair'; emoji = '✅'; label = '적정가';
  } else if (score <= 55) {
    tier = 'meh'; emoji = '🤔'; label = '조금 비쌈';
  } else if (score <= 75) {
    tier = 'bad'; emoji = '⚠️'; label = '호구 주의';
  } else {
    tier = 'hogu'; emoji = '🚨'; label = '호구 확정';
  }

  // 7) 추천 대안: 쿠폰 적용 "실구매가"가 싼 순 (평점 나쁜 것 제외)
  const eff = (it) => (it.effPrice != null ? it.effPrice : it.price);
  const alternatives = comparable
    .filter((it) => it.price != null && (myPrice == null || eff(it) < myPrice) && it.similarity >= Math.min(threshold, 0.3))
    .filter((it) => it.rating == null || it.rating >= 3.8)
    .sort((a, b) => eff(a) - eff(b))
    .slice(0, 5)
    .map((it) => ({
      ...it,
      savings: myPrice != null ? myPrice - eff(it) : null,
    }));

  // 8) 최저 실구매 딜 + "이래서 이득" 설득 문구
  const dealPitch = buildDealPitch(product, comparable, stats, myPrice, eff);

  // 9) 리뷰 종합 판단
  const reviewVerdict = buildReviewVerdict(product, comparable);

  // 실구매가 기준 최저가 (쿠폰 반영)
  const effMin = comparable.length ? Math.min(...comparable.filter((it) => it.price != null).map(eff)) : null;

  return {
    score, tier, emoji, label,
    reasons, warnings,
    stats,
    comparableCount: comparable.length,
    similarityThreshold: +threshold.toFixed(2),
    alternatives,
    dealPitch,
    reviewVerdict,
    savingsPotential: myPrice != null && effMin != null ? Math.max(0, myPrice - effMin) : null,
  };
}

/**
 * "이래서 이득" 안내를 만든다. 상황을 두 가지로 명확히 구분한다.
 *  - kind:'better-deal' — 내 가격보다 싼 딜이 실제로 있다 → 그 판매처로 "사러 가기"
 *  - kind:'already-best' — 내 가격이 이미 시세 최저 이하 → 다른 걸 사라고 하지 않고
 *                          "지금 가격이 이미 최저"임을 확정해준다 (헷갈림 방지)
 */
function buildDealPitch(product, comparable, stats, myPrice, eff) {
  const won = (n) => (n == null ? '?' : n.toLocaleString('ko-KR') + '원');
  const pct = (x) => Math.round(x * 100) + '%';
  // "이래서 이득"으로 내세우는 딜은 확실히 유사한 상품이어야 한다 (유사도 0.3↑). 없으면 안내 생략.
  let pool = comparable.filter((it) => it.price != null && it.similarity >= 0.3 && (it.rating == null || it.rating >= 3.8));
  if (!pool.length) pool = comparable.filter((it) => it.price != null && it.similarity >= 0.3);
  if (!pool.length) return null;
  const best = pool.reduce((a, b) => (eff(b) < eff(a) ? b : a));
  const bp = eff(best);
  const where = best.mall || best.provider;

  // 내 가격이 이미 시세 최저 이하 → "지금이 최저가" 프레임 (더 비싼 걸 사라고 하면 안 됨)
  if (myPrice != null && myPrice <= bp) {
    const lines = [`✅ 지금 보고 계신 <b>${won(myPrice)}</b>이 이미 시세 최저입니다. 더 싼 곳은 없어요.`];
    if (stats && stats.median && myPrice < stats.median) {
      const gap = stats.median - myPrice;
      lines.push(`📉 유사 상품 중앙값 ${won(stats.median)}보다 <b>${won(gap)}(${pct(gap / stats.median)})</b> 쌉니다.`);
    }
    if (bp > myPrice) lines.push(`🛒 다른 판매처 최저가도 ${where} ${won(bp)} — 그보다 <b>${won(bp - myPrice)}</b> 더 쌉니다.`);
    lines.push('🔥 망설일 이유가 없습니다. 이 가격이면 바로 사도 됩니다.');
    return {
      kind: 'already-best',
      myPrice,
      productUrl: product.url || null,
      marketLow: { price: bp, mall: best.mall, provider: best.provider },
      lines,
    };
  }

  // 그 외 → 더 싼 딜을 사러 가라
  const lines = [];
  if (best.discount > 0) {
    lines.push(`💳 ${where} 정가 ${won(best.price)}에서 쿠폰·할인 ${won(best.discount)}을 빼면 실구매가 <b>${won(bp)}</b>입니다.`);
  } else {
    lines.push(`🏷️ ${where}에서 <b>${won(bp)}</b>이 지금 잡을 수 있는 최저가입니다.`);
  }
  if (myPrice != null && bp < myPrice) {
    lines.push(`🎯 지금 보고 계신 ${won(myPrice)} 대신 이 딜을 잡으면 <b>${won(myPrice - bp)}</b> 아낍니다.`);
  }
  if (stats && stats.median && bp < stats.median) {
    const gap = stats.median - bp;
    lines.push(`📉 유사 상품 중앙값 ${won(stats.median)}보다 <b>${won(gap)}(${pct(gap / stats.median)})</b> 쌉니다.`);
  }
  if (best.rating != null && best.rating >= 4.3) {
    lines.push(`⭐ 평점 ${best.rating}점${best.reviewCount ? `(리뷰 ${best.reviewCount.toLocaleString('ko-KR')}개)` : ''}로 품질도 검증됐습니다.`);
  }
  const ship = (best.promos || []).find((p) => /무료배송|당일|내일도착|로켓|새벽/.test(p));
  if (ship) lines.push(`🚚 ${ship} 포함 — 배송비 부담도 없습니다.`);
  if (stats && stats.count >= 3) lines.push(`🔥 ${stats.count}개 판매처를 다 뒤진 결과입니다.`);

  return {
    kind: 'better-deal',
    best: {
      title: best.title, link: best.link, mall: best.mall, provider: best.provider,
      price: best.price, discount: best.discount || 0, effPrice: bp,
      rating: best.rating, reviewCount: best.reviewCount, promos: best.promos || [],
      savingsVsMine: myPrice != null ? Math.max(0, myPrice - bp) : null,
      savingsVsMedian: stats && stats.median ? Math.max(0, stats.median - bp) : null,
    },
    lines,
  };
}

function buildReviewVerdict(product, comparable) {
  const lines = [];
  let sentiment = 'unknown';
  if (product.rating != null) {
    const rc = product.reviewCount ?? 0;
    if (product.rating >= 4.5 && rc >= 100) { sentiment = 'good'; lines.push('평점과 리뷰 수 모두 탄탄합니다. 제품 자체는 믿을 만합니다.'); }
    else if (product.rating >= 4.2) { sentiment = 'good'; lines.push('평점이 준수합니다. 큰 품질 이슈는 없어 보입니다.'); }
    else if (product.rating >= 3.5) { sentiment = 'mixed'; lines.push('평점이 애매합니다. 낮은 별점 리뷰를 직접 확인해 보세요.'); }
    else { sentiment = 'bad'; lines.push('평점이 낮습니다. 싸더라도 거르는 게 나을 수 있습니다.'); }
    if (rc > 0 && rc < 20) lines.push(`리뷰가 ${rc}개뿐이라 표본이 작습니다. 평점을 그대로 믿기는 이릅니다.`);
  } else {
    lines.push('이 페이지에서 평점을 추출하지 못했습니다. 아래 유사 상품의 평점과 후기 검색 링크를 참고하세요.');
  }
  // 비교군 평점 컨텍스트
  const rated = comparable.filter((it) => it.rating != null);
  if (rated.length >= 3) {
    const avg = +(rated.reduce((s, it) => s + it.rating, 0) / rated.length).toFixed(2);
    lines.push(`유사 상품 ${rated.length}개의 평균 평점은 ${avg}점입니다.`);
    if (product.rating != null) {
      if (product.rating >= avg + 0.3) lines.push('동급 대비 평판이 좋은 편입니다.');
      else if (product.rating <= avg - 0.3) lines.push('동급 대비 평판이 떨어집니다. 대안을 고려하세요.');
    }
  }
  return { sentiment, lines };
}

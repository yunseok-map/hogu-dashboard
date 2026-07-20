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
  if (comparable.length < 3) comparable = pool.filter((it) => it.price);

  // 2) 가격 이상치 제거 (중앙값의 0.25x~4x 범위만) — 액세서리/벌크 상품 오염 방지
  const rawPrices = comparable.map((it) => it.price).sort((a, b) => a - b);
  const median0 = quantile(rawPrices, 0.5);
  if (median0) {
    comparable = comparable.filter((it) => it.price >= median0 * 0.25 && it.price <= median0 * 4);
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

/** 최저 실구매 딜을 골라 "왜 이득인지" 구매 욕구를 자극하는 문구를 만든다. */
function buildDealPitch(product, comparable, stats, myPrice, eff) {
  const won = (n) => (n == null ? '?' : n.toLocaleString('ko-KR') + '원');
  const pct = (x) => Math.round(x * 100) + '%';
  // 후보: 가격 있고, 평점이 나쁘지 않은 것 중 실구매가 최저
  const pool = comparable.filter((it) => it.price != null && (it.rating == null || it.rating >= 3.8));
  if (!pool.length) return null;
  const best = pool.reduce((a, b) => (eff(b) < eff(a) ? b : a));
  const bp = eff(best);

  const lines = [];
  const where = best.mall || best.provider;
  if (best.discount > 0) {
    lines.push(`💳 ${where} 정가 ${won(best.price)}에서 쿠폰·할인 ${won(best.discount)}을 빼면 실구매가 <b>${won(bp)}</b>입니다.`);
  } else {
    lines.push(`🏷️ ${where}에서 <b>${won(bp)}</b>이 지금 잡을 수 있는 최저가입니다.`);
  }
  if (stats && stats.median && bp < stats.median) {
    const gap = stats.median - bp;
    lines.push(`📉 유사 상품 중앙값 ${won(stats.median)}보다 <b>${won(gap)}(${pct(gap / stats.median)})</b> 쌉니다.`);
  }
  if (myPrice != null && bp < myPrice) {
    lines.push(`🎯 지금 보고 계신 ${won(myPrice)} 대신 이 딜을 잡으면 <b>${won(myPrice - bp)}</b> 아낍니다.`);
  }
  if (best.rating != null && best.rating >= 4.3) {
    lines.push(`⭐ 평점 ${best.rating}점${best.reviewCount ? `(리뷰 ${best.reviewCount.toLocaleString('ko-KR')}개)` : ''}로 품질도 검증됐습니다.`);
  }
  const ship = (best.promos || []).find((p) => /무료배송|당일|내일도착|로켓|새벽/.test(p));
  if (ship) lines.push(`🚚 ${ship} 포함 — 배송비 부담도 없습니다.`);
  // 마무리 한 방
  if (stats && stats.count >= 3) {
    lines.push(`🔥 ${stats.count}개 판매처를 다 뒤진 결과입니다. 더 싼 곳은 안 나옵니다.`);
  }

  return {
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

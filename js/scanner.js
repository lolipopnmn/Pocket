/* Проверка стратегий на истории и подбор лучшей пары.
   Принцип: стратегия вносит вклад в сигнал, только если на истории ЭТОЙ пары у неё есть преимущество
   над точкой безубыточности. Оценка процента угаданных сглажена (априорные 10 побед и 10 проигрышей),
   чтобы пара удачных сделок на малой выборке не выглядела как закономерность. */
(function (root) {
  if (!root.Strategies && typeof require !== 'undefined') require('./strategies.js');
  const { list, WARMUP } = root.Strategies;
  const HORIZONS = [1, 2, 3]; // экспирация в свечах выбранного таймфрейма
  const PRIOR = 10;

  const breakeven = (payout) => 1 / (1 + payout / 100);

  // Вход по закрытию свечи i, результат по закрытию свечи i+h. Равенство цен считается возвратом ставки.
  // from/to ограничивают диапазон сигналов (для проверки на половинах истории).
  function backtest(closes, sig, h, from = WARMUP, to = closes.length - h) {
    let w = 0, l = 0, d = 0;
    const end = Math.min(to, closes.length - h);
    for (let i = from; i < end; i++) {
      const s = sig[i];
      if (!s) continue;
      const a = closes[i], z = closes[i + h];
      if (z === a) d++;
      else if ((s > 0) === (z > a)) w++;
      else l++;
    }
    return { w, l, d, n: w + l };
  }
  const shrink = (b) => (b.w + PRIOR) / (b.n + 2 * PRIOR);

  function analyzePair(candles, payout = 85) {
    if (candles.length < WARMUP + 60) throw new Error('Мало свечей для анализа');
    const closes = candles.map(x => x.c), idx = candles.length - 1, be = breakeven(payout);
    // История делится пополам: стратегия допускается в сигнал, только если преимущество есть и в первой,
    // и во второй половине. Так отсекается то, что «повезло» на одном отрезке (из ~190 проверяемых вариантов
    // часть всегда выглядит хорошо случайно).
    const mid = Math.floor((WARMUP + closes.length) / 2);
    const per = list.map(s => {
      const sig = s.signals(candles), stats = {};
      for (const h of HORIZONS) {
        const b = backtest(closes, sig, h);
        const A = backtest(closes, sig, h, WARMUP, mid), B = backtest(closes, sig, h, mid);
        const adj = shrink(b), adjA = shrink(A), adjB = shrink(B);
        stats[h] = { ...b, adj, edge: adj - be, a: { ...A, adj: adjA }, b: { ...B, adj: adjB },
          ok: adj > be && adjA > be && adjB > be };
      }
      return { id: s.id, name: s.name, dir: sig[idx], stats };
    });

    let best = null;
    for (const h of HORIZONS) {
      let score = 0;
      for (const p of per) if (p.dir && p.stats[h].ok) score += p.dir * p.stats[h].edge;
      if (score !== 0 && (!best || Math.abs(score) > Math.abs(best.score))) best = { h, score, dir: Math.sign(score) };
    }
    if (best) {
      best.contrib = per
        .filter(p => p.dir === best.dir && p.stats[best.h].ok)
        .map(p => ({ id: p.id, name: p.name, ...p.stats[best.h] }));
      best.score = Math.abs(best.score);
    }
    return { per, best, be, last: candles[idx], firing: per.filter(p => p.dir).length };
  }

  // results: [{pair, res}] -> отсортированный список только пар с сигналом
  function rank(results) {
    return results.filter(r => r.res && r.res.best).sort((a, b) => b.res.best.score - a.res.best.score);
  }

  root.Scanner = { analyzePair, rank, backtest, breakeven, HORIZONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Scanner;
})(typeof window !== 'undefined' ? window : globalThis);

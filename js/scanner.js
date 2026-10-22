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

  // Стратегия считается «действующей», если сработала на одной из последних LOOKBACK закрытых свечей
  // (последнее событие и задаёт сторону). Два разных индикатора редко подают сигнал на одной и той же свече,
  // поэтому строгое совпадение по одной свече почти никогда не выполнялось бы.
  const LOOKBACK = 3;
  function active(sig, idx) {
    for (let k = 0; k < LOOKBACK && idx - k >= 0; k++) if (sig[idx - k]) return { dir: sig[idx - k], age: k };
    return { dir: 0, age: 0 };
  }

  // minAgree: сколько стратегий должно совпасть в одну сторону. Подтверждённая стратегия против сигнала
  // отменяет его. Из допустимых вариантов выбирается тот, у которого больше суммарное преимущество.
  function analyzePair(candles, payout = 85, minAgree = 2) {
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
      const act = active(sig, idx);
      return { id: s.id, name: s.name, dir: act.dir, age: act.age, stats };
    });

    const cands = [];
    for (const h of HORIZONS) for (const dir of [1, -1]) {
      const contrib = per.filter(p => p.dir === dir && p.stats[h].ok)
        .map(p => ({ id: p.id, name: p.name, age: p.age, ...p.stats[h] }));
      if (!contrib.length) continue;
      const against = per.filter(p => p.dir === -dir && p.stats[h].ok).length;
      cands.push({ h, dir, count: contrib.length, against, score: contrib.reduce((a, c) => a + c.edge, 0), contrib });
    }
    const clean = cands.filter(c => !c.against);
    const best = clean.filter(c => c.count >= minAgree).sort((a, b) => b.score - a.score)[0] || null;
    const partial = best ? null : (clean.sort((a, b) => b.count - a.count || b.score - a.score)[0] || null);
    return { per, best, partial, minAgree, be, last: candles[idx], firing: per.filter(p => p.dir).length };
  }

  // results: [{pair, res}] -> отсортированный список только пар с сигналом
  function rank(results) {
    return results.filter(r => r.res && r.res.best).sort((a, b) => b.res.best.score - a.res.best.score);
  }

  // Пары, где подтверждена только часть нужных правил: показываются как «ближе всего», входить по ним нельзя
  function nearMiss(results) {
    return results.filter(r => r.res && !r.res.best && r.res.partial)
      .sort((a, b) => b.res.partial.count - a.res.partial.count || b.res.partial.score - a.res.partial.score);
  }

  root.Scanner = { analyzePair, rank, nearMiss, backtest, breakeven, HORIZONS, LOOKBACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Scanner;
})(typeof window !== 'undefined' ? window : globalThis);

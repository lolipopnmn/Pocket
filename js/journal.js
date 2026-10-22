/* Журнал сигналов: каждый показанный сигнал записывается, а после экспирации результат проверяется
   по реальным свечам. Это проверка «вперёд» на данных, которых сигнал не видел: единственная цифра,
   которой можно доверять больше, чем бэктесту. Чистые функции, хранилище подключает app.js. */
(function (root) {
  if (!root.Data && typeof require !== 'undefined') require('./data.js');
  const MAX = 300;

  const key = (e) => [e.pair, e.tf, e.t0, e.h, e.dir].join('|');

  // sig: { pair, tf, t0 (время свечи сигнала), price (её закрытие), dir (+1/-1), h (свечей до экспирации) }
  function add(entries, sig) {
    if (entries.some(e => key(e) === key(sig))) return entries;
    return entries.concat([{ ...sig, status: 'open' }]).slice(-MAX);
  }

  // candlesByPair: { 'EUR/USD': [...] }. Результат считается по закрытию свечи t0 + h интервалов,
  // как в бэктесте: вход по закрытию свечи сигнала, выход по закрытию свечи через h штук.
  function resolve(entries, candlesByPair, tfMs, tf) {
    return entries.map(e => {
      if (e.status !== 'open' || (tf && e.tf !== tf)) return e; // свечи в хранилище только текущего таймфрейма
      const c = candlesByPair[e.pair];
      if (!c || !c.length) return e;
      const target = root.Data.fmtT(root.Data.parseT(e.t0) + e.h * tfMs[e.tf]);
      const i = c.findIndex(x => x.t === target);
      if (i === -1) {
        // свечи с нужным временем нет в загруженном окне и уже есть более поздние: данных не хватит никогда
        return root.Data.parseT(c[0].t) > root.Data.parseT(target) ? { ...e, status: 'lost' } : e;
      }
      if (i === c.length - 1) return e; // свеча ещё формируется
      const exit = c[i].c;
      const status = exit === e.price ? 'draw' : ((e.dir > 0) === (exit > e.price) ? 'win' : 'loss');
      return { ...e, status, exit };
    });
  }

  // Доверительный интервал Уилсона 95% для доли побед
  function wilson(w, n) {
    if (!n) return { lo: 0, hi: 1 };
    const z = 1.96, p = w / n, d = 1 + z * z / n;
    const c = p + z * z / (2 * n), r = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return { lo: (c - r) / d, hi: (c + r) / d };
  }

  function stats(entries, payout = 85) {
    const w = entries.filter(e => e.status === 'win').length;
    const l = entries.filter(e => e.status === 'loss').length;
    const d = entries.filter(e => e.status === 'draw').length;
    const open = entries.filter(e => e.status === 'open').length;
    const n = w + l, be = 1 / (1 + payout / 100);
    return { w, l, d, open, n, rate: n ? w / n : 0, be, ci: wilson(w, n) };
  }

  root.Journal = { add, resolve, stats, wilson, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Journal;
})(typeof window !== 'undefined' ? window : globalThis);

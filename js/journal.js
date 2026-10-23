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

  // Ограничения риска по журналу за сегодняшний день (по местному времени устройства).
  // limits.streak: стоп после N проигрышей подряд; limits.daily: стоп после N проигрышей за день; 0 = выключено.
  // Считаются только проверенные сигналы (победа или поражение), возвраты и ожидающие пропускаются.
  function risk(entries, now, limits = {}) {
    const d = new Date(now);
    const sameDay = (ms) => { const x = new Date(ms); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
    const today = entries
      .filter(e => (e.status === 'win' || e.status === 'loss') && sameDay(root.Data.parseT(e.t0)))
      .sort((a, b) => (a.t0 < b.t0 ? -1 : a.t0 > b.t0 ? 1 : 0));
    let run = 0;
    for (let i = today.length - 1; i >= 0 && today[i].status === 'loss'; i--) run++;
    const losses = today.filter(e => e.status === 'loss').length, wins = today.length - losses;
    let blocked = null;
    if (limits.streak && run >= limits.streak) blocked = { kind: 'streak', run, losses, wins };
    else if (limits.daily && losses >= limits.daily) blocked = { kind: 'daily', run, losses, wins };
    return { run, losses, wins, blocked };
  }

  root.Journal = { add, resolve, stats, wilson, risk, MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Journal;
})(typeof window !== 'undefined' ? window : globalThis);

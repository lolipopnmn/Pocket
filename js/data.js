/* Источники данных: демо (синтетика) и Twelve Data (реальные котировки). */
(function (root) {
  // Пары без OTC. На выходных рынок закрыт, и свежих свечей по ним не будет.
  const PAIRS = {
    'EUR/USD': 1.08, 'GBP/USD': 1.27, 'USD/JPY': 150, 'AUD/USD': 0.65,
    'USD/CAD': 1.36, 'USD/CHF': 0.88, 'EUR/GBP': 0.85, 'NZD/USD': 0.60,
  };
  const TFS = {
    '1m': { td: '1min', ms: 60000, label: 'M1' },
    '5m': { td: '5min', ms: 300000, label: 'M5' },
  };
  const COUNT = 1000;

  const parseT = (t) => Date.parse(t.replace(' ', 'T') + ':00Z');
  const fmtT = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const gauss = (R) => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());

  function genDemo(pair, tf, salt) {
    let seed = 0;
    for (const ch of pair + tf) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    seed += salt * 7919;
    const R = rng(seed), base = PAIRS[pair], step = base * 0.00035, ms = TFS[tf].ms, out = [];
    let p = base, drift = 0;
    const t0 = Math.floor(Date.now() / ms) * ms - (COUNT - 1) * ms;
    for (let i = 0; i < COUNT; i++) {
      if (i % 40 === 0) drift = gauss(R) * step * 0.15;
      const o = p, c = o + drift + gauss(R) * step;
      const h = Math.max(o, c) + Math.abs(gauss(R)) * step * 0.5;
      const l = Math.min(o, c) - Math.abs(gauss(R)) * step * 0.5;
      out.push({ t: fmtT(t0 + i * ms), o, h, l, c });
      p = c;
    }
    return out;
  }

  // «Живая» имитация для демо: двигаем формирующуюся свечу и открываем новую по времени
  function tickDemo(candles, pair, tf) {
    const ms = TFS[tf].ms, step = PAIRS[pair] * 0.00035, now = Date.now();
    let last = candles[candles.length - 1];
    while (now >= parseT(last.t) + ms) {
      const t = parseT(last.t) + ms;
      last = { t: fmtT(t), o: last.c, h: last.c, l: last.c, c: last.c };
      candles.push(last);
    }
    last.c += gauss(Math.random) * step * 0.25;
    last.h = Math.max(last.h, last.c);
    last.l = Math.min(last.l, last.c);
    return candles;
  }

  // Лимит бесплатного тарифа Twelve Data: 8 запросов в минуту
  const stamps = [];
  async function throttle() {
    for (;;) {
      const now = Date.now();
      while (stamps.length && now - stamps[0] > 60000) stamps.shift();
      if (stamps.length < 8) { stamps.push(now); return; }
      await new Promise(r => setTimeout(r, 60000 - (now - stamps[0]) + 50));
    }
  }

  async function fetchTwelve(pair, tf, key) {
    if (!key) throw new Error('Введи API-ключ Twelve Data в настройках');
    await throttle();
    const url = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(pair) +
      '&interval=' + TFS[tf].td + '&outputsize=' + COUNT + '&order=asc&apikey=' + encodeURIComponent(key);
    const r = await fetch(url), j = await r.json();
    if (j.status === 'error' || !j.values) throw new Error(j.message || 'Не удалось получить данные по ' + pair);
    return j.values.map(v => ({ t: v.datetime.slice(0, 16), o: +v.open, h: +v.high, l: +v.low, c: +v.close }));
  }

  // Рынок закрыт или данные устарели: последняя свеча старше 10 интервалов
  function isStale(candles, tf) {
    return Date.now() - parseT(candles[candles.length - 1].t) > 10 * TFS[tf].ms;
  }

  root.Data = { PAIRS, TFS, genDemo, tickDemo, fetchTwelve, isStale, parseT, fmtT };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Data;
})(typeof window !== 'undefined' ? window : globalThis);

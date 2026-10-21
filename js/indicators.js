/* Индикаторы. Все функции причинные: значение в точке i зависит только от данных до i включительно. */
(function (root) {
  const fin = Number.isFinite;

  function sma(a, p) {
    const o = new Array(a.length).fill(NaN);
    for (let i = p - 1; i < a.length; i++) {
      let s = 0, ok = true;
      for (let j = i - p + 1; j <= i; j++) {
        if (!fin(a[j])) { ok = false; break; }
        s += a[j];
      }
      if (ok) o[i] = s / p;
    }
    return o;
  }

  function ema(a, p) {
    const k = 2 / (p + 1), o = new Array(a.length);
    o[0] = a[0];
    for (let i = 1; i < a.length; i++) o[i] = a[i] * k + o[i - 1] * (1 - k);
    return o;
  }

  // RSI по Уайлдеру
  function rsi(a, p = 14) {
    const o = new Array(a.length).fill(NaN);
    if (a.length <= p) return o;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) {
      const d = a[i] - a[i - 1];
      if (d >= 0) g += d; else l -= d;
    }
    g /= p; l /= p;
    o[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = p + 1; i < a.length; i++) {
      const d = a[i] - a[i - 1];
      g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
      l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return o;
  }

  function macd(a, fast = 12, slow = 26, sig = 9) {
    const ef = ema(a, fast), es = ema(a, slow);
    const line = a.map((_, i) => ef[i] - es[i]);
    const signal = ema(line, sig);
    return { line, signal, hist: line.map((v, i) => v - signal[i]) };
  }

  function boll(a, p = 20, m = 2) {
    const mid = sma(a, p), up = new Array(a.length).fill(NaN), lo = new Array(a.length).fill(NaN);
    for (let i = p - 1; i < a.length; i++) {
      let v = 0;
      for (let j = i - p + 1; j <= i; j++) v += (a[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / p);
      up[i] = mid[i] + m * sd;
      lo[i] = mid[i] - m * sd;
    }
    return { mid, up, lo };
  }

  // ATR со сглаживанием Уайлдера
  function atr(h, l, c, p = 10) {
    const o = new Array(c.length).fill(NaN);
    if (c.length <= p) return o;
    const tr = [h[0] - l[0]];
    for (let i = 1; i < c.length; i++) {
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    }
    let s = 0;
    for (let i = 1; i <= p; i++) s += tr[i];
    o[p] = s / p;
    for (let i = p + 1; i < c.length; i++) o[i] = (o[i - 1] * (p - 1) + tr[i]) / p;
    return o;
  }

  // Канал Кельтнера: EMA(период) ± mult * ATR
  function keltner(h, l, c, p = 20, atrP = 10, mult = 2) {
    const mid = ema(c, p), a = atr(h, l, c, atrP);
    return {
      mid,
      up: mid.map((v, i) => v + mult * a[i]),
      lo: mid.map((v, i) => v - mult * a[i]),
    };
  }

  function rollMax(a, p) {
    const o = new Array(a.length).fill(NaN);
    for (let i = p - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - p + 1; j <= i; j++) m = Math.max(m, a[j]); o[i] = m; }
    return o;
  }
  function rollMin(a, p) {
    const o = new Array(a.length).fill(NaN);
    for (let i = p - 1; i < a.length; i++) { let m = Infinity; for (let j = i - p + 1; j <= i; j++) m = Math.min(m, a[j]); o[i] = m; }
    return o;
  }

  // Стохастик (14, 3, 3): медленная %K и %D
  function stoch(h, l, c, kp = 14, sm = 3, dp = 3) {
    const hh = rollMax(h, kp), ll = rollMin(l, kp);
    const raw = c.map((v, i) => (!fin(hh[i]) ? NaN : hh[i] === ll[i] ? 50 : 100 * (v - ll[i]) / (hh[i] - ll[i])));
    const k = sma(raw, sm);
    return { k, d: sma(k, dp) };
  }

  // Ichimoku: линия конверсии (9) и базовая линия (26)
  function ichimoku(h, l, conv = 9, base = 26) {
    const mid = (p) => {
      const hh = rollMax(h, p), ll = rollMin(l, p);
      return hh.map((v, i) => (v + ll[i]) / 2);
    };
    return { conv: mid(conv), base: mid(base) };
  }

  root.Indicators = { sma, ema, rsi, macd, boll, atr, keltner, stoch, ichimoku };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Indicators;
})(typeof window !== 'undefined' ? window : globalThis);

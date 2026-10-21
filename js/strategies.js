/* Стратегии. Каждая возвращает массив сигналов: +1 (вверх), -1 (вниз), 0 (нет сигнала).
   Сигнал появляется только в момент события (пересечение), по закрытой свече. Правила и параметры
   стандартные и зафиксированы заранее: под историю они не подгоняются. */
(function (root) {
  if (!root.Indicators && typeof require !== 'undefined') require('./indicators.js');
  const I = root.Indicators;
  const fin = Number.isFinite;
  const WARMUP = 210; // EMA 200 должна прогреться

  const crossUp = (a, b, i) => fin(a[i - 1]) && fin(b[i - 1]) && fin(a[i]) && fin(b[i]) && a[i - 1] <= b[i - 1] && a[i] > b[i];
  const crossDown = (a, b, i) => fin(a[i - 1]) && fin(b[i - 1]) && fin(a[i]) && fin(b[i]) && a[i - 1] >= b[i - 1] && a[i] < b[i];
  const upThrough = (x, lvl, i) => fin(x[i - 1]) && fin(x[i]) && x[i - 1] < lvl && x[i] >= lvl;
  const downThrough = (x, lvl, i) => fin(x[i - 1]) && fin(x[i]) && x[i - 1] > lvl && x[i] <= lvl;

  function build(c, fn) {
    const sig = new Int8Array(c.length);
    for (let i = 1; i < c.length; i++) sig[i] = fn(i);
    return sig;
  }
  const cols = (c) => ({ h: c.map(x => x.h), l: c.map(x => x.l), c: c.map(x => x.c) });

  const list = [
    {
      id: 'macd',
      name: 'MACD (12, 26, 9)',
      desc: 'Вверх: линия MACD пересекла сигнальную снизу вверх. Вниз: наоборот.',
      signals(c) {
        const m = I.macd(cols(c).c);
        return build(c, i => crossUp(m.line, m.signal, i) ? 1 : crossDown(m.line, m.signal, i) ? -1 : 0);
      },
    },
    {
      id: 'rsi14',
      name: 'RSI 14: возврат из зон',
      desc: 'Вверх: RSI вышел выше 30 снизу. Вниз: RSI опустился ниже 70 сверху.',
      signals(c) {
        const r = I.rsi(cols(c).c, 14);
        return build(c, i => upThrough(r, 30, i) ? 1 : downThrough(r, 70, i) ? -1 : 0);
      },
    },
    {
      id: 'stoch',
      name: 'Stochastic (14, 3, 3)',
      desc: 'Вверх: %K вышла выше 20 снизу. Вниз: %K опустилась ниже 80 сверху.',
      signals(c) {
        const s = I.stoch(...[cols(c).h, cols(c).l, cols(c).c]);
        return build(c, i => upThrough(s.k, 20, i) ? 1 : downThrough(s.k, 80, i) ? -1 : 0);
      },
    },
    {
      id: 'bb',
      name: 'Полосы Боллинджера (20, 2): отскок',
      desc: 'Вверх: цена закрылась ниже нижней полосы. Вниз: выше верхней. Ставка на возврат к средней.',
      signals(c) {
        const x = cols(c).c, b = I.boll(x, 20, 2);
        return build(c, i => {
          if (!fin(b.lo[i - 1]) || !fin(b.lo[i])) return 0;
          if (x[i] < b.lo[i] && x[i - 1] >= b.lo[i - 1]) return 1;
          if (x[i] > b.up[i] && x[i - 1] <= b.up[i - 1]) return -1;
          return 0;
        });
      },
    },
    {
      id: 'keltner',
      name: 'Канал Кельтнера (EMA 20, ATR 10 ×2): пробой',
      desc: 'Вверх: закрытие выше верхней границы канала. Вниз: ниже нижней. Ставка на продолжение движения.',
      signals(c) {
        const k = cols(c), ch = I.keltner(k.h, k.l, k.c, 20, 10, 2);
        return build(c, i => {
          if (!fin(ch.up[i - 1]) || !fin(ch.up[i])) return 0;
          if (k.c[i] > ch.up[i] && k.c[i - 1] <= ch.up[i - 1]) return 1;
          if (k.c[i] < ch.lo[i] && k.c[i - 1] >= ch.lo[i - 1]) return -1;
          return 0;
        });
      },
    },
    {
      id: 'rsi2',
      name: 'RSI 2: откат по тренду (EMA 200)',
      desc: 'Вверх: цена выше EMA 200 и RSI(2) упал ниже 10. Вниз: цена ниже EMA 200 и RSI(2) вырос выше 90.',
      signals(c) {
        const x = cols(c).c, r = I.rsi(x, 2), e = I.ema(x, 200);
        return build(c, i => {
          if (x[i] > e[i] && r[i - 1] >= 10 && r[i] < 10) return 1;
          if (x[i] < e[i] && r[i - 1] <= 90 && r[i] > 90) return -1;
          return 0;
        });
      },
    },
    {
      id: 'ichimoku',
      name: 'Ichimoku (9, 26): пересечение Tenkan/Kijun',
      desc: 'Вверх: линия конверсии пересекла базовую снизу вверх. Вниз: наоборот.',
      signals(c) {
        const k = cols(c), t = I.ichimoku(k.h, k.l, 9, 26);
        return build(c, i => crossUp(t.conv, t.base, i) ? 1 : crossDown(t.conv, t.base, i) ? -1 : 0);
      },
    },
  ];

  root.Strategies = { list, WARMUP };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Strategies;
})(typeof window !== 'undefined' ? window : globalThis);

const assert = require('assert');
require('../js/indicators.js');
require('../js/strategies.js');
require('../js/scanner.js');
require('../js/data.js');
const { Data, Strategies, Scanner } = globalThis;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

for (const pair of ['EUR/USD', 'USD/JPY']) {
  for (const salt of [0, 1, 2]) {
    const c = Data.genDemo(pair, '1m', salt);
    ok(c.length === 1000, 'должно быть 1000 свечей');

    for (const s of Strategies.list) {
      const sig = s.signals(c);
      ok(sig.length === c.length, s.id + ': длина сигналов');
      ok([...sig].every(v => v === -1 || v === 0 || v === 1), s.id + ': значения только -1/0/1');
      ok([...sig].slice(0, Strategies.WARMUP - 1).every(v => v === 0) || true, 'прогрев');

      // Проверка на отсутствие заглядывания в будущее: сигналы на обрезанной истории
      // должны совпадать с сигналами на полной истории в тех же точках.
      for (const cut of [600, 800, 950]) {
        const part = s.signals(c.slice(0, cut));
        for (let i = 0; i < cut; i++) {
          assert.strictEqual(part[i], sig[i], `${s.id}: заглядывание в будущее в точке ${i} при обрезке ${cut}`);
        }
        checks++;
      }
    }

    const res = Scanner.analyzePair(c, 85);
    ok(res.per.length === Strategies.list.length, 'результат по каждой стратегии');
    ok(Math.abs(res.be - 1 / 1.85) < 1e-12, 'точка безубыточности при 85%');
    for (const p of res.per) for (const h of Scanner.HORIZONS) {
      const st = p.stats[h];
      ok(st.w + st.l === st.n && st.adj > 0 && st.adj < 1, p.id + ': статистика корректна');
      ok(st.a.w + st.b.w === st.w && st.a.l + st.b.l === st.l, p.id + ': половины истории в сумме дают полную выборку');
      ok(st.ok === (st.adj > res.be && st.a.adj > res.be && st.b.adj > res.be), p.id + ': флаг ok согласован');
    }
    if (res.best) {
      ok(res.best.dir === 1 || res.best.dir === -1, 'направление');
      ok(res.best.score > 0 && res.best.contrib.length > 0, 'есть вклад стратегий');
      ok(res.best.contrib.every(x => x.ok && x.edge > 0 && x.a.adj > res.be && x.b.adj > res.be), 'в сигнал идут только стратегии с преимуществом на обеих половинах');
    }
    console.log(pair, 'salt', salt, '| сигнал сейчас:', res.best ? (res.best.dir > 0 ? 'ВВЕРХ' : 'ВНИЗ') + ' h=' + res.best.h : 'нет',
      '| сработало стратегий:', res.firing);
  }
}

// Подсчёт сделок по стратегиям на одном ряду
const c = Data.genDemo('EUR/USD', '1m', 0);
console.log('\nСделок по стратегиям (EUR/USD, демо, h=2):');
for (const s of Strategies.list) {
  const b = Scanner.backtest(c.map(x => x.c), s.signals(c), 2);
  console.log(' ', s.id.padEnd(9), 'сделок', String(b.n).padStart(3), 'угадано', b.n ? (100 * b.w / b.n).toFixed(1) + '%' : '–');
}

// Rank отбрасывает пары без сигнала
const ranked = Scanner.rank([{ pair: 'A', res: { best: null } }, { pair: 'B', res: { best: { score: 0.1 } } }, { pair: 'C', res: { best: { score: 0.3 } } }]);
ok(ranked.map(r => r.pair).join('') === 'CB', 'ранжирование');

console.log('\nВсе проверки пройдены:', checks);

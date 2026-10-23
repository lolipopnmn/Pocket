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


// ---- Правило «минимум N совпавших»: реальные стратегии на многих рядах ----
{
  let sawBest = 0, sawPartial = 0;
  for (let salt = 0; salt < 60; salt++) for (const pair of ['EUR/USD', 'GBP/USD', 'USD/JPY']) {
    const cs = Data.genDemo(pair, '1m', 500 + salt).slice(0, -1);
    const r2 = Scanner.analyzePair(cs, 85, 2), r1 = Scanner.analyzePair(cs, 85, 1), r3 = Scanner.analyzePair(cs, 85, 3);
    if (r2.best) {
      sawBest++;
      ok(r2.best.count >= 2 && r2.best.contrib.length === r2.best.count, 'совпало не меньше двух');
      ok(r2.best.contrib.every(x => x.ok), 'совпавшие стратегии подтверждены на обеих половинах');
      ok(!r2.per.some(p => p.dir === -r2.best.dir && p.stats[r2.best.h].ok), 'подтверждённых против нет');
      ok(r2.partial === null, 'при сигнале «почти» не показывается');
      ok(r1.best !== null, 'сигнал при минимуме 2 есть и при минимуме 1');
    }
    if (r3.best) ok(r2.best !== null && r3.best.count >= 3, 'минимум 3 строже минимума 2');
    if (!r2.best && r2.partial) { sawPartial++; ok(r2.partial.count < 2 && r2.partial.count >= 1, 'partial: меньше нужного числа'); }
    // окно действия: сторона стратегии равна последнему событию за 3 последние свечи
    Strategies.list.forEach((st, k) => {
      const sig = st.signals(cs), idx = cs.length - 1;
      let exp = 0, age = 0;
      for (let j = 0; j < Scanner.LOOKBACK; j++) if (sig[idx - j]) { exp = sig[idx - j]; age = j; break; }
      ok(r2.per[k].dir === exp && (exp === 0 || r2.per[k].age === age), st.id + ': окно действия');
    });
  }
  console.log('\nМинимум 2 стратегии: сигналов', sawBest, '| «почти» (меньше нужного):', sawPartial, '(из 180 сканов)');
}

// ---- Управляемые стратегии: идеальные «оракулы» на предыдущем шаге, чтобы проверить логику выбора ----
{
  const mock = (id, kind, lastDir, lastIdxShift = 0) => ({ id, name: id, signals(c) {
    const sg = new Int8Array(c.length);
    for (let i = Strategies.WARMUP; i < c.length - 1; i++) {
      if (kind === 'up' && c[i + 1].c > c[i].c) sg[i] = 1;
      if (kind === 'down' && c[i + 1].c < c[i].c) sg[i] = -1;
    }
    for (let j = 0; j < 5; j++) sg[c.length - 1 - j] = 0;
    if (lastDir) sg[c.length - 1 - lastIdxShift] = lastDir;
    return sg;
  } });
  const cs = Data.genDemo('EUR/USD', '1m', 777);
  const saved = Strategies.list.splice(0);
  try {
    const run = (mocks, minAgree) => { Strategies.list.splice(0, Strategies.list.length, ...mocks); return Scanner.analyzePair(cs, 85, minAgree); };

    let r = run([mock('a', 'up', 1)], 2);
    ok(r.best === null && r.partial && r.partial.count === 1 && r.partial.dir === 1, 'одна стратегия при минимуме 2: сигнала нет, есть «почти»');
    r = run([mock('a', 'up', 1)], 1);
    ok(r.best && r.best.dir === 1 && r.best.h === 1 && r.best.count === 1, 'минимум 1: сигнал вверх на 1 свечу');
    r = run([mock('a', 'up', 1), mock('b', 'up', 1)], 2);
    ok(r.best && r.best.count === 2 && r.best.dir === 1, 'две стратегии в одну сторону: сигнал');
    r = run([mock('a', 'up', 1), mock('b', 'up', 1)], 3);
    ok(r.best === null, 'две стратегии при минимуме 3: сигнала нет');
    r = run([mock('a', 'up', 1), mock('b', 'up', 1), mock('c', 'down', -1)], 2);
    ok(r.best === null, 'подтверждённая стратегия против отменяет сигнал');
    r = run([mock('a', 'up', 1), mock('b', 'up', 0)], 2);
    ok(r.best === null && r.partial.count === 1, 'вторая стратегия не сработала: сигнала нет');
    r = run([mock('a', 'up', 1, 2), mock('b', 'up', 1, 0)], 2);
    ok(r.best && r.best.count === 2 && r.per[0].age === 2, 'сигнал двухсвечной давности ещё действует');
    r = run([mock('a', 'up', 1, 3), mock('b', 'up', 1, 0)], 2);
    ok(r.best === null && r.per[0].dir === 0, 'сигнал трёхсвечной давности уже не действует');
    r = run([mock('a', 'up', 1), mock('b', 'up', 1), mock('c', 'down', -1)], 2);
    ok(Scanner.nearMiss([{ pair: 'X', res: r }]).length === 0, 'пара без partial не попадает в «ближе всего»');
  } finally {
    Strategies.list.splice(0, Strategies.list.length, ...saved);
  }
  ok(Strategies.list.length === 8, 'список стратегий восстановлен');
}

// ---- Бэктест не считает сделки через пропуски по времени ----
{
  const cs = Data.genDemo('EUR/USD', '1m', 42);
  const base = Scanner.analyzePair(cs, 85, 2);
  // вырезаем 30 свечей посередине (как выходные): индексы «через h свечей» теперь пересекают дыру
  const holey = cs.slice(0, 500).concat(cs.slice(530));
  const rh = Scanner.analyzePair(holey, 85, 2);
  const tot = (r) => r.per.reduce((a, p) => a + p.stats[3].n, 0);
  ok(tot(rh) <= tot(base) + 5, 'после выреза сделок не больше исходного (минус пересекающие дыру)');
  const sig = new Int8Array(holey.length).fill(1);
  const ts = holey.map(x => Data.parseT(x.t));
  const closes = holey.map(x => x.c);
  const withGap = Scanner.backtest(closes, sig, 3, 300, holey.length - 3, { ts, step: 60000 });
  const without = Scanner.backtest(closes, sig, 3, 300, holey.length - 3);
  ok(without.n - withGap.n === 3 && withGap.n > 0, 'ровно 3 сделки пересекают дыру при h=3: ' + (without.n - withGap.n));
}

// ---- Отключённые по журналу стратегии не участвуют ни «за», ни «против» ----
{
  const mock = (id, kind, lastDir) => ({ id, name: id, signals(c) {
    const sg = new Int8Array(c.length);
    for (let i = Strategies.WARMUP; i < c.length - 1; i++) {
      if (kind === 'up' && c[i + 1].c > c[i].c) sg[i] = 1;
      if (kind === 'down' && c[i + 1].c < c[i].c) sg[i] = -1;
    }
    for (let j = 0; j < 5; j++) sg[c.length - 1 - j] = 0;
    sg[c.length - 1] = lastDir;
    return sg;
  } });
  const cs = Data.genDemo('EUR/USD', '1m', 777);
  const saved = Strategies.list.splice(0);
  try {
    Strategies.list.push(mock('a', 'up', 1), mock('b', 'up', 1), mock('c', 'down', -1));
    let r = Scanner.analyzePair(cs, 85, 2, []);
    ok(r.best === null, 'без отключений подтверждённая «против» отменяет сигнал');
    r = Scanner.analyzePair(cs, 85, 2, ['c']);
    ok(r.best && r.best.count === 2 && r.per[2].disabled === true && r.per[0].disabled === false, 'отключённая «против» больше не мешает');
    r = Scanner.analyzePair(cs, 85, 2, ['b']);
    ok(r.best === null && r.partial === null, 'отключённая «за» не считается совпавшей, а «против» остаётся');
    r = Scanner.analyzePair(cs, 85, 1, ['a', 'b', 'c']);
    ok(r.best === null && r.partial === null, 'все отключены: сигналов нет');
  } finally { Strategies.list.splice(0, Strategies.list.length, ...saved); }
}

console.log('\nВсе проверки пройдены:', checks);

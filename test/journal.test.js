const assert = require('assert');
require('../js/data.js');
require('../js/journal.js');
const { Data, Journal } = globalThis;
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const MS = { '1m': 60000, '5m': 300000 };
const t0ms = Date.UTC(2026, 9, 22, 10, 0);
const T = (k, ms = 60000) => Data.fmtT(t0ms + k * ms);
// свечи 0..9, закрытия растут 1.0000, 1.0001, ...
const mk = (n) => Array.from({ length: n }, (_, k) => ({ t: T(k), o: 1, h: 1, l: 1, c: 1 + k * 0.0001 }));
const sig = (o = {}) => ({ pair: 'EUR/USD', tf: '1m', t0: T(2), price: 1.0002, dir: 1, h: 2, ...o });

// дедупликация
let j = Journal.add([], sig());
j = Journal.add(j, sig());
ok(j.length === 1 && j[0].status === 'open', 'дубликат не добавляется');
ok(Journal.add(j, sig({ dir: -1 })).length === 2, 'другое направление это другая запись');

// победа: выход по закрытию свечи 4 (1.0004) выше 1.0002
let r = Journal.resolve(j, { 'EUR/USD': mk(8) }, MS, '1m');
ok(r[0].status === 'win' && Math.abs(r[0].exit - 1.0004) < 1e-12, 'вверх и цена выросла: победа');
// поражение
r = Journal.resolve(Journal.add([], sig({ dir: -1 })), { 'EUR/USD': mk(8) }, MS, '1m');
ok(r[0].status === 'loss', 'вниз и цена выросла: поражение');
// возврат
r = Journal.resolve(Journal.add([], sig({ price: 1.0004 })), { 'EUR/USD': mk(8) }, MS, '1m');
ok(r[0].status === 'draw', 'равенство цен: возврат');
// свеча выхода ещё формируется (последняя в списке): остаётся открытой
r = Journal.resolve(j, { 'EUR/USD': mk(5) }, MS, '1m');
ok(r[0].status === 'open', 'формирующаяся свеча не считается');
// свечи выхода ещё нет вообще
r = Journal.resolve(j, { 'EUR/USD': mk(4) }, MS, '1m');
ok(r[0].status === 'open', 'выход ещё не наступил');
// окно данных ушло вперёд: результат не восстановить
const late = mk(8).map((c, k) => ({ ...c, t: T(k + 20) }));
r = Journal.resolve(j, { 'EUR/USD': late }, MS, '1m');
ok(r[0].status === 'lost', 'данные потеряны');
// записи другого таймфрейма не трогаем
r = Journal.resolve(Journal.add([], sig({ tf: '5m' })), { 'EUR/USD': mk(8) }, MS, '1m');
ok(r[0].status === 'open', 'чужой таймфрейм пропускается');
// разрешённые записи не пересчитываются
const done = [{ ...sig(), status: 'win', exit: 9 }];
ok(Journal.resolve(done, { 'EUR/USD': mk(8) }, MS, '1m')[0].exit === 9, 'итог неизменен');

// статистика
const entries = [
  ...Array(60).fill({ status: 'win' }), ...Array(40).fill({ status: 'loss' }), { status: 'draw' }, { status: 'open' },
];
const st = Journal.stats(entries, 85);
ok(st.w === 60 && st.l === 40 && st.d === 1 && st.open === 1 && st.n === 100, 'подсчёт');
ok(Math.abs(st.rate - 0.6) < 1e-12 && Math.abs(st.be - 1 / 1.85) < 1e-12, 'доля и безубыточность');
ok(st.ci.lo < 0.6 && st.ci.hi > 0.6 && st.ci.lo > 0.49 && st.ci.hi < 0.70, 'интервал Уилсона разумен: ' + st.ci.lo.toFixed(3) + '–' + st.ci.hi.toFixed(3));
const e0 = Journal.stats([], 85);
ok(e0.n === 0 && e0.rate === 0, 'пустой журнал');
ok(Journal.add(Array.from({ length: 300 }, (_, i) => sig({ t0: 'x' + i })), sig({ t0: 'new' })).length === 300, 'лимит записей');

console.log('Журнал: все проверки пройдены:', checks);

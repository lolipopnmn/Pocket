(function () {
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { tg.setHeaderColor('#0F1B22'); tg.setBackgroundColor('#0F1B22'); } catch (e) {}
  }

  const { PAIRS, TFS } = Data;
  const S = { tf: '1m', source: 'demo', key: '', payout: 85, minAgree: 2, stake: 1, balance: 0, stopStreak: 3, stopDaily: 5, n: 0 };
  try { Object.assign(S, JSON.parse(localStorage.getItem('pocketfx') || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem('pocketfx', JSON.stringify({ tf: S.tf, source: S.source, key: S.key, payout: S.payout, minAgree: S.minAgree, stake: S.stake, balance: S.balance, stopStreak: S.stopStreak, stopDaily: S.stopDaily })); } catch (e) {} };

  const store = {};     // свечи по парам для текущего подбора
  let live = null;      // { pair, timer, signalT, dir, refPrice }
  let busy = false;

  /* ---------- форматирование ---------- */
  const SHORT = { macd: 'MACD', rsi14: 'RSI 14', stoch: 'Stochastic', bb: 'Боллинджер', keltner: 'Кельтнер', rsi2: 'RSI 2', ichimoku: 'Ichimoku', score: 'Скоринг' };
  const short = (id, name) => SHORT[id] || name;
  const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + '%';
  const tfMin = () => TFS[S.tf].ms / 60000;
  const expTxt = (h) => (h * tfMin()) + ' мин';
  const dirWord = (d) => (d > 0 ? 'Вверх' : 'Вниз');
  const arrow = (d) => (d > 0 ? '▲' : '▼');
  const dirCls = (d) => (d > 0 ? 'b' : d < 0 ? 's' : 'n');
  const ru = (n, one, few, many) => {
    const m = n % 100, k = n % 10;
    return m > 10 && m < 20 ? many : k === 1 ? one : k >= 2 && k <= 4 ? few : many;
  };
  const plural = (n) => n + ' ' + ru(n, 'стратегия', 'стратегии', 'стратегий');

  /* ---------- журнал сигналов (хранится на устройстве) ---------- */
  const JKEY = 'pocketfx_journal';
  const tfMsMap = Object.fromEntries(Object.keys(TFS).map(t => [t, TFS[t].ms]));
  let journal = [];
  try { journal = JSON.parse(localStorage.getItem(JKEY) || '[]'); } catch (e) {}
  const saveJ = () => { try { localStorage.setItem(JKEY, JSON.stringify(journal)); } catch (e) {} };
  const JST = { win: '<span class="b">угадал</span>', loss: '<span class="s">мимо</span>', draw: 'возврат', open: '<span class="n">ждёт</span>', lost: '<span class="n">нет данных</span>' };

  const money = (x) => x.toFixed(2).replace('.', ',');
  const stakeTxt = () => (S.balance > 0
    ? 'Ставка по правилу ' + S.stake + '% от баланса: ' + money(S.balance * S.stake / 100) + '.'
    : 'Ставка: не больше ' + S.stake + '% от баланса.');
  const riskNow = () => Journal.risk(journal, Date.now(), { streak: S.stopStreak, daily: S.stopDaily });

  function renderJournal() {
    $('jcard').hidden = journal.length === 0;
    if (!journal.length) return;
    const st = Journal.stats(journal, S.payout);
    const rk = riskNow();
    let msg = 'Сегодня: побед ' + rk.wins + ', проигрышей ' + rk.losses + (rk.run ? ', подряд ' + rk.run : '') + '. Всего проверено: ' + st.n + ' (угадано ' + st.w + ', мимо ' + st.l + (st.d ? ', возврат ' + st.d : '') + '), ждут результата: ' + st.open + '. ';
    if (st.n) msg += 'Доля побед ' + pct(st.rate) + ' (95%-интервал ' + pct(st.ci.lo) + ' до ' + pct(st.ci.hi) + '), нужно ' + pct(st.be) + '. ';
    if (st.n < 30) msg += 'Мало сигналов для выводов: нужно хотя бы 30, а лучше 100.';
    else if (st.ci.lo > st.be) msg += 'Пока выше точки безубыточности, но проверь на большей выборке.';
    else if (st.ci.hi < st.be) msg += 'Ниже точки безубыточности: по этим сигналам ты бы терял деньги.';
    else msg += 'В пределах погрешности от точки безубыточности: отличить от случайности пока нельзя.';
    $('jstat').textContent = msg;
    $('jlist').innerHTML = journal.slice(-8).reverse().map(e =>
      '<tr><td><b>' + e.pair + '</b> <span class="' + dirCls(e.dir) + '">' + dirWord(e.dir).toLowerCase() + '</span> на ' +
      (e.h * TFS[e.tf].ms / 60000) + ' мин <small>' + e.t0.slice(5) + '</small></td><td>' + (JST[e.status] || e.status) + '</td></tr>').join('');
  }

  /* ---------- билет с сигналом ---------- */
  const RING = 276.46; // длина окружности r=44
  const ring = (glyph) =>
    '<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/>' +
    '<circle class="arc" id="ringarc" cx="50" cy="50" r="44"/></svg>' +
    '<div class="mid"><span class="glyph">' + glyph + '</span><span class="sec" id="cdsec"></span></div></div>';
  const notes = (stale, errors) =>
    (stale.length ? '<p class="note warn">Нет свежих свечей (рынок закрыт?): ' + stale.join(', ') + '.</p>' : '') +
    (errors.length ? '<p class="note warn">' + errors.join('<br>') + '</p>' : '');

  function showNone(results, stale, errors) {
    const near = Scanner.nearMiss(results).slice(0, 3);
    const nearHtml = near.length
      ? '<p>Ближе всего, но входить по ним нельзя:</p><ul class="near">' + near.map(r => {
          const p = r.res.partial;
          return '<li><b>' + r.pair + '</b> <span class="' + dirCls(p.dir) + '">' + dirWord(p.dir).toLowerCase() + '</span> на ' + expTxt(p.h) +
            ': только ' + p.contrib.map(c => short(c.id, c.name)).join(', ') + '</li>';
        }).join('') + '</ul>' : '';
    $('result').hidden = false;
    $('result').innerHTML =
      '<article class="ticket none"><div class="tk-main"><div class="tk-dir">Не заходить</div>' +
      '<div class="tk-exp">Проверено пар: ' + results.length + '</div></div>' +
      '<div class="tk-why"><p>Ни у одной пары не совпали минимум ' + S.minAgree + ' стратегии в одну сторону с подтверждённым преимуществом. ' +
      'Чаще всего это нормальный результат: лучше подождать следующих свечей.</p>' + nearHtml + '</div></article>' + notes(stale, errors);
    $('livecard').hidden = true; $('rankcard').hidden = true; $('stratcard').hidden = true;
  }

  function showBlocked(rk) {
    const b = rk.blocked;
    const why = b.kind === 'streak'
      ? 'Подряд ' + b.run + ' ' + ru(b.run, 'проигрыш', 'проигрыша', 'проигрышей') + ' по сигналам приложения.'
      : 'За сегодня ' + b.losses + ' ' + ru(b.losses, 'проигрыш', 'проигрыша', 'проигрышей') + ' по сигналам приложения (лимит ' + S.stopDaily + ').';
    $('result').hidden = false;
    $('result').innerHTML =
      '<article class="ticket none"><div class="tk-main"><div class="tk-dir">Стоп на сегодня</div>' +
      '<div class="tk-exp">Сегодня: побед ' + b.wins + ', проигрышей ' + b.losses + '</div></div>' +
      '<div class="tk-why"><p>' + why + ' Новые сигналы остановлены: после серии неудач хочется отыграться, и именно так теряют депозит. ' +
      'Сделай перерыв и вернись завтра. Лимиты можно изменить в настройках, но лучше этого не делать.</p></div></article>';
    $('livecard').hidden = true; $('rankcard').hidden = true; $('stratcard').hidden = true;
  }

  function showTop(top, ranked, stale, errors) {
    const { pair, res } = top, b = res.best, cls = b.dir > 0 ? 'up' : 'down';
    const chips = b.contrib.map(c => '<li>' + short(c.id, c.name) + (c.age ? ' <small>' + c.age + ' св. назад</small>' : '') + '</li>').join('');
    $('result').hidden = false;
    $('result').innerHTML =
      '<article class="ticket ' + cls + '" id="ticket">' +
      '<div class="tk-main"><div class="tk-pair">' + pair + '</div><div class="tk-dir">' + dirWord(b.dir) + '</div>' +
      '<div class="tk-exp">на ' + expTxt(b.h) + '</div></div>' + ring(arrow(b.dir)) +
      '<div class="tk-why"><p>Совпали ' + plural(b.count) + ' (нужно минимум ' + res.minAgree + '), подтверждённых против нет. ' +
      'Чтобы не терять, нужно угадывать не реже ' + pct(res.be) + '.</p><p>' + stakeTxt() + '</p><ul class="chips">' + chips + '</ul></div>' +
      '<p class="tk-foot" id="tkfoot"></p></article>' + notes(stale, errors);

    const rest = ranked.slice(1);
    $('rankcard').hidden = rest.length === 0;
    $('rank').innerHTML = rest.map(r => {
      const x = r.res.best;
      return '<tr><td><b>' + r.pair + '</b></td><td><span class="' + dirCls(x.dir) + '">' + dirWord(x.dir) + '</span> на ' + expTxt(x.h) +
        ' <small>' + plural(x.count) + '</small></td></tr>';
    }).join('');

    $('stratcard').hidden = false;
    $('strats').innerHTML = res.per.map(p => {
      const st = p.stats[b.h];
      const flag = p.dir ? ' <span class="' + dirCls(p.dir) + '">' + arrow(p.dir) + '</span>' : '';
      return '<tr><td>' + short(p.id, p.name) + flag + '</td><td>' + pct(st.adj) + ' из ' + pct(res.be) + ' <small>(' + st.n + ')</small>' + (st.ok ? ' <span class="b">✓</span>' : '') + '</td></tr>';
    }).join('');

    if (S.source !== 'demo') {
      journal = Journal.add(journal, { pair, tf: S.tf, t0: res.last.t, price: res.last.c, dir: b.dir, h: b.h });
      saveJ(); renderJournal();
    }
    startLive(pair, res.last.t, b.dir);
  }

  /* ---------- живой график и обратный отсчёт ---------- */
  function startLive(pair, signalT, dir) {
    stopLive();
    live = { pair, signalT, dir, timer: null, refPrice: store[pair][store[pair].length - 2].c };
    $('livecard').hidden = false;
    $('livepair').textContent = pair;
    $('term').value = ''; $('termnote').textContent = '';
    initChart();
    updateLive();
    tickCountdown();
    const demo = S.source === 'demo';
    live.timer = setInterval(demo ? tickLive : pollLive, demo ? 1500 : 20000);
  }
  function stopLive() { if (live && live.timer) clearInterval(live.timer); live = null; destroyChart(); }

  function tickLive() {
    if (!live) return;
    Data.tickDemo(store[live.pair], live.pair, S.tf);
    updateLive();
  }
  async function pollLive() {
    if (!live || document.hidden) return;
    const pair = live.pair;
    try {
      const c = await Data.fetchTwelve(pair, S.tf, S.key);
      if (live && live.pair === pair) { store[pair] = c; updateLive(); }
    } catch (e) { $('livenote').textContent = 'Не удалось обновить: ' + e.message; }
  }

  // Кольцо показывает, сколько осталось до закрытия свечи, следующей за свечой сигнала: пока она идёт, сигнал свежий
  function tickCountdown() {
    if (!live) return;
    const c = store[live.pair], last = c[c.length - 1], closed = c[c.length - 2];
    const total = TFS[S.tf].ms, remain = closed.t === live.signalT ? Math.max(0, Data.parseT(last.t) + total - Date.now()) : 0;
    const fresh = remain > 0;
    const arc = $('ringarc'); if (arc) arc.style.strokeDashoffset = String(RING * (1 - remain / total));
    const sec = $('cdsec'); if (sec) sec.textContent = fresh ? Math.ceil(remain / 1000) + ' с' : 'вышел';
    const foot = $('tkfoot');
    if (foot) foot.innerHTML = fresh
      ? 'Сигнал свежий ещё <b>' + Math.ceil(remain / 1000) + ' с</b>, потом нужен новый подбор.'
      : '<span class="warn">Сигнал устарел: закрылась новая свеча. Нажми «Подобрать пару» ещё раз.</span>';
    const tk = $('ticket'); if (tk) tk.classList.toggle('stale', !fresh);
  }

  function updateLive() {
    if (!live) return;
    const c = store[live.pair], last = c[c.length - 1];
    const dec = live.pair.includes('JPY') ? 3 : 5;
    $('liveprice').textContent = last.c.toFixed(dec);
    $('livenote').textContent = 'Пунктир: цена на момент сигнала ' + live.refPrice.toFixed(dec) + '. Время свечей в UTC.';
    renderChart(c);
    termCheck();
    tickCountdown();
  }

  /* ---------- сверка цены с терминалом ---------- */
  function termCheck() {
    const note = $('termnote');
    if (!live) { note.textContent = ''; return; }
    const v = parseFloat($('term').value);
    if (!isFinite(v)) { note.textContent = ''; return; }
    const c = store[live.pair], last = c[c.length - 1];
    const pip = live.pair.includes('JPY') ? 0.01 : 0.0001, dec = live.pair.includes('JPY') ? 3 : 5;
    const m = Math.min(20, c.length - 1);
    let rng = 0; for (let j = 1; j <= m; j++) rng += c[c.length - 1 - j].h - c[c.length - 1 - j].l;
    const avg = rng / m / pip, diff = (v - last.c) / pip;
    const ratio = avg > 0 ? Math.abs(diff) / avg : 0;
    let msg = 'Терминал ' + v.toFixed(dec) + ', источник ' + last.c.toFixed(dec) + ': расхождение ' + (Math.round(diff * 10) / 10 || 0).toFixed(1) +
      ' пп при среднем размахе свечи ' + avg.toFixed(1) + ' пп. ';
    let warn = false;
    if (ratio > 0.5) { msg += 'Расхождение больше половины типичной свечи: цены заметно разные, сигнал может не подходить.'; warn = true; }
    else if (ratio > 0.25) { msg += 'Расхождение заметное, учитывай его при входе.'; warn = true; }
    else msg += 'Расхождение небольшое.';
    if (avg > 0 && ((v - live.refPrice) / pip) * live.dir > 0.5 * avg) {
      msg += ' Цена уже ушла в сторону сигнала дальше, чем на полсвечи: вход запоздал.'; warn = true;
    }
    note.className = 'note' + (warn ? ' warn' : '');
    note.textContent = msg;
  }

  /* ---------- график: Lightweight Charts, запасной вариант canvas ---------- */
  const UP = '#3DD6A3', DOWN = '#FF7A6B';
  let lw = null;
  const sec = (t) => Math.floor(Data.parseT(t) / 1000);
  const bar = (k) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c });

  function destroyChart() {
    if (lw) { try { lw.chart.remove(); } catch (e) {} lw = null; }
  }
  function useCanvas(on) { $('cv').hidden = !on; $('lw').hidden = on; }

  function initChart() {
    destroyChart();
    const LC = window.LightweightCharts;
    if (!LC || !live) { useCanvas(true); return; }
    try {
      useCanvas(false);
      const grid = { color: 'rgba(143,166,176,.12)' };
      const chart = LC.createChart($('lw'), {
        width: $('lw').clientWidth || 340, height: 240,
        layout: { background: { color: 'transparent' }, textColor: '#8FA6B0' },
        grid: { vertLines: grid, horzLines: grid },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      });
      const candle = chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
      });
      const lineOpts = (color) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const e9 = chart.addLineSeries(lineOpts('#F2B84B')), e21 = chart.addLineSeries(lineOpts('#6FB7FF'));
      candle.createPriceLine({ price: live.refPrice, color: live.dir > 0 ? UP : DOWN, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'сигнал' });
      lw = { chart, candle, e9, e21, fitted: false, lastT: 0, n: 0 };
    } catch (e) { destroyChart(); useCanvas(true); }
  }

  function renderChart(c) {
    if (!lw) { drawChart(c); return; }
    try {
      const n = c.length, last = c[n - 1], t = sec(last.t);
      const cl = c.map(x => x.c), e9 = Indicators.ema(cl, 9), e21 = Indicators.ema(cl, 21);
      if (lw.fitted && t === lw.lastT && n === lw.n) {
        lw.candle.update(bar(last));
        lw.e9.update({ time: t, value: e9[n - 1] });
        lw.e21.update({ time: t, value: e21[n - 1] });
      } else {
        const range = lw.fitted ? lw.chart.timeScale().getVisibleLogicalRange() : null;
        lw.candle.setData(c.map(bar));
        lw.e9.setData(c.map((k, i) => ({ time: sec(k.t), value: e9[i] })));
        lw.e21.setData(c.map((k, i) => ({ time: sec(k.t), value: e21[i] })));
        lw.chart.timeScale().setVisibleLogicalRange(range || { from: n - 70, to: n + 4 });
        lw.fitted = true;
      }
      lw.lastT = t; lw.n = n;
    } catch (e) { destroyChart(); useCanvas(true); drawChart(c); }
  }

  function drawChart(c) {
    const cv = $('cv'), N = 70, n = c.length, s = n - N, dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    const cl = c.map(x => x.c), e9 = Indicators.ema(cl, 9), e21 = Indicators.ema(cl, 21);
    let lo = Infinity, hi = -Infinity;
    for (let i = s; i < n; i++) { lo = Math.min(lo, c[i].l); hi = Math.max(hi, c[i].h); }
    if (live) { lo = Math.min(lo, live.refPrice); hi = Math.max(hi, live.refPrice); }
    const pad = (hi - lo) * 0.08 || 1e-6; lo -= pad; hi += pad;
    const cw = (w - 8) / N, px = i => 4 + (i - s + 0.5) * cw, py = v => h - 4 - (v - lo) / (hi - lo) * (h - 8);
    const line = (arr, color) => { g.beginPath(); g.strokeStyle = color; g.lineWidth = 1.2; g.setLineDash([]);
      for (let i = s; i < n; i++) { const x = px(i), y = py(arr[i]); i === s ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); };
    for (let i = s; i < n; i++) {
      const k = c[i], col = k.c >= k.o ? UP : DOWN, x = px(i);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, py(k.h)); g.lineTo(x, py(k.l)); g.stroke();
      const y1 = py(Math.max(k.o, k.c)), y2 = py(Math.min(k.o, k.c));
      g.fillRect(x - cw * 0.3, y1, cw * 0.6, Math.max(1, y2 - y1));
    }
    line(e9, '#F2B84B'); line(e21, '#6FB7FF');
    if (live) {
      g.beginPath(); g.setLineDash([4, 4]); g.strokeStyle = live.dir > 0 ? UP : DOWN; g.lineWidth = 1;
      g.moveTo(0, py(live.refPrice)); g.lineTo(w, py(live.refPrice)); g.stroke(); g.setLineDash([]);
    }
  }

  /* ---------- подбор пары ---------- */
  async function scan() {
    if (busy) return;
    busy = true; stopLive(); S.n++;
    $('scan').disabled = true; $('scanlabel').textContent = 'Анализирую…';
    $('progwrap').hidden = false; $('prog').style.width = '0%';
    const pairs = Object.keys(PAIRS), results = [], stale = [], errors = [];
    for (let k = 0; k < pairs.length; k++) {
      const pair = pairs[k];
      $('status').textContent = 'Анализ ' + pair + ', ' + (k + 1) + ' из ' + pairs.length;
      $('prog').style.width = Math.round(k / pairs.length * 100) + '%';
      try {
        const candles = S.source === 'demo' ? Data.genDemo(pair, S.tf, S.n, Data.HISTORY) : await Data.fetchTwelve(pair, S.tf, S.key);
        if (S.source !== 'demo' && Data.isStale(candles, S.tf)) { stale.push(pair); continue; }
        store[pair] = candles;
        results.push({ pair, res: Scanner.analyzePair(candles.slice(0, -1), S.payout, S.minAgree) });
      } catch (e) {
        errors.push(pair + ': ' + e.message);
        if (/ключ/i.test(e.message)) break;
      }
    }
    if (S.source !== 'demo') { journal = Journal.resolve(journal, store, tfMsMap, S.tf); saveJ(); renderJournal(); }
    const ranked = Scanner.rank(results);
    $('progwrap').hidden = true;
    $('status').textContent = S.source === 'demo' ? 'Демо-режим: данные случайные, результат ничего не говорит о рынке.' : '';
    const rk = S.source !== 'demo' ? riskNow() : null;
    if (rk && rk.blocked) showBlocked(rk);
    else if (ranked.length) showTop(ranked[0], ranked, stale, errors);
    else showNone(results, stale, errors);
    busy = false; $('scan').disabled = false; $('scanlabel').textContent = 'Подобрать пару';
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.impactOccurred('medium'); } catch (e) {} }
  }

  /* ---------- интерфейс ---------- */
  $('tfs').innerHTML = Object.keys(TFS).map(t => '<button data-t="' + t + '">' + TFS[t].label + '</button>').join('');
  function sync() {
    $('source').value = S.source; $('key').value = S.key; $('payout').value = S.payout; $('minagree').value = String(S.minAgree);
    $('stake').value = S.stake; $('balance').value = S.balance > 0 ? S.balance : '';
    $('stopstreak').value = String(S.stopStreak); $('stopdaily').value = String(S.stopDaily);
    const live_ = S.source !== 'demo';
    $('src').className = 'pill' + (live_ ? ' live' : '');
    $('src').innerHTML = '<i></i><b>' + (live_ ? 'Twelve Data' : 'демо') + '</b>';
    document.querySelectorAll('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tf));
  }
  $('tfs').onclick = (e) => { const t = e.target.dataset.t; if (!t) return; S.tf = t; save(); sync(); };
  $('source').onchange = (e) => { S.source = e.target.value; save(); sync(); };
  $('key').onchange = (e) => { S.key = e.target.value.trim(); save(); };
  $('payout').onchange = (e) => { S.payout = Math.min(100, Math.max(50, +e.target.value || 85)); save(); sync(); };
  $('minagree').onchange = (e) => { S.minAgree = Math.min(4, Math.max(1, +e.target.value || 2)); save(); sync(); };
  $('stake').onchange = (e) => { S.stake = Math.min(5, Math.max(0.5, +e.target.value || 1)); save(); sync(); };
  $('balance').onchange = (e) => { S.balance = Math.max(0, +e.target.value || 0); save(); sync(); };
  $('stopstreak').onchange = (e) => { S.stopStreak = +e.target.value || 0; save(); sync(); renderJournal(); };
  $('stopdaily').onchange = (e) => { S.stopDaily = +e.target.value || 0; save(); sync(); renderJournal(); };
  $('scan').onclick = scan;
  $('jclear').onclick = () => { journal = []; saveJ(); renderJournal(); };
  $('term').oninput = termCheck;
  window.addEventListener('resize', () => {
    if (!live) return;
    if (lw) { try { lw.chart.resize($('lw').clientWidth || 340, 240); } catch (e) {} } else updateLive();
  });
  setInterval(tickCountdown, 1000);
  sync();
  renderJournal();
})();

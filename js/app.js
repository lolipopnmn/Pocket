(function () {
  const $ = (id) => document.getElementById(id);
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

  const { PAIRS, TFS } = Data;
  const S = { tf: '1m', source: 'demo', key: '', payout: 85, n: 0 };
  try { Object.assign(S, JSON.parse(localStorage.getItem('pocketfx') || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem('pocketfx', JSON.stringify({ tf: S.tf, source: S.source, key: S.key, payout: S.payout })); } catch (e) {} };

  const store = {};     // свечи по парам для текущего подбора
  let live = null;      // { pair, timer, signalT, dir }
  let busy = false;

  const pct = (x) => (x * 100).toFixed(1) + '%';
  const tfMin = () => TFS[S.tf].ms / 60000;
  const dirCls = (d) => (d > 0 ? 'b' : d < 0 ? 's' : 'n');
  const dirTxt = (d) => (d > 0 ? 'ВВЕРХ ▲' : d < 0 ? 'ВНИЗ ▼' : '—');
  const expTxt = (h) => (h * tfMin()) + ' мин';

  /* ---------- вывод результата ---------- */
  function showNone(total, stale, errors) {
    const box = $('result');
    box.className = 'card signal wait'; box.hidden = false;
    let sub = 'Проанализировано пар: ' + total + '. Ни у одной нет сигнала, у которого на истории было бы преимущество над точкой безубыточности. Это нормальный результат: чаще всего лучше не входить.';
    if (stale.length) sub += '<br><span class="warn">Нет свежих свечей (рынок закрыт?): ' + stale.join(', ') + '.</span>';
    box.innerHTML = '<div class="dir">НЕ ЗАХОДИТЬ</div><div class="sub">' + sub + '</div>' + errHtml(errors);
    $('livecard').hidden = true; $('rankcard').hidden = true; $('stratcard').hidden = true;
  }
  const errHtml = (errors) => errors.length ? '<div class="sub warn">' + errors.join('<br>') + '</div>' : '';

  function showTop(top, ranked, total, stale, errors) {
    const { pair, res } = top, b = res.best;
    const box = $('result');
    box.className = 'card signal ' + (b.dir > 0 ? 'buy' : 'sell'); box.hidden = false;
    const lines = b.contrib.map(c =>
      '<tr><td>' + c.name + '</td><td>' + pct(c.adj) + ' (' + c.n + ')</td></tr>').join('');
    box.innerHTML =
      '<div class="pair">' + pair + '</div>' +
      '<div class="dir">' + (b.dir > 0 ? 'BUY ▲' : 'SELL ▼') + '</div>' +
      '<div class="exp">на ' + expTxt(b.h) + '</div>' +
      '<div class="sub">Совпали стратегии: ' + b.contrib.length + ' из ' + res.per.length +
      '. Нужно угадывать минимум ' + pct(res.be) + ', чтобы не терять.</div>' +
      '<table style="margin-top:12px;text-align:left"><tr><td class="note">Сработавшая стратегия</td><td class="note">угадано (сделок)</td></tr>' + lines + '</table>' +
      (stale.length ? '<div class="sub warn">Нет свежих свечей: ' + stale.join(', ') + '</div>' : '') + errHtml(errors);

    // остальные пары
    const rest = ranked.slice(1);
    $('rankcard').hidden = rest.length === 0;
    $('rank').innerHTML = rest.map(r =>
      '<tr><td>' + r.pair + '</td><td class="' + dirCls(r.res.best.dir) + '">' + dirTxt(r.res.best.dir) + ' · ' + expTxt(r.res.best.h) + '</td></tr>').join('');

    // таблица стратегий для выбранной пары
    $('stratcard').hidden = false;
    $('strats').innerHTML = res.per.map(p => {
      const st = p.stats[b.h];
      const flag = p.dir ? '<span class="' + dirCls(p.dir) + '">' + (p.dir > 0 ? '▲ ' : '▼ ') + '</span>' : '';
      return '<tr><td>' + flag + p.name + '</td><td>' + pct(st.adj) + ' / ' + pct(res.be) + ' (' + st.n + ')</td></tr>';
    }).join('');

    startLive(pair, res.last.t, b.dir);
  }

  /* ---------- живой график ---------- */
  function startLive(pair, signalT, dir) {
    stopLive();
    live = { pair, signalT, dir, timer: null, refPrice: store[pair][store[pair].length - 2].c };
    $('livecard').hidden = false;
    $('livepair').textContent = pair;
    $('term').value = ''; $('termnote').textContent = '';
    initChart();
    updateLive();
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

  function updateLive() {
    if (!live) return;
    const c = store[live.pair], last = c[c.length - 1], closed = c[c.length - 2];
    const dec = live.pair.includes('JPY') ? 3 : 5;
    $('liveprice').textContent = last.c.toFixed(dec);
    const remain = Math.max(0, Math.round((Data.parseT(last.t) + TFS[S.tf].ms - Date.now()) / 1000));
    const fresh = closed.t === live.signalT;
    $('livenote').innerHTML = fresh
      ? 'Сигнал актуален ещё около ' + remain + ' с (до закрытия свечи). Пунктир: цена на момент сигнала ' + live.refPrice.toFixed(dec) + '. Время свечей в UTC.'
      : '<span class="warn">Сигнал устарел: закрылась новая свеча. Нажми «Подобрать пару» ещё раз.</span>';
    renderChart(c);
    termCheck();
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
  let lw = null;
  const sec = (t) => Math.floor(Data.parseT(t) / 1000);
  const bar = (k) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c });
  function cssVar(n, d) { try { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; } catch (e) { return d; } }

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
      const grid = { color: 'rgba(138,147,166,.12)' };
      const chart = LC.createChart($('lw'), {
        width: $('lw').clientWidth || 340, height: 240,
        layout: { background: { color: 'transparent' }, textColor: cssVar('--text', '#e8ecf3') },
        grid: { vertLines: grid, horzLines: grid },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      });
      const candle = chart.addCandlestickSeries({
        upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      });
      const lineOpts = (color) => ({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const e9 = chart.addLineSeries(lineOpts('#f59e0b')), e21 = chart.addLineSeries(lineOpts('#3b82f6'));
      candle.createPriceLine({ price: live.refPrice, color: live.dir > 0 ? '#22c55e' : '#ef4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'сигнал' });
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
      const k = c[i], col = k.c >= k.o ? '#22c55e' : '#ef4444', x = px(i);
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, py(k.h)); g.lineTo(x, py(k.l)); g.stroke();
      const y1 = py(Math.max(k.o, k.c)), y2 = py(Math.min(k.o, k.c));
      g.fillRect(x - cw * 0.3, y1, cw * 0.6, Math.max(1, y2 - y1));
    }
    line(e9, '#f59e0b'); line(e21, '#3b82f6');
    if (live) {
      g.beginPath(); g.setLineDash([4, 4]); g.strokeStyle = live.dir > 0 ? '#22c55e' : '#ef4444'; g.lineWidth = 1;
      g.moveTo(0, py(live.refPrice)); g.lineTo(w, py(live.refPrice)); g.stroke(); g.setLineDash([]);
    }
  }

  /* ---------- подбор пары ---------- */
  async function scan() {
    if (busy) return;
    busy = true; stopLive(); S.n++;
    $('scan').disabled = true;
    const pairs = Object.keys(PAIRS), results = [], stale = [], errors = [];
    for (let k = 0; k < pairs.length; k++) {
      const pair = pairs[k];
      $('status').textContent = 'Анализ ' + pair + ' (' + (k + 1) + ' из ' + pairs.length + ')…';
      try {
        const candles = S.source === 'demo' ? Data.genDemo(pair, S.tf, S.n) : await Data.fetchTwelve(pair, S.tf, S.key);
        if (S.source !== 'demo' && Data.isStale(candles, S.tf)) { stale.push(pair); continue; }
        store[pair] = candles;
        results.push({ pair, res: Scanner.analyzePair(candles.slice(0, -1), S.payout) });
      } catch (e) {
        errors.push(pair + ': ' + e.message);
        if (/ключ/i.test(e.message)) break;
      }
    }
    const ranked = Scanner.rank(results);
    $('status').textContent = S.source === 'demo' ? 'Демо-режим: данные случайные, результат ничего не говорит о рынке.' : '';
    if (ranked.length) showTop(ranked[0], ranked, results.length, stale, errors);
    else showNone(results.length, stale, errors);
    busy = false; $('scan').disabled = false;
    if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.impactOccurred('medium'); } catch (e) {} }
  }

  /* ---------- интерфейс ---------- */
  $('tfs').innerHTML = Object.keys(TFS).map(t => '<button data-t="' + t + '">' + TFS[t].label + '</button>').join('');
  function sync() {
    $('source').value = S.source; $('key').value = S.key; $('payout').value = S.payout;
    $('src').textContent = S.source === 'demo' ? 'демо-данные' : 'Twelve Data';
    document.querySelectorAll('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tf));
  }
  $('tfs').onclick = (e) => { const t = e.target.dataset.t; if (!t) return; S.tf = t; save(); sync(); };
  $('source').onchange = (e) => { S.source = e.target.value; save(); sync(); };
  $('key').onchange = (e) => { S.key = e.target.value.trim(); save(); };
  $('payout').onchange = (e) => { S.payout = Math.min(100, Math.max(50, +e.target.value || 85)); save(); sync(); };
  $('scan').onclick = scan;
  $('term').oninput = termCheck;
  window.addEventListener('resize', () => {
    if (!live) return;
    if (lw) { try { lw.chart.resize($('lw').clientWidth || 340, 240); } catch (e) {} } else updateLive();
  });
  sync();
})();

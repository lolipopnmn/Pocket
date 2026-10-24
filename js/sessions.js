/* Торговые сессии forex. Часы считаются по местному времени городов (с учётом перехода на летнее время),
   а не жёстко в UTC: в UTC они сдвигаются дважды в год. Самое активное время: Лондон и Нью-Йорк открыты
   одновременно. «Тихие часы» (открыт только Сидней или ничего) это допущение: мало ликвидности, шире разброс. */
(function (root) {
  const SESS = [
    { id: 'sydney', name: 'Сидней', tz: 'Australia/Sydney', from: 8, to: 17 },
    { id: 'tokyo', name: 'Токио', tz: 'Asia/Tokyo', from: 9, to: 18 },
    { id: 'london', name: 'Лондон', tz: 'Europe/London', from: 8, to: 17 },
    { id: 'newyork', name: 'Нью-Йорк', tz: 'America/New_York', from: 8, to: 17 },
  ];

  const fmtCache = {};
  function local(ms, tz) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }));
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { h: +o.hour + (+o.minute) / 60, wd: o.weekday };
  }

  // Рыночная неделя: с воскресенья 17:00 до пятницы 17:00 по Нью-Йорку
  function closed(ms) {
    const ny = local(ms, 'America/New_York');
    return ny.wd === 'Sat' || (ny.wd === 'Fri' && ny.h >= 17) || (ny.wd === 'Sun' && ny.h < 17);
  }

  function at(ms) {
    if (closed(ms)) return { level: 'closed', open: [], label: 'Рынок закрыт' };
    const open = SESS.filter(s => { const l = local(ms, s.tz); return l.h >= s.from && l.h < s.to; });
    const ids = open.map(s => s.id);
    const names = open.map(s => s.name).join(', ');
    if (ids.includes('london') && ids.includes('newyork')) return { level: 'peak', open: ids, label: 'Лондон и Нью-Йорк открыты: самое активное время' };
    if (ids.includes('london') || ids.includes('newyork') || ids.includes('tokyo')) return { level: 'active', open: ids, label: 'Открыто: ' + names };
    return { level: 'quiet', open: ids, label: 'Тихие часы: ' + (names ? 'открыт только ' + names : 'крупных сессий нет') + ', ликвидность ниже' };
  }

  root.Sessions = { at, closed, SESS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Sessions;
})(typeof window !== 'undefined' ? window : globalThis);

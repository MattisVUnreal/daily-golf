/* Hole of the Day — daily schedule, scoring names, save data, streaks & stats. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const LAUNCH = Date.UTC(2026, 9, 6); // Hole #1 = 6 Oct 2026 (UTC)
  const CYCLE = 63;                    // 9 weeks; holes repeat mirrored after that
  const MILESTONES = [3, 7, 14, 30, 100];
  const MAX_STROKES = 10;

  /* ---------- schedule ---------- */
  const launchWeekday = (new Date(LAUNCH).getUTCDay() + 6) % 7; // Monday = 0

  function buildSchedule(holes) {
    // 60 holes + 3 mirrored mid-difficulty repeats fill a 63-slot (9 week) cycle
    const entries = holes.map((h, i) => ({ idx: i, mirror: false, d: h.d }));
    const sorted = entries.slice().sort((a, b) => a.d - b.d || a.idx - b.idx);
    for (const k of [22, 36, 48]) entries.push({ idx: sorted[k].idx, mirror: true, d: sorted[k].d + 0.01 });
    entries.sort((a, b) => a.d - b.d || a.idx - b.idx);
    // weekly rhythm: Monday easy -> weekend hardest, slowly rising over the weeks
    const WEEKDAY = [0, 1.1, 2.2, 3.3, 4.4, 6, 6.3];
    const slots = [];
    for (let s = 0; s < CYCLE; s++) slots.push({ s, score: Math.floor(s / 7) * 0.9 + WEEKDAY[s % 7] });
    slots.sort((a, b) => a.score - b.score || a.s - b.s);
    const table = new Array(CYCLE);
    slots.forEach((sl, i) => { table[sl.s] = entries[i]; });
    // keep each mirrored repeat at least 3 weeks away from its original (same weekday swap)
    for (let s = 0; s < CYCLE; s++) {
      const e = table[s];
      if (!e.mirror) continue;
      const orig = table.findIndex(x => x.idx === e.idx && !x.mirror);
      if (Math.abs(orig - s) >= 21) continue;
      let best = -1;
      for (let t = s % 7; t < CYCLE; t += 7) {
        if (table[t].mirror || Math.abs(t - orig) < 21 || t === 0) continue;
        if (best < 0 || Math.abs(table[t].d - e.d) < Math.abs(table[best].d - e.d)) best = t;
      }
      if (best >= 0) { table[s] = table[best]; table[best] = e; }
    }
    // slot 0..launchWeekday-1 are before launch in the first cycle: open with the gentlest hole
    const first = table[launchWeekday];
    table[launchWeekday] = table[0]; table[0] = first;
    return table;
  }

  function dayIndex(now) { return Math.floor(((now == null ? Date.now() : now) - LAUNCH) / DAY); }
  function dateOfDay(d) { return new Date(LAUNCH + d * DAY); }
  function msToNextDay(now) {
    const t = now == null ? Date.now() : now;
    return DAY - ((t - LAUNCH) % DAY + DAY) % DAY;
  }

  let table = null;
  function holeForDay(d) {
    const H = root.HOTD.HOLES;
    if (!table) table = buildSchedule(H);
    const q = d + launchWeekday;
    const cycle = Math.floor(q / CYCLE), slot = ((q % CYCLE) + CYCLE) % CYCLE;
    const e = table[slot];
    return { hole: H[e.idx], idx: e.idx, mirror: e.mirror !== (cycle % 2 === 1), number: d + 1 };
  }

  /* ---------- scoring ---------- */
  function scoreInfo(strokes, par) {
    const r = strokes - par;
    if (strokes === 1) return { key: 'ace', name: 'Hole-in-one', emoji: '🏆', rel: r };
    if (r <= -3) return { key: 'albatross', name: 'Albatross', emoji: '🕊️', rel: r };
    if (r === -2) return { key: 'eagle', name: 'Eagle', emoji: '🦅', rel: r };
    if (r === -1) return { key: 'birdie', name: 'Birdie', emoji: '🐦', rel: r };
    if (r === 0) return { key: 'par', name: 'Par', emoji: '👌', rel: r };
    if (r === 1) return { key: 'bogey', name: 'Bogey', emoji: '😅', rel: r };
    if (r === 2) return { key: 'double', name: 'Double Bogey', emoji: '😬', rel: r };
    return { key: 'triple', name: r === 3 ? 'Triple Bogey' : 'Triple Bogey+', emoji: '🫠', rel: r };
  }
  const BUCKETS = [
    ['ace', '🏆 Ace'], ['albatross', 'Albatross'], ['eagle', 'Eagle'], ['birdie', 'Birdie'],
    ['par', 'Par'], ['bogey', 'Bogey'], ['double', 'Double'], ['triple', 'Triple+'],
  ];
  const relText = r => (r === 0 ? 'E' : r > 0 ? '+' + r : String(r));

  /* ---------- save data ---------- */
  const KEY = 'hotd.save.v1';
  const DEFAULTS = { results: {}, practice: {}, progress: null, tutorial: false, skin: 'classic', trail: 'simple', sound: true, seenUnlock: 0 };
  let data = null;
  function load() {
    if (data) return data;
    try { data = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { data = Object.assign({}, DEFAULTS); }
    return data;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* private mode: play on */ } }

  function recordDaily(day, strokes, par) {
    const d = load();
    if (d.results[day]) return false; // official score is locked
    d.results[day] = { s: strokes, p: par, ts: Date.now() };
    d.progress = null;
    save();
    return true;
  }

  /* ---------- streaks & stats ---------- */
  function streaks(today) {
    const r = load().results;
    let cur = 0;
    let d = r[today] ? today : today - 1;
    while (r[d]) { cur++; d--; }
    let best = 0, run = 0, prev = null;
    Object.keys(r).map(Number).sort((a, b) => a - b).forEach(k => {
      run = prev !== null && k === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run); prev = k;
    });
    return { current: cur, best };
  }

  function stats() {
    const r = load().results;
    const keys = Object.keys(r);
    const dist = {};
    BUCKETS.forEach(([k]) => (dist[k] = 0));
    let rel = 0, bestRel = null;
    for (const k of keys) {
      const e = r[k], info = scoreInfo(e.s, e.p);
      dist[info.key]++;
      rel += e.s - e.p;
      if (bestRel === null || e.s - e.p < bestRel) bestRel = e.s - e.p;
    }
    return { played: keys.length, avgRel: keys.length ? rel / keys.length : 0, bestRel, dist, aces: dist.ace };
  }

  root.HOTD = Object.assign(root.HOTD || {}, {
    daily: {
      LAUNCH, MILESTONES, MAX_STROKES, BUCKETS,
      dayIndex, dateOfDay, msToNextDay, holeForDay, scoreInfo, relText,
      load, save, recordDaily, streaks, stats, buildSchedule,
    },
  });
})(window);

/* Hole of the Day — game flow, input, UI screens. */
(function () {
  'use strict';
  const { phys: P, daily: D, sfx, Renderer, SKINS, TRAILS, drawBall } = window.HOTD;
  const $ = s => document.querySelector(s);
  const save = D.load();
  sfx.setEnabled(save.sound !== false);

  const cv = $('#game');
  const R = new Renderer(cv);
  const hud = $('#hud');
  let today = D.dayIndex();
  let game = null;
  let drag = null, aim = null, lastTick = -1;
  let clock = 0;

  /* ---------- helpers ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* no haptics */ } };
  const gameUrl = () => location.href.split(/[?#]/)[0].replace(/index\.html$/, '');
  function fmtCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
  }
  let toastTimer = 0;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 1600);
  }
  function banner(html, big) {
    const b = $('#banner');
    b.innerHTML = html;
    b.className = '';
    void b.offsetWidth;
    b.className = 'show' + (big ? ' big' : '');
  }

  function layout() {
    R.insetTop = hud.getBoundingClientRect().bottom + 8;
    R.insetBottom = 14;
    R.resize();
  }

  /* ---------- rounds ---------- */
  function startRound(mode, day, resume) {
    const info = D.holeForDay(day);
    const course = P.buildCourse(info.hole, info.mirror);
    const sim = new P.Sim(course);
    game = {
      mode, day, info, course, sim, strokes: 0, done: false,
      lastSpot: { x: course.tee.x, y: course.tee.y },
      ball: { x: course.tee.x, y: course.tee.y, visible: true, scale: 0 },
      anim: { kind: 'pop', t: 0 },
    };
    if (resume) {
      game.strokes = resume.strokes;
      sim.placeBall(resume.x, resume.y);
      game.lastSpot = { x: resume.x, y: resume.y };
    }
    R.setCourse(course);
    aim = null; drag = null;
    updateHud();
    showTutorial(mode === 'daily' && !save.tutorial);
  }

  function startToday() {
    today = D.dayIndex();
    const res = save.results[today];
    if (res) {
      startRound('fun', today);
      showResult({ fromLoad: true });
    } else {
      const pr = save.progress && save.progress.day === today ? save.progress : null;
      startRound('daily', today, pr);
    }
  }

  function updateHud() {
    if (!game) return;
    const g = game, n = g.info.number;
    $('#hTitle').textContent = `Hole #${n} · Par ${g.course.par}`;
    const chip = g.mode === 'daily' ? '<span class="chip daily">Today</span>'
      : g.mode === 'practice' ? '<span class="chip practice">Practice</span>'
        : '<span class="chip fun">Just for fun</span>';
    $('#hSub').innerHTML = `${esc(g.course.name)} ${chip}`;
    const st = $('#strokes');
    st.querySelector('b').textContent = g.strokes;
    st.querySelector('span').textContent = g.strokes === 1 ? 'stroke' : 'strokes';
    st.classList.toggle('over', g.strokes > g.course.par);
  }
  function bumpStrokes() {
    const st = $('#strokes');
    st.classList.remove('bump'); void st.offsetWidth; st.classList.add('bump');
    updateHud();
  }

  function saveProgress(at) {
    if (!game || game.mode !== 'daily' || game.done) return;
    const p = at || game.sim.pos;
    save.progress = { day: game.day, strokes: game.strokes, x: p.x, y: p.y };
    D.save();
  }

  /* ---------- input ---------- */
  function canAim() {
    return game && !game.done && game.sim.phase === 'ready' && !game.anim && $('#sheet').hidden;
  }
  function maxDrag() { return Math.max(120, Math.min(280, Math.min(R.w, R.h) * 0.42)); }

  cv.addEventListener('pointerdown', e => {
    sfx.unlock();
    if (!canAim()) return;
    drag = { sx: e.clientX, sy: e.clientY, id: e.pointerId };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    aim = null; lastTick = -1;
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!canAim()) { drag = null; aim = null; return; }
    const dx = drag.sx - e.clientX, dy = drag.sy - e.clientY, len = Math.hypot(dx, dy);
    if (len < 10) { aim = null; return; }
    const power = Math.min(1, len / maxDrag());
    aim = { dx: dx / len, dy: dy / len, power };
    const tick = Math.floor(power * 10);
    if (tick !== lastTick) { if (lastTick >= 0) sfx.tick(); lastTick = tick; }
  });
  const release = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    if (aim && canAim() && e.type === 'pointerup') shoot(aim);
    aim = null;
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);

  function shoot(a) {
    const g = game;
    const pw = Math.max(0.03, a.power);
    const p = g.sim.pos;
    g.lastSpot = p;
    g.sim.shoot(a.dx * pw * P.MAX_SHOT, a.dy * pw * P.MAX_SHOT);
    g.strokes++;
    bumpStrokes();
    saveProgress(p); // a reload mid-roll keeps the stroke and returns to this spot
    sfx.hit(pw);
    vibrate(pw > 0.8 ? 18 : 8);
    if (pw > 0.82) R.shake = Math.max(R.shake, 0.32);
    R.burst(p.x - a.dx * 0.15, p.y - a.dy * 0.15, 6 + Math.round(pw * 8), { color: ['#ffffff', '#d8ffe0'], speed: 1.5 + pw * 3, vx: -a.dx * 1.5, vy: -a.dy * 1.5, size: 0.06, decay: 3.2 });
    if (!save.tutorial) { save.tutorial = true; D.save(); showTutorial(false); }
  }

  /* ---------- simulation events ---------- */
  function handleEvents() {
    const g = game, ev = g.sim.events;
    for (const e of ev) {
      if (e.type === 'hit') {
        if (e.kind === 'bumper' || e.kind === 'kicker') {
          sfx.bumper();
          R.burst(e.x, e.y, 8, { color: ['#ff5d8f', '#ffd23f', '#ffffff'], speed: 4, size: 0.07, decay: 3 });
        } else if (e.dv > 1.2) {
          sfx.bounce(e.dv);
          if (e.dv > 7) R.burst(e.x, e.y, 4, { color: '#ffffff', speed: 2.5, size: 0.05, decay: 4 });
        }
        if (e.dv > 13) { R.shake = Math.max(R.shake, Math.min(0.6, (e.dv - 9) / 26)); vibrate(10); }
      } else if (e.type === 'sink') {
        sfx.plop();
        vibrate([12, 40, 20]);
        const c = g.course.cup;
        R.ring(c.x, c.y, '#ffffff', 1.1);
        R.burst(c.x, c.y, 10, { color: ['#ffffff', '#c8f7d6'], speed: 2.2, size: 0.06, decay: 2.6 });
        g.anim = { kind: 'sink', t: 0, from: g.sim.pos };
      } else if (e.type === 'hazard') {
        g.strokes++;
        bumpStrokes();
        if (e.kind === 'water') {
          sfx.splash();
          R.burst(e.x, e.y, 18, { color: ['#7cc8ff', '#ffffff', '#3ba7f2'], speed: 3.5, size: 0.08, decay: 2 });
          R.ring(e.x, e.y, '#d6f0ff', 0.9);
          toast('Splash! +1 stroke');
        } else {
          sfx.oob();
          toast('Out of bounds! +1 stroke');
        }
        g.anim = { kind: e.kind === 'water' ? 'sinkWater' : 'fall', t: 0, from: { x: e.x, y: e.y } };
      } else if (e.type === 'portal') {
        sfx.portal();
        R.burst(e.from.x, e.from.y, 12, { color: ['#a259ff', '#d6b4ff'], speed: 3, size: 0.07 });
        R.burst(e.to.x, e.to.y, 12, { color: ['#ff9f1c', '#ffe1a8'], speed: 3, size: 0.07 });
        R.ring(e.to.x, e.to.y, '#ff9f1c', 0.8);
      } else if (e.type === 'boost') {
        sfx.boost();
        const p = g.sim.pos;
        R.burst(p.x, p.y, 10, { color: ['#ffd23f', '#fff3b0'], speed: 3, size: 0.07, decay: 3 });
      } else if (e.type === 'sand') {
        sfx.sand();
        const p = g.sim.pos;
        R.burst(p.x, p.y, 9, { color: ['#e8c26e', '#f6d98e'], speed: 2, size: 0.06, decay: 2.5 });
      } else if (e.type === 'stop') {
        g.lastSpot = { x: e.x, y: e.y };
        afterShot();
      }
    }
    ev.length = 0;
  }

  function afterShot() {
    const g = game;
    if (g.done) return;
    if (g.strokes >= D.MAX_STROKES) { finishRound(true); return; }
    saveProgress();
  }

  function updateAnim(dt) {
    const g = game, a = g.anim;
    const pos = g.sim.pos;
    g.ball.x = pos.x; g.ball.y = pos.y; g.ball.visible = true; g.ball.scale = 1;
    if (!a) return;
    a.t += dt;
    if (a.kind === 'pop') {
      const k = Math.min(1, a.t / 0.28);
      g.ball.scale = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.35 - (1 - k) * 0.9 : 1;
      g.ball.scale = Math.max(0, g.ball.scale);
      if (k >= 1) g.anim = null;
    } else if (a.kind === 'sink') {
      const k = Math.min(1, a.t / 0.16), c = g.course.cup;
      g.ball.x = a.from.x + (c.x - a.from.x) * k; g.ball.y = a.from.y + (c.y - a.from.y) * k;
      g.ball.scale = 1 - k * 0.75;
      if (k >= 1) { g.ball.visible = false; }
      if (a.t > 0.3 && !g.done) finishRound(false);
    } else if (a.kind === 'sinkWater' || a.kind === 'fall') {
      const k = Math.min(1, a.t / (a.kind === 'fall' ? 0.35 : 0.2));
      g.ball.x = a.from.x; g.ball.y = a.from.y;
      g.ball.scale = 1 - k;
      if (k >= 1) g.ball.visible = false;
      if (a.t > 0.75) {
        g.sim.placeBall(g.lastSpot.x, g.lastSpot.y);
        R.trail = [];
        g.anim = { kind: 'pop', t: 0 };
        if (g.strokes >= D.MAX_STROKES) finishRound(true);
        else saveProgress();
      }
    }
  }

  /* ---------- finishing ---------- */
  function unlockedAt(best) {
    return D.MILESTONES.filter(m => m <= best);
  }

  function finishRound(pickedUp) {
    const g = game;
    if (g.done) return;
    g.done = true;
    const strokes = Math.min(g.strokes, D.MAX_STROKES);
    const par = g.course.par;
    const info = D.scoreInfo(strokes, par);
    g.result = { strokes, par, info, pickedUp, newUnlocks: [] };
    if (g.mode === 'daily') {
      g.result.official = D.recordDaily(g.day, strokes, par);
      const best = D.streaks(today).best;
      const reached = unlockedAt(best);
      const top = reached.length ? reached[reached.length - 1] : 0;
      if (top > (save.seenUnlock || 0)) {
        g.result.newUnlocks = reached.filter(m => m > (save.seenUnlock || 0));
        save.seenUnlock = top;
        D.save();
      }
    } else if (g.mode === 'practice') {
      const prev = save.practice[g.day];
      if (!prev || strokes < prev) { save.practice[g.day] = strokes; D.save(); }
    }
    celebrate(info, pickedUp);
    const delay = info.key === 'ace' ? 2200 : info.rel < 0 ? 1500 : 1000;
    setTimeout(() => { if (game === g) showResult({}); }, delay);
  }

  function celebrate(info, pickedUp) {
    const c = game.course.cup;
    const s = R.toScreen(c.x, c.y);
    if (pickedUp) { banner('Picked up<small>10 stroke limit</small>'); sfx.sad(); return; }
    if (info.key === 'ace') {
      banner(`HOLE-IN-ONE! 🏆`, true);
      sfx.fanfare(3);
      R.confetti(160);
      R.confettiBurst(s.x, s.y, 60);
      R.shake = 0.5;
    } else if (info.rel <= -2) {
      banner(`${info.name}! ${info.emoji}`, true);
      sfx.fanfare(2);
      R.confettiBurst(s.x, s.y, 70);
      starBurst(c, 26);
    } else if (info.rel === -1) {
      banner(`${info.name}! ${info.emoji}`, true);
      sfx.fanfare(1);
      R.confettiBurst(s.x, s.y, 36);
      starBurst(c, 18);
    } else if (info.rel === 0) {
      banner(`Par ${info.emoji}`);
      sfx.fanfare(0);
      starBurst(c, 8);
    } else {
      banner(`${info.name}`);
      sfx.sad();
    }
  }
  function starBurst(c, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4;
      R.particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 1.1, size: 0.16 + Math.random() * 0.1, color: ['#ffd23f', '#ffffff', '#ff9fc0'][i % 3], kind: 'star', drag: 2.4 });
    }
  }

  /* ---------- sheets ---------- */
  const sheet = $('#sheet'), card = $('#card');
  let sheetName = null;
  function openSheet(name, html) {
    sheetName = name;
    card.innerHTML = `<button class="close-x" data-act="close" aria-label="Close">×</button>` + html;
    sheet.hidden = false;
    card.scrollTop = 0;
    drag = null; aim = null;
  }
  function closeSheet() { sheet.hidden = true; sheetName = null; }
  sheet.querySelector('.backdrop').addEventListener('click', () => { sfx.ui(); closeSheet(); });

  card.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    sfx.ui();
    const act = b.dataset.act, arg = b.dataset.arg;
    if (act === 'close') closeSheet();
    else if (act === 'menu') showMenu();
    else if (act === 'stats') showStats();
    else if (act === 'calendar') showCalendar(arg ? +arg : undefined);
    else if (act === 'practice') showPractice();
    else if (act === 'locker') showLocker();
    else if (act === 'help') showHelp();
    else if (act === 'share') share();
    else if (act === 'today') { closeSheet(); startToday(); }
    else if (act === 'fun') { closeSheet(); startRound('fun', today); }
    else if (act === 'play') { closeSheet(); startRound(+arg === today && !save.results[today] ? 'daily' : 'practice', +arg); }
    else if (act === 'restart') { closeSheet(); startRound(game.mode, game.day); }
    else if (act === 'sound') {
      save.sound = !(save.sound !== false); sfx.setEnabled(save.sound); D.save();
      b.classList.toggle('on', save.sound);
    } else if (act === 'skin' || act === 'trail') {
      save[act] = arg; D.save(); showLocker();
    } else if (act === 'equip') {
      const m = +arg;
      const s = SKINS.find(x => x.unlock === m), t = TRAILS.find(x => x.unlock === m);
      if (s) save.skin = s.id;
      if (t) save.trail = t.id;
      D.save(); toast('Equipped!'); showResult({});
    }
  });
  $('#btnMenu').addEventListener('click', () => { sfx.unlock(); sfx.ui(); showMenu(); });

  function countdownHtml() {
    return `<div class="countdown-box">Next hole in<span class="countdown">${fmtCountdown(D.msToNextDay())}</span></div>`;
  }

  function shareText() {
    const r = save.results[today];
    if (!r) return null;
    const info = D.scoreInfo(r.s, r.p);
    const st = D.streaks(today).current;
    return `⛳ Hole of the Day #${today + 1} — ${plural(r.s, 'stroke')} (par ${r.p}) ${info.emoji}\n🔥 Streak ${st}\n${gameUrl()}`;
  }
  async function share() {
    const text = shareText();
    if (!text) return;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* fall through */ }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    if (ok) toast('Result copied! Paste it anywhere 📋', 2200);
    else if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* cancelled */ } }
    else toast('Could not copy, sorry');
  }

  function unlockLabel(m) {
    const s = SKINS.find(x => x.unlock === m), t = TRAILS.find(x => x.unlock === m);
    return [s && `${s.name} ball`, t && `${t.name} trail`].filter(Boolean).join(' + ');
  }

  function showResult() {
    const g = game;
    const official = save.results[today];
    let html = '';
    const isOfficialView = g.mode === 'daily' || (!g.result && official);
    if (g.result && !isOfficialView) {
      // practice / just-for-fun result
      const r = g.result;
      html += `<div class="result-emoji">${r.info.emoji}</div>
        <p class="result-name">${r.pickedUp ? 'Picked up' : r.info.name}</p>
        <div class="pillrow"><span class="pill">${plural(r.strokes, 'stroke')}</span><span class="pill">Par ${r.par}</span><span class="pill">${D.relText(r.info.rel)}</span></div>
        <p class="note">${g.mode === 'practice' ? `Practice round on hole #${g.info.number}. It doesn't change your stats.` : 'Just for fun. Your official score for today is locked in.'}</p>
        <div class="row"><button class="btn primary" data-act="restart">↻ Play again</button><button class="btn" data-act="practice">More holes</button></div>`;
      if (official) html += `<button class="btn gold" data-act="share">Share today's result</button>`;
      html += countdownHtml();
    } else {
      const r = official;
      const info = D.scoreInfo(r.s, r.p);
      const st = D.streaks(today);
      html += `<p class="sub" style="margin:0 0 4px">Hole of the Day #${today + 1}</p>
        <div class="result-emoji">${info.emoji}</div>
        <p class="result-name">${info.name}</p>
        <div class="pillrow"><span class="pill">${plural(r.s, 'stroke')}</span><span class="pill">Par ${r.p}</span><span class="pill fire">🔥 Streak ${st.current}</span></div>`;
      if (g.result && g.result.newUnlocks && g.result.newUnlocks.length) {
        const m = g.result.newUnlocks[g.result.newUnlocks.length - 1];
        html += `<div class="unlock">🎉 ${m}-day streak! Unlocked: ${unlockLabel(m)}
          <button class="btn primary" data-act="equip" data-arg="${m}">Equip it</button></div>`;
      } else {
        const next = D.MILESTONES.find(m => m > st.best);
        if (next) html += `<p class="note">Play ${plural(next - st.current, 'more day')} in a row to unlock the ${unlockLabel(next)}.</p>`;
      }
      html += `<button class="btn gold" data-act="share">📋 Share result</button>
        <div class="row"><button class="btn" data-act="fun">Replay for fun</button><button class="btn" data-act="stats">Stats</button></div>
        ${countdownHtml()}`;
    }
    openSheet('result', html);
  }

  function showMenu() {
    const done = !!save.results[today];
    const st = D.streaks(today);
    const canRestart = game && game.mode !== 'daily';
    openSheet('menu', `<h2>⛳ Hole of the Day</h2>
      <p class="sub">🔥 Streak ${st.current} · best ${st.best}</p>
      <div class="menu-list">
        <button class="btn primary wide" data-act="today">${done ? "Today's result" : (game && game.mode === 'daily' ? 'Back to today\'s hole' : "Play today's hole")}</button>
        <button class="btn" data-act="stats"><span class="ic">📊</span>Stats</button>
        <button class="btn" data-act="calendar"><span class="ic">📅</span>Calendar</button>
        <button class="btn" data-act="practice"><span class="ic">🎯</span>Practice</button>
        <button class="btn" data-act="locker"><span class="ic">🎨</span>Ball &amp; trail</button>
        ${canRestart ? '<button class="btn wide" data-act="restart">↻ Restart this hole</button>' : ''}
        <button class="btn wide" data-act="help">❓ How to play</button>
      </div>
      ${countdownHtml()}`);
  }

  function showStats() {
    const s = D.stats(), st = D.streaks(today);
    const max = Math.max(1, ...Object.values(s.dist));
    const todayKey = save.results[today] ? D.scoreInfo(save.results[today].s, save.results[today].p).key : null;
    const avg = s.played ? (s.avgRel >= 0 ? '+' : '') + s.avgRel.toFixed(1) : '–';
    const bars = D.BUCKETS.map(([k, label]) => `<div class="bar"><span>${label}</span><div><div class="fill ${k === todayKey ? 'hot' : ''}" style="width:${Math.max(8, (s.dist[k] / max) * 100)}%">${s.dist[k]}</div></div></div>`).join('');
    const ms = D.MILESTONES.map(m => `<div class="ms ${st.best >= m ? 'done' : ''}"><b>${st.best >= m ? '🏅' : '🔒'}</b>${m} days</div>`).join('');
    let best = '–';
    if (s.aces) best = `${s.aces}× hole-in-one 🏆`;
    else if (s.bestRel !== null) best = `${D.relText(s.bestRel)} (${D.scoreInfo(10 + s.bestRel, 10).name})`;
    openSheet('stats', `<h2>📊 Statistics</h2>
      <div class="tiles">
        <div class="tile"><b>${s.played}</b><span>Played</span></div>
        <div class="tile"><b>${avg}</b><span>Avg vs par</span></div>
        <div class="tile"><b>${st.current}</b><span>Streak</span></div>
        <div class="tile"><b>${st.best}</b><span>Best streak</span></div>
      </div>
      <div class="pillrow" style="margin-top:0"><span class="pill">Best result: ${best}</span></div>
      <div class="section-h">Results</div>
      <div class="bars">${bars}</div>
      <div class="section-h">Streak rewards</div>
      <div class="milestones">${ms}</div>
      <div class="row"><button class="btn" data-act="calendar">📅 Calendar</button><button class="btn" data-act="locker">🎨 Ball &amp; trail</button></div>`);
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function showCalendar(monthKey) {
    const now = D.dateOfDay(today);
    const launch = D.dateOfDay(0);
    const firstKey = launch.getUTCFullYear() * 12 + launch.getUTCMonth();
    const lastKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
    const key = monthKey === undefined ? lastKey : Math.max(firstKey, Math.min(lastKey, monthKey));
    const y = Math.floor(key / 12), m = key % 12;
    const first = Date.UTC(y, m, 1);
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (new Date(first).getUTCDay() + 6) % 7;
    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(w => `<div class="wd">${w}</div>`).join('');
    for (let i = 0; i < lead; i++) cells += '<div class="day blank"></div>';
    for (let dnum = 1; dnum <= days; dnum++) {
      const di = D.dayIndex(Date.UTC(y, m, dnum) + 1000);
      const r = save.results[di];
      let cls = 'day', e = '', act = '';
      if (di < 0) cls += ' blank';
      else if (di > today) cls += ' future';
      else if (r) {
        const info = D.scoreInfo(r.s, r.p);
        cls += ' played' + (info.rel < 0 ? ' under' : info.rel > 0 ? ' over' : '');
        e = info.emoji;
        act = `data-act="play" data-arg="${di}"`;
      } else if (di === today) { e = '⛳'; act = 'data-act="today"'; }
      else { cls += ' missed'; e = '·'; }
      if (di === today) cls += ' today';
      cells += di < 0 ? `<div class="${cls}"></div>` : `<button class="${cls}" ${act} ${act ? '' : 'disabled'}><span class="e">${e}</span><span class="n">${dnum}</span></button>`;
    }
    openSheet('calendar', `<h2>📅 Calendar</h2><p class="sub">Tap a played day to practise it again.</p>
      <div class="cal-head"><button data-act="calendar" data-arg="${key - 1}" ${key <= firstKey ? 'disabled' : ''}>‹</button><b>${MONTHS[m]} ${y}</b><button data-act="calendar" data-arg="${key + 1}" ${key >= lastKey ? 'disabled' : ''}>›</button></div>
      <div class="cal">${cells}</div>
      <div class="legend"><span>🏆 ace</span><span>🦅 eagle</span><span>🐦 birdie</span><span>👌 par</span><span>😅 bogey</span><span>· missed</span></div>`);
  }

  function showPractice() {
    const days = Object.keys(save.results).map(Number).filter(d => d <= today).sort((a, b) => b - a);
    const items = days.map(d => {
      const r = save.results[d], info = D.scoreInfo(r.s, r.p), h = D.holeForDay(d);
      const pb = save.practice[d];
      const date = D.dateOfDay(d);
      return `<button class="pitem" data-act="play" data-arg="${d}">
        <span class="num">#${d + 1}</span>
        <span class="meta"><b>${esc(h.hole.n)}</b><span>${date.getUTCDate()} ${MONTHS[date.getUTCMonth()].slice(0, 3)} · par ${h.hole.par} · you: ${r.s}${pb ? ` · practice best: ${pb}` : ''}</span></span>
        <span class="sc">${info.emoji}</span></button>`;
    }).join('');
    openSheet('practice', `<h2>🎯 Practice</h2><p class="sub">Replay holes you've already played. Practice doesn't change your stats.</p>
      <div class="plist">${items || '<div class="empty">Finish today\'s hole to unlock it for practice. Every hole you play shows up here.</div>'}</div>`);
  }

  function showLocker() {
    const best = D.streaks(today).best;
    const item = (kind, x) => {
      const ok = best >= x.unlock;
      const on = save[kind] === x.id;
      return `<button class="lock-item ${on ? 'on' : ''} ${ok ? '' : 'locked'}" ${ok ? `data-act="${kind}" data-arg="${x.id}"` : 'disabled'}>
        <canvas data-kind="${kind}" data-id="${x.id}" width="128" height="88"></canvas>${x.name}
        <small>${ok ? (on ? 'Equipped' : 'Tap to equip') : `🔒 ${x.unlock}-day streak`}</small></button>`;
    };
    openSheet('locker', `<h2>🎨 Ball &amp; trail</h2><p class="sub">Keep your daily streak going to unlock more. Best streak: ${best}</p>
      <div class="section-h">Balls</div><div class="locker">${SKINS.map(s => item('skin', s)).join('')}</div>
      <div class="section-h">Trails</div><div class="locker">${TRAILS.map(t => item('trail', t)).join('')}</div>`);
    drawLockerPreviews();
  }
  function drawLockerPreviews() {
    card.querySelectorAll('canvas[data-kind]').forEach(c => {
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = '#5ccb6c';
      g.beginPath(); g.roundRect ? g.roundRect(0, 0, c.width, c.height, 18) : g.rect(0, 0, c.width, c.height); g.fill();
      g.setTransform(40, 0, 0, 40, 0, 0);
      if (c.dataset.kind === 'skin') {
        drawBall(g, 1.6, 1.1, 0.5, c.dataset.id, clock);
      } else {
        const id = c.dataset.id;
        for (let i = 0; i < 16; i++) {
          const f = i / 16, x = 0.35 + f * 2.2, y = 1.35 - Math.sin(f * 2.4) * 0.45;
          g.globalAlpha = f;
          if (id === 'dots') { if (i % 2) continue; g.fillStyle = i % 4 ? '#ff9f43' : '#fff'; g.beginPath(); g.arc(x, y, 0.07 + f * 0.06, 0, 7); g.fill(); continue; }
          const col = id === 'comet' ? '#a0c4ff' : id === 'rainbow' ? `hsl(${i * 22},95%,62%)` : id === 'fire' ? ['#ffd23f', '#ff9f1c', '#ff3b5c'][i % 3] : id === 'sparkle' ? '#fff6a8' : '#ffffff';
          g.fillStyle = col; g.beginPath(); g.arc(x, y, (id === 'comet' || id === 'rainbow' ? 0.18 : 0.11) * f + 0.02, 0, 7); g.fill();
        }
        g.globalAlpha = 1;
        drawBall(g, 2.7, 0.75, 0.22, save.skin, clock);
      }
    });
  }

  function showHelp() {
    const lg = (col, txt) => `<div class="lg"><i style="background:${col}"></i><span>${txt}</span></div>`;
    openSheet('help', `<h2>❓ How to play</h2>
      <p class="sub">Drag back from the ball to aim (like a slingshot). The further you pull, the harder the shot. Let go to shoot.</p>
      <div class="legend-list">
        ${lg('#f6d98e', '<b>Sand</b> slows the ball right down')}
        ${lg('#d4f2ff', '<b>Ice</b> keeps it sliding')}
        ${lg('#2b8fd6', '<b>Water</b> costs +1 stroke, back to your last spot')}
        ${lg('#27354f', '<b>Pits and open edges</b> are out of bounds, +1 stroke')}
        ${lg('#ff5d8f', '<b>Bumpers</b> and yellow <b>kickers</b> bounce extra hard')}
        ${lg('#8e7dff', '<b>Moving walls</b> slide back and forth')}
        ${lg('#ff7a45', '<b>Spinning bars</b> sweep around')}
        ${lg('linear-gradient(90deg,#a259ff 50%,#ff9f1c 50%)', '<b>Portals</b>: in at purple, out at orange')}
        ${lg('#1fb5a8', '<b>One-way gates</b> only let you through along the arrows')}
        ${lg('#ffb000', '<b>Boost pads</b> fling you along the arrows')}
      </div>
      <p class="note">Everyone gets the same hole each day (it changes at midnight UTC). Your first finished round is your official score. After that you can replay just for fun. Holes get trickier through the week, and weekends are the hardest.</p>
      <div class="toggle-row"><span>🔊 Sound</span><button class="switch ${save.sound !== false ? 'on' : ''}" data-act="sound" aria-label="Sound"></button></div>`);
  }

  /* ---------- tutorial ---------- */
  const tut = $('#tutorial');
  function showTutorial(on) { tut.hidden = !on; }
  function placeTutorial() {
    if (tut.hidden || !game) return;
    const s = R.toScreen(game.ball.x, game.ball.y);
    tut.style.transform = `translate(${s.x}px, ${s.y}px)`;
    const p = tut.querySelector('p');
    p.style.top = s.y > R.h * 0.6 ? '-170px' : '118px';
    const left = Math.max(10, Math.min(R.w - 240, s.x - 115));
    p.style.left = (left - s.x) + 'px';
    p.style.transform = 'none';
  }

  /* ---------- main loop ---------- */
  let acc = 0, last = performance.now(), tickAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; clock += dt;
    if (game) {
      acc += dt;
      let n = 0;
      while (acc >= P.DT && n < 12) { game.sim.step(); handleEvents(); acc -= P.DT; n++; }
      if (n >= 12) acc = 0;
      updateAnim(dt);
      if (game.sim.phase === 'rolling') R.addTrail(game.ball.x, game.ball.y, game.sim.speed, save.trail, clock);
      R.updateFx(dt);
      R.draw({
        t: clock, sim: game.sim, ball: game.ball, aim: aim && canAim() ? aim : null,
        skinId: save.skin, trailId: save.trail, flagUp: 1,
      });
      placeTutorial();
    }
    tickAcc += dt;
    if (tickAcc > 0.5) { tickAcc = 0; secondTick(); }
    if (sheetName === 'locker') drawLockerPreviews();
    requestAnimationFrame(frame);
  }

  function secondTick() {
    const cd = document.querySelectorAll('.countdown');
    cd.forEach(el => { el.textContent = fmtCountdown(D.msToNextDay()); });
    const nowDay = D.dayIndex();
    if (nowDay !== today) {
      const midRound = game && game.mode === 'daily' && !game.done && game.strokes > 0;
      today = nowDay;
      if (!midRound) {
        closeSheet();
        startToday();
        toast('A new hole is ready! ⛳', 2500);
      }
    }
  }

  /* ---------- boot ---------- */
  window.addEventListener('resize', layout);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); secondTick(); } });
  layout();
  if (today < 0) today = 0; // before launch: preview hole #1
  startToday();
  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // debug/test hook
  window.HOTD.game = () => game;
  window.HOTD.debugStart = (mode, day) => startRound(mode, day);
})();

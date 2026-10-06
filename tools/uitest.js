// Headless UI test: finish a hole, open every screen. usage: node tools/uitest.js outdir
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  // fake history: 8 days before "today" (today = launch + 9)
  await p.addInitScript(() => {
    const real = Date.now; const off = Date.UTC(2026, 9, 6) + 9 * 86400000 + 13 * 3600000 - real();
    Date.now = () => real() + off;
    if (!localStorage.getItem('hotd.save.v1')) {
      const results = {};
      [[0, 2, 2], [1, 2, 3], [2, 4, 3], [4, 1, 2], [5, 3, 3], [6, 2, 2], [7, 2, 2], [8, 3, 2]].forEach(([d, s, p]) => results[d] = { s, p, ts: 1 });
      localStorage.setItem('hotd.save.v1', JSON.stringify({ results, tutorial: true, seenUnlock: 3 }));
    }
  });
  await p.goto('http://localhost:8123/');
  await p.waitForTimeout(600);
  await p.screenshot({ path: out + '/u0.png' });
  // roll the ball into the cup
  await p.evaluate(() => {
    const g = HOTD.game(); const c = g.course.cup;
    g.sim.placeBall(c.x, c.y + 1.2); g.sim.shoot(0, -5); g.strokes = 1;
  });
  await p.waitForTimeout(700);
  await p.screenshot({ path: out + '/u1.png' });
  await p.waitForTimeout(2600);
  await p.screenshot({ path: out + '/u2.png' });
  if (process.env.DESKTOP) { await p.setViewportSize({ width: 1280, height: 760 }); await p.waitForTimeout(300); await p.screenshot({ path: out + '/ud.png' }); }
  await p.click('[data-act=share]');
  await p.waitForTimeout(300);
  console.log('clipboard:', await p.evaluate(() => navigator.clipboard.readText()));
  for (const [act, name] of [['stats', 'u3'], ['calendar', 'u4'], ['locker', 'u5'], ['practice', 'u6'], ['help', 'u7']]) {
    await p.evaluate(a => { document.querySelector('#sheet').hidden = true; }, act);
    await p.click('#btnMenu');
    await p.waitForTimeout(150);
    if (name === 'u3') await p.screenshot({ path: out + '/um.png' });
    await p.click(`.menu-list [data-act=${act}]`);
    await p.waitForTimeout(700);
    await p.screenshot({ path: out + `/${name}.png` });
  }
  console.log('state', await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('hotd.save.v1')).results[9])));
  console.log('errors', errs);
  await b.close();
})();

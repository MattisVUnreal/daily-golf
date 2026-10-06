// Headless smoke test: load, drag-shoot, screenshot. usage: node tools/playtest.js outdir
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8123/');
  await p.waitForTimeout(800);
  await p.screenshot({ path: out + '/s1.png' });
  const g = await p.evaluate(() => { const g = HOTD.game(); return { tee: g.course.tee, name: g.course.name, par: g.course.par }; });
  const R = await p.evaluate(() => { const g = HOTD.game(); return null; });
  // drag straight down from ball to aim up
  const bs = await p.evaluate(() => { const g = HOTD.game(); const c = document.querySelector('#game'); return null; });
  console.log(JSON.stringify(g));
  await p.mouse.move(195, 700); await p.mouse.down(); await p.mouse.move(195, 760, { steps: 5 }); await p.mouse.move(195, 800, { steps: 5 });
  await p.screenshot({ path: out + '/s2.png' });
  await p.mouse.up();
  await p.waitForTimeout(250);
  await p.screenshot({ path: out + '/s3.png' });
  await p.waitForTimeout(3500);
  await p.screenshot({ path: out + '/s4.png' });
  console.log(JSON.stringify(await p.evaluate(() => { const g = HOTD.game(); return { strokes: g.strokes, phase: g.sim.phase, pos: g.sim.pos, done: g.done }; })));
  console.log('errors', errs);
  await b.close();
})();

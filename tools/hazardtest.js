// Water penalty + reset, portal, reload-resume. usage: node tools/hazardtest.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/');
  await p.waitForTimeout(500);
  // Bridge Over: find its day and shoot into the left pond
  const r1 = await p.evaluate(async () => {
    const D = HOTD.daily; let day = 0; while (D.holeForDay(day).hole.n !== 'Bridge Over') day++;
    HOTD.debugStart('practice', day);
    await new Promise(r => setTimeout(r, 400));
    const g = HOTD.game(); const tee = { ...g.sim.pos };
    g.sim.shoot(-4, -12); g.strokes = 1;
    await new Promise(r => setTimeout(r, 1800));
    return { tee, strokes: g.strokes, pos: g.sim.pos, phase: g.sim.phase };
  });
  console.log('water', JSON.stringify(r1));
  const r2 = await p.evaluate(async () => {
    const D = HOTD.daily; let day = 0; while (D.holeForDay(day).hole.n !== 'Wormhole') day++;
    HOTD.debugStart('practice', day);
    await new Promise(r => setTimeout(r, 400));
    const g = HOTD.game(); g.sim.shoot(0, -12);
    await new Promise(r => setTimeout(r, 2500));
    return { pos: g.sim.pos, out: g.course.portals[0].b };
  });
  console.log('portal', JSON.stringify(r2));
  // daily resume after reload mid-roll
  await p.evaluate(() => { localStorage.clear(); });
  await p.reload(); await p.waitForTimeout(600);
  await p.mouse.move(195, 700); await p.mouse.down(); await p.mouse.move(195, 760, { steps: 4 }); await p.mouse.up();
  await p.waitForTimeout(100);
  await p.reload(); await p.waitForTimeout(600);
  console.log('resume', await p.evaluate(() => JSON.stringify({ strokes: HOTD.game().strokes, mode: HOTD.game().mode })));
  console.log('errors', errs);
  await b.close();
})();

// Level checker: beam-searches shots with the real physics to estimate the
// best achievable score per hole and the hole-in-one rate.
// usage: node tools/solve.js [from] [to] [--mirror]
const P = require('../js/physics.js');
const HOLES = require('../js/holes.js');

const ANG = +(process.env.ANG || 96), POW = +(process.env.POW || 12), BEAM = +(process.env.BEAM || 10);

function distMap(c) {
  const res = 0.25, nx = Math.ceil(P.W / res), ny = Math.ceil(P.H / res);
  const ok = new Uint8Array(nx * ny);
  const pts = c.bound;
  const blocked = (x, y) => {
    if (!P.pointInPoly(pts, x, y)) return true;
    for (let i = 0; i < pts.length; i++) {
      if (c.open.has(i)) continue;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (P.segDist(x, y, a.x, a.y, b.x, b.y) < 0.3) return true;
    }
    for (const w of c.walls) if (P.segDist(x, y, w.a.x, w.a.y, w.b.x, w.b.y) < 0.3) return true;
    for (const z of c.zones) if ((z.kind === 'water' || z.kind === 'pit') && P.inShape(z.s, x, y)) return true;
    for (const b of c.bumpers) if (Math.hypot(x - b.x, y - b.y) < b.r + 0.2) return true;
    for (const k of c.blocks) {
      const dx = x - k.x, dy = y - k.y, ca = Math.cos(-k.a), sa = Math.sin(-k.a);
      const lx = dx * ca - dy * sa, ly = dx * sa + dy * ca;
      if (Math.abs(lx) < k.w / 2 + 0.2 && Math.abs(ly) < k.h / 2 + 0.2) return true;
    }
    for (const p of c.polys) if (P.pointInPoly(p.pts, x, y)) return true;
    return false;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) ok[j * nx + i] = blocked((i + 0.5) * res, (j + 0.5) * res) ? 0 : 1;
  const dist = new Float64Array(nx * ny).fill(Infinity);
  const cell = (x, y) => Math.min(nx - 1, Math.max(0, Math.floor(x / res))) + Math.min(ny - 1, Math.max(0, Math.floor(y / res))) * nx;
  const q = [];
  const push = (k, d) => { if (d < dist[k]) { dist[k] = d; q.push([d, k]); } };
  push(cell(c.cup.x, c.cup.y), 0);
  const portalOut = c.portals.map(p => cell(p.b.x, p.b.y));
  while (q.length) {
    q.sort((a, b) => b[0] - a[0]);
    const [d, k] = q.pop();
    if (d > dist[k]) continue;
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (!ok[kk]) continue;
      push(kk, d + Math.hypot(di, dj) * res);
    }
    portalOut.forEach((po, pi) => { if (po === k) push(cell(c.portals[pi].a.x, c.portals[pi].a.y), d); });
  }
  return (x, y) => dist[cell(x, y)];
}

function shot(hole, mirror, start, ang, pw) {
  const c = P.buildCourse(hole, mirror);
  const s = new P.Sim(c);
  s.placeBall(start.x, start.y);
  s.shoot(Math.cos(ang) * pw * P.MAX_SHOT, Math.sin(ang) * pw * P.MAX_SHOT);
  for (let i = 0; i < 120 * 20; i++) {
    s.step();
    for (const e of s.events) {
      if (e.type === 'sink') return { sunk: true };
      if (e.type === 'hazard') return { hazard: true };
    }
    s.events.length = 0;
    if (s.phase === 'ready') return { pos: s.pos };
  }
  return { pos: s.pos, timeout: true };
}

function solve(hole, mirror) {
  const c = P.buildCourse(hole, mirror);
  const dm = distMap(c);
  let beam = [{ x: c.tee.x, y: c.tee.y }];
  const out = { name: hole.n, par: hole.par, d: hole.d, best: null, hio: 0, teeDist: dm(c.tee.x, c.tee.y), timeouts: 0 };
  const total = ANG * POW;
  for (let depth = 1; depth <= hole.par + 2; depth++) {
    const cands = new Map();
    let sunk = 0;
    for (const st of beam) {
      for (let a = 0; a < ANG; a++) for (let p = 1; p <= POW; p++) {
        const r = shot(hole, mirror, st, (a / ANG) * Math.PI * 2, p / POW);
        if (r.sunk) { sunk++; continue; }
        if (r.timeout) out.timeouts++;
        if (r.pos) {
          const key = Math.round(r.pos.x / 0.3) + ',' + Math.round(r.pos.y / 0.3);
          const sc = dm(r.pos.x, r.pos.y);
          if (isFinite(sc) && (!cands.has(key) || cands.get(key).sc > sc)) cands.set(key, { x: r.pos.x, y: r.pos.y, sc });
        }
      }
    }
    if (depth === 1) out.hio = +((sunk / total) * 100).toFixed(1);
    if (sunk) { out.best = depth; out.ways = sunk; break; }
    beam = [...cands.values()].sort((a, b) => a.sc - b.sc).slice(0, BEAM);
    out['d' + depth] = beam.length ? +beam[0].sc.toFixed(1) : null;
    if (!beam.length) break;
  }
  return out;
}

if (require.main !== module) { module.exports = { distMap, shot }; return; }
const args = process.argv.slice(2);
const mirror = args.includes('--mirror');
const nums = args.filter(a => !a.startsWith('--')).map(Number);
const from = nums[0] || 0, to = nums.length > 1 ? nums[1] : HOLES.length;
for (let i = from; i < to; i++) {
  const t0 = Date.now();
  const r = solve(HOLES[i], mirror);
  const flag = r.best == null ? 'UNSOLVED' : r.best > r.par ? 'OVER' : r.best < r.par - 1 ? 'EASY' : '';
  console.log(JSON.stringify(Object.assign({ i }, r, { sec: ((Date.now() - t0) / 1000).toFixed(0) })), flag);
}

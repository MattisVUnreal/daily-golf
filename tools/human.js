// Rough "decent human" estimate: a greedy player who picks the shot with the
// best average outcome under aiming noise, then executes it with noise.
// usage: node tools/human.js [from] [to] [--mirror]
const P = require('../js/physics.js');
const HOLES = require('../js/holes.js');
const { distMap, shot } = require('./solve.js');

const ANG = 72, POW = 10, RUNS = +(process.env.RUNS || 4);
const NOISE_A = 2.5 * Math.PI / 180, NOISE_P = 0.06;

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };

function value(r, dm, here) {
  if (r.sunk) return -1;
  if (r.hazard) return here + 3; // penalty stroke ~ worth a few units
  const d = dm(r.pos.x, r.pos.y);
  return isFinite(d) ? d : here + 3;
}

function play(hole, mirror, dm) {
  const c = P.buildCourse(hole, mirror);
  let pos = { x: c.tee.x, y: c.tee.y }, strokes = 0;
  while (strokes < 10) {
    const here = dm(pos.x, pos.y);
    let best = null;
    for (let a = 0; a < ANG; a++) for (let p = 1; p <= POW; p++) {
      const ang = (a / ANG) * Math.PI * 2, pw = p / POW;
      let v = 0;
      for (const [da, dp] of [[NOISE_A, NOISE_P], [-NOISE_A, -NOISE_P]]) v += value(shot(hole, mirror, pos, ang + da, Math.min(1, pw * (1 + dp))), dm, here);
      if (!best || v < best.v) best = { v, ang, pw };
    }
    const r = shot(hole, mirror, pos, best.ang + gauss() * NOISE_A, Math.min(1, Math.max(0.05, best.pw * (1 + gauss() * NOISE_P))));
    strokes++;
    if (r.sunk) return strokes;
    if (r.hazard) { strokes++; continue; }
    pos = r.pos;
  }
  return 10;
}

const args = process.argv.slice(2);
const mirror = args.includes('--mirror');
const nums = args.filter(a => !a.startsWith('--')).map(Number);
const from = nums[0] || 0, to = nums.length > 1 ? nums[1] : HOLES.length;
for (let i = from; i < to; i++) {
  const h = HOLES[i];
  seed = 1 + i * 7919;
  const dm = distMap(P.buildCourse(h, mirror));
  const res = [];
  for (let k = 0; k < RUNS; k++) res.push(play(h, mirror, dm));
  const avg = res.reduce((a, b) => a + b, 0) / res.length;
  console.log(`${i}\t${h.n.padEnd(20)}\tpar ${h.par}\td ${h.d}\thuman ${avg.toFixed(2)} [${res.join(',')}]\t${(avg - h.par).toFixed(2)}`);
}

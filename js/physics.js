/* Hole of the Day — course model + physics simulation (Planck.js).
   Shared by the browser game and the node level checker (tools/solve.js). */
(function (root) {
  'use strict';
  const pl = root.planck || (typeof require === 'function' ? require('./vendor/planck.min.js') : null);
  const Vec2 = pl.Vec2;
  pl.Settings.velocityThreshold = 0.35; // keep bounces alive at low speeds

  const W = 10, H = 16;
  const BALL_R = 0.2;
  const CUP_R = 0.3;
  const WALL_T = 0.28;
  const MAX_SHOT = 24;     // units / second at full power
  const SPEED_CAP = 32;
  const SINK_V = 9.5;      // max speed that still drops in the cup
  const STOP_V = 0.16;
  const DT = 1 / 120;
  const BOOST_KICK = 13;
  // constant deceleration + linear drag per surface: crisp stops, no floaty tail
  const SURF = {
    grass: { c: 5.5, k: 0.42 },
    sand: { c: 26, k: 3.2 },
    ice: { c: 0.7, k: 0.06 },
  };

  /* ---------- shapes ---------- */
  function parseShape(o, i) {
    const t = o[i];
    if (t === 'r') return { t: 'r', x: o[i + 1], y: o[i + 2], w: o[i + 3], h: o[i + 4] };
    if (t === 'c') return { t: 'c', x: o[i + 1], y: o[i + 2], r: o[i + 3] };
    if (t === 'p') return { t: 'p', pts: o[i + 1].map(p => ({ x: p[0], y: p[1] })) };
    throw new Error('bad shape ' + t);
  }
  function pointInPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function inShape(s, x, y) {
    if (s.t === 'r') return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
    if (s.t === 'c') return (x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r;
    return pointInPoly(s.pts, x, y);
  }
  function mirrorShape(s) {
    if (s.t === 'r') return { t: 'r', x: W - s.x - s.w, y: s.y, w: s.w, h: s.h };
    if (s.t === 'c') return { t: 'c', x: W - s.x, y: s.y, r: s.r };
    return { t: 'p', pts: s.pts.map(p => ({ x: W - p.x, y: p.y })).reverse() };
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  const DEFAULT_BOUND = [[0.5, 0.5], [9.5, 0.5], [9.5, 15.5], [0.5, 15.5]];

  /* ---------- hole definition -> normalized course ---------- */
  function buildCourse(hole, mirror) {
    const mx = x => (mirror ? W - x : x);
    const P = (x, y) => ({ x: mx(x), y });
    const c = {
      name: hole.n, par: hole.par, d: hole.d || 1,
      tee: P(hole.tee[0], hole.tee[1]),
      cup: P(hole.cup[0], hole.cup[1]),
      bound: (hole.b || DEFAULT_BOUND).map(p => P(p[0], p[1])),
      open: new Set(hole.open || []),
      walls: [], blocks: [], polys: [], bumpers: [], zones: [],
      movers: [], spinners: [], portals: [], gates: [], boosts: [],
      mirror: !!mirror,
    };
    if (mirror) {
      // reverse winding but keep the open edge indices pointing at the same edges
      const n = c.bound.length;
      c.bound.reverse();
      c.open = new Set([...c.open].map(i => (n - 2 - i + n) % n));
    }
    for (const o of hole.o || []) {
      const k = o[0];
      if (k === 'w' || k === 'k') {
        c.walls.push({ a: P(o[1], o[2]), b: P(o[3], o[4]), kick: k === 'k' });
      } else if (k === 'bp') {
        c.bumpers.push({ x: mx(o[1]), y: o[2], r: o[3] || 0.45, flash: 0 });
      } else if (k === 'blk') {
        c.blocks.push({ x: mx(o[1]), y: o[2], w: o[3], h: o[4], a: ((o[5] || 0) * Math.PI / 180) * (mirror ? -1 : 1) });
      } else if (k === 'poly') {
        c.polys.push({ pts: o[1].map(p => P(p[0], p[1])) });
      } else if (k === 'sand' || k === 'ice' || k === 'water' || k === 'pit') {
        let s = parseShape(o, 1);
        if (mirror) s = mirrorShape(s);
        c.zones.push({ kind: k, s });
      } else if (k === 'mv') {
        c.movers.push({ a: P(o[1], o[2]), b: P(o[3], o[4]), w: o[5], h: o[6], period: o[7] || 3, phase: o[8] || 0 });
      } else if (k === 'sp') {
        c.spinners.push({ x: mx(o[1]), y: o[2], len: o[3], speed: (o[4] || 2) * (mirror ? -1 : 1) });
      } else if (k === 'pt') {
        c.portals.push({ a: P(o[1], o[2]), b: P(o[3], o[4]) });
      } else if (k === 'gate') {
        c.gates.push({ a: P(o[1], o[2]), b: P(o[3], o[4]), n: { x: mirror ? -o[5] : o[5], y: o[6] } });
      } else if (k === 'boost') {
        const ang = (mirror ? 180 - o[5] : o[5]) * Math.PI / 180;
        c.boosts.push({ x: mx(o[1]) - o[3] / 2, y: o[2] - o[4] / 2, w: o[3], h: o[4], ang, dx: Math.cos(ang), dy: Math.sin(ang) });
      } else {
        throw new Error('unknown obstacle ' + k);
      }
    }
    return c;
  }

  function surfaceAt(course, x, y) {
    let s = 'grass';
    for (const z of course.zones) {
      if ((z.kind === 'sand' || z.kind === 'ice') && inShape(z.s, x, y)) s = z.kind;
    }
    return s;
  }

  function moverPos(m, t) {
    const u = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / m.period + m.phase * Math.PI * 2);
    return { x: m.a.x + (m.b.x - m.a.x) * u, y: m.a.y + (m.b.y - m.a.y) * u };
  }

  /* ---------- simulation ---------- */
  class Sim {
    constructor(course, opts) {
      this.course = course;
      this.t = (opts && opts.t0) || 0;
      this.events = [];
      this.phase = 'ready';
      this.lastBoost = -1;
      this.portalLock = -1;
      const world = (this.world = new pl.World({ gravity: Vec2(0, 0) }));
      const wallFix = { restitution: 0.78, friction: 0 };

      const capsule = (body, a, b, t, fix) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const mid = Vec2((a.x + b.x) / 2, (a.y + b.y) / 2);
        body.createFixture(pl.Box(len / 2, t / 2, mid, Math.atan2(dy, dx)), fix);
        body.createFixture(pl.Circle(Vec2(a.x, a.y), t / 2), fix);
        body.createFixture(pl.Circle(Vec2(b.x, b.y), t / 2), fix);
      };

      const st = world.createBody({ type: 'static' });
      const bnd = course.bound;
      for (let i = 0; i < bnd.length; i++) {
        if (course.open.has(i)) continue;
        capsule(st, bnd[i], bnd[(i + 1) % bnd.length], WALL_T, Object.assign({ userData: { kind: 'wall' } }, wallFix));
      }
      for (const w of course.walls) {
        const fix = w.kick
          ? { restitution: 1.18, friction: 0, userData: { kind: 'kicker', ref: w } }
          : Object.assign({ userData: { kind: 'wall' } }, wallFix);
        capsule(st, w.a, w.b, w.kick ? 0.22 : WALL_T, fix);
      }
      for (const b of course.blocks) {
        st.createFixture(pl.Box(b.w / 2, b.h / 2, Vec2(b.x, b.y), b.a), Object.assign({ userData: { kind: 'wall' } }, wallFix));
      }
      for (const p of course.polys) {
        st.createFixture(pl.Polygon(p.pts.map(q => Vec2(q.x, q.y))), Object.assign({ userData: { kind: 'wall' } }, wallFix));
      }
      for (const b of course.bumpers) {
        st.createFixture(pl.Circle(Vec2(b.x, b.y), b.r), { restitution: 1.3, friction: 0, userData: { kind: 'bumper', ref: b } });
      }
      course.gates.forEach((g, i) => {
        g.passing = false;
        const gb = world.createBody({ type: 'static' });
        capsule(gb, g.a, g.b, 0.12, { restitution: 0.6, friction: 0, userData: { kind: 'gate', ref: g } });
      });
      this.moverBodies = course.movers.map(m => {
        const p = moverPos(m, this.t);
        const body = world.createBody({ type: 'kinematic', position: Vec2(p.x, p.y) });
        body.createFixture(pl.Box(m.w / 2, m.h / 2), Object.assign({ userData: { kind: 'mover' } }, wallFix));
        return body;
      });
      this.spinBodies = course.spinners.map(s => {
        const body = world.createBody({ type: 'kinematic', position: Vec2(s.x, s.y), angle: s.angle0 || 0 });
        body.createFixture(pl.Box(s.len / 2, 0.13), Object.assign({ userData: { kind: 'spinner' } }, wallFix));
        body.createFixture(pl.Circle(0.2), Object.assign({ userData: { kind: 'spinner' } }, wallFix));
        body.setAngularVelocity(s.speed);
        body.setAngle(s.speed * this.t);
        return body;
      });

      const ball = (this.ball = world.createBody({
        type: 'dynamic', bullet: true, fixedRotation: true, allowSleep: false,
        position: Vec2(course.tee.x, course.tee.y),
      }));
      ball.createFixture(pl.Circle(BALL_R), { density: 1, restitution: 0, friction: 0, userData: { kind: 'ball' } });
      this.ballMass = ball.getMass();

      const other = c => {
        const a = c.getFixtureA().getUserData(), b = c.getFixtureB().getUserData();
        if (a && a.kind === 'ball') return b;
        if (b && b.kind === 'ball') return a;
        return null;
      };
      world.on('begin-contact', c => {
        const o = other(c);
        if (o && o.kind === 'gate') {
          const v = ball.getLinearVelocity();
          o.ref.passing = v.x * o.ref.n.x + v.y * o.ref.n.y > 0;
        }
      });
      world.on('pre-solve', c => {
        const o = other(c);
        if (o && o.kind === 'gate' && o.ref.passing) c.setEnabled(false);
      });
      world.on('post-solve', (c, imp) => {
        const o = other(c);
        if (!o) return;
        let n = 0;
        for (const x of imp.normalImpulses) n += x;
        const dv = n / this.ballMass;
        if (dv < 0.6) return;
        if (o.ref && o.kind === 'bumper') o.ref.flash = 1;
        if (o.ref && o.kind === 'kicker') o.ref.flash = 1;
        const p = ball.getPosition();
        this.events.push({ type: 'hit', kind: o.kind, dv, x: p.x, y: p.y });
      });
    }

    get pos() { const p = this.ball.getPosition(); return { x: p.x, y: p.y }; }
    get vel() { const v = this.ball.getLinearVelocity(); return { x: v.x, y: v.y }; }
    get speed() { const v = this.ball.getLinearVelocity(); return Math.hypot(v.x, v.y); }

    shoot(vx, vy) {
      this.ball.setActive(true);
      this.ball.setLinearVelocity(Vec2(vx, vy));
      this.phase = 'rolling';
    }
    placeBall(x, y) {
      this.ball.setActive(true);
      this.ball.setPosition(Vec2(x, y));
      this.ball.setLinearVelocity(Vec2(0, 0));
      this.phase = 'ready';
      this.portalLock = -1;
      this.lastBoost = -1;
    }

    step() {
      const c = this.course, ball = this.ball;
      // drive moving obstacles by velocity so contacts stay crisp
      this.t += DT;
      c.movers.forEach((m, i) => {
        const b = this.moverBodies[i];
        const p = b.getPosition(), target = moverPos(m, this.t + DT);
        b.setLinearVelocity(Vec2((target.x - p.x) / DT, (target.y - p.y) / DT));
      });
      for (const b of c.bumpers) b.flash = Math.max(0, b.flash - DT * 4);
      for (const w of c.walls) if (w.flash) w.flash = Math.max(0, w.flash - DT * 4);

      if (this.phase === 'sunk' || this.phase === 'hazard') {
        this.world.step(DT, 8, 3);
        return;
      }

      // rolling resistance
      let p = ball.getPosition(), v = ball.getLinearVelocity();
      let speed = Math.hypot(v.x, v.y);
      const surf = surfaceAt(c, p.x, p.y);
      if (surf !== this.surface) {
        if (surf === 'sand' && speed > 2) this.events.push({ type: 'sand' });
        this.surface = surf;
      }
      const sf = SURF[surf];
      // the cup gently gobbles slow balls
      const dcx = c.cup.x - p.x, dcy = c.cup.y - p.y, dc = Math.hypot(dcx, dcy);
      let vx = v.x, vy = v.y;
      if (dc < CUP_R + 0.18 && speed < 14) {
        vx += (dcx / (dc || 1)) * 22 * DT;
        vy += (dcy / (dc || 1)) * 22 * DT;
        speed = Math.hypot(vx, vy);
      }
      const dec = (sf.c + sf.k * speed) * DT;
      if (speed <= dec) { vx = 0; vy = 0; }
      else { const f = (speed - dec) / speed; vx *= f; vy *= f; }
      ball.setLinearVelocity(Vec2(vx, vy));

      this.world.step(DT, 8, 3);

      p = ball.getPosition(); v = ball.getLinearVelocity();
      speed = Math.hypot(v.x, v.y);
      if (speed > SPEED_CAP) { ball.setLinearVelocity(Vec2(v.x * SPEED_CAP / speed, v.y * SPEED_CAP / speed)); speed = SPEED_CAP; }

      // cup
      if (Math.hypot(c.cup.x - p.x, c.cup.y - p.y) < CUP_R && speed < SINK_V) {
        this.phase = 'sunk';
        ball.setLinearVelocity(Vec2(0, 0));
        ball.setActive(false);
        this.events.push({ type: 'sink', speed });
        return;
      }

      // portals
      if (this.portalLock >= 0) {
        const o = c.portals[this.portalLock].b;
        if (Math.hypot(o.x - p.x, o.y - p.y) > 0.55) this.portalLock = -1;
      }
      if (this.portalLock < 0) {
        for (let i = 0; i < c.portals.length; i++) {
          const pt = c.portals[i];
          if (Math.hypot(pt.a.x - p.x, pt.a.y - p.y) < 0.34) {
            this.events.push({ type: 'portal', from: { x: pt.a.x, y: pt.a.y }, to: { x: pt.b.x, y: pt.b.y } });
            ball.setPosition(Vec2(pt.b.x, pt.b.y));
            this.portalLock = i;
            p = ball.getPosition();
            break;
          }
        }
      }

      // hazards
      let hz = null;
      if (!pointInPoly(c.bound, p.x, p.y)) hz = 'oob';
      else {
        for (const z of c.zones) {
          if ((z.kind === 'water' || z.kind === 'pit') && inShape(z.s, p.x, p.y)) { hz = z.kind === 'water' ? 'water' : 'oob'; break; }
        }
      }
      if (hz) {
        this.phase = 'hazard';
        ball.setLinearVelocity(Vec2(0, 0));
        ball.setActive(false);
        this.events.push({ type: 'hazard', kind: hz, x: p.x, y: p.y });
        return;
      }

      // boost pads (edge triggered)
      let inBoost = -1;
      for (let i = 0; i < c.boosts.length; i++) {
        const b = c.boosts[i];
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { inBoost = i; break; }
      }
      if (inBoost >= 0 && inBoost !== this.lastBoost) {
        const b = c.boosts[inBoost];
        ball.setLinearVelocity(Vec2(v.x + b.dx * BOOST_KICK, v.y + b.dy * BOOST_KICK));
        this.phase = 'rolling';
        this.events.push({ type: 'boost' });
        speed = BOOST_KICK;
      }
      this.lastBoost = inBoost;

      if (this.phase === 'rolling') {
        if (speed < STOP_V) {
          ball.setLinearVelocity(Vec2(0, 0));
          this.phase = 'ready';
          this.events.push({ type: 'stop', x: p.x, y: p.y });
        }
      } else if (speed > 0.6) {
        this.phase = 'rolling'; // nudged by a moving obstacle
      }
    }
  }

  const api = {
    W, H, BALL_R, CUP_R, WALL_T, MAX_SHOT, DT, SURF,
    buildCourse, Sim, inShape, pointInPoly, segDist, moverPos, surfaceAt,
  };
  root.HOTD = Object.assign(root.HOTD || {}, { phys: api });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

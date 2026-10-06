/* Hole of the Day — canvas renderer, cosmetics and particles. */
(function (root) {
  'use strict';
  const P = root.HOTD.phys;
  const TAU = Math.PI * 2;

  const COL = {
    bg1: '#b9f0dd', bg2: '#d9f7ec', dot: 'rgba(40,140,110,0.10)',
    grass: '#5ccb6c', grass2: '#53c164', cliff: '#2f6f4a',
    wall: '#fffaf0', wallShade: 'rgba(20,70,40,0.32)', wallEdge: '#e9dfc9',
    sand: '#f6d98e', sandDot: 'rgba(170,120,40,0.35)',
    ice: '#d4f2ff', iceLine: 'rgba(255,255,255,0.8)',
    water: '#3ba7f2', water2: '#7cc8ff', pit: '#27354f',
    bumper: '#ff5d8f', kicker: '#ffb703', mover: '#8e7dff', spinner: '#ff7a45',
    portalIn: '#a259ff', portalOut: '#ff9f1c', gate: '#1fb5a8', boost: '#ffd23f',
    cup: '#173826', flag: '#ff3b5c',
  };

  /* ---------- cosmetics ---------- */
  const SKINS = [
    { id: 'classic', name: 'Classic', unlock: 0, fill: '#ffffff' },
    { id: 'tangerine', name: 'Tangerine', unlock: 3, fill: '#ff9f43' },
    { id: 'bubblegum', name: 'Bubblegum', unlock: 7, fill: '#ff8fc7' },
    { id: 'galaxy', name: 'Galaxy', unlock: 14, fill: '#2b2d6e' },
    { id: 'disco', name: 'Disco', unlock: 30, fill: 'hue' },
    { id: 'gold', name: 'Gold', unlock: 100, fill: '#f7c948' },
  ];
  const TRAILS = [
    { id: 'simple', name: 'Breeze', unlock: 0 },
    { id: 'dots', name: 'Dots', unlock: 3 },
    { id: 'sparkle', name: 'Sparkle', unlock: 7 },
    { id: 'comet', name: 'Comet', unlock: 14 },
    { id: 'rainbow', name: 'Rainbow', unlock: 30 },
    { id: 'fire', name: 'Fire', unlock: 100 },
  ];

  function drawBall(g, x, y, r, skinId, t) {
    const skin = SKINS.find(s => s.id === skinId) || SKINS[0];
    let fill = skin.fill;
    if (fill === 'hue') fill = `hsl(${(t * 120) % 360},90%,60%)`;
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, TAU);
    g.fillStyle = fill; g.fill();
    if (skin.id === 'galaxy') {
      g.clip();
      g.fillStyle = '#9fa8ff';
      for (let i = 0; i < 6; i++) {
        const a = i * 2.1 + t * 0.6, d = r * (0.25 + (i % 3) * 0.22);
        g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.09, 0, TAU); g.fill();
      }
    } else if (skin.id === 'bubblegum') {
      g.clip();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(x - r, y - r * 0.18, r * 2, r * 0.36);
    } else if (skin.id === 'gold') {
      const gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
      gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.45, '#f7c948'); gr.addColorStop(1, '#b7791f');
      g.fillStyle = gr; g.fill();
    }
    g.restore();
    // shading + specular
    const sh = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    sh.addColorStop(0, 'rgba(255,255,255,0.65)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = sh; g.fill();
    g.lineWidth = r * 0.12; g.strokeStyle = 'rgba(0,0,0,0.12)'; g.stroke();
  }

  /* ---------- helpers ---------- */
  function shapePath(g, s) {
    g.beginPath();
    if (s.t === 'r') roundRectPath(g, s.x, s.y, s.w, s.h, Math.min(0.25, s.w / 2, s.h / 2));
    else if (s.t === 'c') g.arc(s.x, s.y, s.r, 0, TAU);
    else { g.moveTo(s.pts[0].x, s.pts[0].y); for (const p of s.pts.slice(1)) g.lineTo(p.x, p.y); g.closePath(); }
  }
  function roundRectPath(g, x, y, w, h, r) {
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.g = canvas.getContext('2d');
      this.layer = document.createElement('canvas');
      this.particles = [];
      this.fx = []; // screen-space confetti
      this.trail = [];
      this.shake = 0;
      this.insetTop = 64; this.insetBottom = 16;
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      const w = this.cv.clientWidth, h = this.cv.clientHeight;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      this.dpr = dpr; this.w = w; this.h = h;
      this.fit();
      if (this.course) this.buildLayer();
    }

    // zoom to the hole's own bounds so narrow holes fill the screen
    fit() {
      let x0 = 0, y0 = 0, x1 = P.W, y1 = P.H;
      if (this.course) {
        const xs = this.course.bound.map(p => p.x), ys = this.course.bound.map(p => p.y);
        x0 = Math.min(...xs) - 0.45; x1 = Math.max(...xs) + 0.45;
        y0 = Math.min(...ys) - 0.45; y1 = Math.max(...ys) + 0.6;
      }
      const w = this.w, availH = this.h - this.insetTop - this.insetBottom;
      const s = Math.min(w / (x1 - x0), availH / (y1 - y0), 90);
      this.s = s;
      this.ox = (w - (x1 - x0) * s) / 2 - x0 * s;
      this.oy = this.insetTop + (availH - (y1 - y0) * s) / 2 - y0 * s;
    }

    toWorld(px, py) { return { x: (px - this.ox) / this.s, y: (py - this.oy) / this.s }; }
    toScreen(x, y) { return { x: this.ox + x * this.s, y: this.oy + y * this.s }; }

    setCourse(course) {
      this.course = course;
      this.particles = []; this.trail = [];
      this.fit();
      this.buildLayer();
    }

    buildLayer() {
      const L = this.layer, c = this.course;
      L.width = this.cv.width; L.height = this.cv.height;
      const g = L.getContext('2d');
      const d = this.dpr;
      // backdrop
      g.setTransform(d, 0, 0, d, 0, 0);
      const bg = g.createLinearGradient(0, 0, 0, this.h);
      bg.addColorStop(0, COL.bg1); bg.addColorStop(1, COL.bg2);
      g.fillStyle = bg; g.fillRect(0, 0, this.w, this.h);
      g.fillStyle = COL.dot;
      for (let y = 10; y < this.h; y += 22) for (let x = (y / 22) % 2 ? 10 : 21; x < this.w; x += 22) { g.beginPath(); g.arc(x, y, 1.6, 0, TAU); g.fill(); }

      g.setTransform(d * this.s, 0, 0, d * this.s, d * this.ox, d * this.oy);
      const b = c.bound;
      const boundPath = () => { g.beginPath(); g.moveTo(b[0].x, b[0].y); for (const p of b.slice(1)) g.lineTo(p.x, p.y); g.closePath(); };
      // soft drop shadow under the whole course + cliff on open edges
      g.save();
      g.translate(0, 0.28);
      boundPath(); g.fillStyle = COL.cliff; g.fill();
      g.restore();
      g.save();
      g.shadowColor = 'rgba(0,60,40,0.25)'; g.shadowBlur = 18 * d; g.shadowOffsetY = 6 * d;
      boundPath(); g.fillStyle = COL.grass; g.fill();
      g.restore();
      // mowing stripes
      g.save(); boundPath(); g.clip();
      g.fillStyle = COL.grass2;
      for (let y = -2; y < P.H + 2; y += 2) { g.beginPath(); g.moveTo(-1, y); g.lineTo(P.W + 1, y - 1.2); g.lineTo(P.W + 1, y - 0.2); g.lineTo(-1, y + 1); g.fill(); }
      // zones
      for (const z of c.zones) this.drawZone(g, z);
      g.restore();

      // open edges: a darker lip so you can see where the ball falls off
      g.lineCap = 'round';
      for (let i = 0; i < b.length; i++) {
        if (!c.open.has(i)) continue;
        const a = b[i], e = b[(i + 1) % b.length];
        g.strokeStyle = 'rgba(20,60,35,0.55)'; g.lineWidth = 0.16;
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(e.x, e.y); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.05; g.setLineDash([0.25, 0.2]);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(e.x, e.y); g.stroke(); g.setLineDash([]);
      }
      // tee pad
      g.fillStyle = 'rgba(30,90,50,0.22)';
      g.beginPath(); roundRectPath(g, c.tee.x - 0.45, c.tee.y - 0.3, 0.9, 0.6, 0.15); g.fill();
      // cup
      g.beginPath(); g.arc(c.cup.x, c.cup.y + 0.03, P.CUP_R + 0.06, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
      g.beginPath(); g.arc(c.cup.x, c.cup.y, P.CUP_R, 0, TAU); g.fillStyle = COL.cup; g.fill();
      g.beginPath(); g.arc(c.cup.x, c.cup.y + 0.07, P.CUP_R * 0.82, 0, TAU); g.fillStyle = '#0c1f14'; g.fill();

      // walls: shadow pass, then body
      const walls = [];
      for (let i = 0; i < b.length; i++) if (!c.open.has(i)) walls.push([b[i], b[(i + 1) % b.length], P.WALL_T]);
      for (const w of c.walls) if (!w.kick) walls.push([w.a, w.b, P.WALL_T]);
      g.lineCap = 'round'; g.lineJoin = 'round';
      const strokeAll = (dy, col, wid) => {
        g.strokeStyle = col;
        for (const [a, bb, t] of walls) { g.lineWidth = t * wid; g.beginPath(); g.moveTo(a.x, a.y + dy); g.lineTo(bb.x, bb.y + dy); g.stroke(); }
      };
      const fillSolids = (dy, col) => {
        g.fillStyle = col;
        for (const k of c.blocks) { g.save(); g.translate(k.x, k.y + dy); g.rotate(k.a); g.beginPath(); roundRectPath(g, -k.w / 2, -k.h / 2, k.w, k.h, Math.min(0.12, k.w / 2, k.h / 2)); g.fill(); g.restore(); }
        for (const p of c.polys) { g.beginPath(); g.moveTo(p.pts[0].x, p.pts[0].y + dy); for (const q of p.pts.slice(1)) g.lineTo(q.x, q.y + dy); g.closePath(); g.fill(); }
      };
      strokeAll(0.1, COL.wallShade, 1.05); fillSolids(0.1, COL.wallShade);
      strokeAll(0.03, COL.wallEdge, 1); fillSolids(0.03, COL.wallEdge);
      strokeAll(0, COL.wall, 1); fillSolids(0, COL.wall);
      strokeAll(-0.02, 'rgba(255,255,255,0.9)', 0.35);
    }

    drawZone(g, z) {
      const s = z.s;
      g.save();
      if (z.kind === 'sand') {
        shapePath(g, s); g.fillStyle = COL.sand; g.fill();
        g.clip(); g.fillStyle = COL.sandDot;
        const bb = this.bbox(s);
        let k = 0;
        for (let y = bb.y; y < bb.y + bb.h; y += 0.22) for (let x = bb.x; x < bb.x + bb.w; x += 0.22) {
          k++; g.fillRect(x + hash(k) * 0.2, y + hash(k + 99) * 0.2, 0.035, 0.035);
        }
        shapePath(g, s); g.lineWidth = 0.08; g.strokeStyle = 'rgba(200,150,60,0.5)'; g.stroke();
      } else if (z.kind === 'ice') {
        shapePath(g, s); g.fillStyle = COL.ice; g.fill();
        g.clip(); g.strokeStyle = COL.iceLine; g.lineWidth = 0.06;
        const bb = this.bbox(s);
        for (let x = bb.x - bb.h; x < bb.x + bb.w; x += 0.7) { g.beginPath(); g.moveTo(x, bb.y + bb.h); g.lineTo(x + bb.h, bb.y); g.stroke(); }
        shapePath(g, s); g.lineWidth = 0.08; g.strokeStyle = 'rgba(120,200,240,0.8)'; g.stroke();
      } else if (z.kind === 'water') {
        shapePath(g, s); g.fillStyle = '#2b8fd6'; g.fill();
        shapePath(g, s); g.lineWidth = 0.14; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
      } else if (z.kind === 'pit') {
        shapePath(g, s); g.fillStyle = COL.pit; g.fill();
        g.clip(); shapePath(g, s); g.lineWidth = 0.35; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
      }
      g.restore();
    }

    bbox(s) {
      if (s.t === 'r') return s;
      if (s.t === 'c') return { x: s.x - s.r, y: s.y - s.r, w: s.r * 2, h: s.r * 2 };
      const xs = s.pts.map(p => p.x), ys = s.pts.map(p => p.y);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }

    /* ---------- particles ---------- */
    burst(x, y, n, opts) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
        this.particles.push({
          x, y, vx: Math.cos(a) * sp + (opts.vx || 0), vy: Math.sin(a) * sp + (opts.vy || 0),
          life: 1, decay: opts.decay || 2.2, size: (opts.size || 0.08) * (0.6 + Math.random() * 0.8),
          color: Array.isArray(opts.color) ? opts.color[i % opts.color.length] : opts.color,
          kind: opts.kind || 'dot', drag: opts.drag || 3,
        });
      }
    }
    ring(x, y, color, max) { this.particles.push({ x, y, vx: 0, vy: 0, life: 1, decay: 2.5, size: max || 1, color, kind: 'ring', drag: 0 }); }

    confetti(n) {
      const cols = ['#ff3b5c', '#ffd23f', '#3ba7f2', '#5ccb6c', '#a259ff', '#ff9f1c'];
      for (let i = 0; i < n; i++) {
        this.fx.push({
          x: this.w * (0.1 + Math.random() * 0.8), y: -20 - Math.random() * this.h * 0.4,
          vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 220,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, w: 6 + Math.random() * 6, h: 4 + Math.random() * 6,
          color: cols[i % cols.length], life: 4 + Math.random() * 2, sway: Math.random() * TAU,
        });
      }
    }
    confettiBurst(sx, sy, n) {
      const cols = ['#ff3b5c', '#ffd23f', '#3ba7f2', '#5ccb6c', '#a259ff', '#ff9f1c'];
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 250 + Math.random() * 450;
        this.fx.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 14,
          w: 5 + Math.random() * 6, h: 3 + Math.random() * 6, color: cols[i % cols.length], life: 3 + Math.random() * 2, sway: Math.random() * TAU });
      }
    }

    updateFx(dt) {
      for (const p of this.particles) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        const f = Math.max(0, 1 - p.drag * dt); p.vx *= f; p.vy *= f;
        if (p.kind === 'fire') p.vy -= 1.5 * dt;
        p.life -= p.decay * dt;
      }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const q of this.fx) {
        q.vy += 380 * dt; q.vx *= 1 - 1.2 * dt; q.vy = Math.min(q.vy, 260);
        q.sway += dt * 5; q.x += (q.vx + Math.sin(q.sway) * 40) * dt; q.y += q.vy * dt; q.rot += q.vr * dt; q.life -= dt;
      }
      this.fx = this.fx.filter(q => q.life > 0 && q.y < this.h + 30);
      this.shake = Math.max(0, this.shake - dt * 3.2);
    }

    addTrail(x, y, speed, trailId, t) {
      this.trail.push({ x, y, t, speed });
      if (this.trail.length > 60) this.trail.shift();
      if (speed < 1.5) return;
      if (trailId === 'sparkle' && Math.random() < 0.5) {
        this.particles.push({ x: x + (Math.random() - 0.5) * 0.3, y: y + (Math.random() - 0.5) * 0.3, vx: 0, vy: 0, life: 1, decay: 1.8, size: 0.12, color: ['#fff6a8', '#ffffff', '#ffd1f2'][Math.random() * 3 | 0], kind: 'star', drag: 0 });
      } else if (trailId === 'fire' && Math.random() < 0.8) {
        this.particles.push({ x: x + (Math.random() - 0.5) * 0.2, y: y + (Math.random() - 0.5) * 0.2, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, life: 1, decay: 2.6, size: 0.16, color: ['#ffd23f', '#ff9f1c', '#ff3b5c'][Math.random() * 3 | 0], kind: 'fire', drag: 1 });
      }
    }

    /* ---------- frame ---------- */
    draw(st) {
      const g = this.g, c = this.course, d = this.dpr, t = st.t;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.cv.width, this.cv.height);
      let sx = 0, sy = 0;
      if (this.shake > 0) {
        const m = this.shake * this.shake * 9;
        sx = (Math.random() - 0.5) * m; sy = (Math.random() - 0.5) * m;
      }
      g.setTransform(1, 0, 0, 1, sx * d, sy * d);
      g.drawImage(this.layer, 0, 0);
      g.setTransform(d * this.s, 0, 0, d * this.s, d * (this.ox + sx), d * (this.oy + sy));

      // animated water ripples
      for (const z of c.zones) {
        if (z.kind !== 'water') continue;
        g.save(); shapePath(g, z.s); g.clip();
        const bb = this.bbox(z.s);
        g.strokeStyle = 'rgba(160,220,255,0.55)'; g.lineWidth = 0.06; g.lineCap = 'round';
        for (let y = bb.y + 0.3, i = 0; y < bb.y + bb.h; y += 0.45, i++) {
          const off = ((t * 0.5 + i * 0.37) % 1) * 1.2;
          for (let x = bb.x - 1.2 + off + (i % 2) * 0.6; x < bb.x + bb.w; x += 1.2) {
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 0.15, y - 0.08, x + 0.3, y); g.stroke();
          }
        }
        g.restore();
      }

      // boost pads
      for (const b of c.boosts) {
        g.save();
        g.beginPath(); roundRectPath(g, b.x, b.y, b.w, b.h, 0.15); g.fillStyle = '#ffb000'; g.fill();
        g.clip();
        g.translate(b.x + b.w / 2, b.y + b.h / 2); g.rotate(b.ang);
        const len = Math.max(b.w, b.h) + 1;
        g.strokeStyle = '#fff3b0'; g.lineWidth = 0.13; g.lineJoin = 'round'; g.lineCap = 'round';
        for (let k = -len; k < len; k += 0.55) {
          const xx = k + ((t * 1.6) % 0.55);
          g.globalAlpha = 0.5 + 0.5 * Math.sin(xx * 2 - t * 6) ** 2;
          g.beginPath(); g.moveTo(xx - 0.18, -0.24); g.lineTo(xx, 0); g.lineTo(xx - 0.18, 0.24); g.stroke();
        }
        g.restore();
      }

      // portals
      for (const pt of c.portals) {
        g.save(); g.translate(pt.a.x, pt.a.y);
        g.beginPath(); g.arc(0, 0, 0.42, 0, TAU); g.fillStyle = '#3d1a6e'; g.fill();
        g.rotate(t * 4);
        for (let k = 0; k < 3; k++) {
          g.rotate(TAU / 3);
          g.beginPath(); g.arc(0, 0, 0.3, 0, 2.1); g.strokeStyle = COL.portalIn; g.lineWidth = 0.09; g.lineCap = 'round'; g.stroke();
        }
        g.beginPath(); g.arc(0, 0, 0.42, 0, TAU); g.strokeStyle = '#d6b4ff'; g.lineWidth = 0.06; g.stroke();
        g.restore();
        g.save(); g.translate(pt.b.x, pt.b.y);
        const pulse = 0.36 + Math.sin(t * 5) * 0.03;
        g.beginPath(); g.arc(0, 0, pulse, 0, TAU); g.fillStyle = 'rgba(255,159,28,0.25)'; g.fill();
        g.setLineDash([0.12, 0.1]); g.lineDashOffset = -t * 0.6;
        g.beginPath(); g.arc(0, 0, pulse, 0, TAU); g.strokeStyle = COL.portalOut; g.lineWidth = 0.08; g.stroke();
        g.restore();
      }

      // one-way gates
      for (const gt of c.gates) {
        g.save();
        g.lineCap = 'round';
        g.strokeStyle = COL.gate; g.lineWidth = 0.12; g.setLineDash([0.18, 0.12]);
        g.beginPath(); g.moveTo(gt.a.x, gt.a.y); g.lineTo(gt.b.x, gt.b.y); g.stroke();
        g.setLineDash([]);
        const len = Math.hypot(gt.b.x - gt.a.x, gt.b.y - gt.a.y), ux = (gt.b.x - gt.a.x) / len, uy = (gt.b.y - gt.a.y) / len;
        const n = Math.max(1, Math.round(len / 0.9));
        const bob = Math.sin(t * 4) * 0.05;
        g.strokeStyle = COL.gate; g.lineWidth = 0.08; g.globalAlpha = 0.9;
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n, cx = gt.a.x + (gt.b.x - gt.a.x) * f + gt.n.x * (0.22 + bob), cy = gt.a.y + (gt.b.y - gt.a.y) * f + gt.n.y * (0.22 + bob);
          g.beginPath();
          g.moveTo(cx - ux * 0.15 - gt.n.x * 0.12, cy - uy * 0.15 - gt.n.y * 0.12);
          g.lineTo(cx, cy);
          g.lineTo(cx + ux * 0.15 - gt.n.x * 0.12, cy + uy * 0.15 - gt.n.y * 0.12);
          g.stroke();
        }
        for (const e of [gt.a, gt.b]) { g.beginPath(); g.arc(e.x, e.y, 0.12, 0, TAU); g.fillStyle = '#0f7d74'; g.globalAlpha = 1; g.fill(); }
        g.restore();
      }

      // kickers
      for (const w of c.walls) {
        if (!w.kick) continue;
        g.save(); g.lineCap = 'round';
        g.strokeStyle = COL.wallShade; g.lineWidth = 0.26; g.beginPath(); g.moveTo(w.a.x, w.a.y + 0.08); g.lineTo(w.b.x, w.b.y + 0.08); g.stroke();
        g.strokeStyle = w.flash > 0 ? '#fff4c2' : COL.kicker; g.lineWidth = 0.22 + (w.flash || 0) * 0.08;
        g.beginPath(); g.moveTo(w.a.x, w.a.y); g.lineTo(w.b.x, w.b.y); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.06;
        g.beginPath(); g.moveTo(w.a.x, w.a.y - 0.03); g.lineTo(w.b.x, w.b.y - 0.03); g.stroke();
        g.restore();
      }
      // bumpers
      for (const b of c.bumpers) {
        const r = b.r * (1 + b.flash * 0.15);
        g.beginPath(); g.arc(b.x, b.y + 0.1, b.r, 0, TAU); g.fillStyle = COL.wallShade; g.fill();
        g.beginPath(); g.arc(b.x, b.y, r, 0, TAU); g.fillStyle = b.flash > 0.3 ? '#ffd1e0' : COL.bumper; g.fill();
        g.beginPath(); g.arc(b.x, b.y, r * 0.62, 0, TAU); g.fillStyle = '#fff'; g.fill();
        g.beginPath(); g.arc(b.x, b.y, r * 0.42, 0, TAU); g.fillStyle = COL.bumper; g.fill();
        g.beginPath(); g.arc(b.x - r * 0.3, b.y - r * 0.35, r * 0.18, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
      }
      // movers
      if (st.sim) {
        st.sim.moverBodies.forEach((body, i) => {
          const m = c.movers[i], p = body.getPosition();
          g.save(); g.translate(p.x, p.y);
          g.fillStyle = COL.wallShade; g.beginPath(); roundRectPath(g, -m.w / 2, -m.h / 2 + 0.1, m.w, m.h, 0.1); g.fill();
          g.fillStyle = COL.mover; g.beginPath(); roundRectPath(g, -m.w / 2, -m.h / 2, m.w, m.h, 0.1); g.fill();
          g.save(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 0.12;
          for (let k = -m.w; k < m.w; k += 0.4) { g.beginPath(); g.moveTo(k, m.h); g.lineTo(k + m.h * 2, -m.h); g.stroke(); }
          g.restore(); g.restore();
        });
        st.sim.spinBodies.forEach((body, i) => {
          const s = c.spinners[i], p = body.getPosition(), a = body.getAngle();
          g.save(); g.translate(p.x, p.y + 0.1); g.rotate(a);
          g.fillStyle = COL.wallShade; g.beginPath(); roundRectPath(g, -s.len / 2, -0.13, s.len, 0.26, 0.13); g.fill();
          g.restore();
          g.save(); g.translate(p.x, p.y); g.rotate(a);
          g.fillStyle = COL.spinner; g.beginPath(); roundRectPath(g, -s.len / 2, -0.13, s.len, 0.26, 0.13); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(-s.len / 2 + 0.15, -0.09, s.len - 0.3, 0.05);
          g.beginPath(); g.arc(0, 0, 0.22, 0, TAU); g.fillStyle = '#fff'; g.fill();
          g.beginPath(); g.arc(0, 0, 0.11, 0, TAU); g.fillStyle = COL.spinner; g.fill();
          g.restore();
        });
      }

      // trail
      this.drawTrail(g, st.trailId, t);

      // particles (world)
      for (const p of this.particles) {
        g.globalAlpha = Math.max(0, Math.min(1, p.life));
        if (p.kind === 'ring') {
          g.beginPath(); g.arc(p.x, p.y, p.size * (1.2 - p.life), 0, TAU); g.strokeStyle = p.color; g.lineWidth = 0.08 * p.life + 0.02; g.stroke();
        } else if (p.kind === 'star') {
          const r = p.size * (0.5 + p.life * 0.5);
          g.fillStyle = p.color; g.beginPath();
          for (let k = 0; k < 8; k++) { const rr = k % 2 ? r * 0.35 : r, a = k * Math.PI / 4 + t * 2; g.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
          g.closePath(); g.fill();
        } else {
          g.beginPath(); g.arc(p.x, p.y, p.size * (p.kind === 'fire' ? p.life : 1), 0, TAU); g.fillStyle = p.color; g.fill();
        }
      }
      g.globalAlpha = 1;

      // ball
      const ball = st.ball;
      if (ball && ball.visible) {
        const r = P.BALL_R * ball.scale;
        g.beginPath(); g.ellipse(ball.x + 0.05, ball.y + 0.08, r * 1.05, r * 0.9, 0, 0, TAU); g.fillStyle = 'rgba(0,40,20,0.28)'; g.fill();
        if (st.aim) this.drawAim(g, ball, st.aim, t);
        drawBall(g, ball.x, ball.y, r, st.skinId, t);
      }

      // flag (on top so it's never hidden)
      this.drawFlag(g, c.cup, t, st.flagUp);

      // screen-space confetti
      g.setTransform(d, 0, 0, d, 0, 0);
      for (const q of this.fx) {
        g.save(); g.translate(q.x, q.y); g.rotate(q.rot);
        g.globalAlpha = Math.min(1, q.life);
        g.fillStyle = q.color; g.fillRect(-q.w / 2, -q.h / 2 * Math.abs(Math.cos(q.sway)), q.w, q.h * Math.abs(Math.cos(q.sway)) + 1);
        g.restore();
      }
      g.globalAlpha = 1;
    }

    drawTrail(g, id, t) {
      const tr = this.trail;
      if (tr.length < 2) return;
      const now = t;
      const pts = tr.filter(p => now - p.t < (id === 'comet' || id === 'rainbow' ? 0.45 : 0.3));
      if (pts.length < 2) return;
      g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
      if (id === 'dots') {
        pts.forEach((p, i) => {
          if (i % 2) return;
          const f = i / pts.length;
          g.globalAlpha = f; g.fillStyle = i % 4 ? '#ff9f43' : '#ffffff';
          g.beginPath(); g.arc(p.x, p.y, 0.06 + f * 0.06, 0, TAU); g.fill();
        });
      } else {
        for (let i = 1; i < pts.length; i++) {
          const f = i / pts.length, a = pts[i - 1], b = pts[i];
          if (Math.hypot(b.x - a.x, b.y - a.y) > 1) continue; // portal jump
          let col = 'rgba(255,255,255,0.6)', wd = P.BALL_R * 1.2 * f;
          if (id === 'comet') { col = `rgba(${120 + 100 * f | 0},${170 + 60 * f | 0},255,${0.7 * f})`; wd = P.BALL_R * 2 * f; }
          else if (id === 'rainbow') { col = `hsla(${(i * 18 + t * 200) % 360},95%,62%,${0.85 * f})`; wd = P.BALL_R * 1.8 * f; }
          else if (id === 'fire') { col = `rgba(255,${150 + 80 * f | 0},40,${0.5 * f})`; wd = P.BALL_R * 1.6 * f; }
          else if (id === 'sparkle') { col = `rgba(255,250,200,${0.5 * f})`; }
          else { col = `rgba(255,255,255,${0.55 * f})`; }
          g.strokeStyle = col; g.lineWidth = wd;
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
      }
      g.restore();
    }

    drawAim(g, ball, aim, t) {
      const { dx, dy, power } = aim;
      const hue = 120 - power * 120;
      const col = `hsl(${hue},90%,${power > 0.85 ? 55 : 50}%)`;
      // power ring
      g.beginPath(); g.arc(ball.x, ball.y, P.BALL_R + 0.18, -Math.PI / 2, -Math.PI / 2 + TAU * power);
      g.strokeStyle = col; g.lineWidth = 0.08; g.lineCap = 'round'; g.stroke();
      // dotted aim line
      const len = 0.9 + power * 4.4;
      const step = 0.32;
      const offset = (t * 2.2) % step;
      for (let s = 0.45 + offset; s < len; s += step) {
        const f = 1 - s / (len + 0.4);
        g.beginPath(); g.arc(ball.x + dx * s, ball.y + dy * s, 0.035 + 0.06 * f, 0, TAU);
        g.fillStyle = col; g.globalAlpha = 0.35 + 0.65 * f; g.fill();
      }
      g.globalAlpha = 1;
      // arrow head
      const hx = ball.x + dx * (len + 0.1), hy = ball.y + dy * (len + 0.1), nx = -dy, ny = dx;
      g.beginPath(); g.moveTo(hx + dx * 0.22, hy + dy * 0.22); g.lineTo(hx + nx * 0.16, hy + ny * 0.16); g.lineTo(hx - nx * 0.16, hy - ny * 0.16); g.closePath();
      g.fillStyle = col; g.fill();
      // pull-back band
      g.setLineDash([0.08, 0.08]);
      g.beginPath(); g.moveTo(ball.x, ball.y); g.lineTo(ball.x - dx * power * 1.6, ball.y - dy * power * 1.6);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.05; g.stroke();
      g.setLineDash([]);
    }

    drawFlag(g, cup, t, up) {
      const h = 1.25 * up;
      if (h <= 0.02) return;
      g.save();
      g.globalAlpha = Math.min(1, up * 1.4);
      g.strokeStyle = 'rgba(0,40,20,0.25)'; g.lineWidth = 0.06;
      g.beginPath(); g.moveTo(cup.x, cup.y); g.lineTo(cup.x + h * 0.35, cup.y + 0.12); g.stroke();
      g.strokeStyle = '#f4f4f4'; g.lineWidth = 0.07; g.lineCap = 'round';
      g.beginPath(); g.moveTo(cup.x, cup.y); g.lineTo(cup.x, cup.y - h); g.stroke();
      g.fillStyle = COL.flag;
      g.beginPath();
      const top = cup.y - h;
      g.moveTo(cup.x, top);
      for (let i = 0; i <= 8; i++) { const f = i / 8; g.lineTo(cup.x + f * 0.75, top + 0.02 + Math.sin(t * 6 - f * 4) * 0.06 * f + f * 0.2); }
      for (let i = 8; i >= 0; i--) { const f = i / 8; g.lineTo(cup.x + f * 0.75, top + 0.44 + Math.sin(t * 6 - f * 4) * 0.06 * f - f * 0.2); }
      g.closePath(); g.fill();
      g.restore();
    }
  }

  root.HOTD = Object.assign(root.HOTD || {}, { Renderer, SKINS, TRAILS, drawBall });
})(window);

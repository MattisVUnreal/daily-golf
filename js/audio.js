/* Hole of the Day — procedural sound effects (WebAudio, no files). */
(function (root) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;
  const last = {};

  function ensure() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function throttle(name, ms) {
    const now = performance.now();
    if (last[name] && now - last[name] < ms) return false;
    last[name] = now;
    return true;
  }

  function tone(type, f0, f1, dur, vol, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, filterType, freq, q, delay, freqEnd) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  const sfx = {
    unlock() { ensure(); },
    setEnabled(v) { enabled = v; },
    get enabled() { return enabled; },
    // club strike: crisp click + woody knock, louder with power
    hit(power) {
      if (!enabled || !ensure()) return;
      const p = Math.max(0.15, Math.min(1, power));
      noise(0.05, 0.5 * p + 0.15, 'highpass', 2500, 0.7);
      tone('triangle', 900 + 500 * p, 260, 0.09, 0.35 * p + 0.15);
      tone('sine', 180, 90, 0.08, 0.3 * p);
    },
    bounce(dv) {
      if (!enabled || !ensure() || !throttle('bounce', 35)) return;
      const v = Math.min(1, dv / 22);
      tone('square', 520 + 600 * v, 300 + 200 * v, 0.045, 0.06 + 0.16 * v);
      noise(0.03, 0.12 + 0.2 * v, 'bandpass', 1800, 2);
    },
    bumper() {
      if (!enabled || !ensure() || !throttle('bumper', 60)) return;
      tone('sine', 380, 980, 0.12, 0.35);
      tone('triangle', 760, 1500, 0.1, 0.12, 0.02);
    },
    plop() {
      if (!enabled || !ensure()) return;
      tone('sine', 700, 130, 0.16, 0.55);
      tone('sine', 140, 60, 0.22, 0.45, 0.03);
      noise(0.07, 0.18, 'lowpass', 900, 1, 0.0);
      // little rattle in the cup
      tone('triangle', 1600, 1200, 0.03, 0.08, 0.12);
      tone('triangle', 1400, 1100, 0.03, 0.05, 0.18);
    },
    splash() {
      if (!enabled || !ensure()) return;
      noise(0.5, 0.45, 'bandpass', 1400, 0.8, 0, 300);
      tone('sine', 420, 120, 0.25, 0.25);
    },
    oob() {
      if (!enabled || !ensure()) return;
      tone('sine', 500, 90, 0.4, 0.3);
    },
    sand() {
      if (!enabled || !ensure() || !throttle('sand', 150)) return;
      noise(0.18, 0.25, 'lowpass', 1200, 0.7, 0, 300);
    },
    portal() {
      if (!enabled || !ensure()) return;
      tone('sine', 300, 1400, 0.22, 0.25);
      tone('triangle', 600, 2200, 0.18, 0.1, 0.05);
    },
    boost() {
      if (!enabled || !ensure() || !throttle('boost', 120)) return;
      tone('sawtooth', 200, 900, 0.18, 0.12);
      noise(0.15, 0.15, 'highpass', 1500, 1, 0, 6000);
    },
    tick() {
      if (!enabled || !ensure() || !throttle('tick', 40)) return;
      tone('sine', 1300, 1300, 0.025, 0.05);
    },
    ui() {
      if (!enabled || !ensure()) return;
      tone('triangle', 880, 1100, 0.06, 0.12);
    },
    fanfare(level) {
      // level: 0 = par, 1 = birdie, 2 = eagle+, 3 = hole-in-one
      if (!enabled || !ensure()) return;
      const notes = [[523, 659, 784], [523, 659, 784, 1047], [523, 659, 784, 1047, 1319], [392, 523, 659, 784, 1047, 1319, 1568]][level] || [523, 659];
      notes.forEach((f, i) => {
        tone('triangle', f, f, 0.22, 0.2, i * 0.075);
        tone('sine', f * 2, f * 2, 0.15, 0.05, i * 0.075);
      });
      if (level >= 3) noise(0.8, 0.12, 'highpass', 5000, 0.5, 0.3);
    },
    sad() {
      if (!enabled || !ensure()) return;
      tone('triangle', 392, 370, 0.2, 0.15);
      tone('triangle', 330, 310, 0.3, 0.15, 0.18);
    },
  };
  root.HOTD = Object.assign(root.HOTD || {}, { sfx });
})(window);

// fx.js — animated backdrop for the catalog page.
//
// One fixed, full-viewport PixiJS canvas sits behind the content. Each section
// (hero + one per plugin) owns a scene; scenes crossfade as you scroll.
// Everything visual here is decoration: if PixiJS fails to load, WebGL is
// missing, or the visitor prefers reduced motion, the page still works on CSS.

// Pinned so the look never changes under us. Bump deliberately.
const PIXI_URL = 'https://cdn.jsdelivr.net/npm/pixi.js@8.22.0/dist/pixi.min.mjs';

// Shared tempo so every scene grooves together.
const BPM = 124;
const BEAT = 60 / BPM;
const SIXTEENTH = BEAT / 4;

// Plugin palettes, matching the inline --accent/--accent2 values in index.html.
const C = {
  tewYellow: 0xe8c200, tewGreen: 0x22b14c, tewRed: 0xff2a00, cream: 0xf4ead0,
  k1xOrange: 0xd94214, k1xSteel: 0xb8c4d6,
  hkrMagenta: 0xff00ff, hkrCyan: 0x00e0e0,
  v4jbTeal: 0x6fc3b8, v4jbOrange: 0xf0a030, v4jbIndigo: 0x4a3f8f,
  f4rtGreen: 0x02f53a, f4rtYellow: 0xe4f20f,
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Pointer in 0..1 viewport units; scenes use it for parallax and repel.
const pointer = { x: 0.5, y: 0.5 };
addEventListener('pointermove', (e) => {
  pointer.x = e.clientX / innerWidth;
  pointer.y = e.clientY / innerHeight;
}, { passive: true });

// ---------- Section tracking (runs even without PixiJS) ----------

let active = 'top';
let onActive = () => {};
const navLinks = [...document.querySelectorAll('nav a')];

// A thin band around the middle of the viewport decides the active section.
const activeObserver = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    active = e.target.dataset.scene;
    document.body.dataset.active = active;
    for (const a of navLinks) a.classList.toggle('active', a.hash === '#' + active);
    onActive(active);
  }
}, { rootMargin: '-45% 0px -45% 0px' });

document.querySelectorAll('[data-scene]').forEach((el) => activeObserver.observe(el));

// Scroll reveal. CSS only hides content once <html> has .reveal, so no-JS
// and reduced-motion visitors always see everything.
if (!reduceMotion) {
  document.documentElement.classList.add('reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('seen');
      revealObserver.unobserve(e.target);
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.plugin').forEach((el) => revealObserver.observe(el));
}

start().catch((err) => {
  // CDN blocked, no WebGL, or an old browser: the CSS gradients carry the page.
  console.info('fx: animated backdrop disabled:', err?.message || err);
  document.getElementById('fx')?.remove();
});

// ---------- PixiJS app ----------

async function start() {
  const PIXI = await import(PIXI_URL);
  const app = new PIXI.Application();
  await app.init({
    canvas: document.getElementById('fx'),
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    // Cap at 2x: sharper than that costs fill rate for no visible gain.
    resolution: Math.min(devicePixelRatio || 1, 2),
    preference: 'webgl',
  });

  const glow = glowTexture(PIXI);
  const { width: w0, height: h0 } = app.screen;
  // Particle budget scales with screen area so phones stay smooth.
  const budget = clamp(Math.round((w0 * h0) / 4000), 120, 500);

  const scenes = {
    top: heroScene(PIXI, glow, w0, h0, budget),
    tew03: tewScene(PIXI),
    k1x: kickScene(PIXI, glow),
    '5hkr': grooveScene(PIXI),
    v4jb: fogScene(PIXI, glow, w0, h0),
    f4rt: fartScene(PIXI, glow, w0, h0),
  };
  for (const [key, s] of Object.entries(scenes)) {
    s.root.alpha = key === active ? 1 : 0;
    app.stage.addChild(s.root);
  }

  if (reduceMotion) {
    // One still frame per section change; the ticker never runs.
    app.ticker.stop();
    const still = () => {
      const { width: w, height: h } = app.screen;
      for (const [key, s] of Object.entries(scenes)) {
        s.root.alpha = key === active ? 1 : 0;
        s.root.visible = key === active;
      }
      scenes[active]?.update(8, w, h, 0);
      app.render();
    };
    onActive = still;
    addEventListener('resize', () => requestAnimationFrame(still));
    still();
    return;
  }

  let t = 0;
  app.ticker.add((ticker) => {
    // Clamp dt so a stalled frame doesn't teleport particles.
    const dt = Math.min(ticker.deltaMS / 1000, 0.05);
    t += dt;
    const { width: w, height: h } = app.screen;
    const ease = Math.min(1, dt * 2.5);
    for (const [key, s] of Object.entries(scenes)) {
      const target = key === active ? 1 : 0;
      s.root.alpha += (target - s.root.alpha) * ease;
      s.root.visible = s.root.alpha > 0.01;
      if (!s.root.visible) continue; // hidden scenes cost nothing
      // Gentle parallax: the scene leans away from the pointer.
      s.root.x += ((0.5 - pointer.x) * 40 - s.root.x) * ease;
      s.root.y += ((0.5 - pointer.y) * 24 - s.root.y) * ease;
      s.update(t, w, h, dt);
    }
  });

  // Browsers throttle rAF in background tabs anyway; this makes it explicit.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) app.ticker.stop(); else app.ticker.start();
  });
}

// Soft white radial dot; tinted per sprite. Used for particles, cores, and fog.
function glowTexture(PIXI, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return PIXI.Texture.from(c);
}

function glowSprite(PIXI, tex, tint) {
  const s = new PIXI.Sprite(tex);
  s.anchor.set(0.5);
  s.tint = tint;
  s.blendMode = 'add';
  return s;
}

// Fake bloom: stroke the same polyline wide+faint, then narrow+bright.
// Pixi v8 clears the path after each stroke(), so we rebuild it per pass.
const GLOW_PASSES = [[22, 0.05], [10, 0.14], [2.5, 1]];
function glowLine(g, pts, color, scale = 1, passes = GLOW_PASSES) {
  for (const [width, alpha] of passes) {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.stroke({ width: width * scale, color, alpha, cap: 'round', join: 'round' });
  }
}

function wrap(s, w, h, m = 40) {
  if (s.x < -m) s.x += w + 2 * m; else if (s.x > w + m) s.x -= w + 2 * m;
  if (s.y < -m) s.y += h + 2 * m; else if (s.y > h + m) s.y -= h + 2 * m;
}

// ---------- Hero: five-color flow field ----------
// Streaks in all five plugin colors ride a slowly shifting vector field and
// part around the pointer.

function heroScene(PIXI, glow, w0, h0, n) {
  const root = new PIXI.Container();
  const colors = [C.tewYellow, C.k1xOrange, C.hkrMagenta, C.v4jbTeal, C.f4rtGreen];
  const ps = [];
  for (let i = 0; i < n; i++) {
    const s = glowSprite(PIXI, glow, colors[i % 5]);
    s.x = rand(0, w0);
    s.y = rand(0, h0);
    // Mostly small streaks, with ~8% big soft bokeh for depth.
    const big = Math.random() < 0.08;
    s.size = big ? rand(1.2, 2.4) : rand(0.08, 0.3);
    s.alpha = big ? rand(0.05, 0.12) : rand(0.35, 0.85);
    s.speed = big ? rand(8, 20) : rand(25, 80);
    root.addChild(s);
    ps.push(s);
  }

  return {
    root,
    update(t, w, h, dt) {
      const px = pointer.x * w, py = pointer.y * h, r2 = 150 * 150;
      for (const s of ps) {
        const a = (Math.sin(s.x * 0.0025 + t * 0.15) + Math.cos(s.y * 0.003 - t * 0.1)) * Math.PI;
        let vx = Math.cos(a) * s.speed, vy = Math.sin(a) * s.speed;
        const dx = s.x - px, dy = s.y - py, d2 = dx * dx + dy * dy;
        if (d2 < r2) {
          const f = (1 - d2 / r2) * 400 / Math.sqrt(d2 + 1);
          vx += dx * f;
          vy += dy * f;
        }
        s.x += vx * dt;
        s.y += vy * dt;
        // Stretch along travel direction so dots read as light trails.
        s.rotation = Math.atan2(vy, vx);
        s.scale.set(s.size * 2.6, s.size);
        wrap(s, w, h);
      }
    },
  };
}

// ---------- TEW03: acid squelch ----------
// A saw with a resonant ring after every reset; the "cutoff" sweeps slowly so
// the ring opens and closes like a 303. Sequencer notes slide past a playhead.

function tewScene(PIXI) {
  const root = new PIXI.Container();
  const grid = new PIXI.Graphics();
  const notes = new PIXI.Graphics();
  const wave = new PIXI.Graphics();
  notes.blendMode = 'add';
  wave.blendMode = 'add';
  root.addChild(grid, notes, wave);

  const ROWS = 12;
  const blocks = Array.from({ length: 26 }, () => ({
    row: Math.floor(rand(0, ROWS)),
    x: rand(0, 2400),
    red: Math.random() < 0.45,
    lit: 0,
  }));

  return {
    root,
    update(t, w, h, dt) {
      const rowH = (h * 0.8) / ROWS, top = h * 0.1, head = w * 0.62;

      // Faint piano-roll grid, scrolling with the notes.
      grid.clear();
      for (let r = 0; r <= ROWS; r++) grid.moveTo(0, top + r * rowH).lineTo(w, top + r * rowH);
      const step = 64, off = (t * 90) % step;
      for (let x = -off; x < w; x += step) grid.moveTo(x, top).lineTo(x, top + ROWS * rowH);
      grid.stroke({ width: 1, color: C.tewYellow, alpha: 0.07 });
      grid.moveTo(head, top).lineTo(head, top + ROWS * rowH);
      grid.stroke({ width: 2, color: C.tewRed, alpha: 0.35 });

      // Note blocks: flare when they cross the playhead.
      notes.clear();
      for (const b of blocks) {
        b.x -= 90 * dt;
        if (b.x < -120) {
          b.x = w + rand(0, w * 0.6);
          b.row = Math.floor(rand(0, ROWS));
          b.red = Math.random() < 0.45;
        }
        if (b.x < head && b.x + 64 > head) b.lit = 1; else b.lit *= Math.exp(-dt * 3);
        const y = top + b.row * rowH + rowH * 0.2, bh = rowH * 0.6;
        const color = b.red ? C.tewRed : C.cream;
        notes.roundRect(b.x - 6, y - 6, 76, bh + 12, 8).fill({ color, alpha: 0.06 + 0.25 * b.lit });
        notes.roundRect(b.x, y, 64, bh, 4).fill({ color, alpha: 0.35 + 0.6 * b.lit });
      }

      // The squelch: cutoff wobbles slowly, resonance ring follows it.
      wave.clear();
      const cut = 0.5 + 0.5 * Math.sin(t * 0.8);
      const period = 240 + 60 * Math.sin(t * 0.23);
      const amp = h * 0.16, cy = h * 0.55, scroll = t * 140;
      const main = [], echo = [];
      for (let x = -10; x <= w + 10; x += 5) {
        const ph = (((x + scroll) / period) % 1 + 1) % 1;
        const saw = 1 - 2 * ph;
        const ring = Math.exp(-ph * (7 - 5 * cut)) * Math.sin(ph * (18 + 40 * cut) * Math.PI);
        main.push(x, cy + amp * (saw * (0.35 + 0.4 * cut) + ring * 0.7));
        const ph2 = (ph + 0.5) % 1;
        echo.push(x, cy + amp * 0.6 * ((1 - 2 * ph2) * 0.5 + Math.exp(-ph2 * 5) * Math.sin(ph2 * 30 * Math.PI) * 0.5));
      }
      glowLine(wave, echo, C.tewGreen, 0.7);
      glowLine(wave, main, C.tewYellow, 1 + 0.4 * cut);
    },
  };
}

// ---------- K1X: kick shockwaves ----------
// Every beat fires a ring burst, a spark spray, and a pitch-dropping sine
// that decays across the screen like the plugin's waveform view.

function kickScene(PIXI, glow) {
  const root = new PIXI.Container();
  const rings = new PIXI.Graphics();
  const wave = new PIXI.Graphics();
  rings.blendMode = 'add';
  wave.blendMode = 'add';
  const core = glowSprite(PIXI, glow, C.k1xOrange);
  root.addChild(rings, wave, core);

  const sparks = Array.from({ length: 90 }, () => {
    const s = glowSprite(PIXI, glow, Math.random() < 0.7 ? C.k1xOrange : C.k1xSteel);
    s.alpha = 0;
    root.addChild(s);
    return s;
  });
  let nextSpark = 0;
  const bursts = [];
  let lastBeat = -1;

  return {
    root,
    update(t, w, h, dt) {
      const cx = w * 0.5, cy = h * 0.45;
      const beat = Math.floor(t / BEAT);
      const env = Math.exp(-(t % BEAT) * 7); // 1 on the hit, decays to ~0
      if (beat !== lastBeat) {
        lastBeat = beat;
        bursts.push(t);
        for (let i = 0; i < 24; i++) {
          const s = sparks[nextSpark++ % sparks.length];
          const a = rand(0, Math.PI * 2), v = rand(200, 650);
          s.x = cx; s.y = cy; s.vx = Math.cos(a) * v; s.vy = Math.sin(a) * v;
          s.alpha = 1; s.scale.set(rand(0.15, 0.4));
        }
      }
      while (bursts.length && t - bursts[0] > 2.6) bursts.shift();

      // Expanding rings: orange shock, steel echo slightly behind.
      rings.clear();
      const maxR = Math.hypot(w, h) * 0.55;
      for (const born of bursts) {
        const a = t - born, life = 1 - a / 2.6;
        if (life <= 0) continue;
        const r = maxR * (1 - Math.exp(-a * 2.2));
        for (const [width, alpha] of GLOW_PASSES) {
          rings.circle(cx, cy, r).stroke({ width: width * (0.5 + life), color: C.k1xOrange, alpha: alpha * life * life });
        }
        if (a > 0.12) {
          rings.circle(cx, cy, r * 0.82).stroke({ width: 1.5, color: C.k1xSteel, alpha: 0.5 * life * life });
        }
      }

      core.scale.set(2.5 + 5 * env);
      core.alpha = 0.35 + 0.6 * env;

      for (const s of sparks) {
        if (s.alpha <= 0.01) continue;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.vx *= Math.exp(-dt * 2.5); s.vy *= Math.exp(-dt * 2.5);
        s.alpha *= Math.exp(-dt * 2.2);
      }

      // Kick waveform: pitch drops fast, amplitude decays, punches on the beat.
      wave.clear();
      const pts = [], wy = h * 0.82, amp = h * 0.09 * (0.45 + 0.55 * env);
      for (let x = 0; x <= w; x += 3) {
        const u = x / w;
        const phase = 70 * u + 55 * (1 - Math.exp(-u * 6)) - t * 6;
        pts.push(x, wy + amp * Math.exp(-u * 2.8) * Math.sin(phase));
      }
      glowLine(wave, pts, C.k1xOrange);
    },
  };
}

// ---------- 5HKR: perspective groove grid ----------
// Eight lanes × sixteen steps laid out as a floor and ceiling receding to a
// horizon. Cells flash magenta on quarter notes, cyan otherwise, with a
// little per-lane swing.

function grooveScene(PIXI) {
  const root = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.blendMode = 'add';
  root.addChild(g);

  // Decorative pattern (not a factory preset). One string per lane, near→far.
  const pattern = [
    'x.x.x.x.x.x.x.x.',
    '..x...x...x...x.',
    'x...............',
    '....x.......x...',
    '.x.x.x.x.x.x.x.x',
    'x..x..x...x..x..',
    '...x.....x..x...',
    '....x.......x..x',
  ].map((row) => [...row].map((c) => c === 'x'));
  const LANES = pattern.length, STEPS = 16;
  const swing = [0, 0.12, 0, 0.2, 0.08, 0.16, 0.24, 0.1];
  const flash = pattern.map(() => new Float32Array(STEPS));
  const lastK = new Array(LANES).fill(-1);

  return {
    root,
    update(t, w, h, dt) {
      // Fire hits: lane r's odd steps land swing[r] sixteenths late.
      for (let r = 0; r < LANES; r++) {
        let k = Math.floor(t / SIXTEENTH);
        if (k % 2 === 1 && t < (k + swing[r]) * SIXTEENTH) k -= 1;
        if (k !== lastK[r]) {
          lastK[r] = k;
          const s = k % STEPS;
          if (pattern[r][s]) flash[r][s] = 1;
        }
        for (let s = 0; s < STEPS; s++) flash[r][s] *= Math.exp(-dt * 4);
      }

      g.clear();
      const hy = h * 0.42, cx = w * (0.5 + 0.04 * Math.sin(t * 0.21));
      const cellW = Math.max(w, 700) * 0.075, play = Math.floor(t / SIXTEENTH) % STEPS;
      // Project a grid point (column edge, depth) onto floor (+1) or ceiling (-1).
      const P = (col, z, side) => [cx + (col - STEPS / 2) * cellW / z, hy + side * (h * 0.7) / z];

      for (const side of [1, -1]) {
        const dim = side === 1 ? 1 : 0.45;
        for (let r = 0; r < LANES; r++) {
          const z0 = 1 + r * 0.55, z1 = z0 + 0.45;
          for (let s = 0; s < STEPS; s++) {
            const a = P(s + 0.06, z0, side), b = P(s + 0.94, z0, side);
            const c = P(s + 0.94, z1, side), d = P(s + 0.06, z1, side);
            const quad = [...a, ...b, ...c, ...d];
            const color = s % 4 === 0 ? C.hkrMagenta : C.hkrCyan;
            const f = flash[r][s];
            const onHead = s === play ? 0.12 : 0;
            g.poly(quad)
              .fill({ color, alpha: (0.06 + onHead + 0.8 * f) * dim / (1 + r * 0.15) })
              .stroke({ width: 1.5, color, alpha: (0.25 + 0.5 * f) * dim });
          }
        }
      }
    },
  };
}

// ---------- V4JB: partials and fog ----------
// Hundreds of slow sine "partials" rise as soft bars under a moving spectral
// bump; fog drifts through and a few orange sparks float upward.

function fogScene(PIXI, glow, w0, h0) {
  const root = new PIXI.Container();
  const bars = new PIXI.Graphics();
  bars.blendMode = 'add';
  root.addChild(bars);

  const fog = Array.from({ length: 22 }, (_, i) => {
    const s = glowSprite(PIXI, glow, [C.v4jbTeal, C.v4jbIndigo, 0x8a6fd1][i % 3]);
    s.x = rand(0, w0); s.y = rand(0, h0);
    s.scale.set(rand(6, 12));
    s.alpha = rand(0.05, 0.11);
    s.vx = rand(-12, 12); s.vy = rand(-6, 6);
    root.addChild(s);
    return s;
  });

  const sparks = Array.from({ length: 40 }, () => {
    const s = glowSprite(PIXI, glow, C.v4jbOrange);
    s.x = rand(0, w0); s.y = rand(0, h0);
    s.scale.set(rand(0.08, 0.22));
    s.vy = rand(-30, -10); s.ph = rand(0, 6.28);
    root.addChild(s);
    return s;
  });

  const N = clamp(Math.round(w0 / 7), 60, 260);
  const partials = Array.from({ length: N }, () => ({ sp: rand(0.2, 1.1), ph: rand(0, 6.28) }));

  return {
    root,
    update(t, w, h, dt) {
      for (const s of fog) {
        s.x += s.vx * dt; s.y += s.vy * dt;
        wrap(s, w, h, 300);
      }
      for (const s of sparks) {
        s.y += s.vy * dt;
        s.x += Math.sin(t * 0.7 + s.ph) * 10 * dt;
        s.alpha = 0.35 + 0.45 * Math.sin(t * 2 + s.ph);
        wrap(s, w, h);
      }

      bars.clear();
      const bw = w / N;
      const center = 0.45 + 0.35 * Math.sin(t * 0.09);
      for (let i = 0; i < N; i++) {
        const u = i / N, p = partials[i];
        const tilt = 1 / (1 + i * 0.025);
        const bump = Math.exp(-((u - center) ** 2) / 0.015);
        const amp = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph));
        const bh = h * 0.6 * (0.55 * tilt + 0.6 * bump) * amp;
        const x = i * bw;
        bars.rect(x + bw * 0.2, h - bh, bw * 0.6, bh).fill({ color: C.v4jbTeal, alpha: 0.12 });
        bars.rect(x + bw * 0.1, h - bh - 2, bw * 0.8, 3).fill({ color: C.v4jbTeal, alpha: 0.7 });
      }
    },
  };
}

// ---------- F4RT: toxic gas and formants ----------
// Green/yellow blobs rise like the plugin site's floating logos. Under them a
// croak wave with three formant peaks wobbles on a slow wet envelope.

function fartScene(PIXI, glow, w0, h0) {
  const root = new PIXI.Container();
  const wave = new PIXI.Graphics();
  wave.blendMode = 'add';
  root.addChild(wave);

  const blobs = Array.from({ length: 28 }, (_, i) => {
    const s = glowSprite(PIXI, glow, i % 3 ? C.f4rtGreen : C.f4rtYellow);
    s.x = rand(0, w0);
    s.y = rand(0, h0);
    s.scale.set(rand(2.4, 7));
    s.alpha = rand(0.08, 0.2);
    s.vy = rand(-70, -22);
    s.ph = rand(0, 6.28);
    root.addChild(s);
    return s;
  });

  return {
    root,
    update(t, w, h, dt) {
      for (const s of blobs) {
        s.y += s.vy * dt;
        s.x += Math.sin(t * 0.6 + s.ph) * 18 * dt;
        s.alpha = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.4 + s.ph));
        if (s.y < -80) {
          s.y = h + rand(40, 160);
          s.x = rand(0, w);
        }
      }

      wave.clear();
      const wet = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.35));
      const amp = h * 0.16 * (0.55 + 0.45 * wet);
      const cy = h * 0.58;
      const main = [], echo = [];
      for (let x = -10; x <= w + 10; x += 5) {
        const u = (x / w) * 6.28 + t * 1.1;
        const body = Math.sin(u * 1.4) * 0.35;
        const f1 = Math.sin(u * 7.2) * Math.exp(-Math.abs(Math.sin(u * 0.5)) * 1.6);
        const f2 = Math.sin(u * 12.5 + 0.4) * 0.55 * wet;
        const f3 = Math.sin(u * 18 + t) * 0.28 * wet;
        const y = cy + amp * (body + f1 + f2 + f3);
        main.push(x, y);
        echo.push(x, cy + (y - cy) * 0.55 + amp * 0.12 * Math.sin(u * 3));
      }
      glowLine(wave, echo, C.f4rtYellow, 0.7);
      glowLine(wave, main, C.f4rtGreen, 1 + 0.35 * wet);
    },
  };
}

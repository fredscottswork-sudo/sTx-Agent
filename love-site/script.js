/* ═══════════════════════════════════════════════════════════════
   FOR GLORIA COLETE — the engine
   ═══════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const doc   = document.documentElement;
const body  = document.body;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp  = (a, b, t) => a + (b - a) * t;
const rand  = (a, b) => a + Math.random() * (b - a);
const smooth = t => t * t * (3 - 2 * t);

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* A decorative feature must never be able to take the page down with it. */
function safe(name, fn) {
  try { fn(); }
  catch (err) { console.warn('[love-site] "' + name + '" skipped:', err && err.message); }
}

/* ───────────────────────────────────────────────────────────────
   1.  THE SCENE — a road that carries you from dawn to midnight
   ─────────────────────────────────────────────────────────────── */

const cv  = document.getElementById('scene');
const ctx = cv.getContext('2d', { alpha: false });

let W = 0, H = 0, DPR = 1, horizonY = 0, focal = 1;
const camH = 1.55;          // camera height, metres
const RW   = 3.9;           // road half-width, metres
const NEAR = 1.4;           // nearest drawable distance, metres
const FAR  = 460;           // fog distance, metres
const SPAN = 7.5;           // metres per road segment

let drive = 0;              // metres travelled (the thing that makes the world move)
let journey = 0;            // 0 → 1 across the whole page
let boost  = 0;             // scroll-velocity kick

/* colour helpers ------------------------------------------------ */
const hex2rgb = h => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mixc = (a, b, t) => `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* one day, from first light to stars --------------------------- */
/* Sky stops stay deliberately deep: cream text has to stay legible
   over them at every point in the journey.                     */
const SKY = [
  { p: 0.00, top: '#170f33', mid: '#5e3159', low: '#d99a6c', sun: '#fff0cf', gnd: '#2a1f30' },
  { p: 0.14, top: '#1d4a7c', mid: '#4b7ba8', low: '#b9926e', sun: '#fff8e6', gnd: '#2c3324' },
  { p: 0.38, top: '#12568f', mid: '#3f83b4', low: '#8fb8cd', sun: '#ffffff', gnd: '#333a22' },
  { p: 0.62, top: '#1e1545', mid: '#b84f43', low: '#d9854f', sun: '#ffd79a', gnd: '#332524' },
  { p: 0.82, top: '#0b0820', mid: '#241a4a', low: '#523162', sun: '#ece6ff', gnd: '#110d24' },
  { p: 1.00, top: '#04030d', mid: '#090d24', low: '#171e46', sun: '#eef0ff', gnd: '#090716' },
].map(s => ({ ...s, top: hex2rgb(s.top), mid: hex2rgb(s.mid), low: hex2rgb(s.low), sun: hex2rgb(s.sun), gnd: hex2rgb(s.gnd) }));

function sky(p) {
  let i = 0;
  while (i < SKY.length - 2 && p > SKY[i + 1].p) i++;
  const a = SKY[i], b = SKY[i + 1];
  const t = clamp((p - a.p) / (b.p - a.p || 1), 0, 1);
  const e = smooth(t);
  return {
    top: mixc(a.top, b.top, e),
    mid: mixc(a.mid, b.mid, e),
    low: mixc(a.low, b.low, e),
    sun: mixc(a.sun, b.sun, e),
    gnd: mixc(a.gnd, b.gnd, e),
    t: e,
  };
}
const nightness = p => clamp((p - 0.70) / 0.24, 0, 1);
const duskness  = p => clamp((p - 0.52) / 0.24, 0, 1);

/* ── deterministic scenery ───────────────────────────────────── */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let STARS = [], CLOUDS = [], RIDGES = [], PROPS = [];

function buildScenery() {
  const r = rng(20241013);

  // stars
  STARS = Array.from({ length: 170 }, () => ({
    x: r(), y: r() * 0.72, m: r() * 1.5 + 0.3, p: r() * Math.PI * 2,
  }));

  // clouds — three parallax layers
  CLOUDS = Array.from({ length: 11 }, () => {
    const layer = Math.floor(r() * 3);
    return {
      x: r(), layer,
      y: 0.08 + layer * 0.11 + r() * 0.05,
      s: (0.5 + r() * 0.9) * (1 + layer * 0.42),
      a: 0.10 + r() * 0.16,
      v: 0.0016 + r() * 0.004,
    };
  });

  // mountain ridges
  RIDGES = [0, 1, 2].map(layer => {
    const rr = rng(77 + layer * 31);
    const pts = [];
    const n = 26;
    for (let i = 0; i <= n; i++) {
      pts.push({
        x: i / n,
        y: 0.34 + rr() * 0.30 - Math.sin(i * 1.1 + layer) * 0.10 + layer * 0.055,
      });
    }
    return { pts, layer, par: 0.10 + layer * 0.17 };
  });

  // roadside props
  PROPS = Array.from({ length: 90 }, (_, i) => {
    const rr = rng(1000 + i * 13);
    return {
      d: i * 26 + rr() * 10,
      side: i % 2 === 0 ? -1 : 1,
      off: 5.2 + rr() * 9,
      kind: rr() < 0.62 ? 'tree' : (rr() < 0.5 ? 'pole' : 'bush'),
      h: rr() * 1.9 + 1,
      s: rr(),
    };
  });
}
buildScenery();

/* ── sizing ──────────────────────────────────────────────────── */
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = Math.floor(W * DPR);
  cv.height = Math.floor(H * DPR);
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  horizonY = Math.round(H * 0.665);
  focal = Math.max(W * 1.02, H * 0.95);
}
resize();
addEventListener('resize', resize, { passive: true });

/* ── projection ──────────────────────────────────────────────── */
const px = (x, d) => W / 2 + (x * focal) / d;
const py = (d)     => horizonY + (camH * focal) / d;
const pyH = (d, h) => horizonY + ((camH - h) * focal) / d;

/* ── drawing pieces ──────────────────────────────────────────── */

function drawSky(S, p) {
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0,    S.top);
  g.addColorStop(0.55, S.mid);
  g.addColorStop(1,    S.low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizonY + 1);

  // stars
  const nk = nightness(p);
  if (nk > 0.001) {
    for (const st of STARS) {
      const tw = REDUCED ? 0.75 : 0.55 + 0.45 * Math.sin(Date.now() / 900 + st.p);
      ctx.globalAlpha = nk * tw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(st.x * W, st.y * horizonY, st.m, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // sun / moon
  const travel = p / 0.92;                    // 0 → 1 across the day
  const bx = lerp(0.10, 0.92, travel) * W;
  const arc = Math.sin(clamp(travel, 0, 1) * Math.PI);
  const by = horizonY - arc * H * 0.46;
  const R = lerp(46, 26, nightness(p)) * clamp(W / 1280, 0.62, 1.15);

  if (travel <= 1) {
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, R * 9);
    glow.addColorStop(0,   rgba(S.sun, 0.55));
    glow.addColorStop(0.22, rgba(S.sun, 0.18));
    glow.addColorStop(1,   rgba(S.sun, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(bx - R * 9, by - R * 9, R * 18, R * 18);

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = rgba(S.sun, 1);
    ctx.beginPath();
    ctx.arc(bx, by, R, 0, 7);
    ctx.fill();

    if (nk > 0.25) {
      // crescent: repaint an offset bite with the sky gradient itself, so it
      // matches whatever is behind it (no compositing, no punched hole)
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx + R * 0.52, by - R * 0.26, R * 0.94, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawClouds(p) {
  const t = Date.now() / 60000;
  const S = sky(p);
  const col = mixc(S.mid, [255, 255, 255], 0.55);

  for (const c of CLOUDS) {
    const drift = (c.x + t * c.v * (1 + journey * 2.4) + journey * c.layer * 0.18) % 1.35 - 0.18;
    const cx = drift * W;
    const cy = c.y * horizonY;
    const w = 150 * c.s;
    const h = w * 0.30;
    const a = c.a * (1 - nightness(p) * 0.62) * (0.6 + c.layer * 0.25);

    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, h, 0, 0, 7);
    ctx.ellipse(cx - w * 0.42, cy + h * 0.35, w * 0.58, h * 0.66, 0, 0, 7);
    ctx.ellipse(cx + w * 0.44, cy + h * 0.30, w * 0.62, h * 0.72, 0, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRidges(S, p) {
  const nk = nightness(p), dk = duskness(p);
  const col = mixc(S.gnd, S.low, 0.22);

  for (const rg of RIDGES) {
    const off = (-journey * rg.par * 2.4) % 1;
    ctx.fillStyle = mixc(col, [8, 5, 18], nk * 0.45 + rg.layer * 0.10);
    ctx.beginPath();
    ctx.moveTo(-W * 0.3, horizonY + 2);
    for (let i = 0; i <= rg.pts.length; i++) {
      const pt = rg.pts[i % rg.pts.length];
      let x = pt.x + off;
      x = ((x % 1) + 1) % 1;
      const sx = -W * 0.3 + x * W * 1.6;
      ctx.lineTo(sx, horizonY - pt.y * H * 0.20 - rg.layer * 3);
    }
    ctx.lineTo(W * 1.3, horizonY + 2);
    ctx.closePath();
    ctx.fill();
  }
  // warm haze hugging the horizon at golden hour
  if (dk > 0.01) {
    const hz = ctx.createLinearGradient(0, horizonY - H * 0.14, 0, horizonY + 4);
    hz.addColorStop(0, rgba(S.low, 0));
    hz.addColorStop(1, rgba(S.low, 0.34 * dk));
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizonY - H * 0.14, W, H * 0.14 + 6);
  }
}

function drawGround(S, p) {
  const g = ctx.createLinearGradient(0, horizonY, 0, H);
  g.addColorStop(0, mixc(S.gnd, S.low, 0.30));
  g.addColorStop(0.4, S.gnd);
  g.addColorStop(1, mixc(S.gnd, [0, 0, 0], 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, horizonY, W, H - horizonY);

  // scrolling grass streaks for speed
  const nk = nightness(p);
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = mixc(S.gnd, [255, 255, 255], 0.35);
  for (let i = 0; i < 34; i++) {
    const d = NEAR + ((i * SPAN * 1.7) - (drive % (SPAN * 1.7)) + SPAN * 1.7 * 34) % (SPAN * 1.7 * 34);
    const y = py(d);
    if (y > H + 40) continue;
    const w = (RW * focal) / d * 5.2;
    ctx.fillRect(W / 2 - w / 2 + Math.sin(i * 2.4) * w * 0.22, y, w, Math.max(1, 3 * (60 / d)));
  }
  ctx.globalAlpha = 1;
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4, fill) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawProps(S, p) {
  const nk = nightness(p);
  const trunk = mixc(S.gnd, [0, 0, 0], 0.62);
  const leaf  = mixc(S.gnd, [0, 0, 0], 0.44);
  const lampGlow = p > 0.72 ? 0.85 : 0.22;

  for (const pr of PROPS) {
    const d = ((pr.d - drive) % 2340 + 2340) % 2340 + NEAR;
    if (d > 330) continue;
    const fog = clamp(1 - d / 330, 0, 1) ** 1.5;
    const x = pr.side * pr.off;
    const bx = px(x, d), by = py(d);
    if (by < horizonY || by > H + 60) continue;

    const alpha = 0.25 + fog * 0.75;
    ctx.globalAlpha = alpha;

    if (pr.kind === 'tree') {
      const h = 4.2 + pr.h * 3.4;
      const top = pyH(d, h);
      const halfW = ((1.0 + pr.s * 0.7) * focal) / d;
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.moveTo(bx - halfW, by);
      ctx.lineTo(bx, top);
      ctx.lineTo(bx + halfW, by);
      ctx.closePath();
      ctx.fill();
      // trunk: a real slice of ground plane, so it scales correctly at any depth
      const trunkH = (1.1 * focal) / d;
      ctx.fillStyle = trunk;
      ctx.fillRect(bx - halfW * 0.10, by - trunkH, Math.max(0.6, halfW * 0.20), trunkH);
    } else if (pr.kind === 'pole') {
      const h = 5.6;
      const top = pyH(d, h);
      ctx.strokeStyle = trunk;
      ctx.lineWidth = Math.max(1, (0.16 * focal) / d);
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx, top);
      ctx.stroke();
      const armY = top + ((0.6 * focal) / d) * 5;
      const armW = (0.7 * focal) / d;
      ctx.beginPath();
      ctx.moveTo(bx - armW, armY); ctx.lineTo(bx + armW, armY);
      ctx.stroke();
      if (lampGlow > 0.3) {
        const gl = ctx.createRadialGradient(bx, armY, 0, bx, armY, armW * 3.4);
        gl.addColorStop(0, rgba([255, 214, 150], 0.75 * fog));
        gl.addColorStop(1, rgba([255, 214, 150], 0));
        ctx.fillStyle = gl;
        ctx.fillRect(bx - armW * 3.4, armY - armW * 3.4, armW * 6.8, armW * 6.8);
      }
    } else {
      const r = (1.1 + pr.s * 0.8) * focal / d;
      ctx.fillStyle = leaf;
      ctx.beginPath();
      ctx.ellipse(bx, by - r * 0.35, r, r * 0.66, 0, 0, 7);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  void nk;
}

function drawRoad(S, p) {
  const nk = nightness(p);
  const asphaltFar  = mixc(mixc(S.gnd, [0, 0, 0], 0.55), S.low, 0.22);
  const asphaltNear = mixc([26, 22, 34], [46, 38, 54], 0.4 + nk * 0.1);

  const phase = drive % (SPAN * 2);
  const segs = Math.ceil((FAR - NEAR) / SPAN);

  // far → near so nearer segments overlap correctly
  for (let i = segs; i >= 0; i--) {
    const d0 = NEAR + i * SPAN + phase;
    const d1 = d0 + SPAN;
    if (d1 > FAR) continue;

    const y0 = py(d0), y1 = py(d1);
    if (y0 > H + 60) continue;
    if (y1 < horizonY - 2) continue;

    const fog = clamp(1 - d0 / FAR, 0, 1);
    const xa0 = px(-RW, d0), xb0 = px(RW, d0);
    const xa1 = px(-RW, d1), xb1 = px(RW, d1);

    // asphalt
    quad(
      xa0, y0, xb0, y0, xb1, y1, xa1, y1,
      mixc(asphaltFar, asphaltNear, fog)
    );

    // rumble strip on the shoulder, alternating — gives the road its speed
    const rumble = i % 2 === 0 ? '#e8695f' : '#f4ece0';
    for (const s of [-1, 1]) {
      quad(
        px(s * (RW - 0.62), d0), y0, px(s * (RW + 0.30), d0), y0,
        px(s * (RW + 0.30), d1), y1, px(s * (RW - 0.62), d1), y1,
        mixc(hex2rgb(rumble), S.low, clamp(d0 / FAR, 0, 1) * 0.72)
      );
    }

    // continuous edge line
    for (const s of [-1, 1]) {
      quad(
        px(s * (RW - 0.30), d0), y0, px(s * (RW - 0.08), d0), y0,
        px(s * (RW - 0.08), d1), y1, px(s * (RW - 0.30), d1), y1,
        mixc(S.low, '#fff6e2', 0.5)
      );
    }

    // centre dashes — on every other segment
    if (i % 2 === 0) {
      quad(
        px(-0.18, d0), y0, px(0.18, d0), y0,
        px(0.18, d1), y1, px(-0.18, d1), y1,
        mixc(S.low, '#fffaf0', 0.45)
      );
    }
  }
}

function drawCar(S, p) {
  const w = clamp(W * 0.26, 130, 250);
  const bob = REDUCED ? 0 : Math.sin(Date.now() / 90) * (1.1 + boost * 5);
  const cx = W / 2;
  const baseY = H + w * 0.10 + bob;

  const bodyTop = baseY - w * 0.46;
  const cabinTop = bodyTop - w * 0.42;

  ctx.save();

  // headlight wash on the road ahead
  const wash = ctx.createRadialGradient(cx, bodyTop, 0, cx, bodyTop, w * 1.5);
  wash.addColorStop(0, `rgba(255,225,190,${0.10 + nightness(p) * 0.14})`);
  wash.addColorStop(1, 'rgba(255,225,190,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(cx - w * 1.5, bodyTop - w * 1.5, w * 3, w * 3);

  const body = mixc([44, 34, 58], S.low, 0.10);
  const r = w * 0.09;

  // cabin
  ctx.fillStyle = mixc(body, [0, 0, 0], 0.18);
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.345, cabinTop, w * 0.69, w * 0.50, [w * 0.16, w * 0.16, w * 0.05, w * 0.05]);
  ctx.fill();

  // rear window
  const glass = ctx.createLinearGradient(0, cabinTop, 0, cabinTop + w * 0.34);
  glass.addColorStop(0, mixc(S.mid, [255, 255, 255], 0.22));
  glass.addColorStop(1, mixc([18, 12, 30], [60, 45, 80], 0.5));
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.28, cabinTop + w * 0.055, w * 0.56, w * 0.335, w * 0.09);
  ctx.fill();

  // body
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, bodyTop, w, w * 0.52, [r, r, w * 0.05, w * 0.05]);
  ctx.fill();

  // shoulder highlight
  ctx.fillStyle = rgba(mixc(body, [255, 255, 255], 0.5), 0.30);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, bodyTop, w, w * 0.045, [r, r, 0, 0]);
  ctx.fill();

  // tail lights
  const tw = w * 0.155, th = w * 0.105;
  for (const s of [-1, 1]) {
    const lx = cx + s * (w / 2 - tw - w * 0.055);
    const ly = bodyTop + w * 0.085;
    const g = ctx.createRadialGradient(lx + tw / 2, ly + th / 2, 0, lx + tw / 2, ly + th / 2, tw * 2.4);
    g.addColorStop(0, 'rgba(255,110,130,.85)');
    g.addColorStop(1, 'rgba(255,110,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - tw * 1.9, ly - tw * 1.9, tw * 4.8, tw * 4.8);
    ctx.fillStyle = '#ff6e82';
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw, th, th * 0.45);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,240,.75)';
    ctx.beginPath();
    ctx.roundRect(lx + tw * 0.12, ly + th * 0.16, tw * 0.76, th * 0.3, th * 0.15);
    ctx.fill();
  }

  // number plate
  ctx.fillStyle = 'rgba(20,14,30,.72)';
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.10, bodyTop + w * 0.255, w * 0.20, w * 0.075, w * 0.012);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,215,154,.85)';
  ctx.font = `500 ${Math.max(7, w * 0.052)}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('♥ 2US', cx, bodyTop + w * 0.294);

  // bumper
  ctx.fillStyle = rgba([0, 0, 0], 0.28);
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.44, bodyTop + w * 0.40, w * 0.88, w * 0.055, w * 0.02);
  ctx.fill();

  ctx.restore();
}

function render() {
  const S = sky(journey);
  drawSky(S, journey);
  drawClouds(journey);
  drawRidges(S, journey);
  drawGround(S, journey);
  drawProps(S, journey);
  drawRoad(S, journey);
  drawCar(S, journey);
}

/* ───────────────────────────────────────────────────────────────
   2.  SCROLL CHOREOGRAPHY
   ─────────────────────────────────────────────────────────────── */

let lastY = scrollY;

function onScroll() {
  const y = scrollY;
  const dy = y - lastY;
  lastY = y;
  boost = clamp(boost + Math.abs(dy) * 0.022, 0, 3.4);

  const max = Math.max(1, body.scrollHeight - innerHeight);
  journey = clamp(y / max, 0, 1);

  document.getElementById('progressFill').style.width = (journey * 100).toFixed(2) + '%';
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });

let prevT = performance.now();
function frame(now) {
  const dt = Math.min((now - prevT) / 1000, 0.05);
  prevT = now;

  // the world keeps rolling on its own; scrolling pushes it harder
  const speed = 15 + boost * 26;
  drive += speed * dt;
  boost = Math.max(0, boost - dt * 1.9);

  render();
  requestAnimationFrame(frame);
}

/* Reduced motion: paint one still frame, never animate the road. */
if (REDUCED) render();
else requestAnimationFrame(frame);

/* ───────────────────────────────────────────────────────────────
   3.  REVEALS
   ─────────────────────────────────────────────────────────────── */

const revealIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
  }
}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

function initReveals() {
  document.querySelectorAll('.reveal').forEach(el => revealIO.observe(el));
}

/* ───────────────────────────────────────────────────────────────
   4.  ROUTE MAP — the line inks itself in as you scroll
   ─────────────────────────────────────────────────────────────── */

const mapPath = document.getElementById('mapPath');
const mapBase = document.getElementById('mapBase');
const mapPins = document.getElementById('mapPins');
let mapLen = 0;

function buildMap() {
  if (!mapPath || !mapBase || !mapPins) return;

  // getTotalLength is unavailable in some engines (and while the SVG is hidden)
  if (typeof mapPath.getTotalLength !== 'function') {
    console.warn('[love-site] route map not supported here; continuing without it.');
    return;
  }
  mapLen = mapPath.getTotalLength();
  if (!Number.isFinite(mapLen) || mapLen <= 0) return;

  mapBase.setAttribute('stroke-dasharray', '3 9');
  mapPath.style.strokeDasharray = `${mapLen} ${mapLen}`;
  mapPath.style.strokeDashoffset  = mapLen;

  const STOPS = [
    { f: 0.055, label: 'KM 0',      to: '#stop-1' },
    { f: 0.285, label: 'KM 143',    to: '#stop-2' },
    { f: 0.505, label: 'KM 301',    to: '#stop-3' },
    { f: 0.735, label: 'KM 458',    to: '#stop-4' },
    { f: 0.945, label: 'KM ∞',      to: '#stop-5' },
  ];

  mapPins.innerHTML = '';
  STOPS.forEach((s, i) => {
    let pt;
    try { pt = mapPath.getPointAtLength(mapLen * s.f); }
    catch (_) { return; }
    if (!pt || !Number.isFinite(pt.x)) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'map-pin');
    g.setAttribute('transform', `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'link');
    g.setAttribute('aria-label', `Go to stop ${i + 1}`);
    g.innerHTML = `
      <circle class="halo" cx="0" cy="0" r="11" style="animation-delay:${(i * .5).toFixed(2)}s"></circle>
      <circle class="dot"  cx="0" cy="0" r="7"></circle>
      <circle class="core" cx="0" cy="0" r="2.6"></circle>
      <text x="0" y="-20" text-anchor="middle">${s.label}</text>`;
    const go = () => {
      const t = document.querySelector(s.to);
      if (t) t.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    };
    g.addEventListener('click', go);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    mapPins.appendChild(g);
  });
  requestAnimationFrame(updateMap);
}

function updateMap() {
  if (!mapLen || !mapPath) return;
  const sec = document.getElementById('route');
  if (!sec) return;
  const h = sec.offsetHeight || 1;          // guard: hidden / zero-height section
  const local = clamp((scrollY + innerHeight * 0.55 - sec.offsetTop) / h, 0, 1);
  const off = mapLen * (1 - local);
  mapPath.style.strokeDashoffset = Number.isFinite(off) ? off.toFixed(1) : String(mapLen);
}
safe('route map', buildMap);

/* light up pins whose stop you've already driven past */
const stopEls = [...document.querySelectorAll('.stop')];
const pinEls  = [...document.querySelectorAll('.map-pin')];
const pinIO = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const i = stopEls.indexOf(e.target);
    const pin = pinEls[i];
    if (!pin) return;
    // style.fill, not the fill attribute: var() is unreliable in presentation attributes
    pin.querySelector('.dot').style.fill = 'var(--gold)';
    const lbl = pin.querySelector('text');
    if (lbl) { lbl.style.fill = 'var(--ink)'; lbl.style.fontWeight = '600'; }
  });
}, { threshold: 0.4 });
safe('pin highlights', () => stopEls.forEach(el => pinIO.observe(el)));

/* ───────────────────────────────────────────────────────────────
   5.  COUNTERS (the detour tally)
   ─────────────────────────────────────────────────────────────── */

const countIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    const end = +el.dataset.count;
    const dur = 1500;
    const t0 = performance.now();
    const step = (t) => {
      const k = clamp((t - t0) / dur, 0, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    countIO.unobserve(el);
  }
}, { threshold: 0.6 });
safe('counters', () => document.querySelectorAll('[data-count]').forEach(el => countIO.observe(el)));

/* ───────────────────────────────────────────────────────────────
   6.  TILT — photos lean toward the cursor
   ─────────────────────────────────────────────────────────────── */

function initTilt() {
  if (!matchMedia('(pointer: fine)').matches || REDUCED) return;
  document.querySelectorAll('[data-tilt]').forEach(el => {
    // an explicit base wins; otherwise infer from layout position
    const explicit = parseFloat(el.dataset.tiltBase);
    const base = Number.isFinite(explicit) ? explicit
      : el.classList.contains('shot')
        ? (el.matches('.grid-gallery .shot:nth-child(even)') ? 1.4 : -1.1)
        : (el.closest('.stop-flip') ? 1.9 : -1.6);

    el.style.transition = 'transform .55s cubic-bezier(.16,1,.3,1), box-shadow .55s cubic-bezier(.16,1,.3,1)';

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width  - 0.5;
      const dy = (e.clientY - r.top)  / r.height - 0.5;
      el.style.transform =
        `perspective(900px) rotateX(${(-dy * 6).toFixed(2)}deg) rotateY(${(dx * 6).toFixed(2)}deg) rotate(${base}deg) scale(1.03)`;
    });

    el.addEventListener('pointerleave', () => {
      el.style.transform = `rotate(${base}deg)`;
    });
  });
}

/* ───────────────────────────────────────────────────────────────
   7.  FLOATING HEARTS
   ─────────────────────────────────────────────────────────────── */

function initHearts() {
  const hearts = document.getElementById('hearts');
  if (!hearts || REDUCED) return;
  for (let i = 0; i < 14; i++) {
    const h = document.createElement('i');
    h.textContent = Math.random() < 0.34 ? '♥' : (Math.random() < 0.5 ? '✦' : '❥');
    h.style.left = rand(0, 100) + '%';
    h.style.fontSize = rand(9, 20).toFixed(1) + 'px';
    h.style.setProperty('--dx', rand(-110, 110).toFixed(0) + 'px');
    h.style.setProperty('--rot', rand(-80, 80).toFixed(0) + 'deg');
    h.style.animationDuration = rand(16, 30).toFixed(1) + 's';
    h.style.animationDelay = (-rand(0, 26)).toFixed(1) + 's';
    hearts.appendChild(h);
  }
}

/* ───────────────────────────────────────────────────────────────
   8.  THE ROAD SONG — generated, never downloaded
   ─────────────────────────────────────────────────────────────── */

const soundBtn = document.getElementById('soundBtn');
let ac = null, pad = null, chordTimer = null, playing = false;

const CHORDS = [
  [130.81, 164.81, 196.00, 246.94],   // Cmaj
  [ 87.31, 130.81, 174.61, 220.00],   // F
  [110.00, 130.81, 164.81, 220.00],   // Am
  [ 98.00, 123.47, 146.83, 196.00],   // G
];

function startSong() {
  ac = new (window.AudioContext || window.webkitAudioContext)();

  const master = ac.createGain();
  master.gain.setValueAtTime(0.0001, ac.currentTime);
  master.gain.exponentialRampToValueAtTime(0.085, ac.currentTime + 3);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  lp.Q.value = 0.5;

  // gentle echo
  const delay = ac.createDelay(1.5);
  delay.delayTime.value = 0.42;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const wet = ac.createGain(); wet.gain.value = 0.34;
  delay.connect(fb); fb.connect(delay);
  delay.connect(wet); wet.connect(master);

  const voices = [];
  CHORDS[0].forEach((f, i) => {
    for (let d = 0; d < 2; d++) {
      const o = ac.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * (d ? 1.004 : 0.996);
      const g = ac.createGain();
      g.gain.value = (i === 0 ? 0.30 : 0.16) / 2;
      // slow breathing so it never sits still
      const lfo = ac.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.05 + i * 0.017;
      const lfoAmt = ac.createGain();
      lfoAmt.gain.value = g.gain.value * 0.45;
      lfo.connect(lfoAmt); lfoAmt.connect(g.gain);

      o.connect(g); g.connect(lp);
      g.connect(master); g.connect(delay);
      o.start(); lfo.start();
      voices.push({ o, g });
    }
  });

  lp.connect(master);
  master.connect(ac.destination);

  pad = { master, voices };
  let idx = 0;
  const shift = () => {
    const next = CHORDS[(idx + 1) % CHORDS.length];
    const t = ac.currentTime;
    CHORDS[idx].forEach((f, i) => {
      voices.forEach((v, k) => {
        if (k % 4 !== i) return;
        v.o.frequency.cancelScheduledValues(t);
        v.o.frequency.setTargetAtTime(next[i] * (k > 3 ? 1.004 : 0.996), t, 1.1);
      });
    });
    idx = (idx + 1) % CHORDS.length;
  };
  chordTimer = setInterval(shift, 5200);

  playing = true;
  soundBtn.setAttribute('aria-pressed', 'true');
  soundBtn.querySelector('.sound-label').textContent = 'playing';
}

function stopSong() {
  if (!ac || !playing) return;
  playing = false;
  chordTimer && clearInterval(chordTimer);
  const t = ac.currentTime;
  pad.master.gain.cancelScheduledValues(t);
  pad.master.gain.setTargetAtTime(0.0001, t, 0.5);
  setTimeout(() => { try { ac.close(); } catch (_) {} }, 2200);
  ac = null;
  soundBtn.setAttribute('aria-pressed', 'false');
  soundBtn.querySelector('.sound-label').textContent = 'road song';
}

function onSoundClick() {
  if (playing) { stopSong(); return; }
  try { startSong(); }
  catch (_) {
    const l = soundBtn && soundBtn.querySelector('.sound-label');
    if (l) l.textContent = 'no audio';
  }
}

// pause the song if she switches tabs
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stopSong(); });

/* ───────────────────────────────────────────────────────────────
   9.  LOADER
   ─────────────────────────────────────────────────────────────── */

const loader = document.getElementById('loader');
const fill   = document.getElementById('loaderFill');

function drop() {
  loader.classList.add('done');
  setTimeout(() => loader.remove(), 1200);
}

function initLoader() {
  if (document.readyState === 'complete') { finish(); }
  else addEventListener('load', finish);

  // safety net: never leave her staring at a loading bar
  setTimeout(() => { if (loader && !loader.classList.contains('done')) drop(); }, 5200);
}

function finish() {
  let p = 0;
  const tick = () => {
    p = Math.min(100, p + rand(6, 19));
    fill.style.width = p + '%';
    if (p < 100) setTimeout(tick, rand(90, 200));
    else setTimeout(drop, 260);
  };
  setTimeout(tick, 180);
}

/* ───────────────────────────────────────────────────────────────
   10.  MISC
   ─────────────────────────────────────────────────────────────── */

/* ───────────────────────────────────────────────────────────────
   10.  VIDEO PLAYLIST — eight clips, one stage
   ─────────────────────────────────────────────────────────────── */

const CLIPS = [
  { src: 'videos/clip-01.mp4', cap: 'the one that started it' },
  { src: 'videos/clip-02.mp4', cap: 'you, mid-sentence' },
  { src: 'videos/clip-03.mp4', cap: 'still laughing about it' },
  { src: 'videos/clip-04.mp4', cap: 'the long one' },
  { src: 'videos/clip-05.mp4', cap: 'proof you were there' },
  { src: 'videos/clip-06.mp4', cap: 'the good part' },
  { src: 'videos/clip-07.mp4', cap: 'you, being ridiculous' },
  { src: 'videos/clip-08.mp4', cap: 'and then this' },
];

function initPlaylist() {
  const reel  = document.getElementById('reel');
  const stage = document.getElementById('reelStage');
  const cap   = document.getElementById('reelCap');
  const list  = document.getElementById('playlist');
  const note  = document.getElementById('videoNote');
  if (!reel || !list) return;

  // buttons are shown up front so the section is never an empty box
  const buttons = CLIPS.map((clip, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'clip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    b.innerHTML =
      `<span class="clip-ico">▶</span>` +
      `<span class="clip-n">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="clip-d" data-dur></span>`;
    list.appendChild(b);
    return b;
  });

  function select(i, autoplay) {
    const clip = CLIPS[i];
    if (!clip) return;

    if (reel.getAttribute('src') !== clip.src) {
      reel.setAttribute('src', clip.src);
      reel.load();
    }
    if (cap) cap.innerHTML = `Clip ${String(i + 1).padStart(2, '0')} &mdash; ${clip.cap}`;

    buttons.forEach((b, k) => b.setAttribute('aria-selected', k === i ? 'true' : 'false'));

    if (autoplay) {
      const p = reel.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});  // autoplay may be blocked
    }
  }

  buttons.forEach((b, i) => b.addEventListener('click', () => select(i, true)));

  // fill in each clip's duration once its header loads
  CLIPS.forEach((clip, i) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => {
      const slot = buttons[i].querySelector('[data-dur]');
      if (!slot || !isFinite(probe.duration)) return;
      const s = Math.round(probe.duration);
      slot.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      probe.removeAttribute('src');
      probe.load();
    }, { once: true });
    probe.addEventListener('error', () => { probe.removeAttribute('src'); }, { once: true });
    probe.src = clip.src;
  });

  // phone clips are vertical — give them a vertical frame
  function fitStage() {
    if (!stage) return;
    const portrait = reel.videoHeight > reel.videoWidth && reel.videoHeight > 0;
    stage.classList.toggle('is-portrait', portrait);
  }
  reel.addEventListener('loadedmetadata', fitStage);

  // don't shout over the rest of the page
  new IntersectionObserver((es) => es.forEach(e => {
    if (!e.isIntersecting && !reel.paused) reel.pause();
  }), { threshold: 0.3 }).observe(reel);

  select(0, false);
  if (note) note.hidden = true;
}

function initMisc() {
  onScroll();
  addEventListener('scroll', updateMap, { passive: true });

  // an empty slot should read as "intentionally waiting", not as a broken image
  document.querySelectorAll('.photo img').forEach(img => {
    const mark = () => {
      img.style.display = 'none';
      if (img.parentNode) img.parentNode.classList.add('empty');
    };
    img.addEventListener('error', mark);
    if (img.complete && img.naturalWidth === 0) mark();
  });

  // if every clip is missing, say so rather than showing a dead player
  const reel = document.getElementById('reel');
  const vNote = document.getElementById('videoNote');
  if (reel && vNote) {
    reel.addEventListener('error', () => { vNote.hidden = false; });
    setTimeout(() => {
      if (reel.networkState === 3 /* NETWORK_NO_SOURCE */ && !reel.currentSrc) vNote.hidden = false;
    }, 2000);
  }
}

/* ───────────────────────────────────────────────────────────────
   11.  BOOT — every feature is isolated, so one failure is survivable
   ─────────────────────────────────────────────────────────────── */

safe('reveals',       initReveals);
safe('playlist',      initPlaylist);
safe('hearts',       initHearts);
safe('photo tilt',   initTilt);
safe('sound toggle', () => { if (soundBtn) soundBtn.addEventListener('click', onSoundClick); });
safe('loader',       initLoader);
safe('misc',         initMisc);

})();
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
   1.  THE SCENE — a real 3D road, from dawn to midnight
   ─────────────────────────────────────────────────────────────── */

const cv  = document.getElementById('scene');
const ctx = cv.getContext('2d', { alpha: false });

let W = 0, H = 0, DPR = 1, horizonY = 0, focal = 1, cx = 0;

const CAM_H     = 1.62;   // eye height, metres
const ROAD_HALF = 4.5;    // half carriageway width, metres
const Z_NEAR    = 2.2;    // nearest drawn sample, metres
const Z_FAR     = 540;    // fog distance, metres
const SEG_MAX   = 116;    // cross-section samples (fewer on phones)
let   SEG       = SEG_MAX;

/* The road is a genuine world-space curve: it bends and it rolls over
   hills. Everything else is projected from it, so the whole scene stays
   consistent as you drive. */
function roadX(z) {
  return 8.2 * Math.sin(z * 0.00500)
       + 4.3 * Math.sin(z * 0.01280 + 1.7)
       + 2.0 * Math.sin(z * 0.02710 + 0.4);
}
function roadY(z) {
  return 2.9 * Math.sin(z * 0.00360 + 0.6)
       + 1.4 * Math.sin(z * 0.00940 + 2.4)
       + 0.5 * Math.sin(z * 0.02100 + 1.1);
}

let drive = 0;        // how far along the road we are, in metres
let camX = 0;         // camera lags the centreline — that's the steering
let camY = CAM_H;
let roll = 0;         // bank into the corners
let journey = 0;      // 0 → 1 across the page
let boost = 0;        // scroll-velocity kick
let mx = 0, my = 0;   // pointer parallax, −1 → 1

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
  };
}
const nightness = p => clamp((p - 0.70) / 0.24, 0, 1);
const duskness  = p => clamp((p - 0.52) / 0.24, 0, 1);

/* deterministic scenery ----------------------------------------- */
const hash = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

let STARS = [], CLOUDS = [], RIDGES = [];
(function buildScenery() {
  for (let i = 0; i < 190; i++) {
    STARS.push({ x: hash(i + 1), y: hash(i + 99) * 0.74, m: hash(i + 7) * 1.5 + 0.3, p: hash(i + 31) * 6.283 });
  }
  for (let i = 0; i < 12; i++) {
    const layer = i % 3;
    CLOUDS.push({
      x: hash(i + 200), layer,
      y: 0.07 + layer * 0.10 + hash(i + 300) * 0.05,
      s: (0.5 + hash(i + 400) * 0.9) * (1 + layer * 0.45),
      a: 0.09 + hash(i + 500) * 0.15,
      v: 0.0016 + hash(i + 600) * 0.004,
    });
  }
  for (let layer = 0; layer < 3; layer++) {
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      pts.push({
        x: i / 26,
        y: 0.34 + hash(i + layer * 41) * 0.30 - Math.sin(i * 1.1 + layer) * 0.10 + layer * 0.055,
      });
    }
    RIDGES.push({ pts, layer, par: 0.10 + layer * 0.17 });
  }
})();

/* sizing --------------------------------------------------------- */
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
  cx = W / 2;
  SEG = W < 760 ? 80 : SEG_MAX;
}
resize();
addEventListener('resize', resize, { passive: true });

/* projection ------------------------------------------------------ */
/* World point (X across, Z along, h above the road surface) → screen */
function proj(X, Z, h) {
  const dz = Z - drive;
  if (dz < 0.5) return null;
  const inv = focal / dz;
  return {
    x: cx + (X - camX) * inv + mx * 26,
    y: horizonY - (camY - roadY(Z) - h) * inv + my * 14,
    s: inv,
  };
}

/* ── the cross-section of road we are about to draw ─────────────── */
/* xs[] holds DISTANCE AHEAD of the camera, never an absolute position:
   `drive` grows forever, so an absolute frame would slide off the end
   of the world after half a minute and the road would vanish. */
let xs = new Float64Array(SEG + 1);
let pl = new Array(SEG + 1);
let pr = new Array(SEG + 1);
const absZ = i => drive + xs[i];

function buildSection() {
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    xs[i] = Z_NEAR + (Z_FAR - Z_NEAR) * Math.pow(t, 2.05);
    const Z = drive + xs[i];
    const centre = roadX(Z);
    pl[i] = proj(centre - ROAD_HALF, Z, 0.02);
    pr[i] = proj(centre + ROAD_HALF, Z, 0.02);
  }
}

/* ── sky, sun, stars, clouds ─────────────────────────────────── */

function drawSky(S, p) {
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, S.top);
  g.addColorStop(0.55, S.mid);
  g.addColorStop(1, S.low);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, horizonY + 1);

  const nk = nightness(p);
  if (nk > 0.001) {
    for (const st of STARS) {
      const tw = REDUCED ? 0.8 : 0.55 + 0.45 * Math.sin(Date.now() / 900 + st.p);
      ctx.globalAlpha = nk * tw;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(st.x * W + mx * 10, st.y * horizonY, st.m, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const travel = p / 0.92;
  const bx = lerp(0.10, 0.92, travel) * W + mx * 34;
  const arc = Math.sin(clamp(travel, 0, 1) * Math.PI);
  const by = horizonY - arc * H * 0.46;
  const R = lerp(46, 26, nk) * clamp(W / 1280, 0.62, 1.15);

  if (travel <= 1) {
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, R * 9);
    glow.addColorStop(0, rgba(S.sun, 0.55));
    glow.addColorStop(0.22, rgba(S.sun, 0.18));
    glow.addColorStop(1, rgba(S.sun, 0));
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
    const cx2 = drift * W;
    const cy = c.y * horizonY;
    const w = 150 * c.s;
    const h = w * 0.30;
    ctx.globalAlpha = c.a * (1 - nightness(p) * 0.62) * (0.6 + c.layer * 0.25);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(cx2, cy, w, h, 0, 0, 7);
    ctx.ellipse(cx2 - w * 0.42, cy + h * 0.35, w * 0.58, h * 0.66, 0, 0, 7);
    ctx.ellipse(cx2 + w * 0.44, cy + h * 0.30, w * 0.62, h * 0.72, 0, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ── distant hills, fixed on the horizon ───────────────────────── */

function drawRidges(S, p) {
  const nk = nightness(p), dk = duskness(p);
  const col = mixc(S.gnd, S.low, 0.22);

  for (const rg of RIDGES) {
    const off = (-journey * rg.par * 2.4 - mx * 0.02) % 1;
    ctx.fillStyle = mixc(col, [8, 5, 18], nk * 0.45 + rg.layer * 0.10);
    ctx.beginPath();
    ctx.moveTo(-W * 0.3, horizonY + 2);
    for (let i = 0; i <= rg.pts.length; i++) {
      const pt = rg.pts[i % rg.pts.length];
      let x = pt.x + off;
      x = ((x % 1) + 1) % 1;
      ctx.lineTo(-W * 0.3 + x * W * 1.6, horizonY - pt.y * H * 0.20 - rg.layer * 3);
    }
    ctx.lineTo(W * 1.3, horizonY + 2);
    ctx.closePath();
    ctx.fill();
  }
  if (dk > 0.01) {
    const hz = ctx.createLinearGradient(0, horizonY - H * 0.14, 0, horizonY + 4);
    hz.addColorStop(0, rgba(S.low, 0));
    hz.addColorStop(1, rgba(S.low, 0.34 * dk));
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizonY - H * 0.14, W, H * 0.14 + 6);
  }
}

/* ── terrain: follows the hills, so crests actually hide things ── */

function drawTerrain(S) {
  const g = ctx.createLinearGradient(0, horizonY - H * 0.1, 0, H);
  g.addColorStop(0, mixc(S.gnd, S.low, 0.34));
  g.addColorStop(0.35, S.gnd);
  g.addColorStop(1, mixc(S.gnd, [0, 0, 0], 0.62));
  ctx.fillStyle = g;

  ctx.beginPath();
  let started = false;
  for (let i = SEG; i >= 0; i--) {                     // far → near, left
    const Z = absZ(i);
    const q = proj(roadX(Z) - 520, Z, 0);
    if (!q) continue;
    if (!started) { ctx.moveTo(q.x, q.y); started = true; } else ctx.lineTo(q.x, q.y);
  }
  for (let i = 0; i <= SEG; i++) {                      // near → far, right
    const Z = absZ(i);
    const q = proj(roadX(Z) + 520, Z, 0);
    if (!q) continue;
    ctx.lineTo(q.x, q.y);
  }
  ctx.closePath();
  ctx.fill();
}

/* ── the road surface ─────────────────────────────────────────── */

function poly(a, b, fill) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  for (let i = 1; i < a.length; i++) ctx.lineTo(a[i][0], a[i][1]);
  for (let i = b.length - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function band(i, off0, off1, h, fill) {
  const za = absZ(i), zb = absZ(i + 1);
  const ca = roadX(za), cb = roadX(zb);
  const A = proj(ca + off0, za, h), B = proj(ca + off1, za, h);
  const C = proj(cb + off1, zb, h), D = proj(cb + off0, zb, h);
  if (!A || !B || !C || !D) return false;
  ctx.beginPath();
  ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(C.x, C.y); ctx.lineTo(D.x, D.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  return true;
}

function drawRoad(S, p) {
  const nk = nightness(p);
  const far  = mixc(mixc(S.gnd, [0, 0, 0], 0.55), S.low, 0.26);
  const near = mixc([24, 20, 32], [44, 36, 52], 0.45);

  // tarmac
  const L = [], R = [];
  for (let i = 0; i <= SEG; i++) {
    const qa = pl[i], qb = pr[i];
    if (!qa || !qb) continue;
    L.push([qa.x, qa.y]);
    R.push([qb.x, qb.y]);
  }
  if (L.length > 2) poly(L, R, far);
  if (L.length > 2) {
    const nearFog = clamp(xs[6] / 90, 0, 1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
    ctx.clip();
    const nearG = ctx.createLinearGradient(0, H, 0, horizonY);
    nearG.addColorStop(0, rgba(near, 0.95 * nearFog));
    nearG.addColorStop(1, rgba(near, 0));
    ctx.fillStyle = nearG;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // markings, far → near so nearer ones overlap
  for (let i = SEG - 1; i >= 0; i--) {
    const dz = xs[i];
    if (dz > 230) continue;
    // a segment thinner than a pixel adds cost, not detail
    const a = pl[i], b = pl[i + 1];
    if (a && b && Math.abs(a.y - b.y) < 0.45) continue;
    const fog = clamp(dz / 230, 0, 1);
    const alpha = clamp(1 - dz / 230, 0.12, 1);
    void fog;

    // rumble strips — alternating, and they give the road its speed
    const rum = (i & 1) ? '#e8695f' : '#f4ece0';
    band(i, -ROAD_HALF - 0.55, -ROAD_HALF + 0.18, 0.035, mixc(hex2rgb(rum), S.low, (1 - alpha) * 0.8));
    band(i,  ROAD_HALF - 0.18,  ROAD_HALF + 0.55, 0.035, mixc(hex2rgb(rum), S.low, (1 - alpha) * 0.8));

    // continuous edge lines
    const edge = mixc(mixc(S.low, [255, 246, 226], 0.5), S.low, (1 - alpha) * 0.85);
    band(i, -ROAD_HALF + 0.20, -ROAD_HALF + 0.42, 0.04, edge);
    band(i,  ROAD_HALF - 0.42,  ROAD_HALF - 0.20, 0.04, edge);

    // centre dashes
    if ((i & 1) === 0) {
      const dash = mixc(mixc(S.low, [255, 250, 240], 0.45), S.low, (1 - alpha) * 0.85);
      band(i, -0.17, 0.17, 0.045, dash);
    }
  }

  // wet tarmac catching the tail lights after dark
  if (nk > 0.05) {
    const refl = ctx.createLinearGradient(0, H, 0, H * 0.72);
    refl.addColorStop(0, `rgba(255,110,130,${0.16 * nk})`);
    refl.addColorStop(1, 'rgba(255,110,130,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(cx - W * 0.34, H * 0.72, W * 0.68, H * 0.28);
  }
}

/* ── roadside: trees, poles, bushes — fixed in world space ─────── */

const PROP_SP = 21;

function drawProps(S, p) {
  const trunk = mixc(S.gnd, [0, 0, 0], 0.62);
  const leaf  = mixc(S.gnd, [0, 0, 0], 0.44);
  const lamps = p > 0.72 ? 0.9 : 0.25;

  const i0 = Math.floor((drive + Z_NEAR) / PROP_SP);
  const i1 = Math.ceil((drive + 360) / PROP_SP);

  for (let i = i0; i <= i1; i++) {
    for (let s = -1; s <= 1; s += 2) {
      const Z = i * PROP_SP + hash(i * 7 + (s > 0 ? 3 : 9)) * PROP_SP;
      const dz = Z - drive;
      if (dz < Z_NEAR || dz > 340) continue;

      const rnd = hash(i * 13 + s * 29);
      const kind = rnd < 0.55 ? 'tree' : (rnd < 0.85 ? 'bush' : 'pole');
      const X = roadX(Z) + s * (ROAD_HALF + 2.6 + hash(i + s * 17) * 11);
      const g0 = proj(X, Z, 0);
      if (!g0 || g0.y < horizonY - 2 || g0.y > H + 60) continue;

      const fog = clamp(1 - dz / 340, 0, 1) ** 1.5;
      ctx.globalAlpha = 0.3 + fog * 0.7;

      if (kind === 'tree') {
        const h = 4.4 + hash(i * 3 + s) * 3.6;
        const top = proj(X, Z, h);
        if (!top) { ctx.globalAlpha = 1; continue; }
        const halfW = (1.05 + hash(i * 5) * 0.75) * g0.s;
        ctx.fillStyle = leaf;
        ctx.beginPath();
        ctx.moveTo(g0.x - halfW, g0.y);
        ctx.lineTo(top.x, top.y);
        ctx.lineTo(g0.x + halfW, g0.y);
        ctx.closePath();
        ctx.fill();
        const trunkTop = proj(X, Z, 1.2);
        if (trunkTop) {
          ctx.fillStyle = trunk;
          ctx.fillRect(g0.x - halfW * 0.10, trunkTop.y, Math.max(0.7, halfW * 0.20), g0.y - trunkTop.y);
        }
      } else if (kind === 'bush') {
        const r = (1.1 + hash(i * 11) * 0.9) * g0.s;
        ctx.fillStyle = leaf;
        ctx.beginPath();
        ctx.ellipse(g0.x, g0.y - r * 0.35, r, r * 0.68, 0, 0, 7);
        ctx.fill();
      } else {
        const h = 5.8;
        const top = proj(X, Z, h);
        if (!top) { ctx.globalAlpha = 1; continue; }
        ctx.strokeStyle = trunk;
        ctx.lineWidth = Math.max(0.8, 0.16 * g0.s);
        ctx.beginPath();
        ctx.moveTo(g0.x, g0.y);
        ctx.lineTo(top.x, top.y);
        const armY = top.y + 0.6 * g0.s * 5;
        const armW = 0.75 * g0.s;
        ctx.lineTo(top.x + armW, armY);
        ctx.moveTo(top.x - armW, armY);
        ctx.stroke();
        if (lamps > 0.35) {
          const gl = ctx.createRadialGradient(top.x, armY, 0, top.x, armY, Math.max(2, armW * 3.4));
          gl.addColorStop(0, rgba([255, 214, 150], 0.8 * fog));
          gl.addColorStop(1, rgba([255, 214, 150], 0));
          ctx.fillStyle = gl;
          ctx.fillRect(top.x - armW * 3.4, armY - armW * 3.4, armW * 6.8, armW * 6.8);

          // motion blur: a streak radiating from the vanishing point, which is
          // exactly how a passing light smears in a real photograph
          const smear = clamp((speedNow * 1.6) / Math.max(dz, 1), 0, 1) * fog;
          if (smear > 0.02) {
            const vx = top.x - cx, vy = armY - horizonY;
            const len = Math.hypot(vx, vy) * smear * 0.5;
            const sx = top.x - vx * smear * 0.5, sy = armY - vy * smear * 0.5;
            const lg = ctx.createLinearGradient(sx, sy, top.x, armY);
            lg.addColorStop(0, rgba([255, 220, 160], 0));
            lg.addColorStop(1, rgba([255, 230, 180], 0.65 * smear));
            ctx.strokeStyle = lg;
            ctx.lineWidth = Math.max(1, armW * 0.55);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(top.x, armY);
            ctx.stroke();
            void len;
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* ── the car, banking into the corners ────────────────────────── */

/* arrival: the whole page is a drive, so the drive has to end.
   0 → still driving, 1 → stopped, parked, brake lights on. */
let arrival = 0;
let speedNow = 16;

/* Paint the car. Called twice: upright on the road, and mirrored onto the
   tarmac so she sees it reflected in the surface. */
function paintCar(S, p, alpha, flip) {
  const w = clamp(W * 0.26, 130, 250);
  const bob = REDUCED ? 0 : Math.sin(Date.now() / 90) * (1.1 + boost * 5);
  const bank = roll * 0.55;
  const bx = cx + mx * 8;
  const baseY = H + w * 0.10 + bob;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip) {
    // mirror about the tarmac line, then squash so it reads as a reflection
    ctx.translate(0, baseY * 2 + 6);
    ctx.scale(1, -0.62);
  }
  ctx.translate(bx, baseY);
  ctx.rotate(bank);
  ctx.translate(-bx, -baseY);

  const bodyTop = baseY - w * 0.46;
  const cabinTop = bodyTop - w * 0.42;

  if (!flip) {
    // headlight wash down the road ahead
    const wash = ctx.createRadialGradient(bx, bodyTop, 0, bx, bodyTop, w * 1.9);
    wash.addColorStop(0, `rgba(255,228,196,${0.09 + nightness(p) * 0.17})`);
    wash.addColorStop(1, 'rgba(255,228,196,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(bx - w * 1.9, bodyTop - w * 1.9, w * 3.8, w * 3.8);

    // volumetric beams, narrowing as we come to a stop
    const beam = ctx.createLinearGradient(0, bodyTop, 0, horizonY);
    beam.addColorStop(0, `rgba(255,232,200,${(0.10 + nightness(p) * 0.16) * (1 + arrival * 0.5)})`);
    beam.addColorStop(1, 'rgba(255,232,200,0)');
    ctx.fillStyle = beam;
    const spread = 1.25 + arrival * 0.5;
    ctx.beginPath();
    ctx.moveTo(bx - w * 0.30, bodyTop);
    ctx.lineTo(bx + w * 0.30, bodyTop);
    ctx.lineTo(bx + w * spread, horizonY + 6);
    ctx.lineTo(bx - w * spread, horizonY + 6);
    ctx.closePath();
    ctx.fill();
  }

  const body = mixc([44, 34, 58], S.low, 0.10);
  const r = w * 0.09;

  ctx.fillStyle = mixc(body, [0, 0, 0], 0.18);
  ctx.beginPath();
  ctx.roundRect(bx - w * 0.345, cabinTop, w * 0.69, w * 0.50, [w * 0.16, w * 0.16, w * 0.05, w * 0.05]);
  ctx.fill();

  const glass = ctx.createLinearGradient(0, cabinTop, 0, cabinTop + w * 0.34);
  glass.addColorStop(0, mixc(S.mid, [255, 255, 255], 0.22));
  glass.addColorStop(1, mixc([18, 12, 30], [60, 45, 80], 0.5));
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.roundRect(bx - w * 0.28, cabinTop + w * 0.055, w * 0.56, w * 0.335, w * 0.09);
  ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.roundRect(bx - w / 2, bodyTop, w, w * 0.52, [r, r, w * 0.05, w * 0.05]);
  ctx.fill();

  ctx.fillStyle = rgba(mixc(body, [255, 255, 255], 0.5), 0.30);
  ctx.beginPath();
  ctx.roundRect(bx - w / 2, bodyTop, w, w * 0.045, [r, r, 0, 0]);
  ctx.fill();

  // tail lights — they bloom red and throw light onto the road when braking
  const braking = arrival * arrival;
  const tail = braking > 0.02 ? `255,${Math.round(60 - braking * 45)},${Math.round(80 - braking * 60)}` : '255,110,130';
  const tw = w * 0.155, th = w * 0.105;
  for (const s of [-1, 1]) {
    const lx = bx + s * (w / 2 - tw - w * 0.055);
    const ly = bodyTop + w * 0.085;
    const glow = tw * (2.4 + braking * 2.6);
    const g = ctx.createRadialGradient(lx + tw / 2, ly + th / 2, 0, lx + tw / 2, ly + th / 2, glow);
    g.addColorStop(0, `rgba(${tail},${0.85 + braking * 0.15})`);
    g.addColorStop(1, `rgba(${tail},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(lx - glow, ly - glow, glow * 2, glow * 2);
    ctx.fillStyle = `rgb(${tail})`;
    ctx.beginPath();
    ctx.roundRect(lx, ly, tw, th, th * 0.45);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,240,.75)';
    ctx.beginPath();
    ctx.roundRect(lx + tw * 0.12, ly + th * 0.16, tw * 0.76, th * 0.3, th * 0.15);
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(20,14,30,.72)';
  ctx.beginPath();
  ctx.roundRect(bx - w * 0.10, bodyTop + w * 0.255, w * 0.20, w * 0.075, w * 0.012);
  ctx.fill();
  ctx.fillStyle = `rgba(255,215,154,${0.85 + braking * 0.15})`;
  ctx.font = `500 ${Math.max(7, w * 0.052)}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('♥ 2US', bx, bodyTop + w * 0.294);

  ctx.fillStyle = rgba([0, 0, 0], 0.28);
  ctx.beginPath();
  ctx.roundRect(bx - w * 0.44, bodyTop + w * 0.40, w * 0.88, w * 0.055, w * 0.02);
  ctx.fill();

  ctx.restore();
}

function drawCar(S, p) {
  // reflection first — it lives on the tarmac, under the car
  const wet = clamp(nightness(p) * 0.8 + arrival * 0.35, 0, 1);
  if (wet > 0.04 && !REDUCED) {
    paintCar(S, p, 0.20 * wet, true);
    const fade = ctx.createLinearGradient(0, H, 0, H * 0.80);
    fade.addColorStop(0, `rgba(0,0,0,${0.5 * wet})`);
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(cx - W * 0.3, H * 0.80, W * 0.6, H * 0.2);
  }
  paintCar(S, p, 1, false);
}

/* ── night: bugs and dust in the headlights ──────────────────── */

const MOTES = Array.from({ length: 34 }, (_, i) => ({
  x: hash(i * 3 + 1), y: hash(i * 7 + 2), s: hash(i * 11 + 3), p: hash(i * 13 + 4) * 6.283,
}));

function drawMotes(p) {
  const nk = nightness(p) * (1 - arrival * 0.6);
  if (nk < 0.04 || REDUCED) return;
  const t = Date.now() / 1000;
  ctx.globalCompositeOperation = 'lighter';
  for (const m of MOTES) {
    const x = (m.x + Math.sin(t * 0.35 + m.p) * 0.06) * W;
    const y = (m.y + Math.cos(t * 0.27 + m.p) * 0.05) * H;
    const r = (0.7 + m.s * 2.1) * (1 + nk * 0.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    g.addColorStop(0, `rgba(255,236,200,${0.30 * nk})`);
    g.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r * 3.2, y - r * 3.2, r * 6.4, r * 6.4);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ── one frame ───────────────────────────────────────────────── */

function render(dt) {
  // arrival ramps over the last few percent of the page
  const wantArrival = smooth(clamp((journey - 0.90) / 0.085, 0, 1));
  arrival += (wantArrival - arrival) * Math.min(1, dt * 1.6);

  // steering: the camera chases the centreline, and banks into the bend
  const lead = 46;
  camX += (roadX(drive + lead) - camX) * Math.min(1, dt * 2.1);
  camY += (CAM_H + roadY(drive) * 0.85 - camY) * Math.min(1, dt * 1.8);

  const curvature = (roadX(drive + 55) - roadX(drive - 15)) / 70;
  const targetRoll = clamp(-curvature * 0.30, -0.13, 0.13);
  roll += (targetRoll - roll) * Math.min(1, dt * 2.6);

  const S = sky(journey);
  buildSection();

  drawSky(S, journey);
  drawClouds(journey);
  drawRidges(S, journey);

  // bank the world but not the sky — that's what makes it feel like driving
  ctx.save();
  ctx.translate(cx, horizonY);
  ctx.rotate(roll);
  ctx.translate(-cx, -horizonY);
  drawTerrain(S);
  drawProps(S, journey);
  drawRoad(S, journey);
  ctx.restore();

  drawCar(S, journey);
  drawMotes(journey);

  // speed rush at the edges when she scrolls hard
  if (boost > 0.35 && !REDUCED) {
    const a = Math.min(0.5, boost * 0.16);
    const g = ctx.createRadialGradient(cx, H * 0.62, H * 0.22, cx, H * 0.62, H * 0.92);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,235,220,${a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
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

  // odometer — the page is a drive, so show the distance covered
  const odo = document.getElementById('odoNow');
  const odoBox = document.querySelector('.odo');
  if (odo) odo.textContent = String(Math.round(drive / 10)).padStart(3, '0');
  if (odoBox) odoBox.classList.toggle('stopped', arrival > 0.5);
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });

let prevT = performance.now();
function frame(now) {
  const dt = Math.min((now - prevT) / 1000, 0.05);
  prevT = now;

  // the world keeps rolling on its own; scrolling pushes it harder —
  // then it slows to a stop as she reaches the end of the journey
  const coast = 1 - arrival;
  const speed = (16 + boost * 30) * (0.06 + 0.94 * coast);
  speedNow = speed;
  drive += speed * dt;
  boost = Math.max(0, boost - dt * 1.9);

  updateChapters();
  updateDepth();
  render(dt);
  requestAnimationFrame(frame);
}

/* Reduced motion: one still frame, and the page goes back to plain
   top-to-bottom scrolling — a pinned 3D runway would trap the content. */
if (REDUCED) {
  body.classList.add('reduced');
  updateDepth();
  render(0.016);
}
else requestAnimationFrame(frame);

/* ── pointer parallax: lean the world toward the cursor ───────── */
function initPointer() {
  if (REDUCED || !matchMedia('(pointer: fine)').matches) return;
  addEventListener('pointermove', (e) => {
    mx = (e.clientX / innerWidth - 0.5) * 2;
    my = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });
  addEventListener('pointerleave', () => { mx = 0; my = 0; }, { passive: true });
}
safe('pointer parallax', initPointer);

/* ───────────────────────────────────────────────────────────────
   2b.  THE RUNWAY — scroll is the throttle, the camera moves forward
   ───────────────────────────────────────────────────────────────
   Scrolling doesn't scroll a page; it drives us down the road. Each
   chapter is pinned and flies out of the distance, up to the camera,
   and past it — so she drives through her own story.               */

const STAGE_SEL = '.hero-inner, .section > .wrap, .stop > .wrap';

let chapters = [];

function cacheChapters() {
  chapters = [];
  document.querySelectorAll(STAGE_SEL).forEach(stage => {
    const host = stage.parentElement;
    if (!host) return;
    let top = 0, p = host;
    while (p) { top += p.offsetTop; p = p.offsetParent; }
    chapters.push({ host, stage, top, h: host.offsetHeight || 1, lastZ: null });
  });
}

function updateChapters() {
  if (!chapters.length) return;
  const vh = innerHeight;
  const lastIdx = chapters.length - 1;

  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];

    // how far she is through this chapter, 0 → 1
    const span = Math.max(1, c.h - vh);
    const p = clamp((scrollY - c.top) / span, 0, 1);

    // The landing page can't fly in from somewhere — there is no scroll
    // above it — so the first chapter starts at the camera and drifts past.
    const isFirst = i === 0;

    // everything else arrives out of the distance, reaches us, goes past
    const z = isFirst ? lerp(0, -180, p) : lerp(1500, -180, p);

    // a touch of roll so it reads as motion, not as a slideshow
    const tilt = lerp(5.5, -2.0, p);
    const lift = lerp(-2.2, 1.2, p);

    // Fade IN only. Fading out would blank the screen: the chapter keeps
    // scrolling up and off after its run ends, and that exit should be seen.
    const vis = isFirst ? 1 : clamp((p - 0.005) / 0.14, 0, 1);

    // always write the transform: 12 writes a frame is nothing, and it stops
    // a chapter scrolling back out of view from keeping a stale position
    c.stage.style.transform =
      `translate3d(0, ${lift.toFixed(2)}%, ${z.toFixed(1)}px) rotateX(${tilt.toFixed(2)}deg)`;
    c.stage.style.opacity = vis.toFixed(3);

    // Stop invisible panels from swallowing clicks — but the final chapter
    // never leaves, so its links and buttons must stay live at p = 1.
    const live = p > 0.02 && (i === lastIdx || p < 0.995);
    if (c.live !== live) {
      c.live = live;
      c.stage.style.pointerEvents = live ? '' : 'none';
    }
  }
}
/* ───────────────────────────────────────────────────────────────
   3.  3D DEPTH — every block rises and tilts as it crosses the screen
   ─────────────────────────────────────────────────────────────── */

let depthItems = [];

function cacheDepth() {
  depthItems = [];
  document.querySelectorAll('.reveal').forEach(el => {
    let top = 0, p = el;
    while (p) { top += p.offsetTop; p = p.offsetParent; }
    depthItems.push({ el, mid: top + el.offsetHeight / 2, done: false });
  });
}

function updateDepth() {
  if (!depthItems.length) return;
  const mid = scrollY + innerHeight * 0.5;
  const span = innerHeight * 0.82;
  for (const it of depthItems) {
    const k = (it.mid - mid) / span;
    if (k < -1.35 || k > 1.35) continue;
    const kk = clamp(k, -1, 1);
    it.el.style.setProperty('--dy', (kk * 34).toFixed(1) + 'px');
    it.el.style.setProperty('--dr', (kk * -9).toFixed(2) + 'deg');
    it.el.style.setProperty('--dz', (kk * 60).toFixed(1) + 'px');
  }
}

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
  cacheDepth();
  cacheChapters();
  updateChapters();
  addEventListener('resize', () => { cacheDepth(); cacheChapters(); }, { passive: true });
  // the cache is layout-dependent, so refresh once fonts/images settle
  addEventListener('load', () => { cacheDepth(); cacheChapters(); }, { once: true });
  // images decoding late change the height of their chapter
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { cacheDepth(); cacheChapters(); }).catch(() => {});
  }
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
      // compose with the scroll-depth vars instead of replacing them
      el.style.transform =
        `translate3d(0, var(--dy,0px), var(--dz,0px)) ` +
        `rotateX(${(-dy * 7).toFixed(2)}deg) rotateY(${(dx * 8).toFixed(2)}deg) ` +
        `rotate(${base}deg) translateZ(30px) scale(1.035)`;
    });

    el.addEventListener('pointerleave', () => {
      el.style.transform =
        `translate3d(0, var(--dy,0px), var(--dz,0px)) rotate(${base}deg)`;
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

/* ───────────────────────────────────────────────────────────────
   9b.  THE ENVELOPE — she opens it herself
   ─────────────────────────────────────────────────────────────── */

function initEnvelope() {
  const env  = document.getElementById('envelope');
  const btn  = document.getElementById('envelopeBtn');
  const body = document.getElementById('letterBody');
  if (!env || !btn || !body) return;

  let opened = false;
  btn.addEventListener('click', () => {
    opened = !opened;
    env.classList.toggle('opened', opened);
    btn.setAttribute('aria-expanded', opened ? 'true' : 'false');

    if (opened) {
      body.hidden = false;
      // let the flap start turning before the letter rises out of it
      setTimeout(() => {
        body.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
        // the reveal observer only fires once; re-arm for the new content
        body.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
      }, 420);
    } else {
      body.hidden = true;
    }
  });
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
safe('envelope',      initEnvelope);
safe('playlist',      initPlaylist);
safe('hearts',       initHearts);
safe('photo tilt',   initTilt);
safe('sound toggle', () => { if (soundBtn) soundBtn.addEventListener('click', onSoundClick); });
safe('loader',       initLoader);
safe('misc',         initMisc);

})();
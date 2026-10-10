// Runtime smoke test: boots the real index.html + script.js in jsdom,
// stubbing canvas, rAF, IntersectionObserver and AudioContext.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = '/home/user/sTx-Agent/love-site';
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const js   = fs.readFileSync(path.join(SITE, 'script.js'), 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = e.stack || e.message;
  // environment limits, not site bugs: sandboxed font CDN + jsdom has no media stack
  if (/fonts\.(googleapis|gstatic)\.com/.test(m)) return;
  if (/HTMLMediaElement|Not implemented/.test(m)) return;
  errors.push('jsdomError: ' + m);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => errors.push('WARN: ' + a.join(' ')));
vc.on('log', () => {});

// ---- SVG geometry stub: real sampling of the path so map logic is exercised ----
const lerpN = (a, b, t) => a + (b - a) * t;
function pathPoints(el) {
  const d = el.getAttribute('d') || '';
  const nums = (d.match(/-?\d*\.?\d+/g) || []).map(Number);
  const cmds = d.match(/[MLCSQTAZmlcsqtaz]/g) || [];
  // naive but adequate: flatten numbers into an (x,y) polyline in document order
  const pts = [];
  let i = 0, cur = { x: 0, y: 0 }, startPt = { x: 0, y: 0 }, lastCtrl = null;
  for (let ci = 0; ci < cmds.length && i + 1 < nums.length; ci++) {
    const c = cmds[ci].toUpperCase();
    if (c === 'M' || c === 'L') {
      cur = { x: nums[i], y: nums[i + 1] }; i += 2;
      pts.push(cur);
      if (c === 'M') startPt = { ...cur };
    } else if (c === 'S') {
      // smooth cubic: reflect previous control
      const c1 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : { ...cur };
      const p1 = { x: nums[i], y: nums[i + 1] };
      const p2 = { x: nums[i + 2], y: nums[i + 3] };
      const steps = 24;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, mt = 1 - t;
        pts.push({
          x: mt*mt*mt*cur.x + 3*mt*mt*t*c1.x + 3*mt*t*t*p1.x + t*t*t*p2.x,
          y: mt*mt*mt*cur.y + 3*mt*mt*t*c1.y + 3*mt*t*t*p1.y + t*t*t*p2.y,
        });
      }
      lastCtrl = p1; cur = p2; i += 4;
    } else if (c === 'C') {
      const p1 = { x: nums[i], y: nums[i + 1] };
      const p2 = { x: nums[i + 2], y: nums[i + 3] };
      const p3 = { x: nums[i + 4], y: nums[i + 5] };
      const steps = 24;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, mt = 1 - t;
        pts.push({
          x: mt*mt*mt*cur.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
          y: mt*mt*mt*cur.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
        });
      }
      lastCtrl = p2; cur = p3; i += 6;
    } else { i += 2; }
  }
  const cum = [0];
  for (let k = 1; k < pts.length; k++) {
    cum[k] = cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  }
  void startPt;
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

// ---- canvas stub: records calls, validates numeric args ----
const ctxCalls = { total: 0, bad: 0 };
function makeCtx() {
  const grad = { addColorStop: (o, c) => {
    if (!Number.isFinite(o) || typeof c !== 'string') { ctxCalls.bad++; }
  } };
  const handler = {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'canvas') return { width: 1440, height: 900 };
      if (k in t) return t[k];
      return typeof k === 'string' && /^(font|textAlign|textBaseline|globalAlpha|lineWidth|globalCompositeOperation)$/.test(k)
        ? t[k] : (...args) => {
            ctxCalls.total++;
            for (const a of args) {
              if (typeof a === 'number' && !Number.isFinite(a)) ctxCalls.bad++;
              if (a && typeof a === 'object' && a.__isGrad) {
                for (const v of [a.x0, a.y0, a.x1, a.y1]) if (v !== undefined && !Number.isFinite(v)) ctxCalls.bad++;
              }
            }
          };
    },
    set(t, k, v) {
      if ((k === 'globalAlpha' || k === 'lineWidth') && (typeof v !== 'number' || !Number.isFinite(v))) ctxCalls.bad++;
      t[k] = v; return true;
    },
  };
  return new Proxy({ __isGrad: false }, handler);
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'http://127.0.0.1:4173/',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = () => makeCtx();
    window.Element.prototype.getTotalLength = function () {
      return pathPoints(this).total;
    };
    window.Element.prototype.getPointAtLength = function (L) {
      const { pts, cum, total } = pathPoints(this);
      const target = Math.max(0, Math.min(total, L));
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const seg = (cum[i] - cum[i - 1]) || 1;
      const t = (target - cum[i - 1]) / seg;
      return {
        x: lerpN(pts[i - 1].x, pts[i].x, t),
        y: lerpN(pts[i - 1].y, pts[i].y, t),
      };
    };
    window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
    window.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
      unobserve() {} disconnect() {}
    };
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.cancelAnimationFrame = () => {};
    window.AudioContext = function () {
      return {
        currentTime: 0, state: 'running',
        createGain: () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {} }),
        createBiquadFilter: () => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} }),
        createDelay: () => ({ delayTime: { value: 0 }, connect() {} }),
        createOscillator: () => ({ type: '', frequency: { value: 0, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {}, start() {} }),
        createDynamicsCompressor: () => ({ connect() {} }),
        destination: {},
        close() {},
      };
    };
    window.setTimeout = (fn, ms) => (ms > 4000 ? 0 : setTimeout(fn, 0)); // skip the 5.2s loader safety net
    window.scrollTo = () => {};
  },
});

const w = dom.window, d = w.document;

// let module init settle
setTimeout(async () => {
  const results = [];

  // 1. loader behaviour
  const loaderGone = !d.getElementById('loader') || d.getElementById('loader').classList.contains('done');
  results.push(['loader dismisses', loaderGone]);

  // 2. reveals activated
  const revealed = d.querySelectorAll('.reveal.in').length;
  results.push(['reveals activated (' + revealed + '/' + d.querySelectorAll('.reveal').length + ')', revealed > 0]);

  // 3. map pins generated
  const pins = d.querySelectorAll('.map-pin').length;
  results.push(['map pins built (' + pins + ')', pins === 5]);

  // 4. route path gets its ink length and inks in as you scroll
  const mp = d.getElementById('mapPath');
  const route = d.getElementById('route');
  // jsdom has no layout: give the section believable dimensions
  Object.defineProperty(route, 'offsetHeight', { value: 800, configurable: true });
  Object.defineProperty(route, 'offsetTop', { value: 0, configurable: true });

  const hasLen = !!(mp && /\d/.test(mp.style.strokeDasharray || ''));
  const len = mp ? parseFloat(mp.style.strokeDasharray) : 0;
  results.push(['route path ink-length set (' + len.toFixed(0) + 'px)', hasLen && len > 100]);

  Object.defineProperty(w, 'scrollY', { value: 0, configurable: true, writable: true });
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise(r => setTimeout(r, 30));
  const atTop = parseFloat(mp.style.strokeDashoffset);

  Object.defineProperty(w, 'scrollY', { value: 900, configurable: true, writable: true });
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise(r => setTimeout(r, 30));
  const further = parseFloat(mp.style.strokeDashoffset);

  results.push(['route inks in on scroll (' + atTop.toFixed(0) + 'px -> ' + further.toFixed(0) + 'px)',
                atTop > further && atTop <= len && further >= 0]);

  // 5. counters counted up
  const tally = [...d.querySelectorAll('[data-count]')].map(e => e.textContent);
  results.push(['counters ran (' + tally.join(',') + ')', tally.every(t => +t > 0)]);

  // 6. hearts spawned
  results.push(['hearts spawned (' + d.querySelectorAll('.hearts i').length + ')', d.querySelectorAll('.hearts i').length > 0]);

  // 7. audio wiring
  try {
    const b = d.getElementById('soundBtn');
    b.click();
    results.push(['sound toggles on', b.getAttribute('aria-pressed') === 'true']);
    b.click();
    results.push(['sound toggles off', b.getAttribute('aria-pressed') === 'false']);
  } catch (e) { errors.push('audio: ' + e.message); }

  // 8. canvas numeric sanity after frames
  results.push(['canvas numeric args valid (' + ctxCalls.bad + ' bad)', ctxCalls.bad === 0]);

  // 8b. sweep the whole day cycle: no NaN may reach the canvas at any progress
  const badBefore = ctxCalls.bad, totalBefore = ctxCalls.total;
  for (const y of [0, 0.12, 0.25, 0.4, 0.5, 0.62, 0.75, 0.88, 1]) {
    Object.defineProperty(w, 'scrollY', { value: y * 10000, configurable: true, writable: true });
    w.dispatchEvent(new w.Event('scroll'));
    await new Promise(r => setTimeout(r, 25));
  }
  results.push(['canvas clean across dawn->night (+' + (ctxCalls.total - totalBefore) + ' calls)',
                ctxCalls.bad === badBefore && (ctxCalls.total - totalBefore) > 500]);

  // 8c. empty photo slots get the "intentionally waiting" marker
  // (jsdom never fetches images, so simulate the 404 each photo would produce)
  [...d.querySelectorAll('.photo img')].forEach(i => i.dispatchEvent(new w.Event('error')));
  const emptyMarked = [...d.querySelectorAll('.photo')].filter(p => p.classList.contains('empty')).length;
  results.push(['missing photos marked as empty (' + emptyMarked + '/11)', emptyMarked === 11]);

  // 8d. drive a long way: the road must keep projecting ahead of the camera.
  // `drive` grows forever, so an absolute-coordinate bug would blank the scene.
  // `drive` grows without bound. If the road were built in absolute world
  // coordinates it would slide past Z_FAR and the scene would go blank after
  // ~13s of driving — so compare draw volume early vs. much later.
  const early = ctxCalls.total;
  await new Promise(r => setTimeout(r, 1000));
  const baseline = ctxCalls.total - early;

  await new Promise(r => setTimeout(r, 16000));       // drive well past Z_FAR
  const lateStart = ctxCalls.total;
  await new Promise(r => setTimeout(r, 1000));
  const late = ctxCalls.total - lateStart;

  results.push(['road survives a long drive (early ' + baseline + ' calls/1s, late ' + late + ')',
                baseline > 500 && late > baseline * 0.6]);

  // 9. every referenced asset actually resolves on the server
  const imgs = [...d.querySelectorAll('.photo img')].map(i => i.getAttribute('src'));
  const missing = [];
  for (const src of imgs) {
    const r = await fetch('http://127.0.0.1:4173/' + src);
    if (!r.ok) missing.push(src + ' -> ' + r.status);
  }
  results.push(['photo slots resolve (' + imgs.length + ')' + (missing.length ? ' MISSING ' + missing.join(',') : ''),
                imgs.length === 11 && missing.length === 0]);

  // 10. playlist
  const clips = [...d.querySelectorAll('.clip')];
  results.push(['playlist buttons built (' + clips.length + ')', clips.length === 8]);
  const reel = d.getElementById('reel');
  results.push(['reel loaded clip-01', !!reel && /clip-01\.mp4$/.test(reel.getAttribute('src') || '')]);
  results.push(['first clip selected', clips[0] && clips[0].getAttribute('aria-selected') === 'true']);
  if (clips[4]) clips[4].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 50));
  results.push(['click swaps clip (' + (reel.getAttribute('src') || '') + ')', /clip-05\.mp4$/.test(reel.getAttribute('src') || '')]);
  results.push(['selection follows click', clips[4] && clips[4].getAttribute('aria-selected') === 'true'
                && clips[0].getAttribute('aria-selected') === 'false']);
  const capTxt = d.getElementById('reelCap').textContent;
  results.push(['caption updates (' + capTxt.trim() + ')', /Clip 05/.test(capTxt)]);

  let fail = 0;
  console.log('\n─── smoke results ─────────────────────────────');
  for (const [name, ok] of results) {
    if (!ok) fail++;
    console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
  }
  console.log('───────────────────────────────────────────────');
  if (errors.length) {
    console.log('\n!! runtime errors (' + errors.length + '):');
    errors.slice(0, 6).forEach(e => console.log('   ' + e.split('\n').slice(0, 4).join('\n   ')));
    fail += errors.length;
  } else {
    console.log('no runtime errors');
  }
  console.log(fail === 0 ? '\n✅ ALL GREEN' : '\n❌ ' + fail + ' problem(s)');
  process.exit(fail === 0 ? 0 : 1);
}, 600);
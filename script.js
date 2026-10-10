/* ═══════════════════════════════════════════════════════════
   FOR GLORIA COLETE — the engine
   ═══════════════════════════════════════════════════════════ */
(() => {
'use strict';

/* ── helpers ──────────────────────────────────────────────── */
const doc      = document.documentElement;
const body     = document.body;
const clamp    = (v,a,b) => v < a ? a : v > b ? b : v;
const lerp     = (a,b,t) => a + (b-a) * t;
const rand     = (a,b) => a + Math.random()*(b-a);
const smooth   = t => t*t*(3-2*t);
const hash     = n => { const s = Math.sin(n*127.1)*43758.5453; return s - Math.floor(s); };

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE    = matchMedia('(pointer: fine)').matches;

/* Nothing decorative is allowed to take the page down with it. */
function safe(name, fn){
  try { fn(); }
  catch (err) { console.warn('[love] "' + name + '" skipped:', err && err.message); }
}

/* ═══════════════════════════════════════════════════════════
   1 · THE SCENE — a real 3D road, dawn to midnight
   ═══════════════════════════════════════════════════════════ */

const cv  = document.getElementById('scene');
const ctx = cv.getContext('2d', { alpha:false });

let W=0, H=0, DPR=1, horizonY=0, focal=1, cx=0;
const CAM_H     = 1.62;      // eye height, metres
const ROAD_HALF = 4.5;       // half carriageway, metres
const Z_NEAR    = 2.2;
const Z_FAR     = 540;
let   SEG       = 116;

let drive = 0;      // metres travelled — grows forever, so never use it as a world coord
let camX = 0;       // camera lags the centreline; that lag is the steering
let camY = CAM_H;
let roll = 0;
let journey = 0;    // 0 → 1 down the page
let boost  = 0;
let mx = 0, my = 0; // pointer parallax
let arrival = 0;    // 0 → still driving, 1 → parked
let speedNow = 16;

/* The road is a world-space curve. Everything else is projected from it,
   so the scene stays coherent however far we drive. */
const roadX = z => 8.2*Math.sin(z*0.00500) + 4.3*Math.sin(z*0.01280+1.7) + 2.0*Math.sin(z*0.02710+0.4);
const roadY = z => 2.9*Math.sin(z*0.00360+0.6) + 1.4*Math.sin(z*0.00940+2.4) + 0.5*Math.sin(z*0.02100+1.1);

const hex2rgb = h => { h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
const mixc = (a,b,t) => `rgb(${Math.round(lerp(a[0],b[0],t))},${Math.round(lerp(a[1],b[1],t))},${Math.round(lerp(a[2],b[2],t))})`;
const rgba = (c,a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/* Sky stops are deliberately deep: cream text has to stay legible over
   them at every point in the journey. */
const SKY = [
  { p:0.00, top:'#170f33', mid:'#5e3159', low:'#d99a6c', sun:'#fff0cf', gnd:'#2a1f30' },
  { p:0.14, top:'#1d4a7c', mid:'#4b7ba8', low:'#b9926e', sun:'#fff8e6', gnd:'#2c3324' },
  { p:0.38, top:'#12568f', mid:'#3f83b4', low:'#8fb8cd', sun:'#ffffff', gnd:'#333a22' },
  { p:0.62, top:'#1e1545', mid:'#b84f43', low:'#d9854f', sun:'#ffd79a', gnd:'#332524' },
  { p:0.82, top:'#0b0820', mid:'#241a4a', low:'#523162', sun:'#ece6ff', gnd:'#110d24' },
  { p:1.00, top:'#04030d', mid:'#090d24', low:'#171e46', sun:'#eef0ff', gnd:'#090716' },
].map(s => ({...s, top:hex2rgb(s.top), mid:hex2rgb(s.mid), low:hex2rgb(s.low), sun:hex2rgb(s.sun), gnd:hex2rgb(s.gnd)}));

function skyAt(p){
  let i = 0;
  while (i < SKY.length-2 && p > SKY[i+1].p) i++;
  const a = SKY[i], b = SKY[i+1], e = smooth(clamp((p-a.p)/(b.p-a.p||1),0,1));
  return { top:mixc(a.top,b.top,e), mid:mixc(a.mid,b.mid,e), low:mixc(a.low,b.low,e),
           sun:mixc(a.sun,b.sun,e), gnd:mixc(a.gnd,b.gnd,e) };
}
const night = p => clamp((p-0.70)/0.24, 0, 1);
const dusk  = p => clamp((p-0.52)/0.24, 0, 1);

/* scenery, generated once and deterministic */
const STARS  = Array.from({length:190},(_,i)=>({x:hash(i+1), y:hash(i+99)*0.74, m:hash(i+7)*1.5+0.3, p:hash(i+31)*6.283}));
const CLOUDS = Array.from({length:12},(_,i)=>{ const L=i%3; return {
  x:hash(i+200), layer:L, y:0.07+L*0.10+hash(i+300)*0.05,
  s:(0.5+hash(i+400)*0.9)*(1+L*0.45), a:0.09+hash(i+500)*0.15, v:0.0016+hash(i+600)*0.004 }; });
const RIDGES = [0,1,2].map(L => {
  const pts = [];
  for (let i=0;i<=26;i++) pts.push({ x:i/26, y:0.34+hash(i+L*41)*0.30-Math.sin(i*1.1+L)*0.10+L*0.055 });
  return { pts, layer:L, par:0.10+L*0.17 };
});

function resize(){
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width  = Math.floor(W*DPR);
  cv.height = Math.floor(H*DPR);
  cv.style.width = W+'px'; cv.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  horizonY = Math.round(H*0.665);
  focal = Math.max(W*1.02, H*0.95);
  cx = W/2;
  SEG = W < 760 ? 80 : 116;
}
resize();
addEventListener('resize', resize, { passive:true });

/* world (X across, Z along, h above the road) → screen */
function proj(X, Z, h){
  const dz = Z - drive;
  if (dz < 0.5) return null;
  const inv = focal/dz;                       // inverse depth == scale
  return { x: cx + (X-camX)*inv + mx*26, y: horizonY - (camY-roadY(Z)-h)*inv + my*14, s: inv };
}

/* xs[] is DISTANCE AHEAD, never an absolute position — `drive` grows
   without bound, so absolute coordinates would slide the world away. */
const xs = new Float64Array(SEG+1);
const pL = new Array(SEG+1);
const pR = new Array(SEG+1);
const absZ = i => drive + xs[i];

function buildSection(){
  for (let i=0;i<=SEG;i++){
    xs[i] = Z_NEAR + (Z_FAR-Z_NEAR)*Math.pow(i/SEG, 2.05);
    const Z = absZ(i), c = roadX(Z);
    pL[i] = proj(c-ROAD_HALF, Z, 0.02);
    pR[i] = proj(c+ROAD_HALF, Z, 0.02);
  }
}

function drawSky(S, p){
  const g = ctx.createLinearGradient(0,0,0,horizonY);
  g.addColorStop(0,S.top); g.addColorStop(0.55,S.mid); g.addColorStop(1,S.low);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,horizonY+1);

  const nk = night(p);
  if (nk > 0.001){
    for (const s of STARS){
      ctx.globalAlpha = nk * (REDUCED ? 0.8 : 0.55 + 0.45*Math.sin(Date.now()/900 + s.p));
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x*W + mx*10, s.y*horizonY, s.m, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  const travel = p/0.92;
  if (travel <= 1){
    const bx = lerp(0.10,0.92,travel)*W + mx*34;
    const by = horizonY - Math.sin(travel*Math.PI)*H*0.46;
    const R  = lerp(46,26,nk) * clamp(W/1280, 0.62, 1.15);

    const glow = ctx.createRadialGradient(bx,by,0,bx,by,R*9);
    glow.addColorStop(0, rgba(S.sun,0.55)); glow.addColorStop(0.22, rgba(S.sun,0.18)); glow.addColorStop(1, rgba(S.sun,0));
    ctx.fillStyle = glow; ctx.fillRect(bx-R*9, by-R*9, R*18, R*18);

    ctx.globalAlpha = 0.9; ctx.fillStyle = rgba(S.sun,1);
    ctx.beginPath(); ctx.arc(bx,by,R,0,7); ctx.fill();

    if (nk > 0.25){  // crescent: repaint the bite with the sky gradient itself
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx+R*0.52, by-R*0.26, R*0.94, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawClouds(p){
  const t = Date.now()/60000, S = skyAt(p);
  const col = mixc(S.mid,[255,255,255],0.55);
  for (const c of CLOUDS){
    const drift = (c.x + t*c.v*(1+journey*2.4) + journey*c.layer*0.18) % 1.35 - 0.18;
    const x = drift*W, y = c.y*horizonY, w = 150*c.s, h = w*0.30;
    ctx.globalAlpha = c.a*(1-night(p)*0.62)*(0.6+c.layer*0.25);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(x,y,w,h,0,0,7);
    ctx.ellipse(x-w*0.42,y+h*0.35,w*0.58,h*0.66,0,0,7);
    ctx.ellipse(x+w*0.44,y+h*0.30,w*0.62,h*0.72,0,0,7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRidges(S, p){
  const nk = night(p), dk = dusk(p);
  const col = mixc(S.gnd, S.low, 0.22);
  for (const rg of RIDGES){
    const off = (-journey*rg.par*2.4 - mx*0.02) % 1;
    ctx.fillStyle = mixc(col,[8,5,18], nk*0.45 + rg.layer*0.10);
    ctx.beginPath();
    ctx.moveTo(-W*0.3, horizonY+2);
    for (let i=0;i<=rg.pts.length;i++){
      const pt = rg.pts[i % rg.pts.length];
      let x = pt.x + off; x = ((x%1)+1)%1;
      ctx.lineTo(-W*0.3 + x*W*1.6, horizonY - pt.y*H*0.20 - rg.layer*3);
    }
    ctx.lineTo(W*1.3, horizonY+2); ctx.closePath(); ctx.fill();
  }
  if (dk > 0.01){
    const hz = ctx.createLinearGradient(0, horizonY-H*0.14, 0, horizonY+4);
    hz.addColorStop(0, rgba(S.low,0)); hz.addColorStop(1, rgba(S.low, 0.34*dk));
    ctx.fillStyle = hz; ctx.fillRect(0, horizonY-H*0.14, W, H*0.14+6);
  }
}

/* terrain follows the hills, so a crest really does hide what is beyond */
function drawTerrain(S){
  const g = ctx.createLinearGradient(0, horizonY-H*0.1, 0, H);
  g.addColorStop(0, mixc(S.gnd,S.low,0.34)); g.addColorStop(0.35, S.gnd);
  g.addColorStop(1, mixc(S.gnd,[0,0,0],0.62));
  ctx.fillStyle = g;
  ctx.beginPath();
  let started = false;
  for (let i=SEG;i>=0;i--){ const Z=absZ(i), q=proj(roadX(Z)-520,Z,0); if(!q) continue;
    if (!started){ ctx.moveTo(q.x,q.y); started=true; } else ctx.lineTo(q.x,q.y); }
  for (let i=0;i<=SEG;i++){ const Z=absZ(i), q=proj(roadX(Z)+520,Z,0); if(q) ctx.lineTo(q.x,q.y); }
  ctx.closePath(); ctx.fill();
}

function quad(A,B,C,D, fill){
  ctx.beginPath();
  ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineTo(C.x,C.y); ctx.lineTo(D.x,D.y);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}

function band(i, o0, o1, h, fill){
  const za = absZ(i), zb = absZ(i+1), ca = roadX(za), cb = roadX(zb);
  const A = proj(ca+o0,za,h), B = proj(ca+o1,za,h), C = proj(cb+o1,zb,h), D = proj(cb+o0,zb,h);
  if (A && B && C && D) quad(A,B,C,D,fill);
}

function drawRoad(S, p){
  const far  = mixc(mixc(S.gnd,[0,0,0],0.55), S.low, 0.26);
  const near = mixc([24,20,32],[44,36,52],0.45);

  const L=[], R=[];
  for (let i=0;i<=SEG;i++){ if(pL[i]&&pR[i]){ L.push([pL[i].x,pL[i].y]); R.push([pR[i].x,pR[i].y]); } }
  if (L.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(L[0][0],L[0][1]);
  for (let i=1;i<L.length;i++) ctx.lineTo(L[i][0],L[i][1]);
  for (let i=R.length-1;i>=0;i--) ctx.lineTo(R[i][0],R[i][1]);
  ctx.closePath();
  ctx.fillStyle = far; ctx.fill();

  // near-tarmac tint, clipped to the road
  const nearFog = clamp(xs[6]/90, 0, 1);
  if (nearFog > 0){
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(L[0][0],L[0][1]);
    for (let i=1;i<L.length;i++) ctx.lineTo(L[i][0],L[i][1]);
    for (let i=R.length-1;i>=0;i--) ctx.lineTo(R[i][0],R[i][1]);
    ctx.closePath(); ctx.clip();
    const g = ctx.createLinearGradient(0,H,0,horizonY);
    g.addColorStop(0, rgba(near, 0.95*nearFog)); g.addColorStop(1, rgba(near,0));
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    ctx.restore();
  }

  for (let i=SEG-1;i>=0;i--){
    const dz = xs[i];
    if (dz > 230) continue;
    // a segment thinner than a pixel costs draw calls and adds no detail
    const a = pL[i], b = pL[i+1];
    if (a && b && Math.abs(a.y-b.y) < 0.45) continue;
    const fade = 1 - clamp(dz/230, 0.12, 1);

    const rum = (i & 1) ? '#e8695f' : '#f4ece0';
    const rc  = mixc(hex2rgb(rum), S.low, fade*0.8);
    band(i, -ROAD_HALF-0.55, -ROAD_HALF+0.18, 0.035, rc);
    band(i,  ROAD_HALF-0.18,  ROAD_HALF+0.55, 0.035, rc);

    const edge = mixc(mixc(S.low,[255,246,226],0.5), S.low, fade*0.85);
    band(i, -ROAD_HALF+0.20, -ROAD_HALF+0.42, 0.04, edge);
    band(i,  ROAD_HALF-0.42,  ROAD_HALF-0.20, 0.04, edge);

    if ((i & 1) === 0) band(i, -0.17, 0.17, 0.045, mixc(mixc(S.low,[255,250,240],0.45), S.low, fade*0.85));
  }

  // wet tarmac catching the tail lights
  const nk = night(p);
  if (nk > 0.05){
    const refl = ctx.createLinearGradient(0,H,0,H*0.72);
    refl.addColorStop(0, `rgba(255,110,130,${0.16*nk})`); refl.addColorStop(1,'rgba(255,110,130,0)');
    ctx.fillStyle = refl; ctx.fillRect(cx-W*0.34, H*0.72, W*0.68, H*0.28);
  }
}

const PROP_SP = 21;

function drawProps(S, p){
  const trunk = mixc(S.gnd,[0,0,0],0.62);
  const leaf  = mixc(S.gnd,[0,0,0],0.44);
  const lamps = p > 0.72 ? 0.9 : 0.25;

  const i0 = Math.floor((drive+Z_NEAR)/PROP_SP);
  const i1 = Math.ceil((drive+360)/PROP_SP);

  for (let i=i0;i<=i1;i++){
    for (let s=-1;s<=1;s+=2){
      const Z = i*PROP_SP + hash(i*7 + (s>0?3:9))*PROP_SP;
      const dz = Z - drive;
      if (dz < Z_NEAR || dz > 340) continue;

      const r = hash(i*13 + s*29);
      const kind = r < 0.55 ? 'tree' : (r < 0.85 ? 'bush' : 'pole');
      const X = roadX(Z) + s*(ROAD_HALF + 2.6 + hash(i + s*17)*11);
      const g0 = proj(X,Z,0);
      if (!g0 || g0.y < horizonY-2 || g0.y > H+60) continue;

      ctx.globalAlpha = 0.3 + clamp(1-dz/340,0,1)**1.5 * 0.7;

      if (kind === 'tree'){
        const top = proj(X, Z, 4.4 + hash(i*3+s)*3.6);
        if (!top){ ctx.globalAlpha=1; continue; }
        const hw = (1.05 + hash(i*5)*0.75) * g0.s;
        ctx.fillStyle = leaf;
        ctx.beginPath(); ctx.moveTo(g0.x-hw,g0.y); ctx.lineTo(top.x,top.y); ctx.lineTo(g0.x+hw,g0.y);
        ctx.closePath(); ctx.fill();
        const tt = proj(X,Z,1.2);
        if (tt){ ctx.fillStyle = trunk; ctx.fillRect(g0.x-hw*0.10, tt.y, Math.max(0.7,hw*0.20), g0.y-tt.y); }
      } else if (kind === 'bush'){
        const rr = (1.1 + hash(i*11)*0.9)*g0.s;
        ctx.fillStyle = leaf;
        ctx.beginPath(); ctx.ellipse(g0.x, g0.y-rr*0.35, rr, rr*0.68, 0, 0, 7); ctx.fill();
      } else {
        const top = proj(X,Z,5.8);
        if (!top){ ctx.globalAlpha=1; continue; }
        ctx.strokeStyle = trunk; ctx.lineWidth = Math.max(0.8, 0.16*g0.s);
        ctx.beginPath(); ctx.moveTo(g0.x,g0.y); ctx.lineTo(top.x,top.y);
        const armY = top.y + 3*g0.s, armW = 0.75*g0.s;
        ctx.lineTo(top.x+armW,armY); ctx.moveTo(top.x-armW,armY);
        ctx.stroke();
        if (lamps > 0.35){
          const gl = ctx.createRadialGradient(top.x,armY,0,top.x,armY,Math.max(2,armW*3.4));
          gl.addColorStop(0, rgba([255,214,150],0.8*clamp(1-dz/340,0,1)**1.5));
          gl.addColorStop(1, rgba([255,214,150],0));
          ctx.fillStyle = gl; ctx.fillRect(top.x-armW*3.4, armY-armW*3.4, armW*6.8, armW*6.8);

          // motion blur: a streak radiating from the vanishing point, which is
          // exactly how a passing light smears in a real photograph
          const smear = clamp((speedNow*1.6)/Math.max(dz,1),0,1) * clamp(1-dz/340,0,1)**1.5;
          if (smear > 0.02){
            const vx = top.x-cx, vy = armY-horizonY;
            const lg = ctx.createLinearGradient(top.x-vx*smear*0.5, armY-vy*smear*0.5, top.x, armY);
            lg.addColorStop(0, rgba([255,220,160],0));
            lg.addColorStop(1, rgba([255,230,180],0.65*smear));
            ctx.strokeStyle = lg; ctx.lineWidth = Math.max(1, armW*0.55);
            ctx.beginPath();
            ctx.moveTo(top.x-vx*smear*0.5, armY-vy*smear*0.5);
            ctx.lineTo(top.x, armY); ctx.stroke();
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* painted twice: upright, and mirrored onto the tarmac */
function paintCar(S, p, alpha, flip){
  const w = clamp(W*0.26, 130, 250);
  const bob = REDUCED ? 0 : Math.sin(Date.now()/90) * (1.1 + boost*5);
  const bx = cx + mx*8;
  const baseY = H + w*0.10 + bob;

  ctx.save();
  ctx.globalAlpha = alpha;
  if (flip){ ctx.translate(0, baseY*2 + 6); ctx.scale(1, -0.62); }
  ctx.translate(bx, baseY); ctx.rotate(roll*0.55); ctx.translate(-bx, -baseY);

  const bodyTop  = baseY - w*0.46;
  const cabinTop = bodyTop - w*0.42;

  if (!flip){
    const wash = ctx.createRadialGradient(bx, bodyTop, 0, bx, bodyTop, w*1.9);
    wash.addColorStop(0, `rgba(255,228,196,${0.09 + night(p)*0.17})`);
    wash.addColorStop(1, 'rgba(255,228,196,0)');
    ctx.fillStyle = wash; ctx.fillRect(bx-w*1.9, bodyTop-w*1.9, w*3.8, w*3.8);

    const beam = ctx.createLinearGradient(0, bodyTop, 0, horizonY);
    beam.addColorStop(0, `rgba(255,232,200,${(0.10 + night(p)*0.16)*(1+arrival*0.5)})`);
    beam.addColorStop(1, 'rgba(255,232,200,0)');
    ctx.fillStyle = beam;
    const spread = 1.25 + arrival*0.5;
    ctx.beginPath();
    ctx.moveTo(bx-w*0.30, bodyTop); ctx.lineTo(bx+w*0.30, bodyTop);
    ctx.lineTo(bx+w*spread, horizonY+6); ctx.lineTo(bx-w*spread, horizonY+6);
    ctx.closePath(); ctx.fill();
  }

  const body = mixc([44,34,58], S.low, 0.10);
  const r = w*0.09;

  ctx.fillStyle = mixc(body,[0,0,0],0.18);
  ctx.beginPath(); ctx.roundRect(bx-w*0.345, cabinTop, w*0.69, w*0.50, [w*0.16,w*0.16,w*0.05,w*0.05]); ctx.fill();

  const glass = ctx.createLinearGradient(0, cabinTop, 0, cabinTop+w*0.34);
  glass.addColorStop(0, mixc(S.mid,[255,255,255],0.22));
  glass.addColorStop(1, mixc([18,12,30],[60,45,80],0.5));
  ctx.fillStyle = glass;
  ctx.beginPath(); ctx.roundRect(bx-w*0.28, cabinTop+w*0.055, w*0.56, w*0.335, w*0.09); ctx.fill();

  ctx.fillStyle = body;
  ctx.beginPath(); ctx.roundRect(bx-w/2, bodyTop, w, w*0.52, [r,r,w*0.05,w*0.05]); ctx.fill();
  ctx.fillStyle = rgba(mixc(body,[255,255,255],0.5), 0.30);
  ctx.beginPath(); ctx.roundRect(bx-w/2, bodyTop, w, w*0.045, [r,r,0,0]); ctx.fill();

  const braking = arrival*arrival;
  const tail = braking > 0.02
    ? `255,${Math.round(60-braking*45)},${Math.round(80-braking*60)}`
    : '255,110,130';
  const tw = w*0.155, th = w*0.105;
  for (const s of [-1,1]){
    const lx = bx + s*(w/2 - tw - w*0.055), ly = bodyTop + w*0.085;
    const glow = tw*(2.4 + braking*2.6);
    const g = ctx.createRadialGradient(lx+tw/2, ly+th/2, 0, lx+tw/2, ly+th/2, glow);
    g.addColorStop(0, `rgba(${tail},${0.85+braking*0.15})`);
    g.addColorStop(1, `rgba(${tail},0)`);
    ctx.fillStyle = g; ctx.fillRect(lx-glow, ly-glow, glow*2, glow*2);
    ctx.fillStyle = `rgb(${tail})`;
    ctx.beginPath(); ctx.roundRect(lx, ly, tw, th, th*0.45); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,240,.75)';
    ctx.beginPath(); ctx.roundRect(lx+tw*0.12, ly+th*0.16, tw*0.76, th*0.3, th*0.15); ctx.fill();
  }

  ctx.fillStyle = 'rgba(20,14,30,.72)';
  ctx.beginPath(); ctx.roundRect(bx-w*0.10, bodyTop+w*0.255, w*0.20, w*0.075, w*0.012); ctx.fill();
  ctx.fillStyle = `rgba(255,215,154,${0.85+braking*0.15})`;
  ctx.font = `500 ${Math.max(7, w*0.052)}px Inter, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('♥ 2US', bx, bodyTop + w*0.294);

  ctx.fillStyle = rgba([0,0,0],0.28);
  ctx.beginPath(); ctx.roundRect(bx-w*0.44, bodyTop+w*0.40, w*0.88, w*0.055, w*0.02); ctx.fill();

  ctx.restore();
}

function drawCar(S, p){
  const wet = clamp(night(p)*0.8 + arrival*0.35, 0, 1);
  if (wet > 0.04 && !REDUCED){
    paintCar(S, p, 0.20*wet, true);          // reflection, on the tarmac
    const fade = ctx.createLinearGradient(0,H,0,H*0.80);
    fade.addColorStop(0, `rgba(0,0,0,${0.5*wet})`); fade.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = fade; ctx.fillRect(cx-W*0.3, H*0.80, W*0.6, H*0.2);
  }
  paintCar(S, p, 1, false);
}

/* ═══════════════════════════════════════════════════════════
   2 · THE RUNWAY — scroll is the throttle
   ═══════════════════════════════════════════════════════════ */

let chapters = [];

function cacheChapters(){
  chapters = [];
  document.querySelectorAll('.stage').forEach(stage => {
    const host = stage.parentElement;
    if (!host) return;
    let top = 0, p = host;
    while (p){ top += p.offsetTop; p = p.offsetParent; }
    chapters.push({ host, stage, top, h: host.offsetHeight || 1, live: null });
  });
}

function updateChapters(){
  if (!chapters.length) return;
  const vh = innerHeight;
  const lastIdx = chapters.length - 1;

  for (let i = 0; i < chapters.length; i++){
    const c = chapters[i];
    const p = clamp((scrollY - c.top) / Math.max(1, c.h - vh), 0, 1);
    const isFirst = i === 0;

    // The landing page can't fly in — there is no scroll above it — so the
    // first chapter starts at the camera and drifts past.
    const z    = isFirst ? lerp(0,-180,p) : lerp(1500,-180,p);
    const tilt = lerp(5.5,-2.0,p);
    const lift = lerp(-2.2,1.2,p);

    // Fade IN only. Fading out would blank the screen: the chapter keeps
    // scrolling up and off after its run, and that exit should be seen.
    const vis = isFirst ? 1 : clamp((p-0.005)/0.14, 0, 1);

    c.stage.style.transform =
      `translate3d(0,${lift.toFixed(2)}%,${z.toFixed(1)}px) rotateX(${tilt.toFixed(2)}deg)`;
    c.stage.style.opacity = vis.toFixed(3);

    // The last chapter never leaves, so its links must stay live at p = 1.
    const live = p > 0.02 && (i === lastIdx || p < 0.995);
    if (c.live !== live){ c.live = live; c.stage.style.pointerEvents = live ? '' : 'none'; }
  }
}

/* subtle parallax on the individual blocks */
let depth = [];
function cacheDepth(){
  depth = [];
  document.querySelectorAll('.reveal').forEach(el => {
    let top = 0, p = el;
    while (p){ top += p.offsetTop; p = p.offsetParent; }
    depth.push({ el, mid: top + el.offsetHeight/2 });
  });
}
function updateDepth(){
  const mid = scrollY + innerHeight*0.5, span = innerHeight*0.82;
  for (const it of depth){
    const k = (it.mid - mid)/span;
    if (k < -1.35 || k > 1.35) continue;
    const kk = clamp(k,-1,1);
    it.el.style.setProperty('--dy', (kk*34).toFixed(1)+'px');
    it.el.style.setProperty('--dr', (kk*-9).toFixed(2)+'deg');
    it.el.style.setProperty('--dz', (kk*60).toFixed(1)+'px');
  }
}

/* ═══════════════════════════════════════════════════════════
   3 · SCROLL + THE FRAME LOOP
   ═══════════════════════════════════════════════════════════ */

let lastY = scrollY;
function onScroll(){
  const y = scrollY;
  boost = clamp(boost + Math.abs(y-lastY)*0.022, 0, 3.4);
  lastY = y;
  journey = clamp(y / Math.max(1, body.scrollHeight - innerHeight), 0, 1);

  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = (journey*100).toFixed(2) + '%';

  const odo = document.getElementById('odoNow');
  if (odo) odo.textContent = String(Math.round(drive/10)).padStart(3,'0');
  const box = document.querySelector('.odo');
  if (box) box.classList.toggle('stopped', arrival > 0.5);
}
addEventListener('scroll', onScroll, { passive:true });

function render(dt){
  arrival += (smooth(clamp((journey-0.90)/0.085,0,1)) - arrival) * Math.min(1, dt*1.6);

  camX += (roadX(drive+46) - camX) * Math.min(1, dt*2.1);
  camY += (CAM_H + roadY(drive)*0.85 - camY) * Math.min(1, dt*1.8);
  roll  += (clamp(-((roadX(drive+55)-roadX(drive-15))/70)*0.30, -0.13, 0.13) - roll) * Math.min(1, dt*2.6);

  const S = skyAt(journey);
  buildSection();

  drawSky(S, journey);
  drawClouds(journey);
  drawRidges(S, journey);

  // bank the world but not the sky — that is what reads as driving
  ctx.save();
  ctx.translate(cx, horizonY); ctx.rotate(roll); ctx.translate(-cx, -horizonY);
  drawTerrain(S); drawProps(S, journey); drawRoad(S, journey);
  ctx.restore();

  drawCar(S, journey);

  if (boost > 0.35 && !REDUCED){
    const g = ctx.createRadialGradient(cx, H*0.62, H*0.22, cx, H*0.62, H*0.92);
    g.addColorStop(0,'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(255,235,220,${Math.min(0.5, boost*0.16)})`);
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }
}

let prevT = performance.now();
function frame(now){
  const dt = Math.min((now-prevT)/1000, 0.05);
  prevT = now;

  // she slows to a stop as she reaches the end of the journey
  speedNow = (16 + boost*30) * (0.06 + 0.94*(1-arrival));
  drive += speedNow * dt;
  boost = Math.max(0, boost - dt*1.9);

  updateChapters();
  updateDepth();
  render(dt);
  requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════════════════════
   4 · THE SMALL FEATURES
   ═══════════════════════════════════════════════════════════ */

function initReveals(){
  const io = new IntersectionObserver(es => {
    for (const e of es) if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold:0.12, rootMargin:'0px 0px -6% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  const recache = () => { cacheDepth(); cacheChapters(); onScroll(); };
  cacheDepth(); cacheChapters(); onScroll();
  addEventListener('resize', recache, { passive:true });
  addEventListener('load', recache, { once:true });
  if (document.fonts && document.fonts.ready){
    document.fonts.ready.then(recache).catch(()=>{});
  }
}

/* ── route map ───────────────────────────────────────────── */
const STOPS = [
  { f:0.055, label:'KM 0',   to:'#stop-1' },
  { f:0.285, label:'KM 143', to:'#stop-2' },
  { f:0.505, label:'KM 301', to:'#stop-3' },
  { f:0.735, label:'KM 458', to:'#stop-4' },
  { f:0.945, label:'KM ∞',   to:'#stop-5' },
];
let mapLen = 0;

function initMap(){
  const ink = document.getElementById('mapInk');
  const base = document.getElementById('mapBase');
  const pins = document.getElementById('mapPins');
  if (!ink || !base || !pins) return;
  if (typeof ink.getTotalLength !== 'function') return;   // not every engine has it

  mapLen = ink.getTotalLength();
  if (!Number.isFinite(mapLen) || mapLen <= 0) return;
  base.setAttribute('stroke-dasharray','3 9');
  ink.style.strokeDasharray = `${mapLen} ${mapLen}`;
  ink.style.strokeDashoffset  = mapLen;

  const dots = STOPS.map((s, i) => {
    let pt;
    try { pt = ink.getPointAtLength(mapLen * s.f); } catch (_) { return null; }
    if (!pt || !Number.isFinite(pt.x)) return null;

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','pin');
    g.setAttribute('transform', `translate(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
    g.setAttribute('tabindex','0');
    g.setAttribute('role','link');
    g.setAttribute('aria-label', `Go to stop ${i+1}`);
    g.innerHTML =
      `<circle class="halo" r="11" style="animation-delay:${(i*0.5).toFixed(2)}s"></circle>` +
      `<circle class="dot" r="7"></circle><circle class="core" r="2.6"></circle>` +
      `<text y="-20" text-anchor="middle">${s.label}</text>`;

    const go = () => {
      const t = document.querySelector(s.to);
      if (t) t.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block:'center' });
    };
    g.addEventListener('click', go);
    g.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); }
    });
    pins.appendChild(g);
    return g;
  }).filter(Boolean);

  // light a pin when its stop is reached
  const hosts = STOPS.map(s => document.querySelector(s.to)).filter(Boolean);
  const io = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      const i = hosts.indexOf(e.target);
      const pin = dots[i];
      if (!pin) return;
      // style, not the fill attribute: var() is unreliable in presentation attributes
      pin.querySelector('.dot').style.fill = 'var(--gold)';
      const lbl = pin.querySelector('text');
      if (lbl){ lbl.style.fill = 'var(--ink)'; lbl.style.fontWeight = '600'; }
    });
  }, { threshold:0.4 });
  hosts.forEach(el => io.observe(el));
}

function updateMap(){
  if (!mapLen) return;
  const sec = document.getElementById('route');
  if (!sec) return;
  const h = sec.offsetHeight || 1;
  const local = clamp((scrollY + innerHeight*0.55 - sec.offsetTop) / h, 0, 1);
  const ink = document.getElementById('mapInk');
  if (ink) ink.style.strokeDashoffset = (mapLen * (1 - local)).toFixed(1);
}

/* ── counters ────────────────────────────────────────────── */
function initCounters(){
  const io = new IntersectionObserver(es => {
    for (const e of es){
      if (!e.isIntersecting) continue;
      const el = e.target, end = +el.dataset.count, t0 = performance.now(), dur = 1500;
      const step = t => {
        const k = clamp((t-t0)/dur, 0, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1-k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      io.unobserve(el);
    }
  }, { threshold:0.6 });
  document.querySelectorAll('[data-count]').forEach(el => io.observe(el));
}

/* ── photos lean toward the cursor ────────────────────────── */
function initTilt(){
  if (!FINE || REDUCED) return;
  document.querySelectorAll('[data-tilt]').forEach(el => {
    const explicit = parseFloat(el.dataset.tiltBase);
    const base = Number.isFinite(explicit) ? explicit
      : (el.classList.contains('flip') ? 1.9 : -1.6);
    el.style.transition = 'transform .55s var(--ease), box-shadow .55s var(--ease), filter .55s var(--ease)';

    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - r.left)/r.width  - 0.5;
      const dy = (e.clientY - r.top) /r.height - 0.5;
      // compose with the scroll-depth vars rather than replacing them
      el.style.transform =
        `translate3d(0,var(--dy,0px),var(--dz,0px)) ` +
        `rotateX(${(-dy*7).toFixed(2)}deg) rotateY(${(dx*8).toFixed(2)}deg) ` +
        `rotate(${base}deg) translateZ(30px) scale(1.035)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = `translate3d(0,var(--dy,0px),var(--dz,0px)) rotate(${base}deg)`;
    });
  });
}

/* ── drifting hearts ─────────────────────────────────────── */
function initHearts(){
  const box = document.getElementById('motes');
  if (!box || REDUCED) return;
  for (let i=0;i<14;i++){
    const h = document.createElement('i');
    h.textContent = Math.random() < 0.34 ? '♥' : (Math.random() < 0.5 ? '✦' : '❥');
    h.style.left = rand(0,100)+'%';
    h.style.fontSize = rand(9,20).toFixed(1)+'px';
    h.style.setProperty('--dx', rand(-110,110).toFixed(0)+'px');
    h.style.setProperty('--rot', rand(-80,80).toFixed(0)+'deg');
    h.style.animationDuration = rand(16,30).toFixed(1)+'s';
    h.style.animationDelay = (-rand(0,26)).toFixed(1)+'s';
    box.appendChild(h);
  }
}

/* ── the road song, synthesised live (no audio file) ──────── */
const CHORDS = [
  [130.81,164.81,196.00,246.94],
  [ 87.31,130.81,174.61,220.00],
  [110.00,130.81,164.81,220.00],
  [ 98.00,123.47,146.83,196.00],
];
let ac = null, master = null, voices = [], chordTimer = null, chordIdx = 0, playing = false;

function startSong(){
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.setValueAtTime(0.0001, ac.currentTime);
  master.gain.exponentialRampToValueAtTime(0.085, ac.currentTime + 3);

  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.5;

  const delay = ac.createDelay(1.5); delay.delayTime.value = 0.42;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const wet = ac.createGain(); wet.gain.value = 0.34;
  delay.connect(fb); fb.connect(delay);
  delay.connect(wet); wet.connect(master);

  voices = [];
  CHORDS[0].forEach((f, i) => {
    for (let d = 0; d < 2; d++){
      const o = ac.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * (d ? 1.004 : 0.996);
      const g = ac.createGain();
      g.gain.value = (i === 0 ? 0.30 : 0.16) / 2;
      const lfo = ac.createOscillator(); lfo.frequency.value = 0.05 + i*0.017;
      const amt = ac.createGain(); amt.gain.value = g.gain.value * 0.45;
      lfo.connect(amt); amt.connect(g.gain);
      o.connect(g); g.connect(lp); g.connect(master); g.connect(delay);
      o.start(); lfo.start();
      voices.push({ o, i });
    }
  });

  lp.connect(master); master.connect(ac.destination);

  const shift = () => {
    const next = CHORDS[(chordIdx + 1) % CHORDS.length];
    const t = ac.currentTime;
    voices.forEach(v => {
      v.o.frequency.cancelScheduledValues(t);
      v.o.frequency.setTargetAtTime(next[v.i], t, 1.1);
    });
    chordIdx = (chordIdx + 1) % CHORDS.length;
  };
  chordTimer = setInterval(shift, 5200);

  playing = true;
  document.getElementById('soundBtn').setAttribute('aria-pressed','true');
  label('playing');
}
function stopSong(){
  if (!ac || !playing) return;
  playing = false;
  clearInterval(chordTimer);

  const ctxRef = ac, gainRef = master;   // keep references alive across the fade
  const t = ctxRef.currentTime;
  gainRef.gain.cancelScheduledValues(t);
  gainRef.gain.setTargetAtTime(0.0001, t, 0.5);
  setTimeout(() => { try { ctxRef.close(); } catch (_){} }, 2200);

  ac = null; master = null; voices = [];
  document.getElementById('soundBtn').setAttribute('aria-pressed','false');
  label('road song');
}
function label(t){ const el = document.querySelector('.sound-label'); if (el) el.textContent = t; }

function initSound(){
  const btn = document.getElementById('soundBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (playing) return stopSong();
    try { startSong(); }
    catch (_){ label('no audio'); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) stopSong(); });
}

/* ── video playlist ──────────────────────────────────────── */
const CLIPS = [
  { src:'videos/clip-01.mp4', cap:'the one that started it' },
  { src:'videos/clip-02.mp4', cap:'you, mid-sentence' },
  { src:'videos/clip-03.mp4', cap:'still laughing about it' },
  { src:'videos/clip-04.mp4', cap:'the long one' },
  { src:'videos/clip-05.mp4', cap:'proof you were there' },
  { src:'videos/clip-06.mp4', cap:'the good part' },
  { src:'videos/clip-07.mp4', cap:'you, being ridiculous' },
  { src:'videos/clip-08.mp4', cap:'and then this' },
];

function initPlaylist(){
  const reel  = document.getElementById('reel');
  const stage = document.getElementById('reelStage');
  const cap   = document.getElementById('reelCap');
  const list  = document.getElementById('playlist');
  const note  = document.getElementById('videoNote');
  if (!reel || !list) return;

  const buttons = CLIPS.map((clip, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'clip';
    b.setAttribute('role','tab');
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    b.innerHTML = `<span class="clip-ico">▶</span><span class="clip-n">${String(i+1).padStart(2,'0')}</span><span class="clip-d"></span>`;
    list.appendChild(b);
    return b;
  });

  const select = (i, play) => {
    const clip = CLIPS[i];
    if (!clip) return;
    if (reel.getAttribute('src') !== clip.src){ reel.setAttribute('src', clip.src); reel.load(); }
    if (cap) cap.textContent = `Clip ${String(i+1).padStart(2,'0')} — ${clip.cap}`;
    buttons.forEach((b, k) => b.setAttribute('aria-selected', k === i ? 'true' : 'false'));
    if (play){
      const pr = reel.play();
      if (pr && typeof pr.catch === 'function') pr.catch(()=>{});
    }
  };
  buttons.forEach((b, i) => b.addEventListener('click', () => select(i, true)));

  // durations, read from each file's header
  CLIPS.forEach((clip, i) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => {
      const slot = buttons[i].querySelector('.clip-d');
      if (slot && Number.isFinite(probe.duration)){
        const s = Math.round(probe.duration);
        slot.textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
      }
      probe.removeAttribute('src'); probe.load();
    }, { once:true });
    probe.src = clip.src;
  });

  // phone clips are vertical — give them a vertical frame
  const fit = () => { if (stage) stage.classList.toggle('portrait', reel.videoHeight > reel.videoWidth && reel.videoHeight > 0); };
  reel.addEventListener('loadedmetadata', fit);

  new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting && !reel.paused) reel.pause();
  }), { threshold:0.3 }).observe(reel);

  select(0, false);
  if (note) note.hidden = true;
}

/* ── the envelope she opens ───────────────────────────────── */
function initEnvelope(){
  const env  = document.getElementById('envelope');
  const btn  = document.getElementById('envelopeBtn');
  const bodyEl = document.getElementById('letterBody');
  if (!env || !btn || !bodyEl) return;

  let opened = false;
  btn.addEventListener('click', () => {
    opened = !opened;
    env.classList.toggle('opened', opened);
    btn.setAttribute('aria-expanded', opened ? 'true' : 'false');
    bodyEl.hidden = !opened;
    if (!opened) return;
    setTimeout(() => {
      bodyEl.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block:'center' });
      bodyEl.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    }, 420);
  });
}

/* ── pointer parallax on the world ────────────────────────── */
function initPointer(){
  if (REDUCED || !FINE) return;
  addEventListener('pointermove', e => {
    mx = (e.clientX/innerWidth  - 0.5) * 2;
    my = (e.clientY/innerHeight - 0.5) * 2;
  }, { passive:true });
  addEventListener('pointerleave', () => { mx = 0; my = 0; }, { passive:true });
}

/* ── missing photos should look deliberate ────────────────── */
function initPhotos(){
  document.querySelectorAll('.photo img').forEach(img => {
    const mark = () => {
      img.style.display = 'none';
      if (img.parentNode) img.parentNode.classList.add('empty');
    };
    img.addEventListener('error', mark);
    if (img.complete && img.naturalWidth === 0) mark();
  });
}

/* ── loader ───────────────────────────────────────────────── */
function initLoader(){
  const loader = document.getElementById('loader');
  const fill   = document.getElementById('loaderFill');
  if (!loader || !fill) return;

  const drop = () => { loader.classList.add('gone'); setTimeout(() => loader.remove(), 1200); };
  const finish = () => {
    let p = 0;
    const tick = () => {
      p = Math.min(100, p + rand(6,19));
      fill.style.width = p + '%';
      if (p < 100) setTimeout(tick, rand(90,200));
      else setTimeout(drop, 260);
    };
    setTimeout(tick, 180);
  };
  if (document.readyState === 'complete') finish();
  else addEventListener('load', finish);

  setTimeout(drop, 6000);   // never leave her staring at a bar
}

/* ═══════════════════════════════════════════════════════════
   5 · BOOT — every feature isolated, so one failure is survivable
   ═══════════════════════════════════════════════════════════ */

if (REDUCED) body.classList.add('reduced');

safe('loader',    initLoader);
safe('reveals',   initReveals);
safe('map',       initMap);
safe('counters',  initCounters);
safe('tilt',      initTilt);
safe('hearts',    initHearts);
safe('sound',     initSound);
safe('playlist',  initPlaylist);
safe('envelope',  initEnvelope);
safe('pointer',   initPointer);
safe('photos',    initPhotos);

addEventListener('scroll', updateMap, { passive:true });

if (REDUCED) render(0.016);
else requestAnimationFrame(frame);

})();
'use strict';
/* ============================================================
   NEON SQUADRON  v1.67
   Izbor nivoa pamti poslednji otključani; tačkice samo za novootključane delove
   ============================================================ */

const VER = 'v1.67';
const VW = 540;
let VH = 960, SCALE = 1, DPR = 1, SAFE_TOP = 0, SAFE_BOT = 0;

const cv = document.getElementById('game');
const ctx = cv.getContext('2d', { alpha: false });
const probeTop = document.getElementById('safeTop');
const probeBot = document.getElementById('safeBot');

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  SCALE = w / VW;
  VH = h / SCALE;
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(h * DPR);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  ctx.setTransform(SCALE * DPR, 0, 0, SCALE * DPR, 0, 0);
  SAFE_TOP = probeTop.getBoundingClientRect().height / SCALE;
  SAFE_BOT = probeBot.getBoundingClientRect().height / SCALE;
  if (stars.length === 0) initStars();
  clampPlayer();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 150));

/* ---------- PALETA ---------- */

const C = {
  bg: '#05060a', player: '#7df9ff', bullet: '#c9fbff', coin: '#ffd23f',
  hp: '#39ff88', hpLow: '#ff3355', shield: '#4d8dff', nrg: '#ffe600',
  ui: '#9fe8ff', uiDim: '#4a6076', warn: '#ff3355', ok: '#39ff88'
};

/* ---------- POMOĆNE ---------- */

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const fmt = n => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const cx = x1 + dx * t, cy = y1 + dy * t;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}
/* ============================================================
   PERSPEKTIVA — čisto crtanje. Logika igre ostaje ravna 2D.
   y se tumači kao dubina: 0 = horizont (daleko), VH = kod tebe.
   ============================================================ */
let persp = false;
const HORIZON = 0.15;
const P_R = 3.30;        // horizont je 3,3× dalje od ravni u kojoj je tvoj brod
const P_SPRITE = 1.15;   // koliko je sprajt krupan u tvojoj ravni
const P_INV = 1 / P_R;

/* Klasična perspektiva: dubina z raste linearno ka horizontu, a sve se deli sa z.
   Zato je razmera tačno srazmerna rastojanju od horizonta na ekranu — i samo
   pod tim uslovom se prava linija u prostoru preslikava u pravu liniju na ekranu. */
/* Warp-zona: svet iznad y=0 (negativan y) se sabija u pojas iznad horizonta.
   Tamo protivnici izleću iz daljine — nisu aktivni dok ne stignu do y=0. */
/* Warp nije poseban prostor — to je isti svet, samo sa negativnim y.
   Ista 1/z formula važi i tamo, pa prava putanja ostaje prava i preko horizonta. */
const WARP_DEPTH = 900;          // koliko jedinica sveta staje iznad horizonta

function warpT(y) {              // 1 na y=0, 0 na kraju warpa
  return clamp(1 + y / WARP_DEPTH, 0, 1);
}
function inWarp(y) { return persp && y < 0; }

function pZ(y) {
  /* Ni gornja ni donja granica se ne odsecaju: iznad je warp, a ispod dna
     protivnik mora da nastavi da se udaljava, inače stoji zalepljen za ivicu. */
  const d = y / VH;
  return 1 / (1 + (1 - d) * (P_R - 1));
}
function pT(y) { return (pZ(y) - P_INV) / (1 - P_INV); }   // 0 na horizontu, 1 kod tebe
function pS(y) { return persp ? P_SPRITE * pZ(y) : 1; }
function pY(y) {
  if (!persp) return y;
  const hy = VH * HORIZON;
  return hy + (VH - hy) * pT(y);            // ista formula i iznad horizonta
}
function pX(x, y) { return persp ? VW / 2 + (x - VW / 2) * pZ(y) : x; }

/* Obrnuta projekcija: sa ekrana nazad u svet igre.
   Potrebna je zato što prst radi na ekranu, a igra u svom 2D prostoru. */
function pInvY(sy) {
  if (!persp) return sy;
  const hy = VH * HORIZON;
  const T = clamp((sy - hy) / (VH - hy), 0, 1);   // brod nikad ne ide u warp
  const z = P_INV + T * (1 - P_INV);
  return clamp(1 - (1 / z - 1) / (P_R - 1), 0, 1) * VH;
}
function pInvX(sx, wy) {
  return persp ? VW / 2 + (sx - VW / 2) / pZ(wy) : sx;
}

/* sprajt u svetu igre */
function wblit(sp, x, y, rot, alpha) {
  if (!persp) { blit(sp, x, y, rot, alpha); return; }
  blit(sp, pX(x, y), pY(y), rot, alpha, pS(y));
}

/* Prava linija u svetu igre u perspektivi postaje kriva na ekranu.
   Zato je delimo na segmente i svaku tačku projektujemo posebno. */
function worldPath(x0, y0, x1, y1, n) {
  n = n || 8;
  // odseci tačno na ivicama, inače bi krajnja tačka pala u ograničenu projekciju i napravila prelom
  if (y1 !== y0) {
    if (y1 > VH) { const t = (VH - y0) / (y1 - y0); x1 = x0 + (x1 - x0) * t; y1 = VH; }
    if (y1 < 0)  { const t = (0 - y0) / (y1 - y0);  x1 = x0 + (x1 - x0) * t; y1 = 0; }
  }
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wx = x0 + (x1 - x0) * t;
    const wy = y0 + (y1 - y0) * t;
    if (i === 0) ctx.moveTo(pX(wx, wy), pY(wy));
    else ctx.lineTo(pX(wx, wy), pY(wy));
  }
}

function drawGrid() {
  if (!persp) return;
  ctx.save();
  ctx.strokeStyle = '#1d4468';
  ctx.lineWidth = 1;

  /* Uzdužne linije idu i kroz warp-zonu i tamo se postepeno gube —
     isto kao meci, bez oštrog prekida na horizontu. */
  const TOPY = -WARP_DEPTH * 0.98;
  for (let i = -5; i <= 5; i++) {
    const xf = VW / 2 + i * 108;
    const N = 22;
    for (let k = 0; k < N; k++) {
      const ya = TOPY + (VH - TOPY) * (k / N);
      const yb = TOPY + (VH - TOPY) * ((k + 1) / N);
      const fa = ya < 0 ? Math.pow(warpT(ya), 3.0) : 1;
      const fb = yb < 0 ? Math.pow(warpT(yb), 3.0) : 1;
      const a = (fa + fb) / 2;
      if (a < 0.02) continue;
      ctx.globalAlpha = 0.26 * a;
      ctx.beginPath();
      ctx.moveTo(pX(xf, ya), pY(ya));
      ctx.lineTo(pX(xf, yb), pY(yb));
      ctx.stroke();
    }
  }

  // poprečne linije klize ka igraču; one u warpu blede
  const off = (performance.now() / 1000 * 0.22) % 1;
  for (let k = 0; k < 16; k++) {
    const y = ((k + off) / 16) * VH;
    ctx.globalAlpha = 0.05 + 0.22 * pT(y);
    ctx.beginPath();
    ctx.moveTo(pX(0, y), pY(y));
    ctx.lineTo(pX(VW, y), pY(y));
    ctx.stroke();
  }
  const woff = (performance.now() / 1000 * 0.5) % 1;
  for (let k = 0; k < 7; k++) {
    const y = -WARP_DEPTH * ((k + woff) / 7);
    const a = Math.pow(warpT(y), 3.2);
    if (a < 0.02) continue;
    ctx.globalAlpha = 0.20 * a;
    ctx.beginPath();
    ctx.moveTo(pX(0, y), pY(y));
    ctx.lineTo(pX(VW, y), pY(y));
    ctx.stroke();
  }
  ctx.restore();
}

const isBoss = e => e.type === 'boss' || e.type === 'boss2' || e.type === 'boss3' || e.type === 'boss4' || e.type === 'boss5' || e.type === 'boss6';
/* Dok je u warp-zoni, protivnik se ne može pogoditi i sam ne puca. */
const warpSafe = e => persp && e.y < 0;

/* ---------- SPRAJT KEŠ ---------- */

const spriteCache = {};
function getSprite(key, w, h, color, drawFn, glow) {
  if (spriteCache[key]) return spriteCache[key];
  glow = glow === undefined ? 14 : glow;
  const pad = glow * 1.6;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w + pad * 2);
  c.height = Math.ceil(h + pad * 2);
  const g = c.getContext('2d');
  g.translate(pad + w / 2, pad + h / 2);
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = color; g.shadowBlur = glow;
  g.strokeStyle = color; g.fillStyle = color;
  drawFn(g, w, h, color);
  drawFn(g, w, h, color);
  const s = { c: c, ox: pad + w / 2, oy: pad + h / 2 };
  spriteCache[key] = s;
  return s;
}
function blit(s, x, y, rot, alpha, scale) {
  if (alpha !== undefined && alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
  if (scale !== undefined && scale !== 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (rot) ctx.rotate(rot);
    ctx.drawImage(s.c, -s.ox, -s.oy); ctx.restore();
  } else if (rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.drawImage(s.c, -s.ox, -s.oy); ctx.restore();
  } else ctx.drawImage(s.c, x - s.ox, y - s.oy);
  if (alpha !== undefined && alpha < 1) ctx.restore();
}

/* ---------- OBLICI ---------- */

function poly(g, pts, fillAlpha) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fillAlpha) { g.save(); g.globalAlpha = fillAlpha; g.fill(); g.restore(); }
  g.lineWidth = 2.5; g.stroke();
}

const SHAPES = {
  player: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2, h / 2 - 4], [w / 4, h / 2 - 10], [0, h / 2 - 2],
             [-w / 4, h / 2 - 10], [-w / 2, h / 2 - 4]], 0.18);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -h / 2 + 6); g.lineTo(0, h / 2 - 8); g.stroke();
  },
  grunt: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, -h / 2], [w / 5, -h / 4], [-w / 5, -h / 4], [-w / 2, -h / 2]], 0.18);
  },
  weaver: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, 0], [w / 3, -h / 2], [-w / 3, -h / 2], [-w / 2, 0]], 0.18);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 4, 0); g.lineTo(w / 4, 0); g.stroke();
  },
  shooter: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 6], [w / 2, -h / 3], [w / 6, -h / 2],
             [-w / 6, -h / 2], [-w / 2, -h / 3], [-w / 2, h / 6]], 0.18);
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 6, 0, Math.PI * 2); g.stroke();
  },
  tank: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 5], [w / 2, -h / 2], [w / 6, -h / 3],
             [-w / 6, -h / 3], [-w / 2, -h / 2], [-w / 2, h / 5]], 0.2);
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-w / 3, h / 6); g.lineTo(w / 3, h / 6); g.stroke();
    g.beginPath(); g.moveTo(-w / 3, -h / 8); g.lineTo(w / 3, -h / 8); g.stroke();
  },
  boss: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 3, h / 4], [w / 2, -h / 6], [w / 3, -h / 2],
             [-w / 3, -h / 2], [-w / 2, -h / 6], [-w / 3, h / 4]], 0.15);
    g.lineWidth = 3;
    poly(g, [[0, h / 5], [w / 5, 0], [0, -h / 5], [-w / 5, 0]], 0.3);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 2 + 6, -h / 6); g.lineTo(-w / 3, h / 4); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - 6, -h / 6); g.lineTo(w / 3, h / 4); g.stroke();
  },
  shieldbearer: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 8], [w / 2.6, -h / 2], [-w / 2.6, -h / 2], [-w / 2, h / 8]], 0.18);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 4, -h / 6); g.lineTo(w / 4, -h / 6); g.stroke();
    g.beginPath(); g.arc(0, h / 8, w / 7, 0, Math.PI * 2); g.stroke();
  },
  swarm: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, -h / 3], [0, -h / 6], [-w / 2, -h / 3]], 0.25);
  },
  rocket: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2, h / 6], [w / 3, h / 2], [-w / 3, h / 2], [-w / 2, h / 6]], 0.3);
  },
  drone: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2, h / 4], [0, h / 8], [-w / 2, h / 4]], 0.25);
  },
  boss2: function (g, w, h) {
    poly(g, [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 6], [w / 4, h / 2],
             [-w / 4, h / 2], [-w / 2, h / 6]], 0.14);
    g.lineWidth = 3;
    poly(g, [[-w / 6, -h / 4], [w / 6, -h / 4], [w / 5, h / 5], [-w / 5, h / 5]], 0.28);
    g.lineWidth = 2;
    for (let k = -1; k <= 1; k += 2) {
      g.beginPath();
      g.moveTo(k * w / 2.6, -h / 2 + 6); g.lineTo(k * w / 2.6, h / 8);
      g.stroke();
      g.beginPath(); g.arc(k * w / 3.2, h / 8, w / 14, 0, Math.PI * 2); g.stroke();
    }
  },
  miner: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 5], [w / 3, -h / 2], [-w / 3, -h / 2], [-w / 2, h / 5]], 0.18);
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, h / 6, w / 6, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(-w / 3, -h / 5); g.lineTo(w / 3, -h / 5); g.stroke();
  },
  sniper: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 6, h / 6], [w / 2, -h / 4], [w / 5, -h / 2],
             [-w / 5, -h / 2], [-w / 2, -h / 4], [-w / 6, h / 6]], 0.18);
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, h / 6); g.lineTo(0, h / 2 + 4); g.stroke();
  },
  mine: function (g, w, h) {
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 3, 0, Math.PI * 2);
    g.save(); g.globalAlpha = 0.3; g.fill(); g.restore(); g.stroke();
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      g.beginPath();
      g.moveTo(Math.cos(a) * w / 3, Math.sin(a) * w / 3);
      g.lineTo(Math.cos(a) * w / 2, Math.sin(a) * w / 2);
      g.stroke();
    }
  },
  pod: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 8], [w / 3, -h / 2], [-w / 3, -h / 2], [-w / 2, h / 8]], 0.22);
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 5, 0, Math.PI * 2); g.stroke();
  },
  boss3: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 3, h / 5], [w / 2, -h / 5], [w / 5, -h / 2],
             [-w / 5, -h / 2], [-w / 2, -h / 5], [-w / 3, h / 5]], 0.14);
    g.lineWidth = 3;
    poly(g, [[0, h / 4], [w / 4, 0], [0, -h / 4], [-w / 4, 0]], 0.3);
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 8, 0, Math.PI * 2); g.stroke();
    for (let k = -1; k <= 1; k += 2) {
      g.beginPath(); g.moveTo(k * w / 4, -h / 3); g.lineTo(k * w / 2.3, -h / 8); g.stroke();
    }
  },
  splitter: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2, 0], [0, h / 2], [-w / 2, 0]], 0.16);
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(0, -h / 2); g.lineTo(0, h / 2); g.stroke();
    g.beginPath(); g.moveTo(-w / 2, 0); g.lineTo(w / 2, 0); g.stroke();
  },
  healer: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 8], [w / 3, -h / 2], [-w / 3, -h / 2], [-w / 2, h / 8]], 0.18);
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(-w / 5, -h / 8); g.lineTo(w / 5, -h / 8); g.stroke();
    g.beginPath(); g.moveTo(0, -h / 8 - w / 5); g.lineTo(0, -h / 8 + w / 5); g.stroke();
  },
  boss4: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2.6, -h / 5], [w / 2.2, h / 5], [0, h / 2],
             [-w / 2.2, h / 5], [-w / 2.6, -h / 5]], 0.15);
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, w / 5, 0, Math.PI * 2);
    g.save(); g.globalAlpha = 0.3; g.fill(); g.restore(); g.stroke();
    g.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      g.beginPath();
      g.moveTo(Math.cos(a) * w / 5, Math.sin(a) * w / 5);
      g.lineTo(Math.cos(a) * w / 2.6, Math.sin(a) * w / 2.6);
      g.stroke();
    }
  },
  charger: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, -h / 6], [w / 4, -h / 2], [-w / 4, -h / 2], [-w / 2, -h / 6]], 0.2);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 4, -h / 5); g.lineTo(0, h / 4); g.lineTo(w / 4, -h / 5); g.stroke();
  },
  mirror: function (g, w, h) {
    poly(g, [[0, h / 2], [w / 2, h / 6], [w / 2, -h / 3], [0, -h / 2], [-w / 2, -h / 3], [-w / 2, h / 6]], 0.16);
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 3, -h / 8); g.lineTo(w / 3, -h / 8); g.stroke();
    g.beginPath(); g.moveTo(-w / 4, h / 8); g.lineTo(w / 4, h / 8); g.stroke();
  },
  twin: function (g, w, h) {
    poly(g, [[0, -h / 2], [w / 2, -h / 8], [w / 3, h / 2], [-w / 3, h / 2], [-w / 2, -h / 8]], 0.16);
    g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, w / 5, 0, Math.PI * 2);
    g.save(); g.globalAlpha = 0.28; g.fill(); g.restore(); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(-w / 3, h / 5); g.lineTo(w / 3, h / 5); g.stroke();
  },
  pellet: function (g, w, h, color) {
    g.lineCap = 'round';
    g.strokeStyle = color;
    g.lineWidth = 4.5;
    g.beginPath(); g.moveTo(0, -h / 2 + 2); g.lineTo(0, h / 2 - 2); g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(0, -h / 2 + 3); g.lineTo(0, h / 2 - 6); g.stroke();
    g.strokeStyle = color;
  },
  bullet: function (g, w, h) {
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -h / 2); g.lineTo(0, h / 2); g.stroke();
  },
  orb: function (g, w, h) {
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, w / 2 - 2, 0, Math.PI * 2);
    g.save(); g.globalAlpha = 0.35; g.fill(); g.restore(); g.stroke();
  },
  coinSmall: function (g, w, h) {
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 2 - 1.5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, w / 5, 0, Math.PI * 2); g.stroke();
  },
  coin: function (g, w, h) {
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(0, 0, w / 2 - 2, 0, Math.PI * 2);
    g.save(); g.globalAlpha = 0.3; g.fill(); g.restore(); g.stroke();
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, w / 5, 0, Math.PI * 2); g.stroke();
  },
  nrg: function (g, w, h) {
    g.lineWidth = 2.5;
    poly(g, [[w / 8, -h / 2], [-w / 2, h / 8], [-w / 12, h / 8], [-w / 8, h / 2],
             [w / 2, -h / 8], [w / 12, -h / 8]], 0.4);
  },
  blueprint: function (g, w, h, color) {
    g.lineWidth = 2;
    const r = 4;
    g.beginPath();
    g.moveTo(-w / 2 + r, -h / 2);
    g.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
    g.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
    g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
    g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
    g.closePath();
    g.save(); g.globalAlpha = 0.18; g.fill(); g.restore();
    g.stroke();
    g.lineWidth = 1;
    g.save(); g.globalAlpha = 0.55;
    for (let k = -1; k <= 1; k++) {
      g.beginPath(); g.moveTo(-w / 2 + 4, k * h / 4); g.lineTo(w / 2 - 4, k * h / 4); g.stroke();
      g.beginPath(); g.moveTo(k * w / 4, -h / 2 + 4); g.lineTo(k * w / 4, h / 2 - 4); g.stroke();
    }
    g.restore();
  },
  pu: function (g, w, h) {
    g.lineWidth = 2.5;
    const r = 6;
    g.beginPath();
    g.moveTo(-w / 2 + r, -h / 2);
    g.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
    g.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
    g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
    g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
    g.closePath();
    g.save(); g.globalAlpha = 0.2; g.fill(); g.restore();
    g.stroke();
  }
};

/* ---------- NEPRIJATELJI ---------- */

const ENEMY = {
  grunt:   { hp: 22,  r: 17, w: 34, h: 30, color: '#00f0ff', coin: 3,   speed: 130, ram: 14, shape: 'grunt'   },
  weaver:  { hp: 30,  r: 17, w: 36, h: 30, color: '#ff2bd6', coin: 4,   speed: 105, ram: 16, shape: 'weaver'  },
  shooter: { hp: 42,  r: 19, w: 38, h: 36, color: '#ffe600', coin: 6,   speed: 90,  ram: 18, shape: 'shooter' },
  tank:    { hp: 130, r: 27, w: 54, h: 50, color: '#ff7a00', coin: 12,  speed: 48,  ram: 30, shape: 'tank'    },
  shieldbearer: { hp: 90, r: 22, w: 46, h: 42, color: '#8b5cff', coin: 10, speed: 70, ram: 22, shape: 'shieldbearer', plate: 120 },
  swarm:   { hp: 8,   r: 11, w: 22, h: 20, color: '#7cff00', coin: 1,   speed: 168, ram: 10, shape: 'swarm' },
  boss:    { hp: 1000,r: 62, w: 168,h: 130,color: '#ff2244', coin: 120, ram: 34, shape: 'boss'    },
  boss2:   { hp: 3600,r: 78, w: 210,h: 140,color: '#ff3d00', coin: 220, ram: 38, shape: 'boss2'   },
  miner:   { hp: 85,  r: 21, w: 44, h: 40, color: '#00d9a3', coin: 11, speed: 95,  ram: 20, shape: 'miner'  },
  sniper:  { hp: 55,  r: 19, w: 40, h: 40, color: '#ff5c8a', coin: 9,  speed: 95,  ram: 18, shape: 'sniper' },
  pod:     { hp: 220, r: 26, w: 52, h: 50, color: '#e05cff', coin: 25, speed: 0,   ram: 24, shape: 'pod'    },
  boss3:   { hp: 1400,r: 70, w: 190,h: 150,color: '#c400ff', coin: 320, ram: 40, shape: 'boss3'  },
  splitter:{ hp: 90,  r: 24, w: 48, h: 48, color: '#dfe9ff', coin: 5,  speed: 84,  ram: 20, shape: 'splitter' },
  healer:  { hp: 80,  r: 20, w: 42, h: 40, color: '#00ff6a', coin: 14, speed: 78,  ram: 18, shape: 'healer' },
  boss4:   { hp: 1800,r: 66, w: 176,h: 160,color: '#ff8a00', coin: 420, ram: 42, shape: 'boss4'  },
  charger: { hp: 105, r: 20, w: 42, h: 46, color: '#ff2d2d', coin: 12, speed: 70,  ram: 34, shape: 'charger' },
  mirror:  { hp: 130, r: 23, w: 48, h: 44, color: '#b0b8c8', coin: 15, speed: 66,  ram: 22, shape: 'mirror' },
  twin:    { hp: 1500,r: 54, w: 132,h: 132,color: '#ff0066', coin: 300, ram: 40, shape: 'twin' },
  bomber:  { hp: 210, r: 24, w: 48, h: 40, color: '#ff8a1e', coin: 16, ram: 20, speed: 62,  shape: 'tank' },
  phoenix: { hp: 150, r: 19, w: 38, h: 34, color: '#ffe14a', coin: 14, ram: 17, speed: 128, shape: 'weaver' },
  phantom: { hp: 190, r: 21, w: 42, h: 36, color: '#a97bff', coin: 18, ram: 19, speed: 104, shape: 'splitter' },
  boss5:   { hp: 1,   r: 0,  w: 2,  h: 2,  color: '#ff0066', coin: 0,   ram: 0,  shape: 'twin' },
  boss6:   { hp: 2400, r: 62, w: 124, h: 108, color: '#ff3d6e', coin: 900, ram: 46, shape: 'boss4' }
};

/* ---------- KOMPONENTE ---------- */

const COMP = {
  cpu:    { name: 'GLAVNI RAČUNAR', letter: 'R', color: '#7df9ff', core: true,
            up: [400, 950, 1950, 3600, 6400, 11200, 19000, 31000, 50000], desc: 'broj modula i plafon nivoa', pw: 0,
            stat: function (lv) {
              return TAB.modules[lv] + ' modula, delovi do nivoa ' + lv + ', oklop ' + TAB.hull[lv];
            } },
  gen:    { name: 'GENERATOR', letter: 'G', color: '#ffe600', core: true,
            up: [60, 140, 280, 520, 950, 1700, 3000, 5200, 8800], desc: 'proizvodi struju', pw: 0,
            stat: function (lv) { return TAB.gen[lv] + '/s struje'; } },
  motor:  { name: 'MOTORI', letter: 'P', color: '#ff9a3c', core: true,
            up: [40, 90, 180, 340, 620, 1100, 1950, 3400, 5800],
            desc: 'koliko se brod pomeri u odnosu na prst', pw: 2.5, pwn: '/s u pokretu',
            stat: function (lv) {
              return 'brod prati prst ' + Math.round(TAB.speed[lv] * 100) + '%' +
                     (lv < UP_MAX ? '  (sledeći nivo ' + Math.round(TAB.speed[lv + 1] * 100) + '%)' : '');
            } },
  turret: { name: 'TURRET', letter: 'T', color: '#00ff9d', buy: 180, max: 3,
            up: [60, 140, 280, 520, 950, 1700, 3000, 5200, 8800], desc: 'šteta, brzina, broj mlazova', pw: 1.2, pwn: 'po metku',
            stat: function (lv) {
              const n = TAB.tStream[lv], d = TAB.dmg[lv], it = TAB.interval[lv];
              return n + (n > 1 ? ' mlaza' : ' mlaz') + ' × ' + (d / n).toFixed(0) + ' = ' + d +
                     ' po salvi na ' + it.toFixed(2) + 's  (' + Math.round(d / it) + '/s)';
            } },
  shield: { name: 'ŠTIT', letter: 'Š', color: '#4d8dff', buy: 120, max: 1,
            up: [90, 190, 380, 700, 1250, 2200, 3800, 6500, 11000], desc: 'upija štetu, sam se puni', pw: 3, pwn: '/s dok se puni',
            stat: function (lv) { return TAB.shield[lv] + ' štita, puni se 8/s posle 3s bez pogotka'; } },
  bat:    { name: 'BATERIJA', letter: 'B', color: '#c86dff', buy: 90, max: 1,
            up: [70, 150, 300, 560, 1000, 1800, 3100, 5300, 9000], desc: 'veća rezerva struje', pw: 0,
            stat: function (lv) { return '+' + TAB.bat[lv] + ' rezerve (ukupno ' + (100 + TAB.bat[lv]) + ')'; } },
  magnet: { name: 'MAGNET', letter: 'M', color: '#ffd23f', buy: 70, max: 1,
            up: [50, 110, 220, 400, 720, 1300, 2300, 3900, 6600], desc: 'privlači novčiće', pw: 1.5, pwn: '/s',
            stat: function (lv) { return 'privlači sa ' + TAB.magnet[lv] + ' px (bez magneta ' + BASE_MAGNET + ')'; } },
  rocket: { name: 'RAKETE', letter: 'RK', color: '#ff6a3d', buy: 200, max: 1,
            up: [110, 230, 460, 820, 1500, 2600, 4500, 7700, 13000], desc: 'same se navode na cilj', pw: 8, pwn: 'po raketi',
            stat: function (lv) {
              return TAB.rkN[lv] + (TAB.rkN[lv] > 1 ? ' rakete' : ' raketa') + ' × ' + TAB.rkDmg[lv] +
                     ' štete na ' + fmt1(TAB.rkInt[lv]) + 's, domašaj ' + TAB.rkRad[lv] + ' px';
            } },
  robot:  { name: 'ROBOTI', letter: 'RB', color: '#39ff88', buy: 150, max: 1,
            up: [100, 210, 420, 760, 1350, 2400, 4200, 7200, 12000], desc: 'polako krpe oklop, ali tek kad prestaneš da primaš udarce',
            pw: 2.5, pwn: '/s dok rade',
            stat: function (lv) { return fmt1(TAB.repair[lv]) + ' HP/s, kreću ' + fmt1(TAB.repDelay[lv]) + 's posle pogotka'; } },
  drone:  { name: 'DRON', letter: 'DR', color: '#66ffd9', buy: 260, max: 1,
            up: [140, 290, 560, 980, 1750, 3100, 5400, 9200, 15500], desc: 'izleti, bori se sam, vrati se na punjenje', pw: 5, pwn: '/s dok je napolju',
            stat: function (lv) {
              return TAB.drN[lv] + (TAB.drN[lv] > 1 ? ' drona' : ' dron') + ' × ' + TAB.drDmg[lv] +
                     ' štete na ' + fmt1(TAB.drInt[lv]) + 's, ' + TAB.drStay[lv] + 's napolju / ' +
                     fmt1(TAB.drCharge[lv]) + 's punjenja';
            } },
  laser:  { name: 'LASER', letter: 'L', color: '#ff2bd6', buy: 300, max: 1,
            up: [160, 340, 660, 1150, 2050, 3600, 6300, 10800, 18000], desc: 'zrak prolazi kroz sve u liniji', pw: 12, pwn: '/s dok gori',
            stat: function (lv) {
              return TAB.lsDmg[lv] + ' štete/s, gori ' + fmt1(TAB.lsDur[lv]) + 's, na ' + fmt1(TAB.lsInt[lv]) + 's';
            } },
  bolt:   { name: 'MUNJA', letter: 'MU', color: '#b3ecff', buy: 340, max: 1,
            up: [180, 380, 720, 1250, 2200, 3900, 6800, 11600, 19500], desc: 'grana se sa protivnika na protivnika',
            pw: 6, pwn: 'po munji',
            stat: function (lv) {
              return TAB.boltN[lv] + (TAB.boltN[lv] > 1 ? ' munje' : ' munja') + ' × ' +
                     TAB.boltDmg[lv] + ', ' + (TAB.boltHops[lv] - 1) + ' grananja, domet ' +
                     BOLT_REACH[lv] + ' px, na ' + fmt1(TAB.boltInt[lv]) + 's';
            } },
  chamber:{ name: 'KOMORA', letter: 'RK', color: '#7cff5a', buy: 420, max: 1, heavy: true,
            up: [220, 450, 880, 1500, 2700, 4700, 8200, 14000, 23000],
            desc: 'skuplja pozadinsku radijaciju za teško naoružanje', pw: 0,
            note: 'ne troši struju — puni se sama tokom misije',
            stat: function (lv) {
              return 'do ' + fmt1(TAB.chCap[lv]) + ' punjenja po misiji  (jedan hitac = 1,0)';
            } },
  blackhole:{ name: 'CRNA RUPA', letter: 'CR', color: '#b06bff', buy: 900, max: 1, heavy: true,
            up: [420, 850, 1650, 2900, 5200, 9000, 15500, 26000, 43000],
            desc: 'TAP drugim prstom — uvlači i melje sve u krugu', pw: 0,
            stat: function (lv) {
              return TAB.bhDmg[lv] + ' štete/s, prečnik ' + TAB.bhRad[lv] + ' px, traje ' + fmt1(TAB.bhDur[lv]) + 's';
            } },
  emp:    { name: 'EMP POLJE', letter: 'EM', color: '#5ad1ff', buy: 820, max: 1, heavy: true,
            up: [380, 780, 1500, 2650, 4700, 8200, 14000, 24000, 39000],
            desc: 'PREVUCI NAGORE drugim prstom — udarni talas od broda', pw: 0,
            stat: function (lv) {
              return TAB.empDmg[lv] + ' štete uz brod, domet ' + TAB.empRad[lv] + ' px (slabi sa daljinom)';
            } },
  sweep:  { name: 'SKROL LASER', letter: 'SL', color: '#ff6ad5', buy: 860, max: 1, heavy: true,
            up: [400, 810, 1580, 2800, 4950, 8600, 14800, 25000, 41000],
            desc: 'PREVUCI UDESNO drugim prstom — snop prelazi ekran s leva na desno', pw: 0,
            stat: function (lv) {
              return TAB.swDmg[lv] + ' štete/s, širina ' + TAB.swW[lv] + ' px, prelaz ' + fmt1(TAB.swDur[lv]) + 's';
            } },
  rail:   { name: 'RAIL TOP', letter: 'RT', color: '#ffd24a', buy: 940, max: 1, heavy: true,
            up: [440, 890, 1720, 3050, 5400, 9400, 16200, 27500, 45000],
            desc: 'PREVUCI ULEVO drugim prstom — rafal u luku s desna na levo', pw: 0,
            stat: function (lv) {
              return TAB.rlN[lv] + ' zrna × ' + TAB.rlDmg[lv] + ' štete, luk za ' + fmt1(TAB.rlDur[lv]) + 's';
            } },
  copilot:{ name: 'KOPILOT', letter: 'KP', color: '#ffb3ec', buy: 350, max: 1, core: true,
            up: [500, 1050, 2100, 3800, 6800, 11800, 20000, 33000, 53000],
            desc: 'koliko oružja možeš držati aktivno u isto vreme', pw: 1.5, pwn: '/s',
            stat: function (lv) { return 'do ' + (1 + 2 * lv) + ' aktivnih oružja (bez njega samo 1)'; } },
  pulse:  { name: 'PULS LASER', letter: 'PL', color: '#ff4d6d', buy: 540, max: 1,
            up: [280, 570, 1110, 1950, 3450, 6000, 10300, 17500, 29000],
            desc: 'rafal tankih zraka u najbližeg — ugao gađanja raste sa nivoom', pw: 1.6, pwn: 'po zraku',
            stat: function (lv) {
              return TAB.plN[lv] + ' zraka × ' + TAB.plDmg[lv] + ', luk ' + TAB.plArc[lv] +
                     '°, na ' + fmt1(TAB.plInt[lv]) + 's';
            } },
  anti:   { name: 'ANTIMATERIJA', letter: 'AM', color: '#c8ff00', buy: 720, max: 1,
            up: [340, 690, 1340, 2350, 4150, 7200, 12400, 21000, 34500],
            desc: 'kugla koja zastane pa odleti, uz munje na sve strane', pw: 11, pwn: 'po kugli',
            stat: function (lv) {
              return TAB.amDmg[lv] + ' štete kuglom, munje ' + Math.round(TAB.amDmg[lv] * AM_ARC_FRAC) +
                     ' u krugu ' + TAB.amRad[lv] + ' px, na ' + fmt1(TAB.amInt[lv]) + 's';
            } },
  hack:   { name: 'HAKER', letter: 'HK', color: '#00ffa8', buy: 480, max: 1,
            up: [250, 510, 990, 1750, 3100, 5400, 9300, 15800, 26000],
            desc: 'preuzima protivnika i zabija ga u najbližeg susednog', pw: 4, pwn: 'po preuzimanju',
            stat: function (lv) {
              return 'preuzima na ' + fmt1(TAB.hkInt[lv]) + 's, udar nosi ' +
                     fmt1(TAB.hkPow[lv]) + '× oklopa otete letelice';
            } },
  burst:  { name: 'RAFALNI TOP', letter: 'BT', color: '#ff9d2e', buy: 300, max: 2,
            up: [160, 330, 660, 1150, 2050, 3600, 6300, 10800, 18000],
            desc: 'kratki rafali od pet metaka', pw: 1.0, pwn: 'po metku',
            stat: function (lv) {
              return TAB.buN[lv] + ' metaka × ' + TAB.buDmg[lv] + ', rafal na ' +
                     fmt1(TAB.buGap[lv]) + 's  (' + Math.round(TAB.buN[lv] * TAB.buDmg[lv] / TAB.buGap[lv]) + '/s)';
            } },
  branch: { name: 'GRANATA', letter: 'GR', color: '#ff4fd8', buy: 360, max: 1,
            up: [190, 400, 780, 1350, 2400, 4200, 7300, 12500, 20500],
            desc: 'raketa koja se pri udaru grana u manje', pw: 10, pwn: 'po raketi',
            stat: function (lv) {
              return TAB.brDmg[lv] + ' štete + ' + TAB.brN[lv] + ' granica × ' +
                     Math.round(TAB.brDmg[lv] * BRANCH_FRAC) + ', na ' + fmt1(TAB.brInt[lv]) + 's';
            } },
  shotgun:{ name: 'SAČMARA', letter: 'SG', color: '#c2ff3d', buy: 280, max: 1,
            up: [150, 310, 620, 1100, 1950, 3400, 6000, 10200, 17000],
            desc: 'sama opali kad ti se protivnik približi', pw: 5, pwn: 'po rafalu',
            stat: function (lv) {
              return TAB.sgN[lv] + ' sačmi × ' + TAB.sgDmg[lv] + ', domet ' + TAB.sgRange[lv] +
                     ' px, rasipanje ' + Math.round(TAB.sgCone[lv] * 2 * 180 / Math.PI) + '° — gađa i mine';
            } },
  remote: { name: 'DALJINSKI', letter: 'RC', color: '#8fa8ff', buy: 200, max: 1,
            up: [110, 230, 460, 820, 1450, 2600, 4500, 7700, 13000],
            desc: 'koliko daleko od broda prst sme da bude', pw: 1.0, pwn: '/s',
            stat: function (lv) {
              const r = TAB.leash[lv];
              return 'prst do ' + (r >= 1300 ? 'bilo gde po ekranu' : r + ' px od broda') +
                     (lv < UP_MAX ? '  (sledeći ' + TAB.leash[lv + 1] + ')' : '');
            } },
  gforce: { name: 'STABILIZATOR', letter: 'GS', color: '#ff8fb0', buy: 240, max: 1,
            up: [130, 270, 540, 950, 1700, 3000, 5200, 8900, 15000],
            desc: 'guši inerciju broda pri promeni pravca', pw: 2.0, pwn: '/s u pokretu',
            stat: function (lv) {
              const q = TAB.inertia[lv];
              return q <= 0 ? 'inercija potpuno poništena'
                            : 'inercija ' + Math.round(q * 100) + '%' +
                              (lv < UP_MAX ? '  (sledeći nivo ' + Math.round(TAB.inertia[lv + 1] * 100) + '%)' : '');
            } },
  auto:   { name: 'AUTOPILOT', letter: 'AP', color: '#9fe8ff', buy: 220, max: 1,
            up: [120, 250, 500, 900, 1600, 2800, 4900, 8400, 14000], desc: 'izbegava napade dok ne držiš prst', pw: 0,
            note: 'ne troši struju — kretanje pod autopilotom je besplatno',
            stat: function (lv) { return 'domet ' + TAB.apR[lv] + ' px, izmiče se brzinom ' + TAB.apSpd[lv]; } }
};
const SHOP_LIST = ['turret', 'shield', 'bat', 'magnet', 'rocket', 'branch', 'robot', 'drone', 'laser', 'bolt', 'burst', 'shotgun', 'gforce', 'remote', 'auto', 'chamber', 'blackhole', 'emp', 'sweep', 'rail', 'hack', 'pulse', 'anti'];
/* Teško naoružanje: nacrti za njega padaju samo sa bosova. */
const HEAVY_LIST = ['chamber', 'blackhole', 'emp', 'sweep', 'rail'];

/* Nacrti ne padaju za sve odjednom, nego za četiri komponente u isto vreme,
   redom kojim su uvođene u igru. Kad se jedna skupi, u prozor ulazi sledeća. */
const BP_WINDOW = 4;
const BP_ORDER = [
  'turret', 'rocket', 'shield', 'magnet',
  'drone', 'shotgun', 'bat', 'bolt',
  'auto', 'robot', 'laser', 'gforce',
  'remote', 'burst', 'branch', 'hack',
  'pulse', 'anti'
];
const BP_ORDER_HEAVY = ['chamber', 'emp', 'rail', 'sweep', 'blackhole'];

function bpWindow(lista) {
  const w = [];
  for (const t of lista) {
    if (bpUnlocked(t)) continue;
    w.push(t);
    if (w.length >= BP_WINDOW) break;
  }
  return w;
}
const isHeavy = t => !!(COMP[t] && COMP[t].heavy);

/* Oružja se moraju uključiti, a koliko ih sme raditi zavisi od kopilota.
   Komora nije oružje — ona samo skuplja radijaciju. */
const WEAPONS = ['turret', 'burst', 'rocket', 'branch', 'laser', 'bolt', 'shotgun',
                 'drone', 'hack', 'pulse', 'anti', 'blackhole', 'emp', 'sweep', 'rail'];
const isWeapon = t => WEAPONS.indexOf(t) >= 0;
function weaponCap() { return 1 + 2 * bestLv('copilot'); }   // svaki nivo nosi dva oružja
function activeCount() {
  let n = 0;
  for (let i = 0; i < MAX_SLOTS; i++)
    if (save.grid[i] && isWeapon(save.grid[i]) && !isDamaged(i) && save.on[i] !== false) n++;
  return n;
}
function slotActive(i) {
  const t = save.grid[i];
  if (!t || !isWeapon(t)) return true;      // sve što nije oružje uvek radi
  return save.on[i] !== false;
}

/* Radionica: delovi razvrstani po nameni, da lista ostane čitljiva. */
const SHOP_TABS = [
  { id: 'weap',  name: 'ORUŽJE',  color: '#00ff9d',
    list: ['turret', 'burst', 'rocket', 'branch', 'laser', 'pulse', 'bolt', 'shotgun', 'anti', 'drone', 'hack'] },
  { id: 'heavy', name: 'TEŠKO',   color: '#7cff5a',
    list: ['chamber', 'blackhole', 'emp', 'sweep', 'rail'] },
  { id: 'def',   name: 'ODBRANA', color: '#4d8dff',
    list: ['shield', 'robot', 'bat'] },
  { id: 'sys',   name: 'SISTEMI', color: '#9fe8ff',
    list: ['magnet', 'gforce', 'remote', 'auto'] },
  { id: 'stock', name: 'MAGACIN', color: '#ffd23f', list: null }
];
function tabDef(id) { return SHOP_TABS.find(t => t.id === id) || SHOP_TABS[0]; }
/* Tačkica u radionici znači: nacrti su skupljeni, a deo još nije nabavljen.
   Nestaje čim ga kupiš — bez obzira da li ga možeš priuštiti. */
function isNoviDeo(t) {
  return bpUnlocked(t) && ownedTotal(t) === 0;
}

function tabOfType(t) {
  for (const td of SHOP_TABS) if (td.list && td.list.indexOf(t) >= 0) return td.id;
  return null;
}

const TAB = {
  modules:  [0, 5, 8, 11, 14, 16, 18, 20, 21, 22, 24],
  hull:     [0, 100, 130, 165, 205, 250, 300, 355, 415, 480, 550],
  gen:      [0, 10, 14, 19, 25, 32, 40, 49, 59, 70, 82],
  bat:      [0, 80, 130, 190, 250, 320, 400, 490, 590, 700, 820],
  speed:    [0, 0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20],
  dmg:      [0, 10, 14, 19, 25, 32, 40, 49, 59, 70, 82],
  interval: [0, 0.30, 0.27, 0.24, 0.21, 0.18, 0.165, 0.155, 0.145, 0.135, 0.125],
  tStream:  [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3],
  shield:   [0, 60, 85, 110, 135, 160, 195, 235, 280, 330, 390],
  magnet:   [0, 130, 180, 240, 310, 390, 450, 510, 570, 630, 700],
  rkInt:    [0, 2.5, 2.2, 1.9, 1.6, 1.4, 1.25, 1.15, 1.05, 0.95, 0.85],
  rkN:      [0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4],
  rkDmg:    [0, 40, 52, 66, 80, 90, 105, 120, 138, 158, 180],
  rkRad:    [0, 58, 66, 75, 85, 96, 108, 121, 135, 150, 168],
  repair:   [0, 1.0, 1.4, 1.8, 2.3, 3.0, 3.7, 4.5, 5.4, 6.4, 7.5],
  repDelay: [0, 6.0, 5.2, 4.5, 3.8, 3.0, 2.7, 2.4, 2.2, 2.0, 1.8],
  drStay:   [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  drCharge: [0, 5, 4.5, 4, 3.5, 3, 2.8, 2.6, 2.4, 2.2, 2.0],
  drDmg:    [0, 8, 11, 14, 18, 22, 27, 32, 38, 45, 53],
  drInt:    [0, 0.45, 0.40, 0.35, 0.30, 0.26, 0.24, 0.22, 0.20, 0.18, 0.16],
  drN:      [0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3],
  lsDmg:    [0, 105, 145, 195, 255, 325, 405, 495, 595, 705, 830],
  lsDur:    [0, 1.0, 1.1, 1.25, 1.4, 1.6, 1.75, 1.9, 2.1, 2.25, 2.4],
  lsInt:    [0, 4.2, 3.7, 3.2, 2.8, 2.4, 2.2, 2.0, 1.85, 1.7, 1.5],
  boltDmg:  [0, 30, 36, 42, 48, 48, 56, 64, 73, 83, 94],
  boltHops: [0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  boltN:    [0, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3],
  boltInt:  [0, 2.2, 2.0, 1.8, 1.6, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9],
  inertia:  [1.00, 0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30, 0.20, 0.10, 0.00],
  chCap:    [0, 1.0, 1.25, 1.5, 1.75, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0],
  bhDmg:    [0, 300, 385, 490, 615, 765, 940, 1150, 1395, 1680, 2020],
  bhRad:    [0, 205, 232, 260, 290, 322, 356, 392, 430, 470, 515],
  bhDur:    [0, 3.0, 3.2, 3.45, 3.7, 4.0, 4.3, 4.6, 4.9, 5.2, 5.6],
  empDmg:   [0, 900, 1150, 1450, 1800, 2200, 2650, 3150, 3700, 4300, 5000],
  swDmg:    [0, 2000, 2520, 3130, 3830, 4610, 5510, 6540, 7690, 8980, 10400],
  swW:      [0, 26, 30, 34, 38, 43, 48, 54, 60, 67, 75],
  swDur:    [0, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 2.0],
  rlDmg:    [0, 230, 292, 363, 443, 531, 637, 752, 885, 1035, 1204],
  rlN:      [0, 14, 16, 18, 20, 23, 26, 29, 32, 36, 40],
  rlDur:    [0, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.9],
  empRad:   [0, 520, 590, 660, 730, 810, 890, 970, 1060, 1150, 1250],
  plDmg:    [0, 22, 29, 37, 47, 59, 73, 90, 110, 134, 162],
  plN:      [0, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8],
  plArc:    [0, 45, 80, 115, 150, 185, 220, 255, 290, 325, 360],
  plInt:    [0, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.92, 0.84, 0.76, 0.68],
  amDmg:    [0, 320, 405, 510, 635, 785, 960, 1170, 1420, 1710, 2060],
  amRad:    [0, 130, 148, 168, 190, 214, 240, 268, 298, 330, 365],
  amInt:    [0, 6.0, 5.5, 5.0, 4.6, 4.2, 3.8, 3.5, 3.2, 2.9, 2.6],
  hkInt:    [0, 14.0, 12.2, 10.6, 9.2, 8.0, 7.0, 6.1, 5.3, 4.6, 4.0],
  hkPow:    [0, 2.2, 2.7, 3.3, 4.0, 4.8, 5.8, 7.0, 8.4, 10.0, 12.0],
  buDmg:    [0, 7, 9, 12, 15, 19, 24, 29, 35, 42, 50],
  buN:      [0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  buGap:    [0, 1.10, 0.98, 0.87, 0.78, 0.69, 0.61, 0.54, 0.48, 0.42, 0.36],
  buRate:   [0, 0.075, 0.072, 0.069, 0.066, 0.063, 0.060, 0.057, 0.054, 0.051, 0.048],
  brDmg:    [0, 55, 68, 84, 102, 122, 145, 170, 198, 230, 265],
  brN:      [0, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6],
  brInt:    [0, 3.2, 2.9, 2.6, 2.3, 2.1, 1.9, 1.75, 1.6, 1.45, 1.3],
  sgDmg:    [0, 12, 15, 19, 23, 28, 34, 41, 49, 58, 68],
  sgN:      [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
  sgRange:  [0, 210, 260, 315, 370, 430, 490, 555, 620, 690, 760],
  sgCone:   [0, 0.30, 0.28, 0.26, 0.24, 0.22, 0.19, 0.17, 0.15, 0.12, 0.10],
  sgInt:    [0, 1.20, 1.15, 1.10, 1.05, 1.00, 0.95, 0.90, 0.85, 0.80, 0.75],
  leash:    [120, 180, 230, 290, 360, 440, 540, 660, 810, 1000, 1400],
  apR:      [0, 90, 115, 140, 170, 200, 230, 260, 290, 320, 350],
  apSpd:    [0, 160, 200, 240, 280, 330, 370, 410, 450, 490, 530]
};
const BASE_MAGNET = 70;
const BRANCH_FRAC = 0.42;   // koliki deo štete nosi svaka granica
const RAD_PER_SHOT = 1.0;   // koliko radijacije troši jedan hitac teškog oružja
const AM_ARC_FRAC = 0.30;   // koliki deo štete nose munje antimaterije
const SELL_RATE = 0.35;     // koliki deo uloženog se vraća pri prodaji

/* Koliko je u deo ukupno uloženo: kupovina plus svi apgrejdi do tog nivoa. */
function investedIn(type, lv) {
  const c = COMP[type];
  let n = c.buy || 0;
  for (let k = 0; k < (lv || 1) - 1; k++) n += c.up[k] || 0;
  return n;
}
function sellValue(type, lv) {
  return Math.max(10, Math.round(investedIn(type, lv) * SELL_RATE / 10) * 10);
}
const BP_NEEDED = 3;

/* Oštećenje modula: na 30% i 15% oklopa nasumičan zauzet modul ispada iz stroja.
   Glavni računar je izuzet — on određuje maksimalni oklop, pa bi mu kvar
   menjao HP usred borbe. Popravlja se u radionici, za novac. */
const DMG_THRESHOLDS = [0.30, 0.15];
function isDamaged(i) { return !!(save.dmg && save.dmg[i]); }
function damagedList() {
  const a = [];
  for (let i = 0; i < MAX_SLOTS; i++) if (isDamaged(i) && save.grid[i]) a.push(i);
  return a;
}
function repairCost(i) {
  const t = save.grid[i];
  if (!t) return 0;
  const c = COMP[t];
  const lv = save.lv[i] || 1;
  const base = c.buy || 200;
  return Math.round((base * 0.30 + (c.up[Math.max(0, lv - 2)] || 100) * 0.22) / 10) * 10;
}
function repairAllCost() { return damagedList().reduce((a, i) => a + repairCost(i), 0); }
function bpOf(t) { return (save.bp && save.bp[t]) || 0; }
function bpUnlocked(t) { return bpOf(t) >= BP_NEEDED; }
function bpTotal() { let n = 0; for (const t of SHOP_LIST) n += Math.min(BP_NEEDED, bpOf(t)); return n; }
function bpMax() { return SHOP_LIST.length * BP_NEEDED; }
/* Redosled otključavanja: kreće od jezgra u sredini pa se širi ka ivicama. */
const SLOT_ORDER = [
   9,  5, 13,  8, 10,
   6, 14,  4, 11, 17,
   1, 21,  2, 12, 18,
   0,  3, 16, 20,  7,
  15, 19, 22, 23
];
/* Cene otključavanja modula. Kriva je blaža nego ranije: 19 modula ukupno
   košta 87.700 umesto nekadašnjih 56.750 za samo 10. */
const SLOT_COST = [
  120, 200, 320, 480, 700, 980, 1320, 1750, 2300, 3000,
  3850, 4900, 6200, 7700, 9500, 11600, 14000, 16800, 20000
];
const MAX_SLOTS = 24;
const GRID_COLS = 4, GRID_ROWS = 6;

/* Težine: svaki stepen množi prethodni.
   HP ×1.75, šteta ×1.50, novčići ×1.50, brzina ×1.10 (ograničena na 2.5×). */
const DIFF_MAX = 10;
const DIFF_SPD_CAP = 2.5;
function diffHp(d)   { return Math.pow(1.75, d - 1); }
function diffDmg(d)  { return Math.pow(1.50, d - 1); }
function diffCoin(d) { return Math.pow(1.50, d - 1); }
function diffSpd(d)  { return Math.min(Math.pow(1.10, d - 1), DIFF_SPD_CAP); }
function maxDiff(L)  { return (save.diff && save.diff[L]) || 1; }
const UP_MAX = 10;

/* ---------- POWERUP-OVI ---------- */

const POWERUPS = {
  spread: { letter: '3', color: '#00ff9d', name: 'DODATNE CEVI',  dur: 20 },
  rapid:  { letter: 'B', color: '#00c8ff', name: 'BRZA PALJBA',   dur: 20 },
  power:  { letter: 'S', color: '#ff2bd6', name: 'JAČA ŠTETA',    dur: 20 },
  surge:  { letter: 'E', color: '#ffe600', name: 'NEOGRANIČENA STRUJA', dur: 15 },
  heal:   { letter: '+', color: '#39ff88', name: 'POPRAVKA OKLOPA', dur: 0 }
};
const PU_KEYS = ['spread', 'rapid', 'power', 'surge', 'heal'];

/* ---------- SNIMANJE ---------- */

/* Ključ snimanja NAMERNO ostaje isti i posle preimenovanja igre —
   promena bi obrisala sav postojeći progres. */
/* Tri odvojene kampanje. Prva namerno koristi stari ključ, da zatečeni
   progres ostane netaknut i završi kao kampanja 1. */
const SLOT_COUNT = 3;
const SLOT_KEYS = ['neonjuris_save_v2', 'neonfighter_save_s2', 'neonfighter_save_s3'];
const ACTIVE_SLOT_KEY = 'neonfighter_slot';

let slotIdx = 0;
function SAVE_KEY_OF(i) { return SLOT_KEYS[i]; }
function activeKey() { return SLOT_KEYS[slotIdx]; }

function readActiveSlot() {
  try {
    const v = parseInt(localStorage.getItem(ACTIVE_SLOT_KEY), 10);
    if (v >= 0 && v < SLOT_COUNT) return v;
  } catch (e) { }
  return 0;
}
function setActiveSlot(i) {
  slotIdx = clamp(i, 0, SLOT_COUNT - 1);
  try { localStorage.setItem(ACTIVE_SLOT_KEY, String(slotIdx)); } catch (e) { }
}

/* Kratak pregled kampanje za ekran izbora — čita se bez diranja tekućeg stanja. */
function slotInfo(i) {
  let d = null;
  try {
    const raw = localStorage.getItem(SLOT_KEYS[i]);
    if (raw) d = JSON.parse(raw);
  } catch (e) { d = null; }
  if (!d || !Array.isArray(d.grid)) return null;
  let delova = 0, nacrta = 0;
  for (const t of d.grid) if (t) delova++;
  if (d.bp) for (const k in d.bp) nacrta += Math.min(BP_NEEDED, d.bp[k] || 0);
  let najtezi = 1;
  if (d.diff) for (const k in d.diff) najtezi = Math.max(najtezi, d.diff[k] || 1);
  return {
    coins: d.coins || 0,
    unlocked: clamp(d.unlocked || 1, 1, LEVELS.length),
    slots: d.slots || 5,
    delova: delova,
    nacrta: nacrta,
    diff: najtezi
  };
}

function wipeSlot(i) {
  try { localStorage.removeItem(SLOT_KEYS[i]); } catch (e) { }
}
const OLD_KEY = 'neonjuris_save_v1';
let wiped = false;

function defaultSave() {
  const g = new Array(MAX_SLOTS).fill(null);
  const l = new Array(MAX_SLOTS).fill(0);
  g[9] = 'cpu'; g[5] = 'gen'; g[13] = 'motor'; g[8] = 'turret'; g[10] = 'copilot';
  l[9] = 1; l[5] = 1; l[13] = 1; l[8] = 1; l[10] = 1;
  return { coins: 0, unlocked: 1, slots: 5, diff: {}, persp: false, grid: g, lv: l, stock: {}, bp: {}, bpDone: {}, bpHeavyDone: {}, dmg: {}, on: {} };
}
let save = defaultSave();

function loadSave() {
  try {
    const raw = localStorage.getItem(activeKey());
    if (raw) {
      const d = JSON.parse(raw);
      const s = defaultSave();
      if (typeof d.coins === 'number') s.coins = d.coins;
      if (typeof d.unlocked === 'number') s.unlocked = d.unlocked;
      if (typeof d.slots === 'number') s.slots = clamp(d.slots, 5, MAX_SLOTS);
      let remapped = false;
      if (Array.isArray(d.grid)) {
        if (d.grid.length === MAX_SLOTS) {
          s.grid = d.grid.slice();
        } else {
          /* Stara rešetka 3×5 se preslikava u novu 4×6, red po red,
             pa raspored ostaje prepoznatljiv i ništa se ne gubi. */
          const oldCols = 3;
          const g2 = new Array(MAX_SLOTS).fill(null);
          const l2 = new Array(MAX_SLOTS).fill(0);
          const oldLv = Array.isArray(d.lv) ? d.lv : null;
          for (let i = 0; i < d.grid.length; i++) {
            const r = Math.floor(i / oldCols), c = i % oldCols;
            const ni = r * GRID_COLS + c;
            if (ni < MAX_SLOTS) {
              g2[ni] = d.grid[i] || null;
              if (oldLv) l2[ni] = oldLv[i] || 0;
            }
          }
          s.grid = g2;
          if (oldLv) { s.lv = l2; remapped = true; }
        }
      }
      if (remapped) {
        // nivoi su već preslikani zajedno sa rešetkom
      } else if (Array.isArray(d.lv)) {
        // v1.11+ : nivo se vodi po modulu
        s.lv = d.lv.slice(0, MAX_SLOTS);
        while (s.lv.length < MAX_SLOTS) s.lv.push(0);
      } else if (d.lv) {
        // stariji save: nivo je bio po tipu — prenosimo ga na svaki modul tog tipa
        s.lv = new Array(MAX_SLOTS).fill(0);
        for (let i = 0; i < MAX_SLOTS; i++) {
          const t = s.grid[i];
          if (t) s.lv[i] = typeof d.lv[t] === 'number' ? Math.max(1, d.lv[t]) : 1;
        }
      }
      if (d.stock) {
        s.stock = {};
        for (const t in d.stock) {
          const v = d.stock[t];
          if (Array.isArray(v)) s.stock[t] = v.slice();
          else if (typeof v === 'number' && v > 0) {
            // stariji save: broj komada -> svaki dobija nivo koji je tip tada imao
            const lv = (d.lv && typeof d.lv[t] === 'number') ? Math.max(1, d.lv[t]) : 1;
            s.stock[t] = new Array(v).fill(lv);
          }
        }
      }
      if (typeof d.persp === 'boolean') s.persp = d.persp;
      if (d.bpDone && typeof d.bpDone === 'object') s.bpDone = d.bpDone;
      if (d.bpHeavyDone && typeof d.bpHeavyDone === 'object') s.bpHeavyDone = d.bpHeavyDone;
      if (d.dmg && typeof d.dmg === 'object') s.dmg = d.dmg;
      if (d.on && typeof d.on === 'object') s.on = d.on;

      else s.on = {};

      /* Kopilot je deo jezgra. Brod koji ga nema dobija ga odmah, i to na nivou
         koji pokriva sva oružja koja su do sada radila — ograničenje ne sme
         retroaktivno da ugasi ono što je igrač već zaslužio. */
      {
        let n = 0;
        for (let i = 0; i < MAX_SLOTS; i++) if (s.grid[i] && isWeapon(s.grid[i])) n++;
        const treba = clamp(Math.ceil((n - 1) / 2), 1, UP_MAX);
        let ima = -1;
        for (let i = 0; i < MAX_SLOTS; i++) if (s.grid[i] === 'copilot') ima = i;
        if (ima >= 0) s.lv[ima] = Math.max(s.lv[ima] || 1, treba);
        else {
          let stavljen = false;
          for (let k = 0; k < s.slots && k < SLOT_ORDER.length; k++) {
            const idx = SLOT_ORDER[k];
            if (!s.grid[idx]) { s.grid[idx] = 'copilot'; s.lv[idx] = treba; stavljen = true; break; }
          }
          // nema slobodnog polja — otključaj sledeće za njega
          if (!stavljen && s.slots < MAX_SLOTS) {
            const idx = SLOT_ORDER[s.slots];
            s.slots++;
            s.grid[idx] = 'copilot'; s.lv[idx] = treba;
          }
        }
      }
      if (d.diff && typeof d.diff === 'object') s.diff = d.diff;
      else { for (let L = 1; L < s.unlocked; L++) s.diff[L] = 2; }
      /* Prelaskom na rešetku 4×6 promenio se redosled otključavanja, pa je
         poneki ugrađen deo mogao da završi u polju koje se vodi kao zaključano.
         Broj otključanih modula se ovde usklađuje sa onim što je stvarno ugrađeno. */
      let need = s.slots;
      for (let i = 0; i < MAX_SLOTS; i++) {
        if (!s.grid[i]) continue;
        const k = SLOT_ORDER.indexOf(i);
        if (k >= 0 && k + 1 > need) need = k + 1;
      }
      s.slots = clamp(need, 5, MAX_SLOTS);

      if (d.bp && typeof d.bp === 'object') {
        s.bp = d.bp;
      } else {
        // stariji save: sve što je već ugrađeno ili u magacinu važi kao otključano
        s.bp = {};
        for (let i = 0; i < MAX_SLOTS; i++) if (s.grid[i]) s.bp[s.grid[i]] = 3;
        for (const t in s.stock) if (s.stock[t] && s.stock[t].length) s.bp[t] = 3;
      }
      save = s;
    } else {
      /* Prazna kampanja mora da krene od nule — bez ovoga bi ostalo
         stanje prethodno izabrane kampanje. */
      save = defaultSave();
      if (localStorage.getItem(OLD_KEY)) {
        localStorage.removeItem(OLD_KEY);
        wiped = true;
      }
    }
  } catch (e) { save = defaultSave(); }
}
function writeSave() {
  for (const t in save.stock) {
    if (!Array.isArray(save.stock[t]) || save.stock[t].length === 0) delete save.stock[t];
  }
  try { localStorage.setItem(activeKey(), JSON.stringify(save)); } catch (e) { }
}

/* ---------- STANJE BRODA ---------- */

function installed(type) {
  let n = 0;
  for (let i = 0; i < MAX_SLOTS; i++)
    if (save.grid[i] === type && !isDamaged(i) && slotActive(i)) n++;
  return n;
}
function installedAny(type) {
  let n = 0;
  for (let i = 0; i < MAX_SLOTS; i++) if (save.grid[i] === type) n++;
  return n;
}
function stockArr(type) {
  if (!Array.isArray(save.stock[type])) save.stock[type] = [];
  return save.stock[type];
}
function stockOf(type) { return stockArr(type).length; }
function ownedTotal(type) { return installedAny(type) + stockOf(type); }
function slotLv(i) { return save.lv[i] || 0; }
function cpuLv() { const i = save.grid.indexOf('cpu'); return i >= 0 ? Math.max(1, save.lv[i]) : 1; }   // računar se ne oštećuje
function bestLv(type) {
  let m = 0;
  for (let i = 0; i < MAX_SLOTS; i++)
    if (save.grid[i] === type && !isDamaged(i) && slotActive(i)) m = Math.max(m, save.lv[i] || 0);
  return m;
}
function lvsOf(type) {
  const a = [];
  for (let i = 0; i < MAX_SLOTS; i++)
    if (save.grid[i] === type && !isDamaged(i) && slotActive(i) && (save.lv[i] || 0) > 0) a.push(save.lv[i]);
  return a;
}
function slotUnlocked(i) { return SLOT_ORDER.indexOf(i) < save.slots; }
function canRemove(type) {
  if (COMP[type].core) return false;
  if (type === 'turret') return installed('turret') > 1;
  return true;
}
function firstFreeSlot() {
  for (let k = 0; k < save.slots; k++) {
    const i = SLOT_ORDER[k];
    if (!save.grid[i]) return i;
  }
  return -1;
}

let PS = null;   // izvedene karakteristike broda
function buildShip() {
  const s = {};
  const cl = cpuLv();
  s.maxModules = TAB.modules[cl];
  s.maxLv = cl;
  s.hullMax = TAB.hull[cl];
  const gl = bestLv('gen');   s.genOut = gl > 0 ? TAB.gen[gl] : 3;      // oštećen generator daje minimum
  const bl = bestLv('bat');   s.hasBat = bl > 0; s.energyMax = 100 + (bl > 0 ? TAB.bat[bl] : 0);
  const ml = bestLv('motor'); s.speed = ml > 0 ? TAB.speed[ml] : 0.35;  // oštećeni motori — brod puzi

  // svaki turret ima svoj nivo -> svoju štetu i svoj ritam
  s.turretLv = lvsOf('turret');
  if (s.turretLv.length === 0) s.turretLv = [1];
  s.turrets = s.turretLv.length;
  s.tDmg = s.turretLv.map(l => TAB.dmg[l]);          // ukupna šteta po salvi
  s.tInt = s.turretLv.map(l => TAB.interval[l]);
  s.tStr = s.turretLv.map(l => TAB.tStream[l]);      // na koliko mlazova se ta šteta deli
  s.dmg = Math.max.apply(null, s.tDmg);
  s.interval = Math.min.apply(null, s.tInt);

  const shl = bestLv('shield'); s.hasShield = shl > 0; s.shieldMax = shl > 0 ? TAB.shield[shl] : 0;
  const mgl = bestLv('magnet'); s.hasMagnet = mgl > 0; s.magnet = mgl > 0 ? TAB.magnet[mgl] : BASE_MAGNET;
  const rl = bestLv('rocket');  s.hasRocket = rl > 0;
  s.rkInt = TAB.rkInt[rl]; s.rkN = TAB.rkN[rl]; s.rkDmg = TAB.rkDmg[rl];
  s.rkRad = TAB.rkRad[rl];
  const rbl = bestLv('robot');  s.hasRobot = rbl > 0;
  s.repair = TAB.repair[rbl]; s.repDelay = TAB.repDelay[rbl];
  const ll = bestLv('laser');   s.hasLaser = ll > 0;
  s.lsDmg = TAB.lsDmg[ll]; s.lsDur = TAB.lsDur[ll]; s.lsInt = TAB.lsInt[ll];
  const btl = bestLv('bolt');   s.hasBolt = btl > 0;
  s.boltDmg = TAB.boltDmg[btl]; s.boltHops = TAB.boltHops[btl];
  s.boltN = TAB.boltN[btl]; s.boltInt = TAB.boltInt[btl];
  s.burstLv = lvsOf('burst');
  s.hasBurst = s.burstLv.length > 0;
  s.buDmg = s.burstLv.map(l => TAB.buDmg[l]);
  s.buGap = s.burstLv.map(l => TAB.buGap[l]);
  s.buRate = s.burstLv.map(l => TAB.buRate[l]);
  s.buN = s.burstLv.map(l => TAB.buN[l]);
  const brl = bestLv('branch');  s.hasBranch = brl > 0;
  s.brDmg = TAB.brDmg[brl]; s.brN = TAB.brN[brl]; s.brInt = TAB.brInt[brl];
  const chl = bestLv('chamber'); s.hasChamber = chl > 0;
  s.radCap = chl > 0 ? TAB.chCap[chl] : 0;
  const bhl = bestLv('blackhole'); s.hasBH = bhl > 0;
  s.bhDmg = TAB.bhDmg[bhl]; s.bhRad = TAB.bhRad[bhl]; s.bhDur = TAB.bhDur[bhl];
  const epl = bestLv('emp');    s.hasEmp = epl > 0;
  s.empDmg = TAB.empDmg[epl]; s.empRad = TAB.empRad[epl];
  const swl = bestLv('sweep');  s.hasSweep = swl > 0;
  s.swDmg = TAB.swDmg[swl]; s.swW = TAB.swW[swl]; s.swDur = TAB.swDur[swl];
  const rll = bestLv('rail');   s.hasRail = rll > 0;
  s.rlDmg = TAB.rlDmg[rll]; s.rlN = TAB.rlN[rll]; s.rlDur = TAB.rlDur[rll];
  const pll = bestLv('pulse');  s.hasPulse = pll > 0;
  s.plDmg = TAB.plDmg[pll]; s.plN = TAB.plN[pll];
  s.plArc = TAB.plArc[pll] * Math.PI / 180; s.plInt = TAB.plInt[pll];
  const aml = bestLv('anti');   s.hasAnti = aml > 0;
  s.amDmg = TAB.amDmg[aml]; s.amRad = TAB.amRad[aml]; s.amInt = TAB.amInt[aml];
  const hkl = bestLv('hack');   s.hasHack = hkl > 0;
  s.hkInt = TAB.hkInt[hkl]; s.hkPow = TAB.hkPow[hkl];
  const sgl = bestLv('shotgun'); s.hasSg = sgl > 0;
  s.sgDmg = TAB.sgDmg[sgl]; s.sgN = TAB.sgN[sgl]; s.sgRange = TAB.sgRange[sgl];
  s.sgCone = TAB.sgCone[sgl]; s.sgInt = TAB.sgInt[sgl];
  const rcl = bestLv('remote');  s.hasRC = rcl > 0;
  s.leash = TAB.leash[rcl];
  const gfl = bestLv('gforce'); s.hasG = gfl > 0;
  s.inertia = TAB.inertia[gfl];
  const al = bestLv('auto');    s.hasAuto = al > 0;
  s.apR = TAB.apR[al]; s.apSpd = TAB.apSpd[al];
  const dl = bestLv('drone');   s.hasDrone = dl > 0;
  s.drStay = TAB.drStay[dl]; s.drCharge = TAB.drCharge[dl];
  s.drDmg = TAB.drDmg[dl]; s.drInt = TAB.drInt[dl]; s.drN = TAB.drN[dl];
  return s;
}
function estDraw() {
  const s = PS || buildShip();
  let d = 0;
  for (let i = 0; i < s.turrets; i++) d += COMP.turret.pw / s.tInt[i];
  d += COMP.motor.pw;
  if (s.hasShield) d += COMP.shield.pw;
  if (s.hasMagnet) d += COMP.magnet.pw;
  if (s.hasRocket) d += COMP.rocket.pw * s.rkN / s.rkInt;
  if (s.hasRobot) d += COMP.robot.pw;
  if (s.hasDrone) d += COMP.drone.pw * s.drN * (s.drStay / (s.drStay + s.drCharge));
  if (s.hasBolt) d += COMP.bolt.pw * s.boltN / s.boltInt;
  if (s.hasG) d += COMP.gforce.pw;
  for (let i = 0; i < s.burstLv.length; i++) d += COMP.burst.pw * s.buN[i] / s.buGap[i];
  if (s.hasBranch) d += COMP.branch.pw / s.brInt;
  if (s.hasSg) d += COMP.shotgun.pw / s.sgInt * 0.5;
  if (s.hasHack) d += COMP.hack.pw / s.hkInt;
  if (s.hasPulse) d += COMP.pulse.pw * s.plN / s.plInt;
  if (s.hasAnti) d += COMP.anti.pw / s.amInt;
  if (s.hasRC) d += COMP.remote.pw;
  return d;
}

/* ---------- NIVOI ---------- */

const LEVELS = [
  { name: 'NIVO 1', accent: '#00f0ff', waves: [
      { gap: 0.95, spawn: [{ t: 'grunt', n: 5, dx: 0.5, spread: 0.55, every: 0.30 }] },
      { gap: 0.8, spawn: [{ t: 'grunt', n: 4, dx: 0.28, spread: 0.30, every: 0.25 },
                          { t: 'grunt', n: 4, dx: 0.72, spread: 0.30, every: 0.25, delay: 0.6 }] },
      { gap: 0.8, spawn: [{ t: 'weaver', n: 4, dx: 0.5, spread: 0.6, every: 0.45 }] },
      { gap: 0.8, spawn: [{ t: 'grunt', n: 6, dx: 0.5, spread: 0.7, every: 0.20, pattern: 'v' },
                          { t: 'weaver', n: 2, dx: 0.5, spread: 0.4, every: 0.5, delay: 1.4 }] },
      { gap: 0.95, spawn: [{ t: 'shooter', n: 2, dx: 0.5, spread: 0.45, every: 0.7 }] },
      { gap: 0.95, spawn: [{ t: 'grunt', n: 8, dx: 0.5, spread: 0.8, every: 0.18, pattern: 'rand' },
                          { t: 'shooter', n: 2, dx: 0.5, spread: 0.6, every: 0.6, delay: 1.8 }] }
    ] },
  { name: 'NIVO 2', accent: '#ff2bd6', waves: [
      { gap: 0.8, spawn: [{ t: 'weaver', n: 5, dx: 0.5, spread: 0.7, every: 0.28 }] },
      { gap: 0.8, spawn: [{ t: 'grunt', n: 8, dx: 0.5, spread: 0.75, every: 0.16, pattern: 'v' }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 1, dx: 0.5, spread: 0, every: 0 },
                          { t: 'grunt', n: 4, dx: 0.5, spread: 0.7, every: 0.3, delay: 1.0 }] },
      { gap: 0.8, spawn: [{ t: 'shooter', n: 3, dx: 0.5, spread: 0.6, every: 0.5 },
                          { t: 'weaver', n: 3, dx: 0.5, spread: 0.5, every: 0.4, delay: 1.6 }] },
      { gap: 0.8, spawn: [{ t: 'grunt', n: 10, dx: 0.5, spread: 0.85, every: 0.14, pattern: 'rand' }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 2, dx: 0.5, spread: 0.45, every: 1.0 },
                          { t: 'shooter', n: 2, dx: 0.5, spread: 0.7, every: 0.6, delay: 1.5 }] },
      { gap: 0.95, spawn: [{ t: 'weaver', n: 6, dx: 0.5, spread: 0.8, every: 0.25 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.6, every: 0.2, delay: 2.0, pattern: 'v' }] }
    ] },
  { name: 'NIVO 3', accent: '#ff7a00', waves: [
      { gap: 0.8, spawn: [{ t: 'grunt', n: 8, dx: 0.5, spread: 0.8, every: 0.16, pattern: 'v' },
                          { t: 'weaver', n: 3, dx: 0.5, spread: 0.5, every: 0.4, delay: 1.5 }] },
      { gap: 0.8, spawn: [{ t: 'shooter', n: 4, dx: 0.5, spread: 0.75, every: 0.45 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 3, dx: 0.5, spread: 0.6, every: 0.8 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.6, pattern: 'rand' }] },
      { gap: 1.12, spawn: [{ t: 'weaver', n: 6, dx: 0.5, spread: 0.85, every: 0.22 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.6, every: 0.5, delay: 2.0 }] },
      { boss: true, gap: 1.6 }
    ] },
  { name: 'NIVO 4', accent: '#8b5cff', waves: [
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 1, dx: 0.5, spread: 0, every: 0 },
                          { t: 'grunt', n: 5, dx: 0.5, spread: 0.7, every: 0.25, delay: 1.2 }] },
      { gap: 0.8, spawn: [{ t: 'weaver', n: 5, dx: 0.5, spread: 0.8, every: 0.26 },
                          { t: 'shieldbearer', n: 1, dx: 0.28, spread: 0, every: 0, delay: 1.4 }] },
      { gap: 0.8, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'shooter', n: 2, dx: 0.5, spread: 0.7, every: 0.6, delay: 1.8 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'grunt', n: 8, dx: 0.5, spread: 0.85, every: 0.16, delay: 1.2, pattern: 'rand' }] },
      { gap: 0.8, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.65, every: 1.0 },
                          { t: 'weaver', n: 4, dx: 0.5, spread: 0.7, every: 0.3, delay: 2.0 }] },
      { gap: 1.12, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.8, every: 0.5, delay: 2.2 },
                          { t: 'tank', n: 1, dx: 0.5, spread: 0, every: 0, delay: 3.5 }] }
    ] },
  { name: 'NIVO 5', accent: '#7cff00', waves: [
      { gap: 0.95, spawn: [{ t: 'swarm', n: 12, dx: 0.5, spread: 0.7, every: 0.10 }] },
      { gap: 0.8, spawn: [{ t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.18, pattern: 'v' },
                          { t: 'swarm', n: 10, dx: 0.5, spread: 0.6, every: 0.09, delay: 1.6 }] },
      { gap: 0.8, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.55, every: 0.9 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.85, every: 0.08, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.8, every: 0.5, delay: 1.5 },
                          { t: 'swarm', n: 8, dx: 0.5, spread: 0.5, every: 0.09, delay: 3.0 }] },
      { gap: 0.8, spawn: [{ t: 'swarm', n: 12, dx: 0.30, spread: 0.35, every: 0.08 },
                          { t: 'swarm', n: 12, dx: 0.70, spread: 0.35, every: 0.08, delay: 1.2 }] },
      { gap: 1.12, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'weaver', n: 5, dx: 0.5, spread: 0.8, every: 0.28, delay: 1.8 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.9, every: 0.08, delay: 3.4 }] }
    ] },
  { name: 'NIVO 6', accent: '#ff3d00', waves: [
      { gap: 0.95, spawn: [{ t: 'grunt', n: 8, dx: 0.5, spread: 0.85, every: 0.15, pattern: 'v' },
                          { t: 'weaver', n: 4, dx: 0.5, spread: 0.6, every: 0.3, delay: 1.6 }] },
      { gap: 0.8, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.8, every: 0.08, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.8, every: 0.5, delay: 1.8 }] },
      { gap: 1.12, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.75, every: 0.8 },
                          { t: 'swarm', n: 12, dx: 0.30, spread: 0.35, every: 0.08, delay: 2.2 },
                          { t: 'swarm', n: 12, dx: 0.70, spread: 0.35, every: 0.08, delay: 3.4 }] },
      { boss2: true, gap: 1.75 }
    ] },
  { name: 'NIVO 7', accent: '#00d9a3', waves: [
      { gap: 0.95, spawn: [{ t: 'miner', n: 1, dx: 0.5, spread: 0, every: 0 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.4, pattern: 'v' }] },
      { gap: 0.8, spawn: [{ t: 'miner', n: 2, dx: 0.5, spread: 0.6, every: 0.8 },
                          { t: 'weaver', n: 4, dx: 0.5, spread: 0.7, every: 0.3, delay: 1.6 }] },
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'miner', n: 2, dx: 0.5, spread: 0.75, every: 0.9, delay: 2.0 }] },
      { gap: 0.8, spawn: [{ t: 'tank', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.8, every: 0.08, delay: 1.8 }] },
      { gap: 0.95, spawn: [{ t: 'miner', n: 3, dx: 0.5, spread: 0.8, every: 0.7 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.7, every: 0.5, delay: 2.2 }] },
      { gap: 1.12, spawn: [{ t: 'miner', n: 3, dx: 0.5, spread: 0.85, every: 0.6 },
                          { t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 2.0 },
                          { t: 'grunt', n: 8, dx: 0.5, spread: 0.9, every: 0.15, delay: 3.4, pattern: 'rand' }] }
    ] },
  { name: 'NIVO 8', accent: '#ff5c8a', waves: [
      { gap: 0.95, spawn: [{ t: 'sniper', n: 2, dx: 0.5, spread: 0.5, every: 0.7 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.6, pattern: 'v' }] },
      { gap: 0.8, spawn: [{ t: 'sniper', n: 2, dx: 0.5, spread: 0.75, every: 0.8 },
                          { t: 'weaver', n: 5, dx: 0.5, spread: 0.8, every: 0.28, delay: 1.8 }] },
      { gap: 0.95, spawn: [{ t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.6 },
                          { t: 'miner', n: 2, dx: 0.5, spread: 0.6, every: 0.9, delay: 2.2 }] },
      { gap: 0.8, spawn: [{ t: 'tank', n: 3, dx: 0.5, spread: 0.65, every: 0.8 },
                          { t: 'sniper', n: 2, dx: 0.5, spread: 0.5, every: 0.8, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.85, every: 0.08, delay: 2.4 }] },
      { gap: 1.12, spawn: [{ t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.6 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 2.0 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.7, every: 0.5, delay: 4.0 }] }
    ] },
  { name: 'NIVO 9', accent: '#c400ff', waves: [
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.85, every: 0.08, delay: 2.0 }] },
      { gap: 0.8, spawn: [{ t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.7 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 2.2 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 4, dx: 0.5, spread: 0.75, every: 0.7 },
                          { t: 'shooter', n: 4, dx: 0.5, spread: 0.85, every: 0.45, delay: 2.0 },
                          { t: 'weaver', n: 6, dx: 0.5, spread: 0.8, every: 0.25, delay: 4.0 }] },
      { boss3: true, gap: 1.92 }
    ] },
  { name: 'NIVO 10', accent: '#dfe9ff', waves: [
      { gap: 0.95, spawn: [{ t: 'splitter', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.6, pattern: 'v' }] },
      { gap: 0.8, spawn: [{ t: 'splitter', n: 3, dx: 0.5, spread: 0.7, every: 0.7 },
                          { t: 'shooter', n: 2, dx: 0.5, spread: 0.6, every: 0.6, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'splitter', n: 3, dx: 0.5, spread: 0.8, every: 0.6, delay: 2.2 }] },
      { gap: 0.8, spawn: [{ t: 'sniper', n: 2, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'miner', n: 2, dx: 0.5, spread: 0.6, every: 0.9, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'splitter', n: 4, dx: 0.5, spread: 0.85, every: 0.5 },
                          { t: 'tank', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 2.4 }] },
      { gap: 1.12, spawn: [{ t: 'splitter', n: 5, dx: 0.5, spread: 0.9, every: 0.45 },
                          { t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 2.6 },
                          { t: 'sniper', n: 2, dx: 0.5, spread: 0.7, every: 0.7, delay: 4.2 }] }
    ] },
  { name: 'NIVO 11', accent: '#00ff6a', waves: [
      { gap: 0.95, spawn: [{ t: 'healer', n: 1, dx: 0.5, spread: 0, every: 0 },
                          { t: 'tank', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 1.4 }] },
      { gap: 0.8, spawn: [{ t: 'healer', n: 1, dx: 0.3, spread: 0, every: 0 },
                          { t: 'shieldbearer', n: 2, dx: 0.6, spread: 0.5, every: 0.9, delay: 1.6 }] },
      { gap: 0.95, spawn: [{ t: 'healer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'shooter', n: 3, dx: 0.5, spread: 0.75, every: 0.5, delay: 2.0 }] },
      { gap: 0.8, spawn: [{ t: 'healer', n: 1, dx: 0.5, spread: 0, every: 0 },
                          { t: 'splitter', n: 4, dx: 0.5, spread: 0.8, every: 0.5, delay: 1.8 },
                          { t: 'miner', n: 2, dx: 0.5, spread: 0.6, every: 0.9, delay: 3.4 }] },
      { gap: 0.95, spawn: [{ t: 'healer', n: 2, dx: 0.5, spread: 0.7, every: 0.9 },
                          { t: 'tank', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 2.2 }] },
      { gap: 1.12, spawn: [{ t: 'healer', n: 2, dx: 0.5, spread: 0.75, every: 0.9 },
                          { t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 2.0 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.6, delay: 4.0 }] }
    ] },
  { name: 'NIVO 12', accent: '#ff8a00', waves: [
      { gap: 0.95, spawn: [{ t: 'splitter', n: 4, dx: 0.5, spread: 0.85, every: 0.5 },
                          { t: 'healer', n: 1, dx: 0.5, spread: 0, every: 0, delay: 2.0 }] },
      { gap: 0.8, spawn: [{ t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.6, delay: 2.2 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 4, dx: 0.5, spread: 0.75, every: 0.7 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 2.0 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.85, every: 0.08, delay: 4.0 }] },
      { boss4: true, gap: 1.92 }
    ] },
  { name: 'NIVO 13', accent: '#ff2d2d', waves: [
      { gap: 0.95, spawn: [{ t: 'charger', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.6, pattern: 'v' }] },
      { gap: 0.8, spawn: [{ t: 'charger', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'weaver', n: 4, dx: 0.5, spread: 0.7, every: 0.3, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'shieldbearer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'charger', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 2.2 }] },
      { gap: 0.8, spawn: [{ t: 'healer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'tank', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 1.8 }] },
      { gap: 0.95, spawn: [{ t: 'charger', n: 4, dx: 0.5, spread: 0.85, every: 0.6 },
                          { t: 'sniper', n: 2, dx: 0.5, spread: 0.7, every: 0.8, delay: 2.4 }] },
      { gap: 1.12, spawn: [{ t: 'charger', n: 4, dx: 0.5, spread: 0.9, every: 0.55 },
                          { t: 'splitter', n: 4, dx: 0.5, spread: 0.8, every: 0.5, delay: 2.2 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 4.2 }] }
    ] },
  { name: 'NIVO 14', accent: '#b0b8c8', waves: [
      { gap: 0.95, spawn: [{ t: 'mirror', n: 2, dx: 0.5, spread: 0.5, every: 0.9 },
                          { t: 'grunt', n: 6, dx: 0.5, spread: 0.8, every: 0.2, delay: 1.8, pattern: 'v' }] },
      { gap: 0.8, spawn: [{ t: 'mirror', n: 2, dx: 0.5, spread: 0.7, every: 0.9 },
                          { t: 'charger', n: 3, dx: 0.5, spread: 0.7, every: 0.7, delay: 2.0 }] },
      { gap: 0.95, spawn: [{ t: 'mirror', n: 3, dx: 0.5, spread: 0.8, every: 0.8 },
                          { t: 'healer', n: 1, dx: 0.5, spread: 0, every: 0, delay: 2.4 }] },
      { gap: 0.8, spawn: [{ t: 'tank', n: 3, dx: 0.5, spread: 0.7, every: 0.8 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.6, delay: 2.0 },
                          { t: 'mirror', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 4.0 }] },
      { gap: 0.95, spawn: [{ t: 'mirror', n: 3, dx: 0.5, spread: 0.85, every: 0.7 },
                          { t: 'swarm', n: 12, dx: 0.5, spread: 0.85, every: 0.08, delay: 2.4 }] },
      { gap: 1.12, spawn: [{ t: 'mirror', n: 3, dx: 0.5, spread: 0.8, every: 0.7 },
                          { t: 'charger', n: 4, dx: 0.5, spread: 0.9, every: 0.6, delay: 2.2 },
                          { t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 4.4 }] }
    ] },
  { name: 'NIVO 15', accent: '#ff0066', waves: [
      { gap: 0.95, spawn: [{ t: 'mirror', n: 3, dx: 0.5, spread: 0.8, every: 0.8 },
                          { t: 'charger', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 2.2 }] },
      { gap: 0.8, spawn: [{ t: 'healer', n: 2, dx: 0.5, spread: 0.6, every: 0.9 },
                          { t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.75, every: 0.8, delay: 1.8 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.85, every: 0.6, delay: 4.0 }] },
      { gap: 0.95, spawn: [{ t: 'tank', n: 4, dx: 0.5, spread: 0.8, every: 0.7 },
                          { t: 'splitter', n: 4, dx: 0.5, spread: 0.85, every: 0.5, delay: 2.2 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.7, every: 0.8, delay: 4.4 }] },
      { boss5: true, gap: 2.08 }
    ] },

  { name: 'NIVO 16', accent: '#ffb300', waves: [
      { gap: 0.95, spawn: [{ t: 'bomber', n: 3, dx: 0.5, spread: 0.7, every: 0.8 }] },
      { gap: 0.88, spawn: [{ t: 'bomber', n: 3, dx: 0.5, spread: 0.8, every: 0.7 },
                          { t: 'charger', n: 4, dx: 0.5, spread: 0.85, every: 0.55, delay: 2.2 }] },
      { gap: 0.8, spawn: [{ t: 'mirror', n: 3, dx: 0.5, spread: 0.85, every: 0.7 },
                          { t: 'bomber', n: 2, dx: 0.5, spread: 0.6, every: 0.9, delay: 2.4 },
                          { t: 'swarm', n: 10, dx: 0.5, spread: 0.9, every: 0.14, delay: 4.2 }] },
      { gap: 0.8, spawn: [{ t: 'splitter', n: 5, dx: 0.5, spread: 0.9, every: 0.45 },
                          { t: 'healer', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 2.0 },
                          { t: 'bomber', n: 3, dx: 0.5, spread: 0.8, every: 0.8, delay: 3.8 }] },
      { gap: 0.95, spawn: [{ t: 'bomber', n: 4, dx: 0.5, spread: 0.85, every: 0.6 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.8, every: 0.65, delay: 2.6 },
                          { t: 'tank', n: 3, dx: 0.5, spread: 0.8, every: 0.8, delay: 4.6 }] }
    ] },

  { name: 'NIVO 17', accent: '#00ffc8', waves: [
      { gap: 0.95, spawn: [{ t: 'phoenix', n: 4, dx: 0.5, spread: 0.8, every: 0.6 }] },
      { gap: 0.8, spawn: [{ t: 'phoenix', n: 5, dx: 0.5, spread: 0.85, every: 0.5 },
                          { t: 'bomber', n: 2, dx: 0.5, spread: 0.6, every: 0.9, delay: 2.4 }] },
      { gap: 0.88, spawn: [{ t: 'phoenix', n: 4, dx: 0.5, spread: 0.85, every: 0.55 },
                          { t: 'healer', n: 3, dx: 0.5, spread: 0.6, every: 0.8, delay: 2.0 },
                          { t: 'mirror', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 4.0 }] },
      { gap: 0.8, spawn: [{ t: 'splitter', n: 5, dx: 0.5, spread: 0.9, every: 0.45 },
                          { t: 'phoenix', n: 4, dx: 0.5, spread: 0.85, every: 0.55, delay: 2.6 },
                          { t: 'miner', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 4.6 }] },
      { gap: 0.95, spawn: [{ t: 'phoenix', n: 5, dx: 0.5, spread: 0.9, every: 0.5 },
                          { t: 'charger', n: 4, dx: 0.5, spread: 0.85, every: 0.6, delay: 2.4 },
                          { t: 'shieldbearer', n: 3, dx: 0.5, spread: 0.8, every: 0.75, delay: 4.8 }] }
    ] },

  { name: 'NIVO 18', accent: '#ff3d6e', waves: [
      { gap: 0.95, spawn: [{ t: 'phantom', n: 4, dx: 0.5, spread: 0.8, every: 0.6 }] },
      { gap: 0.8, spawn: [{ t: 'phantom', n: 4, dx: 0.5, spread: 0.85, every: 0.55 },
                          { t: 'phoenix', n: 3, dx: 0.5, spread: 0.7, every: 0.7, delay: 2.4 }] },
      { gap: 0.88, spawn: [{ t: 'phantom', n: 5, dx: 0.5, spread: 0.9, every: 0.5 },
                          { t: 'bomber', n: 3, dx: 0.5, spread: 0.8, every: 0.8, delay: 2.2 },
                          { t: 'sniper', n: 3, dx: 0.5, spread: 0.85, every: 0.65, delay: 4.4 }] },
      { gap: 0.8, spawn: [{ t: 'phantom', n: 4, dx: 0.5, spread: 0.85, every: 0.55 },
                          { t: 'mirror', n: 3, dx: 0.5, spread: 0.8, every: 0.7, delay: 2.0 },
                          { t: 'tank', n: 4, dx: 0.5, spread: 0.85, every: 0.65, delay: 4.0 },
                          { t: 'healer', n: 2, dx: 0.5, spread: 0.5, every: 0.9, delay: 6.0 }] },
      { boss6: true, gap: 2.24 }
    ] }
];

/* ---------- STANJE ---------- */

let screen = 'slots';   // igra kreće od izbora kampanje
let shopMode = 'menu';
let selLevel = 1, level = 1, levelDef = LEVELS[0];
let waveIdx = 0, waveTimer = 0, waveActive = false;
let pendingSpawns = [];
let levelDone = false, doneTimer = 0, runCoins = 0;
let shake = 0, flash = 0, flashColor = C.warn;
let bossRef = null, toast = null, toastT = 0;

let energy = 100, brownout = false, brownFlash = 0;
let rad = 0, radGoal = 0, radStep = 0, radFlash = 0;
let diff = 1, selDiff = 1, dHp = 1, dDmg = 1, dSpd = 1, dCoin = 1;
let bpType = null, bpTarget = -1, killCount = 0, runBp = null, endMode = 'clear';
let heavyBp = null, runHeavyBp = null;
let runBpAll = [], runHeavyAll = [];   // svi nacrti kroz niz vezanih misija
let dmgStage = 0, runDmg = [], dmgFlash = 0;

/* Prelaz između misija: umesto sletanja igrač može da proleti kroz
   meteorsko polje i uđe u sledeću misiju bez svraćanja u radionicu. */
let askExit = 0;        // odbrojavanje dok stoji pitanje sleteti/nastaviti
let transit = false;    // traje li prolazak kroz polje
let trT = 0, trDur = 0, trSpawn = 0, trBonus = 0, trHits = 0;
let chainCount = 0;     // koliko je misija vezano bez sletanja
let spentTotal = 0, playTime = 0, lastAvgDraw = 0;
let shieldPause = 0, repairPause = 0;

const bullets = [], ebullets = [], enemies = [], pickups = [], particles = [], stars = [], rockets = [], drones = [], mines = [], blasts = [], bolts = [], rings = [], holes = [], emps = [], sweeps = [], rocks = [], pulses = [], antis = [];

const player = {
  x: VW / 2, y: 0, r: 15, w: 34, h: 40,
  hp: 100, maxHp: 100, shield: 0,
  tx: 0, ty: 0, vx: 0, vy: 0, sgCd: 0, sgFlash: 0, leashHint: 0, hkCd: 0, plCd: 0, amCd: 0,
  buCd: [], buLeft: [], buShot: [], brCd: 0,
  warp: null, warpT: 0,
  inv: 0, fireCd: 0, tCd: [], rkCd: 0, lsCd: 0, lsOn: 0, boCd: 0, autoOn: 0, alive: true, tilt: 0, moving: 0, repairing: 0,
  trail: [], trailT: 0,
  pu: {}
};

/* ---------- ZVEZDE ---------- */

/* ============================================================
   POZADINSKI SLOJ — čista dekoracija. Ne utiče ni na šta u igri.
   Crta se iza mreže, tamno i sporo, da se ne meša sa metama.
   Svaki nivo ima svoj izgled, isti svaki put kad ga igraš.
   ============================================================ */
const backdrop = [];
const backdrop2 = [];      // pozadina sledeće misije dok traje preplitanje
let bgMix = 0;             // 0 = stara, 1 = nova

function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bgCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  return c;
}

function makePlanet(r, hi, lo, edge, ringed, rng) {
  const pad = r * 0.75;
  const c = bgCanvas((r + pad) * 2, (r + pad) * 2);
  const g = c.getContext('2d');
  g.translate(r + pad, r + pad);
  const grd = g.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.06, 0, 0, r);
  grd.addColorStop(0, hi); grd.addColorStop(1, lo);
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.clip();
  g.strokeStyle = edge; g.globalAlpha = 0.16;
  for (let i = 0; i < 5; i++) {
    const yy = -r + rng() * r * 2;
    g.lineWidth = r * (0.04 + rng() * 0.09);
    g.beginPath();
    g.ellipse(0, yy, r * (0.9 + rng() * 0.3), r * (0.05 + rng() * 0.10), 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 0.5; g.strokeStyle = edge; g.lineWidth = 1.5;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  if (ringed) {
    g.globalAlpha = 0.32; g.strokeStyle = edge;
    for (let k = 0; k < 3; k++) {
      g.lineWidth = r * 0.05;
      g.beginPath();
      g.ellipse(0, 0, r * (1.28 + k * 0.13), r * (0.30 + k * 0.03), -0.38, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return c;
}

function makeSun(r, col) {
  const pad = r * 2.6;
  const c = bgCanvas((r + pad) * 2, (r + pad) * 2);
  const g = c.getContext('2d');
  g.translate(r + pad, r + pad);
  const grd = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r + pad);
  grd.addColorStop(0, col); grd.addColorStop(0.16, col);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(0, 0, r + pad, 0, Math.PI * 2); g.fill();
  return c;
}

function makeNebula(r, c1, c2, rng) {
  const c = bgCanvas(r * 2, r * 2);
  const g = c.getContext('2d');
  g.translate(r, r);
  for (let i = 0; i < 5; i++) {
    const rr = r * (0.35 + rng() * 0.5);
    const ox = (rng() - 0.5) * r * 0.7, oy = (rng() - 0.5) * r * 0.7;
    const grd = g.createRadialGradient(ox, oy, 0, ox, oy, rr);
    grd.addColorStop(0, i % 2 ? c1 : c2);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(ox, oy, rr, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function makeRock(r, col, rng) {
  const pad = 6;
  const c = bgCanvas((r + pad) * 2, (r + pad) * 2);
  const g = c.getContext('2d');
  g.translate(r + pad, r + pad);
  const n = 7 + Math.floor(rng() * 4);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const rr = r * (0.62 + rng() * 0.42);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = col; g.globalAlpha = 0.55; g.fill();
  g.globalAlpha = 0.85; g.strokeStyle = col; g.lineWidth = 1.2; g.stroke();
  return c;
}

const BG_THEMES = [
  { hi: '#3a4a6b', lo: '#101725', edge: '#7fa0d0', sun: 'rgba(120,170,255,0.30)', n1: 'rgba(60,90,160,0.16)', n2: 'rgba(120,60,150,0.13)' },
  { hi: '#6b3a4a', lo: '#251015', edge: '#d08fa0', sun: 'rgba(255,140,170,0.26)', n1: 'rgba(150,50,90,0.15)', n2: 'rgba(90,40,130,0.13)' },
  { hi: '#3a6b5a', lo: '#0f2220', edge: '#7fd0b8', sun: 'rgba(120,255,215,0.24)', n1: 'rgba(40,130,110,0.15)', n2: 'rgba(40,90,140,0.13)' },
  { hi: '#6b5a3a', lo: '#221a0f', edge: '#d0bb7f', sun: 'rgba(255,215,130,0.26)', n1: 'rgba(150,110,40,0.15)', n2: 'rgba(140,60,40,0.12)' },
  { hi: '#4a3a6b', lo: '#171025', edge: '#a88fd0', sun: 'rgba(180,140,255,0.28)', n1: 'rgba(100,60,170,0.16)', n2: 'rgba(50,70,150,0.13)' }
];

/* Priprema sloj u dati niz — isti postupak i za tekuću i za dolazeću pozadinu. */
function initBackdrop(levelIdx) { buildBackdrop(levelIdx, backdrop); }

function buildBackdrop(levelIdx, out) {
  const cilj = out || backdrop;
  cilj.length = 0;
  const rng = seeded(levelIdx * 7919 + 137);
  const th = BG_THEMES[(levelIdx - 1) % BG_THEMES.length];
  const H = VH || 960;

  cilj.push({ kind: 'maglina', img: makeNebula(150 + rng() * 90, th.n1, th.n2, rng),
                  x: rng() * VW, y: rng() * H, v: 2 + rng() * 3, a: 0.55, rot: 0, spin: 0 });

  if (rng() < 0.75) {
    const r = 40 + rng() * 34;
    cilj.push({ kind: 'sunce', img: makeSun(r, th.sun), x: 60 + rng() * (VW - 120),
                    y: rng() * H * 0.5, v: 1.5 + rng() * 2, a: 0.9, rot: 0, spin: 0 });
  }

  const pn = 1 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < pn; i++) {
    const r = 58 + rng() * 82;
    cilj.push({ kind: 'planeta', img: makePlanet(r, th.hi, th.lo, th.edge, rng() < 0.4, rng),
                    x: rng() * VW, y: rng() * H, v: 3 + rng() * 4,
                    a: 0.30 + rng() * 0.14, rot: 0, spin: 0 });
  }

  const rn = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < rn; i++) {
    const r = 13 + rng() * 20;
    cilj.push({ kind: 'meteor', img: makeRock(r, th.edge, rng), x: rng() * VW, y: rng() * H,
                    v: 14 + rng() * 26, a: 0.20 + rng() * 0.12,
                    rot: rng() * 6.28, spin: (rng() - 0.5) * 0.35 });
  }
}

function moveLayer(list, dt) {
  const H = VH || 960;
  for (const o of list) {
    o.y += o.v * dt;
    o.rot += o.spin * dt;
    if (o.y - o.img.height > H) { o.y = -o.img.height; o.x = Math.random() * VW; }
  }
}

function updateBackdrop(dt) {
  moveLayer(backdrop, dt);
  if (backdrop2.length) moveLayer(backdrop2, dt);
}

function drawLayer(list, mul) {
  if (mul <= 0.004) return;
  for (const o of list) {
    const y = persp ? (VH * HORIZON * 0.35 + o.y * 0.55) : o.y;
    ctx.globalAlpha = o.a * mul;
    if (o.spin) {
      ctx.save(); ctx.translate(o.x, y); ctx.rotate(o.rot);
      ctx.drawImage(o.img, -o.img.width / 2, -o.img.height / 2); ctx.restore();
    } else {
      ctx.drawImage(o.img, o.x - o.img.width / 2, y - o.img.height / 2);
    }
  }
}

/* Dok traje preplitanje, stara pozadina bledi a nova se pojavljuje —
   ni u jednom trenutku nema naglog reza. */
function drawBackdrop() {
  ctx.save();
  drawLayer(backdrop, 1 - bgMix);
  if (backdrop2.length) drawLayer(backdrop2, bgMix);
  ctx.restore();
}

function initStars() {
  stars.length = 0;
  for (let i = 0; i < 90; i++)
    stars.push({ x: Math.random() * VW, y: Math.random() * (VH || 960), s: rnd(0.6, 2.2), v: rnd(18, 90) });
}
function updateStars(dt) {
  for (const s of stars) { s.y += s.v * dt; if (s.y > VH) { s.y = -2; s.x = Math.random() * VW; } }
}
function drawStars() {
  ctx.fillStyle = '#8fb6d6';
  for (const s of stars) {
    ctx.globalAlpha = 0.12 + s.s * 0.16;
    if (persp) {
      const sc = pS(s.y);
      ctx.fillRect(pX(s.x, s.y), pY(s.y), s.s * sc, s.s * 2.2 * sc);
    } else ctx.fillRect(s.x, s.y, s.s, s.s * 2.2);
  }
  ctx.globalAlpha = 1;
}

/* ---------- UNOS ---------- */

const uiButtons = [];
let dragId = null, lastPX = 0, lastPY = 0, firing = false;
let gid = null, gx0 = 0, gy0 = 0, gMoved = 0;
let sdrag = null, sel = null, shopTab = 'weap', SL = null;

function toVirt(e) { return { x: e.clientX / SCALE, y: e.clientY / SCALE }; }

cv.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  const p = toVirt(e);
  if (screen === 'play') {
    if (hitPause(p.x, p.y)) { screen = 'pause'; firing = false; dragId = null; return; }
    if (askExit > 0 && !transit) {
      const bw = 200, bh = 62, by = VH * 0.44;
      if (p.y > by && p.y < by + bh) {
        if (p.x > VW / 2 - bw - 8 && p.x < VW / 2 - 8) { askExit = 0; startPlayerExit(); return; }
        if (p.x > VW / 2 + 8 && p.x < VW / 2 + bw + 8) { startTransit(); return; }
      }
    }
    if (player.warp === 'out') return;          // dok odlazi, komande više ne znače ništa
    if (player.warp === 'in') {
      // prst se hvata odmah, ali brod se ne pomera dok ne izađe iz warpa
      dragId = e.pointerId; lastPX = p.x; lastPY = p.y; firing = true;
      return;
    }
    /* Drugi prst pokreće teško naoružanje. Radi samo dok prvi drži brod —
       inače bi prevlačenje pomerilo brod umesto da opali. */
    if (dragId !== null && gid === null) {
      gid = e.pointerId; gx0 = p.x; gy0 = p.y; gMoved = 0;
      return;
    }
    // prst mora da bude dovoljno blizu broda — daljinski povećava taj domet
    // brod se hvata tamo gde je NACRTAN, ne gde je u koordinatama sveta
    const R = PS ? PS.leash : 120;
    const sx = pX(player.x, player.y), sy = pY(player.y), sc = pS(player.y);
    const rx = R * sc, ry = R * sc * (persp ? 0.55 : 1);
    const ddx = (p.x - sx) / rx, ddy = (p.y - sy) / ry;
    if (ddx * ddx + ddy * ddy > 1) { player.leashHint = 1.3; return; }
    dragId = e.pointerId; lastPX = p.x; lastPY = p.y; firing = true;
  } else if (screen === 'shop') {
    shopDown(p, e.pointerId);
  } else {
    uiClick(p.x, p.y);
  }
}, { passive: false });

cv.addEventListener('pointermove', function (e) {
  const p = toVirt(e);
  if (e.pointerId === gid) {
    e.preventDefault();
    gMoved = Math.max(gMoved, Math.hypot(p.x - gx0, p.y - gy0));
    return;
  }
  if (screen === 'shop') {
    if (sdrag && sdrag.id === e.pointerId) {
      e.preventDefault();
      sdrag.x = p.x; sdrag.y = p.y;
      if (Math.abs(p.x - sdrag.sx) + Math.abs(p.y - sdrag.sy) > 12) sdrag.moved = true;
    }
    return;
  }
  if (screen !== 'play' || e.pointerId !== dragId) return;
  if (player.warp) {                            // prati prst, ali ne pomera brod
    e.preventDefault();
    const q = toVirt(e);
    lastPX = q.x; lastPY = q.y;
    return;
  }
  e.preventDefault();
  const dx = (p.x - lastPX) * PS.speed * (brownout ? 0.55 : 1);
  const dy = (p.y - lastPY) * PS.speed * (brownout ? 0.55 : 1);

  /* Cilj se pomera po EKRANU koliko i prst, pa se vrati u koordinate sveta.
     Bez ovoga brod u nagnutom prikazu ne prati prst — što dublje, to gore. */
  let sx = pX(player.tx, player.ty) + dx;
  let sy = pY(player.ty) + dy;

  // povodac: cilj ne sme da odluta od prsta dalje nego što domet dozvoljava, mereno na ekranu
  const sc = pS(player.ty);
  const rx = PS.leash * sc, ry = PS.leash * sc * (persp ? 0.55 : 1);
  const ox = (sx - p.x) / rx, oy = (sy - p.y) / ry;
  const od = Math.hypot(ox, oy);
  if (od > 1) { sx = p.x + (sx - p.x) / od; sy = p.y + (sy - p.y) / od; }

  player.ty = pInvY(sy);
  player.tx = pInvX(sx, player.ty);
  player.tilt = clamp(player.tilt + dx * 0.02, -0.5, 0.5);
  if (Math.abs(dx) + Math.abs(dy) > 0.6) player.moving = 0.16;
  lastPX = p.x; lastPY = p.y;
  clampTarget();
}, { passive: false });

const GESTURE_MIN = 60;      // ispod ovoga je tap, iznad je prevlačenje

function endPointer(e) {
  if (screen === 'shop' && sdrag && sdrag.id === e.pointerId) { shopUp(toVirt(e)); return; }
  if (e.pointerId === gid) {
    const p = toVirt(e);
    const dx = p.x - gx0, dy = p.y - gy0;
    gid = null;
    if (screen !== 'play' || !player.alive || player.warp) return;
    if (gMoved < GESTURE_MIN) { heavyFire('tap', gx0, gy0); return; }
    if (Math.abs(dy) > Math.abs(dx)) { if (dy < 0) heavyFire('up', gx0, gy0); }
    else heavyFire(dx > 0 ? 'right' : 'left', gx0, gy0);
    return;
  }
  if (e.pointerId === dragId) { dragId = null; firing = false; gid = null; }
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
window.addEventListener('blur', function () {
  dragId = null; firing = false; sdrag = null;
  if (screen === 'play') screen = 'pause';
});

/* Granice kretanja se računaju na EKRANU, ne u koordinatama sveta.
   Bez toga bi se u nagnutom prikazu igralište sužavalo ka horizontu
   i brod bi udarao u nevidljiv zid. */
function xLimits(y) {
  const m = player.w / 2;
  if (!persp) return [m, VW - m];
  const z = Math.max(0.05, pZ(y));
  const half = (VW / 2 - m) / z;
  return [VW / 2 - half, VW / 2 + half];
}
function clampPlayer() {
  player.y = clamp(player.y, SAFE_TOP + 78, VH - SAFE_BOT - 20);
  const L = xLimits(player.y);
  player.x = clamp(player.x, L[0], L[1]);
}
function clampTarget() {
  player.ty = clamp(player.ty, SAFE_TOP + 78, VH - SAFE_BOT - 20);
  const L = xLimits(player.ty);
  player.tx = clamp(player.tx, L[0], L[1]);
}

/* Brod ima masu: prst vuče cilj, telo ga sustiže oprugom sa prigušenjem.
   PS.inertia: 1 = bez stabilizatora, 0 = stabilizator na desetom nivou. */
function updateMovement(dt) {
  clampTarget();
  const q = PS ? PS.inertia : 1;
  if (q <= 0.001) {
    player.x = player.tx; player.y = player.ty;
    player.vx = 0; player.vy = 0;
    return;
  }
  const k = 60 + (1 - q) * 900;     // krutost: veći nivo = brod čvršće prati prst
  const z = 0.50 + 0.50 * (1 - q);  // prigušenje: bez stabilizatora brod prebacuje cilj
  const c = 2 * Math.sqrt(k) * z;
  // integracija u koracima od najviše 1/120 s — da jak trzaj ne razvali oprugu
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    left -= h;
    player.vx += (k * (player.tx - player.x) - c * player.vx) * h;
    player.vy += (k * (player.ty - player.y) - c * player.vy) * h;
    player.x += player.vx * h;
    player.y += player.vy * h;
  }
  const by = clamp(player.y, SAFE_TOP + 78, VH - SAFE_BOT - 20);
  if (by !== player.y) { player.y = by; player.vy = 0; }
  const L = xLimits(player.y);
  const bx = clamp(player.x, L[0], L[1]);
  if (bx !== player.x) { player.x = bx; player.vx = 0; }
}
function hitPause(x, y) {
  const s = 44, px = VW - s - 14, py = SAFE_TOP + 12;
  return x >= px - 8 && x <= px + s + 8 && y >= py - 8 && y <= py + s + 8;
}

/* ---------- UI ---------- */

function roundRect(c, x, y, w, h, r) {
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function text(str, x, y, size, color, align, glow, weight) {
  ctx.save();
  ctx.font = (weight || 700) + ' ' + size + 'px ' + FONT;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}
function btn(id, x, y, w, h, label, opt) {
  opt = opt || {};
  uiButtons.push({ id: id, x: x, y: y, w: w, h: h, enabled: opt.enabled !== false });
  if (opt.invisible) return;                 // samo dodirna zona, bez crtanja
  const col = opt.enabled === false ? C.uiDim : (opt.color || C.ui);
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = opt.enabled === false ? 0 : 12;
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); roundRect(ctx, x, y, w, h, opt.radius === undefined ? 8 : opt.radius);
  if (opt.fill) { ctx.globalAlpha = 0.14; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.stroke(); ctx.restore();
  text(label, x + w / 2, y + h / 2 + 1, opt.size || 20, col, 'center', opt.enabled === false ? 0 : 10);
}
function uiClick(x, y) {
  for (let i = uiButtons.length - 1; i >= 0; i--) {
    const b = uiButtons[i];
    if (!b.enabled) continue;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { onButton(b.id); return true; }
  }
  return false;
}
function showToast(t) { toast = t; toastT = 2.2; }
function lsize(base, letter) { return letter.length > 1 ? base * 0.58 : base; }

function onButton(id) {
  if (id === 'play') { startLevel(selLevel, selDiff); return; }
  if (id === 'shop') { shopMode = 'menu'; sel = null; screen = 'shop'; return; }
  if (id === 'persp') { persp = !persp; save.persp = persp; writeSave(); showToast(persp ? 'NAGNUTI PRIKAZ' : 'RAVAN PRIKAZ'); return; }
  if (id === 'levprev') { selLevel = Math.max(1, selLevel - 1); selDiff = clamp(selDiff, 1, maxDiff(selLevel)); return; }
  if (id === 'levnext') { selLevel = Math.min(save.unlocked, selLevel + 1); selDiff = clamp(selDiff, 1, maxDiff(selLevel)); return; }
  if (id === 'difprev') { selDiff = Math.max(1, selDiff - 1); return; }
  if (id === 'difnext') { selDiff = Math.min(maxDiff(selLevel), selDiff + 1); return; }
  if (id === 'resume') { screen = 'play'; return; }
  if (id === 'quit') {
    screen = 'menu'; selLevel = clamp(save.unlocked, 1, LEVELS.length);
    selDiff = clamp(diff, 1, maxDiff(selLevel)); return;
  }
  if (id === 'shopmain') { screen = 'menu'; return; }
  if (id.indexOf('slot_') === 0) {
    const i = parseInt(id.slice(5), 10);
    if (i !== slotIdx) { setActiveSlot(i); loadSave(); PS = buildShip(); }
    wipeAsk = -1;
    return;
  }
  if (id === 'slotgo') {
    setActiveSlot(slotIdx); loadSave(); PS = buildShip();
    selLevel = clamp(save.unlocked, 1, LEVELS.length);
    selDiff = clamp(selDiff, 1, maxDiff(selLevel));
    wipeAsk = -1; screen = 'menu';
    return;
  }
  if (id.indexOf('wipeyes_') === 0) {
    const i = parseInt(id.slice(8), 10);
    wipeSlot(i);
    if (i === slotIdx) { loadSave(); PS = buildShip(); }
    wipeAsk = -1;
    showToast('KAMPANJA ' + (i + 1) + ' OBRISANA');
    return;
  }
  if (id.indexOf('wipeno_') === 0) { wipeAsk = -1; return; }
  if (id.indexOf('wipe_') === 0) { wipeAsk = parseInt(id.slice(5), 10); return; }
  if (id === 'toslots') { wipeAsk = -1; screen = 'slots'; return; }
  if (id === 'endnext') { shopMode = endMode; sel = null; screen = 'shop'; return; }
  if (id === 'repair') {
    const cost = repairAllCost();
    if (save.coins < cost) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
    save.coins -= cost;
    save.dmg = {};
    writeSave(); PS = buildShip();
    showToast('SVI MODULI POPRAVLJENI');
    return;
  }
  if (id === 'repair1') {
    if (!sel || sel.kind !== 'slot' || !isDamaged(sel.idx)) return;
    const cost = repairCost(sel.idx);
    if (save.coins < cost) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
    save.coins -= cost;
    delete save.dmg[sel.idx];
    writeSave(); PS = buildShip();
    showToast(COMP[save.grid[sel.idx]].name + ' POPRAVLJEN');
    return;
  }
  if (id === 'retry') { startLevel(level, diff); return; }
  if (id === 'next') { const nl = Math.min(level + 1, LEVELS.length); startLevel(nl, Math.min(diff, maxDiff(nl))); return; }
  if (id === 'restartall') { startLevel(1, Math.min(diff, maxDiff(1))); return; }
  if (id.indexOf('tab_') === 0) { shopTab = id.slice(4); sel = null; return; }
  if (id === 'buy') { doBuy(); return; }
  if (id === 'levelup') { doLevelUp(); return; }
  if (id === 'store') { doStore(); return; }
  if (id === 'sell') {
    if (!sel || sel.kind !== 'stock') return;
    const a = save.stock[sel.type];
    if (!a || !a.length) return;
    const k = sel.si !== undefined && sel.si < a.length ? sel.si : 0;
    const lv = a[k];
    const v = sellValue(sel.type, lv);
    a.splice(k, 1);
    if (a.length === 0) delete save.stock[sel.type];
    save.coins += v;
    showToast(COMP[sel.type].name + ' PRODAT ZA ' + fmt(v));
    sel = null;
    after();
    return;
  }
  if (id === 'toggle') {
    if (!sel || sel.kind !== 'slot') return;
    const t = save.grid[sel.idx];
    if (!t || !isWeapon(t)) return;
    if (save.on[sel.idx] === false) {
      if (activeCount() >= weaponCap()) {
        showToast('KOPILOT PODNOSI SAMO ' + weaponCap() + ' ORUŽJA');
        return;
      }
      delete save.on[sel.idx];
      showToast(COMP[t].name + ' UKLJUČEN');
    } else {
      save.on[sel.idx] = false;
      showToast(COMP[t].name + ' ISKLJUČEN');
    }
    after();
    return;
  }
  if (id === 'mount') { doMount(); return; }
  if (id === 'unlock') { doUnlock(); return; }
  if (id === 'reset') {
    if (toast === 'RESET? DODIRNI PONOVO') {
      save = defaultSave(); writeSave(); PS = buildShip();
      selLevel = 1; selDiff = 1; sel = null; showToast('PROGRES OBRISAN');
    } else showToast('RESET? DODIRNI PONOVO');
  }
}

/* ---------- RADIONICA: AKCIJE ---------- */

function doBuy() {
  if (!sel || sel.kind !== 'shop') return;
  const t = sel.type, c = COMP[t];
  if (!bpUnlocked(t)) { showToast('TREBA TI ' + (BP_NEEDED - bpOf(t)) + ' NACRT(A) JOŠ'); return; }
  if (ownedTotal(t) >= (c.max || 1)) { showToast('DOSTIGNUT MAKSIMUM'); return; }
  if (save.coins < c.buy) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
  save.coins -= c.buy;
  const free = firstFreeSlot();
  if (free >= 0) { save.grid[free] = t; save.lv[free] = 1; autoEnable(free, t); showToast(c.name + ' UGRAĐEN'); }
  else { stockArr(t).push(1); showToast(c.name + ' → MAGACIN'); }
  after();
}

/* nivo izabranog dela: modul u rešetki ili konkretan komad u magacinu */
function selLevelRef() {
  if (!sel) return null;
  if (sel.kind === 'slot') {
    const t = save.grid[sel.idx];
    if (!t) return null;
    return { t: t, get: () => save.lv[sel.idx], set: v => { save.lv[sel.idx] = v; } };
  }
  if (sel.kind === 'stock') {
    const a = stockArr(sel.type);
    if (sel.si >= a.length) return null;
    return { t: sel.type, get: () => a[sel.si], set: v => { a[sel.si] = v; } };
  }
  return null;
}

function doLevelUp() {
  const ref = selLevelRef();
  if (!ref) return;
  const t = ref.t, c = COMP[t], lv = ref.get();
  if (lv < 1) { showToast('DEO NIJE KUPLJEN'); return; }
  if (lv >= UP_MAX) { showToast('MAKSIMALAN NIVO'); return; }
  if (lv >= cpuLv() && t !== 'cpu') { showToast('RAČUNAR JE PRESLAB'); return; }
  const cost = c.up[lv - 1];
  if (save.coins < cost) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
  save.coins -= cost;
  ref.set(lv + 1);
  showToast(c.name + ' → NIVO ' + (lv + 1));
  after();
}

function doStore() {
  if (!sel || sel.kind !== 'slot') return;
  const t = save.grid[sel.idx];
  if (!t || !canRemove(t)) { showToast('NE MOŽE SE SKINUTI'); return; }
  if (isDamaged(sel.idx)) { showToast('POKVAREN DEO — PRVO GA POPRAVI'); return; }
  stockArr(t).push(save.lv[sel.idx] || 1);
  save.grid[sel.idx] = null;
  save.lv[sel.idx] = 0;
  delete save.on[sel.idx];
  showToast(COMP[t].name + ' → MAGACIN');
  sel = null;
  after();
}

function doMount() {
  if (!sel || sel.kind !== 'stock') return;
  const free = firstFreeSlot();
  if (free < 0) { showToast('NEMA SLOBODNOG MODULA'); return; }
  const a = stockArr(sel.type);
  if (sel.si >= a.length) return;
  save.grid[free] = sel.type;
  save.lv[free] = a[sel.si];
  a.splice(sel.si, 1);
  if (a.length === 0) delete save.stock[sel.type];
  sel = null;
  showToast('UGRAĐENO');
  after();
}

function doUnlock() {
  if (!sel || sel.kind !== 'lock') return;
  if (save.slots >= TAB.modules[cpuLv()]) { showToast('RAČUNAR NE PODRŽAVA VIŠE MODULA'); return; }
  if (save.slots >= MAX_SLOTS) return;
  const cost = SLOT_COST[save.slots - 5];
  if (save.coins < cost) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
  save.coins -= cost;
  save.slots++;
  showToast('MODUL OTKLJUČAN');
  sel = null;
  after();
}
function after() { writeSave(); PS = buildShip(); }
function finishRun() {
  if (playTime > 3) lastAvgDraw = spentTotal / playTime;
  writeSave();
}

/* ---------- RADIONICA: PREVLAČENJE ---------- */

function slotAt(x, y) {
  if (!SL) return -1;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const c = SL.cells[i];
    if (x >= c.x && x <= c.x + c.s && y >= c.y && y <= c.y + c.s) return i;
  }
  return -1;
}
function listAt(x, y) {
  if (!SL) return -1;
  for (let i = 0; i < SL.rows.length; i++) {
    const r = SL.rows[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

function shopDown(p, pid) {
  if (uiClick(p.x, p.y)) return;
  const si = slotAt(p.x, p.y);
  if (si >= 0) {
    const t = save.grid[si];
    if (t) { sdrag = { id: pid, src: 'slot', type: t, idx: si, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false }; }
    else { sdrag = { id: pid, src: 'empty', idx: si, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false }; }
    return;
  }
  const li = listAt(p.x, p.y);
  if (li >= 0) {
    const r = SL.rows[li];
    const isStock = shopTab === 'stock';
    if (r.enabled) sdrag = { id: pid, src: isStock ? 'stock' : 'shop', type: r.type, si: r.si, x: p.x, y: p.y, sx: p.x, sy: p.y, moved: false };
    else { sel = { kind: isStock ? 'stock' : 'shop', type: r.type, si: r.si }; }
  }
}

function shopUp(p) {
  const d = sdrag;
  sdrag = null;
  if (!d) return;

  if (!d.moved) {   // tap
    if (d.src === 'slot') {
      if (sel && (sel.kind === 'shop' || sel.kind === 'stock')) { sel = { kind: 'slot', idx: d.idx, type: d.type }; }
      else sel = { kind: 'slot', idx: d.idx, type: d.type };
    } else if (d.src === 'empty') {
      if (sel && sel.kind === 'shop') { installFromShop(sel.type, d.idx); sel = null; }
      else if (sel && sel.kind === 'stock') { installFromStock(sel.type, sel.si, d.idx); sel = null; }
      else sel = slotUnlocked(d.idx) ? { kind: 'empty', idx: d.idx } : { kind: 'lock', idx: d.idx };
    } else {
      sel = { kind: d.src, type: d.type, si: d.si };
    }
    return;
  }

  const si = slotAt(p.x, p.y);
  if (si >= 0) {
    if (!slotUnlocked(si)) { showToast('MODUL ZAKLJUČAN'); return; }
    if (d.src === 'shop') { installFromShop(d.type, si); return; }
    if (d.src === 'stock') { installFromStock(d.type, d.si, si); return; }
    if (d.src === 'slot') {
      if (si === d.idx) return;
      const ot = save.grid[si], ol = save.lv[si], od = isDamaged(si), oo = save.on[si];
      const sd = isDamaged(d.idx), so = save.on[d.idx];
      save.grid[si] = d.type; save.lv[si] = save.lv[d.idx];
      save.grid[d.idx] = ot;  save.lv[d.idx] = ot ? ol : 0;
      if (sd) save.dmg[si] = true; else delete save.dmg[si];
      if (od && ot) save.dmg[d.idx] = true; else delete save.dmg[d.idx];
      if (so === false) save.on[si] = false; else delete save.on[si];
      if (oo === false && ot) save.on[d.idx] = false; else delete save.on[d.idx];
      after();
      return;
    }
    return;
  }
  if (SL && p.x > SL.right.x - 10 && d.src === 'slot') {
    if (!canRemove(d.type)) { showToast('NE MOŽE SE SKINUTI'); return; }
    stockArr(d.type).push(save.lv[d.idx] || 1);
    save.grid[d.idx] = null;
    save.lv[d.idx] = 0;
    delete save.on[d.idx];
    showToast(COMP[d.type].name + ' → MAGACIN');
    after();
  }
}

function autoEnable(si, t) {
  if (!isWeapon(t)) { delete save.on[si]; return; }
  // uključi samo ako kopilot to podnosi
  if (activeCount() < weaponCap()) delete save.on[si];
  else save.on[si] = false;
}

/* Novi deo prevučen preko zauzetog modula: stari automatski ide u magacin. */
function displaceTo(si) {
  const old = save.grid[si];
  if (!old) return true;
  if (!canRemove(old)) { showToast(COMP[old].name + ' SE NE MOŽE SKINUTI'); return false; }
  if (isDamaged(si)) { showToast('POKVAREN DEO — PRVO GA POPRAVI'); return false; }
  stockArr(old).push(save.lv[si] || 1);
  save.grid[si] = null;
  save.lv[si] = 0;
  delete save.on[si];
  showToast(COMP[old].name + ' → MAGACIN');
  return true;
}

function installFromShop(t, si) {
  if (!displaceTo(si)) return;
  if (!bpUnlocked(t)) { showToast('TREBA TI ' + (BP_NEEDED - bpOf(t)) + ' NACRT(A) JOŠ'); return; }
  const c = COMP[t];
  if (ownedTotal(t) >= (c.max || 1)) { showToast('DOSTIGNUT MAKSIMUM'); return; }
  if (save.coins < c.buy) { showToast('NEMA DOVOLJNO NOVČIĆA'); return; }
  save.coins -= c.buy;
  save.grid[si] = t;
  save.lv[si] = 1;
  autoEnable(si, t);
  showToast(c.name + ' UGRAĐEN' + (save.on[si] === false ? ' (isključen — kopilot je pun)' : ''));
  after();
}
function installFromStock(t, sidx, si) {
  if (!displaceTo(si)) return;
  const a = stockArr(t);
  const k = (sidx === undefined || sidx >= a.length) ? 0 : sidx;
  if (a.length === 0) return;
  save.grid[si] = t;
  save.lv[si] = a[k];
  a.splice(k, 1);
  if (a.length === 0) delete save.stock[t];
  autoEnable(si, t);
  showToast(COMP[t].name + ' UGRAĐEN' + (save.on[si] === false ? ' (isključen)' : ''));
  after();
}

/* ---------- POKRETANJE NIVOA ---------- */

function startLevel(n, d) {
  level = clamp(n, 1, LEVELS.length);
  levelDef = LEVELS[level - 1];
  diff = clamp(d || 1, 1, maxDiff(level));
  dHp = diffHp(diff); dDmg = diffDmg(diff); dSpd = diffSpd(diff); dCoin = diffCoin(diff);
  PS = buildShip();
  if (!trKeepBg) initBackdrop(level);
  trKeepBg = false;
  bullets.length = ebullets.length = enemies.length = pickups.length = particles.length = rockets.length = mines.length = 0;
  blasts.length = 0; bolts.length = 0; rings.length = 0; holes.length = 0; emps.length = 0; sweeps.length = 0; rocks.length = 0; pulses.length = 0; antis.length = 0;
  drones.length = 0;
  if (PS.hasDrone) for (let i = 0; i < PS.drN; i++) drones.push(mkDrone(i));
  waveIdx = 0; waveTimer = levelDef.waves[0].gap || 1; waveActive = false;
  pendingSpawns.length = 0;
  levelDone = false; doneTimer = 0; runCoins = 0;
  bossRef = null; shake = 0; flash = 0;
  player.maxHp = PS.hullMax;
  player.hp = player.maxHp;   // računar se ne oštećuje, pa maxHp ostaje isti ceo nivo
  player.shield = PS.shieldMax;
  player.pu = {};
  player.inv = 1.0; player.alive = true; player.fireCd = 0; player.tilt = 0; player.moving = 0;
  player.tCd = new Array(PS.turrets).fill(0);
  player.buCd = new Array(PS.burstLv.length).fill(0);
  player.buLeft = new Array(PS.burstLv.length).fill(0);
  player.buShot = new Array(PS.burstLv.length).fill(0);
  player.brCd = PS.hasBranch ? PS.brInt * 0.5 : 0;
  player.hkCd = PS.hasHack ? PS.hkInt * 0.45 : 0;
  player.plCd = PS.hasPulse ? PS.plInt * 0.4 : 0;
  player.amCd = PS.hasAnti ? PS.amInt * 0.5 : 0;
  player.rkCd = PS.hasRocket ? PS.rkInt * 0.5 : 0; player.repairing = 0;
  player.x = VW / 2; player.y = VH - SAFE_BOT - 210;   // brod stoji nešto dublje ka sredini
  player.tx = player.x; player.ty = player.y; player.vx = 0; player.vy = 0;
  /* Ulazak u misiju: brod dolazi iz warpa odozdo, iza donje ivice. */
  player.warp = 'in'; player.warpT = 0;
  player.warpFrom = VH + 120;
  player.warpTo = player.y;
  player.y = player.warpFrom; player.ty = player.y;
  player.trail.length = 0; player.trailT = 0;
  energy = PS.energyMax; brownout = false; brownFlash = 0; shieldPause = 0;
  /* Radijacija se puni po talasima, ne po sekundama — svaki nivo daje isto,
     bez obzira koliko dugo traje. */
  rad = 0; radFlash = 0;
  radGoal = PS.radCap;
  radStep = levelDef.waves.length > 0 ? radGoal / levelDef.waves.length : 0;
  spentTotal = 0; playTime = 0; repairPause = 0;
  // tačno jedan nacrt po nivou i stepenu težine, i to samo ako ga tu još nisi dobio
  killCount = 0; bpTarget = -1; bpType = null; runBp = null;
  /* Brojač pragova se resetuje samo kad se kreće iz garaže. Kroz vezani niz
     oklop se ne obnavlja, pa bi resetovanje značilo da se isti pragovi
     okidaju iznova u svakoj misiji. */
  if (chainCount === 0) { dmgStage = 0; runDmg = []; }
  dmgFlash = 0;
  /* Kroz niz vezanih misija skupljeni nacrti se pamte do sletanja,
     da bi ih pregled na kraju prikazao sve, a ne samo poslednji. */
  if (chainCount === 0) { runBpAll = []; runHeavyAll = []; }
  runBp = null; runHeavyBp = null;
  askExit = 0;
  levelCommitted = false;
  // 2-3 grupe meteora po misiji, prva ne odmah na početku
  rockRuns = rndi(2, 3);
  rockRunCd = rnd(8, 13);
  rockBurst = 0; rockBurstCd = 0;
  if (!save.bpDone[level + ':' + diff]) {
    const pool = bpWindow(BP_ORDER);
    if (pool.length) { bpType = pool[rndi(0, pool.length - 1)]; bpTarget = rndi(3, 20); }
  }
  /* Nacrti za teško naoružanje padaju samo sa bosova, i to nezavisno
     od toga da li si na tom nivou već pokupio običan nacrt. */
  /* Teški nacrt se, kao i obični, dobija jednom po nivou i stepenu težine.
     Bez toga bi se isti boss mogao vrteti unedogled zbog nacrta. */
  heavyBp = null;
  if (!save.bpHeavyDone[level + ':' + diff]) {
    const hpool = bpWindow(BP_ORDER_HEAVY);
    if (hpool.length) heavyBp = hpool[rndi(0, hpool.length - 1)];
  }
  player.lsCd = PS.hasLaser ? PS.lsInt * 0.6 : 0; player.lsOn = 0;
  player.sgCd = 0; player.sgFlash = 0; player.leashHint = 0;
  player.boCd = PS.hasBolt ? PS.boltInt * 0.4 : 0;
  clampPlayer();
  dragId = null; firing = false;
  screen = 'play';
}

/* ---------- TALASI ---------- */

function launchWave(w) {
  pendingSpawns.length = 0;
  if (w.boss || w.boss2 || w.boss3 || w.boss4 || w.boss5 || w.boss6) {
    const bt = w.boss6 ? 'boss6' : (w.boss5 ? 'boss5' : (w.boss4 ? 'boss4' : (w.boss3 ? 'boss3' : (w.boss2 ? 'boss2' : 'boss'))));
    pendingSpawns.push({ t: 0, type: bt, x: VW / 2, vpat: 0 });
    waveActive = true; waveTimer = 0; return;
  }
  w.spawn.forEach(function (s) {
    const pattern = s.pattern || 'line';
    for (let i = 0; i < s.n; i++) {
      let x;
      if (pattern === 'rand') x = rnd(50, VW - 50);
      else if (pattern === 'v') {
        const t = s.n === 1 ? 0 : (i / (s.n - 1)) * 2 - 1;
        x = VW * s.dx + t * (s.spread * VW) / 2;
      } else {
        const t = s.n === 1 ? 0.5 : i / (s.n - 1);
        x = VW * (s.dx + (t - 0.5) * s.spread);
      }
      pendingSpawns.push({
        t: (s.delay || 0) + i * (s.every || 0.3), type: s.t, x: clamp(x, 40, VW - 40),
        vpat: pattern === 'v' ? Math.abs(s.n === 1 ? 0 : (i / (s.n - 1)) * 2 - 1) : 0
      });
    }
  });
  pendingSpawns.sort((a, b) => a.t - b.t);
  waveActive = true; waveTimer = 0;
}

function updateWaves(dt) {
  if (levelDone) return;
  if (!waveActive) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      if (waveIdx >= levelDef.waves.length) { levelDone = true; doneTimer = 2.0; return; }
      launchWave(levelDef.waves[waveIdx]);
    }
    return;
  }
  waveTimer += dt;
  for (let i = pendingSpawns.length - 1; i >= 0; i--) {
    const s = pendingSpawns[i];
    if (waveTimer >= s.t) { spawnEnemy(s.type, s.x, (persp ? -WARP_DEPTH * 0.92 : -40) - s.vpat * 70); pendingSpawns.splice(i, 1); }
  }
  if (pendingSpawns.length === 0 && enemies.length === 0) {
    waveActive = false; waveIdx++;
    if (radStep > 0) {
      const pre = Math.floor(rad / RAD_PER_SHOT);
      rad = Math.min(radGoal, rad + radStep);
      if (Math.floor(rad / RAD_PER_SHOT) > pre) { radFlash = 1.4; showToast('TEŠKO ORUŽJE SPREMNO'); }
    }
    waveTimer = waveIdx < levelDef.waves.length ? (levelDef.waves[waveIdx].gap || 1) : 1.2;
  }
}

/* ---------- NEPRIJATELJI ---------- */

function spawnEnemy(type, x, y) {
  const d = ENEMY[type];
  const mul = 1 + (level - 1) * 0.22;
  const e = {
    type: type, x: x, y: y, r: d.r, w: d.w, h: d.h, color: d.color,
    hp: Math.round(d.hp * (type === 'boss' ? 1 : mul) * dHp), speed: d.speed * dSpd,
    coin: Math.max(1, Math.round(d.coin * dCoin)), ram: Math.round(d.ram * dDmg),
    flash: 0, t: rnd(0, 6), phase: 1,
    fireCd: rnd(0.8, 2.0), baseX: x, dir: Math.random() < 0.5 ? -1 : 1, state: 'in', hover: 0
  };
  e.maxHp = e.hp;
  if (isBoss(e)) {
    e.hp = e.maxHp = Math.round(d.hp * (1 + (level - 1) * 0.15) * dHp);
    e.y = persp ? -WARP_DEPTH * 0.9 : -150; bossRef = e;
    if (type === 'boss2') {
      e.laser = { state: 'idle', t: 3.0, x: VW / 2, dir: 1 };
      e.bayCd = 3.0;
    }
    if (type === 'boss5') {
      e.invuln = true; e.hide = true; e.r = 0; e.w = e.h = 2;
      e.cx = VW / 2; e.cy = -60; e.ang = 0; e.rad = 112; e.beam = false; e.bayCd = 7;
      e.twins = [];
      const thp = Math.round(3600 * (1 + (level - 1) * 0.15) * dHp);
      for (let k = 0; k < 2; k++) {
        const t = spawnEnemy('twin', VW / 2 + (k ? 110 : -110), -160);
        t.hp = t.maxHp = thp;
        t.twin = true; t.host = e; t.tidx = k; t.down = false; t.reviveT = 0;
        t.fireCd = 1.6 + k * 0.9;
        e.twins.push(t);
      }
    }
    if (type === 'boss4') {
      const rhp = Math.round(1700 * (1 + (level - 1) * 0.15) * dHp);
      e.ring = { ang: Math.PI / 2, gap: 2.08, spd: 0.45, dir: 1, t: 4, hp: rhp, maxHp: rhp };
      e.ringHit = 0; e.bayCd = 6; e.dive = null; e.phase = 1;
    }
    if (type === 'boss3') {
      e.invuln = true; e.bayCd = 5.0; e.pods = [];
      const defs = [{ k: 'left', ox: -105, oy: 40 }, { k: 'top', ox: 0, oy: 52 }, { k: 'right', ox: 105, oy: 40 }];
      for (const d2 of defs) {
        const p = spawnEnemy('pod', e.x + d2.ox, e.y + d2.oy);
        p.host = e; p.ox = d2.ox; p.oy = d2.oy; p.pod = d2.k;
        p.fireCd = rnd(0.8, 2.2);
        e.pods.push(p);
      }
    }
  }
  if (type === 'shooter') e.hover = rnd(0.30, 0.46) * VH;
  if (type === 'weaver') e.amp = Math.max(30, Math.min(95, Math.min(x - 34, VW - 34 - x)));
  if (type === 'swarm') { e.amp = Math.max(20, Math.min(70, Math.min(x - 28, VW - 28 - x))); e.ph = rnd(0, 6); }
  if (type === 'miner') { e.hover = rnd(0.32, 0.46) * VH; e.fireCd = rnd(1.0, 2.0); }
  if (type === 'splitter') { e.gen = 0; e.vx = rnd(-18, 18); }
  if (type === 'charger') { e.hover = rnd(0.27, 0.42) * VH; e.dash = 'idle'; e.dashT = rnd(1.2, 2.6); }
  if (type === 'mirror') { e.hover = rnd(0.28, 0.42) * VH; e.heat = 0; e.cool = 0; e.fireCd = rnd(1.5, 2.6); }
  if (type === 'bomber') { e.hover = rnd(0.26, 0.40) * VH; e.bombCd = rnd(1.4, 2.6); }
  if (type === 'phoenix') { e.rebirth = 1; e.reb = 0; }
  if (type === 'phantom') { e.ghost = 0; e.ghCd = rnd(1.6, 2.8); e.fireCd = rnd(1.2, 2.2); }
  if (type === 'healer') { e.hover = rnd(0.26, 0.38) * VH; e.link = null; }
  if (type === 'sniper') {
    e.hover = rnd(0.24, 0.34) * VH; e.aim = 'idle'; e.aimT = rnd(1.0, 2.4);
    e.lx = 0; e.ly = 0;
  }
  if (type === 'shieldbearer') {
    e.plateMax = Math.round(ENEMY.shieldbearer.plate * mul * dHp);
    e.plate = e.plateMax; e.plateDown = 0; e.plateHit = 0;
    e.hover = rnd(0.28, 0.40) * VH; e.fireCd = rnd(1.6, 2.6);
  }
  enemies.push(e);
  return e;
}

function mkEb(x, y, vx, vy, dmg, color, extra) {
  if (persp && y < 0) return { x: x, y: y, vx: 0, vy: 0, dmg: 0, r: 0, dead: true };
  const b = { x: x, y: y, vx: vx, vy: vy, dmg: Math.round(dmg * dDmg), r: 6, color: color || '#ff5566' };
  if (extra) for (const k in extra) b[k] = extra[k];
  return b;
}
function aimShot(e, spd, dmg) {
  const dx = player.x - e.x, dy = player.y - e.y;
  const l = Math.hypot(dx, dy) || 1;
  ebullets.push(mkEb(e.x, e.y + e.h / 2, dx / l * spd, dy / l * spd, dmg, e.color));
}

const removeQueue = [];

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e) continue;              // niz se mogao skratiti tokom prolaza
    e.t += dt;

    if (e.hacked) { updateHacked(e, dt); continue; }
    /* Vreme u borbi — bočno kretanje kreće od nule po izlasku iz warpa,
       inače protivnik na ulasku skoči u stranu. */
    if (e.y >= 0 && e.bt === undefined) e.bt = 0;
    if (e.bt !== undefined) e.bt += dt;

    /* Warp: kroz pojas iznad horizonta juri velikom brzinom i usporava do y=0,
       gde ulazi u borbu. Ostatak ponašanja se ne dira. */
    if (inWarp(e.y) && !isBoss(e) && e.type !== 'pod' && e.type !== 'twin') {
      const t = warpT(e.y);
      e.y += (4200 * (1 - t) + 260) * dt;
      if (e.y > 0) e.y = 0;
      continue;
    }
    if (e.flash > 0) e.flash -= dt;

    switch (e.type) {
      case 'grunt': e.y += e.speed * dt; break;
      case 'weaver': e.y += e.speed * dt; e.x = e.baseX + Math.sin((e.bt || 0) * 2.2) * e.amp * clamp((e.bt || 0) * 2.2, 0, 1); break;
      case 'shooter':
        if (e.y < e.hover) e.y += e.speed * dt;
        else {
          e.x += e.dir * 55 * dt;
          if (e.x < 50) { e.x = 50; e.dir = 1; }
          if (e.x > VW - 50) { e.x = VW - 50; e.dir = -1; }
          e.fireCd -= dt;
          if (e.fireCd <= 0) { e.fireCd = rnd(1.4, 2.2); aimShot(e, 260, 10); }
        }
        break;
      case 'tank':
        e.y += e.speed * dt;
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 0) {
          e.fireCd = rnd(2.0, 2.8);
          for (let k = -1; k <= 1; k++)
            ebullets.push(mkEb(e.x, e.y + e.h / 2, Math.sin(k * 0.35) * 200, Math.cos(k * 0.35) * 200, 12, e.color));
        }
        break;
      case 'swarm':
        e.y += e.speed * dt;
        e.x = e.baseX + Math.sin((e.bt || 0) * 3.1 + (e.ph || 0)) * e.amp * clamp((e.bt || 0) * 2.2, 0, 1);
        break;
      case 'shieldbearer':
        if (e.y < e.hover) e.y += e.speed * dt;
        else {
          e.x += e.dir * 62 * dt;
          if (e.x < 60) { e.x = 60; e.dir = 1; }
          if (e.x > VW - 60) { e.x = VW - 60; e.dir = -1; }
        }
        if (e.plateDown > 0) e.plateDown -= dt;
        if (e.plateHit > 0) e.plateHit -= dt;
        if (e.plateDown <= 0 && e.plateHit <= 0 && e.plate < e.plateMax)
          e.plate = Math.min(e.plateMax, e.plate + 15 * dt);
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 40) {
          e.fireCd = 2.2;
          e.plateDown = 0.9;
          aimShot(e, 280, 12);
        }
        break;
      case 'splitter':
        e.y += e.speed * dt;
        e.x += (e.vx || 0) * dt;
        if (e.x < 26) { e.x = 26; e.vx = Math.abs(e.vx || 10); }
        if (e.x > VW - 26) { e.x = VW - 26; e.vx = -Math.abs(e.vx || 10); }
        break;
      case 'healer':
        if (e.y < e.hover) e.y += e.speed * dt;
        else {
          e.x += e.dir * 50 * dt;
          if (e.x < 55) { e.x = 55; e.dir = 1; }
          if (e.x > VW - 55) { e.x = VW - 55; e.dir = -1; }
        }
        e.link = null;
        if (e.y >= e.hover - 20) {
          let best = null, bw = 0;
          for (const o of enemies) {
            if (o === e || o.type === 'healer' || o.invuln) continue;
            if (o.hp >= o.maxHp) continue;
            const dx = o.x - e.x, dy = o.y - e.y;
            if (dx * dx + dy * dy > 260 * 260) continue;
            const need = 1 - o.hp / o.maxHp;
            if (need > bw) { bw = need; best = o; }
          }
          if (best) {
            e.link = best;
            best.hp = Math.min(best.maxHp, best.hp + 14 * (1 + (level - 1) * 0.1) * dt);
            if (Math.random() < 0.25)
              particles.push({ x: best.x + rnd(-10, 10), y: best.y + rnd(-10, 10), vx: 0, vy: -30,
                               life: 0.35, max: 0.4, color: ENEMY.healer.color, size: 2 });
          }
        }
        break;
      case 'charger':
        if (e.dash === 'idle') {
          if (e.y < e.hover) e.y += e.speed * dt;
          else {
            e.x += e.dir * 60 * dt;
            if (e.x < 50) { e.x = 50; e.dir = 1; }
            if (e.x > VW - 50) { e.x = VW - 50; e.dir = -1; }
          }
          e.dashT -= dt;
          if (e.dashT <= 0 && e.y >= e.hover - 10) {
            e.dash = 'warn'; e.dashT = 0.65;
            e.tx = player.x; e.ty = player.y;
          }
        } else if (e.dash === 'warn') {
          e.dashT -= dt;
          e.tx = player.x; e.ty = player.y;
          const dx = e.tx - e.x, dy = e.ty - e.y, l = Math.hypot(dx, dy) || 1;
          e.ax = dx / l; e.ay = dy / l;
          if (e.dashT <= 0) { e.dash = 'go'; e.dashT = 2.2; burst(e.x, e.y, e.color, 10, 160); }
        } else {
          e.x += e.ax * 620 * dt;
          e.y += e.ay * 620 * dt;
          e.dashT -= dt;
          if (Math.random() < 0.5)
            particles.push({ x: e.x + rnd(-8, 8), y: e.y + rnd(-8, 8), vx: 0, vy: -40,
                             life: 0.25, max: 0.3, color: e.color, size: 2 });
        }
        break;
      case 'bomber': updateBomber(e, dt); break;
      case 'phoenix': updatePhoenix(e, dt); break;
      case 'phantom': updatePhantom(e, dt); break;
      case 'mirror':
        if (e.y < e.hover) e.y += e.speed * dt;
        else {
          e.x += e.dir * 52 * dt;
          if (e.x < 55) { e.x = 55; e.dir = 1; }
          if (e.x > VW - 55) { e.x = VW - 55; e.dir = -1; }
        }
        if (e.cool > 0) {
          e.cool -= dt;
          if (e.cool <= 0) e.heat = 0;
        }
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 30) { e.fireCd = rnd(2.0, 3.0); aimShot(e, 270, 12); }
        break;
      case 'miner':
        if (e.y < e.hover) e.y += e.speed * dt;
        else {
          e.x += e.dir * 48 * dt;
          if (e.x < 55) { e.x = 55; e.dir = 1; }
          if (e.x > VW - 55) { e.x = VW - 55; e.dir = -1; }
        }
        e.fireCd -= dt;
        if (e.fireCd <= 0 && e.y > 30) {
          e.fireCd = rnd(1.2, 1.8);
          dropMine(e.x, e.y + e.h / 2, 26, 4.5);
        }
        break;
      case 'sniper':
        if (e.y < e.hover) { e.y += e.speed * dt; break; }
        if (e.aim !== 'lock') {
          e.x += e.dir * 42 * dt;
          if (e.x < 50) { e.x = 50; e.dir = 1; }
          if (e.x > VW - 50) { e.x = VW - 50; e.dir = -1; }
        }
        e.aimT -= dt;
        if (e.aim === 'idle') {
          if (e.aimT <= 0) { e.aim = 'track'; e.aimT = 1.0; }
        } else if (e.aim === 'track') {
          e.lx = player.x; e.ly = player.y;
          if (e.aimT <= 0) { e.aim = 'lock'; e.aimT = 0.45; }
        } else {
          if (e.aimT <= 0) {
            e.aim = 'idle'; e.aimT = 2.6;
            const mx = e.x, my = e.y + e.h / 2;          // pravac se računa iz cevi, ne iz centra
            const dx = e.lx - mx, dy = e.ly - my, l = Math.hypot(dx, dy) || 1;
            const eb = mkEb(mx, my, dx / l * 3200, dy / l * 3200, 18, e.color);
            eb.tracer = 1; eb.r = 7;
            ebullets.push(eb);
            burst(e.x, e.y + e.h / 2, e.color, 5, 120);
          }
        }
        break;
      case 'pod':
        updatePod(e, dt);
        break;
      case 'boss3': updateBoss3(e, dt); break;
      case 'boss4': updateBoss4(e, dt); break;
      case 'boss5': updateBoss5(e, dt); break;
      case 'boss6': updateBoss6(e, dt); break;
      case 'boss': updateBoss(e, dt); break;
      case 'boss2': updateBoss2(e, dt); break;
    }

    if (e.y - e.h > VH + 40 || e.x < -140 || e.x > VW + 140) {
      if (!isBoss(e)) { enemies.splice(i, 1); continue; }
    }

    if (player.alive && player.inv <= 0 && !e.down && !e.hide && !warpSafe(e) && !e.hacked) {
      const rr = e.r + player.r;
      if (dist2(e, player) < rr * rr) {
        hurtPlayer(e.ram);
        if (!isBoss(e) && e.type !== 'tank') { killEnemy(i, false); continue; }
        else if (e.type === 'tank') damageEnemy(e, 40);
      }
    }
  }
  flushRemoveQueue();
}

function flushRemoveQueue() {
  while (removeQueue.length) {
    const r = removeQueue.shift();
    const i = enemies.indexOf(r.e);
    if (i < 0) continue;
    if (r.drops) killEnemy(i, true);
    else enemies.splice(i, 1);
  }
}

function updateBoss(e, dt) {
  if (e.state === 'in') {
    e.y += (persp ? 150 : 90) * dt;
    if (e.y >= 265) { e.y = 265; e.state = 'fight'; }
    return;
  }
  const f = e.hp / e.maxHp;
  e.phase = f > 0.66 ? 1 : (f > 0.33 ? 2 : 3);
  const sp = e.phase === 1 ? 70 : (e.phase === 2 ? 110 : 150);
  e.x += e.dir * sp * dt;
  if (e.x < 100) { e.x = 100; e.dir = 1; }
  if (e.x > VW - 100) { e.x = VW - 100; e.dir = -1; }
  e.y = 265 + Math.sin(e.t * 1.1) * 26;

  e.fireCd -= dt;
  if (e.fireCd > 0) return;

  if (e.phase === 1) {
    e.fireCd = 1.8;
    for (let k = -2; k <= 2; k++)
      ebullets.push(mkEb(e.x, e.y + 50, Math.sin(k * 0.22) * 230, Math.cos(k * 0.22) * 230, 12, e.color));
  } else if (e.phase === 2) {
    e.fireCd = 1.4;
    aimShot(e, 250, 12); aimShot(e, 310, 12); aimShot(e, 380, 12);
    for (let k = -3; k <= 3; k++)
      ebullets.push(mkEb(e.x, e.y + 50, Math.sin(k * 0.20) * 200, Math.cos(k * 0.20) * 200, 10, e.color));
  } else {
    e.fireCd = 0.28;
    const a = e.t * 2.4;
    for (let k = 0; k < 3; k++) {
      const ang = a + k * (Math.PI * 2 / 3);
      ebullets.push(mkEb(e.x, e.y + 20, Math.cos(ang) * 210, Math.abs(Math.sin(ang)) * 150 + 90, 10, e.color));
    }
    e.summonCd = (e.summonCd || 5) - 0.28;
    if (e.summonCd <= 0) {
      e.summonCd = 6;
      spawnEnemy('grunt', rnd(60, VW - 60), -40);
      spawnEnemy('grunt', rnd(60, VW - 60), -40);
    }
  }
}

function updateBoss2(e, dt) {
  if (e.state === 'in') {
    e.y += 80 * dt;
    if (e.y >= 240) { e.y = 240; e.state = 'fight'; }
    return;
  }
  const f = e.hp / e.maxHp;
  e.phase = f > 0.66 ? 1 : (f > 0.33 ? 2 : 3);
  const L = e.laser;

  // kretanje (miruje dok laser gori)
  if (L.state !== 'fire') {
    const sp = e.phase === 1 ? 55 : (e.phase === 2 ? 80 : 100);
    e.x += e.dir * sp * dt;
    if (e.x < 118) { e.x = 118; e.dir = 1; }
    if (e.x > VW - 118) { e.x = VW - 118; e.dir = -1; }
  }
  e.y = 240 + Math.sin(e.t * 0.9) * 16;

  // laser (od druge faze)
  L.t -= dt;
  if (e.phase >= 2) {
    if (L.state === 'idle' && L.t <= 0) {
      L.state = 'warn'; L.t = 1.1;
      L.dir = Math.random() < 0.5 ? 1 : -1;
      L.x = L.dir > 0 ? 40 : VW - 40;
    } else if (L.state === 'warn' && L.t <= 0) {
      L.state = 'fire'; L.t = e.phase === 3 ? 1.7 : 2.1;
      L.speed = (VW - 80) / L.t;
    } else if (L.state === 'fire') {
      L.x += L.dir * L.speed * dt;
      if (L.t <= 0) { L.state = 'idle'; L.t = e.phase === 3 ? 3.4 : 4.6; }
      if (player.alive && player.inv <= 0 && player.y > e.y + 20) {
        const rr = 18 + player.r;
        if (segDist2(player.x, player.y, e.x, e.y + 30, L.x, VH) < rr * rr)
          hurtPlayer(Math.round(28 * dDmg));
      }
    }
  }

  // hangari
  e.bayCd -= dt;
  if (e.bayCd <= 0 && L.state !== 'fire') {
    e.bayCd = e.phase === 1 ? 4.2 : (e.phase === 2 ? 6.0 : 4.6);
    const kind = e.phase === 3 ? 'swarm' : 'grunt';
    const n = e.phase === 3 ? 5 : 3;
    for (let k = 0; k < n; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const en = spawnEnemy(kind, clamp(e.x + side * 78 + rnd(-12, 12), 40, VW - 40), e.y + 26);
      en.baseX = en.x;
      burst(en.x, en.y, e.color, 6, 120);
    }
  }

  // vatra
  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  if (e.phase === 1) {
    e.fireCd = 2.2;
    for (let k = -3; k <= 3; k++)
      ebullets.push(mkEb(e.x, e.y + 55, Math.sin(k * 0.19) * 215, Math.cos(k * 0.19) * 215, 12, e.color));
  } else if (e.phase === 2) {
    e.fireCd = 1.7;
    aimShot(e, 270, 13); aimShot(e, 340, 13);
    for (let k = -2; k <= 2; k++)
      ebullets.push(mkEb(e.x - 70, e.y + 40, Math.sin(k * 0.24) * 195, Math.cos(k * 0.24) * 195, 11, e.color));
    for (let k = -2; k <= 2; k++)
      ebullets.push(mkEb(e.x + 70, e.y + 40, Math.sin(k * 0.24) * 195, Math.cos(k * 0.24) * 195, 11, e.color));
  } else {
    e.fireCd = 0.85;
    const a = e.t * 1.9;
    for (let k = 0; k < 5; k++) {
      const ang = a + k * (Math.PI * 2 / 5);
      ebullets.push(mkEb(e.x, e.y + 30, Math.cos(ang) * 200, Math.abs(Math.sin(ang)) * 140 + 105, 11, e.color));
    }
    aimShot(e, 360, 13);
  }
}

/* Snop se okreće oko Nosača: gornji kraj je na njemu, donji šara s kraja na kraj.
   Uz sam boss je otvor u kom se laser može izbeći. */
function beamQuad(x0, y0, x1, y1, halfW) {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l * halfW, ny = dx / l * halfW;
  const N = 12, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const wx = x0 + dx * t, wy = y0 + dy * t;
    L.push([pX(wx + nx, wy + ny), pY(wy + ny)]);
    R.push([pX(wx - nx, wy - ny), pY(wy - ny)]);
  }
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = N; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
}

function drawBoss2Laser(e) {
  const L = e.laser;
  if (!L || L.state === 'idle') return;
  const x0 = e.x, y0 = e.y + 30;
  ctx.save();
  if (L.state === 'warn') {
    ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(performance.now() / 70));
    ctx.strokeStyle = e.color; ctx.lineWidth = 2;
    ctx.shadowColor = e.color; ctx.shadowBlur = 12;
    worldPath(x0, y0, L.x, VH, 16);
    ctx.stroke();
  } else {
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = e.color; ctx.shadowBlur = 26;
    ctx.fillStyle = e.color;
    beamQuad(x0, y0, L.x, VH, 15); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    beamQuad(x0, y0, L.x, VH, 4.5); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.ellipse(pX(x0, y0), pY(y0), 26 * pS(y0), 26 * pS(y0) * (persp ? 0.62 : 1), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function updatePod(e, dt) {
  const h = e.host;
  if (!h || enemies.indexOf(h) < 0) { e.hp = 0; return; }
  e.x = h.x + e.ox; e.y = h.y + e.oy;
  if (h.state === 'in') return;
  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  if (e.pod === 'left') {
    e.fireCd = 2.4;
    for (let k = -3; k <= 3; k++)
      ebullets.push(mkEb(e.x, e.y + 20, Math.sin(k * 0.21) * 210, Math.cos(k * 0.21) * 210, 12, e.color));
  } else if (e.pod === 'right') {
    e.fireCd = 1.9;
    aimShot(e, 300, 13); aimShot(e, 370, 13);
  } else {
    e.fireCd = 0.7;
    const a = e.t * 2.2;
    for (let k = 0; k < 4; k++) {
      const ang = a + k * (Math.PI / 2);
      ebullets.push(mkEb(e.x, e.y, Math.cos(ang) * 195, Math.abs(Math.sin(ang)) * 130 + 95, 11, e.color));
    }
  }
}

/* ============================================================
   KOVAČNICA (nivo 18) — poslednji boss.
   Kuje oklopne ploče koje ga štite; dok ploče stoje, jezgro je
   neranjivo. Ploče se ruše pojedinačno, pa se kuju iznova.
   ============================================================ */
function updateBoss6(e, dt) {
  if (e.state === 'in') {
    e.y += (persp ? 150 : 95) * dt;
    if (e.y >= 250) { e.y = 250; e.state = 'fight'; e.plates = []; e.forge = 1.2; }
    return;
  }
  if (!e.plates) { e.plates = []; e.forge = 1.2; }

  const f = e.hp / e.maxHp;
  e.phase = f > 0.66 ? 1 : (f > 0.33 ? 2 : 3);

  e.x = VW / 2 + Math.sin(e.t * (0.5 + e.phase * 0.16)) * 128;
  e.y = 250 + Math.sin(e.t * 0.8) * 22;

  // ploče kruže oko jezgra
  const zive = e.plates.filter(p => p.hp > 0);
  e.invuln = zive.length > 0;
  const maxPloca = e.phase === 3 ? 5 : (e.phase === 2 ? 4 : 3);
  e.forge -= dt;
  if (e.forge <= 0 && zive.length < maxPloca) {
    e.forge = e.phase === 3 ? 2.4 : 3.4;
    e.plates.push({ ang: rnd(0, Math.PI * 2), hp: Math.round(760 * dHp), maxHp: Math.round(760 * dHp) });
    burst(e.x, e.y, e.color, 16, 200);
  }
  for (const p of e.plates) p.ang += (0.7 + e.phase * 0.24) * dt;
  e.plates = e.plates.filter(p => p.hp > 0);

  // paljba
  e.fireCd = (e.fireCd === undefined ? 1.4 : e.fireCd) - dt;
  if (e.fireCd <= 0) {
    e.fireCd = e.phase === 3 ? 0.85 : (e.phase === 2 ? 1.15 : 1.5);
    const n = 2 + e.phase;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.30;
      ebullets.push(mkEb(e.x, e.y + 40, Math.cos(a) * 300, Math.abs(Math.sin(a)) * 120 + 300,
                         Math.round(15 * dDmg), e.color));
    }
    if (e.phase >= 2) aimShot(e, 360, Math.round(16 * dDmg));
  }

  // pojačanja i mine
  e.bayCd = (e.bayCd === undefined ? 8 : e.bayCd) - dt;
  if (e.bayCd <= 0) {
    e.bayCd = e.phase === 3 ? 5.5 : 8.0;
    const kind = e.phase === 1 ? 'mirror' : (e.phase === 2 ? 'splitter' : 'charger');
    for (let k = 0; k < (e.phase === 3 ? 3 : 2); k++)
      spawnEnemy(kind, clamp(e.x + rnd(-120, 120), 45, VW - 45), e.y + 30);
  }
  if (e.phase >= 2) {
    e.mineCd = (e.mineCd === undefined ? 4 : e.mineCd) - dt;
    if (e.mineCd <= 0) {
      e.mineCd = e.phase === 3 ? 3.0 : 4.6;
      dropMine(e.x + rnd(-50, 50), e.y + 44, Math.round(26 * dDmg), 6.0);
    }
  }
}

/* Ploče se crtaju kao obruč oko jezgra; svaka prima štetu zasebno. */
function drawBoss6Plates(e) {
  if (!e.plates || !e.plates.length) return;
  const R = e.r + 44;
  const ex = pX(e.x, e.y), ey = pY(e.y), es = pS(e.y), sq = persp ? 0.62 : 1;
  ctx.save();
  for (const p of e.plates) {
    const f = clamp(p.hp / p.maxHp, 0, 1);
    ctx.globalAlpha = 0.35 + 0.5 * f;
    ctx.strokeStyle = e.color;
    ctx.shadowColor = e.color; ctx.shadowBlur = 14;
    ctx.lineWidth = (5 + 5 * f) * es;
    ctx.beginPath();
    ctx.ellipse(ex, ey, R * es, R * es * sq, 0, p.ang - 0.42, p.ang + 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

function updateBoss5(e, dt) {
  const tw = e.twins;
  e.maxHp = tw.reduce((a, t) => a + t.maxHp, 0);
  e.hp = tw.reduce((a, t) => a + t.hp, 0);

  if (e.state === 'in') {
    e.cy += 70 * dt;
    if (e.cy >= 290) { e.cy = 290; e.state = 'fight'; }
  }

  const alive = tw.filter(t => !t.down).length;
  const f = e.hp / e.maxHp;
  e.phase = f > 0.60 ? 1 : (f > 0.25 ? 2 : 3);

  // ozivljavanje
  for (const t of tw) {
    if (!t.down) continue;
    t.reviveT -= dt;
    if (t.reviveT <= 0) {
      t.down = false; t.invuln = false;
      t.hp = Math.round(t.maxHp * 0.35);
      // vrati ga u orbitu odakle je i ispao
      const k2 = tw.indexOf(t);
      const a2 = e.ang + k2 * Math.PI;
      t.x = clamp(e.cx + Math.cos(a2) * e.rad, 46, VW - 46);
      t.y = e.cy + Math.sin(a2) * e.rad * 0.42;
      burst(t.x, t.y, t.color, 30, 240);
      shake = Math.max(shake, 12);
      showToast('BLIZANAC OŽIVEO');
    }
  }
  if (tw.every(t => t.down) && !e.won) {
    e.won = true;
    flash = 0.45; flashColor = e.color; shake = 24;
    for (const t of tw) removeQueue.push({ e: t, drops: true });
    removeQueue.push({ e: e, drops: false });
    bossRef = null;
    return;
  }
  if (e.won) return;

  // kruženje — oboreni ispada iz orbite i lagano tone, da se jasno vidi ko je aktivan
  const rush = alive === 1 ? 1.5 : 1;
  const spd = (e.phase === 1 ? 0.55 : (e.phase === 2 ? 0.85 : 1.15)) * rush;
  e.ang += spd * dt;
  e.cx = VW / 2 + Math.sin(e.t * 0.42) * 108;
  for (let k = 0; k < tw.length; k++) {
    const t = tw[k];
    if (t.down) {
      t.y += 26 * dt;                       // tone
      t.x += Math.sin(t.reviveT * 2.2) * 8 * dt;
      if (Math.random() < 0.25)
        particles.push({ x: t.x + rnd(-16, 16), y: t.y + rnd(-16, 16), vx: rnd(-14, 14), vy: rnd(6, 26),
                         life: 0.5, max: 0.6, color: '#5a6472', size: rnd(1.5, 3) });
      continue;
    }
    const a = e.ang + k * Math.PI;
    t.x = clamp(e.cx + Math.cos(a) * e.rad, 46, VW - 46);
    t.y = e.cy + Math.sin(a) * e.rad * 0.42;
  }

  if (e.state === 'in') return;

  // zrak između blizanaca u trećoj fazi
  e.beam = (e.phase === 3 && alive === 2);
  if (e.beam && player.alive && player.inv <= 0) {
    const A = tw[0], B = tw[1];
    if (segDist2(player.x, player.y, A.x, A.y, B.x, B.y) < (18 + player.r) * (18 + player.r))
      hurtPlayer(Math.round(26 * dDmg));
  }

  // paljba
  for (let k = 0; k < tw.length; k++) {
    const t = tw[k];
    if (t.down) continue;
    t.fireCd -= dt * rush;
    if (t.fireCd > 0) continue;
    if (k === 0) {
      t.fireCd = e.phase === 3 ? 1.2 : 1.8;
      for (let j = -3; j <= 3; j++)
        ebullets.push(mkEb(t.x, t.y + 40, Math.sin(j * 0.19) * 210, Math.cos(j * 0.19) * 210, 12, t.color));
    } else {
      t.fireCd = e.phase === 3 ? 1.0 : 1.5;
      aimShot(t, 320, 13); aimShot(t, 390, 13);
      if (e.phase >= 2) {
        const a0 = e.t * 2.4;
        for (let j = 0; j < 4; j++) {
          const ang = a0 + j * (Math.PI / 2);
          ebullets.push(mkEb(t.x, t.y + 16, Math.cos(ang) * 200, Math.abs(Math.sin(ang)) * 140 + 100, 11, t.color));
        }
      }
    }
  }

  // pojačanja
  e.bayCd = (e.bayCd === undefined ? 7 : e.bayCd) - dt;
  if (e.bayCd <= 0) {
    e.bayCd = e.phase === 3 ? 5.0 : 7.5;
    const kind = e.phase === 1 ? 'charger' : (e.phase === 2 ? 'splitter' : 'swarm');
    const n = e.phase === 3 ? 4 : 2;
    // izlaze iz živog blizanca — da se ne čini da ih šalje oboreni
    const izvor = tw.find(t => !t.down);
    const sx = izvor ? izvor.x : e.cx, sy = izvor ? izvor.y : e.cy;
    for (let k = 0; k < n; k++)
      spawnEnemy(kind, clamp(sx + rnd(-90, 90), 45, VW - 45), sy - 30);
  }
}

function drawTwinBeam(e) {
  if (!e.beam) return;
  const A = e.twins[0], B = e.twins[1];
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = e.color; ctx.lineWidth = 14;
  ctx.shadowColor = e.color; ctx.shadowBlur = 24;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pX(A.x, A.y), pY(A.y)); ctx.lineTo(pX(B.x, B.y), pY(B.y)); ctx.stroke();
  ctx.globalAlpha = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(pX(A.x, A.y), pY(A.y)); ctx.lineTo(pX(B.x, B.y), pY(B.y)); ctx.stroke();
  ctx.restore();
}

function updateBoss4(e, dt) {
  if (e.state === 'in') {
    e.y += 85 * dt;
    if (e.y >= 262) { e.y = 262; e.state = 'fight'; }
    return;
  }
  if (e.ringHit > 0) e.ringHit -= dt;
  const rf = e.ring ? e.ring.hp / e.ring.maxHp : 0;
  const newPhase = !e.ring ? 3 : (rf > 0.5 ? 1 : 2);
  if (newPhase !== e.phase) {
    e.phase = newPhase;
    if (e.phase === 2 && e.ring) { e.ring.gap = 2.00; e.ring.spd = 0.70; }
  }
  if (e.ring && e.hp / e.maxHp <= 0.25) breakRing(e);
  if (e.ring) {
    e.ring.t -= dt;
    if (e.phase === 2 && e.ring.t <= 0) { e.ring.dir *= -1; e.ring.t = rnd(3.0, 5.0); }
    e.ring.ang += e.ring.spd * e.ring.dir * dt;
    if (e.ring.ang > Math.PI) e.ring.ang -= Math.PI * 2;
    if (e.ring.ang < -Math.PI) e.ring.ang += Math.PI * 2;
  }

  // nalet u trecoj fazi
  if (e.phase === 3) {
    e.diveCd = (e.diveCd === undefined ? 3.0 : e.diveCd) - dt;
    if (e.dive === 'warn') {
      e.diveT -= dt;
      e.x += clamp(e.diveX - e.x, -420 * dt, 420 * dt);
      if (e.diveT <= 0) e.dive = 'down';
      return;
    } else if (e.dive === 'down') {
      e.y += 980 * dt;
      if (e.y > VH * 0.60) e.dive = 'up';
      return;
    } else if (e.dive === 'up') {
      e.y -= 520 * dt;
      if (e.y <= 262) { e.y = 262; e.dive = null; e.diveCd = 5.0; }
      return;
    } else if (e.diveCd <= 0) {
      e.dive = 'warn'; e.diveT = 0.75; e.diveX = clamp(player.x, 90, VW - 90);
      shake = Math.max(shake, 7);
      return;
    }
  }

  const sp = e.phase === 1 ? 65 : (e.phase === 2 ? 95 : 135);
  e.x += e.dir * sp * dt;
  if (e.x < 100) { e.x = 100; e.dir = 1; }
  if (e.x > VW - 100) { e.x = VW - 100; e.dir = -1; }
  e.y = 262 + Math.sin(e.t * 1.0) * 18;

  // pojacanja
  e.bayCd = (e.bayCd === undefined ? 6 : e.bayCd) - dt;
  if (e.bayCd <= 0) {
    if (e.phase === 1) {
      e.bayCd = 7.5;
      for (let k = -1; k <= 1; k += 2) spawnEnemy('splitter', clamp(e.x + k * 80, 40, VW - 40), e.y + 30);
    } else if (e.phase === 2) {
      e.bayCd = 10.0;
      spawnEnemy('healer', clamp(e.x + rnd(-90, 90), 60, VW - 60), e.y + 30);
    } else {
      e.bayCd = 6.0;
      for (let k = 0; k < 3; k++) spawnEnemy('swarm', clamp(e.x + rnd(-90, 90), 40, VW - 40), e.y + 24);
    }
  }

  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  if (e.phase === 1) {
    e.fireCd = 2.2;
    for (let k = -3; k <= 3; k++)
      ebullets.push(mkEb(e.x, e.y + 45, Math.sin(k * 0.20) * 215, Math.cos(k * 0.20) * 215, 12, e.color));
  } else if (e.phase === 2) {
    e.fireCd = 1.6;
    for (let k = -4; k <= 4; k++)
      ebullets.push(mkEb(e.x, e.y + 45, Math.sin(k * 0.18) * 205, Math.cos(k * 0.18) * 205, 12, e.color));
    aimShot(e, 340, 13); aimShot(e, 420, 13);
  } else {
    e.fireCd = 0.7;
    const a = e.t * 2.8;
    for (let k = 0; k < 6; k++) {
      const ang = a + k * (Math.PI * 2 / 6);
      ebullets.push(mkEb(e.x, e.y + 18, Math.cos(ang) * 210, Math.abs(Math.sin(ang)) * 150 + 105, 11, e.color));
    }
    aimShot(e, 400, 13);
  }
}

function drawBoss4Ring(e) {
  const r = e.ring;
  if (!r) return;
  const R = e.r + 26;
  const a0 = r.ang + r.gap / 2, a1 = r.ang - r.gap / 2 + Math.PI * 2;
  ctx.save();
  ctx.lineCap = 'butt';
  ctx.strokeStyle = e.color;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = e.ringHit > 0 ? 26 : 14;
  const rf = clamp(r.hp / r.maxHp, 0, 1);
  ctx.globalAlpha = (e.ringHit > 0 ? 1 : 0.8) * (0.35 + 0.65 * rf);
  ctx.lineWidth = 4 + 8 * rf;
  const rx = pX(e.x, e.y), ry = pY(e.y), rs = pS(e.y), sq = persp ? 0.62 : 1;
  ctx.beginPath(); ctx.ellipse(rx, ry, R * rs, R * rs * sq, 0, a0, a1); ctx.stroke();
  ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(performance.now() / 200));
  ctx.strokeStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 16;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(rx, ry, R * rs, R * rs * sq, 0, r.ang - r.gap / 2, r.ang + r.gap / 2); ctx.stroke();
  ctx.restore();
}

function updateBoss3(e, dt) {
  if (e.state === 'in') {
    e.y += 85 * dt;
    if (e.y >= 258) { e.y = 258; e.state = 'fight'; }
    return;
  }
  e.pods = (e.pods || []).filter(p => enemies.indexOf(p) >= 0);
  const wasInv = e.invuln;
  e.invuln = e.pods.length > 0;
  if (wasInv && !e.invuln) {
    shake = 16; flash = 0.3; flashColor = e.color;
    showToast('JEZGRO OTKRIVENO');
  }

  const sp = e.invuln ? 60 : 130;
  e.x += e.dir * sp * dt;
  if (e.x < 110) { e.x = 110; e.dir = 1; }
  if (e.x > VW - 110) { e.x = VW - 110; e.dir = -1; }
  e.y = 258 + Math.sin(e.t * 1.0) * 20;
  e.phase = e.invuln ? 1 : (e.hp / e.maxHp > 0.4 ? 2 : 3);

  e.bayCd = (e.bayCd === undefined ? 5 : e.bayCd) - dt;
  if (e.bayCd <= 0) {
    if (e.invuln) {
      e.bayCd = 6.5;
      for (let k = 0; k < 4; k++)
        spawnEnemy('swarm', clamp(e.x + (k % 2 ? 70 : -70) + rnd(-14, 14), 40, VW - 40), e.y + 24);
    } else {
      e.bayCd = e.phase === 3 ? 2.6 : 3.6;
      for (let k = 0; k < (e.phase === 3 ? 3 : 2); k++)
        dropMine(clamp(e.x + rnd(-120, 120), 40, VW - 40), e.y + 60, 24, 6.0);
    }
  }

  e.fireCd -= dt;
  if (e.fireCd > 0) return;
  if (e.invuln) {
    e.fireCd = 2.8;
    aimShot(e, 280, 12);
  } else if (e.phase === 2) {
    e.fireCd = 1.5;
    for (let k = -4; k <= 4; k++)
      ebullets.push(mkEb(e.x, e.y + 45, Math.sin(k * 0.17) * 215, Math.cos(k * 0.17) * 215, 12, e.color));
    aimShot(e, 330, 13);
  } else {
    e.fireCd = 0.75;
    const a = e.t * 2.6;
    for (let k = 0; k < 6; k++) {
      const ang = a + k * (Math.PI * 2 / 6);
      ebullets.push(mkEb(e.x, e.y + 20, Math.cos(ang) * 205, Math.abs(Math.sin(ang)) * 145 + 100, 11, e.color));
    }
    aimShot(e, 380, 13);
  }
}

function ringBlocks(e, hx, hy) {
  if (!e.ring) return false;
  if (hx === undefined) return true;              // eksplozija bez tačke pogotka ne prolazi
  let a = Math.atan2(hy - e.y, hx - e.x);
  let d = a - e.ring.ang;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > e.ring.gap / 2;
}

function breakRing(e) {
  if (!e.ring) return;
  const R = e.r + 26;
  for (let k = 0; k < 26; k++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({ x: e.x + Math.cos(a) * R, y: e.y + Math.sin(a) * R,
                     vx: Math.cos(a) * rnd(120, 300), vy: Math.sin(a) * rnd(120, 300),
                     life: rnd(0.4, 0.9), max: 0.9, color: e.color, size: rnd(2, 4) });
  }
  e.ring = null;
  shake = 18; flash = 0.32; flashColor = e.color;
  showToast('PRSTEN SE RASPAO');
}

function damageEnemy(e, dmg, hx, hy) {
  if (warpSafe(e)) return;
  // Kovačnica: dok ploče stoje, sva šteta ide u najbližu ploču
  if (e.type === 'boss6' && e.plates && e.plates.length) {
    let best = null, bd = 1e9;
    const ha = Math.atan2((hy === undefined ? e.y : hy) - e.y, (hx === undefined ? e.x : hx) - e.x);
    for (const p of e.plates) {
      if (p.hp <= 0) continue;          // oborena ploča više ne štiti
      let d = Math.abs(((p.ang - ha + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) {
      best.hp -= dmg;
      e.flash = 0.06;
      if (best.hp <= 0) {
        burst(e.x + Math.cos(best.ang) * (e.r + 44), e.y + Math.sin(best.ang) * (e.r + 44), e.color, 22, 240);
        shake = Math.max(shake, 8);
      }
      return;
    }
  }
  if (e.invuln) { e.flash = 0.05; return; }
  if (e.ring && ringBlocks(e, hx, hy)) {
    e.ringHit = 0.14;
    e.ring.hp -= dmg;
    if (e.ring.hp <= 0) breakRing(e);
    return;
  }
  e.hp -= dmg; e.flash = 0.08;
  if (e.twin && e.down) return;        // oboren blizanac je van igre do oživljavanja
  if (e.hp <= 0 && e.twin && !e.down) {
    e.hp = 0; e.down = true; e.reviveT = 8; e.invuln = true;
    burst(e.x, e.y, e.color, 40, 300);
    shake = Math.max(shake, 16); flash = 0.28; flashColor = e.color;
    showToast('BLIZANAC PAO — SREDI DRUGOG ZA 8s');
    return;
  }
  if (e.hp <= 0) { const i = enemies.indexOf(e); if (i >= 0) killEnemy(i, true); }
}

const SPLIT = [
  { hp: 90, r: 24, w: 48, h: 48, coin: 5, speed: 84,  ram: 20 },
  { hp: 42, r: 17, w: 34, h: 34, coin: 3, speed: 118, ram: 14 },
  { hp: 18, r: 11, w: 22, h: 22, coin: 2, speed: 155, ram: 10 }
];

function splitEnemy(e) {
  const g = (e.gen || 0) + 1;
  if (g > 2) return;
  const d = SPLIT[g];
  const mul = (1 + (level - 1) * 0.22) * dHp;
  for (let k = -1; k <= 1; k += 2) {
    const c = {
      type: 'splitter', x: clamp(e.x + k * 16, 26, VW - 26), y: e.y,
      r: d.r, w: d.w, h: d.h, color: ENEMY.splitter.color,
      hp: Math.round(d.hp * mul), maxHp: Math.round(d.hp * mul),
      speed: d.speed * dSpd, coin: Math.max(1, Math.round(d.coin * dCoin)),
      ram: Math.round(d.ram * dDmg), gen: g,
      flash: 0, t: rnd(0, 6), phase: 1, fireCd: 0,
      baseX: e.x, dir: k, state: 'fight', hover: 0, vx: k * rnd(55, 95)
    };
    enemies.push(c);
    burst(c.x, c.y, ENEMY.splitter.color, 6, 130);
  }
}

function updateBomber(e, dt) {
  if (e.y < e.hover) { e.y += e.speed * dt; return; }
  e.x = e.baseX + Math.sin((e.bt || 0) * 0.7) * 74 * clamp((e.bt || 0) * 2.2, 0, 1);
  e.bombCd -= dt;
  if (e.bombCd <= 0) {
    e.bombCd = rnd(2.4, 3.6);
    ebullets.push(mkEb(e.x, e.y + e.h / 2, rnd(-30, 30), 190, 14, e.color, { bomb: 1.15 }));
  }
}

function updatePhoenix(e, dt) {
  if (e.reb > 0) {
    e.reb -= dt;
    e.hide = e.reb > 0.35;
    if (e.reb <= 0) {
      e.hide = false; e.invuln = false;
      e.hp = Math.round(e.maxHp * 0.5);
      burst(e.x, e.y, e.color, 26, 240);
      rings.push({ x: e.x, y: e.y, r: 70, t: 0, dur: 0.4, color: e.color });
    }
    return;
  }
  e.x = e.baseX + Math.sin((e.bt || 0) * 2.4) * 62 * clamp((e.bt || 0) * 2.2, 0, 1);
  e.y += e.speed * dt;
}

function updatePhantom(e, dt) {
  e.ghCd -= dt;
  if (e.ghost > 0) {
    e.ghost -= dt;
    if (e.ghost <= 0) { e.invuln = false; e.ghCd = rnd(2.2, 3.6); }
  } else if (e.ghCd <= 0) {
    e.ghost = 1.1; e.invuln = true;
    burst(e.x, e.y, e.color, 10, 150);
  }
  e.x = e.baseX + Math.sin((e.bt || 0) * 1.5) * 88 * clamp((e.bt || 0) * 2.2, 0, 1);
  e.y += e.speed * dt;
  if (e.ghost <= 0) {
    e.fireCd -= dt;
    if (e.fireCd <= 0) { e.fireCd = rnd(1.6, 2.6); aimShot(e, 300, 11); }
  }
}

function killEnemy(idx, drops) {
  const e = enemies[idx];
  /* Feniks se prvi put ponovo sklopi umesto da nestane. */
  if (e && e.type === 'phoenix' && e.rebirth > 0 && drops !== false) {
    e.rebirth = 0;
    e.reb = 1.2;
    e.invuln = true;
    e.hp = 1;
    burst(e.x, e.y, e.color, 22, 220);
    return;
  }
  enemies.splice(idx, 1);
  if (e.type === 'splitter') splitEnemy(e);
  burst(e.x, e.y, e.color, e.type === 'boss' ? 60 : 14, e.type === 'boss' ? 340 : 190);
  if (isBoss(e)) {
    bossRef = null;
    if (heavyBp) { dropBlueprint(e.x, e.y + 30, heavyBp); heavyBp = null; } shake = 18; flash = 0.35; flashColor = e.color;
    for (let i = 0; i < 14; i++) dropCoin(e.x + rnd(-60, 60), e.y + rnd(-40, 40), Math.ceil(e.coin / 14));
    for (let i = 0; i < 3; i++) dropPowerup(e.x + rnd(-70, 70), e.y + rnd(-30, 30));
    for (let i = 0; i < 4; i++) dropNrg(e.x + rnd(-70, 70), e.y + rnd(-30, 30));
  } else if (drops !== false) {
    killCount++;
    if (bpType && killCount === bpTarget) dropBlueprint(e.x, e.y, bpType);
    const n = Math.min(e.coin, 5), per = Math.ceil(e.coin / n);
    for (let i = 0; i < n; i++) dropCoin(e.x + rnd(-14, 14), e.y + rnd(-10, 10), per);
    if (Math.random() < 0.07) dropPowerup(e.x, e.y);
    if (Math.random() < 0.10) dropNrg(e.x, e.y);
  } else {
    dropCoin(e.x, e.y, Math.max(1, Math.floor(e.coin / 2)));
  }
}

/* ---------- PREDMETI ---------- */

function dropCoin(x, y, v) { pickups.push({ kind: 'coin', x: x, y: y, vx: rnd(-40, 40), vy: rnd(-60, 20), val: v, r: 8, t: 0 }); }
function dropBlueprint(x, y, t) {
  pickups.push({ kind: 'bp', bp: t, x: x, y: y, vx: rnd(-20, 20), vy: -40, r: 16, t: 0 });
}
function dropNrg(x, y) { pickups.push({ kind: 'nrg', x: x, y: y, vx: rnd(-30, 30), vy: rnd(-40, 10), r: 12, t: 0 }); }
function dropPowerup(x, y) {
  pickups.push({ kind: 'pu', pu: PU_KEYS[rndi(0, PU_KEYS.length - 1)], x: x, y: y, vx: rnd(-25, 25), vy: -30, r: 16, t: 0 });
}

function updatePickups(dt) {
  const mag = brownout ? 0 : PS.magnet;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    p.vy = Math.min(p.vy + 260 * dt, 150);
    const pmag = p.kind === 'bp' ? Math.max(mag, 220) : mag;
    if (p.kind !== 'pu' && pmag > 0 && player.alive) {
      const dx = player.x - p.x, dy = player.y - p.y, d = Math.hypot(dx, dy);
      if (d < pmag) {
        const pull = 900 * dt * (1 - d / pmag) + 260 * dt;
        p.vx += dx / (d || 1) * pull; p.vy += dy / (d || 1) * pull;
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985;
    if (p.y > VH + 40) { pickups.splice(i, 1); continue; }
    if (player.alive) {
      const rr = p.r + player.r + 6;
      if (dist2(p, player) < rr * rr) { collect(p); pickups.splice(i, 1); }
    }
  }
}

function collect(p) {
  if (p.kind === 'coin') { save.coins += p.val; runCoins += p.val; burst(p.x, p.y, C.coin, 5, 110); return; }
  if (p.kind === 'bp') {
    save.bp[p.bp] = Math.min(BP_NEEDED, bpOf(p.bp) + 1);
    if (isHeavy(p.bp)) {
      save.bpHeavyDone[level + ':' + diff] = true;   // ovaj boss je dao svoj nacrt
      runHeavyBp = p.bp;
      if (runHeavyAll.indexOf(p.bp) < 0) runHeavyAll.push(p.bp);
    } else {
      save.bpDone[level + ':' + diff] = true;
      runBp = p.bp;
      if (runBpAll.indexOf(p.bp) < 0) runBpAll.push(p.bp);
    }
    writeSave();
    burst(p.x, p.y, COMP[p.bp].color, 22, 210);
    flash = 0.22; flashColor = COMP[p.bp].color;
    showToast('NACRT: ' + COMP[p.bp].name + '  ' + bpOf(p.bp) + '/' + BP_NEEDED +
              (bpUnlocked(p.bp) ? '  — OTKLJUČANO' : ''));
    return;
  }
  if (p.kind === 'nrg') {
    energy = Math.min(PS.energyMax, energy + 15);
    burst(p.x, p.y, C.nrg, 6, 120);
    return;
  }
  const def = POWERUPS[p.pu];
  if (p.pu === 'heal') player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.35));
  else player.pu[p.pu] = (player.pu[p.pu] || 0) + def.dur;
  burst(p.x, p.y, def.color, 12, 150);
  showToast(def.name);
}

/* ---------- IGRAČ I STRUJA ---------- */

function spend(v) { if (!brownout && !player.pu.surge) { energy -= v; spentTotal += v; } }

const WARP_IN_DUR = 1.30, WARP_OUT_DUR = 1.05;

/* Ulazak i izlazak iz misije. Dok traje, brod se ne kontroliše i ne puca,
   ali ostaje neranjiv — protivnici u tom trenutku još nisu ni stigli. */
function updatePlayerWarp(dt) {
  if (!player.warp) return false;
  player.warpT += dt;
  if (player.warp === 'in') {
    const f = clamp(player.warpT / WARP_IN_DUR, 0, 1);
    const e = 1 - Math.pow(1 - f, 4.5);               // uleti brzo pa dugo i meko koči
    player.y = player.warpFrom + (player.warpTo - player.warpFrom) * e;
    player.ty = player.y; player.tx = player.x;
    player.inv = Math.max(player.inv, 0.3);
    if (f >= 1) { player.warp = null; player.y = player.warpTo; player.ty = player.y; player.inv = 1.0; }
  } else {
    const f = clamp(player.warpT / WARP_OUT_DUR, 0, 1);
    const e = Math.pow(f, 2.6);                       // polako pa ubrza
    player.y = player.warpFrom + (player.warpTo - player.warpFrom) * e;
    player.ty = player.y; player.tx = player.x;
    player.inv = 1;
  }
  player.vx = 0; player.vy = 0;
  return true;
}

function startPlayerExit() {
  if (player.warp || !player.alive) return;
  chainCount = 0;                      // sletanjem se niz prekida
  player.warp = 'out'; player.warpT = 0;
  player.warpFrom = player.y;
  player.warpTo = -WARP_DEPTH * 1.1;
  firing = false; dragId = null;
  burst(player.x, player.y, C.player, 16, 200);
}

function updatePlayer(dt) {
  if (!player.alive) return;
  playTime += dt;
  if (player.warp) { updatePlayerWarp(dt); return; }
  player.tilt *= Math.pow(0.001, dt);
  if (player.inv > 0) player.inv -= dt;
  if (player.moving > 0) player.moving -= dt;
  if (player.autoOn > 0) player.autoOn -= dt;
  if (player.leashHint > 0) player.leashHint -= dt;
  if (player.sgFlash > 0) player.sgFlash -= dt;

  // trag prati stvarnu putanju broda
  const tr = player.trail;
  const lp = tr[tr.length - 1];
  if (!lp || Math.abs(lp.x - player.x) + Math.abs(lp.y - player.y) > 2.5) {
    tr.push({ x: player.x, y: player.y });
    if (tr.length > (transit ? 64 : 36)) tr.shift();
  }
  player.trailT += dt;
  // u polju trag ostaje duže — utisak velike brzine
  const tstep = transit ? 0.075 : 0.026;
  if (player.trailT > tstep) { player.trailT = 0; if (tr.length) tr.shift(); }

  for (const k in player.pu) { player.pu[k] -= dt; if (player.pu[k] <= 0) delete player.pu[k]; }

  // struja
  energy += PS.genOut * dt;
  if (!brownout) {
    if (player.moving > 0) spend(COMP.motor.pw * dt);
    if (PS.hasG && (player.moving > 0 || Math.abs(player.vx) + Math.abs(player.vy) > 8)) spend(COMP.gforce.pw * dt);
    if (PS.hasMagnet) spend(COMP.magnet.pw * dt);
    if (PS.shieldMax > 0) {
      if (shieldPause > 0) shieldPause -= dt;
      else if (player.shield < PS.shieldMax) {
        player.shield = Math.min(PS.shieldMax, player.shield + 8 * dt);
        spend(COMP.shield.pw * dt);
      }
    }
    if (energy <= 0) {
      energy = 0; brownout = true; player.shield = 0;
      brownFlash = 1; showToast('NESTALO STRUJE');
    }
  } else if (energy >= PS.energyMax * 0.25) {
    brownout = false; showToast('NAPAJANJE VRAĆENO');
  }
  energy = clamp(energy, 0, PS.energyMax);
  if (brownFlash > 0) brownFlash -= dt;

  // roboti za popravku — kreću tek posle pauze bez pogodaka
  player.repairing = 0;
  if (repairPause > 0) repairPause -= dt;
  else if (PS.hasRobot && !brownout && player.hp < player.maxHp) {
    player.hp = Math.min(player.maxHp, player.hp + PS.repair * dt);
    spend(COMP.robot.pw * dt);
    player.repairing = 1;
  }
  /* Kad oklop pređe prag na kom je modul otkazao, roboti ga vrate u stroj —
     ali samo onaj koji je pao u ovoj misiji, i to redom obrnutim od kvara. */
  if (PS.hasRobot && runDmg.length && dmgStage > 0) {
    const prag = DMG_THRESHOLDS[dmgStage - 1] + 0.12;
    if (player.hp / player.maxHp >= prag) {
      const idx = runDmg.pop();
      dmgStage--;
      delete save.dmg[idx];
      writeSave();
      PS = buildShip();
      burst(player.x, player.y, C.ok, 22, 200);
      flash = 0.20; flashColor = C.ok;
      showToast('MODUL POPRAVLJEN: ' + COMP[save.grid[idx]].name);
    }
  }

  // blizinska sačmara
  if (PS.hasSg && !transit) {
    player.sgCd -= dt;
    if (player.sgCd <= 0) {
      if (fireShotgun()) player.sgCd = PS.sgInt * (brownout ? 1.7 : 1);
      else player.sgCd = 0.12;
    }
  }

  // munja
  if (PS.hasBolt && !transit) {
    player.boCd -= dt;
    if (player.boCd <= 0) {
      if (fireBolt()) player.boCd = PS.boltInt * (brownout ? 1.7 : 1);
      else player.boCd = 0.25;
    }
  }

  // puls laser
  if (!transit && PS.hasPulse) {
    player.plCd -= dt;
    if (player.plCd <= 0) {
      if (firePulse()) player.plCd = PS.plInt * (brownout ? 1.7 : 1);
      else player.plCd = 0.2;
    }
  }

  // antimaterija
  if (!transit && PS.hasAnti) {
    player.amCd -= dt;
    if (player.amCd <= 0) {
      if (pickTarget() && fireAnti()) player.amCd = PS.amInt * (brownout ? 1.7 : 1);
      else player.amCd = 0.3;
    }
  }

  // haker
  if (!transit && PS.hasHack) {
    player.hkCd -= dt;
    if (player.hkCd <= 0) {
      if (doHack()) player.hkCd = PS.hkInt * (brownout ? 1.7 : 1);
      else player.hkCd = 0.5;
    }
  }

  // granata
  if (PS.hasBranch) {
    player.brCd -= dt;
    if (player.brCd <= 0) {
      if (launchBranch()) player.brCd = PS.brInt * (brownout ? 1.7 : 1);
      else player.brCd = 0.25;
    }
  }

  // rakete
  if (PS.hasRocket) {
    player.rkCd -= dt;
    if (player.rkCd <= 0) {
      if (pickTarget()) {
        launchRockets();
        player.rkCd = PS.rkInt * (brownout ? 1.7 : 1);
      } else player.rkCd = 0.25;
    }
  }

  fire(dt);
  fireBurst(dt);
}

/* Rafalni top: pet metaka u brzom nizu, pa duža pauza do sledećeg rafala. */
function fireBurst(dt) {
  if (!PS.hasBurst || player.warp || transit) return;
  const cnt = PS.burstLv.length;
  const spacing = 14;
  for (let i = 0; i < cnt; i++) {
    if (player.buCd[i] === undefined) { player.buCd[i] = 0; player.buLeft[i] = 0; player.buShot[i] = 0; }
    player.buCd[i] -= dt;
    if (player.buCd[i] > 0) continue;

    if (player.buLeft[i] <= 0) {
      if (!firing) continue;
      player.buLeft[i] = PS.buN[i];               // kreće nov rafal
    }

    let dmg = PS.buDmg[i];
    if (player.pu.power) dmg = Math.round(dmg * 1.8);
    let rate = PS.buRate[i];
    if (player.pu.rapid) rate *= 0.58;
    if (brownout) rate *= 1.7;

    const off = (i - (cnt - 1) / 2) * spacing + (PS.turrets > 1 ? 22 : 0);
    const k = PS.buN[i] - player.buLeft[i];
    const jitter = (k % 2 ? 1 : -1) * 2.5;
    bullets.push({
      x: player.x + off + jitter, y: player.y - player.h / 2,
      vx: 0, vy: -1450, dmg: dmg, r: 5, burst: true
    });
    spend(COMP.burst.pw);
    player.buLeft[i]--;
    player.buShot[i] = 0.08;

    if (player.buLeft[i] <= 0) {
      let gap = PS.buGap[i];
      if (player.pu.rapid) gap *= 0.58;
      if (brownout) gap *= 1.7;
      player.buCd[i] = gap;
    } else player.buCd[i] = rate;
  }
}

function fire(dt) {
  if (player.warp || transit) return;
  const n = PS.turrets;
  const spacing = 12;
  for (let i = 0; i < n; i++) {
    if (player.tCd[i] === undefined) player.tCd[i] = 0;
    player.tCd[i] -= dt;
    if (!firing || player.tCd[i] > 0) continue;

    let interval = PS.tInt[i];
    if (player.pu.rapid) interval *= 0.58;
    if (brownout) interval *= 1.7;
    player.tCd[i] = interval;

    /* Šteta i struja su vezane za SALVU, ne za pojedinačan metak.
       Više mlazova znači da se ista salva deli na više metaka —
       dodavanje mlaza ne pojačava turret, samo mu širi paljbu. */
    const base = PS.tStr[i];
    const m = base + (player.pu.spread ? 2 : 0);
    let volley = PS.tDmg[i];
    if (player.pu.power) volley *= 1.8;
    const perShot = volley / base;
    const off = (i - (n - 1) / 2) * spacing;

    for (let k = 0; k < m; k++) {
      const f = m === 1 ? 0 : (k / (m - 1)) * 2 - 1;
      const a = f * 0.042;
      bullets.push({
        x: player.x + off + f * 5, y: player.y - player.h / 2,
        vx: Math.sin(a) * 760, vy: -Math.cos(a) * 760, dmg: perShot, r: 6
      });
    }
    spend(COMP.turret.pw / base * m);
  }
}

function hurtPlayer(dmg) {
  if (player.inv > 0 || !player.alive) return;
  player.inv = 0.7;
  if (PS.hasRobot) repairPause = PS.repDelay;
  if (player.shield > 0) {
    player.shield -= dmg;
    if (player.shield < 0) { player.hp += player.shield; player.shield = 0; }
    shieldPause = 3.0;
    flash = 0.16; flashColor = C.shield;
  } else {
    player.hp -= dmg;
    shieldPause = 3.0;
    flash = 0.2; flashColor = C.warn;
  }
  shake = Math.max(shake, 10);
  burst(player.x, player.y, C.player, 10, 160);
  checkModuleDamage();
  if (player.hp <= 0) {
    player.hp = 0; player.alive = false;
    burst(player.x, player.y, C.player, 50, 320);
    shake = 22; doneTimer = 1.6;
  }
}

/* ---------- METKOVI ---------- */

/* Kad oklop padne ispod praga, nasumičan zauzet modul ispada iz stroja. */
function checkModuleDamage() {
  if (!player.alive) return;
  const f = player.hp / player.maxHp;
  while (dmgStage < DMG_THRESHOLDS.length && f <= DMG_THRESHOLDS[dmgStage]) {
    dmgStage++;
    const pool = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const t = save.grid[i];
      if (!t || t === 'cpu' || isDamaged(i)) continue;
      pool.push(i);
    }
    if (!pool.length) continue;
    const idx = pool[rndi(0, pool.length - 1)];
    save.dmg[idx] = true;
    runDmg.push(idx);
    PS = buildShip();
    dmgFlash = 1.6;
    shake = Math.max(shake, 16);
    flash = 0.30; flashColor = C.warn;
    burst(player.x, player.y, C.warn, 26, 240);
    showToast('KVAR: ' + COMP[save.grid[idx]].name);
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.life !== undefined) { b.life -= dt; if (b.life <= 0) { bullets.splice(i, 1); continue; } }
    const topLimit = persp ? -WARP_DEPTH : -30;
    const side = b.rail ? 120 : 30;          // rail zrna lete koso, treba im više prostora
    if (b.y < topLimit || b.y > VH + 30 || b.x < -side || b.x > VW + side) { bullets.splice(i, 1); continue; }
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (isBoss(e) && e.state === 'in') continue;
      if (e.down || e.hide || warpSafe(e) || e.hacked) continue;
      const rr = e.r + b.r;
      if (dist2(e, b) < rr * rr) {
        if (e.type === 'mirror' && e.cool <= 0 && e.y >= e.hover - 20 && b.y > e.y) {
          // ogledalo vraća metak nazad i pri tom se greje
          const dx = player.x - e.x, dy = player.y - e.y, l = Math.hypot(dx, dy) || 1;
          ebullets.push(mkEb(e.x, e.y + e.h / 2, dx / l * 260, dy / l * 260, 12, e.color));
          e.heat++;
          burst(b.x, b.y, '#ffffff', 3, 100);
          if (e.heat >= 12) { e.cool = 2.5; burst(e.x, e.y, e.color, 16, 190); }
          hit = true; break;
        }
        if (e.type === 'shieldbearer' && e.plateDown <= 0 && e.plate > 0) {
          e.plate = Math.max(0, e.plate - b.dmg);
          e.plateHit = 1.6;
          burst(b.x, b.y, '#bda4ff', 3, 90);
        } else {
          damageEnemy(e, b.dmg, b.x, b.y);
          burst(b.x, b.y, e.color, 3, 90);
        }
        hit = true; break;
      }
    }
    if (hit) bullets.splice(i, 1);
  }
  for (let i = ebullets.length - 1; i >= 0; i--) {
    const b = ebullets[i];
    if (b.dead) { ebullets.splice(i, 1); continue; }
    if (b.bomb !== undefined) {
      b.bomb -= dt;
      if (b.bomb <= 0) {
        // kasetna bomba: prsne u snop krhotina
        for (let k = 0; k < 7; k++) {
          const a = Math.PI / 2 + (k - 3) * 0.26;
          ebullets.push(mkEb(b.x, b.y, Math.cos(a) * 210, Math.sin(a) * 210,
                             Math.round(b.dmg * 0.55 / Math.max(0.01, dDmg)), b.color));
        }
        burst(b.x, b.y, b.color, 14, 190);
        ebullets.splice(i, 1);
        continue;
      }
    }
    const ox = b.x, oy = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (player.alive && player.inv <= 0) {
      const rr = b.r + player.r;
      // provera po celoj putanji — brzi metak ne sme da preskoci brod izmedju frejmova
      if (segDist2(player.x, player.y, ox, oy, b.x, b.y) < rr * rr) {
        hurtPlayer(b.dmg); ebullets.splice(i, 1); continue;
      }
    }
    if (b.y > VH + 30 || b.y < -60 || b.x < -40 || b.x > VW + 40) { ebullets.splice(i, 1); }
  }
}

/* ---------- RAKETE ---------- */

function pickTarget() {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (isBoss(e) && e.state === 'in') continue;
    if (e.invuln || e.down || e.hide || warpSafe(e) || e.hacked) continue;
    if (e.y < -20) continue;
    const d = dist2(e, player);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/* Granata: velika raketa koja se pri udaru raspada na manje,
   a te same traže sledeće mete. */
function launchBranch() {
  const t = pickTarget();
  if (!t) return false;
  rockets.push({
    x: player.x, y: player.y - 10, vx: rnd(-60, 60), vy: -200,
    dmg: PS.brDmg, rad: 50, target: t, life: 4.5, t: 0, r: 10,
    branch: PS.brN, kind: 'branch'
  });
  if (!brownout) spend(COMP.branch.pw);
  return true;
}

function spawnBranchlets(rk) {
  const n = rk.branch || 0;
  if (n <= 0) return;
  const dmg = Math.round(rk.dmg * BRANCH_FRAC);
  const used = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
    // svaka granica bira svoju metu, izbegavajući one koje su već zauzete
    let tgt = nearestEnemy(rk.x, rk.y, 420, used);
    if (!tgt) { used.length = 0; tgt = nearestEnemy(rk.x, rk.y, 420, used); }
    if (tgt) used.push(tgt);
    rockets.push({
      x: rk.x, y: rk.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210,
      dmg: dmg, rad: 32, target: tgt, life: 2.4, t: 0, r: 6,
      branch: 0, kind: 'branchlet', delay: 0.22
    });
  }
  burst(rk.x, rk.y, COMP.branch.color, 14, 200);
}

function launchRockets() {
  const n = PS.rkN;
  for (let i = 0; i < n; i++) {
    const side = n === 1 ? 0 : (i === 0 ? -1 : 1);
    rockets.push({
      x: player.x + side * 16, y: player.y,
      vx: side * 120, vy: -180,
      dmg: PS.rkDmg, rad: PS.rkRad, target: pickTarget(), life: 4.0, t: 0, r: 9
    });
  }
  if (!brownout) spend(COMP.rocket.pw * n);
}

function updateRockets(dt) {
  const SPD = 400, TURN = 6.2;
  for (let i = rockets.length - 1; i >= 0; i--) {
    const rk = rockets[i];
    rk.t += dt; rk.life -= dt;
    if (rk.life <= 0 || rk.y < -40 || rk.x < -40 || rk.x > VW + 40) {
      if (rk.life <= 0 && rk.branch) spawnBranchlets(rk);
      rockets.splice(i, 1); continue;
    }

    /* Samo granice imaju kašnjenje; obične rakete ga nemaju, pa se
       vrednost mora normalizovati pre poređenja. */
    if (rk.delay > 0) rk.delay -= dt;
    const kasni = (rk.delay || 0) > 0;
    if (!rk.target || enemies.indexOf(rk.target) < 0) rk.target = pickTarget();
    let ang = Math.atan2(rk.vy, rk.vx);
    if (rk.target && !kasni) {
      const want = Math.atan2(rk.target.y - rk.y, rk.target.x - rk.x);
      let d = want - ang;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      ang += clamp(d, -TURN * (rk.kind === 'branchlet' ? 1.6 : 1) * dt, TURN * (rk.kind === 'branchlet' ? 1.6 : 1) * dt);
    }
    const spd = rk.kind === 'branchlet' ? 330 : (rk.kind === 'branch' ? 350 : SPD);
    rk.vx = Math.cos(ang) * spd; rk.vy = Math.sin(ang) * spd;
    rk.x += rk.vx * dt; rk.y += rk.vy * dt;
    rk.ang = ang;

    if (rk.t > 0.02 && Math.random() < 0.6)
      particles.push({ x: rk.x, y: rk.y, vx: rnd(-20, 20), vy: rnd(10, 60), life: 0.3, max: 0.4,
                       color: rk.kind ? COMP.branch.color : '#ff9a3c', size: rnd(1.5, 3) });

    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (isBoss(e) && e.state === 'in') continue;
      if (e.down || e.hide || warpSafe(e)) continue;
      if (rk.delay > 0) continue;              // granice prvo prsnu u stranu, pa tek onda gađaju
      const rr = e.r + rk.r;
      if (dist2(e, rk) < rr * rr) {
        explodeRocket(rk, e);
        rockets.splice(i, 1);
        break;
      }
    }
  }
}

function explodeRocket(rk, hit) {
  const R = rk.rad || 45;
  burst(rk.x, rk.y, '#ff6a3d', 18, 240);
  damageEnemy(hit, rk.dmg, rk.x, rk.y);           // rakete zaobilaze ploču štitonoše
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (e === hit) continue;
    const dx = e.x - rk.x, dy = e.y - rk.y;
    if (dx * dx + dy * dy < R * R) damageEnemy(e, Math.round(rk.dmg * 0.5), rk.x, rk.y);
  }
  // vidljiv talas tačno na domašaju eksplozije
  rings.push({ x: rk.x, y: rk.y, r: R, t: 0, dur: 0.34,
               color: rk.kind ? COMP.branch.color : '#ff8a3d' });
  shake = Math.max(shake, rk.kind === 'branchlet' ? 3 : 5);
  if (rk.branch) spawnBranchlets(rk);
}

function drawRockets() {
  const s = getSprite('rk', 12, 22, '#ff6a3d', SHAPES.rocket, 12);
  const gb = getSprite('rkb', 15, 26, COMP.branch.color, SHAPES.rocket, 14);
  const gs = getSprite('rkbs', 9, 16, COMP.branch.color, SHAPES.rocket, 10);
  for (const rk of rockets) {
    const sp = rk.kind === 'branch' ? gb : (rk.kind === 'branchlet' ? gs : s);
    wblit(sp, rk.x, rk.y, (rk.ang || -Math.PI / 2) + Math.PI / 2);
  }
}

/* ============================================================
   TEŠKO NAORUŽANJE — pokreće se drugim prstom, troši radijaciju.
   ============================================================ */

function heavyFire(gest, gxx, gyy) {
  if (transit) { showToast('ORUŽJA SU UGAŠENA U POLJU'); return; }
  if (rad < RAD_PER_SHOT) {
    showToast(PS.hasChamber ? 'RADIJACIJA: ' + Math.floor(rad / RAD_PER_SHOT * 100) + '%' : 'TREBA TI KOMORA');
    return;
  }
  let opalio = false;
  if (gest === 'tap' && PS.hasBH) {
    holes.push({
      x: clamp(gxx, 60, VW - 60), y: clamp(pInvY(gyy), 60, VH - 120),
      r: PS.bhRad, dmg: PS.bhDmg, life: PS.bhDur, max: PS.bhDur, t: 0
    });
    shake = Math.max(shake, 14); flash = 0.25; flashColor = COMP.blackhole.color;
    opalio = true;
  } else if (gest === 'right' && PS.hasSweep) {
    sweeps.push({ kind: 'sweep', t: 0, dur: PS.swDur, dmg: PS.swDmg, w: PS.swW,
                  a0: -Math.PI * 0.86, a1: -Math.PI * 0.14, next: 0 });
    shake = Math.max(shake, 10); flash = 0.22; flashColor = COMP.sweep.color;
    opalio = true;
  } else if (gest === 'left' && PS.hasRail) {
    sweeps.push({ kind: 'rail', t: 0, dur: PS.rlDur, dmg: PS.rlDmg, n: PS.rlN,
                  a0: -Math.PI * 0.14, a1: -Math.PI * 0.86, next: 0, fired: 0 });
    shake = Math.max(shake, 12); flash = 0.22; flashColor = COMP.rail.color;
    opalio = true;
  } else if (gest === 'up' && PS.hasEmp) {
    emps.push({
      x: player.x, y: player.y, r: 20, rMax: PS.empRad,
      dmg: PS.empDmg, t: 0, dur: 0.55, hit: []
    });
    shake = Math.max(shake, 18); flash = 0.30; flashColor = COMP.emp.color;
    opalio = true;
  }
  if (!opalio) { showToast('NEMAŠ TO ORUŽJE'); return; }
  rad -= RAD_PER_SHOT;
  radFlash = 0.8;
}

/* Crna rupa: stoji na mestu, vuče protivnike ka sebi i melje ih. */
function updateHoles(dt) {
  for (let i = holes.length - 1; i >= 0; i--) {
    const h = holes[i];
    h.t += dt; h.life -= dt;
    if (h.life <= 0) {
      burst(h.x, h.y, COMP.blackhole.color, 30, 260);
      rings.push({ x: h.x, y: h.y, r: h.r, t: 0, dur: 0.4, color: COMP.blackhole.color });
      holes.splice(i, 1);
      continue;
    }
    for (const e of enemies) {
      if (e.hide || e.down || warpSafe(e) || (isBoss(e) && e.state === 'in')) continue;
      const dx = h.x - e.x, dy = h.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > h.r) continue;
      const f = 1 - d / h.r;
      // bosove i tornjeve ne vuče, samo melje
      if (!isBoss(e) && e.type !== 'pod' && e.type !== 'twin') {
        /* Vuča raste ka centru i mora da nadjača kretanje protivnika —
           inače brži tipovi prosto prolete kroz rupu. */
        const pull = (240 + 620 * f * f) * dt;
        const inv = 1 / (d || 1);
        e.x += dx * inv * pull;
        e.y += dy * inv * pull;
        if (e.baseX !== undefined) e.baseX = e.x;
        if (e.hover !== undefined) e.hover = e.y;
        // dok je u rupi ne može da nasrne niti da telegrafira napad
        if (e.dash === 'warn' || e.dash === 'go') { e.dash = 'idle'; e.dashT = 0.8; }
      }
      damageEnemy(e, h.dmg * dt * (0.55 + 0.45 * f), e.x, e.y);
    }
    for (let j = mines.length - 1; j >= 0; j--) {
      const m = mines[j];
      if (Math.hypot(h.x - m.x, h.y - m.y) < h.r) { burst(m.x, m.y, ENEMY.miner.color, 8, 120); mines.splice(j, 1); }
    }
    for (let j = ebullets.length - 1; j >= 0; j--) {
      const b = ebullets[j];
      if (Math.hypot(h.x - b.x, h.y - b.y) < h.r * 0.75) ebullets.splice(j, 1);
    }
    if (Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, rr = h.r * (0.5 + Math.random() * 0.5);
      particles.push({ x: h.x + Math.cos(a) * rr, y: h.y + Math.sin(a) * rr,
                       vx: -Math.cos(a) * 150, vy: -Math.sin(a) * 150,
                       life: 0.4, max: 0.5, color: COMP.blackhole.color, size: rnd(1.5, 3) });
    }
  }
}

function drawHoles() {
  for (const h of holes) {
    const f = clamp(h.life / h.max, 0, 1);
    const gr = h.r * (0.25 + 0.15 * Math.sin(h.t * 6));
    const sc = pS(h.y), qx = pX(h.x, h.y), qy = pY(h.y), sq = persp ? 0.55 : 1;
    ctx.save();
    // jezgro
    ctx.globalAlpha = 0.9 * Math.min(1, f * 3);
    ctx.fillStyle = '#05060a';
    ctx.beginPath(); ctx.ellipse(qx, qy, gr * sc, gr * sc * sq, 0, 0, Math.PI * 2); ctx.fill();
    // obruči
    ctx.strokeStyle = COMP.blackhole.color;
    ctx.shadowColor = COMP.blackhole.color; ctx.shadowBlur = 22;
    for (let k = 0; k < 3; k++) {
      const rr = h.r * (0.45 + k * 0.28) * (0.92 + 0.08 * Math.sin(h.t * 4 + k));
      ctx.globalAlpha = (0.55 - k * 0.14) * f;
      ctx.lineWidth = (4 - k) * sc;
      ctx.beginPath();
      ctx.ellipse(qx, qy, rr * sc, rr * sc * sq, h.t * (0.6 + k * 0.3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.30 * f;
    ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.ellipse(qx, qy, h.r * sc, h.r * sc * sq, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

/* EMP: udarni talas od broda, slabi sa udaljenošću. */
function updateEmp(dt) {
  for (let i = emps.length - 1; i >= 0; i--) {
    const w = emps[i];
    w.t += dt;
    w.r = 20 + (w.rMax - 20) * Math.pow(clamp(w.t / w.dur, 0, 1), 0.6);
    for (const e of enemies) {
      if (e.hide || e.down || warpSafe(e) || (isBoss(e) && e.state === 'in')) continue;
      if (w.hit.indexOf(e) >= 0) continue;
      const d = Math.hypot(e.x - w.x, e.y - w.y);
      if (d > w.r) continue;
      w.hit.push(e);
      const f = Math.pow(clamp(1 - d / w.rMax, 0, 1), 1.4);
      damageEnemy(e, Math.round(w.dmg * f), e.x, e.y);
      burst(e.x, e.y, COMP.emp.color, 5, 130);
    }
    for (let j = ebullets.length - 1; j >= 0; j--) {
      const b = ebullets[j];
      if (Math.hypot(b.x - w.x, b.y - w.y) < w.r) ebullets.splice(j, 1);
    }
    if (w.t > w.dur + 0.2) emps.splice(i, 1);
  }
}

function drawEmp() {
  ctx.save();
  for (const w of emps) {
    const f = clamp(w.t / w.dur, 0, 1);
    const a = Math.pow(1 - clamp((w.t - w.dur) / 0.2, 0, 1), 1.2) * (1 - f * 0.45);
    const sc = pS(w.y), qx = pX(w.x, w.y), qy = pY(w.y), sq = persp ? 0.55 : 1;
    ctx.globalAlpha = 0.7 * a;
    ctx.strokeStyle = COMP.emp.color;
    ctx.shadowColor = COMP.emp.color; ctx.shadowBlur = 24;
    ctx.lineWidth = (10 - 6 * f) * sc;
    ctx.beginPath(); ctx.ellipse(qx, qy, w.r * sc, w.r * sc * sq, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.4 * a;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.ellipse(qx, qy, w.r * 0.86 * sc, w.r * 0.86 * sc * sq, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   METEORSKO POLJE — prelaz ka sledećoj misiji.
   Oružja ne rade, meteori se ne mogu uništiti, samo izbeći.
   ============================================================ */

let bgSwap = 0;        // koliko je pozadina već zamenjena tokom polja
let trKeepBg = false;  // ulazak u misiju iz polja zadržava pozadinu koja je već u kadru
let levelCommitted = false;   // je li napredak za tekući nivo već upisan
let rockRunCd = 0, rockBurst = 0, rockBurstCd = 0, rockRuns = 0;   // povremene grupe meteora u misiji

/* Napredak se mora upisati i kad se sleti i kad se produži kroz polje —
   inače pređen nivo ne uđe u progres ako igrač ne sleti. */
function commitLevel() {
  if (levelCommitted) return;
  levelCommitted = true;
  if (level >= save.unlocked && level < LEVELS.length) save.unlocked = level + 1;
  if (diff >= maxDiff(level) && diff < DIFF_MAX) {
    save.diff[level] = diff + 1;
    showToast('OTKLJUČANA TEŽINA T' + (diff + 1) + ' ZA ' + levelDef.name);
  }
  writeSave();
}

function startTransit() {
  commitLevel();
  transit = true;
  bgSwap = 0;
  askExit = 0;
  trT = 0;
  trHits = 0;
  chainCount++;
  // duže i gušće polje kako se ide dublje
  trDur = 15 + Math.min(11, chainCount * 1.8) + Math.min(7, (level - 1) * 0.5);
  trSpawn = 0;
  trBonus = Math.max(40, Math.round(runCoins * 0.20));   // petina onoga što si upravo sakupio
  rocks.length = 0;
  drones.length = 0;                 // dron se uvlači — u polju nema šta da radi
  enemies.length = 0; ebullets.length = 0; pendingSpawns.length = 0;
  bullets.length = 0; rockets.length = 0; mines.length = 0;
  holes.length = 0; emps.length = 0; sweeps.length = 0; bolts.length = 0; pulses.length = 0; antis.length = 0;
  showToast('METEORSKO POLJE');
}

/* Grupa meteora koja povremeno preleti kroz misiju — isto ponašanje
   kao u meteorskom polju, samo u manjem broju. */
function updateRockRun(dt) {
  if (transit || levelDone || !player.alive) return;
  if (rockBurst > 0) {
    rockBurstCd -= dt;
    if (rockBurstCd <= 0) { spawnRock(true); rockBurst--; rockBurstCd = rnd(0.16, 0.34); }
  } else {
    if (rockRuns > 0) {
      rockRunCd -= dt;
      if (rockRunCd <= 0) {
        rockBurst = rndi(4, 5);
        rockBurstCd = 0;
        rockRuns--;
        rockRunCd = rnd(15, 23);
        showToast('METEORI');
      }
    }
  }
  for (let i = rocks.length - 1; i >= 0; i--) {
    const k = rocks[i];
    k.x += k.vx * dt; k.y += k.vy * dt; k.rot += k.spin * dt;
    if (rockOut(k)) { rocks.splice(i, 1); continue; }
    if (!player.alive || player.warp || player.inv > 0) continue;
    if (persp && k.y < 0) continue;
    const rr = k.r + player.r;
    if (dist2(k, player) < rr * rr) {
      hurtPlayer(Math.round((14 + k.r * 0.8) * dDmg));
      burst(k.x, k.y, '#8a94a6', 14, 190);
      shake = Math.max(shake, 10);
      const dx = k.x - player.x || 1;
      k.vx += Math.sign(dx) * 150; k.y += 22;
      player.inv = 0.5;
    }
  }
}

/* U nagnutom prikazu se x sabija ka sredini, pa granica u koordinatama sveta
   nije granica na ekranu — meteor bi nestao usred slike. Proverava se ekran. */
function rockOut(k) {
  if (k.y - k.r > VH + 80) return true;
  const sx = pX(k.x, k.y), rr = k.r * pS(k.y);
  return sx + rr < -20 || sx - rr > VW + 20;
}

function spawnRock(uMisiji) {
  const f = uMisiji ? 0.35 : clamp(trT / Math.max(1, trDur), 0, 1);
  const r = rnd(15, 15 + 34 * (0.55 + f * 0.75));
  // sa napretkom kroz polje kamenje ide sve kosije
  const kos = uMisiji ? 0.30 : Math.min(0.85, (0.26 + f * 0.58) * (1 + (chainCount - 1) * 0.20));
  const ang = Math.PI / 2 + rnd(-kos, kos);
  const spd = rnd(390, 545) + f * 260 + (uMisiji ? 0 : chainCount * 34);
  const x0 = rnd(-60, VW + 60);
  rocks.push({
    x: x0, y: -WARP_DEPTH * 0.92 - r,
    vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
    r: r, rot: rnd(0, 6.28), spin: rnd(-2.2, 2.2),
    shape: Math.floor(rnd(0, 4))
  });
}

function updateTransit(dt) {
  trT += dt;
  const f = clamp(trT / trDur, 0, 1);

  /* Pozadina se u letu neprimetno zamenjuje pozadinom sledeće misije,
     i kreće se brže — da se oseti da se stvarno negde stiže. */
  if (bgSwap === 0 && f > 0.16) {
    bgSwap = 1;
    buildBackdrop(clamp(level + 1, 1, LEVELS.length), backdrop2);
    for (const o of backdrop2) o.y = rnd(-o.img.height, VH * 0.8);
    bgMix = 0;
  }
  if (bgSwap === 1) {
    // meko preplitanje kroz sredinu polja
    const t2 = clamp((f - 0.16) / 0.62, 0, 1);
    bgMix = t2 * t2 * (3 - 2 * t2);
  }
  const zalet = 1 + 5.5 * Math.sin(Math.min(1, f * 1.1) * Math.PI);
  updateBackdrop(dt * zalet);
  for (const st of stars) {
    st.y += st.v * (zalet - 1) * dt;
    if (st.y > VH) { st.y = -4; st.x = Math.random() * VW; }
  }

  // gustina raste ka sredini polja pa se pri kraju smiruje
  const gust = 0.150 - 0.055 * Math.sin(Math.min(1, f * 1.15) * Math.PI) - chainCount * 0.006;
  trSpawn -= dt;
  if (trSpawn <= 0 && f < 0.94) { spawnRock(); trSpawn = gust; }

  for (let i = rocks.length - 1; i >= 0; i--) {
    const k = rocks[i];
    k.x += k.vx * dt;
    k.y += k.vy * dt;
    k.rot += k.spin * dt;
    if (rockOut(k)) { rocks.splice(i, 1); continue; }
    if (!player.alive || player.warp || player.inv > 0) continue;
    if (persp && k.y < 0) continue;      // dok su u daljini, ne mogu da udare
    const rr = k.r + player.r;
    if (dist2(k, player) < rr * rr) {
      const dmg = Math.round((16 + k.r * 0.9) * dDmg);
      hurtPlayer(dmg);
      trHits++;
      burst(k.x, k.y, '#8a94a6', 16, 200);
      shake = Math.max(shake, 12);
      // odbije se u stranu da ne melje na istom mestu
      const dx = k.x - player.x || 1;
      k.vx += Math.sign(dx) * 160;
      k.y += 24;
      player.inv = 0.5;
    }
  }

  if (f >= 1 && rocks.length === 0) {
    // polje pređeno — nagrada pa sledeća misija
    save.coins += trBonus;
    runCoins += trBonus;
    writeSave();
    showToast('POLJE PREĐENO  +' + fmt(trBonus));
    transit = false;
    const next = clamp(level + 1, 1, LEVELS.length);
    const keepHp = player.hp;
    const keepRad = rad;
    // brod nastavlja tačno odakle je i bio — ne teleportuje se na sredinu
    const kx = player.x, ky = player.y;
    const ktx = player.tx, kty = player.ty;
    const kvx = player.vx, kvy = player.vy;
    const ktrail = player.trail ? player.trail.slice() : null;
    trKeepBg = true;
    startLevel(next, diff);
    player.hp = clamp(keepHp, 1, player.maxHp);
    rad = keepRad;
    player.warp = null;              // bez ponovnog ulaska iz warpa
    player.x = kx; player.y = ky;
    player.tx = ktx; player.ty = kty;
    player.vx = kvx; player.vy = kvy;
    player.inv = 0;                  // bez treptanja — prelaz je neprekidan
    if (ktrail) player.trail = ktrail;
    // nova pozadina je već u kadru — preuzmi je kao tekuću, bez ponovnog crtanja
    if (backdrop2.length) {
      backdrop.length = 0;
      for (const o of backdrop2) backdrop.push(o);
      backdrop2.length = 0;
    }
    bgMix = 0; bgSwap = 0;
  }
}

function drawRocks() {
  ctx.save();
  for (const k of rocks) {
    const sc = pS(k.y), qx = pX(k.x, k.y), qy = pY(k.y);
    const rr = k.r * sc;
    if (rr < 0.6) continue;
    // u warp-zoni se postepeno pojavljuje, kao i protivnici
    const a = k.y < 0 ? Math.pow(warpT(k.y), 1.6) : 1;
    if (a < 0.02) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(qx, qy);
    ctx.rotate(k.rot);
    ctx.fillStyle = '#2b3444';
    ctx.strokeStyle = '#8a94a6';
    ctx.lineWidth = Math.max(1, 2 * sc);
    ctx.shadowColor = '#6b7a8f'; ctx.shadowBlur = 8 * sc;
    ctx.beginPath();
    const n = 7 + k.shape;
    for (let j = 0; j < n; j++) {
      const a = j / n * Math.PI * 2;
      const q = rr * (0.72 + 0.28 * Math.abs(Math.sin(j * 2.7 + k.shape)));
      const px2 = Math.cos(a) * q, py2 = Math.sin(a) * q;
      if (j === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/* ============================================================
   PULS LASER — rafal tankih zraka u najbližeg protivnika.
   Luk gađanja raste sa nivoom: od uskog konusa napred do punog kruga.
   ============================================================ */

function pulseTarget() {
  let best = null, bd = 1e9;
  const half = PS.plArc / 2;
  for (const e of enemies) {
    if (isBoss(e) && e.state === 'in') continue;
    if (e.invuln || e.down || e.hide || warpSafe(e) || e.hacked) continue;
    if (e.y < 0) continue;
    const a = Math.atan2(e.y - player.y, e.x - player.x);
    let d = a - (-Math.PI / 2);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > half) continue;
    const dd = dist2(e, player);
    if (dd < bd) { bd = dd; best = e; }
  }
  return best;
}

function firePulse() {
  const t = pulseTarget();
  if (!t) return false;
  const base = Math.atan2(t.y - player.y, t.x - player.x);
  for (let i = 0; i < PS.plN; i++) {
    pulses.push({
      x: player.x, y: player.y - 8, ang: base + rnd(-0.05, 0.05),
      dmg: PS.plDmg, len: 0, life: 0.22, max: 0.22, delay: i * 0.055, hit: false
    });
  }
  if (!brownout) spend(COMP.pulse.pw * PS.plN);
  return true;
}

function updatePulses(dt) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    if (!p.hit) {
      p.hit = true;
      const fx = p.x + Math.cos(p.ang) * 1400, fy = p.y + Math.sin(p.ang) * 1400;
      let best = null, bd = 1e9;
      for (const e of enemies) {
        if (isBoss(e) && e.state === 'in') continue;
        if (e.invuln || e.down || e.hide || warpSafe(e) || e.hacked) continue;
        const rr = e.r + 7;
        if (segDist2(e.x, e.y, p.x, p.y, fx, fy) < rr * rr) {
          const dd = dist2(e, p);
          if (dd < bd) { bd = dd; best = e; }
        }
      }
      if (best) {
        p.len = Math.sqrt(bd);
        damageEnemy(best, p.dmg, best.x, best.y);
        burst(best.x, best.y, COMP.pulse.color, 4, 120);
      } else p.len = 1400;
    }
    p.life -= dt;
    if (p.life <= 0) pulses.splice(i, 1);
  }
}

function drawPulses() {
  ctx.save();
  for (const p of pulses) {
    if (p.delay > 0) continue;
    const a = clamp(p.life / p.max, 0, 1);
    const ex = p.x + Math.cos(p.ang) * p.len, ey = p.y + Math.sin(p.ang) * p.len;
    ctx.globalAlpha = 0.85 * a;
    ctx.strokeStyle = COMP.pulse.color;
    ctx.shadowColor = COMP.pulse.color; ctx.shadowBlur = 14;
    ctx.lineWidth = 3.5 * pS(p.y) * a;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pX(p.x, p.y), pY(p.y));
    ctx.lineTo(pX(ex, ey), pY(ey));
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 * pS(p.y) * a;
    ctx.beginPath();
    ctx.moveTo(pX(p.x, p.y), pY(p.y));
    ctx.lineTo(pX(ex, ey), pY(ey));
    ctx.stroke();
  }
  ctx.restore();
}

/* ============================================================
   ANTIMATERIJA — kugla zastane pred brodom, seva munjama na sve
   strane, pa ubrza naviše i melje sve na putu.
   ============================================================ */

function fireAnti() {
  antis.push({
    x: player.x, y: player.y - 34, vy: -40,
    dmg: PS.amDmg, rad: PS.amRad, t: 0, phase: 'hold',
    arcCd: 0, hit: [], r: 17
  });
  if (!brownout) spend(COMP.anti.pw);
  shake = Math.max(shake, 6);
  return true;
}

function updateAntis(dt) {
  for (let i = antis.length - 1; i >= 0; i--) {
    const a = antis[i];
    a.t += dt;
    if (a.phase === 'hold') {
      a.y += a.vy * dt;
      if (a.t > 0.9) { a.phase = 'go'; a.vy = -140; }
    } else {
      a.vy -= 900 * dt;
      a.y += a.vy * dt;
    }

    a.arcCd -= dt;
    if (a.arcCd <= 0) {
      a.arcCd = 0.16;
      const used = [];
      for (let k = 0; k < 3; k++) {
        const t2 = nearestEnemy(a.x, a.y, a.rad, used);
        if (!t2) break;
        used.push(t2);
        damageEnemy(t2, Math.round(a.dmg * AM_ARC_FRAC * 0.34), t2.x, t2.y);
        bolts.push({ pts: [{ x: a.x, y: a.y }, { x: t2.x, y: t2.y }], life: 0.12, max: 0.12, color: COMP.anti.color });
      }
    }

    for (const e of enemies) {
      if (isBoss(e) && e.state === 'in') continue;
      if (e.down || e.hide || warpSafe(e) || a.hit.indexOf(e) >= 0) continue;
      const rr = e.r + a.r + 6;
      if (dist2(e, a) < rr * rr) {
        a.hit.push(e);
        damageEnemy(e, a.dmg, e.x, e.y);
        burst(e.x, e.y, COMP.anti.color, 12, 190);
      }
    }

    if (Math.random() < 0.8)
      particles.push({ x: a.x + rnd(-12, 12), y: a.y + rnd(-12, 12), vx: rnd(-40, 40), vy: rnd(-20, 60),
                       life: 0.35, max: 0.4, color: COMP.anti.color, size: rnd(1.5, 3.5) });

    if (a.y < -WARP_DEPTH * 0.5 || a.t > 7) {
      rings.push({ x: a.x, y: a.y, r: a.rad * 0.7, t: 0, dur: 0.3, color: COMP.anti.color });
      antis.splice(i, 1);
    }
  }
}

function drawAntis() {
  ctx.save();
  for (const a of antis) {
    const sc = pS(a.y), qx = pX(a.x, a.y), qy = pY(a.y), sq = persp ? 0.62 : 1;
    const puls = 1 + 0.16 * Math.sin(a.t * 14);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = COMP.anti.color;
    ctx.lineWidth = 1.5 * sc;
    ctx.beginPath();
    ctx.ellipse(qx, qy, a.rad * sc, a.rad * sc * sq, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = COMP.anti.color;
    ctx.shadowColor = COMP.anti.color; ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.ellipse(qx, qy, a.r * puls * sc, a.r * puls * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(qx, qy, a.r * 0.42 * puls * sc, a.r * 0.42 * puls * sc, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ============================================================
   HAKER — preuzima protivničku letelicu i zabija je u susednu.
   Bosovi se ne mogu preuzeti, ali mogu biti udareni.
   ============================================================ */

function hackable(e) {
  return e && !isBoss(e) && !e.hide && !e.down && !e.hacked && !e.invuln
         && !warpSafe(e) && e.type !== 'pod' && e.type !== 'twin' && e.y > 20;
}

function pickHackTarget(from, skip) {
  let best = null, bd = 1e9;
  for (const e of enemies) {
    if (e === skip || e.hacked) continue;
    if (e.hide || e.down || warpSafe(e) || (isBoss(e) && e.state === 'in')) continue;
    if (e.y < 0) continue;
    const d = dist2(e, from);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function doHack() {
  const pool = [];
  for (const e of enemies) if (hackable(e)) pool.push(e);
  if (!pool.length) return false;
  const e = pool[rndi(0, pool.length - 1)];
  const meta = pickHackTarget(e, e);
  e.hacked = true;
  e.hackT = 0;
  e.hackTarget = meta;
  e.hackPow = Math.round(e.maxHp * PS.hkPow);
  burst(e.x, e.y, COMP.hack.color, 18, 190);
  rings.push({ x: e.x, y: e.y, r: e.r + 26, t: 0, dur: 0.4, color: COMP.hack.color });
  if (!brownout) spend(COMP.hack.pw);
  showToast('PREUZETO: ' + (meta ? 'udar u metu' : 'nema mete'));
  return true;
}

/* Oteta letelica juri ka meti i eksplodira pri udaru. */
function updateHacked(e, dt) {
  e.hackT += dt;
  if (!e.hackTarget || enemies.indexOf(e.hackTarget) < 0 || e.hackTarget.hacked)
    e.hackTarget = pickHackTarget(e, e);

  if (Math.random() < 0.5)
    particles.push({ x: e.x + rnd(-8, 8), y: e.y + rnd(-8, 8), vx: rnd(-30, 30), vy: rnd(-20, 40),
                     life: 0.35, max: 0.4, color: COMP.hack.color, size: rnd(1.5, 3) });

  if (!e.hackTarget) {
    // nema u koga — odleti naviše i raspadne se
    e.y -= 340 * dt;
    if (e.y < -60 || e.hackT > 6) {
      burst(e.x, e.y, COMP.hack.color, 20, 220);
      const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1);
    }
    return;
  }

  const t = e.hackTarget;
  const dx = t.x - e.x, dy = t.y - e.y, l = Math.hypot(dx, dy) || 1;
  const spd = 430;
  e.x += dx / l * spd * dt;
  e.y += dy / l * spd * dt;

  const rr = e.r + t.r;
  if (l < rr || e.hackT > 7) {
    // sudar: meta prima oklop otete letelice, obe eksplodiraju
    burst(e.x, e.y, COMP.hack.color, 26, 260);
    rings.push({ x: e.x, y: e.y, r: 90, t: 0, dur: 0.35, color: COMP.hack.color });
    shake = Math.max(shake, 9);
    damageEnemy(t, e.hackPow, e.x, e.y);
    // udarni talas zahvata i susede
    const R = 90;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const o = enemies[j];
      if (o === e || o === t || o.hacked) continue;
      const ox = o.x - e.x, oy = o.y - e.y;
      if (ox * ox + oy * oy < R * R) damageEnemy(o, Math.round(e.hackPow * 0.5), e.x, e.y);
    }
    const i = enemies.indexOf(e);
    if (i >= 0) killEnemy(i, false);
  }
}

/* Skrol laser i rail top: oba prelaze ekran u luku, jedan kao neprekidan
   snop, drugi kao rafal zrna. Ugao ide od a0 do a1 tokom trajanja. */
function sweepAngle(sw) {
  const f = clamp(sw.t / sw.dur, 0, 1);
  const e = f * f * (3 - 2 * f);            // meko kreće i meko staje
  return sw.a0 + (sw.a1 - sw.a0) * e;
}

function updateSweeps(dt) {
  for (let i = sweeps.length - 1; i >= 0; i--) {
    const sw = sweeps[i];
    sw.t += dt;
    const ang = sweepAngle(sw);
    sw.ang = ang;
    const ox = player.x, oy = player.y - 12;
    const L = 2200;
    const tx = ox + Math.cos(ang) * L, ty = oy + Math.sin(ang) * L;

    if (sw.kind === 'sweep') {
      // neprekidan snop — melje sve preko čega pređe
      for (const e of enemies) {
        if (e.hide || e.down || warpSafe(e) || (isBoss(e) && e.state === 'in')) continue;
        const rr = sw.w / 2 + e.r;
        if (segDist2(e.x, e.y, ox, oy, tx, ty) < rr * rr) {
          damageEnemy(e, sw.dmg * dt, e.x, e.y);
          if (Math.random() < 0.3) burst(e.x, e.y, COMP.sweep.color, 2, 90);
        }
      }
      for (let j = mines.length - 1; j >= 0; j--) {
        const m = mines[j];
        if (segDist2(m.x, m.y, ox, oy, tx, ty) < (sw.w / 2 + m.r) * (sw.w / 2 + m.r)) {
          burst(m.x, m.y, ENEMY.miner.color, 8, 130); mines.splice(j, 1);
        }
      }
    } else {
      // rail: ispaljuje zrna duž luka
      const treba = Math.floor(clamp(sw.t / sw.dur, 0, 1) * sw.n);
      while (sw.fired < treba) {
        sw.fired++;
        const f2 = sw.fired / sw.n;
        const ee = f2 * f2 * (3 - 2 * f2);
        const a2 = sw.a0 + (sw.a1 - sw.a0) * ee;
        bullets.push({
          x: ox + Math.cos(a2) * 16, y: oy + Math.sin(a2) * 16,
          vx: Math.cos(a2) * 1500, vy: Math.sin(a2) * 1500,
          dmg: sw.dmg, r: 9, rail: true
        });
        if (sw.fired % 3 === 0) shake = Math.max(shake, 4);
      }
    }
    if (sw.t > sw.dur + 0.12) sweeps.splice(i, 1);
  }
}

function drawSweeps() {
  for (const sw of sweeps) {
    const f = clamp(sw.t / sw.dur, 0, 1);
    const a = sw.t > sw.dur ? clamp(1 - (sw.t - sw.dur) / 0.12, 0, 1) : Math.min(1, sw.t / 0.08);
    const ox = player.x, oy = player.y - 12;
    const ang = sw.ang !== undefined ? sw.ang : sweepAngle(sw);
    if (sw.kind === 'sweep') {
      const L = 2200;
      const half = sw.w / 2;
      const nx = -Math.sin(ang) * half, ny = Math.cos(ang) * half;
      ctx.save();
      ctx.shadowColor = COMP.sweep.color; ctx.shadowBlur = 26;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = (pass ? 0.95 : 0.55) * a;
        ctx.fillStyle = pass ? '#ffffff' : COMP.sweep.color;
        const k = pass ? 0.28 : 1;
        const N = 10;
        ctx.beginPath();
        for (let q = 0; q <= N; q++) {
          const t2 = q / N, wx = ox + Math.cos(ang) * L * t2, wy = oy + Math.sin(ang) * L * t2;
          const p2 = pS(wy) / Math.max(0.01, pS(oy));
          const px2 = pX(wx + nx * k * p2, wy), py2 = pY(wy + ny * k * p2);
          if (q === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        for (let q = N; q >= 0; q--) {
          const t2 = q / N, wx = ox + Math.cos(ang) * L * t2, wy = oy + Math.sin(ang) * L * t2;
          const p2 = pS(wy) / Math.max(0.01, pS(oy));
          ctx.lineTo(pX(wx - nx * k * p2, wy), pY(wy - ny * k * p2));
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    } else {
      // rail: kratak bljesak na cevi u pravcu trenutnog ugla
      ctx.save();
      ctx.globalAlpha = 0.8 * a;
      ctx.strokeStyle = COMP.rail.color;
      ctx.shadowColor = COMP.rail.color; ctx.shadowBlur = 20;
      ctx.lineWidth = 5 * pS(oy);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pX(ox, oy), pY(oy));
      const ex2 = ox + Math.cos(ang) * 60, ey2 = oy + Math.sin(ang) * 60;
      ctx.lineTo(pX(ex2, ey2), pY(ey2));
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------- BLIZINSKA SAČMARA ---------- */

/* Sačmara bira najbližu metu u bilo kom pravcu — protivnika ili minu. */
function sgTarget() {
  let best = null, bd = PS.sgRange * PS.sgRange;
  for (const e of enemies) {
    if (isBoss(e) && e.state === 'in') continue;
    if (e.invuln || e.down || e.hide || warpSafe(e) || e.hacked) continue;
    if (e.y < 0) continue;
    const d = dist2(e, player);
    if (d < bd) { bd = d; best = e; }
  }
  for (const m of mines) {
    const d = dist2(m, player);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

function fireShotgun() {
  const t = sgTarget();
  if (!t) return false;
  const base = Math.atan2(t.y - player.y, t.x - player.x);
  const n = PS.sgN, cone = PS.sgCone;
  let dmg = PS.sgDmg;
  if (player.pu.power) dmg = Math.round(dmg * 1.8);
  if (brownout) dmg = Math.round(dmg * 0.6);
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const a = base + f * cone + rnd(-0.03, 0.03);
    const sp = rnd(560, 700);
    bullets.push({
      x: player.x + Math.cos(base) * 10, y: player.y + Math.sin(base) * 10,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      dmg: dmg, r: 5, life: (PS.sgRange + 40) / sp, pellet: true
    });
  }
  burst(player.x + Math.cos(base) * 14, player.y + Math.sin(base) * 14, COMP.shotgun.color, 10, 170);
  player.sgFlash = 0.16;
  player.sgAng = base;
  shake = Math.max(shake, 4);
  if (!brownout) spend(COMP.shotgun.pw);
  return true;
}

/* ---------- MUNJA ---------- */

function nearestEnemy(x, y, maxD, skip) {
  let best = null, bd = maxD * maxD;
  for (const e of enemies) {
    if (isBoss(e) && e.state === 'in') continue;
    if (e.invuln || e.down || e.hide || warpSafe(e) || e.hacked) continue;
    if (e.y < 0) continue;
    if (skip.indexOf(e) >= 0) continue;
    const dx = e.x - x, dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

const BOLT_RANGE = 175;                                    // domet skoka sa mete na metu
const BOLT_REACH = [0, 520, 580, 640, 700, 760, 820, 880, 940, 1000, 1060];   // domet do prve mete
const BOLT_FALL = 0.75;

function fireBolt() {
  const used = [];
  let fired = false;
  const reach = BOLT_REACH[bestLv('bolt')] || 520;
  for (let k = 0; k < PS.boltN; k++) {
    let cur = nearestEnemy(player.x, player.y, reach, used);
    if (!cur) break;
    fired = true;
    const pts = [{ x: player.x, y: player.y - 18 }];
    let dmg = PS.boltDmg * (player.pu.power ? 1.8 : 1) * (brownout ? 0.6 : 1);
    let prev = { x: player.x, y: player.y - 18 };
    for (let h = 0; h < PS.boltHops; h++) {
      if (!cur) break;
      // tačka pogotka na obodu mete, sa strane sa koje munja dolazi
      const dx = prev.x - cur.x, dy = prev.y - cur.y, l = Math.hypot(dx, dy) || 1;
      const hx = cur.x + dx / l * cur.r, hy = cur.y + dy / l * cur.r;
      damageEnemy(cur, Math.round(dmg), hx, hy);
      burst(hx, hy, COMP.bolt.color, 4, 110);
      pts.push({ x: cur.x, y: cur.y });
      used.push(cur);
      prev = { x: cur.x, y: cur.y };
      dmg *= BOLT_FALL;
      cur = nearestEnemy(cur.x, cur.y, BOLT_RANGE, used);
    }
    if (pts.length > 1) bolts.push({ pts: pts, life: 0.28, max: 0.28 });
  }
  if (fired && !brownout) spend(COMP.bolt.pw * PS.boltN);
  return fired;
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    bolts[i].life -= dt;
    if (bolts[i].life <= 0) bolts.splice(i, 1);
  }
}

function drawBolts() {
  if (!bolts.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const b of bolts) {
    const f = clamp(b.life / b.max, 0, 1);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? '#ffffff' : COMP.bolt.color;
      ctx.shadowColor = COMP.bolt.color;
      ctx.shadowBlur = pass ? 8 : 20;
      ctx.lineWidth = pass ? 1.6 : 4.5;
      ctx.globalAlpha = f * (pass ? 1 : 0.8);
      ctx.beginPath();
      for (let i = 1; i < b.pts.length; i++) {
        const a = b.pts[i - 1], c = b.pts[i];
        ctx.moveTo(pX(a.x, a.y), pY(a.y));
        const segs = 4;
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const jx = k === segs ? 0 : rnd(-9, 9);
          const jy = k === segs ? 0 : rnd(-9, 9);
          const wx = a.x + (c.x - a.x) * t, wy = a.y + (c.y - a.y) * t;
          ctx.lineTo(pX(wx, wy) + jx, pY(wy) + jy);
        }
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ---------- MINE ---------- */

const MINE_SEEK = 175;   // brzina kojom mina ide ka brodu

function dropMine(x, y, dmg, fuse) {
  mines.push({
    x: x, y: y, vx: rnd(-40, 40), vy: rnd(30, 70), hp: 14, arm: 0.5,
    fuse: fuse || 4.5, maxFuse: fuse || 4.5, t: 0, r: 15, dmg: Math.round((dmg || 26) * dDmg)
  });
}

function makeBlast(x, y, rMax, dmg, color) {
  blasts.push({ x: x, y: y, r: 10, rMax: rMax, t: 0, dur: 0.45, dmg: dmg, color: color || '#ffb03a', hit: false });
  burst(x, y, color || '#ffb03a', 22, 260);
  shake = Math.max(shake, 11);
}

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].t += dt;
    if (rings[i].t > rings[i].dur) rings.splice(i, 1);
  }
}

function drawRings() {
  ctx.save();
  for (const r of rings) {
    const f = clamp(r.t / r.dur, 0, 1);
    const rr = r.r * (0.25 + 0.75 * Math.pow(f, 0.55));
    const a = Math.pow(1 - f, 1.5);
    const sc = pS(r.y), qx = pX(r.x, r.y), qy = pY(r.y), sq = persp ? 0.55 : 1;
    ctx.globalAlpha = 0.75 * a;
    ctx.strokeStyle = r.color;
    ctx.shadowColor = r.color; ctx.shadowBlur = 18;
    ctx.lineWidth = (2 + 5 * a) * sc;
    ctx.beginPath();
    ctx.ellipse(qx, qy, rr * sc, rr * sc * sq, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.35 * a;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5 * sc;
    ctx.beginPath();
    ctx.ellipse(qx, qy, rr * 0.72 * sc, rr * 0.72 * sc * sq, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function updateBlasts(dt) {
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t += dt;
    b.r = 10 + (b.rMax - 10) * clamp(b.t / b.dur, 0, 1);
    if (!b.hit && player.alive && player.inv <= 0) {
      if (Math.hypot(player.x - b.x, player.y - b.y) < b.r + player.r) {
        hurtPlayer(b.dmg); b.hit = true;
      }
    }
    if (b.t > b.dur + 0.18) blasts.splice(i, 1);
  }
}

function drawBlasts() {
  ctx.save();
  for (const b of blasts) {
    const f = clamp(1 - (b.t - b.dur) / 0.18, 0, 1) * clamp(b.t / b.dur * 2, 0, 1);
    ctx.globalAlpha = 0.75 * f;
    ctx.strokeStyle = b.color; ctx.lineWidth = 6 * f + 2;
    ctx.shadowColor = b.color; ctx.shadowBlur = 22;
    const bs = pS(b.y), bx = pX(b.x, b.y), by = pY(b.y);
    ctx.beginPath(); ctx.ellipse(bx, by, b.r * bs, b.r * bs * (persp ? 0.55 : 1), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.30 * f;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(bx, by, b.r * bs * 0.82, b.r * bs * 0.82 * (persp ? 0.55 : 1), 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function updateMines(dt) {
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.t += dt;
    if (m.arm > 0) m.arm -= dt;

    // mina se navodi ka brodu, sa blagim kašnjenjem da ne seče uglove savršeno
    if (player.alive) {
      const dx = player.x - m.x, dy = player.y - m.y;
      const l = Math.hypot(dx, dy) || 1;
      m.vx += ((dx / l) * MINE_SEEK - m.vx) * 1.7 * dt;
      m.vy += ((dy / l) * MINE_SEEK - m.vy) * 1.7 * dt;
    } else {
      m.vy += 40 * dt;
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.y > VH + 40 || m.x < -60 || m.x > VW + 60) { mines.splice(i, 1); continue; }

    // obaranje mecima ili laserom — bez eksplozije
    let shot = false;
    for (let j = bullets.length - 1; j >= 0; j--) {
      const b = bullets[j];
      const rr = m.r + b.r;
      if (dist2(m, b) < rr * rr) { m.hp -= b.dmg; bullets.splice(j, 1); shot = true; }
    }
    if (player.lsOn > 0 && Math.abs(m.x - player.x) < LASER_HW + m.r && m.y < player.y)
      m.hp -= PS.lsDmg * dt;
    if (m.hp <= 0) {
      burst(m.x, m.y, ENEMY.miner.color, 14, 190);
      mines.splice(i, 1); continue;
    }
    if (shot) burst(m.x, m.y, ENEMY.miner.color, 2, 70);

    // fitilj
    m.fuse -= dt;
    if (m.fuse <= 0) {
      makeBlast(m.x, m.y, 132, m.dmg);
      mines.splice(i, 1); continue;
    }

    // okidanje na blizinu
    if (m.arm <= 0 && player.alive) {
      const rr = 42 + player.r;
      if (dist2(m, player) < rr * rr) {
        makeBlast(m.x, m.y, 132, m.dmg);
        mines.splice(i, 1);
      }
    }
  }
}

function drawMines() {
  const s = getSprite('mine', 30, 30, ENEMY.miner.color, SHAPES.mine, 12);
  for (const m of mines) {
    const armed = m.arm <= 0;
    const f = clamp(m.fuse / m.maxFuse, 0, 1);
    const hot = m.fuse < 1.2;
    wblit(s, m.x, m.y, m.t * 0.7, armed ? 1 : 0.45);

    const mx = pX(m.x, m.y), my = pY(m.y), ms = pS(m.y), sq = persp ? 0.62 : 1;

    // prsten fitilja — pokazuje koliko je ostalo
    ctx.save();
    ctx.globalAlpha = hot ? (0.55 + 0.45 * Math.abs(Math.sin(m.fuse * 22))) : 0.85;
    ctx.strokeStyle = hot ? '#ff3355' : ENEMY.miner.color;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = hot ? 16 : 8;
    ctx.lineWidth = 3 * ms;
    ctx.beginPath();
    ctx.ellipse(mx, my, (m.r + 6) * ms, (m.r + 6) * ms * sq, 0,
                -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
    ctx.stroke();
    ctx.restore();

    // najava domašaja eksplozije pred kraj
    if (hot) {
      ctx.save();
      ctx.globalAlpha = 0.13 + 0.13 * Math.abs(Math.sin(m.fuse * 14));
      ctx.strokeStyle = '#ff3355'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(mx, my, 132 * ms, 132 * ms * sq, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------- LASER ---------- */

const LASER_HW = 11;   // poluširina zraka

function updateLaser(dt) {
  if (!PS.hasLaser) return;
  if (player.lsOn > 0) {
    player.lsOn -= dt;
    if (!brownout) spend(COMP.laser.pw * dt);
    const dmg = PS.lsDmg * dt * (brownout ? 0.6 : 1) * (player.pu.power ? 1.8 : 1);
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (isBoss(e) && e.state === 'in') continue;
      if (e.down || e.hide || warpSafe(e)) continue;
      if (e.y > player.y) continue;
      if (Math.abs(e.x - player.x) > LASER_HW + e.r) continue;
      if (e.type === 'mirror' && e.cool <= 0 && e.y >= e.hover - 20) {
        e.heat += 14 * dt;
        if (e.heat >= 12) { e.cool = 2.5; burst(e.x, e.y, e.color, 16, 190); }
      } else if (e.type === 'shieldbearer' && e.plateDown <= 0 && e.plate > 0) {
        e.plate = Math.max(0, e.plate - dmg);
        e.plateHit = 1.6;
      } else {
        damageEnemy(e, dmg, player.x, e.y + e.r);
      }
      if (Math.random() < 0.25) burst(e.x + rnd(-8, 8), e.y + e.h / 2, COMP.laser.color, 1, 70);
    }
    return;
  }
  if (transit) { player.lsOn = 0; return; }
  player.lsCd -= dt;
  if (player.lsCd <= 0) {
    if (pickTarget()) {
      player.lsOn = PS.lsDur;
      player.lsCd = PS.lsInt * (brownout ? 1.7 : 1) + PS.lsDur;
      shake = Math.max(shake, 5);
    } else player.lsCd = 0.3;
  }
}

function drawLaser() {
  if (!PS.hasLaser || player.lsOn <= 0 || !player.alive) return;
  const col = COMP.laser.color;
  const fade = clamp(player.lsOn / Math.max(0.1, PS.lsDur * 0.35), 0, 1);
  const w = 4 + Math.abs(Math.sin(performance.now() / 40)) * 2;

  if (!persp) {
    const top = SAFE_TOP - 20;
    ctx.save();
    ctx.globalAlpha = 0.5 * fade;
    ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.fillStyle = col;
    ctx.fillRect(player.x - LASER_HW, top, LASER_HW * 2, player.y - top);
    ctx.globalAlpha = 0.95 * fade;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(player.x - w / 2, top, w, player.y - top);
    ctx.restore();
    return;
  }

  /* Zrak ide i kroz warp-zonu i tamo se gubi, umesto da se preseče na horizontu.
     Crta se u trakama da bi svaka mogla da ima svoju prozirnost. */
  const TOPY = -WARP_DEPTH * 0.98;
  const N = 26;
  ctx.save();
  ctx.shadowColor = col; ctx.shadowBlur = 24;
  for (let k = 0; k < N; k++) {
    const ya = player.y + (TOPY - player.y) * (k / N);
    const yb = player.y + (TOPY - player.y) * ((k + 1) / N);
    const fa = ya < 0 ? Math.pow(warpT(ya), 2.0) : 1;
    const fb = yb < 0 ? Math.pow(warpT(yb), 2.0) : 1;
    const a = (fa + fb) / 2;
    if (a < 0.02) continue;
    const sa = pS(ya), sb = pS(yb);
    const xa = pX(player.x, ya), xb = pX(player.x, yb);
    const pa = pY(ya), pb = pY(yb);

    ctx.globalAlpha = 0.5 * fade * a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(xa - LASER_HW * sa, pa); ctx.lineTo(xb - LASER_HW * sb, pb);
    ctx.lineTo(xb + LASER_HW * sb, pb); ctx.lineTo(xa + LASER_HW * sa, pa);
    ctx.closePath(); ctx.fill();

    ctx.globalAlpha = 0.95 * fade * a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(xa - w / 2 * sa, pa); ctx.lineTo(xb - w / 2 * sb, pb);
    ctx.lineTo(xb + w / 2 * sb, pb); ctx.lineTo(xa + w / 2 * sa, pa);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ---------- AUTOPILOT ---------- */

function autopilot(dt) {
  if (!PS.hasAuto || firing || !player.alive || player.warp) return;
  const R = PS.apR;
  let ax = 0, ay = 0, n = 0;

  for (const b of ebullets) {
    const dx = player.x - b.x, dy = player.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > R || d < 0.01) continue;
    if (b.vx * dx + b.vy * dy <= 0) continue;         // ne prilazi
    const w = 1 - d / R;
    ax += (dx / d) * w * 1.6; ay += (dy / d) * w * 0.7; n++;
  }
  for (const e of enemies) {
    if (isBoss(e) && e.state === 'in') continue;
    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d > R + e.r || d < 0.01) continue;
    const w = 1 - d / (R + e.r);
    ax += (dx / d) * w * 1.3; ay += (dy / d) * w * 0.6; n++;
  }
  if (bossRef && bossRef.laser && bossRef.laser.state === 'fire') {
    const dx = player.x - bossRef.laser.x;
    if (Math.abs(dx) < 90) { ax += (dx >= 0 ? 1 : -1) * 2.2; n++; }
  }
  if (n === 0) return;                                 // nema pretnje — ne mrda se

  const l = Math.hypot(ax, ay) || 1;
  const spd = PS.apSpd * Math.min(1, l);
  player.tx += (ax / l) * spd * dt;
  player.ty += (ay / l) * spd * dt;
  player.autoOn = 0.25;
  clampTarget();
}

/* ---------- DRON ---------- */

function mkDrone(i) {
  return {
    idx: i, x: player.x, y: player.y, vx: 0, vy: 0,
    state: 'charging', timer: 1.2 + i * 0.6, fireCd: 0, t: rnd(0, 6)
  };
}

function droneSlot(d) {
  const side = d.idx === 0 ? -1 : 1;
  return { x: player.x + side * 26, y: player.y + 18 };
}

function updateDrones(dt) {
  if (!PS.hasDrone || transit) return;
  for (const d of drones) {
    d.t += dt;
    d.timer -= dt;

    let tx, ty, speed;
    if (d.state === 'out') {
      const tgt = pickTarget();
      if (tgt) { tx = tgt.x; ty = tgt.y + 78; }
      else { tx = player.x + Math.cos(d.t * 1.1) * 90; ty = player.y - 150; }
      speed = 300;
      if (!brownout) spend(COMP.drone.pw * dt);
      if (d.timer <= 0) { d.state = 'back'; }

      d.fireCd -= dt;
      if (d.fireCd <= 0 && tgt) {
        d.fireCd = PS.drInt * (brownout ? 1.7 : 1);
        const dx = tgt.x - d.x, dy = tgt.y - d.y, l = Math.hypot(dx, dy) || 1;
        bullets.push({ x: d.x, y: d.y, vx: dx / l * 620, vy: dy / l * 620, dmg: PS.drDmg, r: 5, drone: true });
      }
    } else if (d.state === 'back') {
      const s = droneSlot(d);
      tx = s.x; ty = s.y; speed = 340;
      if (Math.abs(d.x - tx) < 14 && Math.abs(d.y - ty) < 14) {
        d.state = 'charging';
        d.timer = PS.drCharge;
      }
    } else {
      const s = droneSlot(d);
      tx = s.x; ty = s.y; speed = 340;
      if (d.timer <= 0) { d.state = 'out'; d.timer = PS.drStay; burst(d.x, d.y, COMP.drone.color, 8, 130); }
    }

    const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1;
    const acc = speed * 4;
    d.vx += (dx / l * speed - d.vx) * Math.min(1, acc * dt / speed);
    d.vy += (dy / l * speed - d.vy) * Math.min(1, acc * dt / speed);
    d.x += d.vx * dt; d.y += d.vy * dt;
  }
}

function drawDrones() {
  if (transit) return;
  if (!PS.hasDrone) return;
  const col = COMP.drone.color;
  const s = getSprite('dr', 20, 22, col, SHAPES.drone, 12);
  for (const d of drones) {
    const charging = d.state === 'charging';
    wblit(s, d.x, d.y, Math.sin(d.t * 3) * 0.12, charging ? 0.45 : 1);
    if (charging) {
      const dx2 = pX(d.x, d.y), dy2 = pY(d.y), ds = pS(d.y), sq = persp ? 0.62 : 1;
      ctx.save();
      ctx.globalAlpha = 0.7; ctx.strokeStyle = col; ctx.lineWidth = 2 * ds;
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(dx2, dy2, 15 * ds, 15 * ds * sq, 0,
                  -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(1 - d.timer / Math.max(0.1, PS.drCharge), 0, 1));
      ctx.stroke(); ctx.restore();
    }
  }
}

/* ---------- ČESTICE ---------- */

function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rnd(spd * 0.25, spd);
    particles.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.25, 0.7), max: 0.7, color: color, size: rnd(1.5, 3.5) });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= Math.pow(0.15, dt); p.vy *= Math.pow(0.15, dt);
  }
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.color;
    const sc = pS(p.y), qx = pX(p.x, p.y), qy = pY(p.y), sz = p.size * sc;
    ctx.fillRect(qx - sz / 2, qy - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;
}

/* ---------- CRTANJE ENTITETA ---------- */

function drawTrail() {
  const t = player.trail;
  if (!player.alive || t.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = '#ff9a3c'; ctx.shadowBlur = 10;
  ctx.strokeStyle = '#ff9a3c';
  const n = t.length;
  for (let i = 1; i < n; i++) {
    const f = i / n;
    ctx.globalAlpha = f * f * 0.55;
    ctx.lineWidth = 1 + f * 5.5;
    ctx.beginPath();
    ctx.moveTo(pX(t[i - 1].x, t[i - 1].y + 14), pY(t[i - 1].y + 14));
    ctx.lineTo(pX(t[i].x, t[i].y + 14), pY(t[i].y + 14));
    ctx.stroke();
  }
  ctx.restore();
}

function drawPlayer() {
  if (!player.alive) return;
  if (!player.warp && player.inv > 0 && Math.floor(player.inv * 20) % 2 === 0) return;
  const px = pX(player.x, player.y), py = pY(player.y), ps = pS(player.y);

  /* Ulazak i izlazak iz misije: trag se crta kao stvarni rep iza broda,
     odsečen na ivici ekrana da se ne razvuče preko cele slike. */
  if (player.warp) {
    const dur = player.warp === 'in' ? WARP_IN_DUR : WARP_OUT_DUR;
    const f = clamp(player.warpT / dur, 0, 1);
    const ulaz = player.warp === 'in';
    const a = ulaz ? Math.pow(Math.min(1, f * 1.6), 1.1) : Math.pow(1 - f, 1.4);
    const brzina = ulaz ? Math.pow(1 - f, 1.6) : Math.pow(f, 1.4);
    const tail = 26 + brzina * 230;

    // rep ide unazad u odnosu na smer kretanja, ali nikad ispod donje ivice
    let ty = player.y + tail;
    if (ty > VH - 4) ty = VH - 4;
    if (ty > player.y + 2) {
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.strokeStyle = C.player;
      ctx.shadowColor = C.player; ctx.shadowBlur = 16;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, player.w * ps * 0.44);
      ctx.beginPath();
      ctx.moveTo(pX(player.x, ty), pY(ty));
      ctx.lineTo(px, py);
      ctx.stroke();
      const mid = player.y + (ty - player.y) * 0.5;
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, player.w * ps * 0.14);
      ctx.beginPath();
      ctx.moveTo(pX(player.x, mid), pY(mid));
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }
    wblit(getSprite('pl', player.w, player.h, C.player, SHAPES.player, 16), player.x, player.y, 0, a);

    // mlaznice se pale kako brod usporava
    if (ulaz && f > 0.45) {
      const q = (f - 0.45) / 0.55;
      const fl = (6 + 10 * q) * ps;
      ctx.save();
      ctx.globalAlpha = 0.7 * q;
      ctx.shadowColor = '#ff9a3c'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 3 * ps;
      const ey1 = py + (player.h / 2 - 4) * ps;
      ctx.beginPath();
      ctx.moveTo(px - 5 * ps, ey1); ctx.lineTo(px - 5 * ps, ey1 + fl);
      ctx.moveTo(px + 5 * ps, ey1); ctx.lineTo(px + 5 * ps, ey1 + fl);
      ctx.stroke(); ctx.restore();
    }
    return;                       // bez štita i prstenova dok warpuje
  }

  wblit(getSprite('pl', player.w, player.h, C.player, SHAPES.player, 16), player.x, player.y, player.tilt * 0.5);

  const fl = (10 + Math.sin(performance.now() / 60) * 5) * ps;
  ctx.save();
  ctx.globalAlpha = brownout ? 0.35 : 0.75;
  ctx.shadowColor = '#ff9a3c'; ctx.shadowBlur = 12;
  ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = 3 * ps;
  const ey0 = py + (player.h / 2 - 4) * ps;
  ctx.beginPath();
  ctx.moveTo(px - 5 * ps, ey0); ctx.lineTo(px - 5 * ps, ey0 + fl);
  ctx.moveTo(px + 5 * ps, ey0); ctx.lineTo(px + 5 * ps, ey0 + fl);
  ctx.stroke(); ctx.restore();

  if (PS.hasSg && player.sgFlash > 0) {
    const f = player.sgFlash / 0.16;
    const a = player.sgAng || -Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = 0.85 * f;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = COMP.shotgun.color; ctx.shadowBlur = 18;
    const r1 = 6 * ps, r2 = (16 + 14 * f) * ps, r3 = (26 + 20 * f) * ps;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
    ctx.lineTo(px + Math.cos(a - 0.42) * r2, py + Math.sin(a - 0.42) * r2);
    ctx.lineTo(px + Math.cos(a) * r3, py + Math.sin(a) * r3);
    ctx.lineTo(px + Math.cos(a + 0.42) * r2, py + Math.sin(a + 0.42) * r2);
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  if (player.leashHint > 0 || (dragId !== null && PS.leash < 1300)) {
    const strong = player.leashHint > 0;
    ctx.save();
    ctx.globalAlpha = strong ? 0.20 + 0.35 * Math.abs(Math.sin(performance.now() / 90)) : 0.07;
    ctx.strokeStyle = strong ? C.warn : COMP.remote.color;
    ctx.lineWidth = 2; ctx.setLineDash([9, 9]);
    ctx.beginPath();
    ctx.ellipse(px, py, PS.leash * ps, PS.leash * ps * (persp ? 0.55 : 1), 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }

  if (player.autoOn > 0) {
    ctx.save();
    ctx.globalAlpha = 0.30 + 0.25 * Math.abs(Math.sin(performance.now() / 180));
    ctx.strokeStyle = C.ui; ctx.lineWidth = 1.5;
    ctx.shadowColor = C.ui; ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(px, py, (player.r + 22) * ps, (player.r + 22) * ps * (persp ? 0.62 : 1), 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore();
    text('AP', px, py + (player.h / 2 + 22) * ps, 11 * ps, C.ui, 'center', 8, 600);
  }

  if (player.shield > 0) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.3 * (player.shield / Math.max(1, PS.shieldMax));
    ctx.shadowColor = C.shield; ctx.shadowBlur = 14;
    ctx.strokeStyle = C.shield; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py, (player.r + 14) * ps, (player.r + 14) * ps * (persp ? 0.62 : 1), 0, 0, Math.PI * 2);
    ctx.stroke(); ctx.restore();
  }
}

function drawMiniBar(cx, y, w, h, f, color) {
  ctx.save();
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(cx - w / 2, y, w, h);
  ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.fillRect(cx - w / 2, y, w * clamp(f, 0, 1), h);
  ctx.restore();
}

function drawEnemies() {
  for (const e of enemies) {
    if (e.hide) { if (e.type === 'boss5') drawTwinBeam(e); continue; }
    const d = ENEMY[e.type], key = 'e_' + e.type;
    const ex = pX(e.x, e.y), ey = pY(e.y), es = pS(e.y);

    // izlazak iz warpa: trag koji se skraćuje kako usporava, uz postepeno pojavljivanje
    if (inWarp(e.y)) {
      const t = warpT(e.y);                       // 0 daleko -> 1 na ulasku
      const a = Math.pow(t, 2.2);
      const tail = (1 - t) * 620 + 60;
      const ty = pY(e.y - tail);
      ctx.save();
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = d.color;
      ctx.shadowColor = d.color; ctx.shadowBlur = 14;
      ctx.lineWidth = Math.max(1, d.w * es * 0.42);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pX(e.x, e.y - tail), ty);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(0.8, d.w * es * 0.13);
      ctx.beginPath();
      ctx.moveTo(pX(e.x, e.y - tail * 0.55), pY(e.y - tail * 0.55));
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
      wblit(getSprite(key, d.w, d.h, d.color, SHAPES[d.shape], isBoss(e) ? 24 : 14), e.x, e.y, 0, a);
      continue;                                    // bez traka života i efekata dok je u warpu
    }
    wblit(getSprite(key, d.w, d.h, d.color, SHAPES[d.shape], isBoss(e) ? 24 : 14),
          e.x, e.y, e.type === 'weaver' ? Math.sin(e.t * 2.2) * 0.25 : 0, e.down ? 0.28 : 1);
    if (e.down) {
      text(Math.ceil(e.reviveT) + 's', ex, ey, 26 * es, '#ffffff', 'center', 12);
      text('OŽIVLJAVA', ex, ey + 26 * es, 11 * es, '#ffffff', 'center', 8, 700);
    }
    if (e.flash > 0) wblit(getSprite(key + '_w', d.w, d.h, '#ffffff', SHAPES[d.shape], 10), e.x, e.y, 0, 0.85);
    if (e.hacked) {
      wblit(getSprite(key + '_hk', d.w, d.h, COMP.hack.color, SHAPES[d.shape], 18), e.x, e.y, 0,
            0.55 + 0.45 * Math.abs(Math.sin(e.hackT * 9)));
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.3 * Math.abs(Math.sin(e.hackT * 7));
      ctx.strokeStyle = COMP.hack.color; ctx.lineWidth = 2 * es;
      ctx.shadowColor = COMP.hack.color; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(ex, ey, (e.r + 10) * es, (e.r + 10) * es * (persp ? 0.62 : 1), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (e.hackTarget) {
        const t2 = e.hackTarget;
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = COMP.hack.color; ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 7]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(pX(t2.x, t2.y), pY(t2.y));
        ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (e.type === 'boss2') drawBoss2Laser(e);
    if (e.type === 'charger' && e.dash === 'warn') {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(performance.now() / 55));
      ctx.strokeStyle = e.color; ctx.lineWidth = 2;
      ctx.shadowColor = e.color; ctx.shadowBlur = 12;
      worldPath(e.x, e.y, e.x + (e.ax || 0) * 1400, e.y + (e.ay || 1) * 1400, 8);
      ctx.stroke();
      ctx.restore();
    }
    if (e.type === 'mirror' && e.y >= e.hover - 20) {
      const hot = e.cool > 0;
      ctx.save();
      ctx.globalAlpha = hot ? 0.25 : 0.55 + 0.3 * (e.heat / 12);
      ctx.strokeStyle = hot ? '#5a6472' : '#ffffff';
      ctx.lineWidth = 4 * es;
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = hot ? 0 : 14;
      ctx.beginPath();
      ctx.ellipse(ex, ey - 2 * es, (e.r + 12) * es, (e.r + 12) * es * (persp ? 0.62 : 1), 0, Math.PI * 0.14, Math.PI * 0.86);
      ctx.stroke();
      ctx.restore();
      if (hot) text('PREGREJANO', ex, ey + (e.h / 2 + 18) * es, 10 * es, '#ff3355', 'center', 8, 700);
      else drawMiniBar(ex, ey + (e.h / 2 + 14) * es, e.w * 0.9 * es, 3 * es, e.heat / 12, '#ffffff');
    }
    if (e.type === 'boss4') drawBoss4Ring(e);
    if (e.type === 'boss6') drawBoss6Plates(e);
    if (e.type === 'sniper' && e.aim !== 'idle' && e.y >= e.hover) {
      const lock = e.aim === 'lock';
      const mx = e.x, my = e.y + e.h / 2;               // cev, isto odakle metak izleće
      const dx = e.lx - mx, dy = e.ly - my, l = Math.hypot(dx, dy) || 1;
      ctx.save();
      ctx.globalAlpha = lock ? (0.55 + 0.35 * Math.abs(Math.sin(performance.now() / 45))) : 0.30;
      ctx.strokeStyle = e.color; ctx.lineWidth = lock ? 2.5 : 1;
      ctx.shadowColor = e.color; ctx.shadowBlur = lock ? 14 : 5;
      worldPath(mx, my, mx + dx / l * 1400, my + dy / l * 1400, 8);
      ctx.stroke();
      ctx.restore();
    }
    if (e.type === 'boss3' && e.invuln && e.state === 'fight') {
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.20 * Math.abs(Math.sin(performance.now() / 260));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.shadowColor = e.color; ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(ex, ey, (e.r + 12) * es, (e.r + 12) * es * (persp ? 0.62 : 1), 0, e.t * 1.4, e.t * 1.4 + Math.PI * 1.3);
      ctx.stroke();
      ctx.restore();
    }
    if (e.type === 'pod')
      drawMiniBar(ex, ey - (e.h / 2 + 9) * es, e.w * 0.9 * es, 3 * es, e.hp / e.maxHp, e.color);
    if (e.type === 'twin' && !e.down) {
      drawMiniBar(ex, ey - (e.h / 2 + 12) * es, e.w * 0.85 * es, 5 * es, e.hp / e.maxHp, e.color);
      text(Math.round(e.hp / e.maxHp * 100) + '%', ex, ey - (e.h / 2 + 24) * es, 12 * es, e.color, 'center', 8, 700);
    }
    if (e.type === 'twin' && e.down) {
      // ugašen: bez sjaja, sa iskrama, da se ne pomeša sa aktivnim
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.15 * Math.abs(Math.sin(performance.now() / 220));
      ctx.strokeStyle = '#5a6472'; ctx.lineWidth = 2 * es;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.ellipse(ex, ey, (e.r + 8) * es, (e.r + 8) * es * (persp ? 0.62 : 1), 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    if (e.type === 'shieldbearer') {
      const up = e.plateDown <= 0 && e.plate > 0;
      const warn = e.fireCd < 0.5 && e.fireCd > 0;
      if (up) {
        ctx.save();
        ctx.globalAlpha = (0.35 + 0.5 * (e.plate / e.plateMax)) * (warn ? (0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 60))) : 1);
        ctx.strokeStyle = '#bda4ff'; ctx.lineWidth = 4 * es;
        ctx.shadowColor = '#bda4ff'; ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(ex, ey - 4 * es, (e.r + 14) * es, (e.r + 14) * es * (persp ? 0.62 : 1), 0, Math.PI * 0.12, Math.PI * 0.88);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (e.type === 'tank' || e.type === 'shieldbearer' || (e.type === 'shooter' && e.hp < e.maxHp))
      drawMiniBar(ex, ey - (e.h / 2 + 9) * es, e.w * 0.9 * es, 3 * es, e.hp / e.maxHp, e.color);
    if (e.type === 'shieldbearer' && e.plate > 0)
      drawMiniBar(ex, ey - (e.h / 2 + 15) * es, e.w * 0.9 * es, 3 * es, e.plate / e.plateMax, '#bda4ff');
  }
}

function drawBullets() {
  const s = getSprite('b', 5, 20, C.bullet, SHAPES.bullet, 10);
  const sp = getSprite('pellet', 7, 19, COMP.shotgun.color, SHAPES.pellet, 12);
  const bs = getSprite('bb', 6, 26, COMP.burst.color, SHAPES.bullet, 12);
  const rs = getSprite('rl', 8, 30, COMP.rail.color, SHAPES.bullet, 16);
  for (const b of bullets) {
    // predmet koji se udaljava se smanjuje i bledi — bez traga i bez izduživanja
    const fade = inWarp(b.y) ? Math.pow(warpT(b.y), 1.8) : 1;
    if (fade <= 0.02) continue;
    if (b.pellet) wblit(sp, b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI / 2, fade);
    else if (b.rail) wblit(rs, b.x, b.y, Math.atan2(b.vy, b.vx) + Math.PI / 2, fade);
    else if (b.burst) wblit(bs, b.x, b.y, 0, fade);
    else wblit(s, b.x, b.y, 0, fade);
  }
  for (const b of ebullets) {
    if (b.tracer) {
      const l = Math.hypot(b.vx, b.vy) || 1;
      const x2 = b.x - b.vx / l * 46, y2 = b.y - b.vy / l * 46;
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = b.color; ctx.lineWidth = 3;
      ctx.shadowColor = b.color; ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(pX(b.x, b.y), pY(b.y));
      ctx.lineTo(pX(x2, y2), pY(y2));
      ctx.stroke();
      ctx.restore();
    }
    wblit(getSprite('eb_' + b.color, 13, 13, b.color, SHAPES.orb, 10), b.x, b.y);
  }
}

function drawPickups() {
  const cs = getSprite('coinp', 10, 10, C.coin, SHAPES.coinSmall, 20);
  const ns = getSprite('nrgp', 22, 24, C.nrg, SHAPES.nrg, 12);
  for (const p of pickups) {
    if (p.kind === 'coin') {
      const sc = 0.75 + 0.25 * Math.abs(Math.cos(p.t * 4));
      const qx = pX(p.x, p.y), qy = pY(p.y);
      ctx.save(); ctx.translate(qx, qy); ctx.scale(sc, 1); ctx.translate(-qx, -qy);
      wblit(cs, p.x, p.y); ctx.restore();
    } else if (p.kind === 'nrg') {
      wblit(ns, p.x, p.y, Math.sin(p.t * 3) * 0.2);
    } else if (p.kind === 'bp') {
      const c = COMP[p.bp];
      wblit(getSprite('bp_' + p.bp, 30, 34, c.color, SHAPES.blueprint, 16), p.x, p.y, Math.sin(p.t * 1.6) * 0.12);
      text(c.letter, pX(p.x, p.y), pY(p.y) + 1, lsize(15, c.letter) * pS(p.y), c.color, 'center', 8);
    } else {
      const def = POWERUPS[p.pu];
      wblit(getSprite('pu_' + p.pu, 32, 32, def.color, SHAPES.pu, 14), p.x, p.y, Math.sin(p.t * 2) * 0.15);
      text(def.letter, pX(p.x, p.y), pY(p.y) + 1, 18 * pS(p.y), def.color, 'center', 8);
    }
  }
}

/* ---------- HUD ---------- */

function drawHUD() {
  const top = SAFE_TOP + 14;
  const bw = 190;

  // oklop
  ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(14, top, bw, 13); ctx.restore();
  const f = player.hp / player.maxHp, col = f > 0.35 ? C.hp : C.hpLow;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fillStyle = col;
  ctx.fillRect(14, top, bw * clamp(f, 0, 1), 13); ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  ctx.strokeRect(14.5, top + 0.5, bw - 1, 12);
  if (player.repairing) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(performance.now() / 160));
    ctx.strokeStyle = C.ok; ctx.lineWidth = 2; ctx.shadowColor = C.ok; ctx.shadowBlur = 10;
    ctx.strokeRect(13, top - 1, bw + 2, 15);
    ctx.restore();
  }

  // štit
  if (PS.shieldMax > 0) {
    ctx.save(); ctx.shadowColor = C.shield; ctx.shadowBlur = 8; ctx.fillStyle = C.shield;
    ctx.fillRect(14, top + 15, bw * clamp(player.shield / PS.shieldMax, 0, 1), 5); ctx.restore();
  }

  // struja
  const ey = top + (PS.shieldMax > 0 ? 24 : 18);
  ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(14, ey, bw, 8); ctx.restore();
  const ecol = brownout ? C.warn : C.nrg;
  const pulse = brownout ? (0.55 + 0.45 * Math.sin(performance.now() / 110)) : 1;
  ctx.save(); ctx.globalAlpha = pulse; ctx.shadowColor = ecol; ctx.shadowBlur = 10; ctx.fillStyle = ecol;
  ctx.fillRect(14, ey, bw * clamp(energy / PS.energyMax, 0, 1), 8); ctx.restore();
  if (brownout) text('NEMA STRUJE', 14, ey + 20, 12, C.warn, 'left', 10);
  if (dmgFlash > 0) {
    dmgFlash -= 1 / 60;
    const a = clamp(dmgFlash / 1.6, 0, 1);
    ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 90));
    text('KVAR MODULA', VW / 2, SAFE_TOP + VH * 0.22, 26 * (0.9 + 0.2 * a), C.warn, 'center', 18);
    ctx.restore();
  }
  if (runDmg.length) {
    text('■'.repeat(runDmg.length) + '  KVAR', 14, ey + (brownout ? 36 : 20), 12, C.warn, 'left', 8);
  }

  // radijacija — koliko hitaca teškog naoružanja imaš spremno
  if (PS.hasChamber) {
    const rw = 190, ry2 = ey + 14;
    const hits = Math.floor(radGoal / RAD_PER_SHOT) || 1;
    ctx.save(); ctx.globalAlpha = 0.32; ctx.fillStyle = '#000';
    ctx.fillRect(14, ry2, rw, 10); ctx.restore();
    const rf = clamp(rad / Math.max(0.01, radGoal), 0, 1);
    const spreman = rad >= RAD_PER_SHOT;
    ctx.save();
    ctx.globalAlpha = spreman ? 1 : 0.75;
    ctx.shadowColor = COMP.chamber.color; ctx.shadowBlur = spreman ? 14 : 6;
    ctx.fillStyle = COMP.chamber.color;
    ctx.fillRect(14, ry2, rw * rf, 10);
    ctx.restore();
    // podeoci na svakom punom hicu
    ctx.save(); ctx.strokeStyle = 'rgba(5,6,10,0.85)'; ctx.lineWidth = 2;
    for (let k = 1; k < hits; k++) {
      const px2 = 14 + rw * (k * RAD_PER_SHOT / radGoal);
      ctx.beginPath(); ctx.moveTo(px2, ry2); ctx.lineTo(px2, ry2 + 10); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    ctx.strokeRect(14.5, ry2 + 0.5, rw - 1, 9);
    const spremno = Math.floor(rad / RAD_PER_SHOT);
    if (radFlash > 0) {
      radFlash -= 1 / 60;
      ctx.save(); ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 90));
      text('◆'.repeat(Math.max(1, spremno)), 14 + rw + 10, ry2 + 6, 14, COMP.chamber.color, 'left', 12);
      ctx.restore();
    } else if (spremno > 0) {
      text('◆'.repeat(spremno), 14 + rw + 10, ry2 + 6, 14, COMP.chamber.color, 'left', 8);
    }
  }

  // novčići
  blit(getSprite('coin', 22, 22, C.coin, SHAPES.coin, 12), VW / 2 - 24, top + 8);
  text(fmt(save.coins), VW / 2 - 8, top + 9, 20, C.coin, 'left', 10);
  text(levelDef.name, VW / 2 - 24, top + 30, 13, levelDef.accent, 'left', 8);
  if (diff > 1) text('T' + diff, VW / 2 + 42, top + 30, 13, diff < 4 ? C.coin : C.warn, 'left', 10);

  // pauza
  const s = 44, px = VW - s - 14, py = SAFE_TOP + 12;
  ctx.save();
  ctx.strokeStyle = C.ui; ctx.lineWidth = 2; ctx.shadowColor = C.ui; ctx.shadowBlur = 8;
  ctx.beginPath(); roundRect(ctx, px, py, s, s, 8); ctx.stroke();
  ctx.fillStyle = C.ui;
  ctx.fillRect(px + 15, py + 13, 5, 18); ctx.fillRect(px + 24, py + 13, 5, 18);
  ctx.restore();

  // powerup-ovi
  let py2 = SAFE_TOP + 70;
  for (const k in player.pu) {
    const def = POWERUPS[k];
    text(def.letter, VW - 26, py2, 16, def.color, 'center', 10);
    drawMiniBar(VW - 26, py2 + 13, 26, 3, player.pu[k] / def.dur, def.color);
    py2 += 30;
  }

  if (bossRef && bossRef.state === 'fight') {
    const w = VW - 120, x = 60, y = SAFE_TOP + 62;
    if (bossRef.type === 'boss5') {
      // dve zasebne trake, po jedna za svakog blizanca
      const hw = (w - 10) / 2;
      for (let k = 0; k < 2; k++) {
        const t = bossRef.twins[k];
        const bx = x + k * (hw + 10);
        ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(bx, y, hw, 9); ctx.restore();
        ctx.save();
        if (t.down) {
          ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(performance.now() / 140));
          ctx.fillStyle = '#5a6472';
          ctx.fillRect(bx, y, hw, 9);
        } else {
          ctx.shadowColor = t.color; ctx.shadowBlur = 12; ctx.fillStyle = t.color;
          ctx.fillRect(bx, y, hw * clamp(t.hp / t.maxHp, 0, 1), 9);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, y + 0.5, hw - 1, 8);
        text(t.down ? Math.ceil(t.reviveT) + 's' : Math.round(t.hp / t.maxHp * 100) + '%',
             bx + hw / 2, y + 22, 12, t.down ? '#ff3355' : t.color, 'center', 8, 700);
      }
      text(bossRef.twins.some(t => t.down) ? 'OBORI I DRUGOG PRE ODBROJAVANJA' : 'BLIZANCI — FAZA ' + bossRef.phase,
           VW / 2, y - 12, 13, bossRef.color, 'center', 8);
    } else {
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, 9); ctx.restore();
    ctx.save(); ctx.shadowColor = bossRef.color; ctx.shadowBlur = 12; ctx.fillStyle = bossRef.color;
    ctx.fillRect(x, y, w * clamp(bossRef.hp / bossRef.maxHp, 0, 1), 9); ctx.restore();
    const BN = { boss2: 'NOSAČ — FAZA ', boss3: 'ARSENAL — FAZA ', boss4: 'PRSTEN — FAZA ', boss5: 'BLIZANCI — FAZA ', boss6: 'KOVAČNICA — FAZA ' };
    text((BN[bossRef.type] || 'FAZA ') + bossRef.phase, VW / 2, y - 12, 13, bossRef.color, 'center', 8);
    if (bossRef.invuln)
      text('UNIŠTI SVA TRI TORNJA', VW / 2, y + 22, 13, '#ffffff', 'center', 10);
    }
    if (bossRef.ring) {
      const rw = VW - 200, rx = 100, ry = y + 15;
      ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.fillRect(rx, ry, rw, 6); ctx.restore();
      ctx.save(); ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 8; ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, rw * clamp(bossRef.ring.hp / bossRef.ring.maxHp, 0, 1), 6); ctx.restore();
      text('PRSTEN — probij ga ili gađaj kroz otvor', VW / 2, ry + 18, 12, '#ffffff', 'center', 8, 600);
    }
  }

  if (transit) {
    const f = clamp(trT / trDur, 0, 1);
    const bw = 250, bx2 = VW / 2 - bw / 2, by2 = SAFE_TOP + VH * 0.13;
    text('METEORSKO POLJE', VW / 2, by2 - 12, 16, '#8a94a6', 'center', 10);
    ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = '#8a94a6';
    ctx.fillRect(bx2, by2, bw, 8); ctx.restore();
    ctx.save(); ctx.fillStyle = C.ok; ctx.shadowColor = C.ok; ctx.shadowBlur = 10;
    ctx.fillRect(bx2, by2, bw * f, 8); ctx.restore();
    text('ORUŽJA UGAŠENA', VW / 2, by2 + 26, 11, C.warn, 'center', 0, 600);
    text('+' + fmt(trBonus) + ' na izlazu', VW / 2, by2 + 44, 11, C.coin, 'center', 0, 600);
  } else if (askExit > 0 && player.alive && !player.warp) {
    const bw = 200, bh = 62, by2 = VH * 0.44;
    text('NIVO ZAVRŠEN', VW / 2, VH * 0.34, 30, levelDef.accent, 'center', 18);
    text('sleti u garažu ili produži kroz meteorsko polje', VW / 2, VH * 0.34 + 30, 12, C.uiDim, 'center', 0, 600);
    ctx.save();
    ctx.globalAlpha = 0.14; ctx.fillStyle = C.ui;
    ctx.beginPath(); roundRect(ctx, VW / 2 - bw - 8, by2, bw, bh, 10); ctx.fill();
    ctx.fillStyle = C.coin;
    ctx.beginPath(); roundRect(ctx, VW / 2 + 8, by2, bw, bh, 10); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = C.ui; ctx.lineWidth = 2; ctx.shadowColor = C.ui; ctx.shadowBlur = 10;
    ctx.beginPath(); roundRect(ctx, VW / 2 - bw - 8, by2, bw, bh, 10); ctx.stroke();
    ctx.strokeStyle = C.coin; ctx.shadowColor = C.coin;
    ctx.beginPath(); roundRect(ctx, VW / 2 + 8, by2, bw, bh, 10); ctx.stroke();
    ctx.restore();
    text('SLETI', VW / 2 - bw / 2 - 8, by2 + 26, 20, C.ui, 'center', 10);
    text('u radionicu', VW / 2 - bw / 2 - 8, by2 + 47, 10, C.uiDim, 'center', 0, 600);
    text('PRODUŽI', VW / 2 + bw / 2 + 8, by2 + 26, 20, C.coin, 'center', 10);
    text('+' + fmt(Math.max(40, Math.round(runCoins * 0.20))),
         VW / 2 + bw / 2 + 8, by2 + 47, 10, C.coin, 'center', 0, 600);
    const fr = clamp(askExit / 7.0, 0, 1);
    ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = C.uiDim;
    ctx.fillRect(VW / 2 - 100, by2 + bh + 14, 200, 4);
    ctx.fillStyle = C.ui;
    ctx.fillRect(VW / 2 - 100, by2 + bh + 14, 200 * fr, 4);
    ctx.restore();
    if (chainCount > 0)
      text('vezanih misija: ' + chainCount, VW / 2, by2 + bh + 36, 11, C.ok, 'center', 0, 600);
  } else if (levelDone && player.alive && !player.warp)
    text('NIVO ZAVRŠEN', VW / 2, VH * 0.4, 34, levelDef.accent, 'center', 20);
  if (!player.alive) text('UNIŠTEN', VW / 2, VH * 0.4, 38, C.warn, 'center', 20);
}

/* ---------- MENI ---------- */

let wipeAsk = -1;      // koji slot čeka potvrdu brisanja

function drawSlots() {
  uiButtons.length = 0;
  const cx = VW / 2;
  let y = SAFE_TOP + VH * 0.10;
  text('NEON', cx, y, 46, '#00f0ff', 'center', 20);
  text('SQUADRON', cx, y + 44, 34, '#ff2bd6', 'center', 20);
  text('IZABERI KAMPANJU', cx, y + 92, 15, C.uiDim, 'center', 0, 600);

  const top = y + 122;
  const gap = 12;
  const cardH = Math.min(126, (VH - SAFE_BOT - 96 - top - gap * (SLOT_COUNT - 1)) / SLOT_COUNT);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const cy = top + i * (cardH + gap);
    const inf = slotInfo(i);
    const on = i === slotIdx;
    const col = inf ? (on ? C.ok : C.ui) : C.uiDim;

    ctx.save();
    ctx.globalAlpha = on ? 0.16 : 0.07;
    ctx.fillStyle = col;
    ctx.beginPath(); roundRect(ctx, 20, cy, VW - 40, cardH, 12); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = on ? 2.5 : 1.5;
    if (on) { ctx.shadowColor = col; ctx.shadowBlur = 14; }
    ctx.beginPath(); roundRect(ctx, 20, cy, VW - 40, cardH, 12); ctx.stroke();
    ctx.restore();

    text('KAMPANJA ' + (i + 1), 38, cy + 26, 18, col, 'left', on ? 10 : 0);
    if (on) text('AKTIVNA', VW - 38, cy + 26, 11, C.ok, 'right', 8, 700);

    if (inf) {
      const nivo = clamp(inf.unlocked, 1, LEVELS.length);
      text('nivo ' + nivo + ' / ' + LEVELS.length + (inf.diff > 1 ? '   T' + inf.diff : ''),
           38, cy + 52, 13, C.ui, 'left', 0, 600);
      blit(getSprite('coin', 16, 16, C.coin, SHAPES.coin, 8), 45, cy + 76);
      text(fmt(inf.coins), 58, cy + 76, 14, C.coin, 'left', 0, 700);
      text(inf.delova + ' delova   ' + inf.nacrta + '/' + bpMax() + ' nacrta',
           38, cy + 100, 11, C.uiDim, 'left', 0, 600);
      const bw = 150, bx2 = VW - 38 - bw;
      ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = C.ui;
      ctx.fillRect(bx2, cy + 62, bw, 6); ctx.restore();
      ctx.save(); ctx.fillStyle = C.ok; ctx.shadowColor = C.ok; ctx.shadowBlur = 8;
      ctx.fillRect(bx2, cy + 62, bw * (nivo / LEVELS.length), 6); ctx.restore();

      if (wipeAsk === i) {
        text('obrisati kampanju?', VW - 38, cy + 88, 11, C.warn, 'right', 0, 600);
        btn('wipeyes_' + i, VW - 168, cy + 96, 62, 26, 'DA', { size: 12, fill: true, color: C.warn });
        btn('wipeno_' + i, VW - 100, cy + 96, 62, 26, 'NE', { size: 12, color: C.ui });
      } else {
        btn('wipe_' + i, VW - 130, cy + 92, 92, 28, 'OBRIŠI', { size: 11, color: C.warn });
      }
    } else {
      text('prazno — nova igra', 38, cy + 56, 13, C.uiDim, 'left', 0, 600);
    }
    btn('slot_' + i, 20, cy, VW - 180, cardH, '', { invisible: true });
  }

  btn('slotgo', cx - 130, VH - SAFE_BOT - 76, 260, 54,
      slotInfo(slotIdx) ? 'NASTAVI' : 'NOVA IGRA', { fill: true, size: 20, color: C.ok });
}

function drawMenu() {
  uiButtons.length = 0;
  const cx = VW / 2, topY = SAFE_TOP + VH * 0.13;

  text('NEON', cx, topY, 62, '#00f0ff', 'center', 26);
  text('SQUADRON', cx, topY + 58, 46, '#ff2bd6', 'center', 26);
  text(VER, cx, topY + 102, 14, C.uiDim, 'center', 0);

  blit(getSprite('pl', player.w * 1.6, player.h * 1.6, C.player, SHAPES.player, 20),
       cx, topY + 170 + Math.sin(performance.now() / 700) * 8);

  const by = SAFE_TOP + VH * 0.50;
  text('IZABERI NIVO', cx, by - 34, 14, C.uiDim, 'center', 0);
  btn('levprev', cx - 130, by - 16, 46, 46, '◀', { enabled: selLevel > 1, size: 22 });
  text(String(selLevel), cx, by + 8, 30, LEVELS[selLevel - 1].accent, 'center', 14);

  /* Da li na izabranom nivou i stepenu još ima nacrta za pokupiti. */
  {
    const obicanOstao = !save.bpDone[selLevel + ':' + selDiff] && bpWindow(BP_ORDER).length > 0;
    const bosNivo = LEVELS[selLevel - 1].waves.some(w => w.boss || w.boss2 || w.boss3 || w.boss4 || w.boss5 || w.boss6);
    const teskiOstao = bosNivo && !save.bpHeavyDone[selLevel + ':' + selDiff] && bpWindow(BP_ORDER_HEAVY).length > 0;
    const yb = by + 34;
    let poruke = [];
    if (obicanOstao) poruke.push(['NACRT', C.ok]);
    if (teskiOstao) poruke.push(['NACRT SA BOSA', COMP.chamber.color]);
    if (poruke.length) {
      let ux = cx - (poruke.length === 2 ? 108 : 44);
      for (const [lbl, col] of poruke) {
        const w2 = lbl.length * 5.6 + 16;
        ctx.save();
        ctx.globalAlpha = 0.18; ctx.fillStyle = col;
        ctx.beginPath(); roundRect(ctx, ux, yb, w2, 18, 5); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); roundRect(ctx, ux, yb, w2, 18, 5); ctx.stroke();
        ctx.restore();
        text(lbl, ux + w2 / 2, yb + 9, 9, col, 'center', 6, 700);
        ux += w2 + 8;
      }
    } else {
      text(bosNivo ? 'nacrti sa ovog nivoa su iscrpeni' : 'nacrt sa ovog nivoa je iscrpen',
           cx, yb + 9, 10, C.uiDim, 'center', 0, 600);
    }
  }
  btn('levnext', cx + 84, by - 16, 46, 46, '▶', { enabled: selLevel < save.unlocked, size: 22 });

  const md = maxDiff(selLevel);
  selDiff = clamp(selDiff, 1, md);
  const dy = by + 52;
  if (md > 1) {
    text('TEŽINA', cx, dy - 12, 13, C.uiDim, 'center', 0);
    btn('difprev', cx - 130, dy + 2, 46, 42, '◀', { enabled: selDiff > 1, size: 20 });
    const dcol = selDiff === 1 ? C.ui : (selDiff < 4 ? C.coin : C.warn);
    text('T' + selDiff, cx, dy + 24, 26, dcol, 'center', 14);
    btn('difnext', cx + 84, dy + 2, 46, 42, '▶', { enabled: selDiff < md, size: 20 });
    text('protivnici ×' + fmt1(diffHp(selDiff)) + ' HP  ·  ×' + fmt1(diffDmg(selDiff)) + ' šteta  ·  ×' + fmt1(diffCoin(selDiff)) + ' novčića',
         cx, dy + 52, 11, C.uiDim, 'center', 0, 600);
  } else {
    text('teži stepen se otključava kad pređeš nivo', cx, dy + 24, 11, C.uiDim, 'center', 0, 600);
  }

  btn('play', cx - 130, by + 118, 260, 62, 'IGRAJ', { fill: true, size: 26, color: C.ok });
  btn('shop', cx - 130, by + 192, 260, 54, 'RADIONICA', { size: 20 });

  blit(getSprite('coin', 22, 22, C.coin, SHAPES.coin, 12), cx - 34, by + 272);
  text(fmt(save.coins), cx - 18, by + 273, 20, C.coin, 'left', 10);

  btn('persp', cx - 130, VH - SAFE_BOT - 128, 260, 44,
      persp ? 'PRIKAZ: NAGNUT' : 'PRIKAZ: RAVAN',
      { size: 16, color: persp ? '#ff2bd6' : C.ui, fill: persp });
  btn('toslots', cx - 130, VH - SAFE_BOT - 74, 260, 40,
      'KAMPANJA ' + (slotIdx + 1), { size: 15, color: C.uiDim });
  text('probni nagnuti prikaz — logika igre je ista', cx, VH - SAFE_BOT - 22, 11, C.uiDim, 'center', 0, 600);
}

/* ---------- RADIONICA ---------- */

function shopHeader() {
  const top = SAFE_TOP + 10;
  let head = 'RADIONICA', headCol = C.ui;
  if (shopMode === 'dead') { head = 'UNIŠTEN'; headCol = C.warn; }
  else if (shopMode === 'clear') { head = LEVELS[level - 1].name + (diff > 1 ? ' T' + diff : '') + ' ZAVRŠEN'; headCol = C.ok; }
  else if (shopMode === 'all') { head = 'SVI NIVOI ZAVRŠENI'; headCol = C.coin; }
  text(head, 16, top + 14, 20, headCol, 'left', 14);
  if (shopMode !== 'menu') text('skupljeno: ' + fmt(runCoins), 16, top + 34, 12, C.uiDim, 'left', 0, 600);
  btn('reset', VW - 92, top + 3, 76, 24, 'RESET', { size: 11, color: C.uiDim });

  blit(getSprite('coin', 20, 20, C.coin, SHAPES.coin, 10), VW - 150, top + 15);
  text(fmt(save.coins), VW - 138, top + 15, 17, C.coin, 'left', 10);

  const s = PS || buildShip();
  const useAvg = lastAvgDraw > 0;
  const dr = useAvg ? lastAvgDraw : estDraw();
  const net = s.genOut - dr;
  const y2 = top + 52;
  text('⚡ ' + fmt1(s.genOut) + '/s', 16, y2, 13, C.nrg, 'left', 8);
  text((useAvg ? 'prosek ' : 'procena ') + fmt1(dr) + '/s', 96, y2, 13, net >= 0 ? C.ok : C.warn, 'left', 8);
  text('rezerva ' + s.energyMax, 232, y2, 13, C.ui, 'left', 6);
  text('moduli ' + save.slots + '/' + s.maxModules, 340, y2, 13, C.ui, 'left', 6);
  return top + 66;
}

function drawShop() {
  uiButtons.length = 0;
  const s = PS || buildShip();
  const gridTop = shopHeader();

  const footH = shopMode === 'menu' ? 74 : 118;
  const panelH = 108;
  const midBottom = VH - SAFE_BOT - footH - panelH - 8;
  const midH = midBottom - gridTop;

  const GAP = 6;
  const cellH = (midH - GAP * (GRID_ROWS - 1)) / GRID_ROWS;
  const cellW = (VW * 0.545 - 16 - GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cell = clamp(Math.min(cellH, cellW), 34, 100);
  const gridH = cell * GRID_ROWS + GAP * (GRID_ROWS - 1);
  const gw = cell * GRID_COLS + GAP * (GRID_COLS - 1);
  const gx = 16, gy = gridTop + Math.max(0, (midH - gridH) / 2);

  const rightX = gx + gw + 12;
  const rightW = VW - rightX - 16;

  SL = { cells: [], rows: [], right: { x: rightX, y: gridTop, w: rightW, h: midH } };

  // koliko oružja kopilot podnosi
  {
    const cap = weaponCap(), act = activeCount();
    const pun = act >= cap;
    text('ORUŽJA ' + act + '/' + cap, gx + gw / 2, gridTop - 6, 12,
         pun ? C.coin : COMP.copilot.color, 'center', 8, 700);
  }

  // obris broda iza rešetke
  ctx.save();
  ctx.globalAlpha = 0.10;
  ctx.strokeStyle = C.player; ctx.lineWidth = 2;
  const cxg = gx + gw / 2, cyg = gy + gridH / 2, hw = gw / 2 + 10, hh = gridH / 2 + 14;
  ctx.beginPath();
  ctx.moveTo(cxg, cyg - hh);
  ctx.lineTo(cxg + hw, cyg + hh * 0.5);
  ctx.lineTo(cxg + hw * 0.4, cyg + hh);
  ctx.lineTo(cxg - hw * 0.4, cyg + hh);
  ctx.lineTo(cxg - hw, cyg + hh * 0.5);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  // rešetka
  for (let i = 0; i < MAX_SLOTS; i++) {
    const cxi = i % GRID_COLS, cyi = Math.floor(i / GRID_COLS);
    const x = gx + cxi * (cell + GAP), y = gy + cyi * (cell + GAP);
    SL.cells.push({ x: x, y: y, s: cell });
    const t = save.grid[i];
    const unlocked = slotUnlocked(i);
    const isSel = sel && (sel.kind === 'slot' || sel.kind === 'empty' || sel.kind === 'lock') && sel.idx === i;
    const dragging = sdrag && sdrag.moved && sdrag.src === 'slot' && sdrag.idx === i;

    const dmgd = t && isDamaged(i);
    const off = t && isWeapon(t) && save.on[i] === false;
    let col = unlocked ? (t ? (dmgd ? C.warn : (off ? '#4a5568' : COMP[t].color)) : C.uiDim) : '#2a3546';
    if (isSel) col = C.ok;

    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = isSel ? 3 : 2;
    if (unlocked) { ctx.shadowColor = col; ctx.shadowBlur = t ? 12 : 5; }
    ctx.beginPath(); roundRect(ctx, x, y, cell, cell, 10);
    if (t && !dragging) { ctx.globalAlpha = 0.12; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
    ctx.restore();

    if (!unlocked) {
      text('🔒', x + cell / 2, y + cell / 2 - 8, cell * 0.24, '#3d4d64', 'center', 0);
      const idxOrder = SLOT_ORDER.indexOf(i);
      const price = SLOT_COST[idxOrder - 5];
      const isNext = idxOrder === save.slots;
      text(isNext ? fmt(price) : '—', x + cell / 2, y + cell * 0.74, 13, isNext ? C.coin : '#31405a', 'center', isNext ? 8 : 0);
    } else if (t && !dragging) {
      const c = COMP[t];
      const lv = slotLv(i);
      const lc = dmgd ? C.warn : (off ? '#4a5568' : c.color);
      text(c.letter, x + cell / 2, y + cell * 0.34, lsize(cell * 0.34, c.letter), lc, 'center', off ? 0 : 12);
      text(c.name.length > 9 ? c.name.slice(0, 8) + '.' : c.name, x + cell / 2, y + cell * 0.60, cell * 0.12,
           lc, 'center', 6, 600);
      text(dmgd ? 'KVAR' : (off ? 'ISKLJ.' : ('nv ' + lv)), x + cell / 2, y + cell * 0.77, cell * 0.15,
           dmgd ? C.warn : (off ? '#6b7a8f' : (lv >= UP_MAX ? C.coin : c.color)), 'center', 8, 700);
      const bw2 = cell * 0.64, bx2 = x + cell / 2 - bw2 / 2, by2 = y + cell * 0.87;
      ctx.save();
      ctx.globalAlpha = 0.20; ctx.fillStyle = '#9fe8ff'; ctx.fillRect(bx2, by2, bw2, 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = lv >= UP_MAX ? C.coin : c.color;
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 6;
      ctx.fillRect(bx2, by2, bw2 * clamp(lv / UP_MAX, 0, 1), 4);
      ctx.restore();
    }
  }

  // desna kolona
  // tabovi: dva reda po tri, poslednji je magacin
  const tabH = 26, tabG = 4, cols = 3;
  const tw = (rightW - tabG * (cols - 1)) / cols;
  SHOP_TABS.forEach(function (td, i) {
    const cx2 = i % cols, cy2 = Math.floor(i / cols);
    const tx2 = rightX + cx2 * (tw + tabG);
    const ty2 = gridTop + cy2 * (tabH + tabG);
    const on = shopTab === td.id;
    // koliko u toj grupi ima nečeg novog za kupovinu
    let ready = 0;
    if (td.list) {
      for (const t of td.list) if (isNoviDeo(t)) ready++;
    } else {
      // magacin: tačkica samo ako u njemu stvarno nešto stoji
      for (const t in save.stock) if (save.stock[t] && save.stock[t].length) { ready = 1; break; }
    }
    btn('tab_' + td.id, tx2, ty2, tw, tabH, td.name,
        { size: 10, fill: on, color: on ? td.color : C.uiDim });
    if (ready > 0 && !on) {
      ctx.save();
      ctx.fillStyle = td.color; ctx.shadowColor = td.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(tx2 + tw - 7, ty2 + 6, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });

  const tabRows = Math.ceil(SHOP_TABS.length / cols);
  const tabBlock = tabRows * tabH + (tabRows - 1) * tabG;
  const listY = gridTop + tabBlock + 8;
  const listH = midH - tabBlock - 8;
  const items = [];
  const cur = tabDef(shopTab);
  if (cur.list) {
    cur.list.forEach(t => {
      const lock = !bpUnlocked(t);
      items.push({
        type: t, label: COMP[t].name,
        sub: lock ? ('nacrt ' + bpOf(t) + '/' + BP_NEEDED) : fmt(COMP[t].buy),
        enabled: !lock && ownedTotal(t) < (COMP[t].max || 1) && save.coins >= COMP[t].buy,
        lock: lock
      });
    });
  } else {
    for (const t in save.stock) {
      const a = save.stock[t];
      if (!Array.isArray(a)) continue;
      for (let k = 0; k < a.length; k++)
        items.push({ type: t, si: k, label: COMP[t].name, sub: 'nivo ' + a[k], enabled: true });
    }
    if (items.length === 0) text('magacin je prazan', rightX + rightW / 2, listY + 30, 12, C.uiDim, 'center', 0, 600);
  }

  const rowH = clamp(listH / Math.max(items.length, 3), 34, 68);
  items.forEach(function (it, i) {
    const y = listY + i * rowH;
    const c = COMP[it.type];
    const isSel = sel && sel.kind === (cur.list ? 'shop' : 'stock') && sel.type === it.type && (cur.list ? true : sel.si === it.si);
    const dragging = sdrag && sdrag.moved && sdrag.type === it.type && sdrag.si === it.si && (sdrag.src === 'shop' || sdrag.src === 'stock');
    SL.rows.push({ x: rightX, y: y, w: rightW, h: rowH - 4, type: it.type, si: it.si, enabled: it.enabled });
    if (dragging) return;
    ctx.save();
    ctx.strokeStyle = isSel ? C.ok : (it.enabled ? c.color : '#2c3a4d');
    ctx.lineWidth = isSel ? 2.5 : 1.5;
    ctx.globalAlpha = it.enabled ? 1 : 0.5;
    ctx.beginPath(); roundRect(ctx, rightX, y, rightW, rowH - 4, 7); ctx.stroke();
    ctx.restore();
    const a = it.enabled ? 1 : 0.5;
    ctx.save(); ctx.globalAlpha = a;
    text(c.letter, rightX + 16, y + (rowH - 4) / 2, lsize(17, c.letter), c.color, 'center', 8);
    text(c.name, rightX + 30, y + (rowH - 4) / 2 - 7, 11, C.ui, 'left', 0, 700);
    text(it.sub, rightX + 30, y + (rowH - 4) / 2 + 8, 12, it.lock ? C.warn : (cur.list ? C.coin : C.uiDim), 'left', 0, 700);
    ctx.restore();
    // otključano a još nenabavljeno — tačkica stoji do kupovine
    if (cur.list && isNoviDeo(it.type)) {
      ctx.save();
      ctx.fillStyle = c.color;
      ctx.shadowColor = c.color; ctx.shadowBlur = 9;
      ctx.beginPath(); ctx.arc(rightX + rightW - 12, y + 12, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  });

  // donji panel
  const panY = midBottom + 8;
  ctx.save();
  ctx.strokeStyle = 'rgba(159,232,255,0.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); roundRect(ctx, 16, panY, VW - 32, panelH - 6, 8); ctx.stroke();
  ctx.restore();
  drawPanel(panY, panelH - 6, s);

  // dno
  const fy = VH - SAFE_BOT - footH + 6;
  if (shopMode === 'menu') {
    btn('shopmain', 16, fy, VW - 32, 54, 'NAZAD', { size: 20 });
  } else if (shopMode === 'dead') {
    btn('retry', 16, fy, VW - 32, 52, 'PONOVI ' + LEVELS[level - 1].name + (diff > 1 ? ' T' + diff : ''), { fill: true, size: 19, color: C.warn });
    btn('quit', 16, fy + 58, VW - 32, 44, 'GLAVNI MENI', { size: 16 });
  } else if (shopMode === 'clear') {
    const nl = Math.min(level, LEVELS.length - 1);
    const nd = Math.min(diff, maxDiff(nl + 1));
    btn('next', 16, fy, VW - 32, 52, LEVELS[nl].name + (nd > 1 ? ' T' + nd : '') + ' ▶', { fill: true, size: 19, color: C.ok });
    btn('quit', 16, fy + 58, VW - 32, 44, 'GLAVNI MENI', { size: 16 });
  } else {
    btn('restartall', 16, fy, VW - 32, 52, 'IGRAJ PONOVO', { fill: true, size: 19, color: C.coin });
    btn('quit', 16, fy + 58, VW - 32, 44, 'GLAVNI MENI', { size: 16 });
  }

  // duh koji se vuče
  if (sdrag && sdrag.moved && sdrag.type) {
    const c = COMP[sdrag.type];
    ctx.save(); ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c.color; ctx.lineWidth = 2; ctx.shadowColor = c.color; ctx.shadowBlur = 16;
    ctx.beginPath(); roundRect(ctx, sdrag.x - 30, sdrag.y - 30, 60, 60, 10);
    ctx.globalAlpha = 0.2; ctx.fillStyle = c.color; ctx.fill(); ctx.globalAlpha = 0.9; ctx.stroke();
    ctx.restore();
    text(c.letter, sdrag.x, sdrag.y, lsize(24, c.letter), c.color, 'center', 12);
  }
}

function drawPanel(y, h, s) {
  const pad = 14;
  if (!sel) {
    text('dodirni deo ili modul', VW / 2, y + h / 2 - 10, 14, C.uiDim, 'center', 0, 600);
    text('prevlačenjem se ugrađuje i premešta', VW / 2, y + h / 2 + 12, 12, C.uiDim, 'center', 0, 600);
    return;
  }
  if (sel.kind === 'lock') {
    const can = save.slots < TAB.modules[cpuLv()] && save.slots < MAX_SLOTS;
    const cost = save.slots < MAX_SLOTS ? SLOT_COST[save.slots - 5] : 0;
    text('ZAKLJUČAN MODUL', 16 + pad, y + 20, 16, C.ui, 'left', 10);
    text(can ? 'sledeći modul košta ' + fmt(cost) : 'nadogradi glavni računar da otključaš još modula',
         16 + pad, y + 42, 12, can ? C.uiDim : C.warn, 'left', 0, 600);
    btn('unlock', VW - 16 - pad - 150, y + h - 48, 150, 40, 'OTKLJUČAJ',
        { size: 16, fill: can && save.coins >= cost, color: C.coin, enabled: can && save.coins >= cost && sel.idx === SLOT_ORDER[save.slots] });
    if (sel.idx !== SLOT_ORDER[save.slots] && can)
      text('prvo otključaj modul označen cenom', 16 + pad, y + 62, 11, C.warn, 'left', 0, 600);
    return;
  }
  if (sel.kind === 'empty') {
    text('PRAZAN MODUL', 16 + pad, y + 20, 16, C.ok, 'left', 10);
    text('prevuci deo iz desne liste ovde', 16 + pad, y + 42, 12, C.uiDim, 'left', 0, 600);
    return;
  }

  const t = sel.kind === 'slot' ? save.grid[sel.idx] : sel.type;
  if (!t) { text('prazan modul', VW / 2, y + h / 2, 14, C.uiDim, 'center', 0, 600); return; }
  const c = COMP[t];
  const ref = selLevelRef();
  const lv = sel.kind === 'shop' ? 0 : (ref ? ref.get() : 0);
  const cl = cpuLv();
  text(c.name, 16 + pad, y + 18, 16, c.color, 'left', 10);
  text(c.desc, 16 + pad, y + 38, 11, C.uiDim, 'left', 0, 600);
  if (c.pw > 0) text('struja: ' + fmt1(c.pw) + ' ' + (c.pwn || ''), 16 + pad, y + 54, 11, C.nrg, 'left', 0, 600);
  else if (c.note) text(c.note, 16 + pad, y + 54, 11, C.ok, 'left', 0, 600);
  if (c.stat && lv > 0) text(c.stat(lv), 16 + pad, y + 70, 11, c.color, 'left', 0, 600);
  if (isHeavy(t) && t !== 'chamber' && lv > 0 && installed('chamber') === 0)
    text('bez komore nema radijacije — ovo oružje ne radi', 16 + pad, y + 84, 10, C.warn, 'left', 0, 600);
  if (sel.kind === 'slot' && installed(t) > 1) text('svaki komad se apgrejduje zasebno', 16 + pad, y + 84, 10, C.uiDim, 'left', 0, 600);

  // pipe nivoa
  for (let k = 0; k < UP_MAX; k++) {
    const px = 16 + pad + k * 14, py = y + h - 22;
    ctx.save();
    if (k < lv) { ctx.fillStyle = C.ok; ctx.shadowColor = C.ok; ctx.shadowBlur = 8; }
    else if (k < cl) ctx.fillStyle = 'rgba(159,232,255,0.22)';
    else ctx.fillStyle = 'rgba(255,51,85,0.28)';
    ctx.fillRect(px, py, 10, 6);
    ctx.restore();
  }
  text('nivo ' + lv + '/' + UP_MAX, 16 + pad + UP_MAX * 14 + 8, y + h - 19, 11, C.uiDim, 'left', 0, 600);

  const bx = VW - 16 - pad;
  if (sel.kind === 'stock') {
    const v = sellValue(t, lv);
    btn('sell', bx - 268, y + 12, 122, 40, 'PRODAJ ' + fmt(v), { size: 13, color: C.coin });
    text('vraća se ' + Math.round(SELL_RATE * 100) + '% od ' + fmt(investedIn(t, lv)),
         bx - 207, y + 62, 10, C.uiDim, 'center', 0, 600);
  }
  if (sel.kind === 'shop') {
    if (!bpUnlocked(t)) {
      text('ZAKLJUČANO — treba ' + BP_NEEDED + ' nacrta', bx, y + 22, 14, C.warn, 'right', 10);
      for (let k = 0; k < BP_NEEDED; k++) {
        const sx = bx - 140 + k * 48, sy = y + 40;
        ctx.save();
        ctx.strokeStyle = k < bpOf(t) ? c.color : C.uiDim;
        ctx.lineWidth = 2;
        if (k < bpOf(t)) { ctx.shadowColor = c.color; ctx.shadowBlur = 10; ctx.globalAlpha = 0.18; ctx.fillStyle = c.color; }
        ctx.beginPath(); roundRect(ctx, sx, sy, 40, 30, 5);
        if (k < bpOf(t)) ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        ctx.restore();
      }
      text(bpOf(t) + '/' + BP_NEEDED, bx, y + h - 20, 13, c.color, 'right', 8);
      return;
    }
    const canBuy = ownedTotal(t) < (c.max || 1) && save.coins >= c.buy;
    btn('buy', bx - 140, y + 12, 140, 40, 'KUPI ' + fmt(c.buy), { size: 15, fill: canBuy, color: C.coin, enabled: canBuy });
    if (ownedTotal(t) >= (c.max || 1)) text('imaš maksimum (' + (c.max || 1) + ')', bx, y + 60, 11, C.uiDim, 'right', 0, 600);
    return;
  }

  if (lv >= UP_MAX) {
    text('MAKSIMALAN NIVO', bx, y + 30, 14, C.coin, 'right', 10);
  } else if (lv >= cl && t !== 'cpu') {
    text('računar je preslab', bx, y + 30, 12, C.warn, 'right', 8);
  } else {
    const cost = c.up[lv - 1];
    btn('levelup', bx - 140, y + 12, 140, 40, 'NIVO ↑ ' + fmt(cost),
        { size: 15, fill: save.coins >= cost, color: C.ok, enabled: save.coins >= cost });
  }

  if (sel.kind === 'slot' && isDamaged(sel.idx)) {
    const rc = repairCost(sel.idx);
    const can = save.coins >= rc;
    text('MODUL U KVARU — ne radi', 16 + pad, y + 54, 12, C.warn, 'left', 8);
    btn('repair1', bx - 140, y + 12, 140, 40, 'POPRAVI ' + fmt(rc),
        { size: 15, fill: can, color: can ? C.coin : C.uiDim, enabled: can });
  }
  if (sel.kind === 'slot' && isWeapon(t) && save.grid[sel.idx] === t && !isDamaged(sel.idx)) {
    const off2 = save.on[sel.idx] === false;
    const mozeUkljuciti = !off2 || activeCount() < weaponCap();
    btn('toggle', bx - 258, y + 12, 112, 40, off2 ? 'UKLJUČI' : 'ISKLJUČI',
        { size: 13, fill: off2 && mozeUkljuciti, color: off2 ? (mozeUkljuciti ? C.ok : C.uiDim) : C.ui,
          enabled: mozeUkljuciti });
    if (off2 && !mozeUkljuciti)
      text('kopilot pun (' + activeCount() + '/' + weaponCap() + ')', bx - 202, y + 62, 10, C.warn, 'center', 0, 600);
  }
  if (sel.kind === 'slot' && canRemove(t) && save.grid[sel.idx] === t)
    text('prevuci deo na listu da ga skloniš u magacin', 16 + pad, y + h - 22, 10, C.uiDim, 'left', 0, 600);
  if (sel.kind === 'stock')
    text('prevuci deo na modul da ga ugradiš', 16 + pad, y + h - 22, 10, C.uiDim, 'left', 0, 600);
}

/* ---------- PAUZA ---------- */

function drawLevelEnd() {
  uiButtons.length = 0;
  ctx.save(); ctx.fillStyle = 'rgba(5,6,10,0.86)'; ctx.fillRect(0, 0, VW, VH); ctx.restore();
  const cx = VW / 2;
  let y = SAFE_TOP + VH * 0.16;

  const ok = endMode !== 'dead';
  const head = endMode === 'dead' ? 'UNIŠTEN'
             : (endMode === 'all' ? 'SVI NIVOI ZAVRŠENI' : LEVELS[level - 1].name + ' ZAVRŠEN');
  text(head, cx, y, 30, ok ? C.ok : C.warn, 'center', 18);
  if (diff > 1) text('TEŽINA T' + diff, cx, y + 28, 14, diff < 4 ? C.coin : C.warn, 'center', 8);

  y += 78;
  blit(getSprite('coin', 26, 26, C.coin, SHAPES.coin, 12), cx - 60, y);
  text(fmt(runCoins), cx - 40, y + 1, 30, C.coin, 'left', 12);
  text('novčića na ovom nivou', cx, y + 32, 12, C.uiDim, 'center', 0, 600);

  y += 92;

  /* Pregled prikazuje sve nacrte skupljene kroz niz vezanih misija,
     ne samo one iz poslednje. */
  const svi = [];
  for (const t of runHeavyAll) svi.push([t, true]);
  for (const t of runBpAll) svi.push([t, false]);

  if (svi.length) {
    const jedan = svi.length === 1;
    const w = jedan ? 118 : Math.min(104, (VW - 60) / Math.min(svi.length, 4) - 10);
    const hh = jedan ? 132 : 112;
    const perRed = Math.min(svi.length, 4);
    const redova = Math.ceil(svi.length / 4);
    for (let k = 0; k < svi.length; k++) {
      const [t, tezak] = svi[k];
      const c = COMP[t], have = bpOf(t);
      const red = Math.floor(k / 4), kol = k % 4;
      const uRedu = Math.min(4, svi.length - red * 4);
      const bx = cx - (uRedu * w + (uRedu - 1) * 10) / 2 + kol * (w + 10);
      const by = y + red * (hh + 10);
      ctx.save();
      ctx.strokeStyle = C.uiDim; ctx.lineWidth = 2;
      ctx.beginPath(); roundRect(ctx, bx, by, w, hh, 10); ctx.stroke();
      ctx.save();
      ctx.beginPath(); roundRect(ctx, bx, by, w, hh, 10); ctx.clip();
      const fh = hh * (have / BP_NEEDED);
      ctx.globalAlpha = 0.30; ctx.fillStyle = c.color;
      ctx.fillRect(bx, by + hh - fh, w, fh);
      ctx.globalAlpha = 1; ctx.strokeStyle = c.color; ctx.lineWidth = 2;
      ctx.shadowColor = c.color; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(bx, by + hh - fh); ctx.lineTo(bx + w, by + hh - fh); ctx.stroke();
      ctx.restore(); ctx.restore();
      text(c.letter, bx + w / 2, by + hh * 0.36, lsize(jedan ? 46 : 32, c.letter), c.color, 'center', 14);
      text(c.name.length > 10 ? c.name.slice(0, 9) + '.' : c.name,
           bx + w / 2, by + hh * 0.66, jedan ? 14 : 11, c.color, 'center', 8);
      text(have + ' / ' + BP_NEEDED, bx + w / 2, by + hh * 0.86, jedan ? 18 : 14,
           have >= BP_NEEDED ? C.ok : C.ui, 'center', 10);
      if (tezak) text('BOSS', bx + w / 2, by + 12, 9, COMP.chamber.color, 'center', 6, 700);
    }
    y += redova * (hh + 10) + 14;
    const otkljucanih = svi.filter(([t]) => bpOf(t) >= BP_NEEDED).length;
    text(otkljucanih ? (otkljucanih === 1 ? 'KOMPONENTA OTKLJUČANA' : otkljucanih + ' KOMPONENTE OTKLJUČANE')
                     : (svi.length === 1 ? 'NACRT PRONAĐEN' : svi.length + ' NACRTA PRONAĐENO'),
         cx, y, 15, otkljucanih ? C.ok : C.ui, 'center', 12);
    y += 24;
  } else {
    text('nema nacrta na ovom nivou', cx, y + 10, 14, C.uiDim, 'center', 0, 600);
    if (save.bpDone[level + ':' + diff])
      text('ovaj nivo na T' + diff + ' si već iscrpeo', cx, y + 32, 12, C.uiDim, 'center', 0, 600);
    y += 62;
  }

  text('nacrti ukupno ' + bpTotal() + ' / ' + bpMax() + (PS.hasChamber ? '' : ''),
       cx, y + 6, 13, C.uiDim, 'center', 0, 600);

  // oštećeni moduli i popravka
  const dl = damagedList();
  if (dl.length) {
    y += 34;
    text('OŠTEĆENI MODULI', cx, y, 15, C.warn, 'center', 10);
    y += 22;
    const bw2 = 62, gap2 = 8;
    const per = Math.min(dl.length, 5);
    const totW = per * bw2 + (per - 1) * gap2;
    dl.slice(0, 5).forEach(function (i, k) {
      const t = save.grid[i], c = COMP[t];
      const bx2 = cx - totW / 2 + k * (bw2 + gap2);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.25 * Math.abs(Math.sin(performance.now() / 260));
      ctx.strokeStyle = C.warn; ctx.lineWidth = 2;
      ctx.shadowColor = C.warn; ctx.shadowBlur = 10;
      ctx.beginPath(); roundRect(ctx, bx2, y, bw2, 46, 7); ctx.stroke();
      ctx.restore();
      text(c.letter, bx2 + bw2 / 2, y + 17, lsize(19, c.letter), C.warn, 'center', 8);
      text(fmt(repairCost(i)), bx2 + bw2 / 2, y + 35, 12, C.coin, 'center', 6, 700);
    });
    if (dl.length > 5) text('+' + (dl.length - 5), cx + totW / 2 + 16, y + 24, 14, C.warn, 'left', 6);
    y += 58;
    const cost = repairAllCost();
    const can = save.coins >= cost;
    btn('repair', cx - 130, y, 260, 46, 'POPRAVI SVE  ' + fmt(cost),
        { size: 17, fill: can, color: can ? C.coin : C.uiDim, enabled: can });
    if (!can) text('nemaš dovoljno novčića', cx, y + 62, 11, C.uiDim, 'center', 0, 600);
  }

  btn('endnext', cx - 130, VH - SAFE_BOT - 96, 260, 56, 'RADIONICA', { fill: true, size: 20, color: C.ok });
}

function drawPause() {
  uiButtons.length = 0;
  ctx.save(); ctx.fillStyle = 'rgba(5,6,10,0.82)'; ctx.fillRect(0, 0, VW, VH); ctx.restore();
  const cx = VW / 2, cy = VH / 2;
  text('PAUZA', cx, cy - 130, 40, C.ui, 'center', 20);
  btn('resume', cx - 130, cy - 60, 260, 60, 'NASTAVI', { fill: true, size: 22, color: C.ok });
  btn('quit', cx - 130, cy + 20, 260, 54, 'GLAVNI MENI', { size: 19 });
  text('progres nivoa se gubi', cx, cy + 92, 12, C.uiDim, 'center', 0, 600);
}

function drawToast() {
  if (!toast || toastT <= 0) return;
  ctx.save(); ctx.globalAlpha = clamp(toastT, 0, 1);
  text(toast, VW / 2, VH - SAFE_BOT - 16, 15, C.ui, 'center', 12);
  ctx.restore();
}

/* ---------- PETLJA ---------- */

let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, 0.05);
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast = null; }

  ctx.setTransform(SCALE * DPR, 0, 0, SCALE * DPR, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, VW, VH);

  if (screen === 'play') {
    updateStars(dt); updateBackdrop(dt);
    if (transit) { updateTransit(dt); }
    else { updateWaves(dt); updateEnemies(dt); updateRockRun(dt); }
    updatePlayer(dt); autopilot(dt); updateMovement(dt); updateLaser(dt); updateDrones(dt); updateBullets(dt); updateRockets(dt); updateMines(dt); updateBlasts(dt); updateRings(dt); updateBolts(dt); updateHoles(dt); updateEmp(dt); updateSweeps(dt); updatePulses(dt); updateAntis(dt); updatePickups(dt); updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - 40 * dt);
    if (flash > 0) flash -= dt;

    ctx.save();
    if (shake > 0) ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
    drawStars(); drawBackdrop(); drawGrid(); drawRocks(); drawPickups(); drawMines(); drawEnemies(); drawBullets(); drawRockets(); drawDrones(); drawLaser(); drawBolts(); drawBlasts(); drawRings(); drawHoles(); drawEmp(); drawSweeps(); drawPulses(); drawAntis(); drawTrail(); drawPlayer(); drawParticles();
    ctx.restore();

    if (flash > 0) {
      ctx.save(); ctx.globalAlpha = clamp(flash * 1.6, 0, 0.45);
      ctx.fillStyle = flashColor; ctx.fillRect(0, 0, VW, VH); ctx.restore();
    }
    drawHUD();

    if (!player.alive) {
      doneTimer -= dt;
      if (doneTimer <= 0) { finishRun(); endMode = 'dead'; chainCount = 0; transit = false; rocks.length = 0; screen = 'levelend'; }
    } else if (levelDone && !transit) {
      /* Sačekaj da se pokupe ili izgube zaostali novčići, pa tek onda odlazak. */
      if (!player.warp && player.alive) {
        // čeka novčiće, ali najviše 3,5 s — da se kraj misije ne oteže
        const cekaj = pickups.some(p => p.kind !== 'pu') && doneTimer > -3.5;
        doneTimer -= cekaj ? dt * 0.55 : dt;
        const gotovo = (doneTimer <= 0 && !cekaj) || doneTimer <= -3.5;
        if (gotovo) {
          /* Poslednji nivo se ne nastavlja — nema dalje misije. */
          if (level >= LEVELS.length) startPlayerExit();
          else if (askExit <= 0) askExit = 7.0;      // pitanje: sleteti ili dalje
          else {
            askExit -= dt;
            if (askExit <= 0) startPlayerExit();     // bez odgovora — sleće
          }
        }
      }
      if (player.warp === 'out') {
        doneTimer = 0.01;
        if (player.warpT >= WARP_OUT_DUR) { player.warp = null; doneTimer = -99; }
      }
      if (doneTimer <= -50) {
        commitLevel();
        finishRun();
        endMode = level >= LEVELS.length ? 'all' : 'clear';
        selLevel = clamp(save.unlocked, 1, LEVELS.length);
        selDiff = clamp(diff, 1, maxDiff(selLevel));
        sel = null; screen = 'levelend';
      }
    }
  } else if (screen === 'slots') {
    updateStars(dt); updateBackdrop(dt); drawStars(); drawBackdrop();
    drawSlots(); drawToast();
  } else if (screen === 'levelend') {
    updateStars(dt * 0.3); drawStars(); updateBackdrop(dt); drawBackdrop();
    drawLevelEnd();
  } else if (screen === 'pause') {
    drawStars(); drawBackdrop(); drawGrid(); drawPickups(); drawMines(); drawEnemies(); drawBullets(); drawRockets(); drawDrones(); drawBlasts(); drawRings(); drawHoles(); drawEmp(); drawTrail(); drawPlayer();
    drawHUD(); drawPause();
  } else if (screen === 'menu') {
    updateStars(dt); updateBackdrop(dt); drawStars(); drawBackdrop(); updateParticles(dt); drawParticles(); drawMenu();
  } else if (screen === 'shop') {
    updateStars(dt * 0.3); drawStars(); drawShop();
  }
  drawToast();
}

/* ---------- START ---------- */

slotIdx = readActiveSlot();
loadSave();
persp = !!save.persp;
initBackdrop(1);
PS = buildShip();
resize();
initStars();
selLevel = clamp(save.unlocked, 1, LEVELS.length);
selDiff = 1;
player.y = VH - SAFE_BOT - 140;
player.tx = player.x; player.ty = player.y;
requestAnimationFrame(frame);

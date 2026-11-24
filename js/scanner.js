// OMR answer-key scanner: perspective rectify -> table grid detection -> per-cell OCR -> sequence inference.
const WL = '0123456789.ABCDE';
let pool = null, poolP = null;

export async function initOCR() {
  if (pool) return pool;
  if (poolP) return poolP;
  poolP = (async () => {
    if (!window.Tesseract) throw new Error('OCR library not loaded (check internet)');
    const n = (navigator.hardwareConcurrency || 2) >= 4 ? 2 : 1;
    const ws = [];
    for (let i = 0; i < n; i++) {
      const w = await Tesseract.createWorker('eng', 1);
      await w.setParameters({ tessedit_char_whitelist: WL, tessedit_pageseg_mode: '7', user_defined_dpi: '300' });
      w._mode = 'cell';
      ws.push(w);
    }
    pool = ws;
    return ws;
  })();
  try { return await poolP; } catch (e) { poolP = null; throw e; }
}
const MODES = {
  cell: { tessedit_char_whitelist: WL, tessedit_pageseg_mode: '7' },
  char: { tessedit_char_whitelist: 'ABCDE', tessedit_pageseg_mode: '10' },
  sparse: { tessedit_char_whitelist: WL, tessedit_pageseg_mode: '11' },
};
async function setMode(w, m) { if (w._mode !== m) { await w.setParameters(MODES[m]); w._mode = m; } }

/* ---------- gray image helpers ---------- */
export function grayFromCanvas(c) {
  const id = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const d = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; j < d.length; i += 4, j++) d[j] = (id[i] * 77 + id[i + 1] * 150 + id[i + 2] * 29) >> 8;
  return { w: c.width, h: c.height, d };
}
export function grayToCanvas(G) {
  const c = document.createElement('canvas'); c.width = G.w; c.height = G.h;
  const g = c.getContext('2d'), id = g.createImageData(G.w, G.h), o = id.data;
  for (let i = 0, j = 0; i < G.d.length; i++, j += 4) { o[j] = o[j + 1] = o[j + 2] = G.d[i]; o[j + 3] = 255; }
  g.putImageData(id, 0, 0); return c;
}
function resizeGray(G, s) { // area-average downscale
  const w = Math.max(1, Math.round(G.w * s)), h = Math.max(1, Math.round(G.h * s)), d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / s), y1 = Math.min(G.h, Math.max(y0 + 1, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / s), x1 = Math.min(G.w, Math.max(x0 + 1, Math.floor((x + 1) / s)));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += G.d[yy * G.w + xx]; n++; }
      d[y * w + x] = n ? sum / n : 255;
    }
  }
  return { w, h, d };
}
export function rot90(G, k) {
  k = ((k % 4) + 4) % 4; if (!k) return G;
  const { w, h, d } = G, W = k % 2 ? h : w, H = k % 2 ? w : h, o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let X, Y;
    if (k === 1) { X = h - 1 - y; Y = x; } else if (k === 2) { X = w - 1 - x; Y = h - 1 - y; } else { X = y; Y = w - 1 - x; }
    o[Y * W + X] = d[y * w + x];
  }
  return { w: W, h: H, d: o };
}
function rotateGray(G, deg) {
  const src = grayToCanvas(G), c = document.createElement('canvas'); c.width = G.w; c.height = G.h;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(src, -c.width / 2, -c.height / 2);
  return grayFromCanvas(c);
}

/* ---------- perspective warp ---------- */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
function homography(src, dst) { // maps dst -> src
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return [...solve(A, b), 1];
}
function warp(G, quad, ow, oh) {
  const H = homography(quad, [[0, 0], [ow - 1, 0], [ow - 1, oh - 1], [0, oh - 1]]);
  const out = new Uint8Array(ow * oh), { w, h, d } = G;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const z = H[6] * x + H[7] * y + 1, sx = (H[0] * x + H[1] * y + H[2]) / z, sy = (H[3] * x + H[4] * y + H[5]) / z;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) { out[y * ow + x] = 255; continue; }
    const fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
    out[y * ow + x] = (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + w] * (1 - fx) + d[i + w + 1] * fx) * fy;
  }
  return { w: ow, h: oh, d: out, H };
}
const applyH = (H, [x, y]) => { const z = H[6] * x + H[7] * y + 1; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z]; };
function warpQuad(G, q) {
  const W0 = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), H0 = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const s = Math.min(2.5, 1900 / Math.max(W0, H0));
  return warp(G, q, Math.max(60, Math.round(W0 * s)), Math.max(60, Math.round(H0 * s)));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- binarisation & lines ---------- */
function integral(G) {
  const { w, h, d } = G, W1 = w + 1, I = new Float64Array(W1 * (h + 1));
  for (let y = 1; y <= h; y++) { let rs = 0; for (let x = 1; x <= w; x++) { rs += d[(y - 1) * w + x - 1]; I[y * W1 + x] = I[(y - 1) * W1 + x] + rs; } }
  return I;
}
function binarize(G, I, win, t) { // Bradley adaptive threshold, 1 = ink
  const { w, h, d } = G, B = new Uint8Array(w * h), r = win >> 1, W1 = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), n = (x1 - x0) * (y1 - y0);
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      if (d[y * w + x] * n < s * (1 - t)) B[y * w + x] = 1;
    }
  }
  return B;
}
function lineMask(B, w, h, minH, minV, gap) {
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = -1, l = -1; const o = y * w;
    for (let x = 0; x <= w; x++) {
      if (x < w && B[o + x]) { if (s < 0) s = x; l = x; }
      else if (s >= 0 && (x === w || x - l > gap)) { if (l - s + 1 >= minH) for (let k = s; k <= l; k++) M[o + k] = 1; s = -1; }
    }
  }
  for (let x = 0; x < w; x++) {
    let s = -1, l = -1;
    for (let y = 0; y <= h; y++) {
      if (y < h && B[y * w + x]) { if (s < 0) s = y; l = y; }
      else if (s >= 0 && (y === h || y - l > gap)) { if (l - s + 1 >= minV) for (let k = s; k <= l; k++) M[k * w + x] = 1; s = -1; }
    }
  }
  return M;
}
function dilate(M, w, h, r) {
  const T = new Uint8Array(w * h), O = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M[y * w + x]) for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) T[y * w + k] = 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (T[y * w + x]) for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) O[k * w + x] = 1;
  return O;
}
function components(M, w, h, val) {
  const lab = new Uint8Array(w * h), st = new Int32Array(w * h), out = [];
  for (let s0 = 0; s0 < w * h; s0++) {
    if (M[s0] !== val || lab[s0]) continue;
    let sp = 0; st[sp++] = s0; lab[s0] = 1;
    const c = { x0: w, y0: h, x1: 0, y1: 0, area: 0, sMin: 1e9, sMax: -1e9, dMin: 1e9, dMax: -1e9, pts: {} };
    while (sp) {
      const p = st[--sp], x = p % w, y = (p / w) | 0; c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      const s = x + y, df = x - y;
      if (s < c.sMin) { c.sMin = s; c.pts.tl = [x, y]; } if (s > c.sMax) { c.sMax = s; c.pts.br = [x, y]; }
      if (df > c.dMax) { c.dMax = df; c.pts.tr = [x, y]; } if (df < c.dMin) { c.dMin = df; c.pts.bl = [x, y]; }
      if (x > 0 && M[p - 1] === val && !lab[p - 1]) { lab[p - 1] = 1; st[sp++] = p - 1; }
      if (x < w - 1 && M[p + 1] === val && !lab[p + 1]) { lab[p + 1] = 1; st[sp++] = p + 1; }
      if (y > 0 && M[p - w] === val && !lab[p - w]) { lab[p - w] = 1; st[sp++] = p - w; }
      if (y < h - 1 && M[p + w] === val && !lab[p + w]) { lab[p + w] = 1; st[sp++] = p + w; }
    }
    out.push(c);
  }
  return out;
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] || 0; };

/* ---------- auto-detect table corners (for the crop tool) ---------- */
function tableQuad(G0, minFrac, grow) {
  const s = Math.min(1, 900 / Math.max(G0.w, G0.h)), G = s < 1 ? resizeGray(G0, s) : G0, { w, h } = G;
  const B = binarize(G, integral(G), Math.max(15, Math.round(Math.min(w, h) / 20)) | 1, 0.15);
  const M = dilate(lineMask(B, w, h, Math.max(18, w * 0.035 | 0), Math.max(18, h * 0.035 | 0), 2), w, h, 1);
  const t = components(M, w, h, 1).sort((a, b) => b.area - a.area)[0];
  if (!t || t.area < (w + h) * 0.8 || (t.x1 - t.x0) < w * minFrac || (t.y1 - t.y0) < h * minFrac) return null;
  const q = [t.pts.tl, t.pts.tr, t.pts.br, t.pts.bl];
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  return q.map(([x, y]) => [Math.max(0, Math.min(w, cx + (x - cx) * grow)) / s, Math.max(0, Math.min(h, cy + (y - cy) * grow)) / s]);
}
export function detectQuad(src) {
  const s = Math.min(1, 900 / Math.max(src.width, src.height));
  const c = document.createElement('canvas'); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const q = tableQuad(grayFromCanvas(c), 0.1, 1.03);
  return q && q.map(([x, y]) => [x / s, y / s]);
}
// re-find the table inside a roughly-cropped image; map its corners back to the photo and warp once
function rectify(G0, quad) {
  let Q = quad, R = warpQuad(G0, Q);
  const out = [R];
  for (let it = 0; it < 2; it++) {
    const q = tableQuad(R, 0.12, 1.02);
    if (!q) break;
    const moved = Math.max(...q.map((p, i) => dist(p, [[0, 0], [R.w, 0], [R.w, R.h], [0, R.h]][i])));
    if (moved < Math.min(R.w, R.h) * 0.01) break;
    Q = q.map(p => applyH(R.H, p));
    R = warpQuad(G0, Q); out.push(R);
  }
  return out; // candidates; caller keeps the one with the cleanest grid
}
const gridScore = g => g ? g.cells.filter(c => !c.synth).length - 0.5 * g.cells.filter(c => c.synth).length : -1;

/* ---------- skew ---------- */
function estimateSkew(G) {
  const g = resizeGray(G, Math.min(1, 700 / Math.max(G.w, G.h)));
  const B = binarize(g, integral(g), Math.max(9, Math.round(Math.min(g.w, g.h) / 20)) | 1, 0.15);
  const xs = [], ys = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (B[y * g.w + x]) { xs.push(x); ys.push(y); }
  if (xs.length < 100) return 0;
  const off = g.w + 2, H = new Float64Array(g.h + 2 * g.w + 4);
  let best = 0, bv = -1;
  for (let a = -6; a <= 6.001; a += 0.25) {
    const r = a * Math.PI / 180, sn = Math.sin(r), cs = Math.cos(r); H.fill(0);
    for (let k = 0; k < xs.length; k++) H[(ys[k] * cs - xs[k] * sn + off) | 0]++;
    let v = 0; for (let k = 0; k < H.length; k++) v += H[k] * H[k];
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}

/* ---------- grid ---------- */
function cluster(vals, tol) {
  const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), lab = new Array(vals.length);
  let k = -1, prev = -1e9;
  for (const [v, i] of idx) { if (v - prev > tol) k++; lab[i] = k; prev = v; }
  return { lab, n: k + 1 };
}
function buildGrid(G) {
  const { w, h } = G, I = integral(G), win = Math.max(15, Math.round(Math.min(w, h) / 25)) | 1;
  const B1 = binarize(G, I, win, 0.12), B2 = binarize(G, I, win, 0.3);
  const M = dilate(lineMask(B1, w, h, Math.max(30, w * 0.05 | 0), Math.max(30, h * 0.05 | 0), 3), w, h, 2);
  const comps = components(M, w, h, 0).filter(c => {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
    return bw >= Math.max(14, w * 0.02) && bh >= Math.max(12, h * 0.012) && bw < w * 0.95 && bh < h * 0.95 && c.area / (bw * bh) > 0.55;
  });
  if (comps.length < 4) return null;
  const mw = median(comps.map(c => c.x1 - c.x0 + 1)), mh = median(comps.map(c => c.y1 - c.y0 + 1));
  const cells = [];
  for (const c of comps) {
    const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, rx = bw / mw, ry = bh / mh;
    if (rx < 0.45 || ry < 0.5) continue;
    const kx = rx < 1.5 ? 1 : Math.round(rx), ky = ry < 1.5 ? 1 : Math.round(ry);
    if ((kx > 1 && Math.abs(rx - kx) > 0.3) || (ky > 1 && Math.abs(ry - ky) > 0.3) || kx * ky > 6) continue;
    for (let a = 0; a < kx; a++) for (let b = 0; b < ky; b++)
      cells.push({ x0: Math.round(c.x0 + bw * a / kx), x1: Math.round(c.x0 + bw * (a + 1) / kx) - 1, y0: Math.round(c.y0 + bh * b / ky), y1: Math.round(c.y0 + bh * (b + 1) / ky) - 1 });
  }
  if (cells.length < 4) return null;
  const R = cluster(cells.map(c => (c.y0 + c.y1) / 2), mh * 0.5), C = cluster(cells.map(c => (c.x0 + c.x1) / 2), mw * 0.5);
  cells.forEach((c, i) => { c.r = R.lab[i]; c.c = C.lab[i]; });
  // complete the lattice: rebuild cells hidden by faint/broken lines from their row & column bounds
  const have = new Set(cells.map(c => c.r + ',' + c.c));
  if (R.n * C.n - cells.length > 0 && R.n * C.n - cells.length <= Math.max(2, cells.length * 0.4)) {
    const rb = [], cb = [];
    for (let r = 0; r < R.n; r++) { const a = cells.filter(c => c.r === r); rb[r] = [median(a.map(c => c.y0)), median(a.map(c => c.y1))]; }
    for (let k = 0; k < C.n; k++) { const a = cells.filter(c => c.c === k); cb[k] = [median(a.map(c => c.x0)), median(a.map(c => c.x1))]; }
    for (let r = 0; r < R.n; r++) for (let k = 0; k < C.n; k++) if (!have.has(r + ',' + k)) cells.push({ x0: cb[k][0], x1: cb[k][1], y0: rb[r][0], y1: rb[r][1], r, c: k, synth: 1 });
  }
  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  return { w, h, B: B2, M, cells, rows: R.n, cols: C.n, mw, mh };
}

/* ---------- cell image for OCR ---------- */
function cellCanvas(G, grid, cell, part) {
  const { w, B, M } = grid, bw = cell.x1 - cell.x0 + 1, bh = cell.y1 - cell.y0 + 1, ins = Math.max(2, Math.round(Math.min(bw, bh) * 0.06));
  const X0 = cell.x0 + ins, Y0 = cell.y0 + ins, X1 = cell.x1 - ins, Y1 = cell.y1 - ins;
  if (X1 - X0 < 4 || Y1 - Y0 < 4) return null;
  const cw = X1 - X0 + 1, chh = Y1 - Y0 + 1, colS = new Uint16Array(cw), rowS = new Uint16Array(chh);
  let n = 0;
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const i = y * w + x; if (B[i] && !M[i]) { colS[x - X0]++; rowS[y - Y0]++; n++; } }
  if (n < 20) return null;
  let mx = 0, Mx = cw - 1, my = 0, My = chh - 1;
  while (mx < cw && colS[mx] < 2) mx++; while (Mx > mx && colS[Mx] < 2) Mx--;
  while (my < chh && rowS[my] < 2) my++; while (My > my && rowS[My] < 2) My--;
  if (mx >= Mx || my >= My) return null;
  let ax = X0 + mx, bx = X0 + Mx; const ay = Y0 + my, by = Y0 + My, ch = by - ay + 1;
  if (ch < 6) return null;
  if (part === 'right') ax = Math.round(bx - (bx - ax) * 0.4);
  // grayscale crop with contrast stretch (ink -> black, paper/watermark -> white), grid lines removed
  const ex = Math.round(ch * 0.12), rx0 = Math.max(X0, ax - ex), rx1 = Math.min(X1, bx + ex), ry0 = Math.max(Y0, ay - ex), ry1 = Math.min(Y1, by + ex);
  let ink = 0, inkN = 0, pap = 0, papN = 0;
  for (let y = ry0; y <= ry1; y++) for (let x = rx0; x <= rx1; x++) { const i = y * w + x; if (M[i]) continue; if (B[i]) { ink += G.d[i]; inkN++; } else { pap += G.d[i]; papN++; } }
  ink = inkN ? ink / inkN : 0; pap = papN ? pap / papN : 255;
  const lo = ink + (pap - ink) * 0.05, hi = ink + (pap - ink) * 0.75, span = Math.max(8, hi - lo);
  const pad = Math.round(ch * 0.3), sx0 = ax - pad, sy0 = ay - pad, sw = bx - ax + 1 + 2 * pad, sh = ch + 2 * pad;
  const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
  const tg = tmp.getContext('2d'), id = tg.createImageData(sw, sh), o = id.data;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const gx = sx0 + x, gy = sy0 + y, j = (y * sw + x) * 4;
    let v = 255;
    if (gx >= rx0 && gx <= rx1 && gy >= ry0 && gy <= ry1) { const i = gy * w + gx; if (!M[i]) v = Math.max(0, Math.min(255, (G.d[i] - lo) * 255 / span)); }
    o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
  }
  tg.putImageData(id, 0, 0);
  const sc = Math.max(0.5, Math.min(4, 42 / ch)), out = document.createElement('canvas');
  out.width = Math.round(sw * sc) + 20; out.height = Math.round(sh * sc) + 20;
  const og = out.getContext('2d'); og.fillStyle = '#fff'; og.fillRect(0, 0, out.width, out.height);
  og.imageSmoothingQuality = 'high'; og.drawImage(tmp, 10, 10, Math.round(sw * sc), Math.round(sh * sc));
  return out;
}

export function parseCell(text) {
  const t = (text || '').replace(/\s+/g, '').toUpperCase();
  let num = null, letter = null;
  if (!t) return { num, letter, raw: t };
  const lm = t.match(/([A-E])(?!.*[A-E])/);
  if (lm) { letter = lm[1]; const nm = t.slice(0, lm.index).match(/\d{1,3}/g); if (nm) num = +nm[nm.length - 1]; }
  else {
    const m2 = t.match(/^(\d{1,3})[.,:\-]+(\d)$/);
    if (m2) { num = +m2[1]; letter = { 8: 'B', 0: 'D', 6: 'B', 3: 'B', 4: 'A' }[m2[2]] || null; }
    else { const m3 = t.match(/(\d{1,3})/); if (m3) num = +m3[1]; }
  }
  return { num, letter, raw: t };
}

async function ocrCells(ws, G, grid, list, mode, prog) {
  let k = 0, done = 0; const out = new Array(list.length);
  await Promise.all(ws.map(async w => {
    await setMode(w, mode);
    while (k < list.length) {
      const i = k++, cell = list[i];
      if (mode === 'cell' && cell._r) { out[i] = cell._r; done++; prog && prog(done / list.length); continue; }
      const cv = cellCanvas(G, grid, cell, mode === 'char' ? 'right' : null);
      if (!cv) { out[i] = { cell, has: false }; }
      else {
        const { data } = await w.recognize(cv);
        if (mode === 'char') out[i] = { cell, has: true, letterOnly: (data.text.replace(/[^A-E]/g, '')[0] || null), conf: data.confidence };
        else out[i] = cell._r = { cell, has: true, ...parseCell(data.text), conf: data.confidence };
      }
      done++; prog && prog(done / list.length);
    }
  }));
  return out;
}

function inferNumbers(rs, grid) {
  const { rows: R, cols: C } = grid, votes = new Map();
  let numbered = 0;
  for (const x of rs) {
    if (x.num == null) continue; numbered++;
    const a = 'r' + (x.num - (x.cell.r * C + x.cell.c)), b = 'c' + (x.num - (x.cell.c * R + x.cell.r));
    votes.set(a, (votes.get(a) || 0) + 1.01); votes.set(b, (votes.get(b) || 0) + 1);
  }
  let best = null, bv = 0;
  for (const [k, v] of votes) if (v > bv) { bv = v; best = k; }
  const ok = best && bv >= Math.max(2, numbered * 0.35);
  for (const x of rs) {
    if (ok) {
      const base = +best.slice(1);
      x.q = best[0] === 'r' ? base + x.cell.r * C + x.cell.c : base + x.cell.c * R + x.cell.r;
      if (x.num != null && x.num !== x.q) x.conf = Math.min(x.conf ?? 60, 55);
      if (!x.letter && x.raw) { // e.g. "018" = 01 + B misread
        const ds = x.raw.replace(/\D/g, '');
        if (ds.length > 1 && +ds.slice(0, -1) === x.q) { const L = { 8: 'B', 0: 'D', 6: 'B' }[ds.slice(-1)]; if (L) { x.letter = L; x.conf = Math.min(x.conf ?? 60, 50); } }
      }
    } else x.q = x.num;
  }
  return ok;
}

function spread(arr, n) { if (arr.length <= n) return arr.slice(); const o = []; for (let i = 0; i < n; i++) o.push(arr[Math.floor((i + 0.5) * arr.length / n)]); return o; }

function drawDebug(G, grid, rs) {
  const s = Math.min(1, 1000 / G.w), c = document.createElement('canvas');
  c.width = Math.round(G.w * s); c.height = Math.round(G.h * s);
  const g = c.getContext('2d'); g.drawImage(grayToCanvas(G), 0, 0, c.width, c.height);
  g.lineWidth = 2; g.font = `600 ${Math.max(10, Math.round(grid.mh * s * 0.28))}px ui-monospace,monospace`;
  for (const x of rs) {
    const k = x.cell, good = x.letter && x.q != null, col = good ? (x.conf < 60 ? '#c98a12' : '#23825a') : '#d23c2f';
    g.strokeStyle = col; g.fillStyle = col + '22';
    g.fillRect(k.x0 * s, k.y0 * s, (k.x1 - k.x0) * s, (k.y1 - k.y0) * s);
    g.strokeRect(k.x0 * s + 1, k.y0 * s + 1, (k.x1 - k.x0) * s - 2, (k.y1 - k.y0) * s - 2);
    if (good) { g.fillStyle = col; g.fillText(`${x.q}${x.letter}`, k.x0 * s + 4, k.y1 * s - 4); }
  }
  return c;
}

function parseText(data, ST) {
  let s = '', cf = [];
  const W = data.words || [];
  if (W.length) for (const w of W) { s += ' '; cf.push(100); for (const ch of w.text) { s += ch; cf.push(w.confidence); } }
  else { s = data.text || ''; cf = Array(s.length).fill(60); }
  const out = new Map(), re = /(?:^|[^\d])(\d{1,3})\s*[.,:\-]*\s*([A-E8])(?![A-Z0-9])/g;
  let m;
  while ((m = re.exec(s))) {
    const q = +m[1], letter = m[2] === '8' ? 'B' : m[2];
    const ni = m.index + m[0].indexOf(m[1]), li = m.index + m[0].length - 1;
    const conf = Math.min(cf[ni] ?? 60, cf[li] ?? 60, m[2] === '8' ? 50 : 100);
    if (!out.has(q)) out.set(q, { q, letter, conf });
    re.lastIndex = m.index + m[0].length;
  }
  return [...out.values()];
}

/* ---------- main ---------- */
export async function scanKey(G0, quad, opt = {}) {
  const P = opt.onProgress || (() => {});
  P('prepare', 0); await tick();
  let R = null, g0 = null, bs = -2;
  for (let cand of rectify(G0, quad)) {
    const sk = estimateSkew(cand); if (Math.abs(sk) >= 0.4) cand = rotateGray(cand, -sk);
    const g = buildGrid(cand), sc = gridScore(g);
    if (sc > bs) { bs = sc; R = cand; g0 = g; }
    await tick();
  }
  P('load', 0);
  const ws = await initOCR();
  P('detect', 0); await tick();
  const order = g0 && g0.mh > g0.mw * 1.1 ? [1, 3, 0, 2] : [0, 2, 1, 3];
  let best = null;
  for (const k of order) {
    const Rk = rot90(R, k), g = k === 0 ? g0 : buildGrid(Rk);
    if (!g) continue;
    const sample = spread(g.cells, 8), rs = await ocrCells(ws, Rk, g, sample, 'cell');
    const sc = rs.filter(x => x.letter && x.num != null).length / sample.length;
    if (!best || sc > best.sc) best = { k, Rk, g, sc };
    if (sc >= 0.6) break;
  }
  let found = [], mode = 'grid', debug = null, cells = 0;
  if (best && best.sc >= 0.2) {
    cells = best.g.cells.length;
    const rs = await ocrCells(ws, best.Rk, best.g, best.g.cells, 'cell', f => P('read', f));
    const miss = rs.filter(x => x.has && !x.letter);
    if (miss.length) {
      P('retry', 0);
      const r2 = await ocrCells(ws, best.Rk, best.g, miss.map(x => x.cell), 'char', f => P('retry', f));
      r2.forEach((y, i) => { if (y.letterOnly) { miss[i].letter = y.letterOnly; miss[i].conf = Math.min(y.conf, miss[i].conf ?? 100, 65); } });
    }
    inferNumbers(rs, best.g);
    found = rs.filter(x => x.q != null && x.letter).map(x => ({ q: x.q, letter: x.letter, conf: Math.round(x.conf ?? 60) }));
    debug = drawDebug(best.Rk, best.g, rs);
  }
  if (found.length < Math.min(opt.expect || 10, 5)) { // no usable grid: read as free text
    mode = 'text'; P('text', 0);
    let tb = [], tk = 0;
    for (const k of [0, 1, 3, 2]) {
      const Rk = rot90(R, k);
      await setMode(ws[0], 'sparse');
      const { data } = await ws[0].recognize(grayToCanvas(Rk), {}, { text: true, blocks: true });
      const r = parseText(data);
      if (r.length > tb.length) { tb = r; tk = k; }
      if (tb.length >= 8) break;
    }
    if (tb.length > found.length) { found = tb; const c2 = grayToCanvas(rot90(R, tk)); debug = c2; }
    else mode = 'grid';
  }
  for (const w of ws) await setMode(w, 'cell');
  const m = new Map();
  for (const f of found) { const o = m.get(f.q); if (!o || f.conf > o.conf) m.set(f.q, f); }
  return { mode, found: [...m.values()].sort((x, y) => x.q - y.q), debug, cells };
}
const tick = () => new Promise(r => setTimeout(r, 0));

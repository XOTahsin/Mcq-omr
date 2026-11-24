// 4-corner crop tool. Handles move relative to the finger (no jumping), edges drag both corners,
// dragging inside moves the whole frame, and a magnifier shows the exact corner position.
export class Cropper {
  constructor(canvas, onChange) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.onChange = onChange;
    this.src = null; this.q = null; this.drag = null;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
  }
  set(src, quad) {
    this.src = src;
    const s = Math.min(1, 1400 / Math.max(src.width, src.height));
    this.s = s; this.c.width = Math.round(src.width * s); this.c.height = Math.round(src.height * s);
    this.q = quad ? quad.map(p => [p[0] * s, p[1] * s]) : this.inset();
    requestAnimationFrame(() => this.draw());
  }
  full() { const w = this.c.width, h = this.c.height; this.q = [[0, 0], [w, 0], [w, h], [0, h]]; this.draw(); }
  inset() { const w = this.c.width, h = this.c.height, m = 0.08; return [[w * m, h * m], [w * (1 - m), h * m], [w * (1 - m), h * (1 - m)], [w * m, h * (1 - m)]]; }
  quad() { return this.q.map(p => [p[0] / this.s, p[1] / this.s]); }
  ratio() { const r = this.c.getBoundingClientRect(); return r.width ? this.c.width / r.width : 1; }
  pos(e) { const r = this.c.getBoundingClientRect(); return [(e.clientX - r.left) * this.c.width / r.width, (e.clientY - r.top) * this.c.height / r.height]; }
  mids() { return this.q.map((p, i) => { const n = this.q[(i + 1) % 4]; return [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]; }); }
  inside(p) {
    let c = false; const q = this.q;
    for (let i = 0, j = 3; i < 4; j = i++) if ((q[i][1] > p[1]) !== (q[j][1] > p[1]) && p[0] < (q[j][0] - q[i][0]) * (p[1] - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0]) c = !c;
    return c;
  }
  hit(p) {
    const R = 34 * this.ratio(); let best = null, bd = R;
    this.q.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = { t: 'c', i }; } });
    if (best) return best;
    this.mids().forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; best = { t: 'e', i }; } });
    if (best) return best;
    return this.inside(p) ? { t: 'm' } : null;
  }
  down(e) {
    if (!this.src) return;
    const p = this.pos(e), h = this.hit(p);
    if (!h) return;
    e.preventDefault(); this.c.setPointerCapture(e.pointerId);
    this.drag = { ...h, last: p, at: p }; this.draw();
  }
  move(e) {
    if (!this.drag) return;
    e.preventDefault();
    const p = this.pos(e), dx = p[0] - this.drag.last[0], dy = p[1] - this.drag.last[1], W = this.c.width, H = this.c.height;
    this.drag.last = p;
    const cl = v => [Math.max(0, Math.min(W, v[0])), Math.max(0, Math.min(H, v[1]))];
    const { t, i } = this.drag;
    if (t === 'c') { this.q[i] = cl([this.q[i][0] + dx, this.q[i][1] + dy]); this.drag.at = this.q[i]; }
    else if (t === 'e') { const j = (i + 1) % 4; this.q[i] = cl([this.q[i][0] + dx, this.q[i][1] + dy]); this.q[j] = cl([this.q[j][0] + dx, this.q[j][1] + dy]); this.drag.at = this.mids()[i]; }
    else {
      let mx = dx, my = dy;
      for (const c of this.q) { mx = Math.max(-c[0], Math.min(W - c[0], mx)); my = Math.max(-c[1], Math.min(H - c[1], my)); }
      this.q = this.q.map(c => [c[0] + mx, c[1] + my]);
    }
    this.draw();
  }
  up() { if (!this.drag) return; this.drag = null; this.draw(); this.onChange && this.onChange(); }
  draw() {
    const { g, c, q } = this; if (!this.src) return;
    const r = this.ratio(), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H); g.drawImage(this.src, 0, 0, W, H);
    g.save(); g.beginPath(); g.rect(0, 0, W, H); g.moveTo(...q[0]); q.slice(1).forEach(p => g.lineTo(...p)); g.closePath();
    g.fillStyle = 'rgba(10,10,10,.55)'; g.fill('evenodd'); g.restore();
    // thirds guide
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1 * r;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (const t of [1 / 3, 2 / 3]) {
      let a = lerp(q[0], q[1], t), b = lerp(q[3], q[2], t); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
      a = lerp(q[0], q[3], t); b = lerp(q[1], q[2], t); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke();
    }
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#e0442b';
    g.strokeStyle = acc; g.lineWidth = 2.5 * r; g.beginPath(); g.moveTo(...q[0]); q.slice(1).forEach(p => g.lineTo(...p)); g.closePath(); g.stroke();
    this.mids().forEach((m, i) => {
      const a = q[i], b = q[(i + 1) % 4], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      g.save(); g.translate(...m); g.rotate(ang); g.fillStyle = '#fff'; g.strokeStyle = acc; g.lineWidth = 2 * r;
      g.beginPath(); g.roundRect(-14 * r, -4 * r, 28 * r, 8 * r, 4 * r); g.fill(); g.stroke(); g.restore();
    });
    q.forEach((p, i) => {
      const on = this.drag && this.drag.t === 'c' && this.drag.i === i;
      g.beginPath(); g.arc(p[0], p[1], (on ? 14 : 11) * r, 0, Math.PI * 2);
      g.fillStyle = on ? acc : '#fff'; g.fill(); g.lineWidth = 2.5 * r; g.strokeStyle = acc; g.stroke();
    });
    if (this.drag && this.drag.t !== 'm') this.loupe(this.drag.at, r, acc);
  }
  loupe(p, r, acc) {
    const g = this.g, R = 62 * r, z = 2.6, W = this.c.width;
    const cx = p[0] < W / 2 ? W - R - 12 * r : R + 12 * r, cy = R + 12 * r;
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.closePath(); g.fillStyle = '#000'; g.fill(); g.clip();
    const sw = (2 * R) / z, sx = p[0] - sw / 2, sy = p[1] - sw / 2, f = this.src.width / W;
    g.drawImage(this.src, sx * f, sy * f, sw * f, sw * f, cx - R, cy - R, 2 * R, 2 * R);
    g.strokeStyle = acc; g.lineWidth = 1.5 * r;
    g.beginPath(); g.moveTo(cx - 12 * r, cy); g.lineTo(cx + 12 * r, cy); g.moveTo(cx, cy - 12 * r); g.lineTo(cx, cy + 12 * r); g.stroke();
    g.restore();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.lineWidth = 3 * r; g.strokeStyle = '#fff'; g.stroke();
  }
}

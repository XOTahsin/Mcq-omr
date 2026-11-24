const P = 'omr2_';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(P + k) : localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; } },
  wipe() { Object.keys(localStorage).filter(k => k.startsWith(P)).forEach(k => localStorage.removeItem(k)); },
};
// bring over data saved by the earlier single-file version (same site)
export function migrate() {
  if (localStorage.getItem(P + 'tests') != null) return;
  try {
    const t = JSON.parse(localStorage.getItem('omr_tests') || 'null'), h = JSON.parse(localStorage.getItem('omr_hist') || 'null');
    if (Array.isArray(t)) store.set('tests', t);
    if (Array.isArray(h)) store.set('hist', h);
  } catch { /* ignore */ }
}

import { T, setLang } from './i18n.js';
import { store, migrate } from './store.js';
import { I } from './icons.js';
import { Cropper } from './cropper.js';
import * as SC from './scanner.js';

const VERSION = '2.0.0';
migrate();
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const L = j => 'ABCDE'[j];
const fmt = s => { s = Math.max(0, Math.round(s || 0)); const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
const tone = p => p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low';

const S = {
  tests: store.get('tests', []), hist: store.get('hist', []),
  cfg: Object.assign({ theme: 'auto', big: 0, lang: 'en', warn: 5, haptic: 1 }, store.get('cfg', {})),
};
S.tests.forEach(t => { t.conf = t.conf || t.key.map(k => (k == null ? 0 : 100)); t.sec = t.sec || ''; t.neg = +t.neg || 0; });
const saveTests = () => store.set('tests', S.tests), saveHist = () => store.set('hist', S.hist), saveCfg = () => store.set('cfg', S.cfg);
const findTest = id => S.tests.find(t => t.id === id);
const buzz = p => { if (S.cfg.haptic && navigator.vibrate) navigator.vibrate(p); };

/* ---------- shell ---------- */
function applyCfg() {
  setLang(S.cfg.lang);
  const dark = S.cfg.theme === 'dark' || (S.cfg.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.body.classList.toggle('big', !!S.cfg.big);
  $('meta[name=theme-color]').content = dark ? '#121211' : '#f4f2ec';
  $$('#tabs [data-v]').forEach(b => { b.querySelector('span').textContent = T(b.dataset.v); });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { applyCfg(); });

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 2600); }
function ask(msg, { ok = T('ok'), danger = false } = {}) {
  return new Promise(res => {
    const d = $('#dlg'); d.returnValue = '';
    d.innerHTML = `<form method="dialog"><p>${esc(msg)}</p><div class="dlg-a"><button value="0" class="btn ghost">${T('cancel')}</button><button value="1" class="btn ${danger ? 'danger' : 'ink'}">${esc(ok)}</button></div></form>`;
    d.onclose = () => res(d.returnValue === '1'); d.showModal();
  });
}

/* ---------- router ---------- */
const TABS = ['home', 'tests', 'history', 'settings'];
let route = { name: 'home' }, stack = [], cleanup = null;
function nav(name, p = {}, how = 'push') {
  if (cleanup) { cleanup(); cleanup = null; }
  if (how === 'push') { stack.push(route); history.pushState({ d: stack.length }, ''); }
  if (how === 'tab') stack = [];
  route = { name, ...p }; render();
}
function goBack() { if (stack.length) history.back(); else nav('home', {}, 'tab'); }
addEventListener('popstate', () => {
  if (!stack.length) return;
  if (cleanup) { cleanup(); cleanup = null; }
  route = stack.pop(); render();
});
function render() {
  const v = V[route.name](route), isTab = TABS.includes(route.name);
  document.body.dataset.route = route.name;
  $('#title').textContent = v.title || '';
  $('#bar-r').innerHTML = v.right || '';
  $('#back').hidden = isTab;
  $('#brand').hidden = !isTab;
  $('#tabs').hidden = !isTab;
  $$('#tabs [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === route.name));
  const view = $('#view'); view.innerHTML = v.html; view.className = 'view v-' + route.name;
  scrollTo(0, 0);
  v.mount && v.mount();
}

/* ---------- shared bits ---------- */
const empty = (icon, h, p, cta = '') => `<div class="empty"><div class="empty-i">${icon}</div><b>${h}</b><p>${p}</p>${cta}</div>`;
function testRow(t) {
  const k = t.key.filter(x => x != null).length, hs = S.hist.filter(h => h.tid === t.id), b = hs.length ? Math.max(...hs.map(h => h.pct)) : null;
  return `<div class="trow"><button class="tmain" data-act="edit" data-id="${t.id}"><span class="tbadge">${t.N}</span><span class="tt"><b>${esc(t.name)}</b><small>${k}/${t.N} ${T('keyed')} · ${t.MIN} ${T('min')}${b != null ? ` · ${T('best')} ${b}%` : ''}</small></span></button><button class="ib play" data-act="start" data-id="${t.id}" aria-label="${T('startExam')}">${I.play}</button></div>`;
}
function histRow(h) {
  return `<button class="hrow" data-act="openRes" data-id="${h.id}"><span class="hpct ${tone(h.pct)}">${Math.round(h.pct)}<small>%</small></span><span class="tt"><b>${esc(h.name)}${h.sub ? ` <em>${T('retakeTag')}</em>` : ''}</b><small>${new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${h.net}/${h.total} · ${fmt(h.used)}</small></span>${I.chev}</button>`;
}
function lineChart(pts, H = 140) {
  const W = 320, n = pts.length; if (!n) return '';
  const X = i => n === 1 ? W / 2 : 28 + i * (W - 40) / (n - 1), Y = p => H - 18 - Math.max(0, Math.min(100, p)) / 100 * (H - 32);
  let s = '';
  [0, 50, 100].forEach(p => { s += `<line x1="28" x2="${W}" y1="${Y(p)}" y2="${Y(p)}" class="gl"/><text x="0" y="${Y(p) + 3}">${p}</text>`; });
  const line = pts.map((h, i) => `${X(i).toFixed(1)},${Y(h.pct).toFixed(1)}`).join(' ');
  if (n > 1) s += `<polygon class="area" points="${X(0)},${Y(0)} ${line} ${X(n - 1)},${Y(0)}"/>`;
  s += `<polyline class="ln" points="${line}"/>` + pts.map((h, i) => `<circle cx="${X(i)}" cy="${Y(h.pct)}" r="${i === n - 1 ? 4 : 2.5}" class="${i === n - 1 ? 'last' : ''}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${s}</svg>`;
}
const seg = (k, opts, val) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-act="seg" data-k="${k}" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const sw = (k, on) => `<button type="button" class="switch ${on ? 'on' : ''}" data-act="toggle" data-k="${k}" role="switch" aria-checked="${!!on}"><i></i></button>`;

/* ---------- views ---------- */
const V = {};

V.home = () => {
  const cur = store.get('cur', null), n = S.hist.length, avg = n ? Math.round(S.hist.reduce((a, h) => a + h.pct, 0) / n) : null;
  const best = n ? Math.round(Math.max(...S.hist.map(h => h.pct))) : null, last = S.hist.slice(-14);
  const d = new Date().toLocaleDateString(S.cfg.lang === 'bn' ? 'bn-BD' : undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return {
    title: T('appName'),
    html: `
    <section class="hello"><p class="eyebrow">${d}</p><h2 class="display">${T('homeHead')}</h2></section>
    ${cur ? `<button class="resume" data-act="resume"><span class="pulse"></span><span class="tt"><b>${T('resume')}</b><small>${esc(cur.t.name)} · ${fmt(cur.lim - cur.el)} ${T('left')}</small></span>${I.play}</button>` : ''}
    <div class="quick">
      <button class="qa dark" data-act="newScan"><span class="qi">${I.camera}</span><b>${T('scanKey')}</b><small>${T('scanKeySub')}</small></button>
      <button class="qa" data-act="newTest"><span class="qi">${I.plus}</span><b>${T('newTest')}</b><small>${T('newTestSub')}</small></button>
    </div>
    <div class="kpis"><div><small>${T('tests')}</small><b>${S.tests.length}</b></div><div><small>${T('attempts')}</small><b>${n}</b></div><div><small>${T('average')}</small><b>${avg == null ? '—' : avg + '<i>%</i>'}</b></div><div><small>${T('best')}</small><b>${best == null ? '—' : best + '<i>%</i>'}</b></div></div>
    ${last.length > 1 ? `<section class="card"><div class="card-h"><h3>${T('trend')}</h3><button class="link" data-act="tab" data-v="history">${T('seeAll')}</button></div>${lineChart(last, 120)}</section>` : ''}
    <section class="card"><div class="card-h"><h3>${T('recentTests')}</h3>${S.tests.length > 3 ? `<button class="link" data-act="tab" data-v="tests">${T('seeAll')}</button>` : ''}</div>
      ${S.tests.length ? S.tests.slice(0, 3).map(testRow).join('') : empty(I.tests, T('noTests'), T('noTestsSub'))}</section>
    ${n ? `<section class="card"><div class="card-h"><h3>${T('recent')}</h3><button class="link" data-act="tab" data-v="history">${T('seeAll')}</button></div>${S.hist.slice(-3).reverse().map(histRow).join('')}</section>` : ''}`,
  };
};

V.tests = () => ({
  title: T('tests'),
  right: `<button class="ib" data-act="newTest" aria-label="${T('newTest')}">${I.plus}</button>`,
  html: S.tests.length ? `<section class="card flush">${S.tests.map(testRow).join('')}</section>`
    : `<section class="card">${empty(I.tests, T('noTests'), T('noTestsSub'), `<button class="btn acc" data-act="newScan">${I.camera}<span>${T('scanKey')}</span></button>`)}</section>`,
});

V.history = ({ f = '' }) => {
  const hs = S.hist.filter(h => !f || h.tid === f), n = hs.length;
  const avg = n ? Math.round(hs.reduce((a, h) => a + h.pct, 0) / n) : 0;
  return {
    title: T('history'),
    html: `
    ${S.tests.length > 1 ? `<div class="chips">${[['', T('all')], ...S.tests.map(t => [t.id, t.name])].map(([v, l]) => `<button class="chip ${v === f ? 'on' : ''}" data-act="hf" data-v="${v}">${esc(l)}</button>`).join('')}</div>` : ''}
    ${n ? `<section class="card"><div class="card-h"><h3>${T('trend')}</h3><span class="muted">${T('average')} <b>${avg}%</b></span></div>${lineChart(hs.slice(-30))}</section>
    <section class="card flush">${hs.slice().reverse().map(histRow).join('')}</section>`
      : `<section class="card">${empty(I.chart, T('noHist'), T('noHistSub'))}</section>`}`,
  };
};

V.settings = () => ({
  title: T('settings'),
  html: `
  <section class="card set">
    <div class="srow"><span>${T('theme')}</span>${seg('theme', [['auto', T('auto')], ['light', T('light')], ['dark', T('dark')]], S.cfg.theme)}</div>
    <div class="srow"><span>${T('lang')}</span>${seg('lang', [['en', 'English'], ['bn', 'বাংলা']], S.cfg.lang)}</div>
    <div class="srow"><span>${T('big')}</span>${sw('big', S.cfg.big)}</div>
    <div class="srow"><span>${T('haptic')}</span>${sw('haptic', S.cfg.haptic)}</div>
    <div class="srow"><span>${T('warn')}</span><input class="num" type="number" inputmode="numeric" min="0" max="60" value="${S.cfg.warn}" data-cfg="warn"></div>
  </section>
  <section class="card set">
    <div class="card-h"><h3>${T('backup')}</h3></div><p class="muted">${T('backupSub')}</p>
    <div class="row-a"><button class="btn ghost" data-act="export">${I.down}<span>${T('export')}</span></button><label class="btn ghost">${I.up}<span>${T('import')}</span><input type="file" accept=".json,application/json" hidden data-in="import"></label></div>
  </section>
  <section class="card set"><button class="btn danger-ghost" data-act="wipe">${I.trash}<span>${T('wipe')}</span></button></section>
  <p class="foot">${T('appName')} · ${T('version')} ${VERSION}</p>`,
  mount() {
    $('[data-cfg=warn]').onchange = e => { S.cfg.warn = Math.max(0, Math.min(60, +e.target.value || 0)); saveCfg(); toast(T('saved')); };
    $('[data-in=import]').onchange = e => importData(e.target);
  },
});

/* ----- test editor ----- */
function keyCls(t, i) { return t.key[i] == null ? 'miss' : (t.conf[i] ?? 100) < 60 ? 'low' : ''; }
function keyRows(t) {
  let h = '';
  for (let i = 0; i < t.N; i++) {
    h += `<div class="qr ${keyCls(t, i)}" id="k${i}"><span class="qn">${i + t.ST}</span><span class="bubs">`;
    for (let j = 0; j < t.O; j++) h += `<button class="bub ${t.key[i] === j ? 'on' : ''}" data-act="kb" data-i="${i}" data-j="${j}">${L(j)}</button>`;
    h += `</span></div>`;
  }
  return h;
}
V.edit = ({ id }) => {
  const t = findTest(id); if (!t) return V.home();
  const k = t.key.filter(x => x != null).length;
  return {
    title: t.name,
    right: `<button class="ib" data-act="delTest" data-id="${t.id}" aria-label="${T('del')}">${I.trash}</button>`,
    html: `
    <section class="card form">
      <div class="field"><label>${T('name')}</label><input data-f="name" value="${esc(t.name)}" autocomplete="off"></div>
      <div class="g3">
        <div class="field"><label>${T('total')}</label><input data-f="N" type="number" inputmode="numeric" min="1" max="300" value="${t.N}"></div>
        <div class="field"><label>${T('time')}</label><input data-f="MIN" type="number" inputmode="numeric" min="1" value="${t.MIN}"></div>
        <div class="field"><label>${T('first')}</label><input data-f="ST" type="number" inputmode="numeric" min="0" value="${t.ST}"></div>
      </div>
      <div class="g2">
        <div class="field"><label>${T('opts')}</label>${seg('O', [[4, 'A–D'], [5, 'A–E']], t.O)}</div>
        <div class="field"><label>${T('neg')}</label>${seg('neg', [[0, '0'], [0.25, '¼'], [0.5, '½'], [1, '1']], t.neg)}</div>
      </div>
      <div class="field"><label>${T('sec')}</label><input data-f="sec" placeholder="English:1-40, Math:41-100" value="${esc(t.sec)}" autocomplete="off"></div>
    </section>
    <section class="card">
      <div class="card-h"><h3>${T('key')} <span class="count" id="kc">${k}/${t.N}</span></h3><div class="row-a"><button class="btn sm ghost" data-act="clearKey">${T('clear')}</button><button class="btn sm acc" data-act="goScan">${I.camera}<span>${T('scan')}</span></button></div></div>
      <p class="legend"><span><i class="lg miss"></i>${T('lgMiss')}</span><span><i class="lg low"></i>${T('lgLow')}</span></p>
      <div class="sheet" id="kg">${keyRows(t)}</div>
    </section>
    <div class="dock"><button class="btn acc grow" data-act="start" data-id="${t.id}">${I.play}<span>${T('startExam')}</span></button></div>`,
    mount() {
      $$('[data-f]').forEach(inp => inp.addEventListener('change', () => editField(t, inp.dataset.f, inp.value)));
      cleanup = () => saveTests();
    },
  };
};
function editField(t, f, v) {
  if (f === 'name') { t.name = v.trim() || T('untitled'); $('#title').textContent = t.name; }
  else if (f === 'sec') t.sec = v;
  else if (f === 'MIN') t.MIN = Math.max(1, Math.min(600, +v || 1));
  else if (f === 'ST') t.ST = Math.max(0, parseInt(v) || 0);
  else if (f === 'N') { const N = Math.max(1, Math.min(300, parseInt(v) || 1)); t.key = Array.from({ length: N }, (_, i) => t.key[i] ?? null); t.conf = Array.from({ length: N }, (_, i) => t.conf[i] ?? 0); t.N = N; }
  else if (f === 'O') { t.O = +v; t.key = t.key.map(k => (k != null && k < t.O ? k : null)); }
  else if (f === 'neg') t.neg = +v;
  saveTests();
  if (['N', 'ST', 'O'].includes(f)) refreshKey(t);
}
function refreshKey(t) { const kg = $('#kg'); if (kg) kg.innerHTML = keyRows(t); const kc = $('#kc'); if (kc) kc.textContent = `${t.key.filter(x => x != null).length}/${t.N}`; }
function newTestObj() { return { id: uid(), name: `Test ${S.tests.length + 1}`, N: 50, O: 4, ST: 1, MIN: 50, neg: 0, sec: '', key: Array(50).fill(null), conf: Array(50).fill(0), created: Date.now() }; }

/* ----- scanner screen ----- */
let SCN = null;
V.scan = ({ id }) => ({
  title: T('scanKey'),
  html: `
  <section class="pick" id="pick">
    <div class="pick-art">${I.scan}</div>
    <h2 class="h2">${T('scanTitle')}</h2><p class="muted">${T('scanIntro')}</p>
    <label class="btn acc block lg">${I.camera}<span>${T('takePhoto')}</span><input type="file" accept="image/*" capture="environment" hidden data-in="file"></label>
    <label class="btn ghost block lg">${I.image}<span>${T('fromGallery')}</span><input type="file" accept="image/*" hidden data-in="file"></label>
    <ol class="tips"><li>${T('tip1')}</li><li>${T('tip2')}</li><li>${T('tip3')}</li></ol>
  </section>
  <section class="editor" id="editor" hidden>
    <div class="stage"><canvas id="cv"></canvas></div>
    <p class="hint">${T('cropHint')}</p>
    <div class="tools">
      <button class="tool" data-act="scRot" data-d="-1">${I.rotL}<span>${T('rotate')}</span></button>
      <button class="tool" data-act="scRot" data-d="1">${I.rotR}<span>${T('rotate')}</span></button>
      <button class="tool" data-act="scAuto">${I.target}<span>${T('autoDetect')}</span></button>
      <button class="tool" data-act="scFull">${I.frame}<span>${T('fullImage')}</span></button>
    </div>
  </section>
  <section class="work" id="work" hidden><div class="spin"></div><b id="wStage"></b><div class="pbar"><i id="wBar"></i></div></section>
  <section id="done" hidden></section>
  <div class="dock" id="scDock" hidden><button class="btn ghost" data-act="scRepick">${T('change')}</button><button class="btn acc grow" data-act="scGo">${I.bolt}<span>${T('scanNow')}</span></button></div>`,
  mount() {
    SCN = { id, src: null, cropper: new Cropper($('#cv')) };
    $$('[data-in=file]').forEach(i => i.onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) scLoad(f); });
    SC.initOCR().catch(() => {}); // warm up the reader while the user frames the photo
    cleanup = () => { SCN = null; };
  },
});
function scShow(w) { ['pick', 'editor', 'work', 'done'].forEach(x => { const e = $('#' + x); if (e) e.hidden = x !== w; }); const d = $('#scDock'); if (d) d.hidden = w !== 'editor'; }
async function scLoad(f) {
  let bmp;
  try { bmp = await createImageBitmap(f, { imageOrientation: 'from-image' }); }
  catch { bmp = await new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = URL.createObjectURL(f); }); }
  if (!SCN) return;
  const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  SCN.src = c; scShow('editor'); scAuto(false);
}
function scAuto(loud) { const q = SC.detectQuad(SCN.src); SCN.cropper.set(SCN.src, q); if (q || loud) toast(q ? T('tableFound') : T('tableNotFound')); }
function scRot(d) {
  const s = SCN.src, c = document.createElement('canvas'); c.width = s.height; c.height = s.width;
  const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.rotate(d * Math.PI / 2); g.drawImage(s, -s.width / 2, -s.height / 2);
  SCN.src = c; scAuto(false);
}
async function scGo() {
  const t = findTest(SCN.id), quad = SCN.cropper.quad(), my = SCN;
  scShow('work');
  const P = (k, f) => { const st = $('#wStage'), bar = $('#wBar'); if (st) st.textContent = T('st_' + k); if (bar) bar.style.width = Math.round((f || 0) * 100) + '%'; };
  try {
    const res = await SC.scanKey(SC.grayFromCanvas(my.src), quad, { onProgress: P, expect: t.N });
    if (SCN !== my) return;
    scDone(t, res);
  } catch (e) { console.error(e); if (SCN === my) { toast(T('scanFail') + ': ' + (e.message || e)); scShow('editor'); } }
}
function scDone(t, res) {
  if (res.found.some(f => f.letter === 'E') && t.O < 5) { t.O = 5; toast(T('switched5')); }
  let nw = 0, up = 0, out = 0;
  for (const f of res.found) {
    const i = f.q - t.ST, j = 'ABCDE'.indexOf(f.letter);
    if (i < 0 || i >= t.N || j < 0 || j >= t.O) { out++; continue; }
    if (t.key[i] == null) { t.key[i] = j; t.conf[i] = f.conf; nw++; }
    else if ((t.conf[i] ?? 0) < 100 && t.key[i] !== j && f.conf > (t.conf[i] ?? 0)) { t.key[i] = j; t.conf[i] = f.conf; up++; }
    else if (t.key[i] === j) t.conf[i] = Math.max(t.conf[i] ?? 0, f.conf);
  }
  saveTests(); buzz(30);
  const keyed = t.key.filter(x => x != null).length, low = t.key.filter((k, i) => k != null && (t.conf[i] ?? 100) < 60).length;
  const d = $('#done');
  d.innerHTML = `
    <div class="done-h"><div class="big-n">${res.found.length}<small>/${t.N}</small></div><p>${T('found')}</p></div>
    <div class="stat3"><div><b>${nw}</b><small>${T('newA')}</small></div><div><b>${up}</b><small>${T('updated')}</small></div><div class="${low ? 'warn' : ''}"><b>${low}</b><small>${T('unsure')}</small></div></div>
    ${res.mode === 'text' ? `<p class="note">${T('textMode')}</p>` : ''}
    ${out ? `<p class="note">${out} ${T('outside')}</p>` : ''}
    <figure class="dbg" id="dbg"><figcaption>${T('debugCap')}</figcaption></figure>
    <p class="muted center">${T('key')}: <b>${keyed}/${t.N}</b></p>
    <div class="row-a stack"><button class="btn acc block" data-act="back">${I.check}<span>${T('reviewKey')}</span></button><button class="btn ghost block" data-act="scRepick">${I.camera}<span>${T('scanMore')}</span></button></div>`;
  if (res.debug) $('#dbg').prepend(res.debug);
  scShow('done');
}

/* ----- exam ----- */
let E = null, tint = null;
function beginExam(t, sub, how = 'push') {
  if (!t) return;
  const qs = sub || [...Array(t.N).keys()], miss = qs.filter(i => t.key[i] == null).length;
  const go = () => {
    E = { t: JSON.parse(JSON.stringify(t)), qs, sub: !!sub, ans: Array(t.N).fill(null), flag: Array(t.N).fill(0), qt: Array(t.N).fill(0), lim: Math.max(60, Math.round(t.MIN * 60 * qs.length / t.N)), el: 0, warned: 0, run: 0 };
    store.set('cur', E); nav('exam', {}, how);
  };
  if (miss === qs.length) { toast(T('noKey')); if (route.name !== 'edit') nav('edit', { id: t.id }); return; }
  if (miss) ask(`${miss} ${T('missKey')}`).then(ok => ok && go()); else go();
}
const palCls = i => (E.ans[i] != null ? 'a' : '') + (E.flag[i] ? ' f' : '');
function examRow(i) {
  let h = `<div class="qr" id="e${i}"><span class="qn">${i + E.t.ST}</span><span class="bubs">`;
  for (let j = 0; j < E.t.O; j++) h += `<button class="bub ${E.ans[i] === j ? 'on' : ''}" data-act="ans" data-i="${i}" data-j="${j}">${L(j)}</button>`;
  return h + `</span><button class="flag ${E.flag[i] ? 'on' : ''}" data-act="flag" data-i="${i}" aria-label="flag">${I.flag}</button></div>`;
}
V.exam = () => {
  if (!E) return V.home();
  return {
    title: E.t.name,
    right: `<span class="timer" id="tmr">${fmt(E.lim - E.el)}</span><button class="ib" data-act="pause" aria-label="${T('paused')}">${I.pause}</button>`,
    html: `
    <div class="pal" id="pal">${E.qs.map(i => `<button data-act="jump" data-i="${i}" id="p${i}" class="${palCls(i)}">${i + E.t.ST}</button>`).join('')}</div>
    <div class="sheet exam">${E.qs.map(examRow).join('')}</div>
    <div class="dock exam-dock"><div class="prog"><i id="eprog"></i></div><span class="ecount" id="ecount"></span><button class="btn acc" data-act="submit">${I.check}<span>${T('submit')}</span></button></div>
    <div class="pz" id="pz" hidden><div class="pz-in"><p class="eyebrow">${T('paused')}</p><div class="pz-t" id="pzt"></div><button class="btn acc block lg" data-act="resumeT">${I.play}<span>${T('cont')}</span></button><button class="btn ghost block" data-act="back">${T('saveExit')}</button></div></div>`,
    mount() { updCount(); if (E.resumed) { E.resumed = 0; showPause(); } else startTick(); cleanup = () => { stopTick(); }; },
  };
};
function updCount() { const a = E.qs.filter(i => E.ans[i] != null).length, n = E.qs.length; $('#ecount').innerHTML = `<b>${a}</b>/${n} ${T('answered')}`; $('#eprog').style.width = (a / n * 100) + '%'; }
function startTick() { $('#pz').hidden = true; E.run = 1; E.tk = E.last = Date.now(); clearInterval(tint); tint = setInterval(tick, 500); tick(); }
function stopTick() { if (E && E.run) { tick(); E.run = 0; } clearInterval(tint); if (E) store.set('cur', E); }
function showPause() { stopTick(); $('#pzt').textContent = fmt(E.lim - E.el); $('#pz').hidden = false; }
function tick() {
  if (!E || !E.run) return;
  const now = Date.now(); E.el += (now - E.tk) / 1000; E.tk = now;
  const r = E.lim - E.el, el = $('#tmr');
  if (el) { el.textContent = fmt(r); el.classList.toggle('hot', r < 60); }
  if (S.cfg.warn && !E.warned && r <= S.cfg.warn * 60 && E.lim > S.cfg.warn * 60) { E.warned = 1; buzz([250, 120, 250]); toast(`${S.cfg.warn} ${T('warnLeft')}`); el && el.classList.add('warn'); }
  if ((now / 1000 | 0) % 5 === 0) store.set('cur', E);
  if (r <= 0) { buzz(600); toast(T('timesUp')); submitExam(); }
}
function grade(r) {
  let c = 0, w = 0, s = 0; const items = [];
  for (const i of r.qs) { if (r.key[i] == null) continue; const st = r.ans[i] == null ? 's' : r.ans[i] === r.key[i] ? 'c' : 'w'; st === 'c' ? c++ : st === 'w' ? w++ : s++; items.push({ i, st }); }
  const total = c + w + s; return { c, w, s, total, net: +(c - w * (r.neg || 0)).toFixed(2), items };
}
function submitExam() {
  if (!E) return;
  stopTick();
  const t = E.t, r = { id: uid(), tid: t.id, name: t.name, date: Date.now(), sub: E.sub, N: t.N, O: t.O, ST: t.ST, MIN: t.MIN, neg: t.neg, sec: t.sec, key: t.key, qs: E.qs, ans: E.ans, flag: E.flag, qt: E.qt.map(x => Math.round(x)), used: Math.round(Math.min(E.el, E.lim)), lim: E.lim };
  const g = grade(r); Object.assign(r, { c: g.c, w: g.w, s: g.s, total: g.total, net: g.net, pct: g.total ? Math.round(Math.max(0, g.net) / g.total * 1000) / 10 : 0 });
  S.hist.push(r); if (S.hist.length > 400) S.hist = S.hist.slice(-400); saveHist();
  store.set('cur', null); E = null; cleanup = null;
  nav('result', { id: r.id }, 'replace');
}

/* ----- result ----- */
function secs(r) { const o = []; (r.sec || '').split(/[,;\n]/).forEach(p => { const m = p.match(/^\s*(.*?)\s*[:=]?\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/i); if (m) o.push({ n: m[1] || `${m[2]}–${m[3]}`, a: +m[2], b: +m[3] }); }); return o; }
V.result = ({ id, f = 'x' }) => {
  const r = S.hist.find(h => h.id === id); if (!r) return V.history({});
  const g = grade(r), ss = secs(r), fl = r.qs.filter(i => r.flag[i]).length;
  const slow = g.items.filter(x => r.qt[x.i] > 0).sort((a, b) => r.qt[b.i] - r.qt[a.i]).slice(0, 5);
  return {
    title: T('review'),
    right: `<button class="ib" data-act="shareRes" aria-label="${T('share')}">${I.share}</button>`,
    html: `
    <section class="res-hero">
      <p class="eyebrow">${esc(r.name)} · ${new Date(r.date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
      <div class="res-top"><div class="res-pct ${tone(r.pct)}">${r.pct}<small>%</small></div>
        <div class="res-side"><div><small>${T('marks')}</small><b>${g.net}<span>/${g.total}</span></b></div><div><small>${T('timeUsed')}</small><b>${fmt(r.used)}<span>/${fmt(r.lim)}</span></b></div></div></div>
      <div class="sbar">${g.c ? `<i class="ok" style="flex:${g.c}"></i>` : ''}${g.w ? `<i class="bad" style="flex:${g.w}"></i>` : ''}${g.s ? `<i class="skip" style="flex:${g.s}"></i>` : ''}</div>
      <div class="legend4"><span><i class="ok"></i>${T('correct')}<b>${g.c}</b></span><span><i class="bad"></i>${T('wrong')}<b>${g.w}</b></span><span><i class="skip"></i>${T('skipped')}<b>${g.s}</b></span><span><i class="flg"></i>${T('flagged')}<b>${fl}</b></span></div>
      ${r.neg ? `<p class="muted small">−${r.neg} × ${g.w} ${T('wrong').toLowerCase()}</p>` : ''}
    </section>
    ${ss.length ? `<section class="card"><div class="card-h"><h3>${T('sections')}</h3></div><table class="tbl"><tr><th>${T('section')}</th><th>✓</th><th>✗</th><th>—</th><th>${T('marks')}</th></tr>${ss.map(s => { const it = g.items.filter(x => x.i + r.ST >= s.a && x.i + r.ST <= s.b), c = it.filter(x => x.st === 'c').length, w = it.filter(x => x.st === 'w').length; return `<tr><td>${esc(s.n)}</td><td>${c}</td><td>${w}</td><td>${it.length - c - w}</td><td><b>${+(c - w * r.neg).toFixed(2)}</b>/${it.length}</td></tr>`; }).join('')}</table></section>` : ''}
    ${slow.length ? `<section class="card"><div class="card-h"><h3>${T('slow')}</h3></div><div class="chips wrap">${slow.map(x => `<button class="chip" data-act="rjump" data-i="${x.i}"><b>${x.i + r.ST}</b> ${fmt(r.qt[x.i])} <i class="dot ${x.st}"></i></button>`).join('')}</div></section>` : ''}
    <section class="card">
      <div class="card-h"><h3>${T('review')}</h3></div>
      ${seg('rf', [['x', T('fx')], ['w', T('wrong')], ['s', T('skipped')], ['f', T('flagged')], ['a', T('all')]], f)}
      <div class="sheet review" id="rl">${resList(r, g, f)}</div>
    </section>
    <div class="dock"><button class="btn ghost" data-act="retake" data-w="0">${I.redo}<span>${T('retake')}</span></button><button class="btn acc grow" data-act="retake" data-w="1">${I.redo}<span>${T('retakeWrong')}</span></button></div>`,
  };
};
function resList(r, g, f) {
  let h = '';
  for (const { i, st } of g.items) {
    if ((f === 'x' && st === 'c') || (f === 'w' && st !== 'w') || (f === 's' && st !== 's') || (f === 'f' && !r.flag[i])) continue;
    h += `<div class="qr r-${st}" id="r${i}"><span class="qn">${i + r.ST}</span><span class="bubs">`;
    for (let j = 0; j < r.O; j++) { const cl = j === r.key[i] ? (st === 's' ? 'want' : 'ok') : j === r.ans[i] ? 'bad' : ''; h += `<span class="bub ${cl}">${L(j)}</span>`; }
    h += `</span><span class="rmeta">${r.flag[i] ? I.flag : ''}${r.qt[i] ? `<small>${fmt(r.qt[i])}</small>` : ''}</span></div>`;
  }
  return h || empty(I.check, T('perfect'), '');
}
function shareResult() {
  const r = S.hist.find(h => h.id === route.id); if (!r) return;
  const g = grade(r), wr = g.items.filter(x => x.st !== 'c'), cols = 4, W = 1080, H = 520 + Math.ceil(wr.length / cols) * 56 + 60;
  const dark = document.documentElement.dataset.theme === 'dark', bg = dark ? '#121211' : '#f4f2ec', ink = dark ? '#eeebe4' : '#1c1b18', mute = '#8d887d';
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e0442b'; x.fillRect(0, 0, W, 12);
  x.fillStyle = mute; x.font = '500 30px "JetBrains Mono", monospace'; x.fillText(new Date(r.date).toLocaleDateString().toUpperCase(), 60, 90);
  x.fillStyle = ink; x.font = '600 52px "Space Grotesk", sans-serif'; x.fillText(r.name.slice(0, 30), 60, 160);
  x.font = '700 150px "Space Grotesk", sans-serif'; x.fillText(r.pct + '%', 60, 320);
  x.font = '500 38px "JetBrains Mono", monospace'; x.fillStyle = mute; x.fillText(`${g.net}/${g.total} · ${fmt(r.used)}`, 60, 380);
  const tot = Math.max(1, g.total); let bx = 60; [[g.c, '#23825a'], [g.w, '#cc3a2b'], [g.s, '#b9b3a6']].forEach(([v, col]) => { const bw = (W - 120) * v / tot; x.fillStyle = col; x.fillRect(bx, 420, bw, 22); bx += bw; });
  x.font = '500 30px "JetBrains Mono", monospace';
  wr.forEach((it, k) => { x.fillStyle = it.st === 'w' ? '#cc3a2b' : mute; x.fillText(`${String(it.i + r.ST).padStart(2, '0')}  ${r.ans[it.i] != null ? L(r.ans[it.i]) : '–'}→${L(r.key[it.i])}`, 60 + (k % cols) * 250, 520 + Math.floor(k / cols) * 56); });
  c.toBlob(async b => {
    const f = new File([b], 'omr-result.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: r.name }); } catch { /* cancelled */ } }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'omr-result.png'; a.click(); }
  }, 'image/png');
}

/* ---------- backup ---------- */
function exportData() {
  const b = new Blob([JSON.stringify({ app: 'omr-practice', v: VERSION, tests: S.tests, hist: S.hist, cfg: S.cfg })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `omr-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}
function importData(inp) {
  const f = inp.files[0]; inp.value = ''; if (!f) return;
  f.text().then(txt => {
    const d = JSON.parse(txt); if (!Array.isArray(d.tests)) throw 0;
    const ti = new Set(S.tests.map(x => x.id)), hi = new Set(S.hist.map(x => x.id));
    S.tests = S.tests.concat(d.tests.filter(x => !ti.has(x.id)).map(t => ({ ...t, conf: t.conf || t.key.map(k => (k == null ? 0 : 100)) })));
    S.hist = S.hist.concat((d.hist || []).filter(x => !hi.has(x.id))).sort((a, b) => a.date - b.date);
    saveTests(); saveHist(); toast(T('imported')); render();
  }).catch(() => toast(T('badFile')));
}

/* ---------- actions ---------- */
const A = {
  back: () => goBack(),
  tab: b => nav(b.dataset.v, {}, 'tab'),
  newTest: () => { const t = newTestObj(); S.tests.unshift(t); saveTests(); nav('edit', { id: t.id }); },
  newScan: () => { const t = newTestObj(); S.tests.unshift(t); saveTests(); nav('edit', { id: t.id }); nav('scan', { id: t.id }); },
  edit: b => nav('edit', { id: b.dataset.id }),
  start: b => { if (route.name === 'edit') saveTests(); beginExam(findTest(b.dataset.id), null); },
  delTest: async b => { if (!(await ask(T('delTest'), { ok: T('del'), danger: true }))) return; S.tests = S.tests.filter(t => t.id !== b.dataset.id); S.hist = S.hist.filter(h => h.tid !== b.dataset.id); saveTests(); saveHist(); cleanup = null; stack = []; nav('tests', {}, 'tab'); },
  seg: b => {
    const k = b.dataset.k, v = b.dataset.v;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    if (route.name === 'edit') editField(findTest(route.id), k, v);
    else if (k === 'rf') { route.f = v; const r = S.hist.find(h => h.id === route.id); $('#rl').innerHTML = resList(r, grade(r), v); }
    else { S.cfg[k] = v; saveCfg(); applyCfg(); if (k === 'lang') render(); }
  },
  toggle: b => { const k = b.dataset.k; S.cfg[k] = S.cfg[k] ? 0 : 1; saveCfg(); b.classList.toggle('on', !!S.cfg[k]); b.setAttribute('aria-checked', !!S.cfg[k]); applyCfg(); },
  kb: b => {
    const t = findTest(route.id), i = +b.dataset.i, j = +b.dataset.j;
    t.key[i] = t.key[i] === j ? null : j; t.conf[i] = 100; saveTests(); buzz(8);
    const row = $('#k' + i); row.className = 'qr ' + keyCls(t, i); row.querySelectorAll('.bub').forEach((x, k) => x.classList.toggle('on', t.key[i] === k));
    $('#kc').textContent = `${t.key.filter(x => x != null).length}/${t.N}`;
  },
  clearKey: async () => { if (!(await ask(T('clearKeyQ'), { ok: T('clear'), danger: true }))) return; const t = findTest(route.id); t.key.fill(null); t.conf.fill(0); saveTests(); refreshKey(t); },
  goScan: () => nav('scan', { id: route.id }),
  scRot: b => SCN && SCN.src && scRot(+b.dataset.d),
  scAuto: () => SCN && SCN.src && scAuto(true),
  scFull: () => SCN && SCN.src && SCN.cropper.full(),
  scRepick: () => scShow('pick'),
  scGo: () => SCN && SCN.src && scGo(),
  ans: b => {
    if (!E) return; const i = +b.dataset.i, j = +b.dataset.j, now = Date.now();
    E.qt[i] += (now - E.last) / 1000; E.last = now; E.ans[i] = E.ans[i] === j ? null : j; buzz(8);
    $('#e' + i).querySelectorAll('.bub').forEach((x, k) => x.classList.toggle('on', E.ans[i] === k));
    $('#p' + i).className = palCls(i); updCount(); store.set('cur', E);
  },
  flag: b => { const i = +b.dataset.i; E.flag[i] ^= 1; b.classList.toggle('on', !!E.flag[i]); $('#p' + i).className = palCls(i); store.set('cur', E); },
  jump: b => { $('#e' + b.dataset.i).scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  pause: () => E && showPause(),
  resumeT: () => { startTick(); },
  submit: async () => { const left = E.qs.filter(i => E.ans[i] == null).length; if (await ask(T('submitQ') + (left ? ` (${left} ${T('unanswered')})` : ''), { ok: T('submit') })) submitExam(); },
  resume: () => { E = store.get('cur', null); if (!E) return render(); E.run = 0; E.resumed = 1; nav('exam'); },
  openRes: b => nav('result', { id: b.dataset.id }),
  hf: b => { route.f = b.dataset.v; render(); },
  rjump: b => { const r = S.hist.find(h => h.id === route.id); route.f = 'a'; $$('[data-k=rf]').forEach(x => x.classList.toggle('on', x.dataset.v === 'a')); $('#rl').innerHTML = resList(r, grade(r), 'a'); $('#r' + b.dataset.i)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  retake: b => {
    const r = S.hist.find(h => h.id === route.id); if (!r) return;
    const t = findTest(r.tid) || { id: r.tid, name: r.name, N: r.N, O: r.O, ST: r.ST, MIN: r.MIN, neg: r.neg, sec: r.sec, key: r.key, conf: [] };
    if (b.dataset.w !== '1') return beginExam(t, null, 'replace');
    const qs = grade(r).items.filter(x => x.st !== 'c').map(x => x.i);
    if (!qs.length) { ask(T('allRight')).then(ok => ok && beginExam(t, null, 'replace')); return; }
    beginExam(t, qs, 'replace');
  },
  shareRes: () => shareResult(),
  export: () => exportData(),
  wipe: async () => { if (!(await ask(T('wipeQ'), { ok: T('wipe'), danger: true }))) return; store.wipe(); S.tests = []; S.hist = []; render(); },
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && A[b.dataset.act]) { e.preventDefault(); A[b.dataset.act](b, e); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && E && E.run) store.set('cur', E); });

/* ---------- boot ---------- */
$('#back').innerHTML = I.back;
$('#tabs').innerHTML = [['home', I.home], ['tests', I.tests], ['history', I.chart], ['settings', I.gear]].map(([v, ic]) => `<button data-act="tab" data-v="${v}">${ic}<span></span></button>`).join('');
applyCfg();
history.replaceState({ d: 0 }, '');
render();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

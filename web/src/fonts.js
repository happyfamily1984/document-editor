// 글꼴: 앱에 든 글꼴 + 앱 안에서 받아 쓰는 글꼴(jsDelivr) 관리, 글꼴 고르기 창
import catalog from './font-catalog.json';
import { el, sheet, toast, confirmDialog } from './ui.js';

const CATS = ['전체', '고딕', '명조', '손글씨', '꾸밈', '코딩', '받은 글꼴'];
const DB = 'docedit-fonts';
const downloaded = new Map(); // id → {name, cat}

// ───────── 받은 글꼴 보관(IndexedDB) ─────────
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fonts', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('fonts', mode);
    const r = fn(t.objectStore('fonts'));
    t.oncomplete = () => resolve(r && r.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

function register(rec) {
  for (const [w, blob] of Object.entries(rec.files)) {
    const face = new FontFace(rec.name, `url(${URL.createObjectURL(blob)}) format('woff2')`, { weight: String(w), display: 'swap' });
    document.fonts.add(face);
    if (Object.keys(rec.files).length === 1) document.fonts.add(new FontFace(rec.name, `url(${URL.createObjectURL(blob)}) format('woff2')`, { weight: '700', display: 'swap' }));
  }
  downloaded.set(rec.id, { name: rec.name, cat: rec.cat });
}

/** 앱을 켤 때 받아 둔 글꼴을 등록한다(파일은 쓸 때 읽힌다) */
export async function initFonts() {
  try { for (const rec of (await tx('readonly', (s) => s.getAll())) || []) register(rec); } catch (e) { console.warn('글꼴 불러오기 실패', e); }
}

async function download(item, onProgress) {
  const files = {};
  const entries = Object.entries(item.files);
  let done = 0;
  for (const [w, url] of entries) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('글꼴을 받지 못했습니다. 인터넷 연결을 확인해 주세요.');
    files[w] = await res.blob();
    onProgress && onProgress(++done / entries.length);
  }
  const rec = { id: item.id, name: item.name, cat: item.cat, files };
  await tx('readwrite', (s) => s.put(rec));
  register(rec);
}

async function remove(id) {
  await tx('readwrite', (s) => s.delete(id));
  const name = downloaded.get(id)?.name;
  downloaded.delete(id);
  for (const f of [...document.fonts]) if (f.family.replace(/"/g, '') === name) document.fonts.delete(f);
}

// ───────── 글꼴 불러오기 ─────────
const quote = (n) => `"${String(n).replace(/"/g, '')}"`;
/** 글꼴 파일을 미리 읽어 둔다(글자 폭을 재기 전에 필요) */
export async function ensureFonts(names, sample = '가나다ABC123') {
  const list = [...new Set(names.filter(Boolean))];
  await Promise.all(list.flatMap((n) => [400, 700].map((w) => document.fonts.load(`${w} 16px ${quote(n)}`, sample).catch(() => {}))));
}
export const cssFamily = (name) => `${quote(name)}, "Noto Sans KR", sans-serif`;
export const fontCount = () => ({ bundled: catalog.bundled.length, downloadable: catalog.download.length, downloaded: downloaded.size });

// ───────── 글꼴 고르기 창 ─────────
const fmtSize = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + 'MB' : Math.max(1, Math.round(b / 1e3)) + 'KB');

/**
 * 글꼴을 고르는 창. 고른 글꼴 이름을 돌려준다(관리만 할 때는 manage: true → 고르기 없이 받기·지우기만).
 */
export function pickFont({ current = '', title = '글꼴', manage = false, sample = '가나다라 한글 글꼴 Abc 123' } = {}) {
  let cat = '전체', query = '';
  const listBox = el('div', { class: 'font-list' });
  const search = el('input', { type: 'search', class: 'font-search', placeholder: '글꼴 이름 찾기', autocomplete: 'off' });
  const chips = el('div', { class: 'font-cats' });
  return sheet(title, (done) => {
    const renderChips = () => chips.replaceChildren(...CATS.map((c) => el('button', { 'aria-pressed': String(c === cat), text: c, onclick: () => { cat = c; renderChips(); render(); } })));
    function row(item, kind) {
      const isDl = kind === 'dl';
      const have = !isDl || downloaded.has(item.id);
      const label = item.label || item.name;
      const name = el('strong', { text: label, style: have ? `font-family:${cssFamily(item.name)}` : '' });
      const sub = el('small', { text: have ? sample : `${item.cat} · ${fmtSize(item.size)} · 받아서 쓰는 글꼴`, style: have ? `font-family:${cssFamily(item.name)}` : '' });
      const side = [];
      if (isDl && !have) {
        const btn = el('button', { class: 'primary', text: '받기', onclick: async (e) => {
          e.stopPropagation();
          btn.disabled = true; btn.textContent = '받는 중…';
          try { await download(item, (p) => (btn.textContent = Math.round(p * 100) + '%')); toast(`"${label}" 글꼴을 받았습니다.`); render(); }
          catch (err) { btn.disabled = false; btn.textContent = '받기'; toast(err.message || '글꼴을 받지 못했습니다.'); }
        } });
        side.push(btn);
      } else if (isDl && manage) {
        side.push(el('button', { text: '지우기', onclick: async (e) => { e.stopPropagation(); if (await confirmDialog(`"${label}" 글꼴을 지울까요?`, '지우기', '취소')) { await remove(item.id); render(); } } }));
      }
      if (!manage && have && item.name === current) side.push(el('span', { class: 'done', text: '✓' }));
      return el('div', { class: 'font-row' + (have && !manage ? ' pickable' : ''), onclick: () => { if (have && !manage) done(item.name); } },
        el('span', { class: 'font-names' }, name, sub), ...side);
    }
    function render() {
      const q = query.trim().toLowerCase();
      const match = (it) => (!q || (it.label || it.name).toLowerCase().includes(q) || it.name.toLowerCase().includes(q));
      const rows = [];
      if (cat !== '받은 글꼴') rows.push(...catalog.bundled.filter((b) => (cat === '전체' || b.cat === cat) && match(b)).map((b) => row(b, 'bundled')));
      const dls = catalog.download.filter((d) => (cat === '전체' || cat === '받은 글꼴' ? (cat !== '받은 글꼴' || downloaded.has(d.id)) : d.cat === cat) && match(d));
      // 받은 글꼴을 먼저
      dls.sort((a, b) => (downloaded.has(b.id) ? 1 : 0) - (downloaded.has(a.id) ? 1 : 0));
      if (dls.length && cat !== '받은 글꼴') rows.push(el('p', { class: 'font-sep', text: '인터넷에서 받아 쓰는 글꼴 (한 번 받으면 인터넷 없이 씁니다)' }));
      rows.push(...dls.map((d) => row(d, 'dl')));
      if (!rows.length) rows.push(el('p', { class: 'empty', text: cat === '받은 글꼴' ? '아직 받은 글꼴이 없습니다.' : '찾는 글꼴이 없습니다.' }));
      listBox.replaceChildren(...rows);
    }
    search.oninput = () => { query = search.value; render(); };
    renderChips(); render();
    return el('div', { class: 'font-picker' },
      el('p', { class: 'hint', text: `앱에 든 글꼴 ${catalog.bundled.length}종 · 받아 쓰는 글꼴 ${catalog.download.length}종 (모두 무료 글꼴)` }),
      search, chips, listBox);
  }).then((v) => (typeof v === 'string' ? v : null));
}

/** 글자 크기 고르기(pt) */
export function pickSize(current) {
  const sizes = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 60, 72];
  return sheet('글자 크기', (done) => el('div', { class: 'size-grid' },
    sizes.map((s) => el('button', { class: s === current ? 'primary' : '', text: String(s), onclick: () => done(s) })))).then((v) => (typeof v === 'number' ? v : null));
}

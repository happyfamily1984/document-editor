import { $, el, toast, busy, dialog, confirmDialog, alertDialog, menu, sheet, promptText, closeTopOverlay } from './ui.js';
import * as native from './native.js';
import { putDraft, getDraft, deleteDraft, listDrafts } from './drafts.js';
import { initFonts, pickFont, fontCount } from './fonts.js';

// 앱에 든 글꼴 목록(CSS)과 받아 둔 글꼴을 등록한다
document.head.append(el('link', { rel: 'stylesheet', href: './fonts/fonts.css' }));
initFonts();
const manageFonts = () => pickFont({ manage: true, title: '글꼴 (받기·지우기)' });

const KINDS = {
  docx: 'docx', docm: 'docx', dotx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', xls: 'xlsx', csv: 'xlsx', tsv: 'xlsx',
  pptx: 'pptx', ppsx: 'pptx', pdf: 'pdf', hwp: 'hwp', hwpx: 'hwp', doc: 'doc', ppt: 'ppt', html: 'html', htm: 'html', xhtml: 'html',
};
const BADGE = { docx: 'W', doc: 'W', xlsx: 'X', pptx: 'P', ppt: 'P', pdf: 'PDF', hwp: '한', txt: 'T', html: '<>' };
const loaders = {
  docx: () => import('./formats/docx.js'), xlsx: () => import('./formats/xlsx.js'), pptx: () => import('./formats/pptx.js'),
  pdf: () => import('./formats/pdf.js'), hwp: () => import('./formats/hwp.js'), txt: () => import('./formats/text.js'), html: () => import('./formats/html.js'),
};
const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || [, ''])[1].toLowerCase();
const baseOf = (name) => (name || '문서').replace(/\.[a-z0-9]+$/i, '');

const state = { doc: null, name: '', uri: '', srcExt: '', dirty: false, editing: false, zoom: 1, confirmedOverwrite: false, tab: 'home', draftId: '' };

// ───────── 최근 문서 ─────────
const loadRecents = () => { try { return JSON.parse(localStorage.getItem('recents') || '[]'); } catch { return []; } };
const saveRecents = (list) => localStorage.setItem('recents', JSON.stringify(list.slice(0, 60)));
function touchRecent(name, uri, kind) {
  if (!uri) return;
  const list = loadRecents();
  const old = list.find((r) => r.uri === uri);
  saveRecents([{ name, uri, kind, time: Date.now(), star: !!(old && old.star) }, ...list.filter((r) => r.uri !== uri)]);
}
const when = (t) => new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
async function renderDrafts() {
  const list = await listDrafts();
  document.querySelectorAll('.draft-box').forEach((box) => {
    box.hidden = !list.length;
    box.querySelector('.draft-list').replaceChildren(...list.map((d) =>
      el('div', { class: 'recent draft' },
        el('button', { class: 'recent-main', onclick: () => openDraft(d.id) },
          el('b', { class: 'k k-' + (KINDS[extOf(d.name)] || 'txt'), text: BADGE[KINDS[extOf(d.name)] || 'txt'] || 'T' }),
          el('span', {}, el('strong', { text: d.name }), el('small', { text: '임시저장 · ' + when(d.time) }))),
        el('button', { class: 'icon', 'aria-label': '임시저장 지우기', text: '✕', onclick: async () => { if (await confirmDialog(`"${d.name}"의 임시저장본을 지울까요?\n고친 내용이 사라집니다.`, '지우기', '취소')) { await deleteDraft(d.id); renderDrafts(); } } }))));
  });
}
async function openDraft(id) {
  const d = await getDraft(id);
  if (!d) return renderDrafts();
  await openFile({ name: d.name, bytes: d.bytes, uri: d.uri }, { draft: d });
}
function toggleStar(uri) { const l = loadRecents(); const x = l.find((y) => y.uri === uri); if (x) x.star = !x.star; saveRecents(l); renderRecents(); }
function recentRow(r) {
  return el('div', { class: 'recent' },
    el('button', { class: 'recent-main', onclick: () => openRecent(r) },
      el('b', { class: 'k k-' + r.kind, text: BADGE[r.kind] || '?' }),
      el('span', {}, el('strong', { text: r.name }), el('small', { text: when(r.time) }))),
    el('button', { class: 'icon star', 'aria-label': '중요 표시', 'aria-pressed': String(!!r.star), text: r.star ? '★' : '☆', onclick: () => toggleStar(r.uri) }),
    el('button', { class: 'icon more', 'aria-label': '더 보기', text: '⋮', onclick: async () => {
      const pick = await menu(r.name, [{ label: '열기', value: 'open' }, { label: r.star ? '중요 표시 풀기' : '중요 문서로 표시', value: 'star' }, { label: '목록에서 빼기', value: 'remove', danger: true }]);
      if (pick === 'open') openRecent(r);
      else if (pick === 'star') toggleStar(r.uri);
      else if (pick === 'remove') { saveRecents(loadRecents().filter((y) => y.uri !== r.uri)); renderRecents(); }
    } }));
}
function fill(sel, list, emptyText) {
  $(sel).replaceChildren(...(list.length ? list.map(recentRow) : [el('p', { class: 'empty', text: emptyText })]));
}
function renderRecents() {
  renderDrafts();
  const all = loadRecents();
  const q = $('#recent-search').value.trim().toLowerCase();
  fill('#home-recent', all.slice(0, 5), '아직 연 문서가 없습니다. 파일을 열거나 새 문서를 만들어 보세요.');
  fill('#recent-list', q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all, q ? '찾는 문서가 없습니다.' : '아직 연 문서가 없습니다.');
  fill('#star-list', all.filter((r) => r.star), '별표(☆)를 누른 문서가 여기에 모입니다.');
}
async function openRecent(r) {
  try {
    const ref = await busy('여는 중…', () => native.openUri(r.uri));
    await openFile(ref);
  } catch (e) {
    if (await confirmDialog(`${e.message}\n목록에서 뺄까요?`)) { saveRecents(loadRecents().filter((y) => y.uri !== r.uri)); renderRecents(); }
  }
}

// ───────── 형식 판별 ─────────
async function detect(name, bytes) {
  const ext = extOf(name);
  const b = bytes;
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { kind: 'pdf', ext: 'pdf' };
  if (b.length > 4 && b[0] === 0x50 && b[1] === 0x4b) {
    const JSZip = (await import('jszip')).default;
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file('word/document.xml')) return { kind: 'docx', ext: 'docx' };
      if (zip.file('xl/workbook.xml')) return { kind: 'xlsx', ext: 'xlsx' };
      if (zip.file('ppt/presentation.xml')) return { kind: 'pptx', ext: 'pptx' };
      if (zip.file('Contents/content.hpf') || zip.file('Contents/header.xml')) return { kind: 'hwp', ext: 'hwpx' };
    } catch {}
    throw new Error('지원하지 않는 압축 문서입니다.');
  }
  if (b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    const { cfbKind } = await import('./formats/legacy.js');
    const k = cfbKind(bytes);
    if (k === 'encrypted') throw new Error('비밀번호가 걸린 오피스 문서는 열 수 없습니다.');
    if (k === 'hwp') return { kind: 'hwp', ext: 'hwp' };
    if (k === 'xls') return { kind: 'xlsx', ext: 'xls' };
    if (k) return { kind: k, ext: k };
    throw new Error('지원하지 않는 문서 형식입니다.');
  }
  if (KINDS[ext] === 'hwp') return { kind: 'hwp', ext }; // HWP 3.0 등
  if (ext === 'csv' || ext === 'tsv') return { kind: 'xlsx', ext };
  const isHtmlExt = ['html', 'htm', 'xhtml', 'shtml'].includes(ext);
  // 은행·관공서에서 내려받는 "엑셀" 파일은 속이 HTML 표나 XML인 경우가 많다
  const headText = new TextDecoder('latin1').decode(b.subarray(0, 3000)).toLowerCase();
  const sheetLike = /<table|<html|urn:schemas-microsoft-com:office:spreadsheet|<\?mso-application/.test(headText);
  if (sheetLike && (KINDS[ext] === 'xlsx' || (!isHtmlExt && /ms-excel|office:excel|office:spreadsheet|mso-application progid="excel/.test(headText)))) return { kind: 'xlsx', ext: 'xls' };
  // 웹 문서(HTML): 확장자가 html이거나, 확장자 없이 내용이 HTML로 시작할 때
  if (isHtmlExt || (!KINDS[ext] && !['txt', 'md', 'csv'].includes(ext) && /^\s*(\ufeff)?\s*(<!doctype html|<html)/i.test(new TextDecoder().decode(b.subarray(0, 600))))) return { kind: 'html', ext: 'html' };
  // 나머지는 글 파일로 본다. 글이 아닌 이진 파일이면 거절.
  const head = b.subarray(0, 4096);
  if (!(b[0] === 0xff && b[1] === 0xfe) && !(b[0] === 0xfe && b[1] === 0xff) && head.some((x) => x === 0)) throw new Error('지원하지 않는 파일 형식입니다.');
  return { kind: 'txt', ext: ext || 'txt' };
}

// ───────── 문서 열기·닫기 ─────────
async function openFile(ref, opts = {}) {
  if (state.doc && !(await closeDoc())) return;
  if (!opts.draft && ref.uri) {
    // 같은 파일의 임시저장본이 있으면 이어서 편집할지 묻는다
    const d = await getDraft(ref.uri);
    if (d) {
      const a = await dialog('이 문서를 고치다 만 임시저장본이 있습니다.', [{ label: '원본 열기(임시저장 삭제)', value: 'orig' }, { label: '이어서 편집', value: 'draft', kind: 'primary' }]);
      if (a === 'draft') return openFile({ name: d.name, bytes: d.bytes, uri: d.uri }, { draft: d, external: opts.external });
      if (a !== 'orig') return;
      await deleteDraft(d.id);
    }
  }
  try {
    await busy('문서를 여는 중…', async () => {
      let { name, bytes, uri } = ref;
      let kind, ext, notice = '', mustSaveAs = false;
      if (opts.kind) ({ kind, ext } = opts);
      else ({ kind, ext } = await detect(name, bytes));
      if (kind === 'doc' || kind === 'ppt') {
        const legacy = await import('./formats/legacy.js');
        const { buildDocx } = await import('./formats/docx.js');
        const lines = kind === 'doc' ? legacy.docText(bytes) : legacy.pptText(bytes);
        bytes = await buildDocx(lines.length ? lines : ['']);
        notice = `옛 형식(${kind.toUpperCase()})이라 글만 가져왔습니다. 저장하면 DOCX 새 파일로 만들어집니다.`;
        kind = 'docx'; ext = 'docx'; mustSaveAs = true;
      }
      const old = $('#doc-body');
      const body = el('div', { id: 'doc-body' });
      old.replaceWith(body);
      const extra = $('#doc-extra');
      extra.replaceChildren(); extra.hidden = true;
      $('#home').hidden = true; $('#doc').hidden = false; // 크기를 재야 하는 형식이 있어 먼저 보이게 한다
      const mod = await loaders[kind]();
      const doc = await mod.open({ bytes, name, ext, body, extra, scroll: $('#doc-scroll'), ctx: { changed: markDirty, refreshTools: renderTools } });
      const dr = opts.draft;
      state.external = !!opts.external;
      Object.assign(state, { doc, name, uri: uri || '', srcExt: dr ? dr.srcExt : extOf(name), dirty: !!dr, editing: false, confirmedOverwrite: false, zoom: 1, draftId: dr ? dr.id : uri || 'new:' + Date.now() });
      if (mustSaveAs || (dr && dr.mustSaveAs)) doc.mustSaveAs = true;
      if (dr) { notice = '임시저장된 내용을 불러왔습니다. 아직 파일에는 저장되지 않았습니다.'; localStorage.setItem('activeDraft', dr.id); }
      $('#doc-title').textContent = name;
      const n = $('#doc-notice');
      n.textContent = notice || doc.notice || ''; n.hidden = !n.textContent;
      $('#doc-scroll').scrollTop = 0;
      fitZoom();
      touchRecent(name, uri, doc.kind);
      refreshTop(); renderTools();
      if ((opts.startEditing || opts.draft) && doc.canEdit) setEditing(true);
    });
  } catch (e) {
    console.error(e);
    showHome();
    alertDialog(e.message || String(e), '문서를 열지 못했습니다');
  }
}

function showHome() {
  if (state.doc) { try { state.doc.destroy(); } catch {} }
  state.doc = null; state.editing = false; state.dirty = false; state.external = false;
  clearTimeout(draftTimer);
  localStorage.removeItem('activeDraft');
  closeFind();
  $('#doc').hidden = true; $('#home').hidden = false;
  $('#doc-body').replaceChildren();
  renderRecents();
}

/** 문서 닫기. 고친 내용이 있으면 먼저 묻는다. 닫혔으면 true */
async function closeDoc() {
  if (state.dirty) {
    const a = await dialog('파일에 저장하지 않은 변경이 있습니다.\n임시저장해 두면 홈 화면에서 이어서 편집할 수 있습니다.', [{ label: '버리기', value: 'discard', kind: 'danger' }, { label: '임시저장', value: 'draft' }, { label: '저장', value: 'save', kind: 'primary' }]);
    if (a === 'save') { if (!(await saveDoc())) return false; }
    else if (a === 'draft') { if (!(await flushDraft())) { alertDialog('임시저장하지 못했습니다. 파일로 저장해 주세요.'); return false; } toast('임시저장했습니다. 홈 화면에서 이어서 편집할 수 있습니다.'); }
    else if (a === 'discard') { await draftChain; await deleteDraft(state.draftId); }
    else return false;
  }
  showHome();
  return true;
}

// ───────── 편집·저장 ─────────
function markDirty() {
  if (!state.dirty) { state.dirty = true; refreshTop(); }
  // 고칠 때마다 잠시 뒤 자동으로 임시저장한다
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 1200);
}

// ───────── 임시저장 ─────────
let draftTimer = 0, draftChain = Promise.resolve(true);
/** 지금 내용을 임시저장한다. 앞선 저장이 끝난 뒤 차례로 실행된다. */
function flushDraft() {
  clearTimeout(draftTimer);
  const doc = state.doc;
  draftChain = draftChain.then(async () => {
    if (!doc || state.doc !== doc) return true;
    try {
      const bytes = await doc.save(); // 입력 중이던 칸 등도 이때 반영된다
      if (!state.dirty || state.doc !== doc) return true;
      await putDraft({ id: state.draftId, name: state.name, uri: state.uri, srcExt: state.srcExt, mustSaveAs: !!doc.mustSaveAs, time: Date.now(), bytes: new Uint8Array(bytes) });
      localStorage.setItem('activeDraft', state.draftId);
      return true;
    } catch (e) { console.warn('임시저장 실패', e); return false; }
  });
  return draftChain;
}
window.__flushDraft = () => { if (state.doc && (state.dirty || state.editing)) flushDraft(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) window.__flushDraft(); });
window.addEventListener('pagehide', () => window.__flushDraft());
function refreshTop() {
  const d = state.doc;
  $('#doc-edit').hidden = !d || !d.canEdit;
  $('#doc-edit').textContent = state.editing ? '완료' : '편집';
  $('#doc-save').hidden = !state.dirty;
  $('#doc').classList.toggle('is-editing', state.editing);
}
function setEditing(on) {
  if (!state.doc || !state.doc.canEdit) return;
  state.editing = on;
  if (on) closeFind();
  state.doc.setEditing(on);
  refreshTop(); renderTools();
  if (on && state.doc.editHint) toast(state.doc.editHint);
}

async function produce() { return busy('저장할 파일을 만드는 중…', () => state.doc.save()); }

async function saveDoc(forceAs) {
  const d = state.doc;
  if (!d) return false;
  try {
    const bytes = await produce();
    const sameType = state.uri && !d.mustSaveAs && state.srcExt === d.ext;
    if (!forceAs && sameType) {
      if (!state.confirmedOverwrite) {
        if (!(await confirmDialog('원본 파일에 덮어씁니다. 계속할까요?\n(원본을 남기려면 메뉴의 "다른 이름으로 저장"을 쓰세요.)', '덮어쓰기', '취소'))) return false;
        state.confirmedOverwrite = true;
      }
      if (native.saveOverwrite(state.uri, bytes)) { await savedCleanup(); refreshTop(); toast('저장했습니다.'); return true; }
      toast('원본에 쓸 수 없어 새 파일로 저장합니다.');
    }
    const res = await native.saveAs(`${baseOf(state.name)}.${d.ext}`, d.mime, bytes);
    if (!res) return false;
    await savedCleanup();
    if (res.uri) {
      state.draftId = res.uri;
      state.uri = res.uri; state.name = res.name || state.name; state.srcExt = d.ext; state.confirmedOverwrite = true; d.mustSaveAs = false;
      $('#doc-title').textContent = state.name;
      touchRecent(state.name, state.uri, d.kind);
    }
    refreshTop(); toast('저장했습니다.');
    return true;
  } catch (e) {
    console.error(e);
    alertDialog(e.message || String(e), '저장하지 못했습니다');
    return false;
  }
}

/** 파일로 저장한 뒤: 임시저장본은 더 필요 없다 */
async function savedCleanup() {
  clearTimeout(draftTimer);
  state.dirty = false;
  await draftChain;
  await deleteDraft(state.draftId);
  localStorage.removeItem('activeDraft');
}

async function docMenu() {
  const d = state.doc;
  const starred = loadRecents().find((r) => r.uri === state.uri)?.star;
  const pick = await menu(state.name, [
    { label: '저장', value: 'save', disabled: !state.dirty },
    { label: '다른 이름으로 저장', value: 'saveas' },
    { label: '공유', value: 'share', disabled: !native.isNative },
    { label: d.kind === 'pdf' ? '인쇄' : '인쇄 · PDF로 내보내기', value: 'print' },
    state.uri ? { label: starred ? '중요 표시 풀기' : '중요 문서로 표시', value: 'star' } : null,
    { label: '문서 정보', value: 'info' },
  ].filter(Boolean));
  if (pick === 'save') saveDoc();
  else if (pick === 'saveas') saveDoc(true);
  else if (pick === 'share') native.share(`${baseOf(state.name)}.${d.ext}`, d.mime, await produce());
  else if (pick === 'print') {
    if (state.editing) setEditing(false);
    await busy('인쇄를 준비하는 중…', async () => { if (d.beforePrint) await d.beforePrint(); });
    native.print(baseOf(state.name));
  } else if (pick === 'star') { const l = loadRecents(); const x = l.find((y) => y.uri === state.uri); if (x) x.star = !x.star; saveRecents(l); toast(x && x.star ? '중요 문서로 표시했습니다.' : '중요 표시를 풀었습니다.'); }
  else if (pick === 'info') {
    const rows = [['이름', state.name], ['형식', d.ext.toUpperCase()], ...(d.info ? d.info() : [])];
    sheet('문서 정보', () => el('dl', { class: 'info' }, rows.map(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])));
  }
}

// ───────── 도구 막대·확대 ─────────
function renderTools() {
  const d = state.doc;
  if (!d) return;
  const base = [
    d.noFind ? null : { label: '찾기', icon: '⌕', run: openFind },
    { label: '확대', icon: '＋', run: () => setZoom(state.zoom * 1.25) },
    { label: '축소', icon: '－', run: () => setZoom(state.zoom / 1.25) },
    d.noFit ? null : { label: '폭 맞춤', icon: '↔', run: fitZoom },
  ].filter(Boolean);
  const extra = (d.tools ? d.tools() : []).filter((t) => !t.editOnly || state.editing);
  const list = state.editing && extra.length ? [...extra, ...base.slice(d.noFind ? 0 : 1, 3)] : [...base, ...extra];
  $('#doc-tools').replaceChildren(...list.map((t) =>
    el('button', { class: 'tool' + (t.active ? ' active' : ''), onmousedown: (e) => e.preventDefault(), onclick: () => t.run() }, el('i', { text: t.icon }), t.label)));
}
function setZoom(z) {
  state.zoom = Math.min(5, Math.max(0.2, z));
  $('#doc-body').style.zoom = state.zoom;
  state.doc && state.doc.onZoom && state.doc.onZoom(state.zoom);
}
function fitZoom() {
  const body = $('#doc-body'), scroll = $('#doc-scroll');
  body.style.zoom = 1;
  const w = body.scrollWidth, avail = scroll.clientWidth;
  setZoom(state.doc && state.doc.noFit ? 1 : w > avail ? avail / w : 1);
}
// 두 손가락으로 벌려 확대·축소
(() => {
  const scroll = $('#doc-scroll');
  let startDist = 0, startZoom = 1, raf = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { startDist = dist(e.touches); startZoom = state.zoom; } }, { passive: true });
  scroll.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !startDist) return;
    e.preventDefault();
    const z = startZoom * (dist(e.touches) / startDist);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => setZoom(z));
  }, { passive: false });
  scroll.addEventListener('touchend', () => { startDist = 0; });
})();

// ───────── 찾기 ─────────
const find = { ranges: [], index: 0 };
function openFind() { $('#find-bar').hidden = false; $('#find-input').focus(); runFind(); }
function closeFind() {
  $('#find-bar').hidden = true;
  if (window.CSS && CSS.highlights) { CSS.highlights.delete('find'); CSS.highlights.delete('find-cur'); }
  find.ranges = [];
}
function runFind() {
  const q = $('#find-input').value.toLowerCase();
  find.ranges = []; find.index = 0;
  if (!(window.CSS && CSS.highlights)) { $('#find-count').textContent = '지원 안 됨'; return; }
  if (q) {
    const walker = document.createTreeWalker($('#doc-body'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && find.ranges.length < 2000; n = walker.nextNode()) {
      const text = n.data.toLowerCase();
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); find.ranges.push(r); }
    }
  }
  CSS.highlights.set('find', new Highlight(...find.ranges));
  showFind();
}
function showFind(step = 0) {
  const n = find.ranges.length;
  if (n) find.index = (find.index + step + n) % n;
  $('#find-count').textContent = n ? `${find.index + 1}/${n}` : $('#find-input').value ? '없음' : '';
  if (!n) return CSS.highlights.delete('find-cur');
  const r = find.ranges[find.index];
  CSS.highlights.set('find-cur', new Highlight(r));
  const rect = r.getBoundingClientRect(), scroll = $('#doc-scroll'), box = scroll.getBoundingClientRect();
  scroll.scrollBy({ top: rect.top - box.top - box.height / 3, left: rect.left - box.left - box.width / 3 });
}

// ───────── 뒤로가기 ─────────
// 열린 창 → 문서별 진행 중 동작 → 찾기 → 편집 → 문서 닫기 → (홈) 탭 → 종료 확인 순으로 되돌린다.
async function onBack() {
  if (closeTopOverlay()) return;
  if (!$('#busy').hidden) return;
  if (state.doc) {
    if (state.doc.back && state.doc.back()) return;
    if (!$('#find-bar').hidden) return closeFind();
    if (state.editing) return setEditing(false);
    // 다른 앱에서 넘겨받아 연 문서는 닫으면 그 앱 화면으로 돌아간다
    const external = state.external;
    if ((await closeDoc()) && external) native.leaveApp();
    return;
  }
  if (state.tab !== 'home') return setTab('home');
  if (await confirmDialog('앱을 종료하겠습니까?')) native.exitApp();
}
window.__onBack = onBack;

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.pane').forEach((p) => (p.hidden = p.dataset.pane !== tab));
  document.querySelectorAll('#tabbar button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  renderRecents();
}

// ───────── 새 문서 ─────────
async function newDoc(kind) {
  const stamp = new Date().toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }).replace(/[.\s]+/g, '').trim();
  const name = `새 문서 ${stamp}`;
  if (kind === 'docx') { const { buildDocx } = await import('./formats/docx.js'); return openFile({ name: name + '.docx', bytes: await buildDocx(['']) }, { kind: 'docx', ext: 'docx', startEditing: true }); }
  if (kind === 'pptx') { const { blankPptx } = await busy('새 슬라이드를 만드는 중…', () => import('./formats/pptx.js')); return openFile({ name: name + '.pptx', bytes: await blankPptx() }, { kind: 'pptx', ext: 'pptx', startEditing: true }); }
  if (kind === 'xlsx') return openFile({ name: name + '.xlsx', bytes: null }, { kind: 'xlsx', ext: 'xlsx', startEditing: true });
  if (kind === 'hwp') return openFile({ name: name + '.hwp', bytes: null }, { kind: 'hwp', ext: 'hwp', startEditing: true });
  return openFile({ name: name + '.txt', bytes: null }, { kind: 'txt', ext: 'txt', startEditing: true });
}

function about() {
  sheet('안내', () => el('div', { class: 'about' },
    el('p', { text: '한글(HWP·HWPX), 워드(DOCX·DOC), 엑셀(XLSX·XLS·CSV), 파워포인트(PPTX·PPT), PDF, 웹 문서(HTML), 글 파일을 열고 고칠 수 있습니다.' }),
    el('p', { text: '파일은 이 기기 안에서만 열고 고치며, 어디에도 올리지 않습니다. 인터넷 연결 없이도 동작합니다. (글꼴을 받을 때만 인터넷에서 글꼴 파일을 내려받으며, 이때 문서 내용은 보내지 않습니다.)' }),
    el('p', { text: '이 앱은 있는 그대로 제공되며, 파일 손상·손실에 대해 책임지지 않습니다. 중요한 문서는 원본을 따로 보관해 주세요.' }),
    el('p', { text: '한글·HWP는 한글과컴퓨터의, Word·Excel·PowerPoint는 Microsoft의 상표입니다. 이 앱은 두 회사와 관계없는 독립 앱입니다.' }),
    el('h4', { text: '오픈소스' }),
    el('p', { class: 'small', text: 'rhwp (MIT) · docx-preview (Apache-2.0) · pptx-renderer (Apache-2.0) · PDF.js (Apache-2.0) · pdf-lib (MIT) · SheetJS (Apache-2.0) · JSZip (MIT) · PptxGenJS (MIT) · cfb (Apache-2.0)' }),
    el('p', { class: 'small', text: '글꼴: 네이버 나눔글꼴·마루부리, 배달의민족 글꼴, 학교안심 글꼴, Noto Sans/Serif KR, Pretendard, SUIT, Wanted Sans, LINE Seed, 리디바탕, KCC-한빛, D2Coding, 구글 한글 글꼴 등 — 모두 SIL Open Font License 1.1' }),
    el('p', { class: 'small', text: '문서 편집기 1.6' })));
}

// ───────── 기본 앱 설정 ─────────
const DEFAULT_NAMES = { hwp: '한글 (HWP)', hwpx: '한글 (HWPX)', docx: '워드 (DOCX)', doc: '워드 (DOC)', xlsx: '엑셀 (XLSX)', xls: '엑셀 (XLS)', pptx: '파워포인트 (PPTX)', ppt: '파워포인트 (PPT)', pdf: 'PDF', txt: '글 파일 (TXT)', html: '웹 문서 (HTML)' };
let defaultsOpen = false;
function defaultsSheet() {
  if (!native.isNative) return;
  if (defaultsOpen) return void (window.__native.onDefaultsChanged && window.__native.onDefaultsChanged());
  defaultsOpen = true;
  localStorage.setItem('defaultsAsked', '1');
  const list = el('div', { class: 'defaults' });
  const render = () => {
    list.replaceChildren(...native.defaultStatus().map((d) =>
      el('div', { class: 'default-row' },
        el('b', { class: 'k k-' + (KINDS[d.ext] || 'txt'), text: BADGE[KINDS[d.ext] || 'txt'] }),
        el('span', {}, el('strong', { text: DEFAULT_NAMES[d.ext] || d.ext }),
          el('small', { class: d.state === 'mine' ? 'ok' : '', text: d.state === 'mine' ? '이 앱이 기본 앱입니다' : d.state === 'other' ? `지금 기본 앱: ${d.label}` : '기본 앱이 정해지지 않았습니다' })),
        d.state === 'mine' ? el('span', { class: 'done', text: '✓' })
          : d.state === 'other' ? el('button', { text: '풀기', onclick: async () => {
            if (await confirmDialog(`"${d.label}" 앱 정보 화면을 엽니다.\n거기서 "기본으로 설정" → "기본 설정 지우기"를 누른 뒤 돌아와서 [설정]을 눌러 주세요.`, '열기', '취소')) native.openAppSettings(d.pkg);
          } })
          : el('button', { class: 'primary', text: '설정', onclick: () => native.chooseDefault(d.ext) }))));
  };
  render();
  native.onDefaultsChanged(render);
  sheet('기본 앱으로 설정', () => el('div', {},
    el('p', { class: 'hint', text: '[설정]을 누르면 휴대폰의 "연결 프로그램" 창이 뜹니다. 거기서 "문서 편집기"를 고르고 "항상"을 누르면, 그 형식의 파일을 누를 때 이 앱으로 바로 열립니다.' }),
    list,
    el('p', { class: 'hint', text: '나중에 홈 화면의 [기본 앱]에서 다시 설정할 수 있습니다.' }),
  )).then(() => { defaultsOpen = false; native.onDefaultsChanged(null); });
}

// ───────── 연결 ─────────
const pickAndOpen = async () => { try { const ref = await native.pickFile(); if (ref) await openFile(ref); } catch (e) { alertDialog(e.message || String(e), '파일을 읽지 못했습니다'); } };
$('#open-btn').onclick = pickAndOpen;
$('#open-btn2').onclick = pickAndOpen;
document.querySelectorAll('[data-new]').forEach((b) => (b.onclick = () => newDoc(b.dataset.new)));
document.querySelectorAll('#tabbar button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$('#all-recent').onclick = () => setTab('recent');
$('#search-btn').onclick = () => { setTab('recent'); $('#recent-search').focus(); };
$('#settings-btn').onclick = () => setTab('settings');
$('#recent-search').oninput = renderRecents;
$('#menu-btn').onclick = async () => {
  const pick = await menu('문서 편집기', [{ label: '파일 열기', value: 'open' }, { label: '최근 문서', value: 'recent' }, { label: '내 문서', value: 'mine' }, { label: '글꼴', value: 'fonts' }, native.isNative ? { label: '기본 앱으로 설정', value: 'defaults' } : null, { label: '안내', value: 'about' }].filter(Boolean));
  if (pick === 'open') pickAndOpen(); else if (pick === 'fonts') manageFonts(); else if (pick === 'defaults') defaultsSheet(); else if (pick === 'about') about(); else if (pick) setTab(pick);
};
$('#about-btn').onclick = about;
$('#fonts-btn').onclick = manageFonts;
{ const c = fontCount(); $('#fonts-btn small').textContent = `앱에 든 글꼴 ${c.bundled}종 · 받아 쓰는 글꼴 ${c.downloadable}종`; }
$('#defaults-btn').hidden = !native.isNative;
$('#defaults-btn').onclick = defaultsSheet;
// 기본 앱 고르기 창에서 이 앱을 골라 돌아오면 설정 창을 다시 보여 준다
window.__native.onShowDefaults = () => { if (!state.doc) defaultsSheet(); };
$('#doc-back').onclick = onBack;
$('#doc-edit').onclick = () => setEditing(!state.editing);
$('#doc-save').onclick = () => saveDoc();
$('#doc-menu').onclick = docMenu;
$('#find-input').oninput = runFind;
$('#find-input').onkeydown = (e) => { if (e.key === 'Enter') showFind(1); };
$('#find-next').onclick = () => showFind(1);
$('#find-prev').onclick = () => showFind(-1);
$('#find-close').onclick = closeFind;
renderRecents();
// 편집 도중 앱이 꺼졌다면 임시저장본을 바로 다시 연다
(async () => {
  const id = localStorage.getItem('activeDraft');
  if (id && (await getDraft(id))) await openDraft(id);
  else localStorage.removeItem('activeDraft');
})();
// 처음 실행할 때 기본 앱 설정을 안내한다
if (native.isNative && !localStorage.getItem('defaultsAsked')) setTimeout(() => { if (!state.doc) defaultsSheet(); }, 600);
native.onIncoming((ref, err) => { if (ref) openFile(ref, { external: true }); else alertDialog((err && err.message) || '파일을 읽지 못했습니다.', '문서를 열지 못했습니다'); });

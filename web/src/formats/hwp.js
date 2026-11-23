// 한글(HWP·HWPX): rhwp(WebAssembly)로 쪽을 그리고, 누른 문단의 글을 고친다.
import init, { HwpDocument } from '@rhwp/core';
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url';
import { el, toast, promptText } from '../ui.js';
import { pickFont, pickSize, ensureFonts } from '../fonts.js';

let ready = null;
function ensureInit() {
  if (!ready) {
    let ctx = null, last = '';
    globalThis.measureTextWidth = (font, text) => {
      if (!ctx) ctx = document.createElement('canvas').getContext('2d');
      if (font !== last) { ctx.font = font; last = font; }
      return ctx.measureText(text).width;
    };
    ready = init({ module_or_path: wasmUrl });
  }
  return ready;
}

const ok = (json) => { const r = JSON.parse(json); if (r && r.ok === false) throw new Error(r.error || '편집 실패'); return r; };

export async function open({ bytes, ext, body, scroll, ctx }) {
  await ensureInit();
  let doc;
  if (!bytes) { doc = HwpDocument.createEmpty(); doc.createBlankDocument(); }
  else {
    try { doc = new HwpDocument(bytes); }
    catch (e) {
      if (!/암호|password|encrypt/i.test(String(e))) throw new Error('한글 문서를 열지 못했습니다. (' + String(e).slice(0, 120) + ')');
      const pw = await promptText('비밀번호가 걸린 문서', '', { placeholder: '비밀번호' });
      if (pw == null) throw new Error('비밀번호를 넣지 않아 열지 않았습니다.');
      try { doc = HwpDocument.openWithPassword(bytes, pw); } catch { throw new Error('비밀번호가 맞지 않습니다.'); }
    }
  }
  let editing = false, observer = null, pageDivs = [];

  function layout() {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && !e.target.dataset.done) {
        e.target.dataset.done = '1';
        try { e.target.innerHTML = doc.renderPageSvg(Number(e.target.dataset.i)); } catch (err) { e.target.textContent = '이 쪽을 그리지 못했습니다.'; }
      }
    }, { root: scroll, rootMargin: '800px 0px' });
    const n = doc.pageCount();
    pageDivs = [];
    for (let i = 0; i < n; i++) {
      const info = JSON.parse(doc.getPageInfo(i));
      const div = el('div', { class: 'hwp-page', 'data-i': i, style: `width:${info.width}px;height:${info.height}px` });
      pageDivs.push(div);
    }
    body.replaceChildren(...pageDivs);
    pageDivs.forEach((d) => observer.observe(d));
  }
  // 글자 폭을 재기 전에 문서에 쓰인 글꼴을 미리 읽어 둔다(그래야 줄바꿈이 맞는다)
  try { await ensureFonts(JSON.parse(doc.getDocumentInfo()).fontsUsed || []); } catch {}
  layout();

  // 문단 위치(본문 또는 표 칸 안)에 따라 알맞은 API를 부른다
  function accessor(hit) {
    const s = hit.sectionIndex;
    if (hit.cellPath) {
      const path = hit.cellPath.map((x) => ({ ...x })), parent = hit.parentParaIndex;
      const pj = () => JSON.stringify(path);
      const first = path[path.length - 1].cellParaIndex;
      return {
        props: () => JSON.parse(doc.getCellCharPropertiesAtByPath(s, parent, pj(), 0)),
        // 고친 문단(줄을 나눴으면 나뉜 문단까지)에 글자 서식을 건다
        format: (props) => {
          const last = path[path.length - 1].cellParaIndex;
          for (let i = first; i <= last; i++) {
            const pp = path.map((x) => ({ ...x })); pp[pp.length - 1].cellParaIndex = i;
            const len = doc.getCellParagraphLengthByPath(s, parent, JSON.stringify(pp));
            if (len) ok(doc.applyCharFormatInCellByPath(s, parent, JSON.stringify(pp), 0, len, JSON.stringify(props)));
          }
        },
        text: () => doc.getTextInCellByPath(s, parent, pj(), 0, doc.getCellParagraphLengthByPath(s, parent, pj())),
        del: (off, n) => ok(doc.deleteTextInCellByPath(s, parent, pj(), off, n)),
        ins: (off, t) => ok(doc.insertTextInCellByPath(s, parent, pj(), off, t)),
        split: (off) => { ok(doc.splitParagraphInCellByPath(s, parent, pj(), off)); path[path.length - 1].cellParaIndex++; },
      };
    }
    let para = hit.paragraphIndex;
    const first = para;
    return {
      props: () => JSON.parse(doc.getCharPropertiesAt(s, para, 0)),
      format: (props) => {
        for (let i = first; i <= para; i++) {
          const len = doc.getParagraphLength(s, i);
          if (len) ok(doc.applyCharFormat(s, i, 0, len, JSON.stringify(props)));
        }
      },
      text: () => doc.getTextRange(s, para, 0, doc.getParagraphLength(s, para)),
      del: (off, n) => ok(doc.deleteText(s, para, off, n)),
      ins: (off, t) => ok(doc.insertText(s, para, off, t)),
      split: (off) => { para = ok(doc.splitParagraph(s, para, off)).paraIdx; },
    };
  }

  async function editAt(div, x, y) {
    let hit;
    try { hit = JSON.parse(doc.hitTest(Number(div.dataset.i), x, y)); } catch { return toast('이 자리는 고칠 수 없습니다.'); }
    if (hit.sectionIndex == null) return toast('이 자리는 고칠 수 없습니다.');
    const acc = accessor(hit);
    let old;
    try { old = acc.text(); } catch { return toast('이 자리는 고칠 수 없습니다.'); }
    let cur = {};
    try { cur = acc.props(); } catch {}
    let font = null, size = null; // 새로 고른 글꼴·크기
    const next = await promptText(hit.cellPath ? '표 칸 글 고치기' : '문단 고치기', old, {
      multiline: true, okLabel: '적용',
      extra: () => {
        const fBtn = el('button', { class: 'chip', text: '글꼴: ' + (cur.fontFamily || '기본'), onclick: async () => {
          const v = await pickFont({ current: font || cur.fontFamily });
          if (v) { font = v; fBtn.textContent = '글꼴: ' + v; fBtn.classList.add('on'); }
        } });
        const curPt = cur.fontSize ? cur.fontSize / 100 : 10;
        const sBtn = el('button', { class: 'chip', text: '크기: ' + curPt, onclick: async () => {
          const v = await pickSize(size || curPt);
          if (v) { size = v; sBtn.textContent = '크기: ' + v; sBtn.classList.add('on'); }
        } });
        return el('div', { class: 'chip-row' }, fBtn, sBtn, el('small', { class: 'hint', text: '이 문단 전체에 적용됩니다' }));
      },
    });
    if (next == null || (next === old && !font && !size)) return;
    if (font) await ensureFonts([font], next);
    try {
      // 바뀐 부분만 지우고 넣는다(문단 안의 표·그림 같은 개체를 건드리지 않도록)
      let pre = 0; const max = Math.min(old.length, next.length);
      while (pre < max && old[pre] === next[pre]) pre++;
      let suf = 0;
      while (suf < max - pre && old[old.length - 1 - suf] === next[next.length - 1 - suf]) suf++;
      if (old.length - suf - pre > 0) acc.del(pre, old.length - suf - pre);
      const lines = next.slice(pre, next.length - suf).split('\n');
      let off = pre;
      lines.forEach((line, i) => {
        if (i > 0) { acc.split(off); off = 0; }
        if (line) { acc.ins(off, line); off += line.length; }
      });
      const props = {};
      if (font) props.fontName = font;
      if (size) props.fontSize = Math.round(size * 100);
      if (font || size) acc.format(props);
      ctx.changed();
    } catch (e) { toast('고치지 못했습니다: ' + String(e.message || e).slice(0, 100)); }
    const top = scroll.scrollTop;
    layout();
    scroll.scrollTop = top;
  }

  body.addEventListener('click', (e) => {
    if (!editing) return;
    const div = e.target.closest('.hwp-page');
    if (!div) return;
    const r = div.getBoundingClientRect();
    editAt(div, ((e.clientX - r.left) / r.width) * parseFloat(div.style.width), ((e.clientY - r.top) / r.height) * parseFloat(div.style.height));
  });

  const hwpx = ext === 'hwpx';
  return {
    kind: 'hwp', ext: hwpx ? 'hwpx' : 'hwp', mime: hwpx ? 'application/vnd.hancom.hwpx' : 'application/x-hwp',
    canEdit: true, noFind: true,
    editHint: '고칠 문단이나 표 칸을 누르세요.',
    setEditing(on) { editing = on; body.classList.toggle('editing', on); },
    tools: () => [],
    save: async () => (hwpx ? doc.exportHwpx() : doc.exportHwp()),
    beforePrint() { for (const d of pageDivs) if (!d.dataset.done) { d.dataset.done = '1'; d.innerHTML = doc.renderPageSvg(Number(d.dataset.i)); } },
    info: () => [['쪽 수', String(doc.pageCount())]],
    destroy() { observer?.disconnect(); try { doc.free(); } catch {} },
  };
}

// 파워포인트: 화면은 pptx-renderer로 그리고, 글 수정·슬라이드 복제·삭제는 원본 XML을 고쳐서 한다.
import JSZip from 'jszip';
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer';
import PptxGenJS from 'pptxgenjs';
import { A, paraText, setParaText, serializeXml, parseXml } from './ooxml-text.js';
import { el, sheet, toast, busy, confirmDialog } from '../ui.js';
import { pickFont, pickSize, ensureFonts } from '../fonts.js';

const ANS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PNS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_SLIDE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide';

// a:rPr 안 자식 순서: ln, 채우기, 효과, highlight, 밑줄…, latin, ea, cs, sym, hlinkClick…
const AFTER_FONT = ['cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'];
/** 글상자(문단들)의 모든 글자 서식에 글꼴·크기를 건다 */
function styleBlock(ps, font, size) {
  for (const p of ps) {
    for (const r of [...p.children].filter((c) => c.localName === 'r' || c.localName === 'fld')) {
      if (![...r.children].some((c) => c.localName === 'rPr')) r.prepend(r.ownerDocument.createElementNS(ANS, 'a:rPr'));
    }
    const rprs = [...p.getElementsByTagNameNS(ANS, 'rPr'), ...p.getElementsByTagNameNS(ANS, 'endParaRPr')];
    for (const rPr of rprs) {
      if (size) rPr.setAttribute('sz', String(Math.round(size * 100)));
      if (!font) continue;
      for (const tag of ['latin', 'ea']) {
        let e = [...rPr.children].find((c) => c.localName === tag);
        if (!e) {
          e = rPr.ownerDocument.createElementNS(ANS, 'a:' + tag);
          const after = [...rPr.children].find((c) => (tag === 'latin' ? ['ea', ...AFTER_FONT] : AFTER_FONT).includes(c.localName));
          if (after) rPr.insertBefore(e, after); else rPr.append(e);
        }
        e.setAttribute('typeface', font);
      }
    }
  }
}
const blockFont = (ps) => { for (const p of ps) for (const t of ['ea', 'latin']) { const e = p.getElementsByTagNameNS(ANS, t)[0]; if (e && !e.getAttribute('typeface').startsWith('+')) return e.getAttribute('typeface'); } return ''; };
const blockSize = (ps) => { for (const p of ps) { const r = p.getElementsByTagNameNS(ANS, 'rPr')[0]; if (r && r.getAttribute('sz')) return Number(r.getAttribute('sz')) / 100; } return 18; };

export async function blankPptx() {
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const s = p.addSlide();
  s.addText('제목을 입력하세요', { x: 0.7, y: 2.2, w: 11.9, h: 1.3, fontSize: 40, bold: true, align: 'center', fontFace: '맑은 고딕' });
  s.addText('내용을 입력하세요', { x: 0.7, y: 3.7, w: 11.9, h: 1.0, fontSize: 20, align: 'center', color: '555555', fontFace: '맑은 고딕' });
  return new Uint8Array(await p.write({ outputType: 'arraybuffer' }));
}

const relsPath = (p) => p.replace(/([^/]+)$/, '_rels/$1.rels');

export async function open({ bytes, body, scroll, ctx }) {
  let zip = await JSZip.loadAsync(bytes);
  let viewer = null, editing = false;
  const slideEls = new Map();

  async function slidePaths() {
    const pres = parseXml(await zip.file('ppt/presentation.xml').async('string'));
    const rels = parseXml(await zip.file('ppt/_rels/presentation.xml.rels').async('string'));
    const target = {};
    for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
    const ids = [...pres.getElementsByTagNameNS(PNS, 'sldId')];
    return { pres, rels, ids, paths: ids.map((s) => { const t = target[s.getAttributeNS(RNS, 'id')]; return t.startsWith('/') ? t.slice(1) : 'ppt/' + t; }) };
  }

  async function render(data, keepIndex) {
    if (viewer) { try { viewer.destroy(); } catch {} }
    body.replaceChildren();
    slideEls.clear();
    viewer = await PptxViewer.open(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), body, {
      renderMode: 'list', zipLimits: RECOMMENDED_ZIP_LIMITS, pdfjs: false, scrollContainer: scroll,
      onSlideRendered: (i, e) => { slideEls.set(e, i); },
    });
    if (keepIndex != null) for (const [e, i] of slideEls) if (i === keepIndex) e.scrollIntoView({ block: 'start' });
  }
  await render(bytes);

  const rebuild = async (index) => {
    const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await render(data, index);
    ctx.changed();
  };

  /** 슬라이드 XML에서 글이 든 도형별 문단 목록 */
  function textBlocks(xml) {
    const blocks = [];
    for (const tb of [...xml.getElementsByTagNameNS(PNS, 'txBody'), ...xml.getElementsByTagNameNS(ANS, 'txBody')]) {
      const ps = [...tb.children].filter((c) => c.localName === 'p');
      if (ps.length) blocks.push(ps);
    }
    return blocks;
  }

  function applyBlock(ps, text) {
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (i < ps.length) return setParaText(ps[i], A, line);
      // 줄이 늘면 마지막 문단을 본떠 새 문단을 만든다
      const last = ps[ps.length - 1];
      const np = last.cloneNode(true);
      last.after(np);
      ps.push(np);
      setParaText(np, A, line);
    });
    for (let i = ps.length - 1; i >= lines.length && ps.length > 1; i--) { ps[i].remove(); ps.pop(); }
  }

  async function editSlide(index) {
    const { paths } = await slidePaths();
    const path = paths[index];
    const xml = parseXml(await zip.file(path).async('string'));
    const blocks = textBlocks(xml);
    const areas = [], styles = [];
    const result = await sheet(`${index + 1}번 슬라이드`, (done) =>
      el('div', { class: 'slide-edit' },
        blocks.length ? el('p', { class: 'hint', text: '글 상자마다 한 칸입니다. 줄을 바꾸면 문단이 나뉩니다.' }) : el('p', { class: 'hint', text: '이 슬라이드에는 고칠 글이 없습니다.' }),
        blocks.map((ps, bi) => {
          const t = el('textarea', { rows: Math.min(Math.max(ps.length, 1) + 1, 6) });
          t.value = ps.map((p) => paraText(p, A)).join('\n'); areas.push(t);
          const st = { font: null, size: null }; styles.push(st);
          const f0 = blockFont(ps), s0 = blockSize(ps);
          if (f0) t.style.fontFamily = `"${f0}"`;
          const fBtn = el('button', { class: 'chip', text: '글꼴: ' + (f0 || '기본'), onclick: async () => {
            const v = await pickFont({ current: st.font || f0 });
            if (v) { st.font = v; fBtn.textContent = '글꼴: ' + v; fBtn.classList.add('on'); t.style.fontFamily = `"${v}"`; }
          } });
          const sBtn = el('button', { class: 'chip', text: '크기: ' + s0, onclick: async () => {
            const v = await pickSize(st.size || s0);
            if (v) { st.size = v; sBtn.textContent = '크기: ' + v; sBtn.classList.add('on'); }
          } });
          return el('div', { class: 'block-edit' }, el('div', { class: 'chip-row' }, el('small', { class: 'hint', text: `글상자 ${bi + 1}` }), fBtn, sBtn), t);
        }),
        el('div', { class: 'dialog-buttons' },
          el('button', { text: '복제', onclick: () => done('dup') }),
          el('button', { class: 'danger', text: '삭제', onclick: () => done('del') }),
          el('button', { class: 'primary', text: '적용', onclick: () => done('apply') }))));
    if (result === 'apply') {
      let changed = false;
      const fonts = [];
      blocks.forEach((ps, i) => {
        if (areas[i].value !== ps.map((p) => paraText(p, A)).join('\n')) { applyBlock(ps, areas[i].value); changed = true; }
        if (styles[i].font || styles[i].size) { styleBlock(ps, styles[i].font, styles[i].size); changed = true; if (styles[i].font) fonts.push(styles[i].font); }
      });
      await ensureFonts(fonts);
      if (!changed) return;
      zip.file(path, serializeXml(xml));
      await busy('슬라이드를 다시 그리는 중…', () => rebuild(index));
    } else if (result === 'dup') await busy('슬라이드를 복제하는 중…', () => duplicate(index));
    else if (result === 'del') {
      if (paths.length < 2) return toast('마지막 한 장은 지울 수 없습니다.');
      if (await confirmDialog(`${index + 1}번 슬라이드를 지울까요?`)) await busy('슬라이드를 지우는 중…', () => remove(index));
    }
  }

  async function duplicate(index) {
    const { pres, rels, ids, paths } = await slidePaths();
    const src = paths[index];
    let n = 1;
    while (zip.file(`ppt/slides/slide${n}.xml`)) n++;
    const dst = `ppt/slides/slide${n}.xml`;
    zip.file(dst, await zip.file(src).async('uint8array'));
    const srcRels = zip.file(relsPath(src));
    if (srcRels) {
      // 슬라이드 노트 연결은 복제본에서 뺀다(노트는 슬라이드 하나에만 딸릴 수 있다)
      zip.file(relsPath(dst), (await srcRels.async('string')).replace(/<Relationship[^>]*notesSlide[^>]*\/>/g, ''));
    }
    const ct = zip.file('[Content_Types].xml');
    zip.file('[Content_Types].xml', (await ct.async('string')).replace('</Types>', `<Override PartName="/${dst}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`));
    const used = new Set([...rels.getElementsByTagName('Relationship')].map((r) => r.getAttribute('Id')));
    let k = 1; while (used.has('rId' + (1000 + k))) k++;
    const rid = 'rId' + (1000 + k);
    const rel = rels.createElementNS(rels.documentElement.namespaceURI, 'Relationship');
    rel.setAttribute('Id', rid); rel.setAttribute('Type', REL_SLIDE); rel.setAttribute('Target', `slides/slide${n}.xml`);
    rels.documentElement.append(rel);
    const maxId = Math.max(255, ...[...pres.getElementsByTagNameNS(PNS, 'sldId')].map((s) => Number(s.getAttribute('id'))));
    const sid = ids[index].cloneNode(false);
    sid.setAttribute('id', String(maxId + 1));
    sid.setAttributeNS(RNS, 'r:id', rid);
    ids[index].after(sid);
    zip.file('ppt/presentation.xml', serializeXml(pres));
    zip.file('ppt/_rels/presentation.xml.rels', serializeXml(rels));
    await rebuild(index + 1);
  }

  async function remove(index) {
    const { pres, rels, ids, paths } = await slidePaths();
    const rid = ids[index].getAttributeNS(RNS, 'id');
    ids[index].remove();
    [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.remove();
    zip.remove(paths[index]);
    zip.remove(relsPath(paths[index]));
    const ct = zip.file('[Content_Types].xml');
    zip.file('[Content_Types].xml', (await ct.async('string')).replace(new RegExp(`<Override[^>]*PartName="/${paths[index]}"[^>]*/>`), ''));
    zip.file('ppt/presentation.xml', serializeXml(pres));
    zip.file('ppt/_rels/presentation.xml.rels', serializeXml(rels));
    await rebuild(Math.max(0, index - 1));
  }

  body.addEventListener('click', (e) => {
    if (!editing) return;
    for (const [node, i] of slideEls) if (node.contains(e.target)) { editSlide(i).catch((err) => toast('수정하지 못했습니다: ' + err.message)); return; }
  });

  return {
    kind: 'pptx', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    canEdit: true, noFit: true,
    editHint: '고칠 슬라이드를 누르세요.',
    setEditing(on) { editing = on; body.classList.toggle('editing', on); },
    tools: () => [],
    save: () => zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    info: () => [['슬라이드 수', String(new Set(slideEls.values()).size)]],
    destroy() { try { viewer && viewer.destroy(); } catch {} },
  };
}

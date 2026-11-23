// DOCX: 화면은 docx-preview로 그리고, 고친 글은 원본 XML의 해당 문단에만 반영해 저장한다.
import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import { W, segments, paraText, setParaText, serializeXml, parseXml } from './ooxml-text.js';
import { toast, xmlEscape } from '../ui.js';
import { pickFont, pickSize, ensureFonts } from '../fonts.js';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const FLOW = new Set(['body', 'tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'ins', 'smartTag', 'customXml']);
const norm = (s) => s.replace(/\s+/g, '');

/** 본문 흐름에 있는 문단만(글상자 안 문단 제외) 문서 순서대로 */
function flowParagraphs(xml) {
  const out = [];
  for (const p of xml.getElementsByTagNameNS(WNS, 'p')) {
    let ok = true;
    for (let a = p.parentElement; a; a = a.parentElement) {
      if (a.localName === 'document') break;
      if (!FLOW.has(a.localName)) { ok = false; break; }
    }
    if (ok) out.push(p);
  }
  return out;
}

// 그림·필드 등이 든 문단은 글만 고쳐도 안전하도록 조각 단위로만 손대므로 그대로 편집 가능.
// 화면 문단과 XML 문단을 글 내용으로 짝짓는다.
function pairParagraphs(domPs, xmlPs) {
  const pairs = new Map();
  const dt = domPs.map((p) => norm(p.textContent)), xt = xmlPs.map((p) => norm(paraText(p, W)));
  let i = 0, j = 0;
  while (i < domPs.length && j < xmlPs.length) {
    if (dt[i] === xt[j]) { pairs.set(domPs[i], xmlPs[j]); i++; j++; continue; }
    let found = false;
    for (let k = 1; k <= 8 && !found; k++) {
      if (j + k < xmlPs.length && dt[i] === xt[j + k] && dt[i]) { j += k; found = true; }
      else if (i + k < domPs.length && dt[i + k] === xt[j] && xt[j]) { i += k; found = true; }
    }
    if (!found) { i++; j++; }
  }
  return pairs;
}

function ensureChild(parent, name, first) {
  let c = [...parent.children].find((x) => x.localName === name);
  if (!c) {
    c = parent.ownerDocument.createElementNS(WNS, 'w:' + name);
    if (first) parent.prepend(c); else parent.append(c);
  }
  return c;
}
const wAttr = (e, name, v) => e.setAttributeNS(WNS, 'w:' + name, v);
const topRun = (n) => { while (n && n.localName !== 'r') n = n.parentElement; return n; };

/** 글자 위치 offset에서 run을 둘로 나눈다 */
function splitRunAt(p, offset) {
  let pos = 0;
  for (const s of segments(p, W)) {
    const end = pos + s.text.length;
    if (offset > pos && offset < end && s.isText) {
      const run = topRun(s.node);
      const clone = run.cloneNode(false);
      const rPr = [...run.children].find((c) => c.localName === 'rPr');
      if (rPr) clone.append(rPr.cloneNode(true));
      const t2 = s.node.cloneNode(false);
      t2.textContent = s.text.slice(offset - pos);
      s.node.textContent = s.text.slice(0, offset - pos);
      clone.append(t2);
      let n = s.node.nextSibling;
      while (n) { const next = n.nextSibling; clone.append(n); n = next; }
      run.after(clone);
      return;
    }
    if (offset > pos && offset < end) return;
    pos = end;
  }
}

/** [a,b) 범위 글자에 굵게(b)·기울임(i)·밑줄(u)을 켜거나 끈다 */
function toggleFormat(p, a, b, prop) {
  splitRunAt(p, a); splitRunAt(p, b);
  const runs = new Set();
  let pos = 0;
  for (const s of segments(p, W)) {
    const end = pos + s.text.length;
    if (pos >= a && end <= b && end > pos) runs.add(topRun(s.node));
    pos = end;
  }
  runs.delete(null);
  const has = (r) => {
    const rPr = [...r.children].find((c) => c.localName === 'rPr');
    const e = rPr && [...rPr.children].find((c) => c.localName === prop);
    if (!e) return false;
    const v = e.getAttributeNS(WNS, 'val');
    return !(v === '0' || v === 'false' || v === 'none');
  };
  const on = ![...runs].every(has);
  for (const r of runs) {
    const rPr = ensureChild(r, 'rPr', true);
    [...rPr.children].filter((c) => c.localName === prop || c.localName === prop + 'Cs').forEach((c) => c.remove());
    const e = r.ownerDocument.createElementNS(WNS, 'w:' + prop);
    if (prop === 'u') wAttr(e, 'val', on ? 'single' : 'none');
    else if (!on) wAttr(e, 'val', '0');
    // 스키마 순서상 b·i는 앞쪽, u는 뒤쪽에 둔다
    const before = [...rPr.children].find((c) => !['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs'].includes(c.localName));
    if (prop === 'u' || !before) rPr.append(e); else rPr.insertBefore(e, before);
    if (prop === 'u') {
      const order = ['effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
      const after = [...rPr.children].find((c) => order.includes(c.localName));
      if (after) rPr.insertBefore(e, after);
    }
  }
  return on;
}

/** [a,b) 범위의 글자 조각(run)들. 경계에서 run을 나눈다 */
function runsIn(p, a, b) {
  splitRunAt(p, a); splitRunAt(p, b);
  const runs = new Set();
  let pos = 0;
  for (const s of segments(p, W)) {
    const end = pos + s.text.length;
    if (pos >= a && end <= b && end > pos) runs.add(topRun(s.node));
    pos = end;
  }
  runs.delete(null);
  return [...runs];
}
const RPR_AFTER_SZ = ['highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
/** 글꼴 바꾸기: 영문·한글·기타 글자 모두 같은 글꼴로 */
function setRunFont(p, a, b, name) {
  for (const r of runsIn(p, a, b)) {
    const rPr = ensureChild(r, 'rPr', true);
    let f = [...rPr.children].find((c) => c.localName === 'rFonts');
    if (!f) {
      f = r.ownerDocument.createElementNS(WNS, 'w:rFonts');
      const style = [...rPr.children].find((c) => c.localName === 'rStyle');
      if (style) style.after(f); else rPr.prepend(f);
    }
    for (const at of ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']) f.removeAttributeNS(WNS, at);
    for (const at of ['ascii', 'hAnsi', 'eastAsia', 'cs']) wAttr(f, at, name);
  }
}
/** 글자 크기 바꾸기(pt) */
function setRunSize(p, a, b, pt) {
  for (const r of runsIn(p, a, b)) {
    const rPr = ensureChild(r, 'rPr', true);
    [...rPr.children].filter((c) => c.localName === 'sz' || c.localName === 'szCs').forEach((c) => c.remove());
    const after = [...rPr.children].find((c) => RPR_AFTER_SZ.includes(c.localName));
    for (const n of ['sz', 'szCs']) {
      const e = r.ownerDocument.createElementNS(WNS, 'w:' + n);
      wAttr(e, 'val', String(Math.round(pt * 2)));
      if (after) rPr.insertBefore(e, after); else rPr.append(e);
    }
  }
}

export function buildDocx(lines) {
  const body = lines.map((l) => `<w:p>${l ? `<w:r><w:t xml:space="preserve">${xmlEscape(l)}</w:t></w:r>` : ''}</w:p>`).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${WNS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="맑은 고딕" w:hAnsi="맑은 고딕" w:eastAsia="맑은 고딕" w:cs="맑은 고딕"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style></w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${WNS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function open({ bytes, body, ctx }) {
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('워드 문서 본문을 찾지 못했습니다.');
  const xml = parseXml(await docFile.async('string'));
  await renderAsync(bytes, body, null, { inWrapper: true, breakPages: true, experimental: true, useBase64URL: true, renderChanges: false });

  let pairs = new Map();
  const domParagraphs = () => [...body.querySelectorAll('section.docx > article p')];
  const repair = () => { pairs = pairParagraphs(domParagraphs(), flowParagraphs(xml)); };
  repair();
  let editing = false, current = null;

  const sync = (dp) => {
    const xp = pairs.get(dp);
    if (!xp) return;
    const text = dp.textContent.replace(/​/g, '');
    const old = paraText(xp, W);
    if (old === text) return;
    // 화면 글과 XML 글이 공백만 다르면(탭 등) 그 차이는 건드리지 않도록 공백 무시 비교
    if (norm(old) === norm(text)) return;
    setParaText(xp, W, text);
    ctx.changed();
  };
  const caretOffset = (dp) => {
    const sel = getSelection();
    if (!sel.rangeCount || !dp.contains(sel.anchorNode)) return [0, 0];
    const r = sel.getRangeAt(0);
    const measure = (node, off) => { const x = document.createRange(); x.selectNodeContents(dp); x.setEnd(node, off); return x.toString().length; };
    return [measure(r.startContainer, r.startOffset), measure(r.endContainer, r.endOffset)];
  };
  const focusPara = (dp, atEnd) => {
    dp.focus();
    const r = document.createRange();
    r.selectNodeContents(dp);
    r.collapse(!atEnd);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  };

  function splitParagraph(dp) {
    const xp = pairs.get(dp);
    if (!xp) return;
    sync(dp);
    const [off] = caretOffset(dp);
    const full = dp.textContent;
    const head = full.slice(0, off), tail = full.slice(off);
    // XML: 새 문단은 문단 서식과 마지막 글자 서식을 물려받는다
    const nx = xp.cloneNode(false);
    const pPr = [...xp.children].find((c) => c.localName === 'pPr');
    if (pPr) { const c = pPr.cloneNode(true); [...c.children].filter((x) => x.localName === 'sectPr').forEach((x) => x.remove()); nx.append(c); }
    const lastRun = [...xp.getElementsByTagNameNS(WNS, 'r')].pop();
    xp.after(nx);
    if (norm(paraText(xp, W)) !== norm(head)) setParaText(xp, W, head);
    if (tail) {
      const r = xml.createElementNS(WNS, 'w:r');
      const rPr = lastRun && [...lastRun.children].find((c) => c.localName === 'rPr');
      if (rPr) r.append(rPr.cloneNode(true));
      const t = xml.createElementNS(WNS, 'w:t');
      t.textContent = tail; t.setAttribute('xml:space', 'preserve');
      r.append(t); nx.append(r);
    }
    // 화면
    const nd = dp.cloneNode(false);
    const span = dp.querySelector('span') ? dp.querySelector('span').cloneNode(false) : document.createElement('span');
    span.textContent = tail; nd.append(span);
    if (off < full.length) { const r = document.createRange(); r.selectNodeContents(dp); const s = getSelection(); const cur = s.getRangeAt(0); r.setStart(cur.startContainer, cur.startOffset); r.deleteContents(); }
    dp.after(nd);
    pairs.set(nd, nx);
    focusPara(nd, false);
    ctx.changed();
  }

  function removeParagraph(dp) {
    const xp = pairs.get(dp);
    const all = domParagraphs().filter((p) => pairs.has(p));
    const idx = all.indexOf(dp);
    if (!xp || all.length < 2) return;
    // 표 칸의 마지막 문단·구역 정보가 든 문단은 지우면 파일이 깨지므로 남긴다
    const siblings = [...xp.parentElement.children].filter((c) => c.localName === 'p');
    if (xp.parentElement.localName === 'tc' && siblings.length < 2) return;
    if (xp.getElementsByTagNameNS(WNS, 'sectPr').length) return;
    xp.remove(); dp.remove(); pairs.delete(dp);
    const prev = all[idx - 1] || all[idx + 1];
    if (prev) focusPara(prev, true);
    ctx.changed();
  }

  body.addEventListener('focusin', (e) => { const p = e.target.closest && e.target.closest('p'); if (p && pairs.has(p)) current = p; });
  body.addEventListener('input', (e) => { const p = e.target.closest && e.target.closest('p'); if (p) sync(p); });
  body.addEventListener('keydown', (e) => {
    const p = e.target.closest && e.target.closest('p');
    if (!editing || !p || !pairs.has(p)) return;
    if (e.key === 'Enter') { e.preventDefault(); splitParagraph(p); }
    else if (e.key === 'Backspace' && !p.textContent.replace(/​/g, '')) { e.preventDefault(); removeParagraph(p); }
  });
  // 안드로이드 글자판은 Enter를 keydown이 아닌 beforeinput으로 보낸다
  body.addEventListener('beforeinput', (e) => {
    const p = e.target.closest && e.target.closest('p');
    if (!editing || !p || !pairs.has(p)) return;
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); splitParagraph(p); }
    else if (e.inputType === 'deleteContentBackward' && !p.textContent.replace(/​/g, '')) { e.preventDefault(); removeParagraph(p); }
    else if (e.inputType && e.inputType.startsWith('format')) e.preventDefault();
  });
  body.addEventListener('paste', (e) => {
    if (!editing) return;
    e.preventDefault();
    const text = (e.clipboardData.getData('text/plain') || '').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });

  function format(prop, cmd) {
    const dp = current;
    const xp = dp && pairs.get(dp);
    if (!xp || !document.contains(dp)) return toast('먼저 고칠 문단을 눌러 주세요.');
    sync(dp);
    let [a, b] = caretOffset(dp);
    if (a === b) { a = 0; b = dp.textContent.length; const r = document.createRange(); r.selectNodeContents(dp); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    if (a === b) return;
    if (norm(paraText(xp, W)).length !== norm(dp.textContent).length) return toast('이 문단은 서식을 바꿀 수 없습니다.');
    // 화면 글과 XML 글의 위치가 같을 때만 정확히 적용된다
    if (paraText(xp, W) !== dp.textContent) { a = 0; b = paraText(xp, W).length; }
    const on = toggleFormat(xp, a, b, prop);
    // 화면: 선택 범위에 직접 스타일을 입힌다
    document.execCommand('styleWithCSS', false, true);
    const state = document.queryCommandState(cmd);
    if (state !== on) document.execCommand(cmd);
    ctx.changed();
  }
  /** 글꼴·크기: 고르는 창이 열리면 선택이 풀리므로 범위를 기억해 두었다가 되살린다 */
  async function runStyle(kind) {
    const dp = current;
    const xp = dp && pairs.get(dp);
    if (!xp || !document.contains(dp)) return toast('먼저 고칠 문단을 눌러 주세요.');
    sync(dp);
    let [a, b] = caretOffset(dp);
    const sel = getSelection();
    let range = sel.rangeCount && dp.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    if (a === b || !range) { a = 0; b = dp.textContent.length; range = document.createRange(); range.selectNodeContents(dp); }
    if (a === b) return toast('글자가 없는 문단입니다.');
    const anchor = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const cs = getComputedStyle(anchor);
    const value = kind === 'font'
      ? await pickFont({ current: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() })
      : await pickSize(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
    if (value == null) return;
    if (paraText(xp, W) !== dp.textContent) { a = 0; b = paraText(xp, W).length; range = document.createRange(); range.selectNodeContents(dp); }
    if (kind === 'font') { await ensureFonts([value]); setRunFont(xp, a, b, value); } else setRunSize(xp, a, b, value);
    // 화면에도 같은 서식을 입힌다
    dp.focus();
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('styleWithCSS', false, true);
    if (kind === 'font') document.execCommand('fontName', false, value);
    else {
      document.execCommand('fontSize', false, '7');
      dp.querySelectorAll('[style*="xxx-large"], font[size="7"]').forEach((e) => { e.style.fontSize = value + 'pt'; e.removeAttribute('size'); });
    }
    ctx.changed();
  }

  function align(val, css) {
    const dp = current;
    const xp = dp && pairs.get(dp);
    if (!xp || !document.contains(dp)) return toast('먼저 고칠 문단을 눌러 주세요.');
    const pPr = ensureChild(xp, 'pPr', true);
    [...pPr.children].filter((c) => c.localName === 'jc').forEach((c) => c.remove());
    const jc = xml.createElementNS(WNS, 'w:jc');
    wAttr(jc, 'val', val);
    const order = ['textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
    const after = [...pPr.children].find((c) => order.includes(c.localName));
    if (after) pPr.insertBefore(jc, after); else pPr.append(jc);
    dp.style.textAlign = css;
    ctx.changed();
  }

  return {
    kind: 'docx', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    canEdit: true,
    setEditing(on) {
      editing = on;
      if (on) repair();
      for (const p of pairs.keys()) { if (on) p.setAttribute('contenteditable', 'true'); else p.removeAttribute('contenteditable'); }
      body.classList.toggle('editing', on);
      if (!on) { document.activeElement && document.activeElement.blur(); current = null; }
    },
    tools: () => [
      { label: '글꼴', icon: '가', editOnly: true, run: () => runStyle('font') },
      { label: '크기', icon: '¹²', editOnly: true, run: () => runStyle('size') },
      { label: '굵게', icon: 'B', editOnly: true, run: () => format('b', 'bold') },
      { label: '기울임', icon: 'I', editOnly: true, run: () => format('i', 'italic') },
      { label: '밑줄', icon: 'U', editOnly: true, run: () => format('u', 'underline') },
      { label: '왼쪽', icon: '⇤', editOnly: true, run: () => align('left', 'left') },
      { label: '가운데', icon: '↔', editOnly: true, run: () => align('center', 'center') },
      { label: '오른쪽', icon: '⇥', editOnly: true, run: () => align('right', 'right') },
    ],
    async save() {
      for (const p of pairs.keys()) sync(p);
      zip.file('word/document.xml', serializeXml(xml));
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    },
    info: () => [['문단 수', String(flowParagraphs(xml).length)]],
    destroy() {},
  };
}

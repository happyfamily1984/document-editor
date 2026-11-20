// 오피스 XML(워드·파워포인트) 문단의 글자를 서식을 지키면서 고치는 공통 도구.
// 바뀐 부분만 찾아(앞뒤 공통 부분 제외) 해당 글자 조각에만 손을 대므로 나머지 서식은 그대로 남는다.

export const W = {
  // 문단 안에서 들어가지 않을 영역(글상자·그림·지워진 글 등)
  skip: new Set(['txbxContent', 'drawing', 'pict', 'object', 'del', 'moveFrom', 'AlternateContent', 'pPr', 'rPr']),
  atoms: { tab: '\t', br: '\n', cr: '\n', noBreakHyphen: '-' },
};
export const A = {
  skip: new Set(['pPr', 'rPr', 'endParaRPr']),
  atoms: { br: '↵' },
};

/** 문단의 글자 조각 목록: [{node, text, isText}] */
export function segments(p, cfg) {
  const out = [];
  (function walk(n) {
    for (const c of n.children) {
      const name = c.localName;
      if (cfg.skip.has(name)) continue;
      if (name === 't') out.push({ node: c, text: c.textContent, isText: true });
      else if (name in cfg.atoms) out.push({ node: c, text: cfg.atoms[name], isText: false });
      else walk(c);
    }
  })(p);
  return out;
}
export const paraText = (p, cfg) => segments(p, cfg).map((s) => s.text).join('');

const childNamed = (e, name) => [...e.children].find((c) => c.localName === name);
const closestRun = (n) => { while (n && n.localName !== 'r') n = n.parentElement; return n; };
const qn = (p, name) => (p.prefix ? p.prefix + ':' : '') + name;

function setText(t, value) {
  t.textContent = value;
  if (/^\s|\s$|\s\s/.test(value)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
}

/** 글자 조각이 없는 자리에 새 글자 조각(run + t)을 만든다 */
function newTextNode(p, cfg, prev) {
  const doc = p.ownerDocument;
  const ns = p.namespaceURI;
  const run = doc.createElementNS(ns, qn(p, 'r'));
  const prevRun = prev && closestRun(prev.node);
  const srcRun = prevRun || [...p.getElementsByTagNameNS(ns, 'r')].find((r) => closestRun(r) === r);
  let rPr = srcRun && childNamed(srcRun, 'rPr');
  if (!rPr) {
    // 빈 문단이면 문단 끝 서식을 물려받는다
    const end = childNamed(p, 'endParaRPr') || (childNamed(p, 'pPr') && childNamed(childNamed(p, 'pPr'), 'rPr'));
    if (end) {
      rPr = doc.createElementNS(ns, qn(p, 'rPr'));
      for (const a of end.attributes) rPr.setAttribute(a.name, a.value);
      for (const c of end.children) rPr.append(c.cloneNode(true));
    }
  }
  if (rPr) run.append(rPr.cloneNode(true));
  const t = doc.createElementNS(ns, qn(p, 't'));
  run.append(t);
  const anchor = prevRun || (prev && prev.node);
  if (anchor) anchor.after(run);
  else {
    const pPr = childNamed(p, 'pPr');
    if (pPr) pPr.after(run); else p.prepend(run);
  }
  return t;
}

/** 문단 글자를 newText로 바꾼다. 바뀐 부분만 고친다. */
export function setParaText(p, cfg, newText) {
  const segs = segments(p, cfg);
  const old = segs.map((s) => s.text).join('');
  if (old === newText) return false;
  let pre = 0;
  const max = Math.min(old.length, newText.length);
  while (pre < max && old[pre] === newText[pre]) pre++;
  let suf = 0;
  while (suf < max - pre && old[old.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++;
  const delEnd = old.length - suf;
  const ins = newText.slice(pre, newText.length - suf);

  // 넣을 자리: 바뀌기 시작하는 위치를 품은 글자 조각(앞쪽 조각 우선 → 앞 글자 서식을 이어받음)
  let pos = 0, target = null, targetOffset = 0, prev = null;
  for (const s of segs) {
    const start = pos, end = pos + s.text.length;
    if (s.isText && !target && start <= pre && pre <= end && (pre > start || pre === 0 || !prev || !prev.isText)) {
      target = s; targetOffset = pre - start;
    }
    if (end <= pre) prev = s;
    // 지울 부분
    const a = Math.max(start, pre), b = Math.min(end, delEnd);
    if (a < b) {
      if (s.isText) s.newText = (s.newText ?? s.text).slice(0, a - start) + s.text.slice(b - start);
      else s.remove = true;
    }
    pos = end;
  }
  for (const s of segs) {
    if (s.remove) s.node.remove();
    else if (s.newText !== undefined && s !== target) setText(s.node, s.newText);
  }
  if (ins || target) {
    if (target) {
      const base = target.newText ?? target.text;
      setText(target.node, base.slice(0, targetOffset) + ins + base.slice(targetOffset));
    } else setText(newTextNode(p, cfg, prev && !prev.remove ? prev : null), ins);
  }
  return true;
}

/** XML 문서를 글자로. 선언부가 빠지면 붙인다. */
export function serializeXml(doc) {
  const s = new XMLSerializer().serializeToString(doc);
  return s.startsWith('<?xml') ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
}
export const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');

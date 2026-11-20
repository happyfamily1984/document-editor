// PDF: pdf.js로 보여 주고, pdf-lib으로 글 넣기·쪽 지우기·쪽 돌리기를 한다.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { PDFDocument, degrees } from 'pdf-lib';
import { el, toast, busy, promptText, confirmDialog } from '../ui.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const ASSET = new URL('./pdfjs/', document.baseURI).href;

export async function open({ bytes, body, scroll, ctx }) {
  let data = bytes, pdf = null, password;
  let editing = false, textMode = false, zoom = 1, encrypted = false;
  let pages = []; // {div, canvas, page, rendered, task}
  let observer = null;

  async function load() {
    const task = pdfjs.getDocument({ data: data.slice(), password, cMapUrl: ASSET + 'cmaps/', cMapPacked: true, standardFontDataUrl: ASSET + 'standard_fonts/' });
    task.onPassword = async (update, reason) => {
      encrypted = true;
      const pw = await promptText(reason === 2 ? '비밀번호가 맞지 않습니다' : '비밀번호가 걸린 PDF', '', { placeholder: '비밀번호' });
      if (pw == null) task.destroy(); else { password = pw; update(pw); }
    };
    pdf = await task.promise;
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) draw(pages[Number(e.target.dataset.i)]); }, { root: scroll, rootMargin: '600px 0px' });
    body.replaceChildren();
    pages = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 96 / 72 });
      const div = el('div', { class: 'pdf-page', 'data-i': i, style: `width:${vp.width}px;height:${vp.height}px` });
      const item = { div, page, scaleDrawn: 0 };
      pages.push(item);
      body.append(div);
      observer.observe(div);
    }
  }

  async function draw(item) {
    const scale = Math.min(Math.max(zoom, 1) * Math.min(devicePixelRatio || 1, 2), 4);
    if (item.scaleDrawn >= scale || item.busy) return;
    item.busy = true;
    try {
      let vp = item.page.getViewport({ scale: (96 / 72) * scale });
      const limit = 12e6; // 한 쪽당 픽셀 수 한도(메모리 보호)
      if (vp.width * vp.height > limit) vp = item.page.getViewport({ scale: (96 / 72) * scale * Math.sqrt(limit / (vp.width * vp.height)) });
      const canvas = el('canvas', { width: Math.floor(vp.width), height: Math.floor(vp.height) });
      await item.page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      item.div.replaceChildren(canvas);
      item.scaleDrawn = scale;
    } catch (e) { if (e && e.name !== 'RenderingCancelledException') console.warn(e); }
    item.busy = false;
  }

  function currentIndex() {
    const mid = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
    let best = 0, dist = Infinity;
    pages.forEach((p, i) => { const r = p.div.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < dist) { dist = d; best = i; } });
    return best;
  }

  /** pdf-lib으로 고친 뒤 화면을 다시 그린다 */
  async function modify(job, keepIndex) {
    await busy('PDF를 고치는 중…', async () => {
      const doc = await PDFDocument.load(data, { ignoreEncryption: false });
      await job(doc);
      data = await doc.save();
      const top = scroll.scrollTop;
      await load();
      if (keepIndex != null && pages[keepIndex]) pages[keepIndex].div.scrollIntoView({ block: 'start' }); else scroll.scrollTop = top;
      ctx.changed();
    });
  }

  // 글은 기기 글꼴로 그림을 만들어 넣는다(한글 글꼴을 따로 싣지 않아도 어느 글자든 들어간다)
  async function addText(index, pt, text, size) {
    const K = 4, lines = text.split('\n'), lh = size * 1.35;
    const canvas = document.createElement('canvas');
    let g = canvas.getContext('2d');
    const font = `${size * K}px "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
    g.font = font;
    const w = Math.max(1, ...lines.map((l) => g.measureText(l).width)) / K + 2, h = lines.length * lh + size * 0.2;
    canvas.width = Math.ceil(w * K); canvas.height = Math.ceil(h * K);
    g = canvas.getContext('2d');
    g.font = font; g.fillStyle = '#000'; g.textBaseline = 'alphabetic';
    lines.forEach((l, i) => g.fillText(l, K, (i * lh + size) * K));
    const png = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer());
    await modify(async (doc) => {
      const page = doc.getPage(index), img = await doc.embedPng(png);
      const rot = page.getRotation().angle;
      if (rot === 0) page.drawImage(img, { x: pt[0], y: pt[1] - h, width: w, height: h });
      else page.drawImage(img, { x: pt[0], y: pt[1], width: w, height: h, rotate: degrees(rot) });
    }, null);
  }

  body.addEventListener('click', async (e) => {
    if (!editing || !textMode) return;
    const div = e.target.closest('.pdf-page');
    if (!div) return;
    const i = Number(div.dataset.i), r = div.getBoundingClientRect(), item = pages[i];
    const vp = item.page.getViewport({ scale: 1 });
    const pt = vp.convertToPdfPoint(((e.clientX - r.left) / r.width) * vp.width, ((e.clientY - r.top) / r.height) * vp.height);
    let size = 12;
    const text = await promptText('넣을 글', '', {
      multiline: true, okLabel: '넣기',
      extra: () => { const s = el('select', { 'aria-label': '글자 크기', onchange: () => (size = Number(s.value)) }, [8, 10, 12, 14, 18, 24, 32].map((n) => el('option', { value: n, text: `글자 크기 ${n}`, selected: n === 12 }))); return s; },
    });
    if (!text || !text.trim()) return;
    try { await addText(i, pt, text, size); } catch (err) { toast('글을 넣지 못했습니다: ' + err.message); }
  });

  await load();
  let editable = !encrypted;
  if (editable) { try { await PDFDocument.load(data, { updateMetadata: false }); } catch { editable = false; } }

  return {
    kind: 'pdf', ext: 'pdf', mime: 'application/pdf',
    canEdit: editable, noFind: true,
    notice: editable ? '' : '이 PDF는 보호되어 있거나 구조가 달라 보기만 할 수 있습니다.',
    setEditing(on) { editing = on; if (!on) textMode = false; body.classList.toggle('placing', textMode); ctx.refreshTools(); },
    onZoom(z) { zoom = z; for (const p of pages) { const r = p.div.getBoundingClientRect(); if (r.bottom > -800 && r.top < innerHeight + 800) draw(p); } },
    back() { if (textMode) { textMode = false; body.classList.remove('placing'); ctx.refreshTools(); return true; } return false; },
    tools: () => [
      { label: textMode ? '글 넣기 끝' : '글 넣기', icon: 'T', editOnly: true, active: textMode, run: () => { textMode = !textMode; body.classList.toggle('placing', textMode); ctx.refreshTools(); if (textMode) toast('글을 넣을 자리를 누르세요.'); } },
      { label: '쪽 돌리기', icon: '⟳', editOnly: true, run: async () => { const i = currentIndex(); await modify((d) => { const p = d.getPage(i); p.setRotation(degrees((p.getRotation().angle + 90) % 360)); }, i); } },
      { label: '쪽 지우기', icon: '🗑', editOnly: true, run: async () => {
        const i = currentIndex();
        if (pages.length < 2) return toast('마지막 한 쪽은 지울 수 없습니다.');
        if (await confirmDialog(`${i + 1}쪽을 지울까요?`)) await modify((d) => d.removePage(i), Math.max(0, i - 1));
      } },
    ],
    async beforePrint() { for (const p of pages.slice(0, 80)) await draw(p); },
    save: async () => data,
    info: () => [['쪽 수', String(pages.length)]],
    destroy() { observer?.disconnect(); pdf && pdf.destroy(); },
  };
}

// HTML(웹 문서): 칸막이(iframe) 안에 보여 주고 고친다.
// 문서 속 스크립트는 실행하지 않고, 외부 사이트에서 그림·글꼴 등을 불러오지 않는다(내 정보가 새지 않게).
import { el, toast, confirmDialog } from '../ui.js';
import { decodeText } from './text.js';
import { pickFont, pickSize, ensureFonts } from '../fonts.js';
import * as native from '../native.js';

const MARK = 'data-docedit'; // 이 앱이 넣은 요소 표시(저장할 때 뺀다)
const CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'self' 'unsafe-inline' data:; font-src 'self' data:";

export async function open({ bytes, body, ctx }) {
  let text = bytes ? decodeText(bytes).replace(/^﻿/, '') : '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>새 문서</title></head><body><p><br></p></body></html>';
  const doctype = (/^\s*<!doctype[^>]*>/i.exec(text) || ['<!DOCTYPE html>'])[0].trim();

  // 스크립트는 칸막이(sandbox)가 실행을 막으므로 지우지 않는다(저장할 때 원본 그대로 남게).
  // 자동 이동(meta refresh)만 잠시 꺼 두었다가 저장할 때 되살린다.
  const parsed = new DOMParser().parseFromString(text, 'text/html');
  parsed.querySelectorAll('meta[http-equiv="refresh" i]').forEach((m) => { m.setAttribute('data-docedit-equiv', m.getAttribute('http-equiv')); m.removeAttribute('http-equiv'); });
  const head = parsed.head;
  const cspMeta = parsed.createElement('meta');
  cspMeta.setAttribute('http-equiv', 'Content-Security-Policy');
  cspMeta.setAttribute('content', CSP);
  cspMeta.setAttribute(MARK, '');
  const fontLink = parsed.createElement('link');
  fontLink.rel = 'stylesheet'; fontLink.href = new URL('./fonts/fonts.css', document.baseURI).href; fontLink.setAttribute(MARK, '');
  const style = parsed.createElement('style');
  style.setAttribute(MARK, '');
  style.textContent = 'html{-webkit-text-size-adjust:100%}body{margin:12px;word-wrap:break-word;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}table{max-width:100%}body[contenteditable]{outline:none;min-height:60vh}';
  head.prepend(cspMeta, fontLink, style);
  if (!parsed.querySelector('meta[name="viewport"]')) {
    const vp = parsed.createElement('meta'); vp.name = 'viewport'; vp.content = 'width=device-width, initial-scale=1'; vp.setAttribute(MARK, ''); head.append(vp);
  }
  // 인터넷 주소를 가진 그림·스타일 등은 주소를 잠시 다른 속성에 옮겨 두어 아예 불러오지 않게 한다(저장할 때 되돌린다)
  let blocked = 0;
  const NET = /^\s*(https?:)?\/\//i;
  for (const e of parsed.querySelectorAll('[src], [srcset], link[href], [poster], object[data], [background]')) {
    for (const a of ['src', 'srcset', 'poster', 'data', 'background', ...(e.localName === 'link' ? ['href'] : [])]) {
      const v = e.getAttribute(a);
      if (v != null && (NET.test(v) || (a === 'srcset' && /(https?:)?\/\//i.test(v)))) { e.setAttribute('data-docedit-' + a, v); e.removeAttribute(a); blocked++; }
    }
  }

  const frame = el('iframe', { class: 'html-frame', sandbox: 'allow-same-origin', title: '문서 내용' });
  body.append(frame);
  body.classList.add('html-body');
  await new Promise((resolve) => { frame.onload = resolve; frame.srcdoc = '<!DOCTYPE html>' + parsed.documentElement.outerHTML; });
  const d = frame.contentDocument;
  let editing = false;

  const fit = () => { frame.style.height = '0px'; frame.style.height = Math.max(d.documentElement.scrollHeight, body.parentElement.clientHeight) + 'px'; };
  fit();
  new ResizeObserver(fit).observe(d.documentElement);
  d.fonts && d.fonts.ready.then(fit);

  // 링크: 칸막이 안에서 이동하지 않게 막고, 인터넷 주소면 브라우저로 열지 묻는다
  d.addEventListener('click', async (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    if (editing) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) { const t = d.getElementById(href.slice(1)) || d.querySelector(`[name="${CSS.escape(href.slice(1))}"]`); if (t) t.scrollIntoView(); return; }
    if (/^https?:\/\//i.test(href) && (await confirmDialog(`브라우저로 열까요?\n${href}`, '열기', '취소'))) {
      if (native.isNative) location.href = href; else window.open(href, '_blank', 'noopener');
    }
  });
  d.addEventListener('input', () => { ctx.changed(); fit(); });

  // 도구 단추를 누르면 칸막이 안의 선택이 풀릴 수 있어 마지막 선택을 기억해 둔다
  let lastRange = null;
  d.addEventListener('selectionchange', () => { const sel = d.getSelection(); if (editing && sel.rangeCount && d.body.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange(); });
  function restore() {
    const sel = d.getSelection();
    d.body.focus();
    if (lastRange) { sel.removeAllRanges(); sel.addRange(lastRange); }
    return sel;
  }
  function exec(cmd, value) {
    if (!editing) return;
    restore();
    d.execCommand('styleWithCSS', false, true);
    d.execCommand(cmd, false, value);
    ctx.changed();
  }
  async function runStyle(kind) {
    const sel = d.getSelection();
    const range = lastRange && !lastRange.collapsed ? lastRange.cloneRange() : null;
    if (!range) return toast('먼저 바꿀 글자를 길게 눌러 고르세요.');
    const anchor = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const cs = frame.contentWindow.getComputedStyle(anchor);
    const v = kind === 'font'
      ? await pickFont({ current: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() })
      : await pickSize(Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2);
    if (v == null) return;
    lastRange = range;
    if (kind === 'font') { await ensureFonts([v]); exec('fontName', v); }
    else {
      exec('fontSize', '7');
      d.querySelectorAll('[style*="xxx-large"], font[size="7"]').forEach((e) => { e.style.fontSize = v + 'pt'; e.removeAttribute('size'); });
    }
  }

  const info = () => {
    const t = d.body.innerText || '';
    return [['제목', d.title || '(없음)'], ['글자 수', String(t.replace(/\s/g, '').length)]];
  };

  return {
    kind: 'html', ext: 'html', mime: 'text/html', canEdit: true, noFit: true, noFind: true,
    notice: blocked ? `안전을 위해 인터넷에 있는 그림·스타일 ${blocked}개는 불러오지 않았습니다. 문서 속 스크립트도 실행하지 않습니다.` : parsed.querySelector('script') ? '안전을 위해 문서 속 스크립트는 실행하지 않습니다(저장할 때는 그대로 남습니다).' : '',
    editHint: '고칠 곳을 눌러 바로 쓰세요.',
    setEditing(on) {
      editing = on;
      if (on) { d.body.setAttribute('contenteditable', 'true'); d.body.focus(); }
      else { d.body.removeAttribute('contenteditable'); d.getSelection().removeAllRanges(); }
    },
    tools: () => [
      { label: '글꼴', icon: '가', editOnly: true, run: () => runStyle('font') },
      { label: '크기', icon: '¹²', editOnly: true, run: () => runStyle('size') },
      { label: '굵게', icon: 'B', editOnly: true, run: () => exec('bold') },
      { label: '기울임', icon: 'I', editOnly: true, run: () => exec('italic') },
      { label: '밑줄', icon: 'U', editOnly: true, run: () => exec('underline') },
      { label: '되돌리기', icon: '↶', editOnly: true, run: () => exec('undo') },
    ],
    async save() {
      // 화면과 떨어진 문서에서 작업한다(그래야 주소를 되돌려도 그림을 불러오지 않는다)
      const copy = new DOMParser().parseFromString('<!DOCTYPE html>' + d.documentElement.outerHTML, 'text/html').documentElement;
      copy.querySelectorAll(`[${MARK}]`).forEach((e) => e.remove());
      copy.querySelector('body')?.removeAttribute('contenteditable');
      for (const e of copy.querySelectorAll('*')) for (const at of [...e.attributes]) {
        if (at.name.startsWith('data-docedit-') && at.name !== 'data-docedit-equiv') { e.setAttribute(at.name.slice(13), at.value); e.removeAttribute(at.name); }
      }
      copy.querySelectorAll('[style=""]').forEach((e) => e.removeAttribute('style'));
      copy.querySelectorAll('[data-docedit-equiv]').forEach((m) => { m.setAttribute('http-equiv', m.getAttribute('data-docedit-equiv')); m.removeAttribute('data-docedit-equiv'); });
      if (!copy.querySelector('meta[charset]')) { const m = copy.ownerDocument.createElement('meta'); m.setAttribute('charset', 'utf-8'); copy.querySelector('head')?.prepend(m); }
      else copy.querySelector('meta[charset]').setAttribute('charset', 'utf-8');
      // 원래 인코딩 선언(euc-kr 등)은 UTF-8로 바꾼다(저장은 UTF-8)
      copy.querySelectorAll('meta[http-equiv="Content-Type" i]').forEach((m) => m.setAttribute('content', (m.getAttribute('content') || 'text/html').replace(/charset=[^;]+/i, 'charset=utf-8')));
      return new TextEncoder().encode(doctype + '\n' + copy.outerHTML + '\n');
    },
    info,
    destroy() {},
  };
}

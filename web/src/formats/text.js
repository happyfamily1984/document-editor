// 글 파일(TXT·MD·JSON 등): 그대로 보여 주고 고친다.
import { el } from '../ui.js';

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('euc-kr').decode(bytes); }
}

export async function open({ bytes, ext, body, ctx }) {
  const area = el('textarea', { class: 'text-doc', readonly: true, spellcheck: 'false' });
  area.value = bytes ? decodeText(bytes).replace(/^﻿/, '') : '';
  const grow = () => { area.style.height = 'auto'; area.style.height = area.scrollHeight + 40 + 'px'; };
  area.addEventListener('input', () => { ctx.changed(); grow(); });
  body.append(area);
  body.classList.add('text-body');
  requestAnimationFrame(grow);
  return {
    kind: 'txt', ext: ext || 'txt', mime: 'text/plain',
    canEdit: true, noFind: true, noFit: true,
    setEditing(on) { area.readOnly = !on; if (on) area.focus(); else area.blur(); },
    tools: () => [],
    save: async () => new TextEncoder().encode(area.value),
    info: () => [['글자 수', String(area.value.length)]],
    destroy() {},
  };
}

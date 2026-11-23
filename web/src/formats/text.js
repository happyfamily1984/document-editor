// 글 파일(TXT·MD·JSON 등): 그대로 보여 주고 고친다.
import { el } from '../ui.js';
import { pickFont, pickSize, cssFamily } from '../fonts.js';

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
  // 보는 글꼴·크기(파일에는 저장되지 않는 화면 설정)
  const pref = (() => { try { return JSON.parse(localStorage.getItem('textView') || '{}'); } catch { return {}; } })();
  const applyPref = () => { if (pref.font) area.style.fontFamily = cssFamily(pref.font); if (pref.size) area.style.fontSize = pref.size + 'pt'; grow(); };
  const savePref = () => { try { localStorage.setItem('textView', JSON.stringify(pref)); } catch {} applyPref(); };
  body.append(area);
  applyPref();
  body.classList.add('text-body');
  requestAnimationFrame(grow);
  return {
    kind: 'txt', ext: ext || 'txt', mime: 'text/plain',
    canEdit: true, noFind: true, noFit: true,
    setEditing(on) { area.readOnly = !on; if (on) area.focus(); else area.blur(); },
    tools: () => [
      { label: '글꼴', icon: '가', run: async () => { const v = await pickFont({ current: pref.font, title: '보는 글꼴' }); if (v) { pref.font = v; savePref(); } } },
      { label: '크기', icon: '¹²', run: async () => { const v = await pickSize(pref.size || 11); if (v) { pref.size = v; savePref(); } } },
    ],
    save: async () => new TextEncoder().encode(area.value),
    info: () => [['글자 수', String(area.value.length)]],
    destroy() {},
  };
}

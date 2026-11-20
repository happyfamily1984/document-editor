// 공통 UI 도우미: 알림, 대화상자, 아래 시트, 진행 표시
export const $ = (s, r = document) => r.querySelector(s);
export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

// 열린 창 목록. 뒤로가기를 누르면 가장 위의 창부터 닫는다.
const overlays = [];
export function closeTopOverlay() {
  const top = overlays[overlays.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

function openOverlay(kind, build) {
  return new Promise((resolve) => {
    const wrap = el('div', { class: 'overlay ' + kind });
    const entry = {
      close(value) {
        const i = overlays.indexOf(entry);
        if (i < 0) return;
        overlays.splice(i, 1);
        wrap.remove();
        resolve(value);
      },
    };
    wrap.addEventListener('click', (e) => { if (e.target === wrap) entry.close(); });
    wrap.append(build((v) => entry.close(v)));
    overlays.push(entry);
    $('#overlays').append(wrap);
  });
}

/** buttons: [{label, value, kind}] → 누른 버튼의 value (취소·뒤로가기는 undefined) */
export function dialog(message, buttons, title) {
  return openOverlay('center', (done) =>
    el('div', { class: 'dialog', role: 'dialog' },
      title ? el('h3', { text: title }) : null,
      el('p', { text: message }),
      el('div', { class: 'dialog-buttons' },
        buttons.map((b) => el('button', { class: b.kind || '', text: b.label, onclick: () => done(b.value) })))));
}
export const confirmDialog = (message, yes = '예', no = '아니오') =>
  dialog(message, [{ label: no, value: false }, { label: yes, value: true, kind: 'primary' }]).then((v) => v === true);
export const alertDialog = (message, title) => dialog(message, [{ label: '확인', value: true, kind: 'primary' }], title);

/** 글 입력 창. 취소하면 null */
export function promptText(title, value = '', { multiline = false, placeholder = '', okLabel = '확인', extra } = {}) {
  return openOverlay(multiline ? 'bottom' : 'center', (done) => {
    const input = multiline
      ? el('textarea', { rows: 6, placeholder })
      : el('input', { type: 'text', placeholder, autocomplete: 'off' });
    input.value = value;
    setTimeout(() => { input.focus(); if (!multiline) input.select(); }, 50);
    if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); });
    return el('div', { class: multiline ? 'sheet' : 'dialog' },
      el('h3', { text: title }), input, extra ? extra(done) : null,
      el('div', { class: 'dialog-buttons' },
        el('button', { text: '취소', onclick: () => done(null) }),
        el('button', { class: 'primary', text: okLabel, onclick: () => done(input.value) })));
  }).then((v) => (v === undefined ? null : v));
}

/** 아래에서 올라오는 시트. build(done)이 내용 요소를 돌려준다. */
export function sheet(title, build) {
  return openOverlay('bottom', (done) =>
    el('div', { class: 'sheet' },
      el('div', { class: 'sheet-head' }, el('h3', { text: title }), el('button', { class: 'icon', text: '✕', 'aria-label': '닫기', onclick: () => done() })),
      build(done)));
}

/** 고르기 메뉴. items: [{label, value, danger}] */
export function menu(title, items) {
  return sheet(title, (done) =>
    el('div', { class: 'menu-list' }, items.map((it) =>
      el('button', { class: it.danger ? 'danger' : '', text: it.label, disabled: it.disabled, onclick: () => done(it.value) }))));
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

export async function busy(msg, job) {
  $('#busy-msg').textContent = msg;
  $('#busy').hidden = false;
  await new Promise((r) => setTimeout(r, 30)); // 화면에 먼저 그려지게
  try { return await job(); } finally { $('#busy').hidden = true; }
}

export const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 엑셀(XLSX·XLS·CSV): SheetJS로 읽어 표로 보여 준다.
// XLSX는 고친 칸만 원본 XML에 반영해 저장하므로 서식·차트 등 나머지는 그대로 남는다.
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { el, toast } from '../ui.js';
import { serializeXml, parseXml } from './ooxml-text.js';
import { decodeText } from './text.js';

const MAX_ROWS = 3000, MAX_COLS = 150;
const SNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function parseInput(raw) {
  const s = raw.trim();
  if (s === '') return null;
  if (s[0] === '=' && s.length > 1) return { t: 'f', f: s.slice(1) };
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return { t: 'n', v: Number(s) };
  return { t: 's', v: raw };
}

/**
 * HTML 표로 된 "엑셀" 파일(은행·관공서 내려받기)을 시트 하나로 읽는다.
 * 표가 여러 개면 위에서 아래로 이어 붙이고, 합쳐진 칸(colspan·rowspan)과 숫자를 살린다.
 */
function htmlToWorkbook(text) {
  const dom = new DOMParser().parseFromString(text, 'text/html');
  const tables = [...dom.querySelectorAll('table')].filter((t) => !t.querySelector('table'));
  if (!tables.length) return null;
  const ws = {}, merges = [];
  let top = 0, maxC = 0;
  for (const table of tables) {
    const taken = new Set(); // 합쳐진 칸이 차지한 자리
    let r = 0;
    for (const tr of table.rows) {
      let c = 0;
      for (const cell of tr.cells) {
        while (taken.has(r + ',' + c)) c++;
        const rs = Math.max(1, cell.rowSpan || 1), cs = Math.max(1, cell.colSpan || 1);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) taken.add(r + i + ',' + (c + j));
        if (rs > 1 || cs > 1) merges.push({ s: { r: top + r, c }, e: { r: top + r + rs - 1, c: c + cs - 1 } });
        cell.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
        const raw = cell.textContent.replace(/\s+/g, ' ').trim();
        if (raw) {
          const plain = raw.replace(/,/g, '');
          // 쉼표 숫자는 숫자로(계좌번호·0으로 시작하는 번호·아주 긴 번호는 글자 그대로)
          const isNum = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(raw) && plain.replace(/\D/g, '').length <= 15 && !/^-?0\d/.test(plain);
          ws[XLSX.utils.encode_cell({ r: top + r, c })] = isNum ? { t: 'n', v: Number(plain), w: raw, z: raw.includes(',') ? '#,##0' : 'General' } : { t: 's', v: raw, w: raw };
        }
        c += cs;
        maxC = Math.max(maxC, c);
      }
      r++;
    }
    top += r + 1; // 표 사이에 한 줄 띄운다
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(top - 2, 0), c: Math.max(maxC - 1, 0) } });
  if (merges.length) ws['!merges'] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return wb;
}

/** 칸 너비가 정해지지 않은 시트는 내용 길이에 맞춘다 */
function autoWidths(ws, cols) {
  const merged = new Set();
  for (const m of ws['!merges'] || []) if (m.e.c > m.s.c) merged.add(XLSX.utils.encode_cell(m.s));
  const w = new Array(cols).fill(0);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = 0; r <= Math.min(range.e.r, 600); r++) for (let c = 0; c <= Math.min(range.e.c, cols - 1); c++) {
    const a = XLSX.utils.encode_cell({ r, c }), cell = ws[a];
    if (!cell || merged.has(a)) continue;
    const t = String(cell.w != null ? cell.w : cell.v != null ? cell.v : '');
    let len = 0;
    for (const ch of t) len += ch.charCodeAt(0) > 0x2e7f ? 13 : 7.5; // 한글·한자는 넓다
    w[c] = Math.max(w[c], len);
  }
  return w.map((x) => ({ wpx: Math.min(Math.max(Math.round(x + 16), 56), 300) }));
}

/** 고친 칸을 시트 XML에 반영 */
function patchSheetXml(xml, edits, ref) {
  const data = xml.getElementsByTagNameNS(SNS, 'sheetData')[0];
  if (!data) throw new Error('sheetData 없음');
  const mk = (name) => xml.createElementNS(SNS, (data.prefix ? data.prefix + ':' : '') + name);
  const rows = new Map();
  for (const r of data.children) if (r.localName === 'row') rows.set(Number(r.getAttribute('r')), r);
  for (const [addr, val] of edits) {
    const { r, c } = XLSX.utils.decode_cell(addr);
    let row = rows.get(r + 1);
    if (!row) {
      if (!val) continue;
      row = mk('row'); row.setAttribute('r', String(r + 1));
      const next = [...rows.keys()].filter((n) => n > r + 1).sort((a, b) => a - b)[0];
      if (next) data.insertBefore(row, rows.get(next)); else data.append(row);
      rows.set(r + 1, row);
    }
    row.removeAttribute('spans');
    let cell = null, before = null;
    for (const x of row.children) {
      if (x.localName !== 'c') continue;
      const xc = XLSX.utils.decode_cell(x.getAttribute('r')).c;
      if (xc === c) { cell = x; break; }
      if (xc > c) { before = x; break; }
    }
    if (!cell) {
      if (!val) continue;
      cell = mk('c'); cell.setAttribute('r', addr);
      if (before) row.insertBefore(cell, before); else row.append(cell);
    }
    while (cell.firstChild) cell.firstChild.remove();
    cell.removeAttribute('t');
    if (!val) continue;
    if (val.t === 's') {
      cell.setAttribute('t', 'inlineStr');
      const is = mk('is'), t = mk('t');
      t.textContent = val.v; t.setAttribute('xml:space', 'preserve');
      is.append(t); cell.append(is);
    } else {
      const v = mk(val.t === 'f' ? 'f' : 'v');
      v.textContent = val.t === 'f' ? val.f : String(val.v);
      cell.append(v);
    }
  }
  const dim = xml.getElementsByTagNameNS(SNS, 'dimension')[0];
  if (dim && ref) dim.setAttribute('ref', ref);
}

export async function open({ bytes, ext, body, extra, ctx }) {
  const isCsv = ext === 'csv' || ext === 'tsv';
  let wb;
  if (isCsv) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('euc-kr').decode(bytes); }
    wb = XLSX.read(text, { type: 'string', raw: false });
  } else if (bytes && !(bytes[0] === 0x50 && bytes[1] === 0x4b) && !(bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    // 속이 HTML 표·XML인 "엑셀" 파일: 글자로 풀어서 읽는다(한글이 깨지지 않게)
    const text = decodeText(bytes);
    wb = (/<table/i.test(text) && htmlToWorkbook(text)) || XLSX.read(text, { type: 'string', cellFormula: true });
  } else if (bytes) wb = XLSX.read(bytes, { type: 'array', cellFormula: true, cellNF: true });
  else { wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1'); }

  // 원본이 XLSX일 때만 "고친 칸만 반영" 저장이 가능하다
  let zip = null; const sheetPaths = {};
  if (bytes && !isCsv && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      zip = await JSZip.loadAsync(bytes);
      const wbXml = parseXml(await zip.file('xl/workbook.xml').async('string'));
      const rels = parseXml(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
      const target = {};
      for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
      for (const s of wbXml.getElementsByTagNameNS(SNS, 'sheet')) {
        const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        const t = target[rid];
        if (t) sheetPaths[s.getAttribute('name')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
      }
    } catch { zip = null; }
  }
  const edits = {}; // 시트 이름 → Map(칸 주소 → 값)
  let sheetName = wb.SheetNames[0];
  let editing = false, selected = null;

  const table = el('table', { class: 'grid' });
  body.append(table);
  body.classList.add('sheet-body');

  const tabs = el('div', { class: 'sheet-tabs' });
  const refLabel = el('span', { class: 'cell-ref' });
  const input = el('input', { type: 'text', class: 'cell-input', placeholder: '칸을 눌러 고르세요', autocomplete: 'off', enterkeyhint: 'done' });
  const okBtn = el('button', { class: 'primary', text: '입력', onclick: () => commit(true) });
  const bar = el('div', { class: 'cell-bar', hidden: true }, refLabel, input, okBtn);
  extra.append(bar, tabs);
  extra.hidden = false;

  function renderTabs() {
    tabs.replaceChildren(...wb.SheetNames.map((n) =>
      el('button', { text: n, 'aria-selected': n === sheetName, onclick: () => { commit(); sheetName = n; selected = null; renderTabs(); render(); } })));
    tabs.hidden = wb.SheetNames.length < 2;
  }

  function render() {
    const ws = wb.Sheets[sheetName];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const rows = Math.min(Math.max(range.e.r + 1 + (editing ? 20 : 2), 30), MAX_ROWS);
    const cols = Math.min(Math.max(range.e.c + 1 + (editing ? 3 : 1), 8), MAX_COLS);
    const span = new Map(), covered = new Set();
    for (const m of ws['!merges'] || []) {
      span.set(XLSX.utils.encode_cell(m.s), m);
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ',' + c);
    }
    const colW = ws['!cols'] || (ws['!auto'] ||= autoWidths(ws, cols));
    let html = '<colgroup><col style="width:44px">';
    for (let c = 0; c < cols; c++) html += `<col style="width:${Math.min(Math.max(Math.round((colW[c] && colW[c].wpx) || 80), 40), 400)}px">`;
    html += '</colgroup><thead><tr><th></th>';
    for (let c = 0; c < cols; c++) html += `<th>${XLSX.utils.encode_col(c)}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += `<tr><th>${r + 1}</th>`;
      for (let c = 0; c < cols; c++) {
        if (covered.has(r + ',' + c)) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr], m = span.get(addr);
        const text = cell ? (cell.w != null ? cell.w : cell.v != null ? cell.v : cell.f ? '=' + cell.f : '') : '';
        html += `<td data-a="${addr}"${m ? ` rowspan="${m.e.r - m.s.r + 1}" colspan="${m.e.c - m.s.c + 1}"` : ''}${cell && cell.t === 'n' ? ' class="num"' : ''}>${esc(text)}</td>`;
      }
      html += '</tr>';
    }
    table.innerHTML = html + '</tbody>';
    if (range.e.r + 1 > MAX_ROWS || range.e.c + 1 > MAX_COLS) toast(`너무 큰 시트라 ${MAX_ROWS}행 ${MAX_COLS}열까지만 보여 줍니다.`);
  }

  const rawOf = (cell) => (!cell ? '' : cell.f ? '=' + cell.f : cell.t === 'n' || cell.t === 'b' ? String(cell.v) : cell.w != null && cell.t === 'd' ? cell.w : cell.v != null ? String(cell.v) : '');

  function select(td) {
    commit();
    table.querySelector('td.sel')?.classList.remove('sel');
    selected = td;
    if (!td) { refLabel.textContent = ''; input.value = ''; return; }
    td.classList.add('sel');
    refLabel.textContent = td.dataset.a;
    input.value = rawOf(wb.Sheets[sheetName][td.dataset.a]);
  }

  function commit(moveDown) {
    if (!selected || !editing) return;
    const ws = wb.Sheets[sheetName], addr = selected.dataset.a;
    if (input.value !== rawOf(ws[addr])) {
      const val = parseInput(input.value);
      if (!val) delete ws[addr];
      else if (val.t === 'f') ws[addr] = { t: 'n', f: val.f };
      else ws[addr] = { t: val.t, v: val.v, w: String(val.v) };
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1'), p = XLSX.utils.decode_cell(addr);
      range.e.r = Math.max(range.e.r, p.r); range.e.c = Math.max(range.e.c, p.c);
      ws['!ref'] = XLSX.utils.encode_range(range);
      (edits[sheetName] ||= new Map()).set(addr, val);
      selected.textContent = val ? (val.t === 'f' ? '=' + val.f : String(val.v)) : '';
      selected.classList.toggle('num', !!val && val.t === 'n');
      ctx.changed();
    }
    if (moveDown) {
      const p = XLSX.utils.decode_cell(addr);
      const next = table.querySelector(`td[data-a="${XLSX.utils.encode_cell({ r: p.r + 1, c: p.c })}"]`);
      if (next) { selected = null; select(next); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); input.focus(); }
    }
  }

  table.addEventListener('click', (e) => {
    const td = e.target.closest('td');
    if (!td) return;
    if (!editing) { table.querySelector('td.sel')?.classList.remove('sel'); td.classList.add('sel'); if (td.textContent.length > 12) toast(td.textContent.slice(0, 300)); return; }
    select(td);
    input.focus();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } });

  renderTabs(); render();

  const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return {
    kind: 'xlsx', ext: isCsv ? ext : 'xlsx', mime: isCsv ? 'text/csv' : xlsxMime,
    canEdit: true, noFit: true,
    notice: ext === 'xls' ? '옛 형식(XLS)이라 저장하면 XLSX 새 파일로 만들어지고 일부 서식은 빠질 수 있습니다.' : '',
    mustSaveAs: ext === 'xls',
    setEditing(on) {
      if (!on) { commit(); select(null); }
      editing = on; bar.hidden = !on;
      render();
    },
    back() { if (editing && document.activeElement === input) { input.blur(); return true; } return false; },
    tools: () => [],
    async save() {
      commit();
      if (isCsv) return new TextEncoder().encode('﻿' + XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: ext === 'tsv' ? '\t' : ',' }));
      const canPatch = zip && Object.keys(edits).every((n) => sheetPaths[n] && zip.file(sheetPaths[n]));
      if (!canPatch) return new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true }));
      for (const [name, map] of Object.entries(edits)) {
        const path = sheetPaths[name];
        const xml = parseXml(await zip.file(path).async('string'));
        patchSheetXml(xml, map, wb.Sheets[name]['!ref']);
        zip.file(path, serializeXml(xml));
      }
      if (Object.keys(edits).length) {
        // 계산 순서 기록은 지우고, 엑셀이 열 때 수식을 다시 계산하게 한다
        if (zip.file('xl/calcChain.xml')) {
          zip.remove('xl/calcChain.xml');
          const strip = async (p, re) => { const f = zip.file(p); if (f) zip.file(p, (await f.async('string')).replace(re, '')); };
          await strip('[Content_Types].xml', /<Override[^>]*calcChain[^>]*\/>/);
          await strip('xl/_rels/workbook.xml.rels', /<Relationship[^>]*calcChain[^>]*\/>/);
        }
        const f = zip.file('xl/workbook.xml');
        let s = await f.async('string');
        if (/<calcPr[^>]*>/.test(s)) s = s.replace(/<calcPr([^>]*?)\/?>/, (m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`).replace(/<\/calcPr>/, '');
        else s = s.replace(/<\/sheets>/, '</sheets><calcPr fullCalcOnLoad="1"/>');
        zip.file('xl/workbook.xml', s);
      }
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    },
    info: () => [['시트 수', String(wb.SheetNames.length)], ['시트', wb.SheetNames.join(', ')]],
    destroy() {},
  };
}

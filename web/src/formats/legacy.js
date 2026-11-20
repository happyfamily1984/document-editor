// 옛 형식(DOC·PPT): 글만 뽑아낸다. 서식·그림은 가져오지 못한다.
import * as CFB from 'cfb';

const stream = (cfb, name) => { const e = CFB.find(cfb, name); return e && e.content ? new Uint8Array(e.content) : null; };

export function cfbKind(bytes) {
  let cfb;
  try { cfb = CFB.read(bytes, { type: 'array' }); } catch { return null; }
  const has = (n) => !!CFB.find(cfb, n);
  if (has('EncryptedPackage')) return 'encrypted';
  if (has('FileHeader') && (has('BodyText') || has('DocInfo'))) return 'hwp';
  if (has('WordDocument')) return 'doc';
  if (has('Workbook') || has('Book')) return 'xls';
  if (has('PowerPoint Document')) return 'ppt';
  return null;
}

export function docText(bytes) {
  const cfb = CFB.read(bytes, { type: 'array' });
  const wd = stream(cfb, 'WordDocument');
  if (!wd) throw new Error('워드 문서가 아닙니다.');
  const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  const flags = dv.getUint16(0x0a, true);
  if (flags & 0x0100) throw new Error('비밀번호가 걸린 문서는 열 수 없습니다.');
  const table = stream(cfb, flags & 0x0200 ? '1Table' : '0Table');
  if (!table) throw new Error('문서 구조를 읽지 못했습니다.');
  const ccpText = dv.getInt32(0x4c, true);
  const fcClx = dv.getUint32(0x01a2, true), lcbClx = dv.getUint32(0x01a6, true);
  const tv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let pos = fcClx; const end = fcClx + lcbClx;
  while (pos < end && table[pos] === 1) pos += 3 + tv.getUint16(pos + 1, true);
  if (table[pos] !== 2) throw new Error('문서 구조를 읽지 못했습니다.');
  const lcb = tv.getUint32(pos + 1, true); pos += 5;
  const n = (lcb - 4) / 12;
  let out = '';
  const latin = new TextDecoder('windows-1252'), wide = new TextDecoder('utf-16le');
  for (let i = 0; i < n; i++) {
    const cpStart = tv.getUint32(pos + i * 4, true), cpEnd = tv.getUint32(pos + (i + 1) * 4, true);
    const fcRaw = tv.getUint32(pos + (n + 1) * 4 + i * 8 + 2, true);
    const len = cpEnd - cpStart;
    if (fcRaw & 0x40000000) { const fc = (fcRaw & 0x3fffffff) >>> 1; out += latin.decode(wd.subarray(fc, fc + len)); }
    else out += wide.decode(wd.subarray(fcRaw, fcRaw + len * 2));
  }
  out = out.slice(0, ccpText);
  return out.replace(/\x13[^\x14\x15]*\x14/g, '').replace(/\x13[^\x15]*\x15/g, '')
    .replace(/[\x07\x0b\x0c\r]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '').split('\n');
}

export function pptText(bytes) {
  const cfb = CFB.read(bytes, { type: 'array' });
  const s = stream(cfb, 'PowerPoint Document');
  if (!s) throw new Error('파워포인트 문서가 아닙니다.');
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  const lines = [];
  const latin = new TextDecoder('windows-1252'), wide = new TextDecoder('utf-16le');
  (function walk(start, end) {
    let p = start;
    while (p + 8 <= end) {
      const ver = dv.getUint16(p, true) & 0xf, type = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true);
      const a = p + 8, b = Math.min(a + len, end);
      if (ver === 0xf) walk(a, b);
      else if (type === 0x0fa0) lines.push(...wide.decode(s.subarray(a, b)).split(/[\r\x0b]/));
      else if (type === 0x0fa8) lines.push(...latin.decode(s.subarray(a, b)).split(/[\r\x0b]/));
      p = a + len;
    }
  })(0, s.length);
  return lines.filter((l) => !/^[\s*]*$/.test(l) || l === '');
}

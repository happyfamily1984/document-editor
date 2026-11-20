// 안드로이드 껍데기와 주고받는 다리. 브라우저에서 열면 파일 입력·내려받기로 대신한다.
const N = window.NativeBridge;
export const isNative = !!N;
const FILE_BASE = 'https://docedit.app.local/__file/';

let pickResolve = null;
let saveResolve = null;
let incomingHandler = null;

async function loadRef(info) {
  const res = await fetch(FILE_BASE + info.id);
  if (!res.ok) throw new Error('파일을 읽지 못했습니다.');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { name: info.name || '문서', uri: info.uri || '', bytes };
}

window.__native = {
  onPicked(info) { const r = pickResolve; pickResolve = null; r && r(info); },
  onSaved(info) { const r = saveResolve; saveResolve = null; r && r(info); },
  onIncoming(info) { if (incomingHandler) loadRef(info).then(incomingHandler, (e) => incomingHandler(null, e)); },
};

/** 기기에서 파일 고르기 → {name, uri, bytes} 또는 null */
export function pickFile() {
  if (isNative) {
    return new Promise((resolve, reject) => {
      pickResolve = (info) => (info ? loadRef(info).then(resolve, reject) : resolve(null));
      N.pick();
    });
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, uri: '', bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** 최근 문서를 주소(uri)로 다시 열기 */
export async function openUri(uri) {
  if (!isNative) throw new Error('이 환경에서는 다시 열 수 없습니다.');
  const json = N.openUri(uri);
  if (!json) throw new Error('파일을 찾을 수 없거나 열 권한이 없습니다.');
  return loadRef(JSON.parse(json));
}

function sendBytes(bytes) {
  N.writeBegin();
  const CHUNK = 384 * 1024; // 3의 배수여야 base64 조각을 이어 붙일 수 있다
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const part = bytes.subarray(i, i + CHUNK);
    let s = '';
    for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
    N.writeChunk(btoa(s));
  }
}

/** 원본 파일에 덮어쓰기. 성공하면 true */
export function saveOverwrite(uri, bytes) {
  if (!isNative || !uri) return false;
  sendBytes(bytes);
  return N.writeToUri(uri);
}

/** 새 파일로 저장 → {uri, name} 또는 null(취소) */
export function saveAs(name, mime, bytes) {
  if (isNative) {
    return new Promise((resolve) => {
      saveResolve = resolve;
      sendBytes(bytes);
      N.writeCreate(name, mime);
    });
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return Promise.resolve({ uri: '', name });
}

export function share(name, mime, bytes) {
  if (!isNative) return false;
  sendBytes(bytes);
  N.writeShare(name, mime);
  return true;
}

export function print(title) { if (isNative) N.print(title); else window.print(); }
export function exitApp() { if (isNative) N.exit(); }
/** 다른 앱에서 "이 앱으로 열기"로 넘어온 파일 받기 */
export function onIncoming(handler) { incomingHandler = handler; if (isNative) N.ready(); }

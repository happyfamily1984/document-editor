// 임시저장: 고치는 중인 문서를 기기 안(IndexedDB)에 자동으로 보관한다.
// 화면을 나가거나 앱이 꺼져도 남아 있고, 홈 화면에서 이어서 편집할 수 있다.
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('docedit', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('drafts', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('drafts', mode);
    const req = fn(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** draft: {id, name, uri, srcExt, mustSaveAs, time, bytes} */
export const putDraft = (draft) => run('readwrite', (s) => s.put(draft));
export const getDraft = (id) => run('readonly', (s) => s.get(id)).catch(() => undefined);
export const deleteDraft = (id) => run('readwrite', (s) => s.delete(id)).catch(() => {});
/** 목록(내용 제외), 최근 것부터 */
export async function listDrafts() {
  try {
    const all = await run('readonly', (s) => s.getAll());
    return all.map(({ bytes, ...meta }) => ({ ...meta, size: bytes ? bytes.length : 0 })).sort((a, b) => b.time - a.time);
  } catch { return []; }
}

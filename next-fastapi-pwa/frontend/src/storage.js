// Keep the same database/store/key as the previous frontend to preserve local data.
let database;
export function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('sync-lab', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = undefined; reject(request.error); };
    });
  }
  return database;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', mode);
    const request = operation(tx.objectStore('state'));
    // Wait for commit, not just request success, before changing the UI/outbox.
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('Không lưu được dữ liệu trên thiết bị.'));
  });
}

export const readWorkspace = () => transaction('readonly', store => store.get('workspace'));
export const writeWorkspace = state => transaction('readwrite', store => store.put(state, 'workspace'));

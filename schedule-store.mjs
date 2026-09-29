// Large imported schedules remain private to this browser; transaction completion confirms a save.
// https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
function openStore() {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('Schedule storage is unavailable in this browser.')); return; }
        const request = indexedDB.open('drywall-schedule', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Close other schedule tabs and try again.'));
    });
}
async function transact(mode, action) {
    const db = await openStore();
    try { return await new Promise((resolve, reject) => {
        const tx = db.transaction('state', mode), request = action(tx.objectStore('state'));
        tx.oncomplete = () => resolve(request.result ?? null);
        tx.onerror = tx.onabort = () => reject(tx.error || request.error || new Error('Schedule storage failed.'));
    }); } finally { db.close(); }
}
export const readBrowserSchedule = () => transact('readonly', store => store.get('schedule'));
export const writeBrowserSchedule = value => transact('readwrite', store => store.put(value, 'schedule'));

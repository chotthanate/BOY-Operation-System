(() => {
  "use strict";
  const DB_NAME = "boy-auth-session-v1";
  let database;
  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sessions");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Session storage blocked"));
    });
    return database;
  }
  async function access(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", mode);
      const request = operation(transaction.objectStore("sessions"));
      transaction.oncomplete = () => resolve(request.result ?? null);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  const storage = {
    async getItem(key) {
      let value = null;
      try { if (localStorage.getItem("boy-auth-cleared:"+key)) return null; } catch (_) {}
      try { value = localStorage.getItem(key); } catch (_) {}
      if (value !== null) {
        try { await access("readwrite", store => store.put(value, key)); } catch (_) {}
        return value;
      }
      try {
        value = await access("readonly", store => store.get(key));
        if (value !== null) try { localStorage.setItem(key, value); } catch (_) {}
        return value;
      } catch (_) { return null; }
    },
    async setItem(key, value) {
      let saved = false;
      try { localStorage.setItem(key, value); saved = true; } catch (_) {}
      try { await access("readwrite", store => store.put(value, key)); saved = true; } catch (_) {}
      if (!saved) throw new Error("ไม่สามารถจำการเข้าใช้ในเบราว์เซอร์นี้ได้");
      try { localStorage.removeItem("boy-auth-cleared:"+key); } catch (_) {}
    },
    async removeItem(key) {
      let cleared = false;
      try { localStorage.setItem("boy-auth-cleared:"+key,"1"); localStorage.removeItem(key); cleared = true; } catch (_) {}
      try { await access("readwrite", store => store.delete(key)); cleared = true; } catch (_) {}
      if (!cleared) throw new Error("ไม่สามารถล้างสถานะเข้าใช้ในเบราว์เซอร์นี้ได้");
    }
  };
  async function clearProject(url) {
    const key = "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token";
    await Promise.all([key, key+"-user", key+"-code-verifier"].map(name => storage.removeItem(name)));
  }
  globalThis.BOY_SESSION_STORAGE = {storage, clearProject};
})();

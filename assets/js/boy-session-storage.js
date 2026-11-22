(() => {
  "use strict";
  const DB_NAME = "boy-auth-session-v1";
  const DEADLINE_MS = 1800;
  let database;
  const versions = new Map(), pending = new Map();
  function openDatabase() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      let settled=false;
      const fail=error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);};
      const timer=setTimeout(()=>fail(new Error("Session backup timed out")),DEADLINE_MS);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("sessions");
      request.onsuccess = () => {
        if(settled){request.result.close();return;}
        settled=true;clearTimeout(timer);request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error("Session storage blocked"));
    }).catch(error=>{database=null;throw error;});
    return database;
  }
  async function access(mode, operation) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("sessions", mode);
      const timer=setTimeout(()=>{try{transaction.abort();}catch(_){}reject(new Error("Session backup timed out"));},DEADLINE_MS);
      const request = operation(transaction.objectStore("sessions"));
      transaction.oncomplete = () => {clearTimeout(timer);resolve(request.result ?? null);};
      transaction.onerror = transaction.onabort = () => {clearTimeout(timer);reject(transaction.error);};
    });
  }
  function cleared(key){try{return !!localStorage.getItem("boy-auth-cleared:"+key);}catch(_){return false;}}
  function backup(key,value){
    const version=(versions.get(key)||0)+1;versions.set(key,version);
    const task=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(versions.get(key)!==version||(value!==null&&cleared(key)))return;
      await access("readwrite",store=>value===null?store.delete(key):store.put(value,key));
    });
    pending.set(key,task);task.finally(()=>{if(pending.get(key)===task)pending.delete(key);}).catch(()=>{});return task;
  }
  const storage = {
    async getItem(key) {
      let value = null;
      if(cleared(key))return null;
      try { value = localStorage.getItem(key); } catch (_) {}
      if (value !== null) {
        // The working local session must not wait for Safari's backup database.
        void backup(key,value).catch(()=>{});
        return value;
      }
      try {
        value = await access("readonly", store => store.get(key));
        if(cleared(key))return null;
        try{const current=localStorage.getItem(key);if(current!==null)return current;}catch(_){}
        if (value !== null) try { localStorage.setItem(key, value); } catch (_) {}
        return value;
      } catch (_) { return null; }
    },
    async setItem(key, value) {
      let saved = false;
      try { localStorage.setItem(key, value); saved = true; } catch (_) {}
      try { localStorage.removeItem("boy-auth-cleared:"+key); } catch (_) {}
      const copy=backup(key,value);
      if(saved){void copy.catch(()=>{});return;}
      try { await copy; saved = true; } catch (_) {}
      if (!saved) throw new Error("ไม่สามารถจำการเข้าใช้ในเบราว์เซอร์นี้ได้");
    },
    async removeItem(key) {
      let cleared = false;
      try { localStorage.setItem("boy-auth-cleared:"+key,"1"); localStorage.removeItem(key); cleared = true; } catch (_) {}
      const copy=backup(key,null);
      if(cleared){void copy.catch(()=>{});return;}
      try { await copy; cleared = true; } catch (_) {}
      if (!cleared) throw new Error("ไม่สามารถล้างสถานะเข้าใช้ในเบราว์เซอร์นี้ได้");
    }
  };
  async function clearProject(url) {
    const key = "sb-" + new URL(url).hostname.split(".")[0] + "-auth-token";
    await Promise.all([key, key+"-user", key+"-code-verifier"].map(name => storage.removeItem(name)));
  }
  globalThis.BOY_SESSION_STORAGE = {storage, clearProject};
})();

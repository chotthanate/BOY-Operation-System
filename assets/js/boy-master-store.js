(() => {
  "use strict";
  const DB_NAME = "boy-operation-cache";
  const STORE_NAME = "master-catalogs";
  const CACHE_VERSION = 2;
  const SOFT_TTL = 5 * 60 * 1000;
  const pending = new Map();
  let databasePromise;
  let supabaseClient;

  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, CACHE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "sheetName" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return databasePromise;
  }

  async function cached(sheetName) {
    try {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(sheetName);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (_) { return null; }
  }

  async function remember(sheetName, catalog, source) {
    const entry = { sheetName, catalog: { ...catalog, _source: source, _cachedAt: Date.now() }, source, cachedAt: Date.now() };
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
    return entry.catalog;
  }

  function client() {
    if (supabaseClient) return supabaseClient;
    const config = window.BOY_CENTRAL_CONFIG || {};
    if (!window.supabase || !config.url || !config.publishableKey) return null;
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    return supabaseClient;
  }

  async function fromSupabase(sheetName) {
    const central = client();
    if (!central) throw new Error("Supabase ยังไม่พร้อม");
    const { data: sessionData } = await central.auth.getSession();
    if (!sessionData?.session) throw new Error("ยังไม่มีเซสชัน Supabase");
    const { data, error } = await central.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: sheetName });
    if (error) throw error;
    if (!data?.sheetName) throw new Error("ไม่พบข้อมูลใน Supabase");
    return data;
  }

  async function refresh(sheetName, legacyLoad, notify = true) {
    if (pending.has(sheetName)) return pending.get(sheetName);
    const task = (async () => {
      let catalog;
      let source = "supabase";
      try { catalog = await fromSupabase(sheetName); }
      catch (supabaseError) {
        source = "google-sheets-fallback";
        catalog = await legacyLoad();
        catalog._supabaseError = supabaseError?.message || String(supabaseError);
      }
      catalog = await remember(sheetName, catalog, source);
      if (notify) window.dispatchEvent(new CustomEvent("boy-master-catalog-updated", { detail: { sheetName, catalog } }));
      return catalog;
    })().finally(() => pending.delete(sheetName));
    pending.set(sheetName, task);
    return task;
  }

  async function load(sheetName, legacyLoad, options = {}) {
    const entry = await cached(sheetName);
    if (entry?.catalog && !options.force) {
      const catalog = { ...entry.catalog, _source: "device-cache", _originSource: entry.source, _stale: Date.now() - entry.cachedAt > SOFT_TTL };
      refresh(sheetName, legacyLoad, true).catch(() => {});
      return catalog;
    }
    return refresh(sheetName, legacyLoad, false);
  }

  async function save(sheetName, rowNumber, values, actorName, legacySave) {
    const central = client();
    if (central) {
      try {
        const { data: sessionData } = await central.auth.getSession();
        if (sessionData?.session) {
          const { data, error } = await central.schema("boy_central").rpc("save_master_catalog_row", {
            target_sheet_name: sheetName,
            target_row_number: rowNumber ? Number(rowNumber) : null,
            payload: values,
            actor_name: actorName || "เจ้าของร้าน"
          });
          if (error) throw error;
          const catalog = await remember(sheetName, data, "supabase");
          Promise.resolve().then(() => legacySave("mirror")).catch(() => {});
          return catalog;
        }
      } catch (_) {}
    }
    const catalog = await legacySave("fallback");
    return remember(sheetName, catalog, "google-sheets-fallback");
  }

  async function setActive(sheetName, rowNumber, next, currentRow, actorName, legacySave) {
    const values = { ...(currentRow || {}), "เปิดใช้งาน": Boolean(next) };
    delete values.__rowNumber;
    delete values.__version;
    return save(sheetName, rowNumber, values, actorName, legacySave);
  }

  async function prefetch(entries, legacyLoader) {
    for (const entry of entries) {
      const sheetName = entry[2];
      if (await cached(sheetName)) continue;
      try { await refresh(sheetName, () => legacyLoader(entry[0]), false); } catch (_) {}
    }
  }

  window.BOY_MASTER_STORE = { load, save, setActive, refresh, prefetch, cached };
})();

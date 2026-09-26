(() => {
  "use strict";
  const DB_NAME = "boy-master-catalog-cache-v2";
  const STORE_NAME = "master-catalogs";
  const CACHE_VERSION = 1;
  const SOFT_TTL = 5 * 60 * 1000;
  const pending = new Map();
  let databasePromise;
  let supabaseClient;

  function withTimeout(promise, milliseconds, message) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

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

  async function remove(key) {
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
  }

  async function queueCatalog(sheetName, catalog) {
    try {
      const db = await database();
      await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put({
          sheetName: `__outbox__:${sheetName}`,
          kind: "catalog-outbox",
          targetSheetName: sheetName,
          rows: catalog?.rows || [],
          queuedAt: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (_) {}
  }

  async function flushCatalogOutbox(central, sheetName) {
    const key = `__outbox__:${sheetName}`;
    const queued = await cached(key);
    if (!queued?.rows) return;
    const { error } = await withTimeout(central.schema("boy_central").rpc("replace_master_catalog_rows", {
      target_sheet_name: sheetName,
      rows: queued.rows,
      actor_name: "ซิงก์รายการที่แก้ไขระหว่างออฟไลน์"
    }), 15000, "ส่งข้อมูลที่รอซิงก์ไม่สำเร็จ");
    if (error) throw error;
    await remove(key);
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
    const { data: sessionData } = await withTimeout(central.auth.getSession(), 2500, "Supabase ใช้เวลาตอบกลับนานเกินไป");
    if (!sessionData?.session) throw new Error("ยังไม่มีเซสชัน Supabase");
    await flushCatalogOutbox(central, sheetName);
    const { data, error } = await withTimeout(central.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: sheetName }), 8000, "Supabase ใช้เวลาตอบกลับนานเกินไป");
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

  function mergeCompactResult(currentCatalog, result) {
    if (!result?.row || !currentCatalog?.rows) return result;
    const rowNumber = String(result.row.__rowNumber || result.rowNumber || "");
    const rows = currentCatalog.rows.slice();
    const index = rows.findIndex(row => String(row.__rowNumber) === rowNumber);
    if (index >= 0) rows[index] = result.row;
    else rows.push(result.row);
    const references = { ...(currentCatalog.references || {}) };
    Object.entries(result.referencePatches || {}).forEach(([name, patch]) => {
      const existing = references[name] || { idHeader: patch.idHeader, rows: [] };
      const kept = (existing.rows || []).filter(row => String(row[patch.matchField]) !== String(patch.matchValue));
      references[name] = { ...existing, idHeader: patch.idHeader || existing.idHeader, rows: kept.concat(patch.rows || []) };
    });
    return {
      ...currentCatalog,
      status: "success",
      headers: result.headers?.length ? result.headers : currentCatalog.headers,
      required: result.required || currentCatalog.required,
      rows,
      references
    };
  }

  async function save(sheetName, rowNumber, values, actorName, legacySave, currentCatalog) {
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
    const result = await legacySave("fallback");
    const catalog = mergeCompactResult(currentCatalog, result);
    const remembered = await remember(sheetName, catalog, "google-sheets-fallback");
    await queueCatalog(sheetName, remembered);
    return remembered;
  }

  async function setActive(sheetName, rowNumber, next, currentRow, actorName, legacySave, currentCatalog) {
    const values = { ...(currentRow || {}), "เปิดใช้งาน": Boolean(next) };
    delete values.__rowNumber;
    delete values.__version;
    return save(sheetName, rowNumber, values, actorName, legacySave, currentCatalog);
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

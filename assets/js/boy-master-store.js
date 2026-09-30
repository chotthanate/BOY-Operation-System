(() => {
  "use strict";
  const DB_NAME = "boy-master-catalog-cache-v3";
  const STORE_NAME = "master-catalogs";
  const CACHE_VERSION = 1;
  const SOFT_TTL = 5 * 60 * 1000;
  const OUTBOX_PREFIX = "__outbox-ops__:";
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

  async function putEntry(entry) {
    const db = await database();
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function allEntries() {
    try {
      const db = await database();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (_) { return []; }
  }

  function operationKey(sheetName) { return `${OUTBOX_PREFIX}${sheetName}`; }
  function localOperationId() {
    return globalThis.crypto?.randomUUID?.() || `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function isLocalRowNumber(value) { return String(value || "").startsWith("local:"); }
  function isRetryable(error) {
    if (!navigator.onLine) return true;
    const text = `${error?.status || ""} ${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();
    return /(^|\s)(402|408|429|500|502|503|504)(\s|$)|payment required|quota|restricted|service unavailable|failed to fetch|network|timeout|ใช้เวลาตอบกลับ|supabase ยังไม่พร้อม|supabase ไม่พร้อม|ยังไม่มีเซสชัน/.test(text);
  }

  async function queueOperation(sheetName, operation) {
    const key = operationKey(sheetName);
    const queued = await cached(key);
    const operations = Array.isArray(queued?.operations) ? queued.operations.slice() : [];
    const matchIndex = operations.findIndex(item => {
      if (operation.localRowNumber && item.localRowNumber === operation.localRowNumber) return true;
      return operation.rowNumber && item.rowNumber && String(item.rowNumber) === String(operation.rowNumber);
    });
    if (matchIndex >= 0 && operation.type === "save" && operations[matchIndex].type === "save") {
      const previous = operations[matchIndex];
      operations[matchIndex] = {
        ...previous,
        ...operation,
        values: { ...(previous.values || {}), ...(operation.values || {}) },
        queuedAt: Date.now()
      };
    } else operations.push(operation);
    await putEntry({ sheetName: key, kind: "operation-outbox", targetSheetName: sheetName, operations, queuedAt: Date.now() });
    window.dispatchEvent(new CustomEvent("boy-master-outbox-updated", { detail: { sheetName, count: operations.length } }));
    return operations.length;
  }

  async function pendingCount(sheetName) {
    const queued = await cached(operationKey(sheetName));
    return Array.isArray(queued?.operations) ? queued.operations.length : 0;
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

  async function flushOperationOutbox(central, sheetName) {
    const key = operationKey(sheetName);
    const queued = await cached(key);
    let operations = Array.isArray(queued?.operations) ? queued.operations.slice() : [];
    if (!operations.length) return null;
    const { data: initialCatalog, error: loadError } = await withTimeout(
      central.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: sheetName }),
      8000,
      "Supabase ใช้เวลาตอบกลับนานเกินไป"
    );
    if (loadError) throw loadError;
    let remoteCatalog = initialCatalog;
    while (operations.length) {
      const operation = operations[0];
      let result;
      if (operation.type === "bulk") {
        result = await withTimeout(central.schema("boy_central").rpc("bulk_upsert_master_catalog_rows", {
          target_sheet_name: sheetName,
          rows: operation.rows || [],
          actor_name: operation.actorName || "ซิงก์รายการที่บันทึกในเครื่อง"
        }), 30000, "ส่งข้อมูลที่รอซิงก์ไม่สำเร็จ");
      } else {
        let targetRowNumber = operation.rowNumber || null;
        if (!targetRowNumber && operation.idHeader && operation.idValue) {
          const existing = (remoteCatalog?.rows || []).find(row => String(row[operation.idHeader] || "") === String(operation.idValue));
          targetRowNumber = existing?.__rowNumber || null;
        }
        result = await withTimeout(central.schema("boy_central").rpc("save_master_catalog_row", {
          target_sheet_name: sheetName,
          target_row_number: targetRowNumber ? Number(targetRowNumber) : null,
          payload: operation.values || {},
          actor_name: operation.actorName || "ซิงก์รายการที่บันทึกในเครื่อง"
        }), 15000, "ส่งข้อมูลที่รอซิงก์ไม่สำเร็จ");
      }
      if (result.error) throw result.error;
      remoteCatalog = result.data || remoteCatalog;
      operations.shift();
      if (operations.length) await putEntry({ ...queued, operations, queuedAt: Date.now() });
      else await remove(key);
      window.dispatchEvent(new CustomEvent("boy-master-outbox-updated", { detail: { sheetName, count: operations.length } }));
    }
    return remoteCatalog;
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
    await flushOperationOutbox(central, sheetName);
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
        const local = await cached(sheetName);
        if (local?.catalog) {
          source = "device-cache";
          catalog = { ...local.catalog, _source: "device-cache", _supabaseError: supabaseError?.message || String(supabaseError) };
        } else {
          source = "google-sheets-fallback";
          catalog = await legacyLoad();
          catalog._supabaseError = supabaseError?.message || String(supabaseError);
        }
      }
      const waiting = await pendingCount(sheetName);
      if (waiting) catalog = { ...catalog, _pendingSync: true, _pendingSyncCount: waiting };
      else if (catalog) { delete catalog._pendingSync; delete catalog._pendingSyncCount; }
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
    if (!currentCatalog?.rows) return result;
    const rows = currentCatalog.rows.slice();
    if (result?.row) {
      const rowNumber = String(result.row.__rowNumber || result.rowNumber || "");
      const index = rows.findIndex(row => String(row.__rowNumber) === rowNumber);
      if (index >= 0) rows[index] = result.row;
      else rows.push(result.row);
    }
    const references = { ...(currentCatalog.references || {}) };
    Object.entries(result.referencePatches || {}).forEach(([name, patch]) => {
      const existing = references[name] || { idHeader: patch.idHeader, rows: [] };
      const values = new Set((patch.matchValues || [patch.matchValue]).filter(value => value != null).map(String));
      const kept = (existing.rows || []).filter(row => !values.has(String(row[patch.matchField])));
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

  function mergeLocalSave(currentCatalog, rowNumber, values, localRowNumber) {
    const rows = (currentCatalog?.rows || []).slice();
    const index = rows.findIndex(row => String(row.__rowNumber) === String(rowNumber || localRowNumber));
    const previous = index >= 0 ? rows[index] : {};
    const row = {
      ...previous,
      ...values,
      __rowNumber: rowNumber || localRowNumber,
      __version: previous.__version || `offline:${Date.now()}`,
      __pendingSync: true
    };
    if (index >= 0) rows[index] = row;
    else rows.push(row);
    return { ...currentCatalog, rows, _source: "device-cache", _pendingSync: true };
  }

  function mergeLocalBulk(currentCatalog, updates) {
    const rows = (currentCatalog?.rows || []).slice();
    const idHeader = currentCatalog?.idHeader;
    (updates || []).forEach(values => {
      const index = idHeader ? rows.findIndex(row => String(row[idHeader] || "") === String(values[idHeader] || "")) : -1;
      const localRowNumber = index >= 0 ? rows[index].__rowNumber : `local:${localOperationId()}`;
      const row = { ...(index >= 0 ? rows[index] : {}), ...values, __rowNumber: localRowNumber, __pendingSync: true };
      if (index >= 0) rows[index] = row;
      else rows.push(row);
    });
    return { ...currentCatalog, rows, _source: "device-cache", _pendingSync: true };
  }

  async function applyPatch(sheetName, currentCatalog, result) {
    return remember(sheetName, mergeCompactResult(currentCatalog, result), "google-sheets-fallback");
  }

  async function save(sheetName, rowNumber, values, actorName, legacySave, currentCatalog) {
    const central = client();
    if (central) {
      try {
        const { data: sessionData } = await central.auth.getSession();
        if (sessionData?.session) {
          const { data, error } = await withTimeout(central.schema("boy_central").rpc("save_master_catalog_row", {
            target_sheet_name: sheetName,
            target_row_number: rowNumber && !isLocalRowNumber(rowNumber) ? Number(rowNumber) : null,
            payload: values,
            actor_name: actorName || "เจ้าของร้าน"
          }), 12000, "Supabase ใช้เวลาตอบกลับนานเกินไป");
          if (error) throw error;
          const catalog = await remember(sheetName, data, "supabase");
          Promise.resolve().then(() => legacySave("mirror")).catch(() => {});
          return catalog;
        }
      } catch (error) {
        if (!isRetryable(error)) throw error;
      }
    }
    const operationId = localOperationId();
    const previousLocal = isLocalRowNumber(rowNumber) ? String(rowNumber) : "";
    const localRowNumber = previousLocal || `local:${operationId}`;
    const idHeader = currentCatalog?.idHeader || "";
    const count = await queueOperation(sheetName, {
      id: operationId,
      type: "save",
      rowNumber: rowNumber && !isLocalRowNumber(rowNumber) ? rowNumber : null,
      localRowNumber,
      idHeader,
      idValue: idHeader ? values?.[idHeader] : "",
      values,
      actorName: actorName || "เจ้าของร้าน",
      queuedAt: Date.now()
    });
    const catalog = mergeLocalSave(currentCatalog, rowNumber, values, localRowNumber);
    catalog._pendingSyncCount = count;
    const remembered = await remember(sheetName, catalog, "device-cache");
    return remembered;
  }

  async function setActive(sheetName, rowNumber, next, currentRow, actorName, legacySave, currentCatalog) {
    const values = { ...(currentRow || {}), "เปิดใช้งาน": Boolean(next) };
    delete values.__rowNumber;
    delete values.__version;
    return save(sheetName, rowNumber, values, actorName, legacySave, currentCatalog);
  }

  async function bulkSave(sheetName, rows, actorName, legacySave, currentCatalog) {
    const central = client();
    if (central) {
      try {
        const { data: sessionData } = await central.auth.getSession();
        if (sessionData?.session) {
          const { data, error } = await withTimeout(central.schema("boy_central").rpc("bulk_upsert_master_catalog_rows", {
            target_sheet_name: sheetName,
            rows,
            actor_name: actorName || "เจ้าของร้าน"
          }), 30000, "นำเข้าข้อมูลใช้เวลานานเกินไป");
          if (error) throw error;
          const catalog = await remember(sheetName, data, "supabase");
          Promise.resolve().then(() => legacySave("mirror")).catch(() => {});
          return catalog;
        }
      } catch (error) {
        if (!isRetryable(error)) throw error;
      }
    }
    const count = await queueOperation(sheetName, { id: localOperationId(), type: "bulk", rows, actorName: actorName || "เจ้าของร้าน", queuedAt: Date.now() });
    const catalog = mergeLocalBulk(currentCatalog, rows);
    catalog._pendingSyncCount = count;
    const remembered = await remember(sheetName, catalog, "device-cache");
    return remembered;
  }

  async function prefetch(entries, legacyLoader) {
    for (const entry of entries) {
      const sheetName = entry[2];
      if (await cached(sheetName)) continue;
      try { await refresh(sheetName, () => legacyLoader(entry[0]), false); } catch (_) {}
    }
  }

  async function syncPending(sheetName, legacyLoad = () => Promise.reject(new Error("ไม่มีข้อมูลสำรอง"))) {
    return refresh(sheetName, legacyLoad, true);
  }

  async function syncAllPending() {
    if (!navigator.onLine || !client()) return { synced: 0 };
    const entries = (await allEntries()).filter(entry => entry?.kind === "operation-outbox" && entry.targetSheetName);
    let synced = 0;
    for (const entry of entries) {
      try {
        const catalog = await fromSupabase(entry.targetSheetName);
        await remember(entry.targetSheetName, catalog, "supabase");
        synced += 1;
        window.dispatchEvent(new CustomEvent("boy-master-catalog-updated", { detail: { sheetName: entry.targetSheetName, catalog, syncedFromOutbox: true } }));
      } catch (_) {}
    }
    return { synced };
  }

  window.addEventListener("online", () => {
    window.dispatchEvent(new CustomEvent("boy-master-connectivity-restored"));
    syncAllPending().catch(() => {});
  });
  setTimeout(() => syncAllPending().catch(() => {}), 1500);
  setInterval(() => syncAllPending().catch(() => {}), 5 * 60 * 1000);

  window.BOY_MASTER_STORE = { load, save, bulkSave, setActive, applyPatch, refresh, prefetch, cached, pendingCount, syncPending, syncAllPending };
})();

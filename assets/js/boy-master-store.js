(() => {
  "use strict";
  const DB_NAME = "boy-master-catalog-cache-v3";
  const STORE_NAME = "master-catalogs";
  const CACHE_VERSION = 1;
  const SOFT_TTL = 5 * 60 * 1000;
  const OUTBOX_PREFIX = "__outbox-ops__:";
  const ITEM_SHEET = "M_สินค้า";
  const EXPENSE_SHEET = "M_รายการค่าใช้จ่าย";
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
  function isExpenseRow(row) { return row?.__sourceSheet === EXPENSE_SHEET; }
  function rowId(row) { return String(row?.item_id || "").trim(); }
  function sourceSheetFor(row, values) {
    return isExpenseRow(row) || (!row && values?.["ประเภทข้อมูล"] === "EXPENSE_ITEM") ? EXPENSE_SHEET : ITEM_SHEET;
  }
  function normalizeExpenseRow(row) {
    return {
      ...row,
      "ชื่อสินค้า": row["ชื่อรายการค่าใช้จ่าย"] || "",
      "ประเภทข้อมูล": "EXPENSE_ITEM",
      __sourceSheet: EXPENSE_SHEET,
      __sourceRowNumber: row.__rowNumber,
      __rowNumber: `${EXPENSE_SHEET}:${row.__rowNumber}`
    };
  }
  function combineItemCatalog(items, expenses) {
    if (!items?.sheetName || !expenses?.sheetName) throw new Error("ข้อมูลสินค้าและค่าใช้จ่ายจาก Supabase ไม่ครบ");
    return {
      ...items,
      rows: [...(items.rows || []).map(row => ({ ...row, __sourceSheet: ITEM_SHEET })),
        ...(expenses.rows || []).map(normalizeExpenseRow)],
      _expenseCatalog: expenses,
      _source: "supabase"
    };
  }
  function findCurrentRow(catalog, rowNumber, values) {
    const rows = catalog?.rows || [];
    return rows.find(row => rowNumber && String(row.__rowNumber) === String(rowNumber)) ||
      rows.find(row => rowId(row) && rowId(row) === String(values?.item_id || "")) || null;
  }
  function sourcePayload(sheetName, values, existing) {
    const clean = Object.fromEntries(Object.entries(values || {}).filter(([key]) => !key.startsWith("__")));
    if (sheetName !== EXPENSE_SHEET) return clean;
    const allowed = new Set(existing?.headers || []);
    clean["ชื่อรายการค่าใช้จ่าย"] = clean["ชื่อสินค้า"] || existing?.row?.["ชื่อรายการค่าใช้จ่าย"] || "";
    clean.expense_item_id ||= existing?.row?.expense_item_id || `EXP-${Date.now()}${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
    return Object.fromEntries(Object.entries(clean).filter(([key]) => allowed.has(key)));
  }
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
        baseVersion: previous.baseVersion || operation.baseVersion,
        baseRow: previous.baseRow || operation.baseRow,
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

  async function pendingDetails(sheetName) {
    const queued = await cached(operationKey(sheetName));
    return (queued?.operations || []).map(operation => ({
      type: operation.type,
      actionLabel: operation.type === "bulk" ? "แก้ไขหลายรายการ" : operation.rowNumber ? "อัปเดตรายการ" : "เพิ่มรายการ",
      rowNumber: operation.rowNumber || operation.localRowNumber || "",
      id: operation.idValue || operation.values?.item_id || "",
      name: operation.values?.["ชื่อสินค้า"] || operation.values?.["ชื่อรายการค่าใช้จ่าย"] || "",
      rows: operation.type === "bulk" ? operation.rows?.length || 0 : 1,
      reason: operation.conflict || (operation.type === "bulk" ? "ต้องตรวจเทียบข้อมูลหลายรายการก่อนส่ง" : "ยังไม่ได้ตรวจเทียบ Supabase"),
      changes: operation.type === "bulk" ? operation.rows || [] : operation.values || {}
    }));
  }

  async function mergePendingOperations(sheetName, catalog) {
    const queued = await cached(operationKey(sheetName));
    const operations = Array.isArray(queued?.operations) ? queued.operations : [];
    return operations.reduce((current, operation) => {
      if (operation.type === "bulk") return mergeLocalBulk(current, operation.rows || []);
      return mergeLocalSave(current, operation.rowNumber, operation.values || {}, operation.localRowNumber);
    }, catalog);
  }

  function client() {
    if (supabaseClient) return supabaseClient;
    const config = window.BOY_CENTRAL_CONFIG || {};
    if (!window.supabase || !config.url || !config.publishableKey) return null;
    supabaseClient = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    return supabaseClient;
  }

  async function fromSupabase(sheetName, overlayPending = false) {
    const central = client();
    if (!central) throw new Error("Supabase ยังไม่พร้อม");
    const { data: sessionData } = await withTimeout(central.auth.getSession(), 2500, "Supabase ใช้เวลาตอบกลับนานเกินไป");
    if (!sessionData?.session) throw new Error("ยังไม่มีเซสชัน Supabase — กรุณาเข้าสู่ระบบออนไลน์");
    async function getCatalog(name) {
      const { data, error } = await withTimeout(central.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: name }), 8000, "Supabase ใช้เวลาตอบกลับนานเกินไป");
      if (error) throw error;
      if (!data?.sheetName) throw new Error(`ไม่พบ ${name} ใน Supabase`);
      return data;
    }
    const catalog = sheetName === ITEM_SHEET
      ? combineItemCatalog(...await Promise.all([getCatalog(ITEM_SHEET), getCatalog(EXPENSE_SHEET)]))
      : await getCatalog(sheetName);
    return overlayPending ? mergePendingOperations(sheetName, catalog) : catalog;
  }

  async function refresh(sheetName, legacyLoad, notify = true) {
    if (pending.has(sheetName)) return pending.get(sheetName);
    const task = (async () => {
      let catalog;
      let source = "supabase";
      try {
        catalog = await fromSupabase(sheetName);
      }
      catch (supabaseError) {
        const local = await cached(sheetName);
        if (!local?.catalog) throw supabaseError;
        source = "device-cache";
        catalog = { ...local.catalog, _source: source, _supabaseError: supabaseError?.message || String(supabaseError) };
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

  async function save(sheetName, rowNumber, values, actorName, legacySave, currentCatalog) {
    const central = client();
    const currentRow = findCurrentRow(currentCatalog, rowNumber, values);
    const targetSheet = sheetName === ITEM_SHEET ? sourceSheetFor(currentRow, values) : sheetName;
    let committed = false;
    if (central) {
      try {
        const { data: sessionData } = await central.auth.getSession();
        if (!sessionData?.session) throw new Error("กรุณาเข้าสู่ระบบออนไลน์ด้วยบัญชี Supabase ก่อนบันทึก — PIN ในเครื่องไม่ใช่การเข้าสู่ระบบออนไลน์");
        const sourceCatalog = targetSheet === EXPENSE_SHEET ? currentCatalog?._expenseCatalog : currentCatalog;
        const sourceRow = targetSheet === EXPENSE_SHEET
          ? (sourceCatalog?.rows || []).find(row => row.expense_item_id === currentRow?.expense_item_id)
          : currentRow;
        const payload = sourcePayload(targetSheet, values, { headers: sourceCatalog?.headers || [], row: sourceRow });
        if (sourceRow?.__version) payload.__version = sourceRow.__version;
        const { error } = await withTimeout(central.schema("boy_central").rpc("bulk_upsert_master_catalog_rows", {
            target_sheet_name: targetSheet,
            rows: [payload],
            actor_name: actorName || "เจ้าของร้าน"
          }), 15000, "Supabase ใช้เวลาตอบกลับนานเกินไป");
          if (error) throw error;
        committed = true;
        const catalog = await fromSupabase(sheetName);
        try { await legacySave("mirror"); catalog._mirrorStatus = "synced"; }
        catch (mirrorError) { catalog._mirrorStatus = "failed"; catalog._mirrorError = mirrorError?.message || String(mirrorError); }
        return remember(sheetName, catalog, "supabase");
      } catch (error) {
        if (committed) throw new Error(`บันทึกใน Supabase แล้ว แต่โหลดผลกลับไม่สำเร็จ: ${error?.message || error} — อย่ากดบันทึกซ้ำ ให้รีเฟรชตรวจรายการก่อน`);
        if (/เซสชัน|เข้าสู่ระบบออนไลน์/.test(error?.message || "")) throw error;
        if (!isRetryable(error)) throw error;
      }
    }
    if (navigator.onLine && !central) throw new Error("Supabase ไม่พร้อม — ยังไม่ได้บันทึกออนไลน์ กรุณาลองใหม่");
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
      sourceSheet: targetSheet,
      baseVersion: currentRow?.__version || "",
      baseRow: currentRow || null,
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
    let committedGroups = 0;
    if (central) {
      try {
        const { data: sessionData } = await central.auth.getSession();
        if (!sessionData?.session) throw new Error("กรุณาเข้าสู่ระบบออนไลน์ด้วยบัญชี Supabase ก่อนบันทึก — PIN ในเครื่องไม่ใช่การเข้าสู่ระบบออนไลน์");
        const groups = new Map();
        for (const row of rows) {
          const currentRow = findCurrentRow(currentCatalog, null, row);
          const targetSheet = sheetName === ITEM_SHEET ? sourceSheetFor(currentRow, row) : sheetName;
          const sourceCatalog = targetSheet === EXPENSE_SHEET ? currentCatalog?._expenseCatalog : currentCatalog;
          const sourceRow = targetSheet === EXPENSE_SHEET
            ? (sourceCatalog?.rows || []).find(item => item.expense_item_id === currentRow?.expense_item_id)
            : currentRow;
          const payload = sourcePayload(targetSheet, row, { headers: sourceCatalog?.headers || [], row: sourceRow });
          if (sourceRow?.__version) payload.__version = sourceRow.__version;
          if (!groups.has(targetSheet)) groups.set(targetSheet, []);
          groups.get(targetSheet).push(payload);
        }
        for (const [targetSheet, payloads] of groups) {
          const { error } = await withTimeout(central.schema("boy_central").rpc("bulk_upsert_master_catalog_rows", {
            target_sheet_name: targetSheet,
            rows: payloads,
            actor_name: actorName || "เจ้าของร้าน"
          }), 30000, "นำเข้าข้อมูลใช้เวลานานเกินไป");
          if (error) throw error;
          committedGroups++;
        }
        const catalog = await fromSupabase(sheetName);
        try { await legacySave("mirror"); catalog._mirrorStatus = "synced"; }
        catch (mirrorError) { catalog._mirrorStatus = "failed"; catalog._mirrorError = mirrorError?.message || String(mirrorError); }
        return remember(sheetName, catalog, "supabase");
      } catch (error) {
        if (committedGroups) throw new Error(`บันทึกใน Supabase ไปแล้ว ${committedGroups} กลุ่ม แต่ขั้นตอนถัดไปไม่สำเร็จ: ${error?.message || error} — กรุณารีเฟรชตรวจสอบก่อนทำซ้ำ`);
        if (/เซสชัน|เข้าสู่ระบบออนไลน์/.test(error?.message || "")) throw error;
        if (!isRetryable(error)) throw error;
      }
    }
    if (navigator.onLine && !central) throw new Error("Supabase ไม่พร้อม — ยังไม่ได้บันทึกออนไลน์ กรุณาลองใหม่");
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

  async function syncPending(sheetName) {
    const queued = await cached(operationKey(sheetName));
    const operations = Array.isArray(queued?.operations) ? queued.operations.slice() : [];
    if (!operations.length) return { cleared: 0, sent: 0, conflicts: 0 };
    const central = client();
    if (!central || !(await central.auth.getSession()).data?.session) throw new Error("กรุณาเข้าสู่ระบบ Supabase ก่อนตรวจคิว");
    let cleared = 0, sent = 0, conflicts = 0;
    while (operations.length) {
      const operation = operations[0];
      const remote = await fromSupabase(sheetName, false);
      const id = String(operation.idValue || operation.values?.[operation.idHeader] || "").trim();
      const matching = id && (remote.rows || []).find(row => String(row[operation.idHeader] || "") === id);
      const desired = operation.values || {};
      const comparable = Object.entries(desired).filter(([key, value]) => !key.startsWith("__") && !(key === operation.idHeader && !value));
      const sameNameRows = (remote.rows || []).filter(row => String(row["ชื่อสินค้า"] || "").trim() === String(desired["ชื่อสินค้า"] || "").trim());
      const alreadySaved = matching || (!id && sameNameRows.length === 1 ? sameNameRows[0] : null);
      if (operation.type === "save" && alreadySaved && comparable.every(([key, value]) => String(alreadySaved[key] ?? "") === String(value ?? ""))) {
        operations.shift(); cleared++;
      } else if (operation.type === "save" && operation.baseVersion && matching?.__version === operation.baseVersion) {
        const targetSheet = operation.sourceSheet || sourceSheetFor(matching, desired);
        const sourceCatalog = targetSheet === EXPENSE_SHEET ? remote._expenseCatalog : remote;
        const sourceRow = targetSheet === EXPENSE_SHEET
          ? sourceCatalog?.rows?.find(row => row.expense_item_id === matching.expense_item_id) : matching;
        const payload = sourcePayload(targetSheet, desired, { headers: sourceCatalog?.headers || [], row: sourceRow });
        payload.__version = matching.__version;
        const { error } = await central.schema("boy_central").rpc("bulk_upsert_master_catalog_rows", {
          target_sheet_name: targetSheet, rows: [payload], actor_name: operation.actorName || "ส่งข้อมูลที่รอในเครื่อง"
        });
        if (error) throw error;
        operations.shift(); sent++;
      } else {
        operation.conflict = !id ? "คิวเก่าไม่มีรหัสสินค้า — ต้องจับคู่ด้วยตนเอง" : matching
          ? "ข้อมูลใน Supabase ต่างจากเครื่องนี้ — หยุดเพื่อป้องกันการเขียนทับ"
          : sameNameRows.length ? "พบชื่อเดียวกันแต่รหัสต่างกัน — ต้องตรวจสอบก่อนเพิ่ม" : "ยังไม่มีข้อมูลต้นทางยืนยัน — ต้องตรวจสอบก่อนเพิ่ม";
        operations[0] = operation; conflicts++;
        break;
      }
      if (operations.length) await putEntry({ ...queued, operations, queuedAt: Date.now() });
      else await remove(operationKey(sheetName));
    }
    if (operations.length) await putEntry({ ...queued, operations, queuedAt: Date.now() });
    window.dispatchEvent(new CustomEvent("boy-master-outbox-updated", { detail: { sheetName, count: operations.length } }));
    const catalog = await refresh(sheetName, null, true);
    return { cleared, sent, conflicts, remaining: operations.length, catalog };
  }

  async function syncAllPending() {
    const entries = (await allEntries()).filter(entry => entry?.kind === "operation-outbox" && entry.targetSheetName);
    const results = [];
    for (const entry of entries) results.push({ sheetName: entry.targetSheetName, ...await syncPending(entry.targetSheetName) });
    return results;
  }

  window.addEventListener("online", () => window.dispatchEvent(new CustomEvent("boy-master-connectivity-restored")));

  window.BOY_MASTER_STORE = { load, save, bulkSave, setActive, refresh, prefetch, cached, pendingCount, pendingDetails, syncPending, syncAllPending };
})();

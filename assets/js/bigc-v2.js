(() => {
  "use strict";
  const DEMO_MODE = document.body.dataset.demo === "true";
  const DEMO_STORE = DEMO_MODE ? globalThis.BOYBigCDemo.createStore() : null;
  const STORAGE_PREFIX = DEMO_MODE ? "boy-bigc-demo:" : "boy-bigc-v2-";
  const BRANCH_CODE = "BIGC-CENTRAL-PATTAYA";
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec";
  const CLOUD_DRAFT_DELAY = 8000;
  const SETTINGS_CACHE_KEY = STORAGE_PREFIX + "settings-cache";
  const SETTINGS_PENDING_KEY = STORAGE_PREFIX + "settings-pending";
  const STAFF_SORT_KEY = STORAGE_PREFIX + "staff-sort-v1";
  const REQUESTED_VIEW = new URLSearchParams(location.search).get("view") === "staff" ? "staff" : "admin";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const { codesFor: masterItemCodes, withCodes: withMasterItemCodes, canonicalCodeFor, matchesSearch: matchesMasterSearch } = globalThis.BOYBigCMasterMapping;
  const number = (value) => Math.max(0, Number(value) || 0);
  const money = (value) => number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  };
  const state = {
    client: null, session: null, branch: null, context: null, contexts: {}, menu: [], selectedSettingsKeys: new Set(), selectingSettings: false, deletingSettings: false,
    order: {}, receive: {}, returns: {}, receiveHistory: [], receiveRounds: [], receiveExpanded: new Set(), receiveTopRoundId: "", orderHistory: [], activeTab: "close", pickerTarget: "receive", sortMode: "categories", sortCategory: "", settingsSection: "", editingKey: "",
    cloudTimer: 0, cloudDraftPromise: null, saving: false, started: false, authContext: null, access: null, sortSnapshot: null, mappingDirty: false, editingMasterCodes: [], settingsConflict: "",
    fruitCostItems: [], fruitCostRules: [], fruitWeights: [], fruitYieldRows: [], masterItems: [], normalizedItemsByCode: new Map(), normalizedRowsByCode: new Map(), masterItemsByCode: new Map(), sharedStockVariants: new Map()
  };

  function keyFor(name, unit = "") {
    const source = `${name}|${unit}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `item-${(hash >>> 0).toString(16)}`;
  }

  function draftKey(type, date) { return `${STORAGE_PREFIX}draft:${type}:${date}`; }
  function blankDraft() { return { savedAt: 0, dates: { order: today(), receive: today(), returns: today() }, revenue: { cash: "", transfer: "", thai: "" }, order: {}, receive: {}, returns: {} }; }
  function readLocalDraft() {
    const dates = { order: $("#orderDate").value || today(), receive: $("#receiveDate").value || today(), returns: $("#returnDate").value || today() };
    try {
      const order = JSON.parse(localStorage.getItem(draftKey("order", dates.order)) || "{}");
      const receive = JSON.parse(localStorage.getItem(draftKey("receive", dates.receive)) || "{}");
      const returned = JSON.parse(localStorage.getItem(draftKey("returns", dates.returns)) || "{}");
      return { ...blankDraft(), dates, savedAt: Math.max(order.savedAt || 0, receive.savedAt || 0, returned.savedAt || 0), savedAtByType: { order: order.savedAt || 0, receive: receive.savedAt || 0, returns: returned.savedAt || 0 }, order: order.order || {}, receive: receive.receive || {}, returns: returned.returns || {}, revenue: returned.revenue || blankDraft().revenue };
    } catch (_) { return { ...blankDraft(), dates }; }
  }
  function currentDraft(type = state.activeTab === "close" ? "order" : state.activeTab === "return" ? "returns" : "receive") {
    const dates = { order: $("#orderDate").value, receive: $("#receiveDate").value, returns: $("#returnDate").value };
    const draft = {
      business_date: dates[type],
      savedAt: Date.now(),
      dates
    };
    if (type === "order") draft.order = state.order;
    if (type === "receive") draft.receive = state.receive;
    if (type === "returns") {
      draft.returns = state.returns;
      draft.revenue = { cash: $("#cashAmount").value, transfer: $("#transferAmount").value, thai: $("#thaiAmount").value };
    }
    return draft;
  }
  function activeDate() {
    return state.activeTab === "receive" ? $("#receiveDate").value : state.activeTab === "return" ? $("#returnDate").value : $("#orderDate").value;
  }
  function saveDraft() {
    const draft = currentDraft();
    const savedAt = Date.now();
    localStorage.setItem(draftKey("order", draft.dates.order), JSON.stringify({ savedAt, order: state.order }));
    localStorage.setItem(draftKey("receive", draft.dates.receive), JSON.stringify({ savedAt, receive: state.receive }));
    localStorage.setItem(draftKey("returns", draft.dates.returns), JSON.stringify({ savedAt, returns: state.returns, revenue: { cash: $("#cashAmount").value, transfer: $("#transferAmount").value, thai: $("#thaiAmount").value } }));
    setSync("บันทึกในเครื่องแล้ว", "pending");
    window.clearTimeout(state.cloudTimer);
    state.cloudTimer = window.setTimeout(() => { state.cloudDraftPromise = saveCloudDraft(draft); }, CLOUD_DRAFT_DELAY);
  }
  async function saveCloudDraft(draft = currentDraft()) {
    if (DEMO_MODE) return true;
    if (!state.session) { setSync("ต้องเชื่อม Supabase", "error"); return false; }
    if (!navigator.onLine) { setSync("ออฟไลน์ · รอส่งข้อมูล", "pending"); return false; }
    const { error } = await state.client.schema("boy_central").rpc("save_bigc_v2_draft", { payload: draft });
    if (error) { setSync("รอส่งข้อมูล", "error"); notice(`ร่างเก็บไว้ในเครื่องแล้ว แต่ส่ง Supabase ไม่สำเร็จ: ${error.message}`, true); return false; }
    setSync("บันทึกแล้ว", "ok"); return true;
  }

  function setSync(text, tone = "pending") {
    const badge = $("#syncBadge");
    badge.textContent = text;
    badge.className = `sync-badge ${tone === "ok" ? "" : tone}`;
  }
  function notice(text, isError = false) {
    const box = $("#pageNotice"); box.textContent = text || ""; box.classList.toggle("error", isError);
  }
  function showActionToast(message, tone = "ok") {
    const toast = $("#actionToast");
    toast.textContent = message;
    toast.className = `action-toast ${tone === "ok" ? "" : tone}`;
    window.clearTimeout(showActionToast.timer);
    showActionToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 9000);
  }
  function orderSubmissionKey(date) { return `${STORAGE_PREFIX}order-submission:${date}`; }
  function submissionIdFor(date, lines) {
    const fingerprint = JSON.stringify(lines);
    let saved;
    try { saved = JSON.parse(localStorage.getItem(orderSubmissionKey(date)) || "null"); } catch (_) { /* create a fresh ID */ }
    if (saved?.fingerprint === fingerprint && saved.id) return saved.id;
    const id = crypto.randomUUID();
    localStorage.setItem(orderSubmissionKey(date), JSON.stringify({ id, fingerprint }));
    return id;
  }
  function showSettingsConnection(visible, message = "เชื่อมต่อบัญชีออนไลน์เพื่อให้การตั้งค่าไม่หายและใช้ได้ทุกเครื่อง") {
    const warning = $("#settingsSyncWarning");
    if (!warning) return;
    warning.hidden = !visible;
    $("#settingsSyncMessage").textContent = message;
  }
  function loading(text, active = true) { $("#loadingText").textContent = text; $("#loadingOverlay").classList.toggle("hidden", !active); }

  async function sheetApi(action, payload = {}) {
    if (DEMO_MODE) throw new Error("โหมดทดลองไม่ส่งข้อมูลออนไลน์");
    const response = await fetch(WEB_APP_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action, ...payload }) });
    const data = await response.json();
    if (!response.ok || !["success", "Success"].includes(data.status)) throw new Error(data.message || "Google Sheets ตอบกลับผิดปกติ");
    return data;
  }

  function normalizeMenu(database) {
    const weights = new Set(database?.weightItems || []);
    const mappings = database?.itemMappings || {};
    const output = [];
    Object.entries(database?.categories || {}).forEach(([category, names]) => {
      (names || []).forEach((displayName, index) => {
        const match = String(displayName).match(/^(.*)\s+\(([^()]*)\)$/);
        const name = match?.[1]?.trim() || String(displayName).trim();
        const unit = match?.[2]?.trim() || "";
        output.push({
          key: keyFor(displayName, unit), displayName, name: mappings[displayName] || name,
          category, unit, inputMode: weights.has(displayName) ? "weight" : "quantity",
          active: true, defaultReturn: false, sortOrder: output.length + index
        });
      });
    });
    return output;
  }

  async function loadLegacyMenu() {
    try {
      const result = await sheetApi("bigcOrderLoadDB");
      const menu = normalizeMenu(result.database || {});
      localStorage.setItem("boy-bigc-v2-menu-cache", JSON.stringify(menu));
      return menu;
    } catch (_) {
      try { return JSON.parse(localStorage.getItem("boy-bigc-v2-menu-cache") || "[]"); }
      catch (_) { return []; }
    }
  }

  function settingsMenu(settings, fallback) {
    const configured = Array.isArray(settings?.menu_config) ? settings.menu_config : [];
    if (!configured.length) return fallback;
    const defaultKeys = new Set(settings?.default_return_keys || []);
    return configured.map((item, index) => withMasterItemCodes({
      key: item.key || keyFor(item.displayName || item.item_name, item.unit),
      displayName: item.displayName || item.item_name, name: item.name || item.item_name,
      category: item.category || "อื่นๆ", unit: item.unit || "",
      inputMode: item.inputMode === "weight" ? "weight" : "quantity",
      active: item.active !== false, defaultReturn: defaultKeys.has(item.key), sortOrder: Number(item.sortOrder ?? index),
      handlingType: item.handlingType || item.handling_type || "", costingBasis: item.costingBasis || item.costing_basis || "",
      itemId: item.itemId || item.item_id || null,
      stockAtBigc: item.stockAtBigc === true, deductTawanaStock: item.deductTawanaStock === true
    }, masterItemCodes(item), item.masterItemId || item.master_item_id || "")).sort((left, right) => left.sortOrder - right.sortOrder);
  }

  function readStoredJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }
  function isStaffView() { return REQUESTED_VIEW === "staff" || state.access?.canManage === false; }
  function staffLink() {
    const url = new URL("bigc-v2.html", location.href);
    url.search = "?view=staff&online=1";
    return url.href;
  }
  function applyStaffSort(menu) {
    if (!isStaffView()) return menu;
    const keys = readStoredJson(STAFF_SORT_KEY);
    if (!Array.isArray(keys) || !keys.length) return menu;
    const rank = new Map(keys.map((key, index) => [key, index]));
    return menu.map((item, index) => ({ item, index })).sort((left, right) =>
      (rank.get(left.item.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.item.key) ?? Number.MAX_SAFE_INTEGER) || left.index - right.index
    ).map((row) => row.item);
  }
  async function loadAccess() {
    if (state.access) return state.access;
    if (!state.session) {
      state.access = { canManage: Boolean(state.authContext?.localAccess), companyRole: state.authContext?.localAccess ? "admin" : "staff", branchRole: null };
      return state.access;
    }
    const userId = state.session.user.id;
    const [profileResult, roleResult] = await Promise.all([
      state.client.schema("boy_central").from("profiles").select("company_role,active").eq("user_id", userId).maybeSingle(),
      state.client.schema("boy_central").from("user_branch_roles").select("role,active").eq("user_id", userId).eq("branch_id", state.branch.id).maybeSingle()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (roleResult.error) throw roleResult.error;
    const companyRole = profileResult.data?.company_role || "staff";
    const branchRole = roleResult.data?.active === false ? null : roleResult.data?.role || null;
    state.access = {
      companyRole, branchRole,
      canManage: profileResult.data?.active !== false && (companyRole === "admin" || ["admin", "manager"].includes(branchRole))
    };
    return state.access;
  }
  function applyAccessMode() {
    const staff = isStaffView();
    document.body.classList.toggle("staff-view", staff);
    $("#settingsButton").hidden = false;
    $("#staffSortButton").hidden = !staff;
    $("#branchModeLabel").textContent = staff ? "เวอร์ชันพนักงาน" : "BOY Operation · เวอร์ชันเต็ม";
    $("#openStaffLink").href = staffLink();
  }
  function settingsPayload(menu = state.menu) {
    return {
      menu_config: menu.map((item) => withMasterItemCodes(item, masterItemCodes(item), item.masterItemId || "")),
      default_return_keys: menu.filter((item) => item.defaultReturn).map((item) => item.key),
      savedAt: Date.now()
    };
  }
  function settingsFingerprint(payload) {
    const menu = Array.isArray(payload?.menu_config) ? payload.menu_config : [];
    const normalized = menu.map((item, index) => ({
      key: item.key || "", displayName: item.displayName || item.item_name || "", name: item.name || item.item_name || "",
      category: item.category || "อื่นๆ", unit: item.unit || "", inputMode: item.inputMode === "weight" ? "weight" : "quantity",
      handlingType: item.handlingType || item.handling_type || "", costingBasis: item.costingBasis || item.costing_basis || "",
      itemId: item.itemId || item.item_id || null, masterItemId: item.masterItemId || item.master_item_id || null,
      masterItemIds: masterItemCodes(item),
      stockAtBigc: item.stockAtBigc === true, deductTawanaStock: item.deductTawanaStock === true,
      active: item.active !== false, sortOrder: Number(item.sortOrder ?? index)
    })).sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key));
    return JSON.stringify({ menu: normalized, returns: [...(payload?.default_return_keys || [])].sort() });
  }
  function cacheSettings(payload, pending = false) {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(payload));
    if (pending) {
      const previous = readStoredJson(SETTINGS_PENDING_KEY);
      localStorage.setItem(SETTINGS_PENDING_KEY, JSON.stringify({
        ...payload,
        _baseFingerprint: previous?._baseFingerprint || (state.context?.settings ? settingsFingerprint(state.context.settings) : null)
      }));
    }
  }
  async function uploadSettingsPayload(payload) {
    const cleanPayload = { menu_config: payload.menu_config || [], default_return_keys: payload.default_return_keys || [] };
    const { error } = await state.client.schema("boy_central").rpc("save_bigc_v2_settings", { payload: cleanPayload });
    if (error) throw error;
    const { data, error: verifyError } = await state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: activeDate() || today() });
    if (verifyError) throw verifyError;
    if (settingsFingerprint(data?.settings || {}) !== settingsFingerprint(cleanPayload)) throw new Error("ตรวจสอบการตั้งค่าที่บันทึกแล้วไม่ตรงกัน");
    localStorage.removeItem(SETTINGS_PENDING_KEY);
    cacheSettings(payload, false);
    if (state.context) state.context.settings = data.settings;
    showSettingsConnection(false);
    return data.settings;
  }
  async function flushPendingSettings(quiet = false) {
    const pending = readStoredJson(SETTINGS_PENDING_KEY);
    if (!pending || !state.session || !navigator.onLine) return false;
    try {
      const { data: current, error: readError } = await state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: activeDate() || today() });
      if (readError) throw readError;
      const cloudFingerprint = settingsFingerprint(current?.settings || {});
      if (settingsFingerprint(pending) === cloudFingerprint) {
        localStorage.removeItem(SETTINGS_PENDING_KEY);
        state.settingsConflict = "";
        return true;
      }
      if (!pending._baseFingerprint || pending._baseFingerprint !== cloudFingerprint) {
        state.settingsConflict = "ข้อมูลตั้งค่าออนไลน์เปลี่ยนจากอีกเครื่องแล้ว ระบบเก็บฉบับในเครื่องไว้แต่ไม่ส่งทับ กรุณาตรวจรายการก่อนบันทึกใหม่";
        if (!quiet) { setSync("การตั้งค่าต้องตรวจสอบ", "error"); notice(state.settingsConflict, true); }
        return false;
      }
      await uploadSettingsPayload(pending);
      state.settingsConflict = "";
      if (!quiet) { setSync("ส่งการตั้งค่าแล้ว", "ok"); notice("ส่งการตั้งค่าที่ค้างไว้เรียบร้อย"); }
      return true;
    } catch (error) {
      if (!quiet) {
        setSync("การตั้งค่ารอส่ง", "pending");
        showSettingsConnection(true, `ส่งไม่สำเร็จ: ${error.message}`);
        notice(`เก็บการตั้งค่าไว้ในเครื่องแล้ว รอส่งใหม่: ${error.message}`, true);
      }
      return false;
    }
  }

  async function loadPage() {
    if (DEMO_MODE) { loadDemoPage(); return true; }
    state.receiveHistory = null; state.receiveRounds = null; state.orderHistory = null;
    loading("กำลังโหลดข้อมูล"); notice("");
    try {
      await flushPendingSettings(true);
      const dates = { order: $("#orderDate").value, receive: $("#receiveDate").value, returns: $("#returnDate").value };
      const requests = {};
      Object.values(dates).forEach((date) => { if (!requests[date]) requests[date] = state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: date }); });
      const resolved = Object.fromEntries(await Promise.all(Object.entries(requests).map(async ([date, request]) => {
        const { data, error } = await request; if (error) throw error; return [date, data || {}];
      })));
      state.contexts = { order: resolved[dates.order], receive: resolved[dates.receive], returns: resolved[dates.returns] };
      const [historyResult, roundsResult, orderHistoryResult] = await Promise.all([
        state.client.schema("boy_central").rpc("get_bigc_v2_receive_history", { target_date: dates.receive }),
        state.client.schema("boy_central").rpc("get_bigc_v2_receive_order_rounds", { target_date: dates.receive }),
        state.client.schema("boy_central").rpc("get_bigc_v2_order_history", { max_rows: 30 })
      ]);
      state.receiveHistory = historyResult.error ? null : historyResult.data || [];
      if (roundsResult.error) throw roundsResult.error;
      state.receiveRounds = roundsResult.data || [];
      state.orderHistory = orderHistoryResult.error ? null : orderHistoryResult.data || [];
      state.context = state.activeTab === "receive" ? state.contexts.receive : state.activeTab === "return" ? state.contexts.returns : state.contexts.order;
      state.branch = state.context.branch;
      await loadAccess();
      await loadMasterItems(true);
      const localSettings = readStoredJson(SETTINGS_PENDING_KEY) || readStoredJson(SETTINGS_CACHE_KEY);
      const cloudHasMenu = Array.isArray(state.context.settings?.menu_config) && state.context.settings.menu_config.length > 0;
      const localHasMenu = Array.isArray(localSettings?.menu_config) && localSettings.menu_config.length > 0;
      const legacyMenu = cloudHasMenu || localHasMenu ? [] : await loadLegacyMenu();
      state.menu = applyStaffSort(settingsMenu(state.context.settings, settingsMenu(localSettings, legacyMenu)));
      const localDraft = readLocalDraft();
      const orderCloud = state.contexts.order.draft || {};
      const receiveCloud = state.contexts.receive.draft || {};
      const returnCloud = state.contexts.returns.draft || {};
      const draft = {
        ...blankDraft(), dates,
        order: Number(orderCloud.savedAt || 0) > Number(localDraft.savedAtByType?.order || 0) ? orderCloud.order || {} : localDraft.order,
        receive: Number(receiveCloud.savedAt || 0) > Number(localDraft.savedAtByType?.receive || 0) ? receiveCloud.receive || {} : localDraft.receive,
        returns: Number(returnCloud.savedAt || 0) > Number(localDraft.savedAtByType?.returns || 0) ? returnCloud.returns || {} : localDraft.returns,
        revenue: Number(returnCloud.savedAt || 0) > Number(localDraft.savedAtByType?.returns || 0) ? returnCloud.revenue || blankDraft().revenue : localDraft.revenue
      };
      hydrateDraft(draft);
      hydrateSubmitted([
        ...(state.contexts.order.workflows || []).filter((row) => row.workflow_type === "close_order"),
        ...(state.contexts.receive.workflows || []).filter((row) => row.workflow_type === "receive"),
        ...(state.contexts.returns.workflows || []).filter((row) => row.workflow_type === "return")
      ]);
      seedReceiveFromRounds(state.receiveRounds,
        (state.contexts.receive.workflows || []).filter((row) => row.workflow_type === "receive"));
      seedDefaultReturns();
      renderAll();
      applyAccessMode();
      const pending = (state.context.pending_sheet_sync || []).length;
      const settingsPending = Boolean(readStoredJson(SETTINGS_PENDING_KEY));
      setSync(state.settingsConflict ? "การตั้งค่าต้องตรวจสอบ" : settingsPending ? "การตั้งค่ารอส่ง" : pending ? `รอส่งชีต ${pending}` : "ข้อมูลพร้อม", state.settingsConflict ? "error" : settingsPending || pending ? "pending" : "ok");
      return true;
    } catch (error) {
      const draft = readLocalDraft(); hydrateDraft(draft);
      if (!state.menu.length) state.menu = settingsMenu(readStoredJson(SETTINGS_PENDING_KEY) || readStoredJson(SETTINGS_CACHE_KEY), await loadLegacyMenu());
      renderAll(); setSync("ใช้งานในเครื่อง", "error"); notice(`โหลดฐานข้อมูลกลางไม่สำเร็จ: ${error.message}`, true);
      return false;
    } finally { loading("", false); }
  }

  function hydrateDraft(draft) {
    state.order = draft.order || {}; state.receive = draft.receive || {}; state.returns = draft.returns || {};
    renderDateDisplays();
    $("#cashAmount").value = draft.revenue?.cash || "";
    $("#transferAmount").value = draft.revenue?.transfer || "";
    $("#thaiAmount").value = draft.revenue?.thai || "";
  }
  function hydrateSubmitted(workflows) {
    const close = workflows.find((row) => row.workflow_type === "close_order");
    const receive = workflows.find((row) => row.workflow_type === "receive");
    const returned = workflows.find((row) => row.workflow_type === "return");
    if (returned) {
      if (!Object.keys(state.returns).length) state.returns = Object.fromEntries((returned.lines || []).map((line) => [line.line_key, { ...line }]));
      if (!$("#cashAmount").value && !$("#transferAmount").value && !$("#thaiAmount").value) {
        $("#cashAmount").value = returned.cash_amount || ""; $("#transferAmount").value = returned.transfer_amount || ""; $("#thaiAmount").value = returned.thai_chuay_thai_amount || "";
      }
    }
    return { close: Boolean(close), receive: Boolean(receive), returned: Boolean(returned) };
  }
  function newReceiptKey() { return `receipt-${crypto.randomUUID()}`; }
  function seedReceiveFromPrevious(previous, receivedWorkflows = []) {
    const received = receivedWorkflows.flatMap((workflow) => workflow.lines || []);
    const completedKeys = new Set(received.map((line) => line.line_key));
    const completedSources = new Set(received.map((line) => line.source_line_key
      || (line.line_key?.startsWith("receipt-") ? "" : line.line_key)).filter(Boolean));
    Object.entries(state.receive).forEach(([key, line]) => {
      if (completedKeys.has(line.receipt_key)
        || (line.source_line_key && completedSources.has(line.source_line_key))
        || (!line.receipt_key && completedSources.has(key))) delete state.receive[key];
      else line.receipt_key ||= newReceiptKey();
    });
    (previous?.lines || []).forEach((line) => {
      if (state.receive[line.line_key] || completedSources.has(line.line_key)) return;
      const item = findMenu(line.line_key, line);
      state.receive[line.line_key] = { ...line, input_mode: item.inputMode,
        source_line_key: line.line_key, receipt_key: newReceiptKey(), checked: false };
    });
    $("#receiveSourceLabel").textContent = Object.keys(state.receive).length
      ? previous?.business_date ? `จากรายการสั่งวันที่ ${previous.business_date}` : "รายการรอรับ"
      : received.length ? "รับรายการครบแล้ว · เพิ่มรายการระหว่างวันได้" : "รายการรอรับ";
  }
  function seedReceiveFromRounds(rounds, receivedWorkflows = []) {
    const received = receivedWorkflows.flatMap((workflow) => workflow.lines || []);
    const completedKeys = new Set(received.map((line) => line.line_key));
    const completedSources = new Set(received.map((line) => line.source_line_key
      || (line.line_key?.startsWith("receipt-") ? "" : line.line_key)).filter(Boolean));
    Object.entries(state.receive).forEach(([key, line]) => {
      if (completedKeys.has(line.receipt_key) || (line.source_line_key && completedSources.has(line.source_line_key))) delete state.receive[key];
      else line.receipt_key ||= newReceiptKey();
    });
    [...rounds].reverse().forEach((round) => (round.lines || []).forEach((line) => {
      const sourceKey = `${round.id}:${line.line_key}`;
      if (completedSources.has(sourceKey) || (round.legacy && completedSources.has(line.line_key))) {
        delete state.receive[sourceKey];
        if (round.legacy) delete state.receive[line.line_key];
        return;
      }
      const oldByName = state.receive[line.line_key];
      const oldDraft = state.receive[sourceKey] || (oldByName?.source_line_key === line.line_key ? oldByName : null);
      if (oldDraft === state.receive[line.line_key]) delete state.receive[line.line_key];
      const item = findMenu(line.line_key, line);
      state.receive[sourceKey] = { ...line, ...oldDraft, source_round_id: round.id,
        source_workflow_id: round.workflow_id, source_line_key: sourceKey,
        receipt_key: oldDraft?.receipt_key || newReceiptKey(),
        input_mode: oldDraft?.input_mode || item.inputMode, checked: oldDraft?.checked === true };
    }));
    const top = rounds[0]?.id || "";
    if (state.receiveTopRoundId !== top) {
      state.receiveTopRoundId = top;
      state.receiveExpanded = new Set(top ? [top] : []);
    }
    $("#receiveSourceLabel").textContent = rounds.length ? `${rounds.length} ใบสั่งของ` :
      received.length ? "รับรายการครบแล้ว · เพิ่มรายการระหว่างวันได้" : "รายการรอรับ";
  }
  function seedDefaultReturns() {
    if (Object.keys(state.returns).length) return;
    state.menu.filter((item) => item.active && item.defaultReturn).forEach((item) => { state.returns[item.key] = lineFromMenu(item, 0); });
  }
  function addMissingDefaultReturns() {
    state.menu.filter((item) => item.active && item.defaultReturn && !state.returns[item.key]).forEach((item) => { state.returns[item.key] = lineFromMenu(item, 0); });
  }
  function lineFromMenu(item, quantity = 0, inputMode = item.inputMode) {
    const handlingType = receiveHandlingType(item);
    return {
      line_key: item.key, item_name: item.displayName, category_name: item.category, unit_name: item.unit,
      input_mode: inputMode, quantity, received: true, sort_order: item.sortOrder,
      item_id: item.itemId || item.item_id || null, master_item_id: item.masterItemId || item.master_item_id || null,
      handling_type: handlingType, costing_basis: receiveCostingBasis(item, handlingType)
    };
  }

  function isFrozenFruit(item) { return /ผลไม้แช่แข็ง/.test(item.category || ""); }
  function isWeighedFruitCategory(item) { return /(?:^|\s)ผลไม้(?:\s*\(ใส่กล่อง\))?$/.test(item.category || ""); }
  function receiveHandlingType(item) {
    if (!isWeighedFruitCategory(item)) return item.handlingType === "consignment"
      || /ฝากขาย|น้ำส้ม\s*\(ขวด\)/.test(`${item.displayName || ""} ${item.name || ""}`) ? "consignment" : "standard";
    if (item.handlingType) return item.handlingType;
    const text = `${item.category || ""} ${item.displayName || ""} ${item.name || ""}`.toLowerCase();
    if (/ฝากขาย/.test(text) || /น้ำส้ม\s*\(ขวด\)/.test(text)) return "consignment";
    if (/ปอก|ใส่กล่อง|\(กล่อง\)|คั้น|น้ำผลไม้|น้ำส้ม/.test(text)) return /คั้น|น้ำผลไม้|น้ำส้ม/.test(text) ? "juiced" : "prepared";
    if (/ผลไม้|แตงโม|สับปะรด|มะม่วง|อโวคาโด|อาโวคาโด|ส้ม|มะนาว|มะพร้าว|มะละกอ|เมลอน|แคนตาลูป|เสาวรส/.test(text)) return "whole_fruit";
    return "standard";
  }
  function receiveCostingBasis(item, handlingType = receiveHandlingType(item)) {
    if (!isWeighedFruitCategory(item)) return handlingType === "consignment" ? "consignment" : "backend";
    if (isPieceEstimatedFruit(item) && handlingType === "whole_fruit") return "estimated_raw_piece";
    if (item.costingBasis) return item.costingBasis;
    return handlingType === "consignment" ? "consignment" : handlingType === "standard" ? "backend" : handlingType === "whole_fruit" ? "actual_raw_weight_kg" : "backend_yield_from_actual_weight";
  }
  function isPieceEstimatedFruit(item) {
    return receiveHandlingType(item) === "whole_fruit" && item.unit === "ลูก" && /แตงโม|สับปะรด/.test(`${item.name || ""} ${item.displayName || ""}`);
  }
  function needsActualWeight(item) { return isWeighedFruitCategory(item) && !isPieceEstimatedFruit(item) && ["whole_fruit", "prepared", "juiced"].includes(receiveHandlingType(item)); }
  function isWeightQuantity(item) { return item.inputMode === "weight"; }
  function handlingLabel(type) {
    if (type === "prepared") return "ปอก/พร้อมใช้";
    if (type === "juiced") return "คั้นแล้ว";
    if (type === "whole_fruit") return "ผลไม้ทั้งลูก";
    if (type === "consignment") return "ฝากขาย";
    return "";
  }
  function costingBasisForHandling(type) {
    if (type === "consignment") return "consignment";
    if (type === "whole_fruit") return "actual_raw_weight_kg";
    if (["prepared", "juiced"].includes(type)) return "backend_yield_from_actual_weight";
    return "backend";
  }
  function handlingSettingLabel(item) {
    const type = receiveHandlingType(item);
    return handlingLabel(type) || "ทั่วไป";
  }
  function finiteNumber(value) { const parsed = Number(value); return value !== null && value !== "" && Number.isFinite(parsed) ? parsed : null; }
  function costStatusHtml(line) {
    const value = finiteNumber(line.estimated_value ?? line.cost_value ?? line.calculated_cost);
    const status = String(line.costing_status || line.cost_status || "").toLowerCase();
    const estimated = line.measurement_basis === "estimated_raw" || Number(line.cost_provenance?.price_estimated_purchase_line_count || 0) > 0;
    if (value !== null && !["pending", "waiting", "unavailable"].includes(status)) return `<small class="cost-status">${estimated ? "ต้นทุนประมาณ" : "ต้นทุน"} ${money(value)} บาท</small>`;
    if (["pending", "waiting"].includes(status)) return `<small class="cost-status pending">${line.cost_pending_reason === "missing_piece_weight_estimate" ? "รอน้ำหนักเฉลี่ยต่อลูก" : "รอคำนวณต้นทุน"}</small>`;
    if (status === "unavailable") return `<small class="cost-status pending">ยังไม่มีข้อมูลต้นทุน</small>`;
    return "";
  }
  function receiveControls(item, line, key) {
    if (isPieceEstimatedFruit(item)) return inputControl({ ...item, key, inputMode: "quantity" }, line.quantity, "receive");
    if (!needsActualWeight(item)) return inputControl({ ...item, key, inputMode: isFrozenFruit(item) ? "quantity" : item.inputMode }, line.quantity, "receive");
    const weight = finiteNumber(line.actual_weight_kg);
    const quantityControl = isWeightQuantity(item) ? "" : `<label class="receive-measurement"><span>จำนวนที่รับ (${escapeHtml(item.unit || "หน่วย")})</span><input data-qty-target="receive" data-key="${key}" inputmode="decimal" type="number" min="0" step="0.01" value="${number(line.quantity) || ""}" aria-label="จำนวนที่รับ"></label>`;
    return `<div class="receive-measurements">${quantityControl}<label class="receive-measurement"><span>น้ำหนักจริง (กก.)</span><input data-actual-weight-key="${key}" inputmode="decimal" type="text" value="${weight === null ? "" : weight}" aria-label="น้ำหนักจริงกิโลกรัม"></label></div>`;
  }
  function sharedStockOptions(item, line) {
    return state.sharedStockVariants.get(item.itemId || item.item_id || line.item_id) || [];
  }
  function expectedBrandCount(item) {
    const codes = masterItemCodes(item);
    return codes.length > 1 && (item.itemId || item.item_id) ? codes.length - 1 : 0;
  }
  function renderBrandAllocations(item, line, key) {
    const variants = sharedStockOptions(item, line);
    if (variants.length < expectedBrandCount(item)) return `<div class="brand-allocations brand-warning" role="alert">ข้อมูลยี่ห้อโหลดไม่ครบ กด “อัปเดตข้อมูล” ก่อนรับรายการนี้</div>`;
    if (!variants.length) return "";
    const allocations = Array.isArray(line.brand_allocations) && line.brand_allocations.length
      ? line.brand_allocations : [{ item_id: "", quantity: number(line.quantity) || 1 }];
    return `<div class="brand-allocations" data-brand-picker="${escapeHtml(key)}"><strong>ยี่ห้อที่ได้รับ</strong>${allocations.map((allocation, index) =>
      `<div class="brand-allocation-row"><select data-brand-choice="${escapeHtml(key)}" data-brand-index="${index}" aria-label="เลือกยี่ห้อที่รับ"><option value="">เลือกยี่ห้อ</option>${variants.map((variant) =>
        `<option value="${escapeHtml(variant.id)}" ${allocation.item_id === variant.id ? "selected" : ""}>${escapeHtml(variant.name)}</option>`).join("")}</select><input data-brand-quantity="${escapeHtml(key)}" data-brand-index="${index}" type="number" inputmode="numeric" min="1" step="1" value="${number(allocation.quantity)}" aria-label="จำนวน${escapeHtml(item.unit || "หน่วย")}"><button data-brand-remove="${escapeHtml(key)}" data-brand-index="${index}" type="button" aria-label="ลบยี่ห้อ">×</button></div>`).join("")}<button class="brand-add" data-brand-add="${escapeHtml(key)}" type="button">+ อีกยี่ห้อ</button></div>`;
  }

  function renderDateDisplays() {
    $$('[data-date-display]').forEach((label) => {
      const value = $("#" + label.dataset.dateDisplay).value;
      if (!value) { label.textContent = "เลือกวันที่"; return; }
      const [year, month, day] = value.split("-"); label.textContent = `${day}/${month}/${Number(year) + 543}`;
    });
  }
  function renderAll() { renderDateDisplays(); renderRevenue(); renderOrder(); renderOrderHistory(); renderReceive(); renderReturns(); updateCartBar(); }
  function renderRevenue() {
    $("#revenueTotal").textContent = money(number($("#cashAmount").value) + number($("#transferAmount").value) + number($("#thaiAmount").value));
  }
  function groupedMenu(search = "") {
    const query = search.trim().toLowerCase();
    const groups = new Map();
    state.menu.filter((item) => item.active && (!query || `${item.displayName} ${item.category}`.toLowerCase().includes(query))).forEach((item) => {
      if (!groups.has(item.category)) groups.set(item.category, []); groups.get(item.category).push(item);
    });
    return groups;
  }
  function inputControl(item, value, target) {
    if (!target.startsWith("order") && item.inputMode === "weight") return `<div class="weight-control"><input data-qty-target="${target}" data-key="${item.key}" inputmode="decimal" type="text" value="${number(value) || ""}" placeholder="${escapeHtml(item.unit || "น้ำหนัก")}"></div>`;
    return `<div class="qty-control"><button data-step="-1" data-qty-target="${target}" data-key="${item.key}" type="button" aria-label="ลดจำนวน">−</button><input data-qty-target="${target}" data-key="${item.key}" inputmode="numeric" type="number" min="0" step="1" value="${number(value)}" aria-label="จำนวน"><button data-step="1" data-qty-target="${target}" data-key="${item.key}" type="button" aria-label="เพิ่มจำนวน">+</button></div>`;
  }
  function renderOrder() {
    let html = ""; let selected = 0; let groupIndex = 0; const nav = [];
    groupedMenu($("#orderSearch").value).forEach((items, category) => {
      const id = `order-category-${groupIndex++}`;
      nav.push(`<button data-category-target="${id}" type="button">${escapeHtml(category)}</button>`);
      html += `<section id="${id}" class="order-category-block"><h3 class="order-category-title">${escapeHtml(category)}</h3><div class="order-grid">`;
      items.forEach((item) => { const qty = number(state.order[item.key]); if (qty) selected += 1; html += `<div class="order-card ${qty ? "selected" : ""}" data-order-key="${escapeHtml(item.key)}"><div class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small></div>${inputControl(item, qty, "order")}</div>`; });
      html += `</div></section>`;
    });
    $("#orderList").innerHTML = html || `<div class="empty-state">ไม่พบรายการ</div>`;
    $("#orderCategoryNav").innerHTML = nav.join("");
    $$('[data-category-target]').forEach((button) => { button.onclick = () => $("#" + button.dataset.categoryTarget)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("#orderCount").textContent = `${selected} รายการ`; bindQuantityEvents(); bindOrderCards(); updateCartBar();
  }
  function findMenu(key, line) { return state.menu.find((item) => item.key === key || item.key === line?.line_key) || { key, displayName: line.item_name, name: line.item_name, category: line.category_name || "อื่นๆ", unit: line.unit_name || "", inputMode: line.input_mode || "quantity", handlingType: line.handling_type || "", costingBasis: line.costing_basis || "", itemId: line.item_id || null, sortOrder: line.sort_order || 0 }; }
  function renderReceive() {
    const entries = Object.entries(state.receive); let checked = 0;
    const renderRow = ([key, line]) => {
      const item = findMenu(key, line); if (line.checked) checked += 1;
      return `<div class="item-row ${line.checked ? "" : "unchecked"}" data-swipe-key="${escapeHtml(key)}" data-swipe-target="receive"><button class="swipe-delete" data-remove-target="receive" data-key="${escapeHtml(key)}" type="button">ไม่ได้รับ</button><div class="item-row-inner receive-row-inner"><label class="receive-check"><input data-receive-check="${escapeHtml(key)}" type="checkbox" ${line.checked ? "checked" : ""}><span class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small>${costStatusHtml(line)}</span></label>${receiveControls(item, line, key)}</div>${line.checked ? renderBrandAllocations(item, line, key) : ""}</div>`;
    };
    const roundIds = new Set((state.receiveRounds || []).map((round) => round.id));
    const ordered = (state.receiveRounds || []).map((round) => ({ round,
      rows: entries.filter(([, line]) => line.source_round_id === round.id) })).filter(({ rows }) => rows.length);
    const manual = entries.filter(([, line]) => !line.source_round_id || !roundIds.has(line.source_round_id));
    if (state.receiveRounds?.length) $("#receiveSourceLabel").textContent = ordered.length
      ? `${ordered.length} ใบสั่งของ` : manual.length ? "รายการเพิ่มเอง" : "รับรายการครบแล้ว · เพิ่มรายการระหว่างวันได้";
    const cards = ordered.map(({ round, rows }, index) => {
      const time = round.submitted_at ? new Date(round.submitted_at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : "";
      const title = `สั่ง ${formatThaiDate(round.business_date)}${time ? ` · ${time} น.` : ""}`;
      return `<details class="receive-order-card" data-receive-round="${escapeHtml(round.id)}" ${state.receiveExpanded.has(round.id) || (!state.receiveTopRoundId && index === 0) ? "open" : ""}><summary><strong>${escapeHtml(title)}</strong><span>${rows.length} รายการ</span></summary><div class="receive-order-lines">${rows.map(renderRow).join("")}</div></details>`;
    });
    if (manual.length) cards.push(`<section class="receive-manual-card"><h3>รายการเพิ่มเอง</h3><div class="receive-order-lines">${manual.map(renderRow).join("")}</div></section>`);
    $("#receiveList").innerHTML = cards.length ? cards.join("") : `<div class="empty-state">ไม่มีรายการรอรับ<br>กด “+ เพิ่ม” เมื่อมีของเข้าระหว่างวัน</div>`;
    $("#receiveProgress").textContent = `${checked} / ${entries.length} รายการ`;
    $("#receiveProgressBar").style.width = `${entries.length ? checked / entries.length * 100 : 0}%`;
    $$('[data-receive-round]').forEach((card) => { card.ontoggle = () => {
      if (card.open) state.receiveExpanded.add(card.dataset.receiveRound);
      else state.receiveExpanded.delete(card.dataset.receiveRound);
    }; });
    bindQuantityEvents(); bindActualWeightEvents(); bindBrandEvents(); bindRowEvents();
    renderReceiveHistory();
  }
  function renderReceiveHistory() {
    const batches = state.receiveHistory;
    if (!batches) {
      $("#receiveHistorySummary").textContent = "ประวัติรับของยังโหลดไม่สำเร็จ";
      $("#receiveHistoryContent").innerHTML = '<p class="page-notice error">กดอัปเดตข้อมูลเพื่อลองอีกครั้ง</p>';
      return;
    }
    const rounds = batches.filter((batch) => !batch.is_legacy).length;
    const legacy = batches.some((batch) => batch.is_legacy);
    const totals = new Map();
    batches.forEach((batch) => (batch.lines || []).forEach((line) => {
      const key = JSON.stringify([line.item_name,line.unit_name||""]);
      const row = totals.get(key) || {name:line.item_name,unit:line.unit_name||"",quantity:0,weight:0};
      row.quantity += number(line.quantity); row.weight += number(line.actual_weight_kg);
      totals.set(key,row);
    }));
    $("#receiveHistorySummary").textContent = `รับแล้ว ${rounds} รอบ${legacy ? " + ข้อมูลเดิม" : ""} · ${totals.size} รายการ`;
    const rows = lines => lines.map((line) => `<div class="receipt-history-row"><span>${escapeHtml(line.name || line.item_name)}</span><strong>${number(line.quantity).toLocaleString("th-TH")} ${escapeHtml(line.unit || line.unit_name || "")}${number(line.weight || line.actual_weight_kg) ? `<small>น้ำหนัก ${number(line.weight || line.actual_weight_kg).toLocaleString("th-TH")} กก.</small>` : ""}</strong></div>`).join("");
    $("#receiveHistoryContent").innerHTML = batches.length
      ? `<h3>รวมที่รับวันนี้</h3>${rows([...totals.values()])}<div class="receipt-rounds">${batches.map((batch) => {
        const time = batch.received_at ? new Date(batch.received_at).toLocaleTimeString("th-TH",{timeZone:"Asia/Bangkok",hour:"2-digit",minute:"2-digit"}) : "";
        return `<details><summary>${batch.is_legacy ? "ข้อมูลเดิม · ไม่ทราบจำนวนรอบ" : `รอบที่ ${batch.round_number} · ${escapeHtml(time)} น.`}</summary>${rows(batch.lines || [])}</details>`;
      }).join("")}</div>` : '<p class="page-notice">ยังไม่มีรายการรับในวันที่เลือก</p>';
  }
  function renderOrderHistory() {
    const rows = state.orderHistory;
    if (!rows) {
      $("#orderHistorySummary").textContent = "ประวัติการสั่งของ · โหลดไม่สำเร็จ";
      $("#orderHistoryContent").innerHTML = '<p class="page-notice error">กดอัปเดตข้อมูลเพื่อลองอีกครั้ง</p>';
      return;
    }
    $("#orderHistorySummary").textContent = `ประวัติการสั่งของ · ${rows.length} ครั้งล่าสุด`;
    $("#orderHistoryContent").innerHTML = rows.length ? rows.map((order) => {
      const time = order.submitted_at ? new Date(order.submitted_at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }) : "";
      const count = (order.lines || []).filter((line) => number(line.quantity) > 0).length;
      return `<div class="order-history-row"><span>${escapeHtml(formatThaiDate(order.business_date))}<small>${count} รายการ${time ? ` · ${escapeHtml(time)} น.` : ""}</small></span><button type="button" data-copy-order="${escapeHtml(order.id)}">คัดลอกซ้ำ</button></div>`;
    }).join("") : '<p class="page-notice">ยังไม่มีประวัติการสั่งของ</p>';
    $$('[data-copy-order]').forEach((button) => { button.onclick = async () => {
      const order = rows.find((row) => row.id === button.dataset.copyOrder);
      if (!order) return;
      try { await copyOrderText(order.lines || [], order.business_date); showActionToast("คัดลอกรายการสั่งของแล้ว"); }
      catch (_) { showActionToast("คัดลอกไม่สำเร็จ กรุณาลองอีกครั้ง", "error"); }
    }; });
  }

  function bindBrandEvents() {
    const current = (key) => {
      const line = state.receive[key]; if (!line) return null;
      if (!Array.isArray(line.brand_allocations) || !line.brand_allocations.length) {
        line.brand_allocations = [{ item_id: "", quantity: number(line.quantity) || 1 }];
      }
      return line.brand_allocations;
    };
    $$('[data-brand-choice]').forEach((select) => { select.onchange = () => {
      const rows = current(select.dataset.brandChoice); if (!rows) return;
      rows[Number(select.dataset.brandIndex)].item_id = select.value; saveDraft();
    }; });
    $$('[data-brand-quantity]').forEach((input) => { input.oninput = () => {
      const rows = current(input.dataset.brandQuantity); if (!rows) return;
      rows[Number(input.dataset.brandIndex)].quantity = number(input.value); saveDraft();
    }; });
    $$('[data-brand-add]').forEach((button) => { button.onclick = () => {
      const rows = current(button.dataset.brandAdd); if (!rows) return;
      rows.push({ item_id: "", quantity: 1 }); saveDraft(); renderReceive();
    }; });
    $$('[data-brand-remove]').forEach((button) => { button.onclick = () => {
      const rows = current(button.dataset.brandRemove); if (!rows) return;
      rows.splice(Number(button.dataset.brandIndex), 1); saveDraft(); renderReceive();
    }; });
  }

  function bindActualWeightEvents() {
    $$('[data-actual-weight-key]').forEach((input) => {
      input.onclick = (event) => event.stopPropagation();
      input.onpointerdown = (event) => event.stopPropagation();
      input.oninput = () => {
        const key = input.dataset.actualWeightKey;
        const line = state.receive[key]; if (!line) return;
        const item = findMenu(key, line); const actualWeight = number(input.value);
        line.actual_weight_kg = actualWeight;
        line.handling_type = receiveHandlingType(item);
        line.costing_basis = receiveCostingBasis(item, line.handling_type);
        if (isWeightQuantity(item)) line.quantity = actualWeight;
        saveDraft();
      };
    });
  }
  function renderReturns() {
    const entries = Object.entries(state.returns);
    $("#returnList").innerHTML = entries.length ? entries.map(([key, line]) => {
      const item = findMenu(key, line);
      return `<div class="item-row" data-swipe-key="${key}" data-swipe-target="returns"><button class="swipe-delete" data-remove-target="returns" data-key="${key}" type="button">ลบ</button><div class="item-row-inner"><div class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small></div>${inputControl(item, line.quantity, "returns")}</div></div>`;
    }).join("") : `<div class="empty-state">ยังไม่มีรายการคืน<br>กด “+ เพิ่ม” เพื่อเลือกรายการ</div>`;
    bindQuantityEvents(); bindRowEvents();
  }

  function updateCartBar() {
    const total = Object.values(state.order).reduce((sum, value) => sum + number(value), 0);
    $("#orderTotalQty").textContent = total.toLocaleString("th-TH");
    $("#orderCartBar").classList.toggle("hidden", state.activeTab !== "close");
  }
  function renderOrderSummary() {
    const selected = state.menu.filter((item) => number(state.order[item.key]) > 0);
    $("#orderSummaryList").innerHTML = selected.length ? selected.map((item) => `<div class="summary-row"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)}</small></span>${inputControl(item, state.order[item.key], "order-summary")}</div>`).join("") : `<div class="empty-state">ยังไม่มีรายการในตะกร้า</div>`;
    bindQuantityEvents();
  }
  function openOrderSummary() { renderOrderSummary(); $("#orderSummaryModal").classList.remove("hidden"); }
  function clearOrder() { state.order = {}; localStorage.removeItem(orderSubmissionKey($("#orderDate").value)); saveDraft(); renderOrder(); renderOrderSummary(); }
  function nextBusinessDate(date) {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + 1);
    return value.toISOString().slice(0, 10);
  }
  function receiveDateForOrder(orderDate) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    const nextMorning = Number(parts.hour) < 6 ? localDate : nextBusinessDate(localDate);
    const planned = nextBusinessDate(orderDate);
    return planned < nextMorning ? planned : nextMorning;
  }
  async function copyOrderText(lines, businessDate) {
    const groups = new Map();
    [...lines].filter((line) => number(line.quantity) > 0)
      .sort((a, b) => number(a.sort_order) - number(b.sort_order))
      .forEach((line) => {
        const category = line.category_name || "อื่นๆ";
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(`- ${line.item_name} x ${number(line.quantity)}`);
      });
    let text = `รายการสั่งของ BigC (${formatThaiDate(businessDate)})`;
    groups.forEach((rows, category) => { text += `\n\n${category}\n${rows.join("\n")}`; });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select();
      const copied = document.execCommand("copy"); area.remove(); if (!copied) throw new Error("copy failed");
    }
  }
  function formatThaiDate(value) { const [year, month, day] = value.split("-"); return `${day}/${month}/${Number(year) + 543}`; }

  function targetObject(name) { return name === "order" ? state.order : name === "receive" ? state.receive : state.returns; }
  function updateQuantity(target, key, value) {
    if (target === "order-summary") target = "order";
    if (target === "order") state.order[key] = number(value);
    else { const object = targetObject(target); const item = findMenu(key, object[key] || {}); object[key] = { ...(object[key] || lineFromMenu(item)), quantity: number(value) }; }
    saveDraft(); renderRevenue(); updateCartBar();
  }
  function syncQuantityViews(target, key, value) {
    const normalizedTarget = target === "order-summary" ? "order" : target;
    $$('input[data-qty-target]').filter((input) => (input.dataset.qtyTarget === "order-summary" ? "order" : input.dataset.qtyTarget) === normalizedTarget && input.dataset.key === key).forEach((input) => { input.value = number(value); });
    if (normalizedTarget !== "order") return;
    $$('[data-order-key]').filter((card) => card.dataset.orderKey === key).forEach((card) => card.classList.toggle("selected", number(value) > 0));
    $("#orderCount").textContent = `${Object.values(state.order).filter((quantity) => number(quantity) > 0).length} รายการ`;
  }
  function bindQuantityEvents() {
    $$('input[data-qty-target]').forEach((input) => {
      input.onclick = (event) => event.stopPropagation();
      input.onpointerdown = (event) => event.stopPropagation();
      input.oninput = () => { updateQuantity(input.dataset.qtyTarget, input.dataset.key, input.value); syncQuantityViews(input.dataset.qtyTarget, input.dataset.key, input.value); };
    });
    $$('[data-step]').forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const normalizedTarget = button.dataset.qtyTarget === "order-summary" ? "order" : button.dataset.qtyTarget;
        const object = targetObject(normalizedTarget); const current = normalizedTarget === "order" ? object[button.dataset.key] : object[button.dataset.key]?.quantity;
        const next = number(current) + Number(button.dataset.step);
        updateQuantity(button.dataset.qtyTarget, button.dataset.key, next);
        if (["order", "order-summary"].includes(button.dataset.qtyTarget)) syncQuantityViews(button.dataset.qtyTarget, button.dataset.key, next);
        else if (button.dataset.qtyTarget === "receive") renderReceive(); else renderReturns();
      };
    });
  }
  function bindOrderCards() {
    $$('[data-order-key]').forEach((card) => {
      const increment = () => {
        const next = number(state.order[card.dataset.orderKey]) + 1;
        updateQuantity("order", card.dataset.orderKey, next);
        syncQuantityViews("order", card.dataset.orderKey, next);
      };
      card.onclick = (event) => { if (!event.target.closest("button,input")) increment(); };
    });
  }
  function bindRowEvents() {
    $$('[data-receive-check]').forEach((checkbox) => { checkbox.onchange = () => { state.receive[checkbox.dataset.receiveCheck].checked = checkbox.checked; saveDraft(); renderReceive(); }; });
    $$('[data-remove-target]').forEach((button) => { button.onclick = () => confirmRemoveLine(button.dataset.removeTarget, button.dataset.key); });
    $$('[data-swipe-key]').forEach((row) => {
      let start = 0;
      row.ontouchstart = (event) => { start = event.target.closest(".brand-allocations") ? null : event.touches[0].clientX; row.classList.remove("swiped"); };
      row.ontouchmove = (event) => { if (start === null) return; const distance = Math.max(0, start - event.touches[0].clientX); row.querySelector(".item-row-inner").style.transform = `translateX(-${Math.min(90, distance)}px)`; };
      row.ontouchend = (event) => { if (start === null) return; const distance = start - event.changedTouches[0].clientX; row.querySelector(".item-row-inner").style.transform = ""; row.classList.toggle("swiped", distance > 50); };
    });
  }
  function confirmRemoveLine(target, key) {
    const line = targetObject(target)[key]; const item = findMenu(key, line || {});
    const action = target === "receive" ? "นำออกจากรายการรับของ" : "ลบออกจากรายการคืนของ";
    if (confirm(`${action}\n“${item.displayName}”\n\nยืนยันการลบรายการนี้หรือไม่?`)) removeLine(target, key);
  }
  function removeLine(target, key) { delete targetObject(target)[key]; saveDraft(); target === "receive" ? renderReceive() : renderReturns(); }

  function linesFor(type) {
    if (type === "close_order") return state.menu.filter((item) => number(state.order[item.key]) > 0).map((item) => ({ ...lineFromMenu(item, state.order[item.key], "quantity"), received: true }));
    const source = type === "receive" ? state.receive : state.returns;
    return Object.entries(source).filter(([, line]) => number(line.quantity) > 0 && (type !== "receive" || line.checked)).map(([key, line]) => {
      const item = findMenu(key, line); const handlingType = type === "receive"
        ? receiveHandlingType(item) : line.handling_type || receiveHandlingType(item);
      return {
        ...line, line_key: type === "receive" ? (line.receipt_key ||= newReceiptKey()) : key, item_id: line.item_id || item.itemId || item.item_id || null,
        input_mode: type === "receive" && (isPieceEstimatedFruit(item) || isFrozenFruit(item)) ? "quantity" : line.input_mode,
        actual_weight_kg: type === "receive" && !needsActualWeight(item) ? null : line.actual_weight_kg,
        handling_type: handlingType, costing_basis: receiveCostingBasis(item, handlingType),
        measurement_basis: type === "receive" ? isPieceEstimatedFruit(item) ? "estimated_raw"
          : needsActualWeight(item) ? line.measurement_basis : null : line.measurement_basis,
        received: type === "receive" ? Boolean(line.checked) : true
      };
    });
  }

  async function submitWorkflow(type, { reload = true, deferMirror = false } = {}) {
    if (state.saving) return false;
    const lines = linesFor(type);
    if (type === "close_order" && !lines.length) { notice("ยังไม่มีรายการสั่งของ", true); return false; }
    if (type === "receive" && !lines.length) { notice("กรุณาเช็กรายการที่ได้รับอย่างน้อย 1 รายการ", true); return false; }
    if (type === "receive") {
      const invalidPiece = lines.find((line) => isPieceEstimatedFruit(findMenu(line.line_key, line)) && !Number.isInteger(Number(line.quantity)));
      if (invalidPiece) { notice(`จำนวนลูกของ ${invalidPiece.item_name} ต้องเป็นจำนวนเต็ม`, true); return false; }
      const missingWeight = lines.find((line) => needsActualWeight(findMenu(line.line_key, line)) && number(line.actual_weight_kg) <= 0);
      if (missingWeight) { notice(`กรอกน้ำหนักจริงของ ${missingWeight.item_name} ก่อนบันทึก`, true); return false; }
      const incompleteBrands = lines.find((line) => {
        const item = findMenu(line.line_key, line);
        return sharedStockOptions(item, line).length < expectedBrandCount(item);
      });
      if (incompleteBrands) { notice(`ข้อมูลยี่ห้อของ ${incompleteBrands.item_name} โหลดไม่ครบ กด “อัปเดตข้อมูล” ก่อนบันทึก`, true); return false; }
      const invalidBrand = lines.find((line) => {
        const item = findMenu(line.line_key, line);
        const variants = sharedStockOptions(item, line);
        if (!variants.length) return false;
        const rows = line.brand_allocations || [];
        const ids = new Set(); let total = 0;
        for (const row of rows) {
          if (!variants.some((variant) => variant.id === row.item_id) || ids.has(row.item_id)
            || !Number.isInteger(Number(row.quantity)) || number(row.quantity) <= 0) return true;
          ids.add(row.item_id); total += number(row.quantity);
        }
        return !rows.length || total !== number(line.quantity);
      });
      if (invalidBrand) { notice(`เลือกยี่ห้อและจำนวน${findMenu(invalidBrand.line_key, invalidBrand).unit || "หน่วย"}ให้ตรงกับที่รับจริง: ${invalidBrand.item_name}`, true); return false; }
    }
    const payload = {
      workflow_type: type, business_date: type === "close_order" ? $("#orderDate").value : type === "receive" ? $("#receiveDate").value : $("#returnDate").value,
      source_workflow_id: type === "receive" ? state.contexts.receive?.previous_order?.id || null : null,
      cash_amount: type === "return" ? number($("#cashAmount").value) : 0,
      transfer_amount: type === "return" ? number($("#transferAmount").value) : 0,
      thai_chuay_thai_amount: type === "return" ? number($("#thaiAmount").value) : 0,
      lines
    };
    if (type === "close_order") payload.submission_id = submissionIdFor(payload.business_date, lines);
    state.saving = true; loading("กำลังบันทึกลงฐานข้อมูล"); notice("");
    try {
      if (type === "close_order") {
        window.clearTimeout(state.cloudTimer);
        if (state.cloudDraftPromise) try { await state.cloudDraftPromise; } catch (_) { /* online order can still be saved */ }
      }
      if (type === "receive") saveDraft();
      const { data, error } = DEMO_MODE ? { data: DEMO_STORE.submit(payload) }
        : await state.client.schema("boy_central").rpc(
          type === "receive" ? "append_bigc_v2_receive" : type === "close_order" ? "append_bigc_v2_order" : "save_bigc_v2_workflow", { payload });
      if (error) throw error;
      if (data?.status !== "saved" && !DEMO_MODE) throw new Error("ฐานข้อมูลยังไม่ยืนยันการบันทึก");
      if (type === "receive") {
        const submittedKeys = new Set(lines.map((line) => line.line_key));
        Object.entries(state.receive).forEach(([key, line]) => {
          if (submittedKeys.has(line.receipt_key)) delete state.receive[key];
        });
        saveDraft();
        $("#receiveSourceLabel").textContent = Object.keys(state.receive).length ? "รายการรอรับ" : "รับรายการครบแล้ว · เพิ่มรายการระหว่างวันได้";
        renderReceive();
      } else if (type !== "close_order") saveDraft();
      let mirrorSynced = DEMO_MODE;
      setSync("บันทึกฐานข้อมูลแล้ว", "ok");
      if (DEMO_MODE) {
        setSync("โหมดทดลอง", "pending"); notice("บันทึกทดลองแล้ว · ไม่ส่งข้อมูลจริง");
      } else if (deferMirror && type === "close_order") {
        setSync("บันทึก Supabase แล้ว · กำลังส่งชีต", "pending");
      } else try {
        await sheetApi("bigcV2MirrorWorkflow", { payload: { ...(data.mirror_payload || payload), workflow_id: data.workflow_id } });
        await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "synced", sync_error: null });
        mirrorSynced = true;
        setSync("บันทึกครบแล้ว", "ok"); notice("บันทึกเรียบร้อย");
      } catch (sheetError) {
        try { await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "error", sync_error: String(sheetError.message || sheetError).slice(0, 400) }); } catch (_) { /* database save remains valid */ }
        setSync("รอส่ง Google Sheets", "pending"); notice("ข้อมูลอยู่ในฐานข้อมูลแล้ว แต่สำเนา Google Sheets ยังรอส่ง", false);
      }
      if (reload) await loadPage();
      return type === "close_order" ? { workflowId: data.workflow_id,
        submissionId: payload.submission_id, businessDate: payload.business_date, lines,
        mirrorPayload: data.mirror_payload || payload, mirrorSynced } : true;
    } catch (error) {
      if (type === "close_order") saveDraft();
      setSync("บันทึกไม่สำเร็จ", "error"); notice(error.message, true); return false;
    }
    finally { state.saving = false; loading("", false); }
  }

  async function mirrorSavedOrder(saved, { copied = true } = {}) {
    if (DEMO_MODE) return true;
    try {
      await sheetApi("bigcV2MirrorWorkflow", { payload: { ...saved.mirrorPayload, workflow_id: saved.workflowId } });
      const { error } = await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", {
        target_workflow_id: saved.workflowId, sync_status: "synced", sync_error: null
      });
      if (error) throw error;
      setSync("บันทึกครบแล้ว", "ok");
      showActionToast(copied ? "บันทึก Supabase คัดลอกข้อความ และส่งสำเนา Google Sheets แล้ว" :
        "บันทึก Supabase และส่งสำเนา Google Sheets แล้ว · คัดลอกซ้ำในประวัติ", copied ? "ok" : "warning");
      return true;
    } catch (error) {
      try { await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", {
        target_workflow_id: saved.workflowId, sync_status: "error",
        sync_error: String(error.message || error).slice(0, 400)
      }); } catch (_) { /* database save remains valid */ }
      setSync("รอส่ง Google Sheets", "pending");
      showActionToast(`บันทึก Supabase แล้ว แต่สำเนา Google Sheets ยังไม่สำเร็จ${copied ? "" : " · คัดลอกซ้ำในประวัติ"}`, "warning");
      return false;
    }
  }

  async function refreshReceiveAfterOrder(receiveDate, submissionId) {
    if (DEMO_MODE) { loadDemoPage(); return state.receiveRounds.some((round) => round.id === submissionId); }
    const [contextResult, roundsResult, historyResult, orderHistoryResult] = await Promise.all([
      state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: receiveDate }),
      state.client.schema("boy_central").rpc("get_bigc_v2_receive_order_rounds", { target_date: receiveDate }),
      state.client.schema("boy_central").rpc("get_bigc_v2_receive_history", { target_date: receiveDate }),
      state.client.schema("boy_central").rpc("get_bigc_v2_order_history", { max_rows: 30 })
    ]);
    if (contextResult.error || roundsResult.error) throw contextResult.error || roundsResult.error;
    state.contexts.receive = contextResult.data || {};
    state.context = state.contexts.receive;
    state.receiveRounds = roundsResult.data || [];
    state.receiveHistory = historyResult.error ? null : historyResult.data || [];
    state.orderHistory = orderHistoryResult.error ? null : orderHistoryResult.data || [];
    seedReceiveFromRounds(state.receiveRounds,
      (state.contexts.receive.workflows || []).filter((row) => row.workflow_type === "receive"));
    renderReceive(); renderOrderHistory();
    return state.receiveRounds.some((round) => round.id === submissionId);
  }

  function openPicker(target) { state.pickerTarget = target; $("#pickerSearch").value = ""; $("#pickerModal").classList.remove("hidden"); renderPicker(); }
  function renderPicker() {
    const query = $("#pickerSearch").value.trim().toLowerCase(); const selected = targetObject(state.pickerTarget);
    const items = state.menu.filter((item) => item.active && !selected[item.key] && (!query || `${item.displayName} ${item.category}`.toLowerCase().includes(query)));
    $("#pickerList").innerHTML = items.length ? items.map((item) => `<button class="picker-item" data-pick="${item.key}" type="button"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)}</small></span><b>＋</b></button>`).join("") : `<div class="empty-state">ไม่พบรายการ</div>`;
    $$('[data-pick]').forEach((button) => { button.onclick = () => { const item = state.menu.find((row) => row.key === button.dataset.pick); selected[item.key] = { ...lineFromMenu(item), ...(state.pickerTarget === "receive" ? { receipt_key: newReceiptKey() } : {}), checked: state.pickerTarget === "receive" }; saveDraft(); $("#pickerModal").classList.add("hidden"); state.pickerTarget === "receive" ? renderReceive() : renderReturns(); }; });
  }

  function openSettings() {
    const manage = !DEMO_MODE && !isStaffView() && state.access?.canManage;
    $$(".manager-settings").forEach((section) => { section.hidden = !manage; });
    $("#logoutSettingsButton").hidden = DEMO_MODE;
    $("#settingsModal").classList.remove("hidden"); $("#settingsSearch").value = "";
    showSettingsSection("");
    const hasPending = Boolean(readStoredJson(SETTINGS_PENDING_KEY));
    showSettingsConnection(manage && (!state.session || hasPending), !state.session ? "เข้าสู่ระบบออนไลน์ก่อนบันทึก เพื่อให้รายการใช้ได้ทุกเครื่อง" : state.settingsConflict || "มีการตั้งค่าที่เก็บไว้ในเครื่องและยังรอส่งขึ้น Supabase");
    renderSettings(); updateMappingSummary();
  }
  const SETTINGS_SECTIONS = {
    items: ["รายการสินค้า", "แก้ชื่อ หมวดหมู่ หน่วย และการแสดงในหน้าสั่งของ"],
    units: ["หน่วยและการรับของ", "เลือกว่ารายการใดต้องชั่งน้ำหนักตอนรับหรือคืน และแก้หน่วยที่ใช้จริง"],
    costing: ["วิธีคิดต้นทุน", "เลือกประเภทการรับของแต่ละรายการ หรือกำหนด Yield และน้ำหนักผลไม้"],
    returns: ["รายการคืนของประจำ", "เลือกของที่ต้องการให้ขึ้นหน้าคืนโดยอัตโนมัติ"]
  };
  function showSettingsSection(section) {
    if (section && (DEMO_MODE || isStaffView() || !state.access?.canManage)) return;
    state.selectedSettingsKeys.clear();
    state.selectingSettings = false;
    state.settingsSection = SETTINGS_SECTIONS[section] ? section : "";
    const detail = Boolean(state.settingsSection);
    $("#settingsHome").classList.toggle("hidden", detail);
    $("#settingsDetail").classList.toggle("hidden", !detail);
    $("#settingsBack").classList.toggle("hidden", !detail);
    $("#settingsTitle").textContent = detail ? SETTINGS_SECTIONS[section][0] : "ตั้งค่า";
    $("#settingsSectionDescription").textContent = detail ? SETTINGS_SECTIONS[section][1] : "";
    $("#openAddItem").classList.toggle("hidden", section !== "items");
    $("#openFruitCostSettings").classList.toggle("hidden", section !== "costing");
    $("#settingsSearch").value = "";
    $("#settingsModal .modal-sheet").scrollTop = 0;
    if (detail) renderSettings();
  }
  async function loadMasterItems(force = false) {
    if ((!force && state.masterItems.length) || !state.session) return;
    const [catalogResult, normalizedResult] = await Promise.all([
      state.client.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: "M_สินค้า" }),
      state.client.schema("boy_central").from("items").select("id,code,name,stock_target_item_id,active").eq("active", true).limit(1000)
    ]);
    if (catalogResult.error) throw catalogResult.error;
    if (normalizedResult.error) throw normalizedResult.error;
    state.masterItems = (catalogResult.data?.rows || []).filter((row) => row.item_id && row["เปิดใช้งาน"] !== false)
      .map((row) => ({ code: String(row.item_id), name: String(row["ชื่อสินค้า"] || row.item_id),
        stockTargetCode: String(row.stock_target_item_id || "").trim() }));
    state.normalizedItemsByCode = new Map((normalizedResult.data || []).map((row) => [String(row.code), row.id]));
    state.normalizedRowsByCode = new Map((normalizedResult.data || []).map((row) => [String(row.code), row]));
    state.masterItemsByCode = new Map(state.masterItems.map((row) => [row.code, row]));
    state.sharedStockVariants = new Map();
    (normalizedResult.data || []).filter((row) => row.stock_target_item_id).forEach((row) => {
      const options = state.sharedStockVariants.get(row.stock_target_item_id) || [];
      options.push({ id: row.id, name: row.name, code: row.code });
      state.sharedStockVariants.set(row.stock_target_item_id, options);
    });
  }
  async function ensureMappedCatalogItems(items) {
    const codes = [...new Set(items.map((item) => item.masterItemId || item.master_item_id).filter((code) => code && !state.normalizedItemsByCode.has(code)))];
    if (codes.length && !state.session) throw new Error("เข้าสู่ระบบออนไลน์ก่อนจับคู่สินค้า");
    for (let index = 0; index < codes.length; index += 50) {
      const { data, error } = await state.client.schema("boy_central").rpc("ensure_bigc_catalog_items", { target_codes: codes.slice(index, index + 50) });
      if (error) throw error;
      Object.entries(data || {}).forEach(([code, id]) => { if (id) state.normalizedItemsByCode.set(code, id); });
    }
    items.forEach((item) => { if (item.masterItemId || item.master_item_id) item.itemId = state.normalizedItemsByCode.get(item.masterItemId || item.master_item_id) || null; });
  }
  function renderMasterItemOptions() {
    const list = $("#editItemMasterList");
    if (!state.session) {
      list.innerHTML = `<div class="empty-state">ต้องเข้าสู่ระบบออนไลน์ก่อนเลือกสินค้ากลาง<br><a href="bigc-v2.html?online=1">เข้าสู่ระบบออนไลน์</a></div>`;
      updateMappingStatus();
      return;
    }
    const query = $("#editItemMappingSearch").value.trim();
    const selected = new Set(state.editingMasterCodes);
    const choices = [
      ...state.editingMasterCodes.filter((code) => !state.masterItemsByCode.has(code)).map((code) => ({ code, name: code })),
      ...state.masterItems.filter((row) => selected.has(row.code) || matchesMasterSearch(row, query))
    ];
    choices.sort((left, right) => {
      const leftRank = state.editingMasterCodes.indexOf(left.code);
      const rightRank = state.editingMasterCodes.indexOf(right.code);
      return (leftRank < 0 ? Infinity : leftRank) - (rightRank < 0 ? Infinity : rightRank);
    });
    list.innerHTML = choices.length ? choices.map((row) => {
      const checked = selected.has(row.code);
      return `<div class="master-choice-row ${checked ? "selected" : ""}"><label><input data-master-code="${escapeHtml(row.code)}" type="checkbox" ${checked ? "checked" : ""}><span>${escapeHtml(row.name)} <small>· ${escapeHtml(row.code)}</small></span></label></div>`;
    }).join("") : `<div class="empty-state">ไม่พบสินค้า</div>`;
    updateMappingStatus();
  }
  function updateMappingStatus() {
    const codes = state.editingMasterCodes;
    const result = canonicalCodeFor(codes, state.normalizedRowsByCode, state.masterItemsByCode);
    $("#editItemMappingStatus").textContent = !codes.length ? "ยังไม่จับคู่สินค้า"
      : result.error || `ผูกแล้ว ${codes.length} รายการ · ระบบใช้สต็อกรวม ${result.code} โดยอัตโนมัติ`;
  }
  function normalizedMatchName(value) {
    return String(value || "").normalize("NFKC").replace(/\([^)]*\)/g, "").replace(/[\s._\-/]+/g, "").toLowerCase();
  }
  function exactMasterSuggestion(item) {
    const target = normalizedMatchName(item.name || item.displayName);
    if (!target) return null;
    const matches = state.masterItems.filter((row) => normalizedMatchName(row.name) === target);
    return matches.length === 1 ? matches[0] : null;
  }
  function updateMappingSummary() {
    const mapped = state.menu.filter((item) => masterItemCodes(item).length).length;
    const text = `${mapped} / ${state.menu.length} รายการ`;
    if ($("#mappingSummary")) $("#mappingSummary").textContent = text;
    if ($("#mappingProgress")) $("#mappingProgress").textContent = `จับคู่แล้ว ${text}`;
  }
  function renderMappingList() {
    const query = $("#mappingSearch").value.trim().toLowerCase();
    const filter = $("#mappingFilter").value;
    const rows = state.menu.filter((item) => {
      const codes = masterItemCodes(item);
      const mapped = codes.length > 0;
      return (filter === "all" || (filter === "mapped" ? mapped : !mapped))
        && (!query || `${item.displayName} ${item.category} ${codes.join(" ")}`.toLowerCase().includes(query));
    });
    $("#mappingList").innerHTML = rows.length ? rows.map((item) => {
      const codes = masterItemCodes(item);
      const code = codes[0] || "";
      const suggestion = !code ? exactMasterSuggestion(item) : null;
      const names = codes.map((value) => state.masterItemsByCode.get(value)?.name || value);
      const current = code ? `ผูก ${names.join(" · ")}` : "ยังไม่จับคู่";
      return `<div class="mapping-row"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.unit || "จำนวน")}</small><small class="mapping-current">${escapeHtml(current)}</small>${suggestion ? `<small>ชื่อที่ตรงกัน: ${escapeHtml(suggestion.name)} · ${escapeHtml(suggestion.code)}</small>` : ""}</span><span class="mapping-actions">${suggestion ? `<button data-apply-map="${escapeHtml(item.key)}" data-map-code="${escapeHtml(suggestion.code)}" type="button">ใช้รายการแนะนำ</button>` : ""}<button data-map-edit="${escapeHtml(item.key)}" type="button">${code ? "แก้ไข" : "ค้นหา"}</button></span></div>`;
    }).join("") : `<div class="empty-state">ไม่พบรายการตามตัวกรอง</div>`;
    $$('[data-apply-map]').forEach((button) => { button.onclick = () => {
      const item = state.menu.find((row) => row.key === button.dataset.applyMap); if (!item) return;
      Object.assign(item, withMasterItemCodes(item, [button.dataset.mapCode]));
      item.itemId = state.normalizedItemsByCode.get(button.dataset.mapCode) || null;
      state.mappingDirty = true; renderMappingList(); updateMappingSummary();
    }; });
    $$('[data-map-edit]').forEach((button) => { button.onclick = () => openEditItem(button.dataset.mapEdit, true); });
    updateMappingSummary();
  }
  async function openMappingManager() {
    if (isStaffView() || !state.access?.canManage) return;
    $("#mappingModal").classList.remove("hidden"); $("#mappingSearch").value = ""; $("#mappingFilter").value = "unmapped";
    $("#mappingList").innerHTML = `<div class="empty-state">กำลังโหลดสินค้าข้อมูลกลาง</div>`;
    try { await loadMasterItems(); renderMappingList(); }
    catch (error) { $("#mappingList").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</div>`; }
  }
  function applyExactMappings() {
    const suggestions = state.menu.map((item) => ({ item, master: masterItemCodes(item).length ? null : exactMasterSuggestion(item) })).filter((row) => row.master);
    if (!suggestions.length) { notice("ไม่พบชื่อที่ตรงกันแบบหนึ่งต่อหนึ่ง"); return; }
    if (!confirm(`เติมรายการแนะนำ ${suggestions.length} รายการเพื่อให้ตรวจสอบก่อนบันทึก?`)) return;
    suggestions.forEach(({ item, master }) => { Object.assign(item, withMasterItemCodes(item, [master.code])); item.itemId = state.normalizedItemsByCode.get(master.code) || null; });
    state.mappingDirty = true; renderMappingList(); updateMappingSummary(); notice(`เติมรายการแนะนำแล้ว ${suggestions.length} รายการ · กรุณาตรวจและกดบันทึก`);
  }
  async function saveMappings() {
    if (!state.mappingDirty) { notice("ไม่มีการจับคู่ที่เปลี่ยนแปลง"); return; }
    try { await ensureMappedCatalogItems(state.menu); }
    catch (error) { notice(`จับคู่ไม่สำเร็จ: ${error.message}`, true); return; }
    const status = await persistSettings("บันทึกการจับคู่แล้ว");
    if (status === "synced") { state.mappingDirty = false; renderMappingList(); renderSettings(); }
  }
  async function copyStaffLink() {
    try { await navigator.clipboard.writeText(staffLink()); notice("คัดลอกลิงก์พนักงานแล้ว"); }
    catch (_) { notice("คัดลอกลิงก์ไม่สำเร็จ กรุณากดเปิดแล้วคัดลอกจากแถบที่อยู่", true); }
  }
  function renderFruitCostItemOptions() {
    $("#fruitCostError").textContent = "";
    const candidates = state.fruitCostItems;
    const previous = $("#fruitCostRawItem").value;
    $("#fruitCostRawItem").innerHTML = `<option value="">เลือกผลไม้หลัก</option>` + candidates.map((item) =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.base_unit || "")}</option>`).join("");
    if (candidates.some((item) => item.id === previous)) $("#fruitCostRawItem").value = previous;
    else if (candidates.length === 1) $("#fruitCostRawItem").value = candidates[0].id;
    renderFruitCostExisting();
    if (!candidates.length) $("#fruitCostError").textContent = "ยังไม่มีผลไม้หลักในข้อมูลกลาง";
  }
  function renderFruitCostExisting() {
    const itemId = $("#fruitCostRawItem").value;
    const month = $("#fruitCostMonth").value + "-01";
    const weight = state.fruitWeights.find((row) => row.raw_item_id === itemId && row.effective_month === month);
    const item = state.fruitCostItems.find((row) => row.id === itemId);
    const source = state.fruitYieldRows.find((row) => row.item_id === item?.code);
    const values = source ? ["UW เนื้อ/ปั่น", "UW สกัด", "UW รวม"].filter((key) => source[key]).map((key) => `${key}: ${source[key]}`) : [];
    $("#fruitCostYieldSource").textContent = !source ? "ยังไม่มี Yield ใน M_UW_สรุป — ต้นทุนผลไม้แปรรูปยังรอข้อมูล" :
      `${values.join(" · ") || "ยังไม่มีค่า Yield"} · สถานะ: ${source["สถานะตรวจสอบ"] || "ไม่ระบุ"} (BigC ยังไม่เชื่อมค่านี้เข้าการคำนวณอัตโนมัติ)`;
    $("#fruitCostKgPerPiece").value = weight?.kg_per_piece ?? "";
    $("#fruitCostSampleNote").value = weight?.sample_note || "";
  }
  async function openFruitCostSettings() {
    $("#fruitCostError").textContent = "";
    $("#fruitCostMonth").value = today().slice(0, 7);
    $("#fruitCostModal").classList.remove("hidden");
    if (!state.session) { $("#fruitCostError").textContent = "เชื่อมต่อบัญชีออนไลน์ก่อนตั้งค่าต้นทุน"; return; }
    loading("กำลังโหลดต้นทุนผลไม้");
    try {
      const [{ data, error }, sourceResult] = await Promise.all([
        state.client.schema("boy_central").rpc("get_bigc_fruit_cost_settings"),
        state.client.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: "M_UW_สรุป" })
      ]);
      if (error) throw error;
      state.fruitCostItems = data?.items || [];
      state.fruitCostRules = data?.rules || [];
      state.fruitWeights = data?.weights || [];
      state.fruitYieldRows = sourceResult.error ? [] : sourceResult.data?.rows || [];
      renderFruitCostItemOptions();
      if (sourceResult.error) $("#fruitCostError").textContent = `อ่าน Yield จากข้อมูลกลางไม่ได้: ${sourceResult.error.message}`;
    } catch (error) {
      $("#fruitCostError").textContent = `โหลดการตั้งค่าต้นทุนไม่ได้: ${error.message}`;
    } finally { loading("", false); }
  }
  async function saveFruitCost() {
    const itemId = $("#fruitCostRawItem").value;
    const kg = Number($("#fruitCostKgPerPiece").value);
    const month = $("#fruitCostMonth").value;
    const sampleNote = $("#fruitCostSampleNote").value.trim();
    const hasKg = Number.isFinite(kg) && kg > 0;
    if (!itemId || !month || !hasKg || !sampleNote) {
      $("#fruitCostError").textContent = "เลือกผลไม้ เดือน กรอกน้ำหนักต่อลูก และระบุที่มาของตัวเลข"; return;
    }
    loading("กำลังบันทึกต้นทุนผลไม้"); $("#fruitCostError").textContent = "";
    try {
      const { data, error } = await state.client.schema("boy_central").rpc("admin_save_bigc_piece_weight", {
        payload: { raw_item_id: itemId, effective_month: `${month}-01`, kg_per_piece: kg, sample_note: sampleNote }
      });
      if (error) throw error;
      const affected = Number(data?.workflows_requiring_reprocess || 0);
      const monthStart = `${month}-01`;
      state.fruitWeights = state.fruitWeights.filter((row) => row.raw_item_id !== itemId || row.effective_month !== monthStart);
      state.fruitWeights.push({ raw_item_id: itemId, effective_month: monthStart, kg_per_piece: kg, sample_note: sampleNote });
      $("#fruitCostModal").classList.add("hidden");
      notice(affected > 0 ? `บันทึกแล้ว · ระบบคำนวณต้นทุนรายการเดิมให้อัตโนมัติ ${affected} รายการ` : "บันทึกน้ำหนักต่อลูกแล้ว · Yield ยังต้องเชื่อมกับข้อมูลกลาง");
    } catch (error) { $("#fruitCostError").textContent = `บันทึกไม่สำเร็จ: ${error.message}`; }
    finally { loading("", false); }
  }
  function visibleSettingsItems() {
    const query = $("#settingsSearch").value.trim().toLowerCase();
    return state.menu.filter((item) => !query || `${item.displayName} ${item.category}`.toLowerCase().includes(query));
  }
  function updateSettingsSelection() {
    const keys = new Set(state.menu.map((item) => item.key));
    state.selectedSettingsKeys.forEach((key) => { if (!keys.has(key)) state.selectedSettingsKeys.delete(key); });
    const visible = visibleSettingsItems();
    const count = state.selectedSettingsKeys.size;
    const selectedVisible = visible.filter((item) => state.selectedSettingsKeys.has(item.key)).length;
    const selecting = state.settingsSection === "items" && state.selectingSettings;
    $("#toggleSettingsSelection").classList.toggle("hidden", state.settingsSection !== "items");
    $("#toggleSettingsSelection").textContent = selecting ? "ยกเลิก" : "เลือก";
    $("#toggleSettingsSelection").setAttribute("aria-expanded", String(selecting));
    $("#toggleSettingsSelection").disabled = state.deletingSettings;
    $("#settingsBulkActions").classList.toggle("hidden", !selecting);
    $("#settingsSelectedCount").textContent = `เลือก ${count} รายการ`;
    $("#selectVisibleSettings").checked = visible.length > 0 && selectedVisible === visible.length;
    $("#selectVisibleSettings").indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    $("#selectVisibleSettings").disabled = !visible.length || state.deletingSettings;
    $("#deleteSelectedItems").disabled = !count || state.deletingSettings;
    $("#clearSettingsSelection").disabled = !count || state.deletingSettings;
    $$("[data-select-settings-item]").forEach((input) => {
      input.checked = state.selectedSettingsKeys.has(input.dataset.selectSettingsItem);
      input.disabled = state.deletingSettings;
    });
  }
  function renderSettings() {
    const items = visibleSettingsItems();
    const groups = new Map();
    items.forEach((item) => { const category = item.category || "อื่นๆ"; if (!groups.has(category)) groups.set(category, []); groups.get(category).push(item); });
    const mode = state.settingsSection;
    $("#settingsCategoryNav").innerHTML = [...groups.keys()].map((category, index) => `<button data-settings-category="${index}" type="button">${escapeHtml(category)}</button>`).join("");
    $("#settingsList").innerHTML = [...groups.entries()].map(([category, rows], index) => `<section id="settings-category-${index}" class="setting-category-group"><h3><span>${escapeHtml(category)}</span><small>${rows.length} รายการ</small></h3>${rows.map((item) => {
      const codes = masterItemCodes(item);
      const mappingLabel = codes.length ? `ผูกสินค้า ${codes.length} รายการ${item.itemId ? "" : " · รอรหัสเชื่อม"}` : "ยังไม่จับคู่สินค้า";
      const stockLabel = item.stockAtBigc ? item.deductTawanaStock ? " · นับ BigC/ตัดทาวน่า" : " · นับสต็อก BigC" : "";
      const detail = mode === "items" ? `${item.unit || "ไม่ระบุหน่วย"} · ${mappingLabel}${stockLabel}${item.active === false ? " · ไม่แสดงในหน้าสั่ง" : ""}` : mode === "costing" ? `${handlingSettingLabel(item)} · ${mappingLabel}` : `${item.unit || "ไม่ระบุหน่วย"} · ${handlingSettingLabel(item)}`;
      const weightControl = mode === "units" ? `<label class="setting-check"><input data-setting="inputMode" data-key="${escapeHtml(item.key)}" type="checkbox" ${item.inputMode === "weight" && !isPieceEstimatedFruit(item) ? "checked" : ""} ${isPieceEstimatedFruit(item) ? "disabled" : ""} aria-label="ชั่งตอนรับหรือคืน"><small>${isPieceEstimatedFruit(item) ? "นับลูก" : "ชั่ง"}</small></label>` : "";
      const returnControl = mode === "returns" ? `<label class="setting-check"><input data-setting="defaultReturn" data-key="${escapeHtml(item.key)}" type="checkbox" ${item.defaultReturn ? "checked" : ""} aria-label="ขึ้นหน้าคืนอัตโนมัติ"><small>ขึ้นหน้าคืน</small></label>` : "";
      const selecting = mode === "items" && state.selectingSettings;
      const selection = selecting ? `<label class="setting-select"><input data-select-settings-item="${escapeHtml(item.key)}" type="checkbox" aria-label="เลือก ${escapeHtml(item.displayName)}"></label>` : "";
      return `<div class="setting-row${selecting ? " setting-row-selectable" : ""}">${selection}<span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(detail)}</small></span>${weightControl}${returnControl}<span class="setting-actions"><button data-edit-item="${escapeHtml(item.key)}" type="button" aria-label="แก้ไข ${escapeHtml(item.displayName)}">✎</button></span></div>`;
    }).join("")}</section>`).join("") || `<div class="empty-state">ไม่พบรายการ</div>`;
    $$('[data-settings-category]').forEach((button) => { button.onclick = () => $("#settings-category-" + button.dataset.settingsCategory)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    $$('[data-setting]').forEach((input) => { input.onchange = () => { const item = state.menu.find((row) => row.key === input.dataset.key); if (input.dataset.setting === "inputMode") item.inputMode = input.checked ? "weight" : "quantity"; else item[input.dataset.setting] = input.checked; }; });
    $$('[data-edit-item]').forEach((button) => { button.onclick = () => openEditItem(button.dataset.editItem); });
    $$("[data-select-settings-item]").forEach((input) => { input.onchange = () => {
      if (input.checked) state.selectedSettingsKeys.add(input.dataset.selectSettingsItem);
      else state.selectedSettingsKeys.delete(input.dataset.selectSettingsItem);
      updateSettingsSelection();
    }; });
    updateSettingsSelection();
  }
  async function persistSettings(successText) {
    if (DEMO_MODE) { notice("โหมดทดลองไม่บันทึกการตั้งค่าจริง"); return false; }
    loading("กำลังบันทึกการตั้งค่า"); notice("");
    const payload = settingsPayload();
    cacheSettings(payload, true);
    try {
      if (!state.session) {
        showSettingsConnection(true, "เข้าสู่ระบบออนไลน์ก่อนบันทึก เพื่อให้รายการใช้ได้ทุกเครื่อง");
        notice(`${successText}ในเครื่อง แต่ยังไม่ได้ส่ง Supabase`, true);
        addMissingDefaultReturns(); renderAll(); saveDraft();
        setSync("ต้องเชื่อม Supabase", "error"); return "queued";
      }
      if (!navigator.onLine) {
        showSettingsConnection(true, "อุปกรณ์ออฟไลน์ การตั้งค่าจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์");
        notice(`${successText}ในเครื่องแล้ว ระบบจะส่งเมื่อออนไลน์`);
        addMissingDefaultReturns(); renderAll(); saveDraft();
        setSync("ออฟไลน์ · การตั้งค่ารอส่ง", "pending"); return "queued";
      } else {
        await uploadSettingsPayload(payload);
        notice(successText);
      }
      addMissingDefaultReturns(); renderAll(); saveDraft();
      setSync("บันทึกการตั้งค่าแล้ว", "ok"); return "synced";
    } catch (error) {
      showSettingsConnection(true, `ส่งไม่สำเร็จ: ${error.message}`);
      notice(`${successText}ในเครื่องแล้ว รอส่ง Supabase: ${error.message}`, true);
      addMissingDefaultReturns(); renderAll(); saveDraft();
      setSync("การตั้งค่ารอส่ง", "pending"); return "queued";
    } finally { loading("", false); }
  }
  async function saveSettings() {
    const status = await persistSettings("บันทึกการตั้งค่าแล้ว");
    if (status === "synced") $("#settingsModal").classList.add("hidden");
  }
  function openAddItem() {
    $("#newItemName").value = ""; $("#newItemCategory").value = categoryNames()[0] || ""; $("#newItemUnit").value = "";
    $("#addItemError").textContent = "";
    $("#categoryOptions").innerHTML = categoryNames().map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    $("#addItemModal").classList.remove("hidden");
  }
  async function addMenuItem() {
    const name = $("#newItemName").value.trim(); const category = $("#newItemCategory").value.trim(); const unit = $("#newItemUnit").value.trim();
    if (!name || !category) { $("#addItemError").textContent = "กรุณากรอกชื่อรายการและประเภท"; return; }
    const key = keyFor(name, unit); if (state.menu.some((item) => item.displayName === (unit ? `${name} (${unit})` : name))) { $("#addItemError").textContent = "มีรายการนี้แล้ว"; return; }
    const item = { key: globalThis.crypto?.randomUUID?.() || key, displayName: unit ? `${name} (${unit})` : name, name, category, unit, inputMode: "quantity", active: true, defaultReturn: false, sortOrder: state.menu.length };
    state.menu.push(item);
    if (!await persistSettings("เพิ่มรายการแล้ว")) { state.menu = state.menu.filter((row) => row !== item); $("#addItemError").textContent = "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"; return; }
    $("#addItemModal").classList.add("hidden"); renderSettings();
  }
  async function openEditItem(key, focusMapping = false) {
    const item = state.menu.find((row) => row.key === key); if (!item) return;
    state.editingKey = key; $("#editItemName").value = item.name || item.displayName; $("#editItemUnit").value = item.unit || "";
    const category = item.category || "อื่นๆ";
    const categories = [...new Set([...categoryNames(), category])];
    $("#editItemCategory").innerHTML = categories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("") + `<option value="__new__">＋ เพิ่มหมวดหมู่ใหม่</option>`;
    $("#editItemCategory").value = category;
    $("#editItemNewCategory").value = "";
    $("#editItemNewCategoryField").classList.add("hidden");
    $("#editItemHandlingType").value = receiveHandlingType(item);
    $("#editItemActive").checked = item.active !== false;
    $("#editItemStockBigc").checked = item.stockAtBigc === true;
    $("#editItemStockTawana").checked = item.deductTawanaStock === true;
    $("#editItemStockTawanaField").classList.toggle("hidden", item.stockAtBigc !== true);
    $("#editItemMappingSearch").value = focusMapping ? (item.name || item.displayName || "") : "";
    state.editingMasterCodes = masterItemCodes(item);
    $("#editItemMappingStatus").textContent = "กำลังโหลดสินค้าข้อมูลกลาง…";
    $("#editItemMasterList").innerHTML = `<div class="empty-state">กำลังโหลดสินค้ากลาง…</div>`;
    $("#editItemError").textContent = "";
    $("#editItemModal").classList.remove("hidden");
    try { await loadMasterItems(); renderMasterItemOptions(); }
    catch (error) {
      $("#editItemMappingStatus").textContent = `โหลดสินค้าข้อมูลกลางไม่สำเร็จ: ${error.message}`;
      $("#editItemMasterList").innerHTML = `<div class="empty-state">โหลดสินค้ากลางไม่สำเร็จ กรุณาลองใหม่</div>`;
    }
  }
  async function saveEditedItem() {
    const item = state.menu.find((row) => row.key === state.editingKey); if (!item) return;
    const name = $("#editItemName").value.trim(); const unit = $("#editItemUnit").value.trim();
    const category = $("#editItemCategory").value === "__new__" ? $("#editItemNewCategory").value.trim() : $("#editItemCategory").value.trim();
    const handlingType = $("#editItemHandlingType").value;
    if (!name || !category) { $("#editItemError").textContent = "กรุณากรอกชื่อรายการและหมวดหมู่"; return; }
    const previous = { ...item };
    item.name = name; item.unit = unit; item.category = category; item.displayName = unit ? `${name} (${unit})` : name;
    item.handlingType = handlingType; item.costingBasis = receiveCostingBasis({ ...item, costingBasis: "" }, handlingType);
    item.active = $("#editItemActive").checked;
    item.stockAtBigc = $("#editItemStockBigc").checked;
    item.deductTawanaStock = item.stockAtBigc && $("#editItemStockTawana").checked;
    const mapping = canonicalCodeFor(state.editingMasterCodes, state.normalizedRowsByCode, state.masterItemsByCode);
    if (mapping.error && state.editingMasterCodes.length) { $("#editItemError").textContent = mapping.error; return; }
    Object.assign(item, withMasterItemCodes(item, mapping.code ? [mapping.code, ...state.editingMasterCodes] : [], mapping.code));
    item.itemId = item.masterItemId ? state.normalizedItemsByCode.get(item.masterItemId) || null : null;
    if (item.stockAtBigc && !item.itemId) {
      Object.assign(item, previous);
      $("#editItemError").textContent = "กรุณาจับคู่สินค้ากลางก่อนเปิดนับสต็อก";
      return;
    }
    try { await ensureMappedCatalogItems([item]); }
    catch (error) { Object.assign(item, previous); $("#editItemError").textContent = `จับคู่ไม่สำเร็จ: ${error.message}`; return; }
    if (!await persistSettings("แก้ไขรายการแล้ว")) { Object.assign(item, previous); $("#editItemError").textContent = "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"; return; }
    state.mappingDirty = false;
    $("#editItemModal").classList.add("hidden"); renderSettings();
    if (!$("#mappingModal").classList.contains("hidden")) renderMappingList();
  }
  async function deleteMenuItems(keys) {
    if (!state.selectingSettings || state.settingsSection !== "items" || state.deletingSettings || isStaffView() || !state.access?.canManage) return;
    const keySet = new Set(keys);
    const items = state.menu.filter((item) => keySet.has(item.key));
    if (!items.length) return;
    const names = items.slice(0, 8).map((item) => `• ${item.displayName}`).join("\n");
    const more = items.length > 8 ? `\nและอีก ${items.length - 8} รายการ` : "";
    if (!confirm(`ยืนยันลบสินค้า ${items.length} รายการหรือไม่?\n\n${names}${more}`)) return;
    state.deletingSettings = true;
    updateSettingsSelection();
    const previousMenu = [...state.menu];
    let persisted = false;
    try {
      state.menu = state.menu.filter((item) => !keySet.has(item.key));
      if (!await persistSettings(`ลบสินค้า ${items.length} รายการแล้ว`)) {
        state.menu = previousMenu;
        return;
      }
      persisted = true;
      items.forEach(({ key }) => {
        delete state.order[key]; delete state.receive[key]; delete state.returns[key];
        state.selectedSettingsKeys.delete(key);
      });
      saveDraft(); renderAll();
    } catch (error) {
      if (!persisted) state.menu = previousMenu;
      notice(`บันทึกการลบไม่สำเร็จ: ${error.message}`, true);
    } finally {
      state.deletingSettings = false;
      renderSettings();
    }
  }

  function categoryNames() {
    return [...new Set(state.menu.map((item) => item.category || "อื่นๆ"))];
  }
  function normalizeMenuOrder() {
    state.menu.forEach((item, index) => { item.sortOrder = index; });
  }
  function moveCategory(category, direction) {
    const categories = categoryNames(); const index = categories.indexOf(category); const next = index + direction;
    if (index < 0 || next < 0 || next >= categories.length) return;
    [categories[index], categories[next]] = [categories[next], categories[index]];
    const rank = new Map(categories.map((name, position) => [name, position]));
    state.menu = state.menu.map((item, position) => ({ item, position })).sort((left, right) => rank.get(left.item.category || "อื่นๆ") - rank.get(right.item.category || "อื่นๆ") || left.position - right.position).map((row) => row.item);
    normalizeMenuOrder(); renderSortList();
  }
  function moveItem(key, direction) {
    const item = state.menu.find((row) => row.key === key); if (!item) return;
    const indexes = state.menu.map((row, index) => ({ row, index })).filter(({ row }) => (row.category || "อื่นๆ") === (item.category || "อื่นๆ")).map(({ index }) => index);
    const position = indexes.indexOf(state.menu.indexOf(item)); const nextPosition = position + direction;
    if (position < 0 || nextPosition < 0 || nextPosition >= indexes.length) return;
    const nextIndex = indexes[nextPosition]; const currentIndex = indexes[position];
    [state.menu[currentIndex], state.menu[nextIndex]] = [state.menu[nextIndex], state.menu[currentIndex]];
    normalizeMenuOrder(); renderSortList();
  }
  function sortRow(label, detail, key, index, total) {
    return `<div class="sort-row"><span class="sort-grip" aria-hidden="true">⋮⋮</span><span class="sort-copy"><strong>${escapeHtml(label)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</span><div class="sort-actions"><button data-sort-key="${escapeHtml(key)}" data-sort-step="-1" type="button" aria-label="เลื่อนขึ้น" ${index === 0 ? "disabled" : ""}>↑</button><button data-sort-key="${escapeHtml(key)}" data-sort-step="1" type="button" aria-label="เลื่อนลง" ${index === total - 1 ? "disabled" : ""}>↓</button></div></div>`;
  }
  function renderSortList() {
    const categories = categoryNames();
    $("#sortCategoryField").classList.toggle("hidden", state.sortMode !== "items");
    $("#sortCategorySelect").innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}" ${category === state.sortCategory ? "selected" : ""}>${escapeHtml(category)}</option>`).join("");
    if (!categories.includes(state.sortCategory)) state.sortCategory = categories[0] || "";
    if (state.sortMode === "categories") {
      $("#sortList").innerHTML = categories.length ? categories.map((category, index) => sortRow(category, `${state.menu.filter((item) => (item.category || "อื่นๆ") === category).length} รายการ`, category, index, categories.length)).join("") : `<div class="empty-state">ยังไม่มีหมวดหมู่</div>`;
    } else {
      const items = state.menu.filter((item) => (item.category || "อื่นๆ") === state.sortCategory);
      $("#sortList").innerHTML = items.length ? items.map((item, index) => sortRow(item.displayName, item.unit || "", item.key, index, items.length)).join("") : `<div class="empty-state">ยังไม่มีรายการในหมวดนี้</div>`;
    }
    $$('[data-sort-key]').forEach((button) => { button.onclick = () => state.sortMode === "categories" ? moveCategory(button.dataset.sortKey, Number(button.dataset.sortStep)) : moveItem(button.dataset.sortKey, Number(button.dataset.sortStep)); });
  }
  function openSortSettings() {
    $("#sortSaveStatus").textContent = "";
    state.sortSnapshot = state.menu.map((item) => ({ ...item }));
    state.sortMode = "categories"; state.sortCategory = categoryNames()[0] || "";
    $("#sortTitle").textContent = isStaffView() ? "จัดลำดับในเครื่องนี้" : "จัดลำดับ";
    $$("[data-sort-mode]").forEach((button) => button.classList.toggle("active", button.dataset.sortMode === state.sortMode));
    $("#sortModal").classList.remove("hidden"); renderSortList();
  }
  async function saveSortOrder() {
    const button = $("#saveSortOrder");
    if (button.disabled) return;
    button.disabled = true;
    const feedback = $("#sortSaveStatus");
    feedback.classList.remove("error");
    feedback.textContent = "กำลังบันทึกลำดับ";
    normalizeMenuOrder();
    try {
      const staff = isStaffView();
      let status = "synced";
      if (staff) {
        localStorage.setItem(STAFF_SORT_KEY, JSON.stringify(state.menu.map((item) => item.key)));
        renderAll();
      } else {
        status = await persistSettings("บันทึกลำดับแล้ว");
      }
      if (!status) throw new Error("กรุณาลองอีกครั้ง");
      // Closing later discards only moves made after this save.
      state.sortSnapshot = state.menu.map((item) => ({ ...item }));
      const sheet = $("#sortModal .modal-sheet");
      const scrollTop = sheet.scrollTop;
      renderSortList();
      sheet.scrollTop = scrollTop;
      feedback.textContent = staff ? "บันทึกลำดับสำหรับเครื่องนี้แล้ว"
        : status === "synced" ? "บันทึกลำดับแล้ว" : "บันทึกลำดับในเครื่องแล้ว · รอส่งออนไลน์";
    } catch (error) {
      feedback.textContent = `บันทึกไม่สำเร็จ: ${error.message}`;
      feedback.classList.add("error");
    } finally {
      button.disabled = false;
    }
  }

  function selectWorkflowTab(tab) {
    state.activeTab = tab;
    $$(".workflow-tabs button").forEach((row) => row.classList.toggle("active", row.dataset.tab === tab));
    $$(".workflow-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${tab}`));
    updateCartBar();
  }
  function initializePersonalSettings() {
    let size = "small";
    try { if (localStorage.getItem(STORAGE_PREFIX + "order-card-size") === "large") size = "large"; } catch (_) {}
    function applySize(value) {
      document.body.dataset.orderCardSize = value;
      $$('[name="orderCardSize"]').forEach(input => { input.checked = input.value === value; });
    }
    applySize(size);
    $$('[name="orderCardSize"]').forEach(input => { input.onchange = () => {
      if (!input.checked) return;
      applySize(input.value);
      try { localStorage.setItem(STORAGE_PREFIX + "order-card-size", input.value); }
      catch (_) { showActionToast("เปลี่ยนขนาดแล้ว แต่เครื่องนี้ยังจำการตั้งค่าไม่ได้", "warning"); }
    }; });
    const updateStickyMetrics = () => {
      const height = selector => $(selector)?.getBoundingClientRect().height || 0;
      const header = height(".branch-header"), tabs = height(".workflow-tabs");
      document.documentElement.style.setProperty("--branch-header-height", header + "px");
      document.documentElement.style.setProperty("--order-controls-top", (header + tabs) + "px");
      document.documentElement.style.setProperty("--order-scroll-offset", (header + tabs + height(".order-pinned-controls") + 12) + "px");
    };
    if (globalThis.ResizeObserver) {
      const observer = new ResizeObserver(updateStickyMetrics);
      [".branch-header", ".workflow-tabs", ".order-pinned-controls"].forEach(selector => { if ($(selector)) observer.observe($(selector)); });
    }
    window.addEventListener("resize", updateStickyMetrics);
    updateStickyMetrics();
  }
  async function logoutFromSettings() {
    if (DEMO_MODE || state.saving) return;
    const button = $("#logoutSettingsButton");
    button.disabled = true;
    window.clearTimeout(state.cloudTimer);
    try {
      if (state.cloudDraftPromise) try { await state.cloudDraftPromise; } catch (_) {}
      try { await state.client?.auth.signOut({ scope: "local" }); } catch (_) {}
      await window.BOY_SESSION_STORAGE.clearProject(window.BOY_CENTRAL_CONFIG.url);
      window.BOY_LOCAL_ACCESS?.clear();
      state.session = null;
      location.replace("burger.html?next=" + encodeURIComponent("bigc-v2.html" + location.search));
    } catch (_) {
      showActionToast("ยังออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง", "error");
      button.disabled = false;
    }
  }
  function bindStaticEvents() {
    $("#logoutSettingsButton").onclick = logoutFromSettings;
    $$(".workflow-tabs button").forEach((button) => { button.onclick = () => selectWorkflowTab(button.dataset.tab); });
    ["cashAmount", "transferAmount", "thaiAmount"].forEach((id) => { $("#" + id).oninput = () => { renderRevenue(); saveDraft(); }; });
    $("#orderSearch").oninput = renderOrder; $("#pickerSearch").oninput = renderPicker; $("#settingsSearch").oninput = renderSettings;
    ["orderDate", "receiveDate", "returnDate"].forEach((id) => { $("#" + id).onchange = () => {
      if (id === "orderDate") state.order = {};
      if (id === "receiveDate") state.receive = {};
      if (id === "returnDate") { state.returns = {}; $("#cashAmount").value = ""; $("#transferAmount").value = ""; $("#thaiAmount").value = ""; }
      renderDateDisplays(); const local = readLocalDraft(); hydrateDraft(local); saveDraft(); loadPage();
    }; });
    $("#refreshButton").onclick = loadPage;
    $("#settingsButton").onclick = openSettings; $("#staffSortButton").onclick = openSortSettings; $("#addReceiveButton").onclick = () => openPicker("receive"); $("#addReturnButton").onclick = () => openPicker("returns");
    $("#submitReceive").onclick = () => submitWorkflow("receive"); $("#submitReturn").onclick = () => submitWorkflow("return");
    $("#openOrderSummary").onclick = openOrderSummary;
    $("#saveAndCopyOrder").onclick = async () => {
      const button = $("#saveAndCopyOrder"); if (button.disabled) return;
      button.disabled = true;
      try {
        const saved = await submitWorkflow("close_order", { reload: false, deferMirror: true });
        if (!saved) { showActionToast($("#pageNotice").textContent || "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง", "error"); return; }
        state.orderHistory = [{ id: saved.submissionId, business_date: saved.businessDate,
          submitted_at: new Date().toISOString(), lines: saved.lines },
        ...(state.orderHistory || []).filter((row) => row.id !== saved.submissionId)].slice(0, 30);
        renderOrderHistory();
        let copied = true;
        try { await copyOrderText(saved.lines, saved.businessDate); }
        catch (_) { copied = false; }
        state.order = {};
        localStorage.removeItem(orderSubmissionKey(saved.businessDate));
        saveDraft();
        window.clearTimeout(state.cloudTimer);
        if (!DEMO_MODE) void saveCloudDraft(currentDraft("order")).catch(() => {
          setSync("ร่างออนไลน์ยังไม่อัปเดต", "pending");
        });
        $("#orderSummaryModal").classList.add("hidden");
        const receiveDate = receiveDateForOrder(saved.businessDate);
        const dateChanged = $("#receiveDate").value !== receiveDate;
        $("#receiveDate").value = receiveDate;
        if (dateChanged) state.receive = readLocalDraft().receive;
        renderDateDisplays(); renderOrder();
        selectWorkflowTab("receive");
        if (!DEMO_MODE) {
          const newRound = { id: saved.submissionId, workflow_id: saved.workflowId,
            business_date: saved.businessDate, submitted_at: new Date().toISOString(), lines: saved.lines };
          state.receiveRounds = [newRound, ...((dateChanged ? [] : state.receiveRounds) || [])
            .filter((round) => round.id !== saved.submissionId)];
          seedReceiveFromRounds(state.receiveRounds, dateChanged ? [] :
            (state.contexts.receive?.workflows || []).filter((row) => row.workflow_type === "receive"));
          renderReceive();
        }
        showActionToast(copied
          ? DEMO_MODE ? "บันทึกและคัดลอกข้อมูลทดลองแล้ว" : "บันทึก Supabase และคัดลอกแล้ว · กำลังส่งสำเนา Google Sheets"
          : "บันทึกแล้ว แต่คัดลอกไม่สำเร็จ · คัดลอกซ้ำในประวัติ", copied ? "ok" : "warning");
        const mirrorPromise = mirrorSavedOrder(saved, { copied });
        try {
          const ready = await refreshReceiveAfterOrder(receiveDate, saved.submissionId);
          if (!ready) showActionToast("บันทึกแล้ว แต่ยังไม่พบใบสั่งในหน้ารับของ · ตรวจประวัติการสั่งของ", "warning");
        } catch (error) {
          showActionToast(`บันทึกแล้ว แต่โหลดหน้ารับของไม่สำเร็จ: ${error.message}`, "warning");
        }
        void mirrorPromise;
      } finally { button.disabled = false; }
    };
    $("#clearOrderFromSummary").onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) clearOrder(); };
    $("#saveSettings").onclick = saveSettings; $("#openAddItem").onclick = openAddItem; $("#addMenuItem").onclick = addMenuItem; $("#openSortSettings").onclick = openSortSettings; $("#saveSortOrder").onclick = saveSortOrder; $("#saveEditedItem").onclick = saveEditedItem;
    if ($("#editItemStockBigc")) $("#editItemStockBigc").onchange = (event) => {
      $("#editItemStockTawanaField")?.classList.toggle("hidden", !event.target.checked);
      if (!event.target.checked && $("#editItemStockTawana")) $("#editItemStockTawana").checked = false;
    };
    $("#settingsBack").onclick = () => showSettingsSection("");
    $("#toggleSettingsSelection").onclick = () => {
      if (state.deletingSettings) return;
      state.selectingSettings = !state.selectingSettings;
      state.selectedSettingsKeys.clear();
      renderSettings();
    };
    $("#selectVisibleSettings").onchange = (event) => {
      visibleSettingsItems().forEach((item) => {
        if (event.target.checked) state.selectedSettingsKeys.add(item.key);
        else state.selectedSettingsKeys.delete(item.key);
      });
      updateSettingsSelection();
    };
    $("#clearSettingsSelection").onclick = () => { state.selectedSettingsKeys.clear(); updateSettingsSelection(); };
    $("#deleteSelectedItems").onclick = () => deleteMenuItems([...state.selectedSettingsKeys]);
    $$('[data-settings-section]').forEach((button) => { button.onclick = () => showSettingsSection(button.dataset.settingsSection); });
    $("#openMappingManager").onclick = openMappingManager; $("#mappingSearch").oninput = renderMappingList; $("#mappingFilter").onchange = renderMappingList; $("#applyExactMappings").onclick = applyExactMappings; $("#saveMappings").onclick = saveMappings; $("#copyStaffLink").onclick = copyStaffLink;
    $("#editItemMappingSearch").oninput = renderMasterItemOptions;
    $("#editItemCategory").onchange = () => {
      const isNew = $("#editItemCategory").value === "__new__";
      $("#editItemNewCategoryField").classList.toggle("hidden", !isNew);
      if (isNew) $("#editItemNewCategory").focus();
    };
    $("#editItemMasterList").onchange = (event) => {
      const code = event.target.dataset.masterCode;
      if (!code) return;
      state.editingMasterCodes = event.target.checked
        ? [...state.editingMasterCodes, code] : state.editingMasterCodes.filter((value) => value !== code);
      renderMasterItemOptions();
    };
    $("#openFruitCostSettings").onclick = openFruitCostSettings;
    $("#saveFruitCost").onclick = saveFruitCost;
    $("#fruitCostRawItem").onchange = renderFruitCostExisting;
    $("#fruitCostMonth").onchange = renderFruitCostExisting;
    $$("[data-sort-mode]").forEach((button) => { button.onclick = () => { state.sortMode = button.dataset.sortMode; $$("[data-sort-mode]").forEach((row) => row.classList.toggle("active", row === button)); renderSortList(); }; });
    $("#sortCategorySelect").onchange = () => { state.sortCategory = $("#sortCategorySelect").value; renderSortList(); };
    $$('[data-close-modal]').forEach((button) => { button.onclick = () => {
      $("#" + button.dataset.closeModal).classList.add("hidden");
      if (button.dataset.closeModal === "orderSummaryModal") renderOrder();
      if (button.dataset.closeModal === "sortModal" && state.sortSnapshot) { state.menu = state.sortSnapshot; state.sortSnapshot = null; renderAll(); }
    }; });
    $$('[data-clear]').forEach((button) => { button.onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) clearOrder(); }; });
    window.addEventListener("online", async () => { await flushPendingSettings(); saveCloudDraft(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveCloudDraft(); });
  }

  async function start(authContext) {
    if (state.started) return;
    state.started = true;
    state.authContext = authContext || null;
    ["orderDate", "receiveDate", "returnDate"].forEach((id) => { $("#" + id).value = today(); }); renderDateDisplays(); bindStaticEvents();
    const config = window.BOY_CENTRAL_CONFIG || {};
    state.client = window.supabase.createClient(config.url, config.publishableKey, { auth: {
      persistSession: true, autoRefreshToken: true,
      ...(window.BOY_SESSION_STORAGE ? { storage: window.BOY_SESSION_STORAGE.storage } : {})
    } });
    const { data } = await state.client.auth.getSession(); state.session = data.session;
    if (!state.session && authContext?.localAccess) {
      await loadAccess();
      applyAccessMode();
      setSync("ต้องเชื่อม Supabase", "error");
      showSettingsConnection(true, "เข้าสู่ระบบออนไลน์ก่อนบันทึก เพื่อให้รายการใช้ได้ทุกเครื่อง");
      notice("กำลังใช้ข้อมูลในเครื่อง · การตั้งค่าจะยังไม่ส่ง Supabase", true);
      state.menu = applyStaffSort(settingsMenu(readStoredJson(SETTINGS_PENDING_KEY) || readStoredJson(SETTINGS_CACHE_KEY), await loadLegacyMenu()));
      hydrateDraft(readLocalDraft()); renderAll(); return;
    }
    await loadPage();
  }

  function loadDemoPage() {
    state.menu = DEMO_STORE.menu();
    state.contexts = {
      order:DEMO_STORE.context($("#orderDate").value),
      receive:DEMO_STORE.context($("#receiveDate").value),
      returns:DEMO_STORE.context($("#returnDate").value)
    };
    state.context = state.contexts.order; state.branch = state.context.branch;
    hydrateDraft(readLocalDraft());
    hydrateSubmitted([
      ...state.contexts.order.workflows.filter(w=>w.workflow_type==="close_order"),
      ...state.contexts.returns.workflows.filter(w=>w.workflow_type==="return")
    ]);
    state.receiveRounds = DEMO_STORE.receiveOrderRounds($("#receiveDate").value);
    seedReceiveFromRounds(state.receiveRounds,state.contexts.receive.workflows.filter(w=>w.workflow_type==="receive"));
    state.receiveHistory = DEMO_STORE.history($("#receiveDate").value);
    state.orderHistory = DEMO_STORE.orderHistory();
    renderAll(); setSync("โหมดทดลอง","pending");
  }
  initializePersonalSettings();
  if (DEMO_MODE) {
    state.started = true; state.access = {canManage:false};
    $("#settingsButton").hidden = false;
    ["orderDate","receiveDate","returnDate"].forEach(id=>$("#"+id).value=today());
    bindStaticEvents(); loadDemoPage();
    $("#resetDemoButton").onclick = () => {
      if (!confirm("ล้างข้อมูลทดลองทั้งหมด?")) return;
      window.clearTimeout(state.cloudTimer); DEMO_STORE.reset(); location.reload();
    };
  } else {
    window.addEventListener("boy-auth-ready", (event) => start(event.detail));
    if (window.BOY_AUTH_CONTEXT) start(window.BOY_AUTH_CONTEXT);
  }
})();

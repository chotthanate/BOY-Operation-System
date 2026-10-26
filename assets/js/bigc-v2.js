(() => {
  "use strict";
  const BRANCH_CODE = "BIGC-CENTRAL-PATTAYA";
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec";
  const CLOUD_DRAFT_DELAY = 8000;
  const SETTINGS_CACHE_KEY = "boy-bigc-v2-settings-cache";
  const SETTINGS_PENDING_KEY = "boy-bigc-v2-settings-pending";
  const STAFF_SORT_KEY = "boy-bigc-v2-staff-sort-v1";
  const REQUESTED_VIEW = new URLSearchParams(location.search).get("view") === "staff" ? "staff" : "admin";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const { codesFor: masterItemCodes, withCodes: withMasterItemCodes } = globalThis.BOYBigCMasterMapping;
  const number = (value) => Math.max(0, Number(value) || 0);
  const money = (value) => number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  };
  const state = {
    client: null, session: null, branch: null, context: null, contexts: {}, menu: [],
    order: {}, receive: {}, returns: {}, activeTab: "close", pickerTarget: "receive", sortMode: "categories", sortCategory: "", editingKey: "",
    cloudTimer: 0, saving: false, started: false, authContext: null, access: null, sortSnapshot: null, mappingDirty: false, editingMasterCodes: [],
    fruitCostItems: [], fruitCostRules: [], fruitWeights: [], masterItems: [], normalizedItemsByCode: new Map(), masterItemsByCode: new Map(), sharedStockVariants: new Map()
  };

  function keyFor(name, unit = "") {
    const source = `${name}|${unit}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `item-${(hash >>> 0).toString(16)}`;
  }

  function draftKey(type, date) { return `boy-bigc-v2-draft:${type}:${date}`; }
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
    state.cloudTimer = window.setTimeout(() => saveCloudDraft(draft), CLOUD_DRAFT_DELAY);
  }
  async function saveCloudDraft(draft = currentDraft()) {
    if (!state.session || !navigator.onLine) return;
    const { error } = await state.client.schema("boy_central").rpc("save_bigc_v2_draft", { payload: draft });
    if (error) { setSync("รอส่งข้อมูล", "error"); return; }
    setSync("บันทึกแล้ว", "ok");
  }

  function setSync(text, tone = "pending") {
    const badge = $("#syncBadge");
    badge.textContent = text;
    badge.className = `sync-badge ${tone === "ok" ? "" : tone}`;
  }
  function notice(text, isError = false) {
    const box = $("#pageNotice"); box.textContent = text || ""; box.classList.toggle("error", isError);
  }
  function showSettingsConnection(visible, message = "เชื่อมต่อบัญชีออนไลน์เพื่อให้การตั้งค่าไม่หายและใช้ได้ทุกเครื่อง") {
    const warning = $("#settingsSyncWarning");
    if (!warning) return;
    warning.hidden = !visible;
    $("#settingsSyncMessage").textContent = message;
  }
  function loading(text, active = true) { $("#loadingText").textContent = text; $("#loadingOverlay").classList.toggle("hidden", !active); }

  async function sheetApi(action, payload = {}) {
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
      itemId: item.itemId || item.item_id || null
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
    $("#settingsButton").hidden = staff || !state.access?.canManage;
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
      active: item.active !== false, sortOrder: Number(item.sortOrder ?? index)
    })).sort((left, right) => left.sortOrder - right.sortOrder || left.key.localeCompare(right.key));
    return JSON.stringify({ menu: normalized, returns: [...(payload?.default_return_keys || [])].sort() });
  }
  function cacheSettings(payload, pending = false) {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(payload));
    if (pending) localStorage.setItem(SETTINGS_PENDING_KEY, JSON.stringify(payload));
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
      await uploadSettingsPayload(pending);
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
      state.context = state.activeTab === "receive" ? state.contexts.receive : state.activeTab === "return" ? state.contexts.returns : state.contexts.order;
      state.branch = state.context.branch;
      await loadAccess();
      await loadMasterItems();
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
      const submitted = hydrateSubmitted([
        ...(state.contexts.order.workflows || []).filter((row) => row.workflow_type === "close_order"),
        ...(state.contexts.receive.workflows || []).filter((row) => row.workflow_type === "receive"),
        ...(state.contexts.returns.workflows || []).filter((row) => row.workflow_type === "return")
      ]);
      if (!submitted.receive) seedReceiveFromPrevious(state.contexts.receive.previous_order);
      else $("#receiveSourceLabel").textContent = "รับของวันนี้เรียบร้อยแล้ว";
      seedDefaultReturns();
      renderAll();
      applyAccessMode();
      const pending = (state.context.pending_sheet_sync || []).length;
      const settingsPending = Boolean(readStoredJson(SETTINGS_PENDING_KEY));
      setSync(settingsPending ? "การตั้งค่ารอส่ง" : pending ? `รอส่งชีต ${pending}` : "ข้อมูลพร้อม", settingsPending || pending ? "pending" : "ok");
    } catch (error) {
      const draft = readLocalDraft(); hydrateDraft(draft);
      if (!state.menu.length) state.menu = settingsMenu(readStoredJson(SETTINGS_PENDING_KEY) || readStoredJson(SETTINGS_CACHE_KEY), await loadLegacyMenu());
      renderAll(); setSync("ใช้งานในเครื่อง", "error"); notice(`โหลดฐานข้อมูลกลางไม่สำเร็จ: ${error.message}`, true);
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
    if (close && !Object.keys(state.order).length) {
      state.order = Object.fromEntries((close.lines || []).map((line) => [line.line_key, number(line.quantity)]));
    }
    if (receive) clearCompletedReceiveDraft($("#receiveDate").value);
    if (returned) {
      if (!Object.keys(state.returns).length) state.returns = Object.fromEntries((returned.lines || []).map((line) => [line.line_key, { ...line }]));
      if (!$("#cashAmount").value && !$("#transferAmount").value && !$("#thaiAmount").value) {
        $("#cashAmount").value = returned.cash_amount || ""; $("#transferAmount").value = returned.transfer_amount || ""; $("#thaiAmount").value = returned.thai_chuay_thai_amount || "";
      }
    }
    return { close: Boolean(close), receive: Boolean(receive), returned: Boolean(returned) };
  }
  function clearCompletedReceiveDraft(date) {
    state.receive = {};
    window.clearTimeout(state.cloudTimer);
    localStorage.setItem(draftKey("receive", date), JSON.stringify({ savedAt: Date.now(), receive: {}, completed: true }));
  }
  function seedReceiveFromPrevious(previous) {
    if (Object.keys(state.receive).length || !previous?.lines?.length) return;
    previous.lines.forEach((line) => { const item = findMenu(line.line_key, line); state.receive[line.line_key] = { ...line, input_mode: item.inputMode, source_line_key: line.line_key, checked: false }; });
    $("#receiveSourceLabel").textContent = `จากรายการวันที่ ${previous.business_date}`;
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

  function receiveHandlingType(item) {
    if (item.handlingType) return item.handlingType;
    const text = `${item.category || ""} ${item.displayName || ""} ${item.name || ""}`.toLowerCase();
    if (/ฝากขาย/.test(text) || /น้ำส้ม\s*\(ขวด\)/.test(text)) return "consignment";
    if (/ปอก|ใส่กล่อง|\(กล่อง\)|คั้น|น้ำผลไม้|น้ำส้ม/.test(text)) return /คั้น|น้ำผลไม้|น้ำส้ม/.test(text) ? "juiced" : "prepared";
    if (/ผลไม้|แตงโม|สับปะรด|มะม่วง|อโวคาโด|อาโวคาโด|ส้ม|มะนาว|มะพร้าว|มะละกอ|เมลอน|แคนตาลูป|เสาวรส/.test(text)) return "whole_fruit";
    return "standard";
  }
  function receiveCostingBasis(item, handlingType = receiveHandlingType(item)) {
    if (isPieceEstimatedFruit(item) && handlingType === "whole_fruit") return "estimated_raw_piece";
    if (item.costingBasis) return item.costingBasis;
    return handlingType === "consignment" ? "consignment" : handlingType === "standard" ? "backend" : handlingType === "whole_fruit" ? "actual_raw_weight_kg" : "backend_yield_from_actual_weight";
  }
  function isPieceEstimatedFruit(item) {
    return receiveHandlingType(item) === "whole_fruit" && item.unit === "ลูก" && /แตงโม|สับปะรด/.test(`${item.name || ""} ${item.displayName || ""}`);
  }
  function needsActualWeight(item) { return !isPieceEstimatedFruit(item) && ["whole_fruit", "prepared", "juiced"].includes(receiveHandlingType(item)); }
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
    if (isPieceEstimatedFruit(item)) return inputControl({ ...item, inputMode: "quantity" }, line.quantity, "receive");
    if (!needsActualWeight(item)) return inputControl(item, line.quantity, "receive");
    const weight = finiteNumber(line.actual_weight_kg);
    const quantityControl = isWeightQuantity(item) ? "" : `<label class="receive-measurement"><span>จำนวนที่รับ (${escapeHtml(item.unit || "หน่วย")})</span><input data-qty-target="receive" data-key="${key}" inputmode="decimal" type="number" min="0" step="0.01" value="${number(line.quantity) || ""}" aria-label="จำนวนที่รับ"></label>`;
    return `<div class="receive-measurements">${quantityControl}<label class="receive-measurement"><span>น้ำหนักจริง (กก.)</span><input data-actual-weight-key="${key}" inputmode="decimal" type="number" min="0" step="0.001" value="${weight === null ? "" : weight}" aria-label="น้ำหนักจริงกิโลกรัม"></label></div>`;
  }
  function sharedStockOptions(item, line) {
    return state.sharedStockVariants.get(item.itemId || item.item_id || line.item_id) || [];
  }
  function renderBrandAllocations(item, line, key) {
    const variants = sharedStockOptions(item, line);
    if (!variants.length) return "";
    const allocations = Array.isArray(line.brand_allocations) && line.brand_allocations.length
      ? line.brand_allocations : [{ item_id: "", quantity: number(line.quantity) || 1 }];
    return `<div class="brand-allocations" data-brand-picker="${escapeHtml(key)}"><strong>ยี่ห้อที่ได้รับ</strong>${allocations.map((allocation, index) =>
      `<div class="brand-allocation-row"><select data-brand-choice="${escapeHtml(key)}" data-brand-index="${index}" aria-label="เลือกยี่ห้อที่รับ"><option value="">เลือกยี่ห้อ</option>${variants.map((variant) =>
        `<option value="${escapeHtml(variant.id)}" ${allocation.item_id === variant.id ? "selected" : ""}>${escapeHtml(variant.name)}</option>`).join("")}</select><input data-brand-quantity="${escapeHtml(key)}" data-brand-index="${index}" type="number" inputmode="numeric" min="1" step="1" value="${number(allocation.quantity)}" aria-label="จำนวนแกลลอน"><button data-brand-remove="${escapeHtml(key)}" data-brand-index="${index}" type="button" aria-label="ลบยี่ห้อ">×</button></div>`).join("")}<button class="brand-add" data-brand-add="${escapeHtml(key)}" type="button">+ อีกยี่ห้อ</button></div>`;
  }

  function renderDateDisplays() {
    $$('[data-date-display]').forEach((label) => {
      const value = $("#" + label.dataset.dateDisplay).value;
      if (!value) { label.textContent = "เลือกวันที่"; return; }
      const [year, month, day] = value.split("-"); label.textContent = `${day}/${month}/${Number(year) + 543}`;
    });
  }
  function renderAll() { renderDateDisplays(); renderRevenue(); renderOrder(); renderReceive(); renderReturns(); updateCartBar(); }
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
    if (!target.startsWith("order") && item.inputMode === "weight") return `<div class="weight-control"><input data-qty-target="${target}" data-key="${item.key}" inputmode="decimal" type="number" min="0" step="0.01" value="${number(value) || ""}" placeholder="${escapeHtml(item.unit || "น้ำหนัก")}"></div>`;
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
  function findMenu(key, line) { return state.menu.find((item) => item.key === key) || { key, displayName: line.item_name, name: line.item_name, category: line.category_name || "อื่นๆ", unit: line.unit_name || "", inputMode: line.input_mode || "quantity", handlingType: line.handling_type || "", costingBasis: line.costing_basis || "", itemId: line.item_id || null, sortOrder: line.sort_order || 0 }; }
  function renderReceive() {
    const entries = Object.entries(state.receive); let checked = 0;
    $("#receiveList").innerHTML = entries.length ? entries.map(([key, line]) => {
      const item = findMenu(key, line); if (line.checked) checked += 1;
      const type = receiveHandlingType(item); const kind = handlingLabel(type);
      return `<div class="item-row ${line.checked ? "" : "unchecked"}" data-swipe-key="${key}" data-swipe-target="receive"><button class="swipe-delete" data-remove-target="receive" data-key="${key}" type="button">ไม่ได้รับ</button><div class="item-row-inner receive-row-inner"><label class="receive-check"><input data-receive-check="${key}" type="checkbox" ${line.checked ? "checked" : ""}><span class="item-copy"><strong>${kind ? `<span class="receive-kind">${escapeHtml(kind)}</span>` : ""}${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small>${costStatusHtml(line)}</span></label>${receiveControls(item, line, key)}</div>${line.checked ? renderBrandAllocations(item, line, key) : ""}</div>`;
    }).join("") : `<div class="empty-state">ยังไม่มีรายการจากเมื่อคืน<br>กด “+ เพิ่ม” เพื่อเพิ่มเอง</div>`;
    $("#receiveProgress").textContent = `${checked} / ${entries.length} รายการ`;
    $("#receiveProgressBar").style.width = `${entries.length ? checked / entries.length * 100 : 0}%`;
    bindQuantityEvents(); bindActualWeightEvents(); bindBrandEvents(); bindRowEvents();
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
  function clearOrder() { state.order = {}; saveDraft(); renderOrder(); renderOrderSummary(); }
  async function copyOrderText() {
    const groups = groupedMenu(); let text = `รายการสั่งของ BigC (${formatThaiDate($("#orderDate").value)})`;
    groups.forEach((items, category) => {
      const rows = items.filter((item) => number(state.order[item.key]) > 0).map((item) => `- ${item.displayName} x ${number(state.order[item.key])}`);
      if (rows.length) text += `\n\n${category}\n${rows.join("\n")}`;
    });
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
      const item = findMenu(key, line); const handlingType = line.handling_type || receiveHandlingType(item);
      return {
        ...line, line_key: key, item_id: line.item_id || item.itemId || item.item_id || null,
        input_mode: isPieceEstimatedFruit(item) && type === "receive" ? "quantity" : line.input_mode,
        actual_weight_kg: isPieceEstimatedFruit(item) && type === "receive" ? null : line.actual_weight_kg,
        handling_type: handlingType, costing_basis: receiveCostingBasis(item, handlingType),
        measurement_basis: isPieceEstimatedFruit(item) && type === "receive" ? "estimated_raw" : line.measurement_basis,
        received: type === "receive" ? Boolean(line.checked) : true
      };
    });
  }

  async function submitWorkflow(type) {
    if (state.saving) return false;
    const lines = linesFor(type);
    if (type === "close_order" && !lines.length) { notice("ยังไม่มีรายการสั่งของ", true); return false; }
    if (type === "receive" && !lines.length) { notice("กรุณาเช็กรายการที่ได้รับอย่างน้อย 1 รายการ", true); return false; }
    if (type === "receive") {
      const invalidPiece = lines.find((line) => isPieceEstimatedFruit(findMenu(line.line_key, line)) && !Number.isInteger(Number(line.quantity)));
      if (invalidPiece) { notice(`จำนวนลูกของ ${invalidPiece.item_name} ต้องเป็นจำนวนเต็ม`, true); return false; }
      const missingWeight = lines.find((line) => needsActualWeight(findMenu(line.line_key, line)) && number(line.actual_weight_kg) <= 0);
      if (missingWeight) { notice(`กรอกน้ำหนักจริงของ ${missingWeight.item_name} ก่อนบันทึก`, true); return false; }
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
      if (invalidBrand) { notice(`เลือกยี่ห้อและจำนวนแกลลอนให้ตรงกับที่รับจริง: ${invalidBrand.item_name}`, true); return false; }
    }
    const payload = {
      workflow_type: type, business_date: type === "close_order" ? $("#orderDate").value : type === "receive" ? $("#receiveDate").value : $("#returnDate").value,
      source_workflow_id: type === "receive" ? state.contexts.receive?.previous_order?.id || null : null,
      cash_amount: type === "return" ? number($("#cashAmount").value) : 0,
      transfer_amount: type === "return" ? number($("#transferAmount").value) : 0,
      thai_chuay_thai_amount: type === "return" ? number($("#thaiAmount").value) : 0,
      lines
    };
    state.saving = true; loading("กำลังบันทึกลงฐานข้อมูล"); notice("");
    try {
      const { data, error } = await state.client.schema("boy_central").rpc("save_bigc_v2_workflow", { payload });
      if (error) throw error;
      if (type === "receive") {
        clearCompletedReceiveDraft(payload.business_date);
        $("#receiveSourceLabel").textContent = "รับของวันนี้เรียบร้อยแล้ว";
        renderReceive();
      } else saveDraft();
      setSync("บันทึกฐานข้อมูลแล้ว", "ok");
      try {
        await sheetApi("bigcV2MirrorWorkflow", { payload: { ...payload, workflow_id: data.workflow_id } });
        await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "synced", sync_error: null });
        setSync("บันทึกครบแล้ว", "ok"); notice("บันทึกเรียบร้อย");
      } catch (sheetError) {
        await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "error", sync_error: String(sheetError.message || sheetError).slice(0, 400) });
        setSync("รอส่ง Google Sheets", "pending"); notice("ข้อมูลอยู่ในฐานข้อมูลแล้ว แต่สำเนา Google Sheets ยังรอส่ง", false);
      }
      await loadPage(); return true;
    } catch (error) { setSync("บันทึกไม่สำเร็จ", "error"); notice(error.message, true); return false; }
    finally { state.saving = false; loading("", false); }
  }

  function openPicker(target) { state.pickerTarget = target; $("#pickerSearch").value = ""; $("#pickerModal").classList.remove("hidden"); renderPicker(); }
  function renderPicker() {
    const query = $("#pickerSearch").value.trim().toLowerCase(); const selected = targetObject(state.pickerTarget);
    const items = state.menu.filter((item) => item.active && !selected[item.key] && (!query || `${item.displayName} ${item.category}`.toLowerCase().includes(query)));
    $("#pickerList").innerHTML = items.length ? items.map((item) => `<button class="picker-item" data-pick="${item.key}" type="button"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)}</small></span><b>＋</b></button>`).join("") : `<div class="empty-state">ไม่พบรายการ</div>`;
    $$('[data-pick]').forEach((button) => { button.onclick = () => { const item = state.menu.find((row) => row.key === button.dataset.pick); selected[item.key] = { ...lineFromMenu(item), checked: state.pickerTarget === "receive" }; saveDraft(); $("#pickerModal").classList.add("hidden"); state.pickerTarget === "receive" ? renderReceive() : renderReturns(); }; });
  }

  function openSettings() {
    if (isStaffView() || !state.access?.canManage) { notice("บัญชีนี้ใช้รายการได้ แต่ไม่มีสิทธิ์แก้การตั้งค่า", true); return; }
    $("#settingsModal").classList.remove("hidden"); $("#settingsSearch").value = "";
    const hasPending = Boolean(readStoredJson(SETTINGS_PENDING_KEY));
    showSettingsConnection(!state.session || hasPending, !state.session ? "เข้าสู่ระบบออนไลน์ก่อนบันทึก เพื่อให้รายการใช้ได้ทุกเครื่อง" : "มีการตั้งค่าที่เก็บไว้ในเครื่องและยังรอส่งขึ้น Supabase");
    renderSettings(); updateMappingSummary();
  }
  async function loadMasterItems() {
    if (state.masterItems.length || !state.session) return;
    const [catalogResult, normalizedResult] = await Promise.all([
      state.client.schema("boy_central").rpc("get_master_catalog", { target_sheet_name: "M_สินค้า" }),
      state.client.schema("boy_central").from("items").select("id,code,name,stock_target_item_id,active").eq("active", true).limit(1000)
    ]);
    if (catalogResult.error) throw catalogResult.error;
    if (normalizedResult.error) throw normalizedResult.error;
    state.masterItems = (catalogResult.data?.rows || []).filter((row) => row.item_id && row["เปิดใช้งาน"] !== false)
      .map((row) => ({ code: String(row.item_id), name: String(row["ชื่อสินค้า"] || row.item_id) }));
    state.normalizedItemsByCode = new Map((normalizedResult.data || []).map((row) => [String(row.code), row.id]));
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
    const query = $("#editItemMappingSearch").value.trim().toLowerCase();
    const selected = new Set(state.editingMasterCodes);
    const choices = [
      ...state.editingMasterCodes.filter((code) => !state.masterItemsByCode.has(code)).map((code) => ({ code, name: code })),
      ...state.masterItems.filter((row) => selected.has(row.code)
        || !query || `${row.name} ${row.code}`.toLowerCase().includes(query))
    ];
    choices.sort((left, right) => {
      const leftRank = state.editingMasterCodes.indexOf(left.code);
      const rightRank = state.editingMasterCodes.indexOf(right.code);
      return (leftRank < 0 ? Infinity : leftRank) - (rightRank < 0 ? Infinity : rightRank);
    });
    $("#editItemMasterList").innerHTML = choices.length ? choices.map((row) => {
      const checked = selected.has(row.code);
      const primary = state.editingMasterCodes[0] === row.code;
      return `<div class="master-choice-row ${checked ? "selected" : ""}"><label><input data-master-code="${escapeHtml(row.code)}" type="checkbox" ${checked ? "checked" : ""}><span>${escapeHtml(row.name)} <small>· ${escapeHtml(row.code)}</small></span></label>${primary ? "<small>หลัก</small>" : checked ? `<button data-master-primary="${escapeHtml(row.code)}" type="button">ใช้เป็นหลัก</button>` : ""}</div>`;
    }).join("") : `<div class="empty-state">ไม่พบสินค้า</div>`;
    updateMappingStatus();
  }
  function updateMappingStatus() {
    const codes = state.editingMasterCodes;
    const primary = codes[0];
    $("#editItemMappingStatus").textContent = !primary ? "ยังไม่จับคู่สินค้า"
      : codes.length === 1 ? `ผูกแล้ว 1 รายการ · หลัก ${primary}`
      : `ผูกแล้ว ${codes.length} รายการ · รับของและคิดต้นทุนด้วยสินค้าหลัก ${primary}`;
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
      const current = code ? `หลัก ${names[0]}${names.length > 1 ? ` · ${names.slice(1, 3).join(" · ")}${names.length > 3 ? ` · +${names.length - 3}` : ""}` : ""}` : "ยังไม่จับคู่";
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
    const rule = state.fruitCostRules.find((row) => row.received_item_id === itemId && row.effective_month === month);
    const weight = state.fruitWeights.find((row) => row.raw_item_id === itemId && row.effective_month === month);
    $("#fruitCostYieldPercent").value = rule?.yield_ratio ? number(rule.yield_ratio) * 100 : "";
    $("#fruitCostKgPerPiece").value = weight?.kg_per_piece ?? "";
    $("#fruitCostSampleNote").value = rule?.yield_source_note || weight?.sample_note || "";
  }
  async function openFruitCostSettings() {
    $("#fruitCostError").textContent = "";
    $("#fruitCostMonth").value = today().slice(0, 7);
    $("#fruitCostModal").classList.remove("hidden");
    if (!state.session) { $("#fruitCostError").textContent = "เชื่อมต่อบัญชีออนไลน์ก่อนตั้งค่าต้นทุน"; return; }
    loading("กำลังโหลดต้นทุนผลไม้");
    try {
      const { data, error } = await state.client.schema("boy_central").rpc("get_bigc_fruit_cost_settings");
      if (error) throw error;
      state.fruitCostItems = data?.items || [];
      state.fruitCostRules = data?.rules || [];
      state.fruitWeights = data?.weights || [];
      renderFruitCostItemOptions();
    } catch (error) {
      $("#fruitCostError").textContent = `โหลดการตั้งค่าต้นทุนไม่ได้: ${error.message}`;
    } finally { loading("", false); }
  }
  async function saveFruitCost() {
    const itemId = $("#fruitCostRawItem").value;
    const kg = Number($("#fruitCostKgPerPiece").value);
    const yieldPercent = Number($("#fruitCostYieldPercent").value);
    const month = $("#fruitCostMonth").value;
    const sampleNote = $("#fruitCostSampleNote").value.trim();
    const hasKg = Number.isFinite(kg) && kg > 0;
    const hasYield = Number.isFinite(yieldPercent) && yieldPercent > 0 && yieldPercent <= 100;
    if (!itemId || !month || (!hasKg && !hasYield) || !sampleNote) {
      $("#fruitCostError").textContent = "เลือกผลไม้ เดือน กรอก Yield หรือน้ำหนักต่อลูก และระบุที่มาของตัวเลข"; return;
    }
    loading("กำลังบันทึกต้นทุนผลไม้"); $("#fruitCostError").textContent = "";
    try {
      const selected = state.fruitCostItems.find((item) => item.id === itemId);
      const { error: ruleError } = await state.client.schema("boy_central").rpc("admin_save_bigc_interbranch_cost_rule", {
        payload: {
          received_item_id: itemId, raw_item_id: itemId, effective_month: `${month}-01`,
          counted_by_piece: selected?.base_unit_code === "UNIT-013", yield_ratio: hasYield ? yieldPercent / 100 : null,
          yield_source_note: hasYield ? sampleNote : null, note: "ผลไม้หลักตัวเดียว; รูปแบบรับของกำหนดใน BigC"
        }
      });
      if (ruleError) throw ruleError;
      let affected = 0;
      if (hasKg) {
        const { data, error } = await state.client.schema("boy_central").rpc("admin_save_bigc_piece_weight", {
          payload: { raw_item_id: itemId, effective_month: `${month}-01`, kg_per_piece: kg, sample_note: sampleNote }
        });
        if (error) throw error;
        affected = Number(data?.workflows_requiring_reprocess || 0);
      }
      const monthStart = `${month}-01`;
      state.fruitCostRules = state.fruitCostRules.filter((row) => row.received_item_id !== itemId || row.effective_month !== monthStart);
      state.fruitCostRules.push({ received_item_id: itemId, raw_item_id: itemId, effective_month: monthStart, yield_ratio: hasYield ? yieldPercent / 100 : null, yield_source_note: sampleNote });
      if (hasKg) {
        state.fruitWeights = state.fruitWeights.filter((row) => row.raw_item_id !== itemId || row.effective_month !== monthStart);
        state.fruitWeights.push({ raw_item_id: itemId, effective_month: monthStart, kg_per_piece: kg, sample_note: sampleNote });
      }
      $("#fruitCostModal").classList.add("hidden");
      notice(affected > 0 ? `บันทึกแล้ว · ระบบคำนวณต้นทุนรายการเดิมให้อัตโนมัติ ${affected} รายการ` : "บันทึกการคำนวณต้นทุนแล้ว");
    } catch (error) { $("#fruitCostError").textContent = `บันทึกไม่สำเร็จ: ${error.message}`; }
    finally { loading("", false); }
  }
  function renderSettings() {
    const query = $("#settingsSearch").value.trim().toLowerCase();
    const items = state.menu.filter((item) => !query || `${item.displayName} ${item.category}`.toLowerCase().includes(query));
    const groups = new Map();
    items.forEach((item) => { const category = item.category || "อื่นๆ"; if (!groups.has(category)) groups.set(category, []); groups.get(category).push(item); });
    $("#settingsList").innerHTML = [...groups.entries()].map(([category, rows]) => `<section class="setting-category-group"><h3><span>${escapeHtml(category)}</span><small>${rows.length} รายการ</small></h3>${rows.map((item) => {
      const codes = masterItemCodes(item);
      const mappingLabel = codes.length ? `ผูกสินค้า ${codes.length} รายการ · หลัก ${escapeHtml(codes[0])}${item.itemId ? "" : " · รอรหัสเชื่อม"}` : "ยังไม่จับคู่สินค้า";
      return `<div class="setting-row"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")} · ${escapeHtml(handlingSettingLabel(item))}</small><small>${mappingLabel}${item.active === false ? " · ไม่แสดงในหน้าสั่ง" : ""}</small></span><label class="setting-check"><input data-setting="inputMode" data-key="${item.key}" type="checkbox" ${item.inputMode === "weight" && !isPieceEstimatedFruit(item) ? "checked" : ""} ${isPieceEstimatedFruit(item) ? "disabled" : ""} aria-label="ชั่งตอนรับหรือคืน"><small>${isPieceEstimatedFruit(item) ? "นับลูก" : "ชั่ง"}</small></label><label class="setting-check"><input data-setting="defaultReturn" data-key="${item.key}" type="checkbox" ${item.defaultReturn ? "checked" : ""} aria-label="ขึ้นหน้าคืนอัตโนมัติ"><small>คืน</small></label><span class="setting-actions"><button data-edit-item="${item.key}" type="button" aria-label="แก้ไข ${escapeHtml(item.displayName)}">✎</button><button data-delete-item="${item.key}" type="button" aria-label="ลบ ${escapeHtml(item.displayName)}">ลบ</button></span></div>`;
    }).join("")}</section>`).join("") || `<div class="empty-state">ไม่พบรายการ</div>`;
    $$('[data-setting]').forEach((input) => { input.onchange = () => { const item = state.menu.find((row) => row.key === input.dataset.key); if (input.dataset.setting === "inputMode") item.inputMode = input.checked ? "weight" : "quantity"; else item[input.dataset.setting] = input.checked; }; });
    $$('[data-edit-item]').forEach((button) => { button.onclick = () => openEditItem(button.dataset.editItem); });
    $$('[data-delete-item]').forEach((button) => { button.onclick = () => deleteMenuItem(button.dataset.deleteItem); });
  }
  async function persistSettings(successText) {
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
    state.editingKey = key; $("#editItemName").value = item.name || item.displayName; $("#editItemUnit").value = item.unit || ""; $("#editItemCategory").value = item.category || "อื่นๆ";
    $("#editItemHandlingType").value = receiveHandlingType(item);
    $("#editItemActive").checked = item.active !== false;
    $("#editItemMappingSearch").value = focusMapping ? (item.name || item.displayName || "") : "";
    state.editingMasterCodes = masterItemCodes(item);
    $("#editItemMappingStatus").textContent = "กำลังโหลดสินค้าข้อมูลกลาง…";
    $("#editItemError").textContent = "";
    $("#editItemModal").classList.remove("hidden");
    try { await loadMasterItems(); renderMasterItemOptions(); }
    catch (error) { $("#editItemMappingStatus").textContent = `โหลดสินค้าข้อมูลกลางไม่สำเร็จ: ${error.message}`; }
  }
  async function saveEditedItem() {
    const item = state.menu.find((row) => row.key === state.editingKey); if (!item) return;
    const name = $("#editItemName").value.trim(); const unit = $("#editItemUnit").value.trim(); const category = $("#editItemCategory").value.trim(); const handlingType = $("#editItemHandlingType").value;
    if (!name || !category) { $("#editItemError").textContent = "กรุณากรอกชื่อรายการและหมวดหมู่"; return; }
    const previous = { ...item };
    item.name = name; item.unit = unit; item.category = category; item.displayName = unit ? `${name} (${unit})` : name;
    item.handlingType = handlingType; item.costingBasis = receiveCostingBasis({ ...item, costingBasis: "" }, handlingType);
    item.active = $("#editItemActive").checked;
    Object.assign(item, withMasterItemCodes(item, state.editingMasterCodes));
    item.itemId = item.masterItemId ? state.normalizedItemsByCode.get(item.masterItemId) || null : null;
    try { await ensureMappedCatalogItems([item]); }
    catch (error) { Object.assign(item, previous); $("#editItemError").textContent = `จับคู่ไม่สำเร็จ: ${error.message}`; return; }
    if (!await persistSettings("แก้ไขรายการแล้ว")) { Object.assign(item, previous); $("#editItemError").textContent = "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง"; return; }
    state.mappingDirty = false;
    $("#editItemModal").classList.add("hidden"); renderSettings();
    if (!$("#mappingModal").classList.contains("hidden")) renderMappingList();
  }
  async function deleteMenuItem(key) {
    const item = state.menu.find((row) => row.key === key); if (!item || !confirm(`ลบ “${item.displayName}” ออกจากรายการทั้งหมด?`)) return;
    const previousMenu = [...state.menu]; state.menu = state.menu.filter((row) => row.key !== key);
    if (!await persistSettings("ลบรายการแล้ว")) { state.menu = previousMenu; renderSettings(); return; }
    delete state.order[key]; delete state.receive[key]; delete state.returns[key]; saveDraft(); renderAll(); renderSettings();
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
    state.sortSnapshot = state.menu.map((item) => ({ ...item }));
    state.sortMode = "categories"; state.sortCategory = categoryNames()[0] || "";
    $("#sortTitle").textContent = isStaffView() ? "จัดลำดับในเครื่องนี้" : "จัดลำดับ";
    $$("[data-sort-mode]").forEach((button) => button.classList.toggle("active", button.dataset.sortMode === state.sortMode));
    $("#sortModal").classList.remove("hidden"); renderSortList();
  }
  async function saveSortOrder() {
    normalizeMenuOrder();
    if (isStaffView()) {
      localStorage.setItem(STAFF_SORT_KEY, JSON.stringify(state.menu.map((item) => item.key)));
      state.sortSnapshot = null;
      $("#sortModal").classList.add("hidden"); renderAll(); notice("บันทึกลำดับสำหรับเครื่องนี้แล้ว"); return;
    }
    const status = await persistSettings("บันทึกลำดับแล้ว");
    state.sortSnapshot = null;
    $("#sortModal").classList.add("hidden");
    if (status === "synced") $("#settingsModal").classList.add("hidden");
  }

  function bindStaticEvents() {
    $$(".workflow-tabs button").forEach((button) => { button.onclick = () => { state.activeTab = button.dataset.tab; $$(".workflow-tabs button").forEach((row) => row.classList.toggle("active", row === button)); $$(".workflow-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.activeTab}`)); updateCartBar(); }; });
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
    $("#saveAndCopyOrder").onclick = async () => { if (!await submitWorkflow("close_order")) return; try { await copyOrderText(); notice("บันทึกและคัดลอกรายการแล้ว"); } catch (_) { notice("บันทึกแล้ว แต่คัดลอกข้อความไม่สำเร็จ", true); } $("#orderSummaryModal").classList.add("hidden"); };
    $("#clearOrderFromSummary").onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) clearOrder(); };
    $("#saveSettings").onclick = saveSettings; $("#openAddItem").onclick = openAddItem; $("#addMenuItem").onclick = addMenuItem; $("#openSortSettings").onclick = openSortSettings; $("#saveSortOrder").onclick = saveSortOrder; $("#saveEditedItem").onclick = saveEditedItem;
    $("#openMappingManager").onclick = openMappingManager; $("#mappingSearch").oninput = renderMappingList; $("#mappingFilter").onchange = renderMappingList; $("#applyExactMappings").onclick = applyExactMappings; $("#saveMappings").onclick = saveMappings; $("#copyStaffLink").onclick = copyStaffLink;
    $("#editItemMappingSearch").oninput = renderMasterItemOptions;
    $("#editItemMasterList").onchange = (event) => {
      const code = event.target.dataset.masterCode;
      if (!code) return;
      state.editingMasterCodes = event.target.checked
        ? [...state.editingMasterCodes, code] : state.editingMasterCodes.filter((value) => value !== code);
      renderMasterItemOptions();
    };
    $("#editItemMasterList").onclick = (event) => {
      const code = event.target.dataset.masterPrimary;
      if (!code || !state.editingMasterCodes.includes(code)) return;
      state.editingMasterCodes = [code, ...state.editingMasterCodes.filter((value) => value !== code)];
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
    state.client = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
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

  window.addEventListener("boy-auth-ready", (event) => start(event.detail));
  if (window.BOY_AUTH_CONTEXT) start(window.BOY_AUTH_CONTEXT);
})();

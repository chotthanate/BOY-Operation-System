(() => {
  "use strict";
  const BRANCH_CODE = "BIGC-CENTRAL-PATTAYA";
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec";
  const CLOUD_DRAFT_DELAY = 8000;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const number = (value) => Math.max(0, Number(value) || 0);
  const money = (value) => number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const today = () => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  };
  const state = {
    client: null, session: null, branch: null, context: null, menu: [],
    order: {}, receive: {}, returns: {}, activeTab: "close", pickerTarget: "receive",
    cloudTimer: 0, saving: false, started: false
  };

  function keyFor(name, unit = "") {
    const source = `${name}|${unit}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `item-${(hash >>> 0).toString(16)}`;
  }

  function draftKey() { return `boy-bigc-v2-draft:${$("#businessDate").value}`; }
  function blankDraft() { return { savedAt: 0, revenue: { cash: "", transfer: "", thai: "" }, order: {}, receive: {}, returns: {} }; }
  function readLocalDraft() {
    try { return { ...blankDraft(), ...JSON.parse(localStorage.getItem(draftKey()) || "null") }; }
    catch (_) { return blankDraft(); }
  }
  function currentDraft() {
    return {
      business_date: $("#businessDate").value,
      savedAt: Date.now(),
      revenue: { cash: $("#cashAmount").value, transfer: $("#transferAmount").value, thai: $("#thaiAmount").value },
      order: state.order, receive: state.receive, returns: state.returns
    };
  }
  function saveDraft() {
    const draft = currentDraft();
    localStorage.setItem(draftKey(), JSON.stringify(draft));
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
    return configured.map((item, index) => ({
      key: item.key || keyFor(item.displayName || item.item_name, item.unit),
      displayName: item.displayName || item.item_name, name: item.name || item.item_name,
      category: item.category || "อื่นๆ", unit: item.unit || "",
      inputMode: item.inputMode === "weight" ? "weight" : "quantity",
      active: item.active !== false, defaultReturn: defaultKeys.has(item.key), sortOrder: Number(item.sortOrder ?? index)
    })).sort((left, right) => left.sortOrder - right.sortOrder);
  }

  async function loadPage() {
    loading("กำลังโหลดข้อมูล"); notice("");
    try {
      const legacyMenuPromise = loadLegacyMenu();
      const { data, error } = await state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: $("#businessDate").value });
      if (error) throw error;
      state.context = data || {};
      state.branch = data.branch;
      state.menu = settingsMenu(data.settings, await legacyMenuPromise);
      const cloudDraft = data.draft || {};
      const localDraft = readLocalDraft();
      const draft = Number(localDraft.savedAt || 0) >= Number(cloudDraft.savedAt || 0) ? localDraft : { ...blankDraft(), ...cloudDraft };
      hydrateDraft(draft);
      hydrateSubmitted(data.workflows || []);
      seedReceiveFromPrevious(data.previous_order);
      seedDefaultReturns();
      renderAll();
      const pending = (data.pending_sheet_sync || []).length;
      setSync(pending ? `รอส่งชีต ${pending}` : "ข้อมูลพร้อม", pending ? "pending" : "ok");
    } catch (error) {
      const draft = readLocalDraft(); hydrateDraft(draft);
      if (!state.menu.length) state.menu = await loadLegacyMenu();
      renderAll(); setSync("ใช้งานในเครื่อง", "error"); notice(`โหลดฐานข้อมูลกลางไม่สำเร็จ: ${error.message}`, true);
    } finally { loading("", false); }
  }

  function hydrateDraft(draft) {
    state.order = draft.order || {}; state.receive = draft.receive || {}; state.returns = draft.returns || {};
    $("#cashAmount").value = draft.revenue?.cash || "";
    $("#transferAmount").value = draft.revenue?.transfer || "";
    $("#thaiAmount").value = draft.revenue?.thai || "";
  }
  function hydrateSubmitted(workflows) {
    const close = workflows.find((row) => row.workflow_type === "close_order");
    const receive = workflows.find((row) => row.workflow_type === "receive");
    const returned = workflows.find((row) => row.workflow_type === "return");
    if (close && !Object.keys(state.order).length) {
      $("#cashAmount").value = close.cash_amount || ""; $("#transferAmount").value = close.transfer_amount || ""; $("#thaiAmount").value = close.thai_chuay_thai_amount || "";
      state.order = Object.fromEntries((close.lines || []).map((line) => [line.line_key, number(line.quantity)]));
    }
    if (receive && !Object.keys(state.receive).length) state.receive = Object.fromEntries((receive.lines || []).map((line) => [line.line_key, { ...line, checked: line.received !== false }]));
    if (returned && !Object.keys(state.returns).length) state.returns = Object.fromEntries((returned.lines || []).map((line) => [line.line_key, { ...line }]));
  }
  function seedReceiveFromPrevious(previous) {
    if (Object.keys(state.receive).length || !previous?.lines?.length) return;
    previous.lines.forEach((line) => { state.receive[line.line_key] = { ...line, source_line_key: line.line_key, checked: false }; });
    $("#receiveSourceLabel").textContent = `จากรายการวันที่ ${previous.business_date}`;
  }
  function seedDefaultReturns() {
    if (Object.keys(state.returns).length) return;
    state.menu.filter((item) => item.active && item.defaultReturn).forEach((item) => { state.returns[item.key] = lineFromMenu(item, 0); });
  }
  function lineFromMenu(item, quantity = 0) {
    return { line_key: item.key, item_name: item.displayName, category_name: item.category, unit_name: item.unit, input_mode: item.inputMode, quantity, received: true, sort_order: item.sortOrder };
  }

  function renderAll() { renderRevenue(); renderOrder(); renderReceive(); renderReturns(); }
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
    if (item.inputMode === "weight") return `<div class="weight-control"><input data-qty-target="${target}" data-key="${item.key}" inputmode="decimal" type="number" min="0" step="0.01" value="${number(value) || ""}" placeholder="${escapeHtml(item.unit || "น้ำหนัก")}"></div>`;
    return `<div class="qty-control"><button data-step="-1" data-qty-target="${target}" data-key="${item.key}" type="button">−</button><input data-qty-target="${target}" data-key="${item.key}" inputmode="numeric" type="number" min="0" step="1" value="${number(value)}"><button data-step="1" data-qty-target="${target}" data-key="${item.key}" type="button">+</button></div>`;
  }
  function renderOrder() {
    let html = ""; let selected = 0;
    groupedMenu($("#orderSearch").value).forEach((items, category) => {
      html += `<div class="category-label">${escapeHtml(category)}</div>`;
      items.forEach((item) => { const qty = number(state.order[item.key]); if (qty) selected += 1; html += `<div class="item-row"><div class="item-row-inner"><div class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "นับเป็นจำนวน")}</small></div>${inputControl(item, qty, "order")}</div></div>`; });
    });
    $("#orderList").innerHTML = html || `<div class="empty-state">ไม่พบรายการ</div>`;
    $("#orderCount").textContent = `${selected} รายการ`; bindQuantityEvents();
  }
  function findMenu(key, line) { return state.menu.find((item) => item.key === key) || { key, displayName: line.item_name, category: line.category_name || "อื่นๆ", unit: line.unit_name || "", inputMode: line.input_mode || "quantity", sortOrder: line.sort_order || 0 }; }
  function renderReceive() {
    const entries = Object.entries(state.receive); let checked = 0;
    $("#receiveList").innerHTML = entries.length ? entries.map(([key, line]) => {
      const item = findMenu(key, line); if (line.checked) checked += 1;
      return `<div class="item-row ${line.checked ? "" : "unchecked"}" data-swipe-key="${key}" data-swipe-target="receive"><button class="swipe-delete" data-remove-target="receive" data-key="${key}" type="button">ไม่ได้รับ</button><div class="item-row-inner"><label class="receive-check"><input data-receive-check="${key}" type="checkbox" ${line.checked ? "checked" : ""}><span class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small></span></label>${inputControl(item, line.quantity, "receive")}</div></div>`;
    }).join("") : `<div class="empty-state">ยังไม่มีรายการจากเมื่อคืน<br>กด “+ เพิ่ม” เพื่อเพิ่มเอง</div>`;
    $("#receiveProgress").textContent = `${checked} / ${entries.length} รายการ`;
    $("#receiveProgressBar").style.width = `${entries.length ? checked / entries.length * 100 : 0}%`;
    bindQuantityEvents(); bindRowEvents();
  }
  function renderReturns() {
    const entries = Object.entries(state.returns);
    $("#returnList").innerHTML = entries.length ? entries.map(([key, line]) => {
      const item = findMenu(key, line);
      return `<div class="item-row" data-swipe-key="${key}" data-swipe-target="returns"><button class="swipe-delete" data-remove-target="returns" data-key="${key}" type="button">ลบ</button><div class="item-row-inner"><div class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small></div>${inputControl(item, line.quantity, "returns")}</div></div>`;
    }).join("") : `<div class="empty-state">ยังไม่มีรายการคืน<br>กด “+ เพิ่ม” เพื่อเลือกรายการ</div>`;
    bindQuantityEvents(); bindRowEvents();
  }

  function targetObject(name) { return name === "order" ? state.order : name === "receive" ? state.receive : state.returns; }
  function updateQuantity(target, key, value) {
    if (target === "order") state.order[key] = number(value);
    else { const object = targetObject(target); const item = findMenu(key, object[key] || {}); object[key] = { ...(object[key] || lineFromMenu(item)), quantity: number(value) }; }
    saveDraft(); renderRevenue();
  }
  function bindQuantityEvents() {
    $$('input[data-qty-target]').forEach((input) => {
      input.oninput = () => updateQuantity(input.dataset.qtyTarget, input.dataset.key, input.value);
    });
    $$('[data-step]').forEach((button) => {
      button.onclick = () => {
        const object = targetObject(button.dataset.qtyTarget); const current = button.dataset.qtyTarget === "order" ? object[button.dataset.key] : object[button.dataset.key]?.quantity;
        updateQuantity(button.dataset.qtyTarget, button.dataset.key, number(current) + Number(button.dataset.step));
        if (button.dataset.qtyTarget === "order") renderOrder(); else if (button.dataset.qtyTarget === "receive") renderReceive(); else renderReturns();
      };
    });
  }
  function bindRowEvents() {
    $$('[data-receive-check]').forEach((checkbox) => { checkbox.onchange = () => { state.receive[checkbox.dataset.receiveCheck].checked = checkbox.checked; saveDraft(); renderReceive(); }; });
    $$('[data-remove-target]').forEach((button) => { button.onclick = () => removeLine(button.dataset.removeTarget, button.dataset.key); });
    $$('[data-swipe-key]').forEach((row) => {
      let start = 0;
      row.ontouchstart = (event) => { start = event.touches[0].clientX; };
      row.ontouchmove = (event) => { const distance = Math.max(0, start - event.touches[0].clientX); row.querySelector(".item-row-inner").style.transform = `translateX(-${Math.min(90, distance)}px)`; };
      row.ontouchend = (event) => { const distance = start - event.changedTouches[0].clientX; if (distance > 70) removeLine(row.dataset.swipeTarget, row.dataset.swipeKey); else row.querySelector(".item-row-inner").style.transform = ""; };
    });
  }
  function removeLine(target, key) { delete targetObject(target)[key]; saveDraft(); target === "receive" ? renderReceive() : renderReturns(); }

  function linesFor(type) {
    if (type === "close_order") return state.menu.filter((item) => number(state.order[item.key]) > 0).map((item) => ({ ...lineFromMenu(item, state.order[item.key]), received: true }));
    const source = type === "receive" ? state.receive : state.returns;
    return Object.entries(source).filter(([, line]) => number(line.quantity) > 0 && (type !== "receive" || line.checked)).map(([key, line]) => ({ ...line, line_key: key, received: type === "receive" ? Boolean(line.checked) : true }));
  }

  async function submitWorkflow(type) {
    if (state.saving) return;
    const lines = linesFor(type);
    if (type !== "close_order" && !lines.length) { notice("กรุณาระบุรายการอย่างน้อย 1 รายการ", true); return; }
    const payload = {
      workflow_type: type, business_date: $("#businessDate").value,
      source_workflow_id: type === "receive" ? state.context?.previous_order?.id || null : null,
      cash_amount: type === "close_order" ? number($("#cashAmount").value) : 0,
      transfer_amount: type === "close_order" ? number($("#transferAmount").value) : 0,
      thai_chuay_thai_amount: type === "close_order" ? number($("#thaiAmount").value) : 0,
      lines
    };
    state.saving = true; loading("กำลังบันทึกลงฐานข้อมูล"); notice("");
    try {
      const { data, error } = await state.client.schema("boy_central").rpc("save_bigc_v2_workflow", { payload });
      if (error) throw error;
      localStorage.removeItem(draftKey());
      setSync("บันทึกฐานข้อมูลแล้ว", "ok");
      try {
        await sheetApi("bigcV2MirrorWorkflow", { payload: { ...payload, workflow_id: data.workflow_id } });
        await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "synced", sync_error: null });
        setSync("บันทึกครบแล้ว", "ok"); notice("บันทึกเรียบร้อย");
      } catch (sheetError) {
        await state.client.schema("boy_central").rpc("mark_bigc_v2_sheet_sync", { target_workflow_id: data.workflow_id, sync_status: "error", sync_error: String(sheetError.message || sheetError).slice(0, 400) });
        setSync("รอส่ง Google Sheets", "pending"); notice("ข้อมูลอยู่ในฐานข้อมูลแล้ว แต่สำเนา Google Sheets ยังรอส่ง", false);
      }
      await loadPage();
    } catch (error) { setSync("บันทึกไม่สำเร็จ", "error"); notice(error.message, true); }
    finally { state.saving = false; loading("", false); }
  }

  function openPicker(target) { state.pickerTarget = target; $("#pickerSearch").value = ""; $("#pickerModal").classList.remove("hidden"); renderPicker(); }
  function renderPicker() {
    const query = $("#pickerSearch").value.trim().toLowerCase(); const selected = targetObject(state.pickerTarget);
    const items = state.menu.filter((item) => item.active && !selected[item.key] && (!query || `${item.displayName} ${item.category}`.toLowerCase().includes(query)));
    $("#pickerList").innerHTML = items.length ? items.map((item) => `<button class="picker-item" data-pick="${item.key}" type="button"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)}</small></span><b>＋</b></button>`).join("") : `<div class="empty-state">ไม่พบรายการ</div>`;
    $$('[data-pick]').forEach((button) => { button.onclick = () => { const item = state.menu.find((row) => row.key === button.dataset.pick); selected[item.key] = lineFromMenu(item); saveDraft(); $("#pickerModal").classList.add("hidden"); state.pickerTarget === "receive" ? renderReceive() : renderReturns(); }; });
  }

  function openSettings() { $("#settingsModal").classList.remove("hidden"); $("#settingsSearch").value = ""; renderSettings(); }
  function renderSettings() {
    const query = $("#settingsSearch").value.trim().toLowerCase();
    const items = state.menu.filter((item) => !query || `${item.displayName} ${item.category}`.toLowerCase().includes(query));
    $("#settingsList").innerHTML = items.map((item) => `<div class="setting-row"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.unit || "จำนวน")}</small></span><input data-setting="inputMode" data-key="${item.key}" type="checkbox" ${item.inputMode === "weight" ? "checked" : ""} aria-label="ชั่งน้ำหนัก"><input data-setting="defaultReturn" data-key="${item.key}" type="checkbox" ${item.defaultReturn ? "checked" : ""} aria-label="ขึ้นหน้าคืนอัตโนมัติ"><input data-setting="active" data-key="${item.key}" type="checkbox" ${item.active ? "checked" : ""} aria-label="ใช้งาน"></div>`).join("");
    $$('[data-setting]').forEach((input) => { input.onchange = () => { const item = state.menu.find((row) => row.key === input.dataset.key); if (input.dataset.setting === "inputMode") item.inputMode = input.checked ? "weight" : "quantity"; else item[input.dataset.setting] = input.checked; }; });
  }
  async function saveSettings() {
    loading("กำลังบันทึกการตั้งค่า");
    const payload = { menu_config: state.menu, default_return_keys: state.menu.filter((item) => item.defaultReturn).map((item) => item.key) };
    const { error } = await state.client.schema("boy_central").rpc("save_bigc_v2_settings", { payload });
    loading("", false);
    if (error) { notice(error.message, true); return; }
    $("#settingsModal").classList.add("hidden"); state.returns = {}; seedDefaultReturns(); renderAll(); saveDraft(); notice("บันทึกการตั้งค่าแล้ว");
  }
  function addMenuItem() {
    const name = $("#newItemName").value.trim(); const unit = $("#newItemUnit").value.trim(); if (!name) return;
    const key = keyFor(name, unit); if (state.menu.some((item) => item.key === key)) { notice("มีรายการนี้แล้ว", true); return; }
    state.menu.push({ key, displayName: unit ? `${name} (${unit})` : name, name, category: "เพิ่มเอง", unit, inputMode: "quantity", active: true, defaultReturn: false, sortOrder: state.menu.length });
    $("#newItemName").value = ""; $("#newItemUnit").value = ""; renderSettings();
  }

  function bindStaticEvents() {
    $$(".workflow-tabs button").forEach((button) => { button.onclick = () => { state.activeTab = button.dataset.tab; $$(".workflow-tabs button").forEach((row) => row.classList.toggle("active", row === button)); $$(".workflow-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.activeTab}`)); }; });
    ["cashAmount", "transferAmount", "thaiAmount"].forEach((id) => { $("#" + id).oninput = () => { renderRevenue(); saveDraft(); }; });
    $("#orderSearch").oninput = renderOrder; $("#pickerSearch").oninput = renderPicker; $("#settingsSearch").oninput = renderSettings;
    $("#businessDate").onchange = loadPage; $("#refreshButton").onclick = loadPage;
    $("#settingsButton").onclick = openSettings; $("#addReceiveButton").onclick = () => openPicker("receive"); $("#addReturnButton").onclick = () => openPicker("returns");
    $("#submitClose").onclick = () => submitWorkflow("close_order"); $("#submitReceive").onclick = () => submitWorkflow("receive"); $("#submitReturn").onclick = () => submitWorkflow("return");
    $("#saveSettings").onclick = saveSettings; $("#addMenuItem").onclick = addMenuItem;
    $$('[data-close-modal]').forEach((button) => { button.onclick = () => $("#" + button.dataset.closeModal).classList.add("hidden"); });
    $$('[data-clear]').forEach((button) => { button.onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) { state.order = {}; saveDraft(); renderOrder(); } }; });
    window.addEventListener("online", () => saveCloudDraft());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveCloudDraft(); });
  }

  async function start(authContext) {
    if (state.started) return;
    state.started = true;
    $("#businessDate").value = today(); bindStaticEvents();
    const config = window.BOY_CENTRAL_CONFIG || {};
    state.client = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await state.client.auth.getSession(); state.session = data.session;
    if (!state.session && authContext?.localAccess) { setSync("ต้องเข้าออนไลน์", "error"); notice("หน้า BigC รุ่นใหม่ต้องเข้าสู่ระบบออนไลน์ก่อนทดสอบ", true); state.menu = await loadLegacyMenu(); hydrateDraft(readLocalDraft()); renderAll(); return; }
    await loadPage();
  }

  window.addEventListener("boy-auth-ready", (event) => start(event.detail));
  if (window.BOY_AUTH_CONTEXT) start(window.BOY_AUTH_CONTEXT);
})();

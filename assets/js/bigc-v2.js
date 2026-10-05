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
    client: null, session: null, branch: null, context: null, contexts: {}, menu: [],
    order: {}, receive: {}, returns: {}, activeTab: "close", pickerTarget: "receive",
    cloudTimer: 0, saving: false, started: false
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
      const dates = { order: $("#orderDate").value, receive: $("#receiveDate").value, returns: $("#returnDate").value };
      const requests = {};
      Object.values(dates).forEach((date) => { if (!requests[date]) requests[date] = state.client.schema("boy_central").rpc("get_bigc_v2_context", { target_date: date }); });
      const resolved = Object.fromEntries(await Promise.all(Object.entries(requests).map(async ([date, request]) => {
        const { data, error } = await request; if (error) throw error; return [date, data || {}];
      })));
      state.contexts = { order: resolved[dates.order], receive: resolved[dates.receive], returns: resolved[dates.returns] };
      state.context = state.activeTab === "receive" ? state.contexts.receive : state.activeTab === "return" ? state.contexts.returns : state.contexts.order;
      state.branch = state.context.branch;
      state.menu = settingsMenu(state.context.settings, await legacyMenuPromise);
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
      seedReceiveFromPrevious(state.contexts.receive.previous_order);
      seedDefaultReturns();
      renderAll();
      const pending = (state.context.pending_sheet_sync || []).length;
      setSync(pending ? `รอส่งชีต ${pending}` : "ข้อมูลพร้อม", pending ? "pending" : "ok");
    } catch (error) {
      const draft = readLocalDraft(); hydrateDraft(draft);
      if (!state.menu.length) state.menu = await loadLegacyMenu();
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
    if (receive && !Object.keys(state.receive).length) state.receive = Object.fromEntries((receive.lines || []).map((line) => [line.line_key, { ...line, checked: line.received !== false }]));
    if (returned) {
      if (!Object.keys(state.returns).length) state.returns = Object.fromEntries((returned.lines || []).map((line) => [line.line_key, { ...line }]));
      if (!$("#cashAmount").value && !$("#transferAmount").value && !$("#thaiAmount").value) {
        $("#cashAmount").value = returned.cash_amount || ""; $("#transferAmount").value = returned.transfer_amount || ""; $("#thaiAmount").value = returned.thai_chuay_thai_amount || "";
      }
    }
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
  function lineFromMenu(item, quantity = 0, inputMode = item.inputMode) {
    return { line_key: item.key, item_name: item.displayName, category_name: item.category, unit_name: item.unit, input_mode: inputMode, quantity, received: true, sort_order: item.sortOrder };
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
    return `<div class="qty-control"><button data-step="-1" data-qty-target="${target}" data-key="${item.key}" type="button">−</button><input data-qty-target="${target}" data-key="${item.key}" inputmode="numeric" type="number" min="0" step="1" value="${number(value)}"><button data-step="1" data-qty-target="${target}" data-key="${item.key}" type="button">+</button></div>`;
  }
  function renderOrder() {
    let html = ""; let selected = 0; let groupIndex = 0; const nav = [];
    groupedMenu($("#orderSearch").value).forEach((items, category) => {
      const id = `order-category-${groupIndex++}`;
      nav.push(`<button data-category-target="${id}" type="button">${escapeHtml(category)}</button>`);
      html += `<section id="${id}" class="order-category-block"><h3 class="order-category-title">${escapeHtml(category)}</h3><div class="order-grid">`;
      items.forEach((item) => { const qty = number(state.order[item.key]); if (qty) selected += 1; html += `<div class="order-card"><div class="item-copy"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.unit || "จำนวน")}</small></div>${inputControl(item, qty, "order")}</div>`; });
      html += `</div></section>`;
    });
    $("#orderList").innerHTML = html || `<div class="empty-state">ไม่พบรายการ</div>`;
    $("#orderCategoryNav").innerHTML = nav.join("");
    $$('[data-category-target]').forEach((button) => { button.onclick = () => $("#" + button.dataset.categoryTarget)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("#orderCount").textContent = `${selected} รายการ`; bindQuantityEvents(); updateCartBar();
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
  function bindQuantityEvents() {
    $$('input[data-qty-target]').forEach((input) => {
      input.oninput = () => updateQuantity(input.dataset.qtyTarget, input.dataset.key, input.value);
    });
    $$('[data-step]').forEach((button) => {
      button.onclick = () => {
        const normalizedTarget = button.dataset.qtyTarget === "order-summary" ? "order" : button.dataset.qtyTarget;
        const object = targetObject(normalizedTarget); const current = normalizedTarget === "order" ? object[button.dataset.key] : object[button.dataset.key]?.quantity;
        updateQuantity(button.dataset.qtyTarget, button.dataset.key, number(current) + Number(button.dataset.step));
        if (["order", "order-summary"].includes(button.dataset.qtyTarget)) { renderOrder(); if (!$("#orderSummaryModal").classList.contains("hidden")) renderOrderSummary(); } else if (button.dataset.qtyTarget === "receive") renderReceive(); else renderReturns();
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
    if (type === "close_order") return state.menu.filter((item) => number(state.order[item.key]) > 0).map((item) => ({ ...lineFromMenu(item, state.order[item.key], "quantity"), received: true }));
    const source = type === "receive" ? state.receive : state.returns;
    return Object.entries(source).filter(([, line]) => number(line.quantity) > 0 && (type !== "receive" || line.checked)).map(([key, line]) => ({ ...line, line_key: key, received: type === "receive" ? Boolean(line.checked) : true }));
  }

  async function submitWorkflow(type) {
    if (state.saving) return false;
    const lines = linesFor(type);
    if (type === "close_order" && !lines.length) { notice("ยังไม่มีรายการสั่งของ", true); return false; }
    if (type === "receive" && !lines.length) { notice("กรุณาเช็กรายการที่ได้รับอย่างน้อย 1 รายการ", true); return false; }
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
      saveDraft();
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

  function openSettings() { $("#settingsModal").classList.remove("hidden"); $("#settingsSearch").value = ""; renderSettings(); }
  function renderSettings() {
    const query = $("#settingsSearch").value.trim().toLowerCase();
    const items = state.menu.filter((item) => !query || `${item.displayName} ${item.category}`.toLowerCase().includes(query));
    $("#settingsList").innerHTML = items.map((item) => `<div class="setting-row"><span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.category)} · ${escapeHtml(item.unit || "จำนวน")}</small></span><input data-setting="inputMode" data-key="${item.key}" type="checkbox" ${item.inputMode === "weight" ? "checked" : ""} aria-label="ชั่งตอนรับหรือคืน"><input data-setting="defaultReturn" data-key="${item.key}" type="checkbox" ${item.defaultReturn ? "checked" : ""} aria-label="ขึ้นหน้าคืนอัตโนมัติ"></div>`).join("");
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
    $$(".workflow-tabs button").forEach((button) => { button.onclick = () => { state.activeTab = button.dataset.tab; $$(".workflow-tabs button").forEach((row) => row.classList.toggle("active", row === button)); $$(".workflow-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${state.activeTab}`)); updateCartBar(); }; });
    ["cashAmount", "transferAmount", "thaiAmount"].forEach((id) => { $("#" + id).oninput = () => { renderRevenue(); saveDraft(); }; });
    $("#orderSearch").oninput = renderOrder; $("#pickerSearch").oninput = renderPicker; $("#settingsSearch").oninput = renderSettings;
    $$('[data-date-target]').forEach((button) => { button.onclick = () => { const input = $("#" + button.dataset.dateTarget); if (input.showPicker) input.showPicker(); else input.click(); }; });
    ["orderDate", "receiveDate", "returnDate"].forEach((id) => { $("#" + id).onchange = () => {
      if (id === "orderDate") state.order = {};
      if (id === "receiveDate") state.receive = {};
      if (id === "returnDate") { state.returns = {}; $("#cashAmount").value = ""; $("#transferAmount").value = ""; $("#thaiAmount").value = ""; }
      renderDateDisplays(); const local = readLocalDraft(); hydrateDraft(local); saveDraft(); loadPage();
    }; });
    $("#refreshButton").onclick = loadPage;
    $("#settingsButton").onclick = openSettings; $("#addReceiveButton").onclick = () => openPicker("receive"); $("#addReturnButton").onclick = () => openPicker("returns");
    $("#submitReceive").onclick = () => submitWorkflow("receive"); $("#submitReturn").onclick = () => submitWorkflow("return");
    $("#openOrderSummary").onclick = openOrderSummary;
    $("#saveAndCopyOrder").onclick = async () => { if (!await submitWorkflow("close_order")) return; try { await copyOrderText(); notice("บันทึกและคัดลอกรายการแล้ว"); } catch (_) { notice("บันทึกแล้ว แต่คัดลอกข้อความไม่สำเร็จ", true); } $("#orderSummaryModal").classList.add("hidden"); };
    $("#clearOrderFromSummary").onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) clearOrder(); };
    $("#saveSettings").onclick = saveSettings; $("#addMenuItem").onclick = addMenuItem;
    $$('[data-close-modal]').forEach((button) => { button.onclick = () => { $("#" + button.dataset.closeModal).classList.add("hidden"); if (button.dataset.closeModal === "orderSummaryModal") renderOrder(); }; });
    $$('[data-clear]').forEach((button) => { button.onclick = () => { if (confirm("ล้างรายการสั่งของทั้งหมด?")) clearOrder(); }; });
    window.addEventListener("online", () => saveCloudDraft());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveCloudDraft(); });
  }

  async function start(authContext) {
    if (state.started) return;
    state.started = true;
    ["orderDate", "receiveDate", "returnDate"].forEach((id) => { $("#" + id).value = today(); }); renderDateDisplays(); bindStaticEvents();
    const config = window.BOY_CENTRAL_CONFIG || {};
    state.client = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await state.client.auth.getSession(); state.session = data.session;
    if (!state.session && authContext?.localAccess) { setSync("ต้องเข้าออนไลน์", "error"); notice("หน้า BigC รุ่นใหม่ต้องเข้าสู่ระบบออนไลน์ก่อนทดสอบ", true); state.menu = await loadLegacyMenu(); hydrateDraft(readLocalDraft()); renderAll(); return; }
    await loadPage();
  }

  window.addEventListener("boy-auth-ready", (event) => start(event.detail));
  if (window.BOY_AUTH_CONTEXT) start(window.BOY_AUTH_CONTEXT);
})();

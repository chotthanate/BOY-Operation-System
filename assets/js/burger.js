(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.BOY_CENTRAL_CONFIG || {};
  const branchApp = { branchCode: "BURGER", slug: "burger", name: "ร้านเบอร์เกอร์", mark: "BG", sourceSystem: "boy_burger_web", accent: "#ef6c4d", accentSoft: "#fff0e9", legacyEnabled: true, ...(window.BOY_BRANCH_CONFIG || {}) };
  const LEGACY_API_URL = "https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec";
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
  const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 });
  const state = { session: null, profile: null, localAccess: false, catalogSource: "", branch: null, branchItems: [], items: [], units: [], itemUnits: [], categories: [], expenseItems: [], suppliers: [], itemSuppliers: [], stock: [], lines: [], reimbursements: [], masterTab: "items", draftTimer: null, syncing: false };

  function applyBranchIdentity() {
    document.documentElement.style.setProperty("--store-accent", branchApp.accent);
    document.documentElement.style.setProperty("--store-accent-soft", branchApp.accentSoft);
    if (branchApp.branchCode === "GRILL") {
      document.documentElement.style.setProperty("--green", "#7d3f31");
      document.documentElement.style.setProperty("--green2", "#a85a43");
      document.documentElement.style.setProperty("--green-soft", "#f5e8e3");
      document.documentElement.style.setProperty("--orange", "#a85a43");
      document.documentElement.style.setProperty("--orange-soft", "#f8ece7");
      document.documentElement.style.setProperty("--paper", "#fbf5f0");
    }
    document.title = `${branchApp.name} | BOY Operations`;
    const values = { branchMark: branchApp.mark, branchName: branchApp.name, expenseBranchLabel: branchApp.name, settingsBranchLabel: `ข้อมูล${branchApp.name}` };
    Object.entries(values).forEach(([id, value]) => { const node = document.getElementById(id); if (node) node.textContent = value; });
    const burgerChoice = document.getElementById("burgerStoreChoice");
    const grillChoice = document.getElementById("grillStoreChoice");
    burgerChoice?.classList.toggle("active", branchApp.branchCode === "BURGER");
    grillChoice?.classList.toggle("active", branchApp.branchCode === "GRILL");
    const activeChoice = branchApp.branchCode === "GRILL" ? grillChoice : burgerChoice;
    activeChoice?.querySelector("small") && (activeChoice.querySelector("small").textContent = "กำลังใช้");
    const employeeLink = document.getElementById("employeeNavLink");
    if (employeeLink) employeeLink.href = `master-data.html?entity=employees&store=${branchApp.slug}`;
    if (branchApp.branchCode === "GRILL") document.body.classList.add("grill-branch");
  }

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const optionHtml = (rows, selected, label = "name") => rows.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row[label])}</option>`).join("");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const monthNow = () => today().slice(0, 7);
  const newLine = () => ({ id: crypto.randomUUID(), item_id: "", expense_item_id: "", source_expense_item_id: "", expense_search: "", category_id: "", description: "", quantity: 0, unit_id: "", conversion_to_base: 1, line_total: 0, supplier_name: "", note: "", expanded: true });

  async function legacyApi(action, data = {}) {
    const response = await fetch(LEGACY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...data })
    });
    if (!response.ok) throw new Error(`ระบบสำรองตอบกลับ ${response.status}`);
    const result = await response.json();
    if (result.status !== "success") throw new Error(result.message || "ระบบสำรองทำงานไม่สำเร็จ");
    return result;
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
  }

  function setConnection(text, type = "") {
    const badge = $("#connectionBadge");
    badge.textContent = text;
    badge.className = `connection-badge ${type}`;
  }

  const outboxKey = () => `boy-${branchApp.slug}-outbox:${state.session?.user?.id || "guest"}`;
  const profileCacheKey = () => `boy-${branchApp.slug}-profile:${state.session?.user?.id || "guest"}`;
  const masterCacheKey = () => `boy-${branchApp.slug}-master:${state.session?.user?.id || "guest"}`;
  function readCache(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; }
  }
  function readOutbox() {
    try {
      const rows = JSON.parse(localStorage.getItem(outboxKey()) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }
  function writeOutbox(rows) {
    localStorage.setItem(outboxKey(), JSON.stringify(rows));
    updateSyncStatus();
  }
  function updateSyncStatus() {
    if (!state.session) return;
    const count = readOutbox().length;
    if (state.localAccess) { setConnection(count ? `BOY Central พักใช้งาน · รอส่ง ${count}` : "ใช้งานในเครื่อง", "pending"); return; }
    if (!navigator.onLine) setConnection(count ? `ออฟไลน์ · รอส่ง ${count}` : "ออฟไลน์", "pending");
    else if (count) setConnection(`รอส่ง ${count} รายการ`, "pending");
    else setConnection(`เชื่อมต่อแล้ว · ${state.items.filter((row) => row.active !== false && row.branch_active !== false).length} สินค้า`, "online");
  }
  function queueOperation(type, payload, meta = {}) {
    const rows = readOutbox();
    const id = payload.idempotency_key;
    if (!rows.some((row) => row.id === id)) rows.push({ id, type, payload, meta, queued_at: new Date().toISOString() });
    writeOutbox(rows);
  }
  function isNetworkError(error) {
    return !navigator.onLine || error?.status === 402 || /failed to fetch|network|load failed|fetch|exceed_egress_quota|service.*restricted/i.test(String(error?.message || error || ""));
  }

  const centralAvailable = () => navigator.onLine && !state.localAccess;

  function saveMasterCache() {
    localStorage.setItem(masterCacheKey(), JSON.stringify({
      branch: state.branch, branchItems: state.branchItems, items: state.items, units: state.units, itemUnits: state.itemUnits,
      categories: state.categories, expenseItems: state.expenseItems, suppliers: state.suppliers,
      itemSuppliers: state.itemSuppliers, catalogSource: state.catalogSource, saved_at: new Date().toISOString()
    }));
  }

  function loadMasterCache() {
    const cached = readCache(masterCacheKey());
    if (!cached?.branch || !Array.isArray(cached.items)) return false;
    state.branch = cached.branch;
    state.branchItems = cached.branchItems || [];
    state.items = cached.items;
    state.units = cached.units || [];
    state.itemUnits = cached.itemUnits || [];
    state.categories = cached.categories || [];
    state.expenseItems = cached.expenseItems || [];
    state.suppliers = cached.suppliers || [];
    state.itemSuppliers = cached.itemSuppliers || [];
    state.catalogSource = cached.catalogSource || "cache";
    renderLines();
    renderMasterList();
    updateSyncStatus();
    return true;
  }

  function setPage(page) {
    $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.target === page));
    if (page === "stock" && state.session) loadStock();
    if (page === "dashboard" && state.session) loadDashboard();
    if (page === "settings" && state.session) renderMasterList();
  }

  const draftKeyForDate = (date) => `boy-${branchApp.slug}-draft:${state.session?.user?.id || "guest"}:${date || today()}`;
  const draftKey = () => draftKeyForDate($("#expenseDate").value);

  function draftPayload() {
    return { version: 2, transaction_date: $("#expenseDate").value, payment_method: $("#expensePaymentMethod").value, lines: state.lines, saved_at: new Date().toISOString() };
  }

  function setDraftStatus(message, type = "") {
    const node = $("#draftStatus");
    node.textContent = message;
    node.className = `draft-status ${type}`;
  }

  async function saveDraftNow() {
    if (!state.session || !state.branch || !$("#expenseDate").value) return;
    const payload = draftPayload();
    localStorage.setItem(draftKey(), JSON.stringify(payload));
    if (!centralAvailable()) { setDraftStatus("เก็บไว้ในเครื่องแล้ว", "local"); return; }
    setDraftStatus("กำลังบันทึก…");
    const { error } = await client.schema("boy_central").from("expense_drafts").upsert({
      company_id: state.branch.company_id,
      branch_id: state.branch.id,
      user_id: state.session.user.id,
      transaction_date: payload.transaction_date,
      payload
    }, { onConflict: "branch_id,user_id,transaction_date" });
    setDraftStatus(error ? "เก็บไว้ในเครื่องแล้ว" : "บันทึกร่างแล้ว", error ? "local" : "saved");
  }

  function scheduleDraftSave() {
    localStorage.setItem(draftKey(), JSON.stringify(draftPayload()));
    setDraftStatus("มีการแก้ไข");
    clearTimeout(state.draftTimer);
    state.draftTimer = setTimeout(saveDraftNow, 650);
  }

  async function loadDraftForDate() {
    if (!state.session || !state.branch) return;
    let payload = null;
    const local = localStorage.getItem(draftKey());
    if (local) try { payload = JSON.parse(local); } catch (_) { localStorage.removeItem(draftKey()); }
    if (centralAvailable()) {
      const { data } = await client.schema("boy_central").from("expense_drafts")
        .select("payload,updated_at").eq("branch_id", state.branch.id).eq("user_id", state.session.user.id)
        .eq("transaction_date", $("#expenseDate").value).maybeSingle();
      if (data?.payload && (!payload?.saved_at || new Date(data.updated_at) > new Date(payload.saved_at))) payload = data.payload;
    }
    state.lines = Array.isArray(payload?.lines) && payload.lines.length ? payload.lines.map((line) => ({ ...newLine(), ...line, expanded: false })) : [newLine()];
    $("#expensePaymentMethod").value = payload?.payment_method || "cash";
    state.lines[0].expanded = true;
    renderLines();
    setDraftStatus(payload ? "เปิดร่างล่าสุดแล้ว" : "พร้อมบันทึกร่าง", payload ? "saved" : "");
  }

  async function clearDraftForDate(date, removeCloud = true) {
    localStorage.removeItem(draftKeyForDate(date));
    if (removeCloud && state.session && state.branch && centralAvailable()) await client.schema("boy_central").from("expense_drafts").delete()
      .eq("branch_id", state.branch.id).eq("user_id", state.session.user.id).eq("transaction_date", date);
  }

  async function clearDraft() {
    await clearDraftForDate($("#expenseDate").value);
  }

  async function sendQueuedOperation(operation) {
    if (operation.type === "expense") return client.schema("boy_central").rpc("record_expense_v3", { payload: operation.payload });
    if (operation.type === "expense_legacy") {
      try { return { data: await legacyApi("burgerExpenseSave", { payload: operation.payload, actor: operation.meta?.actor || {} }), error: null }; }
      catch (error) { return { data: null, error }; }
    }
    if (operation.type === "master") return client.schema("boy_central").rpc("admin_update_burger_master_v2", { payload: operation.payload });
    return { data: null, error: new Error("ไม่รู้จักประเภทรายการที่รอส่ง") };
  }

  async function flushOutbox({ notify = false } = {}) {
    const sent = { expense: 0, expense_legacy: 0, master: 0 };
    if (state.syncing || !state.session || !navigator.onLine) { updateSyncStatus(); return sent; }
    state.syncing = true;
    let rows = readOutbox();
    try {
      while (rows.length && navigator.onLine) {
        const operation = rows[0];
        const { error } = await sendQueuedOperation(operation);
        if (error) {
          operation.last_error = error.message || String(error);
          writeOutbox(rows);
          if (notify && !isNetworkError(error)) toast(`ส่งรายการที่ค้างไม่สำเร็จ: ${operation.last_error}`);
          break;
        }
        rows.shift();
        writeOutbox(rows);
        if (["expense", "expense_legacy"].includes(operation.type)) await clearDraftForDate(operation.meta?.transaction_date, operation.type === "expense");
        sent[operation.type] += 1;
      }
    } finally {
      state.syncing = false;
      updateSyncStatus();
    }
    const total = sent.expense + sent.expense_legacy + sent.master;
    if (notify && total) toast(`ส่งรายการที่ค้างแล้ว ${total} รายการ`);
    return sent;
  }

  function itemById(id) { return state.items.find((item) => item.id === id); }
  function branchItemById(id) { return state.branchItems.find((row) => row.item_id === id); }
  function unitById(id) { return state.units.find((unit) => unit.id === id); }
  function expenseById(id) { return state.expenseItems.find((expense) => expense.id === id); }
  function isExpenseActive(expense) {
    const linkedItem = expense?.item_id ? itemById(expense.item_id) : null;
    return expense?.active !== false && expense?.branch_active !== false
      && (!linkedItem || (linkedItem.active !== false && linkedItem.branch_active !== false));
  }
  function expenseBySearch(value) {
    const query = String(value || "").trim().toLocaleLowerCase("th");
    return state.expenseItems.find((expense) => isExpenseActive(expense) && (expense.name.trim().toLocaleLowerCase("th") === query || expense.code.toLocaleLowerCase("th") === query));
  }
  function mainCategories() {
    return state.categories.filter((category) => category.category_type === "item" && !category.parent_id && /^CAT-\d+$/.test(category.code));
  }
  function subcategories(mainId) {
    return state.categories.filter((category) => category.category_type === "item" && category.parent_id === mainId);
  }
  function mainCategoryId(categoryId) {
    const category = state.categories.find((row) => row.id === categoryId);
    if (!category) return "";
    if (category.parent_id) return category.parent_id;
    if (category.code.startsWith("EXP-CAT-")) {
      return state.categories.find((row) => row.category_type === "item" && row.code === category.code.replace("EXP-", ""))?.id || "";
    }
    return category.category_type === "item" ? category.id : "";
  }
  function lineCategoryId(line, expense = expenseById(line.expense_item_id)) {
    return line.category_id || mainCategoryId(expense?.category_id);
  }
  function itemUnitChoices(itemId) {
    const rows = state.itemUnits.filter((row) => row.item_id === itemId && row.active !== false && (row.is_base_unit || row.allow_purchase));
    const item = itemById(itemId);
    if (item?.base_unit_id && !rows.some((row) => row.unit_id === item.base_unit_id)) rows.unshift({ item_id: itemId, unit_id: item.base_unit_id, conversion_to_base: 1, is_base_unit: true, allow_purchase: true, active: true });
    return rows;
  }
  function defaultPurchaseUnit(itemId) {
    const defaultUnitId = branchItemById(itemId)?.default_purchase_unit_id;
    return itemUnitChoices(itemId).find((row) => row.unit_id === defaultUnitId)
      || itemUnitChoices(itemId).find((row) => !row.is_base_unit && row.allow_purchase)
      || itemUnitChoices(itemId).find((row) => row.is_base_unit);
  }
  function lineRequirements(line, expense = expenseById(line.expense_item_id), item = itemById(line.item_id)) {
    return {
      quantity: Boolean(item?.track_stock || expense?.requires_quantity),
      unit: Boolean(item?.track_stock || expense?.requires_unit)
    };
  }
  function supplierChoices(itemId) {
    const linkedIds = state.itemSuppliers.filter((link) => link.item_id === itemId && link.active !== false).map((link) => link.supplier_id);
    return linkedIds.length ? state.suppliers.filter((supplier) => linkedIds.includes(supplier.id)) : state.suppliers;
  }

  function renderLines() {
    $("#expenseCount").textContent = `${state.lines.length} รายการ`;
    $("#expenseLines").innerHTML = state.lines.map((line, index) => {
      const item = itemById(line.item_id);
      const expense = expenseById(line.expense_item_id);
      const categoryId = lineCategoryId(line, expense);
      const unit = unitById(line.unit_id);
      const unitLink = state.itemUnits.find((row) => row.item_id === item?.id && row.unit_id === line.unit_id && row.active !== false);
      const requirements = lineRequirements(line, expense, item);
      const unitChoices = item ? itemUnitChoices(item.id).map((row) => unitById(row.unit_id)).filter(Boolean) : state.units;
      const suppliers = supplierChoices(line.item_id);
      const perUnit = Number(line.quantity) > 0 ? Number(line.line_total) / Number(line.quantity) : 0;
      const fields = [
        requirements.quantity ? `<label>จำนวน<input data-field="quantity" type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(line.quantity || "")}"></label>` : "",
        requirements.unit ? `<label>หน่วยซื้อ<select data-field="unit_id"><option value="">เลือก</option>${optionHtml(unitChoices, line.unit_id)}</select></label>` : "",
        `<label>ยอดรวม<input data-field="line_total" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(line.line_total)}"></label>`
      ].filter(Boolean);
      const conversion = Number(line.conversion_to_base || unitLink?.conversion_to_base || 1);
      const stockEffect = item?.track_stock && unit
        ? `เพิ่มสต็อก ${number.format((Number(line.quantity) || 0) * conversion)} ${escapeHtml(unitById(item.base_unit_id)?.name || "หน่วยฐาน")}`
        : "";
      return `<article class="expense-card ${line.expanded ? "expanded" : ""}" data-line-id="${line.id}">
        <button class="expense-summary" type="button" data-action="toggle-line">
          <span class="line-number">${index + 1}</span>
          <span class="summary-copy"><strong>${escapeHtml(line.description || expense?.name || item?.name || "ยังไม่ระบุรายการ")}</strong><small>${escapeHtml(categoryId ? categoryName(categoryId) : "ยังไม่เลือกหมวดหลัก")}</small></span>
          <span class="summary-amount"><strong>${money.format(Number(line.line_total) || 0)}</strong><span class="stock-tag ${item?.track_stock ? "" : "off"}">${item?.track_stock ? "เข้าสต็อก" : "ไม่เข้าสต็อก"}</span></span>
        </button>
        <div class="expense-detail">
          <div class="expense-picker">
            <label>รายการรายจ่าย<input class="typeable-select" data-field="expense_search" value="${escapeHtml(line.expense_search || line.description || expense?.name)}" placeholder="พิมพ์ค้นหาหรือเลือกรายการ" autocomplete="off" aria-autocomplete="list" aria-expanded="false"></label>
            <div class="expense-picker-options" role="listbox" hidden></div>
          </div>
          <div class="field-grid expense-fields fields-${fields.length}">${fields.join("")}</div>
          ${item?.track_stock && unit ? `<div class="conversion-field"><span>1 ${escapeHtml(unit.name)} เพิ่มสต็อก</span><input data-field="conversion_to_base" type="number" min="0.000001" step="any" inputmode="decimal" value="${escapeHtml(conversion)}"><strong>${escapeHtml(unitById(item.base_unit_id)?.name || "หน่วยฐาน")}</strong></div>` : ""}
          ${requirements.quantity ? `<div class="unit-price"><span>${stockEffect || "ราคาต่อหน่วย"}</span><strong>${money.format(perUnit)}${unit ? ` / ${escapeHtml(unit.name)}` : ""}</strong></div>` : ""}
          <div class="field-grid">
            <label>หมวดหลัก<select data-field="category_id"><option value="">เลือกหมวด</option>${optionHtml(mainCategories(), categoryId)}</select></label>
            <label>Supplier<input data-field="supplier_name" list="suppliers-${line.id}" value="${escapeHtml(line.supplier_name)}" placeholder="เลือกหรือพิมพ์ชื่อ"><datalist id="suppliers-${line.id}">${suppliers.map((row) => `<option value="${escapeHtml(row.name)}"></option>`).join("")}</datalist></label>
          </div>
          <label>หมายเหตุ<textarea data-field="note" placeholder="ไม่บังคับ">${escapeHtml(line.note)}</textarea></label>
          <button class="remove-line" type="button" data-action="remove-line">ลบรายการนี้</button>
        </div>
      </article>`;
    }).join("");
  }

  function renderExpenseOptions(card, queryValue = "") {
    const panel = card.querySelector(".expense-picker-options");
    const input = card.querySelector('[data-field="expense_search"]');
    if (!panel || !input) return;
    const query = String(queryValue || "").trim().toLocaleLowerCase("th");
    const rows = state.expenseItems.filter(isExpenseActive).filter((row) => {
      const mainCategory = categoryName(mainCategoryId(row.category_id));
      return `${row.name} ${row.code} ${mainCategory}`.toLocaleLowerCase("th").includes(query);
    }).slice(0, 30);
    panel.innerHTML = rows.map((row) => `<button type="button" role="option" data-action="select-expense" data-expense-id="${escapeHtml(row.id)}"><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(categoryName(mainCategoryId(row.category_id)))} · ${row.item_id || row.affects_stock ? "เข้าสต็อก" : "รายจ่ายทั่วไป"}</small></span></button>`).join("")
      + (query && !expenseBySearch(queryValue) ? `<button type="button" class="custom-expense-option" data-action="use-custom-expense"><span><strong>ใช้ “${escapeHtml(queryValue.trim())}”</strong><small>รายการใหม่ · เลือกหมวดหลักด้านล่าง</small></span></button>` : "")
      + (!rows.length && !query ? '<div class="expense-picker-empty">ยังไม่มีรายการรายจ่าย</div>' : "");
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closeExpensePickers(exceptCard = null) {
    $$(".expense-card").forEach((card) => {
      if (card === exceptCard) return;
      const panel = card.querySelector(".expense-picker-options");
      const input = card.querySelector('[data-field="expense_search"]');
      if (panel) panel.hidden = true;
      if (input) input.setAttribute("aria-expanded", "false");
    });
  }

  function selectExpense(line, expense) {
    const previousItem = itemById(line.item_id);
    line.expense_item_id = expense.id;
    line.source_expense_item_id = expense.id;
    line.expense_search = expense.name;
    line.description = expense.name;
    line.category_id = mainCategoryId(expense.category_id);
    if (expense.item_id) {
      const linkedItem = itemById(expense.item_id);
      const purchaseUnit = defaultPurchaseUnit(expense.item_id);
      line.item_id = expense.item_id;
      line.unit_id = purchaseUnit?.unit_id || linkedItem?.base_unit_id || "";
      line.conversion_to_base = Number(purchaseUnit?.conversion_to_base || 1);
      if (linkedItem?.track_stock && !(Number(line.quantity) > 0)) line.quantity = 1;
      if (previousItem?.id !== linkedItem?.id) line.supplier_name = "";
      const choices = supplierChoices(linkedItem?.id);
      if (choices.length === 1) line.supplier_name = choices[0].name;
    } else {
      line.item_id = "";
      line.conversion_to_base = 1;
      if (!expense.requires_quantity) line.quantity = 0;
      if (!expense.requires_unit) line.unit_id = "";
      if (previousItem) line.supplier_name = "";
    }
  }

  function applyExpenseChoice(button) {
    const card = button.closest(".expense-card");
    const line = state.lines.find((row) => row.id === card?.dataset.lineId);
    if (!line) return;
    if (button.dataset.action === "select-expense") {
      const expense = expenseById(button.dataset.expenseId);
      if (expense) selectExpense(line, expense);
    } else {
      line.expense_item_id = "";
      line.source_expense_item_id = "";
      line.description = String(line.expense_search || "").trim();
      line.quantity = 0;
      line.unit_id = "";
    }
    renderLines();
    scheduleDraftSave();
  }

  function updateLine(card, field, value) {
    const line = state.lines.find((row) => row.id === card.dataset.lineId);
    if (!line) return;
    line[field] = ["quantity", "line_total", "conversion_to_base"].includes(field) ? Number(value) : value;
    if (field === "unit_id" && line.item_id) {
      const link = state.itemUnits.find((row) => row.item_id === line.item_id && row.unit_id === value && row.active !== false);
      line.conversion_to_base = Number(link?.conversion_to_base || 1);
    }
    if (field === "expense_search") {
      const expense = expenseBySearch(value);
      if (expense) {
        selectExpense(line, expense);
      } else {
        line.expense_item_id = "";
        line.source_expense_item_id = "";
        line.item_id = "";
        line.quantity = 0;
        line.unit_id = "";
        line.conversion_to_base = 1;
        line.description = String(value).trim();
      }
    }
    if (field === "category_id") {
      const sourceExpense = expenseById(line.source_expense_item_id);
      line.expense_item_id = sourceExpense && mainCategoryId(sourceExpense.category_id) === value ? sourceExpense.id : "";
    }
    renderLines();
    scheduleDraftSave();
  }

  function validateExpense() {
    const errors = [];
    if (!$("#expenseDate").value) errors.push("กรุณาเลือกวันที่");
    state.lines.forEach((line, index) => {
      const item = itemById(line.item_id);
      const expense = expenseById(line.expense_item_id);
      const requirements = lineRequirements(line, expense, item);
      if (!line.description.trim()) errors.push(`รายการ ${index + 1}: ระบุชื่อรายการ`);
      if (!(Number(line.line_total) > 0)) errors.push(`รายการ ${index + 1}: ระบุยอดรวม`);
      if (!lineCategoryId(line)) errors.push(`รายการ ${index + 1}: เลือกหมวดหลัก`);
      if (requirements.quantity && !(Number(line.quantity) > 0)) errors.push(`รายการ ${index + 1}: ระบุจำนวน`);
      if (requirements.unit && !line.unit_id) errors.push(`รายการ ${index + 1}: เลือกหน่วย`);
      if (item?.track_stock && !(Number(line.conversion_to_base) > 0)) errors.push(`รายการ ${index + 1}: ระบุจำนวนหน่วยฐานต่อหน่วยซื้อ`);
      if (expense?.requires_supplier && !line.supplier_name.trim()) errors.push(`รายการ ${index + 1}: ระบุ Supplier`);
    });
    return errors;
  }

  function openReview() {
    const errors = validateExpense();
    const paymentLabel = $("#expensePaymentMethod").selectedOptions[0]?.textContent || "";
    const total = state.lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    $("#reviewSummary").textContent = `${state.lines.length} รายการ · ${paymentLabel} · ${money.format(total)}`;
    $("#reviewErrors").innerHTML = errors.map((error) => `<div>• ${escapeHtml(error)}</div>`).join("");
    $("#confirmExpenseButton").disabled = errors.length > 0 || !state.session;
    $("#reviewDialog").showModal();
  }

  async function submitExpense() {
    const button = $("#confirmExpenseButton");
    button.disabled = true;
    button.textContent = "กำลังบันทึก";
    const paymentMethod = $("#expensePaymentMethod").value;
    const totalAmount = state.lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const payload = {
      branch_id: state.branch.id,
      transaction_date: $("#expenseDate").value,
      source_system: branchApp.sourceSystem,
      idempotency_key: crypto.randomUUID(),
      payment_method: paymentMethod,
      payment: { method: paymentMethod, amount: totalAmount },
      lines: state.lines.map((line) => {
        const supplier = state.suppliers.find((row) => row.name.trim().toLocaleLowerCase("th") === line.supplier_name.trim().toLocaleLowerCase("th"));
        const requirements = lineRequirements(line);
        return { item_id: line.item_id || null, expense_item_id: line.expense_item_id || null, category_id: lineCategoryId(line) || null, supplier_id: supplier?.id || null, supplier_name: supplier ? null : line.supplier_name || null, description: line.description, quantity: requirements.quantity ? line.quantity : 0, unit_id: requirements.unit ? line.unit_id || null : null, conversion_to_base: Number(line.conversion_to_base || 1), line_total: line.line_total, note: line.note || null };
      })
    };
    const actor = { id: state.session?.user?.id || "local", name: state.profile?.display_name || "ผู้ใช้งาน BOY" };
    let data;
    let error;
    if (state.catalogSource === "google-sheets" || state.localAccess) {
      const legacyPayload = {
        ...payload,
        payment_method: ({ cash: "เงินสด", credit_card: "บัตรเครดิต", reimbursement_pending: "รอเบิกค่าใช้จ่าย" })[paymentMethod],
        lines: payload.lines.map((line) => ({ ...line, unit_name: unitById(line.unit_id)?.name || "", base_unit_id: itemById(line.item_id)?.base_unit_id || "" }))
      };
      try { data = await legacyApi("burgerExpenseSave", { payload: legacyPayload, actor }); }
      catch (legacyError) { error = legacyError; payload.payment_method = legacyPayload.payment_method; queueOperation("expense_legacy", legacyPayload, { transaction_date: payload.transaction_date, actor }); }
    } else if (!centralAvailable()) {
      error = new Error("ออฟไลน์");
      queueOperation("expense", payload, { transaction_date: payload.transaction_date });
    } else {
      ({ data, error } = await client.schema("boy_central").rpc("record_expense_v3", { payload }));
    }
    button.textContent = "บันทึก";
    if (error && isNetworkError(error)) {
      $("#reviewDialog").close();
      await clearDraftForDate(payload.transaction_date, false);
      state.lines = [newLine()];
      renderLines();
      toast("การเชื่อมต่อขาดหาย เก็บรายการไว้รอส่งแล้ว");
      return;
    }
    if (error) { button.disabled = false; toast(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    $("#reviewDialog").close();
    await clearDraft();
    state.lines = [newLine()];
    renderLines();
    loadExpenseHistory();
    toast(`บันทึก ${data?.line_count || state.lines.length} รายการแล้ว`);
  }

  async function loadExpenseHistory() {
    if (!state.branch) return;
    if (!centralAvailable()) { $("#expenseHistory").innerHTML = '<div class="empty-state">ประวัติจากระบบกลางจะกลับมาเมื่อ BOY Central พร้อม</div>'; return; }
    const { data, error } = await client.schema("boy_central").from("transactions").select("id,transaction_date,total_amount,status,transaction_lines(description)").eq("branch_id", state.branch.id).eq("transaction_type", "expense").eq("transaction_date", $("#expenseDate").value).order("occurred_at", { ascending: false }).limit(30);
    if (error) { $("#expenseHistory").innerHTML = '<div class="empty-state">โหลดประวัติไม่สำเร็จ</div>'; return; }
    $("#expenseHistory").innerHTML = (data || []).length ? data.map((row) => `<article class="history-row"><span><strong>${escapeHtml(row.transaction_lines?.[0]?.description || "รายจ่าย")}</strong><small>${escapeHtml(row.transaction_date)} · ${escapeHtml(row.status)}</small></span><span class="history-amount">${money.format(row.total_amount || 0)}</span></article>`).join("") : '<div class="empty-state">ยังไม่มีรายจ่าย</div>';
  }

  async function loadMaster() {
    const [branchResult, unitsResult, categoriesResult] = await Promise.all([
      client.schema("boy_central").from("branches").select("id,company_id,code,name,active").eq("code", branchApp.branchCode).single(),
      client.schema("boy_central").from("units").select("id,name,code").eq("active", true).order("name"),
      client.schema("boy_central").from("categories").select("id,name,code,parent_id,category_type").eq("active", true).order("sort_order")
    ]);
    if (branchResult.error) throw branchResult.error;
    if (unitsResult.error) throw unitsResult.error;
    if (categoriesResult.error) throw categoriesResult.error;
    state.branch = branchResult.data;
    state.units = unitsResult.data || [];
    state.categories = categoriesResult.data || [];
    const [itemLinksResult, expenseLinksResult, supplierLinksResult, linksResult] = await Promise.all([
      client.schema("boy_central").from("branch_items").select("item_id,minimum_stock,reorder_point,target_stock,preferred_supplier_id,default_purchase_unit_id,default_issue_unit_id,notes,active").eq("branch_id", state.branch.id),
      client.schema("boy_central").from("branch_expense_items").select("expense_item_id,sort_order,active").eq("branch_id", state.branch.id).order("sort_order"),
      client.schema("boy_central").from("branch_suppliers").select("supplier_id,is_preferred").eq("branch_id", state.branch.id).eq("active", true).order("is_preferred", { ascending: false }),
      client.schema("boy_central").from("branch_item_suppliers").select("item_id,supplier_id,active,is_primary").eq("branch_id", state.branch.id).order("is_primary", { ascending: false })
    ]);
    if (itemLinksResult.error) throw itemLinksResult.error;
    if (expenseLinksResult.error) throw expenseLinksResult.error;

    const itemIds = (itemLinksResult.data || []).map((row) => row.item_id);
    const expenseIds = (expenseLinksResult.data || []).map((row) => row.expense_item_id);
    const supplierIds = (supplierLinksResult.data || []).map((row) => row.supplier_id);
    const [itemsResult, expenseResult, supplierResult, itemUnitsResult] = await Promise.all([
      itemIds.length
        ? client.schema("boy_central").from("items").select("id,name,code,item_type,base_unit_id,category_id,track_stock,purchaseable,issueable,sellable,brand,package_size,package_unit_id,notes,active").in("id", itemIds).order("name")
        : Promise.resolve({ data: [], error: null }),
      expenseIds.length
        ? client.schema("boy_central").from("expense_items").select("id,name,code,category_id,item_id,affects_stock,requires_quantity,requires_unit,requires_supplier,requires_receipt,notes,active").in("id", expenseIds)
        : Promise.resolve({ data: [], error: null }),
      !supplierLinksResult.error && supplierIds.length
        ? client.schema("boy_central").from("suppliers").select("id,name,code").in("id", supplierIds).eq("active", true)
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? client.schema("boy_central").from("item_units").select("item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active").in("item_id", itemIds).eq("active", true).order("is_base_unit", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (expenseResult.error) throw expenseResult.error;
    if (itemUnitsResult.error) throw itemUnitsResult.error;

    const expenseOrder = new Map((expenseLinksResult.data || []).map((row, index) => [row.expense_item_id, [row.sort_order ?? 0, index]]));
    const supplierOrder = new Map((supplierLinksResult.data || []).map((row, index) => [row.supplier_id, [row.is_preferred ? 0 : 1, index]]));
    const branchItemMap = new Map((itemLinksResult.data || []).map((row) => [row.item_id, row]));
    const branchExpenseMap = new Map((expenseLinksResult.data || []).map((row) => [row.expense_item_id, row]));
    state.items = (itemsResult.data || []).map((row) => ({ ...row, branch_active: branchItemMap.get(row.id)?.active !== false })).sort((a, b) => a.name.localeCompare(b.name, "th"));
    state.branchItems = itemLinksResult.data || [];
    state.itemUnits = itemUnitsResult.data || [];
    state.expenseItems = (expenseResult.data || []).map((row) => ({ ...row, branch_active: branchExpenseMap.get(row.id)?.active !== false, sort_order: expenseOrder.get(row.id)?.[0] || 0 })).sort((a, b) => {
      const left = expenseOrder.get(a.id) || [0, 0];
      const right = expenseOrder.get(b.id) || [0, 0];
      return left[0] - right[0] || left[1] - right[1];
    });
    state.suppliers = supplierResult.error ? [] : (supplierResult.data || []).sort((a, b) => {
      const left = supplierOrder.get(a.id) || [1, 0];
      const right = supplierOrder.get(b.id) || [1, 0];
      return left[0] - right[0] || left[1] - right[1];
    });
    state.itemSuppliers = linksResult.error ? [] : (linksResult.data || []);
    state.catalogSource = "supabase";
    renderLines();
    renderMasterList();
    saveMasterCache();
    updateSyncStatus();
  }

  function applyLegacyCatalog(data) {
    if (!data?.branch || !Array.isArray(data.items)) throw new Error(`ข้อมูลรายการ${branchApp.name}ไม่สมบูรณ์`);
    state.branch = data.branch;
    state.branchItems = data.branchItems || [];
    state.items = data.items || [];
    state.units = data.units || [];
    state.itemUnits = data.itemUnits || [];
    state.categories = data.categories || [];
    state.expenseItems = data.expenseItems || [];
    state.suppliers = data.suppliers || [];
    state.itemSuppliers = data.itemSuppliers || [];
    state.catalogSource = "google-sheets";
    renderLines();
    renderMasterList();
    saveMasterCache();
    updateSyncStatus();
  }

  const mirrorBool = (value, fallback = false) => value === undefined || value === null || value === "" ? fallback : ![false, 0, "0", "false", "FALSE", "ปิด", "ไม่ใช้งาน"].includes(value);
  async function loadMirrorMaster() {
    setConnection(`กำลังโหลดข้อมูล${branchApp.name}`, "pending");
    const [itemCatalog, expenseCatalog, supplierCatalog, itemUnitCatalog, itemSupplierCatalog] = await Promise.all([
      legacyApi("masterCatalog", { entity: "items" }),
      legacyApi("masterCatalog", { entity: "expenseItems" }),
      legacyApi("masterCatalog", { entity: "suppliers" }),
      legacyApi("masterCatalog", { entity: "itemUnits" }),
      legacyApi("masterCatalog", { entity: "itemSuppliers" })
    ]);
    const refs = itemCatalog.references || {};
    const branchRow = (refs.branches?.rows || []).find((row) => String(row["รหัสสาขา"] || row.code || "").toUpperCase() === branchApp.branchCode);
    if (!branchRow) throw new Error(`ยังไม่พบสาขา ${branchApp.branchCode} ในข้อมูลกลาง`);
    const branchId = branchRow.branch_id;
    const branchLinks = (refs.branchItems?.rows || []).filter((row) => String(row.branch_id) === String(branchId) && mirrorBool(row["เปิดใช้งาน"], true));
    const itemIds = new Set(branchLinks.map((row) => String(row.item_id)));
    const unitRows = refs.units?.rows || [];
    const categoryRows = refs.categories?.rows || [];
    state.branch = { id: branchId, company_id: branchRow.company_id || "BOY", code: branchApp.branchCode, name: branchRow["ชื่อสาขา"] || branchApp.name, active: mirrorBool(branchRow["เปิดใช้งาน"], true) };
    state.units = unitRows.map((row) => ({ id: row.unit_id, name: row["ชื่อหน่วย"] || row.name || row.unit_id, code: row["รหัสหน่วย"] || row.code || row.unit_id }));
    state.categories = categoryRows.map((row) => ({ id: row.subcategory_id || row.category_id, name: row["ชื่อประเภทย่อย"] || row["ชื่อประเภทหลัก"] || "ไม่ระบุ", code: row["รหัสประเภทย่อย"] || row.subcategory_id || row.category_id, parent_id: row.subcategory_id ? row.category_id : null, category_type: row["ประเภทหมวดหมู่"] || "expense" }));
    state.items = (itemCatalog.rows || []).filter((row) => itemIds.has(String(row.item_id))).map((row) => ({ id: row.item_id, name: row["ชื่อสินค้า"] || row.name || row.item_id, code: row["รหัสสินค้า"] || row.code || row.item_id, item_type: row["ประเภทข้อมูล"] || "STOCK_ITEM", base_unit_id: row.base_unit_id || row.unit_id || "", category_id: row.subcategory_id || row.category_id || "", track_stock: mirrorBool(row["ติดตามสต็อก"]), purchaseable: mirrorBool(row["ซื้อได้"]), issueable: mirrorBool(row["เบิกได้"]), sellable: mirrorBool(row["ขายได้"]), brand: row["ยี่ห้อ"] || "", package_size: row["ขนาดบรรจุ"] || "", package_unit_id: row.package_unit_id || "", notes: row["หมายเหตุ"] || "", active: mirrorBool(row["เปิดใช้งาน"], true), branch_active: true }));
    state.branchItems = branchLinks.map((row) => ({ item_id: row.item_id, minimum_stock: Number(row["สต็อกขั้นต่ำ"] || 0), reorder_point: Number(row["จุดสั่งซื้อ"] || 0), target_stock: Number(row["สต็อกเป้าหมาย"] || 0), preferred_supplier_id: row.preferred_supplier_id || "", default_purchase_unit_id: row.default_purchase_unit_id || row.purchase_unit_id || "", default_issue_unit_id: row.default_issue_unit_id || row.issue_unit_id || "", notes: row["หมายเหตุ"] || "", active: mirrorBool(row["เปิดใช้งาน"]) }));
    const relevantExpense = (row) => itemIds.has(String(row.item_id || "")) || String(row.default_branch_id || "") === String(branchId) || String(row["รหัสรายการค่าใช้จ่าย"] || row.expense_item_id || "").toUpperCase().includes(branchApp.branchCode);
    state.expenseItems = (expenseCatalog.rows || []).filter(relevantExpense).map((row, index) => ({ id: row.expense_item_id, name: row["ชื่อรายการค่าใช้จ่าย"] || row.name || row.expense_item_id, code: row["รหัสรายการค่าใช้จ่าย"] || row.code || row.expense_item_id, category_id: row.subcategory_id || row.category_id || "", item_id: row.item_id || null, affects_stock: mirrorBool(row["กระทบสต็อก"]), requires_quantity: mirrorBool(row["ต้องกรอกจำนวน"]), requires_unit: mirrorBool(row["ต้องเลือกหน่วย"]), requires_supplier: mirrorBool(row["ต้องระบุผู้ขาย"]), requires_receipt: mirrorBool(row["ต้องมีหลักฐาน"]), notes: row["หมายเหตุ"] || "", active: mirrorBool(row["เปิดใช้งาน"], true), branch_active: true, sort_order: Number(row["ลำดับแสดง"] || index) }));
    state.suppliers = (supplierCatalog.rows || []).filter((row) => mirrorBool(row["เปิดใช้งาน"], true)).map((row) => ({ id: row.supplier_id, name: row["ชื่อผู้ขาย"] || row.name || row.supplier_id, code: row["รหัสผู้ขาย"] || row.code || row.supplier_id }));
    state.itemUnits = (itemUnitCatalog.rows || []).filter((row) => itemIds.has(String(row.item_id)) && mirrorBool(row["เปิดใช้งาน"], true)).map((row) => ({ item_id: row.item_id, unit_id: row.unit_id, conversion_to_base: Number(row["อัตราแปลงเป็นหน่วยฐาน"] || 1), is_base_unit: mirrorBool(row["เป็นหน่วยฐาน"]), allow_purchase: mirrorBool(row["ใช้หน่วยนี้ตอนซื้อ"]), allow_issue: mirrorBool(row["ใช้หน่วยนี้ตอนเบิก"]), active: true }));
    state.itemSuppliers = (itemSupplierCatalog.rows || []).filter((row) => itemIds.has(String(row.item_id)) && (!row.branch_id || String(row.branch_id) === String(branchId)) && mirrorBool(row["เปิดใช้งาน"], true)).map((row) => ({ item_id: row.item_id, supplier_id: row.supplier_id, active: true, is_primary: mirrorBool(row["เป็นผู้ขายหลัก"]) }));
    state.catalogSource = "google-sheets";
    renderLines(); renderMasterList(); saveMasterCache(); updateSyncStatus();
    setConnection(`พร้อมใช้ · ${state.expenseItems.filter(isExpenseActive).length} รายการ`, "online");
  }

  async function loadLegacyMaster() {
    if (!branchApp.legacyEnabled) return loadMirrorMaster();
    setConnection(`กำลังโหลดรายการ${branchApp.name}`, "pending");
    const result = await legacyApi("burgerCatalog");
    applyLegacyCatalog(result);
    setConnection(`พร้อมใช้ · ${state.expenseItems.filter(isExpenseActive).length} รายการ`, "online");
  }

  function renderReimbursements() {
    const list = $("#reimbursementList");
    const rows = state.reimbursements || [];
    $("#reimbursementTotal").textContent = money.format(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">ไม่มีรายการรอเบิก</div>';
      $("#settleReimbursementsButton").disabled = true;
      return;
    }
    list.innerHTML = rows.map((row) => `<label class="reimbursement-row"><input type="checkbox" data-reimbursement-id="${escapeHtml(row.transaction_id || row.id)}" checked><span><strong>${escapeHtml(row.description || row.descriptions?.join(", ") || "ค่าใช้จ่าย")}</strong><small>${escapeHtml(row.transaction_date || "")} · ${escapeHtml(row.created_by || "")}</small></span><b>${money.format(Number(row.amount || 0))}</b></label>`).join("");
    updateReimbursementSelection();
  }

  function updateReimbursementSelection() {
    const selected = $$('#reimbursementList input[data-reimbursement-id]:checked');
    const total = selected.reduce((sum, input) => {
      const row = state.reimbursements.find((item) => (item.transaction_id || item.id) === input.dataset.reimbursementId);
      return sum + Number(row?.amount || 0);
    }, 0);
    const button = $("#settleReimbursementsButton");
    button.disabled = !selected.length;
    button.textContent = selected.length ? `รับเงินและเคลียร์ ${selected.length} รายการ · ${money.format(total)}` : "เลือกรายการที่รับเงินแล้ว";
  }

  async function loadReimbursements() {
    $("#reimbursementList").innerHTML = '<div class="empty-state">กำลังโหลดรายการ…</div>';
    try {
      if (state.catalogSource === "supabase" && centralAvailable()) {
        const { data, error } = await client.schema("boy_central").rpc("get_burger_reimbursements");
        if (error) throw error;
        state.reimbursements = data?.items || data || [];
      } else {
        const result = await legacyApi("burgerReimbursements");
        state.reimbursements = (result.items || result.rows || []).map((row) => ({ ...row, amount: row.amount ?? row.total_amount }));
      }
      renderReimbursements();
    } catch (error) {
      state.reimbursements = [];
      $("#reimbursementList").innerHTML = `<div class="empty-state">โหลดรายการรอเบิกไม่สำเร็จ<br>${escapeHtml(error.message)}</div>`;
      $("#settleReimbursementsButton").disabled = true;
    }
  }

  async function settleReimbursements() {
    const ids = $$('#reimbursementList input[data-reimbursement-id]:checked').map((input) => input.dataset.reimbursementId);
    if (!ids.length || !confirm(`ยืนยันว่าได้รับเงินคืนและเคลียร์ ${ids.length} รายการแล้ว?`)) return;
    const button = $("#settleReimbursementsButton");
    button.disabled = true;
    button.textContent = "กำลังเคลียร์ยอด…";
    try {
      if (state.catalogSource === "supabase" && centralAvailable()) {
        const { error } = await client.schema("boy_central").rpc("settle_burger_reimbursements", { payload: { transaction_ids: ids } });
        if (error) throw error;
      } else {
        await legacyApi("burgerReimbursementsSettle", { transactionIds: ids, actor: { id: state.session?.user?.id || "local", name: state.profile?.display_name || "ผู้ใช้งาน BOY" } });
      }
      toast(`เคลียร์ยอดรอเบิกแล้ว ${ids.length} รายการ`);
      await loadReimbursements();
    } catch (error) {
      toast(`เคลียร์ยอดไม่สำเร็จ: ${error.message}`);
      updateReimbursementSelection();
    }
  }

  async function loadStock() {
    if (!state.branch) return;
    if (!centralAvailable()) { $("#stockList").innerHTML = '<div class="empty-state">ยอดสต็อกกลางจะกลับมาเมื่อ BOY Central พร้อม</div>'; return; }
    $("#stockList").innerHTML = '<div class="empty-state">กำลังโหลด</div>';
    const centralResult = await client.schema("boy_central").from("v_stock_on_hand")
      .select("item_id,item_code,item_name,base_unit_name,quantity_on_hand,average_unit_cost,inventory_value,updated_at")
      .eq("branch_id", state.branch.id).order("item_name");
    if (centralResult.error) { $("#stockList").innerHTML = `<div class="empty-state">${escapeHtml(centralResult.error.message)}</div>`; return; }
    const stockByItem = new Map(state.items.filter((item) => item.track_stock && item.active !== false && item.branch_active !== false).map((item) => [item.id, {
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      base_unit_name: unitById(item.base_unit_id)?.name || "",
      quantity_on_hand: 0,
      average_unit_cost: 0,
      inventory_value: 0,
      stock_source: "BOY Central"
    }]));
    (centralResult.data || []).forEach((row) => stockByItem.set(row.item_id, { ...row, stock_source: "BOY Central" }));
    state.stock = [...stockByItem.values()];
    renderStock();
  }

  function renderStock() {
    const query = $("#stockSearch").value.trim().toLocaleLowerCase("th");
    const rows = state.stock.filter((row) => `${row.item_code} ${row.item_name}`.toLocaleLowerCase("th").includes(query));
    $("#stockList").innerHTML = rows.length ? rows.map((row) => `<article class="stock-row"><span><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.item_code || "")} · ${row.stock_source ? escapeHtml(row.stock_source) : `ต้นทุน ${money.format(row.average_unit_cost || 0)}`}</small></span><span class="stock-qty"><strong>${number.format(row.quantity_on_hand || 0)} ${escapeHtml(row.base_unit_name || "")}</strong><span class="stock-value">${money.format(row.inventory_value || 0)}</span></span></article>`).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  async function loadDashboard() {
    if (!state.branch) return;
    if (!centralAvailable()) { toast("Dashboard กลางจะกลับมาเมื่อ BOY Central พร้อม"); return; }
    const period = `${$("#dashboardMonth").value}-01`;
    const [year, month] = $("#dashboardMonth").value.split("-").map(Number);
    const nextPeriod = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const [summaryResult, transactionsResult, ordersResult] = await Promise.all([
      client.schema("boy_central").from("v_monthly_branch_summary").select("income,expense,net_profit").eq("branch_id", state.branch.id).eq("month_start", period).maybeSingle(),
      client.schema("boy_central").from("transactions").select("source_system,transaction_type,total_amount,status").eq("branch_id", state.branch.id).gte("transaction_date", period).lt("transaction_date", nextPeriod),
      client.schema("boy_central").from("pos_orders").select("sales_channel,payment_method,total_amount,payment_status").eq("branch_id", state.branch.id).gte("ordered_at", `${period}T00:00:00+07:00`).lt("ordered_at", `${nextPeriod}T00:00:00+07:00`)
    ]);
    if (summaryResult.error || transactionsResult.error || ordersResult.error) { toast(summaryResult.error?.message || transactionsResult.error?.message || ordersResult.error?.message); return; }
    const summary = summaryResult.data || { income: 0, expense: 0, net_profit: 0 };
    const transactions = transactionsResult.data || [];
    const income = Number(summary.income || 0);
    const net = income - Number(summary.expense || 0);
    const posOrders = (ordersResult.data || []).filter((row) => row.payment_status === "completed");
    const saleOrders = posOrders.length;
    $("#metricGrid").innerHTML = `<article class="metric accent"><small>ยอดขายสุทธิ</small><strong>${money.format(income)}</strong></article><article class="metric"><small>รายจ่าย</small><strong>${money.format(summary.expense || 0)}</strong></article><article class="metric"><small>คงเหลือก่อนต้นทุน</small><strong>${money.format(net)}</strong></article><article class="metric"><small>ออเดอร์</small><strong>${number.format(saleOrders)}</strong></article>`;
    const channelMap = new Map();
    posOrders.forEach((row) => {
      const channel = ({ store: "หน้าร้าน", grab: "Grab", lineman: "LINE MAN" })[row.sales_channel] || row.sales_channel || "อื่นๆ";
      channelMap.set(channel, (channelMap.get(channel) || 0) + Number(row.total_amount || 0));
    });
    transactions.filter((row) => row.status === "confirmed" && ["income", "settlement"].includes(row.transaction_type)).forEach((row) => {
      const channel = row.source_system || "รายรับอื่น";
      channelMap.set(channel, (channelMap.get(channel) || 0) + Number(row.total_amount || 0));
    });
    const channels = [...channelMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const max = Math.max(...channels.map((row) => row.total), 1);
    $("#channelBreakdown").innerHTML = channels.length ? channels.map((row) => `<div class="breakdown-row"><span>${escapeHtml(row.name)}</span><span class="breakdown-bar"><span style="width:${Math.max(3, row.total / max * 100)}%"></span></span><strong>${money.format(row.total)}</strong></div>`).join("") : '<div class="empty-state">ยังไม่มีข้อมูลเดือนนี้</div>';
  }

  function categoryName(id) { return state.categories.find((row) => row.id === id)?.name || "ไม่ระบุหมวด"; }

  function renderMasterList() {
    const list = $("#masterList");
    if (!list) return;
    const query = $("#masterSearch").value.trim().toLocaleLowerCase("th");
    const rows = (state.masterTab === "items" ? state.items : state.expenseItems)
      .filter((row) => `${row.code} ${row.name}`.toLocaleLowerCase("th").includes(query));
    list.innerHTML = rows.length ? rows.map((row) => `<button class="master-row" type="button" data-master-id="${row.id}" data-master-kind="${state.masterTab === "items" ? "item" : "expense_item"}">
      <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.code)} · ${escapeHtml(categoryName(row.category_id))}</small></span>
      <span class="master-badges"><small>${row.active === false || row.branch_active === false ? "ปิดใช้งาน" : (state.masterTab === "items" ? (row.track_stock ? "ติดตามสต็อก" : "ไม่ติดตามสต็อก") : (row.affects_stock ? "เพิ่มสต็อก" : "รายจ่ายทั่วไป"))}</small><b>แก้ไข</b></span>
    </button>`).join("") : '<div class="empty-state">ไม่พบรายการ</div>';
  }

  function syncMasterPurchaseFields() {
    const isItem = $("#masterKind").value === "item";
    const enabled = isItem && $("#masterStock").checked;
    $("#masterPurchaseFields").hidden = !enabled;
    if (!enabled) return;
    const baseUnit = unitById($("#masterUnit").value);
    const purchaseUnit = unitById($("#masterPurchaseUnit").value);
    $("#masterConversion").disabled = !purchaseUnit;
    if (!purchaseUnit) $("#masterConversion").value = 1;
    $("#masterConversionPreview").textContent = purchaseUnit
      ? `1 ${purchaseUnit.name} = ${number.format(Number($("#masterConversion").value) || 0)} ${baseUnit?.name || "หน่วยฐาน"}`
      : `ซื้อและนับสต็อกเป็น ${baseUnit?.name || "หน่วยฐาน"}`;
  }

  function refreshMasterPurchaseUnits(selected = $("#masterPurchaseUnit").value, issueSelected = $("#masterDefaultIssueUnit").value) {
    const baseUnitId = $("#masterUnit").value;
    const nextSelected = selected === baseUnitId ? "" : selected;
    $("#masterPurchaseUnit").innerHTML = `<option value="">ใช้หน่วยฐาน</option>${optionHtml(state.units.filter((unit) => unit.id !== baseUnitId), nextSelected)}`;
    const issueUnitIds = new Set(state.itemUnits.filter((row) => row.item_id === $("#masterId").value && row.allow_issue && row.active !== false).map((row) => row.unit_id));
    issueUnitIds.add(baseUnitId);
    if (nextSelected) issueUnitIds.add(nextSelected);
    const issueUnits = state.units.filter((unit) => issueUnitIds.has(unit.id));
    $("#masterDefaultIssueUnit").innerHTML = optionHtml(issueUnits, issueUnits.some((unit) => unit.id === issueSelected) ? issueSelected : baseUnitId);
    syncMasterPurchaseFields();
  }

  function refreshMasterCategories(mainId, selectedId = "") {
    const mains = mainCategories();
    const nextMain = mainId || mains[0]?.id || "";
    $("#masterMainCategory").innerHTML = optionHtml(mains, nextMain);
    $("#masterCategory").innerHTML = `<option value="">ไม่ระบุประเภทย่อย</option>${optionHtml(subcategories(nextMain), selectedId)}`;
  }

  function refreshPreferredSupplier(selected = $("#masterPreferredSupplier").value) {
    const selectedIds = $$('#masterSupplierChoices input[type="checkbox"]:checked').map((input) => input.value);
    const rows = state.suppliers.filter((supplier) => selectedIds.includes(supplier.id));
    $("#masterPreferredSupplier").innerHTML = `<option value="">ไม่ระบุ</option>${optionHtml(rows, rows.some((row) => row.id === selected) ? selected : "")}`;
  }

  function renderMasterSuppliers(itemId, preferredId = "") {
    const selectedIds = new Set(state.itemSuppliers.filter((link) => link.item_id === itemId && link.active !== false).map((link) => link.supplier_id));
    $("#masterSupplierChoices").innerHTML = state.suppliers.length
      ? state.suppliers.map((supplier) => `<label class="check-row supplier-choice"><input type="checkbox" value="${supplier.id}" ${selectedIds.has(supplier.id) ? "checked" : ""}><span>${escapeHtml(supplier.name)}</span></label>`).join("")
      : '<div class="expense-picker-empty">ยังไม่มี Supplier ของร้าน</div>';
    refreshPreferredSupplier(preferredId);
  }

  function openMaster(id, kind) {
    const row = (kind === "item" ? state.items : state.expenseItems).find((entry) => entry.id === id) || {};
    const branchItem = kind === "item" ? branchItemById(row.id) || {} : {};
    const purchaseUnit = kind === "item" ? defaultPurchaseUnit(row.id) : null;
    const mainId = mainCategoryId(row.category_id) || mainCategories()[0]?.id || "";
    const selectedSubcategory = state.categories.find((category) => category.id === row.category_id)?.parent_id ? row.category_id : "";
    $("#masterId").value = row.id || "";
    $("#masterKind").value = kind;
    $("#masterCode").textContent = row.code || "ระบบจะสร้างรหัสให้อัตโนมัติ";
    $("#masterName").value = row.name || "";
    $("#masterDialogTitle").textContent = `${row.id ? "แก้ไข" : "เพิ่ม"}${kind === "item" ? "สินค้า / วัตถุดิบ" : "รายการรายจ่าย"}`;
    $("#masterItemFields").hidden = kind !== "item";
    $("#masterItemAdvanced").hidden = kind !== "item";
    $("#masterItemAdvanced").open = false;
    $("#masterUnit").innerHTML = optionHtml(state.units, row.base_unit_id || state.units[0]?.id);
    refreshMasterPurchaseUnits(purchaseUnit?.is_base_unit ? "" : purchaseUnit?.unit_id || "", branchItem.default_issue_unit_id || row.base_unit_id);
    $("#masterConversion").value = purchaseUnit?.conversion_to_base || 1;
    refreshMasterCategories(mainId, selectedSubcategory);
    $("#masterStock").checked = kind === "item" ? Boolean(row.track_stock) : Boolean(row.affects_stock);
    $("#masterStockLabel").textContent = kind === "item" ? "ติดตามสต็อก" : "รายการนี้เพิ่มสต็อก";
    $("#masterItemType").value = row.item_type || (row.track_stock === false ? "NON_STOCK_ITEM" : "STOCK_ITEM");
    $("#masterBrand").value = row.brand || "";
    $("#masterPackageSize").value = row.package_size || "";
    $("#masterPackageUnit").innerHTML = `<option value="">ไม่ระบุ</option>${optionHtml(state.units, row.package_unit_id)}`;
    $("#masterPurchaseable").checked = row.purchaseable !== false;
    $("#masterIssueable").checked = row.issueable !== false;
    $("#masterSellable").checked = Boolean(row.sellable);
    $("#masterMinimumStock").value = branchItem.minimum_stock || 0;
    $("#masterReorderPoint").value = branchItem.reorder_point || 0;
    $("#masterTargetStock").value = branchItem.target_stock || 0;
    renderMasterSuppliers(row.id, branchItem.preferred_supplier_id || "");
    $("#masterExpenseFields").hidden = kind !== "expense_item";
    $("#masterRequiresQuantity").checked = kind === "expense_item" && Boolean(row.requires_quantity);
    $("#masterRequiresUnit").checked = kind === "expense_item" && Boolean(row.requires_unit);
    $("#masterRequiresSupplier").checked = kind === "expense_item" && Boolean(row.requires_supplier);
    $("#masterRequiresReceipt").checked = kind === "expense_item" && Boolean(row.requires_receipt);
    $("#masterSortOrder").value = kind === "expense_item" ? row.sort_order || 0 : 0;
    $("#masterNotes").value = row.notes || "";
    $("#masterActive").checked = row.active !== false && (kind !== "item" || branchItem.active !== false) && (kind !== "expense_item" || row.branch_active !== false);
    syncMasterPurchaseFields();
    $("#masterDialog").showModal();
    $("#masterDialog").focus({ preventScroll: true });
  }

  async function saveMaster(event) {
    event.preventDefault();
    if (state.profile?.company_role !== "admin") { toast("เฉพาะ Admin เท่านั้นที่แก้รายการตั้งต้นได้"); return; }
    const kind = $("#masterKind").value;
    const payload = { idempotency_key: crypto.randomUUID(), kind, id: $("#masterId").value, name: $("#masterName").value.trim(), category_id: $("#masterCategory").value || $("#masterMainCategory").value, active: $("#masterActive").checked, notes: $("#masterNotes").value.trim() };
    if (kind === "item") {
      payload.base_unit_id = $("#masterUnit").value;
      payload.track_stock = $("#masterStock").checked;
      payload.item_type = $("#masterItemType").value;
      payload.purchase_unit_id = $("#masterPurchaseUnit").value || null;
      payload.conversion_to_base = Number($("#masterConversion").value) || 1;
      payload.default_issue_unit_id = $("#masterDefaultIssueUnit").value || $("#masterUnit").value;
      payload.brand = $("#masterBrand").value.trim();
      payload.package_size = $("#masterPackageSize").value || null;
      payload.package_unit_id = $("#masterPackageUnit").value || null;
      payload.purchaseable = $("#masterPurchaseable").checked;
      payload.issueable = $("#masterIssueable").checked;
      payload.sellable = $("#masterSellable").checked;
      payload.minimum_stock = Number($("#masterMinimumStock").value) || 0;
      payload.reorder_point = Number($("#masterReorderPoint").value) || 0;
      payload.target_stock = Number($("#masterTargetStock").value) || 0;
      payload.supplier_ids = $$('#masterSupplierChoices input[type="checkbox"]:checked').map((input) => input.value);
      payload.preferred_supplier_id = $("#masterPreferredSupplier").value || null;
    } else {
      payload.affects_stock = $("#masterStock").checked;
      payload.requires_quantity = $("#masterRequiresQuantity").checked;
      payload.requires_unit = $("#masterRequiresUnit").checked;
      payload.requires_supplier = $("#masterRequiresSupplier").checked;
      payload.requires_receipt = $("#masterRequiresReceipt").checked;
      payload.sort_order = Number($("#masterSortOrder").value) || 0;
    }
    if (!centralAvailable()) {
      queueOperation("master", payload);
      $("#masterDialog").close();
      toast("เก็บการแก้ไขไว้แล้ว จะส่งอัตโนมัติเมื่อออนไลน์");
      return;
    }
    const { error } = await client.schema("boy_central").rpc("admin_update_burger_master_v2", { payload });
    if (error && isNetworkError(error)) {
      queueOperation("master", payload);
      $("#masterDialog").close();
      toast("การเชื่อมต่อขาดหาย เก็บการแก้ไขไว้รอส่งแล้ว");
      return;
    }
    if (error) { toast(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    $("#masterDialog").close();
    await loadMaster();
    toast("อัปเดตรายการแล้ว");
  }

  async function ensureProfile(session) {
    const { data: profile, error: profileError } = await client.schema("boy_central").from("profiles").select("display_name,company_role").eq("user_id", session.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile) return profile;

    const fallbackName = session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "ผู้ดูแล BOY";
    const { data: createdProfile, error: bootstrapError } = await client.schema("boy_central").rpc("bootstrap_first_admin", { display_name: fallbackName });
    if (bootstrapError) {
      if (bootstrapError.message.includes("initial admin already exists")) throw new Error("บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน BOY");
      throw bootstrapError;
    }
    return createdProfile;
  }

  async function enterApp(session) {
    state.localAccess = false;
    state.session = session;
    setConnection("กำลังตรวจสิทธิ์");
    let profile;
    try {
      if (navigator.onLine) {
        profile = await ensureProfile(session);
        localStorage.setItem(profileCacheKey(), JSON.stringify(profile));
      } else {
        profile = readCache(profileCacheKey());
        if (!profile) throw new Error("ต้องเชื่อมต่ออินเทอร์เน็ตอย่างน้อยหนึ่งครั้งก่อนใช้งานออฟไลน์");
      }
    } catch (error) {
      const cachedProfile = readCache(profileCacheKey());
      if (cachedProfile && isNetworkError(error)) profile = cachedProfile;
      else {
        state.session = null;
        document.body.classList.add("auth-mode");
        $("#authCard").hidden = false;
        $$(".page,.bottom-nav").forEach((element) => element.hidden = true);
        $("#loginError").textContent = error.message;
        setConnection("ไม่มีสิทธิ์", "error");
        return;
      }
    }
    state.profile = profile;
    document.body.classList.remove("auth-mode");
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^(tawana|bigc|bigc-order|burger|dashboard|water-pos-admin|master-data)\.html(?:[?#].*)?$/.test(next)) {
      location.replace(next);
      return;
    }
    $("#authCard").hidden = true;
    $$(".page,.bottom-nav").forEach((element) => element.hidden = false);
    $("#accountEmail").textContent = session.user.email || "—";
    $("#accountName").textContent = profile.display_name || "ผู้ใช้งาน BOY";
    updateSyncStatus();
    try {
      if (navigator.onLine) {
        try { await loadMaster(); }
        catch (error) {
          if (!isNetworkError(error)) throw error;
          await loadLegacyMaster();
          toast(`ใช้ข้อมูล${branchApp.name}จากระบบสำรอง`);
        }
      }
      else if (!loadMasterCache()) throw new Error("ยังไม่มีข้อมูลร้านที่เก็บไว้ในเครื่อง กรุณาเชื่อมต่ออินเทอร์เน็ตก่อน");
      const sent = await flushOutbox();
      if (sent.master) await loadMaster();
      await loadDraftForDate();
      await loadExpenseHistory();
      updateSyncStatus();
    } catch (error) { setConnection("เชื่อมต่อไม่สำเร็จ", "error"); toast(error.message); }
  }

  async function enterLocalApp() {
    const session = window.BOY_LOCAL_ACCESS?.session();
    if (!session) return false;
    state.localAccess = true;
    state.session = session;
    state.profile = readCache(profileCacheKey()) || { display_name: "Chotthanate", company_role: "admin" };
    document.body.classList.remove("auth-mode");
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^(tawana|bigc|bigc-order|burger|dashboard|water-pos-admin|master-data)\.html(?:[?#].*)?$/.test(next)) { location.replace(next); return true; }
    $("#authCard").hidden = true;
    $$(".page,.bottom-nav").forEach((element) => element.hidden = false);
    $("#accountEmail").textContent = session.user.email || "—";
    $("#accountName").textContent = state.profile.display_name || "ผู้ดูแล BOY";
    const hadCache = loadMasterCache();
    try { branchApp.legacyEnabled ? await loadLegacyMaster() : await loadMaster(); }
    catch (error) {
      if (!hadCache) toast(`โหลดรายการ${branchApp.name}ไม่สำเร็จ: ${error.message}`);
      else toast("กำลังใช้รายการที่บันทึกไว้ในเครื่อง");
    }
    if (state.branch) { await flushOutbox(); await loadDraftForDate(); await loadExpenseHistory(); }
    updateSyncStatus();
    return true;
  }

  async function init() {
    applyBranchIdentity();
    if (branchApp.branchCode === "BURGER" && "serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("burger-sw.js").catch(() => {});
    $("#expenseDate").value = today();
    $("#dashboardMonth").value = monthNow();
    state.lines = [newLine()];
    renderLines();
    if (!configured) {
      document.body.classList.add("auth-mode");
      setConnection("รอตั้งค่า BOY Central", "error");
      $("#authCard").hidden = false;
      $("#loginForm").innerHTML = '<div class="empty-state">ยังไม่ได้เชื่อม Supabase BOY Central</div>';
      $$(".page,.bottom-nav").forEach((element) => element.hidden = true);
      return;
    }
    const { data } = await client.auth.getSession();
    if (data.session) await enterApp(data.session);
    else if (window.BOY_LOCAL_ACCESS?.hasAccess()) await enterLocalApp();
    else { document.body.classList.add("auth-mode"); $("#authCard").hidden = false; $$(".page,.bottom-nav").forEach((element) => element.hidden = true); setConnection("กรุณาเข้าสู่ระบบ"); }
  }

  $$(".bottom-nav button").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.target)));
  $("#storeButton").addEventListener("click", () => $("#storeDialog").showModal());
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
  $("#addExpenseButton").addEventListener("click", () => { state.lines.forEach((line) => line.expanded = false); state.lines.push(newLine()); renderLines(); scheduleDraftSave(); });
  $("#expenseLines").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    if (["select-expense", "use-custom-expense"].includes(button.dataset.action)) { applyExpenseChoice(button); return; }
    const card = button.closest(".expense-card"); const line = state.lines.find((row) => row.id === card.dataset.lineId); if (!line) return;
    if (button.dataset.action === "toggle-line") { state.lines.forEach((row) => row.expanded = row.id === line.id ? !row.expanded : false); renderLines(); }
    if (button.dataset.action === "remove-line" && confirm("ลบรายการนี้ใช่ไหม")) { state.lines = state.lines.filter((row) => row.id !== line.id); if (!state.lines.length) state.lines.push(newLine()); renderLines(); scheduleDraftSave(); }
  });
  $("#expenseLines").addEventListener("focusin", (event) => {
    if (event.target.dataset.field !== "expense_search") return;
    const card = event.target.closest(".expense-card");
    closeExpensePickers(card);
    renderExpenseOptions(card, event.target.value);
  });
  $("#expenseLines").addEventListener("change", (event) => { const field = event.target.dataset.field; if (field) updateLine(event.target.closest(".expense-card"), field, event.target.value); });
  $("#expenseLines").addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    const card = event.target.closest(".expense-card");
    const line = card && state.lines.find((row) => row.id === card.dataset.lineId);
    if (!field || !line || event.target.matches("select")) return;
    if (field === "expense_search") {
      const hadKnownSelection = Boolean(line.source_expense_item_id || line.item_id || line.expense_item_id);
      line.expense_search = event.target.value;
      line.description = event.target.value.trim();
      line.expense_item_id = "";
      line.source_expense_item_id = "";
      line.item_id = "";
      line.unit_id = "";
      if (hadKnownSelection) { line.category_id = ""; line.supplier_name = ""; }
      renderExpenseOptions(card, event.target.value);
      scheduleDraftSave();
      return;
    }
    line[field] = ["quantity", "line_total", "conversion_to_base"].includes(field) ? Number(event.target.value) : event.target.value;
    scheduleDraftSave();
  });
  document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".expense-picker")) closeExpensePickers(); });
  $("#expenseDate").addEventListener("change", async () => { await loadDraftForDate(); await loadExpenseHistory(); });
  $("#expensePaymentMethod").addEventListener("change", scheduleDraftSave);
  $("#reviewExpenseButton").addEventListener("click", openReview);
  $("#confirmExpenseButton").addEventListener("click", submitExpense);
  $("#stockSearch").addEventListener("input", renderStock);
  $("#refreshStockButton").addEventListener("click", loadStock);
  $("#dashboardMonth").addEventListener("change", loadDashboard);
  $("#masterSearch").addEventListener("input", renderMasterList);
  $$("[data-master-tab]").forEach((button) => button.addEventListener("click", () => {
    state.masterTab = button.dataset.masterTab;
    $$("[data-master-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
    renderMasterList();
  }));
  $("#masterList").addEventListener("click", (event) => { const row = event.target.closest("[data-master-id]"); if (row) openMaster(row.dataset.masterId, row.dataset.masterKind); });
  $("#addMasterButton").addEventListener("click", () => openMaster(null, state.masterTab === "items" ? "item" : "expense_item"));
  $("#accountQuickButton").addEventListener("click", () => setPage("account"));
  $("#masterStock").addEventListener("change", syncMasterPurchaseFields);
  $("#masterUnit").addEventListener("change", () => refreshMasterPurchaseUnits());
  $("#masterPurchaseUnit").addEventListener("change", () => refreshMasterPurchaseUnits($("#masterPurchaseUnit").value));
  $("#masterConversion").addEventListener("input", syncMasterPurchaseFields);
  $("#masterMainCategory").addEventListener("change", () => refreshMasterCategories($("#masterMainCategory").value));
  $("#masterSupplierChoices").addEventListener("change", () => refreshPreferredSupplier());
  $("#masterRequiresUnit").addEventListener("change", () => { if ($("#masterRequiresUnit").checked) $("#masterRequiresQuantity").checked = true; });
  $("#masterRequiresQuantity").addEventListener("change", () => { if (!$("#masterRequiresQuantity").checked) $("#masterRequiresUnit").checked = false; });
  $("#masterForm").addEventListener("submit", saveMaster);
  $("#logoutButton").addEventListener("click", async () => { window.BOY_LOCAL_ACCESS?.clear(); await client.auth.signOut(); location.reload(); });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#loginPassword"); const button = $("#loginButton"); const pin = input.value.trim();
    $("#loginError").textContent = "";
    if (!/^\d{6}$/.test(pin)) { $("#loginError").textContent = "กรุณาใส่รหัส 6 หลัก"; input.focus(); return; }
    button.disabled = true; button.textContent = "กำลังตรวจรหัส";
    const localPinConfigured = window.BOY_LOCAL_ACCESS?.configured();
    const localPinValid = localPinConfigured ? await window.BOY_LOCAL_ACCESS.verifyPin(pin) : false;
    if (localPinConfigured && !localPinValid) {
      button.disabled = false; button.textContent = "เข้าใช้งาน"; input.value = "";
      $("#loginError").textContent = "รหัสไม่ถูกต้อง ลองอีกครั้ง"; input.focus(); return;
    }
    const { data, error } = await client.auth.signInWithPassword({ email: config.ownerLoginEmail, password: pin });
    button.disabled = false; button.textContent = "เข้าใช้งาน";
    if (error) {
      if (localPinValid) { await enterLocalApp(); return; }
      input.value = "";
      const invalidPin = error.status === 400 || /invalid login credentials/i.test(error.message || "");
      $("#loginError").textContent = invalidPin ? "รหัสไม่ถูกต้อง ลองอีกครั้ง" : "ระบบออนไลน์ยังไม่พร้อม กรุณาลองใหม่ภายหลัง";
      input.focus(); return;
    }
    if (!localPinValid) await window.BOY_LOCAL_ACCESS?.verifyPin(pin);
    await enterApp(data.session);
  });
  window.addEventListener("offline", updateSyncStatus);
  window.addEventListener("online", async () => {
    const sent = await flushOutbox({ notify: true });
    if (sent.master) await loadMaster();
    if (sent.expense || sent.expense_legacy) await loadExpenseHistory();
  });
  init();
})();

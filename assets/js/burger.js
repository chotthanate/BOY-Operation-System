(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.BOY_CENTRAL_CONFIG || {};
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
  const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 });
  const state = { session: null, profile: null, branch: null, items: [], units: [], itemUnits: [], categories: [], expenseItems: [], suppliers: [], itemSuppliers: [], stock: [], lines: [], masterTab: "items", draftTimer: null };

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const optionHtml = (rows, selected, label = "name") => rows.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row[label])}</option>`).join("");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const monthNow = () => today().slice(0, 7);
  const newLine = () => ({ id: crypto.randomUUID(), item_id: "", expense_item_id: "", source_expense_item_id: "", expense_search: "", category_id: "", description: "", quantity: 0, unit_id: "", line_total: 0, supplier_name: "", note: "", expanded: true });

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

  function setPage(page) {
    $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.target === page));
    if (page === "stock" && state.session) loadStock();
    if (page === "dashboard" && state.session) loadDashboard();
    if (page === "settings" && state.session) renderMasterList();
  }

  const draftKey = () => `boy-burger-draft:${state.session?.user?.id || "guest"}:${$("#expenseDate").value || today()}`;

  function draftPayload() {
    return { version: 1, transaction_date: $("#expenseDate").value, lines: state.lines, saved_at: new Date().toISOString() };
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
    const { data } = await client.schema("boy_central").from("expense_drafts")
      .select("payload,updated_at").eq("branch_id", state.branch.id).eq("user_id", state.session.user.id)
      .eq("transaction_date", $("#expenseDate").value).maybeSingle();
    if (data?.payload && (!payload?.saved_at || new Date(data.updated_at) > new Date(payload.saved_at))) payload = data.payload;
    state.lines = Array.isArray(payload?.lines) && payload.lines.length ? payload.lines.map((line) => ({ ...newLine(), ...line, expanded: false })) : [newLine()];
    state.lines[0].expanded = true;
    renderLines();
    setDraftStatus(payload ? "เปิดร่างล่าสุดแล้ว" : "พร้อมบันทึกร่าง", payload ? "saved" : "");
  }

  async function clearDraft() {
    localStorage.removeItem(draftKey());
    if (state.session && state.branch) await client.schema("boy_central").from("expense_drafts").delete()
      .eq("branch_id", state.branch.id).eq("user_id", state.session.user.id).eq("transaction_date", $("#expenseDate").value);
  }

  function itemById(id) { return state.items.find((item) => item.id === id); }
  function unitById(id) { return state.units.find((unit) => unit.id === id); }
  function expenseById(id) { return state.expenseItems.find((expense) => expense.id === id); }
  function expenseBySearch(value) {
    const query = String(value || "").trim().toLocaleLowerCase("th");
    return state.expenseItems.find((expense) => expense.name.trim().toLocaleLowerCase("th") === query || expense.code.toLocaleLowerCase("th") === query);
  }
  function mainCategories() {
    return state.categories.filter((category) => category.category_type === "item" && !category.parent_id && /^CAT-\d+$/.test(category.code));
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
    return state.itemUnits.filter((row) => row.item_id === itemId && row.active !== false && (row.is_base_unit || row.allow_purchase));
  }
  function defaultPurchaseUnit(itemId) {
    return itemUnitChoices(itemId).find((row) => !row.is_base_unit && row.allow_purchase)
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
        requirements.unit ? `<label>หน่วย<select data-field="unit_id"><option value="">เลือก</option>${optionHtml(unitChoices, line.unit_id)}</select></label>` : "",
        `<label>ยอดรวม<input data-field="line_total" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(line.line_total)}"></label>`
      ].filter(Boolean);
      const conversion = Number(unitLink?.conversion_to_base || 1);
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
    const rows = state.expenseItems.filter((row) => {
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
      if (linkedItem?.track_stock && !(Number(line.quantity) > 0)) line.quantity = 1;
      if (previousItem?.id !== linkedItem?.id) line.supplier_name = "";
      const choices = supplierChoices(linkedItem?.id);
      if (choices.length === 1) line.supplier_name = choices[0].name;
    } else {
      line.item_id = "";
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
    line[field] = ["quantity", "line_total"].includes(field) ? Number(value) : value;
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
    });
    return errors;
  }

  function openReview() {
    const errors = validateExpense();
    $("#reviewSummary").textContent = `${state.lines.length} รายการ`;
    $("#reviewErrors").innerHTML = errors.map((error) => `<div>• ${escapeHtml(error)}</div>`).join("");
    $("#confirmExpenseButton").disabled = errors.length > 0 || !state.session;
    $("#reviewDialog").showModal();
  }

  async function submitExpense() {
    const button = $("#confirmExpenseButton");
    button.disabled = true;
    button.textContent = "กำลังบันทึก";
    const payload = {
      branch_id: state.branch.id,
      transaction_date: $("#expenseDate").value,
      source_system: "boy_burger_web",
      idempotency_key: crypto.randomUUID(),
      lines: state.lines.map((line) => {
        const supplier = state.suppliers.find((row) => row.name.trim().toLocaleLowerCase("th") === line.supplier_name.trim().toLocaleLowerCase("th"));
        const requirements = lineRequirements(line);
        return { item_id: line.item_id || null, expense_item_id: line.expense_item_id || null, category_id: lineCategoryId(line) || null, supplier_id: supplier?.id || null, supplier_name: supplier ? null : line.supplier_name || null, description: line.description, quantity: requirements.quantity ? line.quantity : 0, unit_id: requirements.unit ? line.unit_id || null : null, line_total: line.line_total, note: line.note || null };
      })
    };
    const { data, error } = await client.schema("boy_central").rpc("record_expense_v2", { payload });
    button.textContent = "บันทึก";
    if (error) { button.disabled = false; toast(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    $("#reviewDialog").close();
    await clearDraft();
    state.lines = [newLine()];
    renderLines();
    loadExpenseHistory();
    toast(`บันทึก ${data.line_count} รายการแล้ว`);
  }

  async function loadExpenseHistory() {
    if (!state.branch) return;
    const { data, error } = await client.schema("boy_central").from("transactions").select("id,transaction_date,total_amount,status,transaction_lines(description)").eq("branch_id", state.branch.id).eq("transaction_type", "expense").eq("transaction_date", $("#expenseDate").value).order("occurred_at", { ascending: false }).limit(30);
    if (error) { $("#expenseHistory").innerHTML = '<div class="empty-state">โหลดประวัติไม่สำเร็จ</div>'; return; }
    $("#expenseHistory").innerHTML = (data || []).length ? data.map((row) => `<article class="history-row"><span><strong>${escapeHtml(row.transaction_lines?.[0]?.description || "รายจ่าย")}</strong><small>${escapeHtml(row.transaction_date)} · ${escapeHtml(row.status)}</small></span><span class="history-amount">${money.format(row.total_amount || 0)}</span></article>`).join("") : '<div class="empty-state">ยังไม่มีรายจ่าย</div>';
  }

  async function loadMaster() {
    const [branchResult, unitsResult, categoriesResult] = await Promise.all([
      client.schema("boy_central").from("branches").select("id,company_id,code,name").eq("code", "BURGER").eq("active", true).single(),
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
      client.schema("boy_central").from("branch_items").select("item_id").eq("branch_id", state.branch.id).eq("active", true),
      client.schema("boy_central").from("branch_expense_items").select("expense_item_id,sort_order").eq("branch_id", state.branch.id).eq("active", true).order("sort_order"),
      client.schema("boy_central").from("branch_suppliers").select("supplier_id,is_preferred").eq("branch_id", state.branch.id).eq("active", true).order("is_preferred", { ascending: false }),
      client.schema("boy_central").from("branch_item_suppliers").select("item_id,supplier_id,active,is_primary").eq("branch_id", state.branch.id).eq("active", true).order("is_primary", { ascending: false })
    ]);
    if (itemLinksResult.error) throw itemLinksResult.error;
    if (expenseLinksResult.error) throw expenseLinksResult.error;

    const itemIds = (itemLinksResult.data || []).map((row) => row.item_id);
    const expenseIds = (expenseLinksResult.data || []).map((row) => row.expense_item_id);
    const supplierIds = (supplierLinksResult.data || []).map((row) => row.supplier_id);
    const [itemsResult, expenseResult, supplierResult, itemUnitsResult] = await Promise.all([
      itemIds.length
        ? client.schema("boy_central").from("items").select("id,name,code,base_unit_id,category_id,track_stock,active").in("id", itemIds).eq("active", true).order("name")
        : Promise.resolve({ data: [], error: null }),
      expenseIds.length
        ? client.schema("boy_central").from("expense_items").select("id,name,code,category_id,item_id,affects_stock,requires_quantity,requires_unit,active").in("id", expenseIds).eq("active", true)
        : Promise.resolve({ data: [], error: null }),
      !supplierLinksResult.error && supplierIds.length
        ? client.schema("boy_central").from("suppliers").select("id,name,code").in("id", supplierIds).eq("active", true)
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? client.schema("boy_central").from("item_units").select("item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,active").in("item_id", itemIds).eq("active", true).order("is_base_unit", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (expenseResult.error) throw expenseResult.error;
    if (itemUnitsResult.error) throw itemUnitsResult.error;

    const expenseOrder = new Map((expenseLinksResult.data || []).map((row, index) => [row.expense_item_id, [row.sort_order ?? 0, index]]));
    const supplierOrder = new Map((supplierLinksResult.data || []).map((row, index) => [row.supplier_id, [row.is_preferred ? 0 : 1, index]]));
    state.items = (itemsResult.data || []).sort((a, b) => a.name.localeCompare(b.name, "th"));
    state.itemUnits = itemUnitsResult.data || [];
    state.expenseItems = (expenseResult.data || []).sort((a, b) => {
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
    renderLines();
    renderMasterList();
    setConnection(`เชื่อมต่อแล้ว · ${state.items.length} สินค้า`, "online");
  }

  async function loadStock() {
    if (!state.branch) return;
    $("#stockList").innerHTML = '<div class="empty-state">กำลังโหลด</div>';
    const [centralResult, posResult] = await Promise.all([
      client.schema("boy_central").from("v_stock_on_hand").select("item_id,item_code,item_name,base_unit_name,quantity_on_hand,average_unit_cost,inventory_value").eq("branch_id", state.branch.id).order("item_name"),
      client.schema("boy_central").rpc("get_burger_pos_stock")
    ]);
    if (centralResult.error) { $("#stockList").innerHTML = `<div class="empty-state">${escapeHtml(centralResult.error.message)}</div>`; return; }
    const stockByItem = new Map(state.items.filter((item) => item.track_stock).map((item) => [item.id, {
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      base_unit_name: unitById(item.base_unit_id)?.name || "",
      quantity_on_hand: 0,
      average_unit_cost: 0,
      inventory_value: 0
    }]));
    (centralResult.data || []).forEach((row) => stockByItem.set(row.item_id, row));
    state.stock = [...stockByItem.values()];
    (posResult.data || []).forEach((pos) => {
      const match = state.stock.find((row) => row.item_name.trim().toLocaleLowerCase("th") === pos.item_name.trim().toLocaleLowerCase("th"));
      if (match) { match.quantity_on_hand = pos.quantity_on_hand; match.base_unit_name = pos.unit_name; match.stock_source = "Burger POS"; }
      else state.stock.push({ item_id: `pos-${pos.legacy_ingredient_id}`, item_code: "POS", item_name: pos.item_name, base_unit_name: pos.unit_name, quantity_on_hand: pos.quantity_on_hand, average_unit_cost: 0, inventory_value: 0, stock_source: "Burger POS" });
    });
    renderStock();
  }

  function renderStock() {
    const query = $("#stockSearch").value.trim().toLocaleLowerCase("th");
    const rows = state.stock.filter((row) => `${row.item_code} ${row.item_name}`.toLocaleLowerCase("th").includes(query));
    $("#stockList").innerHTML = rows.length ? rows.map((row) => `<article class="stock-row"><span><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.item_code || "")} · ${row.stock_source ? escapeHtml(row.stock_source) : `ต้นทุน ${money.format(row.average_unit_cost || 0)}`}</small></span><span class="stock-qty"><strong>${number.format(row.quantity_on_hand || 0)} ${escapeHtml(row.base_unit_name || "")}</strong><span class="stock-value">${money.format(row.inventory_value || 0)}</span></span></article>`).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  async function loadDashboard() {
    if (!state.branch) return;
    const period = `${$("#dashboardMonth").value}-01`;
    const [year, month] = $("#dashboardMonth").value.split("-").map(Number);
    const nextPeriod = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const [summaryResult, transactionsResult, posResult] = await Promise.all([
      client.schema("boy_central").from("v_monthly_branch_summary").select("income,expense,net_profit").eq("branch_id", state.branch.id).eq("month_start", period).maybeSingle(),
      client.schema("boy_central").from("transactions").select("source_system,transaction_type,total_amount,status").eq("branch_id", state.branch.id).gte("transaction_date", period).lt("transaction_date", nextPeriod),
      client.schema("boy_central").rpc("get_burger_pos_monthly_sales", { month_start: period })
    ]);
    if (summaryResult.error || transactionsResult.error) { toast(summaryResult.error?.message || transactionsResult.error?.message); return; }
    const summary = summaryResult.data || { income: 0, expense: 0, net_profit: 0 };
    const transactions = transactionsResult.data || [];
    const hasShadowSales = transactions.some((row) => row.source_system === "burger_pos" && ["income","sale"].includes(row.transaction_type));
    const posSales = hasShadowSales ? 0 : Number(posResult.data?.sales || 0);
    const posOrders = hasShadowSales ? 0 : Number(posResult.data?.orders || 0);
    const income = Number(summary.income || 0) + posSales;
    const net = income - Number(summary.expense || 0);
    $("#metricGrid").innerHTML = `<article class="metric accent"><small>รายรับ</small><strong>${money.format(income)}</strong></article><article class="metric"><small>รายจ่าย</small><strong>${money.format(summary.expense || 0)}</strong></article><article class="metric"><small>คงเหลือก่อนต้นทุน</small><strong>${money.format(net)}</strong></article><article class="metric"><small>จำนวนธุรกรรม</small><strong>${number.format(transactions.length + posOrders)}</strong></article>`;
    const channelMap = new Map();
    transactions.filter((row) => row.status === "confirmed" && ["income", "sale", "settlement"].includes(row.transaction_type)).forEach((row) => channelMap.set(row.source_system, (channelMap.get(row.source_system) || 0) + Number(row.total_amount || 0)));
    if (posSales > 0) channelMap.set("Burger POS", posSales);
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
      <span class="master-badges"><small>${state.masterTab === "items" ? (row.track_stock ? "ติดตามสต็อก" : "ไม่ติดตามสต็อก") : (row.affects_stock ? "เพิ่มสต็อก" : "รายจ่ายทั่วไป")}</small><b>แก้ไข</b></span>
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

  function refreshMasterPurchaseUnits(selected = $("#masterPurchaseUnit").value) {
    const baseUnitId = $("#masterUnit").value;
    const nextSelected = selected === baseUnitId ? "" : selected;
    $("#masterPurchaseUnit").innerHTML = `<option value="">ใช้หน่วยฐาน</option>${optionHtml(state.units.filter((unit) => unit.id !== baseUnitId), nextSelected)}`;
    syncMasterPurchaseFields();
  }

  function openMaster(id, kind) {
    const row = (kind === "item" ? state.items : state.expenseItems).find((entry) => entry.id === id) || {};
    const purchaseUnit = kind === "item" ? state.itemUnits.find((entry) => entry.item_id === row.id && entry.allow_purchase && !entry.is_base_unit && entry.active !== false) : null;
    $("#masterId").value = row.id || "";
    $("#masterKind").value = kind;
    $("#masterName").value = row.name || "";
    $("#masterDialogTitle").textContent = `${row.id ? "แก้ไข" : "เพิ่ม"}${kind === "item" ? "สินค้า / วัตถุดิบ" : "รายการรายจ่าย"}`;
    $("#masterUnitField").hidden = kind !== "item";
    $("#masterUnit").innerHTML = optionHtml(state.units, row.base_unit_id);
    refreshMasterPurchaseUnits(purchaseUnit?.unit_id || "");
    $("#masterConversion").value = purchaseUnit?.conversion_to_base || 1;
    $("#masterCategory").innerHTML = optionHtml(kind === "item" ? state.categories.filter((category) => category.category_type === "item" && category.parent_id) : mainCategories(), kind === "item" ? row.category_id : mainCategoryId(row.category_id));
    $("#masterStock").checked = kind === "item" ? Boolean(row.track_stock) : Boolean(row.affects_stock);
    $("#masterStockLabel").textContent = kind === "item" ? "ติดตามสต็อก" : "รายการนี้เพิ่มสต็อก";
    $("#masterExpenseFields").hidden = kind !== "expense_item";
    $("#masterRequiresQuantity").checked = kind === "expense_item" && Boolean(row.requires_quantity);
    $("#masterRequiresUnit").checked = kind === "expense_item" && Boolean(row.requires_unit);
    $("#masterActive").checked = row.active !== false;
    syncMasterPurchaseFields();
    $("#masterDialog").showModal();
    $("#masterDialog").focus({ preventScroll: true });
  }

  async function saveMaster(event) {
    event.preventDefault();
    if (state.profile?.company_role !== "admin") { toast("เฉพาะ Admin เท่านั้นที่แก้รายการตั้งต้นได้"); return; }
    const kind = $("#masterKind").value;
    const payload = { kind, id: $("#masterId").value, name: $("#masterName").value.trim(), category_id: $("#masterCategory").value, active: $("#masterActive").checked };
    if (kind === "item") {
      payload.base_unit_id = $("#masterUnit").value;
      payload.track_stock = $("#masterStock").checked;
      payload.purchase_unit_id = $("#masterPurchaseUnit").value || null;
      payload.conversion_to_base = Number($("#masterConversion").value) || 1;
    } else {
      payload.affects_stock = $("#masterStock").checked;
      payload.requires_quantity = $("#masterRequiresQuantity").checked;
      payload.requires_unit = $("#masterRequiresUnit").checked;
    }
    const { error } = await client.schema("boy_central").rpc("admin_update_burger_master", { payload });
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
    state.session = session;
    setConnection("กำลังตรวจสิทธิ์");
    let profile;
    try {
      profile = await ensureProfile(session);
    } catch (error) {
      state.session = null;
      await client.auth.signOut();
      $("#authCard").hidden = false;
      $$(".page,.bottom-nav").forEach((element) => element.hidden = true);
      $("#loginError").textContent = error.message;
      setConnection("ไม่มีสิทธิ์", "error");
      return;
    }
    state.profile = profile;
    const next = new URLSearchParams(location.search).get("next");
    if (next && /^(tawana|bigc|bigc-order|dashboard)\.html(?:[?#].*)?$/.test(next)) {
      location.replace(next);
      return;
    }
    $("#authCard").hidden = true;
    $$(".page,.bottom-nav").forEach((element) => element.hidden = false);
    $("#accountEmail").textContent = session.user.email || "—";
    $("#accountName").textContent = profile.display_name || "ผู้ใช้งาน BOY";
    setConnection("เชื่อมต่อแล้ว", "online");
    try { await loadMaster(); await loadDraftForDate(); await loadExpenseHistory(); } catch (error) { setConnection("เชื่อมต่อไม่สำเร็จ", "error"); toast(error.message); }
  }

  async function requestMagicLink() {
    const email = $("#loginEmail").value.trim();
    const button = $("#magicLinkButton");
    $("#loginError").textContent = "";
    if (!email || !$("#loginEmail").checkValidity()) {
      $("#loginError").textContent = "กรุณากรอกอีเมลให้ถูกต้อง";
      return;
    }
    button.disabled = true;
    button.textContent = "กำลังส่ง";
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}${location.pathname}` }
    });
    button.disabled = false;
    button.textContent = "ส่งลิงก์เข้าอีเมล";
    $("#loginError").textContent = error ? error.message : "ส่งลิงก์แล้ว กรุณาตรวจอีเมล";
  }

  async function init() {
    $("#expenseDate").value = today();
    $("#dashboardMonth").value = monthNow();
    state.lines = [newLine()];
    renderLines();
    if (!configured) {
      setConnection("รอตั้งค่า BOY Central", "error");
      $("#authCard").hidden = false;
      $("#loginForm").innerHTML = '<div class="empty-state">ยังไม่ได้เชื่อม Supabase BOY Central</div>';
      $$(".page,.bottom-nav").forEach((element) => element.hidden = true);
      return;
    }
    const { data } = await client.auth.getSession();
    if (data.session) await enterApp(data.session);
    else { $("#authCard").hidden = false; $$(".page,.bottom-nav").forEach((element) => element.hidden = true); setConnection("กรุณาเข้าสู่ระบบ"); }
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
    line[field] = ["quantity", "line_total"].includes(field) ? Number(event.target.value) : event.target.value;
    scheduleDraftSave();
  });
  document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".expense-picker")) closeExpensePickers(); });
  $("#expenseDate").addEventListener("change", async () => { await loadDraftForDate(); await loadExpenseHistory(); });
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
  $("#masterStock").addEventListener("change", syncMasterPurchaseFields);
  $("#masterUnit").addEventListener("change", () => refreshMasterPurchaseUnits());
  $("#masterPurchaseUnit").addEventListener("change", syncMasterPurchaseFields);
  $("#masterConversion").addEventListener("input", syncMasterPurchaseFields);
  $("#masterRequiresUnit").addEventListener("change", () => { if ($("#masterRequiresUnit").checked) $("#masterRequiresQuantity").checked = true; });
  $("#masterRequiresQuantity").addEventListener("change", () => { if (!$("#masterRequiresQuantity").checked) $("#masterRequiresUnit").checked = false; });
  $("#masterForm").addEventListener("submit", saveMaster);
  $("#logoutButton").addEventListener("click", async () => { await client.auth.signOut(); location.reload(); });
  $("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); $("#loginError").textContent = ""; const { data, error } = await client.auth.signInWithPassword({ email: $("#loginEmail").value, password: $("#loginPassword").value }); if (error) { $("#loginError").textContent = error.message; return; } await enterApp(data.session); });
  $("#magicLinkButton").addEventListener("click", requestMagicLink);
  init();
})();

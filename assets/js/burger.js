(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.BOY_CENTRAL_CONFIG || {};
  const branchApp = { branchCode: "BURGER", slug: "burger", name: "ร้านเบอร์เกอร์", mark: "BG", sourceSystem: "boy_burger_web", accent: "#ef6c4d", accentSoft: "#fff0e9", ...(window.BOY_BRANCH_CONFIG || {}) };
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
  const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 });
  const state = { session: null, profile: null, localAccess: false, catalogSource: "", branch: null, branchItems: [], items: [], units: [], itemUnits: [], categories: [], expenseItems: [], suppliers: [], itemSuppliers: [], stock: [], stockCachedAt: "", menus: [], menuMappings: [], recipes: [], recipeDraft: [], lines: [], reimbursements: [], masterFilter: "all", stockGroupMembers: new Map(), stockTrackingDraft: new Map(), draftTimer: null, syncing: false };

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
    const dashboardLink = document.getElementById("dashboardNavLink");
    if (dashboardLink) dashboardLink.href = `branch-dashboard.html?branch=${encodeURIComponent(branchApp.branchCode)}`;
    if (branchApp.branchCode === "GRILL") document.body.classList.add("grill-branch");
  }

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const optionHtml = (rows, selected, label = "name") => rows.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row[label])}</option>`).join("");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const monthNow = () => today().slice(0, 7);
  const newLine = () => ({ id: crypto.randomUUID(), item_id: "", expense_item_id: "", source_expense_item_id: "", expense_search: "", category_id: "", subcategory_id: "", description: "", quantity: 0, unit_id: "", conversion_to_base: 1, conversion_overridden: false, line_total: 0, supplier_name: "", note: "", expanded: true });

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
  const stockCacheKey = () => `boy-${branchApp.slug}-stock:${state.branch?.id || "unknown"}`;
  const lastSyncKey = () => `boy-${branchApp.slug}-last-sync:${state.session?.user?.id || "guest"}`;
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
    if (state.localAccess) { setConnection(count ? `โหมดสำรอง · รอส่ง ${count}` : "โหมดสำรองในเครื่อง", "pending"); renderSyncCenter(); return; }
    if (!navigator.onLine) setConnection(count ? `ออฟไลน์ · รอส่ง ${count}` : "ออฟไลน์", "pending");
    else if (count) setConnection(`รอส่ง ${count} รายการ`, "pending");
    else setConnection(`เชื่อมต่อแล้ว · ${state.items.filter((row) => row.active !== false && row.branch_active !== false).length} สินค้า`, "online");
    renderSyncCenter();
  }

  function queueTypeLabel(type) {
    return ({ expense: "รายจ่าย", expense_legacy: "รายจ่าย", master: "ข้อมูลสินค้า" })[type] || "ข้อมูล";
  }

  function queueOperationLabel(row) {
    if (["expense", "expense_legacy"].includes(row.type)) return "บันทึกรายจ่าย";
    if (row.type !== "master") return queueTypeLabel(row.type);
    const payload = row.payload || {};
    const noun = payload.kind === "expense_item" ? "รายการค่าใช้จ่าย" : "สินค้า / วัตถุดิบ";
    if (payload.active === false) return `ปิดใช้งาน${noun}`;
    return `${payload.id ? "อัปเดต" : "เพิ่ม"}${noun}`;
  }

  function queueDetails(row) {
    const payload = row.payload || {};
    const lines = payload.lines || [];
    const values = [];
    if (payload.name) values.push(["รายการ", payload.name]);
    if (payload.id || payload.code) values.push(["รหัส", payload.code || payload.id]);
    if (lines.length) values.push(["จำนวนบรรทัด", `${lines.length} รายการ`]);
    if (payload.transaction_date) values.push(["วันที่", payload.transaction_date]);
    if (payload.total_amount != null) values.push(["ยอดรวม", money.format(Number(payload.total_amount) || 0)]);
    if (payload.stock_mode) values.push(["การนับสต็อก", ({ none: "ไม่ติดตาม", self: "นับรายการนี้", group: "รวมเข้าสต็อกกลาง" })[payload.stock_mode] || payload.stock_mode]);
    if (lines.length) values.push(["รายละเอียด", lines.map((line) => line.description || line.name || "ไม่ระบุ").join(", ")]);
    return values.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><span>${escapeHtml(value)}</span></div>`).join("");
  }

  function renderSyncCenter() {
    const connection = $("#syncConnectionValue");
    if (!connection) return;
    const rows = readOutbox();
    connection.textContent = state.localAccess ? "โหมดสำรองในเครื่อง" : !navigator.onLine ? "ออฟไลน์" : state.session ? "เชื่อมต่อแล้ว" : "รอเข้าสู่ระบบ";
    $("#syncPendingValue").textContent = `${rows.length} รายการ`;
    $("#syncQueueList").innerHTML = rows.length ? rows.map((row) => {
      const time = row.queued_at ? new Date(row.queued_at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }) : "";
      const error = row.last_error ? `<small class="sync-error">${escapeHtml(row.last_error)}</small>` : `<small>${escapeHtml(time)}</small>`;
      return `<details class="sync-queue-row"><summary><span><strong>${escapeHtml(queueOperationLabel(row))}</strong>${error}</span><span>รอส่ง</span></summary><div class="sync-queue-detail">${queueDetails(row) || '<span class="muted">ไม่มีรายละเอียดเพิ่มเติม</span>'}</div></details>`;
    }).join("") : '<div class="empty-state compact-empty">ไม่มีรายการค้าง</div>';
    const syncButton = $("#syncNowButton");
    syncButton.disabled = state.syncing || !rows.length || !navigator.onLine || state.localAccess || !state.session;
    syncButton.textContent = state.syncing ? "กำลังส่ง…" : rows.length ? `ส่ง ${rows.length} รายการ` : "ส่งครบแล้ว";
    $("#reconnectButton").hidden = !state.localAccess;
    const savedAt = localStorage.getItem(lastSyncKey());
    $("#lastSyncValue").textContent = savedAt ? `ส่งล่าสุด ${new Date(savedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}` : "ยังไม่มีประวัติการส่ง";
    const usageLink = $("#supabaseUsageLink");
    usageLink.href = config.usageUrl || "https://supabase.com/dashboard";
  }

  async function loadCapacityStatus() {
    const value = $("#databaseCapacityValue");
    if (!value) return;
    const bar = $("#databaseCapacityBar");
    const note = $("#databaseCapacityNote");
    bar.className = "";
    if (!navigator.onLine || state.localAccess || !state.session) {
      value.textContent = "รอเชื่อมต่อ";
      note.textContent = state.localAccess ? "เชื่อมต่อ Supabase ใหม่เพื่อดูพื้นที่" : "ยังอ่านข้อมูลไม่ได้";
      bar.style.width = "0%";
      return;
    }
    value.textContent = "กำลังตรวจสอบ";
    try {
      const { data, error } = await client.schema("boy_central").rpc("get_system_capacity_snapshot");
      if (error) throw error;
      const usedMb = Number(data.database_bytes || 0) / 1024 / 1024;
      const limitMb = Number(data.free_limit_bytes || 0) / 1024 / 1024;
      const percent = Math.max(0, Math.min(100, Number(data.used_percent || 0)));
      value.textContent = `${percent.toFixed(1)}%`;
      note.textContent = `${usedMb.toFixed(1)} / ${limitMb.toFixed(0)} MB · ตรวจ ${new Date(data.measured_at || Date.now()).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
      bar.style.width = `${percent}%`;
      if (percent >= 85) bar.classList.add("danger"); else if (percent >= 75) bar.classList.add("warning");
    } catch (error) {
      value.textContent = "ตรวจไม่สำเร็จ";
      note.textContent = error?.message || "ลองใหม่อีกครั้ง";
      bar.style.width = "0%";
    }
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

  function normalizePaymentMethod(value) {
    return ({ "เงินสด": "cash", "บัตรเครดิต": "credit_card", "รอเบิกค่าใช้จ่าย": "reimbursement_pending" })[value] || value || "cash";
  }

  function normalizeQueuedExpensePayload(payload = {}) {
    const paymentMethod = normalizePaymentMethod(payload.payment_method || payload.payment?.method);
    const lines = (payload.lines || []).map((line) => {
      const rawItemId = line.item_id || "";
      const rawExpenseId = line.expense_item_id || "";
      const item = state.items.find((row) => row.id === rawItemId || row.code === rawItemId)
        || state.items.find((row) => row.name === line.description);
      const expense = state.expenseItems.find((row) => row.id === rawExpenseId || row.code === rawExpenseId)
        || state.expenseItems.find((row) => row.code === `EXP-${rawExpenseId}`)
        || state.expenseItems.find((row) => item && row.item_id === item.id)
        || state.expenseItems.find((row) => row.name === line.description);
      const linkedItem = item || state.items.find((row) => row.id === expense?.item_id);
      const unit = state.units.find((row) => row.id === line.unit_id || row.code === line.unit_id || row.name === line.unit_name);
      const category = state.categories.find((row) => row.id === line.category_id || row.code === line.category_id);
      const categoryId = mainCategoryId(category?.id || expense?.category_id) || category?.id || expense?.category_id || null;
      return {
        ...line,
        item_id: linkedItem?.id || null,
        expense_item_id: expense?.id || null,
        unit_id: unit?.id || null,
        category_id: categoryId
      };
    });
    const totalAmount = Number(payload.payment?.amount || payload.total_amount || lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0));
    return { ...payload, payment_method: paymentMethod, payment: { ...(payload.payment || {}), method: paymentMethod, amount: totalAmount }, lines };
  }

  function normalizeQueuedMasterPayload(payload = {}) {
    const item = state.items.find((row) => row.id === payload.id || row.code === payload.id);
    const itemFromExpenseCode = state.items.find((row) => `EXP-${row.code}` === payload.id);
    const expense = state.expenseItems.find((row) => row.id === payload.id || row.code === payload.id)
      || state.expenseItems.find((row) => item && row.item_id === item.id);
    if (payload.id && !item && !itemFromExpenseCode && !expense) {
      throw new Error(`ไม่พบรายการ ${payload.id} ในข้อมูลล่าสุด กรุณาโหลดข้อมูลใหม่`);
    }
    const resolveUnit = (value) => state.units.find((row) => row.id === value || row.code === value || row.name === value)?.id || null;
    const resolveCategory = (value) => state.categories.find((row) => row.id === value || row.code === value)?.id || null;
    const resolveItem = (value) => state.items.find((row) => row.id === value || row.code === value)?.id || null;
    const resolveSupplier = (value) => state.suppliers.find((row) => row.id === value || row.code === value || row.name === value)?.id || null;
    const resolvedTarget = resolveItem(payload.stock_target_item_id);
    return {
      ...payload,
      id: payload.kind === "item" ? (item || itemFromExpenseCode)?.id || null : expense?.id || null,
      category_id: resolveCategory(payload.category_id),
      base_unit_id: resolveUnit(payload.base_unit_id),
      purchase_unit_id: resolveUnit(payload.purchase_unit_id),
      default_issue_unit_id: resolveUnit(payload.default_issue_unit_id),
      package_unit_id: resolveUnit(payload.package_unit_id),
      stock_mode: payload.stock_mode || (resolvedTarget ? "group" : payload.track_stock ? "self" : "none"),
      stock_target_item_id: resolvedTarget,
      preferred_supplier_id: resolveSupplier(payload.preferred_supplier_id),
      supplier_ids: (payload.supplier_ids || []).map(resolveSupplier).filter(Boolean)
    };
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

  function stockCacheLabel(savedAt) {
    if (!savedAt) return "ยอดล่าสุดในเครื่อง";
    return `ยอดในเครื่อง · ${new Date(savedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}`;
  }

  function saveStockCache(rows) {
    const savedAt = new Date().toISOString();
    localStorage.setItem(stockCacheKey(), JSON.stringify({ rows, saved_at: savedAt }));
    state.stockCachedAt = savedAt;
  }

  function loadStockCache() {
    const cached = readCache(stockCacheKey());
    if (!Array.isArray(cached?.rows)) return false;
    state.stockCachedAt = cached.saved_at || "";
    const label = stockCacheLabel(state.stockCachedAt);
    state.stock = cached.rows.map((row) => ({ ...row, stock_source: label }));
    $("#stockPageSubtitle").textContent = label;
    renderStock();
    return true;
  }

  function setPage(page) {
    $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    $$(".bottom-nav button").forEach((button) => button.classList.toggle("active", button.dataset.target === page));
    if (page === "stock" && state.session) loadStock();
    if (page === "dashboard" && state.session) loadDashboard();
    if (page === "settings" && state.session) renderMasterList();
    if (page === "account" && state.session) { renderSyncCenter(); loadCapacityStatus(); }
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
    if (["expense", "expense_legacy"].includes(operation.type)) {
      return client.schema("boy_central").rpc("record_expense_v3", { payload: normalizeQueuedExpensePayload(operation.payload) });
    }
    if (operation.type === "master") {
      const payload = normalizeQueuedMasterPayload(operation.payload);
      payload.branch_code = branchApp.branchCode;
      return client.schema("boy_central").rpc("admin_update_burger_master_v3", { payload });
    }
    return { data: null, error: new Error("ไม่รู้จักประเภทรายการที่รอส่ง") };
  }

  async function flushOutbox({ notify = false } = {}) {
    const sent = { expense: 0, expense_legacy: 0, master: 0 };
    if (state.syncing || !state.session || !centralAvailable()) { updateSyncStatus(); return sent; }
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
    if (total) localStorage.setItem(lastSyncKey(), new Date().toISOString());
    if (notify && total) toast(`ส่งรายการที่ค้างแล้ว ${total} รายการ`);
    renderSyncCenter();
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
    return state.categories.filter((category) => category.category_type === "item" && !category.parent_id);
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
  function subcategoryId(categoryId) {
    const category = state.categories.find((row) => row.id === categoryId);
    if (category?.category_type === "item" && category.parent_id) return category.id;
    if (category?.code?.startsWith("EXP-CAT-")) {
      const itemCode = category.code.replace("EXP-", "");
      const mapped = state.categories.find((row) => row.category_type === "item" && row.code === itemCode);
      return mapped?.parent_id ? mapped.id : "";
    }
    return "";
  }
  function lineMainCategoryId(line, expense = expenseById(line.expense_item_id)) {
    return line.category_id || mainCategoryId(line.subcategory_id) || mainCategoryId(expense?.category_id);
  }
  function lineSubcategoryId(line, expense = expenseById(line.expense_item_id)) {
    return Object.prototype.hasOwnProperty.call(line, "subcategory_id") ? line.subcategory_id : subcategoryId(expense?.category_id);
  }
  function lineCategoryId(line, expense = expenseById(line.expense_item_id)) {
    return lineSubcategoryId(line, expense) || lineMainCategoryId(line, expense);
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
  function expenseForPurchasedItem(itemId) {
    return state.expenseItems.find((row) => String(row.purchased_item_id || row.item_id || "") === String(itemId));
  }
  function stockModeForItem(item) {
    if (!item) return "none";
    if (item.stock_target_item_id || item.stock_mode === "รวมเข้ารายการอื่น") return "group";
    if (item.track_stock || item.stock_mode === "นับเป็นรายการนี้") return "self";
    return "none";
  }
  function stockTargetChoices(excludeId = "") {
    return state.items.filter((item) => item.id !== excludeId && item.active !== false && item.branch_active !== false && stockModeForItem(item) === "self");
  }
  function stockItemForPurchasedItem(item) {
    if (!item) return null;
    if (item.stock_target_item_id) return itemById(item.stock_target_item_id) || null;
    return item.track_stock ? item : null;
  }
  function lineRequirements(line, expense = expenseById(line.expense_item_id), item = itemById(line.item_id)) {
    const stockItem = stockItemForPurchasedItem(item);
    return {
      quantity: Boolean(stockItem || expense?.requires_quantity),
      unit: Boolean(stockItem || expense?.requires_unit)
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
      const stockItem = stockItemForPurchasedItem(item);
      const expense = expenseById(line.expense_item_id);
      const categoryId = lineMainCategoryId(line, expense);
      const selectedSubcategoryId = lineSubcategoryId(line, expense);
      const unit = unitById(line.unit_id);
      const unitLink = state.itemUnits.find((row) => row.item_id === item?.id && row.unit_id === line.unit_id && row.active !== false);
      const requirements = lineRequirements(line, expense, item);
      const unitChoices = item ? itemUnitChoices(item.id).map((row) => unitById(row.unit_id)).filter(Boolean) : [...state.units];
      const expensePurchaseUnit = unitById(expense?.purchase_unit_id);
      if (expensePurchaseUnit && !unitChoices.some((row) => row.id === expensePurchaseUnit.id)) unitChoices.push(expensePurchaseUnit);
      const suppliers = supplierChoices(line.item_id);
      const perUnit = Number(line.quantity) > 0 ? Number(line.line_total) / Number(line.quantity) : 0;
      const fields = [
        requirements.quantity ? `<label>จำนวน<input data-field="quantity" type="number" min="0" step="0.001" inputmode="decimal" value="${escapeHtml(line.quantity || "")}"></label>` : "",
        requirements.unit ? `<label>หน่วยซื้อ<select data-field="unit_id"><option value="">เลือก</option>${optionHtml(unitChoices, line.unit_id)}</select></label>` : "",
        `<label>ยอดรวม<input data-field="line_total" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(line.line_total)}"></label>`
      ].filter(Boolean);
      const conversion = Number(line.conversion_to_base || unitLink?.conversion_to_base || 1);
      const stockEffect = stockItem && unit
        ? `เพิ่มสต็อก ${escapeHtml(stockItem.name)} ${number.format((Number(line.quantity) || 0) * conversion)} ${escapeHtml(unitById(stockItem.base_unit_id)?.name || "หน่วยฐาน")}`
        : "";
      return `<article class="expense-card ${line.expanded ? "expanded" : ""}" data-line-id="${line.id}">
        <button class="expense-summary" type="button" data-action="toggle-line">
          <span class="line-number">${index + 1}</span>
          <span class="summary-copy"><strong>${escapeHtml(line.description || expense?.name || item?.name || "ยังไม่ระบุรายการ")}</strong><small>${escapeHtml(categoryId ? categoryName(categoryId) : "ยังไม่เลือกหมวดหลัก")}</small></span>
          <span class="summary-amount"><strong>${money.format(Number(line.line_total) || 0)}</strong><span class="stock-tag ${stockItem ? "" : "off"}">${stockItem ? `เข้า ${escapeHtml(stockItem.name)}` : "ไม่เข้าสต็อก"}</span></span>
        </button>
        <div class="expense-detail">
          <div class="expense-picker">
            <label>รายการรายจ่าย<input class="typeable-select" data-field="expense_search" value="${escapeHtml(line.expense_search || line.description || expense?.name)}" placeholder="พิมพ์ค้นหาหรือเลือกรายการ" autocomplete="off" aria-autocomplete="list" aria-expanded="false"></label>
            <div class="expense-picker-options" role="listbox" hidden></div>
          </div>
          <div class="field-grid">
            <label>หมวดหลัก<select data-field="category_id"><option value="">เลือกหมวด</option>${optionHtml(mainCategories(), categoryId)}</select></label>
            <label>หมวดย่อย<select data-field="subcategory_id"><option value="">ไม่ระบุหมวดย่อย</option>${optionHtml(subcategories(categoryId), selectedSubcategoryId)}</select></label>
          </div>
          <div class="field-grid expense-fields fields-${fields.length}">${fields.join("")}</div>
          ${stockItem && unit ? `<div class="conversion-field ${line.conversion_overridden ? "is-editing" : ""}"><div><span>อัตราจากข้อมูลสินค้า</span><strong>1 ${escapeHtml(unit.name)} = ${escapeHtml(conversion)} ${escapeHtml(unitById(stockItem.base_unit_id)?.name || "หน่วยฐาน")} ใน ${escapeHtml(stockItem.name)}</strong><small>ใช้กับรายการซื้อครั้งนี้เท่านั้น ไม่แก้ข้อมูลสินค้า</small></div><label class="conversion-toggle"><input data-field="conversion_overridden" type="checkbox" ${line.conversion_overridden ? "checked" : ""}><span>ปรับครั้งนี้</span></label>${line.conversion_overridden ? `<input data-field="conversion_to_base" aria-label="จำนวนที่เพิ่มเข้าสต็อกครั้งนี้" type="number" min="0.000001" step="any" inputmode="decimal" value="${escapeHtml(conversion)}">` : ""}</div>` : ""}
          ${requirements.quantity ? `<div class="unit-price"><span>${stockEffect || "ราคาต่อหน่วย"}</span><strong>${money.format(perUnit)}${unit ? ` / ${escapeHtml(unit.name)}` : ""}</strong></div>` : ""}
          <div class="field-grid">
            <label>ชำระด้วย<select data-field="payment_method"><option value="cash" ${$("#expensePaymentMethod").value === "cash" ? "selected" : ""}>เงินสด</option><option value="credit_card" ${$("#expensePaymentMethod").value === "credit_card" ? "selected" : ""}>บัตรเครดิต</option><option value="reimbursement_pending" ${$("#expensePaymentMethod").value === "reimbursement_pending" ? "selected" : ""}>รอเบิก</option></select></label>
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
    const purchasedItemId = expense.purchased_item_id || expense.item_id;
    const linkedItem = purchasedItemId ? itemById(purchasedItemId) : null;
    const sourceCategoryId = linkedItem?.category_id || expense.category_id;
    line.category_id = mainCategoryId(sourceCategoryId);
    line.subcategory_id = subcategoryId(sourceCategoryId);
    if (purchasedItemId && expense.affects_stock) {
      const purchaseUnit = expense.purchase_unit_id
        ? state.itemUnits.find((row) => row.item_id === purchasedItemId && row.unit_id === expense.purchase_unit_id && row.active !== false)
        : defaultPurchaseUnit(purchasedItemId);
      line.item_id = purchasedItemId;
      line.unit_id = expense.purchase_unit_id || purchaseUnit?.unit_id || linkedItem?.base_unit_id || "";
      line.conversion_to_base = Number(expense.stock_conversion_to_base || purchaseUnit?.conversion_to_base || 1);
      line.conversion_overridden = false;
      if (stockItemForPurchasedItem(linkedItem) && !(Number(line.quantity) > 0)) line.quantity = 1;
      if (previousItem?.id !== linkedItem?.id) line.supplier_name = "";
      const choices = supplierChoices(linkedItem?.id);
      if (choices.length === 1) line.supplier_name = choices[0].name;
    } else {
      line.item_id = "";
      line.conversion_to_base = 1;
      line.conversion_overridden = false;
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
      line.category_id = "";
      line.subcategory_id = "";
      line.quantity = 0;
      line.unit_id = "";
      line.conversion_to_base = 1;
      line.conversion_overridden = false;
    }
    renderLines();
    scheduleDraftSave();
  }

  function updateLine(card, field, value) {
    const line = state.lines.find((row) => row.id === card.dataset.lineId);
    if (!line) return;
    if (field === "payment_method") {
      $("#expensePaymentMethod").value = value;
      $$('#expenseLines [data-field="payment_method"]').forEach((select) => { select.value = value; });
      scheduleDraftSave();
      return;
    }
    line[field] = ["quantity", "line_total", "conversion_to_base"].includes(field) ? Number(value) : field === "conversion_overridden" ? Boolean(value) : value;
    if (field === "unit_id" && line.item_id) {
      const link = state.itemUnits.find((row) => row.item_id === line.item_id && row.unit_id === value && row.active !== false);
      line.conversion_to_base = Number(link?.conversion_to_base || 1);
      line.conversion_overridden = false;
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
        line.conversion_overridden = false;
        line.description = String(value).trim();
      }
    }
    if (field === "category_id") {
      if (!subcategories(value).some((category) => category.id === line.subcategory_id)) line.subcategory_id = "";
      const sourceExpense = expenseById(line.source_expense_item_id);
      line.expense_item_id = sourceExpense && mainCategoryId(sourceExpense.category_id) === value ? sourceExpense.id : "";
    }
    if (field === "conversion_overridden" && !line.conversion_overridden && line.item_id) {
      const link = state.itemUnits.find((row) => row.item_id === line.item_id && row.unit_id === line.unit_id && row.active !== false);
      line.conversion_to_base = Number(link?.conversion_to_base || 1);
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
      if (!lineMainCategoryId(line)) errors.push(`รายการ ${index + 1}: เลือกหมวดหลัก`);
      if (requirements.quantity && !(Number(line.quantity) > 0)) errors.push(`รายการ ${index + 1}: ระบุจำนวน`);
      if (requirements.unit && !line.unit_id) errors.push(`รายการ ${index + 1}: เลือกหน่วย`);
      if (stockItemForPurchasedItem(item) && !(Number(line.conversion_to_base) > 0)) errors.push(`รายการ ${index + 1}: ระบุจำนวนที่เพิ่มเข้าสต็อกต่อหน่วยซื้อ`);
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
    const payload = normalizeQueuedExpensePayload({
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
    });
    let data;
    let error;
    if (!centralAvailable()) {
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
      toast("Supabase ยังไม่พร้อม เก็บรายการไว้รอส่งแล้ว");
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
    const expenseSelect = "id,name,code,category_id,item_id,affects_stock,purchase_unit_id,stock_conversion_to_base,requires_quantity,requires_unit,requires_supplier,requires_receipt,notes,active";
    const [itemsResult, expenseResult, generalExpenseResult, supplierResult, itemUnitsResult] = await Promise.all([
      itemIds.length
        ? client.schema("boy_central").from("items").select("id,name,code,item_type,base_unit_id,category_id,track_stock,stock_target_item_id,purchaseable,issueable,sellable,brand,package_size,package_unit_id,notes,active").in("id", itemIds).order("name")
        : Promise.resolve({ data: [], error: null }),
      expenseIds.length
        ? client.schema("boy_central").from("expense_items").select(expenseSelect).in("id", expenseIds)
        : Promise.resolve({ data: [], error: null }),
      client.schema("boy_central").from("expense_items").select(expenseSelect).is("item_id", null).eq("active", true).order("name"),
      !supplierLinksResult.error && supplierIds.length
        ? client.schema("boy_central").from("suppliers").select("id,name,code").in("id", supplierIds).eq("active", true)
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? client.schema("boy_central").from("item_units").select("item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active").in("item_id", itemIds).eq("active", true).order("is_base_unit", { ascending: true })
        : Promise.resolve({ data: [], error: null })
    ]);
    if (itemsResult.error) throw itemsResult.error;
    if (expenseResult.error) throw expenseResult.error;
    if (generalExpenseResult.error) throw generalExpenseResult.error;
    if (itemUnitsResult.error) throw itemUnitsResult.error;

    const expenseOrder = new Map((expenseLinksResult.data || []).map((row, index) => [row.expense_item_id, [row.sort_order ?? 0, index]]));
    const supplierOrder = new Map((supplierLinksResult.data || []).map((row, index) => [row.supplier_id, [row.is_preferred ? 0 : 1, index]]));
    const branchItemMap = new Map((itemLinksResult.data || []).map((row) => [row.item_id, row]));
    const branchExpenseMap = new Map((expenseLinksResult.data || []).map((row) => [row.expense_item_id, row]));
    state.items = (itemsResult.data || []).map((row) => ({ ...row, branch_active: branchItemMap.get(row.id)?.active !== false })).sort((a, b) => a.name.localeCompare(b.name, "th"));
    state.branchItems = itemLinksResult.data || [];
    state.itemUnits = itemUnitsResult.data || [];
    const expenseRows = [...new Map([...(expenseResult.data || []), ...(generalExpenseResult.data || [])].map((row) => [row.id, row])).values()];
    state.expenseItems = expenseRows.map((row) => ({ ...row, branch_active: branchExpenseMap.get(row.id)?.active !== false, sort_order: expenseOrder.get(row.id)?.[0] || 0 })).sort((a, b) => {
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
    const mappingResult = await client.schema("boy_central").from("pos_master_mappings")
      .select("legacy_key,source_name,menu_id").eq("branch_id", state.branch.id).eq("entity_type", "product").not("menu_id", "is", null).order("source_name");
    if (mappingResult.error) throw mappingResult.error;
    state.menuMappings = mappingResult.data || [];
    const menuIds = [...new Set(state.menuMappings.map((row) => row.menu_id).filter(Boolean))];
    if (menuIds.length) {
      const [menusResult, recipesResult] = await Promise.all([
        client.schema("boy_central").from("menus").select("id,code,name,active").in("id", menuIds).eq("active", true).order("name"),
        client.schema("boy_central").from("recipes").select("menu_id,item_id,quantity_base,active").in("menu_id", menuIds).eq("active", true)
      ]);
      if (menusResult.error) throw menusResult.error;
      if (recipesResult.error) throw recipesResult.error;
      state.menus = menusResult.data || [];
      state.recipes = recipesResult.data || [];
    } else { state.menus = []; state.recipes = []; }
    state.catalogSource = "supabase";
    renderLines();
    renderMasterList();
    saveMasterCache();
    updateSyncStatus();
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
      if (state.catalogSource !== "supabase" || !centralAvailable()) throw new Error("Supabase ยังไม่พร้อม");
      const { data, error } = await client.schema("boy_central").rpc("get_burger_reimbursements");
      if (error) throw error;
      state.reimbursements = data?.items || data || [];
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
      if (state.catalogSource !== "supabase" || !centralAvailable()) throw new Error("Supabase ยังไม่พร้อม");
      const { error } = await client.schema("boy_central").rpc("settle_burger_reimbursements", { payload: { transaction_ids: ids } });
      if (error) throw error;
      toast(`เคลียร์ยอดรอเบิกแล้ว ${ids.length} รายการ`);
      await loadReimbursements();
    } catch (error) {
      toast(`เคลียร์ยอดไม่สำเร็จ: ${error.message}`);
      updateReimbursementSelection();
    }
  }

  async function loadStock() {
    if (!state.branch) return;
    if (!centralAvailable()) {
      if (!loadStockCache()) {
        $("#stockPageSubtitle").textContent = "ยังไม่มียอดในเครื่อง";
        $("#stockList").innerHTML = '<div class="empty-state">ยังไม่มียอดสต็อกที่บันทึกไว้ในเครื่อง<br><small>เมื่อระบบกลางกลับมา เว็บจะบันทึกยอดล่าสุดให้อัตโนมัติ</small></div>';
      }
      return;
    }
    $("#stockPageSubtitle").textContent = "กำลังอัปเดตยอดล่าสุด";
    $("#stockList").innerHTML = '<div class="empty-state">กำลังโหลด</div>';
    const centralResult = await client.schema("boy_central").from("v_stock_on_hand")
      .select("item_id,item_code,item_name,base_unit_name,quantity_on_hand,average_unit_cost,inventory_value,updated_at")
      .eq("branch_id", state.branch.id).order("item_name");
    if (centralResult.error) {
      if (!loadStockCache()) {
        $("#stockPageSubtitle").textContent = "อัปเดตยอดไม่สำเร็จ";
        $("#stockList").innerHTML = '<div class="empty-state">ยังไม่มียอดสต็อกที่บันทึกไว้ในเครื่อง<br><small>ลองโหลดใหม่เมื่อระบบกลางพร้อม</small></div>';
      }
      return;
    }
    const trackedItems = state.items.filter((item) => item.track_stock && !item.stock_target_item_id && item.active !== false && item.branch_active !== false);
    const trackedIds = new Set(trackedItems.map((item) => item.id));
    const stockByItem = new Map(trackedItems.map((item) => [item.id, {
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      base_unit_name: unitById(item.base_unit_id)?.name || "",
      quantity_on_hand: 0,
      average_unit_cost: 0,
      inventory_value: 0,
      stock_source: "BOY Central"
    }]));
    (centralResult.data || []).filter((row) => trackedIds.has(row.item_id)).forEach((row) => stockByItem.set(row.item_id, { ...row, stock_source: "BOY Central" }));
    state.stock = [...stockByItem.values()];
    saveStockCache(state.stock);
    $("#stockPageSubtitle").textContent = "คงเหลือปัจจุบัน";
    renderStock();
  }

  function renderStock() {
    const query = $("#stockSearch").value.trim().toLocaleLowerCase("th");
    const rows = state.stock.filter((row) => `${row.item_code} ${row.item_name}`.toLocaleLowerCase("th").includes(query));
    $("#stockList").innerHTML = rows.length ? rows.map((row) => `<article class="stock-row"><span><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.item_code || "")} · ${row.stock_source ? escapeHtml(row.stock_source) : `ต้นทุน ${money.format(row.average_unit_cost || 0)}`}</small></span><span class="stock-row-actions"><span class="stock-qty"><strong>${number.format(row.quantity_on_hand || 0)} ${escapeHtml(row.base_unit_name || "")}</strong><span class="stock-value">${money.format(row.inventory_value || 0)}</span></span>${state.profile?.company_role === "admin" ? `<button class="stock-settings" type="button" data-stock-group="${escapeHtml(row.item_id)}" aria-label="ตั้งค่า ${escapeHtml(row.item_name)}">⋯</button>` : ""}</span></article>`).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  function canonicalRecipeItems() {
    return state.items.filter((item) => item.track_stock && !item.stock_target_item_id && item.active !== false && item.branch_active !== false);
  }

  function renderRecipeMenuList() {
    const query = $("#recipeMenuSearch").value.trim().toLocaleLowerCase("th");
    const selectedId = $("#recipeMenuId").value;
    const rows = state.menus.filter((menu) => `${menu.code || ""} ${menu.name || ""}`.toLocaleLowerCase("th").includes(query));
    $("#recipeMenuList").innerHTML = rows.length ? rows.map((menu) => {
      const count = state.recipes.filter((row) => row.menu_id === menu.id && row.active !== false).length;
      return `<button class="recipe-menu-row ${menu.id === selectedId ? "active" : ""}" type="button" data-recipe-menu="${menu.id}"><span><strong>${escapeHtml(menu.name)}</strong><small>${count ? `${count} วัตถุดิบ` : "ยังไม่มีสูตร"}</small></span><b>›</b></button>`;
    }).join("") : '<div class="empty-state compact-empty">ไม่พบเมนู</div>';
  }

  function renderRecipeLines() {
    const ingredients = canonicalRecipeItems();
    const usedIds = new Set(state.recipeDraft.map((line) => line.item_id));
    $("#recipeLines").innerHTML = state.recipeDraft.length ? state.recipeDraft.map((line, index) => {
      const item = itemById(line.item_id);
      const options = ingredients.map((row) => `<option value="${row.id}" ${row.id === line.item_id ? "selected" : ""} ${usedIds.has(row.id) && row.id !== line.item_id ? "disabled" : ""}>${escapeHtml(row.name)}</option>`).join("");
      return `<div class="recipe-line" data-recipe-line="${index}"><select data-recipe-field="item_id">${options}</select><label><input data-recipe-field="quantity" type="number" min="0.000001" step="any" inputmode="decimal" value="${escapeHtml(line.quantity)}"><span>${escapeHtml(unitById(item?.base_unit_id)?.name || "หน่วย")}</span></label><button type="button" data-remove-recipe-line="${index}" aria-label="ลบวัตถุดิบ">×</button></div>`;
    }).join("") : '<div class="empty-state compact-empty">เมนูนี้ยังไม่มีวัตถุดิบ</div>';
    $("#addRecipeLineButton").disabled = !$("#recipeMenuId").value || !ingredients.some((item) => !usedIds.has(item.id));
  }

  function selectRecipeMenu(menuId) {
    const menu = state.menus.find((row) => row.id === menuId);
    if (!menu) return;
    $("#recipeMenuId").value = menu.id;
    $("#recipeMenuName").textContent = menu.name;
    state.recipeDraft = state.recipes.filter((row) => row.menu_id === menu.id && row.active !== false)
      .map((row) => ({ item_id: row.item_id, quantity: Number(row.quantity_base || 0) }));
    $("#saveRecipeButton").disabled = false;
    renderRecipeMenuList();
    renderRecipeLines();
  }

  function openRecipeManager() {
    if (state.profile?.company_role !== "admin") { toast("เฉพาะ Admin เท่านั้นที่แก้สูตรได้"); return; }
    $("#recipeMenuSearch").value = "";
    $("#recipeMenuId").value = "";
    $("#recipeMenuName").textContent = "เลือกเมนูก่อน";
    state.recipeDraft = [];
    $("#saveRecipeButton").disabled = true;
    renderRecipeMenuList();
    renderRecipeLines();
    $("#recipeDialog").showModal();
  }

  function addRecipeLine() {
    const usedIds = new Set(state.recipeDraft.map((line) => line.item_id));
    const next = canonicalRecipeItems().find((item) => !usedIds.has(item.id));
    if (!next) return;
    state.recipeDraft.push({ item_id: next.id, quantity: 1 });
    renderRecipeLines();
  }

  async function saveRecipe(event) {
    event.preventDefault();
    const menuId = $("#recipeMenuId").value;
    if (!menuId) return;
    if (state.recipeDraft.some((line) => !line.item_id || Number(line.quantity || 0) <= 0)) { toast("กรุณากรอกจำนวนวัตถุดิบให้ถูกต้อง"); return; }
    const button = $("#saveRecipeButton");
    button.disabled = true; button.textContent = "กำลังบันทึก…";
    try {
      const { error } = await client.schema("boy_central").rpc("admin_save_branch_recipe", { payload: { branch_code: branchApp.branchCode, menu_id: menuId, lines: state.recipeDraft } });
      if (error) throw error;
      state.recipes = state.recipes.filter((row) => row.menu_id !== menuId).concat(state.recipeDraft.map((line) => ({ menu_id: menuId, item_id: line.item_id, quantity_base: Number(line.quantity), active: true })));
      renderRecipeMenuList();
      toast("บันทึกสูตรและส่งให้ POS แล้ว");
    } catch (error) { toast(`บันทึกสูตรไม่สำเร็จ: ${error.message}`); }
    finally { button.disabled = false; button.textContent = "บันทึกสูตร"; }
  }

  function stockMemberRows(targetId = "") {
    return state.items.filter((item) => item.id !== targetId && item.active !== false && item.branch_active !== false && !["EXPENSE_ITEM", "SERVICE"].includes(item.item_type));
  }

  function stockMemberConversion(item) {
    const expense = expenseForPurchasedItem(item.id);
    return Number(expense?.stock_conversion_to_base || defaultPurchaseUnit(item.id)?.conversion_to_base || 1);
  }

  function renderStockGroupMembers() {
    const targetId = $("#stockGroupId").value;
    const query = $("#stockGroupSearch").value.trim().toLocaleLowerCase("th");
    const rows = stockMemberRows(targetId).filter((item) => `${item.code || ""} ${item.name || ""}`.toLocaleLowerCase("th").includes(query));
    $("#stockGroupMembers").innerHTML = rows.length ? rows.map((item) => {
      const selected = state.stockGroupMembers.has(item.id);
      const purchaseUnit = defaultPurchaseUnit(item.id);
      return `<label class="stock-member-row ${selected ? "selected" : ""}" data-stock-member-row="${item.id}"><input type="checkbox" data-stock-member="${item.id}" ${selected ? "checked" : ""}><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code || "")} · ${escapeHtml(unitById(purchaseUnit?.unit_id)?.name || unitById(item.base_unit_id)?.name || "หน่วย")}</small></span></label>`;
    }).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  function syncStockGroupMode() {
    const mode = $('input[name="stockGroupMode"]:checked')?.value || "self";
    $("#stockGroupMemberSection").hidden = mode !== "group";
    if (mode === "group") renderStockGroupMembers();
  }

  function openStockGroup(targetId = "") {
    if (state.profile?.company_role !== "admin") { toast("เฉพาะ Admin เท่านั้นที่ตั้งค่าสต็อกได้"); return; }
    const target = itemById(targetId);
    $("#stockGroupId").value = target?.id || "";
    $("#stockGroupName").value = target?.name || "";
    $("#stockGroupTitle").textContent = target ? `ตั้งค่าสต็อก ${target.name}` : "เพิ่มรายการสต็อก";
    const usedCategoryIds = new Set(stockMemberRows(target?.id || "").map((item) => item.category_id).filter(Boolean));
    const categories = state.categories.filter((row) => row.parent_id && (usedCategoryIds.has(row.id) || row.id === target?.category_id));
    $("#stockGroupCategory").innerHTML = optionHtml(categories.length ? categories : state.categories, target?.category_id || categories[0]?.id || state.categories[0]?.id);
    $("#stockGroupUnit").innerHTML = optionHtml(state.units, target?.base_unit_id || state.units[0]?.id);
    $("#stockGroupSearch").value = "";
    state.stockGroupMembers = new Map(stockMemberRows(target?.id || "")
      .filter((item) => item.stock_target_item_id === target?.id)
      .map((item) => [item.id, stockMemberConversion(item)]));
    const mode = state.stockGroupMembers.size ? "group" : "self";
    const modeInput = $(`input[name="stockGroupMode"][value="${mode}"]`);
    if (modeInput) modeInput.checked = true;
    syncStockGroupMode();
    $("#stockGroupDialog").showModal();
    $("#stockGroupName").focus({ preventScroll: true });
  }

  async function saveStockGroup(event) {
    event.preventDefault();
    const mode = $('input[name="stockGroupMode"]:checked')?.value || "self";
    const members = mode === "group" ? [...state.stockGroupMembers.entries()].map(([itemId, conversion]) => {
      const item = itemById(itemId);
      const purchaseUnit = defaultPurchaseUnit(item.id);
      return { source_item_id: item.id, sourceItemId: item.id, purchaseUnitId: purchaseUnit?.unit_id || item.base_unit_id, conversion_to_target: Number(conversion) || 1, conversionToTarget: Number(conversion) || 1 };
    }) : [];
    if (mode === "group" && !members.length) { toast("กรุณาเลือกสินค้าอย่างน้อย 1 รายการ"); return; }
    const targetId = $("#stockGroupId").value;
    const payload = { branch_code: branchApp.branchCode, branchCode: branchApp.branchCode, target_item_id: targetId || null, targetItemId: targetId || "", name: $("#stockGroupName").value.trim(), base_unit_id: $("#stockGroupUnit").value, baseUnitId: $("#stockGroupUnit").value, category_id: $("#stockGroupCategory").value, categoryId: $("#stockGroupCategory").value, subcategoryId: $("#stockGroupCategory").value, members };
    const button = $("#stockGroupForm button[type=submit]");
    button.disabled = true; button.textContent = "กำลังบันทึก…";
    try {
      if (!centralAvailable() || state.catalogSource !== "supabase") throw new Error("Supabase ยังไม่พร้อม จึงยังบันทึกการตั้งค่าสต็อกไม่ได้");
      const { error } = await client.schema("boy_central").rpc("admin_save_stock_group", { payload });
      if (error) throw error;
      $("#stockGroupDialog").close();
      toast("บันทึกกลุ่มสต็อกแล้ว");
      loadMaster().then(loadStock).catch((loadError) => toast(`อัปเดตหน้าสต็อกไม่สำเร็จ: ${loadError.message}`));
    } catch (error) { toast(`บันทึกไม่สำเร็จ: ${error.message}`); }
    finally { button.disabled = false; button.textContent = "บันทึกสต็อก"; }
  }

  function stockTrackingRows() {
    return state.items.filter((item) => item.active !== false && item.branch_active !== false && !["EXPENSE_ITEM", "SERVICE"].includes(item.item_type));
  }

  function renderStockTrackingList() {
    const query = $("#stockTrackingSearch").value.trim().toLocaleLowerCase("th");
    const rows = stockTrackingRows().filter((item) => `${item.code || ""} ${item.name || ""}`.toLocaleLowerCase("th").includes(query));
    $("#stockTrackingList").innerHTML = rows.length ? rows.map((item) => {
      const draft = state.stockTrackingDraft.get(item.id) || { enabled: stockModeForItem(item) !== "none", mode: stockModeForItem(item) };
      const target = itemById(item.stock_target_item_id);
      const detail = draft.enabled ? (draft.mode === "group" ? `รวมเข้า ${target?.name || "สต็อกกลาง"}` : "นับเป็นรายการนี้") : "ไม่ติดตามสต็อก";
      return `<label class="stock-tracking-row ${draft.enabled ? "selected" : ""}"><input type="checkbox" data-stock-tracking="${item.id}" ${draft.enabled ? "checked" : ""}><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code || "")} · ${escapeHtml(detail)}</small></span></label>`;
    }).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  function openStockTracking() {
    if (state.profile?.company_role !== "admin") { toast("เฉพาะ Admin เท่านั้นที่ตั้งค่าสต็อกได้"); return; }
    state.stockTrackingDraft = new Map(stockTrackingRows().map((item) => [item.id, { enabled: stockModeForItem(item) !== "none", mode: stockModeForItem(item), target_item_id: item.stock_target_item_id || null, conversion: stockMemberConversion(item) }]));
    $("#stockTrackingSearch").value = "";
    renderStockTrackingList();
    $("#stockTrackingDialog").showModal();
  }

  async function saveStockTracking(event) {
    event.preventDefault();
    const changes = stockTrackingRows().flatMap((item) => {
      const originalMode = stockModeForItem(item);
      const draft = state.stockTrackingDraft.get(item.id);
      const nextMode = draft?.enabled ? (originalMode === "none" ? "self" : originalMode) : "none";
      if (nextMode === originalMode) return [];
      return [{ item_id: item.id, mode: nextMode, target_item_id: nextMode === "group" ? item.stock_target_item_id : null, conversion_to_target: draft?.conversion || 1 }];
    });
    if (!changes.length) { $("#stockTrackingDialog").close(); toast("ไม่มีรายการที่เปลี่ยนแปลง"); return; }
    const button = $("#stockTrackingForm button[type=submit]");
    button.disabled = true; button.textContent = "กำลังบันทึก…";
    try {
      if (!centralAvailable() || state.catalogSource !== "supabase") throw new Error("Supabase ยังไม่พร้อม จึงยังบันทึกการตั้งค่าสต็อกไม่ได้");
      const { error } = await client.schema("boy_central").rpc("admin_bulk_save_stock_tracking", { payload: { branch_code: branchApp.branchCode, changes } });
      if (error) throw error;
      changes.forEach((change) => {
        const item = itemById(change.item_id);
        if (!item) return;
        item.track_stock = change.mode === "self";
        item.stock_target_item_id = change.mode === "group" ? change.target_item_id : null;
        const expense = expenseForPurchasedItem(item.id);
        if (expense) expense.affects_stock = change.mode !== "none";
      });
      state.stock = state.stock.filter((row) => itemById(row.item_id)?.track_stock);
      saveMasterCache(); saveStockCache(state.stock); renderMasterList(); renderStock();
      $("#stockTrackingDialog").close();
      toast(`บันทึกแล้ว ${changes.length} รายการ`);
      loadStock().catch((loadError) => toast(`อัปเดตยอดสต็อกไม่สำเร็จ: ${loadError.message}`));
    } catch (error) { toast(`บันทึกไม่สำเร็จ: ${error.message}`); }
    finally { button.disabled = false; button.textContent = "บันทึกทั้งหมด"; }
  }

  async function loadDashboard() {
    if (!state.branch) return;
    if (!centralAvailable()) { toast("Dashboard กลางจะกลับมาเมื่อ BOY Central พร้อม"); return; }
    const period = `${$("#dashboardMonth").value}-01`;
    const [year, month] = $("#dashboardMonth").value.split("-").map(Number);
    const nextPeriod = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const [summaryResult, ordersResult] = await Promise.all([
      client.schema("boy_central").from("v_monthly_branch_summary").select("income,expense,net_profit").eq("branch_id", state.branch.id).eq("month_start", period).maybeSingle(),
      client.schema("boy_central").from("pos_orders").select("id,sales_channel,payment_method,total_amount,payment_status,pos_order_lines(item_name,quantity,line_total)").eq("branch_id", state.branch.id).gte("ordered_at", `${period}T00:00:00+07:00`).lt("ordered_at", `${nextPeriod}T00:00:00+07:00`)
    ]);
    if (summaryResult.error || ordersResult.error) { toast(summaryResult.error?.message || ordersResult.error?.message); return; }
    const summary = summaryResult.data || { income: 0, expense: 0, net_profit: 0 };
    const income = Number(summary.income || 0);
    const net = income - Number(summary.expense || 0);
    const posOrders = (ordersResult.data || []).filter((row) => row.payment_status === "completed");
    const voidOrders = (ordersResult.data || []).filter((row) => row.payment_status === "voided");
    const saleOrders = posOrders.length;
    const posSales = posOrders.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    $("#metricGrid").innerHTML = `<article class="metric accent"><small>ยอดขายสุทธิ</small><strong>${money.format(income)}</strong></article><article class="metric"><small>รายจ่าย</small><strong>${money.format(summary.expense || 0)}</strong></article><article class="metric"><small>คงเหลือก่อนต้นทุน</small><strong>${money.format(net)}</strong></article><article class="metric"><small>ออเดอร์</small><strong>${number.format(saleOrders)}</strong></article><article class="metric"><small>เฉลี่ยต่อบิล</small><strong>${money.format(saleOrders ? posSales / saleOrders : 0)}</strong></article><article class="metric"><small>ยกเลิก</small><strong>${number.format(voidOrders.length)} บิล</strong></article>`;
    const channelMap = new Map();
    posOrders.forEach((row) => {
      const channel = ({ CASH: "เงินสด", cash: "เงินสด", TRANSFER: "เงินโอน", transfer: "เงินโอน", THAI_CHUAY_THAI: "ไทยช่วยไทย", thai_chuay_thai: "ไทยช่วยไทย" })[row.payment_method] || row.payment_method || "อื่นๆ";
      channelMap.set(channel, (channelMap.get(channel) || 0) + Number(row.total_amount || 0));
    });
    const channels = [...channelMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const max = Math.max(...channels.map((row) => row.total), 1);
    $("#channelBreakdown").innerHTML = channels.length ? channels.map((row) => `<div class="breakdown-row"><span>${escapeHtml(row.name)}</span><span class="breakdown-bar"><span style="width:${Math.max(3, row.total / max * 100)}%"></span></span><strong>${money.format(row.total)}</strong></div>`).join("") : '<div class="empty-state">ยังไม่มีข้อมูลเดือนนี้</div>';
    const productMap = new Map();
    posOrders.flatMap((order) => order.pos_order_lines || []).forEach((line) => {
      const current = productMap.get(line.item_name) || { quantity: 0, total: 0 };
      current.quantity += Number(line.quantity || 0); current.total += Number(line.line_total || 0);
      productMap.set(line.item_name, current);
    });
    const products = [...productMap.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
    $("#topProductBreakdown").innerHTML = products.length ? products.map((row) => `<div class="breakdown-row product-rank"><span>${escapeHtml(row.name)}</span><span>${number.format(row.quantity)} ชิ้น</span><strong>${money.format(row.total)}</strong></div>`).join("") : '<div class="empty-state">ยังไม่มีข้อมูลสินค้าเดือนนี้</div>';
  }

  function categoryName(id) { return state.categories.find((row) => row.id === id)?.name || "ไม่ระบุหมวด"; }

  function unifiedMasterRows() {
    const itemIds = new Set(state.items.map((row) => String(row.id)));
    const normalizedExpenseNames = new Set(state.items.filter((row) => row.item_type === "EXPENSE_ITEM").map((row) => String(row.name || "").trim().toLocaleLowerCase("th")));
    const itemRows = state.items.map((row) => ({ ...row, _masterKind: "item", _masterType: row.item_type === "EXPENSE_ITEM" ? "expense" : "product" }));
    const generalExpenseRows = state.expenseItems
      .filter((row) => (!row.item_id || !itemIds.has(String(row.item_id))) && !normalizedExpenseNames.has(String(row.name || "").trim().toLocaleLowerCase("th")))
      .map((row) => ({ ...row, _masterKind: "expense_item", _masterType: "expense", track_stock: false }));
    return [...itemRows, ...generalExpenseRows].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "th"));
  }

  function renderMasterList() {
    const list = $("#masterList");
    if (!list) return;
    const query = $("#masterSearch").value.trim().toLocaleLowerCase("th");
    const rows = unifiedMasterRows()
      .filter((row) => state.masterFilter === "all" || row._masterType === state.masterFilter)
      .filter((row) => `${row.code || ""} ${row.name || ""}`.toLocaleLowerCase("th").includes(query));
    list.innerHTML = rows.length ? rows.map((row) => `<button class="master-row" type="button" data-master-id="${row.id}" data-master-kind="${row._masterKind}">
      <span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.code)} · ${escapeHtml(categoryName(row.category_id))}</small></span>
      <span class="master-badges"><small>${row.active === false || row.branch_active === false ? "ปิดใช้งาน" : (row._masterType === "expense" ? "ค่าใช้จ่ายทั่วไป" : (row.stock_target_item_id ? `รวมเข้า ${escapeHtml(itemById(row.stock_target_item_id)?.name || "สต็อกกลาง")}` : (row.track_stock ? "ติดตามสต็อก" : "สินค้าไม่เก็บสต็อก")))}</small><b>แก้ไข</b></span>
    </button>`).join("") : '<div class="empty-state">ไม่พบรายการ</div>';
  }

  function syncMasterPurchaseFields() {
    const isItem = $("#masterKind").value === "item";
    const mode = $("#masterStockMode").value;
    const enabled = isItem && mode !== "none";
    $("#masterStock").checked = mode === "self";
    $("#masterStockTargetField").hidden = mode !== "group";
    $("#masterPurchaseFields").hidden = !enabled;
    if (!enabled) return;
    const baseUnit = unitById($("#masterUnit").value);
    const purchaseUnit = unitById($("#masterPurchaseUnit").value);
    const target = itemById($("#masterStockTarget").value);
    const targetUnit = unitById(target?.base_unit_id);
    $("#masterConversion").disabled = !purchaseUnit;
    if (!purchaseUnit) $("#masterConversion").value = 1;
    $("#masterConversionPreview").textContent = purchaseUnit
      ? `ซื้อ 1 ${purchaseUnit.name} เพิ่ม ${number.format(Number($("#masterConversion").value) || 0)} ${mode === "group" ? targetUnit?.name || "หน่วยสต็อกกลาง" : baseUnit?.name || "หน่วยฐาน"}`
      : `ซื้อและนับสต็อกเป็น ${mode === "group" ? targetUnit?.name || "หน่วยสต็อกกลาง" : baseUnit?.name || "หน่วยฐาน"}`;
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
    const expenseMapping = kind === "item" ? expenseForPurchasedItem(row.id) : null;
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
    $("#masterConversion").value = expenseMapping?.stock_conversion_to_base || purchaseUnit?.conversion_to_base || 1;
    refreshMasterCategories(mainId, selectedSubcategory);
    const stockMode = kind === "item" ? stockModeForItem(row) : (row.affects_stock ? "self" : "none");
    $("#masterStockMode").value = stockMode;
    $("#masterStockTarget").innerHTML = `<option value="">เลือกรายการสต็อกกลาง</option>${optionHtml(stockTargetChoices(row.id), row.stock_target_item_id)}`;
    $("#masterStock").checked = kind === "item" ? stockMode === "self" : Boolean(row.affects_stock);
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
      payload.stock_mode = $("#masterStockMode").value;
      payload.stock_target_item_id = $("#masterStockTarget").value || null;
      if (payload.stock_mode === "group" && !payload.stock_target_item_id) { toast("กรุณาเลือกรายการสต็อกกลาง"); return; }
      payload.track_stock = payload.stock_mode === "self";
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
    const button = $("#masterForm button[type='submit']");
    const originalText = button?.textContent || "บันทึก";
    if (button) { button.disabled = true; button.textContent = "กำลังบันทึก…"; }
    try {
      if (!centralAvailable() || state.catalogSource !== "supabase") throw new Error("Supabase ยังไม่พร้อม จึงยังบันทึกการแก้ไขไม่ได้");
      const result = await sendQueuedOperation({ type: "master", payload });
      if (result.error) throw result.error;
      $("#masterDialog").close();
      toast("อัปเดตรายการแล้ว");
      if (payload.id) {
        const row = (kind === "item" ? state.items : state.expenseItems).find((entry) => entry.id === payload.id);
        if (row) Object.assign(row, payload, kind === "item" ? {
          track_stock: payload.stock_mode === "self",
          stock_target_item_id: payload.stock_mode === "group" ? payload.stock_target_item_id : null
        } : {});
        if (kind === "item") {
          const expense = expenseForPurchasedItem(payload.id);
          if (expense) expense.affects_stock = payload.stock_mode !== "none";
          if (payload.stock_mode === "none") state.stock = state.stock.filter((stockRow) => stockRow.item_id !== payload.id);
          saveStockCache(state.stock); renderStock();
        }
        saveMasterCache(); renderMasterList();
        loadMaster().catch((loadError) => toast(`อัปเดตข้อมูลล่าสุดไม่สำเร็จ: ${loadError.message}`));
      } else {
        await loadMaster();
      }
    } catch (error) {
      toast(`บันทึกไม่สำเร็จ: ${error.message}`);
    } finally {
      if (button) { button.disabled = false; button.textContent = originalText; }
    }
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
        loadMasterCache();
        try { await loadMaster(); }
        catch (error) {
          if (!isNetworkError(error)) throw error;
          if (!loadMasterCache()) throw error;
          toast("Supabase ยังไม่พร้อม แสดงข้อมูลที่เก็บไว้ในเครื่อง");
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
    if (!hadCache) toast("Supabase ยังไม่พร้อม และเครื่องนี้ยังไม่มีข้อมูลที่บันทึกไว้");
    else toast("Supabase ยังไม่พร้อม แสดงข้อมูลที่เก็บไว้ในเครื่อง");
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
  $("#expenseLines").addEventListener("change", (event) => { const field = event.target.dataset.field; if (field) updateLine(event.target.closest(".expense-card"), field, event.target.type === "checkbox" ? event.target.checked : event.target.value); });
  $("#expenseLines").addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    const card = event.target.closest(".expense-card");
    const line = card && state.lines.find((row) => row.id === card.dataset.lineId);
    if (!field || !line || event.target.matches("select") || event.target.type === "checkbox") return;
    if (field === "expense_search") {
      const hadKnownSelection = Boolean(line.source_expense_item_id || line.item_id || line.expense_item_id);
      line.expense_search = event.target.value;
      line.description = event.target.value.trim();
      line.expense_item_id = "";
      line.source_expense_item_id = "";
      line.item_id = "";
      line.unit_id = "";
      if (hadKnownSelection) { line.category_id = ""; line.subcategory_id = ""; line.supplier_name = ""; }
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
  $("#manageRecipesButton").addEventListener("click", openRecipeManager);
  $("#addStockGroupButton").addEventListener("click", () => openStockGroup());
  $("#manageStockTrackingButton").addEventListener("click", openStockTracking);
  $("#stockList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stock-group]");
    if (button) openStockGroup(button.dataset.stockGroup);
  });
  $("#stockGroupSearch").addEventListener("input", renderStockGroupMembers);
  $$('input[name="stockGroupMode"]').forEach((input) => input.addEventListener("change", syncStockGroupMode));
  $("#stockGroupMembers").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-stock-member]");
    if (!checkbox) return;
    const row = checkbox.closest("[data-stock-member-row]");
    row?.classList.toggle("selected", checkbox.checked);
    if (checkbox.checked) state.stockGroupMembers.set(checkbox.dataset.stockMember, stockMemberConversion(itemById(checkbox.dataset.stockMember)));
    else state.stockGroupMembers.delete(checkbox.dataset.stockMember);
  });
  $("#stockGroupForm").addEventListener("submit", saveStockGroup);
  $("#stockTrackingSearch").addEventListener("input", renderStockTrackingList);
  $("#stockTrackingList").addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-stock-tracking]");
    if (!checkbox) return;
    const draft = state.stockTrackingDraft.get(checkbox.dataset.stockTracking);
    if (draft) draft.enabled = checkbox.checked;
    renderStockTrackingList();
  });
  $("#stockTrackingForm").addEventListener("submit", saveStockTracking);
  $("#recipeMenuSearch").addEventListener("input", renderRecipeMenuList);
  $("#recipeMenuList").addEventListener("click", (event) => { const button = event.target.closest("[data-recipe-menu]"); if (button) selectRecipeMenu(button.dataset.recipeMenu); });
  $("#addRecipeLineButton").addEventListener("click", addRecipeLine);
  $("#recipeLines").addEventListener("change", (event) => {
    const row = event.target.closest("[data-recipe-line]");
    if (!row || !event.target.dataset.recipeField) return;
    const line = state.recipeDraft[Number(row.dataset.recipeLine)];
    if (event.target.dataset.recipeField === "item_id") line.item_id = event.target.value;
    else line.quantity = Number(event.target.value);
    renderRecipeLines();
  });
  $("#recipeLines").addEventListener("click", (event) => { const button = event.target.closest("[data-remove-recipe-line]"); if (!button) return; state.recipeDraft.splice(Number(button.dataset.removeRecipeLine), 1); renderRecipeLines(); });
  $("#recipeForm").addEventListener("submit", saveRecipe);
  $("#dashboardMonth").addEventListener("change", loadDashboard);
  $("#masterSearch").addEventListener("input", renderMasterList);
  $$("[data-master-filter]").forEach((button) => button.addEventListener("click", () => {
    state.masterFilter = button.dataset.masterFilter;
    $$("[data-master-filter]").forEach((filter) => filter.classList.toggle("active", filter === button));
    $("#addMasterButton").textContent = state.masterFilter === "expense" ? "+ ค่าใช้จ่าย" : "+ เพิ่ม";
    renderMasterList();
  }));
  $("#masterList").addEventListener("click", (event) => { const row = event.target.closest("[data-master-id]"); if (row) openMaster(row.dataset.masterId, row.dataset.masterKind); });
  $("#addMasterButton").addEventListener("click", () => openMaster(null, state.masterFilter === "expense" ? "expense_item" : "item"));
  $("#accountQuickButton").addEventListener("click", () => setPage("account"));
  $("#connectionBadge").addEventListener("click", () => setPage("account"));
  $("#syncNowButton").addEventListener("click", async () => {
    if (state.localAccess) { toast("เชื่อมต่อ Supabase ใหม่ก่อนส่งข้อมูล"); return; }
    const sent = await flushOutbox({ notify: true });
    if (sent.master) await loadMaster();
    if (sent.expense || sent.expense_legacy) await loadExpenseHistory();
    await loadCapacityStatus();
  });
  $("#reconnectButton").addEventListener("click", async () => {
    window.BOY_LOCAL_ACCESS?.clear();
    await client.auth.signOut();
    location.reload();
  });
  $("#masterStockMode").addEventListener("change", syncMasterPurchaseFields);
  $("#masterStockTarget").addEventListener("change", syncMasterPurchaseFields);
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
    await loadCapacityStatus();
  });
  init();
})();

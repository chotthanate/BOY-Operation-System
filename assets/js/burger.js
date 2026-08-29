(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.BOY_CENTRAL_CONFIG || {};
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey) : null;
  const money = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
  const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 3 });
  const state = { session: null, branch: null, items: [], units: [], expenseItems: [], suppliers: [], itemSuppliers: [], stock: [], lines: [] };

  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const optionHtml = (rows, selected, label = "name") => rows.map((row) => `<option value="${escapeHtml(row.id)}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row[label])}</option>`).join("");
  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const monthNow = () => today().slice(0, 7);
  const newLine = () => ({ id: crypto.randomUUID(), item_id: "", expense_item_id: "", description: "", quantity: 1, unit_id: "", line_total: 0, supplier_name: "", note: "", expanded: true });

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
  }

  function itemById(id) { return state.items.find((item) => item.id === id); }
  function unitById(id) { return state.units.find((unit) => unit.id === id); }
  function supplierChoices(itemId) {
    const linkedIds = state.itemSuppliers.filter((link) => link.item_id === itemId && link.active !== false).map((link) => link.supplier_id);
    return linkedIds.length ? state.suppliers.filter((supplier) => linkedIds.includes(supplier.id)) : state.suppliers;
  }

  function renderLines() {
    $("#expenseCount").textContent = `${state.lines.length} รายการ`;
    $("#expenseLines").innerHTML = state.lines.map((line, index) => {
      const item = itemById(line.item_id);
      const unit = unitById(line.unit_id);
      const suppliers = supplierChoices(line.item_id);
      const perUnit = Number(line.quantity) > 0 ? Number(line.line_total) / Number(line.quantity) : 0;
      return `<article class="expense-card ${line.expanded ? "expanded" : ""}" data-line-id="${line.id}">
        <button class="expense-summary" type="button" data-action="toggle-line">
          <span class="line-number">${index + 1}</span>
          <span class="summary-copy"><strong>${escapeHtml(line.description || item?.name || "ยังไม่ระบุรายการ")}</strong><small>${escapeHtml(state.expenseItems.find((row) => row.id === line.expense_item_id)?.name || "ยังไม่เลือกหมวด")}</small></span>
          <span class="summary-amount"><strong>${money.format(Number(line.line_total) || 0)}</strong><span class="stock-tag ${item?.track_stock ? "" : "off"}">${item?.track_stock ? "เข้าสต็อก" : "ไม่เข้าสต็อก"}</span></span>
        </button>
        <div class="expense-detail">
          <label>สินค้า (ถ้ามี)<select data-field="item_id"><option value="">ไม่ผูกสินค้า</option>${optionHtml(state.items, line.item_id)}</select></label>
          <label>ชื่อรายการ<input data-field="description" value="${escapeHtml(line.description)}" placeholder="เช่น ขนมปังเบอร์เกอร์"></label>
          <div class="field-grid three">
            <label>จำนวน<input data-field="quantity" type="number" min="0" step="0.001" value="${escapeHtml(line.quantity)}"></label>
            <label>หน่วย<select data-field="unit_id"><option value="">เลือก</option>${optionHtml(state.units, line.unit_id)}</select></label>
            <label>ยอดรวม<input data-field="line_total" type="number" min="0" step="0.01" value="${escapeHtml(line.line_total)}"></label>
          </div>
          <div class="unit-price"><span>ราคาต่อหน่วย</span><strong>${money.format(perUnit)}${unit ? ` / ${escapeHtml(unit.name)}` : ""}</strong></div>
          <div class="field-grid">
            <label>หมวดรายจ่าย<select data-field="expense_item_id"><option value="">เลือกหมวด</option>${optionHtml(state.expenseItems, line.expense_item_id)}</select></label>
            <label>Supplier<input data-field="supplier_name" list="suppliers-${line.id}" value="${escapeHtml(line.supplier_name)}" placeholder="เลือกหรือพิมพ์ชื่อ"><datalist id="suppliers-${line.id}">${suppliers.map((row) => `<option value="${escapeHtml(row.name)}"></option>`).join("")}</datalist></label>
          </div>
          <label>หมายเหตุ<textarea data-field="note" placeholder="ไม่บังคับ">${escapeHtml(line.note)}</textarea></label>
          <button class="remove-line" type="button" data-action="remove-line">ลบรายการนี้</button>
        </div>
      </article>`;
    }).join("");
  }

  function updateLine(card, field, value) {
    const line = state.lines.find((row) => row.id === card.dataset.lineId);
    if (!line) return;
    line[field] = ["quantity", "line_total"].includes(field) ? Number(value) : value;
    if (field === "item_id") {
      const item = itemById(value);
      if (item) {
        line.description = item.name;
        line.unit_id = item.base_unit_id || line.unit_id;
        const choices = supplierChoices(value);
        if (choices.length === 1) line.supplier_name = choices[0].name;
      }
    }
    renderLines();
  }

  function validateExpense() {
    const errors = [];
    if (!$("#expenseDate").value) errors.push("กรุณาเลือกวันที่");
    state.lines.forEach((line, index) => {
      const item = itemById(line.item_id);
      if (!line.description.trim()) errors.push(`รายการ ${index + 1}: ระบุชื่อรายการ`);
      if (!(Number(line.line_total) > 0)) errors.push(`รายการ ${index + 1}: ระบุยอดรวม`);
      if (!line.expense_item_id) errors.push(`รายการ ${index + 1}: เลือกหมวดรายจ่าย`);
      if (item?.track_stock && (!(Number(line.quantity) > 0) || !line.unit_id)) errors.push(`รายการ ${index + 1}: ระบุจำนวนและหน่วยสำหรับสต็อก`);
    });
    return errors;
  }

  function openReview() {
    const errors = validateExpense();
    const total = state.lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    $("#reviewSummary").textContent = `${state.lines.length} รายการ · ${money.format(total)}`;
    $("#reviewErrors").innerHTML = errors.map((error) => `<div>• ${escapeHtml(error)}</div>`).join("");
    $("#confirmExpenseButton").disabled = errors.length > 0 || !state.session;
    $("#reviewDialog").showModal();
  }

  async function submitExpense() {
    const button = $("#confirmExpenseButton");
    button.disabled = true;
    button.textContent = "กำลังบันทึก";
    const total = state.lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0);
    const payload = {
      branch_id: state.branch.id,
      transaction_date: $("#expenseDate").value,
      source_system: "boy_burger_web",
      idempotency_key: crypto.randomUUID(),
      lines: state.lines.map((line) => {
        const supplier = state.suppliers.find((row) => row.name.trim().toLocaleLowerCase("th") === line.supplier_name.trim().toLocaleLowerCase("th"));
        return { item_id: line.item_id || null, expense_item_id: line.expense_item_id, supplier_id: supplier?.id || null, supplier_name: supplier ? null : line.supplier_name || null, description: line.description, quantity: line.quantity, unit_id: line.unit_id || null, line_total: line.line_total, note: line.note || null };
      }),
      payments: [{ method: $("#paymentMethod").value, amount: total }]
    };
    const { data, error } = await client.schema("boy_central").rpc("record_expense", { payload });
    button.textContent = "บันทึก";
    if (error) { button.disabled = false; toast(`บันทึกไม่สำเร็จ: ${error.message}`); return; }
    $("#reviewDialog").close();
    state.lines = [newLine()];
    renderLines();
    loadExpenseHistory();
    toast(`บันทึก ${data.line_count} รายการแล้ว`);
  }

  async function loadExpenseHistory() {
    if (!state.branch) return;
    const { data, error } = await client.schema("boy_central").from("transactions").select("id,transaction_date,total_amount,status,transaction_lines(description)").eq("branch_id", state.branch.id).eq("transaction_type", "expense").order("occurred_at", { ascending: false }).limit(12);
    if (error) { $("#expenseHistory").innerHTML = '<div class="empty-state">โหลดประวัติไม่สำเร็จ</div>'; return; }
    $("#expenseHistory").innerHTML = (data || []).length ? data.map((row) => `<article class="history-row"><span><strong>${escapeHtml(row.transaction_lines?.[0]?.description || "รายจ่าย")}</strong><small>${escapeHtml(row.transaction_date)} · ${escapeHtml(row.status)}</small></span><span class="history-amount">${money.format(row.total_amount || 0)}</span></article>`).join("") : '<div class="empty-state">ยังไม่มีรายจ่าย</div>';
  }

  async function loadMaster() {
    const [branchResult, unitsResult, expenseResult, supplierResult] = await Promise.all([
      client.schema("boy_central").from("branches").select("id,company_id,code,name").eq("code", "BURGER").eq("active", true).single(),
      client.schema("boy_central").from("units").select("id,name,code").eq("active", true).order("name"),
      client.schema("boy_central").from("expense_items").select("id,name,code").eq("active", true).order("name"),
      client.schema("boy_central").from("suppliers").select("id,name,code").eq("active", true).order("name")
    ]);
    if (branchResult.error) throw branchResult.error;
    state.branch = branchResult.data;
    state.units = unitsResult.data || [];
    state.expenseItems = expenseResult.data || [];
    state.suppliers = supplierResult.data || [];
    const [itemsResult, linksResult] = await Promise.all([
      client.schema("boy_central").from("branch_items").select("item_id,items(id,name,code,base_unit_id,track_stock)").eq("branch_id", state.branch.id).eq("active", true),
      client.schema("boy_central").from("item_suppliers").select("item_id,supplier_id,active").eq("active", true)
    ]);
    if (itemsResult.error) throw itemsResult.error;
    state.items = (itemsResult.data || []).map((row) => row.items).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, "th"));
    state.itemSuppliers = linksResult.data || [];
    renderLines();
  }

  async function loadStock() {
    if (!state.branch) return;
    $("#stockList").innerHTML = '<div class="empty-state">กำลังโหลด</div>';
    const { data, error } = await client.schema("boy_central").from("v_stock_on_hand").select("item_id,item_code,item_name,base_unit_name,quantity_on_hand,average_unit_cost,inventory_value").eq("branch_id", state.branch.id).order("item_name");
    if (error) { $("#stockList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; return; }
    state.stock = data || [];
    renderStock();
  }

  function renderStock() {
    const query = $("#stockSearch").value.trim().toLocaleLowerCase("th");
    const rows = state.stock.filter((row) => `${row.item_code} ${row.item_name}`.toLocaleLowerCase("th").includes(query));
    $("#stockList").innerHTML = rows.length ? rows.map((row) => `<article class="stock-row"><span><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.item_code || "")} · ต้นทุน ${money.format(row.average_unit_cost || 0)}</small></span><span class="stock-qty"><strong>${number.format(row.quantity_on_hand || 0)} ${escapeHtml(row.base_unit_name || "")}</strong><span class="stock-value">${money.format(row.inventory_value || 0)}</span></span></article>`).join("") : '<div class="empty-state">ไม่พบสินค้า</div>';
  }

  async function loadDashboard() {
    if (!state.branch) return;
    const period = `${$("#dashboardMonth").value}-01`;
    const [year, month] = $("#dashboardMonth").value.split("-").map(Number);
    const nextPeriod = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const [summaryResult, transactionsResult] = await Promise.all([
      client.schema("boy_central").from("v_monthly_branch_summary").select("income,expense,net_profit").eq("branch_id", state.branch.id).eq("month_start", period).maybeSingle(),
      client.schema("boy_central").from("transactions").select("source_system,transaction_type,total_amount,status").eq("branch_id", state.branch.id).gte("transaction_date", period).lt("transaction_date", nextPeriod)
    ]);
    if (summaryResult.error || transactionsResult.error) { toast(summaryResult.error?.message || transactionsResult.error?.message); return; }
    const summary = summaryResult.data || { income: 0, expense: 0, net_profit: 0 };
    const transactions = transactionsResult.data || [];
    $("#metricGrid").innerHTML = `<article class="metric accent"><small>รายรับ</small><strong>${money.format(summary.income || 0)}</strong></article><article class="metric"><small>รายจ่าย</small><strong>${money.format(summary.expense || 0)}</strong></article><article class="metric"><small>คงเหลือก่อนต้นทุน</small><strong>${money.format(summary.net_profit || 0)}</strong></article><article class="metric"><small>จำนวนธุรกรรม</small><strong>${number.format(transactions.length)}</strong></article>`;
    const channelMap = new Map();
    transactions.filter((row) => row.status === "confirmed" && ["income", "sale", "settlement"].includes(row.transaction_type)).forEach((row) => channelMap.set(row.source_system, (channelMap.get(row.source_system) || 0) + Number(row.total_amount || 0)));
    const channels = [...channelMap.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
    const max = Math.max(...channels.map((row) => row.total), 1);
    $("#channelBreakdown").innerHTML = channels.length ? channels.map((row) => `<div class="breakdown-row"><span>${escapeHtml(row.name)}</span><span class="breakdown-bar"><span style="width:${Math.max(3, row.total / max * 100)}%"></span></span><strong>${money.format(row.total)}</strong></div>`).join("") : '<div class="empty-state">ยังไม่มีข้อมูลเดือนนี้</div>';
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
    $("#authCard").hidden = true;
    $$(".page,.bottom-nav").forEach((element) => element.hidden = false);
    $("#accountEmail").textContent = session.user.email || "—";
    $("#accountName").textContent = profile.display_name || "ผู้ใช้งาน BOY";
    setConnection("เชื่อมต่อแล้ว", "online");
    try { await loadMaster(); await loadExpenseHistory(); } catch (error) { setConnection("เชื่อมต่อไม่สำเร็จ", "error"); toast(error.message); }
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
  $("#addExpenseButton").addEventListener("click", () => { state.lines.forEach((line) => line.expanded = false); state.lines.push(newLine()); renderLines(); });
  $("#expenseLines").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    const card = button.closest(".expense-card"); const line = state.lines.find((row) => row.id === card.dataset.lineId); if (!line) return;
    if (button.dataset.action === "toggle-line") { state.lines.forEach((row) => row.expanded = row.id === line.id ? !row.expanded : false); renderLines(); }
    if (button.dataset.action === "remove-line" && confirm("ลบรายการนี้ใช่ไหม")) { state.lines = state.lines.filter((row) => row.id !== line.id); if (!state.lines.length) state.lines.push(newLine()); renderLines(); }
  });
  $("#expenseLines").addEventListener("change", (event) => { const field = event.target.dataset.field; if (field) updateLine(event.target.closest(".expense-card"), field, event.target.value); });
  $("#reviewExpenseButton").addEventListener("click", openReview);
  $("#confirmExpenseButton").addEventListener("click", submitExpense);
  $("#stockSearch").addEventListener("input", renderStock);
  $("#refreshStockButton").addEventListener("click", loadStock);
  $("#dashboardMonth").addEventListener("change", loadDashboard);
  $("#logoutButton").addEventListener("click", async () => { await client.auth.signOut(); location.reload(); });
  $("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); $("#loginError").textContent = ""; const { data, error } = await client.auth.signInWithPassword({ email: $("#loginEmail").value, password: $("#loginPassword").value }); if (error) { $("#loginError").textContent = error.message; return; } await enterApp(data.session); });
  $("#magicLinkButton").addEventListener("click", requestMagicLink);
  init();
})();

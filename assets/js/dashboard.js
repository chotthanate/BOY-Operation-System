(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const config = window.BOY_CENTRAL_CONFIG || {};
  const client = window.supabase && config.url && config.publishableKey
    ? window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
  const mode = document.body.dataset.dashboardMode || "all";
  const money = (value) => new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
  const count = (value) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const localDate = (date) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const thaiDate = (value, options = {}) => new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", ...options });
  const paymentNames = { cash: "เงินสด", transfer: "เงินโอน", government: "ไทยช่วยไทย", other: "อื่น ๆ" };
  const channelNames = { store: "หน้าร้าน", walk_in: "หน้าร้าน", dine_in: "รับประทานที่ร้าน", delivery: "เดลิเวอรี", online: "ออนไลน์", takeaway: "ซื้อกลับ", other: "อื่น ๆ" };
  const branchMeta = {
    TAWANA: { slug: "tawana", mark: "TW", name: "ทาวน่า", color: "#0b876b", soft: "#e8f6f0" },
    "BIGC-CENTRAL-PATTAYA": { slug: "bigc", mark: "BC", name: "บิ๊กซีพัทยากลาง", color: "#b88812", soft: "#fff5d4" },
    BURGER: { slug: "burger", mark: "BG", name: "ร้านเบอร์เกอร์", color: "#ef6c4d", soft: "#fff0e9" },
    GRILL: { slug: "grill", mark: "GR", name: "ร้านเนื้อย่าง", color: "#7d3f31", soft: "#f5e8e3" }
  };

  async function rpc(name, args) {
    if (!client) throw new Error("Supabase ยังไม่พร้อม");
    await client.auth.getSession();
    const { data, error } = await client.schema("boy_central").rpc(name, args);
    if (error) throw error;
    return data;
  }

  function setLoading(active) {
    document.querySelector("main")?.classList.toggle("loading", active);
    const button = $("#refreshBtn");
    if (button) button.disabled = active;
  }

  function showError(message) {
    const target = $("#dashboardError");
    if (!target) return;
    target.hidden = false;
    target.textContent = message;
  }

  function clearError() {
    const target = $("#dashboardError");
    if (target) target.hidden = true;
  }

  async function loadCapacity() {
    const note = $("#capacityNote");
    if (!note) return;
    try {
      const data = await rpc("get_system_capacity_snapshot", {});
      const used = Number(data.database_bytes || 0) / 1024 / 1024;
      const limit = Number(data.free_limit_bytes || 0) / 1024 / 1024;
      note.className = `capacity ${data.level || "ok"}`;
      note.textContent = `ฐานข้อมูล ${used.toFixed(1)} / ${limit.toFixed(0)} MB (${Number(data.used_percent || 0).toFixed(1)}%)`;
    } catch (_) { note.textContent = ""; }
  }

  function renderAllDaily(data) {
    const totals = data.totals || {};
    $("#totalIncome").textContent = money(totals.income);
    $("#totalExpense").textContent = money(totals.expense);
    $("#totalNet").textContent = money(totals.net);
    $("#pendingTotal").textContent = money(totals.pending_reimbursement);
    $("#updated").textContent = `${thaiDate(data.date)} · อัปเดต ${new Date(data.generatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
    const returned = new Map((data.branches || []).map((branch) => [branch.code, branch]));
    const rows = Object.entries(branchMeta).map(([code, meta]) => returned.get(code) || { code, name: meta.name, income: 0, cash: 0, transfer: 0, government: 0, expense: 0, net: 0 });
    $("#storeGrid").innerHTML = rows.length ? rows.map((branch) => {
      const meta = branchMeta[branch.code] || {};
      const href = `branch-dashboard.html?branch=${encodeURIComponent(branch.code)}&from=${encodeURIComponent(data.date)}&to=${encodeURIComponent(data.date)}`;
      return `<a class="store" href="${href}" style="--accent:${meta.color || "#0b876b"};--accent-soft:${meta.soft || "#e8f6f0"}"><span class="store-head"><span class="store-name">${escapeHtml(branch.name)}</span><span class="go">›</span></span><strong class="store-total">${money(branch.income)}</strong><span class="split"><span>เงินสด<strong>${money(branch.cash)}</strong></span><span>เงินโอน<strong>${money(branch.transfer)}</strong></span><span>ไทยช่วยไทย<strong>${money(branch.government)}</strong></span></span><span class="store-foot"><span>รายจ่าย <b>${money(branch.expense)}</b></span><span>สุทธิ <b>${money(branch.net)}</b></span></span></a>`;
    }).join("") : '<div class="empty">ยังไม่มีข้อมูลสาขา</div>';
  }

  async function loadAllDaily(force = false) {
    clearError(); setLoading(true);
    const date = $("#dateInput").value;
    const key = `BOY_DAILY_OVERVIEW:${date}`;
    if (!force) {
      try { const cached = JSON.parse(localStorage.getItem(key) || "null"); if (cached) renderAllDaily(cached); } catch (_) {}
    }
    try {
      const data = await rpc("get_dashboard_daily", { target_date: date });
      localStorage.setItem(key, JSON.stringify(data));
      renderAllDaily(data);
    } catch (error) { showError(error.message); }
    finally { setLoading(false); }
  }

  async function loadAllMonthly() {
    const target = $("#monthContent");
    target.textContent = "กำลังโหลดรายงานเดือน...";
    try {
      const data = await rpc("get_dashboard_monthly", { target_year: Number($("#yearInput").value), target_month: Number($("#monthSelect").value) });
      const summary = data.summary || {};
      const days = (data.dailyIncome || []).filter((row) => Number(row.total || row.income) > 0);
      const max = Math.max(1, ...days.map((row) => Number(row.total || row.income) || 0));
      target.innerHTML = `<div class="month-summary"><div class="month-stat"><span>รายรับ</span><strong>${money(summary.income)}</strong></div><div class="month-stat"><span>รายจ่าย</span><strong>${money(summary.expense)}</strong></div><div class="month-stat"><span>คงเหลือ</span><strong>${money(summary.profit)}</strong></div><div class="month-stat"><span>วันที่มียอดขาย</span><strong>${count(days.length)} วัน</strong></div></div><div class="bars">${days.slice(-14).map((row) => { const value = Number(row.total || row.income) || 0; return `<div class="bar-row"><span>${escapeHtml(row.label || `วันที่ ${row.day}`)}</span><div class="track"><div class="fill" style="width:${Math.max(3, value / max * 100)}%"></div></div><strong>${money(value)}</strong></div>`; }).join("") || '<div class="empty">ยังไม่มีรายรับในเดือนนี้</div>'}</div>`;
    } catch (error) { target.innerHTML = `<div class="empty error">${escapeHtml(error.message)}</div>`; }
  }

  function initAll() {
    const today = new Date();
    $("#dateInput").value = localDate(today);
    const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
    monthNames.forEach((name, index) => $("#monthSelect").add(new Option(name, index + 1)));
    $("#monthSelect").value = today.getMonth() + 1;
    $("#yearInput").value = today.getFullYear();
    $("#dateInput").addEventListener("change", () => loadAllDaily());
    $("#prevDate").addEventListener("click", () => moveOverviewDate(-1));
    $("#nextDate").addEventListener("click", () => moveOverviewDate(1));
    $("#refreshBtn").addEventListener("click", () => loadAllDaily(true));
    $("#monthSelect").addEventListener("change", loadAllMonthly);
    $("#yearInput").addEventListener("change", loadAllMonthly);
    loadAllDaily(); loadAllMonthly(); loadCapacity();
  }

  function moveOverviewDate(delta) {
    const date = new Date(`${$("#dateInput").value}T12:00:00+07:00`);
    date.setDate(date.getDate() + delta);
    $("#dateInput").value = localDate(date);
    loadAllDaily();
  }

  function rangeForPreset(preset) {
    const today = new Date();
    const to = localDate(today);
    if (preset === "today") return [to, to];
    if (preset === "yesterday") { today.setDate(today.getDate() - 1); const day = localDate(today); return [day, day]; }
    const days = preset === "7d" ? 6 : 29;
    today.setDate(today.getDate() - days);
    return [localDate(today), to];
  }

  function applyBranchTheme(code, branch) {
    const meta = branchMeta[code] || {};
    document.documentElement.style.setProperty("--accent", meta.color || "#0b876b");
    document.documentElement.style.setProperty("--accent-strong", meta.color || "#086d57");
    document.documentElement.style.setProperty("--accent-soft", meta.soft || "#e8f6f0");
    $("#branchMark").textContent = meta.mark || code.slice(0, 2);
    $("#branchTitle").textContent = branch.name;
    document.title = `Dashboard ${branch.name} | BOY Operation`;
  }

  function renderBars(target, rows, labelKey, valueKey, labeler = (value) => value) {
    const max = Math.max(1, ...rows.map((row) => Number(row[valueKey]) || 0));
    target.innerHTML = rows.length ? rows.map((row) => `<div class="breakdown-row"><span>${escapeHtml(labeler(row[labelKey]))}</span><div class="track"><div class="fill" style="width:${Math.max(3, (Number(row[valueKey]) || 0) / max * 100)}%"></div></div><strong>${money(row[valueKey])}</strong></div>`).join("") : '<div class="empty">ยังไม่มีข้อมูลในช่วงนี้</div>';
  }

  function renderTrend(rows) {
    const target = $("#dailyTrend");
    const max = Math.max(1, ...rows.map((row) => Number(row.revenue) || 0));
    const labelEvery = Math.max(1, Math.ceil(rows.length / 7));
    target.innerHTML = rows.length ? rows.map((row, index) => `<div class="chart-col" title="${escapeHtml(thaiDate(row.date))}: ${money(row.revenue)}"><div class="chart-bar" style="height:${Math.max(2, (Number(row.revenue) || 0) / max * 100)}%"></div>${index % labelEvery === 0 ? `<small>${new Date(`${row.date}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}</small>` : ""}</div>`).join("") : '<div class="empty">ยังไม่มีข้อมูลในช่วงนี้</div>';
  }

  function renderBranch(data) {
    applyBranchTheme(data.branch.code, data.branch);
    const totals = data.totals || {};
    $("#branchUpdated").textContent = `${thaiDate(data.dateFrom)}${data.dateFrom === data.dateTo ? "" : ` – ${thaiDate(data.dateTo)}`} · อัปเดต ${new Date(data.generatedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
    $("#metricGrid").innerHTML = [
      ["ยอดขายสุทธิ", money(totals.revenue), `${count(totals.orders)} ออเดอร์`, "accent"],
      ["รายจ่าย", money(totals.expenses), `${count(totals.expenseTransactions)} รายการ`, ""],
      ["คงเหลือก่อนต้นทุน", money(totals.net), "ยอดขายหักรายจ่าย", ""],
      ["เฉลี่ยต่อบิล", money(totals.averageOrder), "ต่อออเดอร์", ""],
      ["ส่วนลด", money(totals.discount), "ส่วนลดรวม", ""],
      ["ยกเลิก", count(totals.voidOrders), "ออเดอร์", ""]
    ].map(([label, value, note, type]) => `<article class="kpi ${type}"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join("");
    renderTrend(data.daily || []);
    renderBars($("#paymentBreakdown"), data.payments || [], "method", "amount", (value) => paymentNames[value] || value || "อื่น ๆ");
    renderBars($("#hourBreakdown"), data.hours || [], "sale_hour", "revenue", (value) => `${String(value).padStart(2, "0")}:00`);
    renderBars($("#channelBreakdown"), data.channels || [], "channel", "amount", (value) => channelNames[String(value || "").toLowerCase()] || value || "อื่น ๆ");
    renderBars($("#expenseBreakdown"), data.expenseCategories || [], "category", "amount");
    const products = data.products || [];
    $("#productRows").innerHTML = products.length ? products.map((row, index) => `<tr><td class="rank">${index + 1}</td><td>${escapeHtml(row.item_name)}</td><td class="num">${count(row.quantity)}</td><td class="num">${count(row.order_count)}</td><td class="num">${money(row.revenue)}</td></tr>`).join("") : '<tr><td colspan="5" class="muted">ยังไม่มีรายการขายในช่วงนี้</td></tr>';
    const orders = data.recentOrders || [];
    $("#orderRows").innerHTML = orders.length ? orders.map((row) => `<tr><td>${escapeHtml(row.order_no)}</td><td>${new Date(row.ordered_at).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${escapeHtml(paymentNames[String(row.payment_method || "").toLowerCase()] || row.payment_method || "อื่น ๆ")}</td><td class="num">${count(row.item_count)}</td><td class="num">${money(row.total_amount)}</td></tr>`).join("") : '<tr><td colspan="5" class="muted">ยังไม่มีออเดอร์ในช่วงนี้</td></tr>';
    const availability = data.available || {};
    $("#availability").textContent = availability.from ? `มีข้อมูลตั้งแต่ ${thaiDate(availability.from)} ถึง ${thaiDate(availability.to)}` : "สาขานี้ยังไม่มีข้อมูลยอดขายหรือรายจ่ายใน Supabase";
  }

  async function loadBranch() {
    clearError(); setLoading(true);
    const branch = new URLSearchParams(location.search).get("branch") || "BURGER";
    const current = new URL(location.href);
    current.searchParams.set("branch", branch);
    current.searchParams.set("from", $("#dateFrom").value);
    current.searchParams.set("to", $("#dateTo").value);
    current.searchParams.delete("preset");
    history.replaceState(null, "", current);
    try {
      const data = await rpc("get_branch_dashboard", { target_branch_code: branch, date_from: $("#dateFrom").value, date_to: $("#dateTo").value });
      renderBranch(data);
    } catch (error) { showError(error.message); }
    finally { setLoading(false); }
  }

  function initBranch() {
    const params = new URLSearchParams(location.search);
    const preset = params.get("preset") || "today";
    const [defaultFrom, defaultTo] = rangeForPreset(preset);
    $("#dateFrom").value = params.get("from") || defaultFrom;
    $("#dateTo").value = params.get("to") || defaultTo;
    const setActivePreset = (activeButton = null) => {
      $$('[data-preset]').forEach((item) => {
        const [from, to] = rangeForPreset(item.dataset.preset);
        item.classList.toggle("active", activeButton ? item === activeButton : $("#dateFrom").value === from && $("#dateTo").value === to);
      });
    };
    setActivePreset();
    $$("[data-preset]").forEach((button) => button.addEventListener("click", () => {
      const [from, to] = rangeForPreset(button.dataset.preset);
      $("#dateFrom").value = from; $("#dateTo").value = to;
      setActivePreset(button);
      loadBranch();
    }));
    $("#dateFrom").addEventListener("change", () => { setActivePreset(); loadBranch(); });
    $("#dateTo").addEventListener("change", () => { setActivePreset(); loadBranch(); });
    $("#refreshBtn").addEventListener("click", loadBranch);
    loadBranch();
  }

  document.addEventListener("DOMContentLoaded", () => mode === "branch" ? initBranch() : initAll());
})();

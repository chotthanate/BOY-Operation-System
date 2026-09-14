(() => {
  "use strict";
  const cfg = window.BOY_CENTRAL_CONFIG || {};
  const client = window.supabase.createClient(cfg.url, cfg.publishableKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const db = client.schema("boy_central");
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const money = (v) => `฿${Number(v || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })}`;
  let branch = null;
  let row = null;
  let config = {};
  let editingProductId = null;
  let editingPaymentId = null;
  let toastTimer;

  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600); }
  function setConnected(ok, label = ok ? "เชื่อม BOY Central แล้ว" : "เชื่อมต่อไม่สำเร็จ") { $("#syncPill").classList.toggle("online", ok); $("#syncPill b").textContent = label; }
  function products() { return Array.isArray(config.products) ? config.products : []; }
  function payments() { return Array.isArray(config.paymentMethods) ? config.paymentMethods : []; }
  function categories() { return Array.isArray(config.categories) ? config.categories : []; }

  async function start() {
    try {
      const { data: auth } = await client.auth.getSession();
      if (!auth.session) return;
      const branchResult = await db.from("branches").select("id,company_id,code,name").eq("code", "TAWANA").single();
      if (branchResult.error) throw branchResult.error;
      branch = branchResult.data;
      await loadConfig();
      await Promise.all([loadOverview(), loadStock(), loadDevices()]);
      setConnected(true);
    } catch (error) { console.error(error); setConnected(false); toast(error.message || "โหลดข้อมูลไม่สำเร็จ"); }
  }

  async function loadConfig() {
    const result = await db.from("pos_branch_configs").select("id,config,version,updated_at").eq("branch_id", branch.id).single();
    if (result.error) throw result.error;
    row = result.data; config = structuredClone(row.config || {});
    config.products ||= []; config.categories ||= []; config.paymentMethods ||= [];
    config.store ||= { name: "BOY ร้านน้ำ", branchName: branch.name, branchCode: branch.code };
    config.settings ||= {};
    renderConfig();
  }

  async function saveConfig() {
    collectSettings();
    const result = await db.from("pos_branch_configs").update({ config, version: Number(row.version || 0) + 1 }).eq("id", row.id).select("id,config,version,updated_at").single();
    if (result.error) throw result.error;
    row = result.data; config = structuredClone(result.data.config); setConnected(true, `บันทึกเวอร์ชัน ${row.version} แล้ว`); renderConfig(); toast("บันทึกข้อมูลกลางแล้ว POS จะรับในการซิงก์ครั้งถัดไป");
  }

  function renderConfig() {
    renderCatalog(); renderPayments();
    const s = config.settings || {}; const store = config.store || {};
    $("#storeName").value = store.name || ""; $("#branchName").value = branch?.name || store.branchName || "";
    ["businessDayStart", "vatRate", "vatPriceMode", "legalName", "taxId"].forEach((key) => { const el = $(`#${key}`); if (el) el.value = s[key] ?? (key === "vatRate" ? 7 : key === "vatPriceMode" ? "included" : ""); });
    ["vatEnabled", "requireOpeningCash", "requireClosingCash", "preventNegativeStock", "lowStockAlerts"].forEach((key) => { $(`#${key}`).checked = s[key] === true; });
  }

  function collectSettings() {
    config.store = { ...(config.store || {}), name: $("#storeName").value.trim() || "BOY ร้านน้ำ", branchName: branch.name, branchCode: branch.code };
    config.settings = { ...(config.settings || {}) };
    ["businessDayStart", "vatPriceMode", "legalName", "taxId"].forEach((key) => config.settings[key] = $(`#${key}`).value);
    config.settings.vatRate = Number($("#vatRate").value || 0);
    ["vatEnabled", "requireOpeningCash", "requireClosingCash", "preventNegativeStock", "lowStockAlerts"].forEach((key) => config.settings[key] = $(`#${key}`).checked);
  }

  function renderCatalog() {
    $("#categoryStrip").innerHTML = categories().map((name) => `<span>${esc(name)} · ${products().filter((p) => p.category === name).length}</span>`).join("");
    $("#categoryOptions").innerHTML = categories().map((name) => `<option value="${esc(name)}"></option>`).join("");
    $("#catalogList").innerHTML = products().map((p) => `<article class="catalog-row"><span class="thumb" style="background:${esc(p.color || "#fff1df")}">${esc(p.emoji || "🥤")}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${money(p.price)}</small></div><span class="status ${p.active === false ? "off" : ""}">${p.active === false ? "ปิดขาย" : "เปิดขาย"}</span><button class="row-action" data-edit-product="${esc(p.id)}">แก้ไข</button></article>`).join("") || `<article class="card">ยังไม่มีรายการขาย</article>`;
  }

  function openProduct(id = null) {
    const p = products().find((item) => item.id === id); editingProductId = p?.id || null;
    $("#productDialogTitle").textContent = p ? `แก้ไข ${p.name}` : "เพิ่มรายการขาย";
    $("#productName").value = p?.name || ""; $("#productPrice").value = p?.price ?? ""; $("#productCategory").value = p?.category || categories()[0] || ""; $("#productEmoji").value = p?.emoji || "🥤"; $("#productActive").checked = p?.active !== false;
    $("#productDialog").showModal();
  }

  function saveProductDraft() {
    const name = $("#productName").value.trim(); const price = Number($("#productPrice").value); const category = $("#productCategory").value.trim();
    if (!name || !category || !Number.isFinite(price) || price < 0) return toast("กรุณากรอกชื่อ ราคา และหมวดหมู่ให้ถูกต้อง");
    if (!categories().includes(category)) config.categories.push(category);
    const old = products().find((p) => p.id === editingProductId);
    const product = { ...(old || {}), id: old?.id || `water-${crypto.randomUUID?.() || Date.now()}`, name, price, category, emoji: $("#productEmoji").value.trim() || "🥤", color: old?.color || "#fff1df", active: $("#productActive").checked, optionGroups: old?.optionGroups || [] };
    if (old) Object.assign(old, product); else config.products.push(product);
    $("#productDialog").close(); renderCatalog(); toast("เก็บการแก้ไขแล้ว กดบันทึกทั้งหมดเพื่อส่งเข้า BOY Central");
  }

  function renderPayments() {
    const typeLabels = { cash: "เงินสด", transfer: "เงินโอน", government: "โครงการรัฐ", delivery: "Delivery", other: "อื่นๆ" };
    $("#paymentList").innerHTML = payments().map((p) => `<article class="payment-row">${p.image ? `<img class="payment-qr" src="${esc(p.image)}" alt="QR ${esc(p.label)}">` : `<span class="thumb">${esc(p.icon || "⌁")}</span>`}<div><strong>${esc(p.label)}</strong><small>${esc(typeLabels[p.type] || p.type)}${p.account ? ` · ${esc(p.account)}` : ""}${Number(p.feePercent || 0) ? ` · ค่าธรรมเนียม ${Number(p.feePercent)}%` : ""}${p.active === false ? " · ปิดใช้งาน" : ""}</small></div><div class="actions"><label class="row-action">${p.image ? "เปลี่ยน QR" : "เพิ่ม QR"}<input hidden type="file" accept="image/png,image/jpeg,image/webp" data-payment-image="${esc(p.id)}"></label><button class="row-action" data-edit-payment="${esc(p.id)}">แก้ไข</button></div></article>`).join("");
  }

  async function uploadPaymentImage(id, file) {
    if (!file || file.size > 5 * 1024 * 1024) return toast("รูปต้องมีขนาดไม่เกิน 5 MB");
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${branch.company_id}/${branch.id}/payments/${id}-${Date.now()}.${ext}`;
    const uploaded = await client.storage.from("boy-pos-assets").upload(path, file, { upsert: false, contentType: file.type });
    if (uploaded.error) throw uploaded.error;
    const { data } = client.storage.from("boy-pos-assets").getPublicUrl(path);
    const method = payments().find((p) => p.id === id); if (method) method.image = data.publicUrl;
    await saveConfig();
  }

  function openPaymentEditor(id = null) { const p = payments().find((item) => item.id === id); editingPaymentId = p?.id || null; $("#paymentDialogTitle").textContent = p ? `แก้ไข ${p.label}` : "เพิ่มช่องทางชำระเงิน"; $("#paymentName").value = p?.label || ""; $("#paymentType").value = p?.type || "other"; $("#paymentFee").value = p?.feePercent ?? 0; $("#paymentAccount").value = p?.account || ""; $("#paymentReference").checked = p?.requireReference === true; $("#paymentChange").checked = p?.canGiveChange === true; $("#paymentActive").checked = p?.active !== false; $("#deletePayment").hidden = !p; $("#paymentDialog").showModal(); }
  function savePaymentDraft() { const label = $("#paymentName").value.trim(); const fee = Number($("#paymentFee").value || 0); if (!label || !Number.isFinite(fee) || fee < 0 || fee > 100) return toast("กรุณากรอกชื่อและค่าธรรมเนียมให้ถูกต้อง"); const old = payments().find((p) => p.id === editingPaymentId); const entry = { ...(old || {}), id: old?.id || `pay-${Date.now()}`, label, type: $("#paymentType").value, feePercent: fee, account: $("#paymentAccount").value.trim(), icon: old?.icon || "⌁", requireReference: $("#paymentReference").checked, canGiveChange: $("#paymentChange").checked, active: $("#paymentActive").checked }; if (old) Object.assign(old, entry); else { config.paymentMethods ||= []; config.paymentMethods.push(entry); } $("#paymentDialog").close(); renderPayments(); toast("เก็บการแก้ไขแล้ว กดบันทึกทั้งหมดเพื่อส่งเข้า BOY Central"); }
  function deletePaymentDraft() { if (!editingPaymentId) return; config.paymentMethods = payments().filter((p) => p.id !== editingPaymentId); $("#paymentDialog").close(); renderPayments(); toast("นำช่องทางออกแล้ว กดบันทึกทั้งหมดเพื่อยืนยัน"); }

  async function loadOverview() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [ordersResult, eventsResult] = await Promise.all([
      db.from("pos_orders").select("id,total_amount,payment_method,payment_status,ordered_at").eq("branch_id", branch.id).eq("source_system", "water_pos").gte("ordered_at", start.toISOString()).order("ordered_at", { ascending: false }),
      db.from("pos_sync_events").select("event_type,status,external_id,received_at").eq("branch_id", branch.id).order("received_at", { ascending: false }).limit(8)
    ]);
    if (ordersResult.error) throw ordersResult.error; if (eventsResult.error) throw eventsResult.error;
    const valid = (ordersResult.data || []).filter((o) => o.payment_status === "completed"); const revenue = valid.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    const byMethod = {}; valid.forEach((o) => byMethod[o.payment_method || "other"] = (byMethod[o.payment_method || "other"] || 0) + Number(o.total_amount || 0));
    $("#metrics").innerHTML = [["ยอดขายวันนี้", money(revenue), "accent"], ["ออร์เดอร์สำเร็จ", `${valid.length} บิล`, ""], ["ยกเลิก/คืนเงิน", `${(ordersResult.data || []).length - valid.length} บิล`, ""], ["ซิงก์ล่าสุด", eventsResult.data?.[0] ? new Date(eventsResult.data[0].received_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "ยังไม่มี", ""]].map(([label, value, cls]) => `<article class="metric ${cls}"><span>${label}</span><strong>${value}</strong></article>`).join("");
    $("#paymentBreakdown").innerHTML = Object.entries(byMethod).map(([method, value]) => `<div><span>${esc(payments().find((p) => p.id === method)?.label || method)}</span><strong>${money(value)}</strong></div>`).join("") || `<small>ยังไม่มียอดขายจาก POS</small>`;
    $("#recentSync").innerHTML = (eventsResult.data || []).map((e) => `<div><span>${esc(e.event_type)}<small>${esc(e.external_id)}</small></span><strong>${new Date(e.received_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</strong></div>`).join("") || `<small>ยังไม่มีข้อมูลจากเครื่อง POS</small>`;
  }

  async function loadStock() {
    const itemsResult = await db.from("branch_items").select("item_id,minimum_stock,target_stock").eq("branch_id", branch.id).eq("active", true);
    if (itemsResult.error) throw itemsResult.error; const ids = (itemsResult.data || []).map((x) => x.item_id);
    if (!ids.length) { $("#stockList").innerHTML = `<article class="card">ยังไม่มีรายการสต็อกของสาขานี้</article>`; return; }
    const [master, balances] = await Promise.all([db.from("items").select("id,code,name,base_unit:units!items_base_unit_id_fkey(name)").in("id", ids), db.from("inventory_balances").select("item_id,quantity_on_hand").eq("branch_id", branch.id).in("item_id", ids)]);
    if (master.error) throw master.error; if (balances.error) throw balances.error;
    $("#stockList").innerHTML = (master.data || []).map((item) => { const branchItem = itemsResult.data.find((x) => x.item_id === item.id); const qty = Number(balances.data.find((x) => x.item_id === item.id)?.quantity_on_hand || 0); const unit = item.base_unit?.name || "หน่วย"; return `<article class="stock-card"><div><h3>${esc(item.name)}</h3><p>${esc(item.code)} · เตือนเมื่อ ≤ ${Number(branchItem.minimum_stock || 0).toLocaleString("th-TH")} ${esc(unit)}</p></div><strong>${qty.toLocaleString("th-TH")} ${esc(unit)}</strong></article>`; }).join("");
  }

  async function loadDevices() {
    const result = await db.from("pos_devices").select("id,device_code,device_name,status,last_seen_at,last_sync_at,app_version").eq("branch_id", branch.id).order("created_at", { ascending: false });
    if (result.error) throw result.error;
    $("#deviceList").innerHTML = (result.data || []).map((d) => `<article class="device-row"><span class="thumb">▣</span><div><strong>${esc(d.device_name)}</strong><small>${esc(d.device_code)} · ${d.last_sync_at ? `ซิงก์ ${new Date(d.last_sync_at).toLocaleString("th-TH")}` : "ยังไม่เคยซิงก์"}${d.app_version ? ` · v${esc(d.app_version)}` : ""}</small></div><span class="status ${d.status !== "active" ? "off" : ""}">${esc(d.status)}</span></article>`).join("") || `<article class="card">ยังไม่มีเครื่อง POS ที่เชื่อมแล้ว</article>`;
  }

  async function createPairing() {
    const result = await db.rpc("create_pos_pairing_code", { target_branch_id: branch.id, target_device_code: "WATER-TWN-POS-01", target_device_name: "เครื่องแคชเชียร์ 1" });
    if (result.error) throw result.error;
    const panel = $("#pairingResult"); panel.hidden = false; panel.innerHTML = `<span>รหัสเชื่อมเครื่อง (ใช้ได้ 15 นาที)</span><strong>${esc(result.data.pairing_code)}</strong><p>เปิด ตั้งค่า → ร้านและเครื่อง POS ที่เครื่องขาย แล้วกรอกรหัสนี้</p>`; await loadDevices();
  }

  $$("[data-tab]").forEach((button) => button.addEventListener("click", () => { $$("[data-tab]").forEach((b) => b.classList.toggle("active", b === button)); $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `${button.dataset.tab}Panel`)); }));
  document.addEventListener("click", (event) => { const edit = event.target.closest("[data-edit-product]"); if (edit) openProduct(edit.dataset.editProduct); const paymentEdit = event.target.closest("[data-edit-payment]"); if (paymentEdit) openPaymentEditor(paymentEdit.dataset.editPayment); });
  document.addEventListener("change", (event) => { const input = event.target.closest("[data-payment-image]"); if (input?.files?.[0]) uploadPaymentImage(input.dataset.paymentImage, input.files[0]).catch((e) => toast(e.message)); });
  $$("[data-save-config]").forEach((button) => button.addEventListener("click", () => saveConfig().catch((e) => toast(e.message))));
  $("#addProduct").addEventListener("click", () => openProduct()); $("#saveProduct").addEventListener("click", saveProductDraft); $("#addPayment").addEventListener("click", () => openPaymentEditor()); $("#savePayment").addEventListener("click", savePaymentDraft); $("#deletePayment").addEventListener("click", deletePaymentDraft);
  $("#refreshAll").addEventListener("click", () => Promise.all([loadOverview(), loadDevices()]).then(() => toast("อัปเดตข้อมูลแล้ว")).catch((e) => toast(e.message)));
  $("#refreshStock").addEventListener("click", () => loadStock().then(() => toast("อัปเดตยอดสต็อกแล้ว")).catch((e) => toast(e.message)));
  $("#createPairing").addEventListener("click", () => createPairing().catch((e) => toast(e.message)));
  start();
})();

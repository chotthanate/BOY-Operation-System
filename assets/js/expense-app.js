(() => {
  "use strict";
  const branches = window.BOY_BRANCHES.all.map(branch => ({ ...branch, path: branch.expensePath }));
  const uniqueNames = (rows) => [...new Map(rows.filter(Boolean).map(value => {
    const name = String(value.name || value).trim();
    return [name.toLocaleLowerCase("th"), name];
  }).filter(([, name]) => name)).values()];
  function onlySupplier(rows) {
    const names = uniqueNames(rows || []);
    return names.length === 1 ? names[0] : "";
  }
  function groupPayments(lines, defaultMethod = 'cash') {
    const groups = new Map();
    lines.forEach(line => {
      const method = line.payment_method || defaultMethod;
      if (!groups.has(method)) groups.set(method, []);
      groups.get(method).push(line);
    });
    return [...groups].map(([method, rows]) => ({ method, lines: rows }));
  }
  function mappedSuppliers(item, branch, links, suppliers, branchRows) {
    if (!item) return [];
    const masterBranch = (branchRows || []).find(row => row['รหัสสาขา'] === branch.code);
    const branchKeys = [branch.id, branch.code, masterBranch?.branch_id].filter(Boolean);
    return uniqueNames((links || []).filter(row => {
      const active = row.active ?? row['เปิดใช้งาน'];
      return active !== false && String(active).toUpperCase() !== 'FALSE'
        && [item.id, item.code].includes(row.item_id)
        && (!row.branch_id || branchKeys.includes(row.branch_id));
    }).map(row => (suppliers || []).find(supplier => [supplier.id, supplier.code, supplier.supplier_id].includes(row.supplier_id)))
      .filter(row => row && row.active !== false && row['เปิดใช้งาน'] !== false)
      .map(row => row.name || row['ชื่อผู้ขาย']));
  }
  function init(branchCode) {
    if (document.getElementById("expenseNavigation")) return;
    document.body.classList.add("expense-app");
    const dialog = document.createElement("dialog");
    dialog.id = "expenseNavigation";
    dialog.className = "expense-navigation";
    dialog.setAttribute("aria-labelledby", "expenseNavigationTitle");
    dialog.innerHTML = `<div class="expense-nav-heading"><div><small>BOY OPERATION</small><h2 id="expenseNavigationTitle">เลือกสาขา</h2></div><button type="button" data-expense-nav-close aria-label="ปิดเมนู">×</button></div><nav aria-label="เลือกสาขา"><div class="expense-nav-label">สาขา</div>${branches.map(branch => `<a href="${branch.path}" ${branch.code === branchCode ? 'aria-current="page"' : ""}><span>${branch.mark}</span><strong>${branch.name}</strong>${branch.code === branchCode ? '<b aria-hidden="true">✓</b>' : ""}</a>`).join("")}<div class="expense-nav-label">เมนูอื่น</div><a href="index.html"><span>⌂</span><strong>หน้าหลัก</strong></a><a href="dashboard.html"><span>▥</span><strong>Dashboard รวม</strong></a><a href="master-data.html?entity=items"><span>▦</span><strong>ข้อมูลกลาง</strong></a></nav>`;
    document.body.appendChild(dialog);
    dialog.querySelector("[data-expense-nav-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog && event.clientX >= dialog.getBoundingClientRect().right) dialog.close(); });
    dialog.addEventListener("close", () => document.querySelector("[data-expense-menu]")?.setAttribute("aria-expanded", "false"));
    dialog.querySelectorAll("a").forEach(link => link.addEventListener("click", () => {
      // Flush the current field to the existing branch draft before navigating.
      document.activeElement?.blur();
      window.dispatchEvent(new Event("expense-before-navigate"));
    }));
    if (new URLSearchParams(location.search).get('mode') === 'test') dialog.querySelectorAll('nav a').forEach(link => {
      const url = new URL(link.href);
      url.searchParams.set('mode', 'test');
      link.href = url.href;
    });
  }
  function toggleMenu() {
    const dialog = document.getElementById("expenseNavigation");
    if (!dialog) return;
    if (dialog.open) dialog.close();
    else { dialog.showModal(); document.querySelector("[data-expense-menu]")?.setAttribute("aria-expanded", "true"); }
  }
  window.BOY_EXPENSE_APP = { branches, uniqueNames, onlySupplier, groupPayments, mappedSuppliers, init, toggleMenu };
})();

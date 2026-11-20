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
  function groupPurchases(lines, defaultMethod = 'cash') {
    const groups = new Map();
    lines.forEach(line => {
      const method=line.payment_method||defaultMethod;
      const receiving_mode=line.receiving_mode==='delivery'?'delivery':'immediate';
      const key=method+':'+receiving_mode+':'+(line.is_investment?'capital':'operating');
      if(!groups.has(key))groups.set(key,{method,receiving_mode,lines:[]});
      groups.get(key).lines.push(line);
    });
    return [...groups.values()];
  }
  const expenseRpcName=payload=>Object.prototype.hasOwnProperty.call(payload,'receiving_mode')?'record_expense_v4':'record_expense_v3';
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
    dialog.innerHTML = `<div class="expense-nav-heading"><div><small>BOY OPERATION</small><h2 id="expenseNavigationTitle">เลือกสาขา</h2></div><button type="button" data-expense-nav-close aria-label="ปิดเมนู">×</button></div><nav aria-label="เลือกสาขา"><div class="expense-nav-label">สาขา</div>${branches.map(branch => `<a href="${branch.path}" ${branch.code === branchCode ? 'aria-current="page"' : ""}><span>${branch.mark}</span><strong>${branch.name}</strong>${branch.code === branchCode ? '<b aria-hidden="true">✓</b>' : ""}</a>`).join("")}<div class="expense-nav-label">เมนูอื่น</div><a href="investments.html?branch=${encodeURIComponent(branchCode)}"><span>▤</span><strong>เงินลงทุนและโครงการ</strong></a><a href="index.html"><span>⌂</span><strong>หน้าหลัก</strong></a><a href="dashboard.html"><span>▥</span><strong>Dashboard รวม</strong></a><a href="master-data.html?entity=items"><span>▦</span><strong>ข้อมูลกลาง</strong></a></nav>`;
    document.body.appendChild(dialog);
    dialog.querySelector('nav').insertAdjacentHTML('beforeend','<a href="reimbursements.html"><span>฿</span><strong>รอเบิกค่าใช้จ่าย</strong></a>');
    dialog.querySelector("[data-expense-nav-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog && event.clientX >= dialog.getBoundingClientRect().right) dialog.close(); });
    dialog.addEventListener("close", () => document.querySelector("[data-expense-menu]")?.setAttribute("aria-expanded", "false"));
    dialog.querySelectorAll("a").forEach(link => link.addEventListener("click", async event => {
      // Flush the current field to the existing branch draft before navigating.
      document.activeElement?.blur();
      window.dispatchEvent(new Event("expense-before-navigate"));
      if(window.BOY_DAILY_STORE){
        event.preventDefault();
        try{await window.BOY_DAILY_STORE.flushLocalDraft();}
        catch(error){if(!confirm('ร่างยังส่งฐานกลางไม่สำเร็จ แต่เก็บไว้ในเครื่องแล้ว ต้องการไปหน้าถัดไปหรือไม่?\n'+error.message))return;}
        location.href=link.href;
      }
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
  const investmentCategories={construction:'ก่อสร้าง / ตกแต่ง',utilities:'ระบบไฟ / น้ำ',equipment:'อุปกรณ์ร้าน',furniture:'เฟอร์นิเจอร์',other:'อื่น ๆ'};
  const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function investmentFields(line={}){
    const selected=line?.is_investment||line?.expense_class==='capital'||(!Object.keys(line||{}).length&&new URLSearchParams(location.search).get('investment')==='1');
    return `<details class="investment-fields" ${selected?'open':''}><summary>รายการพิเศษ${selected?' · เงินลงทุน':''}</summary><label class="investment-toggle"><input type="checkbox" class="is-investment" data-field="is_investment" ${selected?'checked':''} onchange="this.closest('.investment-fields').querySelector('.investment-details').hidden=!this.checked;window.doSync?.()"><span>เงินลงทุน / ก่อสร้าง</span></label><div class="investment-details" ${selected?'':'hidden'}><label>โครงการ<input class="investment-project" data-field="project_name" maxlength="160" value="${escape(line?.project_name)}" placeholder="ชื่อโครงการ" onchange="window.doSync?.()"></label><label>หมวดลงทุน<select class="investment-category" data-field="investment_category" onchange="window.doSync?.()"><option value="">เลือกหมวดลงทุน</option>${Object.entries(investmentCategories).map(([key,label])=>`<option value="${key}" ${line?.investment_category===key?'selected':''}>${label}</option>`).join('')}</select></label></div></details>`;
  }
  let categoryAdapter=null;
  const addCategoryOption=kind=>`<option value="__add_category__">＋ เพิ่มประเภท${kind==='main'?'หลัก':'ย่อย'}…</option>`;
  function configureCategories(adapter){categoryAdapter=adapter;}
  function categorySelectKind(select){return select.matches('.exp-main-type,.main-type,[data-field="category_id"]')?'main':select.matches('.exp-sub-type,.sub-type,[data-field="subcategory_id"]')?'sub':null;}
  async function openCategoryDialog(select,kind){
    if(!categoryAdapter)throw new Error('ระบบหมวดหมู่ยังไม่พร้อม');
    const row=select.closest('.swipe-wrapper,.expense-row,.expense-card');
    const parentSelect=row?.querySelector('.exp-main-type,.main-type,[data-field="category_id"]');
    const categories=await categoryAdapter.categories();
    const parent=categories.find(c=>!c.parent_id&&(c.id===parentSelect?.value||c.name===parentSelect?.value));
    if(kind==='sub'&&!parent)throw new Error('เลือกประเภทหลักก่อนเพิ่มประเภทย่อย');
    document.querySelector('#expenseCategoryDialog')?.remove();
    const dialog=document.createElement('dialog');dialog.id='expenseCategoryDialog';dialog.className='expense-category-dialog';
    const scope=categoryAdapter.branchCode==='GRILL'?'grill':categoryAdapter.branchCode==='BURGER'?'burger':'water';
    dialog.innerHTML=`<form><header><h2>เพิ่มประเภท${kind==='main'?'หลัก':'ย่อย'}</h2><button type="button" data-close aria-label="ปิด">×</button></header>${parent&&kind==='sub'?`<p>${escape(parent.name)}</p>`:''}<label>ชื่อประเภท<input name="name" required maxlength="120" autocomplete="off"></label><fieldset><legend>ใช้กับร้าน</legend>${[['water','ร้านน้ำ'],['grill','ร้านเนื้อย่าง'],['burger','ร้านเบอร์เกอร์']].map(([v,l])=>`<label class="scope-choice"><input type="checkbox" name="scope" value="${v}" ${v===scope?'checked':''}>${l}</label>`).join('')}</fieldset><small>ไม่เลือก = ใช้ร่วมกันทุกร้าน</small><p class="category-error" role="alert"></p><footer><button type="button" data-close>ยกเลิก</button><button type="submit">บันทึกประเภท</button></footer></form>`;
    document.body.appendChild(dialog);dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dialog.close());
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const submit=dialog.querySelector('[type="submit"]'),error=dialog.querySelector('.category-error');submit.disabled=true;error.textContent='';
      try{const result=await categoryAdapter.rpc('create_expense_category',{payload:{branch_code:categoryAdapter.branchCode,kind,name:dialog.querySelector('[name="name"]').value.trim(),parent_id:parent?.id||null,store_types:[...dialog.querySelectorAll('[name="scope"]:checked')].map(x=>x.value)}});
        await categoryAdapter.onCreated(result,{kind,row,lineId:row?.dataset.lineId});dialog.close();if(!result.categories.some(c=>c.id===result.id))alert('บันทึกประเภทแล้ว ประเภทนี้ไม่ได้เลือกใช้กับร้านปัจจุบัน');
      }catch(e){error.textContent=e.message||'บันทึกไม่สำเร็จ';}finally{submit.disabled=false;}
    };dialog.showModal();dialog.querySelector('[name="name"]').focus();
  }
  if(typeof document!=='undefined'){
    document.addEventListener('focusin',event=>{const s=event.target;if(s.tagName==='SELECT'&&categorySelectKind(s))s.dataset.beforeAdd=s.value;});
    document.addEventListener('change',event=>{const s=event.target;if(s.tagName!=='SELECT')return;const kind=categorySelectKind(s);if(!kind)return;
      if(s.value!=='__add_category__'){s.dataset.beforeAdd=s.value;return;}
      event.stopImmediatePropagation();s.value=s.dataset.beforeAdd||'';openCategoryDialog(s,kind).catch(e=>alert(e.message));
    },true);
  }
  function readInvestment(row){return row.querySelector('.is-investment')?.checked?{expense_class:'capital',project_name:row.querySelector('.investment-project')?.value.trim()||'',investment_category:row.querySelector('.investment-category')?.value||''}:{};}
  window.BOY_EXPENSE_APP = { branches, uniqueNames, onlySupplier, groupPayments, groupPurchases, expenseRpcName, mappedSuppliers, init, toggleMenu,investmentFields,readInvestment,investmentCategories,addCategoryOption,configureCategories };
})();

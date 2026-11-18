(()=>{
 'use strict';
 const $=s=>document.querySelector(s),config=window.BOY_CENTRAL_CONFIG;
 const db=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,...(window.BOY_SESSION_STORAGE?{storage:window.BOY_SESSION_STORAGE.storage}:{})}});
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
 let rows=[];
 $('#branch').innerHTML=window.BOY_BRANCHES.all.map(b=>`<option value="${esc(b.code)}">${esc(b.name)}</option>`).join('');
 $('#branch').value=new URLSearchParams(location.search).get('branch')||'BIGC-SOUTH-PATTAYA';
 $('#month').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).slice(0,7);
 function render(){const q=$('#search').value.trim().toLowerCase();$('#rows').innerHTML=rows.filter(r=>JSON.stringify([r.description,r.investment_details]).toLowerCase().includes(q)).map(r=>`<article class="investment-row"><strong>${esc(r.description)} · ฿${money(r.line_total)}</strong><span>${esc(r.investment_details?.project_name)}</span><span class="muted">${esc(r.transaction_date)} · ${esc(window.BOY_EXPENSE_APP.investmentCategories[r.investment_details?.category])} · ${esc(r.supplier_name_raw||'')}</span></article>`).join('')||'<p>ไม่พบรายการลงทุน</p>';}
 async function load(){
  const button=$('button[type="submit"]');button.disabled=true;$('#error').textContent='';
  try{
   const {data:{session}}=await db.auth.getSession();if(!session){location.href='burger.html?online=1&next='+encodeURIComponent('investments.html'+location.search);return;}
   const [year,month]=$('#month').value.split('-').map(Number),end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
   const {data,error}=await db.schema('boy_central').rpc('get_investment_report',{target_branch_code:$('#branch').value,date_from:$('#month').value+'-01',date_to:end});if(error)throw error;
   rows=data.rows||[];$('#summary').textContent=`เงินลงทุน ฿${money(data.total)} · ${data.count} รายการ`;render();
   const b=window.BOY_BRANCHES.all.find(b=>b.code===$('#branch').value);$('#add').href=(b?.expensePath||'expenses.html')+((b?.expensePath||'').includes('?')?'&':'?')+'investment=1';
  }catch(e){$('#error').textContent=e.message;rows=[];render();$('#summary').textContent='โหลดไม่สำเร็จ';}finally{button.disabled=false;}
 }
 $('#filters').onsubmit=e=>{e.preventDefault();load();};$('#search').oninput=render;load();
})();

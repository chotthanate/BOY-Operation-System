// Isolated screen fixture: no requests reach a real service.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
const catalog={version:'fixture',items:[{id:'fruit',code:'ITEM-1',name:'แตงโม',category_id:'cat',subcategory_id:'sub',base_unit_id:'kg'},{id:'shipping',expense_item_id:'shipping',code:'EXP-1',name:'ค่าขนส่ง',category_id:'cat',subcategory_id:'sub'}],units:[{id:'kg',name:'กก.'}],categories:[{id:'cat',name:'วัตถุดิบ',parent_id:null,category_type:'item'},{id:'sub',name:'ผลไม้',parent_id:'cat',category_type:'item'}],item_units:[{item_id:'fruit',unit_id:'kg',purchase:true,conversion:1}],suppliers:[{id:'supplier',name:'ผู้ขายเดียว'}],item_suppliers:[{item_id:'fruit',supplier_id:'supplier'}]};
async function setup(browser,branch,width,seed={}){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({cat,branch,seed})=>{
  window.__calls=[];window.__saved=[];window.__rev=0;window.__income=null;window.__draft={};window.__fail=false;
  window.confirm=()=>true;for(const [k,v] of Object.entries(seed))localStorage.setItem(k,JSON.stringify(v));
  const manual=['TAWANA','BIGC-CENTRAL-PATTAYA'].includes(branch);
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}}})},schema:()=>({rpc:async(name,args)=>{
   window.__calls.push({name,args});const p=args.payload;
   if(name==='get_daily_catalog')return{data:cat};
   if(name==='create_expense_category'){const created={id:'created-sub',name:p.name,parent_id:p.parent_id,category_type:'item'};cat.categories.push(created);return{data:{...created,categories:cat.categories}};}
   if(name==='get_finance_entry_workspace')return{data:{branch_id:'branch',revision:window.__rev,data:window.__draft,revenue_mode:manual?'manual':'pos_shift'}};
   if(name==='save_finance_entry_draft'){if(p.expected_revision!==window.__rev)return{error:{code:'P0001',message:'ร่างถูกแก้จากอีกเครื่อง'}};window.__draft=p.data;return{data:{revision:++window.__rev}};}
   if(name==='record_finance_expenses'){if(window.__fail){window.__fail=false;return{error:{message:'Network request failed'}};}window.__saved.push(p);window.__draft={};return{data:{status:'Success',draft_revision:++window.__rev,transaction_ids:['fixture']}};}
   if(name==='save_branch_manual_income'){window.__income={cash:p.cash,transfer:p.transfer,government:p.government,other:p.other,revision:(window.__income?.revision||0)+1};return{data:{status:'Success',income:window.__income}};}
   if(name==='get_branch_finance_day')return{data:{income:window.__income,revenue_mode:manual?'manual':'pos_shift',pos_income:100,expenses:window.__saved.filter(p=>p.date===args.target_date).map((p,i)=>({id:String(i),status:'confirmed',total_amount:p.lines.reduce((n,x)=>n+x.line_total,0),receiving_status:p.lines[0].receiving_mode==='delivery'?'pending':'received',lines:p.lines.map(x=>({description:x.description,amount:x.line_total,quantity:x.quantity,unit:'กก.',supplier:x.supplier_name}))}))}};
   throw Error('unmocked rpc '+name);
  }})})};
 },{cat:catalog,branch,seed});
 await page.route('**/*',r=>{
  const u=new URL(r.request().url());if(u.origin!=='https://entry.fixture')return r.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return r.fulfill({body:"window.BOY_AUTH_CONTEXT={user:{id:'owner'}};window.BOY_AUTH_SCREEN?.ready();document.querySelector('#boyAuthPendingStyle')?.remove();document.querySelector('#boyAuthFallback')?.remove();",contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-central-config.js'))return r.fulfill({body:"window.BOY_CENTRAL_CONFIG={url:'https://fixture.invalid',publishableKey:'public-fixture'}",contentType:'text/javascript'});
  const file=path.join(root,u.pathname);if(!file.startsWith(root)||!fs.existsSync(file))return r.fulfill({status:404,body:''});
  return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('https://entry.fixture/expenses.html?branch='+branch);await page.waitForFunction(()=>window.BOY_FINANCE_ENTRY?.state.catalog&&document.querySelector('.expense-card'),null,{timeout:5000}).catch(async e=>{console.error(errors,await page.locator('#entryNotice').textContent(),await page.evaluate(()=>window.__calls));throw e;});
 return{page,errors};
}
async function fill(page){
 await page.locator('[data-product]').fill('แตงโม');await page.locator('[data-product]').press('Tab');
 await page.locator('[data-field="quantity"]').fill('2');await page.locator('[data-field="line_total"]').fill('100');await page.locator('[data-field="receiving_mode"]').selectOption('delivery');
 assert.equal(await page.locator('[data-field="supplier_name"]').inputValue(),'ผู้ขายเดียว');assert.equal(await page.locator('[data-field="subcategory_id"]').inputValue(),'sub');
}
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const branch of ['TAWANA','BURGER','GRILL','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA'])for(const width of [390,1440]){
  const{page,errors}=await setup(browser,branch,width),today=await page.locator('#entryDate').inputValue();
  assert.equal(await page.locator('#incomeCard').isVisible(),['TAWANA','BIGC-CENTRAL-PATTAYA'].includes(branch));
  await fill(page);await page.locator('#entryDate').fill('2099-06-01');await page.locator('#entryDate').press('Tab');assert.equal(await page.locator('[data-field="line_total"]').inputValue(),'100');
  await page.locator('.entry-line-done').click();assert.equal(await page.locator('.entry-line-body').isVisible(),false);await page.locator('.entry-line-toggle').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,branch+' overflow '+width);
  await page.screenshot({path:'/private/tmp/finance-entry-'+branch+'-'+width+'.png',fullPage:true});
  await page.locator('#saveExpenses').click();await page.locator('#confirmEntrySave').click();await page.waitForFunction(()=>window.__saved.length===1);
  assert.equal(await page.locator('#entryDate').inputValue(),today);assert.equal(await page.locator('[data-product]').inputValue(),'');
  assert.equal(await page.evaluate(()=>__saved[0].lines[0].receiving_mode),'delivery');
  assert.equal(await page.evaluate(()=>__saved[0].lines[0].supplier_id),'supplier');
  await fill(page);await page.locator('#saveExpenses').click();await page.locator('#confirmEntrySave').click();await page.waitForFunction(()=>window.__saved.length===2);
  if(['TAWANA','BIGC-CENTRAL-PATTAYA'].includes(branch)){
   await page.locator('#incomeCash').fill('500');await page.locator('#saveIncome').click();await page.waitForFunction(()=>document.querySelector('#incomeCard').classList.contains('saved'));
   assert.equal(await page.locator('#incomeFields').isVisible(),false);assert.equal(await page.evaluate(()=>__saved.length),2);
   await page.locator('#incomeHeading').click();await page.locator('#incomeCash').fill('600');await page.locator('#saveIncome').click();await page.waitForFunction(()=>window.__income.cash===600);assert.equal(await page.evaluate(()=>__saved.length),2);
  }
  await page.locator('[data-view="history"]').click();await page.locator('#historyDate').fill('2099-06-01');await page.locator('#reloadDay').click();await page.locator('.day-bill').waitFor();
  assert.equal(await page.locator('.day-bill li').count(),1);assert.match(await page.locator('.day-bill').textContent(),/แตงโม/);
  await page.locator('[data-view="entry"]').click();assert.equal(await page.locator('[data-product]').inputValue(),'');
  await page.locator('#branchMenu').click();assert.equal(await page.locator('#expenseNavigation a[href^="expenses.html?branch="]').count(),5);
  assert.deepEqual(errors,[]);await page.close();console.log(branch+' '+width+': separate saves, posting date, delivery, history and layout passed');
 }
 let{page}=await setup(browser,'GRILL',390);await fill(page);await page.evaluate(()=>window.__fail=true);
 await page.locator('#saveExpenses').click();await page.locator('#confirmEntrySave').click();await page.waitForFunction(()=>document.querySelector('#saveExpenses').textContent.includes('ลองส่ง'));
 assert.equal(await page.locator('#entryLines').getAttribute('inert'),'');const first=await page.evaluate(()=>__calls.find(x=>x.name==='record_finance_expenses').args.payload);
 await page.locator('#confirmEntrySave').click();await page.waitForFunction(()=>__saved.length===1);assert.deepEqual(await page.evaluate(()=>__saved[0]),first);await page.close();
 console.log('network: durable exact retry passed');
 ({page}=await setup(browser,'GRILL',390));await fill(page);
 await page.locator('[data-field="subcategory_id"]').selectOption('__add_category__');await page.locator('#expenseCategoryDialog [name="name"]').fill('เพิ่มจากฟอร์ม');
 await page.locator('#expenseCategoryDialog [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('[data-field="subcategory_id"]').value==='created-sub');
 await page.locator('.investment-fields summary').click();await page.locator('.is-investment').check();await page.locator('.investment-project').fill('โครงการทดสอบ');await page.locator('.investment-category').selectOption('construction');
 assert.equal(await page.evaluate(()=>BOY_FINANCE_ENTRY.payloadLines()[0].expense_class),'capital');
 await page.locator('.is-investment').uncheck();assert.equal(await page.evaluate(()=>BOY_FINANCE_ENTRY.payloadLines()[0].expense_class),'operating');
 assert.equal(await page.evaluate(()=>BOY_FINANCE_ENTRY.payloadLines()[0].subcategory_id),'created-sub');
 await page.close();console.log('inline category ID and investment enable/disable payloads passed');
 const seed={'BOY_ENTRY_V1:TAWANA:owner:draft':{revision:-1,dirty:true,data:{date:'2099-01-01',lines:[{id:'old',description:'ร่างห้ามหาย',line_total:20}]}},'BOY_TAWANA_DRAFT_2099-01-01':{exp:[{i:'เก่าห้ามหาย'}]}};
 ({page}=await setup(browser,'TAWANA',390,seed));assert.equal(await page.locator('#recoveryPanel').isVisible(),true);assert.equal(await page.locator('#legacyRecovery').isVisible(),true);assert.equal(await page.locator('[data-product]').inputValue(),'ร่างห้ามหาย');
 await page.locator('#useCloudDraft').click();await page.waitForFunction(()=>document.querySelector('#recoveryPanel').hidden);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('BOY_ENTRY_V1:TAWANA:owner:backups'))[0].data.lines[0].description),'ร่างห้ามหาย');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('BOY_TAWANA_DRAFT_2099-01-01')).exp[0].i),'เก่าห้ามหาย');await page.close();console.log('conflict: backup and untouched legacy draft passed');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

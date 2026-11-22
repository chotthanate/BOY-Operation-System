// Isolated UI fixture: no requests reach Supabase or Google Sheets.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const catalog={version:'fixture',items:[{id:'fruit-id',code:'ITEM-1',name:'แตงโม',category_id:'cat',subcategory_id:'sub',main:'บรรจุภัณฑ์เก่า',sub:'ชื่อเก่า',base_unit_id:'kg',track_stock:true},{id:'expense-id',expense_item_id:'expense-id',code:'ITEM-EXP',name:'ค่าเช่า',category_id:'cat',main:'วัตถุดิบ',track_stock:false}],units:[{id:'kg',name:'กก.'}],categories:[{id:'cat',name:'วัตถุดิบ',parent_id:null},{id:'sub',name:'ผลไม้',parent_id:'cat'}],item_units:[{item_id:'fruit-id',unit_id:'kg',conversion:1,purchase:true}],suppliers:[],item_suppliers:[]};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{for(const name of ['tawana','bigc'])for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(c=>{
   window.__calls=[];
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'owner'}}}})},schema:()=>({rpc:async(name,args)=>{window.__calls.push({name,args});return{data:name==='get_daily_catalog'?c:name==='get_daily_document'?{revision:0,draft_revision:0,draft:'{}'}:{status:'Success',revision:1}}}})})};
  },catalog);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});
   if(u.pathname.endsWith('boy-auth-guard.js'))return route.fulfill({body:"window.BOY_AUTH_SCREEN?.ready();document.querySelector('#boyAuthPendingStyle')?.remove();",contentType:'text/javascript'});
   if(u.pathname.endsWith('boy-central-config.js'))return route.fulfill({body:"window.BOY_CENTRAL_CONFIG={financeCutover:true,url:'https://example.invalid',publishableKey:'fixture'};",contentType:'text/javascript'});
   const file=path.join(root,u.pathname);if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto(`http://fixture.local/${name}.html?legacy=1`);await page.waitForFunction(()=>window.BOY_DAILY_STORE&&typeof itemMetaDict!=='undefined'&&Object.keys(itemMetaDict).length>0);
  await page.evaluate(()=>window.BOY_EXPENSE_APP.toggleMenu());
  assert.equal(await page.locator('#expenseNavigation a[href="reimbursements.html"]').isVisible(),true);
  await page.locator('#expenseNavigation [data-expense-nav-close]').click();
  if(name==='tawana'){
   const result=await page.evaluate(async()=>{
    let confirmations=0,submissions=0;const oldSubmit=submitToSheet,oldConfirm=window.confirm;
    document.getElementById('val-transfer').value='';window.confirm=()=>{confirmations++;return false;};submitToSheet=async()=>{submissions++;};
    await confirmSubmitReview();const cancelled=submissions===0;window.confirm=()=>{confirmations++;return true;};await confirmSubmitReview();
    submitToSheet=oldSubmit;window.confirm=oldConfirm;return{confirmations,submissions,cancelled};
   });
   assert.deepEqual(result,{confirmations:2,submissions:1,cancelled:true});
  }
  await page.evaluate(()=>{
   const identity={item_id:'fruit-id',receiving_mode:'delivery'};
   if(location.pathname.endsWith('tawana.html'))addRow('แตงโม',2,'กก.',100,'วัตถุดิบ','','','','cash',identity);
   else addRow('แตงโม',2,'กก.',100,'','cash','วัตถุดิบ','',identity);
  });
  const mode=page.locator('.receiving-mode').last();
  assert.equal(await mode.inputValue(),'delivery');
  await page.evaluate(()=>{
   const row=document.querySelectorAll(location.pathname.endsWith('tawana.html')?'.swipe-wrapper':'.expense-row');
   row[row.length-1].classList.add('expanded');
  });
  assert.equal(await mode.isVisible(),true);
  assert.equal(await page.locator(name==='tawana'?'.exp-sub-type':'.sub-type').last().inputValue(),'ผลไม้');
  await page.evaluate(()=>checkAutoFill([...document.querySelectorAll(location.pathname.endsWith('tawana.html')?'.i':'.item')].at(-1)));
  assert.equal(await page.locator(name==='tawana'?'.exp-sub-type':'.sub-type').last().inputValue(),'ผลไม้');
  const snapshot=await page.evaluate(()=>location.pathname.endsWith('tawana.html')?collectFormDataSnapshot():collectSnapshot());
  assert.equal(snapshot.exp.at(-1).item_id,'fruit-id');assert.equal(snapshot.exp.at(-1).receiving_mode,'delivery');
  await page.locator('.investment-fields summary').last().click();
  await page.locator('.is-investment').last().check();
  await page.locator('.investment-project').last().fill('เปิดร้านทดสอบ');
  await page.locator('.investment-category').last().selectOption('construction');
  const investment=await page.evaluate(()=>location.pathname.endsWith('tawana.html')?collectFormDataSnapshot():collectSnapshot());
  assert.equal(investment.exp.at(-1).expense_class,'capital');assert.equal(investment.exp.at(-1).project_name,'เปิดร้านทดสอบ');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflow at ${width}`);
  await page.screenshot({path:`/private/tmp/boy-${name}-${width}.png`,fullPage:true});
  await page.evaluate(()=>{
   const identity={expense_item_id:'expense-id'};
   if(location.pathname.endsWith('tawana.html'))addRow('ค่าเช่า','','',500,'วัตถุดิบ','','','','cash',identity);
   else addRow('ค่าเช่า','','',500,'','cash','วัตถุดิบ','',identity);
  });
  assert.equal(await page.locator('.receiving-mode-field').last().getAttribute('hidden'),'');
  assert.deepEqual(errors,[],`${name} page errors`);
  await page.evaluate(()=>doSync());
  const draftKey=await page.evaluate(n=>(n==='tawana'?'BOY_TAWANA_DRAFT_':'BOY_BIGC_EXPENSE_DRAFT_')+document.getElementById('mainDate').value,name),draftBefore=await page.evaluate(k=>localStorage.getItem(k),draftKey);
  await page.evaluate(n=>n==='tawana'?unlockEditMode():unlockDate(),name);await page.waitForURL('**/expenses.html?branch=**&view=history&date=**');
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),draftKey),draftBefore,'history navigation must not discard the old draft');
  await page.close();
  console.log(`${name} ${width}: identity, receiving mode and layout passed`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

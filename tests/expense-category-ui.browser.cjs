const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){for(const form of ['tawana','bigc','burger']){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://fixture.local/**',r=>r.fulfill({body:`<!doctype html><style>*{box-sizing:border-box}body{margin:16px;font-family:Arial}.card{max-width:600px;margin:auto}select{min-height:44px;font-size:16px;width:100%}</style><style>${fs.readFileSync(path.join(root,'assets/css/expense-app.css'),'utf8')}</style><div class="card expense-app"><div id="sample"></div></div>`,contentType:'text/html'}));
 await page.goto('http://fixture.local/');await page.addScriptTag({content:fs.readFileSync(path.join(root,'assets/js/boy-branches.js'),'utf8')});await page.addScriptTag({content:fs.readFileSync(path.join(root,'assets/js/expense-app.js'),'utf8')});
 await page.evaluate(form=>{
  window.__calls=[];window.__created=null;window.__fail=true;window.doSync=()=>{};
  const classes=form==='tawana'?['swipe-wrapper','exp-main-type','exp-sub-type']:form==='bigc'?['expense-row','main-type','sub-type']:['expense-card','',''];
  document.querySelector('#sample').innerHTML=`<article class="${classes[0]}" data-line-id="line1">${BOY_EXPENSE_APP.investmentFields({expense_class:'operating'})}<label>ประเภทหลัก<select class="${classes[1]}" data-field="category_id"><option value="M1">วัตถุดิบ</option>${BOY_EXPENSE_APP.addCategoryOption('main')}</select></label><label>ประเภทย่อย<select class="${classes[2]}" data-field="subcategory_id"><option value="">เลือก</option>${BOY_EXPENSE_APP.addCategoryOption('sub')}</select></label><label class="receiving-mode-field">การรับสินค้า<select><option value="immediate">รับสินค้าทันที</option><option value="delivery">รอจัดส่ง</option></select></label></article>`;
  BOY_EXPENSE_APP.configureCategories({branchCode:'GRILL',categories:async()=>[{id:'M1',name:'วัตถุดิบ',parent_id:null}],rpc:async(name,args)=>{__calls.push({name,args});if(__fail){__fail=false;throw Error('ลองใหม่: การเชื่อมต่อขัดข้อง');}return{id:'NEW',name:args.payload.name,main_name:'วัตถุดิบ',parent_id:'M1',code:'SUB-NEW',categories:[{id:'NEW'}]};},onCreated:async(r,c)=>{__created={result:r,kind:c.kind,lineId:c.lineId};}});
 },form);
 const details=page.locator('.investment-fields');assert.equal(await details.getAttribute('open'),null);assert.ok((await details.boundingBox()).height<=38);
 await page.locator('[data-field="subcategory_id"]').focus();await page.locator('[data-field="subcategory_id"]').selectOption('__add_category__');
 await page.locator('#expenseCategoryDialog').waitFor({state:'visible'});assert.equal(await page.locator('[name="scope"][value="grill"]').isChecked(),true);
 if(form==='burger')await page.screenshot({path:`/private/tmp/boy-expense-category-dialog-${width}.png`,fullPage:false});
 await page.locator('[name="name"]').fill('หมวดใหม่ทดสอบ');await page.getByRole('button',{name:'บันทึกประเภท',exact:true}).click();await page.getByRole('alert').filter({hasText:'ลองใหม่'}).waitFor();
 assert.equal(await page.locator('#expenseCategoryDialog').isVisible(),true);await page.getByRole('button',{name:'บันทึกประเภท',exact:true}).click();await page.locator('#expenseCategoryDialog').waitFor({state:'hidden'});
 const proof=await page.evaluate(()=>({calls:__calls,created:__created}));assert.equal(proof.calls[0].name,'create_expense_category');assert.equal(proof.calls[0].args.payload.parent_id,'M1');assert.deepEqual(proof.calls[1].args.payload.store_types,['grill']);assert.equal(proof.created.kind,'sub');
 await page.locator('.receiving-mode-field select').selectOption('delivery');assert.equal(await page.locator('.receiving-mode-field select').inputValue(),'delivery');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 if(form==='burger')await page.screenshot({path:`/private/tmp/boy-expense-options-${width}.png`,fullPage:false});
 await details.locator('summary').click();await page.locator('.is-investment').check();await page.locator('.investment-project').fill('โครงการทดสอบ');await page.locator('.investment-category').selectOption('construction');
 assert.equal((await page.evaluate(()=>BOY_EXPENSE_APP.readInvestment(document.querySelector('article')))).expense_class,'capital');
 await page.close();console.log(`${form} ${width}: compact investment, inline category retry/scope and delivery choice passed`);
 }}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

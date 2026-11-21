const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [320,390,430,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.BOY_AUTH_CONTEXT={user:{id:'fixture'}};
  const names=['แหนม','ไส้อั่วสมุนไพร','หมูนมสด','หมูหม่าล่า','ไก่ย่างแดง','ริบอาย','ตับ','ไก่หม่าล่า','ข้าวเหนียว','เนื้อโคขุน รสต้นตำรับ','เนื้อโคขุน รสพริกไทยดำ','ชื่อสินค้ายาวมากเป็นพิเศษสำหรับทดสอบการแสดงผลบนหน้าจอโทรศัพท์'];
  const rows=names.map((n,i)=>({item_id:'I'+i,'ชื่อสินค้า':n,'ประเภทข้อมูล':'STOCK_ITEM',category_id:'C1',subcategory_id:'S1',base_unit_id:'U1','เปิดใช้งาน':i!==10,__rowNumber:i+2,__version:'1',store_types:['grill']}));
  const defs={'M_สินค้า':['item_id',['item_id','ชื่อสินค้า','ประเภทข้อมูล','category_id','subcategory_id','base_unit_id','เปิดใช้งาน'],rows],
   'M_หมวดหมู่':['subcategory_id',[],[{category_id:'C1',subcategory_id:'S1','ชื่อประเภทหลัก':'วัตถุดิบ','ชื่อประเภทย่อย':'เนื้อเสียบไม้','เปิดใช้งาน':true,'ใช้กับร้านเนื้อย่าง':true}]],
   'M_สาขา':['branch_id',[],[{branch_id:'B1','รหัสสาขา':'GRILL','ชื่อสาขา':'เนื้อย่าง','เปิดใช้งาน':true}]],
   'M_สินค้าสาขา':['branch_item_id',[],[]],'M_หน่วย':['unit_id',['unit_id','ชื่อหน่วย'],[{unit_id:'U1','ชื่อหน่วย':'ไม้','เปิดใช้งาน':true}]],'M_หน่วยสินค้า':['item_unit_id',[],[]]};
  window.BOY_MASTER_STORE={load:async s=>{const d=defs[s]||['id',[],[]];return{sheetName:s,idHeader:d[0],headers:d[1],rows:d[2],required:[],readonlyHeaders:[]};},revalidate:async()=>{},pendingCount:async()=>0};
 });
 await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='http://fixture.local')return r.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-master-store.js'))return r.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return r.fulfill({body:"window.BOY_AUTH_SCREEN?.ready();document.querySelector('#boyAuthPendingStyle')?.remove();window.dispatchEvent(new Event('boy-auth-ready'));",contentType:'text/javascript'});
  const f=path.join(root,u.pathname);return r.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://fixture.local/master-data.html?entity=items&store=grill');await page.locator('[data-edit="2"]').waitFor();
 if(width<760){
  assert.equal(await page.locator('.entity-panel').isVisible(),false);assert.equal(await page.locator('.store-context').isVisible(),false);assert.equal(await page.locator('#catalogFilters').isVisible(),false);
  const rows=await page.locator('#rows>.row').evaluateAll(rs=>rs.map(r=>({height:r.getBoundingClientRect().height,buttons:[...r.querySelectorAll('.row-actions button')].map(b=>({y:b.getBoundingClientRect().y,h:b.getBoundingClientRect().height})),name:r.querySelector('strong').getBoundingClientRect().height})));
  rows.forEach(r=>{assert.ok(r.height<=58,'row stays single-line');assert.equal(r.buttons[0].y,r.buttons[1].y);assert.ok(r.buttons.every(b=>b.h>=44));assert.ok(r.name<28);});
  const first=await page.locator('#rows>.row').first().boundingBox();assert.ok(first.y<260,'header remains compact');
  await page.screenshot({path:`/private/tmp/boy-master-compact-${width}.png`,fullPage:false});
  await page.locator('#filterToggle').click();assert.equal(await page.locator('#catalogFilters').isVisible(),true);await page.locator('#dataTypeFilter').selectOption('STOCK_ITEM');assert.equal(await page.locator('#filterCount').textContent(),'1');await page.locator('#filterToggle').click();
  await page.locator('#mobileEntitySelect').selectOption('units');await page.getByRole('heading',{name:'หน่วย',exact:true}).waitFor();assert.equal(await page.locator('#filterToggle').isVisible(),false);
  await page.locator('#mobileEntitySelect').selectOption('items');await page.getByRole('heading',{name:'รายการสินค้าและค่าใช้จ่าย',exact:true}).waitFor();
  await page.locator('#mobileStoreSelect').selectOption('grill');
 }
 await page.locator('#toolMenu summary').click();assert.equal(await page.locator('#exportButton').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#exportButton').isVisible(),false);
 await page.locator('[data-edit="2"]').click();await page.locator('#editor').waitFor({state:'visible'});await page.locator('#close').click();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();console.log(`compact list ${width}: rows, filters, navigation, tools, edit and overflow passed`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

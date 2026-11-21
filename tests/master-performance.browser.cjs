const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.BOY_AUTH_CONTEXT={user:{id:'fixture'}};window.__catalogCalls=[];window.BOY_MASTER_STORE={
  load:async sheet=>{window.__catalogCalls.push(sheet);const defs={
  'M_สินค้า':['item_id',['item_id','ชื่อสินค้า','ประเภทข้อมูล','category_id','subcategory_id','base_unit_id','เปิดใช้งาน'],[{item_id:'I1','ชื่อสินค้า':'มะพร้าว','ประเภทข้อมูล':'STOCK_ITEM',category_id:'C1',subcategory_id:'S1',base_unit_id:'U1','เปิดใช้งาน':true,__rowNumber:2,__version:'1',store_types:['water']}]],
  'M_รายการค่าใช้จ่าย':['expense_item_id',[],[]],
  'M_หมวดหมู่':['subcategory_id',[],[{category_id:'C1',subcategory_id:'S1','ชื่อประเภทหลัก':'วัตถุดิบ','ชื่อประเภทย่อย':'ผลไม้','เปิดใช้งาน':true,'ใช้กับร้านน้ำ':true}]],
  'M_สาขา':['branch_id',[],[{branch_id:'B1','รหัสสาขา':'TAWANA','ชื่อสาขา':'ทาวน่า','เปิดใช้งาน':true}]],
  'M_สินค้าสาขา':['branch_item_id',[],[{branch_item_id:'BI1',branch_id:'B1',item_id:'I1','เปิดใช้งาน':true}]],
  'M_หน่วย':['unit_id',[],[{unit_id:'U1','ชื่อหน่วย':'ลูก','เปิดใช้งาน':true}]],
  'M_หน่วยสินค้า':['item_unit_id',[],[{item_unit_id:'IU1',item_id:'I1',unit_id:'U1','เป็นหน่วยฐาน':true,'ใช้หน่วยนี้ตอนซื้อ':true,'อัตราแปลงเป็นหน่วยฐาน':1,'เปิดใช้งาน':true}]],
  'M_ผู้ขาย':['supplier_id',[],[]],'M_ผู้ขายสินค้า':['item_supplier_id',[],[]]};
  const d=defs[sheet]||['id',[],[]];return{sheetName:sheet,idHeader:d[0],headers:d[1],rows:d[2],readonlyHeaders:[],required:[],sourceRevision:'1'};},revalidate:async()=>{},pendingCount:async()=>0};});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-master-store.js'))return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return route.fulfill({body:"window.BOY_AUTH_SCREEN?.ready();document.querySelector('#boyAuthPendingStyle')?.remove();window.dispatchEvent(new Event('boy-auth-ready'));",contentType:'text/javascript'});
  const f=path.join(root,u.pathname);return route.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://fixture.local/master-data.html?entity=items');await page.locator('[data-edit="2"]').waitFor();
 let calls=await page.evaluate(()=>window.__catalogCalls);assert.ok(!calls.includes('M_ผู้ขาย')&&!calls.includes('M_ผู้ขายสินค้า')&&!calls.includes('M_หน่วยสินค้า'),'list must not block on editor-only references');
 await page.locator('[data-edit="2"]').click();await page.locator('#itemPurchaseSame').waitFor({state:'visible'});
 calls=await page.evaluate(()=>window.__catalogCalls);assert.ok(calls.includes('M_หน่วยสินค้า'));assert.ok(!calls.includes('M_ผู้ขาย'));
 await page.locator('[data-detail-tab="relations"]').click();await page.getByText('ยังไม่มีแหล่งซื้อ',{exact:true}).waitFor();
 calls=await page.evaluate(()=>window.__catalogCalls);assert.ok(calls.includes('M_ผู้ขาย'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/private/tmp/boy-master-perf-${width}.png`,fullPage:false});assert.deepEqual(errors,[]);await page.close();
 console.log(`master ${width}: lazy list, purchase form, related data and layout passed`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

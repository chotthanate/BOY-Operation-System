const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.BOY_AUTH_CONTEXT={user:{id:'fixture'}};window.__writes=[];
  const unitRows=[{item_unit_id:'IU1',item_id:'I1',unit_id:'U1','เป็นหน่วยฐาน':true,'ใช้หน่วยนี้ตอนซื้อ':true,'อัตราแปลงเป็นหน่วยฐาน':1,'เปิดใช้งาน':true,__version:'u1'}];
  const defs={
   'M_สินค้า':['item_id',['item_id','ชื่อสินค้า','ประเภทข้อมูล','category_id','subcategory_id','base_unit_id','เปิดใช้งาน'],[{item_id:'I1','ชื่อสินค้า':'ไก่ย่างแดง','ประเภทข้อมูล':'STOCK_ITEM',category_id:'C1',subcategory_id:'S1',base_unit_id:'U1','เปิดใช้งาน':true,__rowNumber:2,__version:'v1',store_types:['grill']}]],
   'M_หมวดหมู่':['subcategory_id',[],[{category_id:'C1',subcategory_id:'S1','ชื่อประเภทหลัก':'วัตถุดิบ','ชื่อประเภทย่อย':'เนื้อเสียบไม้','เปิดใช้งาน':true,'ใช้กับร้านเนื้อย่าง':true}]],
   'M_สาขา':['branch_id',[],[{branch_id:'B1','รหัสสาขา':'GRILL','ชื่อสาขา':'เนื้อย่าง','เปิดใช้งาน':true}]],
   'M_สินค้าสาขา':['branch_item_id',[],[{branch_item_id:'BI1',branch_id:'B1',item_id:'I1','เปิดใช้งาน':true}]],
   'M_หน่วย':['unit_id',[],[{unit_id:'U1','ชื่อหน่วย':'ชิ้น','เปิดใช้งาน':true},{unit_id:'U2','ชื่อหน่วย':'ไม้','เปิดใช้งาน':true},{unit_id:'U3','ชื่อหน่วย':'แพ็ค','เปิดใช้งาน':true}]],
   'M_หน่วยสินค้า':['item_unit_id',[],unitRows]
  };
  const catalog=sheet=>{const d=defs[sheet]||['id',[],[]];return{sheetName:sheet,idHeader:d[0],headers:d[1],rows:d[2],readonlyHeaders:[],required:[],sourceRevision:'1'};};
  window.BOY_MASTER_STORE={load:async s=>catalog(s),pendingCount:async()=>0,revalidate:async()=>{},
   save:async(s,n,values,actor,legacy,c,options)=>{window.__writes.push({kind:'item',values,options});const freshUnits={...catalog('M_หน่วยสินค้า'),rows:[{...unitRows[0],'เป็นหน่วยฐาน':false,__version:'u2'},{item_unit_id:'IU2',item_id:'I1',unit_id:'U2','เป็นหน่วยฐาน':true,'ใช้หน่วยนี้ตอนซื้อ':true,'อัตราแปลงเป็นหน่วยฐาน':1,'เปิดใช้งาน':true,__version:'u3'}]};return{...c,rows:[{...c.rows[0],...values,__version:'v2'}],unitCatalog:freshUnits,_mirrorStatus:'queued'};},
   bulkSave:async(s,rows,a,l,c)=>{window.__writes.push({kind:'units',rows});return c;}
  };
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-master-store.js'))return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return route.fulfill({body:"document.querySelector('#boyAuthPendingStyle')?.remove();window.dispatchEvent(new Event('boy-auth-ready'));",contentType:'text/javascript'});
  const f=path.join(root,u.pathname);return route.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://fixture.local/master-data.html?entity=items');await page.locator('[data-edit="2"]').click();
 await page.locator('#itemPurchaseSame').waitFor({state:'visible'});await page.locator('[name="base_unit_id"]').selectOption('U2');
 await page.locator('#itemPurchaseSame').uncheck();await page.locator('#itemPurchaseUnit').selectOption('U3');await page.locator('#itemPurchaseConversion').fill('52');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/private/tmp/boy-unit-change-${width}.png`,fullPage:false});
 page.once('dialog',async d=>{assert.match(d.message(),/1 ชิ้นเดิม = 1 ไม้/);await d.dismiss();});
 await page.locator('#form button[type="submit"]').click();assert.equal((await page.evaluate(()=>window.__writes)).length,0);
 page.once('dialog',async d=>{assert.match(d.message(),/1 ชิ้นเดิม = 1 ไม้/);await d.accept();});
 await page.locator('#form button[type="submit"]').click();await page.locator('#editor').waitFor({state:'hidden'});
 const writes=await page.evaluate(()=>window.__writes);assert.equal(writes[0].options.baseUnitOneToOne,true);assert.equal(writes[0].values.base_unit_id,'U2');
 const changes=writes.find(x=>x.kind==='units').rows;assert.equal(changes.find(x=>x.unit_id==='U3')['อัตราแปลงเป็นหน่วยฐาน'],52);assert.equal(changes.find(x=>x.unit_id==='U1').__version,'u2');
 assert.deepEqual(errors,[]);await page.close();console.log(`unit change ${width}: cancel/confirm, fresh versions, pack 52 and layout passed`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

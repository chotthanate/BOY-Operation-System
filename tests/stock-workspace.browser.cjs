const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=require('node:path').join(__dirname,'..');
const html=fs.readFileSync(repo+'/stock.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'').replace(/<link[^>]+>/g,'').replace(/<style id="boyAuthPendingStyle">[\s\S]*?<\/style>/,'');
const css=fs.readFileSync(repo+'/assets/css/boy-stock.css','utf8');
const source=fs.readFileSync(repo+'/assets/js/boy-stock.js','utf8');
const registry=fs.readFileSync(repo+'/assets/js/boy-branches.js','utf8');
const navSource=fs.readFileSync(repo+'/assets/js/boy-work-nav.js','utf8');
const navCss=fs.readFileSync(repo+'/assets/css/boy-work-nav.css','utf8');
(async()=>{
 const engine=process.env.BROWSER_ENGINE==='webkit'?webkit:chromium;
 const browser=await engine.launch({headless:true,executablePath:engine===chromium?process.env.CHROMIUM_PATH:undefined});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://stock.test/**',r=>r.fulfill({contentType:'text/html',body:html}));
 async function setup(query='',role='admin',mixed=false,localWithSession=false){
   await page.goto('http://stock.test/stock.html'+query);await page.addStyleTag({content:navCss+css});await page.addScriptTag({content:registry});
   await page.evaluate(({role,mixed,localWithSession})=>{
    document.getElementById('boyAuthFallback')?.remove();
    const branches=BOY_BRANCHES.all.map((x,n)=>({...x,id:'b'+n,company_id:'company',active:true}));
    const items=[{id:'pool',code:'POOL',name:'มิกซ์เบอร์รี่แช่แข็ง 1 กิโลกรัม',base_unit_id:'bag',category_id:'fruit',track_stock:true,active:true},{id:'zero',code:'ZERO',name:'ขนมปัง',base_unit_id:'piece',category_id:'bread',track_stock:true,active:true},{id:'variant',code:'BRAND',name:'มิกซ์เบอร์รี่ ยี่ห้อ A',base_unit_id:'bag',category_id:'fruit',track_stock:false,stock_target_item_id:'pool',active:true},{id:'unused',code:'UNUSED',name:'ไม่เปิดนับ',base_unit_id:'bag',track_stock:false,active:true}];
    window.fixture={profiles:[{user_id:'user',company_id:'company',company_role:role,active:true}],branches,user_branch_roles:role==='admin'?[]:[{user_id:'user',branch_id:'b1',active:true,role:'staff'}],items,units:[{id:'bag',name:'ถุง'},{id:'piece',name:'ชิ้น'}],categories:[{id:'fruit',name:'ผลไม้แช่แข็ง'},{id:'bread',name:'ขนมปัง'}],branch_items:branches.flatMap(b=>items.map(i=>({branch_id:b.id,item_id:i.id,active:true,minimum_stock:i.id==='pool'?4:0}))),bigc_workflow_settings:[{branch_id:'b3',menu_config:[{itemId:'zero',stockAtBigc:true}]}],v_stock_on_hand:[{branch_id:'b1',item_id:'pool',base_unit_name:'ถุง',quantity_on_hand:2,location_id:'l1',location_name:'ห้องเย็นหลัก'},{branch_id:'b1',item_id:'pool',base_unit_name:mixed?'กิโลกรัม':'ถุง',quantity_on_hand:3,location_id:'l2',location_name:'หน้าร้าน'},{branch_id:'b1',item_id:'variant',base_unit_name:'ถุง',quantity_on_hand:1,location_id:'l1',location_name:'ห้องเย็นหลัก'}]};
    window.queryCalls=[];window.BOY_WORK_NAV={mount:(node,opts)=>{node.textContent='หน้าหลัก · รายจ่าย · สต็อก';window.navOptions=opts;}};
    class Query{constructor(table){this.table=table;this.filters=[];this.single=false;this.offset=0;this.end=999999;}select(){return this;}eq(k,v){this.filters.push(r=>r[k]===v);return this;}in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}order(){return this;}range(a,b){this.offset=a;this.end=b;return this;}maybeSingle(){this.single=true;return this;}abortSignal(){queryCalls.push(this.table);const rows=(fixture[this.table]||[]).filter(r=>this.filters.every(f=>f(r))).slice(this.offset,this.end+1);return Promise.resolve({data:this.single?rows[0]||null:rows,error:null});}}
    window.realSession={user:{id:'user'},access_token:'test'};window.authChecks=0;
    window.BOY_AUTH_CONTEXT=localWithSession?{user:{id:'local'},localAccess:true}:realSession;
    window.BOY_AUTH_CLIENT={schema:()=>({from:table=>new Query(table)}),auth:{getSession:async()=>{authChecks++;return{data:{session:window.realSession}};}}};
   },{role,mixed,localWithSession});await page.addScriptTag({content:navSource});await page.addScriptTag({content:source});
 }
 await setup();await page.waitForFunction(()=>document.querySelectorAll('.stock-branch-card').length===5);
 await page.getByRole('link',{name:'BG ร้านเบอร์เกอร์ ›'}).click();await page.waitForFunction(()=>document.querySelector('#stockUpdated').textContent.startsWith('อัปเดต'));
 assert.equal(await page.locator('.stock-row').count(),3); // Pool + tracked zero + retained child balance.
 const pool=page.locator('.stock-row').filter({hasText:'POOL'});
 assert.equal(await pool.locator('.stock-quantity strong').textContent(),'5');assert.equal(await pool.locator('.stock-quantity span').textContent(),'ถุง');
 await pool.locator('summary').click();assert.equal(await pool.locator('.stock-location').count(),2);
 assert.equal(await page.locator('#stockAdvanced').isVisible(),true);assert.match(await page.locator('#stockReceiving').getAttribute('href'),/page=receipts&work=stock/);
 await page.locator('#stockSearch').fill('ZERO');assert.equal(await page.locator('.stock-row').count(),1);assert.equal(await page.locator('.stock-quantity strong').textContent(),'0');
 await page.locator('#stockSearch').fill('ไม่พบแน่นอน');await page.getByText('ไม่พบสินค้าตามตัวกรอง').waitFor();
 await page.locator('#stockSearch').fill('');await page.locator('#stockFilter').selectOption('empty');assert.equal(await page.locator('.stock-row').count(),1);
 await page.locator('#stockFilter').selectOption('all');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.STOCK_SCREENSHOT)await page.screenshot({path:process.env.STOCK_SCREENSHOT,fullPage:true});
 await page.locator('#stockBranch').selectOption('BIGC-CENTRAL-PATTAYA');await page.waitForFunction(()=>document.querySelector('#stockUpdated').textContent.startsWith('อัปเดต'));assert.equal(await page.locator('.stock-row').count(),1);assert.equal(await page.locator('#stockItemCount').textContent(),'1');
 await page.locator('#stockBack').click();assert.equal(await page.locator('#stockChooser').isVisible(),true);assert.equal(new URL(page.url()).search,'');
 await setup('?branch=BURGER','staff');await page.waitForFunction(()=>document.querySelector('#stockUpdated').textContent.startsWith('อัปเดต'));assert.equal(await page.locator('#stockBranch option').count(),1);assert.equal(await page.locator('#stockAdvanced').isVisible(),false);
 await setup('?branch=GRILL','staff');await page.getByText('ไม่มีสิทธิ์เข้าถึงสาขานี้ หรือสาขาปิดใช้งาน').waitFor();assert.equal(await page.locator('#stockDetail').isVisible(),false);assert.equal(await page.evaluate(()=>queryCalls.includes('v_stock_on_hand')),false);
 await setup('?branch=BURGER','staff',false,true);await page.waitForFunction(()=>document.querySelector('#stockUpdated').textContent.startsWith('อัปเดต'));assert.equal(await page.evaluate(()=>authChecks),1);assert.equal(await page.locator('#stockBranch option').count(),1);assert.equal(await page.locator('#stockAdvanced').isVisible(),false);
 await setup('?branch=BURGER','admin',true);await page.getByText('หน่วยสต็อกของ มิกซ์เบอร์รี่แช่แข็ง 1 กิโลกรัม ไม่ตรงกัน กรุณาตรวจข้อมูลกลาง').waitFor();assert.equal(await page.locator('.stock-row').count(),0);
 await page.evaluate(()=>{window.realSession=null;window.BOY_AUTH_CONTEXT={user:{id:'local'},localAccess:true};document.querySelector('#stockBack').click();document.querySelector('#stockRefresh').click();});await page.getByRole('link',{name:'เข้าสู่ระบบออนไลน์'}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS stock: scoped branches, canonical totals across locations, tracked zero, BigC selective policy, orphan balance visibility, search/filter/chooser, mixed-unit blocking, staff controls, offline auth, 390px no overflow');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

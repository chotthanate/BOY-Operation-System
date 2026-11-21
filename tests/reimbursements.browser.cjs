// Isolated fixtures: all external requests are blocked; no real payment is settled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__calls=[];window.__settled=[];
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},schema:()=>({rpc:async(name,args)=>{
   window.__calls.push({name,args});if(name==='settle_reimbursements'){window.__settled.push(...args.payload.payment_ids);return{data:{status:'success',settled:args.payload.payment_ids.length}};}
   const rows=[{id:'fixture-payment',branch_id:'south',branch_name:'BigC พัทยาใต้',transaction_date:'2026-11-18',total_amount:5492,lines:[{description:'Track light 8 ดวง',amount:1200,supplier:'ร้าน A & B'},{description:'ข้อต่อ 3 ทาง',amount:350},{description:'ป้าย 60*80 6ป้าย , A3 2ป้าย',amount:3942}],can_settle:true},{id:'fixture-tawana',branch_id:'tawana',branch_name:'ทาวน่า',transaction_date:'2026-11-18',total_amount:854,lines:[{description:'ซ่อมเครื่องทำน้ำแข็ง',amount:500},{description:'เลี้ยงอาหารพนักงาน',amount:354}],can_settle:true}].filter(row=>!window.__settled.includes(row.id));
   return{data:{total:rows.reduce((s,r)=>s+r.total_amount,0),count:rows.length,line_count:rows.reduce((s,r)=>s+r.lines.length,0),rows}};
  }})})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return route.fulfill({body:"window.BOY_AUTH_SCREEN?.ready();document.querySelector('#boyAuthPendingStyle')?.remove();",contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-central-config.js'))return route.fulfill({body:"window.BOY_CENTRAL_CONFIG={url:'https://example.invalid',publishableKey:'fixture'}",contentType:'text/javascript'});
  const f=path.join(root,u.pathname);return route.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://fixture.local/reimbursements.html');await page.waitForFunction(()=>document.getElementById('total').textContent.includes('6,346'));
 assert.match(await page.locator('#count').textContent(),/5 รายการ · 2 บิล/);
 assert.match(await page.locator('#list').textContent(),/Track light 8/);assert.equal(await page.locator('.item').count(),2);
 await page.locator('[data-branch="south"]').click();assert.match(await page.locator('#total').textContent(),/5,492/);
 assert.match(await page.locator('#count').textContent(),/3 รายการ · 1 บิล/);
 assert.equal(await page.locator('.bill-lines li').count(),3);
 assert.deepEqual(await page.locator('.line-amount').allTextContents(),['฿1,200.00','฿350.00','฿3,942.00']);
 assert.match(await page.locator('.line-detail').textContent(),/ร้าน A & B/);
 assert.ok(await page.locator('.line-copy').first().evaluate(e=>e.getBoundingClientRect().width)>=130,'line descriptions must remain readable, not one character wide');
 assert.ok(await page.locator('.item').first().evaluate(e=>e.getBoundingClientRect().height)<700,'three-line bill must not become an excessively tall column');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/private/tmp/boy-reimbursements-${width}.png`,fullPage:true});
 await page.locator('.item input').check();page.once('dialog',d=>d.accept());await page.locator('#settleBtn').click();
 await page.waitForFunction(()=>document.getElementById('total').textContent==='854.00');
 assert.match(await page.locator('#count').textContent(),/2 รายการ · 1 บิล/);
 await page.locator('.item input').check();page.once('dialog',d=>d.accept());await page.locator('#settleBtn').click();
 await page.waitForFunction(()=>document.getElementById('list').textContent.includes('ไม่มีรายการรอเบิก'));
 const calls=await page.evaluate(()=>window.__calls);assert.deepEqual(calls.find(c=>c.name==='settle_reimbursements').args,{payload:{payment_ids:['fixture-payment']}});
 assert.deepEqual(errors,[]);await page.close();console.log(`reimbursements ${width}: Supabase read, branch filter, settlement, empty state and layout passed`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

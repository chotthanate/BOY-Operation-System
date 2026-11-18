// Isolated fixtures: all external requests are blocked; no real payment is settled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__calls=[];window.__settled=false;
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},schema:()=>({rpc:async(name,args)=>{
   window.__calls.push({name,args});if(name==='settle_reimbursements'){window.__settled=true;return{data:{status:'success',settled:1}};}
   return{data:{total:window.__settled?0:5492,count:window.__settled?0:1,rows:window.__settled?[]:[{id:'fixture-payment',branch_id:'south',branch_name:'BigC พัทยาใต้',branch_code:'BIGC-SOUTH-PATTAYA',transaction_date:'2026-11-18',total_amount:5492,descriptions:['Track light 8','ป้าย'],can_settle:true}]}};
  }})})};
 });
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-auth-guard.js'))return route.fulfill({body:"document.querySelector('#boyAuthPendingStyle')?.remove();",contentType:'text/javascript'});
  if(u.pathname.endsWith('boy-central-config.js'))return route.fulfill({body:"window.BOY_CENTRAL_CONFIG={url:'https://example.invalid',publishableKey:'fixture'}",contentType:'text/javascript'});
  const f=path.join(root,u.pathname);return route.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});
 });
 await page.goto('http://fixture.local/reimbursements.html');await page.waitForFunction(()=>document.getElementById('total').textContent.includes('5,492'));
 assert.match(await page.locator('#list').textContent(),/Track light 8/);assert.equal(await page.locator('.item').count(),1);
 await page.locator('[data-branch="south"]').click();assert.match(await page.locator('#total').textContent(),/5,492/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`/private/tmp/boy-reimbursements-${width}.png`,fullPage:true});
 await page.locator('.item input').check();page.once('dialog',d=>d.accept());await page.locator('#settleBtn').click();
 await page.waitForFunction(()=>document.getElementById('list').textContent.includes('ไม่มีรายการรอเบิก'));
 const calls=await page.evaluate(()=>window.__calls);assert.deepEqual(calls.find(c=>c.name==='settle_reimbursements').args,{payload:{payment_ids:['fixture-payment']}});
 assert.deepEqual(errors,[]);await page.close();console.log(`reimbursements ${width}: Supabase read, branch filter, settlement, empty state and layout passed`);
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

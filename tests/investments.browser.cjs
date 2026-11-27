// Isolated browser tests. Never connects to a live database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'fixture'}}}})},schema:()=>({rpc:async()=>({data:{total:1200,count:1,rows:[{transaction_date:'2026-11-18',description:'ค่าเคาน์เตอร์',line_total:1200,investment_details:{project_name:'เปิดร้านพัทยาใต้',category:'construction'}}]}})})})};});
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://fixture.local')return route.fulfill({body:'',contentType:'text/javascript'});if(u.pathname.endsWith('boy-central-config.js'))return route.fulfill({body:"window.BOY_CENTRAL_CONFIG={url:'https://example.invalid',publishableKey:'fixture'}",contentType:'text/javascript'});const f=path.join(root,u.pathname);return route.fulfill({body:fs.existsSync(f)?fs.readFileSync(f):'',contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});});
 await page.goto('http://fixture.local/investments.html?branch=BIGC-SOUTH-PATTAYA');await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('1,200'));
 assert.equal(await page.locator('.investment-row').count(),1);assert.equal(await page.locator('#add').getAttribute('href'),'expenses.html?branch=BIGC-SOUTH-PATTAYA&investment=1');
 await page.locator('#search').fill('not-found');assert.equal(await page.locator('.investment-row').count(),0);await page.locator('#search').fill('เปิดร้าน');assert.equal(await page.locator('.investment-row').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>[e.tagName,e.id,e.getBoundingClientRect().width]))));
 await page.screenshot({path:`/private/tmp/boy-investments-${width}.png`,fullPage:true});
 assert.deepEqual(errors,[]);await page.close();console.log(`investment report ${width}: filters, search, branch link and layout passed`);
}}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});

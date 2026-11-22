// Isolated form fixture. No business data is sent to Supabase or Sheets.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const branch of ['BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA'])for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://fixture.local/**',r=>{
   const p=new URL(r.request().url()).pathname;
   if(p.endsWith('.css'))return r.fulfill({contentType:'text/css',body:read(p.slice(1))});
   const html=read('bigc-v2.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   return r.fulfill({contentType:'text/html; charset=utf-8',body:html});
  });
  await page.goto(`http://fixture.local/bigc-v2.html?branch=${branch}`);
  await page.evaluate(()=>{document.querySelector('#boyAuthPendingStyle')?.remove();document.querySelector('#boyAuthFallback')?.remove();});
  await page.addScriptTag({content:read('assets/js/bigc-master-mapping.js')});
  await page.addScriptTag({content:read('assets/js/bigc-v2.js').replace(/\}\)\(\);\s*$/,`window.qa={state,openAddItem,addMenuItem};window.saved=[];persistSettings=async()=>{window.saved.push(JSON.parse(JSON.stringify(state.menu)));return 'synced'};renderSettings=()=>{};document.querySelector('#addMenuItem').onclick=addMenuItem;})();`)});
  await page.evaluate(()=>{qa.state.access={canManage:true};qa.state.menu=[{key:'a',name:'test',category:'🍉 ผลไม้ (ใส่กล่อง)'},{key:'b',name:'snack',category:'ขนม'}];qa.openAddItem();});
  assert.equal(await page.locator('#newItemCategory').evaluate(e=>e.tagName),'SELECT');
  assert.deepEqual(await page.locator('#newItemCategory option').allTextContents(),['🍉 ผลไม้ (ใส่กล่อง)','ขนม']);
  await page.locator('#newItemName').fill('สินค้าใหม่ทดสอบ');await page.locator('#newItemCategory').selectOption('ขนม');await page.locator('#newItemUnit').fill('ถุง');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/private/tmp/bigc-add-category-${branch}-${width}.png`,fullPage:false});
  await page.locator('#addMenuItem').click();assert.equal(await page.evaluate(()=>saved.at(-1).at(-1).category),'ขนม');
  assert.equal(await page.locator('#addItemModal').isVisible(),false);assert.deepEqual(errors,[]);await page.close();
  console.log(`${branch} ${width}: stored category choices, select, save payload and layout passed`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
(async()=>{const browser=await chromium.launch({headless:true});try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});
  await page.route('http://auth.fixture/**',r=>{
   const url=new URL(r.request().url());
   if(url.pathname.endsWith('status.js'))return r.fulfill({contentType:'text/javascript; charset=utf-8',body:read('assets/js/boy-auth-status.js')});
   if(url.pathname.endsWith('blocked.js'))return new Promise(()=>{});
   return r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><style id="boyAuthPendingStyle">html{visibility:hidden}</style></head><body><script>const nativeTimeout=setTimeout;window.setTimeout=(fn,ms)=>{if(ms===12000)window.expireAuth=fn;return nativeTimeout(fn,ms===12000?60000:ms)}</script><script src="/status.js"></script><main id="private">Protected form</main><script src="/blocked.js"></script></body></html>'});
  });
  await page.goto('http://auth.fixture/tawana.html',{waitUntil:'commit'});
  await page.getByRole('heading',{name:'กำลังตรวจสอบการเข้าใช้…'}).waitFor({timeout:5000}).catch(async e=>{console.error(await page.evaluate(()=>document.documentElement.outerHTML));throw e;});
  // Dependency is still stalled, yet the recovery screen already rendered.
  await page.evaluate(()=>window.expireAuth());
  await page.getByRole('button',{name:'ลองใหม่',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).visibility),'hidden');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/private/tmp/boy-auth-recovery-${width}.png`});
  // Test a suspended session and late success without granting access on timeout.
  await page.evaluate(()=>{
   localStorage.setItem('BOY_TAWANA_DRAFT_2099-01-01','{"exp":[{"i":"draft fixture"}]}');
   window.BOY_CENTRAL_CONFIG={url:'https://qa.example',publishableKey:'public-test'};
   window.supabase={createClient:()=>({auth:{getSession:()=>new Promise(resolve=>window.completeSession=resolve)},schema:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{active:true,company_role:'admin'}})})})})})})};
  });
  await page.addScriptTag({content:read('assets/js/boy-auth-guard.js')});
  await page.evaluate(()=>window.completeSession({data:{session:{user:{id:'qa'}}}}));
  await page.locator('#boyAuthStatus').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).visibility),'visible');
  assert.equal(await page.evaluate(()=>!!window.BOY_AUTH_CONTEXT),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('BOY_TAWANA_DRAFT_2099-01-01')).exp[0].i),'draft fixture');
  assert.deepEqual(errors,[]);await page.close();
  console.log(`auth ${width}: stalled dependency/session, recovery UI, protected content and late authenticated success passed`);
 }
 // Profile denial must keep the page protected, rather than reveal it.
 const page=await browser.newPage({viewport:{width:390,height:850}});
 await page.setContent('<style id="boyAuthPendingStyle">html{visibility:hidden}</style><main>Protected</main>');
 await page.addScriptTag({content:read('assets/js/boy-auth-status.js')});
 await page.evaluate(()=>{window.BOY_CENTRAL_CONFIG={url:'https://qa.example',publishableKey:'public-test'};window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'qa'}}}})},schema:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{active:false}})})})})})})};});
 await page.addScriptTag({content:read('assets/js/boy-auth-guard.js')});
 await page.getByText('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).visibility),'hidden');
 assert.equal(await page.evaluate(()=>!!window.BOY_AUTH_CONTEXT),false);await page.close();
 console.log('profile denial: protected content remains hidden');
 const fallback=await browser.newPage({viewport:{width:390,height:850}});
 const markup=read('tawana.html').match(/<div id="boyAuthFallback"[\s\S]*?<\/div><\/div>/)[0];
 await fallback.setContent('<style id="boyAuthPendingStyle">html{visibility:hidden}</style>'+markup+'<main id="private">Protected</main>');
 assert.equal(await fallback.getByRole('button',{name:'ลองใหม่',exact:true}).isVisible(),true);
 assert.equal(await fallback.locator('#private').isVisible(),false);
 assert.equal(await fallback.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await fallback.close();console.log('missing recovery script: static retry remains visible and private form stays hidden');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

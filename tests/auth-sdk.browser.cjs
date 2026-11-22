// Real pinned SDK + real guard/storage. All network responses are isolated fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),root=path.resolve(__dirname,'..');
(async()=>{const browser=await (process.env.BROWSER_ENGINE==='webkit'?webkit:chromium).launch({headless:true});try{
 for(const branch of ['TAWANA','BURGER','GRILL','BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA']){
  const page=await browser.newPage({viewport:{width:390,height:850}}),errors=[],outside=[],calls=[];let failProfile=branch==='TAWANA';
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({expired,quota})=>{
   const enc=x=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   const user={id:'00000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated'},exp=Math.floor(Date.now()/1000)+3600;
   const token=enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:user.id,aud:'authenticated',role:'authenticated',exp})+'.fixture-signature';
   window.__fixtureSession={access_token:token,refresh_token:'test-refresh-not-a-real-token',token_type:'bearer',expires_in:3600,expires_at:exp,user};
   localStorage.setItem('sb-qa-auth-token',JSON.stringify({...window.__fixtureSession,expires_at:expired?1:exp}));
   localStorage.setItem('BOY_TAWANA_DRAFT_2099-01-01','draft-must-survive');
   if(quota){
    localStorage.setItem('BOY_ENTRY_V1:GRILL:owner:catalog','rebuildable-fixture');localStorage.setItem('BOY_CENTRAL_DAILY:TAWANA:catalog:v4:owner','rebuildable-fixture');
    const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(localStorage.getItem('BOY_ENTRY_V1:GRILL:owner:catalog'))throw new DOMException('The quota has been exceeded.','QuotaExceededError');return original.call(this,k,v);};
   }
   Object.defineProperty(window,'indexedDB',{value:{open:()=>({})},configurable:true});
  },{expired:branch==='BURGER',quota:branch==='GRILL'});
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.origin==='https://qa.supabase.co'){
    calls.push(u.pathname);
    if(u.pathname==='/auth/v1/token')return r.fulfill({json:await page.evaluate(()=>window.__fixtureSession)});
    if(u.pathname==='/rest/v1/profiles'){
     if(failProfile){failProfile=false;return r.fulfill({status:400,json:{message:'fixture temporarily unavailable'}});}
     return r.fulfill({json:{active:true,company_role:'admin',employee_code:null}});
    }
    if(u.pathname.endsWith('/get_finance_entry_workspace'))return r.fulfill({json:{branch_id:'fixture-branch',revision:0,data:{},revenue_mode:['TAWANA','BIGC-CENTRAL-PATTAYA'].includes(branch)?'manual':'pos_shift'}});
    if(u.pathname.endsWith('/get_daily_catalog'))return r.fulfill({json:{version:'fixture',items:[],units:[],categories:[],item_units:[],suppliers:[],item_suppliers:[]}});
    if(u.pathname.endsWith('/get_branch_finance_day'))return r.fulfill({json:{income:null,expenses:[],revenue_mode:'manual'}});
    return r.fulfill({status:500,json:{message:'Unexpected fixture request'}});
   }
   if(u.origin!=='https://sdk.fixture'){outside.push(u.origin);return r.abort();}
   if(u.pathname.endsWith('boy-central-config.js'))return r.fulfill({contentType:'text/javascript',body:"window.BOY_CENTRAL_CONFIG={url:'https://qa.supabase.co',publishableKey:'public-fixture'};"});
   const file=path.join(root,u.pathname);if(!file.startsWith(root)||!fs.existsSync(file))return r.fulfill({status:404,body:''});
   return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
  });
  await page.goto('https://sdk.fixture/expenses.html?branch='+branch);
  if(branch==='TAWANA'){
   await page.getByText('ตรวจสิทธิ์บัญชีไม่สำเร็จ กรุณาลองใหม่',{exact:true}).waitFor({timeout:10000}).catch(async e=>{console.error({errors,calls,outside,url:page.url(),screen:await page.locator('#boyAuthStatus').textContent({timeout:1000}).catch(()=>null)});throw e;});
   assert.equal(await page.locator('.entry-shell').isVisible(),false);
   assert.equal(await page.evaluate(()=>!!window.BOY_AUTH_CONTEXT),false);
   await page.getByRole('button',{name:'ลองใหม่',exact:true}).click();
  }
  await page.locator('.expense-card').waitFor({state:'visible',timeout:7000});
  assert.equal(await page.evaluate(()=>BOY_AUTH_CLIENT===BOY_FINANCE_ENTRY.state.client),true,'one shared authenticated client');
  assert.equal(await page.evaluate(()=>localStorage.getItem('BOY_TAWANA_DRAFT_2099-01-01')),'draft-must-survive');
  assert.equal(calls.some(x=>/record_|save_/.test(x)),false);assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);
  if(branch==='BURGER')assert.equal(calls.filter(x=>x==='/auth/v1/token').length,1,'one refresh, no duplicate client refresh');
  if(branch==='GRILL')assert.equal(await page.evaluate(()=>localStorage.getItem('BOY_ENTRY_V1:GRILL:owner:catalog')===null&&localStorage.getItem('BOY_CENTRAL_DAILY:TAWANA:catalog:v4:owner')===null),true,'only regenerable catalogs reclaimed');
  await page.close();console.log(branch+': real SDK, stalled IndexedDB, protected profile check and no-CDN startup passed');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

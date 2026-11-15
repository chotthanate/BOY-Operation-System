const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/js/burger.js'),'utf8');
const css=fs.readFileSync(require('node:path').join(__dirname,'../assets/css/burger-central.css'),'utf8');
const functions=source.slice(source.indexOf('  function renderPendingReceipts()'),source.indexOf('  async function loadExpenseHistory()'));
const listeners=source.slice(source.indexOf('  $("#pendingReceiptList").addEventListener("click"'),source.indexOf('  $("#manageRecipesButton")'));
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('http://localhost:9191/**',r=>r.fulfill({contentType:'text/html',body:`<style>*{box-sizing:border-box}body{margin:12px}${css}</style><div id="pendingReceiptCount"></div><div id="pendingReceiptList"></div><p id="toast"></p>`}));
 const setup=()=>{
  window.$=s=>document.querySelector(s);window.branchApp={branchCode:'GRILL'};
  window.state={branch:{id:'branch'},pendingReceipts:[],receiptLoading:false};window.navigatorOnline=true;
  window.money=window.number={format:String};window.escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  window.toast=s=>$('#toast').textContent=s;window.loadStock=async()=>{};window.centralAvailable=()=>true;
  window.received=0;window.saved=[];window.confirmed=new Set();window.lost=true;
  window.receipts=()=>[1,2].map(n=>({receipt_id:`bill-${n}`,transaction_no:`BILL-${n}`,status:n===1&&received===10?'received':'pending',created_at:'2026-11-15T00:00:00Z',lines:[{line_id:`line-${n}`,item_name:`หมูปิ้ง ${n}`,quantity:10,quantity_received:n===1?received:0,unit:'ไม้'}],checks:[]}));
  window.client={schema:()=>({rpc:(name,args)=>({abortSignal:async()=>{
    const p=args.payload;saved.push(p);
    if(!confirmed.has(p.request_id)){received+=p.lines[0].quantity;confirmed.add(p.request_id);if(lost){lost=false;throw new Error('network lost');}}
    return {data:{status:received===10?'received':'partial'}};
  },then:resolve=>resolve({data:receipts()})})})};
 };
 await page.goto('http://localhost:9191/');await page.evaluate(setup);await page.addScriptTag({content:functions+listeners+';state.pendingReceipts=receipts();renderPendingReceipts();'});
 const first=page.locator('[data-receipt-id="bill-1"]');
 await first.locator('[data-receipt-check]').check();await first.locator('[data-receipt-quantity]').fill('6');
 await first.getByRole('button',{name:'บันทึกรับที่เลือก'}).click();
 await first.getByRole('button',{name:'ตรวจผล/ส่งคำขอเดิม'}).waitFor();
 await first.getByRole('button',{name:'ตรวจผล/ส่งคำขอเดิม'}).click();
 await first.getByRole('button',{name:'บันทึกรับที่เลือก'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>saved[0]),await page.evaluate(()=>saved[1]));
 assert.equal(await page.evaluate(()=>received),6);
 assert.equal(await page.locator('[data-receipt-id="bill-2"] [data-receipt-quantity]').inputValue(),'10');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await first.locator('[data-receipt-check]').check();await first.getByRole('button',{name:'บันทึกรับที่เลือก'}).click();
 await page.waitForFunction(()=>received===10);await page.waitForFunction(()=>document.querySelector('#pendingReceiptCount').textContent==='1 รายการรอรับ');
 assert.equal(await page.evaluate(()=>localStorage.getItem('boy.receipt-check.v1:GRILL:bill-1')),null);
 assert.deepEqual(errors,[]);await page.screenshot({path:'/private/tmp/boy-shared-receiving-390.png',fullPage:true});
 console.log('PASS web receiving: separate bills, partial, lost response/exact retry, completion, draft clearing, 390px');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

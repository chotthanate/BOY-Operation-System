const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function redirect(pathname){let next=null;const location={href:'https://example.test/'+pathname,replace:v=>next=v};vm.runInNewContext(read('assets/js/expense-entry-route.js'),{URL,location});return next;}
test('old expense entry links reach one canonical branch form',()=>{
 for(const [url,branch] of [['tawana.html','TAWANA'],['bigc.html','BIGC-CENTRAL-PATTAYA'],['burger.html','BURGER'],['burger.html?branch=GRILL','GRILL'],['burger.html?branch=BIGC-SOUTH-PATTAYA','BIGC-SOUTH-PATTAYA']])assert.equal(new URL(redirect(url)).searchParams.get('branch'),branch);
});
test('login, old drafts, branch tools and isolated test mode never redirect',()=>{
 for(const url of ['burger.html?next=expenses.html','burger.html?legacy=1','burger.html?branch=GRILL&page=stock','burger.html?page=receipts','tawana.html?view=employee','tawana.html?view=stock','bigc.html?legacy=1','tawana.html?mode=test'])assert.equal(redirect(url),null,url);
});
test('legacy date and history links preserve branch and date in read-only history',()=>{
 for(const [path,branch] of [['tawana.html','TAWANA'],['bigc.html','BIGC-CENTRAL-PATTAYA'],['burger.html?branch=GRILL','GRILL']]){
  const next=new URL(redirect(path+(path.includes('?')?'&':'?')+'view=history&date=2026-11-21'));
  assert.equal(next.pathname,'/expenses.html');assert.equal(next.searchParams.get('branch'),branch);assert.equal(next.searchParams.get('view'),'history');assert.equal(next.searchParams.get('date'),'2026-11-21');
 }
 for(const p of ['tawana.html','bigc.html'])assert.doesNotMatch(read(p),/await apiCall\('(?:unlockDate|bigcExpenseUnlockDate)'/);
});
test('new forms do not erase old storage or call Sheet directly',()=>{
 const js=read('assets/js/finance-entry.js');assert.doesNotMatch(js,/localStorage\.clear|indexedDB\.deleteDatabase|script\.google\.com/);
 assert.match(js,/record_finance_expenses/);assert.match(js,/save_branch_manual_income/);assert.match(js,/expected_revision/);
 assert.match(js,/income-pending/);assert.match(js,/BOY_TAWANA_DRAFT_/);assert.match(js,/BOY_BIGC_EXPENSE_DRAFT_/);
});
test('all expense branch links share the canonical page and keep existing branch registry',()=>{
 const context={window:{}};vm.runInNewContext(read('assets/js/boy-branches.js'),context);vm.runInNewContext(read('assets/js/expense-app.js'),context);
 assert.equal(context.window.BOY_EXPENSE_APP.branches.length,5);for(const b of context.window.BOY_EXPENSE_APP.branches)assert.equal(b.path,'expenses.html?branch='+b.code);
});
function purchaseHelpers(items,categories=[]){
 const source=read('assets/js/finance-entry.js'),context={state:{catalog:{items,categories,item_units:[],item_suppliers:[],suppliers:[]}},notice:()=>{},changed:()=>{},render:()=>{},window:{BOY_EXPENSE_APP:{onlySupplier:()=>''}}};
 vm.runInNewContext(source.slice(source.indexOf(' const normalized='),source.indexOf(' function render(){'))+';globalThis.helpers={requirements,selectProduct,normalized,productCategories};',context);
 return context.helpers;
}
test('quantity is available before selection and required for products despite old false flags',()=>{
 const physical={id:'brand',is_physical:true,track_stock:false,stock_target_item_id:'pool',requires_quantity:false,requires_unit:false};
 const api=purchaseHelpers([physical,{id:'expense',expense_item_id:'expense',requires_quantity:false,requires_unit:false}]);
 assert.equal(api.requirements({}).quantity,true);assert.equal(api.requirements({}).unit,true);
 assert.equal(api.requirements({item_id:'brand'}).quantity,true);assert.equal(api.requirements({item_id:'brand'}).physical,true);
 physical.is_physical=false;assert.equal(api.requirements({item_id:'brand'}).physical,true,'stock identity overrides an obsolete physical flag');
 assert.equal(api.requirements({expense_item_id:'expense'}).quantity,false);
});
test('explicit product choice resolves duplicate display names without guessing',()=>{
 const items=[{id:'one',name:'ชื่อซ้ำ',option:'ชื่อซ้ำ · ONE'},{id:'two',name:'ชื่อซ้ำ',option:'ชื่อซ้ำ · TWO'}],api=purchaseHelpers(items),row={};
 api.selectProduct(row,'ชื่อซ้ำ');assert.equal(row.item_id,undefined);
 api.selectProduct(row,'ชื่อซ้ำ',items[1]);assert.equal(row.item_id,'two');
 assert.equal(api.normalized('  Milk   BOX '),'milk box');
});
test('category autofill follows subcategory UUID parent, never stale names or array position',()=>{
 const categories=[{id:'pack',name:'บรรจุภัณฑ์'},{id:'raw',name:'วัตถุดิบ'},{id:'fruit',name:'ผลไม้',parent_id:'raw'}];
 const product={id:'orange',name:'ส้ม',category_id:'pack',subcategory_id:'fruit',main:'บรรจุภัณฑ์',sub:'ผิด'},api=purchaseHelpers([product],categories),row={category_id:'pack',subcategory_id:'old'};
 api.selectProduct(row,'ส้ม',product);assert.equal(row.category_id,'raw');assert.equal(row.subcategory_id,'fruit');
 assert.equal(api.productCategories({category_id:'fruit'}).category_id,'raw');
 assert.equal(api.productCategories({category_id:'missing',main:'บรรจุภัณฑ์'}).category_id,'');
});
function draftHelpers(){
 const source=read('assets/js/finance-entry.js'),context={};
 vm.runInNewContext(source.slice(source.indexOf(' function hasExpenseEntries('),source.indexOf(' function useDraft('))+';globalThis.api={hasExpenseEntries,draftPostingDate};',context);return context.api;
}
test('new day opens today only for an empty expense draft',()=>{
 const api=draftHelpers(),day='2026-11-24';
 for(const lines of [[],[{}],[{description:' ',expanded:true,payment_method:'cash',receiving_mode:'immediate'}]])assert.equal(api.draftPostingDate({date:'2026-11-23',lines},day),day);
 for(const field of ['description','quantity','line_total','supplier_name','note','item_id','expense_item_id','category_id','subcategory_id','unit_id','project_name','investment_category']){
  const data={date:'2026-11-23',lines:[{[field]:'0'}]};assert.equal(api.hasExpenseEntries(data),true,field);assert.equal(api.draftPostingDate(data,day),'2026-11-23',field);
 }
 for(const row of [{is_investment:true},{payment_method:'reimbursement_pending'},{receiving_mode:'delivery'}])assert.equal(api.draftPostingDate({date:'2026-11-23',lines:[row]},day),'2026-11-23');
 assert.equal(api.draftPostingDate({date:'2026-11-23',lines:[]},day,true),'2026-11-23','exact pending requests and unresolved conflicts must keep their date');
});

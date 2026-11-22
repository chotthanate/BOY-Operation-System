const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function redirect(pathname){let next=null;const location={href:'https://example.test/'+pathname,replace:v=>next=v};vm.runInNewContext(read('assets/js/expense-entry-route.js'),{URL,location});return next;}
test('old expense entry links reach one canonical branch form',()=>{
 for(const [url,branch] of [['tawana.html','TAWANA'],['bigc.html','BIGC-CENTRAL-PATTAYA'],['burger.html','BURGER'],['burger.html?branch=GRILL','GRILL'],['burger.html?branch=BIGC-SOUTH-PATTAYA','BIGC-SOUTH-PATTAYA']])assert.equal(new URL(redirect(url)).searchParams.get('branch'),branch);
});
test('login, old drafts, branch tools and isolated test mode never redirect',()=>{
 for(const url of ['burger.html?next=expenses.html','burger.html?legacy=1','burger.html?branch=GRILL&page=stock','burger.html?page=receipts','tawana.html?view=employee','tawana.html?view=stock','bigc.html?legacy=1','tawana.html?mode=test'])assert.equal(redirect(url),null,url);
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
function purchaseHelpers(items){
 const source=read('assets/js/finance-entry.js'),context={state:{catalog:{items,item_units:[],item_suppliers:[],suppliers:[]}},notice:()=>{},changed:()=>{},render:()=>{},window:{BOY_EXPENSE_APP:{onlySupplier:()=>''}}};
 vm.runInNewContext(source.slice(source.indexOf(' const normalized='),source.indexOf(' function render(){'))+';globalThis.helpers={requirements,selectProduct,normalized};',context);
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

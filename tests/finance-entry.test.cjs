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

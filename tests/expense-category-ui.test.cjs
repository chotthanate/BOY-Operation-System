const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('capital classification is collapsed by default but remains explicit on saved investment lines',()=>{
 const c=vm.createContext({window:{BOY_BRANCHES:{all:[]}},URLSearchParams,location:{search:''}});vm.runInContext(read('assets/js/expense-app.js'),c);
 const ordinary=c.window.BOY_EXPENSE_APP.investmentFields({}),capital=c.window.BOY_EXPENSE_APP.investmentFields({is_investment:true,project_name:'project'});
 assert.match(ordinary,/<details class="investment-fields" >/);assert.doesNotMatch(ordinary,/<details[^>]* open/);assert.match(capital,/<details[^>]* open/);assert.match(capital,/class="is-investment"[^>]*checked/);
});
test('all expense UIs offer connected inline main/subcategory creation',()=>{
 for(const p of ['tawana.html','bigc.html','assets/js/burger.js']){const s=read(p);assert.match(s,/addCategoryOption\('main'\)/);assert.match(s,/addCategoryOption\('sub'\)/);}
 const s=read('assets/js/expense-app.js');assert.match(s,/rpc\('create_expense_category'/);assert.match(s,/store_types:/);assert.match(s,/stopImmediatePropagation/);
 assert.match(read('assets/js/burger.js'),/rpc\("get_expense_category_options"/);assert.match(read('assets/js/boy-daily-store.js'),/catalog:v4:/);
});
test('physical purchases keep their receiving choice and new category creation cannot send a sentinel as a category',()=>{
 const s=read('assets/js/expense-app.js');assert.match(s,/s\.value=s\.dataset\.beforeAdd/);
 for(const p of ['tawana.html','bigc.html']){assert.match(read(p),/value="delivery"/);assert.match(read(p),/receivingField\.hidden=.*!meta.itemId/);}
 assert.match(read('assets/js/burger.js'),/receiving_mode: group.receiving_mode/);
});
test('updated expense scripts and CSS are versioned on every entry page',()=>{
 for(const p of ['tawana.html','bigc.html','burger.html']){assert.match(read(p),/expense-app\.js\?v=20261121-expense1/);assert.match(read(p),/expense-app\.css\?v=20261121-expense1/);}
 for(const p of ['tawana.html','bigc.html','burger.html','master-data.html'])for(const m of read(p).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
});

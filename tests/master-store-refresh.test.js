const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'boy-master-store.js'), 'utf8');
const vm = require('node:vm');

test('shop scope is saved explicitly, including empty shared scope, and overrides category defaults', () => {
  const page=fs.readFileSync(path.join(__dirname,'..','master-data.html'),'utf8');
  assert.match(page,/values\.store_types=storeTypes/);
  const line=page.split('\n').find(line=>line.includes('function itemStoreTypes('));
  const context={STORE_TYPES:[['water'],['grill'],['burger']]};
  vm.createContext(context);vm.runInContext(line,context);
  assert.deepEqual(Array.from(context.itemStoreTypes({store_types:['water']})),['water']);
  assert.deepEqual(Array.from(context.itemStoreTypes({store_types:[]})),[]);
  assert.match(page,/if\(h==='store_types'\)return true/);
  const start=source.indexOf('  function sourcePayload('),end=source.indexOf('  function isRetryable(',start);
  const payloadContext={EXPENSE_SHEET:'M_รายการค่าใช้จ่าย'};
  vm.createContext(payloadContext);vm.runInContext(source.slice(start,end),payloadContext);
  const payload=payloadContext.sourcePayload('M_รายการค่าใช้จ่าย',{expense_item_id:'EXP-1',store_types:['water']},{headers:['expense_item_id']});
  assert.deepEqual(Array.from(payload.store_types),['water']);
});

test('save result replaces only its source catalog without another database read', () => {
  const start=source.indexOf('  function catalogFromSave('),end=source.indexOf('  async function save(',start);
  const helpers=source.slice(source.indexOf('  function isExpenseRow('),source.indexOf('  function findCurrentRow('));
  const scope={ITEM_SHEET:'M_สินค้า',EXPENSE_SHEET:'M_รายการค่าใช้จ่าย'};
  vm.createContext(scope);vm.runInContext(helpers+source.slice(start,end),scope);
  const items={sheetName:'M_สินค้า',rows:[{item_id:'ITEM-1'}]},expenses={sheetName:'M_รายการค่าใช้จ่าย',rows:[{expense_item_id:'EXP-1',__rowNumber:2}]};
  const combined=scope.combineItemCatalog(items,expenses);
  const result=scope.catalogFromSave('M_สินค้า','M_สินค้า',{...items,rows:[{item_id:'ITEM-2'}]},combined);
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].item_id,'ITEM-2');assert.equal(result.rows[1].expense_item_id,'EXP-1');
  const expenseResult=scope.catalogFromSave('M_สินค้า','M_รายการค่าใช้จ่าย',{...expenses,rows:[{expense_item_id:'EXP-2',__rowNumber:3}]},result);
  assert.equal(expenseResult.rows[0].item_id,'ITEM-2');assert.equal(expenseResult.rows[1].expense_item_id,'EXP-2');
  for(const name of ['save','bulkSave']){
    const body=source.slice(source.indexOf(`  async function ${name}(`),source.indexOf('\n  async function ',source.indexOf(`  async function ${name}(`)+1));
    assert.doesNotMatch(body,/await fromSupabase/);
  }
});

test('the unified item view reads both Supabase catalogs, never Sheet fallback', () => {
  assert.match(source, /combineItemCatalog\(\.\.\.await Promise\.all\(\[getCatalog\(ITEM_SHEET\), getCatalog\(EXPENSE_SHEET\)\]\)\)/);
  const refresh = source.slice(source.indexOf('async function refresh('), source.indexOf('async function load(', source.indexOf('async function refresh(')));
  assert.match(refresh, /catalog = await fromSupabase\(sheetName,false,old\?\.catalog,knownVersions\)/);
  assert.doesNotMatch(refresh, /legacyLoad\(/);
});

test('expense rows retain their own source sheet and record identity', () => {
  assert.match(source, /__sourceSheet: EXPENSE_SHEET/);
  assert.match(source, /__rowNumber: `\$\{EXPENSE_SHEET\}:\$\{row\.__rowNumber\}`/);
  assert.match(source, /clean\.expense_item_id \|\|=/);
});

test('writes require Supabase session and mirror only after successful primary write', () => {
  const save = source.slice(source.indexOf('async function save('), source.indexOf('async function setActive('));
  assert.match(save, /if \(!sessionData\?\.session\) throw/);
  assert.match(save, /bulk_upsert_master_catalog_rows/);
  assert.ok(save.indexOf('if (error) throw error') < save.indexOf('legacySave("mirror")'));
  assert.doesNotMatch(save, /legacySave\("fallback"\)/);
});

test('old queues are not sent automatically and conflicts stop replay', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');
  assert.doesNotMatch(page, /setTimeout\(sendPendingItems/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => syncAllPending/);
  assert.match(source, /ข้อมูลใน Supabase ต่างจากเครื่องนี้/);
  assert.match(source, /payload\.__version = matching\.__version/);
});

test('catalog editor does not write Sheet directly when Supabase support is missing', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');
  assert.match(page, /if\(!window\.BOY_MASTER_STORE\?\.load\)throw new Error/);
  assert.match(page, /if\(!window\.BOY_MASTER_STORE\?\.save\)throw new Error/);
  assert.match(page, /if\(!window\.BOY_MASTER_STORE\?\.bulkSave\)throw new Error/);
  assert.match(page, /const legacySave=\(\)=>api\('sheetBulkSave',\{sheetName:savedSheet,rows:\[values\]/);
  assert.doesNotMatch(source, /replace_master_catalog_rows/);
  assert.doesNotMatch(source, /google-sheets-fallback/);
});

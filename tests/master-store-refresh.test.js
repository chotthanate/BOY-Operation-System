const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'boy-master-store.js'), 'utf8');

test('the unified item view reads both Supabase catalogs, never Sheet fallback', () => {
  assert.match(source, /combineItemCatalog\(\.\.\.await Promise\.all\(\[getCatalog\(ITEM_SHEET\), getCatalog\(EXPENSE_SHEET\)\]\)\)/);
  const refresh = source.slice(source.indexOf('async function refresh('), source.indexOf('async function load(', source.indexOf('async function refresh(')));
  assert.match(refresh, /catalog = await fromSupabase\(sheetName\)/);
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

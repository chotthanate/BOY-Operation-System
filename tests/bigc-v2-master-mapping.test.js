const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bigc-v2.html'), 'utf8');
const home = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const authGuard = fs.readFileSync(path.join(__dirname, '..', 'assets/js/boy-auth-guard.js'), 'utf8');

test('BigC settings select several stable master item IDs, not typed product names', () => {
  assert.match(page, /id="editItemMasterList"/);
  assert.match(page, /bigc-master-mapping\.js/);
  assert.match(script, /target_sheet_name: "M_สินค้า"/);
  assert.match(script, /state\.editingMasterCodes = masterItemCodes\(item\)/);
  assert.match(script, /withMasterItemCodes\(item, state\.editingMasterCodes\)/);
  assert.match(script, /masterItemIds: masterItemCodes\(item\)/);
});

test('BigC menu visibility and cost UUID are saved separately from the master ID', () => {
  assert.match(page, /id="editItemActive"/);
  assert.match(script, /item\.active = \$\("#editItemActive"\)\.checked/);
  assert.match(script, /item\.itemId = item\.masterItemId \? state\.normalizedItemsByCode\.get\(item\.masterItemId\) \|\| null : null/);
});

test('admin has a reviewable mapping workspace with safe exact-name suggestions', () => {
  assert.match(page, /id="openMappingManager"/);
  assert.match(page, /id="mappingFilter"/);
  assert.match(script, /function exactMasterSuggestion/);
  assert.match(script, /matches\.length === 1 \? matches\[0\] : null/);
  assert.match(script, /saveMappings/);
});

test('back office opens the online full version in a new tab', () => {
  assert.match(home, /href="bigc-v2\.html\?view=admin&amp;online=1" target="_blank" rel="noopener"/);
  assert.match(authGuard, /requireOnline/);
  assert.match(authGuard, /if \(!requireOnline && allowLocalAccess\(\)\) return/);
});

test('employee link hides catalog settings and keeps sorting local to that device', () => {
  assert.match(page, /bigc-v2\.html\?view=staff&amp;online=1/);
  assert.match(script, /document\.body\.classList\.toggle\("staff-view", staff\)/);
  assert.match(script, /\$\("#settingsButton"\)\.hidden = staff \|\| !state\.access\?\.canManage/);
  assert.match(script, /localStorage\.setItem\(STAFF_SORT_KEY/);
  assert.match(script, /บันทึกลำดับสำหรับเครื่องนี้แล้ว/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bigc-v2.html'), 'utf8');

test('BigC settings select a stable master item ID, not a typed product name', () => {
  assert.match(page, /id="editItemMasterId"/);
  assert.match(script, /target_sheet_name: "M_สินค้า"/);
  assert.match(script, /item\.masterItemId = \$\("#editItemMasterId"\)\.value \|\| null/);
  assert.match(script, /masterItemId: item\.masterItemId \|\| item\.master_item_id \|\| null/);
});

test('BigC menu visibility and cost UUID are saved separately from the master ID', () => {
  assert.match(page, /id="editItemActive"/);
  assert.match(script, /item\.active = \$\("#editItemActive"\)\.checked/);
  assert.match(script, /item\.itemId = item\.masterItemId \? state\.normalizedItemsByCode\.get\(item\.masterItemId\) \|\| null : null/);
});

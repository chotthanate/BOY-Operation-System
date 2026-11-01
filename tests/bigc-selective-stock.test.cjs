const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'bigc-v2.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/js/bigc-v2.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261101161524_bigc_selective_branch_stock.sql'), 'utf8');

test('manager can configure BigC quantity tracking separately from Tawana deduction', () => {
  assert.match(page, /id="editItemStockBigc"/);
  assert.match(page, /id="editItemStockTawana"/);
  assert.match(script, /stockAtBigc: item\.stockAtBigc === true/);
  assert.match(script, /deductTawanaStock: item\.deductTawanaStock === true/);
  assert.match(script, /item\.deductTawanaStock = item\.stockAtBigc &&/);
});

test('database moves stock only for enabled menu items and checks conversion', () => {
  assert.match(migration, /p\.menu_item->>'stockAtBigc'='true'/);
  assert.match(migration, /p\.menu_item->>'deductTawanaStock'='true'/);
  assert.match(migration, /where p\.workflow_id=target_workflow_id or w\.enabled/);
  assert.match(migration, /iu\.conversion_to_base/);
  assert.match(migration, /next_quantity<0/);
  assert.match(migration, /workflow_row\.workflow_type='return'/);
  assert.match(migration, /source_deducted boolean not null default true/);
});

test('Tawana automatic deduction is initially limited to the three agreed cups', () => {
  assert.match(migration, /central_item\.code not in \('ITEM-0142','ITEM-0143','ITEM-0144'\)/);
});

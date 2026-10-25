const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bigc-v2.html'), 'utf8');
const costingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261010193000_bigc_interbranch_cost_allocations.sql'), 'utf8');
const canonicalMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261025113948_canonical_bigc_fruit_workflow.sql'), 'utf8');

test('prepared display forms keep a stable canonical master item and UUID', () => {
  assert.match(canonicalMigration, /'แตงโม','ITEM-0011'/);
  assert.match(canonicalMigration, /'สับปะรด','ITEM-0012'/);
  assert.match(canonicalMigration, /'น้ำมะนาว','ITEM-0016'/);
  assert.match(canonicalMigration, /'handlingType',mapped\.handling_type/);
  assert.match(canonicalMigration, /'itemId',i\.id/);
});

test('legacy prepared products are archived rather than deleted', () => {
  assert.match(canonicalMigration, /'ITEM-0256','ITEM-0257','ITEM-0258','ITEM-0260','ITEM-0261','ITEM-0263'/);
  assert.match(canonicalMigration, /'เปิดใช้งาน',false/);
  assert.doesNotMatch(canonicalMigration, /delete\s+from\s+boy_central\.master_catalog_rows/i);
});

test('receipt lines persist both canonical master code and costing UUID', () => {
  assert.match(script, /item_id: item\.itemId \|\| item\.item_id \|\| null, master_item_id: item\.masterItemId/);
  assert.match(costingMigration, /add column if not exists master_item_id text/);
  assert.match(costingMigration, /'master_item_id',l\.master_item_id/);
});

test('admin can enter yield and optional average raw weight per piece', () => {
  assert.match(page, /id="fruitCostYieldPercent"/);
  assert.match(page, /id="fruitCostKgPerPiece"/);
  assert.match(script, /admin_save_bigc_interbranch_cost_rule/);
  assert.match(script, /yield_ratio: hasYield \? yieldPercent \/ 100 : null/);
  assert.match(script, /admin_save_bigc_piece_weight/);
});

test('fruit conversion uses observed usable weight and never creates another purchase', () => {
  assert.match(costingMigration, /else line_row\.actual_weight_kg\/yield_value end/);
  assert.match(costingMigration, /raw_equivalent_value:=round\(raw_equivalent_value,6\)/);
  assert.match(costingMigration, /Internal branch reallocation ledger/);
  assert.match(costingMigration, /company_cost_delta = 0/);
});

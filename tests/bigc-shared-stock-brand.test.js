const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets/js/bigc-v2.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261026120000_bigc_yogurt_shared_stock.sql'), 'utf8');

test('BigC keeps one order item per yogurt flavor and 5 kg container size', () => {
  assert.match(migration, /ITEM-YOG-PLAIN-5KG/);
  assert.match(migration, /ITEM-YOG-STRAW-5KG/);
  assert.match(migration, /'UNIT-010'/);
  assert.match(migration, /'stock_target_item_id',variant\.pool_code/);
  assert.match(migration, /'masterItemId','ITEM-YOG-PLAIN-5KG'/);
});

test('receiving records the actual brand split and checks totals before saving', () => {
  assert.match(script, /function renderBrandAllocations\(/);
  assert.match(script, /function bindBrandEvents\(/);
  assert.match(script, /total !== number\(line\.quantity\)/);
  assert.match(migration, /allocation_total<>line_quantity/);
  assert.match(migration, /child\.stock_target_item_id=line_item_id/);
});

test('BigC catalog mapping does not require stock tracking', () => {
  assert.match(script, /ensure_bigc_catalog_items/);
  assert.match(migration, /create or replace function boy_central\.ensure_bigc_catalog_items/);
  assert.match(migration, /coalesce\(\(catalog\.row_data->>'ติดตามสต็อก'\)::boolean,false\)/);
  assert.match(migration, /refresh_bigc_standard_costs/);
  assert.match(migration, /receipt_conversion/);
});

test('shared stock transfers reconcile corrections and never consume uncounted stock', () => {
  assert.match(migration, /bigc_shared_stock_postings/);
  assert.match(migration, /delta:=posting\.wanted_quantity-posting\.posted_quantity/);
  assert.match(migration, /balance_row\.quantity_on_hand<delta/);
  assert.match(migration, /perform boy_central_private\.reconcile_bigc_shared_stock\(target_id\)/);
});

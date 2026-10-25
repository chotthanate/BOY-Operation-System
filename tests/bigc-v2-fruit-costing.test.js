const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bigc-v2.html'), 'utf8');
const costingMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261010193000_bigc_interbranch_cost_allocations.sql'), 'utf8');
const canonicalMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261025113948_canonical_bigc_fruit_workflow.sql'), 'utf8');
const revaluationMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261026040000_auto_revalue_bigc_monthly_costs.sql'), 'utf8');
const settingRevaluationMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261026042000_auto_revalue_bigc_cost_settings.sql'), 'utf8');

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

test('later Tawana purchases automatically revalue open BigC receipts', () => {
  assert.match(revaluationMigration, /revalue_bigc_costs_for_month/);
  assert.match(revaluationMigration, /after insert or delete or update of company_id,transaction_id,item_id,quantity,unit_id,line_total/);
  assert.match(revaluationMigration, /after update of company_id,branch_id,transaction_type,transaction_date,status,affects_stock/);
  assert.match(revaluationMigration, /refresh_bigc_interbranch_costs\(workflow_record\.workflow_id\)/);
  assert.match(revaluationMigration, /a\.cost_status in \('pending','provisional'\)/);
  assert.match(revaluationMigration, /reversal\.cost_status='reversed'/);
  assert.doesNotMatch(revaluationMigration, /a\.cost_status in \([^\n]*'final'/);
});

test('later fruit yield and piece-weight settings revalue prior receipts', () => {
  assert.match(settingRevaluationMigration, /revalue_bigc_costs_after_rule_setting/);
  assert.match(settingRevaluationMigration, /revalue_bigc_costs_after_yield_setting/);
  assert.match(settingRevaluationMigration, /revalue_bigc_costs_after_piece_weight_setting/);
  assert.match(settingRevaluationMigration, /revalue_bigc_costs_for_month/);
  assert.match(script, /ระบบคำนวณต้นทุนรายการเดิมให้อัตโนมัติ/);
});

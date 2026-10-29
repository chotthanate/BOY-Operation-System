const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261028123842_bigc_mulberry_shared_stock.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/js/bigc-v2.js'), 'utf8');

test('three 1 kg mulberry brands are grouped as one bag stock item', () => {
  assert.match(migration, /ITEM-MULBERRY-FROZEN-1KG/);
  for (const code of ['ITEM-0039', 'ITEM-0350', 'ITEM-0351']) assert.match(migration, new RegExp(code));
  assert.match(migration, /stock_target_item_id.*ITEM-MULBERRY-FROZEN-1KG/s);
  assert.match(migration, /'base_unit_id','UNIT-001'/);
  assert.match(migration, /'masterItemIds',jsonb_build_array\('ITEM-MULBERRY-FROZEN-1KG'/);
});

test('BigC keeps the pooled ID for transfer and requires actual brand split at receipt', () => {
  assert.match(app, /function sharedStockOptions/);
  assert.match(app, /function renderBrandAllocations/);
  assert.match(app, /await loadMasterItems\(\)/);
  assert.match(app, /ข้อมูลยี่ห้อของ \$\{incompleteBrands\.item_name\} โหลดไม่ครบ/);
  assert.match(app, /เลือกยี่ห้อและจำนวน\$\{findMenu\(invalidBrand\.line_key/);
});

test('an old local settings draft cannot silently replace the new pooled mapping', () => {
  assert.match(app, /pending\._baseFingerprint !== cloudFingerprint/);
  assert.match(app, /ข้อมูลตั้งค่าออนไลน์เปลี่ยนจากอีกเครื่องแล้ว/);
  assert.match(app, /localStorage\.removeItem\(SETTINGS_PENDING_KEY\)/);
});

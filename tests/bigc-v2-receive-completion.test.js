const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'assets/css/bigc-v2.css'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'bigc-v2.html'), 'utf8');

test('iPhone ordering shows three compact cards per row and desktop remains responsive', () => {
  assert.match(styles, /\.order-grid\{grid-template-columns:repeat\(auto-fit,minmax\(140px,1fr\)\)/);
  assert.match(styles, /@media\(max-width:600px\)[\s\S]*\.order-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('order summary uses circular quantity buttons', () => {
  assert.match(styles, /\.summary-row \.qty-control button\{[^}]*border-radius:50%/);
});

test('a completed receipt clears its local draft and is not seeded again', () => {
  assert.match(script, /if \(!submitted\.receive\) seedReceiveFromPrevious/);
  assert.match(script, /if \(receive\) clearCompletedReceiveDraft/);
  assert.match(script, /if \(type === "receive"\) \{\s*clearCompletedReceiveDraft\(payload\.business_date\)/);
});

test('settings are separated by category and iPhone fields do not trigger focus zoom', () => {
  assert.match(script, /setting-category-group/);
  assert.match(styles, /\.setting-category-group\+\.setting-category-group\{[^}]*border-top:2px/);
  assert.match(styles, /\.modal-sheet input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[\s\S]*font-size:16px/);
});

test('settings hub keeps close and category navigation visible while browsing long lists', () => {
  for (const section of ['items', 'units', 'costing', 'returns']) {
    assert.match(page, new RegExp(`data-settings-section="${section}"`));
  }
  assert.match(page, /id="settingsBack"/);
  assert.match(page, /id="settingsCategoryNav"/);
  assert.match(script, /function showSettingsSection\(section\)/);
  assert.match(script, /data-settings-category/);
  assert.match(styles, /\.settings-sheet>\.settings-header\{position:sticky/);
  assert.match(styles, /\.settings-category-nav\{position:sticky/);
  assert.match(styles, /\.settings-save-bar\{position:sticky/);
});

test('item editor can move an item to an existing category or create a new one', () => {
  assert.match(page, /<select id="editItemCategory"/);
  assert.match(page, /id="editItemNewCategoryField"/);
  assert.match(script, /categoryNames\(\), category/);
  assert.match(script, /value="__new__"/);
  assert.match(script, /editItemCategory"\)\.value === "__new__" \? \$\("#editItemNewCategory"\)\.value\.trim\(\)/);
});

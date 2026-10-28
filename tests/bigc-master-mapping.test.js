const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { codesFor, withCodes, canonicalCodeFor, matchesSearch } = require('../assets/js/bigc-master-mapping.js');

function appSettingsFunctions() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
  const context = { location: { search: '' }, URLSearchParams, window: { addEventListener() {} }, BOYBigCMasterMapping: { codesFor, withCodes, canonicalCodeFor, matchesSearch } };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.__test = { settingsMenu, settingsPayload, settingsFingerprint };})();'), context);
  return context.__test;
}

test('legacy single-item mapping becomes a one-item list without losing the primary item', () => {
  const legacy = { masterItemId: 'ITEM-100', itemId: 'uuid-one' };
  assert.deepEqual(codesFor(legacy), ['ITEM-100']);
  assert.deepEqual(withCodes(legacy, codesFor(legacy)), {
    masterItemId: 'ITEM-100', masterItemIds: ['ITEM-100'], itemId: 'uuid-one'
  });
});

test('linked brands resolve to one central stock pool without selecting a primary brand', () => {
  const items = new Map([
    ['POOL', { id: 'pool-id', code: 'POOL' }],
    ['BRAND-A', { id: 'a-id', code: 'BRAND-A', stock_target_item_id: 'pool-id' }],
    ['BRAND-B', { id: 'b-id', code: 'BRAND-B', stock_target_item_id: 'pool-id' }],
    ['OTHER', { id: 'other-id', code: 'OTHER' }]
  ]);
  assert.deepEqual(canonicalCodeFor(['BRAND-B', 'BRAND-A'], items), { code: 'POOL', error: '' });
  assert.match(canonicalCodeFor(['BRAND-A', 'OTHER'], items).error, /ไม่ได้อยู่ในสต็อกรวมเดียวกัน/);
  assert.deepEqual(canonicalCodeFor(['NEW'], items), { code: 'NEW', error: '' });
});

test('multiple links survive reload and keep one explicit primary item', () => {
  const linked = withCodes({}, ['ITEM-100', 'ITEM-200', 'ITEM-100'], 'ITEM-200');
  assert.deepEqual(linked.masterItemIds, ['ITEM-200', 'ITEM-100']);
  assert.equal(linked.masterItemId, 'ITEM-200');
  assert.deepEqual(codesFor(JSON.parse(JSON.stringify(linked))), ['ITEM-200', 'ITEM-100']);
});

test('removing a primary item promotes the next selected item; clearing all links clears primary', () => {
  assert.deepEqual(withCodes({}, ['ITEM-200', 'ITEM-300'], 'ITEM-100').masterItemIds, ['ITEM-200', 'ITEM-300']);
  assert.equal(withCodes({}, [], 'ITEM-100').masterItemId, null);
});

test('older payloads with snake-case mapping arrays remain readable', () => {
  assert.deepEqual(codesFor({ master_item_id: 'ITEM-100', master_item_ids: ['ITEM-200'] }), ['ITEM-100', 'ITEM-200']);
});

test('central product search finds Thai spelling variants and all cranberry brands', () => {
  const products = [
    { code: 'ITEM-0346', name: 'แครนเบอร์รี แช่แข็ง aro 1 กก.' },
    { code: 'ITEM-0037', name: 'แครนเบอร์รี แช่แข็ง Savepak 1 กก.' },
    { code: 'ITEM-0347', name: 'แครนเบอร์รี แช่แข็ง Supersave 1 กก.' },
    { code: 'ITEM-0010', name: 'สตรอว์เบอร์รี แช่แข็ง 1 กก.' }
  ];
  assert.deepEqual(products.filter((product) => matchesSearch(product, 'แครนเบอร์รี่ แช่แข็ง')).map((product) => product.code),
    ['ITEM-0346', 'ITEM-0037', 'ITEM-0347']);
  assert.equal(matchesSearch(products[0], 'ITEM-0346'), true);
});

test('BigC settings save and reload every linked item while keeping the primary cost UUID', () => {
  const { settingsMenu, settingsPayload, settingsFingerprint } = appSettingsFunctions();
  const menu = settingsMenu({ menu_config: [{ key: 'yogurt', displayName: 'โยเกิร์ต 5 กก.', itemId: 'primary-uuid', masterItemId: 'ITEM-100', masterItemIds: ['ITEM-100', 'ITEM-200'] }] }, []);
  const saved = settingsPayload(menu);
  const reloaded = settingsMenu(JSON.parse(JSON.stringify(saved)), []);
  assert.deepEqual(Array.from(reloaded[0].masterItemIds), ['ITEM-100', 'ITEM-200']);
  assert.equal(reloaded[0].masterItemId, 'ITEM-100');
  assert.equal(reloaded[0].itemId, 'primary-uuid');
  assert.equal(settingsFingerprint(saved), settingsFingerprint({ ...saved, menu_config: reloaded }));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');
const settingsSource = html.slice(html.indexOf('    function itemPurchaseSettings('), html.indexOf('    function renderItemPurchaseSettings('));
const saveSource = html.slice(html.indexOf('    function newMasterCode('), html.indexOf('    async function save(e)'));

test('the item editor reads an alternate purchase unit and its conversion', () => {
  const context = {
    referenceCache: { itemUnits: { rows: [
      { item_id: 'ITEM-1', unit_id: 'UNIT-PIECE', 'ใช้หน่วยนี้ตอนซื้อ': true, 'เปิดใช้งาน': true },
      { item_id: 'ITEM-1', unit_id: 'UNIT-PACK', 'ใช้หน่วยนี้ตอนซื้อ': true, 'อัตราแปลงเป็นหน่วยฐาน': 10, 'เปิดใช้งาน': true }
    ] } },
    active: row => row['เปิดใช้งาน'] !== false
  };
  vm.createContext(context);
  vm.runInContext(settingsSource, context);
  const result = context.itemPurchaseSettings({ item_id: 'ITEM-1', base_unit_id: 'UNIT-PIECE' });
  assert.equal(result.same, false);
  assert.equal(result.unitId, 'UNIT-PACK');
  assert.equal(result.conversion, 10);
});

test('switching back to the base unit clears the old purchase choice', async () => {
  const saved = [];
  const catalog = { rows: [
    { __rowNumber: 2, item_unit_id: 'IU-1', item_id: 'ITEM-1', unit_id: 'UNIT-PIECE', 'เป็นหน่วยฐาน': true, 'ใช้หน่วยนี้ตอนซื้อ': false, 'อัตราแปลงเป็นหน่วยฐาน': 1, 'เปิดใช้งาน': true },
    { __rowNumber: 3, item_unit_id: 'IU-2', item_id: 'ITEM-1', unit_id: 'UNIT-PACK', 'เป็นหน่วยฐาน': false, 'ใช้หน่วยนี้ตอนซื้อ': true, 'อัตราแปลงเป็นหน่วยฐาน': 10, 'เปิดใช้งาน': true }
  ] };
  const context = {
    referenceCache: { itemUnits: catalog },
    active: row => row['เปิดใช้งาน'] !== false,
    actor: () => ({ name: 'tester' }),
    api: async () => ({}),
    window: { BOY_MASTER_STORE: { save: async (_sheet, rowNumber, values) => {
      saved.push({ rowNumber, values });
      return catalog;
    } } }
  };
  vm.createContext(context);
  vm.runInContext(saveSource, context);
  await context.saveItemPurchaseSettings('ITEM-1', 'UNIT-PIECE', '', 1);
  assert.equal(saved.length, 2);
  assert.equal(saved.find(row => row.values.unit_id === 'UNIT-PACK').values['ใช้หน่วยนี้ตอนซื้อ'], false);
  assert.equal(saved.find(row => row.values.unit_id === 'UNIT-PIECE').values['ใช้หน่วยนี้ตอนซื้อ'], true);
});

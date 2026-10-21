const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');
const start = html.indexOf('    function itemBaseUnit(');
const end = html.indexOf('    function wireConditionalFields(', start);
assert.ok(start >= 0 && end > start);
const source = html.slice(start, end);

function makeEditor({ baseUnit = 'UNIT-CAN', purchaseUnit = 'UNIT-PACK', rateValue = '6', rows = [], editing = null } = {}) {
  const handlers = {};
  const classList = () => ({ toggle() {}, add() {} });
  const same = { checked: false, disabled: false, addEventListener: (event, callback) => { handlers[`same:${event}`] = callback; } };
  const baseName = { textContent: '' };
  const choice = { className: '', innerHTML: '', querySelector: selector => selector === '[data-same-purchase-unit]' ? same : baseName };
  const preview = { textContent: '', setAttribute() {}, classList: classList() };
  const unitField = { classList: classList(), insertAdjacentElement: (_position, node) => assert.equal(node, choice) };
  const label = { textContent: '' };
  const rateField = { classList: classList(), querySelector: () => label, insertAdjacentElement: (_position, node) => assert.equal(node, preview) };
  const element = (name, value, field) => ({ value, closest: () => field, addEventListener: (event, callback) => { handlers[`${name}:${event}`] = callback; } });
  const item = element('item', 'ITEM-1');
  const unit = element('unit', purchaseUnit, unitField);
  const rate = { ...element('rate', rateValue, rateField), setCustomValidity: message => { rate.validationMessage = message; } };
  const baseFlag = { checked: false, closest: () => ({ classList: classList() }) };
  const purchaseFlag = { checked: false, closest: () => ({ classList: classList() }) };
  const form = { elements: { item_id: item, unit_id: unit, 'อัตราแปลงเป็นหน่วยฐาน': rate, 'เป็นหน่วยฐาน': baseFlag, 'ใช้หน่วยนี้ตอนซื้อ': purchaseFlag } };
  const context = {
    referenceCache: {
      items: { rows: [{ item_id: 'ITEM-1', base_unit_id: baseUnit }] },
      units: { rows: [{ unit_id: 'UNIT-CAN', 'ชื่อหน่วย': 'กระป๋อง' }, { unit_id: 'UNIT-PACK', 'ชื่อหน่วย': 'แพ็ค' }] }
    },
    referenceLabel: (entity, id) => context.referenceCache[entity].rows.find(row => row[entity === 'units' ? 'unit_id' : 'item_id'] === id)?.['ชื่อหน่วย'] || id,
    activeValue: value => ![false, 'FALSE', 'false', 0, '0', ''].includes(value),
    catalog: { rows }, editing,
    document: { createElement: () => context.created++ === 0 ? choice : preview },
    created: 0,
    $: selector => selector === '#form' ? form : selector === '#editorTitle' ? { textContent: '' } : null
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.wireItemUnitEditor();
  return { item, unit, rate, baseFlag, purchaseFlag, same, baseName, preview, handlers };
}

test('different purchase unit clearly shows conversion into the item base unit', () => {
  const editor = makeEditor();
  assert.equal(editor.same.checked, false);
  assert.equal(editor.baseName.textContent, 'กระป๋อง');
  assert.equal(editor.preview.textContent, '1 แพ็ค = 6 กระป๋อง');
  assert.equal(editor.rate.min, '0.000001');
  assert.equal(editor.rate.step, '0.000001');
  assert.equal(editor.rate.validationMessage, '');
  assert.equal(editor.purchaseFlag.checked, true);
  editor.rate.value = '0.25';
  editor.handlers['rate:input']();
  assert.equal(editor.preview.textContent, '1 แพ็ค = 0.25 กระป๋อง');
});

test('same purchase and base unit always means one-to-one conversion', () => {
  const editor = makeEditor();
  editor.same.checked = true;
  editor.handlers['same:change']();
  assert.equal(editor.unit.value, 'UNIT-CAN');
  assert.equal(editor.rate.value, '1');
  assert.equal(editor.baseFlag.checked, true);
  assert.equal(editor.rate.validationMessage, '');
  editor.same.checked = false;
  editor.handlers['same:change']();
  assert.equal(editor.unit.value, 'UNIT-PACK');
  assert.equal(editor.rate.value, '6');
});

test('an existing base-unit row cannot be turned into a different purchase unit', () => {
  const editor = makeEditor({ purchaseUnit: 'UNIT-CAN', rateValue: '1', editing: { __rowNumber: 8, 'เป็นหน่วยฐาน': true } });
  assert.equal(editor.same.checked, true);
  assert.equal(editor.same.disabled, true);
});

test('opening from a unit keeps that unit selected until the item is chosen', () => {
  const editor = makeEditor({ baseUnit: 'UNIT-CAN', purchaseUnit: 'UNIT-PACK', rateValue: '' });
  editor.item.value = '';
  editor.handlers['item:change']();
  assert.equal(editor.unit.value, 'UNIT-PACK');
  editor.item.value = 'ITEM-1';
  editor.handlers['item:change']();
  assert.equal(editor.unit.value, 'UNIT-PACK');
  assert.equal(editor.same.checked, false);
});

test('missing base unit and duplicate item-unit pair are rejected', () => {
  const missing = makeEditor({ baseUnit: '' });
  assert.match(missing.rate.validationMessage, /ไม่มีหน่วยฐาน/);
  const duplicate = makeEditor({ rows: [{ item_id: 'ITEM-1', unit_id: 'UNIT-PACK', __rowNumber: 8 }] });
  assert.match(duplicate.rate.validationMessage, /มีหน่วยซื้อดังกล่าวอยู่แล้ว/);
  const ownRow = makeEditor({ rows: [{ item_id: 'ITEM-1', unit_id: 'UNIT-PACK', __rowNumber: 8 }], editing: { __rowNumber: 8 } });
  assert.equal(ownRow.rate.validationMessage, '');
});

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
  const preview = { textContent: '', setAttribute() {}, classList: { toggle() {} } };
  const field = { querySelector: () => ({ textContent: '' }), insertAdjacentElement: (_position, node) => assert.equal(node, preview) };
  const element = (name, value) => ({ value, addEventListener: (event, callback) => { handlers[`${name}:${event}`] = callback; } });
  const item = element('item', 'ITEM-1');
  const unit = element('unit', purchaseUnit);
  const rate = { ...element('rate', rateValue), closest: () => field, setCustomValidity: message => { rate.validationMessage = message; } };
  const baseFlag = { checked: false, addEventListener: (event, callback) => { handlers[`base:${event}`] = callback; } };
  const form = { elements: { item_id: item, unit_id: unit, 'อัตราแปลงเป็นหน่วยฐาน': rate, 'เป็นหน่วยฐาน': baseFlag } };
  const context = {
    referenceCache: {
      items: { rows: [{ item_id: 'ITEM-1', base_unit_id: baseUnit }] },
      units: { rows: [{ unit_id: 'UNIT-CAN', 'ชื่อหน่วย': 'กระป๋อง' }, { unit_id: 'UNIT-PACK', 'ชื่อหน่วย': 'แพ็ค' }] }
    },
    referenceLabel: (entity, id) => context.referenceCache[entity].rows.find(row => row[entity === 'units' ? 'unit_id' : 'item_id'] === id)?.['ชื่อหน่วย'] || id,
    catalog: { rows }, editing,
    document: { createElement: () => preview },
    $: selector => selector === '#form' ? form : selector === '#editorTitle' ? { textContent: '' } : null
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.wireItemUnitEditor();
  return { context, item, unit, rate, baseFlag, preview, handlers };
}

test('purchase conversion shows the actual item base unit and supports precise quantities', () => {
  const editor = makeEditor();
  assert.equal(editor.preview.textContent, '1 แพ็ค = 6 กระป๋อง (หน่วยฐาน)');
  assert.equal(editor.rate.min, '0.000001');
  assert.equal(editor.rate.step, '0.000001');
  assert.equal(editor.rate.validationMessage, '');
  editor.rate.value = '0.25';
  editor.handlers['rate:input']();
  assert.equal(editor.preview.textContent, '1 แพ็ค = 0.25 กระป๋อง (หน่วยฐาน)');
});

test('base unit cannot be configured as multiple base units', () => {
  const editor = makeEditor({ purchaseUnit: 'UNIT-CAN', rateValue: '2' });
  assert.match(editor.rate.validationMessage, /เท่ากับ 1/);
  editor.rate.value = '1';
  editor.handlers['rate:input']();
  assert.equal(editor.rate.validationMessage, '');
});

test('missing base unit and duplicate item-unit pair are rejected before saving', () => {
  const missing = makeEditor({ baseUnit: '' });
  assert.match(missing.rate.validationMessage, /กำหนดหน่วยฐาน/);
  const duplicate = makeEditor({ rows: [{ item_id: 'ITEM-1', unit_id: 'UNIT-PACK', __rowNumber: 8 }] });
  assert.match(duplicate.rate.validationMessage, /มีหน่วยดังกล่าวอยู่แล้ว/);
  const ownRow = makeEditor({ rows: [{ item_id: 'ITEM-1', unit_id: 'UNIT-PACK', __rowNumber: 8 }], editing: { __rowNumber: 8 } });
  assert.equal(ownRow.rate.validationMessage, '');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'master-data.html'), 'utf8');
const functions = ['bulkFields', 'bulkStockLocked', 'bulkStoreChanged', 'nextSequentialMasterCode']
  .map(name => {
    const line = source.split('\n').find(value => value.trimStart().startsWith(`function ${name}(`));
    assert.ok(line, `missing ${name}`);
    return line;
  }).join('\n');

function context(overrides = {}) {
  const field = { value: 'เบิกได้' };
  const scope = {
    current: 'items',
    catalog: {
      idHeader: 'item_id',
      headers: ['item_id', 'ซื้อได้', 'เบิกได้', 'ขายได้', 'เปิดใช้งาน', 'ติดตามสต็อก'],
      readonlyHeaders: []
    },
    isBoolHeader: key => ['ซื้อได้', 'เบิกได้', 'ขายได้', 'เปิดใช้งาน', 'ติดตามสต็อก'].includes(key),
    friendlyHeader: key => key,
    bulkStoreOriginal: new Map(),
    bulkStoreDraft: new Map(),
    $: () => field,
    ...overrides
  };
  vm.createContext(scope);
  vm.runInContext(functions, scope);
  return { scope, field };
}

test('item bulk actions keep only useful controls', () => {
  const { scope } = context();
  const keys = Array.from(scope.bulkFields(), entry => entry[0]);
  assert.deepEqual(keys, ['เปิดใช้งาน', 'ติดตามสต็อก']);
});

test('grouped stock items cannot be toggled as independent stock', () => {
  const { scope } = context();
  assert.equal(scope.bulkStockLocked({ 'รูปแบบสต็อก': 'รวมเข้ารายการอื่น' }), true);
  assert.equal(scope.bulkStockLocked({ stock_target_item_id: 'ITEM-1' }), true);
  assert.equal(scope.bulkStockLocked({ 'รูปแบบสต็อก': 'นับเป็นรายการนี้' }), false);
});

test('only changed boolean rows are selected for saving', () => {
  const { scope } = context({
    bulkStoreOriginal: new Map([['ITEM-1', true], ['ITEM-2', false]]),
    bulkStoreDraft: new Map([['ITEM-1', true], ['ITEM-2', true]])
  });
  assert.deepEqual(Array.from(scope.bulkStoreChanged()), ['ITEM-2']);
});

test('readonly fields are not offered for bulk edits', () => {
  const { scope } = context({
    catalog: { idHeader: 'item_id', headers: ['item_id', 'เบิกได้', 'เปิดใช้งาน'], readonlyHeaders: ['เบิกได้'] }
  });
  assert.deepEqual(Array.from(scope.bulkFields(), entry => entry[0]), ['เปิดใช้งาน']);
});

test('retired category usage flags are not offered for bulk edits', () => {
  const { scope } = context({
    current: 'categories',
    catalog: { idHeader: 'subcategory_id', headers: ['subcategory_id', 'ใช้กับรายจ่าย', 'ใช้กับการเบิก', 'ใช้กับสต็อก', 'เปิดใช้งาน'], readonlyHeaders: [] },
    isBoolHeader: key => ['ใช้กับรายจ่าย', 'ใช้กับการเบิก', 'ใช้กับสต็อก', 'เปิดใช้งาน'].includes(key)
  });
  assert.deepEqual(Array.from(scope.bulkFields(), entry => entry[0]), ['เปิดใช้งาน']);
});

test('new subcategories receive an automatic SUB code before save', () => {
  assert.match(source, /if\(!editing\)values\.subcategory_id=nextSequentialMasterCode\('SUB','subcategory_id',4\)/);
});

test('new employees receive the next internal employee id without reusing the staff code', () => {
  const { scope } = context({
    current: 'employees',
    catalog: { idHeader: 'employee_id', rows: [{ employee_id: 'EMP-009' }, { employee_id: 'EMP-013' }] }
  });
  assert.equal(scope.nextSequentialMasterCode('EMP', 'employee_id', 3), 'EMP-014');
  assert.match(source, /current==='employees'&&!editing\) values\.employee_id=nextSequentialMasterCode\('EMP','employee_id',3\)/);
});

test('employee editor hides the internal id and prefills an editable login code', () => {
  assert.match(source, /current==='employees'&&\['employee_id','เปิดใช้งาน'\]\.includes\(h\)/);
  assert.match(source, /'รหัสพนักงาน':'รหัสเข้าระบบของพนักงาน'/);
  assert.match(source, /generatedEmployeeCode=isEmployee&&!row\?nextSequentialMasterCode\('EMP','employee_id',3\)\.replace\(\/\^EMP-\/,''\):''/);
  assert.match(source, /isEmployee&&h==='รหัสพนักงาน'\?generatedEmployeeCode:''/);
});

test('retired category usage flags are hidden from the editor', () => {
  assert.match(source, /current==='categories'.*\['ใช้กับรายจ่าย','ใช้กับการเบิก','ใช้กับสต็อก'\]\.includes\(h\)/);
});

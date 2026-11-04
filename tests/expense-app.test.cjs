const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(root, 'assets/js/expense-app.js'), 'utf8'), context);
const app = context.window.BOY_EXPENSE_APP;

test('auto supplier requires exactly one distinct product mapping', () => {
  assert.equal(app.onlySupplier([]), '');
  assert.equal(app.onlySupplier(['Makro', ' Makro ']), 'Makro');
  assert.equal(app.onlySupplier([{ name: 'Makro' }, { name: 'Go Wholesale' }]), '');
});

test('payment selection stays per line while transactions are grouped by method', () => {
  const groups = app.groupPayments([{ id: 'one', payment_method: 'credit_card' }, { id: 'two', payment_method: 'cash' }, { id: 'three', payment_method: 'credit_card' }, { id: 'legacy' }], 'cash');
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups[0].lines, row => row.id), ['one', 'three']);
  assert.deepEqual(Array.from(groups[1].lines, row => row.id), ['two', 'legacy']);
});

test('supplier mapping respects product identity, branch scope, and inactive rows', () => {
  const item = { id: 'uuid-item', code: 'ITEM-1' };
  const branch = { id: 'uuid-branch', code: 'BURGER' };
  const suppliers = [{ supplier_id: 'SUP-1', 'ชื่อผู้ขาย': 'Makro', 'เปิดใช้งาน': true }, { supplier_id: 'SUP-2', 'ชื่อผู้ขาย': 'Other' }];
  const links = [
    { item_id: 'ITEM-1', supplier_id: 'SUP-1', branch_id: 'BR-005' },
    { item_id: 'ITEM-1', supplier_id: 'SUP-2', branch_id: 'TAWANA' },
    { item_id: 'OTHER', supplier_id: 'SUP-2' },
    { item_id: 'ITEM-1', supplier_id: 'SUP-2', 'เปิดใช้งาน': false }
  ];
  const rows = app.mappedSuppliers(item, branch, links, suppliers, [{ branch_id: 'BR-005', 'รหัสสาขา': 'BURGER' }]);
  assert.deepEqual(Array.from(rows), ['Makro']);
});

test('purchases without stock tracking retain item UUID, quantity, and unit', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/burger.js'), 'utf8');
  const c = vm.createContext({
    state: { items: [{ id: 'uuid-item', name: 'แครอท', code: 'ITEM-1' }], expenseItems: [{ id: 'uuid-expense', name: 'แครอท', item_id: 'uuid-item', affects_stock: false }], units: [{ id: 'uuid-unit' }], categories: [] },
    normalizePaymentMethod: value => value || 'cash', mainCategoryId: () => null
  });
  vm.runInContext(source.slice(source.indexOf('  function normalizeQueuedExpensePayload'), source.indexOf('  function normalizeQueuedMasterPayload')), c);
  const result = c.normalizeQueuedExpensePayload({ lines: [{ item_id: 'uuid-item', expense_item_id: 'uuid-expense', description: 'แครอท', quantity: 2, unit_id: 'uuid-unit', line_total: 60 }] });
  assert.equal(result.lines[0].item_id, 'uuid-item');
  assert.equal(result.lines[0].expense_item_id, null);
  assert.equal(result.lines[0].quantity, 2);
  assert.equal(result.lines[0].unit_id, 'uuid-unit');
});

test('a purchased item can be selected even without a separate expense definition', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/burger.js'), 'utf8');
  const c = vm.createContext({ state: { expenseItems: [], items: [{ id: 'uuid-item', name: 'เนื้อ', code: 'ITEM-1', track_stock: true, active: true }] } });
  vm.runInContext(source.slice(source.indexOf('  function expenseOptions'), source.indexOf('  function isExpenseActive')), c);
  assert.equal(c.expenseById('purchase:uuid-item').item_id, 'uuid-item');
});

function submissionHarness(results) {
  const source = fs.readFileSync(path.join(root, 'assets/js/burger.js'), 'utf8');
  const queue = [], calls = [], storage = new Map(), nodes = new Map();
  const lines = ['cash', 'credit_card'].map((payment_method, i) => ({ id: `line-${i}`, payment_method, description: 'สินค้า', quantity: 2, unit_id: 'unit', line_total: 60, supplier_name: '', note: '' }));
  let id = 0;
  const c = vm.createContext({
    state: { lines, suppliers: [], branch: { id: 'branch' }, session: { user: { id: 'user' } }, syncing: false },
    window: { BOY_EXPENSE_APP: app }, crypto: { randomUUID: () => `request-${++id}` }, branchApp: { sourceSystem: 'test' }, Date, Set,
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, { value: selector === '#expenseDate' ? '2026-11-05' : 'cash', close() {} }); return nodes.get(selector); },
    localStorage: { setItem: (key, value) => storage.set(key, value) },
    queueOperation: (type, payload, meta) => queue.push({ id: payload.idempotency_key, type, payload, meta }),
    readOutbox: () => queue.slice(), writeOutbox: rows => queue.splice(0, queue.length, ...rows),
    client: { schema: () => ({ rpc: async (_, { payload }) => { calls.push(payload); const result = results.shift(); if (result instanceof Error) throw result; return result || { data: {}, error: null }; } }) },
    centralAvailable: () => true, validateExpense: () => [], normalizeQueuedExpensePayload: x => x,
    lineRequirements: () => ({ quantity: true, unit: true }), lineCategoryId: () => 'cat',
    draftKeyForDate: date => `draft:${date}`, draftPayload: () => ({ lines: c.state.lines, saved_at: new Date().toISOString() }),
    newLine: () => ({ id: 'blank', description: '' }), renderLines() {}, saveDraftNow: async () => {}, updateSyncStatus() {},
    loadExpenseHistory: async () => {}, loadPendingReceipts: async () => {}, toast() {}, lastSyncKey: () => 'sync', clearTimeout() {},
    isNetworkError: error => /network|fetch/i.test(error.message)
  });
  vm.runInContext(source.slice(source.indexOf('  async function submitExpense()'), source.indexOf('  function renderPendingReceipts()')), c);
  return { c, queue, calls, storage };
}

test('mixed payment submission writes the matching method and clears only accepted lines', async () => {
  const h = submissionHarness([]);
  await h.c.submitExpense();
  assert.deepEqual(h.calls.map(row => row.payment.method), ['cash', 'credit_card']);
  assert.equal(h.queue.length, 0);
  assert.equal(h.c.state.lines[0].id, 'blank');
});

test('uncertain network result retains the exact idempotent request in the outbox', async () => {
  const h = submissionHarness([new Error('Failed to fetch')]);
  await h.c.submitExpense();
  assert.equal(h.queue.length, 1);
  assert.equal(h.queue[0].payload.idempotency_key, h.calls[0].idempotency_key);
  assert.equal(h.queue[0].meta.line_ids[0], 'line-0');
  assert.equal(h.c.state.lines[0].id, 'blank');
});

test('a rejected second payment group restores that group without duplicating the first', async () => {
  const h = submissionHarness([null, { error: { message: 'invalid purchase unit' } }]);
  await h.c.submitExpense();
  assert.equal(h.queue.length, 0);
  assert.deepEqual(Array.from(h.c.state.lines, row => row.id), ['line-1']);
  assert.equal(h.c.state.syncing, false);
});

test('finishing an outbox group preserves unrelated drafts and uses the cloud version condition', async () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/burger.js'), 'utf8');
  const local = { lines: [{ id: 'sent' }, { id: 'unsent' }] };
  let updated, version;
  const c = vm.createContext({
    state: { branch: { id: 'branch' }, session: { user: { id: 'user' } } }, Date, Set,
    readCache: () => local, draftKeyForDate: date => date, localStorage: { setItem() {} }, centralAvailable: () => true,
    client: { schema: () => ({ from: () => {
      const query = { select() { return this; }, eq(key, value) { if (key === 'updated_at') version = value; return this; },
        maybeSingle: async () => ({ data: { payload: { lines: [{ id: 'sent' }, { id: 'other-device' }] }, updated_at: 'version-1' } }),
        update(value) { updated = value; return this; }
      }; return query;
    } }) }
  });
  vm.runInContext(source.slice(source.indexOf('  async function clearQueuedDraftLines'), source.indexOf('  async function sendQueuedOperation')), c);
  await c.clearQueuedDraftLines({ meta: { transaction_date: '2026-11-05', line_ids: ['sent'] } });
  assert.deepEqual(local.lines, [{ id: 'unsent' }]);
  assert.equal(updated.payload.lines[0].id, 'other-device');
  assert.equal(version, 'version-1');
});

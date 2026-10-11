const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('the morning API reads the submitted order from the previous date', () => {
  const properties = {
    'order:BigCOrder:2026-10-10': JSON.stringify({
      date: '2026-10-10', qtyData: { 'แตงโม (ลูก)': 2, 'ส้ม (โหล)': 3 }
    })
  };
  const context = {
    Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] || null }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: {
      formatDate: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.js'), 'utf8'), context);

  const morning = context.handleBigcOrderLoadPreviousOrder_('2026-10-11');
  assert.equal(morning.order.date, '2026-10-10');
  assert.equal(morning.order.qtyData['แตงโม (ลูก)'], 2);
  assert.equal(morning.receivedToday, false);

  properties['received:BigCOrder:2026-10-11'] = '2026-10-11T02:00:00Z';
  assert.equal(context.handleBigcOrderLoadPreviousOrder_('2026-10-11').receivedToday, true);
});

test('confirming receipt still writes the existing Google Sheet and transaction paths', () => {
  const calls = [];
  const props = new Map();
  const context = {
    Date,
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: { formatDate: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') },
    PropertiesService: { getScriptProperties: () => ({
      setProperty: (key, value) => props.set(key, value),
      deleteProperty: key => props.delete(key)
    }) }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'apps-script/Code.js'), 'utf8'), context);
  context.lock_ = () => ({ waitLock: () => {}, releaseLock: () => {} });
  context.replaceBigcWithdrawalRows_ = (_date, qty, options) => {
    calls.push(['sheet', { ...qty }, options.sourceName]);
    return Object.keys(qty).length;
  };
  context.writeBigcOrderTransactionV2_ = (_date, qty, options) => {
    calls.push(['transaction', { ...qty }, options.transactionType]);
  };

  const result = context.handleBigcOrderReceive_('2026-10-11', { 'แตงโม (ลูก)': 2 });
  assert.equal(result.saved, 1);
  assert.deepEqual(calls, [
    ['sheet', { 'แตงโม (ลูก)': 2 }, 'BOY Operation System:BigC Receive'],
    ['transaction', { 'แตงโม (ลูก)': 2 }, 'รับสินค้า']
  ]);
  assert.equal(props.has('received:BigCOrder:2026-10-11'), true);
});

test('a previous order seeds unchecked receipt lines without overwriting a draft', async () => {
  const html = fs.readFileSync(path.join(root, 'bigc-order.html'), 'utf8');
  const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).find(source => source.includes('function initApp()'));
  assert.ok(script);
  const storage = new Map();
  const status = { textContent: '' };
  const context = {
    Date, Intl, URLSearchParams, console,
    STAGING_MODE: false, WEBHOOK_URL: 'https://example.invalid/exec',
    location: { hash: '' },
    document: { getElementById: () => status },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async () => ({ json: async () => ({
      status: 'success', order: { date: '2026-10-10', qtyData: { 'แตงโม (ลูก)': 2, 'ส้ม (โหล)': 3 } }, receivedToday: false
    }) })
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  context.getBusinessDateKey = () => '2026-10-11';
  context.safeLocalStorageSet = (key, value) => storage.set(key, value);
  context.renderReceive = () => {};
  context.receiveQty = { 'แตงโม (ลูก)': 5 };
  context.receiveWgt = {};
  context.receiveChecked = { 'แตงโม (ลูก)': true };
  context.receiveOrderedQty = {};
  context.receiveDismissed = [];
  context.receiveOrderSeedDate = '';
  context.receiveSubmittedDate = '';
  context.returnQty = {};
  context.returnWgt = {};
  context.revenue = { cash: '', transfer: '' };

  await context.loadPreviousOrder();
  assert.equal(context.receiveQty['แตงโม (ลูก)'], 5);
  assert.equal(context.receiveChecked['แตงโม (ลูก)'], true);
  assert.equal(context.receiveQty['ส้ม (โหล)'], 3);
  assert.equal(context.receiveChecked['ส้ม (โหล)'], false);
  assert.equal(context.receiveOrderSeedDate, '2026-10-10');

  delete context.receiveQty['ส้ม (โหล)'];
  context.receiveDismissed.push('ส้ม (โหล)');
  await context.loadPreviousOrder();
  assert.equal(context.receiveQty['ส้ม (โหล)'], undefined);

  context.receiveSubmittedDate = '2026-10-11';
  context.receiveQty = {};
  await context.loadPreviousOrder();
  assert.deepEqual(Object.keys(context.receiveQty), []);
});

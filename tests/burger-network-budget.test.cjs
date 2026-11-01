const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/burger.js'), 'utf8');
function harness(rpc) {
  let time = 1_000_000;
  const nodes = new Map();
  const context = vm.createContext({
    state: { branch: { id: 'branch' }, pendingReceipts: [], receiptLoading: false },
    navigator: { onLine: true }, branchApp: { branchCode: 'BURGER' },
    centralAvailable: () => true, toast: () => {}, renderPendingReceipts: () => {}, loadStock: () => {},
    client: { schema: () => ({ rpc }) },
    Date: class extends Date { static now() { return time; } },
    $: id => { if (!nodes.has(id)) nodes.set(id, { value: '2024-02', innerHTML: '' }); return nodes.get(id); },
    money: { format: String }, number: { format: String }, escapeHtml: String,
  });
  vm.runInContext(source.slice(source.indexOf('  const receiptPoll ='), source.indexOf('  async function receivePendingReceipt')), context);
  vm.runInContext(source.slice(source.indexOf('  async function loadDashboard()'), source.indexOf('  function categoryName')), context);
  return { context, nodes, advance: ms => { time += ms; } };
}
test('automatic receipt requests are throttled; manual refresh is immediate', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { data: [] }; });
  await h.context.loadPendingReceipts({ quiet: true });
  await h.context.loadPendingReceipts({ quiet: true });
  assert.equal(calls, 1);
  await h.context.loadPendingReceipts(); assert.equal(calls, 2);
  h.advance(300000); await h.context.loadPendingReceipts({ quiet: true }); assert.equal(calls, 3);
  h.context.navigator.onLine = false;
  await h.context.loadPendingReceipts(); assert.equal(calls, 3);
});
test('thrown transport failure releases loading state and backs off', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('network'); });
  await h.context.loadPendingReceipts(); assert.equal(h.context.state.receiptLoading, false);
  h.advance(300000); await h.context.loadPendingReceipts({ quiet: true }); assert.equal(calls, 1);
  h.advance(300000); await h.context.loadPendingReceipts({ quiet: true }); assert.equal(calls, 2);
});
test('receipt refresh does not overlap an in-flight request', async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls++; return new Promise(r => { resolve = r; }); });
  const pending = h.context.loadPendingReceipts();
  await h.context.loadPendingReceipts(); assert.equal(calls, 1);
  resolve({ data: [] }); await pending;
});
test('legacy dashboard uses one bounded summary RPC with government totals and leap-month end', async () => {
  const calls = [];
  const h = harness(async (name, args) => { calls.push({ name, args }); return { data: {
    totals: { revenue: 120001, orders: 1201, expenses: 25, voidOrders: 2 },
    payments: [{ method: 'government', amount: 99 }],
    products: [{ item_name: 'Burger', quantity: 1201, revenue: 120001 }],
  } }; });
  await h.context.loadDashboard();
  assert.equal(calls.length, 1); assert.equal(calls[0].name, 'get_branch_dashboard');
  assert.equal(calls[0].args.date_to, '2024-02-29');
  assert.match(h.nodes.get('#metricGrid').innerHTML, /1201/);
  assert.match(h.nodes.get('#channelBreakdown').innerHTML, /ไทยช่วยไทย/);
  assert.match(h.nodes.get('#topProductBreakdown').innerHTML, /120001/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/bigc-v2.js'), 'utf8');
function app(branch) {
  const calls = [];
  const context = { document: { body: { dataset: {} } }, location: { search: branch ? '?branch=' + branch : '' }, URLSearchParams,
    BOYBigCMasterMapping: {}, window: {}, console };
  vm.runInNewContext(source.slice(0, source.lastIndexOf('  if(SOUTH_BRANCH) {')) +
    'globalThis.api={state,workflowApi,draftKey,staffLink,STORAGE_PREFIX};})();', context);
  context.api.state.client = { schema: schema => ({ rpc: (operation, args) => { calls.push({schema,operation,args}); return Promise.resolve({data:{}}); } }) };
  return {...context.api, calls};
}
test('South requests carry branch scope; central keeps its compatible RPC and draft keys', async () => {
  const south=app('BIGC-SOUTH-PATTAYA'), central=app('');
  await south.workflowApi.rpc('save_bigc_v2_draft',{payload:{order:{a:1}}});
  assert.equal(south.calls[0].operation,'bigc_branch_request');
  assert.equal(south.calls[0].args.target_branch_code,'BIGC-SOUTH-PATTAYA');
  assert.equal(south.calls[0].args.operation,'save_bigc_v2_draft');
  await central.workflowApi.rpc('save_bigc_v2_draft',{payload:{}});
  assert.equal(central.calls[0].operation,'save_bigc_v2_draft');
  assert.equal(central.draftKey('order','2026-11-05'),'boy-bigc-v2-draft:order:2026-11-05');
  assert.notEqual(south.draftKey('order','2026-11-05'),central.draftKey('order','2026-11-05'));
});
test('master catalog remains shared but operational settings are separate', async () => {
  const south=app('BIGC-SOUTH-PATTAYA');
  await south.workflowApi.rpc('get_master_catalog',{sheet_name:'M_สินค้า'});
  assert.equal(south.calls[0].operation,'get_master_catalog');
  await south.workflowApi.rpc('save_bigc_v2_settings',{payload:{menu_config:[]}});
  assert.equal(south.calls[1].args.target_branch_code,'BIGC-SOUTH-PATTAYA');
});
test('shared branch registry exposes South expense, order, stock and dashboard routes', () => {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/js/boy-branches.js'),'utf8'),context);
  const branch=context.window.BOY_BRANCHES.get('BIGC-SOUTH-PATTAYA');
  assert.equal(branch.expensePath,'bigc-south.html');
  assert.equal(branch.orderPath,'bigc-south-order.html');
  assert.match(context.window.BOY_BRANCHES.dataPath(branch.code,'stock'),/branch=BIGC-SOUTH-PATTAYA&page=stock/);
  assert.equal(context.window.BOY_BRANCHES.all.length,5);
});
test('South Sheet mirror retries update the same document without touching Central handlers', () => {
  const source=fs.readFileSync(path.join(root,'apps-script/Code.js'),'utf8');
  const start=source.indexOf('function mirrorBigcSouthWorkflow_(');
  const end=source.indexOf('\nfunction readBigcOrderMenu_',start);
  const rows=[]; let locks=0;
  const sheet={getLastRow:()=>rows.length,appendRow:r=>rows.push(r),getRange:(row,col,count,width)=>({
    getValues:()=>rows.slice(row-1,row-1+count).map(r=>r.slice(col-1,col-1+width)),
    setValues:values=>values.forEach((r,i)=>{rows[row-1+i]=r;})})};
  const context={normalizeText_:x=>String(x||'').trim(),lock_:()=>({waitLock(){locks++;},releaseLock(){locks--;}}),
    CONFIG:{spreadsheets:{transactions:'transactions'}},ss_:()=>({getSheetByName:n=>n==='T_BigC_South_Workflows'?sheet:null})};
  vm.runInNewContext(source.slice(start,end),context);
  const payload={workflow_id:'11111111-1111-4111-8111-111111111111',branch_code:'BIGC-SOUTH-PATTAYA',workflow_type:'receive',business_date:'2026-11-05',lines:[{quantity:2}]};
  context.mirrorBigcSouthWorkflow_(payload);
  context.mirrorBigcSouthWorkflow_({...payload,lines:[{quantity:3}]});
  assert.equal(rows.length,2);
  assert.equal(rows[1][1],'BIGC-SOUTH-PATTAYA');
  assert.equal(JSON.parse(rows[1][5]).lines[0].quantity,3);
  assert.equal(locks,0);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function app() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'2026-11-01',textContent:'',classList:{add(){},remove(){},toggle(){}}});
    return nodes.get(id);
  };
  const storage = new Map();
  const context = {URLSearchParams, Intl, Date, crypto:{randomUUID},console,
    location:{search:'?view=admin'},navigator:{onLine:true},
    document:{querySelector:node,querySelectorAll:()=>[]},
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},
    setTimeout:()=>0,clearTimeout:()=>{},
    BOYBigCMasterMapping:{codesFor:()=>[],withCodes:x=>x}};
  context.window=context;context.addEventListener=()=>{};
  const source=fs.readFileSync(path.join(__dirname,'../assets/js/bigc-v2.js'),'utf8');
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    window.qa = {state, seedReceiveFromPrevious, hydrateSubmitted, submitWorkflow, linesFor};
    renderReceive = () => {}; renderAll = () => {}; loadPage = async () => {};
    window.qa.mirrors = []; sheetApi = async (action,data) => {window.qa.mirrors.push(data.payload)};
    saveDraft = () => {window.qa.draftSaves=(window.qa.draftSaves||0)+1};
  })();`),context);
  const qa=context.qa;
  qa.state.menu=['a','b','c'].map(key=>({key,displayName:key,unit:'ชิ้น',inputMode:'quantity',category:'ทั่วไป',handlingType:'standard'}));
  const order={id:randomUUID(),business_date:'2026-10-31',lines:[
    {line_key:'a',item_name:'a',quantity:2,input_mode:'quantity'},
    {line_key:'b',item_name:'b',quantity:3,input_mode:'quantity'}]};
  qa.state.contexts={receive:{previous_order:order}};
  return {qa,node,order};
}

test('ordered lines seed automatically alongside manual drafts, retaining edits and stable receipt keys',()=>{
  const {qa,order}=app();
  qa.state.receive.c={quantity:1,checked:true,receipt_key:'receipt-'+randomUUID()};
  qa.seedReceiveFromPrevious(order);
  assert.deepEqual(Object.keys(qa.state.receive).sort(),['a','b','c']);
  assert.equal(qa.state.receive.a.checked,false);
  assert.equal(qa.state.receive.a.quantity,2);
  const key=qa.state.receive.a.receipt_key;
  qa.state.receive.a.quantity=5;
  qa.seedReceiveFromPrevious(order);
  assert.equal(qa.state.receive.a.quantity,5);
  assert.equal(qa.state.receive.a.receipt_key,key);
});

test('completed order lines stay gone after refresh; later manual receipts and unchecked drafts survive',()=>{
  const {qa,order}=app();
  qa.seedReceiveFromPrevious(order);
  const receipt={workflow_type:'receive',lines:[{line_key:qa.state.receive.a.receipt_key,source_line_key:'a',quantity:2}]};
  qa.hydrateSubmitted([receipt]);
  assert.ok(qa.state.receive.b);
  qa.seedReceiveFromPrevious(order,[receipt]);
  assert.deepEqual(Object.keys(qa.state.receive),['b']);
  qa.state.receive.a={quantity:4,checked:true,receipt_key:'receipt-'+randomUUID()};
  qa.seedReceiveFromPrevious(order,[receipt]);
  assert.equal(qa.state.receive.a.quantity,4);
  assert.equal(qa.state.receive.b.checked,false);
});

test('legacy completed receipts do not reappear as new pending orders',()=>{
  const {qa,order}=app();
  qa.state.receive.a={quantity:2,checked:true};
  qa.seedReceiveFromPrevious(order,[{lines:[{line_key:'a',quantity:2}]}]);
  assert.deepEqual(Object.keys(qa.state.receive),['b']);
});

test('submit removes only accepted checked lines and mirrors the cumulative backend total',async()=>{
  const {qa,order}=app();
  qa.seedReceiveFromPrevious(order);
  qa.state.receive.a.checked=true;
  const key=qa.state.receive.a.receipt_key;
  const calls=[];
  qa.state.client={schema:()=>({rpc:async(name,{payload}={})=>{
    calls.push({name,payload});
    return name==='append_bigc_v2_receive'
      ? {data:{workflow_id:'saved',mirror_payload:{workflow_type:'receive',lines:[{quantity:10}]}}}
      : {data:{}};
  }})};
  assert.equal(await qa.submitWorkflow('receive'),true);
  assert.equal(calls[0].name,'append_bigc_v2_receive');
  assert.equal(calls[0].payload.lines[0].line_key,key);
  assert.equal(calls[0].payload.lines[0].source_line_key,'a');
  assert.deepEqual(Object.keys(qa.state.receive),['b']);
  assert.equal(qa.mirrors[0].lines[0].quantity,10);
  assert.ok(qa.draftSaves>0);
});

test('failure retains draft and receipt ID for retry',async()=>{
  const {qa,order}=app();
  qa.seedReceiveFromPrevious(order);
  qa.state.receive.a.checked=true;
  const key=qa.state.receive.a.receipt_key;
  qa.state.client={schema:()=>({rpc:async()=>({error:{message:'offline'}})})};
  assert.equal(await qa.submitWorkflow('receive'),false);
  assert.equal(qa.state.receive.a.receipt_key,key);
  assert.equal(qa.state.receive.a.checked,true);
  assert.equal(qa.linesFor('receive')[0].line_key,key);
});

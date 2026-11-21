const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function app(search='?view=admin') {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'2026-11-01',textContent:'',style:{},getBoundingClientRect:()=>({height:0}),classList:{add(){},remove(){},toggle(){}}});
    return nodes.get(id);
  };
  const storage = new Map();
  const context = {URLSearchParams, Intl, Date, crypto:{randomUUID},console,
    location:{search},navigator:{onLine:true},
    document:{body:{dataset:{},append(){}},createElement:()=>({style:{},setAttribute(){},addEventListener(){}}),addEventListener(){},documentElement:{style:{setProperty(){}}},querySelector:node,querySelectorAll:()=>[]},
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},
    setTimeout:()=>0,clearTimeout:()=>{},
    BOYBigCMasterMapping:{codesFor:()=>[],withCodes:x=>x}};
  context.window=context;context.addEventListener=()=>{};
  const source=fs.readFileSync(path.join(__dirname,'../assets/js/bigc-v2.js'),'utf8');
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    window.qa = {state, seedReceiveFromPrevious, seedReceiveFromRounds, hydrateSubmitted, submitWorkflow, linesFor, renderReceive,
      needsActualWeight, receiveHandlingType, receiveCostingBasis, receiveControls, isStaffView, canEditProducts};
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

test('only fresh and prepared fruit require actual weight; frozen bags use bag count and standard cost',()=>{
  const {qa}=app();
  const frozen={key:'frozen',displayName:'มัลเบอร์รี่ แช่แข็ง (ถุง)',category:'❄️ ผลไม้แช่แข็ง',unit:'ถุง',
    inputMode:'quantity',handlingType:'whole_fruit',costingBasis:'actual_raw_weight_kg'};
  const dried={key:'dried',displayName:'ผลไม้อบแห้ง (กระปุก)',category:'🥫 ผลไม้อบแห้งกระปุก',unit:'กระปุก',
    inputMode:'quantity',handlingType:'whole_fruit'};
  const fresh={key:'fresh',displayName:'แครอท',category:'🍉 ผลไม้',unit:'',inputMode:'quantity',handlingType:'whole_fruit'};
  const prepared={key:'prepared',displayName:'แตงโม (กล่อง)',category:'🍉 ผลไม้ (ใส่กล่อง)',unit:'กล่อง',
    inputMode:'weight',handlingType:'prepared'};
  qa.state.menu=[frozen,dried,fresh,prepared];
  assert.equal(qa.needsActualWeight(frozen),false);
  assert.equal(qa.needsActualWeight(dried),false);
  assert.equal(qa.receiveHandlingType(frozen),'standard');
  assert.equal(qa.receiveHandlingType(dried),'standard');
  assert.equal(qa.receiveCostingBasis(frozen),'backend');
  assert.doesNotMatch(qa.receiveControls(frozen,{quantity:2,actual_weight_kg:1.5},'frozen'),/น้ำหนักจริง/);
  assert.equal(qa.needsActualWeight(fresh),true);
  assert.equal(qa.needsActualWeight(prepared),true);
  qa.state.receive.frozen={line_key:'frozen',item_name:frozen.displayName,quantity:2,checked:true,
    receipt_key:'receipt-'+randomUUID(),handling_type:'whole_fruit',costing_basis:'actual_raw_weight_kg',actual_weight_kg:1.5};
  const line=qa.linesFor('receive')[0];
  assert.equal(line.quantity,2);
  assert.equal(line.actual_weight_kg,null);
  assert.equal(line.handling_type,'standard');
  assert.equal(line.costing_basis,'backend');
});

test('weight-only pumpkin shows one field and uses current kg units for an older order',()=>{
  const {qa}=app();
  const pumpkin={key:'pumpkin',name:'ฟักทอง',displayName:'ฟักทอง',category:'🍉 ผลไม้',unit:'',inputMode:'weight',handlingType:'whole_fruit',costingBasis:'actual_raw_weight_kg'};
  qa.state.menu=[pumpkin];
  const line={line_key:'pumpkin',item_name:'ฟักทอง',unit_name:'',input_mode:'quantity',quantity:3.25,actual_weight_kg:3.25,checked:true};
  const controls=qa.receiveControls(pumpkin,line,'pumpkin');
  assert.equal((controls.match(/<input /g)||[]).length,1);
  assert.match(controls,/data-actual-weight-key/);
  qa.state.receive.pumpkin=line;
  const saved=qa.linesFor('receive')[0];
  assert.equal(saved.unit_name,'กก.');
  assert.equal(saved.input_mode,'weight');
  assert.equal(saved.quantity,3.25);
  assert.equal(saved.actual_weight_kg,3.25);
  qa.state.order={pumpkin:6};
  assert.equal(qa.linesFor('close_order')[0].unit_name,'');
  assert.equal(qa.linesFor('close_order')[0].quantity,6);
});

test('weight mode overrides piece counting for melon, pineapple and watermelon',()=>{
  const {qa}=app();
  for(const name of ['เมล่อน','สับปะรด','แตงโม']){
    const item={key:name,name,displayName:name,category:'🍉 ผลไม้',unit:'ลูก',inputMode:'weight',handlingType:'whole_fruit',costingBasis:'actual_raw_weight_kg'};
    const controls=qa.receiveControls(item,{quantity:6},name);
    assert.equal((controls.match(/<input /g)||[]).length,1);
    assert.match(controls,/data-actual-weight-key/);
    assert.equal(qa.needsActualWeight(item),true);
    assert.equal(qa.receiveCostingBasis(item),'actual_raw_weight_kg');
  }
});

test('verified owner retains editing through a staff link; staff never gains editing from URL',()=>{
  const owner=app('?view=staff').qa;
  assert.equal(owner.isStaffView(),true);
  owner.state.access={canManage:true,companyRole:'admin'};
  assert.equal(owner.isStaffView(),false);
  const staff=app('?view=admin').qa;
  staff.state.access={canManage:false,companyRole:'staff'};
  assert.equal(staff.isStaffView(),true);
  assert.equal(staff.canEditProducts(),false);
  staff.state.session={user:{id:'test-staff'}};
  assert.equal(staff.canEditProducts(),true);
  assert.equal(staff.state.access.canManage,false);
});

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

test('two order slips for one morning retain separate quantities and checked drafts',()=>{
  const {qa,order}=app();
  const newer={id:randomUUID(),workflow_id:randomUUID(),business_date:'2026-11-01',submitted_at:'2026-11-01T18:30:00Z',
    lines:[{line_key:'a',item_name:'a',quantity:3,input_mode:'quantity'}]};
  const older={...order,id:randomUUID(),workflow_id:order.id,submitted_at:'2026-11-01T17:30:00Z',legacy:true};
  qa.state.receive.a={quantity:5,checked:true,source_line_key:'a',receipt_key:'receipt-'+randomUUID()};
  qa.seedReceiveFromRounds([newer,older]);
  assert.equal(qa.state.receive[`${older.id}:a`].quantity,5);
  assert.equal(qa.state.receive[`${older.id}:a`].checked,true);
  assert.equal(qa.state.receive[`${newer.id}:a`].quantity,3);
  assert.equal(qa.state.receive[`${newer.id}:a`].checked,false);
  assert.equal(qa.state.receive.a,undefined);
  assert.equal(qa.state.receiveTopRoundId,newer.id);
  assert.equal(qa.state.receiveExpanded.has(newer.id),true);
  assert.equal(qa.state.receiveExpanded.has(older.id),false);
  assert.equal(qa.linesFor('receive')[0].source_line_key,`${older.id}:a`);
});

test('receiving one slip does not remove the same item from another slip',()=>{
  const {qa}=app();
  const first={id:randomUUID(),workflow_id:randomUUID(),business_date:'2026-11-01',lines:[{line_key:'a',item_name:'a',quantity:2}]};
  const second={...first,id:randomUUID(),lines:[{line_key:'a',item_name:'a',quantity:4}]};
  qa.seedReceiveFromRounds([second,first]);
  const source=`${first.id}:a`,receiptKey=qa.state.receive[source].receipt_key;
  qa.seedReceiveFromRounds([second,first],[{lines:[{line_key:receiptKey,source_line_key:source,quantity:2}]}]);
  assert.equal(qa.state.receive[source],undefined);
  assert.equal(qa.state.receive[`${second.id}:a`].quantity,4);
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
      ? {data:{status:'saved',workflow_id:'saved',mirror_payload:{workflow_type:'receive',lines:[{quantity:10}]}}}
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

test('three slips with 6 + 5 + 8 lines disappear only after all 19 lines are saved',async()=>{
  const {qa,node}=app();
  const rounds=[6,5,8].map((count,index)=>({id:'slip-'+index,workflow_id:'daily-order',
    business_date:'2026-10-31',submitted_at:'2026-10-31T18:00:00Z',
    lines:Array.from({length:count},(_,i)=>({line_key:'product-'+i,item_name:'สินค้า '+i,
      unit_name:'ชิ้น',quantity:i+1,input_mode:'quantity'}))}));
  qa.state.receiveRounds=rounds;
  qa.seedReceiveFromRounds(rounds);
  assert.equal(Object.keys(qa.state.receive).length,19);
  qa.renderReceive();
  assert.equal((node('#receiveList').innerHTML.match(/data-receive-round=/g)||[]).length,3);
  let posted;
  qa.state.client={schema:()=>({rpc:async(name,{payload}={})=>{
    if(name==='append_bigc_v2_receive'){posted=payload;return {data:{status:'saved',workflow_id:'saved',mirror_payload:payload}}}
    return {data:{}};
  }})};
  // Receive just the six rows in the first slip.
  Object.values(qa.state.receive).forEach(line=>{line.checked=line.source_round_id==='slip-0'});
  assert.equal(await qa.submitWorkflow('receive'),true);
  assert.equal(posted.lines.length,6);
  const received=[...posted.lines];
  assert.equal(Object.keys(qa.state.receive).length,13);
  qa.seedReceiveFromRounds(rounds,[{lines:received}]);qa.renderReceive();
  assert.equal((node('#receiveList').innerHTML.match(/data-receive-round=/g)||[]).length,2);
  // Save the remaining thirteen, then reload from all recorded receipts.
  Object.values(qa.state.receive).forEach(line=>{line.checked=true});
  assert.equal(await qa.submitWorkflow('receive'),true);
  received.push(...posted.lines);
  assert.equal(received.length,19);
  qa.seedReceiveFromRounds(rounds,[{lines:received}]);qa.renderReceive();
  assert.equal(Object.keys(qa.state.receive).length,0);
  assert.equal((node('#receiveList').innerHTML.match(/data-receive-round=/g)||[]).length,0);
  assert.match(node('#receiveList').innerHTML,/ไม่มีรายการรอรับ/);
  // All nineteen may also be checked and submitted in one call.
  qa.state.receive={};qa.seedReceiveFromRounds(rounds);
  Object.values(qa.state.receive).forEach(line=>{line.checked=true});
  assert.equal(await qa.submitWorkflow('receive'),true);
  assert.equal(posted.lines.length,19);
  qa.seedReceiveFromRounds(rounds,[{lines:posted.lines}]);qa.renderReceive();
  assert.equal(Object.keys(qa.state.receive).length,0);
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

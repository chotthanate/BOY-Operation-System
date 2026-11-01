const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
function demo(){
 const values=new Map([['boy-bigc-v2-settings-pending','live-pending'],['boy-bigc-v2-draft:receive:2026-11-01','live-receive']]);
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),
  key:i=>[...values.keys()][i],get length(){return values.size}};
 const context={crypto:{randomUUID},Date,Intl,localStorage:storage};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/bigc-demo-store.js'),'utf8'),context);
 return {store:context.BOYBigCDemo.createStore(storage),values,createStore:()=>context.BOYBigCDemo.createStore(storage)};
}
test('sample ordering supplies tomorrow receipts without reading or changing live queues',()=>{
 const {store,values}=demo();
 const menu=store.menu();
 store.submit({workflow_type:'close_order',business_date:'2026-11-01',submission_id:randomUUID(),
  lines:[{line_key:menu[0].key,item_name:menu[0].displayName,quantity:2}]});
 const next=store.context('2026-11-02');
 assert.equal(next.previous_order.lines[0].quantity,2);
 assert.equal(values.get('boy-bigc-v2-settings-pending'),'live-pending');
 assert.equal(values.get('boy-bigc-v2-draft:receive:2026-11-01'),'live-receive');
 assert.deepEqual([...values.keys()].filter(k=>!k.startsWith('boy-bigc-v2-')),['boy-bigc-demo:data']);
});
test('demo keeps two receive rounds, skips retries, and scopes history by date',()=>{
 const {store}=demo();
 const first={line_key:'receipt-'+randomUUID(),source_line_key:'sample',item_name:'ส้ม',unit_name:'ลูก',quantity:2};
 const submit=lines=>store.submit({workflow_type:'receive',business_date:'2026-11-02',lines});
 submit([first]);submit([first]);
 assert.equal(store.history('2026-11-02').length,1);
 const second={line_key:'receipt-'+randomUUID(),item_name:'ส้ม',unit_name:'ลูก',quantity:3};
 const result=submit([second]);
 assert.equal(store.history('2026-11-02').length,2);
 assert.equal(result.mirror_payload.lines.reduce((sum,line)=>sum+line.quantity,0),5);
 assert.equal(store.history('2026-11-03').length,0);
});
test('demo reset removes only demo data and leaves all live keys unchanged',()=>{
 const {store,values}=demo();
 values.set('boy-bigc-demo:draft:order:2026-11-01','draft');
 store.submit({workflow_type:'close_order',business_date:'2026-11-01',submission_id:randomUUID(),
  lines:[{line_key:'demo-orange',item_name:'ส้ม',quantity:1}]});
 store.reset();
 assert.deepEqual([...values.entries()],[['boy-bigc-v2-settings-pending','live-pending'],['boy-bigc-v2-draft:receive:2026-11-01','live-receive']]);
});
test('same-day orders append without losing receiving lines, and retries do not duplicate them',()=>{
 const {store}=demo();
 const firstId=randomUUID(),secondId=randomUUID();
 const first={workflow_type:'close_order',business_date:'2026-11-01',submission_id:firstId,
  lines:[{line_key:'demo-orange',item_name:'ส้ม',quantity:2,sort_order:0}]};
 const second={...first,submission_id:secondId,
  lines:[{line_key:'demo-orange',item_name:'ส้ม',quantity:3,sort_order:0},
    {line_key:'demo-cup',item_name:'แก้ว',quantity:1,sort_order:1}]};
 store.submit(first);
 const secondSaved=store.submit(second);
 store.submit(second);
 const previous=store.context('2026-11-02').previous_order;
 assert.equal(previous.lines.find(line=>line.line_key==='demo-orange').quantity,5);
 assert.equal(previous.lines.find(line=>line.line_key==='demo-cup').quantity,1);
 assert.equal(store.orderHistory().length,2);
 assert.equal(store.orderHistory()[0].lines[0].quantity,3);
 assert.equal(secondSaved.mirror_payload.lines.find(line=>line.line_key==='demo-orange').quantity,5);
});
test('morning receive shows each saved slip separately, including after-midnight orders',()=>{
 const {store,values,createStore}=demo();
 const menu=store.menu();
 const firstId=randomUUID(),secondId=randomUUID();
 const order={workflow_type:'close_order',business_date:'2026-11-01',
  lines:[{line_key:menu[0].key,item_name:menu[0].displayName,quantity:2}]};
 store.submit({...order,submission_id:firstId});
 store.submit({...order,business_date:'2026-11-02',submission_id:secondId});
 const data=JSON.parse(values.get('boy-bigc-demo:data'));
 data.submissions.find(row=>row.id===firstId).submitted_at='2026-11-01T13:00:00Z';
 data.submissions.find(row=>row.id===secondId).submitted_at='2026-11-01T18:25:00Z';
 values.set('boy-bigc-demo:data',JSON.stringify(data));
 const rounds=createStore().receiveOrderRounds('2026-11-02');
 assert.equal(rounds.length,2);
 assert.deepEqual(Array.from(rounds,row=>row.id),[secondId,firstId]);
 assert.equal(rounds[0].lines[0].quantity,2);
 assert.equal(rounds[1].lines[0].quantity,2);
});

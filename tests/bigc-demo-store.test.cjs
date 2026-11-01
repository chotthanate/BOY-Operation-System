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
 const context={crypto:{randomUUID},Date,localStorage:storage};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/bigc-demo-store.js'),'utf8'),context);
 return {store:context.BOYBigCDemo.createStore(storage),values};
}
test('sample ordering supplies tomorrow receipts without reading or changing live queues',()=>{
 const {store,values}=demo();
 const menu=store.menu();
 store.submit({workflow_type:'close_order',business_date:'2026-11-01',
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
 store.submit({workflow_type:'close_order',business_date:'2026-11-01',lines:[]});
 store.reset();
 assert.deepEqual([...values.entries()],[['boy-bigc-v2-settings-pending','live-pending'],['boy-bigc-v2-draft:receive:2026-11-01','live-receive']]);
});

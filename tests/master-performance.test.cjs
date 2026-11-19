const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/js/boy-master-store.js'),'utf8');
function reader(changed=false){
 const calls=[],items={sheetName:'M_สินค้า',sourceRevision:'i1',rows:[{item_id:'I1'}]},expenses={sheetName:'M_รายการค่าใช้จ่าย',sourceRevision:'e1',rows:[{expense_item_id:'E1',__sourceSheet:'M_รายการค่าใช้จ่าย'}]};
 const previous={...items,rows:[...items.rows,...expenses.rows],_expenseCatalog:expenses};
 const context={ITEM_SHEET:'M_สินค้า',EXPENSE_SHEET:'M_รายการค่าใช้จ่าย',withTimeout:p=>p,client:()=>({auth:{getSession:async()=>({data:{session:{}}})},schema:()=>({rpc:async(name,args)=>{calls.push({name,args});return name==='get_master_catalog_versions'?{data:{'M_สินค้า':{version:'i1',serverMirror:true},'M_รายการค่าใช้จ่าย':{version:changed?'e2':'e1',serverMirror:true}}}:{data:{...expenses,sourceRevision:'e2'}};}})}),isExpenseRow:r=>r.__sourceSheet==='M_รายการค่าใช้จ่าย',combineItemCatalog:(i,e)=>({...i,rows:[...i.rows,...e.rows],_expenseCatalog:e}),mergePendingOperations:async(_,c)=>c};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function fromSupabase('),source.indexOf('  async function refresh(')),context);
 return{context,calls,previous};
}
test('warm catalog validates one small version response, downloads no full catalogs and keeps expense rows unique',async()=>{
 const h=reader();const result=await h.context.fromSupabase('M_สินค้า',false,h.previous);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'get_master_catalog_versions');assert.equal(result.rows.length,2);assert.equal(result.serverMirror,true);
});
test('only the changed half of a unified item catalog is downloaded',async()=>{
 const h=reader(true);const result=await h.context.fromSupabase('M_สินค้า',false,h.previous);
 assert.equal(h.calls.length,2);assert.equal(h.calls[1].args.target_sheet_name,'M_รายการค่าใช้จ่าย');assert.equal(result._expenseCatalog.sourceRevision,'e2');assert.equal(result.rows.length,2);
});
test('server queued mirror returns after the primary commit without calling the legacy Sheet writer',async()=>{
 let legacyCalls=0;
 const context={client:()=>({auth:{getSession:async()=>({data:{session:{}}})},schema:()=>({rpc:async()=>({data:{sheetName:'M_สินค้า',serverMirror:true,rows:[]}})})}),findCurrentRow:()=>({__version:'1'}),ITEM_SHEET:'M_สินค้า',EXPENSE_SHEET:'M_รายการค่าใช้จ่าย',sourceSheetFor:()=> 'M_สินค้า',sourcePayload:(_,x)=>x,withTimeout:p=>p,catalogFromSave:(_,__,x)=>x,remember:async(_,x)=>x};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function save('),source.indexOf('  async function setActive(')),context);
 const saved=await context.save('M_สินค้า',2,{item_id:'I1'},'fixture',()=>{legacyCalls++;return new Promise(()=>{});},{rows:[]});
 assert.equal(saved._mirrorStatus,'queued');assert.equal(legacyCalls,0);
});
test('page no longer forces item downloads or prefetches unused catalogs, and defers cache updates while editing',()=>{
 const page=fs.readFileSync(path.join(__dirname,'../master-data.html'),'utf8');
 assert.doesNotMatch(page,/force:true}:options|prefetch\(ENTITIES/);
 assert.match(page,/items:\['categories','branches','branchItems'\]/);
 assert.match(page,/deferredMasterUpdates\.set/);
 assert.match(page,/tab==='relations'&&editing/);
 for(const m of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
});

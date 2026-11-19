const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/js/boy-master-store.js'),'utf8');
function harness(fail=false){const calls=[],saved=[];const ctx={
 client:()=>({auth:{getSession:async()=>({data:{session:{}}})},schema:()=>({rpc:async(name,args)=>{calls.push({name,args});if(fail)throw Error('network timeout');return{data:{sheetName:'M_สินค้า',rows:[],serverMirror:true,unitCatalog:{sheetName:'M_หน่วยสินค้า',rows:[]}}};}})}),
 findCurrentRow:()=>({__version:'v1'}),ITEM_SHEET:'M_สินค้า',EXPENSE_SHEET:'M_รายการค่าใช้จ่าย',sourceSheetFor:()=> 'M_สินค้า',sourcePayload:(_,v)=>v,
 withTimeout:p=>p,catalogFromSave:(_,__,d)=>d,remember:async(s,d)=>{saved.push(s);return d;},isRetryable:()=>true};
 vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('  async function save('),src.indexOf('  async function setActive(')),ctx);return{ctx,calls,saved};}
test('confirmed base-unit change uses atomic RPC and caches returned unit versions',async()=>{const h=harness();
 const data=await h.ctx.save('M_สินค้า',2,{item_id:'I1',base_unit_id:'U2'},'fixture',()=>assert.fail('must not write Sheet'),{}, {baseUnitOneToOne:true});
 assert.equal(h.calls[0].name,'change_master_base_unit_one_to_one');assert.equal(h.calls[0].args.payload.__version,'v1');assert.ok(h.saved.includes('M_หน่วยสินค้า'));assert.equal(data._mirrorStatus,'queued');
});
test('failed conversion is never queued as an ordinary offline item edit',async()=>{const h=harness(true);
 await assert.rejects(h.ctx.save('M_สินค้า',2,{item_id:'I1'},'fixture',()=>{}, {},{baseUnitOneToOne:true}),/network timeout/);assert.equal(h.calls.length,1);assert.equal(h.saved.length,0);
});
test('item form requires explicit 1:1 confirmation and passes fresh unit catalog to purchase editor',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../master-data.html'),'utf8');
 assert.match(html,/ยืนยันว่า 1/);assert.match(html,/baseUnitOneToOne=true/);assert.match(html,/catalog\.unitCatalog\)referenceCache\.itemUnits=catalog\.unitCatalog/);
 for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
});

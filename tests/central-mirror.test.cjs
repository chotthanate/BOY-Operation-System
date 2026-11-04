const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'apps-script/Code.js'),'utf8');
const handler=code.slice(code.indexOf('function handleCentralMirror_('),code.indexOf('function handleBigcV2MirrorWorkflow_('));
function harness(){
 const rows=[];let legacyWrites=0,locked=0;
 const sheet={getLastRow:()=>rows.length,getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)),getMaxColumns:()=>26,insertColumnsAfter(){},appendRow:r=>rows.push(r),getRange:(row,col,count,width)=>({
  getValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>rows[row-1+i]?.[col-1+j]??'')),
  setValues:values=>values.forEach((r,i)=>{rows[row-1+i]||=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=v);}),
  createTextFinder:id=>({matchEntireCell:()=>({findNext:()=>{const index=rows.findIndex((r,i)=>i>0&&r[0]===id);return index<0?null:{getRow:()=>index+1};}})})
 })};
 const key='test-fixture-key-not-a-production-credential';
 const context={Date,Number,JSON,Array,CONFIG:{spreadsheets:{transactions:'workbook'},branchName:'ทาวน่า',bigcBranchName:'บิ๊กซี'},lock_:()=>({waitLock(){locked++;},releaseLock(){locked--;}}),ss_:()=>({getSheetByName:()=>sheet}),replaceIncomeRows_:()=>legacyWrites++,replaceExpenseRows_:()=>legacyWrites++,upsertDailyCache_:()=>{},replaceExpenseRowsForBranch_:()=>legacyWrites++,UrlFetchApp:{fetch:(_,options)=>{const p=JSON.parse(options.payload),valid=crypto.createHmac('sha256',key).update(p.request_timestamp+'\n'+p.payload_json).digest('hex')===p.signature;return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(valid)};}}};
 vm.runInNewContext(handler,context);
 const sign=payload=>{const timestamp=Date.now().toString(),payload_json=JSON.stringify(payload);return{timestamp,payload_json,signature:crypto.createHmac('sha256',key).update(timestamp+'\n'+payload_json).digest('hex')};};
 return{...context,sign,rows,legacyWrites:()=>legacyWrites,locked:()=>locked};
}
const base={entity_id:'11111111-1111-4111-8111-111111111111',entity_type:'daily_document',branch_code:'TAWANA',business_date:'2026-11-05',revision:2,data:{exp:[]}};
test('mirror validates the signed body before touching any Sheet',()=>{const h=harness();assert.throws(()=>h.handleCentralMirror_({...h.sign(base),signature:'wrong'}),/signature/);assert.equal(h.rows.length,0);});
test('expired mirror calls are rejected before writing',()=>{const h=harness();assert.throws(()=>h.handleCentralMirror_({...h.sign(base),timestamp:'1'}),/expired/);assert.equal(h.rows.length,0);});
test('same entity retry updates one row and stale revisions cannot undo newer data',()=>{const h=harness();h.handleCentralMirror_(h.sign(base));h.handleCentralMirror_(h.sign(base));assert.equal(h.rows.length,2);const result=h.handleCentralMirror_(h.sign({...base,revision:1,data:{old:true}}));assert.equal(result.stale,true);assert.equal(JSON.parse(h.rows[1].slice(6).join('')).revision,2);assert.equal(h.locked(),0);});
test('mirror splits large JSON across cells and verifies the read-back',()=>{const h=harness();h.handleCentralMirror_(h.sign({...base,data:{note:'ก'.repeat(100000)}}));assert.ok(h.rows[1].slice(6).every(cell=>cell.length<=45000));assert.equal(JSON.parse(h.rows[1].slice(6).join('')).data.note.length,100000);h.handleCentralMirror_(h.sign({...base,revision:3}));assert.equal(h.rows[1][7],'');});
test('one rejected entity does not hide successful acknowledgements in the same batch',()=>{const h=harness();const result=h.handleCentralMirror_(h.sign([{...base,job_id:'a'},{entity_id:'invalid',job_id:'b'}]));assert.equal(result.results[0].status,'success');assert.equal(result.results[1].status,'error');});
test('canonical stock and POS mirror do not invoke legacy stock writers',()=>{const h=harness();h.handleCentralMirror_(h.sign({...base,entity_type:'stock_movement'}));assert.equal(h.legacyWrites(),0);assert.equal(h.rows.length,2);});

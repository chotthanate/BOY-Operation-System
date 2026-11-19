const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../apps-script/Code.js'),'utf8');
function fixture(coerceDate=false){
 const rows=[['item_id','ชื่อสินค้า','เปิดใช้งาน','สูตร'],['I1','เก่า',false,'=1+1']];
 const sheet={getLastRow:()=>rows.length,getLastColumn:()=>Math.max(...rows.map(r=>r.length)),getMaxColumns:()=>100,
 getRange:(row,col,height,width)=>({getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>rows[row-1+i]?.[col-1+j]??'')),getFormulas:()=>[Array.from({length:width},(_,j)=>String(rows[row-1]?.[col-1+j]||'').startsWith('=')?rows[row-1][col-1+j]:'')],setValues:values=>values.forEach((r,i)=>{rows[row-1+i]||=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=v);}),createTextFinder:text=>({matchEntireCell:()=>({findNext:()=>{const index=rows.findIndex((r,i)=>i>=row-1&&String(r[col-1])===text);return index>=0?{getRow:()=>index+1}:null;}})})})};
 if(coerceDate){const original=sheet.getRange;sheet.getRange=(...args)=>{const range=original(...args),write=range.setValues;range.setValues=values=>write(values.map(row=>row.map(value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(value+'T00:00:00+07:00'):value)));return range;};}
 const context={Date,Utilities:{formatDate:date=>new Date(date.getTime()+7*3600000).toISOString().slice(0,10)}};vm.createContext(context);const start=source.indexOf('function writeCentralMasterCopy_('),end=source.indexOf('\nfunction ',start+1);vm.runInContext(source.slice(start,end),context);
 return{rows,write:p=>context.writeCentralMasterCopy_({getSheetByName:()=>sheet},p)};
}
test('signed master snapshot upserts one identity, serializes scopes and preserves computed columns',()=>{
 const h=fixture(),payload={sheet_name:'M_สินค้า',id_header:'item_id',record_key:'I1',readonly_headers:['สูตร'],data:{item_id:'I1','ชื่อสินค้า':'ใหม่','เปิดใช้งาน':true,'สูตร':2,store_types:['water']}};
 h.write(payload);h.write(payload);assert.equal(h.rows.length,2);assert.equal(h.rows[1][1],'ใหม่');assert.equal(h.rows[1][2],true);assert.equal(h.rows[1][3],'=1+1');assert.equal(h.rows[1][4],'["water"]');
});
test('invalid master destination/identity is rejected',()=>{const h=fixture();assert.throws(()=>h.write({sheet_name:'T_รายจ่าย',id_header:'item_id',record_key:'I1',data:{item_id:'I1'}}),/invalid master snapshot/);});
test('Sheet date cells verify against the same Bangkok calendar date',()=>{const h=fixture(true);assert.doesNotThrow(()=>h.write({sheet_name:'M_สินค้า',id_header:'item_id',record_key:'I1',data:{item_id:'I1','วันที่สร้าง':'2026-09-02'}}));});

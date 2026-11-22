const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/js/bigc-v2.js'),'utf8');
function app(south){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',style:{},innerHTML:'',setAttribute(){},getBoundingClientRect:()=>({height:0}),classList:{add(){},remove(){}}});return nodes.get(id);};
 const context={URLSearchParams,Intl,Date,location:{search:south?'?branch=BIGC-SOUTH-PATTAYA':''},navigator:{onLine:true},console,
 document:{body:{dataset:{},append(){}},createElement:()=>({style:{},setAttribute(){},addEventListener(){}}),addEventListener(){},querySelector:node,querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}}},
 localStorage:{getItem:()=>null,setItem(){}},BOYBigCMasterMapping:{codesFor:()=>[],withCodes:x=>x},setTimeout:()=>0,clearTimeout(){}};
 context.window=context;context.addEventListener=()=>{};
 vm.runInNewContext(source.replace(/\}\)\(\);\s*$/,`window.qa={state,openAddItem,addMenuItem};window.saved=[];persistSettings=async()=>{window.saved.push(JSON.parse(JSON.stringify(state.menu)));return 'synced'};renderSettings=()=>{};})();`),context);
 context.qa.state.access={canManage:true};context.qa.state.menu=[{key:'one',name:'test',category:'🍉 ผลไม้ (ใส่กล่อง)'},{key:'two',name:'other',category:'ขนม'}];
 return {qa:context.qa,node,saved:context.saved};
}
test('BigC add forms use a real category select, not a free text datalist',()=>{
 for(const p of ['bigc-v2.html','bigc-demo.html']){const html=fs.readFileSync(path.join(root,p),'utf8');assert.match(html,/<select id="newItemCategory"><\/select>/);assert.doesNotMatch(html,/id="categoryOptions"/);assert.match(html,/bigc-v2.js\?v=20261122-category1/);}
});
for(const south of [false,true])test(`BigC ${south?'South':'Central'} uses saved menu categories and persists the selected category`,async()=>{
 const {qa,node,saved}=app(south);qa.openAddItem();assert.match(node('#newItemCategory').innerHTML,/ผลไม้ \(ใส่กล่อง\)/);assert.match(node('#newItemCategory').innerHTML,/>ขนม<\/option>/);
 node('#newItemName').value='new product';node('#newItemUnit').value='ถุง';node('#newItemCategory').value='ขนม';await qa.addMenuItem();assert.equal(saved.at(-1).at(-1).category,'ขนม');
 node('#newItemName').value='invalid';node('#newItemCategory').value='not in database';await qa.addMenuItem();assert.equal(saved.length,1);assert.match(node('#addItemError').textContent,/เลือกประเภท/);
});

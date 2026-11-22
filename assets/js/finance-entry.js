(() => {
 'use strict';
 const $=s=>document.querySelector(s), query=new URLSearchParams(location.search);
 const branch=window.BOY_BRANCHES.get(query.get('branch')||'TAWANA')||window.BOY_BRANCHES.get('TAWANA');
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());
 const money=v=>Number(v||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
 const read=(k,f=null)=>{try{return JSON.parse(localStorage.getItem(k)||'null')??f;}catch{return f;}};
 const write=(k,v,optional=false)=>{
  try{if(window.BOY_SESSION_STORAGE?.saveLocal)return window.BOY_SESSION_STORAGE.saveLocal(k,JSON.stringify(v),optional);localStorage.setItem(k,JSON.stringify(v));return true;}
  catch(error){if(optional)return false;throw Error('พื้นที่เก็บร่างในเบราว์เซอร์ไม่พร้อม ยังไม่ได้ส่งรายการ กรุณาลองใหม่');}
 };
 const state={client:null,session:null,catalog:null,branchId:null,revision:0,lines:[],dirty:false,busy:false,conflict:false,save:Promise.resolve(),timer:0,started:false,income:null,incomeRevision:0,incomeConflict:false,dayCache:new Map()};
 const key=s=>'BOY_ENTRY_V1:'+branch.code+':'+state.session.user.id+':'+s;
 const line=()=>({id:crypto.randomUUID(),description:'',item_id:null,expense_item_id:null,category_id:'',subcategory_id:'',quantity:'',unit_id:'',line_total:'',supplier_name:'',note:'',payment_method:'cash',receiving_mode:'immediate',expanded:true,is_investment:query.get('investment')==='1'});
 const node=(tag,attrs={},children=[])=>{const n=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>{if(k==='text')n.textContent=v;else if(k==='class')n.className=v;else if(k==='hidden')n.hidden=v;else n.setAttribute(k,v);});children.filter(Boolean).forEach(c=>n.append(c));return n;};
 const button=(text,cls,action)=>{const b=node('button',{type:'button',class:cls,text});b.onclick=action;return b;};
 const notice=text=>{$('#entryNotice').textContent=text;$('#entryNotice').hidden=!text;};
 const snapshot=()=>({date:$('#entryDate').value,lines:state.lines});
 function localSave(){if(!state.session)return;write(key('draft'),{revision:state.revision,data:snapshot(),dirty:state.dirty});}
 function backups(){
  const saved=read(key('backups'),[]);$('#backupPanel').hidden=!saved.length;$('#backupList').replaceChildren();
  saved.forEach((b,i)=>$('#backupList').append(button(new Date(b.at).toLocaleString('th-TH')+' · '+(b.data.lines||[]).length+' รายการ','entry-secondary',()=>{
   if(state.busy||read(key('pending')))return notice('ส่งรายการที่ค้างก่อนเปิดร่างสำรอง');
   if(!confirm('เก็บสำเนาร่างปัจจุบัน แล้วเปิดร่างสำรองนี้หรือไม่?'))return;
   backup(snapshot());useDraft(b.data);state.dirty=true;localSave();render();notice('เปิดสำเนาในเครื่องแล้ว กรุณาตรวจรายการก่อนส่ง');
  })));
 }
 function backup(data){if(!(data.lines||[]).some(x=>x.description||x.line_total))return;const rows=read(key('backups'),[]);rows.push({at:new Date().toISOString(),data:JSON.parse(JSON.stringify(data))});write(key('backups'),rows);backups();}
 function useDraft(data){$('#entryDate').value=data.date||today();state.lines=Array.isArray(data.lines)&&data.lines.length?data.lines.map(x=>({...line(),...x})): [line()];}
 async function rpc(name,args){
  if(!navigator.onLine)throw Error('ออฟไลน์ · ข้อมูลยังเก็บอยู่ในเครื่อง');
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ใช้เวลานานเกินไป · ข้อมูลยังอยู่ กดลองส่งอีกครั้งเพื่อตรวจผล')),20000);});
  let response;try{response=await Promise.race([state.client.schema('boy_central').rpc(name,args),timeout]);}finally{clearTimeout(timer);}
  const {data,error}=response;
  if(error){const e=Error(error.message);e.definitive=!!error.code;throw e;}return data;
 }
 async function catalog(force=false){
  const cached=read(key('catalog'));
  // Validate the version once on opening; unchanged catalogs return metadata only.
  const data=await rpc('get_daily_catalog',{target_branch_code:branch.code,known_version:cached?.schema===2?cached.data.version:null});
  const result=data.not_modified?cached.data:data;write(key('catalog'),{schema:2,data:result,at:Date.now()},true);return result;
 }
 function changed(){if(!state.session||state.busy)return;state.dirty=true;localSave();$('#draftState').textContent='เก็บในเครื่องแล้ว';clearTimeout(state.timer);state.timer=setTimeout(()=>saveDraft().catch(showError),8000);}
 async function saveDraft(){
  state.save=state.save.catch(()=>{}).then(async()=>{
   if(!state.dirty||state.conflict||read(key('pending')))return;
   const data=JSON.parse(JSON.stringify(snapshot()));
   const result=await rpc('save_finance_entry_draft',{payload:{branch_code:branch.code,expected_revision:state.revision,data}});
   state.revision=result.revision;
   state.dirty=JSON.stringify(data)!==JSON.stringify(snapshot());localSave();
   $('#draftState').textContent=state.dirty?'เก็บในเครื่องแล้ว':'ร่างตรงกับฐานกลาง';
  });return state.save;
 }
 function showError(error){
  if(/อีกเครื่อง/.test(error.message)){state.conflict=true;$('#recoveryPanel').hidden=false;}
  notice(error.message||'เชื่อมต่อไม่สำเร็จ ข้อมูลยังอยู่ในเครื่อง');
 }
 function field(label,tag,value,attrs,onChange){
  const input=node(tag,attrs);input.value=value??'';
  input.addEventListener(tag==='select'?'change':'input',()=>onChange(input.value));
  return node('label',{},[node('span',{text:label}),input]);
 }
 function selectField(label,value,rows,attrs,change,placeholder='เลือก'){
  const select=node('select',attrs);select.append(node('option',{value:'',text:placeholder}));
  rows.forEach(x=>select.append(node('option',{value:x.id,text:x.name})));select.value=value||'';
  select.onchange=()=>change(select.value);return node('label',{},[node('span',{text:label}),select]);
 }
 const normalized=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('th');
 function productCategories(product){
  const categories=state.catalog.categories||[],byId=id=>categories.find(c=>c.id===id);
  const category=byId(product.category_id),sub=byId(product.subcategory_id)||(category?.parent_id?category:null);
  const main=sub?byId(sub.parent_id):category;
  return {category_id:main&&!main.parent_id?main.id:'',subcategory_id:sub&&main&&!main.parent_id?sub.id:''};
 }
 function productFor(row){return state.catalog.items.find(x=>row.item_id?x.id===row.item_id&&!x.expense_item_id:row.expense_item_id&&x.expense_item_id===row.expense_item_id);}
 function requirements(row){
  const product=productFor(row),physical=!!(product&&(product.is_physical||product.stock_target_item_id||product.track_stock||(!product.expense_item_id&&product.is_physical!==false)));
  if(row.is_investment)return {product,physical:false,quantity:false,unit:false};
  return {product,physical,quantity:!product||physical||product.requires_quantity,unit:!product||physical||product.requires_unit};
 }
 function selectProduct(row,value,explicit=null){
  const matches=state.catalog.items.filter(x=>normalized(x.option)===normalized(value)||normalized(x.name)===normalized(value));
  if(!explicit&&matches.length>1)return notice('ชื่อรายการซ้ำ กรุณาเลือกชื่อพร้อมรหัสจากรายการ');
  const product=explicit||matches[0];if(!product)return;
  row.description=product.name;row.custom_expense=false;
  row.item_id=product&&!product.expense_item_id?product.id:null;row.expense_item_id=product?.expense_item_id||null;
  if(product){
   Object.assign(row,productCategories(product));
   const sourceId=product.purchased_item_id||product.id;
   row.unit_id=product.purchase_unit_id||state.catalog.item_units.find(x=>x.item_id===sourceId&&x.purchase!==false)?.unit_id||product.base_unit_id||'';
   const suppliers=(state.catalog.item_suppliers||[]).filter(x=>x.item_id===sourceId).map(x=>state.catalog.suppliers.find(s=>s.id===x.supplier_id)?.name).filter(Boolean);
   row.supplier_name=window.BOY_EXPENSE_APP.onlySupplier(suppliers)||'';
   if(!requirements(row).physical&&!product.requires_quantity){row.quantity='';row.receiving_mode='immediate';}
  }
  notice('');changed();render();
 }
 function renderProductChoices(picker,row,value){
  const list=picker.querySelector('.entry-product-choices');list.replaceChildren();list.hidden=false;
  const query=normalized(value),matches=state.catalog.items.filter(x=>!query||normalized(x.name+' '+x.code).includes(query));
  matches.slice(0,20).forEach(product=>{
   const choice=button('','entry-product-choice',()=>selectProduct(row,product.name,product));choice.setAttribute('role','option');
   choice.append(node('strong',{text:product.name}),node('small',{text:[product.code,product.stock_target_name?'เข้าสต็อก '+product.stock_target_name:product.expense_item_id?'ค่าใช้จ่าย':'สินค้า'].join(' · ')}));list.append(choice);
  });
  if(!matches.length)list.append(node('small',{text:'ไม่พบสินค้าที่ตรงกัน'}));
  if(matches.length>20)list.append(node('small',{text:'พิมพ์เพิ่มเพื่อค้นหารายการอื่น'}));
  if(query)list.append(button('ใช้ “'+value+'” เป็นรายจ่ายทั่วไป','entry-custom-choice',()=>{row.custom_expense=true;row.item_id=null;row.expense_item_id=null;row.receiving_mode='immediate';notice('');changed();render();}));
 }
 function render(){
  const list=$('#entryLines');list.replaceChildren();const c=state.catalog;if(!c)return;
  state.lines.forEach((row,index)=>{
   const card=node('article',{class:'expense-card','data-line-id':row.id});
   const toggle=button('','entry-line-toggle',()=>{row.expanded=!row.expanded;render();});
   toggle.append(node('span',{text:(index+1)+'. '+(row.description||'ยังไม่ระบุรายการ')}),node('b',{text:money(row.line_total)}));
   const remove=button('×','entry-line-remove',()=>{if(!confirm('ลบรายการนี้ออกจากร่างหรือไม่?'))return;state.lines=state.lines.filter(x=>x!==row);if(!state.lines.length)state.lines=[line()];changed();render();});remove.setAttribute('aria-label','ลบรายการ '+(index+1));
   card.append(node('div',{class:'entry-line-heading'},[toggle]));
   const body=node('div',{class:'entry-line-body',hidden:!row.expanded});
   const picker=node('div',{class:'entry-product-picker'});
   const product=field('รายการสินค้า / ค่าใช้จ่าย','input',row.description,{autocomplete:'off','data-product':'true',placeholder:'พิมพ์ค้นหาหรือกดเลือกสินค้า','aria-autocomplete':'list'},value=>{
    row.description=value;row.item_id=null;row.expense_item_id=null;row.custom_expense=false;row.category_id='';row.subcategory_id='';changed();renderProductChoices(picker,row,value);
    const main=body.querySelector('[data-field="category_id"]'),sub=body.querySelector('[data-field="subcategory_id"]');
    if(main){main.value='';main.dataset.beforeAdd='';}if(sub){sub.replaceChildren(node('option',{value:'',text:'ไม่ระบุ'}));sub.insertAdjacentHTML('beforeend',window.BOY_EXPENSE_APP.addCategoryOption('sub'));sub.dataset.beforeAdd='';}
    picker.querySelector('.entry-product-status').textContent='เลือกรายการจากรายการแนะนำ';
    const receiving=body.querySelector('[data-field="receiving_mode"]');if(receiving)receiving.closest('label').hidden=true;
   });
   product.className='entry-item-field';const input=product.querySelector('input'),choices=node('div',{class:'entry-product-choices',role:'listbox',hidden:true});
   const control=node('div',{class:'entry-product-control'},[input,button('⌄','entry-product-open',()=>{if(choices.hidden)renderProductChoices(picker,row,input.value);else choices.hidden=true;})]);
   control.querySelector('button').setAttribute('aria-label','เลือกสินค้า');product.append(control);
   choices.onpointerdown=e=>{picker.choosing=true;if(e.pointerType==='mouse')e.preventDefault();};
   choices.onpointercancel=()=>{picker.choosing=false;};
   input.onfocus=()=>renderProductChoices(picker,row,input.value);
   input.onchange=e=>{if(!picker.choosing&&!row.item_id&&!row.expense_item_id&&!row.custom_expense)selectProduct(row,e.target.value);};
   input.onkeydown=e=>{if(e.key==='Escape')choices.hidden=true;};
   const req=requirements(row),source=req.product;
   const status=row.is_investment?'เงินลงทุน · ไม่เพิ่มสต็อก':source?(source.stock_target_name?'เข้าสต็อก: '+source.stock_target_name:req.physical?'ผูกสินค้าแล้ว':'รายการค่าใช้จ่าย'):row.custom_expense?'รายจ่ายทั่วไป · ไม่เพิ่มสต็อก':row.description?'เลือกรายการจากรายการแนะนำ':'';
   picker.append(product,choices,node('small',{class:'entry-product-status',text:status}));body.append(picker);
   const grid=node('div',{class:'entry-fields'});
   const mains=c.categories.filter(x=>!x.parent_id),subs=c.categories.filter(x=>x.parent_id===row.category_id);
   const main=selectField('ประเภทหลัก',row.category_id,mains,{'data-field':'category_id'},value=>{if(value==='__add_category__')return;row.category_id=value;row.subcategory_id='';changed();render();});
   main.querySelector('select').insertAdjacentHTML('beforeend',window.BOY_EXPENSE_APP.addCategoryOption('main'));
   const sub=selectField('ประเภทย่อย',row.subcategory_id,subs,{'data-field':'subcategory_id'},value=>{if(value==='__add_category__')return;row.subcategory_id=value;changed();},'ไม่ระบุ');
   sub.querySelector('select').insertAdjacentHTML('beforeend',window.BOY_EXPENSE_APP.addCategoryOption('sub'));grid.append(main,sub);
   grid.append(field('ยอดเงิน','input',row.line_total,{type:'number',min:'0',step:'0.01',inputmode:'decimal','data-field':'line_total'},v=>{row.line_total=v;changed();updateTotal();}));
   if(req.quantity){
    grid.append(field(source?'จำนวน':'จำนวน (ถ้ามี)','input',row.quantity,{type:'number',min:'0',step:'any',inputmode:'decimal','data-field':'quantity'},v=>{row.quantity=v;changed();}));
   }
   if(req.unit){
    const sourceId=source?.purchased_item_id||row.item_id;
    const options=source?.expense_item_id&&req.physical?c.units.filter(x=>x.id===source.purchase_unit_id):c.item_units.filter(x=>x.item_id===sourceId&&x.purchase!==false).map(x=>c.units.find(u=>u.id===x.unit_id)).filter(Boolean);
    grid.append(selectField('หน่วยซื้อ',row.unit_id,options.length?options:c.units,{'data-field':'unit_id'},v=>{row.unit_id=v;changed();}));
   }
   if(req.physical)grid.append(selectField('การรับสินค้า',row.receiving_mode,[{id:'immediate',name:'รับสินค้าทันที'},{id:'delivery',name:'รอจัดส่ง'}],{'data-field':'receiving_mode'},v=>{row.receiving_mode=v;changed();}));
   grid.append(selectField('ชำระด้วย',row.payment_method,[{id:'cash',name:'เงินสด'},{id:'transfer',name:'เงินโอน'},{id:'credit_card',name:'บัตรเครดิต'},{id:'reimbursement_pending',name:'รอเบิกค่าใช้จ่าย'}],{'data-field':'payment_method'},v=>{row.payment_method=v;changed();}));
   grid.append(field('ผู้ขาย / Supplier','input',row.supplier_name,{list:'entrySupplierOptions','data-field':'supplier_name'},v=>{row.supplier_name=v;changed();}));
   grid.append(field('หมายเหตุ','input',row.note,{'data-field':'note'},v=>{row.note=v;changed();}));
   const investment=node('div',{class:'entry-wide'});investment.innerHTML=window.BOY_EXPENSE_APP.investmentFields(row);
   const updateInvestment=event=>{const selected=investment.querySelector('.is-investment').checked;Object.assign(row,window.BOY_EXPENSE_APP.readInvestment(investment));row.is_investment=selected;row.expense_class=selected?'capital':'operating';changed();if(event.type==='change'&&event.target.matches('.is-investment'))render();};
   investment.addEventListener('input',updateInvestment);investment.addEventListener('change',updateInvestment);grid.append(investment);body.append(grid);
   remove.textContent='ลบรายการนี้';remove.className='entry-secondary entry-line-delete';
   body.append(node('div',{class:'entry-actions'},[remove,button('✓ เสร็จสิ้น','entry-secondary entry-line-done',()=>{row.expanded=false;changed();render();})]));card.append(body);list.append(card);
  });
  updateTotal();const pending=read(key('pending'));$('#saveExpenses').textContent=pending?'ลองส่งรายการค้างอีกครั้ง':'บันทึกรายจ่าย';
  $('#entryLines').inert=!!pending||state.busy;$('#entryDate').disabled=!!pending||state.busy;$('#addEntryLine').disabled=!!pending||state.busy;
  $('#saveExpenses').disabled=state.busy;
 }
 function updateTotal(){$('#batchTotal').textContent='รวม '+money(state.lines.reduce((n,x)=>n+Number(x.line_total||0),0))+' บาท';}
 function payloadLines(){
  return state.lines.filter(x=>x.description||Number(x.line_total)).map(x=>{
   if(!x.description.trim()||!(Number(x.line_total)>0))throw Error('กรอกชื่อรายการและยอดเงินให้ครบ');
   const req=requirements(x),source=req.product;
   if(!x.is_investment&&!source&&!x.custom_expense)throw Error('เลือกสินค้า หรือกดใช้เป็นรายจ่ายทั่วไป: '+x.description);
   if(!x.is_investment&&!state.catalog.categories.some(c=>c.id===x.category_id&&!c.parent_id))throw Error('เลือกประเภทหลัก: '+x.description);
   if(!x.is_investment&&x.subcategory_id&&!state.catalog.categories.some(c=>c.id===x.subcategory_id&&c.parent_id===x.category_id))throw Error('เลือกประเภทย่อยให้ตรงกับประเภทหลัก: '+x.description);
   if(!x.is_investment&&((source&&req.quantity)&&!(Number(x.quantity)>0)||(source&&req.unit)&&!x.unit_id))throw Error('กรอกจำนวนและหน่วยซื้อ: '+x.description);
   if(x.is_investment&&(!x.project_name?.trim()||!x.investment_category))throw Error('ระบุโครงการและหมวดลงทุน: '+x.description);
   const suppliers=state.catalog.suppliers.filter(s=>s.name.trim().toLocaleLowerCase('th')===(x.supplier_name||'').trim().toLocaleLowerCase('th'));
   return {...x,expense_class:x.is_investment?'capital':'operating',item_id:x.is_investment?null:x.item_id,expense_item_id:x.is_investment?null:x.expense_item_id,
    subcategory_id:x.is_investment?null:x.subcategory_id,supplier_id:suppliers.length===1?suppliers[0].id:null,quantity:x.is_investment?0:Number(x.quantity||0),line_total:Number(x.line_total),unit_id:x.is_investment?null:x.unit_id||null};
  });
 }
 async function saveExpenses(){
  if(state.busy)return;state.busy=true;clearTimeout(state.timer);$('#confirmEntrySave').disabled=true;document.body.classList.add('busy');
  $('#entryLines').inert=true;$('#entryDate').disabled=$('#addEntryLine').disabled=$('#saveExpenses').disabled=true;
  try{
   await state.save;
   let pending=read(key('pending'));
   if(!pending){if(state.conflict)throw Error('ตรวจเทียบร่างจากอีกเครื่องก่อนส่ง');await saveDraft();const lines=payloadLines();if(!lines.length)throw Error('เพิ่มรายการรายจ่ายก่อนบันทึก');
    pending={branch_code:branch.code,date:$('#entryDate').value,request_id:crypto.randomUUID(),expected_revision:state.revision,lines};write(key('pending'),pending);}
   const result=await rpc('record_finance_expenses',{payload:pending});
   if(result.status!=='Success')throw Error('ฐานกลางยังไม่ยืนยัน');
   localStorage.removeItem(key('pending'));state.revision=result.draft_revision;state.dirty=false;state.lines=[line()];$('#entryDate').value=today();localSave();$('#entryReview').close();
   $('#draftState').textContent='บันทึกแล้ว';notice('บันทึกรายจ่ายแล้ว '+pending.lines.length+' รายการ · สำเนาชีตอยู่ในคิว');state.dayCache.delete(pending.date);
   if(result.duplicate)try{const workspace=await rpc('get_finance_entry_workspace',{branch_code:branch.code});state.revision=workspace.revision;useDraft(workspace.data);localSave();}catch(_){notice('ยืนยันว่าบันทึกรายจ่ายแล้ว แต่ยังโหลดร่างล่าสุดไม่ได้');}
  }catch(e){if(e.definitive)localStorage.removeItem(key('pending'));showError(e);}
  finally{state.busy=false;document.body.classList.remove('busy');$('#confirmEntrySave').disabled=false;render();}
 }
 function toggleIncome(open){$('#incomeFields').hidden=!open;$('#incomeHeading').setAttribute('aria-expanded',String(open));$('#incomeHeadingAction').textContent=open?'ย่อ':state.income?'แก้ไข':'กรอก';}
 function showIncome(income){
  state.incomeLoaded=true;state.income=income;state.incomeRevision=income?.revision||0;state.incomeConflict=false;$('#incomeCard').classList.toggle('saved',!!income);
  for(const [id,prop] of [['incomeCash','cash'],['incomeTransfer','transfer'],['incomeGovernment','government'],['incomeOther','other']])$('#'+id).value=income?income[prop]:'';
  $('#incomeSummary').textContent=income?'บันทึกแล้ว · '+money(Number(income.cash)+Number(income.transfer)+Number(income.government)+Number(income.other))+' บาท':'ยังไม่ได้บันทึก';
  toggleIncome(!income);
 }
 async function day(date,force=false){if(!force&&state.dayCache.has(date))return state.dayCache.get(date);const result=await rpc('get_branch_finance_day',{branch_code:branch.code,target_date:date});state.dayCache.set(date,result);return result;}
 function incomeLock(){
  const pending=read(key('income-pending'));
  document.querySelectorAll('#incomeFields input').forEach(x=>x.disabled=!!pending||!!state.incomeBusy);
  $('#saveIncome').textContent=pending?'ลองส่งรายรับที่ค้างอีกครั้ง':'บันทึกรายรับ';
 }
 async function loadIncome(){try{
  const pending=read(key('income-pending'));
  if(pending){$('#incomeDate').value=pending.date;for(const [id,p] of [['incomeCash','cash'],['incomeTransfer','transfer'],['incomeGovernment','government'],['incomeOther','other']])$('#'+id).value=pending[p];toggleIncome(true);incomeLock();return notice('มีรายรับรอการยืนยัน กดส่งซ้ำเพื่อยืนยันรายการเดิม');}
  const date=$('#incomeDate').value,result=await day(date,true);
  if($('#incomeDate').value===date){showIncome(result.income);const draft=read(key('income-draft:'+date));if(draft){
   for(const id of ['incomeCash','incomeTransfer','incomeGovernment','incomeOther'])$('#'+id).value=draft.values[id]??'';
   state.incomeRevision=draft.revision;state.incomeConflict=draft.revision!==(result.income?.revision||0);toggleIncome(true);
   if(state.incomeConflict)notice('รายรับมีการแก้จากอีกเครื่อง ร่างนี้ยังเก็บไว้ กรุณากดดูรายวันเพื่อตรวจรายรับล่าสุดก่อนแก้');
  }incomeLock();}
 }catch(e){showError(e);}}
 async function saveIncome(){
  const b=$('#saveIncome');if(b.disabled)return;
  try{
   let payload=read(key('income-pending'));
   if(!payload){if(state.incomeConflict)throw Error('กรุณาเปิดรายรับล่าสุดจากหน้าดูรายวันก่อนแก้ไข');if(!$('#incomeDate').value)throw Error('เลือกวันที่รายรับ');if(!$('#incomeTransfer').value&&!confirm('ยังไม่ได้กรอกเงินโอน ยืนยันบันทึกเป็น 0 บาทหรือไม่?'))return;
    payload={request_id:crypto.randomUUID(),branch_code:branch.code,date:$('#incomeDate').value,expected_revision:state.incomeRevision};
    for(const [id,p] of [['incomeCash','cash'],['incomeTransfer','transfer'],['incomeGovernment','government'],['incomeOther','other']]){payload[p]=Number($('#'+id).value||0);if(payload[p]<0)throw Error('รายรับต้องไม่ติดลบ');}
    write(key('income-pending'),payload);}
   b.disabled=true;state.incomeBusy=true;incomeLock();const result=await rpc('save_branch_manual_income',{payload});if(result.status!=='Success')throw Error('ฐานกลางยังไม่ยืนยัน');
   localStorage.removeItem(key('income-pending'));localStorage.removeItem(key('income-draft:'+payload.date));$('#incomeDate').value=payload.date;showIncome(result.income);state.dayCache.delete(payload.date);notice('บันทึกรายรับแล้ว · สำเนาชีตอยู่ในคิว');
   if(result.duplicate)try{showIncome((await day(payload.date,true)).income);}catch(_){notice('ยืนยันว่าบันทึกรายรับแล้ว แต่ยังโหลดยอดล่าสุดไม่ได้');}
   if($('#historyIncomeDialog').open){$('#historyIncomeDialog').close();loadDay();}
  }catch(e){if(e.definitive)localStorage.removeItem(key('income-pending'));if(/อีกเครื่อง/.test(e.message))state.incomeConflict=true;notice(e.message);}
  finally{state.incomeBusy=false;b.disabled=false;incomeLock();}
 }
 function view(name){
  $('#entryView').hidden=name!=='entry';$('#historyView').hidden=name!=='history';document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x.dataset.view===name));
  const url=new URL(location.href);url.searchParams.set('view',name);if(name==='history')url.searchParams.set('date',$('#historyDate').value);else url.searchParams.delete('date');history.replaceState(null,'',url);
  if(name==='history')loadDay();else if(!$('#incomeCard').hidden&&!state.incomeLoaded)loadIncome();
 }
 function addExpenseForDay(){
  const date=$('#historyDate').value,pending=read(key('pending')),hasDraft=state.lines.some(x=>x.description||x.line_total);
  if((pending||hasDraft)&&$('#entryDate').value!==date){view('entry');return notice('มีร่างรายจ่ายวันที่ '+$('#entryDate').value+' อยู่ กรุณาบันทึกร่างนี้ก่อนเพิ่มของวันอื่น');}
  if(!pending&&$('#entryDate').value!==date){$('#entryDate').value=date;changed();}view('entry');$('#entryDate').scrollIntoView({block:'center'});
 }
 function editDayIncome(date,result){
  if(read(key('income-pending')))return notice('ยืนยันรายรับที่รอส่งก่อนเปลี่ยนวันที่');
  const draft=read(key('income-draft:'+date));if(draft){const saved=read(key('income-backups'),[]);saved.push({date,...draft});write(key('income-backups'),saved);localStorage.removeItem(key('income-draft:'+date));}
  $('#incomeDate').value=date;$('#incomeDate').readOnly=true;showIncome(result.income);toggleIncome(true);$('#historyIncomeBody').append($('#incomeCard'));$('#historyIncomeDialog').showModal();
 }
 async function loadDay(){
  const date=$('#historyDate').value;$('#dayEntries').textContent='กำลังโหลด…';
  const url=new URL(location.href);url.searchParams.set('view','history');url.searchParams.set('date',date);history.replaceState(null,'',url);$('#daySummary').replaceChildren();
  try{
   const result=await day(date,true);if($('#historyDate').value!==date)return;
   const valid=result.expenses.filter(x=>x.status==='confirmed'),income=result.income?Number(result.income.cash)+Number(result.income.transfer)+Number(result.income.government)+Number(result.income.other):Number(result.pos_income||0);
   $('#daySummary').replaceChildren(node('div',{class:'day-totals'},[node('span',{text:'รายรับ '+money(income)}),node('span',{text:'รายจ่าย '+money(valid.reduce((n,x)=>n+Number(x.total_amount),0))}),node('span',{text:valid.reduce((n,x)=>n+(x.lines||[]).length,0)+' รายการ'})]));
   if(result.revenue_mode==='manual'&&result.can_record_income!==false)$('#daySummary').append(button(result.income?'แก้ไขรายรับ':'เพิ่มรายรับ','entry-secondary',()=>editDayIncome(date,result)));
   $('#dayEntries').replaceChildren();
   result.expenses.forEach(bill=>{
    const article=node('article',{class:'day-bill '+(bill.status==='confirmed'?'':'voided')});article.append(node('header',{},[node('strong',{text:money(bill.total_amount)+' บาท'}),node('span',{text:(bill.status==='confirmed'?'บันทึกแล้ว':'ยกเลิก')+' · '+(bill.receiving_status==='pending'?'รอรับสินค้า':bill.receiving_status==='received'?'รับแล้ว':bill.payment_method||'')})]));
    const ol=node('ol');(bill.lines||[]).forEach(x=>ol.append(node('li',{},[node('div',{class:'day-line'},[node('strong',{text:x.description}),node('b',{text:money(x.amount)})]),node('small',{text:[Number(x.quantity)?x.quantity+' '+(x.unit||''):'',x.supplier].filter(Boolean).join(' · ')})])));article.append(ol);$('#dayEntries').append(article);
   });if(!result.expenses.length)$('#dayEntries').textContent='ยังไม่มีรายจ่ายในวันที่เลือก';
  }catch(e){$('#dayEntries').textContent='โหลดไม่สำเร็จ · '+e.message;}
 }
 async function start(){
  if(state.started)return;state.started=true;
  try{
   const c=window.BOY_CENTRAL_CONFIG;state.client=window.BOY_AUTH_CLIENT||window.supabase.createClient(c.url,c.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,lockAcquireTimeout:5000,...(window.BOY_SESSION_STORAGE?{storage:window.BOY_SESSION_STORAGE.storage}:{})}});
   const session=await state.client.auth.getSession();state.session=session.data.session;if(!state.session)throw Error('เข้าสู่ระบบออนไลน์ก่อนบันทึก');
   $('#branchTitle').textContent=branch.name;document.title=branch.name+' | BOY Operations';$('#entryDate').value=$('#incomeDate').value=$('#historyDate').value=today();
   window.BOY_EXPENSE_APP.init(branch.code);$('#branchMenu').onclick=()=>window.BOY_EXPENSE_APP.toggleMenu();
   const legacy=branch.code==='TAWANA'?'tawana.html':branch.code==='BIGC-CENTRAL-PATTAYA'?'bigc.html':'burger.html?branch='+branch.code;
   const url=new URL(legacy,location.href);url.searchParams.set('legacy','1');$('#legacyLink').href=url.href;
   if(!$('#legacyNavigation'))$('#expenseNavigation nav').append(node('a',{id:'legacyNavigation',href:url.href},[node('span',{text:'↶'}),node('strong',{text:'กู้ร่าง / ข้อมูลเก่า'})]));
   const tools=branch.code==='TAWANA'?new URL(url):new URL('burger.html?branch='+branch.code+'&legacy=1',location.href);if(branch.code==='TAWANA')tools.searchParams.set('view','employee');else tools.searchParams.set('page','stock');$('#branchTools').href=tools.href;
   if(Object.keys(localStorage).some(k=>k.startsWith(branch.code==='TAWANA'?'BOY_TAWANA_DRAFT_':branch.code==='BIGC-CENTRAL-PATTAYA'?'BOY_BIGC_EXPENSE_DRAFT_':'boy-'+branch.slug+'-draft:')||k.startsWith('boy-'+branch.slug+'-outbox:')||k.startsWith('BOY_CENTRAL_DAILY:'+branch.code+':request:')))$('#legacyRecovery').hidden=false;
   const [workspace,cat]=await Promise.all([rpc('get_finance_entry_workspace',{branch_code:branch.code}),catalog()]);state.branchId=workspace.branch_id;state.revision=workspace.revision;state.catalog=cat;
   // Explicitly reveal this subtree only after the branch-authorized response;
   // WebKit may retain inherited hidden visibility after removing the auth style.
   document.documentElement.dataset.financeReady='true';
   const units=new Map(cat.units.map(x=>[x.id,x.name]));cat.items.forEach(x=>{x.option=x.name+' · '+(units.get(x.base_unit_id)||'ค่าใช้จ่าย')+' · '+x.code;$('#entryProductOptions').append(node('option',{value:x.option}));});
   cat.suppliers.forEach(x=>$('#entrySupplierOptions').append(node('option',{value:x.name})));
   window.BOY_EXPENSE_APP.configureCategories({branchCode:branch.code,categories:async()=>state.catalog.categories,rpc,
    onCreated:async(result,context)=>{state.catalog.categories=result.categories.filter(x=>x.category_type==='item');write(key('catalog'),{schema:2,data:state.catalog,at:Date.now()},true);const row=state.lines.find(x=>x.id===context.lineId);if(row&&result.categories.some(x=>x.id===result.id)){row.category_id=result.parent_id||result.id;row.subcategory_id=result.parent_id?result.id:'';}changed();render();}});
   const local=read(key('draft')),pending=read(key('pending'));let data=workspace.data;
   if(local?.dirty&&JSON.stringify(local.data)!==JSON.stringify(workspace.data)){data=local.data;if(local.revision!==workspace.revision){state.conflict=true;$('#recoveryPanel').hidden=false;}state.dirty=true;}
   if(pending){data={date:pending.date,lines:pending.lines};notice('มีรายการรอส่ง กดส่งซ้ำเพื่อยืนยัน โดยไม่สร้างบิลซ้ำ');}
   useDraft(data);localSave();render();backups();$('#draftState').textContent=state.conflict?'รอตรวจเทียบ':state.dirty?'ร่างในเครื่อง':'พร้อมบันทึก';
   $('#saveExpenses').disabled=false;
   $('#incomeCard').hidden=workspace.revenue_mode!=='manual'||workspace.can_record_income===false;$('#governmentField').hidden=branch.code==='TAWANA';
   if(query.get('view')==='history'){
    if(/^\d{4}-\d{2}-\d{2}$/.test(query.get('date')||''))$('#historyDate').value=query.get('date');view('history');
   }else if(!$('#incomeCard').hidden)await loadIncome();
  }catch(e){showError(e);$('#draftState').textContent='เชื่อมต่อไม่สำเร็จ';$('#entryNotice').append(document.createElement('br'),button('ลองเชื่อมต่อใหม่','entry-secondary',()=>{state.started=false;start();}));
   if(!state.session)$('#entryNotice').append(node('a',{href:'burger.html?online=1&next='+encodeURIComponent('expenses.html?branch='+branch.code),text:'เข้าสู่ระบบออนไลน์'}));
  }
 }
 $('#entryDate').onchange=changed;
 $('#saveExpenses').disabled=$('#addEntryLine').disabled=true;
 $('#addEntryLine').onclick=()=>{state.lines.forEach(x=>x.expanded=false);state.lines.push(line());changed();render();};
 $('#saveExpenses').onclick=()=>{try{const pending=state.session&&read(key('pending'));const lines=pending?.lines||payloadLines();if(!lines.length)throw Error('เพิ่มรายการก่อนบันทึก');$('#entryReviewSummary').textContent=(pending?.date||$('#entryDate').value)+' · '+lines.length+' รายการ · '+money(lines.reduce((n,x)=>n+Number(x.line_total),0))+' บาท';$('#entryReview').showModal();}catch(e){showError(e);}};
 $('#confirmEntrySave').onclick=saveExpenses;$('#cancelEntryReview').onclick=()=>$('#entryReview').close();
 $('#incomeHeading').onclick=()=>toggleIncome($('#incomeFields').hidden);$('#incomeDate').onchange=loadIncome;$('#saveIncome').onclick=saveIncome;
 document.querySelectorAll('#incomeFields input:not(#incomeDate)').forEach(input=>input.addEventListener('input',()=>{if(!state.session)return;const values={};document.querySelectorAll('#incomeFields input').forEach(x=>values[x.id]=x.value);write(key('income-draft:'+$('#incomeDate').value),{values,revision:state.incomeRevision});}));
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));$('#historyDate').onchange=loadDay;$('#reloadDay').onclick=loadDay;
 $('#addDayExpense').onclick=addExpenseForDay;$('#closeHistoryIncome').onclick=()=>$('#historyIncomeDialog').close();
 $('#historyIncomeDialog').addEventListener('close',()=>{$('#incomeDate').readOnly=false;$('#incomeSlot').append($('#incomeCard'));});
 $('#useCloudDraft').onclick=async()=>{try{const remote=await rpc('get_finance_entry_workspace',{branch_code:branch.code});backup(snapshot());state.revision=remote.revision;useDraft(remote.data);state.dirty=false;state.conflict=false;$('#recoveryPanel').hidden=true;localSave();render();notice('เปิดร่างฐานกลางแล้ว สำเนาร่างก่อนหน้ายังอยู่ด้านล่าง');}catch(e){showError(e);}};
 window.doSync=changed;window.addEventListener('pagehide',localSave);
 window.addEventListener('expense-before-navigate',()=>{localSave();saveDraft().catch(showError);});
 window.addEventListener('online',()=>{if(state.session&&state.dirty&&!read(key('pending')))saveDraft().catch(showError);});
 if(window.BOY_AUTH_CONTEXT)start();else window.addEventListener('boy-auth-ready',start,{once:true});
 window.BOY_FINANCE_ENTRY={state,start,saveExpenses,saveIncome,payloadLines,snapshot};
})();

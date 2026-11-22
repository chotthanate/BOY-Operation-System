(() => {
  'use strict';
  const branch=location.pathname.endsWith('/bigc.html')?'BIGC-CENTRAL-PATTAYA':'TAWANA';
  const prefix='BOY_CENTRAL_DAILY:'+branch+':';
  const state={client:null,catalog:null,contexts:new Map(),drafts:new Map()};
  const read=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
  function stable(value){if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';return JSON.stringify(value);}
  async function draftFingerprint(data){try{return stable(await normalize(data));}catch{return stable(data);}}
  // Launch only after the catalog/legacy reconciliation and mirror deployment
  // checklist is signed off. Loading this asset must not cut over a live form.
  const handles=action=>window.BOY_CENTRAL_CONFIG?.financeCutover===true&&['submit','autoSave','loadData','unlockDate','bigcExpenseSubmit','bigcExpenseAutoSave','bigcExpenseLoadData','bigcExpenseUnlockDate','shared_loadDB','pullItems','branchHistory','branchStock'].includes(action);
  function client(){
    if(!state.client){const config=window.BOY_CENTRAL_CONFIG||{};
      if(!window.supabase||!config.url||!config.publishableKey)throw new Error('ระบบฐานกลางยังไม่พร้อม');
      state.client=window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,...(window.BOY_SESSION_STORAGE?{storage:window.BOY_SESSION_STORAGE.storage}:{})}});
    }return state.client;
  }
  async function rpc(name,args){
    if(!navigator.onLine)throw new Error('ออฟไลน์ · ข้อมูลยังอยู่ในเครื่อง รอส่งฐานกลาง');
    const db=client();const {data:{session}}=await db.auth.getSession();
    if(!session){
      if(!document.querySelector('#dailyOnlineLogin')){
        const link=document.createElement('a');link.id='dailyOnlineLogin';link.textContent='เข้าสู่ระบบออนไลน์เพื่อส่งข้อมูล';
        link.href='burger.html?online=1&next='+encodeURIComponent(location.pathname.split('/').pop()+location.search);
        link.style.cssText='display:block;padding:14px;margin:80px 16px 12px;background:#fff0ce;color:#674400;border-radius:12px;font-weight:700';
        document.querySelector('main')?.prepend(link);
      }
      throw new Error('ต้องเข้าสู่ระบบออนไลน์ก่อนบันทึกฐานกลาง (ข้อมูลในเครื่องยังอยู่)');
    }
    const {data,error}=await db.schema('boy_central').rpc(name,args);
    if(error)throw new Error(error.message);return data;
  }
  async function catalog(force=false){
    const {data:{session}}=await client().auth.getSession();
    if(!session)throw new Error('ต้องเข้าสู่ระบบออนไลน์เพื่อโหลดรายการ');
    const catalogKey=prefix+'catalog:v5:'+session.user.id;
    const cached=(state.catalogUser===session.user.id&&state.catalog)||read(catalogKey);
    state.catalogUser=session.user.id;
    if(cached&&!force&&Date.now()-cached.fetchedAt<15*60*1000){state.catalog=cached;return cached;}
    const data=await rpc('get_daily_catalog',{target_branch_code:branch,known_version:cached?.version||null});
    state.catalog=data.not_modified?{...cached,fetchedAt:Date.now()}:{...data,fetchedAt:Date.now()};
    write(catalogKey,state.catalog);return state.catalog;
  }
  function legacyCatalog(c){
    window.BOY_EXPENSE_APP?.configureCategories({branchCode:branch,categories:async()=>state.catalog?.categories||[],rpc,
      onCreated:async(result,context)=>{await catalog(true);await window.pullItems?.(false);if(!result.categories.some(c=>c.id===result.id))return;const main=context.row?.querySelector('.exp-main-type,.main-type'),sub=context.row?.querySelector('.exp-sub-type,.sub-type');
        if(main){main.value=result.main_name;main.dispatchEvent(new Event('change',{bubbles:true}));}
        if(context.kind==='sub'&&sub){sub.value=result.name;sub.dispatchEvent(new Event('change',{bubbles:true}));}window.doSync?.();}});
    const units=new Map(c.units.map(u=>[u.id,u.name])),categories={},itemMeta={};
    const mains=c.categories.filter(x=>!x.parent_id).map(x=>x.name),subs={};
    c.categories.filter(x=>x.parent_id).forEach(x=>{const parent=c.categories.find(p=>p.id===x.parent_id);if(parent)(subs[parent.name]||=[]).push(x.name);});
    c.items.forEach(item=>{
      const category=c.categories.find(x=>x.id===item.category_id),sub=c.categories.find(x=>x.id===item.subcategory_id)||(category?.parent_id?category:null);
      const main=sub?c.categories.find(x=>x.id===sub.parent_id):category;
      const mainType=main&&!main.parent_id?main.name:'',subType=sub&&mainType?sub.name:'';
      const options=c.item_units.filter(u=>u.item_id===item.id&&u.purchase!==false).map(u=>({id:u.unit_id,name:units.get(u.unit_id),conversion:u.conversion})).filter(u=>u.name);
      const unit=units.get(item.base_unit_id)||'',name=item.name,display=unit?name+' ('+unit+')':name;
      (categories[mainType||'อื่นๆ']||=[]).push(display);
      const suppliers=(c.item_suppliers||[]).filter(x=>x.item_id===item.id).map(x=>c.suppliers.find(s=>s.id===x.supplier_id)?.name).filter(Boolean);
      itemMeta[name]=itemMeta[display]={itemId:item.expense_item_id?null:item.id,expenseItemId:item.expense_item_id||null,masterCode:item.code,categoryId:main?.id||null,baseUnit:unit,mainType,subType,useStock:item.track_stock,unitOptions:options.map(u=>u.name),unitMappings:options,supplierOptions:[...new Set(suppliers)]};
    });
    return {database:{categories,itemMeta,suppliers:c.suppliers.map(x=>x.name),expenseCategories:{rows:[],mainTypes:mains,subTypesByMain:subs}}};
  }
  async function normalize(data){
    const c=await catalog();
    const exp=(data.exp||[]).map(row=>{
      if(row.expense_class==='capital'){
        if(!String(row.project_name||'').trim()||!row.investment_category)throw new Error('ระบุโครงการและหมวดลงทุน: '+row.i);
        return {...row,item_id:null,expense_item_id:null,master_code:null,unit_id:null,q:0};
      }
      // Existing UUID wins. Exact catalog lookup is only for an unsaved legacy
      // form; ambiguous names must never be auto-linked.
      const matches=c.items.filter(i=>row.item_id?(i.id===row.item_id&&!i.expense_item_id)||i.code===row.item_id:row.expense_item_id?i.expense_item_id===row.expense_item_id:row.master_code?i.code===row.master_code:i.name===String(row.i||'').trim());
      if(matches.length>1)throw new Error('ชื่อสินค้าซ้ำ กรุณาเลือกสินค้ากลางใหม่: '+row.i);
      const item=matches[0];
      if(!item&&(row.item_id||row.expense_item_id||row.master_code))throw new Error('รายการยังไม่พร้อมในฐานกลาง กรุณาเลือกใหม่: '+row.i);
      const units=c.units.filter(u=>row.unit_id?u.id===row.unit_id:u.name===String(row.u||'').trim());
      const category=c.categories.find(x=>x.id===row.category_id)||c.categories.find(x=>x.id===item?.category_id)||c.categories.find(x=>!x.parent_id&&x.name===row.m);
      const unit=units.length===1?units[0]:null;
      if(item&&row.u&&!unit)throw new Error('หน่วยยังไม่ตรงฐานกลาง: '+row.i);
      return {...row,item_id:item?.expense_item_id?null:item?.id||null,expense_item_id:item?.expense_item_id||null,master_code:item?.code||row.master_code||null,
        category_id:category?.id||null,unit_id:unit?.id||null,receiving_mode:row.receiving_mode||'immediate'};
    });return {...data,exp};
  }
  async function load(date){
    state.currentDate=date;
    const data=await rpc('get_daily_document',{target_branch_code:branch,target_date:date});
    // History is an explicitly labelled archive, not a save fallback. Never
    // replace an old submitted Sheet day with an empty new central document.
    if(!data.revision&&date<=(window.BOY_CENTRAL_CONFIG.financeCutoverDate||'0000-00-00')){
      if(typeof WEB_APP_URL==='undefined'||!WEB_APP_URL)throw new Error('ยังเปิดข้อมูลเก่าวันนี้ไม่ได้ ข้อมูลในเครื่องยังอยู่');
      const response=await fetch(WEB_APP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:branch==='TAWANA'?'loadData':'bigcExpenseLoadData',date}),signal:AbortSignal.timeout(20000)});
      const legacy=await response.json();
      if(legacy.status==='error')throw new Error(legacy.message||'เปิดข้อมูลเก่าไม่สำเร็จ');
      const old=JSON.parse(legacy.draft||'{}');
      if(legacy.submitted){data.draft=JSON.stringify(old);data.submitted=true;data.archive=true;}
      else if(Object.keys(old).length)data.draft=JSON.stringify(old);
    }
    const localKey=branch==='TAWANA'?'BOY_TAWANA_DRAFT_':'BOY_BIGC_EXPENSE_DRAFT_';
    const local=read(localKey+date),cloud=JSON.parse(data.draft||'{}');
    if(local&&Object.keys(local).length){
      const localFp=await draftFingerprint(local),cloudFp=await draftFingerprint(cloud);
      if(localFp!==cloudFp){
        const decisionKey=prefix+'draft-choice:'+date,previous=read(decisionKey);
        const same=previous?.local===localFp&&previous?.cloud===cloudFp;
        if(!same)write(prefix+'recovered:'+date+':'+Date.now(),{local,cloud});
        const acknowledged=read(prefix+'synced:'+date);
        const wasSynced=acknowledged?.fingerprint===localFp;
        const useLocal=!data.archive&&!wasSynced&&(same?previous.useLocal:!Object.keys(cloud).length||confirm('มีการแก้ไขที่ยังไม่ตรงกัน: เครื่องนี้ '+(local.exp||[]).length+' รายการ / ฐานกลาง '+(cloud.exp||[]).length+' รายการ\nต้องการใช้ร่างเครื่องนี้ทั้งชุดแทนฐานกลางไหม?\nยกเลิก = เปิดฐานกลาง เก็บสำเนาทั้งสองชุดไว้ และไม่รวมรายการอัตโนมัติ'));
        write(decisionKey,{local:localFp,cloud:cloudFp,useLocal});
        if(useLocal){data.draft=JSON.stringify(local);data.submitted=false;}
        else if(!data.archive)write(localKey+date,cloud);
      }
      if(localFp===cloudFp||stable(JSON.parse(data.draft||'{}'))===stable(cloud))write(prefix+'synced:'+date,{fingerprint:cloudFp});
    }
    data.remoteFingerprint=await draftFingerprint(cloud);
    if(!local)write(prefix+'synced:'+date,{fingerprint:data.remoteFingerprint});
    state.contexts.set(date,data);write(prefix+'context:'+date,data);return data;
  }
  async function saveDraft(date,data){
    const previous=state.drafts.get(date)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const context=state.contexts.get(date)||await load(date);
      if(context.archive)throw new Error('ข้อมูลเดิมจากชีตเป็นแบบอ่านอย่างเดียว ยังไม่ส่งทับประวัติเดิม');
      if(await draftFingerprint(data)===context.remoteFingerprint)return {status:'unchanged',revision:context.draft_revision||0};
      const result=await rpc('save_daily_draft',{payload:{branch_code:branch,business_date:date,data,expected_revision:context.draft_revision||0,expected_document_revision:context.revision||0}});
      context.draft_revision=result.revision;context.remoteFingerprint=await draftFingerprint(data);write(prefix+'synced:'+date,{fingerprint:context.remoteFingerprint});return result;
    });state.drafts.set(date,task);return task;
  }
  async function submit(date,data){
    await (state.drafts.get(date)||Promise.resolve()).catch(()=>{});
    const normalized=await normalize(data),fp=stable(normalized),key=prefix+'request:'+date;
    let queued=read(key);
    let context=state.contexts.get(date)||await load(date);
    if(context.archive)throw new Error('วันที่นี้มีข้อมูลเดิมจากชีต ต้องตรวจเทียบก่อนนำเข้า ไม่บันทึกทับอัตโนมัติ');
    if(queued&&stable(queued.payload?.data)!==fp){
      const args={branch_code:branch,business_date:date,request_id:queued.payload.request_id,expected_data:queued.payload.data,expected_revision:queued.payload.expected_revision};
      let recovery=await rpc('resolve_daily_request',{payload:{...args,supersede:false}}),consented=false;
      if(recovery.state==='not_found'){
        if(!confirm('มีรายการก่อนหน้ารอส่ง แต่ฐานกลางยังไม่ได้บันทึก ต้องการเก็บสำเนารายการเดิม แล้วส่งข้อมูลที่แก้ไขอยู่ตอนนี้แทนหรือไม่?'))throw new Error('ยังเก็บคำขอเดิมไว้ ไม่ได้ส่งข้อมูลซ้ำ');
        consented=true;recovery=await rpc('resolve_daily_request',{payload:{...args,supersede:true}});
      }
      if(!['committed','superseded'].includes(recovery.state))throw new Error('มีรายการก่อนหน้ารอส่งอยู่ ยังตรวจยืนยันกับฐานกลางไม่ได้');
      if(recovery.state==='committed'&&stable(recovery.document_data)!==fp){
        if(Number(recovery.revision)!==Number(recovery.result?.revision))throw new Error('รายการเดิมบันทึกแล้ว แต่มีข้อมูลใหม่จากอีกเครื่อง กรุณาเปิดวันที่นี้ใหม่เพื่อเทียบข้อมูล');
        if(!consented&&!confirm('คำขอก่อนหน้าบันทึกลงฐานกลางแล้ว ต้องการบันทึกการแก้ไขปัจจุบันต่อหรือไม่?'))throw new Error('รายการเดิมบันทึกแล้ว ข้อมูลที่แก้ไขยังอยู่ในเครื่อง');
      }
      if(read(key)?.payload?.request_id!==queued.payload.request_id)throw new Error('คิวในเครื่องเปลี่ยนจากอีกแท็บ กรุณาเปิดวันที่นี้ใหม่');
      write(prefix+'recovered-request:'+date+':'+queued.payload.request_id,{queued,current:data});
      localStorage.removeItem(key);queued=null;
      context={...context,revision:recovery.revision,draft_revision:recovery.draft_revision||0};state.contexts.set(date,context);
      if(recovery.state==='committed'&&stable(recovery.document_data)===fp){context.submitted=true;context.draft=JSON.stringify(normalized);write(prefix+'context:'+date,context);write(prefix+'synced:'+date,{fingerprint:fp});return {...recovery.result,message:'รายการนี้บันทึกฐานกลางแล้ว · ไม่ส่งซ้ำ'};}
    }
    if(!queued){queued={fingerprint:fp,payload:{request_id:crypto.randomUUID(),branch_code:branch,business_date:date,expected_revision:context.revision||0,expected_draft_revision:context.draft_revision||0,data:normalized}};write(key,queued);}
    else if(queued.payload.expected_draft_revision===undefined){queued.payload.expected_draft_revision=context.draft_revision||0;write(key,queued);}
    const result=await rpc('post_daily_document',{payload:queued.payload});
    if(result.status!=='Success')throw new Error('ฐานกลางยังไม่ยืนยันการบันทึก');
    localStorage.removeItem(key);
    state.contexts.set(date,{...context,revision:result.revision,draft_revision:0,submitted:true,draft:JSON.stringify(normalized)});
    write(prefix+'context:'+date,state.contexts.get(date));
    write(prefix+'synced:'+date,{fingerprint:fp});
    return {...result,message:'บันทึกฐานกลางแล้ว · สำเนาชีตรอส่ง'};
  }
  async function call(action,args={}){
    if(['submit','bigcExpenseSubmit'].includes(action))return submit(args.date,args.data);
    if(['autoSave','bigcExpenseAutoSave'].includes(action))return saveDraft(args.date,args.data);
    if(['loadData','bigcExpenseLoadData'].includes(action))return load(args.date);
    if(['unlockDate','bigcExpenseUnlockDate'].includes(action)){
      const context=state.contexts.get(args.date)||await load(args.date);
      if(context.archive)throw new Error('ข้อมูลเดิมจากชีตเป็นแบบอ่านอย่างเดียว ต้องตรวจเทียบก่อนนำเข้า');
      return {status:'success'};
    }
    if(action==='shared_loadDB')return legacyCatalog(await catalog(args.force===true));
    if(action==='pullItems'){const c=await catalog();const units=new Map(c.units.map(x=>[x.id,x.name]));return c.items.map(i=>({n:i.name,u:units.get(i.base_unit_id)||''}));}
    if(action==='branchHistory')return rpc('get_daily_history',{target_branch_code:branch,before_date:args.before_date||null});
    if(action==='branchStock'){
      const {data,error}=await client().schema('boy_central').from('v_stock_on_hand').select('item_code,item_name,quantity_on_hand,base_unit_name').eq('branch_code',branch);
      if(error)throw error;return {rows:(data||[]).map(x=>({name:x.item_name,itemId:x.item_code,quantity:x.quantity_on_hand,unit:x.base_unit_name}))};
    }throw new Error('unsupported central action');
  }
  async function flushLocalDraft(){const date=state.currentDate;if(!date||state.contexts.get(date)?.submitted||state.contexts.get(date)?.archive)return;const local=read((branch==='TAWANA'?'BOY_TAWANA_DRAFT_':'BOY_BIGC_EXPENSE_DRAFT_')+date);if(local)await saveDraft(date,local);}
  let checking=false,lastCheck=0;
  async function checkRemoteDraft(){
    if(checking||document.visibilityState==='hidden'||!navigator.onLine||Date.now()-lastCheck<10000)return;
    const date=state.currentDate,context=state.contexts.get(date);if(!date||!context||read(prefix+'request:'+date))return;
    checking=true;lastCheck=Date.now();
    try{
      const version=await rpc('get_daily_sync_version',{target_branch_code:branch,target_date:date});
      if(Number(version.revision)===Number(context.revision||0)&&Number(version.draft_revision)===Number(context.draft_revision||0))return;
      const local=read((branch==='TAWANA'?'BOY_TAWANA_DRAFT_':'BOY_BIGC_EXPENSE_DRAFT_')+date);
      const fingerprint=local?await draftFingerprint(local):context.remoteFingerprint;
      if(fingerprint===context.remoteFingerprint&&typeof window.loadData==='function')await window.loadData();
      else{const status=document.querySelector('#saveStatus')||document.querySelector('#draftStatus');if(status)status.textContent='มีร่างใหม่จากอีกเครื่อง · ร่างในเครื่องนี้ยังไม่ถูกทับ กรุณาเปิดวันที่นี้ใหม่เพื่อเทียบข้อมูล';}
    }catch(_){}finally{checking=false;}
  }
  window.addEventListener?.('focus',checkRemoteDraft);
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')checkRemoteDraft();else void flushLocalDraft().catch(()=>{});});
  window.setInterval?.(checkRemoteDraft,60000);
  window.BOY_DAILY_STORE={handles,call,catalog,normalize,state,flushLocalDraft,checkRemoteDraft};
})();

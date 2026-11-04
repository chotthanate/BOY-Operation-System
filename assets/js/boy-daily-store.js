(() => {
  'use strict';
  const branch=location.pathname.endsWith('/bigc.html')?'BIGC-CENTRAL-PATTAYA':'TAWANA';
  const prefix='BOY_CENTRAL_DAILY:'+branch+':';
  const state={client:null,catalog:null,contexts:new Map(),drafts:new Map()};
  const read=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
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
    const catalogKey=prefix+'catalog:'+session.user.id;
    const cached=(state.catalogUser===session.user.id&&state.catalog)||read(catalogKey);
    state.catalogUser=session.user.id;
    if(cached&&!force&&Date.now()-cached.fetchedAt<15*60*1000){state.catalog=cached;return cached;}
    const data=await rpc('get_daily_catalog',{target_branch_code:branch,known_version:cached?.version||null});
    state.catalog=data.not_modified?{...cached,fetchedAt:Date.now()}:{...data,fetchedAt:Date.now()};
    write(catalogKey,state.catalog);return state.catalog;
  }
  function legacyCatalog(c){
    const units=new Map(c.units.map(u=>[u.id,u.name])),categories={},itemMeta={};
    const mains=c.categories.filter(x=>!x.parent_id).map(x=>x.name),subs={};
    c.categories.filter(x=>x.parent_id).forEach(x=>{const parent=c.categories.find(p=>p.id===x.parent_id);if(parent)(subs[parent.name]||=[]).push(x.name);});
    c.items.forEach(item=>{
      const options=c.item_units.filter(u=>u.item_id===item.id&&u.purchase!==false).map(u=>({id:u.unit_id,name:units.get(u.unit_id),conversion:u.conversion})).filter(u=>u.name);
      const unit=units.get(item.base_unit_id)||'',name=item.name,display=unit?name+' ('+unit+')':name;
      (categories[item.main||'อื่นๆ']||=[]).push(display);
      const suppliers=(c.item_suppliers||[]).filter(x=>x.item_id===item.id).map(x=>c.suppliers.find(s=>s.id===x.supplier_id)?.name).filter(Boolean);
      itemMeta[name]=itemMeta[display]={itemId:item.id,masterCode:item.code,categoryId:item.category_id,baseUnit:unit,mainType:item.main||'',subType:item.sub||'',useStock:item.track_stock,unitOptions:options.map(u=>u.name),unitMappings:options,supplierOptions:[...new Set(suppliers)]};
    });
    return {database:{categories,itemMeta,suppliers:c.suppliers.map(x=>x.name),expenseCategories:{rows:[],mainTypes:mains,subTypesByMain:subs}}};
  }
  async function normalize(data){
    const c=await catalog();
    const exp=(data.exp||[]).map(row=>{
      // Existing UUID wins. Exact catalog lookup is only for an unsaved legacy
      // form; ambiguous names must never be auto-linked.
      const matches=c.items.filter(i=>i.id===row.item_id||(!row.item_id&&i.name===String(row.i||'').trim()));
      if(matches.length>1)throw new Error('ชื่อสินค้าซ้ำ กรุณาเลือกสินค้ากลางใหม่: '+row.i);
      const item=matches[0];const units=c.units.filter(u=>u.name===String(row.u||'').trim());
      const category=c.categories.find(x=>!x.parent_id&&x.name===row.m);
      const unit=units.length===1?units[0]:null;
      if(item&&row.u&&!unit)throw new Error('หน่วยยังไม่ตรงฐานกลาง: '+row.i);
      return {...row,item_id:item?.id||row.item_id||null,master_code:item?.code||row.master_code||null,
        category_id:category?.id||row.category_id||item?.category_id||null,unit_id:unit?.id||null};
    });return {...data,exp};
  }
  async function load(date){
    const data=await rpc('get_daily_document',{target_branch_code:branch,target_date:date});
    const localKey=branch==='TAWANA'?'BOY_TAWANA_DRAFT_':'BOY_BIGC_EXPENSE_DRAFT_';
    const local=read(localKey+date),cloud=JSON.parse(data.draft||'{}');
    if(local&&Object.keys(local).length&&JSON.stringify(local)!==JSON.stringify(cloud)){
      write(prefix+'recovered:'+date+':'+Date.now(),local);
      if(!Object.keys(cloud).length||confirm('มีร่างในเครื่องนี้ต่างจากฐานกลาง ต้องการใช้ร่างในเครื่องนี้ไหม?\nยกเลิก = เปิดข้อมูลฐานกลาง โดยยังเก็บสำเนาร่างเดิมไว้')){
        data.draft=JSON.stringify(local);data.submitted=false;
      }
    }
    state.contexts.set(date,data);write(prefix+'context:'+date,data);return data;
  }
  async function saveDraft(date,data){
    const previous=state.drafts.get(date)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const context=state.contexts.get(date)||await load(date);
      const result=await rpc('save_daily_draft',{payload:{branch_code:branch,business_date:date,data,expected_revision:context.draft_revision||0,expected_document_revision:context.revision||0}});
      context.draft_revision=result.revision;return result;
    });state.drafts.set(date,task);return task;
  }
  async function submit(date,data){
    await (state.drafts.get(date)||Promise.resolve()).catch(()=>{});
    const normalized=await normalize(data),fp=JSON.stringify(normalized),key=prefix+'request:'+date;
    let queued=read(key);
    if(queued&&queued.fingerprint!==fp)throw new Error('มีรายการก่อนหน้ารอส่งอยู่ กรุณาส่งรายการเดิมให้สำเร็จก่อนแก้ไข');
    const context=state.contexts.get(date)||await load(date);
    if(!queued){queued={fingerprint:fp,payload:{request_id:crypto.randomUUID(),branch_code:branch,business_date:date,expected_revision:context.revision||0,data:normalized}};write(key,queued);}
    const result=await rpc('post_daily_document',{payload:queued.payload});
    if(result.status!=='Success')throw new Error('ฐานกลางยังไม่ยืนยันการบันทึก');
    localStorage.removeItem(key);
    state.contexts.set(date,{...context,revision:result.revision,draft_revision:0,submitted:true,draft:JSON.stringify(normalized)});
    write(prefix+'context:'+date,state.contexts.get(date));
    return {...result,message:'บันทึกฐานกลางแล้ว · สำเนาชีตรอส่ง'};
  }
  async function call(action,args={}){
    if(['submit','bigcExpenseSubmit'].includes(action))return submit(args.date,args.data);
    if(['autoSave','bigcExpenseAutoSave'].includes(action))return saveDraft(args.date,args.data);
    if(['loadData','bigcExpenseLoadData'].includes(action))return load(args.date);
    if(['unlockDate','bigcExpenseUnlockDate'].includes(action))return {status:'success'};
    if(action==='shared_loadDB')return legacyCatalog(await catalog(args.force===true));
    if(action==='pullItems'){const c=await catalog();const units=new Map(c.units.map(x=>[x.id,x.name]));return c.items.map(i=>({n:i.name,u:units.get(i.base_unit_id)||''}));}
    if(action==='branchHistory')return rpc('get_daily_history',{target_branch_code:branch,before_date:args.before_date||null});
    if(action==='branchStock'){
      const {data,error}=await client().schema('boy_central').from('v_stock_on_hand').select('item_code,item_name,quantity_on_hand,base_unit_name').eq('branch_code',branch);
      if(error)throw error;return {rows:(data||[]).map(x=>({name:x.item_name,itemId:x.item_code,quantity:x.quantity_on_hand,unit:x.base_unit_name}))};
    }throw new Error('unsupported central action');
  }
  window.BOY_DAILY_STORE={handles,call,catalog,normalize,state};
})();

(() => {
  "use strict";
  const STORAGE_KEY = "boy-bigc-demo:data";
  const clone = value => JSON.parse(JSON.stringify(value));
  const sampleMenu = [
    ["demo-orange", "ส้ม", "ผลไม้", "ลูก"],
    ["demo-banana", "กล้วย", "ผลไม้", "หวี"],
    ["demo-water", "น้ำเปล่า", "เครื่องดื่ม", "ขวด"],
    ["demo-cup", "แก้ว", "บรรจุภัณฑ์", "แพ็ก"],
    ["demo-ice", "น้ำแข็ง", "วัตถุดิบ", "ถุง"]
  ].map(([key,displayName,category,unit],sortOrder)=>({
    key,displayName,name:displayName,category,unit,sortOrder,
    active:true,inputMode:"quantity",handlingType:"standard"
  }));
  function createStore(storage = localStorage, options = {}) {
    const storageKey=options.storageKey||STORAGE_KEY;
    let data;
    try { data=JSON.parse(storage.getItem(storageKey)||"null"); } catch (_) {}
    if (!data || data.version!==1) data={version:1,menu:sampleMenu,workflows:{},batches:{},submissions:[]};
    if (!Array.isArray(data.submissions)) data.submissions=[];
    const persist=()=>storage.setItem(storageKey,JSON.stringify(data));
    const nextDate=(date,days=1)=>{
      const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);
      return d.toISOString().slice(0,10);
    };
    const receiveDateFor=(row)=>{
      const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",hourCycle:"h23"})
        .formatToParts(new Date(row.submitted_at)).map(part=>[part.type,part.value]));
      const localDate=`${parts.year}-${parts.month}-${parts.day}`;
      const nextMorning=Number(parts.hour)<6?localDate:nextDate(localDate);
      const planned=nextDate(row.business_date);
      return planned<nextMorning?planned:nextMorning;
    };
    const context=date=>({
      branch:clone(options.branch||{id:"demo",name:"BigC · ทดลอง",code:"DEMO"}),
      business_date:date,settings:{menu_config:clone(data.menu)},
      workflows:clone(Object.values(data.workflows).filter(w=>w.business_date===date)),
      previous_order:clone(data.workflows[nextDate(date,-1)+":close_order"]||null),
      pending_sheet_sync:[]
    });
    function submit(payload) {
      const type=payload.workflow_type,date=payload.business_date,key=date+":"+type;
      const previous=data.workflows[key];
      const lines=clone(payload.lines||[]);
      if(type==="close_order"){
        if(!payload.submission_id||!lines.length)throw new Error("order submission required");
        const submitted=data.submissions.find(row=>row.id===payload.submission_id);
        if(submitted)return {status:"saved",workflow_id:submitted.workflow_id,mirror_payload:clone(submitted.mirror_payload),already_saved:true};
        const byKey=new Map((previous?.lines||[]).map(row=>[row.line_key,clone(row)]));
        lines.forEach(row=>{
          const old=byKey.get(row.line_key);
          byKey.set(row.line_key,old?{...old,quantity:Number(old.quantity)+Number(row.quantity)}:row);
        });
        data.workflows[key]={...clone(payload),id:key,lines:[...byKey.values()],submitted_at:new Date().toISOString()};
        data.submissions.push({id:payload.submission_id,workflow_id:key,business_date:date,
          submitted_at:new Date().toISOString(),lines,mirror_payload:clone(data.workflows[key])});
        persist();
        return {status:"saved",workflow_id:key,mirror_payload:clone(data.workflows[key])};
      }
      let accepted=lines;
      if(type==="receive"){
        const old=previous?.lines||[];
        const keys=new Set(old.map(l=>l.line_key));
        const sources=new Set(old.map(l=>l.source_line_key).filter(Boolean));
        accepted=lines.filter(l=>{
          if(keys.has(l.line_key)||(l.source_line_key&&sources.has(l.source_line_key)))return false;
          keys.add(l.line_key);if(l.source_line_key)sources.add(l.source_line_key);return true;
        });
        if(accepted.length){
          const batches=data.batches[date]||=[];
          batches.push({id:crypto.randomUUID(),round_number:batches.length+1,
            received_at:new Date().toISOString(),is_legacy:false,lines:clone(accepted)});
        }
        data.workflows[key]={...clone(payload),id:key,lines:[...old,...accepted]};
      }else data.workflows[key]={...clone(payload),id:key};
      persist();
      return {status:"saved",workflow_id:key,mirror_payload:clone(data.workflows[key])};
    }
    return {menu:()=>clone(data.menu),context,submit,nextDate,
      history:date=>clone(data.batches[date]||[]),
      orderHistory:()=>clone(data.submissions).reverse().sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at)).slice(0,30),
      receiveOrderRounds:date=>clone([
        ...data.submissions.filter(row=>receiveDateFor(row)===date).map(row=>({...row,legacy:false})),
        ...Object.values(data.workflows).filter(row=>row.workflow_type==="close_order"
          && nextDate(row.business_date)===date && !data.submissions.some(s=>s.workflow_id===row.id))
          .map(row=>({id:row.id,workflow_id:row.id,business_date:row.business_date,
            submitted_at:row.submitted_at,lines:row.lines,legacy:true}))
      ].sort((a,b)=>b.submitted_at.localeCompare(a.submitted_at))),
      reset:()=>{
        const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith("boy-bigc-demo:"))keys.push(key)}
        keys.forEach(key=>storage.removeItem(key));
        data={version:1,menu:clone(sampleMenu),workflows:{},batches:{},submissions:[]};
      }};
  }
  globalThis.BOYBigCDemo={createStore};
})();

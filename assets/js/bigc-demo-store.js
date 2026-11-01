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
  function createStore(storage = localStorage) {
    let data;
    try { data=JSON.parse(storage.getItem(STORAGE_KEY)||"null"); } catch (_) {}
    if (!data || data.version!==1) data={version:1,menu:sampleMenu,workflows:{},batches:{}};
    const persist=()=>storage.setItem(STORAGE_KEY,JSON.stringify(data));
    const nextDate=(date,days=1)=>{
      const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);
      return d.toISOString().slice(0,10);
    };
    const context=date=>({
      branch:{id:"demo",name:"BigC · ทดลอง",code:"DEMO"},
      business_date:date,settings:{menu_config:clone(data.menu)},
      workflows:clone(Object.values(data.workflows).filter(w=>w.business_date===date)),
      previous_order:clone(data.workflows[nextDate(date,-1)+":close_order"]||null),
      pending_sheet_sync:[]
    });
    function submit(payload) {
      const type=payload.workflow_type,date=payload.business_date,key=date+":"+type;
      const previous=data.workflows[key];
      const lines=clone(payload.lines||[]);
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
      return {workflow_id:key,mirror_payload:clone(data.workflows[key])};
    }
    return {menu:()=>clone(data.menu),context,submit,nextDate,
      history:date=>clone(data.batches[date]||[]),
      reset:()=>{
        const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith("boy-bigc-demo:"))keys.push(key)}
        keys.forEach(key=>storage.removeItem(key));
        data={version:1,menu:clone(sampleMenu),workflows:{},batches:{}};
      }};
  }
  globalThis.BOYBigCDemo={createStore};
})();

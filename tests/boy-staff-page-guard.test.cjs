const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function guard(filename,profile,requiredRole){
 const result={ready:false,redirect:null,blocked:false};
 const context={URLSearchParams,CustomEvent:class{constructor(name){this.name=name}},
  location:{pathname:'/BOY-Operation-System/'+filename,search:'?online=1',hash:'',replace:url=>result.redirect=url},
  document:{body:{dataset:{...(requiredRole?{requiredRole}:{})},set innerHTML(_v){result.blocked=true}},documentElement:{dataset:{}},
   querySelector:()=>({remove(){}})},
  BOY_CENTRAL_CONFIG:{url:'https://qa.supabase.co',publishableKey:'test'},
  dispatchEvent:()=>result.ready=true,
  supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'test'}}}})},
   schema:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile})})})})})})}};
 context.window=context;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/boy-auth-guard.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));return result;
}
test('dedicated BigC staff cannot open BOY Central home or master page by direct URL',async()=>{
 for(const file of ['index.html','master-data.html']){
  const r=await guard(file,{active:true,company_role:'staff',employee_code:'BIGC-SHARED-STAFF'},file==='master-data.html'?'admin':null);
  assert.equal(r.ready,false);assert.equal(r.redirect,'bigc-v2.html?online=1');
 }
});
test('owner retains access to admin master data and staff can open the BigC working page',async()=>{
 const owner=await guard('master-data.html',{active:true,company_role:'admin'},'admin');
 assert.equal(owner.ready,true);assert.equal(owner.redirect,null);
 const staff=await guard('bigc-v2.html',{active:true,company_role:'staff',employee_code:'BIGC-SHARED-STAFF'});
 assert.equal(staff.ready,true);
});

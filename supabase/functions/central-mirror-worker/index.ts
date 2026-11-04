import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
Deno.serve(async request=>{
  if(request.method!=="POST")return reply({error:"method_not_allowed"},405);
  const supplied=request.headers.get("x-boy-worker-key")||'';
  if(!/^[a-f0-9]{64}$/.test(supplied))return reply({error:"unauthorized"},401);
  const url=Deno.env.get("BOY_MIRROR_WEB_APP_URL")||'https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec';
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}}).schema("boy_central");
  const {data:secret,error:keyError}=await db.rpc('get_central_mirror_key');
  if(keyError||!secret||supplied!==secret)return reply({error:"unauthorized"},401);
  const {data:jobs,error}=await db.rpc("claim_mirror_jobs",{batch_size:30});
  if(error)return reply({error:"claim_failed"},500);
  if(!jobs?.length)return reply({synced:0,failed:0});
  let synced=0,failed=0;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  let results:Record<string,{status:string;message?:string}>={};
  try{
      const payload_json=JSON.stringify(jobs.map((job:{payload:unknown})=>job.payload)),timestamp=Date.now().toString();
      const bytes=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"\n"+payload_json));
      const signature=Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,"0")).join("");
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"centralMirror",timestamp,payload_json,signature}),signal:AbortSignal.timeout(65000)});
      const result=await response.json();
      if(!response.ok||result.status!=="success")throw new Error(result.message||"mirror rejected");
      results=Object.fromEntries((result.results||[]).map((entry:{job_id:string;status:string})=>[entry.job_id,entry]));
  }catch(error){const message=error instanceof Error?error.message:'mirror failed';results=Object.fromEntries(jobs.map((job:{id:string})=>[job.id,{status:'error',message}]));}
  for(const job of jobs){
    const ok=results[job.id]?.status==='success',message=results[job.id]?.message||'mirror acknowledgement missing';
    if(ok)synced++;else failed++;
    const finished=await db.rpc("finish_mirror_job",{job_id:job.id,success:ok,error_message:ok?null:message});
    if(finished.error)console.error("mirror status update failed",finished.error.code);
  }
  return reply({synced,failed});
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function login(){const c={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/boy-pin-auth.js'),'utf8'),c);return c.BOY_PIN_AUTH.signIn}
const config={ownerLoginEmail:'owner@example.test',staffLoginEmail:'staff@example.test'};
test('owner identity uses the owner Auth account and no role is inferred from client input',async()=>{
 const calls=[];
 const result=await login()({auth:{signInWithPassword:async input=>{calls.push(input);return {data:{session:{user:{email:input.email}}},error:null}}}},config,'482610');
 assert.equal(calls.length,1);assert.equal(result.data.session.user.email,config.ownerLoginEmail);
});
test('staff PIN retains its leading zero and authenticates the separate staff account',async()=>{
 const calls=[];
 const result=await login()({auth:{signInWithPassword:async input=>{
  calls.push(input);return input.email===config.ownerLoginEmail
   ? {data:{session:null},error:{status:400,message:'Invalid login credentials'}}
   : {data:{session:{user:{email:input.email}}},error:null};
 }}},config,'024680');
 assert.equal(calls.length,2);assert.equal(calls[1].password,'024680');
 assert.equal(result.data.session.user.email,config.staffLoginEmail);
});
test('wrong PIN and network failure never create an authenticated session',async()=>{
 let calls=0;
 const client={auth:{signInWithPassword:async()=>{calls++;return {data:{session:null},error:{status:400,message:'Invalid login credentials'}}}}};
 assert.equal((await login()(client,config,'123456')).data.session,null);assert.equal(calls,2);
 calls=0;client.auth.signInWithPassword=async()=>{calls++;return {data:{session:null},error:{status:0,message:'Network unavailable'}}};
 assert.equal((await login()(client,config,'123456')).data.session,null);assert.equal(calls,1);
});

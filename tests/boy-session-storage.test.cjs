const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function adapter(){
 const values=new Map();
 const context={URL,localStorage:{
  getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/js/boy-session-storage.js'),'utf8'),context);
 return {api:context.BOY_SESSION_STORAGE,values};
}
test('existing Supabase session remains readable without PIN storage or IndexedDB',async()=>{
 const {api,values}=adapter();
 const session=JSON.stringify({user:{id:'employee-a'},refresh_token:'test-only'});
 values.set('sb-qa-auth-token',session);
 assert.equal(await api.storage.getItem('sb-qa-auth-token'),session);
 await api.storage.setItem('sb-qa-auth-token',JSON.stringify({user:{id:'employee-b'}}));
 assert.equal(JSON.parse(await api.storage.getItem('sb-qa-auth-token')).user.id,'employee-b');
});
test('logout clears only the selected project and never restores its old session',async()=>{
 const {api,values}=adapter();
 await api.storage.setItem('sb-qa-auth-token','sample-session');
 values.set('sb-other-auth-token','other-session');
 values.set('boy-bigc-v2-draft:order:2026-11-02','unsent-order');
 await api.clearProject('https://qa.supabase.co');
 assert.equal(await api.storage.getItem('sb-qa-auth-token'),null);
 assert.equal(values.get('sb-other-auth-token'),'other-session');
 assert.equal(values.get('boy-bigc-v2-draft:order:2026-11-02'),'unsent-order');
 // A stale underlying copy must not override an explicit logout marker.
 values.set('sb-qa-auth-token','stale-session');
 assert.equal(await api.storage.getItem('sb-qa-auth-token'),null);
 await api.storage.setItem('sb-qa-auth-token','new-login');
 assert.equal(await api.storage.getItem('sb-qa-auth-token'),'new-login');
});

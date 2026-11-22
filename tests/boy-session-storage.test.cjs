const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function adapter(options={}){
 const values=new Map();
 const context={URL,setTimeout:(fn,ms)=>setTimeout(fn,options.fastTimeout?Math.min(ms,10):ms),clearTimeout,indexedDB:options.indexedDB,localStorage:{
  getItem:k=>{if(options.localUnavailable)throw Error('storage unavailable');return values.get(k)||null;},setItem:(k,v)=>{if(options.localUnavailable)throw Error('storage unavailable');values.set(k,v);},removeItem:k=>{if(options.localUnavailable)throw Error('storage unavailable');values.delete(k);}
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
test('a stuck IndexedDB backup cannot block reading or refreshing a local session',async()=>{
 const {api,values}=adapter({indexedDB:{open:()=>({})},fastTimeout:true});values.set('sb-qa-auth-token','test-session');
 const quick=p=>Promise.race([p,new Promise(resolve=>setTimeout(()=>resolve('HUNG'),60))]);
 assert.equal(await quick(api.storage.getItem('sb-qa-auth-token')),'test-session');
 assert.notEqual(await quick(api.storage.setItem('sb-qa-auth-token','refreshed-test-session')),'HUNG');
 assert.equal(values.get('sb-qa-auth-token'),'refreshed-test-session');
 assert.notEqual(await quick(api.storage.removeItem('sb-qa-auth-token')),'HUNG');
 assert.equal(await api.storage.getItem('sb-qa-auth-token'),null);
});
test('when both browser stores are unavailable auth fails in bounded time instead of hanging',async()=>{
 const {api}=adapter({indexedDB:{open:()=>({})},localUnavailable:true,fastTimeout:true});
 const result=await Promise.race([api.storage.getItem('session'),new Promise(resolve=>setTimeout(()=>resolve('HUNG'),100))]);
 assert.equal(result,null);
 await assert.rejects(api.storage.setItem('session','test-session'),/ไม่สามารถจำ/);
});
test('normal backup restores a missing local copy and cannot resurrect a logged-out session',async()=>{
 const backup=new Map();
 const db={close(){},transaction(){const tx={objectStore:()=>({put:(v,k)=>{backup.set(k,v);return finish();},delete:k=>{backup.delete(k);return finish();},get:k=>finish(backup.get(k))})};function finish(result){const request={result};queueMicrotask(()=>tx.oncomplete?.());return request;}return tx;}};
 const indexedDB={open(){const request={result:db};queueMicrotask(()=>request.onsuccess?.());return request;}};
 const {api,values}=adapter({indexedDB});
 await api.storage.setItem('session','fixture-session');await new Promise(setImmediate);assert.equal(backup.get('session'),'fixture-session');
 values.delete('session');assert.equal(await api.storage.getItem('session'),'fixture-session');
 values.delete('session');const staleRead=api.storage.getItem('session');await api.storage.removeItem('session');assert.equal(await staleRead,null);
 await new Promise(setImmediate);assert.equal(backup.has('session'),false);assert.equal(await api.storage.getItem('session'),null);
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

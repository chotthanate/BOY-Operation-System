const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('every guarded page loads recovery before the auth dependency and uses the new guard',()=>{
 const pages=fs.readdirSync(root).filter(p=>p.endsWith('.html')&&read(p).includes('boy-auth-guard.js'));
 assert.equal(pages.length,10);
 for(const page of pages){const html=read(page);assert.ok(html.indexOf('boy-auth-status.js')<html.indexOf('https://cdn.jsdelivr.net/npm/@supabase/'),page);assert.match(html,/boy-auth-guard\.js\?v=20261121-recovery1/,page);assert.ok(html.indexOf('id="boyAuthFallback"')<html.indexOf('boy-auth-status.js'),page);}
});
test('auth recovery has a finite wait and does not delete drafts or grant access on a timeout',()=>{
 const source=read('assets/js/boy-auth-status.js');assert.match(source,/12000/);assert.match(source,/pageshow/);assert.match(source,/location\.reload\(\)/);
 assert.doesNotMatch(source,/localStorage|indexedDB|signOut|BOY_AUTH_CONTEXT\s*=/);
 const failed=source.slice(source.indexOf('const failed'),source.indexOf('const timer'));
 assert.doesNotMatch(failed,/\.remove\(|reveal\(/);
});
test('catalog upgrade leaves all draft and outbox keys intact',()=>{
 const source=read('assets/js/boy-daily-store.js');assert.match(source,/catalog:v4:/);assert.match(source,/BOY_TAWANA_DRAFT_/);assert.match(source,/BOY_BIGC_EXPENSE_DRAFT_/);
 assert.doesNotMatch(source,/localStorage\.clear\(/);
 for(const p of ['tawana.html','bigc.html'])assert.match(read(p),/boy-daily-store\.js\?v=20261121-recovery1/);
});

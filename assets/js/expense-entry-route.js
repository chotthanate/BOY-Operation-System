(() => {
 'use strict';
 const url=new URL(location.href),q=url.searchParams,file=url.pathname.split('/').pop();
 if(q.get('legacy')==='1'||q.has('next')||q.get('mode')==='test')return;
 if(q.has('page')&&q.get('page')!=='expense')return;
 if(q.has('view')&&!['expense','entry','history'].includes(q.get('view')))return;
 const branch=file==='tawana.html'?'TAWANA':file==='bigc.html'?'BIGC-CENTRAL-PATTAYA':q.get('branch')||'BURGER';
 if(!['tawana.html','bigc.html','burger.html'].includes(file))return;
 const next=new URL('expenses.html',url);
 next.searchParams.set('branch',branch);
 if(q.get('view')==='history')next.searchParams.set('view','history');
 if(/^\d{4}-\d{2}-\d{2}$/.test(q.get('date')||'')){next.searchParams.set('date',q.get('date'));next.searchParams.set('view','history');}
 if(q.get('investment')==='1')next.searchParams.set('investment','1');
 location.replace(next.href);
})();

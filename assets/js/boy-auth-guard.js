(() => {
  "use strict";
  const style = document.querySelector("#boyAuthPendingStyle");
  const reveal = () => { if (style) style.remove(); };
  const block = (message) => {
    reveal();
    document.body.innerHTML = `<main style="max-width:420px;margin:15vh auto;padding:24px;font-family:system-ui;text-align:center"><h1>ยังเปิดหน้านี้ไม่ได้</h1><p>${message}</p><a href="burger.html" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#08735e;color:white;text-decoration:none;font-weight:700">ไปหน้าเข้าสู่ระบบ</a></main>`;
  };
  const config = window.BOY_CENTRAL_CONFIG || {};
  if (!window.supabase || !config.url || !config.publishableKey) { block("ระบบเข้าสู่ระบบเชื่อมต่อไม่สำเร็จ"); return; }
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "boy-operation-auth" }
  });
  client.auth.getSession().then(({ data, error }) => {
    if (!error && data.session) { reveal(); return; }
    const next = `${location.pathname.split("/").pop() || "index.html"}${location.search}${location.hash}`;
    location.replace(`burger.html?next=${encodeURIComponent(next)}`);
  }).catch(() => block("กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่"));
})();

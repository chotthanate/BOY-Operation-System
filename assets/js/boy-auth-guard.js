(() => {
  "use strict";
  const style = document.querySelector("#boyAuthPendingStyle");
  const reveal = () => { if (style) style.remove(); };
  const ready = (context) => {
    window.BOY_AUTH_CONTEXT = context;
    reveal();
    window.dispatchEvent(new CustomEvent("boy-auth-ready", { detail: context }));
  };
  const block = (message) => {
    reveal();
    document.body.innerHTML = `<main style="max-width:420px;margin:15vh auto;padding:24px;font-family:system-ui;text-align:center"><h1>ยังเปิดหน้านี้ไม่ได้</h1><p>${message}</p><a href="burger.html" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:12px;background:#08735e;color:white;text-decoration:none;font-weight:700">ไปหน้าเข้าสู่ระบบ</a></main>`;
  };
  const config = window.BOY_CENTRAL_CONFIG || {};
  const allowLocalAccess = () => {
    if (!window.BOY_LOCAL_ACCESS?.hasAccess()) return false;
    const context = window.BOY_LOCAL_ACCESS.session();
    document.documentElement.dataset.boyAccess = "local";
    ready(context);
    return true;
  };
  if (allowLocalAccess()) return;
  if (!window.supabase || !config.url || !config.publishableKey) { block("ระบบเข้าสู่ระบบเชื่อมต่อไม่สำเร็จ"); return; }
  const client = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  client.auth.getSession().then(async ({ data, error }) => {
    if (!error && data.session) {
      const requiredRole = document.body?.dataset.requiredRole;
      if (requiredRole) {
        const { data: profile, error: profileError } = await client.schema("boy_central").from("profiles").select("company_role,active").eq("user_id", data.session.user.id).maybeSingle();
        if (profileError || !profile?.active || profile.company_role !== requiredRole) { block("บัญชีนี้ไม่มีสิทธิ์แก้ข้อมูลกลาง"); return; }
        data.session.profile = profile;
      }
      ready(data.session);
      return;
    }
    if (allowLocalAccess()) return;
    const next = `${location.pathname.split("/").pop() || "index.html"}${location.search}${location.hash}`;
    location.replace(`burger.html?next=${encodeURIComponent(next)}`);
  }).catch(() => { if (!allowLocalAccess()) block("กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่"); });
})();

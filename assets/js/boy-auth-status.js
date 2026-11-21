(() => {
  'use strict';
  if (window.BOY_AUTH_SCREEN) return;
  const panel = document.createElement('section');
  panel.id = 'boyAuthStatus';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.style.cssText = 'visibility:visible;position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#f3f8f5;color:#193d34;font:16px/1.6 system-ui,sans-serif';
  panel.innerHTML = '<div style="width:min(100%,380px);text-align:center"><h1 style="font-size:21px;margin:0 0 10px">กำลังตรวจสอบการเข้าใช้…</h1><p style="margin:0 0 20px"></p><div hidden><button type="button" style="min-height:44px;padding:10px 22px;border:0;border-radius:12px;background:#08735e;color:white;font:inherit;font-weight:700">ลองใหม่</button><a style="display:block;margin-top:16px;color:#08735e" href="burger.html">ไปหน้าเข้าสู่ระบบ</a></div></div>';
  // Runs before third-party scripts: even a stalled dependency cannot leave a
  // completely blank page. Protected content stays hidden until the guard passes.
  document.documentElement.appendChild(panel);
  document.querySelector('#boyAuthFallback')?.remove();
  const actions = panel.querySelector('div[hidden]');
  panel.querySelector('a').href = 'burger.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search + location.hash);
  panel.querySelector('button').onclick = () => location.reload();
  let finished = false;
  const failed = message => {
    if (finished) return;
    clearTimeout(timer);
    panel.querySelector('h1').textContent = 'ยังเปิดหน้านี้ไม่ได้';
    panel.querySelector('p').textContent = message;
    actions.hidden = false;
  };
  const timer = setTimeout(() => failed('เชื่อมต่อใช้เวลานาน กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่'), 12000);
  window.BOY_AUTH_SCREEN = {
    failed,
    ready() {
      finished = true;
      clearTimeout(timer);
      panel.remove();
      document.querySelector('#boyAuthPendingStyle')?.remove();
    }
  };
  window.addEventListener('pageshow', event => {
    if (event.persisted && !window.BOY_AUTH_CONTEXT && !finished) {
      failed('การเชื่อมต่อถูกพักไว้ กรุณาลองใหม่');
    }
  });
})();

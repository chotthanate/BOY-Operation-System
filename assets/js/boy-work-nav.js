(() => {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const handlers = new WeakMap();
  const entries = [
    ['home', 'หน้าแรก', 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-4v-7H8v7H4a1 1 0 0 1-1-1Z'],
    ['expenses', 'รายจ่าย', 'M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1Zm4 6h6m-6 4h6m-6 4h4'],
    ['stock', 'สต็อก', 'm12 3 9 5v8l-9 5-9-5V8Zm-9 5 9 5 9-5m-9 5v8M7.5 5.5l9 5'],
    ['dashboard', 'Dashboard', 'M4 4v16h16M8 15v-3m5 3V6m5 9v-6'],
    ['more', 'เพิ่มเติม', 'M4 12h2m5 0h2m5 0h2']
  ];

  function icon(path) {
    const svg = document.createElementNS(svgNS, 'svg');
    svg.classList.add('boy-work-nav-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const shape = document.createElementNS(svgNS, 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
  }

  function dashboardLink(value) {
    if (value) {
      try {
        const expected = new URL('dashboard.html', location.href);
        const requested = new URL(value, expected);
        if (requested.origin === expected.origin && requested.pathname === expected.pathname) {
          return 'dashboard.html' + requested.search + requested.hash;
        }
      } catch (_) { /* Use the canonical overview link. */ }
    }
    return 'dashboard.html';
  }

  function mount(target, { active, branch = null, dashboardHref, onNavigate } = {}) {
    const nav = typeof target === 'string' ? document.querySelector(target) : target;
    if (!nav) return null;
    const links = {
      home: 'index.html',
      expenses: 'expenses.html' + (branch ? '?' + new URLSearchParams({ branch }) : ''),
      stock: 'stock.html',
      dashboard: dashboardLink(dashboardHref),
      more: 'index.html#more'
    };
    nav.classList.add('boy-work-nav');
    if (nav.localName !== 'nav') nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'เมนูหลัก');
    nav.replaceChildren(...entries.map(([key, label, path]) => {
      const link = document.createElement('a');
      const text = document.createElement('span');
      link.setAttribute('href', links[key]);
      link.dataset.workSection = key;
      if (key === active) link.setAttribute('aria-current', 'page');
      text.textContent = label;
      link.append(icon(path), text);
      return link;
    }));
    nav.hidden = false;
    document.body.classList.add('boy-work-nav-mounted');
    document.documentElement.classList.add('boy-work-nav-active');
    nav.removeAttribute('aria-busy');

    const previous = handlers.get(nav);
    if (previous) nav.removeEventListener('click', previous);
    handlers.delete(nav);
    if (typeof onNavigate !== 'function') return nav;

    let pending = false;
    const handle = async event => {
      const link = event.target.closest?.('a[data-work-section]');
      if (event.defaultPrevented || event.button !== 0 || !link || link.parentElement !== nav
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      event.preventDefault();
      if (pending) return;
      pending = true;
      const href = link.href;
      nav.setAttribute('aria-busy', 'true');
      try {
        // The caller handles its own draft or form state. Do not leave if
        // it cannot safely save to the existing local storage.
        if (await onNavigate(event, link) !== false && handlers.get(nav) === handle) {
          location.assign(href);
        }
      } catch (_) {
        if (handlers.get(nav) === handle) window.alert('ยังเปลี่ยนหน้าไม่ได้ กรุณาลองใหม่');
      } finally {
        pending = false;
        if (handlers.get(nav) === handle) nav.removeAttribute('aria-busy');
      }
    };
    handlers.set(nav, handle);
    nav.addEventListener('click', handle);
    return nav;
  }

  window.BOY_WORK_NAV = Object.freeze({ mount });
})();

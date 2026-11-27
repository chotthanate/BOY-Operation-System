(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const branches = window.BOY_BRANCHES.all;
  const config = window.BOY_CENTRAL_CONFIG || {};
  const zone = 'Asia/Bangkok';
  const dayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const dateFormat = new Intl.DateTimeFormat('th-TH', {
    timeZone: zone, day: 'numeric', month: 'short', year: 'numeric'
  });
  const shortDate = new Intl.DateTimeFormat('th-TH', { timeZone: zone, day: 'numeric', month: 'short' });
  const timeFormat = new Intl.DateTimeFormat('th-TH', { timeZone: zone, hour: '2-digit', minute: '2-digit' });
  const number = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
  const today = () => {
    const parts = Object.fromEntries(dayParts.formatToParts().map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const dateAt = day => new Date(`${day}T12:00:00+07:00`);
  const validDay = day => typeof day === 'string' && dayPattern.test(day) && Number.isFinite(dateAt(day).getTime());
  const money = value => `฿${number.format(value)}`;
  const hasAmount = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const expenseUrl = code => `expenses.html?branch=${encodeURIComponent(code)}`;
  const reportUrl = (code, date) => `branch-dashboard.html?${new URLSearchParams({ branch: code, from: date, to: date })}`;
  const historyUrl = (code, date) => `${expenseUrl(code)}&view=history&date=${encodeURIComponent(date)}`;
  const receivingUrl = code => window.BOY_BRANCHES.dataPath(code, 'receipts') + '&work=stock';
  const loginUrl = 'burger.html?online=1&next=index.html';
  const saleStatus = { awaiting_shift: 'รอปิดกะ', awaiting_manual: 'รอบันทึกยอด', no_sales: 'ยังไม่มียอด' };
  const checkoutLabels = { expense: 'บันทึกรายจ่าย', income: 'บันทึกรายรับ', shift: 'ปิดกะ', receipt: 'รับสินค้า' };
  let authContext, client, snapshot, activeUser, loading, lastAttempt = 0, attemptDay;

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function row(title, detail, value, href, state) {
    const item = element('li');
    const link = element(href ? 'a' : 'div', 'home-row');
    if (href) link.href = href;
    const info = element('span', 'home-row-info');
    info.append(element('strong', null, title));
    if (detail) info.append(element('small', null, detail));
    link.append(info);
    if (value) link.append(element('span', `home-row-value${state ? ' ' + state : ''}`, value));
    item.append(link);
    return item;
  }

  function list(id, rows, empty) {
    $(id).replaceChildren(...(rows.length ? rows : [element('li', 'home-empty', empty)]));
  }

  function dateLabel(day) {
    const label = $('home-date');
    label.dateTime = day;
    label.textContent = dateFormat.format(dateAt(day));
  }

  function message(text, signIn = false) {
    const target = $('home-message');
    if (!target) return;
    target.textContent = text;
    if (signIn) {
      const link = element('a', null, 'เข้าสู่ระบบออนไลน์');
      link.href = loginUrl;
      target.append(' ', link);
    }
    target.hidden = !text;
  }

  function exactLocal(key) {
    // Read only the live draft and exact pending request for this signed-in user.
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
  }

  const draftFields = ['description', 'quantity', 'line_total', 'supplier_name', 'note', 'item_id',
    'expense_item_id', 'category_id', 'subcategory_id', 'unit_id', 'project_name', 'investment_category'];

  function localDraft(code, user, remoteCount = 0, remoteDate = '') {
    if (!user) return { count: remoteCount, date: remoteDate };
    const prefix = `BOY_ENTRY_V1:${code}:${user}:`;
    const pending = exactLocal(prefix + 'pending');
    if (Array.isArray(pending?.lines) && pending.lines.length) {
      return { count: pending.lines.length, date: pending.date, pending: true };
    }
    const draft = exactLocal(prefix + 'draft');
    const count = Array.isArray(draft?.data?.lines) ? draft.data.lines.filter(line => line && (
      draftFields.some(key => String(line[key] ?? '').trim() !== '') || line.is_investment ||
      (line.payment_method && line.payment_method !== 'cash') || (line.receiving_mode && line.receiving_mode !== 'immediate')
    )).length : 0;
    // A clean local snapshot may be stale on another device. Never report it
    // above a newer central result, but still surface unsaved local work.
    return count && (draft.dirty || !snapshot)
      ? { count, date: draft.data.date, local: true }
      : { count: remoteCount, date: remoteDate };
  }

  function renderTasks(visible, allowLocal, fallback) {
    const tasks = [];
    let reimbursements = 0;
    const claimBranches = [];
    for (const branch of visible) {
      if (branch.can_enter_expenses || allowLocal) {
        const draft = localDraft(branch.code, activeUser, branch.draft_count, branch.draft_date);
        if (draft.count > 0) {
          const when = validDay(draft.date) ? ` · ${shortDate.format(dateAt(draft.date))}` : '';
          const title = draft.pending ? 'รายจ่ายรอส่ง' : 'ร่างรายจ่าย';
          const localNote = draft.local || draft.pending ? ' · ในเครื่องนี้' : '';
          tasks.push(row(title, branch.name + when + localNote, `${draft.count} รายการ`, expenseUrl(branch.code), 'pending'));
        }
      }
      if (branch.reimbursements > 0) {
        reimbursements += Number(branch.reimbursements);
        claimBranches.push(branch.name);
      }
      if (branch.receipts > 0) {
        tasks.push(row('รอรับสินค้า', branch.name, `${branch.receipts} บิล`, receivingUrl(branch.code), 'pending'));
      }
    }
    if (reimbursements > 0) tasks.push(row('รอเบิกค่าใช้จ่าย', claimBranches.join(' · '), `${reimbursements} บิล`, 'reimbursements.html', 'pending'));
    if (fallback && tasks.length) tasks.push(element('li', 'home-empty', fallback));
    list('home-tasks', tasks, fallback || 'ไม่มีงานค้าง');
  }

  function renderNavigation(visible) {
    const expense = $('home-expense-link');
    const editable = visible?.filter(branch => branch.can_enter_expenses);
    if (expense) expense.href = editable?.length
      ? expenseUrl((editable.find(branch => branch.code === 'TAWANA') || editable[0]).code)
      : 'expenses.html';
  }

  function renderUnavailable(text, showLocal = false) {
    snapshot = null;
    dateLabel(today());
    $('home-sales-total').textContent = '—';
    $('home-sales-status').textContent = '';
    $('home-expense-total').textContent = '—';
    if ($('home-expense-status')) $('home-expense-status').textContent = '';
    list('home-branches', [], text);
    renderTasks(showLocal ? branches : [], showLocal, text);
    list('home-recent', [], text);
    renderNavigation(null);
  }

  function render(data) {
    snapshot = data;
    const latest = new Map(data.branches.map(row => [row.code, row]));
    const visible = branches.flatMap(branch => latest.has(branch.code)
      ? [{ ...branch, ...latest.get(branch.code) }] : []);
    const recorded = visible.filter(branch => branch.sales_status === 'recorded' && hasAmount(branch.sales));
    const totalSatang = recorded.reduce((sum, branch) => sum + Math.round(Number(branch.sales) * 100), 0);
    dateLabel(data.date);
    $('home-sales-total').textContent = recorded.length ? money(totalSatang / 100) : '—';
    $('home-sales-status').textContent = visible.length
      ? `${recorded.length} / ${visible.length} สาขามียอด` : 'ไม่มีสาขาที่เข้าถึงได้';
    $('home-expense-total').textContent = visible.length && hasAmount(data.total_expenses) ? money(data.total_expenses) : '—';
    if ($('home-expense-status')) $('home-expense-status').textContent = visible.length ? 'ไม่รวมเงินลงทุน' : '';
    list('home-branches', visible.map(branch => {
      const available = branch.sales_status === 'recorded' && hasAmount(branch.sales);
      const value = available ? money(branch.sales) : saleStatus[branch.sales_status] || 'ยังไม่มียอด';
      return row(branch.name, null, value, reportUrl(branch.code, data.date), available ? 'recorded' : 'pending');
    }), 'ไม่มีสาขาที่เข้าถึงได้');
    renderTasks(visible, false);
    list('home-recent', data.recent.flatMap(event => {
      const branch = visible.find(item => item.code === event.branch_code);
      if (!branch || !Object.hasOwn(checkoutLabels, event.kind)) return [];
      const timestamp = new Date(event.at);
      if (!event.at || !Number.isFinite(timestamp.getTime())) return [];
      const validDate = validDay(event.date);
      const href = event.kind === 'receipt' ? receivingUrl(branch.code)
        : !validDate ? null : ['expense', 'income'].includes(event.kind) && branch.can_enter_expenses
          ? historyUrl(branch.code, event.date) : reportUrl(branch.code, event.date);
      const value = hasAmount(event.amount) ? money(event.amount)
        : event.count > 0 ? `${event.count} รายการ` : '';
      return [row(checkoutLabels[event.kind], `${branch.name} · ${shortDate.format(timestamp)} ${timeFormat.format(timestamp)}`, value, href)];
    }).slice(0, 5), 'ยังไม่มีรายการล่าสุด');
    renderNavigation(visible);
  }

  function bounded(promise, milliseconds) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('home timeout')), milliseconds);
    })]).finally(() => clearTimeout(timer));
  }

  async function refresh(force = false) {
    if (!authContext || loading || (!force && attemptDay === today() && Date.now() - lastAttempt < 45000)) return;
    attemptDay = today();
    lastAttempt = Date.now();
    $('home-refresh').disabled = true;
    if (!snapshot || snapshot.date !== attemptDay) renderUnavailable('กำลังโหลด…');
    message('');
    loading = (async () => {
      try {
        client ||= window.BOY_AUTH_CLIENT || (window.supabase && config.url && config.publishableKey
          ? window.supabase.createClient(config.url, config.publishableKey, {
            auth: { persistSession: true, autoRefreshToken: true, lockAcquireTimeout: 5000,
              ...(window.BOY_SESSION_STORAGE ? { storage: window.BOY_SESSION_STORAGE.storage } : {}) }
          }) : null);
        if (!client) throw new Error('home client unavailable');
        const { data, error } = await bounded(client.auth.getSession(), 6500);
        if (error) throw error;
        const session = data?.session;
        if (!session) {
          activeUser = authContext.localAccess ? authContext.user?.id : null;
          renderUnavailable('ยังไม่ได้เชื่อมต่อฐานกลาง', !!activeUser);
          message('เข้าออนไลน์เพื่อดูยอดและงานจากฐานกลาง', true);
          return;
        }
        // A different account in another tab must never inherit the previous view.
        if (activeUser && activeUser !== session.user.id) renderUnavailable('กำลังโหลด…');
        activeUser = session.user.id;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const request = client.rpc('get_operation_home');
          const { data: result, error: readError } = await bounded(request.abortSignal(controller.signal), 10500);
          if (readError) throw readError;
          if (!result || !validDay(result.date) || !Array.isArray(result.branches) || !Array.isArray(result.recent)) throw new Error('invalid home data');
          render(result);
        } finally { clearTimeout(timer); }
      } catch (_) {
        // Clear amounts instead of presenting stale or partial data as today's.
        renderUnavailable('โหลดข้อมูลฐานกลางไม่สำเร็จ', !!activeUser);
        message('โหลดข้อมูลไม่สำเร็จ กรุณาลองรีเฟรช');
      } finally {
        $('home-refresh').disabled = false;
      }
    })();
    try { await loading; } finally { loading = null; }
  }

  const ready = context => {
    authContext = context;
    activeUser = context?.user?.id;
    openMore();
    void refresh(true);
  };
  const more = $('home-more-menu');
  function openMore() {
    if (authContext && location.hash === '#more' && typeof more?.showPopover === 'function' && !more.matches(':popover-open')) more.showPopover();
  }
  more?.addEventListener('toggle', event => {
    if (event.newState === 'closed' && location.hash === '#more') history.replaceState(history.state, '', location.pathname + location.search);
  });
  window.addEventListener('hashchange', openMore);
  dateLabel(today());
  $('home-refresh').addEventListener('click', () => void refresh(true));
  if (window.BOY_AUTH_CONTEXT) ready(window.BOY_AUTH_CONTEXT);
  else window.addEventListener('boy-auth-ready', event => ready(event.detail), { once: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(true); });
  window.addEventListener('online', () => void refresh(true));
  window.addEventListener('focus', () => { if (!document.hidden) void refresh(); });
  // A page left open overnight must not label yesterday's totals as today's.
  setInterval(() => { if (!document.hidden && attemptDay !== today()) void refresh(); }, 60000);
})();

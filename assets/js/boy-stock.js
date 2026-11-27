(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const registry = window.BOY_BRANCHES.all;
  const quantity = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 });
  const clock = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  const state = { client: null, profile: null, branches: [], rows: [], selected: null, sequence: 0, starting: false };
  const branchUrl = code => code ? `stock.html?branch=${encodeURIComponent(code)}` : 'stock.html';
  const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const isBigc = code => code.startsWith('BIGC-');
  const mountNavigation = () => window.BOY_WORK_NAV?.mount($('workNav'), { active: 'stock', branch: state.selected?.code || null });
  function client() {
    if (!state.client) state.client = window.BOY_AUTH_CLIENT || window.supabase.createClient(window.BOY_CENTRAL_CONFIG.url, window.BOY_CENTRAL_CONFIG.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, lockAcquireTimeout: 5000, ...(window.BOY_SESSION_STORAGE ? { storage: window.BOY_SESSION_STORAGE.storage } : {}) } });
    return state.client;
  }
  async function onlineSession(context) {
    if (context?.access_token && context.user?.id && !context.localAccess && !context.local_access) return context;
    let timer;
    try {
      const { data, error } = await Promise.race([client().auth.getSession(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('ตรวจการเข้าใช้ไม่สำเร็จ กรุณาโหลดใหม่')), 8000); })]);
      if (error) throw error;
      return data?.session || null;
    } finally { clearTimeout(timer); }
  }
  function notice(message, signIn = false) {
    const node = $('stockNotice'); node.replaceChildren(); node.hidden = !message;
    if (!message) return;
    node.append(document.createTextNode(message));
    if (signIn) { const link = element('a', null, 'เข้าสู่ระบบออนไลน์'); link.href = `burger.html?online=1&next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`; node.append(link); }
  }
  async function read(query) {
    const { data, error } = await query.abortSignal(AbortSignal.timeout(15000));
    if (error) throw new Error(error.message || 'โหลดข้อมูลไม่สำเร็จ');
    return data;
  }
  async function paged(table, columns, configure) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await read(configure(state.client.schema('boy_central').from(table).select(columns)).range(offset, offset + 999));
      rows.push(...(page || [])); if (!page || page.length < 1000) break;
    }
    return rows;
  }
  async function itemsFor(ids) {
    const rows = [];
    for (let offset = 0; offset < ids.length; offset += 200) {
      rows.push(...await paged('items', 'id,code,name,base_unit_id,category_id,track_stock,stock_target_item_id,active', query => query.in('id', ids.slice(offset, offset + 200)).order('id')));
    }
    return rows;
  }
  function renderChooser() {
    $('stockBranches').replaceChildren(...state.branches.map(branch => {
      const link = element('a', 'stock-branch-card'); link.href = branchUrl(branch.code); link.dataset.stockBranch = branch.code;
      link.append(element('span', null, branch.mark), element('strong', null, branch.name), element('b', null, '›')); return link;
    }));
    if (!state.branches.length) $('stockBranches').append(element('p', 'stock-empty', 'ไม่มีสาขาที่เข้าถึงได้'));
    $('stockBranch').replaceChildren(...state.branches.map(branch => { const option = element('option', null, branch.name); option.value = branch.code; return option; }));
  }
  function configureDetail(branch) {
    $('stockChooser').hidden = Boolean(branch); $('stockDetail').hidden = !branch; $('stockBack').hidden = !branch;
    $('stockTitle').textContent = branch ? `สต็อก · ${branch.name}` : 'สต็อก';
    document.title = branch ? `สต็อก ${branch.name} | BOY Operation` : 'สต็อก | BOY Operation';
    $('stockUpdated').textContent = ''; mountNavigation();
    if (!branch) return;
    $('stockBranch').value = branch.code;
    $('stockReceiving').href = `burger.html?branch=${encodeURIComponent(branch.code)}&page=receipts&work=stock`;
    $('stockAdvanced').hidden = state.profile?.company_role !== 'admin' || branch.code === 'TAWANA';
    $('stockAdvanced').href = `burger.html?branch=${encodeURIComponent(branch.code)}&page=stock&work=stock`;
  }
  function buildRows(items, links, balances, policy, units, categories, branch) {
    const unitNames = new Map(units.map(row => [row.id, row.name]));
    const categoryNames = new Map(categories.map(row => [row.id, row.name]));
    const linkByItem = new Map(links.map(row => [row.item_id, row]));
    const enabled = new Set((policy?.menu_config || []).filter(row => row.stockAtBigc === true).map(row => row.itemId).filter(Boolean));
    const grouped = new Map();
    for (const balance of balances) {
      const existing = grouped.get(balance.item_id) || [];
      existing.push(balance); grouped.set(balance.item_id, existing);
    }
    return items.flatMap(item => {
      const locations = grouped.get(item.id) || [];
      const names = new Set(locations.map(row => row.base_unit_name).filter(Boolean));
      if (names.size > 1) throw new Error(`หน่วยสต็อกของ ${item.name} ไม่ตรงกัน กรุณาตรวจข้อมูลกลาง`);
      const totals = locations.reduce((value, row) => {
        const amount = Number(row.quantity_on_hand);
        if (!Number.isFinite(amount)) throw new Error(`ยอดสต็อกของ ${item.name} ไม่ถูกต้อง`);
        return value + amount;
      }, 0);
      const link = linkByItem.get(item.id);
      const canonical = item.track_stock === true && !item.stock_target_item_id;
      const tracked = canonical && item.active !== false && (isBigc(branch.code) ? enabled.has(item.id) : link?.active === true);
      // Existing non-zero balances remain visible even after a tracking rule changes.
      // A child balance is kept separate; it is never silently added to its pool.
      if (!tracked && !locations.some(row => Number(row.quantity_on_hand) !== 0)) return [];
      const minimum = Number(link?.minimum_stock || 0);
      const unit = [...names][0] || unitNames.get(item.base_unit_id) || 'หน่วย';
      return [{ id: item.id, code: item.code, name: item.name, categoryId: item.category_id || '', categoryName: categoryNames.get(item.category_id) || 'ไม่ระบุหมวด', quantity: totals, unit, minimum,
        low: totals <= Math.max(minimum, 0), locations, note: item.stock_target_item_id ? 'ยอดแยกรายการ · ตรวจการรวมสต็อก' : !tracked ? 'มียอดคงเหลือ · ไม่ได้เปิดติดตาม' : '' }];
    }).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }
  function renderRows() {
    const search = $('stockSearch').value.trim().toLocaleLowerCase('th');
    const category = $('stockCategory').value, filter = $('stockFilter').value;
    const rows = state.rows.filter(row => (!search || `${row.name} ${row.code} ${row.unit}`.toLocaleLowerCase('th').includes(search))
      && (!category || row.categoryId === category) && (filter === 'all' || (filter === 'empty' ? row.quantity <= 0 : row.low)));
    $('stockResultCount').textContent = `พบ ${quantity.format(rows.length)} จาก ${quantity.format(state.rows.length)} รายการ`;
    $('stockRows').replaceChildren(...rows.map(row => {
      const article = element('article', `stock-row${row.low ? ' stock-low' : ''}${row.quantity < 0 ? ' stock-negative' : ''}`);
      const main = element('div', 'stock-row-main'), copy = element('div', 'stock-item-copy'), amount = element('div', 'stock-quantity');
      copy.append(element('strong', null, row.name), element('small', null, `${row.code || ''} · ${row.categoryName}`));
      if (row.note) copy.append(element('span', 'stock-tag', row.note));
      else if (row.low) copy.append(element('span', 'stock-tag', row.quantity < 0 ? 'ติดลบ' : row.quantity === 0 ? 'หมด' : `ขั้นต่ำ ${quantity.format(row.minimum)} ${row.unit}`));
      amount.append(element('strong', null, quantity.format(row.quantity)), element('span', null, row.unit));
      main.append(copy, amount); article.append(main);
      if (row.locations.length > 1) {
        const details = element('details', 'stock-locations'); details.append(element('summary', null, `${row.locations.length} จุดเก็บ`));
        row.locations.forEach(location => { const line = element('div', 'stock-location'); line.append(element('span', null, location.location_name || 'จุดเก็บ'), element('span', null, `${quantity.format(Number(location.quantity_on_hand))} ${row.unit}`)); details.append(line); });
        article.append(details);
      }
      return article;
    }));
    if (!rows.length) $('stockRows').append(element('p', 'stock-empty', state.rows.length ? 'ไม่พบสินค้าตามตัวกรอง' : 'ยังไม่มีรายการสต็อกของสาขานี้'));
  }
  async function loadStock() {
    const branch = state.selected; if (!branch) return;
    const request = ++state.sequence;
    state.rows = []; notice(''); $('stockUpdated').textContent = 'กำลังโหลด…'; $('stockRefresh').disabled = true;
    $('stockSummary').hidden = true; $('stockFilters').hidden = true; $('stockResultCount').textContent = '';
    $('stockRows').replaceChildren(element('p', 'stock-empty', 'กำลังโหลดสต็อก…')); $('stockRows').setAttribute('aria-busy', 'true');
    try {
      if (!navigator.onLine) throw new Error('ออฟไลน์ · เชื่อมต่ออินเทอร์เน็ตแล้วโหลดใหม่');
      const db = state.client.schema('boy_central');
      const [links, balances, policy, units, categories] = await Promise.all([
        paged('branch_items', 'item_id,active,minimum_stock', query => query.eq('branch_id', branch.id).order('item_id')),
        paged('v_stock_on_hand', 'item_id,item_code,item_name,base_unit_name,quantity_on_hand,location_id,location_name,updated_at', query => query.eq('branch_id', branch.id).order('item_id').order('location_id')),
        isBigc(branch.code) ? read(db.from('bigc_workflow_settings').select('menu_config').eq('branch_id', branch.id).maybeSingle()) : Promise.resolve(null),
        paged('units', 'id,name', query => query.order('id')),
        paged('categories', 'id,name', query => query.order('id'))
      ]);
      const ids = [...new Set([...links.map(row => row.item_id), ...balances.map(row => row.item_id), ...(policy?.menu_config || []).filter(row => row.stockAtBigc === true).map(row => row.itemId)].filter(Boolean))];
      const items = await itemsFor(ids);
      if (request !== state.sequence) return;
      if (balances.some(balance => !items.some(item => item.id === balance.item_id))) throw new Error('โหลดสินค้าบางรายการไม่ครบ กรุณาโหลดใหม่');
      state.rows = buildRows(items, links, balances, policy, units, categories, branch);
      const choices = [...new Map(state.rows.map(row => [row.categoryId, row.categoryName])).entries()].filter(([id]) => id).sort((a, b) => a[1].localeCompare(b[1], 'th'));
      const all = element('option', null, 'ทุกหมวดหมู่'); all.value = '';
      $('stockCategory').replaceChildren(all, ...choices.map(([id, name]) => { const option = element('option', null, name); option.value = id; return option; }));
      $('stockItemCount').textContent = quantity.format(state.rows.length); $('stockLowCount').textContent = quantity.format(state.rows.filter(row => row.low).length);
      $('stockSummary').hidden = false; $('stockFilters').hidden = false; $('stockUpdated').textContent = `อัปเดต ${clock.format(new Date())}`; renderRows();
    } catch (error) {
      if (request !== state.sequence) return;
      $('stockUpdated').textContent = 'โหลดไม่สำเร็จ'; $('stockRows').replaceChildren(element('p', 'stock-empty', 'ยังแสดงยอดสต็อกไม่ได้'));
      notice(error.name === 'TimeoutError' || /timeout|aborted/i.test(error.message) ? 'เชื่อมต่อใช้เวลานาน กดโหลดใหม่อีกครั้ง' : error.message || 'โหลดสต็อกไม่สำเร็จ');
    } finally { if (request === state.sequence) { $('stockRefresh').disabled = false; $('stockRows').removeAttribute('aria-busy'); } }
  }
  function navigate(code, push = true) {
    const branch = state.branches.find(row => row.code === code) || null;
    ++state.sequence; state.selected = branch; state.rows = []; $('stockRefresh').disabled = false;
    if (push) history.pushState({}, '', branchUrl(branch?.code));
    notice(code && !branch ? 'ไม่มีสิทธิ์เข้าถึงสาขานี้ หรือสาขาปิดใช้งาน' : '');
    configureDetail(branch);
    $('stockSearch').value = ''; $('stockFilter').value = 'all';
    if (branch) void loadStock();
  }
  async function start(context) {
    if (state.starting) return; state.starting = true; mountNavigation();
    try {
      const session = await onlineSession(context);
      if (!session?.user?.id || !session.access_token) {
        ++state.sequence; state.selected = null; state.profile = null; state.branches = []; state.rows = []; configureDetail(null); renderChooser();
        $('stockChooser').hidden = true; notice('เข้าสู่ระบบออนไลน์เพื่อดูยอดสต็อกล่าสุด', true); return;
      }
      const db = client().schema('boy_central');
      const profile = await read(db.from('profiles').select('company_id,company_role,active').eq('user_id', session.user.id).maybeSingle());
      if (!profile?.active) throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน');
      state.profile = profile;
      const [branches, roles] = await Promise.all([
        read(db.from('branches').select('id,code,name,company_id,active').eq('company_id', profile.company_id).eq('active', true).in('code', registry.map(row => row.code))),
        read(db.from('user_branch_roles').select('branch_id,role,active').eq('user_id', session.user.id).eq('active', true))
      ]);
      const granted = new Set((roles || []).map(row => row.branch_id));
      state.branches = registry.flatMap(known => { const branch = (branches || []).find(row => row.code === known.code); return branch && (profile.company_role === 'admin' || granted.has(branch.id)) ? [{ ...known, ...branch }] : []; });
      renderChooser(); $('stockChooser').hidden = false;
      navigate(new URLSearchParams(location.search).get('branch') || '', false);
    } catch (error) { $('stockChooser').hidden = true; notice(error.message || 'ตรวจสิทธิ์ไม่สำเร็จ กรุณาโหลดใหม่'); }
    finally { state.starting = false; }
  }
  $('stockRefresh').addEventListener('click', () => state.selected ? void loadStock() : void start(window.BOY_AUTH_CONTEXT));
  $('stockBranch').addEventListener('change', event => navigate(event.target.value));
  $('stockSearch').addEventListener('input', renderRows); $('stockCategory').addEventListener('change', renderRows); $('stockFilter').addEventListener('change', renderRows);
  $('stockBack').addEventListener('click', event => { event.preventDefault(); navigate(''); });
  $('stockBranches').addEventListener('click', event => { const link = event.target.closest('[data-stock-branch]'); if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(link.dataset.stockBranch); });
  window.addEventListener('popstate', () => navigate(new URLSearchParams(location.search).get('branch') || '', false));
  window.addEventListener('boy-auth-ready', event => void start(event.detail));
  if (window.BOY_AUTH_CONTEXT) void start(window.BOY_AUTH_CONTEXT);
})();

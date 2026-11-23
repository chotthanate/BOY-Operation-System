// Exercise the deployed HTML/assets with an isolated Supabase fixture. No live requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'https://home.fixture';
const day = '2026-11-24';
const uid = 'home-test-user';
const localDraft = `BOY_ENTRY_V1:TAWANA:${uid}:draft`;
const localPending = `BOY_ENTRY_V1:TAWANA:${uid}:pending`;
const seed = {
  [localDraft]: { revision: 9, dirty: true, data: { date: '2026-11-23', lines: [{ id: 'l1', description: 'ร่างห้ามหาย' }] } },
  [localPending]: { request_id: 'fixture-request', date: '2026-11-23', lines: [{ description: 'รายการรอยืนยัน', line_total: 33 }] },
  [`BOY_ENTRY_V1:TAWANA:${uid}:backups`]: [{ data: { date: '2026-11-22', lines: [{ description: 'สำเนาห้ามหาย' }] } }],
  [`BOY_ENTRY_V1:GRILL:other-user:draft`]: { revision: 2, dirty: true, data: { date: day, lines: [{ description: 'ร่างบัญชีอื่น' }] } },
  BOY_TAWANA_DRAFT_2026_11_21: { exp: [{ i: 'ร่างเก่าเก็บไว้' }] },
};
const snapshot = Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
const branch = (code, name, sales, sales_status, more = {}) => ({
  code, name, sales, sales_status, draft_count: 0, draft_date: null, receipts: 0, reimbursements: 0,
  can_enter_expenses: true, ...more,
});
const data = {
  date: day, generated_at: `${day}T10:30:00+07:00`, total_expenses: 112.25,
  branches: [
    branch('TAWANA', 'ทาวน่า', 1250.25, 'recorded', { draft_count: 2, draft_date: '2026-11-23', reimbursements: 3 }),
    branch('BURGER', 'ร้านเบอร์เกอร์', null, 'awaiting_shift', { receipts: 2 }),
    branch('GRILL', 'ร้านเนื้อย่าง', 0, 'recorded'),
    branch('BIGC-CENTRAL-PATTAYA', 'BigC พัทยากลาง', null, 'awaiting_manual'),
    branch('BIGC-SOUTH-PATTAYA', 'BigC พัทยาใต้', 752, 'recorded'),
  ],
  recent: [
    { kind: 'expense', branch_code: 'TAWANA', at: `${day}T10:30:00+07:00`, date: day, count: 2, amount: 112.25 },
    { kind: 'receipt', branch_code: 'BURGER', at: `${day}T09:45:00+07:00`, date: day, count: 1 },
    { kind: 'shift', branch_code: 'BIGC-SOUTH-PATTAYA', at: '2026-11-23T21:00:00+07:00', date: '2026-11-23', amount: 752 },
  ],
};

async function setup(browser, { width = 390, response = data, role = 'admin', holdAuth = false, signedIn = true, localOnly = false, fail = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 855 }, isMobile: width <= 390, hasTouch: width <= 390 });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date(data.generated_at) });
  await context.addInitScript(({ response, role, signedIn, uid, holdAuth, fail, seed, localOnly }) => {
    if (!localStorage.getItem('__home_fixture_initialized')) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
      if (localOnly) localStorage.setItem('boy-owner-local-access-v1', JSON.stringify({ userId: uid, expiresAt: Date.now() + 3600000 }));
      localStorage.setItem('__home_fixture_initialized', '1');
    }
    window.__fixtureMutations = [];
    const protectedKey = key => /^BOY_ENTRY_V1:|^BOY_TAWANA_DRAFT_/.test(key);
    for (const operation of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[operation];
      Storage.prototype[operation] = function (...args) {
        if (this === localStorage && (operation === 'clear' || protectedKey(args[0]))) {
          window.__fixtureMutations.push([operation, args[0]]);
        }
        return Reflect.apply(original, this, args);
      };
    }
    window.__homeCalls = [];
    window.__homeFailure = fail;
    const session = signedIn ? { user: { id: uid }, access_token: 'fixture' } : null;
    const getSession = () => holdAuth ? new Promise(resolve => {
      window.__homeAuthReady = () => { holdAuth = false; resolve({ data: { session } }); };
    }) : Promise.resolve({ data: { session } });
    const query = async (name, payload) => {
      window.__homeCalls.push({ name, payload });
      if (name !== 'get_operation_home') throw Error(`Unexpected RPC ${name}`);
      return window.__homeFailure
        ? { data: null, error: { code: 'TEST', message: 'Fixture unavailable' } }
        : { data: structuredClone(response), error: null };
    };
    const rpc = (name, payload) => {
      const promise = query(name, payload);
      promise.abortSignal = () => promise;
      return promise;
    };
    window.supabase = { createClient: () => ({ auth: { getSession }, rpc, schema: () => ({
      rpc,
      from(table) {
        if (table !== 'profiles') throw Error(`Unexpected table ${table}`);
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { active: true, company_role: role } }) }) }) };
      },
    }) }) };
  }, { response, role, signedIn, uid, holdAuth, fail, seed: snapshot, localOnly });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/assets/vendor/supabase-')) {
      return route.fulfill({ body: '', contentType: 'text/javascript' });
    }
    if (url.pathname.endsWith('/boy-central-config.js')) {
      return route.fulfill({ body: "window.BOY_CENTRAL_CONFIG={url:'https://fixture.invalid',publishableKey:'public-fixture'}", contentType: 'text/javascript' });
    }
    // Navigation target is inert: verify Home doesn't edit drafts on departure.
    if (/^\/(?:expenses|burger|branch-dashboard|dashboard|reimbursements|tawana)\.html$/.test(url.pathname)) {
      return route.fulfill({ body: '<!doctype html><title>Route fixture</title>', contentType: 'text/html' });
    }
    const file = path.join(root, url.pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ path: file });
  });
  await page.goto(`${origin}/index.html`);
  return { page, context, errors };
}

const text = (page, id) => page.locator(`#home-${id}`).textContent();
const digits = value => String(value).replace(/,/g, '');
const getDrafts = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(seed));

async function assertNoOverflow(page) {
  const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(widths.content <= widths.viewport, JSON.stringify(widths));
}

(async () => {
  const engine = process.env.BROWSER_ENGINE === 'webkit' ? webkit : chromium;
  const browser = await engine.launch();
  try {
    for (const width of [320, 390, 1440]) {
      const { page, context, errors } = await setup(browser, { width, holdAuth: true });
      await page.waitForFunction(() => !!window.__homeAuthReady);
      assert.deepEqual(await page.evaluate(() => window.__homeCalls), [], 'no metrics before authentication');
      assert.equal(await page.locator('#home-branches').isVisible(), false);
      await page.evaluate(() => window.__homeAuthReady());
      await page.locator('#home-branches').getByText('ทาวน่า', { exact: true }).waitFor();
      assert.match(digits(await text(page, 'sales-total')), /2002\.25/, 'sum only confirmed numeric sales');
      assert.match(digits(await text(page, 'expense-total')), /112\.25/);
      const branches = await text(page, 'branches');
      for (const b of data.branches) assert.ok(branches.includes(b.name), b.code);
      assert.match(digits(branches), /1250\.25/);
      assert.match(digits(branches), /(?:^|[^0-9])0(?:\.00)?(?:$|[^0-9.])/, 'recorded zero must remain visible');
      assert.match(branches, /รอ(?:ปิดกะ|ยอดปิดกะ)/, 'missing POS sales should not be presented as zero');
      assert.match(await text(page, 'sales-status'), /3\s*(?:\/|จาก)\s*5/, 'show incomplete coverage in headline');
      const tasks = await text(page, 'tasks');
      assert.match(tasks, /ร่าง|รอส่ง/);
      assert.match(tasks, /รอเบิก/);
      assert.match(tasks, /รอรับ/);
      assert.match(await text(page, 'recent'), /ทาวน่า/);
      assert.match(await text(page, 'recent'), /ร้านเบอร์เกอร์/);
      assert.equal(await page.getByText('งานหลักของคุณ', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => window.__homeCalls.filter(call => call.name === 'get_operation_home').length), 1);
      assert.deepEqual(await getDrafts(page), snapshot, 'load must not overwrite draft, pending or backup');
      assert.deepEqual(await page.evaluate(() => window.__fixtureMutations), []);
      await assertNoOverflow(page);
      const nav = page.getByRole('navigation', { name: 'เมนูหลัก', exact: true });
      assert.deepEqual(await nav.locator(':scope > *').allTextContents(), ['หน้าแรก', 'รายจ่าย', 'สต็อก', 'Dashboard', 'เพิ่มเติม']);
      const branchUrl = new URL(await page.locator('#home-branches a').filter({ hasText: 'ทาวน่า' }).getAttribute('href'), origin);
      assert.equal(branchUrl.pathname, '/branch-dashboard.html');
      assert.equal(branchUrl.searchParams.get('branch'), 'TAWANA');
      assert.equal(branchUrl.searchParams.get('from'), day);
      assert.equal(branchUrl.searchParams.get('to'), day);
      if (width === 390) {
        await nav.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click();
        const more = page.getByRole('dialog', { name: 'เพิ่มเติม', exact: true });
        await more.getByRole('link', { name: 'รอเบิกค่าใช้จ่าย', exact: true }).waitFor();
        await more.getByRole('link', { name: 'ข้อมูลกลาง BOY', exact: true }).waitFor();
        await more.getByRole('button', { name: 'ปิดเมนูเพิ่มเติม', exact: true }).click();
        await nav.getByRole('button', { name: 'สต็อก', exact: true }).click();
        const stock = page.getByRole('dialog', { name: 'สต็อกตามสาขา', exact: true });
        assert.equal(await stock.getByRole('link').count(), 5);
        await stock.getByRole('button', { name: 'ปิดเมนูสต็อก', exact: true }).click();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const unobscured = await page.evaluate(() => document.querySelector('#home-recent').getBoundingClientRect().bottom <=
          document.querySelector('.home-nav').getBoundingClientRect().top);
        assert.ok(unobscured, 'last activity must scroll above bottom navigation');
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (width === 390 && process.env.HOME_SCREENSHOT) await page.screenshot({ path: process.env.HOME_SCREENSHOT, fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }

    const full = await setup(browser);
    await full.page.locator('#home-branches').getByText('ทาวน่า', { exact: true }).waitFor();
    await full.page.evaluate(() => { window.__homeFailure = true; });
    await full.page.locator('#home-refresh').click();
    await full.page.waitForFunction(() => window.__homeCalls.length === 2 && !document.querySelector('#home-refresh').disabled);
    assert.match(await text(full.page, 'message'), /ไม่สำเร็จ|ลองใหม่|เชื่อมต่อ/);
    assert.deepEqual(await getDrafts(full.page), snapshot);
    assert.deepEqual(await full.page.evaluate(() => window.__fixtureMutations), []);
    await full.page.evaluate(() => { window.__homeFailure = false; });
    await full.page.locator('#home-refresh').click();
    await full.page.waitForFunction(() => window.__homeCalls.length === 3 && !document.querySelector('#home-refresh').disabled);
    await full.page.locator('#home-branches').getByText('ทาวน่า', { exact: true }).waitFor();
    const draftLink = full.page.locator('#home-tasks a[href*="expenses.html"]').first();
    assert.ok((await draftLink.getAttribute('href')).includes('branch=TAWANA'));
    await draftLink.click();
    await full.page.waitForURL('**/expenses.html?branch=TAWANA');
    assert.deepEqual(await getDrafts(full.page), snapshot, 'departure to expense editor leaves existing values untouched');
    assert.deepEqual(full.errors, []);
    await full.context.close();

    const restricted = await setup(browser, { role: 'staff', response: {
      ...data, total_expenses: 0, branches: [branch('GRILL', 'ร้านเนื้อย่าง', null, 'awaiting_shift', { can_enter_expenses: false })], recent: data.recent,
    } });
    await restricted.page.locator('#home-branches').getByText('ร้านเนื้อย่าง', { exact: true }).waitFor();
    assert.doesNotMatch(await text(restricted.page, 'branches'), /ทาวน่า|BigC|เบอร์เกอร์/);
    assert.doesNotMatch(await text(restricted.page, 'tasks'), /ร่าง|รอส่ง|ทาวน่า/, 'never surface another branch or user’s local draft');
    assert.doesNotMatch(await text(restricted.page, 'recent'), /ทาวน่า|BigC|เบอร์เกอร์/);
    assert.doesNotMatch(await text(restricted.page, 'sales-total'), /\d/, 'no numeric total if no branch has confirmed sales');
    assert.equal(await restricted.page.locator('#home-tasks a[href*="expenses.html"]').count(), 0);
    assert.equal(await restricted.page.locator('#home-stock-links [data-home-branch]:not([hidden])').count(), 1);
    assert.deepEqual(await getDrafts(restricted.page), snapshot);
    assert.deepEqual(restricted.errors, []);
    await restricted.context.close();

    const failed = await setup(browser, { fail: true });
    await failed.page.locator('#home-message').filter({ hasText: /ไม่สำเร็จ|ลองใหม่|เชื่อมต่อ/ }).waitFor();
    assert.doesNotMatch(await text(failed.page, 'sales-total'), /\d/, 'cannot substitute zero for unavailable data');
    assert.doesNotMatch(await text(failed.page, 'expense-total'), /\d/);
    assert.deepEqual(await getDrafts(failed.page), snapshot);
    assert.deepEqual(failed.errors, []);
    await failed.context.close();

    const local = await setup(browser, { signedIn: false, localOnly: true });
    await local.page.locator('#home-message').getByRole('link', { name: 'เข้าสู่ระบบออนไลน์', exact: true }).waitFor();
    assert.match(await text(local.page, 'tasks'), /รายจ่ายรอส่ง/);
    assert.doesNotMatch(await text(local.page, 'sales-total'), /\d/);
    assert.deepEqual(await local.page.evaluate(() => window.__homeCalls), [], 'local PIN does not confer online read rights');
    assert.deepEqual(await getDrafts(local.page), snapshot);
    assert.deepEqual(local.errors, []);
    await local.context.close();

    const denied = await setup(browser, { signedIn: false });
    await denied.page.waitForURL('**/burger.html?next=index.html');
    assert.deepEqual(await denied.page.evaluate(() => window.__homeCalls), [], 'signed-out visitor cannot query metrics');
    assert.deepEqual(await getDrafts(denied.page), snapshot);
    await denied.context.close();
    console.log(`${engine.name()}: live home layout, totals, auth scope, error/retry and draft preservation passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

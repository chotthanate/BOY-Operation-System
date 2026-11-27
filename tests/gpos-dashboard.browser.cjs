const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || "../scripts/gpos-cloud/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const branch = { id: "bigc-fixture", code: "BIGC-CENTRAL-PATTAYA", name: "BigC Central" };

async function main() {
  const engine = process.env.PLAYWRIGHT_ENGINE === "webkit" ? webkit : chromium;
  const browser = await engine.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [390, 1440]) {
      for (const mode of ["all", "branch"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        try {
          await page.addInitScript((branch) => {
            window.fixture = { recorded: 0, closed: false, age: 60, snapshot: true };
            window.BOY_CENTRAL_CONFIG = { url: "fixture", publishableKey: "fixture" };
            window.supabase = { createClient: () => ({
              auth: { getSession: async () => ({ data: { session: { user: { id: "fixture" } } } }) },
              schema: () => ({
                rpc: async (name, args) => {
                  const { recorded } = window.fixture;
                  const shared = { generatedAt: new Date().toISOString() };
                  if (name === "get_dashboard_daily") return { data: { ...shared, date: args.target_date,
                    totals: { income: recorded + 100 }, branches: [{ ...branch, income: recorded }] } };
                  if (name === "get_branch_dashboard") {
                    const selected = args.target_branch_code === branch.code ? branch : window.BOY_BRANCHES.get(args.target_branch_code);
                    return { data: { ...shared, branch: selected,
                      dateFrom: args.date_from, dateTo: args.date_to, totals: { revenue: recorded } } };
                  }
                  return { data: {} };
                },
                from: () => ({
                  select() { return this; }, eq() { return this; },
                  limit: async () => ({ data: window.fixture.closed ? [{ id: "close" }] : [] }),
                  maybeSingle: async () => ({ data: window.fixture.snapshot ? {
                    net_sales: 6376, order_count: 103,
                    captured_at: new Date(Date.now() - window.fixture.age * 60000).toISOString()
                  } : null })
                })
              })
            }) };
          }, branch);
          const file = mode === "all" ? "dashboard.html" : "branch-dashboard.html";
          await page.route("http://dashboard.fixture/**", (route) => {
            const pathname = new URL(route.request().url()).pathname;
            if (pathname.endsWith(".html")) {
              const html = fs.readFileSync(path.join(root, pathname), "utf8")
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style id="boyAuthPendingStyle">.*?<\/style>/, "")
                .replace('id="boyAuthFallback" role="status" style="', 'id="boyAuthFallback" role="status" style="display:none!important;')
                .replace("</body>", '<script src="/assets/js/boy-branches.js"></script><script src="/assets/js/boy-work-nav.js"></script><script src="/assets/js/dashboard.js"></script></body>');
              return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
            }
            return route.fulfill({ path: path.join(root, pathname) });
          });
          await page.goto(`http://dashboard.fixture/${file}?branch=${branch.code}`);
          const amount = page.locator(mode === "all" ? `a[href*="${branch.code}"] .store-total` : "#metricGrid .kpi:first-child strong");
          const stale = page.locator(mode === "all" ? ".store-gpos.stale" : ".gpos-stale small");
          await stale.waitFor();
          assert.equal(await amount.textContent(), "6,376.00");
          assert.match(await stale.textContent(), /GPOS.*103.*ยอดค้าง/);
          if (mode === "all") assert.equal(await page.locator("#totalIncome").textContent(), "100.00");
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

          await page.evaluate(() => { window.fixture.age = 5; });
          await page.locator("#refreshBtn").click();
          await page.getByText(/GPOS ชั่วคราว.*อัปเดต/).waitFor();
          assert.equal(await amount.textContent(), "6,376.00");

          await page.evaluate(() => { window.fixture.closed = true; });
          await page.locator("#refreshBtn").click();
          await page.getByText(/GPOS ชั่วคราว/).waitFor({ state: "detached" });
          assert.equal(await amount.textContent(), "0.00");

          await page.evaluate(() => { window.fixture.recorded = 6400; });
          await page.locator("#refreshBtn").click();
          await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === "6,400.00", mode === "all" ? `a[href*="${branch.code}"] .store-total` : "#metricGrid .kpi:first-child strong");
          assert.equal(await page.getByText(/GPOS ชั่วคราว/).count(), 0);

          assert.equal(await page.locator('nav[aria-label="เมนูหลัก"]').count(), 1);
          assert.equal(await page.locator('#workNav [aria-current="page"]').textContent(), 'Dashboard');
          assert.equal(await page.locator('#branchBottomNav, .side, #waterPosBranchLink').count(), 0);
          if (mode === "all") {
            const overviewDate = '2026-11-20';
            const rangeEnd = '2026-11-22';
            await page.locator('#dateInput').fill(overviewDate);
            const dateQuery = new URLSearchParams({branch: branch.code, from: overviewDate, to: overviewDate, date: overviewDate});
            await page.locator(`#storeGrid a[href="branch-dashboard.html?${dateQuery}"]`).click();
            await page.waitForURL(url => url.pathname === '/branch-dashboard.html' && url.searchParams.get('branch') === branch.code);
            assert.equal(await page.locator('#dateFrom').inputValue(), overviewDate);
            assert.equal(await page.locator('#dateTo').inputValue(), overviewDate);
            await page.locator('#dateTo').fill(rangeEnd);
            await page.locator('#dashboardBranch').selectOption('TAWANA');
            await page.waitForURL(url => url.pathname === '/branch-dashboard.html' && url.searchParams.get('branch') === 'TAWANA');
            await page.getByRole('heading', {name: 'Dashboard ทาวน่า', exact: true}).waitFor();
            assert.equal(await page.locator('#dateFrom').inputValue(), overviewDate);
            assert.equal(await page.locator('#dateTo').inputValue(), rangeEnd);
            assert.equal(await page.locator('#workNav [data-work-section=expenses]').getAttribute('href'), 'expenses.html?branch=TAWANA');
            await page.locator('#dashboardBack').click();
            await page.waitForURL(url => url.pathname === '/dashboard.html' && url.searchParams.get('date') === overviewDate);
            assert.equal(await page.locator('#dateInput').inputValue(), overviewDate);
          }
        } finally { await page.close(); }
      }
    }
    console.log("Dashboard: desktop and mobile, GPOS income and in-context navigation verified");
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

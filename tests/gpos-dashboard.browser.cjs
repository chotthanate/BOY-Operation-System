const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../scripts/gpos-cloud/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const branch = { id: "bigc-fixture", code: "BIGC-CENTRAL-PATTAYA", name: "BigC Central" };

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [390, 1440]) {
      for (const mode of ["all", "branch"]) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        try {
          await page.addInitScript((branch) => {
            window.fixture = { recorded: 0, closed: false, age: 60, snapshot: true };
            window.BOY_CENTRAL_CONFIG = { url: "fixture", publishableKey: "fixture" };
            window.BOY_BRANCHES = { get: () => branch, dataPath: () => "#" };
            window.supabase = { createClient: () => ({
              auth: { getSession: async () => ({ data: { session: { user: { id: "fixture" } } } }) },
              schema: () => ({
                rpc: async (name, args) => {
                  const { recorded } = window.fixture;
                  const shared = { generatedAt: new Date().toISOString() };
                  if (name === "get_dashboard_daily") return { data: { ...shared, date: args.target_date,
                    totals: { income: recorded + 100 }, branches: [{ ...branch, income: recorded }] } };
                  if (name === "get_branch_dashboard") return { data: { ...shared, branch,
                    dateFrom: args.date_from, dateTo: args.date_to, totals: { revenue: recorded } } };
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
              const html = fs.readFileSync(path.join(root, file), "utf8")
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style id="boyAuthPendingStyle">.*?<\/style>/, "")
                .replace('id="boyAuthFallback" role="status" style="', 'id="boyAuthFallback" role="status" style="display:none!important;')
                .replace("</body>", '<script src="/assets/js/dashboard.js"></script></body>');
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
        } finally { await page.close(); }
      }
    }
    console.log("GPOS dashboard: desktop and mobile, provisional and official income verified");
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

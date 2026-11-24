"use strict";

const { chromium } = require("playwright");
const { bangkokDate, parseDailyReport } = require("../gpos-report.cjs");

const gposUrl = "https://gpos_web-1pq8t2.th.biot-apps.com/branch/reports_sales_by_day";
const required = (key) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };

async function restoreLogin(page) {
  if (!new URL(page.url()).pathname.startsWith("/login")) return;
  const username = process.env.GPOS_LOGIN_EMAIL;
  const password = process.env.GPOS_LOGIN_PASSWORD;
  if (!username || !password) throw new Error("GPOS session expired; login credentials are not configured");
  const acceptance = page.locator('input[type="checkbox"]').nth(1);
  if (!(await acceptance.isChecked())) {
    throw new Error("GPOS session expired; a person must accept the login terms again");
  }
  await page.getByPlaceholder("กรุณากรอกบัญชี").fill(username);
  await page.getByPlaceholder("กรุณากรอกรหัสผ่านเข้าสู่ระบบ").fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
}

async function selectDate(page, index, date) {
  const buttons = page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}$/ });
  if (await buttons.count() !== 2) throw new Error("GPOS report date controls changed");
  if ((await buttons.nth(index).innerText()).trim() === date) return;
  await buttons.nth(index).click();
  await page.locator(`td[title="${date}"]`).click();
  await page.getByRole("button", { name: "ตกลง" }).click();
}

async function readToday(page, date) {
  await page.goto(gposUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => location.pathname === "/login" || [...document.querySelectorAll("th")].some((cell) => cell.textContent.includes("ยอดขายสุทธิ")), null, { timeout: 30000 });
  await restoreLogin(page);
  await page.getByRole("columnheader", { name: "ยอดขายสุทธิ (฿)" }).waitFor({ timeout: 30000 });
  await selectDate(page, 0, date);
  await selectDate(page, 1, date);
  const [year, month, day] = date.split("-");
  await page.getByRole("cell", { name: `${day}/${month}/${year}`, exact: true }).waitFor({ timeout: 30000 });
  const report = await page.locator("table").filter({ has: page.getByRole("columnheader", { name: "ยอดขายสุทธิ (฿)" }) }).first().evaluate((table) => ({
    headers: [...table.querySelectorAll("thead th")].map((cell) => cell.textContent.trim()),
    rows: [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim()))
  }));
  return parseDailyReport(report, date);
}

async function publishPreview(snapshot) {
  if (snapshot.date !== bangkokDate()) throw new Error("Bangkok date changed during extraction");
  const response = await fetch(`${required("BOY_SUPABASE_URL")}/rest/v1/rpc/save_gpos_dashboard_snapshot_worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: required("BOY_SUPABASE_PUBLISHABLE_KEY") },
    body: JSON.stringify({ target_date: snapshot.date, sales_amount: snapshot.netSales, sales_orders: snapshot.orders, ingest_token: required("BOY_GPOS_INGEST_TOKEN") })
  });
  if (!response.ok) throw new Error(`Supabase rejected GPOS preview (${response.status})`);
}

async function main() {
  const authState = JSON.parse(Buffer.from(required("GPOS_AUTH_STATE_B64"), "base64").toString("utf8"));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: authState, timezoneId: "Asia/Bangkok", locale: "th-TH" });
    const page = await context.newPage();
    const snapshot = await readToday(page, bangkokDate());
    await publishPreview(snapshot);
    console.log(`GPOS preview updated: ${snapshot.date}, ${snapshot.orders} orders`);
  } finally { await browser.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { restoreLogin, selectDate, readToday };

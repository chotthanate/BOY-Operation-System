"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { bangkokDate } = require("../gpos-report.cjs");

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: false });
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Bangkok", locale: "th-TH" });
    const page = await context.newPage();
    await page.goto("https://gpos_web-1pq8t2.th.biot-apps.com/branch/reports_sales_by_day");
    console.log("ลงชื่อเข้า GPOS ในหน้าต่างที่เปิด แล้วเปิดรายงานยอดขายรายวัน ระบบจะบันทึก session เมื่อหัวตารางปรากฏ");
    const [year, month, day] = bangkokDate().split("-");
    await page.getByRole("cell", { name: `${day}/${month}/${year}`, exact: true }).waitFor({ timeout: 300000 });
    if (new URL(page.url()).pathname !== "/branch/reports_sales_by_day") throw new Error("GPOS report was not opened");
    const storageState = await context.storageState({ indexedDB: true });
    const sessionEntries = await page.evaluate(() => Object.entries(sessionStorage));
    if (!storageState.cookies.length && !storageState.origins.length && !sessionEntries.length) {
      throw new Error("GPOS login state is empty; cannot configure the cloud worker");
    }
    const file = path.join(__dirname, "..", "..", ".gpos-browser-profile", "gpos-cloud-state.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ storageState, sessionStorage: { origin: new URL(page.url()).origin, entries: sessionEntries } }));
    console.log(`บันทึกสถานะ GPOS เฉพาะในเครื่อง: ${file}`);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

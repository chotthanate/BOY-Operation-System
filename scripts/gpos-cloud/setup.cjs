"use strict";

const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline/promises");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Bangkok", locale: "th-TH" });
    const page = await context.newPage();
    await page.goto("https://gpos_web-1pq8t2.th.biot-apps.com/branch/reports_sales_by_day");
    console.log("ลงชื่อเข้า GPOS ด้วยตัวเองในหน้าต่างที่เปิด รวมถึงยืนยันข้อตกลงเมื่อ GPOS ขอ จากนั้นกด Enter ที่ terminal");
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { await prompt.question("กด Enter เมื่อเห็นรายงานยอดขายรายวัน: "); }
    finally { prompt.close(); }
    await page.getByRole("columnheader", { name: "ยอดขายสุทธิ (฿)" }).waitFor({ timeout: 30000 });
    const file = path.join(__dirname, "..", "..", ".gpos-browser-profile", "gpos-cloud-state.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await context.storageState({ path: file, indexedDB: true });
    console.log(`บันทึกสถานะ GPOS เฉพาะในเครื่อง: ${file}`);
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

const test = require("node:test");
const assert = require("node:assert/strict");
const { bangkokDate, parseDailyReport } = require("../scripts/gpos-report.cjs");

const headers = ["วันที่", "ช่องทาง", "ช่องทางการขาย", "ยอดขายรวม (฿)", "จำนวนออเดอร์", "ยอดขายสุทธิ (฿)"];
test("reads only the all-channel row for the requested day", () => {
  const rows = [
    ["สรุปสินค้าทั้งหมด", "", "", "9,999.00", "90", "9,999.00"],
    ["24/11/2026", "ทั้งหมด", "ทั้งหมด", "3,700.00", "62", "3,699.00"],
    ["24/11/2026", "POS", "ทั้งหมด", "1,000.00", "20", "1,000.00"]
  ];
  assert.deepEqual(parseDailyReport({ headers, rows }, "2026-11-24"), { date: "2026-11-24", netSales: 3699, orders: 62 });
});
test("fails closed when the daily row is absent or duplicated", () => {
  assert.throws(() => parseDailyReport({ headers, rows: [] }, "2026-11-24"), /0 แถว/);
  const row = ["24/11/2026", "ทั้งหมด", "ทั้งหมด", "1", "1", "1"];
  assert.throws(() => parseDailyReport({ headers, rows: [row, row] }, "2026-11-24"), /2 แถว/);
});
test("uses the Bangkok business date", () => {
  assert.equal(bangkokDate(new Date("2026-11-23T18:00:00Z")), "2026-11-24");
});

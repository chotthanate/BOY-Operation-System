"use strict";

function bangkokDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function parseDailyReport({ headers, rows }, date) {
  const find = (label) => headers.findIndex((header) => header.trim() === label);
  const dateIndex = find("วันที่");
  const channelIndex = find("ช่องทาง");
  const saleChannelIndex = find("ช่องทางการขาย");
  const netIndex = find("ยอดขายสุทธิ (฿)");
  const ordersIndex = find("จำนวนออเดอร์");
  if ([dateIndex, channelIndex, saleChannelIndex, netIndex, ordersIndex].some((index) => index < 0)) {
    throw new Error("หัวตารางรายงาน GPOS เปลี่ยนไป");
  }
  const [year, month, day] = date.split("-");
  const matching = rows.filter((row) => row[dateIndex] === `${day}/${month}/${year}` && row[channelIndex] === "ทั้งหมด" && row[saleChannelIndex] === "ทั้งหมด");
  if (matching.length !== 1) throw new Error(`คาดว่า 1 แถวของ ${date} แต่พบ ${matching.length} แถว`);
  const amount = Number(String(matching[0][netIndex]).replaceAll(",", ""));
  const orders = Number(String(matching[0][ordersIndex]).replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(orders) || orders < 0) throw new Error("ยอด GPOS ไม่ใช่ตัวเลขที่ถูกต้อง");
  return { date, netSales: amount, orders };
}

module.exports = { bangkokDate, parseDailyReport };

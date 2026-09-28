(() => {
  "use strict";
  const INTERNAL_HEADERS = ["__version", "__rowNumber"];

  function library() {
    if (!globalThis.XLSX) throw new Error("ระบบ Excel ยังโหลดไม่เสร็จ กรุณาลองใหม่");
    return globalThis.XLSX;
  }

  function safeSheetName(name) {
    return String(name || "ข้อมูล").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "ข้อมูล";
  }

  function buildWorkbook(sheetName, headers, rows) {
    const XLSX = library();
    const exportHeaders = [...headers, ...INTERNAL_HEADERS];
    const matrix = [exportHeaders, ...rows.map(row => exportHeaders.map(header => row?.[header] ?? ""))];
    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(exportHeaders.length - 1)}${Math.max(matrix.length, 1)}` };
    sheet["!cols"] = exportHeaders.map((header, index) => ({
      wch: Math.min(42, Math.max(10, ...matrix.slice(0, 80).map(row => String(row[index] ?? "").length + 2), String(header).length + 2)),
      hidden: index >= headers.length
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(sheetName));
    return workbook;
  }

  function download(sheetName, headers, rows, filename) {
    library().writeFile(buildWorkbook(sheetName, headers, rows), filename, { compression: true });
  }

  function readArrayBuffer(buffer) {
    const XLSX = library();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new Error("ไฟล์ Excel ไม่มีแผ่นงาน");
    const formulas = Object.keys(sheet).filter(address => address[0] !== "!" && sheet[address]?.f);
    if (formulas.length) throw new Error("ไฟล์มีสูตรคำนวณ กรุณาแปลงสูตรเป็นค่าก่อนนำเข้า");
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  }

  globalThis.BOY_MASTER_EXCEL = { INTERNAL_HEADERS, buildWorkbook, download, readArrayBuffer };
  if (typeof module !== "undefined" && module.exports) module.exports = globalThis.BOY_MASTER_EXCEL;
})();

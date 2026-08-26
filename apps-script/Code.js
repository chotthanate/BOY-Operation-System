const CONFIG = {
  branchName: 'ทาวน่า',
  bigcBranchName: 'บิ๊กซีพัทยากลาง',
  branchAliases: {
    tawana: ['ทาวน่า', 'สาขา 1'],
    bigc: ['บิ๊กซีพัทยากลาง', 'BigC', 'บิ๊กซี']
  },
  sourceName: 'BOY Operation System:Tawana',
  spreadsheets: {
    master: '11LqJbnCQQvNIV8tNgoh2x_JGLZWofUaxrpzHUp6U-po',
    transactions: '1HGipIF8DIJO5zZhugXS96k909pF-EsSpeup41Y82-aQ',
    costing: '1d1RZDzCT8CI1Nmow-JiRYZjfZuAevkYDITpo0ynpWzk',
    reports: '1duSHa5Pzjyw9kAstn_UPu1PlXQWkVD6ukFVf7zXHnqc'
  },
  sheets: {
    database: 'Database',
    units: 'หน่วยและการแปลง',
    expenseCategories: 'ประเภทค่าใช้จ่าย',
    income: 'รายรับ',
    expenses: 'รายจ่าย',
    withdrawals: 'ประวัติเบิกของ',
    dailyCache: 'แคชรายวัน',
    leave: 'การลาพนักงาน',
    salary: 'สรุปเงินเดือน',
    bigcOrderMenu: 'รายการเบิกของ',
    masterBranches: 'M_สาขา',
    masterItems: 'M_สินค้า',
    masterUnits: 'M_หน่วย',
    masterItemUnits: 'M_หน่วยสินค้า',
    masterExpenseItems: 'M_รายการค่าใช้จ่าย',
    masterSuppliers: 'M_ผู้ขาย',
    masterItemSuppliers: 'M_ผู้ขายสินค้า',
    masterEmployees: 'M_พนักงาน',
    transactionsV2: 'T_Transactions',
    transactionLinesV2: 'T_รายละเอียด',
    paymentsV2: 'T_การชำระเงิน',
    stockMovementsV2: 'T_สต็อกเคลื่อนไหว',
    leavesV2: 'T_การลา',
    payrollV2: 'T_เงินเดือน',
    attachmentsV2: 'T_ไฟล์แนบ',
    statusHistoryV2: 'T_ประวัติสถานะ'
  }
};

const TRANSACTION_V2_HEADERS = {
  transactions: ['transaction_id', 'วันที่รายการ', 'เวลารายการ', 'ประเภทธุรกรรม', 'รูปแบบการบันทึก', 'branch_id', 'supplier_id', 'related_employee_id', 'expense_item_id', 'parent_transaction_id', 'เลขอ้างอิงภายนอก', 'ยอดก่อนส่วนลด', 'ส่วนลด', 'ภาษี', 'ยอดสุทธิ', 'ช่องทางชำระเงิน', 'กระทบสต็อก', 'สถานะ', 'หมายเหตุ', 'แหล่งที่มา', 'created_by', 'created_at', 'updated_by', 'updated_at', 'เหตุผลยกเลิก'],
  lines: ['line_id', 'transaction_id', 'ลำดับ', 'item_id', 'expense_item_id', 'รายละเอียด', 'จำนวน', 'unit_id', 'conversion_to_base', 'จำนวนหน่วยฐาน', 'ราคาต่อหน่วย', 'ส่วนลด', 'ภาษี', 'ยอดรวม', 'lot_no', 'วันผลิต', 'วันหมดอายุ', 'หมายเหตุ', 'created_at'],
  payments: ['payment_id', 'transaction_id', 'ช่องทางชำระเงิน', 'จำนวนเงิน', 'เลขอ้างอิง', 'วันที่ชำระ', 'สถานะ', 'employee_id', 'created_at', 'หมายเหตุ'],
  stockMovements: ['movement_id', 'transaction_id', 'line_id', 'วันเวลาเคลื่อนไหว', 'branch_id', 'item_id', 'ประเภทเคลื่อนไหว', 'จำนวนเปลี่ยนแปลงหน่วยฐาน', 'base_unit_id', 'ต้นทุนต่อหน่วยฐาน', 'มูลค่ารวม', 'lot_no', 'วันหมดอายุ', 'from_branch_id', 'to_branch_id', 'created_by', 'created_at', 'หมายเหตุ'],
  leaves: ['leave_id', 'employee_id', 'branch_id', 'ประเภทลา', 'วันที่เริ่ม', 'วันที่สิ้นสุด', 'เวลาเริ่ม', 'เวลาสิ้นสุด', 'ชั่วโมงลา', 'จำนวนวันลา', 'สถานะ', 'approved_by', 'วันที่อนุมัติ', 'created_by', 'created_at', 'หมายเหตุ'],
  payroll: ['payroll_id', 'รอบเงินเดือน', 'branch_id', 'employee_id', 'วันทำงาน', 'ชั่วโมงทำงาน', 'ค่าแรงฐาน', 'ค่าล่วงเวลา', 'เบี้ยขยัน', 'โบนัส/พิเศษ', 'รายได้อื่น', 'หักลา', 'หักขาด/สาย', 'หักอื่น', 'ประกันสังคม', 'เงินเดือนสุทธิ', 'สถานะ', 'วันที่จ่าย', 'ช่องทางชำระเงิน', 'approved_by', 'created_at', 'หมายเหตุ'],
  history: ['history_id', 'entity_type', 'entity_id', 'สถานะเดิม', 'สถานะใหม่', 'changed_by', 'changed_at', 'เหตุผล', 'ข้อมูลเพิ่มเติม']
};

const PREPRODUCTION_RESET_TABS = [
  'รายรับ',
  'แคชรายวัน',
  'รายจ่าย',
  'ประวัติเบิกของ',
  'การลาพนักงาน',
  'T_Transactions',
  'T_รายละเอียด',
  'T_การชำระเงิน',
  'T_สต็อกเคลื่อนไหว',
  'T_ตรวจนับสต็อก',
  'T_การลา',
  'T_เงินเดือน',
  'T_ไฟล์แนบ',
  'T_ประวัติสถานะ'
];

const PREPRODUCTION_RESET_ARM_PROPERTY = 'preproduction_reset_armed_at';
const PREPRODUCTION_RESET_ARM_MINUTES = 10;

function doGet() {
  return json_({
    status: 'success',
    service: 'BOY Operation System API',
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = String(payload.action || '').trim();
    let result;

    switch (action) {
      case 'shared_loadDB':
        result = handleSharedLoadDb_();
        break;
      case 'pullItems':
        result = handlePullItems_();
        break;
      case 'database_getRows':
        result = { status: 'success', rows: getDatabaseRows_() };
        break;
      case 'database_saveItem':
        result = handleDatabaseSaveItem_(payload.item || {});
        break;
      case 'database_setActive':
        result = handleDatabaseSetActive_(payload.rowNumber, payload.active);
        break;
      case 'database_syncToStock':
        result = {
          status: 'success',
          synced: 0,
          message: 'ระบบสต็อกกลางจะเชื่อมในเฟสถัดไป'
        };
        break;
      case 'loadData':
        result = handleLoadData_(payload.date);
        break;
      case 'autoSave':
        result = handleAutoSave_(payload.date, payload.data);
        break;
      case 'submit':
        result = handleSubmit_(payload.date, payload.data);
        break;
      case 'unlockDate':
        result = handleUnlockDate_(payload.date);
        break;
      case 'saveMultipleLeaves':
        result = handleSaveMultipleLeaves_(payload.date, payload.leaves || []);
        break;
      case 'getLeavesByDate':
        result = handleGetLeavesByDate_(payload.date);
        break;
      case 'cancelLeaveRecord':
        result = handleCancelLeaveRecord_(payload.date, payload.rowNumber);
        break;
      case 'calculateSalary':
        result = handleCalculateSalary_(payload.month, payload.year, payload.staffList || []);
        break;
      case 'syncCloud':
        result = { status: 'success', message: 'ข้อมูล Database ถูกอ่านจาก BOY_Master โดยตรงแล้ว' };
        break;
      case 'bigcExpenseLoadData':
        result = handleBigcExpenseLoadData_(payload.date);
        break;
      case 'bigcExpenseAutoSave':
        result = handleBigcExpenseAutoSave_(payload.date, payload.data);
        break;
      case 'bigcExpenseSubmit':
        result = handleBigcExpenseSubmit_(payload.date, payload.data);
        break;
      case 'bigcExpenseUnlockDate':
        result = handleBigcExpenseUnlockDate_(payload.date);
        break;
      case 'bigcOrderLoadDB':
        result = handleBigcOrderLoadDb_();
        break;
      case 'bigcOrderLoadDraft':
        result = handleBigcOrderLoadDraft_();
        break;
      case 'bigcOrderAutoSave':
        result = handleBigcOrderAutoSave_(payload.draftData || {});
        break;
      case 'bigcOrderSaveDB':
        result = handleBigcOrderSaveDb_(payload.database || {});
        break;
      case 'bigcOrderRebuildMenuFromMaster':
        result = handleBigcOrderRebuildMenuFromMaster_();
        break;
      case 'bigcOrderSubmitOrder':
        result = handleBigcOrderSubmitOrder_(payload.date, payload.qtyData || {}, payload.categories || {});
        break;
      case 'bigcOrderReceive':
        result = handleBigcOrderReceive_(payload.date, payload.qtyData || {});
        break;
      case 'bigcOrderReturn':
        result = handleBigcOrderReturn_(payload.date, payload.qtyData || {}, payload.cash, payload.transfer);
        break;
      case 'dashboardGetMonthlySummary':
        result = handleDashboardGetMonthlySummary_(payload);
        break;
      case 'systemHealthCheck':
        result = handleSystemHealthCheck_();
        break;
      case 'systemVerifyFlow':
        result = handleSystemVerifyFlow_(payload.date, payload.flow);
        break;
      default:
        result = { status: 'error', message: 'Action ไม่ถูกต้อง: ' + action };
    }

    return json_(result);
  } catch (err) {
    return json_({
      status: 'error',
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : ''
    });
  }
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('ไม่มีข้อมูลส่งมา');
  }
  return JSON.parse(e.postData.contents);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ss_(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}

function sheet_(spreadsheetId, sheetName) {
  const sh = ss_(spreadsheetId).getSheetByName(sheetName);
  if (!sh) throw new Error('ไม่พบชีท: ' + sheetName);
  return sh;
}

function ensureSheet_(spreadsheetId, sheetName, headers) {
  const ss = ss_(spreadsheetId);
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  if (headers && headers.length && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function values_(spreadsheetId, sheetName) {
  const sh = sheet_(spreadsheetId, sheetName);
  const range = sh.getDataRange();
  return range.getNumRows() > 0 ? range.getValues() : [];
}

function tableValues_(spreadsheetId, sheetName, columnCount) {
  const sh = sheet_(spreadsheetId, sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow < 1) return [];
  return sh.getRange(1, 1, lastRow, columnCount).getValues();
}

function displayValues_(spreadsheetId, sheetName) {
  const sh = sheet_(spreadsheetId, sheetName);
  const range = sh.getDataRange();
  return range.getNumRows() > 0 ? range.getDisplayValues() : [];
}

function appendRows_(sheet, rows) {
  if (!rows || rows.length === 0) return;
  // Column A is the required key/date column in every table written here.
  // Use it to find the real end of data because checkboxes or formulas in
  // other columns can make getLastRow() point thousands of rows too far down.
  const maxRows = sheet.getMaxRows();
  const keyCell = sheet.getRange(maxRows, 1).getNextDataCell(SpreadsheetApp.Direction.UP);
  const lastDataRow = isBlank_(keyCell.getValue()) ? 0 : keyCell.getRow();
  sheet.getRange(lastDataRow + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function deleteRowsByPredicate_(sheet, predicate) {
  const data = sheet.getDataRange().getValues();
  let deleted = 0;
  for (let r = data.length - 1; r >= 1; r--) {
    if (predicate(data[r], r + 1)) {
      sheet.deleteRow(r + 1);
      deleted++;
    }
  }
  return deleted;
}

function toBool_(value, defaultValue) {
  if (value === '' || value === null || value === undefined) return defaultValue;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toUpperCase();
  if (text === 'TRUE' || text === 'YES' || text === '1') return true;
  if (text === 'FALSE' || text === 'NO' || text === '0') return false;
  return defaultValue;
}

function toNumber_(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
}

function isBlank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function parseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const text = String(value || '').trim();
  if (!text) throw new Error('ไม่มีวันที่');

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return parsed;
  throw new Error('รูปแบบวันที่ไม่ถูกต้อง: ' + text);
}

function dateKey_(value) {
  const d = parseDate_(value);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function todayKey_() {
  return Utilities.formatDate(now_(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function relativeDateKey_(dayOffset) {
  const d = now_();
  d.setDate(d.getDate() + Number(dayOffset || 0));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function monthKey_(year, month) {
  return String(year) + '-' + String(month).padStart(2, '0');
}

function now_() {
  return new Date();
}

function lock_() {
  return LockService.getScriptLock();
}

function propKey_(prefix, date) {
  return prefix + ':' + CONFIG.branchName + ':' + dateKey_(date);
}

function scopedPropKey_(prefix, scope, date) {
  return prefix + ':' + scope + ':' + dateKey_(date);
}

function makeId_(prefix, date, suffix) {
  return [
    prefix,
    dateKey_(date).replace(/-/g, ''),
    String(suffix || '').replace(/[^A-Za-z0-9ก-๙_-]/g, ''),
    Utilities.getUuid().slice(0, 8)
  ].filter(Boolean).join('-');
}

function tableObjects_(spreadsheetId, sheetName) {
  const rows = values_(spreadsheetId, sheetName);
  if (!rows.length) return [];
  const headers = rows[0].map(function(value) { return normalizeText_(value); });
  return rows.slice(1).map(function(row, index) {
    const obj = { __rowNumber: index + 2 };
    headers.forEach(function(header, columnIndex) {
      if (header) obj[header] = row[columnIndex];
    });
    return obj;
  });
}

function lookupKey_(value) {
  return normalizeText_(value).toLowerCase();
}

function normalizedSheet_(sheetName, headers) {
  const sh = ensureSheet_(CONFIG.spreadsheets.transactions, sheetName, headers);
  const actual = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  for (let i = 0; i < headers.length; i++) {
    if (normalizeText_(actual[i]) !== headers[i]) {
      throw new Error('หัวตาราง ' + sheetName + ' ไม่ตรงที่คอลัมน์ ' + (i + 1));
    }
  }
  return sh;
}

function inspectSheetSchema_(spreadsheetId, sheetName, headers) {
  const sh = ss_(spreadsheetId).getSheetByName(sheetName);
  if (!sh) return { name: sheetName, ok: false, rows: 0, message: 'ไม่พบแท็บ' };
  const lastRow = sh.getLastRow();
  const dataRows = lastRow < 2 ? 0 : sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues().reduce(function(total, row) {
    return total + (normalizeText_(row[0]) ? 1 : 0);
  }, 0);
  if (!headers || !headers.length) {
    return { name: sheetName, ok: true, rows: dataRows, message: 'พบแท็บ' };
  }
  const actual = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const mismatches = [];
  headers.forEach(function(header, index) {
    if (normalizeText_(actual[index]) !== header) mismatches.push(index + 1);
  });
  return {
    name: sheetName,
    ok: mismatches.length === 0,
    rows: dataRows,
    message: mismatches.length ? 'หัวตารางไม่ตรงที่คอลัมน์ ' + mismatches.join(', ') : 'พร้อมใช้งาน'
  };
}

function handleSystemHealthCheck_() {
  const tables = [
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.transactionsV2, TRANSACTION_V2_HEADERS.transactions),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.transactionLinesV2, TRANSACTION_V2_HEADERS.lines),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.paymentsV2, TRANSACTION_V2_HEADERS.payments),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.stockMovementsV2, TRANSACTION_V2_HEADERS.stockMovements),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.leavesV2, TRANSACTION_V2_HEADERS.leaves),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.payrollV2, TRANSACTION_V2_HEADERS.payroll),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, 'T_ตรวจนับสต็อก'),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.attachmentsV2),
    inspectSheetSchema_(CONFIG.spreadsheets.transactions, CONFIG.sheets.statusHistoryV2, TRANSACTION_V2_HEADERS.history)
  ];
  const masterTables = [
    CONFIG.sheets.masterBranches,
    CONFIG.sheets.masterItems,
    CONFIG.sheets.masterUnits,
    CONFIG.sheets.masterItemUnits,
    CONFIG.sheets.masterExpenseItems,
    CONFIG.sheets.masterSuppliers,
    CONFIG.sheets.masterItemSuppliers,
    CONFIG.sheets.masterEmployees
  ].map(function(sheetName) {
    return inspectSheetSchema_(CONFIG.spreadsheets.master, sheetName);
  });
  return {
    status: 'success',
    ok: tables.concat(masterTables).every(function(item) { return item.ok; }),
    checkedAt: now_(),
    tables: tables,
    masterTables: masterTables
  };
}

function preProductionResetSummary_() {
  const ss = ss_(CONFIG.spreadsheets.transactions);
  return PREPRODUCTION_RESET_TABS.map(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return { name: sheetName, exists: false, rows: 0 };
    const lastRow = sh.getLastRow();
    const rows = lastRow < 2 ? 0 : sh.getRange(2, 1, lastRow - 1, 1).getDisplayValues().reduce(function(total, row) {
      return total + (normalizeText_(row[0]) ? 1 : 0);
    }, 0);
    return { name: sheetName, exists: true, rows: rows };
  });
}

function previewPreProductionReset() {
  const result = {
    status: 'preview_only',
    spreadsheet: 'BOY_Transactions',
    tables: preProductionResetSummary_(),
    note: 'ยังไม่มีข้อมูลถูกลบ ให้รัน armPreProductionReset แล้วจึงรัน runPreProductionReset ภายใน 10 นาที'
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function armPreProductionReset() {
  const armedAt = now_();
  PropertiesService.getScriptProperties().setProperty(PREPRODUCTION_RESET_ARM_PROPERTY, armedAt.toISOString());
  const result = {
    status: 'armed',
    armedAt: armedAt,
    expiresInMinutes: PREPRODUCTION_RESET_ARM_MINUTES,
    nextStep: 'ตรวจผล preview แล้วรัน runPreProductionReset ภายใน 10 นาที'
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function copyTransactionWorkbookForReset_() {
  const source = ss_(CONFIG.spreadsheets.transactions);
  const timestamp = Utilities.formatDate(now_(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const backup = SpreadsheetApp.create('BOY_Transactions_PREPRODUCTION_BACKUP_' + timestamp);
  const defaultSheet = backup.getSheets()[0];
  source.getSheets().forEach(function(sourceSheet) {
    sourceSheet.copyTo(backup).setName(sourceSheet.getName());
  });
  backup.deleteSheet(defaultSheet);
  return { id: backup.getId(), url: backup.getUrl(), name: backup.getName() };
}

function clearPreProductionProperties_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  let removed = 0;
  Object.keys(all).forEach(function(key) {
    if (key.indexOf('draft:') === 0 || key.indexOf('submitted:') === 0 || key.indexOf('order:') === 0 || key === PREPRODUCTION_RESET_ARM_PROPERTY) {
      props.deleteProperty(key);
      removed++;
    }
  });
  return removed;
}

function runPreProductionReset() {
  const props = PropertiesService.getScriptProperties();
  const armedText = props.getProperty(PREPRODUCTION_RESET_ARM_PROPERTY);
  const armedAt = armedText ? new Date(armedText) : null;
  const ageMs = armedAt && !isNaN(armedAt.getTime()) ? now_().getTime() - armedAt.getTime() : Infinity;
  if (ageMs < 0 || ageMs > PREPRODUCTION_RESET_ARM_MINUTES * 60 * 1000) {
    throw new Error('Reset ยังไม่ได้เปิดใช้งานหรือหมดเวลา ให้รัน armPreProductionReset ก่อน');
  }

  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const before = preProductionResetSummary_();
    const backup = copyTransactionWorkbookForReset_();
    const ss = ss_(CONFIG.spreadsheets.transactions);
    PREPRODUCTION_RESET_TABS.forEach(function(sheetName) {
      const sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
    });
    const removedProperties = clearPreProductionProperties_();
    const result = {
      status: 'reset_complete',
      backup: backup,
      before: before,
      after: preProductionResetSummary_(),
      removedScriptProperties: removedProperties,
      masterWasChanged: false
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    scriptLock.releaseLock();
  }
}

function systemFlowRules_(flow) {
  const rules = {
    tawana: [{ source: CONFIG.sourceName }],
    bigcExpense: [{ source: 'BOY Operation System:BigC Expense', type: 'รายจ่าย' }],
    bigcOrder: [{ source: 'BOY Operation System:BigC Order', type: 'สั่งซื้อ' }],
    bigcReceive: [{ source: 'BOY Operation System:BigC Receive', type: 'รับสินค้า' }],
    bigcReturn: [
      { source: 'BOY Operation System:BigC Return', type: 'โอนสินค้า' },
      { source: 'BOY Operation System:BigC Order', type: 'รายรับ' }
    ]
  };
  return rules[normalizeText_(flow)] || [];
}

function countRowsByTransactionId_(rows, transactionId, transactionIdColumn) {
  return rows.reduce(function(total, row) {
    return total + (normalizeText_(row[transactionIdColumn]) === transactionId ? 1 : 0);
  }, 0);
}

function handleSystemVerifyFlow_(date, flow) {
  const dateObj = parseDate_(date);
  const rules = systemFlowRules_(flow);
  if (!rules.length) throw new Error('ไม่รู้จัก flow ที่ต้องการตรวจ');

  const transactions = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.transactionsV2).slice(1);
  const lines = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.transactionLinesV2).slice(1);
  const payments = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.paymentsV2).slice(1);
  const movements = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.stockMovementsV2).slice(1);
  const history = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.statusHistoryV2).slice(1);
  const matches = transactions.filter(function(row) {
    if (!rowDateMatches_(row[1], dateObj)) return false;
    const source = normalizeText_(row[19]);
    const type = normalizeText_(row[3]);
    return rules.some(function(rule) {
      return source === rule.source && (!rule.type || type === rule.type);
    });
  }).slice(-20).reverse().map(function(row) {
    const transactionId = normalizeText_(row[0]);
    const type = normalizeText_(row[3]);
    const status = normalizeText_(row[17]);
    const affectsStock = toBool_(row[16], false);
    const lineCount = countRowsByTransactionId_(lines, transactionId, 1);
    const paymentCount = countRowsByTransactionId_(payments, transactionId, 1);
    const movementCount = countRowsByTransactionId_(movements, transactionId, 1);
    const historyCount = history.reduce(function(total, historyRow) {
      return total + (normalizeText_(historyRow[1]) === 'ธุรกรรม' && normalizeText_(historyRow[2]) === transactionId ? 1 : 0);
    }, 0);
    const checks = [];
    if (['รายจ่าย', 'สั่งซื้อ', 'รับสินค้า', 'เบิกสินค้า', 'คืนผู้ขาย', 'โอนสินค้า', 'ขายสินค้า'].indexOf(type) >= 0 && lineCount === 0) {
      checks.push('ไม่มีรายละเอียดรายการ');
    }
    if (type === 'รายรับ' && toNumber_(row[14]) !== 0 && paymentCount === 0) {
      checks.push('ไม่มีข้อมูลการชำระเงิน');
    }
    if (affectsStock && status !== 'รอรับสินค้า' && status !== 'ยกเลิก' && movementCount === 0) {
      checks.push('ไม่มีการเคลื่อนไหวสต็อก');
    }
    if (historyCount === 0) checks.push('ไม่มีประวัติสถานะ');
    return {
      transactionId: transactionId,
      type: type,
      status: status,
      source: normalizeText_(row[19]),
      parentTransactionId: normalizeText_(row[9]),
      lineCount: lineCount,
      paymentCount: paymentCount,
      movementCount: movementCount,
      historyCount: historyCount,
      ok: checks.length === 0,
      checks: checks
    };
  });

  return {
    status: 'success',
    ok: matches.length > 0 && matches.every(function(item) { return item.ok; }),
    date: dateKey_(dateObj),
    flow: flow,
    found: matches.length,
    transactions: matches,
    message: matches.length ? 'ตรวจรายการล่าสุดแล้ว' : 'ยังไม่พบรายการของ flow นี้ในวันที่เลือก'
  };
}

function normalizedMasterLookups_() {
  const branches = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterBranches);
  const items = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterItems);
  const units = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterUnits);
  const itemUnits = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterItemUnits);
  const expenseItems = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterExpenseItems);
  const suppliers = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterSuppliers);
  const itemSuppliers = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterItemSuppliers);
  const employees = tableObjects_(CONFIG.spreadsheets.master, CONFIG.sheets.masterEmployees);
  const result = {
    branchesByName: {},
    itemsByName: {},
    itemsById: {},
    unitsByName: {},
    unitsById: {},
    itemUnitsByKey: {},
    expenseItemsByName: {},
    expenseItemsByItemId: {},
    suppliersByName: {},
    suppliersById: {},
    supplierIdsByItemId: {},
    employeesByName: {}
  };

  branches.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    [row.branch_id, row['รหัสสาขา'], row['ชื่อสาขา']].forEach(function(value) {
      if (!isBlank_(value)) result.branchesByName[lookupKey_(value)] = row;
    });
  });

  items.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    result.itemsById[normalizeText_(row.item_id)] = row;
    [row['ชื่อสินค้า'], row['ชื่อเดิม']].forEach(function(value) {
      if (!isBlank_(value)) result.itemsByName[lookupKey_(value)] = row;
    });
  });

  units.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    result.unitsById[normalizeText_(row.unit_id)] = row;
    [row['ชื่อหน่วย'], row['สัญลักษณ์']].forEach(function(value) {
      if (!isBlank_(value)) result.unitsByName[lookupKey_(value)] = row;
    });
  });

  itemUnits.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    const itemId = normalizeText_(row.item_id);
    const unitId = normalizeText_(row.unit_id);
    const unit = result.unitsById[unitId];
    if (!itemId || !unit) return;
    [unit['ชื่อหน่วย'], unit['สัญลักษณ์'], row['หน่วยเดิม']].forEach(function(value) {
      if (!isBlank_(value)) result.itemUnitsByKey[itemId + '|' + lookupKey_(value)] = row;
    });
  });

  expenseItems.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    const name = lookupKey_(row['ชื่อรายการค่าใช้จ่าย']);
    const itemId = normalizeText_(row.item_id);
    if (name) result.expenseItemsByName[name] = row;
    if (itemId) result.expenseItemsByItemId[itemId] = row;
  });

  suppliers.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    const supplierId = normalizeText_(row.supplier_id);
    if (!supplierId) return;
    result.suppliersById[supplierId] = row;
    [row.supplier_id, row['รหัสผู้ขาย'], row['ชื่อผู้ขาย']].forEach(function(value) {
      if (!isBlank_(value)) result.suppliersByName[lookupKey_(value)] = row;
    });
  });

  itemSuppliers.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    const itemId = normalizeText_(row.item_id);
    const supplierId = normalizeText_(row.supplier_id);
    if (!itemId || !supplierId || !result.suppliersById[supplierId]) return;
    if (!result.supplierIdsByItemId[itemId]) result.supplierIdsByItemId[itemId] = [];
    if (result.supplierIdsByItemId[itemId].indexOf(supplierId) === -1) {
      result.supplierIdsByItemId[itemId].push(supplierId);
    }
  });

  employees.forEach(function(row) {
    if (!toBool_(row['เปิดใช้งาน'], true)) return;
    const fullName = [normalizeText_(row['ชื่อจริง']), normalizeText_(row['นามสกุล'])].filter(Boolean).join(' ');
    [row.employee_id, row['รหัสพนักงาน'], row['ชื่อเล่น'], fullName].forEach(function(value) {
      if (!isBlank_(value)) result.employeesByName[lookupKey_(value)] = row;
    });
  });

  return result;
}

function normalizedSupplierInfo_(lookups, supplierName) {
  const supplier = lookups.suppliersByName[lookupKey_(supplierName)] || null;
  return {
    supplier: supplier,
    supplierId: supplier ? normalizeText_(supplier.supplier_id) : '',
    supplierName: supplier ? normalizeText_(supplier['ชื่อผู้ขาย']) : normalizeText_(supplierName)
  };
}

function normalizedBranchId_(lookups, branchName) {
  const row = lookups.branchesByName[lookupKey_(canonicalBranch_(branchName))] ||
    lookups.branchesByName[lookupKey_(branchName)];
  return row ? normalizeText_(row.branch_id) : '';
}

function normalizedItemInfo_(lookups, itemName, unitName) {
  const item = lookups.itemsByName[lookupKey_(itemName)] || null;
  if (!item) {
    return { item: null, itemId: '', unitId: '', baseUnitId: '', conversion: 1, baseQtyFactor: 1, trackStock: false };
  }
  const itemId = normalizeText_(item.item_id);
  const baseUnitId = normalizeText_(item.base_unit_id);
  let unitId = '';
  let conversion = 1;
  const itemUnit = lookups.itemUnitsByKey[itemId + '|' + lookupKey_(unitName)];
  if (itemUnit) {
    unitId = normalizeText_(itemUnit.unit_id);
    conversion = toNumber_(itemUnit['อัตราแปลงเป็นหน่วยฐาน']) || 1;
  } else {
    const unit = lookups.unitsByName[lookupKey_(unitName)];
    unitId = unit ? normalizeText_(unit.unit_id) : baseUnitId;
  }
  return {
    item: item,
    itemId: itemId,
    unitId: unitId || baseUnitId,
    baseUnitId: baseUnitId,
    conversion: conversion,
    baseQtyFactor: conversion,
    trackStock: toBool_(item['ติดตามสต็อก'], false)
  };
}

function normalizedExpenseInfo_(lookups, itemName, itemId) {
  return lookups.expenseItemsByName[lookupKey_(itemName)] ||
    lookups.expenseItemsByItemId[normalizeText_(itemId)] || null;
}

function normalizedHistoryRow_(entityType, entityId, oldStatus, newStatus, reason, details, changedAt) {
  const stamp = changedAt || now_();
  return [
    makeId_('HIST', stamp, entityId),
    entityType,
    entityId,
    oldStatus || '',
    newStatus || '',
    'WEB',
    stamp,
    reason || '',
    details || ''
  ];
}

function appendNormalizedRows_(batch) {
  batch = batch || {};
  if (batch.transactions && batch.transactions.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.transactionsV2, TRANSACTION_V2_HEADERS.transactions), batch.transactions);
  }
  if (batch.lines && batch.lines.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.transactionLinesV2, TRANSACTION_V2_HEADERS.lines), batch.lines);
  }
  if (batch.payments && batch.payments.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.paymentsV2, TRANSACTION_V2_HEADERS.payments), batch.payments);
  }
  if (batch.stockMovements && batch.stockMovements.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.stockMovementsV2, TRANSACTION_V2_HEADERS.stockMovements), batch.stockMovements);
  }
  if (batch.leaves && batch.leaves.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.leavesV2, TRANSACTION_V2_HEADERS.leaves), batch.leaves);
  }
  if (batch.payroll && batch.payroll.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.payrollV2, TRANSACTION_V2_HEADERS.payroll), batch.payroll);
  }
  if (batch.history && batch.history.length) {
    appendRows_(normalizedSheet_(CONFIG.sheets.statusHistoryV2, TRANSACTION_V2_HEADERS.history), batch.history);
  }
}

function cancelNormalizedTransactions_(date, branchId, sourceName, transactionType, reason) {
  const sh = normalizedSheet_(CONFIG.sheets.transactionsV2, TRANSACTION_V2_HEADERS.transactions);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRANSACTION_V2_HEADERS.transactions.length).getValues();
  const changedAt = now_();
  const history = [];
  const canceledTransactionIds = [];
  rows.forEach(function(row, index) {
    if (!rowDateMatches_(row[1], date)) return;
    if (normalizeText_(row[5]) !== normalizeText_(branchId)) return;
    if (normalizeText_(row[19]) !== normalizeText_(sourceName)) return;
    if (transactionType && normalizeText_(row[3]) !== transactionType) return;
    if (normalizeText_(row[17]) === 'ยกเลิก') return;
    const oldStatus = normalizeText_(row[17]);
    row[17] = 'ยกเลิก';
    row[22] = 'WEB';
    row[23] = changedAt;
    row[24] = reason || 'แทนที่ด้วยการบันทึกใหม่';
    sh.getRange(index + 2, 1, 1, row.length).setValues([row]);
    canceledTransactionIds.push(normalizeText_(row[0]));
    history.push(normalizedHistoryRow_('ธุรกรรม', normalizeText_(row[0]), oldStatus, 'ยกเลิก', row[24], sourceName, changedAt));
  });
  reverseStockMovementsV2_(canceledTransactionIds, reason || 'ย้อนกลับจากการยกเลิก', changedAt);
  return history;
}

function reverseStockMovementsV2_(transactionIds, reason, changedAt) {
  if (!transactionIds || !transactionIds.length) return 0;
  const wanted = {};
  transactionIds.forEach(function(id) { wanted[normalizeText_(id)] = true; });
  const sh = normalizedSheet_(CONFIG.sheets.stockMovementsV2, TRANSACTION_V2_HEADERS.stockMovements);
  if (sh.getLastRow() < 2) return 0;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRANSACTION_V2_HEADERS.stockMovements.length).getValues();
  const stamp = changedAt || now_();
  const reversals = [];
  rows.forEach(function(row, index) {
    const transactionId = normalizeText_(row[1]);
    if (!wanted[transactionId]) return;
    const qty = toNumber_(row[7]);
    if (!qty) return;
    reversals.push([
      makeId_('REV-MOV', stamp, String(index + 1)), transactionId, row[2], stamp, row[4], row[5],
      qty > 0 ? 'ปรับลด' : 'ปรับเพิ่ม', -qty, row[8], row[9], -toNumber_(row[10]), row[11], row[12],
      row[13], row[14], 'WEB', stamp, reason
    ]);
  });
  appendRows_(sh, reversals);
  return reversals.length;
}

function writeExpenseTransactionsV2_(date, data, options) {
  const lookups = normalizedMasterLookups_();
  const branchId = normalizedBranchId_(lookups, options.branchName);
  if (!branchId) throw new Error('ไม่พบ branch_id สำหรับ ' + options.branchName + ' ใน BOY_Master');
  const dateObj = parseDate_(date);
  const createdAt = now_();
  const batch = { transactions: [], lines: [], history: [] };
  batch.history = cancelNormalizedTransactions_(dateObj, branchId, options.sourceName, 'รายจ่าย', 'บันทึกรายจ่ายใหม่ของวันเดียวกัน');
  const expenses = Array.isArray(data && data.exp) ? data.exp : [];

  expenses.forEach(function(entry, index) {
    const name = normalizeText_(entry.i);
    const qty = toNumber_(entry.q);
    const unitName = normalizeText_(entry.u);
    const amount = toNumber_(entry.p);
    const note = normalizeText_(entry.n);
    const supplierName = normalizeText_(entry.s);
    const supplierInfo = normalizedSupplierInfo_(lookups, supplierName);
    if (!name && qty === 0 && !unitName && amount === 0 && !note && !supplierName) return;

    const itemInfo = normalizedItemInfo_(lookups, name, unitName);
    const expenseInfo = normalizedExpenseInfo_(lookups, name, itemInfo.itemId);
    const expenseItemId = expenseInfo ? normalizeText_(expenseInfo.expense_item_id) : '';
    const baseQty = qty ? qty * itemInfo.conversion : '';
    const affectsStock = !!(itemInfo.itemId && itemInfo.trackStock && qty);
    const needsReview = !expenseItemId && !itemInfo.itemId;
    const status = affectsStock ? 'รอรับสินค้า' : (needsReview ? 'รอตรวจสอบ' : 'ยืนยันแล้ว');
    const mode = qty || unitName || itemInfo.itemId ? 'รายละเอียด' : 'บันทึกเร็ว';
    const transactionId = makeId_(options.idPrefix + '-TXN', dateObj, String(index + 1));
    const lineId = makeId_('LINE', dateObj, String(index + 1));
    const unitPrice = qty ? amount / qty : '';
    const categoryNote = [normalizeText_(entry.m), normalizeText_(entry.t)].filter(Boolean).join(' / ');
    const combinedNote = [supplierName ? 'ผู้ขาย: ' + supplierName : '', note, categoryNote].filter(Boolean).join(' | ');

    batch.transactions.push([
      transactionId, dateObj, createdAt, 'รายจ่าย', mode, branchId, supplierInfo.supplierId, '', expenseItemId, '',
      options.sourceName + ':' + dateKey_(dateObj) + ':' + String(index + 1), amount || '', '', '', amount || '', '',
      affectsStock, status, combinedNote, options.sourceName, 'WEB', createdAt, '', '', ''
    ]);
    batch.lines.push([
      lineId, transactionId, index + 1, itemInfo.itemId, expenseItemId, name || 'ไม่ระบุรายการ', qty || '', itemInfo.unitId,
      itemInfo.conversion || 1, baseQty, unitPrice, '', '', amount || '', '', '', '', note, createdAt
    ]);
    batch.history.push(normalizedHistoryRow_('ธุรกรรม', transactionId, '', status, 'สร้างรายการ', options.sourceName, createdAt));
  });

  appendNormalizedRows_(batch);
  return batch.transactions.length;
}

function writeIncomeTransactionsV2_(date, branchName, sourceName, idPrefix, entries) {
  const lookups = normalizedMasterLookups_();
  const branchId = normalizedBranchId_(lookups, branchName);
  if (!branchId) throw new Error('ไม่พบ branch_id สำหรับ ' + branchName + ' ใน BOY_Master');
  const dateObj = parseDate_(date);
  const createdAt = now_();
  const batch = { transactions: [], payments: [], history: [] };
  batch.history = cancelNormalizedTransactions_(dateObj, branchId, sourceName, 'รายรับ', 'บันทึกรายรับใหม่ของวันเดียวกัน');

  (entries || []).forEach(function(entry, index) {
    const amount = toNumber_(entry.amount);
    const note = normalizeText_(entry.note);
    if (amount === 0 && !note) return;
    const transactionId = makeId_(idPrefix + '-TXN', dateObj, String(index + 1));
    const paymentMethod = normalizeText_(entry.paymentMethod) || 'อื่นๆ';
    batch.transactions.push([
      transactionId, dateObj, createdAt, 'รายรับ', 'บันทึกเร็ว', branchId, '', '', '', '',
      sourceName + ':' + dateKey_(dateObj) + ':' + String(index + 1), amount || '', '', '', amount || '', paymentMethod,
      false, 'ยืนยันแล้ว', note, sourceName, 'WEB', createdAt, '', '', ''
    ]);
    if (amount) {
      batch.payments.push([
        makeId_('PAY', dateObj, String(index + 1)), transactionId, paymentMethod, amount, '', createdAt,
        'ชำระแล้ว', '', createdAt, note
      ]);
    }
    batch.history.push(normalizedHistoryRow_('ธุรกรรม', transactionId, '', 'ยืนยันแล้ว', 'สร้างรายการ', sourceName, createdAt));
  });

  appendNormalizedRows_(batch);
  return batch.transactions.length;
}

function latestNormalizedTransactionId_(date, branchId, transactionType, sourceName) {
  const sh = normalizedSheet_(CONFIG.sheets.transactionsV2, TRANSACTION_V2_HEADERS.transactions);
  if (sh.getLastRow() < 2) return '';
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRANSACTION_V2_HEADERS.transactions.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (!rowDateMatches_(row[1], date)) continue;
    if (normalizeText_(row[5]) !== normalizeText_(branchId)) continue;
    if (normalizeText_(row[3]) !== transactionType) continue;
    if (sourceName && normalizeText_(row[19]) !== sourceName) continue;
    if (normalizeText_(row[17]) === 'ยกเลิก') continue;
    return normalizeText_(row[0]);
  }
  return '';
}

function writeBigcOrderTransactionV2_(date, qtyData, options) {
  const dateObj = parseDate_(date || now_());
  const createdAt = now_();
  const lookups = normalizedMasterLookups_();
  const tawanaBranchId = normalizedBranchId_(lookups, CONFIG.branchName);
  const bigcBranchId = normalizedBranchId_(lookups, CONFIG.bigcBranchName);
  if (!tawanaBranchId || !bigcBranchId) throw new Error('ไม่พบ branch_id ของทาวน่าหรือบิ๊กซีใน BOY_Master');
  const batch = { transactions: [], lines: [], stockMovements: [], history: [] };
  batch.history = cancelNormalizedTransactions_(dateObj, bigcBranchId, options.sourceName, options.transactionType, 'บันทึกรายการใหม่ของวันเดียวกัน');
  const parentId = options.transactionType === 'สั่งซื้อ' ? '' :
    latestNormalizedTransactionId_(dateObj, bigcBranchId, 'สั่งซื้อ', 'BOY Operation System:BigC Order');
  const transactionId = makeId_(options.idPrefix + '-TXN', dateObj, '1');
  const metaByName = getDatabaseRowMap_();
  const orderItemMap = getBigcOrderItemMap_();
  let lineNumber = 0;

  Object.keys(qtyData || {}).forEach(function(rawName) {
    const qty = toNumber_(qtyData[rawName]);
    if (!qty) return;
    lineNumber++;
    const resolved = resolveBigcOrderItem_(rawName, metaByName, orderItemMap);
    const itemInfo = normalizedItemInfo_(lookups, resolved.name, resolved.unit);
    const baseQty = qty * (itemInfo.conversion || 1);
    const lineId = makeId_('LINE', dateObj, String(lineNumber));
    batch.lines.push([
      lineId, transactionId, lineNumber, itemInfo.itemId, '', resolved.name, qty, itemInfo.unitId,
      itemInfo.conversion || 1, baseQty, '', '', '', '', '', '', '', options.note || '', createdAt
    ]);

    if (options.stockDirection && itemInfo.itemId) {
      const fromBranchId = options.stockDirection === 'TO_BIGC' ? tawanaBranchId : bigcBranchId;
      const toBranchId = options.stockDirection === 'TO_BIGC' ? bigcBranchId : tawanaBranchId;
      batch.stockMovements.push([
        makeId_('MOV-OUT', dateObj, String(lineNumber)), transactionId, lineId, createdAt, fromBranchId, itemInfo.itemId,
        'โอนออก', -Math.abs(baseQty), itemInfo.baseUnitId, '', '', '', '', fromBranchId, toBranchId, 'WEB', createdAt, options.note || ''
      ]);
      batch.stockMovements.push([
        makeId_('MOV-IN', dateObj, String(lineNumber)), transactionId, lineId, createdAt, toBranchId, itemInfo.itemId,
        'โอนเข้า', Math.abs(baseQty), itemInfo.baseUnitId, '', '', '', '', fromBranchId, toBranchId, 'WEB', createdAt, options.note || ''
      ]);
    }
  });

  if (!lineNumber) return 0;
  batch.transactions.push([
    transactionId, dateObj, createdAt, options.transactionType, 'รายละเอียด', bigcBranchId, '', '', '', parentId,
    options.sourceName + ':' + dateKey_(dateObj), '', '', '', '', '', !!options.stockDirection, 'ยืนยันแล้ว',
    options.note || '', options.sourceName, 'WEB', createdAt, '', '', ''
  ]);
  batch.history.push(normalizedHistoryRow_('ธุรกรรม', transactionId, '', 'ยืนยันแล้ว', 'สร้างรายการ', options.sourceName, createdAt));
  appendNormalizedRows_(batch);
  return lineNumber;
}

function writeLeavesV2_(date, leaves) {
  const lookups = normalizedMasterLookups_();
  const branchId = normalizedBranchId_(lookups, CONFIG.branchName);
  const dateObj = parseDate_(date);
  const createdAt = now_();
  const batch = { leaves: [], history: [] };
  (leaves || []).forEach(function(leave) {
    const employee = lookups.employeesByName[lookupKey_(leave.name)];
    const employeeId = employee ? normalizeText_(employee.employee_id) : '';
    const type = normalizeText_(leave.type) === 'Hourly' ? 'ลารายชั่วโมง' : 'ลาเต็มวัน';
    const hours = type === 'ลารายชั่วโมง' ? toNumber_(leave.hours) : '';
    const days = type === 'ลาเต็มวัน' ? 1 : '';
    batch.leaves.push([
      leave.leaveId, employeeId, branchId, type, dateObj, dateObj, '', '', hours, days,
      'อนุมัติแล้ว', 'WEB', createdAt, 'WEB', createdAt, employeeId ? '' : 'ไม่พบ employee_id จากชื่อ: ' + normalizeText_(leave.name)
    ]);
    batch.history.push(normalizedHistoryRow_('การลา', leave.leaveId, '', 'อนุมัติแล้ว', 'สร้างรายการลา', normalizeText_(leave.name), createdAt));
  });
  appendNormalizedRows_(batch);
}

function cancelLeaveV2_(leaveId) {
  if (!leaveId) return;
  const sh = normalizedSheet_(CONFIG.sheets.leavesV2, TRANSACTION_V2_HEADERS.leaves);
  if (sh.getLastRow() < 2) return;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, TRANSACTION_V2_HEADERS.leaves.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeText_(rows[i][0]) !== normalizeText_(leaveId)) continue;
    const oldStatus = normalizeText_(rows[i][10]);
    rows[i][10] = 'ยกเลิก';
    sh.getRange(i + 2, 1, 1, rows[i].length).setValues([rows[i]]);
    appendNormalizedRows_({ history: [normalizedHistoryRow_('การลา', leaveId, oldStatus, 'ยกเลิก', 'ยกเลิกจากหน้าเว็บ', '', now_())] });
    return;
  }
}

function writePayrollFromExpensesV2_(date, data) {
  const names = {};
  (Array.isArray(data && data.exp) ? data.exp : []).forEach(function(entry) {
    const name = normalizeText_(entry.i);
    ['เงินเดือน ', 'เงินพิเศษ ', 'โบนัส '].some(function(prefix) {
      if (name.indexOf(prefix) !== 0) return false;
      const employeeName = normalizeText_(name.slice(prefix.length));
      if (employeeName) names[employeeName] = true;
      return true;
    });
  });
  const staffNames = Object.keys(names);
  if (!staffNames.length) return 0;

  const dateObj = parseDate_(date);
  const month = dateObj.getMonth() + 1;
  const year = dateObj.getFullYear();
  const period = monthKey_(year, month);
  const createdAt = now_();
  const lookups = normalizedMasterLookups_();
  const branchId = normalizedBranchId_(lookups, CONFIG.branchName);
  const calculations = handleCalculateSalary_(month, year, staffNames);
  const sh = normalizedSheet_(CONFIG.sheets.payrollV2, TRANSACTION_V2_HEADERS.payroll);
  const history = [];

  if (sh.getLastRow() >= 2) {
    const existing = sh.getRange(2, 1, sh.getLastRow() - 1, TRANSACTION_V2_HEADERS.payroll.length).getValues();
    existing.forEach(function(row, index) {
      if (normalizeText_(row[1]) !== period || normalizeText_(row[2]) !== branchId) return;
      if (normalizeText_(row[16]) === 'ยกเลิก') return;
      const oldStatus = normalizeText_(row[16]);
      row[16] = 'ยกเลิก';
      row[21] = [normalizeText_(row[21]), 'แทนที่ด้วยการคำนวณใหม่'].filter(Boolean).join(' | ');
      sh.getRange(index + 2, 1, 1, row.length).setValues([row]);
      history.push(normalizedHistoryRow_('เงินเดือน', normalizeText_(row[0]), oldStatus, 'ยกเลิก', 'คำนวณเงินเดือนใหม่', period, createdAt));
    });
  }

  const payrollRows = calculations.map(function(item, index) {
    const employee = lookups.employeesByName[lookupKey_(item.name)];
    const employeeId = employee ? normalizeText_(employee.employee_id) : '';
    const status = employeeId ? 'อนุมัติแล้ว' : 'รอตรวจสอบ';
    const payrollId = makeId_('PAYROLL', dateObj, String(index + 1));
    history.push(normalizedHistoryRow_('เงินเดือน', payrollId, '', status, 'สร้างผลคำนวณเงินเดือน', item.name, createdAt));
    return [
      payrollId, period, branchId, employeeId, item.workedDays || '', '', item.basePay || '', '', item.bonusPay || '', '', '',
      item.hourDeduction || '', '', '', '', item.totalNet || '', status, '', '', '', createdAt,
      employeeId ? '' : 'ไม่พบ employee_id จากชื่อ: ' + normalizeText_(item.name)
    ];
  });
  appendNormalizedRows_({ payroll: payrollRows, history: history });
  return payrollRows.length;
}

function normalizeText_(value) {
  return String(value || '').trim();
}

function rowDateMatches_(rowDate, targetDate) {
  if (isBlank_(rowDate)) return false;
  try {
    return dateKey_(rowDate) === dateKey_(targetDate);
  } catch (err) {
    return false;
  }
}

function isTawanaBranch_(value) {
  return canonicalBranch_(value) === CONFIG.branchName;
}

function isBranch_(value, branchName) {
  return canonicalBranch_(value) === canonicalBranch_(branchName);
}

function canonicalBranch_(value) {
  const text = normalizeText_(value);
  const lower = text.toLowerCase();
  if (!lower) return '';

  const tawanaAliases = (CONFIG.branchAliases && CONFIG.branchAliases.tawana) || [];
  const bigcAliases = (CONFIG.branchAliases && CONFIG.branchAliases.bigc) || [];
  if (tawanaAliases.map(function(alias) { return normalizeText_(alias).toLowerCase(); }).indexOf(lower) !== -1) {
    return CONFIG.branchName;
  }
  if (bigcAliases.map(function(alias) { return normalizeText_(alias).toLowerCase(); }).indexOf(lower) !== -1) {
    return CONFIG.bigcBranchName;
  }
  return text;
}

function dailyCacheSheet_() {
  const headers = ['วันที่', 'สาขา', 'ข้อมูล JSON', 'ส่งยอดแล้ว', 'อัปเดตเมื่อ'];
  const sh = ensureSheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.dailyCache, headers);
  try {
    if (!sh.isSheetHidden()) sh.hideSheet();
  } catch (err) {
    // Hiding the cache sheet is cosmetic; the cache still works if hiding fails.
  }
  return sh;
}

function getDailyCache_(date, branchName) {
  const ss = ss_(CONFIG.spreadsheets.transactions);
  const sh = ss.getSheetByName(CONFIG.sheets.dailyCache);
  if (!sh || sh.getLastRow() < 2) return null;

  const key = dateKey_(date);
  const branch = normalizeText_(branchName);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (rowDateMatches_(row[0], key) && isBranch_(row[1], branch)) {
      return {
        rowNumber: i + 2,
        draft: normalizeText_(row[2]) || '{}',
        submitted: toBool_(row[3], false),
        updatedAt: row[4] || ''
      };
    }
  }
  return null;
}

function upsertDailyCache_(date, branchName, data, submitted) {
  const sh = dailyCacheSheet_();
  const key = dateKey_(date);
  const branch = normalizeText_(branchName);
  const dateObj = parseDate_(key);
  const draftText = JSON.stringify(data || {});
  const rowValues = [[dateObj, branch, draftText, !!submitted, now_()]];
  const existing = getDailyCache_(key, branch);

  if (existing) {
    sh.getRange(existing.rowNumber, 1, 1, rowValues[0].length).setValues(rowValues);
  } else {
    appendRows_(sh, rowValues);
  }
}

function getUnitRows_() {
  const rows = values_(CONFIG.spreadsheets.master, CONFIG.sheets.units);
  const result = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = normalizeText_(row[0]);
    const unit = normalizeText_(row[2]);
    if (!name || !unit) continue;

    const active = toBool_(row[6], true);
    if (!active) continue;

    const entry = {
      rowNumber: i + 1,
      itemName: name,
      subType: normalizeText_(row[1]),
      unit: unit,
      factor: toNumber_(row[3]) || 1,
      useBuy: toBool_(row[4], true),
      useWithdraw: toBool_(row[5], true),
      active: active,
      note: normalizeText_(row[7])
    };

    if (!result[name]) result[name] = [];
    result[name].push(entry);
  }

  Object.keys(result).forEach(function(name) {
    result[name].sort(function(a, b) {
      if (a.factor === b.factor) return a.unit.localeCompare(b.unit, 'th');
      return a.factor - b.factor;
    });
  });

  return result;
}

function getDatabaseRows_() {
  const dbRows = values_(CONFIG.spreadsheets.master, CONFIG.sheets.database);
  const unitRowsByName = getUnitRows_();
  const output = [];

  for (let i = 1; i < dbRows.length; i++) {
    const row = dbRows[i];
    const name = normalizeText_(row[0]);
    if (!name) continue;

    const units = unitRowsByName[name] || [];
    const base = findBaseUnit_(units);
    const primary = findPrimaryUnit_(units, base);

    output.push({
      rowNumber: i + 1,
      name: name,
      mainType: normalizeText_(row[1]),
      subType: normalizeText_(row[2]),
      unitDetail: normalizeText_(row[3]),
      useStock: toBool_(row[4], false),
      active: toBool_(row[5], true),
      note: normalizeText_(row[6]),
      baseUnit: base ? base.unit : '',
      unit: base ? base.unit : '',
      primaryUnit: primary ? primary.unit : '',
      conversionRate: primary ? primary.factor : 1,
      unitOptions: units.filter(function(unit) {
        return unit.useBuy;
      }).map(function(unit) {
        return unit.unit;
      })
    });
  }

  return output;
}

function getExpenseCategories_() {
  const rows = values_(CONFIG.spreadsheets.master, CONFIG.sheets.expenseCategories);
  const categoryRows = [];
  const mainSeen = {};
  const mainTypes = [];
  const subTypesByMain = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const mainType = normalizeText_(row[0]);
    const subType = normalizeText_(row[1]);
    if (!mainType || !subType) continue;
    if (!toBool_(row[3], true)) continue;

    const usage = normalizeText_(row[2]);
    if (usage && usage.indexOf('รายจ่าย') === -1) continue;

    const item = {
      mainType: mainType,
      subType: subType,
      usage: usage,
      active: true,
      sortOrder: toNumber_(row[4]) || 9999,
      note: normalizeText_(row[5])
    };
    categoryRows.push(item);
  }

  categoryRows.sort(function(a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.mainType !== b.mainType) return a.mainType.localeCompare(b.mainType, 'th');
    return a.subType.localeCompare(b.subType, 'th');
  });

  categoryRows.forEach(function(row) {
    if (!mainSeen[row.mainType]) {
      mainSeen[row.mainType] = true;
      mainTypes.push(row.mainType);
    }
    if (!subTypesByMain[row.mainType]) subTypesByMain[row.mainType] = [];
    if (subTypesByMain[row.mainType].indexOf(row.subType) === -1) {
      subTypesByMain[row.mainType].push(row.subType);
    }
  });

  return {
    rows: categoryRows,
    mainTypes: mainTypes,
    subTypesByMain: subTypesByMain
  };
}

function findBaseUnit_(units) {
  if (!units || units.length === 0) return null;
  return units.find(function(unit) {
    return unit.factor === 1;
  }) || units[0];
}

function findPrimaryUnit_(units, baseUnit) {
  if (!units || units.length === 0) return null;
  const baseName = baseUnit ? baseUnit.unit : '';
  return units.find(function(unit) {
    return unit.useBuy && unit.unit !== baseName && unit.factor > 1;
  }) || null;
}

function handleSharedLoadDb_() {
  const rows = getDatabaseRows_().filter(function(row) {
    return row.active !== false;
  });
  const categories = {};
  const itemMeta = {};
  const lookups = normalizedMasterLookups_();
  const suppliers = Object.keys(lookups.suppliersById).map(function(supplierId) {
    const row = lookups.suppliersById[supplierId];
    return {
      id: supplierId,
      code: normalizeText_(row['รหัสผู้ขาย']),
      name: normalizeText_(row['ชื่อผู้ขาย'])
    };
  }).filter(function(row) {
    return row.name;
  }).sort(function(a, b) {
    return a.name.localeCompare(b.name, 'th');
  });

  rows.forEach(function(row) {
    const category = row.mainType || 'ไม่ระบุประเภท';
    const displayName = row.baseUnit ? row.name + ' (' + row.baseUnit + ')' : row.name;
    if (!categories[category]) categories[category] = [];
    categories[category].push(displayName);

    const meta = {
      mainType: row.mainType,
      subType: row.subType,
      unit: row.baseUnit,
      baseUnit: row.baseUnit,
      primaryUnit: row.primaryUnit,
      conversionRate: row.conversionRate || 1,
      unitDetail: row.unitDetail,
      unitOptions: row.unitOptions || [],
      useStock: row.useStock,
      active: row.active,
      supplierOptions: []
    };
    const normalizedItem = lookups.itemsByName[lookupKey_(row.name)];
    const itemId = normalizedItem ? normalizeText_(normalizedItem.item_id) : '';
    meta.supplierOptions = (lookups.supplierIdsByItemId[itemId] || []).map(function(supplierId) {
      const supplier = lookups.suppliersById[supplierId];
      return supplier ? normalizeText_(supplier['ชื่อผู้ขาย']) : '';
    }).filter(Boolean);
    itemMeta[displayName] = meta;
    itemMeta[row.name] = meta;
  });

  Object.keys(categories).forEach(function(category) {
    categories[category].sort(function(a, b) {
      return a.localeCompare(b, 'th');
    });
  });

  return {
    status: 'success',
    database: {
      categories: categories,
      itemMeta: itemMeta,
      suppliers: suppliers,
      expenseCategories: getExpenseCategories_()
    }
  };
}

function handlePullItems_() {
  const rows = getDatabaseRows_().filter(function(row) {
    return row.active !== false;
  });
  const result = {};
  rows.forEach(function(row) {
    result[row.name] = row.baseUnit || '';
  });
  return result;
}

function handleDatabaseSaveItem_(item) {
  const name = normalizeText_(item.name);
  if (!name) throw new Error('กรุณากรอกชื่อรายการ');

  const sh = sheet_(CONFIG.spreadsheets.master, CONFIG.sheets.database);
  let rowNumber = Number(item.rowNumber || 0);
  let oldName = '';

  if (rowNumber >= 2 && rowNumber <= sh.getLastRow()) {
    oldName = normalizeText_(sh.getRange(rowNumber, 1).getValue());
  } else {
    rowNumber = sh.getLastRow() + 1;
  }

  const values = [[
    name,
    normalizeText_(item.mainType),
    normalizeText_(item.subType),
    normalizeText_(item.unitDetail),
    !!item.useStock,
    item.active !== false,
    normalizeText_(item.note)
  ]];
  sh.getRange(rowNumber, 1, 1, values[0].length).setValues(values);

  if (oldName && oldName !== name) renameUnitRows_(oldName, name);
  upsertUnitForItem_(name, normalizeText_(item.subType), normalizeText_(item.baseUnit || item.unit), 1, true, true, 'หน่วยซื้อจากหน้าเว็บ');
  const primaryUnit = normalizeText_(item.primaryUnit);
  const conversionRate = toNumber_(item.conversionRate) || 1;
  if (primaryUnit && primaryUnit !== normalizeText_(item.baseUnit || item.unit)) {
    upsertUnitForItem_(name, normalizeText_(item.subType), primaryUnit, conversionRate, true, true, 'หน่วยหลักจากหน้าเว็บ');
  }

  return { status: 'success', rows: getDatabaseRows_() };
}

function handleDatabaseSetActive_(rowNumber, active) {
  const sh = sheet_(CONFIG.spreadsheets.master, CONFIG.sheets.database);
  const rn = Number(rowNumber);
  if (!rn || rn < 2 || rn > sh.getLastRow()) throw new Error('rowNumber ไม่ถูกต้อง');
  sh.getRange(rn, 6).setValue(!!active);
  return { status: 'success', rows: getDatabaseRows_() };
}

function renameUnitRows_(oldName, newName) {
  const sh = sheet_(CONFIG.spreadsheets.master, CONFIG.sheets.units);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) === oldName) {
      sh.getRange(i + 1, 1).setValue(newName);
    }
  }
}

function upsertUnitForItem_(name, subType, unit, factor, useBuy, useWithdraw, note) {
  if (!name || !unit) return;
  const sh = sheet_(CONFIG.spreadsheets.master, CONFIG.sheets.units);
  const values = sh.getDataRange().getValues();
  let targetRow = 0;

  for (let i = 1; i < values.length; i++) {
    if (normalizeText_(values[i][0]) === name && normalizeText_(values[i][2]) === unit) {
      targetRow = i + 1;
      break;
    }
  }

  const rowValues = [[name, subType, unit, factor || 1, !!useBuy, !!useWithdraw, true, note || '']];
  if (targetRow) {
    sh.getRange(targetRow, 1, 1, 8).setValues(rowValues);
  } else {
    appendRows_(sh, rowValues);
  }
}

function handleLoadData_(date) {
  const key = dateKey_(date);
  const props = PropertiesService.getScriptProperties();
  const draftText = props.getProperty(propKey_('draft', key));
  const propSubmitted = props.getProperty(propKey_('submitted', key)) === 'true';
  const cached = getDailyCache_(key, CONFIG.branchName);

  if (cached) {
    return {
      status: 'success',
      draft: draftText || cached.draft || '{}',
      submitted: propSubmitted || cached.submitted
    };
  }

  if (draftText && !propSubmitted) {
    return {
      status: 'success',
      draft: draftText,
      submitted: false
    };
  }

  if (!propSubmitted && key >= relativeDateKey_(-2)) {
    return {
      status: 'success',
      draft: '{}',
      submitted: false
    };
  }

  const incomeRows = tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income, 9);
  const expenseRows = tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses, 12);
  const submitted = hasSubmittedRowsFromData_(key, incomeRows, expenseRows) || propSubmitted;
  const sheetSnapshot = buildSnapshotFromRows_(key, incomeRows, expenseRows);
  const hasSheetData = snapshotHasData_(sheetSnapshot);
  const result = {
    status: 'success',
    draft: hasSheetData ? JSON.stringify(sheetSnapshot) : (draftText || '{}'),
    submitted: submitted
  };

  if (hasSheetData || submitted) {
    upsertDailyCache_(key, CONFIG.branchName, sheetSnapshot, submitted);
  }

  return result;
}

function handleAutoSave_(date, data) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().setProperty(propKey_('draft', key), JSON.stringify(data || {}));
  return { status: 'success' };
}

function handleUnlockDate_(date) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().deleteProperty(propKey_('submitted', key));
  const cached = getDailyCache_(key, CONFIG.branchName);
  if (cached) {
    let data = {};
    try {
      data = JSON.parse(cached.draft || '{}');
    } catch (err) {
      data = {};
    }
    upsertDailyCache_(key, CONFIG.branchName, data, false);
  }
  return { status: 'success' };
}

function handleSubmit_(date, data) {
  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const txId = Utilities.getUuid().slice(0, 8);
    replaceIncomeRows_(date, data || {}, txId);
    replaceExpenseRows_(date, data || {}, txId);
    writeIncomeTransactionsV2_(date, CONFIG.branchName, CONFIG.sourceName, 'TAWANA-INC', [
      { amount: data && data.cash && data.cash.v, paymentMethod: 'เงินสด', note: 'รายรับหน้าร้านเงินสด' },
      { amount: data && data.transfer && data.transfer.v, paymentMethod: 'โอนเงิน', note: 'รายรับหน้าร้านเงินโอน' },
      { amount: data && data.other && data.other.v, paymentMethod: 'อื่นๆ', note: data && data.other && data.other.n }
    ]);
    writeExpenseTransactionsV2_(date, data || {}, {
      branchName: CONFIG.branchName,
      sourceName: CONFIG.sourceName,
      idPrefix: 'TAWANA-EXP'
    });
    writePayrollFromExpensesV2_(date, data || {});
    const key = dateKey_(date);
    upsertDailyCache_(key, CONFIG.branchName, data || {}, true);
    PropertiesService.getScriptProperties().setProperty(propKey_('submitted', key), 'true');
    PropertiesService.getScriptProperties().deleteProperty(propKey_('draft', key));
    return { status: 'Success', stockWarnings: [] };
  } finally {
    scriptLock.releaseLock();
  }
}

function replaceIncomeRows_(date, data, txId) {
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income);
  deleteRowsByPredicate_(sh, function(row) {
    if (!rowDateMatches_(row[0], date) || !isTawanaBranch_(row[1])) return false;
    const main = normalizeText_(row[2]);
    const sub = normalizeText_(row[3]);
    return (main === 'หน้าร้าน' && (sub === 'เงินสด' || sub === 'เงินโอน' || sub === 'ธนาคาร')) ||
      main === 'รายได้อื่นๆ' ||
      main === 'รายได้อื่น';
  });

  const rows = [];
  const dateObj = parseDate_(date);
  const createdAt = now_();

  addIncomeRow_(rows, dateObj, 'หน้าร้าน', 'เงินสด', data.cash && data.cash.v, '', 'CASH', txId, createdAt);
  addIncomeRow_(rows, dateObj, 'หน้าร้าน', 'เงินโอน', data.transfer && data.transfer.v, '', 'TRANSFER', txId, createdAt);

  const otherAmount = data.other && data.other.v;
  const otherNote = data.other && data.other.n;
  if (toNumber_(otherAmount) !== 0 || !isBlank_(otherNote)) {
    addIncomeRow_(rows, dateObj, 'รายได้อื่นๆ', normalizeText_(otherNote) || 'อื่นๆ', otherAmount, normalizeText_(otherNote), 'OTHER', txId, createdAt);
  }

  appendRows_(sh, rows);
}

function addIncomeRow_(rows, dateObj, main, sub, amount, note, suffix, txId, createdAt) {
  const amountNumber = toNumber_(amount);
  if (amountNumber === 0 && isBlank_(note)) return;
  rows.push([
    dateObj,
    CONFIG.branchName,
    main,
    sub,
    amountNumber,
    note || '',
    makeId_('TAWANA-INC', dateObj, suffix + '-' + txId),
    createdAt,
    CONFIG.sourceName
  ]);
}

function replaceExpenseRows_(date, data, txId) {
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses);
  deleteRowsByPredicate_(sh, function(row) {
    return rowDateMatches_(row[0], date) && isTawanaBranch_(row[1]);
  });

  const dateObj = parseDate_(date);
  const rows = [];
  const expenses = Array.isArray(data.exp) ? data.exp : [];
  const metaByName = getDatabaseRowMap_();

  expenses.forEach(function(item, index) {
    const name = normalizeText_(item.i);
    const qty = toNumber_(item.q);
    const unit = normalizeText_(item.u);
    const amount = toNumber_(item.p);
    const supplierName = normalizeText_(item.s);
    const note = normalizeText_(item.n);
    if (!name && qty === 0 && !unit && amount === 0 && !supplierName && !note) return;

    const unitPrice = qty ? amount / qty : '';
    const meta = metaByName[name] || {};
    rows.push([
      dateObj,
      CONFIG.branchName,
      name,
      unit,
      qty || '',
      unitPrice === '' ? '' : unitPrice,
      amount || '',
      normalizeText_(item.m) || meta.mainType || '',
      normalizeText_(item.t) || meta.subType || '',
      [supplierName ? 'ผู้ขาย: ' + supplierName : '', note].filter(Boolean).join(' | '),
      makeId_('TAWANA-EXP', dateObj, String(index + 1) + '-' + txId),
      CONFIG.sourceName
    ]);
  });

  appendRows_(sh, rows);
}

function findItemMeta_(name) {
  const cleanName = normalizeText_(name);
  if (!cleanName) return {};
  const rows = getDatabaseRows_();
  return rows.find(function(row) {
    return row.name === cleanName;
  }) || {};
}

function getDatabaseRowMap_() {
  const map = {};
  getDatabaseRows_().forEach(function(row) {
    map[row.name] = row;
  });
  return map;
}

function hasSubmittedRowsFromData_(dateKey, incomeRows, expenseRows) {
  const hasIncome = incomeRows.slice(1).some(function(row) {
    return rowDateMatches_(row[0], dateKey) && isTawanaBranch_(row[1]) &&
      (normalizeText_(row[2]) === 'หน้าร้าน' || normalizeText_(row[2]).indexOf('รายได้อื่น') === 0);
  });
  const hasExpense = expenseRows.slice(1).some(function(row) {
    return rowDateMatches_(row[0], dateKey) && isTawanaBranch_(row[1]);
  });
  return hasIncome || hasExpense;
}

function buildSnapshotFromRows_(dateKey, incomeRows, expenseRows) {
  const snapshot = {
    cash: { v: '', s: true },
    transfer: { v: '', s: true },
    other: { v: '', n: '' },
    exp: []
  };

  incomeRows.slice(1).forEach(function(row) {
    if (!rowDateMatches_(row[0], dateKey) || !isTawanaBranch_(row[1])) return;
    const main = normalizeText_(row[2]);
    const sub = normalizeText_(row[3]);
    const amount = row[4];
    if (main === 'หน้าร้าน' && sub === 'เงินสด') snapshot.cash.v = amount;
    if (main === 'หน้าร้าน' && (sub === 'เงินโอน' || sub === 'ธนาคาร')) snapshot.transfer.v = amount;
    if (main.indexOf('รายได้อื่น') === 0) {
      snapshot.other.v = amount;
      snapshot.other.n = normalizeText_(row[5]) || sub;
    }
  });

  expenseRows.slice(1).forEach(function(row) {
    if (!rowDateMatches_(row[0], dateKey) || !isTawanaBranch_(row[1])) return;
    const legacyNote = normalizeText_(row[9]);
    const supplierMatch = legacyNote.match(/^ผู้ขาย:\s*([^|]+?)(?:\s*\|\s*(.*))?$/);
    snapshot.exp.push({
      i: row[2] || '',
      u: row[3] || '',
      q: row[4] || '',
      p: row[6] || '',
      m: row[7] || '',
      t: row[8] || '',
      s: supplierMatch ? normalizeText_(supplierMatch[1]) : '',
      n: supplierMatch ? normalizeText_(supplierMatch[2]) : legacyNote
    });
  });

  return snapshot;
}

function snapshotHasData_(snapshot) {
  if (!snapshot) return false;
  if (snapshot.cash && !isBlank_(snapshot.cash.v)) return true;
  if (snapshot.transfer && !isBlank_(snapshot.transfer.v)) return true;
  if (snapshot.other && (!isBlank_(snapshot.other.v) || !isBlank_(snapshot.other.n))) return true;
  return Array.isArray(snapshot.exp) && snapshot.exp.length > 0;
}

function handleBigcExpenseLoadData_(date) {
  const scope = 'BigCExpense';
  const branchName = CONFIG.bigcBranchName;
  const key = dateKey_(date);
  const expenseRows = tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses, 12);
  const snapshot = buildExpenseSnapshotForBranch_(key, branchName, expenseRows);
  const hasSheetData = Array.isArray(snapshot.exp) && snapshot.exp.length > 0;
  const submitted = hasSheetData ||
    PropertiesService.getScriptProperties().getProperty(scopedPropKey_('submitted', scope, key)) === 'true';
  const draftText = PropertiesService.getScriptProperties().getProperty(scopedPropKey_('draft', scope, key));

  return {
    status: 'success',
    draft: hasSheetData ? JSON.stringify(snapshot) : (draftText || '{}'),
    submitted: submitted
  };
}

function handleBigcExpenseAutoSave_(date, data) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().setProperty(
    scopedPropKey_('draft', 'BigCExpense', key),
    JSON.stringify(data || {})
  );
  return { status: 'success' };
}

function handleBigcExpenseUnlockDate_(date) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().deleteProperty(scopedPropKey_('submitted', 'BigCExpense', key));
  return { status: 'success' };
}

function handleBigcExpenseSubmit_(date, data) {
  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const txId = Utilities.getUuid().slice(0, 8);
    replaceExpenseRowsForBranch_(date, data || {}, {
      branchName: CONFIG.bigcBranchName,
      sourceName: 'BOY Operation System:BigC Expense',
      idPrefix: 'BIGC-EXP',
      txId: txId
    });
    writeExpenseTransactionsV2_(date, data || {}, {
      branchName: CONFIG.bigcBranchName,
      sourceName: 'BOY Operation System:BigC Expense',
      idPrefix: 'BIGC-EXP'
    });
    const key = dateKey_(date);
    PropertiesService.getScriptProperties().setProperty(scopedPropKey_('submitted', 'BigCExpense', key), 'true');
    PropertiesService.getScriptProperties().deleteProperty(scopedPropKey_('draft', 'BigCExpense', key));
    return { status: 'Success' };
  } finally {
    scriptLock.releaseLock();
  }
}

function buildExpenseSnapshotForBranch_(dateKey, branchName, expenseRows) {
  const snapshot = { exp: [] };
  expenseRows.slice(1).forEach(function(row) {
    if (!rowDateMatches_(row[0], dateKey) || !isBranch_(row[1], branchName)) return;
    snapshot.exp.push({
      i: row[2] || '',
      u: row[3] || '',
      q: row[4] || '',
      p: row[6] || '',
      m: row[7] || '',
      t: row[8] || '',
      n: row[9] || ''
    });
  });
  return snapshot;
}

function replaceExpenseRowsForBranch_(date, data, options) {
  const branchName = options.branchName;
  const sourceName = options.sourceName;
  const idPrefix = options.idPrefix;
  const txId = options.txId || Utilities.getUuid().slice(0, 8);
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses);
  deleteRowsByPredicate_(sh, function(row) {
    return rowDateMatches_(row[0], date) && isBranch_(row[1], branchName);
  });

  const dateObj = parseDate_(date);
  const rows = [];
  const expenses = Array.isArray(data.exp) ? data.exp : [];
  const metaByName = getDatabaseRowMap_();

  expenses.forEach(function(item, index) {
    const name = normalizeText_(item.i);
    const qty = toNumber_(item.q);
    const unit = normalizeText_(item.u);
    const amount = toNumber_(item.p);
    const note = normalizeText_(item.n);
    if (!name && qty === 0 && !unit && amount === 0 && !note) return;

    const unitPrice = qty ? amount / qty : '';
    const meta = metaByName[name] || {};
    rows.push([
      dateObj,
      branchName,
      name,
      unit,
      qty || '',
      unitPrice === '' ? '' : unitPrice,
      amount || '',
      normalizeText_(item.m) || meta.mainType || '',
      normalizeText_(item.t) || meta.subType || '',
      note,
      makeId_(idPrefix, dateObj, String(index + 1) + '-' + txId),
      sourceName
    ]);
  });

  appendRows_(sh, rows);
}

function handleBigcOrderLoadDb_() {
  const savedMenu = readBigcOrderMenu_();
  return {
    status: 'success',
    database: savedMenu || buildBigcOrderDatabaseFromMaster_()
  };
}

function handleBigcOrderLoadDraft_() {
  const key = dateKey_(now_());
  const draftText = PropertiesService.getScriptProperties().getProperty(scopedPropKey_('draft', 'BigCOrder', key));
  return {
    status: 'success',
    draft: draftText ? JSON.parse(draftText) : {}
  };
}

function handleBigcOrderAutoSave_(draftData) {
  const key = dateKey_(draftData.date || now_());
  PropertiesService.getScriptProperties().setProperty(
    scopedPropKey_('draft', 'BigCOrder', key),
    JSON.stringify(draftData || {})
  );
  return { status: 'success' };
}

function handleBigcOrderSaveDb_(database) {
  const headers = ['หมวดหมู่', 'รายการเบิก/คืน', 'อ้างอิงรายการจริง', 'หน่วยกรอก', 'วิธีคิดต้นทุน', 'ใช้ UW', 'UW ที่ใช้', 'เปิดใช้งาน', 'หมายเหตุ', 'อัปเดตเมื่อ'];
  const sh = ensureSheet_(CONFIG.spreadsheets.master, CONFIG.sheets.bigcOrderMenu, headers);
  const categories = database.categories || {};
  const weightSet = {};
  (database.weightItems || []).forEach(function(item) {
    weightSet[normalizeText_(item)] = true;
  });
  const mappings = database.itemMappings || {};
  const updatedAt = normalizeText_(database.updatedAt) || new Date().toISOString();
  const rows = [];

  Object.keys(categories).forEach(function(category) {
    (categories[category] || []).forEach(function(item, index) {
      const displayItem = normalizeText_(item);
      if (!displayItem) return;
      const parsed = parseBigcOrderDisplayItem_(displayItem);
      const unit = parsed.unit || '';
      const usesWeight = !!weightSet[displayItem] || isWeightUnit_(unit);
      rows.push([
        category,
        displayItem,
        mappings[displayItem] || parsed.name || displayItem,
        unit,
        usesWeight ? 'น้ำหนักพร้อมใช้ / UW' : 'จำนวน x ราคาเฉลี่ย',
        usesWeight,
        usesWeight ? 'UW เนื้อ/ปั่น' : 'ไม่ใช้',
        true,
        '',
        updatedAt
      ]);
    });
  });

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  appendRows_(sh, rows);

  return {
    status: 'success',
    database: readBigcOrderMenu_() || database
  };
}

function handleBigcOrderRebuildMenuFromMaster_() {
  const headers = ['หมวดหมู่', 'รายการเบิก/คืน', 'อ้างอิงรายการจริง', 'หน่วยกรอก', 'วิธีคิดต้นทุน', 'ใช้ UW', 'UW ที่ใช้', 'เปิดใช้งาน', 'หมายเหตุ', 'อัปเดตเมื่อ'];
  const sh = ensureSheet_(CONFIG.spreadsheets.master, CONFIG.sheets.bigcOrderMenu, headers);
  const database = buildBigcOrderDatabaseFromMaster_();
  const specialRows = getBigcSpecialWithdrawalRows_();
  const specialNames = {};
  const rows = [];
  const rowsByDisplayName = {};
  const updatedAt = new Date();

  specialRows.forEach(function(row) {
    specialNames[normalizeText_(row[1])] = true;
  });

  function addRow(row) {
    const displayName = normalizeText_(row[1]);
    if (!displayName || rowsByDisplayName[displayName]) return;
    rowsByDisplayName[displayName] = true;
    rows.push(row);
  }

  Object.keys(database.categories || {}).forEach(function(category) {
    (database.categories[category] || []).forEach(function(displayItem) {
      const displayName = normalizeText_(displayItem);
      if (!displayName || isGeneratedSpecialDuplicate_(displayName, specialNames)) return;

      const parsed = parseBigcOrderDisplayItem_(displayName);
      const unit = parsed.unit || '';
      const usesWeight = isWeightUnit_(unit);
      addRow([
        category,
        displayName,
        parsed.name || displayName,
        unit,
        usesWeight ? 'น้ำหนักพร้อมใช้ / UW' : 'จำนวน x ราคาเฉลี่ย',
        usesWeight,
        usesWeight ? 'UW เนื้อ/ปั่น' : 'ไม่ใช้',
        true,
        '',
        updatedAt
      ]);
    });
  });

  specialRows.forEach(function(row) {
    const displayName = normalizeText_(row[1]);
    const existingIndex = rows.findIndex(function(existing) {
      return normalizeText_(existing[1]) === displayName;
    });
    if (existingIndex !== -1) {
      rows.splice(existingIndex, 1);
      delete rowsByDisplayName[displayName];
    }
    row[9] = updatedAt;
    addRow(row);
  });

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  appendRows_(sh, rows);
  formatBigcOrderMenuSheet_(sh, headers.length);

  return {
    status: 'success',
    saved: rows.length,
    database: readBigcOrderMenu_()
  };
}

function getBigcSpecialWithdrawalRows_() {
  return [
    ['🍉 ผลไม้ (ใส่กล่อง)', 'อโวคาโด (กล่อง)', 'อโวคาโด', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ผลไม้ปอก/พร้อมใช้สำหรับ BigC', ''],
    ['🍉 ผลไม้ (ลูก)', 'แตงโม (ลูก)', 'แตงโม', 'ลูก', 'จำนวน x ราคาเฉลี่ย', false, 'ไม่ใช้', true, 'เบิกเป็นลูก ไม่ชั่งน้ำหนัก', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'แตงโม (กล่อง)', 'แตงโม', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกแล้ว/พร้อมใช้', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'สับปะรด (กล่อง)', 'สับปะรด', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกเอาตาออก/พร้อมปั่น', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'มะพร้าว (กล่อง)', 'มะพร้าว', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'เนื้อมะพร้าวพร้อมใช้', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'มะม่วง (กล่อง)', 'มะม่วง', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกแล้ว/พร้อมใช้', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'เสาวรส (ถุง)', 'เสาวรส', 'กก.', 'ปริมาณน้ำ/เนื้อ / UW', true, 'UW คั้น/สกัดตรง', true, 'ควักแล้ว/พร้อมใช้', ''],
    ['🥥 น้ำผลไม้', 'น้ำมะพร้าว', 'มะพร้าว', 'ml', 'ปริมาณน้ำ / UW', true, 'UW คั้น/สกัดตรง', true, 'น้ำมะพร้าวที่แยกออกมา', ''],
    ['🥥 น้ำผลไม้', 'น้ำมะนาว', 'มะนาว', 'ml', 'ปริมาณน้ำ / UW', true, 'UW คั้น/สกัดตรง', true, 'น้ำมะนาวคั้น', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'มะละกอ (กล่อง)', 'มะละกอ', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกแล้ว/พร้อมใช้', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'เมลอน (กล่อง)', 'เมล่อน', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกแล้ว/พร้อมใช้', ''],
    ['🍉 ผลไม้ (ใส่กล่อง)', 'แคนตาลูป (กล่อง)', 'แคนตาลูป', 'กก.', 'น้ำหนักพร้อมใช้ / UW', true, 'UW เนื้อ/ปั่น', true, 'ปอกแล้ว/พร้อมใช้', '']
  ];
}

function isGeneratedSpecialDuplicate_(displayName, specialNames) {
  const text = normalizeText_(displayName);
  return Object.keys(specialNames).some(function(specialName) {
    return text === specialName || text.indexOf(specialName + ' (') === 0;
  });
}

function formatBigcOrderMenuSheet_(sh, columnCount) {
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, columnCount)
    .setBackground('#1f4e79')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sh.autoResizeColumns(1, columnCount);
}

function handleBigcOrderSubmitOrder_(date, qtyData, categories) {
  const dateObj = date ? parseDate_(date) : now_();
  const key = dateKey_(dateObj);
  const orderData = {
    date: key,
    qtyData: qtyData || {},
    categories: categories || {},
    timestamp: new Date().toISOString()
  };
  PropertiesService.getScriptProperties().setProperty(
    scopedPropKey_('order', 'BigCOrder', key),
    JSON.stringify(orderData)
  );
  writeBigcOrderTransactionV2_(dateObj, qtyData || {}, {
    transactionType: 'สั่งซื้อ',
    sourceName: 'BOY Operation System:BigC Order',
    idPrefix: 'BIGC-ORDER',
    note: 'คำสั่งเบิกของสำหรับบิ๊กซีพัทยากลาง'
  });
  return { status: 'success', saved: Object.keys(qtyData || {}).length };
}

function handleBigcOrderReceive_(date, qtyData) {
  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const dateObj = date ? parseDate_(date) : now_();
    const count = replaceBigcWithdrawalRows_(dateObj, qtyData, {
      sign: 1,
      note: 'รับสินค้าเข้าบิ๊กซีพัทยากลาง',
      sourceName: 'BOY Operation System:BigC Receive',
      idPrefix: 'BIGC-WITHDRAW'
    });
    writeBigcOrderTransactionV2_(dateObj, qtyData || {}, {
      transactionType: 'รับสินค้า',
      sourceName: 'BOY Operation System:BigC Receive',
      idPrefix: 'BIGC-RECEIVE',
      note: 'รับสินค้าเข้าบิ๊กซีพัทยากลาง',
      stockDirection: 'TO_BIGC'
    });
    const key = dateKey_(dateObj);
    PropertiesService.getScriptProperties().deleteProperty(scopedPropKey_('draft', 'BigCOrder', key));
    return { status: 'success', saved: count };
  } finally {
    scriptLock.releaseLock();
  }
}

function handleBigcOrderReturn_(date, qtyData, cash, transfer) {
  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const dateObj = date ? parseDate_(date) : now_();
    const returned = replaceBigcWithdrawalRows_(dateObj, qtyData, {
      sign: -1,
      note: 'คืนของให้ทาวน่า',
      sourceName: 'BOY Operation System:BigC Return',
      idPrefix: 'BIGC-RETURN'
    });
    const incomeRows = replaceBigcOrderIncomeRows_(dateObj, cash, transfer);
    writeBigcOrderTransactionV2_(dateObj, qtyData || {}, {
      transactionType: 'โอนสินค้า',
      sourceName: 'BOY Operation System:BigC Return',
      idPrefix: 'BIGC-RETURN',
      note: 'คืนสินค้าจากบิ๊กซีพัทยากลางให้ทาวน่า',
      stockDirection: 'TO_TAWANA'
    });
    writeIncomeTransactionsV2_(dateObj, CONFIG.bigcBranchName, 'BOY Operation System:BigC Order', 'BIGC-INC', [
      { amount: cash, paymentMethod: 'เงินสด', note: 'รายรับหน้าร้านบิ๊กซีเงินสด' },
      { amount: transfer, paymentMethod: 'โอนเงิน', note: 'รายรับหน้าร้านบิ๊กซีเงินโอน' }
    ]);
    const key = dateKey_(dateObj);
    PropertiesService.getScriptProperties().deleteProperty(scopedPropKey_('draft', 'BigCOrder', key));
    return { status: 'success', saved: returned, incomeRows: incomeRows };
  } finally {
    scriptLock.releaseLock();
  }
}

function readBigcOrderMenu_() {
  const ss = ss_(CONFIG.spreadsheets.master);
  const sh = ss.getSheetByName(CONFIG.sheets.bigcOrderMenu);
  if (!sh || sh.getLastRow() < 2) return null;

  const values = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 10)).getValues();
  const headers = (values[0] || []).map(function(cell) { return normalizeText_(cell); });
  const isNewSchema = headers[0] === 'หมวดหมู่' && headers[1] === 'รายการเบิก/คืน';
  const categories = {};
  const weightItems = [];
  const itemMappings = {};
  let updatedAt = '';

  values.slice(1).forEach(function(row) {
    const category = normalizeText_(row[0]);
    const item = normalizeText_(row[1]);
    if (!category || !item) return;
    if (isNewSchema && toBool_(row[7], true) === false) return;
    if (!isNewSchema && toBool_(row[5], true) === false) return;

    if (!categories[category]) categories[category] = [];
    categories[category].push(item);
    if (isNewSchema) {
      const method = normalizeText_(row[4]);
      const unit = normalizeText_(row[3]);
      if (toBool_(row[5], false) || isWeightUnit_(unit) || method.indexOf('UW') !== -1) weightItems.push(item);

      if (row[9]) updatedAt = row[9] instanceof Date ? row[9].toISOString() : normalizeText_(row[9]);
    } else {
      if (toBool_(row[3], false)) weightItems.push(item);

      const sheetItem = normalizeText_(row[2]);
      if (sheetItem && sheetItem !== item) itemMappings[item] = sheetItem;
      if (row[6]) updatedAt = row[6] instanceof Date ? row[6].toISOString() : normalizeText_(row[6]);
    }
  });

  return {
    categories: categories,
    weightItems: weightItems,
    itemMappings: itemMappings,
    updatedAt: updatedAt || new Date().toISOString()
  };
}

function buildBigcOrderDatabaseFromMaster_() {
  const rows = getDatabaseRows_().filter(function(row) {
    return row.active !== false && row.useStock === true;
  });
  const unitRowsByName = getUnitRows_();
  const categories = {};
  const weightItems = [];

  rows.forEach(function(row) {
    const withdrawUnits = (unitRowsByName[row.name] || []).filter(function(unit) {
      return unit.useWithdraw;
    });
    const units = withdrawUnits.length ? withdrawUnits : [{
      unit: row.baseUnit || row.unit || '',
      factor: 1
    }];

    units.forEach(function(unitRow) {
      const unit = normalizeText_(unitRow.unit);
      const displayName = unit ? row.name + ' (' + unit + ')' : row.name;
      const category = mapBigcOrderCategory_(row.mainType, row.subType, row.name);
      if (!categories[category]) categories[category] = [];
      if (categories[category].indexOf(displayName) === -1) categories[category].push(displayName);
      if (isWeightUnit_(unit) && weightItems.indexOf(displayName) === -1) weightItems.push(displayName);
    });
  });

  Object.keys(categories).forEach(function(category) {
    categories[category].sort(function(a, b) {
      return a.localeCompare(b, 'th');
    });
  });

  return {
    categories: categories,
    weightItems: weightItems,
    itemMappings: {},
    updatedAt: new Date().toISOString()
  };
}

function mapBigcOrderCategory_(mainType, subType, name) {
  const main = normalizeText_(mainType);
  const sub = normalizeText_(subType);
  const itemName = normalizeText_(name);
  const text = main + ' ' + sub + ' ' + itemName;

  if (text.indexOf('บรรจุ') !== -1) return '📦 บรรจุภัณฑ์';
  if (text.indexOf('อบแห้ง') !== -1 || text.indexOf('ฝาแดง') !== -1 || text.indexOf('ฝาเขียว') !== -1 || text.indexOf('ฝาชมพู') !== -1 || text.indexOf('ฝาม่วง') !== -1) return '🥫 ผลไม้อบแห้งกระปุก';
  if (text.indexOf('ขนม') !== -1) return '🍬 ขนม';
  if (text.indexOf('แช่แข็ง') !== -1) return '❄️ ผลไม้แช่แข็ง';
  if (text.indexOf('ท็อป') !== -1) return '🍪 ท็อปปิ้ง';
  if (text.indexOf('ผง') !== -1) return '☕ ผง';
  if (text.indexOf('ผลไม้') !== -1) return '🍉 ผลไม้ (ใส่กล่อง)';
  return '🥛 อื่นๆ';
}

function isWeightUnit_(unit) {
  const text = normalizeText_(unit).toLowerCase();
  return text.indexOf('กิโล') !== -1 || text === 'kg' || text.indexOf('กก') !== -1;
}

function replaceBigcWithdrawalRows_(date, qtyData, options) {
  const dateObj = parseDate_(date);
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.withdrawals);
  const sourceName = options.sourceName;
  const idPrefix = options.idPrefix;
  const sign = Number(options.sign || 1);
  const note = normalizeText_(options.note);
  const txId = Utilities.getUuid().slice(0, 8);
  const metaByName = getDatabaseRowMap_();
  const orderItemMap = getBigcOrderItemMap_();

  deleteRowsByPredicate_(sh, function(row) {
    return rowDateMatches_(row[0], dateObj) && isBranch_(row[1], CONFIG.bigcBranchName) && normalizeText_(row[10]) === sourceName;
  });

  const rows = [];
  Object.keys(qtyData || {}).forEach(function(rawName, index) {
    const qty = toNumber_(qtyData[rawName]);
    if (qty === 0) return;

    const resolved = resolveBigcOrderItem_(rawName, metaByName, orderItemMap);
    const meta = metaByName[resolved.name] || {};
    rows.push([
      dateObj,
      CONFIG.bigcBranchName,
      resolved.name,
      resolved.unit,
      qty * sign,
      '',
      '',
      meta.mainType || '',
      note,
      makeId_(idPrefix, dateObj, String(index + 1) + '-' + txId),
      sourceName
    ]);
  });

  appendRows_(sh, rows);
  return rows.length;
}

function getBigcOrderItemMap_() {
  const ss = ss_(CONFIG.spreadsheets.master);
  const sh = ss.getSheetByName(CONFIG.sheets.bigcOrderMenu);
  if (!sh || sh.getLastRow() < 2) return {};

  const values = sh.getRange(1, 1, sh.getLastRow(), Math.min(sh.getLastColumn(), 10)).getValues();
  const headers = (values[0] || []).map(function(cell) { return normalizeText_(cell); });
  if (!(headers[0] === 'หมวดหมู่' && headers[1] === 'รายการเบิก/คืน')) return {};

  const map = {};
  values.slice(1).forEach(function(row) {
    if (toBool_(row[7], true) === false) return;
    const displayName = normalizeText_(row[1]);
    if (!displayName) return;
    const parsed = parseBigcOrderDisplayItem_(displayName);
    map[displayName] = {
      name: normalizeText_(row[2]) || parsed.name || displayName,
      unit: normalizeText_(row[3]) || parsed.unit || ''
    };
  });
  return map;
}

function resolveBigcOrderItem_(rawName, metaByName, orderItemMap) {
  const original = normalizeText_(rawName);
  const mapped = (orderItemMap || {})[original];
  if (mapped && mapped.name) {
    return {
      name: mapped.name,
      unit: mapped.unit || getDefaultUnitForItem_(mapped.name)
    };
  }

  if (metaByName[original]) {
    return {
      name: original,
      unit: getDefaultUnitForItem_(original)
    };
  }

  const parsed = parseBigcOrderDisplayItem_(original);
  if (metaByName[parsed.name]) return parsed;
  return parsed.name ? parsed : { name: original, unit: '' };
}

function parseBigcOrderDisplayItem_(rawName) {
  const text = normalizeText_(rawName);
  const match = text.match(/^(.*)\s+\(([^()]*)\)$/);
  if (!match) return { name: text, unit: '' };
  return {
    name: normalizeText_(match[1]),
    unit: normalizeText_(match[2])
  };
}

function getDefaultUnitForItem_(name) {
  const units = getUnitRows_()[name] || [];
  const base = findBaseUnit_(units);
  return base ? base.unit : '';
}

function replaceBigcOrderIncomeRows_(date, cash, transfer) {
  const dateObj = parseDate_(date);
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income);
  const sourceName = 'BOY Operation System:BigC Order';
  const txId = Utilities.getUuid().slice(0, 8);
  const createdAt = now_();

  deleteRowsByPredicate_(sh, function(row) {
    return rowDateMatches_(row[0], dateObj) && isBranch_(row[1], CONFIG.bigcBranchName) && normalizeText_(row[8]) === sourceName;
  });

  const rows = [];
  addBigcIncomeRow_(rows, dateObj, 'เงินสด', cash, 'CASH', txId, createdAt, sourceName);
  addBigcIncomeRow_(rows, dateObj, 'เงินโอน', transfer, 'TRANSFER', txId, createdAt, sourceName);
  appendRows_(sh, rows);
  return rows.length;
}

function addBigcIncomeRow_(rows, dateObj, subChannel, amount, suffix, txId, createdAt, sourceName) {
  const amountNumber = toNumber_(amount);
  if (amountNumber === 0) return;
  rows.push([
    dateObj,
    CONFIG.bigcBranchName,
    'หน้าร้าน',
    subChannel,
    amountNumber,
    '',
    makeId_('BIGC-INC', dateObj, suffix + '-' + txId),
    createdAt,
    sourceName
  ]);
}

function handleSaveMultipleLeaves_(date, leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) return { status: 'success', saved: 0 };
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.leave);
  const dateObj = parseDate_(date);
  const rows = [];

  leaves.forEach(function(leave, index) {
    const name = normalizeText_(leave.name);
    if (!name) return;
    const type = normalizeText_(leave.type || 'Full Day');
    const hours = type === 'Hourly' ? toNumber_(leave.hours) : 0;
    const dayCount = type === 'Full Day' ? 1 : 0;
    const leaveId = makeId_('TAWANA-LEAVE', dateObj, String(index + 1));
    rows.push([
      dateObj,
      CONFIG.branchName,
      name,
      type,
      hours || '',
      dayCount || '',
      '',
      leaveId
    ]);
    leave.leaveId = leaveId;
  });

  appendRows_(sh, rows);
  writeLeavesV2_(dateObj, leaves.filter(function(leave) { return leave.leaveId; }));
  return { status: 'success', saved: rows.length };
}

function handleGetLeavesByDate_(date) {
  const rows = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.leave);
  const leaves = [];
  rows.slice(1).forEach(function(row, index) {
    if (!rowDateMatches_(row[0], date) || !isTawanaBranch_(row[1])) return;
    leaves.push({
      rowNumber: index + 2,
      name: row[2] || '',
      type: row[3] || 'Full Day',
      hours: row[4] || 0
    });
  });
  return { status: 'success', leaves: leaves };
}

function handleCancelLeaveRecord_(date, rowNumber) {
  const sh = sheet_(CONFIG.spreadsheets.transactions, CONFIG.sheets.leave);
  const rn = Number(rowNumber);
  if (!rn || rn < 2 || rn > sh.getLastRow()) throw new Error('rowNumber ไม่ถูกต้อง');
  const row = sh.getRange(rn, 1, 1, 8).getValues()[0];
  if (!rowDateMatches_(row[0], date) || !isTawanaBranch_(row[1])) {
    throw new Error('รายการลานี้ไม่ตรงกับวันที่หรือสาขาที่เลือก');
  }
  cancelLeaveV2_(normalizeText_(row[7]));
  sh.deleteRow(rn);
  return { status: 'success' };
}

function handleCalculateSalary_(month, year, staffList) {
  const m = Number(month);
  const y = Number(year);
  if (!m || !y) throw new Error('เดือนหรือปีไม่ถูกต้อง');

  const staff = (Array.isArray(staffList) ? staffList : [])
    .map(function(name) { return normalizeText_(name); })
    .filter(Boolean);
  const leavesByStaff = getLeavesForMonth_(m, y);
  const daysInMonth = new Date(y, m, 0).getDate();

  return staff.map(function(name) {
    const leaves = leavesByStaff[name] || [];
    let fullLeaves = 0;
    let leaveHours = 0;
    const leaveDates = {};

    leaves.forEach(function(leave) {
      leaveDates[leave.dateKey] = true;
      if (leave.type === 'Hourly') {
        leaveHours += leave.hours;
      } else {
        fullLeaves += 1;
      }
    });

    const penaltyDays = Math.min(2, Object.keys(leaveDates).length);
    const workedDays = Math.max(0, daysInMonth - fullLeaves);
    const basePay = workedDays * 400;
    const hourDeduction = leaveHours * 40;
    const bonusPay = Math.max(0, 800 - (penaltyDays * 400));
    const totalNet = basePay - hourDeduction + bonusPay;

    return {
      name: name,
      workedDays: workedDays,
      fullLeaves: fullLeaves,
      leaveHours: leaveHours,
      basePay: basePay,
      hourDeduction: hourDeduction,
      bonusPay: bonusPay,
      totalNet: totalNet
    };
  });
}

function getLeavesForMonth_(month, year) {
  const rows = values_(CONFIG.spreadsheets.transactions, CONFIG.sheets.leave);
  const result = {};
  rows.slice(1).forEach(function(row) {
    if (!isTawanaBranch_(row[1])) return;
    let key;
    try {
      key = dateKey_(row[0]);
    } catch (err) {
      return;
    }
    if (key.slice(0, 7) !== monthKey_(year, month)) return;

    const name = normalizeText_(row[2]);
    if (!name) return;
    if (!result[name]) result[name] = [];
    result[name].push({
      dateKey: key,
      type: normalizeText_(row[3] || 'Full Day'),
      hours: toNumber_(row[4])
    });
  });
  return result;
}

function handleDashboardGetMonthlySummary_(payload) {
  payload = payload || {};
  const now = now_();
  const year = Number(payload.year) || now.getFullYear();
  const month = Math.min(12, Math.max(1, Number(payload.month) || (now.getMonth() + 1)));
  const scope = dashboardNormalizeScope_(payload.branch || payload.scope || 'all');
  const previousPeriod = dashboardShiftMonth_(year, month, -1);
  const cacheKey = dashboardCacheKey_(year, month, scope);

  if (!payload.force) {
    const cached = dashboardGetCached_(cacheKey);
    if (cached) {
      cached.cacheHit = true;
      cached.servedAt = new Date().toISOString();
      return cached;
    }
  }

  const rows = {
    income: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income, 9),
    expenses: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses, 12),
    withdrawals: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.withdrawals, 11)
  };
  const metaByName = getDatabaseRowMap_();
  const current = dashboardBuildPeriod_(year, month, scope, rows, metaByName, true);
  const previous = dashboardBuildPeriod_(previousPeriod.year, previousPeriod.month, scope, rows, metaByName, false);

  const result = {
    status: 'success',
    generatedAt: new Date().toISOString(),
    cacheHit: false,
    scope: scope,
    scopeLabel: dashboardScopeLabel_(scope),
    period: {
      year: year,
      month: month,
      monthLabel: dashboardMonthLabel_(month),
      daysInMonth: new Date(year, month, 0).getDate()
    },
    previousPeriod: {
      year: previousPeriod.year,
      month: previousPeriod.month,
      monthLabel: dashboardMonthLabel_(previousPeriod.month)
    },
    summary: dashboardBuildSummary_(current.summary, previous.summary),
    dailyIncome: current.dailyIncome,
    expenseCategories: current.expenseCategories,
    topRawMaterials: dashboardTopRows_(current.rawItems, 10),
    rawMaterialIncreases: dashboardRawMaterialIncreases_(current.rawItems, previous.rawItems, 10),
    unknowns: dashboardTopRows_(current.unknownItems, 20),
    monthSeries: dashboardBuildMonthSeries_(year, month, scope, rows, metaByName, 6)
  };
  dashboardPutCached_(cacheKey, result);
  return result;
}

function dashboardBuildPeriod_(year, month, scope, rows, metaByName, includeDaily) {
  const period = {
    summary: { income: 0, expense: 0, profit: 0, rawMaterialExpense: 0, unknownAmount: 0, unknownCount: 0 },
    dailyIncome: includeDaily ? dashboardEmptyDailyIncome_(year, month) : [],
    categoryMap: {},
    rawItems: {},
    unknownItems: {}
  };

  const monthPrefix = monthKey_(year, month);
  rows.income.slice(1).forEach(function(row) {
    const info = dashboardDateInfo_(row[0], monthPrefix);
    if (!info || !dashboardScopeIncludesBranch_(scope, row[1])) return;
    const amount = toNumber_(row[4]);
    if (!amount) return;
    period.summary.income += amount;
    if (includeDaily) dashboardAddDailyIncome_(period.dailyIncome[info.day - 1], row, amount);
  });

  rows.expenses.slice(1).forEach(function(row) {
    const info = dashboardDateInfo_(row[0], monthPrefix);
    if (!info || !dashboardScopeIncludesBranch_(scope, row[1])) return;
    const entry = dashboardExpenseEntryFromExpenseRow_(row, metaByName, 1, 'actual');
    dashboardAddExpenseEntry_(period, entry);
  });

  rows.withdrawals.slice(1).forEach(function(row) {
    const info = dashboardDateInfo_(row[0], monthPrefix);
    if (!info || !isBranch_(row[1], CONFIG.bigcBranchName)) return;
    const sign = dashboardWithdrawalSign_(scope);
    if (!sign) return;
    const entry = dashboardExpenseEntryFromWithdrawalRow_(row, metaByName, sign);
    dashboardAddExpenseEntry_(period, entry);
  });

  period.summary.profit = period.summary.income - period.summary.expense;
  period.expenseCategories = dashboardFinalizeCategories_(period.categoryMap, period.summary.expense);
  return period;
}

function dashboardCacheKey_(year, month, scope) {
  return ['dashboard:v3', Number(year), String(Number(month)).padStart(2, '0'), scope || 'all'].join(':');
}

function dashboardGetCached_(cacheKey) {
  try {
    const text = CacheService.getScriptCache().get(cacheKey);
    return text ? JSON.parse(text) : null;
  } catch (err) {
    return null;
  }
}

function dashboardPutCached_(cacheKey, result) {
  try {
    const text = JSON.stringify(result);
    if (text.length <= 90000) {
      CacheService.getScriptCache().put(cacheKey, text, 600);
    }
  } catch (err) {
    // Cache is only an optimization. Dashboard correctness must not depend on it.
  }
}

function dashboardExpenseEntryFromExpenseRow_(row, metaByName, sign, sourceType) {
  const name = normalizeText_(row[2]);
  const meta = metaByName[name] || {};
  const category = dashboardResolveCategory_(row[7], row[8], meta);
  return {
    date: row[0],
    branch: normalizeText_(row[1]),
    name: name || 'ไม่ระบุรายการ',
    unit: normalizeText_(row[3]),
    qty: toNumber_(row[4]),
    amount: toNumber_(row[6]) * sign,
    mainType: category.mainType,
    subType: category.subType,
    unknown: category.unknown,
    sourceType: sourceType || 'actual'
  };
}

function dashboardExpenseEntryFromWithdrawalRow_(row, metaByName, sign) {
  const name = normalizeText_(row[2]);
  const meta = metaByName[name] || {};
  const category = dashboardResolveCategory_(row[7], '', meta);
  return {
    date: row[0],
    branch: CONFIG.bigcBranchName,
    name: name || 'ไม่ระบุรายการ',
    unit: normalizeText_(row[3]),
    qty: toNumber_(row[4]) * sign,
    amount: toNumber_(row[6]) * sign,
    mainType: category.mainType,
    subType: category.subType,
    unknown: category.unknown,
    sourceType: sign > 0 ? 'bigc-withdrawal' : 'tawana-transfer-out'
  };
}

function dashboardAddExpenseEntry_(period, entry) {
  if (!entry.name && !entry.amount) return;
  period.summary.expense += entry.amount;

  const main = entry.mainType || 'ไม่ระบุ';
  const sub = entry.subType || 'ไม่ระบุ';
  if (!period.categoryMap[main]) {
    period.categoryMap[main] = { name: main, amount: 0, count: 0, subMap: {} };
  }
  const mainRow = period.categoryMap[main];
  mainRow.amount += entry.amount;
  mainRow.count += 1;

  if (!mainRow.subMap[sub]) {
    mainRow.subMap[sub] = { name: sub, amount: 0, count: 0, itemMap: {} };
  }
  const subRow = mainRow.subMap[sub];
  subRow.amount += entry.amount;
  subRow.count += 1;

  if (!subRow.itemMap[entry.name]) {
    subRow.itemMap[entry.name] = dashboardBlankItem_(entry.name);
  }
  dashboardAddItemValue_(subRow.itemMap[entry.name], entry);

  if (main === 'วัตถุดิบ') {
    period.summary.rawMaterialExpense += entry.amount;
    if (!period.rawItems[entry.name]) period.rawItems[entry.name] = dashboardBlankItem_(entry.name);
    dashboardAddItemValue_(period.rawItems[entry.name], entry);
  }

  if (entry.unknown) {
    period.summary.unknownAmount += entry.amount;
    period.summary.unknownCount += 1;
    if (!period.unknownItems[entry.name]) period.unknownItems[entry.name] = dashboardBlankItem_(entry.name);
    dashboardAddItemValue_(period.unknownItems[entry.name], entry);
  }
}

function dashboardBlankItem_(name) {
  return { name: name || 'ไม่ระบุรายการ', amount: 0, count: 0, qty: 0, unit: '', units: {} };
}

function dashboardAddItemValue_(target, entry) {
  target.amount += entry.amount;
  target.count += 1;
  if (entry.unit) {
    target.units[entry.unit] = (target.units[entry.unit] || 0) + entry.qty;
  } else {
    target.qty += entry.qty;
  }
}

function dashboardResolveCategory_(mainValue, subValue, meta) {
  const main = dashboardCleanType_(mainValue) || dashboardCleanType_(meta && meta.mainType) || 'ไม่ระบุ';
  const sub = dashboardCleanType_(subValue) || dashboardCleanType_(meta && meta.subType) || 'ไม่ระบุ';
  return {
    mainType: main,
    subType: sub,
    unknown: main === 'ไม่ระบุ' || sub === 'ไม่ระบุ'
  };
}

function dashboardCleanType_(value) {
  const text = normalizeText_(value);
  if (!text || text === 'ไม่พบข้อมูล' || text === 'ไม่ระบุ') return '';
  return text;
}

function dashboardFinalizeCategories_(categoryMap, totalExpense) {
  return Object.keys(categoryMap).map(function(mainName) {
    const main = categoryMap[mainName];
    const subcategories = Object.keys(main.subMap).map(function(subName) {
      const sub = main.subMap[subName];
      const items = dashboardTopRows_(sub.itemMap, 100);
      return {
        name: sub.name,
        amount: dashboardRound_(sub.amount),
        percent: dashboardPercent_(sub.amount, main.amount),
        count: sub.count,
        items: items
      };
    }).sort(function(a, b) { return b.amount - a.amount; });

    return {
      name: main.name,
      amount: dashboardRound_(main.amount),
      percent: dashboardPercent_(main.amount, totalExpense),
      count: main.count,
      subcategories: subcategories
    };
  }).sort(function(a, b) { return b.amount - a.amount; });
}

function dashboardTopRows_(itemMap, limit) {
  return Object.keys(itemMap || {}).map(function(name) {
    const item = itemMap[name];
    return {
      name: item.name,
      amount: dashboardRound_(item.amount),
      count: item.count,
      qty: dashboardRound_(item.qty),
      unitText: dashboardUnitText_(item.units)
    };
  }).filter(function(item) {
    return item.amount !== 0 || item.count > 0;
  }).sort(function(a, b) {
    return b.amount - a.amount;
  }).slice(0, limit || 10);
}

function dashboardRawMaterialIncreases_(currentMap, previousMap, limit) {
  const seen = {};
  Object.keys(currentMap || {}).forEach(function(name) { seen[name] = true; });
  Object.keys(previousMap || {}).forEach(function(name) { seen[name] = true; });

  return Object.keys(seen).map(function(name) {
    const current = currentMap[name] ? currentMap[name].amount : 0;
    const previous = previousMap[name] ? previousMap[name].amount : 0;
    const change = current - previous;
    return {
      name: name,
      current: dashboardRound_(current),
      previous: dashboardRound_(previous),
      change: dashboardRound_(change),
      changePercent: dashboardPercent_(change, Math.abs(previous))
    };
  }).filter(function(row) {
    return row.current > 0 && row.change > 0;
  }).sort(function(a, b) {
    return b.change - a.change;
  }).slice(0, limit || 10);
}

function dashboardBuildMonthSeries_(year, month, scope, rows, metaByName, count) {
  const output = [];
  for (let i = (count || 6) - 1; i >= 0; i--) {
    const period = dashboardShiftMonth_(year, month, -i);
    const data = dashboardBuildPeriod_(period.year, period.month, scope, rows, metaByName, false);
    output.push({
      year: period.year,
      month: period.month,
      label: dashboardShortMonthLabel_(period.month),
      income: dashboardRound_(data.summary.income),
      expense: dashboardRound_(data.summary.expense),
      profit: dashboardRound_(data.summary.profit)
    });
  }
  return output;
}

function dashboardBuildSummary_(current, previous) {
  return {
    income: dashboardRound_(current.income),
    expense: dashboardRound_(current.expense),
    profit: dashboardRound_(current.profit),
    rawMaterialExpense: dashboardRound_(current.rawMaterialExpense),
    unknownAmount: dashboardRound_(current.unknownAmount),
    unknownCount: current.unknownCount,
    compare: {
      income: dashboardCompare_(current.income, previous.income),
      expense: dashboardCompare_(current.expense, previous.expense),
      profit: dashboardCompare_(current.profit, previous.profit),
      rawMaterialExpense: dashboardCompare_(current.rawMaterialExpense, previous.rawMaterialExpense)
    }
  };
}

function dashboardCompare_(current, previous) {
  const change = current - previous;
  return {
    previous: dashboardRound_(previous),
    change: dashboardRound_(change),
    percent: dashboardPercent_(change, Math.abs(previous))
  };
}

function dashboardEmptyDailyIncome_(year, month) {
  const days = new Date(year, month, 0).getDate();
  const rows = [];
  for (let d = 1; d <= days; d++) {
    rows.push({ day: d, cash: 0, transfer: 0, grab: 0, goku: 0, delivery: 0, other: 0, total: 0 });
  }
  return rows;
}

function dashboardAddDailyIncome_(daily, row, amount) {
  const main = normalizeText_(row[2]).toLowerCase();
  const sub = normalizeText_(row[3]).toLowerCase();
  daily.total += amount;
  if (main.indexOf('หน้าร้าน') !== -1 && sub.indexOf('สด') !== -1) {
    daily.cash += amount;
  } else if (main.indexOf('หน้าร้าน') !== -1 && (sub.indexOf('โอน') !== -1 || sub.indexOf('ธนาคาร') !== -1)) {
    daily.transfer += amount;
  } else if (main.indexOf('delivery') !== -1 && sub.indexOf('grab') !== -1) {
    daily.grab += amount;
    daily.delivery += amount;
  } else if (main.indexOf('delivery') !== -1 && (sub.indexOf('goku') !== -1 || sub.indexOf('gokoo') !== -1)) {
    daily.goku += amount;
    daily.delivery += amount;
  } else if (main.indexOf('delivery') !== -1) {
    daily.delivery += amount;
  } else {
    daily.other += amount;
  }
}

function dashboardDateInfo_(value, monthPrefix) {
  if (isBlank_(value)) return null;
  let key;
  try {
    key = dateKey_(value);
  } catch (err) {
    return null;
  }
  if (key.slice(0, 7) !== monthPrefix) return null;
  return { key: key, day: Number(key.slice(8, 10)) };
}

function dashboardNormalizeScope_(scope) {
  const text = normalizeText_(scope).toLowerCase();
  if (text === 'tawana' || text === 'ทาวน่า' || text === 'สาขา 1') return 'tawana';
  if (text === 'bigc' || text === 'big c' || text === 'บิ๊กซี' || text === 'บิ๊กซีพัทยากลาง') return 'bigc';
  return 'all';
}

function dashboardScopeLabel_(scope) {
  if (scope === 'tawana') return 'ทาวน่า';
  if (scope === 'bigc') return CONFIG.bigcBranchName;
  return 'รวม 2 สาขา';
}

function dashboardScopeIncludesBranch_(scope, branchName) {
  if (scope === 'all') return isTawanaBranch_(branchName) || isBranch_(branchName, CONFIG.bigcBranchName);
  if (scope === 'tawana') return isTawanaBranch_(branchName);
  if (scope === 'bigc') return isBranch_(branchName, CONFIG.bigcBranchName);
  return false;
}

function dashboardWithdrawalSign_(scope) {
  if (scope === 'tawana') return -1;
  if (scope === 'bigc') return 1;
  return 0;
}

function dashboardShiftMonth_(year, month, offset) {
  const d = new Date(Number(year), Number(month) - 1 + Number(offset || 0), 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function dashboardPercent_(value, total) {
  const base = Number(total);
  if (!base) return 0;
  return Math.round((Number(value || 0) / base) * 10000) / 10000;
}

function dashboardRound_(value) {
  const n = Number(value || 0);
  return Math.round(n * 100) / 100;
}

function dashboardUnitText_(units) {
  const keys = Object.keys(units || {}).filter(function(unit) {
    return toNumber_(units[unit]) !== 0;
  });
  if (!keys.length) return '';
  if (keys.length === 1) return dashboardRound_(units[keys[0]]) + ' ' + keys[0];
  return keys.slice(0, 2).map(function(unit) {
    return dashboardRound_(units[unit]) + ' ' + unit;
  }).join(', ') + (keys.length > 2 ? '...' : '');
}

function dashboardMonthLabel_(month) {
  const labels = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return labels[Number(month) - 1] || '';
}

function dashboardShortMonthLabel_(month) {
  const labels = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return labels[Number(month) - 1] || '';
}

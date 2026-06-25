const CONFIG = {
  branchName: 'สาขา 1',
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
    withdrawals: 'รายการเบิกของ',
    dailyCache: 'แคชรายวัน',
    leave: 'การลาพนักงาน',
    salary: 'สรุปเงินเดือน',
    bigcOrderMenu: 'เมนูเบิกของ BigC'
  }
};

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
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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
  return normalizeText_(value) === CONFIG.branchName;
}

function isBranch_(value, branchName) {
  return normalizeText_(value) === branchName;
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
    if (rowDateMatches_(row[0], key) && normalizeText_(row[1]) === branch) {
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
      active: row.active
    };
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
    if (!name && qty === 0 && !unit && amount === 0) return;

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
      '',
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
    snapshot.exp.push({
      i: row[2] || '',
      u: row[3] || '',
      q: row[4] || '',
      p: row[6] || '',
      m: row[7] || '',
      t: row[8] || ''
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
  const branchName = 'BigC';
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
      branchName: 'BigC',
      sourceName: 'BOY Operation System:BigC Expense',
      idPrefix: 'BIGC-EXP',
      txId: txId
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
  const headers = ['หมวดหมู่', 'รายการที่แสดง', 'รายการในชีท', 'ชั่งน้ำหนัก', 'ลำดับ', 'เปิดใช้งาน', 'อัปเดตเมื่อ'];
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
      rows.push([
        category,
        displayItem,
        mappings[displayItem] || '',
        !!weightSet[displayItem],
        index + 1,
        true,
        updatedAt
      ]);
    });
  });

  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  appendRows_(sh, rows);

  return {
    status: 'success',
    database: readBigcOrderMenu_() || database
  };
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
  return { status: 'success', saved: Object.keys(qtyData || {}).length };
}

function handleBigcOrderReceive_(date, qtyData) {
  const scriptLock = lock_();
  scriptLock.waitLock(30000);
  try {
    const dateObj = date ? parseDate_(date) : now_();
    const count = replaceBigcWithdrawalRows_(dateObj, qtyData, {
      sign: 1,
      note: 'รับสินค้าเข้า BigC',
      sourceName: 'BOY Operation System:BigC Receive',
      idPrefix: 'BIGC-WITHDRAW'
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
      note: 'คืนของให้สาขา 1',
      sourceName: 'BOY Operation System:BigC Return',
      idPrefix: 'BIGC-RETURN'
    });
    const incomeRows = replaceBigcOrderIncomeRows_(dateObj, cash, transfer);
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

  const values = sh.getRange(1, 1, sh.getLastRow(), 7).getValues();
  const categories = {};
  const weightItems = [];
  const itemMappings = {};
  let updatedAt = '';

  values.slice(1).forEach(function(row) {
    const category = normalizeText_(row[0]);
    const item = normalizeText_(row[1]);
    if (!category || !item) return;
    if (toBool_(row[5], true) === false) return;

    if (!categories[category]) categories[category] = [];
    categories[category].push(item);
    if (toBool_(row[3], false)) weightItems.push(item);

    const sheetItem = normalizeText_(row[2]);
    if (sheetItem && sheetItem !== item) itemMappings[item] = sheetItem;
    if (row[6]) updatedAt = row[6] instanceof Date ? row[6].toISOString() : normalizeText_(row[6]);
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

  deleteRowsByPredicate_(sh, function(row) {
    return rowDateMatches_(row[0], dateObj) && isBranch_(row[1], 'BigC') && normalizeText_(row[10]) === sourceName;
  });

  const rows = [];
  Object.keys(qtyData || {}).forEach(function(rawName, index) {
    const qty = toNumber_(qtyData[rawName]);
    if (qty === 0) return;

    const resolved = resolveBigcOrderItem_(rawName, metaByName);
    const meta = metaByName[resolved.name] || {};
    rows.push([
      dateObj,
      'BigC',
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

function resolveBigcOrderItem_(rawName, metaByName) {
  const original = normalizeText_(rawName);
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
    return rowDateMatches_(row[0], dateObj) && isBranch_(row[1], 'BigC') && normalizeText_(row[8]) === sourceName;
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
    'BigC',
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
    rows.push([
      dateObj,
      CONFIG.branchName,
      name,
      type,
      hours || '',
      dayCount || '',
      '',
      makeId_('TAWANA-LEAVE', dateObj, String(index + 1))
    ]);
  });

  appendRows_(sh, rows);
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

  const rows = {
    income: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income, 9),
    expenses: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses, 12),
    withdrawals: tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.withdrawals, 11)
  };
  const metaByName = getDatabaseRowMap_();
  const current = dashboardBuildPeriod_(year, month, scope, rows, metaByName, true);
  const previous = dashboardBuildPeriod_(previousPeriod.year, previousPeriod.month, scope, rows, metaByName, false);

  return {
    status: 'success',
    generatedAt: new Date().toISOString(),
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
    if (!info || !isBranch_(row[1], 'BigC')) return;
    const sign = dashboardWithdrawalSign_(scope);
    if (!sign) return;
    const entry = dashboardExpenseEntryFromWithdrawalRow_(row, metaByName, sign);
    dashboardAddExpenseEntry_(period, entry);
  });

  period.summary.profit = period.summary.income - period.summary.expense;
  period.expenseCategories = dashboardFinalizeCategories_(period.categoryMap, period.summary.expense);
  return period;
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
    branch: 'BigC',
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
  if (text === 'bigc' || text === 'big c') return 'bigc';
  return 'all';
}

function dashboardScopeLabel_(scope) {
  if (scope === 'tawana') return 'ทาวน่า';
  if (scope === 'bigc') return 'BigC';
  return 'รวม 2 สาขา';
}

function dashboardScopeIncludesBranch_(scope, branchName) {
  if (scope === 'all') return isTawanaBranch_(branchName) || isBranch_(branchName, 'BigC');
  if (scope === 'tawana') return isTawanaBranch_(branchName);
  if (scope === 'bigc') return isBranch_(branchName, 'BigC');
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

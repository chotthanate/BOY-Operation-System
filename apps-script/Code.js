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
    income: 'รายรับ',
    expenses: 'รายจ่าย',
    leave: 'การลาพนักงาน',
    salary: 'สรุปเงินเดือน'
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
      itemMeta: itemMeta
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
  const incomeRows = tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.income, 9);
  const expenseRows = tableValues_(CONFIG.spreadsheets.transactions, CONFIG.sheets.expenses, 12);
  const submitted = hasSubmittedRowsFromData_(key, incomeRows, expenseRows) ||
    PropertiesService.getScriptProperties().getProperty(propKey_('submitted', key)) === 'true';
  const sheetSnapshot = buildSnapshotFromRows_(key, incomeRows, expenseRows);
  const draftText = PropertiesService.getScriptProperties().getProperty(propKey_('draft', key));
  const hasSheetData = snapshotHasData_(sheetSnapshot);

  return {
    status: 'success',
    draft: hasSheetData ? JSON.stringify(sheetSnapshot) : (draftText || '{}'),
    submitted: submitted
  };
}

function handleAutoSave_(date, data) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().setProperty(propKey_('draft', key), JSON.stringify(data || {}));
  return { status: 'success' };
}

function handleUnlockDate_(date) {
  const key = dateKey_(date);
  PropertiesService.getScriptProperties().deleteProperty(propKey_('submitted', key));
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

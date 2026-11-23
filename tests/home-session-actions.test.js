const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homeSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const homeClient = fs.readFileSync(path.join(__dirname, '..', 'assets/js/boy-home.js'), 'utf8');
const masterSource = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');

test('home page exposes refresh and logout controls', () => {
  assert.match(homeSource, /id="home-refresh"[^>]*aria-label="โหลดข้อมูลใหม่"/);
  assert.match(homeSource, /id="logoutButton"[^>]*>ออกจากระบบ</);
  assert.match(homeClient, /\$\('home-refresh'\)\.addEventListener\('click'/);
  assert.match(homeSource, /logoutButton\.addEventListener\('click'/);
});

test('home data refresh uses the read-only API and does not edit browser drafts', () => {
  assert.match(homeClient, /client\.rpc\('get_operation_home'\)/);
  assert.doesNotMatch(homeClient, /localStorage\.(?:setItem|removeItem|clear)\(|(?:save|record)_finance_entry/);
});

test('master data toolbar stays focused on catalog work', () => {
  assert.doesNotMatch(masterSource, /id="refreshButton"/);
  assert.doesNotMatch(masterSource, /id="logoutButton"/);
});

test('logout clears local access and Supabase authentication', () => {
  assert.match(homeSource, /BOY_LOCAL_ACCESS\?\.clear\(\)/);
  assert.match(homeSource, /client\.auth\.signOut\(\)/);
  assert.match(homeSource, /location\.replace\('burger\.html\?online=1'\)/);
});

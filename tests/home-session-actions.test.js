const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const homeSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const masterSource = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');

test('home page exposes refresh and logout controls', () => {
  assert.match(homeSource, /id="refreshButton"[^>]*>↻ รีเฟรช</);
  assert.match(homeSource, /id="logoutButton"[^>]*>ออกจากระบบ</);
  assert.match(homeSource, /refreshButton\.addEventListener\('click'/);
  assert.match(homeSource, /logoutButton\.addEventListener\('click'/);
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

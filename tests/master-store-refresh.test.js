const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'boy-master-store.js'), 'utf8');

test('a failed pending sync does not block the latest Supabase catalog', () => {
  assert.match(source, /try \{ await flushOperationOutbox\(central, sheetName\); \}/);
  assert.match(source, /catch \(error\) \{ outboxError = error; \}/);
  assert.match(source, /rpc\("get_master_catalog"/);
});

test('pending edits are overlaid on the latest catalog instead of being discarded', () => {
  assert.match(source, /async function mergePendingOperations\(sheetName, catalog\)/);
  assert.match(source, /mergeLocalBulk\(current, operation\.rows \|\| \[\]\)/);
  assert.match(source, /mergeLocalSave\(current, operation\.rowNumber, operation\.values \|\| \{\}, operation\.localRowNumber\)/);
  assert.match(source, /await mergePendingOperations\(sheetName, data\)/);
});

test('local PIN sessions prefer the current Google Sheet over a stale device cache', () => {
  const fallbackStart = source.indexOf('catch (supabaseError)');
  const fallbackEnd = source.indexOf('const waiting = await pendingCount', fallbackStart);
  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.ok(fallback.indexOf('catalog = await legacyLoad()') < fallback.indexOf('const local = await cached(sheetName)'));
  assert.match(fallback, /catalog = await mergePendingOperations\(sheetName, catalog\)/);
});

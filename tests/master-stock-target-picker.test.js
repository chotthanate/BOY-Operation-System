const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { candidates } = require('../assets/js/boy-stock-target-picker.js');

const page = fs.readFileSync(path.join(__dirname, '..', 'master-data.html'), 'utf8');
const rows = [
  { item_id: 'POOL', 'ชื่อสินค้า': 'มัลเบอร์รีแช่แข็ง 1 กก.', category_id: 'fruit', subcategory_id: 'frozen', 'รูปแบบสต็อก': 'นับเป็นรายการนี้', 'เปิดใช้งาน': true },
  { item_id: 'OTHER', 'ชื่อสินค้า': 'สตรอว์เบอร์รีแช่แข็ง 1 กก.', category_id: 'fruit', subcategory_id: 'frozen', 'รูปแบบสต็อก': 'นับเป็นรายการนี้', 'เปิดใช้งาน': true },
  { item_id: 'BREAD', 'ชื่อสินค้า': 'ขนมปัง', category_id: 'bakery', subcategory_id: 'bread', 'รูปแบบสต็อก': 'นับเป็นรายการนี้', 'เปิดใช้งาน': true },
  { item_id: 'BRAND', 'ชื่อสินค้า': 'มัลเบอร์รี Savepak', category_id: 'fruit', subcategory_id: 'frozen', 'รูปแบบสต็อก': 'รวมเข้ารายการอื่น', stock_target_item_id: 'POOL', 'เปิดใช้งาน': true },
  { item_id: 'DISABLED', 'ชื่อสินค้า': 'เก่า', category_id: 'fruit', subcategory_id: 'frozen', 'รูปแบบสต็อก': 'นับเป็นรายการนี้', 'เปิดใช้งาน': false }
];

test('stock target picker recommends same subcategory and excludes brand children', () => {
  assert.deepEqual(candidates(rows, { currentId: 'BRAND', categoryId: 'fruit', subcategoryId: 'frozen' }).map(row => row.item_id), ['POOL', 'OTHER']);
  assert.deepEqual(candidates(rows, { currentId: 'POOL', categoryId: 'fruit', subcategoryId: 'frozen' }).map(row => row.item_id), ['OTHER']);
});

test('search reaches all categories and an existing cross-category target remains visible', () => {
  assert.deepEqual(candidates(rows, { categoryId: 'fruit', subcategoryId: 'frozen', query: 'ขนมปัง' }).map(row => row.item_id), ['BREAD']);
  assert.deepEqual(candidates(rows, { categoryId: 'fruit', subcategoryId: 'frozen', selectedId: 'BREAD' }).map(row => row.item_id), ['BREAD', 'POOL', 'OTHER']);
});

test('master item editor includes live stock target search and an all-categories control', () => {
  assert.match(page, /id="stockTargetSearch"/);
  assert.match(page, /id="stockTargetShowAll"/);
  assert.match(page, /wireStockTargetPicker\(\)/);
});

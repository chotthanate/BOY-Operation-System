const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'assets/js/bigc-v2.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'assets/css/bigc-v2.css'), 'utf8');

test('iPhone ordering shows three compact cards per row and desktop remains responsive', () => {
  assert.match(styles, /\.order-grid\{grid-template-columns:repeat\(auto-fit,minmax\(140px,1fr\)\)/);
  assert.match(styles, /@media\(max-width:600px\)[\s\S]*\.order-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('order summary uses circular quantity buttons', () => {
  assert.match(styles, /\.summary-row \.qty-control button\{[^}]*border-radius:50%/);
});

test('a completed receipt clears its local draft and is not seeded again', () => {
  assert.match(script, /if \(!submitted\.receive\) seedReceiveFromPrevious/);
  assert.match(script, /if \(receive\) clearCompletedReceiveDraft/);
  assert.match(script, /if \(type === "receive"\) \{\s*clearCompletedReceiveDraft\(payload\.business_date\)/);
});

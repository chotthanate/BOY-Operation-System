const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeAuthBundle, restoreLogin, selectToday } = require("../scripts/gpos-cloud/run.cjs");
const { gzipSync } = require("node:zlib");

test("decodes a compressed browser session", () => {
  const state = { storageState: { cookies: [], origins: [] }, sessionStorage: { entries: [["key", "value"]] } };
  const encoded = gzipSync(Buffer.from(JSON.stringify(state))).toString("base64");
  assert.deepEqual(decodeAuthBundle(encoded), state);
});

test("expired GPOS session never accepts service terms automatically", async () => {
  const actions = [];
  process.env.GPOS_LOGIN_EMAIL = "test@example.invalid";
  process.env.GPOS_LOGIN_PASSWORD = "test-only";
  const page = {
    url: () => "https://gpos.example/login",
    locator: () => ({ nth: () => ({ isChecked: async () => false, check: async () => actions.push("checked") }) }),
    getByPlaceholder: () => ({ fill: async () => actions.push("filled") }),
    getByRole: () => ({ click: async () => actions.push("clicked") })
  };
  await assert.rejects(restoreLogin(page), /person must accept/);
  assert.deepEqual(actions, []);
  delete process.env.GPOS_LOGIN_EMAIL;
  delete process.env.GPOS_LOGIN_PASSWORD;
});

test("today preset sets both ends of the GPOS date range", async () => {
  const values = ["2026-11-24", "2026-11-24"];
  const actions = [];
  const buttons = {
    nth: (index) => ({
      waitFor: async () => {},
      innerText: async () => values[index],
      click: async () => actions.push(`open ${index}`),
      filter: ({ hasText }) => ({ waitFor: async () => assert.equal(values[index], hasText) })
    }),
    count: async () => 2
  };
  const page = {
    getByRole: () => buttons,
    evaluate: async () => { values.fill("2026-11-25"); actions.push("today"); return true; }
  };
  await selectToday(page, "2026-11-25");
  assert.deepEqual(actions, ["open 0", "today"]);
});

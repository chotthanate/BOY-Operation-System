const test = require("node:test");
const assert = require("node:assert/strict");
const { restoreLogin } = require("../scripts/gpos-cloud/run.cjs");

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

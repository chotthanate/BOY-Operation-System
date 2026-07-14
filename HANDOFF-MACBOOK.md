# BOY Operation System Handoff For MacBook

## Current role

`BOY-Operation-System` is the new copy / next-system repo.
It is separate from the old `TAWANA_ACC` frontend.

This repo currently points to the new BOY workbook family and its own Apps Script web app.

## Repo

- Local path: `C:\Users\ADMIN\Documents\Codex\2026-05-03\codex\BOY-Operation-System`
- Remote: `https://github.com/chotthanate/BOY-Operation-System.git`

## Live backend

- Apps Script project source: `apps-script/Code.js`
- Current web app URL:
  `https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec`

## Google Sheets in use

- `BOY_Master`
  `11LqJbnCQQvNIV8tNgoh2x_JGLZWofUaxrpzHUp6U-po`
- `BOY_Transactions`
  `1HGipIF8DIJO5zZhugXS96k909pF-EsSpeup41Y82-aQ`
- `BOY_Costing`
  `1d1RZDzCT8CI1Nmow-JiRYZjfZuAevkYDITpo0ynpWzk`
- `BOY_Reports`
  `1duSHa5Pzjyw9kAstn_UPu1PlXQWkVD6ukFVf7zXHnqc`

Important:
This repo is not pointing back to the old TAWANA sheets.
It uses the new BOY sheets above.

## Frontend pages

- `index.html`
  Menu page only.
  `Admin` is still disabled.

- `tawana.html`
  Connected to live BOY backend.
  Handles income, expenses, leave, salary, daily load, autosave, submit, and unlock.

- `bigc.html`
  Connected to live BOY backend.
  Expense-only page for `บิ๊กซีพัทยากลาง`.

- `bigc-order.html`
  Connected to live BOY backend.
  Supports menu load, draft autosave, receive, and return.
  Note: `order` currently stores order data in `PropertiesService`; it does not yet write an order-history sheet.

- `dashboard.html`
  Read-only reporting page.
  Reads monthly summary from Apps Script.

## Backend status

Actions confirmed in `apps-script/Code.js`:

- Shared / database
  - `shared_loadDB`
  - `pullItems`
  - `database_getRows`
  - `database_saveItem`
  - `database_setActive`

- Tawana flow
  - `loadData`
  - `autoSave`
  - `submit`
  - `unlockDate`
  - `saveMultipleLeaves`
  - `getLeavesByDate`
  - `cancelLeaveRecord`
  - `calculateSalary`

- BigC expense flow
  - `bigcExpenseLoadData`
  - `bigcExpenseAutoSave`
  - `bigcExpenseSubmit`
  - `bigcExpenseUnlockDate`

- BigC order / receive / return flow
  - `bigcOrderLoadDB`
  - `bigcOrderLoadDraft`
  - `bigcOrderAutoSave`
  - `bigcOrderSaveDB`
  - `bigcOrderRebuildMenuFromMaster`
  - `bigcOrderSubmitOrder`
  - `bigcOrderReceive`
  - `bigcOrderReturn`

- Dashboard
  - `dashboardGetMonthlySummary`

## Not finished yet

- `database_syncToStock` is still a placeholder.
- `syncCloud` is not a real sync job; current behavior is basically "read directly from BOY_Master".
- `Admin` page is not built yet.
- `bigc-order` still needs a real order-history write flow if the business wants order records in Sheets.

## Current local-only state

At the time of this handoff, the local repo still has uncommitted changes:

- `apps-script/Code.js`
- `HANDOFF-MACBOOK.md`

This means:

- MacBook will only see what is already in GitHub.
- MacBook will not automatically see these latest local changes until this repo is pushed.

## Sheet-side work already done outside the repo

These are live sheet changes, not repo files:

- `BOY_Master > Usable Weight`
  - Formula behavior was adjusted so UW can calculate from the number of trials actually filled in, not only when all 5 trials are present.
  - Example checked: `ส้ม` row now calculates `UW สกัด` and `UW รวมสกัด`.

- `BOY_Master > รายการเบิกของ`
  - Rebuilt from master data plus special BigC withdrawal rows.

Because these are Google Sheet edits, MacBook will see them when opening the same live sheets.

## Recommended next tasks

1. Push current repo state so MacBook sees the latest `apps-script/Code.js`.
2. Finish `Admin` / stock sync flow.
3. Decide whether `bigc-order > order` must write to a transaction/history sheet.
4. Continue cleaning Thai text encoding in local source files if needed.

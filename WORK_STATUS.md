# Work Status

## 2026-11-15: Shared partial receiving + GRILL admin opening balances

- Applied `20261115082922_shared_receiving_and_grill_admin_stock`. GRILL/Burger device RPC signatures remain unchanged and delegate to a single private line-receiving core. New authenticated web RPC uses branch access, receipt/stock locks, expected_received, request deduplication and proportional rounding. Existing GRILL/Burger audit action names remain intact, so both POS histories include web receipts.
- Shared `burger.js` receiving UI now has per-bill collapsible cards, checkboxes, actual quantities, partial/final status, recent history and durable exact-request retries after uncertainty. Only the confirmed bill draft is cleared; other bills remain untouched. Automatic reads retain the existing 5-minute/backoff budget and manual refresh.
- GRILL admin stock API requires a live active company-admin identity plus GRILL device token; anon/ordinary device-only STOCK_ADJUST is denied. Records actor/reason/before-after, rejects stale quantities and deduplicates retries. Current single-location setup is supported; multiple locations are explicitly rejected instead of guessing.
- Backend rollback tests passed admin/staff/device authorization, conflicts, deduplication, negative quantities, web→POS partial completion, value rounding, history, legacy receiver guards, GRILL/Burger regressions. Browser fixtures passed 390px receiving and admin stock, response loss/reload retries and staff-hidden controls; no business QA rows remain.
- GRILL source 1.34/code35 is in the separate grill-pos repo (bbe18e1). After the user confirmed Install via USB was already enabled, replacement installation on USB tablet `mvi74llreqoflrfe` succeeded. Verified versionName=1.34/versionCode=35 and launched MainActivity; IndexedDB/Local Storage directories remain present. No uninstall/clear/reset was performed. Private pre-update backup `/private/tmp/grill-pos-before-1.34.tar` is 0600 and contains sensitive app data: never commit/upload it. Actual owner-auth/manual stock save still needs the user's real quantity and online admin confirmation; no opening balances were guessed or changed. Local six-digit screen PIN is not online authorization.
- Burger 1.9/code10 remains prepared from the previous round and still awaits its tablet. No historical business data/queues were imported, cleared or reset. Daily finance remains ACTIVE as recorded below.

## 2026-11-15 current state: Daily finance ACTIVE; mirror verified

- User explicitly approved only the two anon boolean APIs. Applied `20261114231913_public_finance_boolean_endpoints`; anon still has no USAGE on boy_central, no SELECT on transactions and no EXECUTE on the Vault-key getter. The pending SQL was moved into the applied migrations directory.
- Production and test Apps Script deployments now use immutable version 79. Backed up and compared remote HEAD before push; only the reviewed verifier error diagnostic differed. Real HMAC probe/read-back succeeded, then a 60,000-Thai-character payload split across cells succeeded and an old revision returned stale=true. The large direct pg_net-to-Google probe timed out before reaching Apps Script; the actual fetch transport used by the worker passed, so do not use pg_net direct large-body tests as worker evidence.
- Real worker pipeline probe `048b361a-ec02-4c0a-9814-57e849002f62` was claimed once and marked synced with no error. This is a clearly labelled QA archive entity only, not a sale, expense or stock movement. No business history was imported or reset.
- Frontend `financeCutover=true` with Bangkok date 2026-11-15 is live on GitHub Pages (commit fe73a87), with versioned config on both legacy target forms. Backend `daily_cutover_control.active=true` is confirmed. Both online forms load normally with the authenticated browser; BigC explicitly displays 370 catalog entries. Same-day pre-cutover Sheet submissions are protected as read-only archives too. Nine quarantined item mappings remain excluded until reviewed.
- Existing business counts increased from 3130/1906 to 3131 transactions/1909 stock movements during rollout; the newest source is an ordinary BURGER POS transaction, not a QA row. Do not delete or reset it. Daily submitted document count is still 0; rollout probes did not create financial entries.
- Authenticated live browser draft tests succeeded for Tawana 2099-12-30 and BigC Central 2099-12-29: typed QA notes appeared in daily_drafts revision 1. Cleared the notes through the forms and saved empty drafts back; these are draft-only future test dates, not financial documents. No submit/financial-post action was clicked. Automated Node suite 126/126 and 390/1440px fixtures passed; the full transactional SQL flow suite passed in earlier rollback runs, while a redundant rerun in this rollout expired at the connector confirmation rather than executing.

## 2026-11-15 follow-up: Google consent completed; boolean API authorization still pending

- User completed Google consent. Apps Script test deployment is now version 78; production remains 76. End-to-end testing found/fixed missing `/rpc/` in verifier/status URLs. The next test exposed the remaining cause: the public invoker wrappers cannot access `boy_central` as anon (HTTP 401), not a bad HMAC. No business data or archive probe was written.
- A narrowly scoped wrapper change is prepared in `supabase/pending/public_finance_boolean_endpoints.sql`, **not applied**. Auto-review rejected making these public boolean endpoints privileged without explicit anon/scope consent. Asked user to approve only `verify_central_mirror` (signature boolean) and `daily_finance_active` (activation boolean), with no table/key access and no schema USAGE grant. Do not bypass the rejection. Finance remains OFF on both frontend/backend; production Apps Script has not changed.
- Applied `20261114230244_daily_expense_definition_identity_guard`: fixes general-expense UUID submission without treating it as a stock item. Added a rollback test that actually posts a mapped general expense. Existing production transaction/stock counts still 3130/1906 after tests.
- Shared `burger.js` expense forms now offer immediate/delivery for physical purchases and group by payment + receiving mode. New payloads use v4; durable old queues without receiving_mode still use v3 unchanged. This applies to the shared Burger/GRILL/BigC South form, independent of the disabled legacy Tawana/BigC Central cutover.
- Applied `20261114231132_burger_partial_purchase_receipts`: Burger-token-scoped private receivers/public RPCs, shared receipt/balance/movement tables, per-request deduplication, line expected_received conflict guard, bounded actual quantities, weighted cost rounding, receipt history and legacy whole-bill double-count guard. SQL `tests/burger-receipts.sql` passed in BEGIN/ROLLBACK; no QA records remain. Web can receive an untouched full bill; a partially received Burger bill must currently be completed through the new POS, not the old full-bill web button.
- Burger source prepared as 1.9/code 10 in `/Users/call_center/Documents/Codex/2026-07-14/8c/work/burger-pos-review`: new per-bill checkbox/quantity screen, exact-request persistence after network uncertainty, receipt history. Source build, 3 unit tests and isolated mobile/reload/network browser fixture passed. No tablet installation or clearing performed. Capacitor android/core/cli pinned to security-patched 8.5.1; npm audit still reports other build-tool dependency findings, so do not claim a completely clean dependency audit.

## 2026-11-15: Daily finance backend installed; activation waiting for Google consent

- Actual target forms are `tawana.html` and `bigc.html` (BigC Central), not the BigC ordering page. Added a compact immediate/delivery selector for physical items, preserving expense UUIDs and receiving mode in drafts. The selector stays hidden while `financeCutover=false`.
- Applied seven finance migrations `20261114221157` through `20261114222435`: daily documents/revisions/idempotency, server Sheet mirror queue, reporting policies, compact POS projections, secured scheduler, receiving modes and activation guards. No old transactions were imported or rewritten. `daily_cutover_control.active=false` and frontend `financeCutover=false` remain intentional.
- Live `central-mirror-worker` version 2 is deployed with Vault/HMAC authorization and UTF-8 bounded batches. Scheduler is gated OFF. Apps Script HEAD contains only the reviewed Code.js/manifest changes; immutable version 77 and a separate test deployment exist (`AKfycbxDvOiieWQFPLPeTOwtT7QZ5rtMK-Pj0X9XZ2BqAwWhs3uNKKF0uMWYY76UKkN_KM9lpg`). Production deployment remains version 76.
- User explicitly approved the two-file Apps Script update and external-request scope. Signed test probe reached version 77 but returned a Google missing `script.external_request` permission error; no mirror row was written. Safari opens the owner project but the authorization popup redirects to “page not found” with multiple Google accounts. User must authorize from an owner-only browser session: select **verifyCentralMirrorSetup** and Run. This helper is read-only; do not run reset functions. HEAD includes this helper after version 77; create a fresh immutable version after consent.
- Never activate finance or redeploy the production Apps Script until a signed mirror probe has a successful verified read-back. Then set an explicit Bangkok cutover date, switch frontend/backend together, cache-bust config, test an authenticated form save and Dashboard/Sheet agreement. Historical submitted Sheet dates must remain labelled read-only until separately reconciled; no Sheet save fallback.
- Node suite: 123/123 passed. SQL tests `daily-receiving-modes.sql` and `central-financial-flow.sql` passed inside BEGIN/ROLLBACK, including immediate vs delivery stock, retry deduplication, income-only corrections, stale conflicts and auth. Browser fixtures for both forms at 390/1440 px passed identity, receiving mode and no horizontal overflow. Fixtures block all external requests and are not live iPhone testing.
- Post-test production counts unchanged: transactions 3130, stock movements 1906, daily documents 0. Nine Master/runtime rows remain quarantined and are excluded from the new daily catalog; do not guess their mappings or units.
- Burger POS partial receiving/new APK and all-other-branch receiving selectors remain follow-up work. No Burger tablet was installed or cleared in this round.

## 2026-11-14: Frozen Aro lychee code separated from burger bread

- Applied `20261113213305_separate_frozen_aro_lychee_from_bread` to Supabase. The Master Aro frozen lychee and purchase-unit mapping `IU-00288` now use `ITEM-0400`; its runtime item has its own UUID and still points to the frozen-lychee pooled stock `ITEM-179326699290620`.
- The burger bread remains `ITEM-0336`. Verified its 927 stock movements and 12 recipes were not moved; the new Aro item has zero movements and zero recipes.
- Updated only the Aro product row and four Aro branch-reference rows in the `BOY_Master` Google Sheet mirror; verified their new codes after write. Bread brand targets that legitimately reference `ITEM-0336` were left unchanged.
- This resolves one of the 10 previously quarantined bridge rows; the other nine still require separate review. Finance cutover remains OFF. The previous 2026-11-09 section below records the historical pre-fix state.

## 2026-11-09: Master/runtime bridge applied; financial cutover still OFF

- ใช้ migration `20261108225652_master_runtime_identity_bridge` บน Supabase แล้ว เพิ่มสินค้า runtime ใหม่ 95 แถว (231 → 326) และ expense definitions 59 แถว (79 → 138) โดยใช้ company + code, ไม่ใช้ชื่อในการตัดสินว่าเป็นสินค้าเดียวกัน
- มี persistent links พร้อมใช้ 369 แถว: สินค้า 309 + ค่าใช้จ่าย 60; หนึ่งค่าใช้จ่ายอ้าง definition เดิมด้วย explicit ITEM→EXP code จึงไม่สร้างซ้ำ เปลี่ยนชื่อผ่าน Master หลังเชื่อมแล้วรักษา UUID; การเปลี่ยนหน่วยฐานที่มีธุรกรรม/สูตร/กลุ่มสต็อกจะถูกปฏิเสธแทนการตีความประวัติใหม่
- แยกรอทบทวน 10 แถว: หน่วยว่าง 3 (เครื่องปั่น/ปากกาเมจิก/เครื่องสกัด), ชื่อชนต่างรหัส 4 (มะพร้าว/แคนตาลูป/มะละกอ/ค่าขนส่ง), หน่วยต่างจาก runtime 3 (ขนมปังเบอร์เกอร์/เนื้อนกกระจอกเทศ/ITEM-0336)
- **พบ code reuse สำคัญ:** Master `ITEM-0336` คือ “ลิ้นจี่ แช่แข็ง aro 1 กก.” หน่วยถุง แต่ runtime code นี้เป็น “ขนมปัง” หน่วยชิ้นและมีประวัติเดิม ห้ามเปิดใช้แถวนี้หรือ sync ชื่อ/หน่วยทับโดยอัตโนมัติ ต้องแยกตัวตนลิ้นจี่กับขนมปังโดยรักษาประวัติเดิมก่อน financial cutover
- Initial bridge ไม่เปลี่ยน UUID/ชื่อ/หน่วย/ธงสต็อกของ runtime เดิม, ไม่เขียนธุรกรรม สต็อกเคลื่อนไหว ยอดคงเหลือ หรือสูตร และไม่ย้ายยอดที่มีอยู่ ไม่มีการตั้งยอดสต็อกแทนผู้ใช้
- เพิ่ม guard แถว quarantine อีกชั้น: การแก้ชื่อหรือข้อมูล Master ของรายการที่หน่วย/ตัวตนขัดแย้งจะยังไม่เขียนทับ runtime จนกว่าจะยืนยัน mapping ทดสอบเปลี่ยนชื่อลิ้นจี่ใน transaction แล้วขนมปังเดิมไม่เปลี่ยน ผ่าน
- SQL `tests/master-runtime-bridge.sql` ทดสอบ migration ใน BEGIN/ROLLBACK ผ่าน preservation, idempotent backfill, rename keeps UUID, historical unit guard, private function privileges และ code-reuse quarantine; Node เดิม 119 กรณีผ่าน ตรวจ advisors หลัง apply ไม่มี finding ที่อ้างถึงตาราง bridge ใหม่
- Four finance migrations จากรอบก่อนยังไม่ apply, worker/Apps Script ยังไม่ deploy และ `financeCutover=false` เช่นเดิม การเชื่อม Master ครั้งนี้ไม่ใช่การเปิดบันทึกการเงินเส้นทางใหม่
- ก่อนเดินต่อ: ให้เจ้าของยืนยันการแยกสินค้ารหัสที่ถูกใช้ซ้ำ; จากนั้นปรับ catalog/financial adapters ให้ใช้ links และแสดงเฉพาะแถว ready (รวม expense definitions) ตรวจข้อมูลเก่า/คิวแบบ preview ก่อนย้าย และทดสอบ mirror/อุปกรณ์จริงก่อนเปิด flags


## 2026-11-05: Finance cutover prepared, NOT activated

- เตรียม RPC บันทึกรายวันทาวน่า/BigC Central, ร่างแยกผู้ใช้, request UUID กันส่งซ้ำ, revision กันเขียนทับ, ประวัติ revision, ยกเลิกรายจ่ายเดิมก่อนแก้, และคิวสำเนาชีตใน transaction เดียวกัน โค้ดอยู่ใน migrations ใหม่ 4 ไฟล์และ `boy-daily-store.js`
- **ยังไม่ได้ apply migrations ทั้ง 4, deploy Edge Function หรืออัปเดต Apps Script**: ทดสอบทั้งหมดใน `BEGIN/ROLLBACK` เท่านั้น ตรวจหลังทดสอบแล้วไม่มีตารางใหม่และไม่มีธุรกรรม QA ค้าง การ commit/push รอบนี้ไม่ใช่การเปิดใช้ finance cutover
- `BOY_CENTRAL_CONFIG.financeCutover=false` โดยตั้งใจ; ทาวน่า/หน้า `bigc.html` ยังใช้เส้นทางเดิม ห้ามเปลี่ยนเป็น true ก่อนแก้ data readiness และทดสอบ mirror จริง ห้ามบอกผู้ใช้ว่าทั้งสองหน้าย้ายไป Supabase เสร็จแล้ว
- จุดหยุดจากการตรวจจริง: M_สินค้าเปิดใช้งาน 318 แถว; join company + business code ไป `items` ได้ 217 แถว ขาด UUID 101 แถว (84 มีหน่วยที่จับด้วย code ได้, 17 ไม่มีหน่วยฐานที่จับได้) นี่คือความต่างระหว่าง master catalog กับ runtime ไม่ใช่สินค้าถูกลบ ต้องทำ normalization bridge แบบรักษา UUID เดิม/ตรวจ conversion และให้เจ้าของกำหนด 17 หน่วยที่ขาด ห้ามจับคู่ด้วยชื่อหรือสมมติหน่วย ตรวจซ้ำด้วย `tests/central-data-readiness.sql`
- `M_รายการค่าใช้จ่าย` อีก 61 แถวยังไม่ตรง code กับ runtime expense definitions; ห้ามตัดออกจากตัวเลือกหรือ import ทับ ต้องรักษา mapping ITEM/EXP และเส้นทางบันทึกให้ถูกประเภทก่อนเปิด catalog ใหม่
- รายรับตามโจทย์: ทาวน่าเจ้าของกรอกเอง, BigC Central พนักงานกรอกสรุปกะ, South/Burger/Grill จาก POS ปิดกะ SQL แยก source หลัก ไม่บวกยอดบิลซ้ำกับกะ และเตรียมให้เปลี่ยน POS branch หลังได้รับกะจาก client ใหม่จริง (ทาวน่ายังคง manual)
- เตรียม `central-mirror-worker` + cron ทุก 5 นาทีเฉพาะเมื่อมีงานค้าง ใช้ HMAC/Vault; Apps Script ขอผลตรวจลายเซ็น boolean จาก Supabase ไม่ต้องแจก service-role หรือใส่ signing secret ในเว็บ/ชีต สำเนา UUID + revision และอ่านกลับก่อน ACK; ยังทดสอบด้วย mock เท่านั้น **ต้องทดสอบ end-to-end และ payload ใหญ่/หลาย revision ก่อน deploy**
- การเรียก Apps Script Execution API ผ่าน clasp ใช้ไม่ได้ด้วยบัญชีปัจจุบัน แม้แก้/เผยแพร่โค้ดได้; ไม่เพิ่ม public configure-secret endpoint เพื่อข้ามข้อจำกัด ใช้ verifier ฝั่ง Supabase แทน แต่ยังไม่ได้เปิดจริง
- ลด egress ที่ทำแล้วในโค้ด: Dashboard cache 60 วินาทีแยก user; refresh เองข้าม cache; capacity cache 24 ชม.; daily catalog 15 นาที + version; debounce ร่าง 8 วินาทีพร้อม local draft ทุก input; POS delta และ compact image-free projection เตรียมไว้หลัง feature flag ยังไม่ได้วัด egress รอบบิลจริง
- Free ระยะยาว: เตรียม guardrail 60/75/85% และ archive manifests แต่ **ยังไม่มี archive/restore ที่ตรวจผ่านหรือ purge ข้อมูลธุรกิจ** จึงรับรอง Free ตลอดไปไม่ได้ ต้องทดสอบสำรอง/restore และกำหนดระยะเก็บรายละเอียดก่อนถึง quota ห้ามลบ orders/events เพื่อประหยัดโดยไม่มีสำเนาที่ตรวจแล้ว
- ผลทดสอบ: Node 119/119 ผ่าน; SQL rollback ผ่าน idempotency, stale revision conflict, correction/void, revision audit, แหล่งรายรับ, mixed cutover payment, POS close retry/conflict, delta no-change, สิทธิ์ anon และ HMAC tamper/expiry; ไม่มี QA records ค้าง ไม่ใช่หลักฐานทดสอบ iPhone/แท็บเล็ตจริงหรือ Google Sheet production ผ่าน
- Burger และ GRILL Vite build ผ่านทั้งค่า default และ `VITE_CENTRAL_FINANCE_V2=true`; GRILL มี warning path ฟอนต์/โลโก้เดิมและ chunk ใหญ่ ต้องตรวจ Android ก่อนใช้งานจริง ไม่ได้ติดตั้ง APK รอบนี้
- Burger source อยู่ repo `burger-pos` (เตรียม 1.8); Water source `/Users/call_center/CodexProjects/water-pos` (1.1.8), GRILL source `/Users/call_center/Documents/Codex/2026-10-29/files-mentioned-by-the-user-grill/work/GRILL_POS` (1.27) สองหลังไม่ใช่ Git repo; เก็บ source overlay แยกใน workspace artifacts ห้ามกล่าวว่า push GitHub ทำให้แท็บเล็ตอัปเดตแล้ว
- งานถัดไป: (1) normalization + 17 หน่วย (2) preview/reconcile ประวัติ Sheet และคิวเดิมโดย UUID/code/ยอด ก่อนนำเข้า (3) deploy backend/worker/Apps Script ทดสอบ read-back (4) เปิด flags และทดสอบบันทึกจริงสองเครื่อง (5) ติดตั้ง POS โดยไม่ล้างข้อมูลแล้วเทียบ Dashboard/ชีต/สต็อก จึงถือว่า cutover เสร็จ


## BigC พัทยาใต้และตรวจความพร้อม (5 พ.ย. 2569)

- เพิ่ม `BIGC-SOUTH-PATTAYA` โดยเปิดใช้ Master สาขาเดิม `BR-003`; สร้าง normalized branch/location, สิทธิ์ admin/manager และสำเนาการตั้งค่า/สินค้า 157 รายการจากพัทยากลาง **ไม่คัดลอก** ยอดสต็อก ประวัติ ร่าง หรือสิทธิ์ staff ของสาขาเดิม
- หน้า `bigc-south.html` เปิดรายจ่ายผ่านฟอร์ม Supabase ร่วม ส่วน `bigc-south-order.html` เปิด BigC v2 แบบแยก namespace/API ตามสาขา; สินค้ากลางและ usable yield ยังใช้ชุดกลางเดียวกัน การเพิ่มสิทธิ์พนักงานให้สาขาใต้ต้องทำก่อนแจก staff link ไม่ถือว่า staff ของพัทยากลางมีสิทธิ์โดยอัตโนมัติ
- ใช้ migrations `bigc_south_branch_scope` และ `bigc_dashboard_income` บน Supabase แล้ว; Dashboard รวม/สาขารับยอดสรุป BigC และโอนต้นทุน โดยไม่สร้างธุรกรรมซื้อหรือบิล POS ซ้ำ (ถ้าวันนั้นมี POS ใช้ยอด POS แทนยอดปิดวัน)
- Apps Script deployment เดิมเผยแพร่เวอร์ชัน 76 แล้ว สำรองพัทยาใต้ใน `T_BigC_South_Workflows` ด้วย UUID แบบ idempotent ไม่ผ่าน routine/cache พัทยากลาง; JSON ยาวแบ่งคอลัมน์ละไม่เกิน 45,000 ตัวอักษร แท็บจะสร้างเมื่อสำรองเอกสารแรก ทดสอบ handler ด้วย mock และตรวจ health action บน deployment จริงแล้ว ยังไม่ได้สร้างรายการธุรกิจทดลองลงชีตจริง
- SQL ทดสอบแบบ BEGIN/ROLLBACK ผ่าน: แยก context/order/draft, กัน source workflow ข้ามสาขา, รักษา RPC พัทยากลาง, รายจ่าย Supabase/idempotent retry, ยอดขาย 120 - รายจ่าย 12 = Dashboard สุทธิ 108; ไม่มีธุรกรรมทดสอบค้าง
- ตรวจ 5 พ.ย.: ORDER events เก่าที่ระบุ `source_system=water_pos` 1,220 รายการ จับคู่ `pos_orders` ด้วย branch + external_id ได้ครบ 1,220 (ห้ามใช้ raw_payload/external_id หรือ source_system เทียบแบบเก่าแล้วสรุปว่าขาด 473 รายการ) ข้อมูลชุดนี้อยู่สาขา BURGER ไม่ใช่หลักฐานว่าแท็บเล็ตร้านน้ำปัจจุบันเชื่อมครบ
- **ยังไม่พร้อมประกาศว่ารายรับ/รายจ่าย/สต็อกทุกร้านรวมเป็นระบบเดียวครบ:** ทาวน่าและหน้า `bigc.html` ยังบันทึกรายจ่ายผ่าน Apps Script; ยังต้อง cutover และกระทบยอดก่อนต้นทุนเฉลี่ยจากรายจ่ายทาวน่าจะไหลเข้าฐานกลางครบ ค่า stock ปัจจุบัน Burger ติดลบ 18 แถว/Grill 6 แถว (ยอดทดลอง) ต้องตั้งยอดจริง ไม่ปรับยอดแทนผู้ใช้
- BigC ทั้งสองสาขามีเมนูใช้งาน 162 รายการ แต่ `itemId` ยังว่าง 3 รายการ และไม่มีเมนูที่เปิด `stockAtBigc` ในการตั้งค่าจริง ณ รอบตรวจนี้ ต้องตรวจ mapping/หน่วยและตั้งยอดเริ่มต้นก่อนเปิดตัดสต็อกจริง ไม่เปิด flags แทนผู้ใช้ขณะที่ทาวน่ายังไม่มียอดพร้อมเบิก
- POS ปิดกะ/รายจ่ายยังต้องตรวจการกระทบยอดเข้าตารางกลางแยกจาก snapshot/local/Sheet ของแต่ละแอป โดยเฉพาะ GRILL ที่ยังไม่ยืนยันติดตั้งรุ่นล่าสุดบนแท็บเล็ต ไม่ถือว่าทดสอบอุปกรณ์จริงผ่านจากการทดสอบเว็บหรือ SQL
- ชุดทดสอบ Node ทั้งหมดผ่าน 103 รายการ (รวมแก้ fixture/assertion BigC เก่าที่ไม่ตรง UI ปัจจุบัน); ตรวจ UI 390px แล้ว ปุ่มลบ/เสร็จสิ้นอยู่บรรทัดเดียว และ Dashboard มีแถบนำทางแยกตามสาขา

## หน้าลงค่าใช้จ่ายร่วม (5 พ.ย. 2569)

- หน้า Home รวมร้านไว้ใต้หัวข้อ “เว็บลงค่าใช้จ่าย”; `expenses.html` เปิดทาวน่าเป็นค่าเริ่มต้นและรองรับ query `branch` สำหรับแต่ละร้าน ใช้เมนูด้านซ้ายและรูปแบบ UI ร่วมใน `expense-app.js/css` โดยคง URL และร่างเดิมของแต่ละร้านไว้
- การปรับครั้งนี้รวม UI/ขั้นตอนกรอก แต่ **ยังไม่เปลี่ยนเส้นทางบันทึกทาวน่า/BigC เก่าจาก Apps Script เป็น Supabase**; เบอร์เกอร์/เนื้อย่างยังใช้ `record_expense_v3` อย่ารายงานว่าการย้ายระบบบันทึกทุกสาขาเสร็จแล้ว การ cutover ต้องกระทบยอด Master และประวัติเดิมก่อน
- เบอร์เกอร์/เนื้อย่างเลือกสินค้าที่เปิดกับสาขาได้แม้ไม่มี expense definition แยก และรักษา UUID/จำนวน/หน่วยของสินค้าที่ไม่ติดตามสต็อก; รายการมี stock target ยังใช้ definition เดิม เพื่อคงอัตราแปลงที่ตรวจไว้
- Supplier อัตโนมัติใช้เฉพาะเมื่อสินค้ามีผู้ขายเดียวจาก mapping ที่เปิดใช้งาน รองรับ normalized mappings และ `M_ผู้ขายสินค้า` ใน Supabase; ไม่ใช้จำนวนผู้ขายทั้งหมดในร้านเป็นเงื่อนไข และไม่ทับชื่อที่กรอกเอง
- วิธีชำระของเบอร์เกอร์/เนื้อย่างเลือกแยกแต่ละการ์ดได้ บันทึกแยกธุรกรรมตามวิธีชำระ แต่เก็บ request/idempotency ใน outbox ก่อนส่ง กรณีเน็ตหลุดเก็บรอส่ง กรณีถูกปฏิเสธคืนเฉพาะกลุ่มที่ไม่สำเร็จกลับฟอร์ม และไม่ล้างร่างรายการอื่นเมื่อส่งคิวสำเร็จ
- ทดสอบที่เกี่ยวข้อง 23 กรณีผ่าน, UI fixture ที่ 390/1440 px ผ่าน, และ SQL `BEGIN … ROLLBACK` ยืนยันสินค้าที่ไม่ติดตามสต็อกยังเก็บ UUID/จำนวน/หน่วยใน transaction lines ได้ ไม่มีรายการทดลองค้าง; baseline failures BigC 2 กรณีเดิมยังอยู่ (ไฟล์ BigC v2 ไม่ได้เปลี่ยนในรอบนี้)

## ลดโควตาและรองรับเน็ตหลุด (2 พ.ย. 2569)

- เว็บสาขาและ Burger POS ลดการตรวจรายการรอรับอัตโนมัติจาก 15 วินาทีเป็น 5 นาที มี backoff เมื่อผิดพลาด; ปุ่มรีเฟรชเองยังทำงานทันที Dashboard เก่าใน burger.html ใช้ RPC สรุปแทนโหลดบิลทั้งหมดแล้ว
- GRILL source ที่เครื่อง Mac (`Documents/Codex/2026-10-29/files-mentioned-by-the-user-grill/work/GRILL_POS`) เพิ่ม outbox 1.22; ต้องติดตั้ง APK และเปิดออนไลน์สำเร็จอย่างน้อยหนึ่งครั้งก่อนใช้แคชออฟไลน์ ห้ามล้างข้อมูล/ถอนแอปขณะมีบิลรอซิงก์ การยกเลิกบิลยังต้องออนไลน์และส่งบิลค้างครบก่อน
- ยังไม่ได้ยืนยันติดตั้ง GRILL 1.22 บนอุปกรณ์จริง; การติดตั้ง 1.21 รอบก่อนถูก Android ปฏิเสธ ต้องให้ผู้ใช้อนุญาตบนเครื่อง ไม่ถอนแอปเพื่อเลี่ยงปัญหา
- ตรวจฐานข้อมูลได้ประมาณ 46 MB แต่ **ยังไม่มีตัวเลข Egress รอบบิลจริง** จึงยังรับรองว่า Free ใช้ครบเดือนไม่ได้ ตรวจ Usage ขององค์กร BOY รวมทุกโปรเจกต์; ใช้ยอดที่เหลือ/จำนวนวันที่เหลือเทียบค่าเฉลี่ยรายวัน และเตือนก่อน 60/75/85% ห้ามใช้ขนาดฐานข้อมูลแทน Egress
- Backup script มีแล้ว แต่ยังไม่ยืนยันตั้งค่ารหัสลับ/ตั้งเวลาหรือทดสอบ restore จริง ห้ามกล่าวว่าสำรองอัตโนมัติพร้อมใช้จนทดสอบครบ และไม่ลบ pos_sync_events เพราะใช้กันบิลซ้ำ
- ทดสอบใหม่ `node --test tests/burger-network-budget.test.cjs` ผ่าน 4 กรณี; suite รวมยังมี baseline failures 2 รายการใน BigC (mock document.querySelectorAll และ regex สิทธิ์ settingsButton) ซึ่งไม่เกี่ยวกับไฟล์ที่แก้รอบนี้

## Current state

- หน้า `master-data.html?entity=items` ตั้งหน่วยฐาน/หน่วยซื้อ/อัตราแปลงในฟอร์มเดียวแล้ว และซ่อนธง `ซื้อได้/เบิกได้/ขายได้` จากฟอร์มกับการแก้หลายรายการโดยคงค่าเก่าไว้ การบันทึกหน่วยลง `M_หน่วยสินค้า` ตามหลัง `M_สินค้า`; หากขั้นที่สองล้มเหลว ฟอร์มยังเปิดให้ลองบันทึกซ้ำ
- ฟอร์มหน่วยซื้อในข้อมูลกลางบันทึกไปที่ `boy_central.master_catalog_rows` และ mirror ไป Google Sheets; ยัง **ไม่** ซิงก์หน่วยในตาราง POS `boy_central.items/item_units` อัตโนมัติ ห้ามถือว่าการแก้หน่วยฐานในข้อมูลกลางแปลงยอดสต็อกหรือสูตร POS ให้แล้ว
- ตรวจข้อมูลจริง 21 ต.ค. 2569: พบ 46 รายการที่จับคู่รหัสระหว่างข้อมูลกลางกับ POS ได้ และมีหน่วยฐานไม่ตรงกัน 3 รายการ (`ITEM-0273`, `ITEM-0283`, `ITEM-0336`); รายการหลังสุดชื่อในข้อมูลกลางเป็นลิ้นจี่ แต่ฝั่ง POS เป็นขนมปัง จึงต้องตรวจตัวตนก่อนทำระบบซิงก์อัตโนมัติ ไม่ backfill ข้อมูลเหล่านี้จากชื่อหรือรหัสอย่างเดียว
- ติดตั้ง BOY Central ใน Supabase โปรเจกต์ `BOY Burger POS` เดิมแล้ว โดยแยกตารางใหม่ทั้งหมดไว้ใน schema `boy_central` และฟังก์ชันภายในไว้ใน `boy_central_private`; ไม่แก้ตาราง POS เดิมใน `public`
- `boy_central` มีตารางฐาน 38 ตารางและข้อมูลสาขาเริ่มต้น 4 สาขา ครอบคลุมบริษัท/สาขา, Master ร่วม, การกำหนดรายการรายจ่าย/Supplier/Supplier ต่อสินค้าแยกสาขา, ธุรกรรม, การชำระเงิน, Stock Ledger, ต้นทุนเฉลี่ยต่อสาขา, Statement, POS shadow data, Import และ Audit Log
- เพิ่ม RLS แยกสิทธิ์ตามสาขา, API บันทึกรายจ่ายแบบ atomic, API รับ POS order/void แบบ idempotent และ API รับข้อมูลที่ตรวจแล้วจาก Google Sheets
- เพิ่ม Edge Function `sheet-import` และ `pos-shadow-sync`; รหัสลับอยู่ใน Supabase secrets เท่านั้นและไม่มีค่าจริงใน repository
- `BOY_Master` เพิ่มแท็บเตรียมนำเข้า `I_แก้ไขสินค้า`, `I_แก้ไข Supplier`, `I_แก้ไขพนักงาน`, `I_แก้ไขสาขา`, `I_ผลการนำเข้า` แล้ว โดยไม่แก้ข้อมูลแท็บเดิม
- `BOY_Master` เพิ่มแท็บกรอกสินค้าและรายการรายจ่ายแยกสำหรับร้านน้ำ/เบอร์เกอร์/เนื้อย่าง พร้อมแท็บผูก Supplier ต่อสาขาและต่อสินค้า โดย Master จริงยังรวมอยู่ใน BOY Central ชุดเดียว
- `BOY_Transactions` เพิ่มแท็บ `I_รายรับภายนอก`, `I_Statement_ช่องทางขาย`, `I_ค่าธรรมเนียม`, `I_รายการปรับปรุง`, `I_ประวัตินำเข้า` แล้ว พร้อมช่องกันยอด Grab/คนละครึ่งซ้ำกับ POS
- เพิ่ม `burger.html` ใน BOY สำหรับล็อกอิน บันทึก/ดูประวัติรายจ่าย ดูสต็อก และ Dashboard ร้านเบอร์เกอร์ พร้อมเมนูสลับร้านและ Supplier ที่กรองตามสินค้าแต่พิมพ์ชื่อใหม่ได้
- นำ Master ร้านเบอร์เกอร์จาก `BOY_Master` เข้า BOY Central แล้ว: หน่วย 22, สินค้า/วัตถุดิบ 40, รายการรายจ่าย 52 และ Supplier 5 ราย; รายการชื่อซ้ำที่ยังระบุตัวตนไม่ได้ (`ITEM-0307`, `ITEM-0309`) ยังไม่นำเข้าเพื่อป้องกันสต็อกปน
- หน้า Burger ตัดช่องวิธีชำระเงินออก, บันทึกร่างทั้งในเครื่องและ Supabase อัตโนมัติ, เปิดร่างตามวันที่ และแสดงรายการที่บันทึกแล้วของวันที่เลือก
- เพิ่มหน้าตั้งค่า Burger สำหรับค้นหา เพิ่ม และแก้สินค้า/วัตถุดิบกับรายการรายจ่าย โดยการเขียน Master จำกัดเฉพาะ Admin ผ่าน RPC
- หน้าตั้งค่า Burger แก้ข้อมูลธุรกิจหลักได้แล้ว: ประเภท/ประเภทย่อย, ประเภทข้อมูล, ยี่ห้อ/ขนาดบรรจุ, หน่วยฐาน/หน่วยซื้อ/อัตราแปลง/หน่วยเบิก, สถานะซื้อ-เบิก-ขาย, ระดับสต็อก, Supplier ต่อสินค้า/เจ้าหลัก, เงื่อนไขรายจ่าย, ลำดับแสดง, หมายเหตุ และสถานะใช้งาน; รายการที่ปิดแล้วยังมองเห็นและเปิดกลับได้จากหน้าตั้งค่า
- ใช้ Supabase session ชุดเดียวกันกับ Tawana, BigC, BigC Order และ Dashboard; เครื่องเดิมจำการเข้าสู่ระบบจนกว่าจะกดออกจากระบบ
- เพิ่ม POS bridge แบบปลอดภัย: อ่านยอดขาย/สต็อก POS ผ่าน RPC และเตรียมตารางจับคู่สินค้า BOY กับวัตถุดิบ POS; การซื้อจาก BOY จะเติม POS ต่อเมื่อ Admin สร้าง mapping แล้วเท่านั้น
- ตรวจพบข้อมูลจริงของ Burger POS อยู่ใน `public.pos_app_state`: วัตถุดิบ 23, เมนู 22, สูตร 37, ออเดอร์ที่แอปเก็บ 200 และ Stock Movement 500 รายการ
- เพิ่ม `pos_master_mappings` สำหรับรหัส string ของ POS รุ่นปัจจุบัน และนำ Master snapshot แรกเข้าแล้ว: วัตถุดิบ 23 + เมนู 22 จับคู่สำเร็จ 45/45; สร้างเมนูและสูตรใน BOY Central โดยไม่แตะสต็อกหรือออเดอร์เดิม
- Burger POS ส่งออเดอร์/ยกเลิกใหม่เข้า BOY Central ผ่านคิวออฟไลน์และ RPC ที่ตรวจ Auth, สิทธิ์สาขา และ idempotency key
- BOY Central เป็น Stock Ledger หลักของ Burger แล้ว โดยสร้าง opening balance ชั่วคราวจาก POS ครบ 23 วัตถุดิบ; หน้า Stock ของ BOY อ่านเฉพาะยอดกลาง ไม่ใช้ยอด POS เก่าทับอีก
- POS รุ่นใหม่ดึงสต็อกจาก BOY Central เมื่อเปิด/กลับมาออนไลน์/ทุก 15 วินาทีและหลังส่งออเดอร์สำเร็จ โดยไม่ทับข้อมูลขณะมีคิวออฟไลน์; รายการรับของจาก BOY จึงย้อนเข้า POS อัตโนมัติ
- Dashboard Burger ใน BOY อ่านยอดขายและช่องทางจากออเดอร์ที่นำเข้า BOY Central โดยตรง ไม่รวมยอด fallback ซ้ำกับข้อมูลกลาง
- ย้ายประวัติ POS ที่แอปเก็บไว้ครบ 200 ออเดอร์/284 บรรทัดขาย (ยกเลิก 3 ออเดอร์) เข้า Dashboard กลางแล้ว โดยตั้งใจไม่สร้าง stock movement ย้อนหลังเพื่อไม่ให้ตัดซ้ำกับ opening balance
- `BOY_Master` มีแท็บ `I_จับคู่_Burger_POS` สำหรับตรวจ Mapping ก่อนใช้จริงแล้ว รวมวัตถุดิบ POS 23 รายการและเมนูขาย 22 รายการ พร้อมรหัส BOY ที่เสนอ ช่องผลการตรวจ รหัสแก้ไข และหมายเหตุ; ชื่อตรงทั้งหมด แต่มีวัตถุดิบ 19 รายการที่ต้องยืนยันหน่วยหรืออัตราแปลง
- รายจ่าย BOY Central รองรับ Supplier แยกต่อรายการแล้ว และเก็บชื่อ Supplier ที่พิมพ์ใหม่ไว้ตรวจสอบโดยไม่สร้าง Master อัตโนมัติ
- `BOY_Transactions` มีโครงสร้างใหม่แล้ว: `_คู่มือระบบใหม่`, `T_Transactions`, `T_รายละเอียด`, `T_การชำระเงิน`, `T_สต็อกเคลื่อนไหว`, `T_ตรวจนับสต็อก`, `T_การลา`, `T_เงินเดือน`, `T_ไฟล์แนบ`, `T_ประวัติสถานะ`
- แท็บเดิมยังอยู่ครบและยังเป็นแหล่งข้อมูลของ Dashboard ระหว่างช่วงเปลี่ยนระบบ
- โค้ด Apps Script ในเครื่องเพิ่ม dual-write จาก flow เดิมไปยัง `T_*` สำหรับรายรับ รายจ่าย คำสั่งซื้อ รับ/คืนสินค้า การลา และเงินเดือน
- หน้ารายจ่ายทาวน่าและ BigC เพิ่มคำอธิบายบันทึกเร็ว โดยจำนวนและหน่วยเป็นข้อมูลที่กรอกเมื่อเกี่ยวกับสต็อก
- เพิ่ม `system-test.html` สำหรับตรวจความพร้อมของ Master/Transactions และตรวจ linkage ของรายการที่บันทึกผ่านหน้าเว็บจริง
- ปรับ `tawana.html` เป็น UI mobile-first ใหม่: แบ่งเมนูบันทึก/ลา/เงินเดือน/เพิ่มเติม, เมนูล่างติดขอบจอ, ตัวเลือกร้าน, สถานะบันทึกร่าง และหน้าตรวจสอบยอดก่อนส่ง
- เพิ่มหน้าพนักงานทาวน่าแบบภาพรวมรายเดือน พร้อมปุ่มเพิ่มวันลารายคน โดยอ่านรายชื่อและรายละเอียดจาก `M_พนักงาน`
- เพิ่ม `master-data.html` สำหรับเพิ่ม แก้ไข และเปิด/ปิดข้อมูล BOY Master จากหน้าเว็บ ครอบคลุมพนักงาน สินค้า ค่าใช้จ่าย หน่วย ผู้ขาย สาขา หมวดหมู่ และตารางความสัมพันธ์
- เพิ่มหน้าประวัติและสต็อกของทาวน่า โดยอ่านจาก `T_Transactions` และ `T_สต็อกเคลื่อนไหว`; ร่างรายวันสำรองลงเครื่องทันทีระหว่างพิมพ์และส่งขึ้น Apps Script เมื่อออนไลน์
- ปรับช่องรายจ่ายทาวน่าเป็น Dropdown แบบพิมพ์ค้นหาได้ในตัวเหมือนร้านเบอร์เกอร์ พร้อมชื่อหมวดและสถานะสต็อก; หน้า Master แสดงและกรองหมวดด้วยชื่อ โดยเก็บ `category_id`/`subcategory_id` ให้อัตโนมัติ
- ปรับ UI ทาวน่ารอบสองให้มีสีหลักเขียว สีรองส้ม และสีเน้นเหลือง, ลดพื้นที่หัวข้อ/วันที่, เอาการ์ดสรุปยอดออก และเปลี่ยนรายจ่ายเป็นการ์ดกดขยายที่แสดงชื่อ ยอด หมวด และสถานะสต็อกก่อน
- หน้าตรวจสอบก่อนส่งแสดงเฉพาะจำนวนรายการและคำเตือนเมื่อยังไม่กรอกเงินสด/เงินโอน พร้อมเพิ่มกฎ UI ของโปรเจกต์ไม่ให้นำบรีฟหรือเหตุผลการออกแบบมาแสดงบนหน้าปฏิบัติงาน
- เนื้อเบอร์เกอร์ 8 รายการใช้หน่วยฐาน `ชิ้น` และหน่วยซื้อ `แพ็ค` ตรงกันใน BOY_Master, BOY Central และ POS แล้ว: หมู 20, ไก่ 6, วัว 6, ปลา 10, กุ้ง 10, แพะ 5, กวาง 5 และกระต่าย 5 ชิ้นต่อแพ็ค
- ตั้งระดับสต็อกเนื้อเบอร์เกอร์จากยอดขายจริง 57 วันแล้ว โดยใช้สต็อกสำรองประมาณ 2 วัน จุดสั่งซื้อประมาณ 3 วัน และเป้าหมายประมาณ 7 วัน พร้อมปัดเป็นจำนวนเต็มแพ็ค; POS ใช้ `minimumStock` เท่ากับจุดสั่งซื้อเพื่อแจ้งเตือนก่อนของถึงระดับสำรอง

## Pending

- ตรวจข้อมูลจริง 21 ต.ค. 2569: หน้า `master-data.html` บันทึกหน่วยซื้อที่ `boy_central.master_catalog_rows` (`M_หน่วยสินค้า`) แต่ Burger/POS ใช้ `boy_central.items`, `item_units`, `expense_items` อีกชุด; ยังไม่มีการซิงก์การแก้หน่วยระหว่างสองชุดโดยอัตโนมัติ จึงเพิ่มคำเตือนตอนบันทึกหน่วยซื้อไว้ชั่วคราว ห้ามถือว่าหน่วยที่แก้ในข้อมูลกลางอัปเดต POS แล้ว ก่อนทำ bridge ต้องกระทบยอด: สินค้าใน catalog 274 รายการจับคู่ relational items ด้วยรหัสได้ 45, ใน 45 รายการนั้นมีหน่วยฐานไม่ตรง 2 (`ITEM-0273`, `ITEM-0283`), และ `expense_items` 11 รายการมีอัตราแปลงต่างจาก `item_units` (เช่นชีส `ITEM-0274`); อย่า backfill ทับอัตราแปลงเหล่านี้โดยไม่ตรวจหน่วยซื้อจริงและผลต่อสต็อก

- BigC interbranch withdrawal costing (2026-10-11) is a **code draft only**. BigC receipt keeps whole watermelon/pineapple in `ลูก`. The admin weight form is hidden until its database migration is deployed and verified. SQL draft supports mixed `ลูก`/`กก.` Tawana purchases and marks missing conversion pending. It has **not** been applied to production. Do not describe branch expense allocation as live; see `docs/BIGC_WITHDRAWAL_COSTING.md`.
- Before rollout: import and reconcile Tawana's confirmed purchases into canonical Supabase transactions; add canonical watermelon/pineapple raw items; map BigC menu UUIDs to raw items and reviewed yields; enter sampled kg/fruit values through the new form; add count-unit rules for other goods and return-to-receipt association; run functional DB and 390 px UI tests; reconcile branch/company reports. Supabase read on 2026-10-11 still found 0 Tawana transactions, 0 BigC workflows and no watermelon/pineapple item names.
- `น้ำส้ม (ขวด)` is consignment, not freshly extracted juice. Do not apply orange yield or change its source `item_name` while the Apps Script mirror still keys by display name.

- POS ร้านน้ำบน Android พร้อมเครื่องพิมพ์ในตัว ยังไม่ได้ build/ติดตั้ง/ทดสอบ: Mac ยังไม่เห็นอุปกรณ์ใน `adb devices -l` (17 ก.ย. 2569) และไม่มี Java Runtime สำหรับ Gradle; ต้องตรวจรุ่นเครื่อง, Android version และ printer SDK หลังเปิด USB debugging/อนุญาตเครื่องนี้ก่อน เลือก bridge เครื่องพิมพ์ตามฮาร์ดแวร์จริง ไม่ควรนำ bridge LAN/Bluetooth ของ Burger POS ไปใช้กับเครื่องพิมพ์ในตัวโดยเดา

- ติดตั้ง migration BOY Central บน Cloud และรัน schema contract ผ่านแล้ว; Data API มองเห็น `boy_central` แต่ผู้ใช้ anonymous ไม่มีสิทธิ์อ่านข้อมูลตามที่ออกแบบ
- ผู้ดูแลยืนยันอีเมลและล็อกอินสำเร็จแล้ว โปรไฟล์มีบทบาท `admin` และสิทธิ์ Admin ครบ 4 สาขา; หน้า Burger เชื่อมต่อและอ่านข้อมูลผ่าน RLS ได้จริง
- Master ร้านเบอร์เกอร์พร้อมใช้ใน `boy_central` แล้ว แต่ Master ร้านน้ำและร้านเนื้อย่างยังต้องตรวจและนำเข้าตามลำดับ
- Supabase Advisor ไม่พบคำเตือนด้านความปลอดภัยใน `boy_central`; Foreign Key ของฐานกลางมีดัชนีรองรับครบแล้ว ส่วนคำเตือนที่ยังเหลืออยู่เป็นของตาราง POS เดิมใน `public` จึงยังไม่แก้ในรอบนี้เพื่อไม่ให้กระทบระบบเดิม
- ขั้นตอนสร้าง Admin คนแรกจำกัดเฉพาะอีเมลผู้ดูแลที่ยืนยันแล้วด้วยค่า hash ในฐานข้อมูล และหน้า Burger รองรับการเข้าใช้งานแบบ Magic Link โดยไม่ต้องส่งรหัสผ่านให้ผู้อื่น
- เปิดทาง POS Shadow Sync สำหรับออเดอร์ใหม่แล้วโดยใช้ Supabase Auth; ไม่มี shared secret หรือ Service Role Key ใน Vite
- ยังไม่ได้ deploy Edge Functions `sheet-import` และ `pos-shadow-sync` หรือกำหนด secrets จริงบน Cloud
- ตาราง legacy `public.ingredients/orders` ไม่ใช่แหล่งข้อมูลหลักแล้ว; ออร์เดอร์จริงอยู่ในตาราง normalized ของ `boy_central` ส่วน `public.pos_app_state` เหลือใช้กับตั้งค่าร่วมขนาดเล็ก
- ต้องติดตั้ง Burger POS รุ่นที่ตัด JSON/รูปออกจาก cloud บนแท็บเล็ตก่อนล้าง snapshot เดิมใน `public.pos_app_state` เพื่อรักษารูปที่อยู่ในเครื่อง
- Opening balance ปัจจุบันเป็นยอดเดิมจาก POS และมีบางรายการติดลบ จึงต้องตรวจนับ/ปรับยอดจริงก่อนประกาศใช้สต็อกเป็นทางการ
- แท็บ `I_จับคู่_Burger_POS` ยืนยันรายการเนื้อเบอร์เกอร์ 8 รายการเป็น `ถูกต้อง` แล้ว; รายการวัตถุดิบอื่นที่ยังขึ้น `ยังไม่ได้ตรวจ` ต้องตรวจหน่วยหรืออัตราแปลงต่อก่อนนำไปใช้ตัดสต็อกจริง
- หน้า Burger ใส่ Supabase URL และ Public Publishable Key แล้ว ผู้ดูแลล็อกอิน อ่าน และบันทึกข้อมูลผ่าน RLS/RPC ได้จริง; Master สาขา Burger ถูกนำเข้าแล้ว
- รายละเอียดที่ยังให้จัดการผ่าน Sheet/งานนำเข้าคือหน่วยแปลงหลายระดับต่อสินค้า และข้อมูลจัดซื้อเชิงลึกต่อ Supplier เช่น MOQ/ระยะเวลาส่ง; ราคาซื้อล่าสุดควรมาจากธุรกรรมซื้อจริง ไม่ให้กรอกทับจากหน้า Master
- Apps Script รุ่นทดสอบ deploy เป็นเวอร์ชัน 28 แล้วที่ deployment แยก URL `AKfycbxZ-...q3nrcg`; ทดสอบโหลด Supplier จริงผ่านหน้า Tawana แล้ว ส่วน deployment เดิมที่หน้าเว็บออนไลน์ใช้อยู่ยังไม่ได้เปลี่ยน
- หน้า `system-test.html` ชี้ไป deployment ทดสอบ และส่ง URL นี้ให้หน้าใช้งานเฉพาะเมื่อเปิดจาก `file:`, `localhost` หรือ `127.0.0.1`
- หน้าใช้งานที่เปิดจาก `system-test.html` มีแถบ Test Mode, ซ่อนการแก้ Master และรักษา query ทดสอบเมื่อสลับระหว่างหน้าทาวน่า/BigC
- Apps Script มี maintenance functions `previewPreProductionReset`, `armPreProductionReset`, `runPreProductionReset`; ไม่เปิดผ่าน Web API และจะสำรอง BOY_Transactions ก่อนล้างข้อมูลธุรกรรมทดสอบ
- แก้ `appendRows_` ให้หาแถวสุดท้ายจากคอลัมน์ A แทน `getLastRow()` เพื่อไม่ให้ค่า checkbox `FALSE` ในแถวว่างดันข้อมูลไปท้ายชีต และย้ายรายการทดลองใน `T_Transactions` กลับมาอยู่แถว 2–7 แล้ว
- ตัวเลือกร้านเนื้อ/Grill และ Burger แสดงเป็น “เร็วๆ นี้” จนกว่าจะมีหน้าและ flow หลังบ้านของแต่ละร้าน; BigC เปิดสลับใช้งานได้แล้ว
- ต้องทดสอบ live หลัง deploy อย่างน้อย: รายจ่ายทั่วไปหนึ่งรายการ, รายจ่ายสินค้าสต็อกหนึ่งรายการ, รายรับ, BigC order/receive/return, การลา และการคำนวณเงินเดือน
- `T_ไฟล์แนบ` เตรียมโครงสร้างไว้แล้ว แต่ยังไม่เปิดอัปโหลดรูปใบเสร็จจากเว็บ เพราะ endpoint ปัจจุบันเปิดแบบ anonymous และต้องออกแบบสิทธิ์/การป้องกันการอัปโหลดก่อน
- BOY Master มี `M_ผู้ขาย` และเพิ่ม `M_ผู้ขายสินค้า` แล้ว เพื่อกำหนดผู้ขายได้หลายเจ้าต่อสินค้า; เริ่มต้นใส่น้ำเชื่อมกับ Makro และ Go Whole Sale เป็นตัวอย่างใช้งานจริง
- หน้า `tawana.html` เลือกหรือพิมพ์ Supplier ได้ และกรองรายชื่อตาม `M_ผู้ขายสินค้า`; ผู้ขายที่ตรงกับ `M_ผู้ขาย` จะเขียน `supplier_id` ลง `T_Transactions` ส่วนชื่อที่พิมพ์ใหม่ยังเก็บเป็นข้อความไว้ตรวจสอบ

## Manual steps

- ใช้ `system-test.html` ทดสอบ flow จริงกับ deployment ทดสอบก่อนอัปเดต deployment เดิม
- สร้างผู้ใช้ Supabase Auth คนแรกด้วยอีเมลของผู้ดูแล จากนั้นผูกเป็น Admin ของบริษัทและสาขา ก่อนเปิดทดสอบหน้า Burger
- Deploy Edge Functions และตั้ง `SHEET_IMPORT_SECRET`/`POS_SYNC_SECRET` ใน Supabase secrets ก่อนเริ่มนำเข้าชีตหรือ Shadow Sync; ห้ามเก็บค่าเหล่านี้ในเว็บหรือ GitHub
- เครื่อง Mac นี้ติดตั้ง `clasp` และล็อกอินบัญชีที่เข้าถึง BOY Apps Script แล้ว สามารถ `clasp push`, สร้าง version และอัปเดต deployment ได้ โดย credentials อยู่ที่ home directory และไม่อยู่ใน repository
- เมื่อทุก flow ผ่านแล้วจึงอัปเดต deployment เดิมที่หน้า BOY ออนไลน์ใช้อยู่
- บนอุปกรณ์ Burger POS ให้เข้า Settings > BOY Central และยืนยัน Magic Link หนึ่งครั้ง จากนั้นกด “ซิงก์ตอนนี้” เพื่อส่ง Master snapshot และคิวออเดอร์ใหม่

## Notes

- รายละเอียด BOY Central, บทบาท Google Sheets และลำดับ Cutover อยู่ใน `docs/BOY_CENTRAL.md`
- ข้อมูลในแท็บ `I_*` เป็น staging เท่านั้น ไม่ใช่ข้อมูลจริงจนกว่าจะตรวจ อนุมัติ และนำเข้า Supabase สำเร็จ

## Storage และรายงาน

- Dashboard รวมอ่านยอดสรุปรายวัน/รายเดือนจาก Supabase RPC โดยตรง ไม่โหลด Google Sheet หรือประวัติออร์เดอร์ทั้งหมด
- BOY Central ไม่เก็บ `raw_payload` ซ้ำในออร์เดอร์และกะใหม่แล้ว; รายละเอียดที่ใช้งานจริงยังอยู่ครบในตาราง normalized
- เพิ่มประวัติออร์เดอร์แบบ cursor pagination สูงสุด 50 รายการต่อครั้ง และตัวตรวจพื้นที่ฐานข้อมูลสำหรับ Admin
- มีสคริปต์สำรองฐานข้อมูลแบบเข้ารหัสที่ `scripts/backup-boy-central.sh`; ต้องตั้งค่าไฟล์ลับนอก repository ก่อนนำไปตั้งเวลาในเครื่องสำรอง
- การแก้รายการที่เคยยืนยันแล้วจะเปลี่ยนรายการเดิมเป็น `ยกเลิก` และสร้างรายการใหม่ ไม่ลบประวัติใน `T_*`
- ธุรกรรมรับ/คืนสินค้าที่ถูกแทนที่จะสร้าง stock movement ย้อนกลับ เพื่อไม่ให้ยอดสต็อกถูกนับซ้ำ
- รายจ่ายที่จับคู่สินค้าและติดตามสต็อกจะอยู่สถานะ `รอรับสินค้า`; รายการที่หา ID ไม่เจอจะอยู่สถานะ `รอตรวจสอบ`

## BigC โยเกิร์ตและการผูกสินค้าที่ไม่นับสต็อก (26 ต.ค. 2569)

- Supabase migration `20261026120000` และ `20261026133000` รันสำเร็จแล้ว: โยเกิร์ต 5 กก. แยกสต็อกรวมรสธรรมดา/สตรอว์เบอร์รี หน่วยแกลลอน; ยี่ห้อจริง 5 รายการโยงเข้ากลุ่มตามรส
- BigC สั่งด้วยชื่อกลางและเลือกยี่ห้อจริงพร้อมจำนวนเมื่อรับ; นโยบายล่าสุด (1 พ.ย. 2569) **ไม่ตัดสต็อกเมื่อสั่ง** และรับ/คืนแบบไม่เคลื่อนสต็อกเป็นค่าเริ่มต้น รายการที่เปิด “นับสต็อกที่ BigC” เท่านั้นจึงเพิ่ม/ลดสต็อก BigC; ถ้าเปิด “ตัดสต็อกทาวน่าเมื่อ BigC รับ” อีกชั้นจึงโอนยอดจากทาวน่าด้วย โดยระบบไม่ยอมให้ยอดต้นทางติดลบ
- หน้าเชื่อมสินค้า BigC เลือกสินค้าใน M_สินค้าได้แม้ไม่ติดตามสต็อก; รายการที่ยังไม่มีหน่วยฐานจะผูกด้วยรหัสข้อความได้ แต่ต้นทุนอัตโนมัติยังรอให้กำหนดหน่วยฐานและธุรกรรมซื้อจริง
- ยังไม่มีธุรกรรมซื้อของทาวน่าหรือยอดสต็อกโยเกิร์ตใน Supabase ณ วันที่ตรวจ จึงยังทดสอบการรับของจริงและต้นทุนที่คำนวณสำเร็จไม่ได้ ต้องนับยอดเริ่มต้นหรือบันทึกการซื้อจริงก่อนรับเข้า BigC; ห้ามตั้งยอดเดา
- การเปลี่ยน M_สินค้า 7 แถวถูกบันทึกเป็นคิว mirror รอส่ง Google Sheet; Supabase เป็นข้อมูลหลัก

## BigC สต็อกเลือกนับและโอนต้นทุน (1 พ.ย. 2569)

- ใช้ migration `20261101161524` และ `20261101162721` ใน Supabase แล้ว: การรับ/คืนคำนวณสต็อกตามธงต่อรายการ; การโอนต้นทุนใช้ `branch_cost_allocations` และ Dashboard ของ BigC/ทาวน่าแสดงค่าใช้จ่ายที่โอนบวก/ลบตามสาขา
- เฉพาะแก้วทาวน่า `ITEM-0142` (PP 22 oz สกรีน), `ITEM-0143` (PP 22 oz ไม่สกรีน), `ITEM-0144` (PP 16 oz) เท่านั้นที่ระบบอนุญาตให้เปิดการหักสต็อกทาวน่าอัตโนมัติในรอบนี้; ฝา/หลอดเปิดนับสต็อก BigC ได้เมื่อหน่วยและยอดตั้งต้นถูกต้อง แต่ยังไม่หักทาวน่าอัตโนมัติ
- **ยังไม่เปิดธงสต็อกให้รายการจริง** และยังไม่ลงยอดตั้งต้น: ต้องรับยอดนับจริงของแก้วทั้งสามก่อนเปิดการโอน; หลอด `ITEM-0145/0146` ต้องมีอัตราแปลง `ลัง → ห่อ` ก่อนเปิดรับเข้าสต็อก BigC ห้ามเดาตัวเลข
- ทดสอบ SQL แบบ `BEGIN … ROLLBACK` ผ่านการรับ 2 แก้วและคืน 1 แก้ว (ทาวน่า 10→8→9, BigC 0→2→1), กรณีไม่เปิดธงไม่เคลื่อนสต็อก, และ Dashboard โอนต้นทุน 200 บาท (ทาวน่า −200, BigC +200); ไม่มีธุรกรรมทดสอบค้างในฐานข้อมูล

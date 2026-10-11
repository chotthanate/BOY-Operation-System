# BigC interbranch withdrawal costing

## Business rule

`close_order` is a request, not a cost event. The confirmed `receive` quantity is
the cost event. A confirmed `return` reverses the original receipt cost for the
quantity returned. External purchases remain on the Tawana purchase ledger;
branch reporting allocates the received cost **to BigC and away from Tawana**
without adding a second company-wide purchase.

The item displayed to staff can be measured in pieces, packs or dozens. The
costing mass is separate from the operational count: it is observed kilograms
when weighed, or an explicitly estimated equivalent for whole fruit counted
by piece.

| Item received | Recorded at BigC | Raw equivalent for costing |
| --- | --- | --- |
| Whole, unpeeled watermelon or pineapple | count in `ลูก` | count × approved estimated raw kg per fruit |
| Other whole fruit weighed at receipt | actual raw kg | actual raw kg |
| Peeled/prepared fruit | count if useful, and actual ready kg | ready kg / verified flesh yield |
| Extracted juice | bottles/dozens if useful, and actual finished juice kg | juice kg / verified extraction yield |

`น้ำส้ม (ขวด)` in the existing source is a **consignment product**, not
freshly extracted Tawana juice. Keep its identity and accounting separate from
`น้ำส้มคั้นจากส้มสด (โหล)`; never apply the orange extraction yield to the
consignment line. Rename both display labels only with a source-ID-preserving
migration, so prior orders still point at the same item. The current Apps Script
mirror keys rows by `item_name`, so changing only the BigC display label can
break the sheet mirror; show a consignment badge until that identity path is
changed safely.

The yield is the fraction of raw mass that becomes usable finished mass. For
example, 2 kg of peeled watermelon at a 60% yield represents 2 / 0.60 = 3.333 kg
of raw watermelon. Do not multiply by the loss percentage. Orange juice is
ordered/received in dozens, but a fixed `dozen -> kg` conversion must **not**
be invented. Keep both the dozen count and the actual finished weight from
that receipt.

For source item `i` and receipt date in month `m`, the purchase price is the
weighted average of confirmed external Tawana purchase lines in that month:

`sum(net line amount) / sum(raw kilograms, observed or explicitly estimated)`.

The denominator must be raw kilograms. A purchase in `กก.` contributes its
recorded kilograms. A purchase in `ลูก` contributes count × the approved,
effective-month raw kg per fruit for that specific item. The same estimate
converts BigC's count-only watermelon or pineapple receipt into raw-equivalent
kilograms for costing; staff still receive those goods in `ลูก`. Do not mutate
the stock unit or claim the estimated mass was actually weighed. Missing
piece estimates or any other purchase unit make the entire month's price
pending; a partial subset of kg-only purchases must not be used silently.
Maintain separate watermelon and pineapple estimates backed by a sampled
weighing note. No default numerical weight is seeded by code.

Use the latest earlier month only when the current month has no valid purchase
lines, and retain the price month, age and source line IDs. Current-month costs
are provisional until month close. An unknown item mapping, unit conversion,
price or yield creates a visible **pending cost**; it must never be treated as
zero or posted as a final allocation.

## Identity and data flow

1. BigC menu lines need stable mapping to a canonical BigC item, canonical raw
   Tawana item, measurement type and (for processed fruit) an effective-dated
   yield. Thai display names are only for humans and must not be the final join.
2. First establish which Tawana purchase workbook/feed is authoritative for
   current transactions. A separate live `ร้านน้ำ ทาวน่า 2569` workbook has
   October expense rows while `BOY_Transactions` was last modified in August.
   The legacy app's normalized `T_Transactions` and `T_รายละเอียด` schema is
   technically preferable to flat `รายจ่าย`, but freshness and coverage must
   be confirmed before choosing an importer. Import confirmed purchases into
   `boy_central.transactions` and `transaction_lines`, with legacy string IDs
   stored as external identifiers; never cast those IDs to UUID.
3. A repeat submit of the same Tawana day cancels older Google rows and creates
   new IDs. Import the cancellation/revision state, not just the latest rows,
   and use source/idempotency keys to avoid duplicate purchases.
4. BigC receipt/cost allocation must be atomic and idempotent by workflow line
   and revision. Editing a submitted receipt should reverse the prior posting
   before applying the new one; a retry must not post twice.
5. Branch expense reports add the internal allocation to BigC and subtract it
   from Tawana. Company-wide external purchase expense remains unchanged.
   Do not create a second external expense transaction for BigC.

## Current evidence and release gates (2026-10-10)

- `boy_central` currently has **zero Tawana purchase/expense transactions** and
  no canonical orange or watermelon items. It cannot compute a genuine monthly
  fruit purchase average yet.
- The Supabase copy of `M_UW_สรุป` has orange extraction yield 46.69% and
  watermelon flesh yield 60.49%, but these are legacy string item IDs, not
  canonical UUID mappings. Other yield rows can be blank despite a `พร้อม`
  review label; each chosen yield must be validated individually.
- The existing `รายการเบิกของ` sheet calls a consignment item `น้ำส้ม (ขวด)`,
  unit `ขวด`, with `จำนวน x ราคาเฉลี่ย` and no UW. This is a *different item*
  from fresh orange juice transferred by dozens. Do not reinterpret its
  historical bottles as juice yield or dozens.
- The live Tawana October sheet records orange purchases in kilograms, but
  watermelon purchases in `ลูก` (for example 27 fruits for 1,616 baht on
  8 October). The new price resolver can mix both units, but watermelon and
  pineapple remain pending until their approved kg/fruit estimates are entered.
- BigC V2 currently records request/receipt/return workflow lines. Until the
  cost migration is deployed and the source mapping/import passes a reconciliation
  review, the UI may collect real receipt weights but must show pending cost
  rather than claim branch expense allocation is live.
- The current return form does not select an originating receipt. A return
  cannot reverse a verified original cost until this association is recorded;
  the draft backend must leave it pending instead of guessing a receipt.
- General merchandise in count units (packs, bottles, etc.) still needs an
  explicit verified same-unit or conversion rule; the first calculation draft
  handles only raw kilogram fruit and prepared/juiced kilogram yield.

Before live financial posting: verify the latest Tawana purchase source,
import canonical fruit masters and purchase rows, reconcile monthly totals
against the source, approve BigC item/yield mappings (including orange juice),
test receive/edit/retry/return cases, and compare the two branch expense reports
plus company-wide total. Add a same-unit/conversion path for non-fruit items
and explicit return-to-receipt selection before claiming all withdrawals are
costed. Do not backfill by fuzzy name matching.

## Next code and release sequence

1. Add canonical raw watermelon and pineapple items and import verified Tawana
   purchase lines with their actual purchase unit (`ลูก` or `กก.`), net amount,
   source ID and confirmation state. Preserve the stock unit separately from
   the costing estimate. Reconcile imported monthly cost totals to the source.
2. Admin opens BigC `ตั้งค่ารายการ` → `ต้นทุนผลไม้ · น้ำหนักเฉลี่ยต่อลูก`,
   chooses the canonical raw item, and records a sampled kg/fruit value and
   the effective month. The form never seeds an invented default. Until then,
   count-only receipts save normally but their financial allocation is pending.
3. Map each BigC received fruit item UUID to the Tawana raw item UUID; enter
   `counted_by_piece=true` for whole watermelon/pineapple and reviewed
   flesh/juice yield only for processed fruit. The backend requires this
   mapping flag rather than trusting a Thai display label. Validate the
   consignment orange-bottle item separately.
4. Deploy and execute the SQL contract and functional tests for mixed kg/piece
   purchases, missing estimate, count-only receipt, partial return, revision,
   idempotency and company-wide zero-sum allocation. Check the 390 px BigC
   settings and receipt screens in an allowed browser environment.
5. Reconcile BigC expense added, Tawana expense removed and the unchanged
   company total before enabling the resulting costs in live branch reports.

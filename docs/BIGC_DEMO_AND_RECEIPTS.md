# BigC receipt history and demo

- Live app: `bigc-v2.html`. Submitted orders/receipts/returns write to Supabase, then mirror to Google Sheets. Receipts also run the existing stock/cost reconciliation.
- Demo: `bigc-demo.html`, linked by **ทดลอง** in the live header. It uses a sample catalog, loads no auth/Supabase client scripts, and stores only keys beginning with `boy-bigc-demo:`.
- Demo orders automatically set the receiving date to the next day. Receive some items, add an additional round, then expand **รับแล้ว** to inspect totals and individual rounds.
- **ล้างข้อมูลทดลอง** clears only the demo namespace. Nothing is promoted or sent to the live system.
- History is read through `get_bigc_v2_receive_history(date)`. New accepted lines from each `append_bigc_v2_receive` call produce one batch with a server timestamp.
- Duplicate retries do not create additional rounds. Original receipt rows without batch metadata are labeled as legacy data; their historical round count is unknown.
- History rows are read-only to authenticated branch users. The authorized receipt writer records them in the same database transaction as receipt/stock/cost updates.

Validation:

```sh
node --test tests/bigc-demo-store.test.cjs tests/bigc-receive-queue.test.cjs
```

`tests/bigc-receive-history.sql` checks two rounds and retry deduplication in a transaction that rolls back every test fixture. Run only through an administrative SQL connection.

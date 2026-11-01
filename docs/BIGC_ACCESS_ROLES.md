# BigC access roles

PINs are verified by Supabase Auth against separate owner and dedicated staff accounts. Actual PINs/passwords are never embedded in frontend code, migrations, tests or documentation.

| Capability | Owner/admin | Dedicated BigC staff |
| --- | --- | --- |
| Order, receive, return, daily summary | Yes | Yes |
| Display size, order/receipt history | Yes | Yes |
| Product list | Edit | Read only |
| Units, costing, master mapping, stock settings | Edit | Hidden and write denied |
| Default return items | Edit | Edit through restricted RPC |
| Sorting | Shared settings | Current device |
| Staff-link panel | Visible | Hidden |
| BOY Central navigation | Available | Hidden; direct URLs redirect to BigC |

- Staff identity has `company_role=staff`, employee code `BIGC-SHARED-STAFF`, and an active staff branch role only for `BIGC-CENTRAL-PATTAYA`.
- Roles come from database profiles/branch roles. URL parameters and user-editable Auth metadata do not grant management privileges.
- `save_bigc_v2_default_returns` accepts only `default_return_keys`, validates them against the existing menu, and preserves every product/unit/cost/mapping/stock field. It runs only for authenticated BigC branch users.
- `bigc-staff-account` is an admin-only Edge Function for configuring the dedicated staff Auth account. It uses Supabase Auth Admin APIs server-side and a service-role-only database procedure. Service keys are read from the Edge runtime environment and are never shipped to the browser.
- A successful staff login clears the former owner-only local fallback. Remembered Supabase sessions and device-local logout continue to work for both roles.
- Existing owner credentials and admin identity are retained.

Validation:

```sh
node --test tests/boy-pin-auth.test.cjs tests/boy-staff-page-guard.test.cjs tests/boy-session-storage.test.cjs tests/bigc-receive-queue.test.cjs tests/bigc-demo-store.test.cjs
```

`tests/bigc-staff-permissions.sql` tests the real dedicated staff identity inside a transaction and rolls back every preference change.

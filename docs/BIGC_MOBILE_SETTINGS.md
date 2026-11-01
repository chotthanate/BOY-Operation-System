# BigC mobile settings

- Personal settings are available to staff and managers. Product/unit/cost/mapping administration keeps its existing access restrictions.
- Order history lives in personal settings, outside the ordering list.
- On phone screens up to 600 px, card size **small** shows three columns and **large** shows two. Preference keys use the existing live/demo namespaces and apply to the current browser only.
- Ordering search and category navigation remain below the fixed branch header and workflow tabs. ResizeObserver measures their actual heights so they do not overlap.
- Authentication continues to use Supabase sessions and refresh tokens. No PIN/password is stored by the new session adapter. The adapter shares the existing canonical Supabase storage keys and maintains an IndexedDB copy for reopening the same browser.
- Settings logout uses local-device scope and clears both stored session copies and the existing local-access fallback. Local order drafts are retained. A logout marker prevents an old storage copy from restoring an explicitly signed-out session.
- Expired/revoked sessions or clearing all site data can require login again. Separate browsers or private browsing do not share a remembered account.
- Receipt behavior is unchanged: saving checked lines removes those lines from pending slips after the database confirms success. Unchecked lines remain. Tests cover three slips containing 6, 5 and 8 lines, both partial and all-at-once receipt, including repeated products across slips.

Checks:

```sh
node --test tests/boy-session-storage.test.cjs tests/bigc-receive-queue.test.cjs tests/bigc-demo-store.test.cjs
```

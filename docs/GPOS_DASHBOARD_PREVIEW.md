# GPOS dashboard preview

This integration reads today's GPOS daily-sales report every 30 minutes on GitHub Actions. It updates one display-only Supabase row for BigC Central Pattaya. It never posts to BOY income, transactions, or Google Sheets.

## First-time setup

1. Run `npm ci --prefix scripts/gpos-cloud` and `node scripts/gpos-cloud/setup.cjs` on a trusted computer. Sign in to GPOS and open its daily-sales report. The setup waits for a row for today and saves cookies, local storage, and session storage in `.gpos-browser-profile/gpos-cloud-state.json`, which is ignored by Git. It rejects an empty login state.
2. Add the following repository Actions secrets: `GPOS_AUTH_STATE_B64` (gzip the JSON file, then base64-encode it to stay under GitHub's secret-size limit), `BOY_GPOS_INGEST_TOKEN` (contents of the ignored `.gpos-ingest-token` file), `GPOS_LOGIN_EMAIL`, and `GPOS_LOGIN_PASSWORD`. Never commit these values. Rotate the GPOS password shared in chat and update its GitHub secret afterward.
3. Run the workflow manually once and verify the BigC Central Pattaya branch dashboard shows a GPOS preview with an update time. Scheduled workflows run only from the default branch.

The stored browser state may expire. The worker may fill credentials and sign in again only when the GPOS terms checkbox is already checked by GPOS. It never checks that box itself. If GPOS requires a new acceptance or a challenge, the job fails and the dashboard marks the last preview stale after 90 minutes. Repeat the manual setup to refresh the browser state.

The GitHub schedule is best effort and can be delayed or skipped. No snapshot is published if login, parsing, or validation fails. The table is keyed by branch and business date, so repeated runs update the same row rather than appending 48 rows per day.

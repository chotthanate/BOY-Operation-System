# BigC frozen-brand dropdown handoff

Updated 2026-11-24.

- Web UI and demo now offer Savepak, aro and Supersave for all nine existing frozen-fruit products.
- Database changes were applied and verified with rolled-back receipt tests, including all 27 brand choices, retry safety and historical receipt compatibility.
- The backend migration and database integration test were intentionally excluded from this public commit: automatic approval review rejected publishing backend SQL here.
- Local reviewed files remain under `tmp/BOY-bigc-brands-20261124/`: `supabase/migrations/20261123190931_bigc_frozen_brand_links.sql` and `tests/bigc-frozen-brands.sql`.
- Do not rerun or reconstruct the backend change blindly; coordinate a user-approved way to preserve these local files before future backend work.

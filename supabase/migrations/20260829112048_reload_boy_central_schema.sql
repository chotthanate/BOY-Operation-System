-- The hosted PostgREST process may apply the exposed-schema configuration
-- before refreshing relation metadata, so request an explicit schema reload.
notify pgrst, 'reload schema';

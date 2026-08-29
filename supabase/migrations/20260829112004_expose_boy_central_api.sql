-- Keep the legacy POS API on public while exposing the isolated BOY Central schema.
-- This is version-controlled because a manual authenticator override supersedes
-- the dashboard's Exposed Schemas setting.
alter role authenticator
set pgrst.db_schemas = 'public, graphql_public, boy_central';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
